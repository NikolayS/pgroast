import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT, ensureDataDirs, expandHome } from "./config.ts";
import { AppDatabase } from "./db.ts";
import { classifyBugText } from "./services/bugs.ts";
import {
  fetchCommitFests,
  performCfMutatingAction,
  refreshSinglePatch,
  syncCommitFest,
  verifyCfLogin,
} from "./services/commitfest.ts";
import { compileInlineCommentsToHackersEmail, fetchPatchDiffForCf } from "./services/diff.ts";
import { runAllDraftGates, wrapEmailBody } from "./services/gates.ts";
import {
  buildSanitizedIssuePreview,
  listForkIssues,
  listForkPrs,
  publishSanitizedIssue,
  pushCiBranch,
} from "./services/github.ts";
import { generateNikDraft, saveDraftToGmail, searchGmailThreads } from "./services/gmail.ts";
import { detectAvailableAiBackends, runDoctor } from "./services/health.ts";
import { publishBriefToHub, publishOpinionToHub, pullOpinionsFromHub } from "./services/hub.ts";
import { connectGitHubIdentity, connectGoogleIdentity, disconnectIdentity, getCurrentContributor } from "./services/identity.ts";
import { JobRunner } from "./services/jobs.ts";
import { buildLightRoast } from "./services/lightroast.ts";
import { BUILTIN_SAVED_SEARCHES } from "./services/query.ts";
import { checkLocalhostSecurity, createLocalSecurityConfig, localSecurityHeaders } from "./services/security.ts";
import { getActiveSkills } from "./services/skills.ts";
import { exportFrozenStaticSnapshot } from "./services/snapshot.ts";
import { buildStatsReport } from "./services/stats.ts";
import {
  buildShortlistAndTop50,
  renderShortlistDigestMarkdown,
  suggestExpertsForEntry,
} from "./services/shortlist.ts";
import type { DraftAttachment, RoastJson } from "./types.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...localSecurityHeaders("json"),
    },
  });
}

function errorJson(err: unknown, status = 400): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, status);
}

async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

async function buildUiBundle(): Promise<string> {
  const entry = join(APP_ROOT, "src", "ui", "app.ts");
  if (!existsSync(entry)) {
    return 'console.error("UI entry not found");';
  }
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });
  if (!built.success || !built.outputs[0]) {
    const msgs = built.logs.map((l) => l.message).join("\n");
    throw new Error(`UI bundle failed:\n${msgs}`);
  }
  return await built.outputs[0].text();
}

export interface CreateServerOptions {
  db?: AppDatabase;
  port?: number;
  autoImport?: boolean;
  requireAuth?: boolean;
  authToken?: string;
}

export async function createAppHandler(opts?: {
  db?: AppDatabase;
  autoImport?: boolean;
  port?: number;
  requireAuth?: boolean;
  authToken?: string;
}) {
  const db = opts?.db ?? (await AppDatabase.create());
  const settings = await db.getSettings();
  ensureDataDirs(settings);
  const jobs = new JobRunner(db);
  const sec = createLocalSecurityConfig({ requireAuth: opts?.requireAuth, token: opts?.authToken });

  // Auto-import precomputed roast batch on first launch if DB is empty
  if (opts?.autoImport !== false && (await db.countEntries()) === 0 && settings.roastDataDir) {
    const resolved = expandHome(settings.roastDataDir);
    if (existsSync(resolved)) {
      try {
        const res = await db.importRoastBatch(resolved);
        if (res.imported > 0) {
          console.log(`[pgroast-app] Auto-imported ${res.imported} roasts from ${resolved}`);
        }
      } catch (err) {
        console.warn(`[pgroast-app] Auto-import skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  let cachedBundle = await buildUiBundle();
  const htmlPath = join(APP_ROOT, "src", "ui", "index.html");
  const cssPath = join(APP_ROOT, "src", "ui", "styles.css");
  const faviconPath = join(APP_ROOT, "src", "ui", "favicon.svg");
  let activePort = opts?.port ?? settings.port ?? 3432;

  const setActivePort = (p: number) => {
    activePort = p;
  };

  async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Mythos Localhost Security Gate: exact Host allowlist, reject foreign/null Origin, per-boot Bearer token on /api/*
    const secCheck = checkLocalhostSecurity(req, activePort, sec);
    if (!secCheck.ok) {
      return errorJson(secCheck.error, secCheck.status);
    }

    try {
      // ---- Static / SPA UI ----
      if (method === "GET" && (path === "/" || path === "/index.html")) {
        let html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "<h1>pgroast-app</h1>";
        const fetchSite = (req.headers.get("sec-fetch-site") || "").toLowerCase();
        const canInjectMetaToken =
          sec.requireAuth &&
          !sec.strictUrlTokenOnly &&
          fetchSite !== "cross-site" &&
          req.headers.get("origin") === null;
        if (canInjectMetaToken) {
          html = html.replace(
            "</head>",
            `  <meta name="pgroast-session-token" content="${sec.token}" />\n  </head>`,
          );
        }
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", ...localSecurityHeaders("html") },
        });
      }
      if (method === "GET" && path === "/styles.css") {
        const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
        return new Response(css, {
          headers: { "Content-Type": "text/css; charset=utf-8", ...localSecurityHeaders("asset") },
        });
      }
      if (method === "GET" && (path === "/favicon.svg" || path === "/favicon.ico")) {
        const svg = existsSync(faviconPath) ? readFileSync(faviconPath, "utf8") : "";
        return new Response(svg, {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
      if (method === "GET" && path === "/app.js") {
        if (process.env.PGROAST_APP_DEV === "1") {
          cachedBundle = await buildUiBundle();
        }
        return new Response(cachedBundle, {
          headers: { "Content-Type": "application/javascript; charset=utf-8", ...localSecurityHeaders("asset") },
        });
      }

      // ---- Health & Doctor ----
      if (method === "GET" && path === "/api/health") {
        const [curSettings, entriesCount, verdictStats, cfAuth, hubStatus, pgInfo] = await Promise.all([
          db.getSettings(),
          db.countEntries(),
          db.getVerdictStats(),
          db.getCfAuthStatus(),
          db.getHubStatus(),
          db.getServerInfo().catch(() => ({ version: "", database: "", schema: db.schema })),
        ]);
        const skillsInfo = getActiveSkills(curSettings);
        return json({
          ok: true,
          app: "pgroast-app",
          version: "0.1.0",
          host: "127.0.0.1",
          port: activePort,
          database: pgInfo,
          entriesCount,
          verdictStats,
          cfAuth,
          hubStatus,
          settings: curSettings,
          identity: getCurrentContributor(curSettings),
          aiSummary: detectAvailableAiBackends(curSettings),
          skillsSummary: {
            mode: skillsInfo.mode,
            count: skillsInfo.skills.length,
            names: skillsInfo.skills.map((s) => s.name),
            customDir: skillsInfo.customDirConfigured,
            customDirValid: skillsInfo.customDirValid,
          },
        });
      }

        if (method === "GET" && path === "/api/doctor") {
          return json(await runDoctor(db, await db.getSettings()));
        }

        // ---- Settings & Auth ----
        if (method === "GET" && path === "/api/settings") {
          const [curSettings, cfAuth, hubStatus] = await Promise.all([
            db.getSettings(),
            db.getCfAuthStatus(),
            db.getHubStatus(),
          ]);
          const skillsInfo = getActiveSkills(curSettings);
          return json({
            settings: curSettings,
            identity: getCurrentContributor(curSettings),
            cfAuth,
            hubStatus,
            aiSummary: detectAvailableAiBackends(curSettings),
            skillsSummary: {
              mode: skillsInfo.mode,
              count: skillsInfo.skills.length,
              names: skillsInfo.skills.map((s) => s.name),
              customDir: skillsInfo.customDirConfigured,
              customDirValid: skillsInfo.customDirValid,
            },
          });
        }

        if (method === "PUT" && path === "/api/settings") {
          const body = await readBody<Record<string, unknown>>(req);
          const updated = await db.updateSettings(body);
          ensureDataDirs(updated);
          await db.logAudit("settings_update", "settings", { keys: Object.keys(body) });
          return json({ settings: updated, cfAuth: await db.getCfAuthStatus() });
        }

        if (method === "POST" && path === "/api/cf/auth/cookies") {
          const body = await readBody<{ sessionid?: string; csrftoken?: string; cookieHeader?: string; clear?: boolean }>(req);
          if (body.clear) {
            await db.clearCfCookies();
            await db.logAudit("cf_cookies_cleared", "auth", {});
            return json({ ok: true, cfAuth: await db.getCfAuthStatus() });
          }
          let sid = body.sessionid || "";
          let csrf = body.csrftoken || "";
          if (body.cookieHeader) {
            const sidMatch = body.cookieHeader.match(/sessionid=([^;\s]+)/);
            const csrfMatch = body.cookieHeader.match(/csrftoken=([^;\s]+)/);
            if (sidMatch?.[1]) sid = sidMatch[1];
            if (csrfMatch?.[1]) csrf = csrfMatch[1];
          }
          if (!sid && !csrf) {
            return errorJson("Provide sessionid (and optionally csrftoken) or a raw Cookie header string.", 400);
          }
          await db.setCfCookies(sid, csrf);
          await db.logAudit("cf_cookies_saved", "auth", { hasSession: Boolean(sid), hasCsrf: Boolean(csrf) });
          return json({ ok: true, cfAuth: await db.getCfAuthStatus() });
        }

        if (method === "POST" && path === "/api/cf/auth/verify") {
          const result = await verifyCfLogin(db);
          return json({ ...result, cfAuth: await db.getCfAuthStatus() });
        }

        // ---- Import Batch ----
        if (method === "POST" && path === "/api/import/batch") {
          const body = await readBody<{ dir?: string }>(req);
          const targetDir = body.dir || (await db.getSettings()).roastDataDir;
          const result = await db.importRoastBatch(targetDir);
          await db.logAudit("import_batch", targetDir, { imported: result.imported, skipped: result.skipped, errors: result.errors.length });
          return json({ ...result, stats: await db.getVerdictStats() });
        }

        // ---- Shortlist & Top-50 ----
        if (method === "GET" && path === "/api/shortlist") {
          const topN = Number(url.searchParams.get("top") || 20);
          const rejectN = Number(url.searchParams.get("reject") || 50);
          const includeExperts = url.searchParams.get("experts") !== "0";
          const data = await buildShortlistAndTop50(db, { topN, rejectN, includeExperts });
          if (url.searchParams.get("format") === "markdown") {
            return new Response(renderShortlistDigestMarkdown(data), {
              headers: { "Content-Type": "text/markdown; charset=utf-8" },
            });
          }
          return json(data);
        }

        if (method === "POST" && path === "/api/auth/github/connect") {
          const result = await connectGitHubIdentity(db, await db.getSettings());
          return json(result);
        }

        if (method === "POST" && path === "/api/auth/google/connect") {
          const result = await connectGoogleIdentity(db, await db.getSettings());
          return json(result);
        }

        if (method === "POST" && path === "/api/auth/disconnect") {
          const result = await disconnectIdentity(db);
          return json(result);
        }

        if (method === "GET" && path === "/api/search") {
          const q = url.searchParams.get("q") || "";
          return json(await db.searchGlobal(q));
        }

        const opinionsMatch = path.match(/^\/api\/entries\/(\d+)\/opinions$/);
        if (method === "GET" && opinionsMatch) {
          const cfId = Number(opinionsMatch[1]);
          return json({ cf_id: cfId, opinions: await db.listRoastRuns(cfId) });
        }
        if (method === "POST" && opinionsMatch) {
          const cfId = Number(opinionsMatch[1]);
          const body = await readBody<{
            backend?: string;
            models?: Record<string, string> | string;
            verdict?: string;
            confidence?: string;
            summaryTxt?: string;
            contributorName?: string;
            contributorHandle?: string;
            contributorProvider?: "github" | "google" | "local";
          }>(req);
          if (!body.verdict?.trim()) return errorJson("verdict is required", 400);
          const cur = getCurrentContributor(await db.getSettings());
          const saved = await db.addExternalOpinion({
            cfId,
            backend: body.backend || "manual",
            models: body.models,
            verdict: body.verdict.trim(),
            confidence: body.confidence || "medium",
            summaryTxt: body.summaryTxt || "",
            contributorName: body.contributorName?.trim() || cur.name,
            contributorHandle: body.contributorHandle?.trim() || cur.handle,
            contributorProvider: body.contributorProvider || cur.provider,
            contributorAvatar: cur.avatarUrl,
          });
          return json({ opinion: saved }, 201);
        }

        // ---- Stats & Insights ----
        if (method === "GET" && path === "/api/stats") {
          return json(await buildStatsReport(db));
        }

        // ---- Frozen Static HTML Snapshot Exporter (#193) ----
        if (method === "POST" && path === "/api/export/snapshot") {
          const body = await readBody<{ topN?: number; rejectN?: number; analyticsBeaconUrl?: string }>(req);
          const result = await exportFrozenStaticSnapshot(db, body);
          return json(result, 201);
        }

        // ---- Saved Searches ----
        if (method === "GET" && path === "/api/saved-searches") {
          return json({
            presets: BUILTIN_SAVED_SEARCHES,
            custom: await db.listSavedSearches(),
          });
        }

        if (method === "POST" && path === "/api/saved-searches") {
          const body = await readBody<{ name?: string; query?: string }>(req);
          if (!body.name?.trim() || !body.query?.trim()) {
            return errorJson("name and query are required", 400);
          }
          const saved = await db.saveSearch(body.name, body.query);
          return json({ saved }, 201);
        }

        const savedSearchDelMatch = path.match(/^\/api\/saved-searches\/(\d+)$/);
        if (method === "DELETE" && savedSearchDelMatch) {
          await db.deleteSavedSearch(Number(savedSearchDelMatch[1]));
          return json({ ok: true });
        }

        // ---- CommitFest Entries & Sync ----
        if (method === "GET" && path === "/api/entries") {
          const [res, stats] = await Promise.all([
            db.listEntries({
              search: url.searchParams.get("search") || undefined,
              verdict: url.searchParams.get("verdict") || undefined,
              status: url.searchParams.get("status") || undefined,
              mineOnly: url.searchParams.get("mine") === "1",
              starredOnly: url.searchParams.get("starred") === "1",
              sortBy: (url.searchParams.get("sort") as "score" | "cf_id" | "updated" | "objections") || "score",
              limit: Number(url.searchParams.get("limit") || 500),
              offset: Number(url.searchParams.get("offset") || 0),
            }),
            db.getVerdictStats(),
          ]);
          return json({ ...res, stats });
        }

        const entryTriageMatch = path.match(/^\/api\/entries\/(\d+)\/triage$/);
        if (method === "PATCH" && entryTriageMatch) {
          const cfId = Number(entryTriageMatch[1]);
          const body = await readBody<{ starred?: boolean; tags?: string[]; notes?: string; markVisited?: boolean }>(req);
          const triage = await db.upsertEntryTriage(cfId, body);
          return json({ triage, stats: await db.getVerdictStats() });
        }

        const entryMatch = path.match(/^\/api\/entries\/(\d+)$/);
        if (method === "GET" && entryMatch) {
          const cfId = Number(entryMatch[1]);
          const entry = await db.getEntry(cfId);
          if (!entry) return errorJson(`Entry CF ${cfId} not found`, 404);
          let roast: RoastJson | null = null;
          if (entry.roast_json) {
            try {
              roast = JSON.parse(entry.roast_json) as RoastJson;
            } catch {
              roast = null;
            }
          }
          const [triage, curSettings, runs, workItems, drafts, jobList] = await Promise.all([
            db.upsertEntryTriage(cfId, { markVisited: true }),
            db.getSettings(),
            db.listRoastRuns(cfId),
            db.listWorkItems(cfId),
            db.listDrafts(cfId),
            db.listJobs(20, cfId),
          ]);
          const experts = suggestExpertsForEntry(entry, roast, curSettings.postgresRepo);
          const lightRoast = buildLightRoast(entry, roast);
          return json({
            entry,
            roast,
            experts,
            lightRoast,
            triage,
            runs,
            workItems,
            drafts,
            jobs: jobList,
          });
        }

        if (method === "GET" && path === "/api/cf/commitfests") {
          const list = await fetchCommitFests();
          return json({ commitfests: list });
        }

        if (method === "POST" && path === "/api/cf/sync") {
          const body = await readBody<{ cfNumber?: number }>(req);
          const cfNumber = Number(body.cfNumber || 62);
          const result = await syncCommitFest(db, cfNumber);
          return json(result);
        }

        const cfRefreshMatch = path.match(/^\/api\/cf\/(\d+)\/refresh$/);
        if (method === "POST" && cfRefreshMatch) {
          const cfId = Number(cfRefreshMatch[1]);
          const result = await refreshSinglePatch(db, cfId);
          return json(result);
        }

        // Guarded CommitFest Mutating Actions
        const cfReviewerBecome = path.match(/^\/api\/cf\/(\d+)\/reviewer\/become$/);
        if (method === "POST" && cfReviewerBecome) {
          const body = await readBody<{ confirm?: boolean }>(req);
          const res = await performCfMutatingAction(db, Number(cfReviewerBecome[1]), { type: "reviewer_become" }, Boolean(body.confirm));
          return json(res);
        }

        const cfReviewerRemove = path.match(/^\/api\/cf\/(\d+)\/reviewer\/remove$/);
        if (method === "POST" && cfReviewerRemove) {
          const body = await readBody<{ confirm?: boolean }>(req);
          const res = await performCfMutatingAction(db, Number(cfReviewerRemove[1]), { type: "reviewer_remove" }, Boolean(body.confirm));
          return json(res);
        }

        const cfStatusMatch = path.match(/^\/api\/cf\/(\d+)\/status$/);
        if (method === "POST" && cfStatusMatch) {
          const body = await readBody<{ status?: "review" | "author" | "committer"; confirm?: boolean }>(req);
          if (!body.status) return errorJson("Missing status (review | author | committer)", 400);
          const res = await performCfMutatingAction(
            db,
            Number(cfStatusMatch[1]),
            { type: "status", status: body.status },
            Boolean(body.confirm),
          );
          return json(res);
        }

        const cfAnnotateMatch = path.match(/^\/api\/cf\/(\d+)\/annotate$/);
        if (method === "POST" && cfAnnotateMatch) {
          const body = await readBody<{ mailthreadId?: string; messageId?: string; text?: string; confirm?: boolean }>(req);
          const res = await performCfMutatingAction(
            db,
            Number(cfAnnotateMatch[1]),
            {
              type: "annotate",
              mailthreadId: body.mailthreadId || "",
              messageId: body.messageId || "",
              text: body.text || "",
            },
            Boolean(body.confirm),
          );
          return json(res);
        }

        const cfRequeueMatch = path.match(/^\/api\/cf\/(\d+)\/cfbot-requeue$/);
        if (method === "POST" && cfRequeueMatch) {
          const body = await readBody<{ confirm?: boolean }>(req);
          const res = await performCfMutatingAction(db, Number(cfRequeueMatch[1]), { type: "cfbot_requeue" }, Boolean(body.confirm));
          return json(res);
        }

        // ---- Jobs & SSE Streaming ----
        if (method === "GET" && path === "/api/jobs") {
          const cfIdParam = url.searchParams.get("cfId");
          const list = await db.listJobs(100, cfIdParam ? Number(cfIdParam) : undefined);
          return json({ jobs: list });
        }

        const jobGetMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
        if (method === "GET" && jobGetMatch) {
          const job = await db.getJob(jobGetMatch[1]!);
          if (!job) return errorJson("Job not found", 404);
          return json({ job, log: await jobs.readLog(job.id) });
        }

        const jobStreamMatch = path.match(/^\/api\/jobs\/([^/]+)\/stream$/);
        if (method === "GET" && jobStreamMatch) {
          const jobId = jobStreamMatch[1]!;
          const job = await db.getJob(jobId);
          if (!job) return errorJson("Job not found", 404);

          const encoder = new TextEncoder();
          let unsubscribe: (() => void) | null = null;
          let heartbeat: ReturnType<typeof setInterval> | null = null;

          const stream = new ReadableStream({
            start(controller) {
              const send = (event: string, data: string) => {
                const payload = data
                  .split(/\r?\n/)
                  .map((line) => `data: ${line}`)
                  .join("\n");
                try {
                  controller.enqueue(encoder.encode(`event: ${event}\n${payload}\n\n`));
                } catch {
                  // Stream closed
                }
              };
              send("status", JSON.stringify({ id: job.id, status: job.status, title: job.title }));
              unsubscribe = jobs.subscribe(jobId, (event, data) => {
                send(event, data);
                if (event === "done") {
                  if (heartbeat) clearInterval(heartbeat);
                  try {
                    controller.close();
                  } catch {
                    // Already closed
                  }
                }
              });
              heartbeat = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(`: ping\n\n`));
                } catch {
                  if (heartbeat) clearInterval(heartbeat);
                }
              }, 15_000);
            },
            cancel() {
              if (heartbeat) clearInterval(heartbeat);
              unsubscribe?.();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        const jobCancelMatch = path.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
        if (method === "POST" && jobCancelMatch) {
          const res = await jobs.cancelJob(jobCancelMatch[1]!);
          return json(res);
        }

        if (method === "POST" && path === "/api/jobs/roast") {
          const body = await readBody<{
            cfId?: number;
            target?: string;
            backend?: "claude" | "agy" | "codex" | "dual";
            claudeModel?: string;
            agyModel?: string;
            rounds?: number;
            selfMode?: boolean;
            dryRun?: boolean;
          }>(req);
          const job = await jobs.startRoastJob(body);
          return json({ job }, 201);
        }

        if (method === "POST" && path === "/api/jobs/pushback") {
          const body = await readBody<{ cfId: number; backend?: "claude" | "agy" | "codex"; dryRun?: boolean }>(req);
          if (!body.cfId) return errorJson("cfId is required", 400);
          const job = await jobs.startPushbackJob(body);
          return json({ job }, 201);
        }

        if (method === "POST" && path === "/api/jobs/build-test") {
          const body = await readBody<{
            cfId: number;
            workItemId?: number;
            targetBranch?: string;
            suites?: string[];
            patchSource?: "cfbot" | "none";
          }>(req);
          if (!body.cfId) return errorJson("cfId is required", 400);
          const job = await jobs.startBuildTestJob(body);
          return json({ job }, 201);
        }

        if (method === "POST" && path === "/api/jobs/ai-review") {
          const body = await readBody<{
            cfId?: number;
            workItemId?: number;
            worktreePath?: string;
            backend?: "claude" | "agy";
            model?: string;
            focusPrompt?: string;
            blindVerify?: boolean;
            previousBackend?: "claude" | "agy";
          }>(req);
          const job = await jobs.startAiReviewJob({
            ...body,
            backend: body.backend || "claude",
          });
          return json({ job }, 201);
        }

        if (method === "POST" && path === "/api/jobs/hetzner") {
          const body = await readBody<{
            cfId?: number;
            workItemId?: number;
            profile?: "asan" | "wal_consistency" | "tap_matrix" | "custom";
            customCommand?: string;
          }>(req);
          const job = await jobs.startHetznerJob({
            ...body,
            profile: body.profile || "asan",
          });
          return json({ job }, 201);
        }

        if (method === "POST" && path === "/api/worktrees/cleanup") {
          const body = await readBody<{ worktreePath?: string }>(req);
          if (!body.worktreePath) return errorJson("worktreePath is required", 400);
          return json(await jobs.cleanupWorktree(body.worktreePath));
        }

        // ---- Work Items ----
        if (method === "GET" && path === "/api/work-items") {
          const cfId = url.searchParams.get("cfId");
          return json({ workItems: await db.listWorkItems(cfId ? Number(cfId) : undefined) });
        }

        if (method === "POST" && path === "/api/work-items") {
          const body = await readBody<{
            cf_id?: number | null;
            slug?: string;
            title?: string;
            target_branch?: string;
            evidence_md?: string;
            is_security?: boolean;
          }>(req);
          const title = body.title?.trim() || (body.cf_id ? `CF ${body.cf_id}` : "Untitled work item");
          const slug =
            body.slug?.trim() ||
            title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 40) ||
            `item-${Date.now()}`;
          const item = await db.createWorkItem({
            cf_id: body.cf_id ?? null,
            slug,
            title,
            target_branch: body.target_branch || "master",
            evidence_md: body.evidence_md || "",
            is_security: Boolean(body.is_security),
          });
          return json({ workItem: item }, 201);
        }

        const workItemMatch = path.match(/^\/api\/work-items\/(\d+)$/);
        if (method === "GET" && workItemMatch) {
          const item = await db.getWorkItem(Number(workItemMatch[1]));
          if (!item) return errorJson("Work item not found", 404);
          return json({ workItem: item });
        }
        if (method === "PATCH" && workItemMatch) {
          const id = Number(workItemMatch[1]);
          const body = await readBody<Record<string, unknown>>(req);
          const updated = await db.updateWorkItem(id, body);
          if (!updated) return errorJson("Work item not found", 404);
          return json({ workItem: updated });
        }

        // ---- Gmail & Draft Studio ----
        if (method === "GET" && path === "/api/gmail/search") {
          const q = url.searchParams.get("q") || "";
          if (!q.trim()) return errorJson("Query parameter q is required", 400);
          const matches = searchGmailThreads(await db.getSettings(), q, Number(url.searchParams.get("max") || 10));
          return json({ matches });
        }

        if (method === "GET" && path === "/api/drafts") {
          const cfId = url.searchParams.get("cfId");
          return json({ drafts: await db.listDrafts(cfId ? Number(cfId) : undefined) });
        }

        if (method === "POST" && path === "/api/drafts") {
          const body = await readBody<Record<string, unknown>>(req);
          const draft = await db.createDraft(body);
          return json({ draft }, 201);
        }

        const draftPatchMatch = path.match(/^\/api\/drafts\/(\d+)$/);
        if (method === "PATCH" && draftPatchMatch) {
          const body = await readBody<Record<string, unknown>>(req);
          const updated = await db.updateDraft(Number(draftPatchMatch[1]), body);
          if (!updated) return errorJson("Draft not found", 404);
          return json({ draft: updated });
        }

        if (method === "POST" && path === "/api/drafts/check-gates") {
          const body = await readBody<{
            body?: string;
            subject?: string;
            isReply?: boolean;
            isOtherAuthorThread?: boolean;
            attachments?: DraftAttachment[];
            cfId?: number | null;
            inReplyTo?: string;
            wrap?: boolean;
          }>(req);
          const rawBody = body.wrap ? wrapEmailBody(body.body || "", 72) : body.body || "";
          const entry = body.cfId ? await db.getEntry(body.cfId) : null;
          const existingDraftCount = body.cfId ? (await db.listDrafts(body.cfId)).length : 0;
          const gates = runAllDraftGates({
            body: rawBody,
            subject: body.subject || "",
            isReply: body.isReply !== false,
            isOtherAuthorThread: body.isOtherAuthorThread !== false,
            attachments: body.attachments ?? [],
            cfId: body.cfId,
            inReplyTo: body.inReplyTo,
            existingDraftCount,
            knownLatestMessageTime: entry?.latest_message_time,
            lastSyncedAt: entry?.synced_at,
          });
          return json({ gates, wrappedBody: rawBody });
        }

        if (method === "POST" && path === "/api/drafts/generate") {
          const body = await readBody<Parameters<typeof generateNikDraft>[2]>(req);
          const generated = await generateNikDraft(db, await db.getSettings(), body);
          return json(generated);
        }

        const draftSaveGmailMatch = path.match(/^\/api\/drafts\/(\d+)\/save-gmail$/);
        if (method === "POST" && draftSaveGmailMatch) {
          const result = await saveDraftToGmail(db, await db.getSettings(), Number(draftSaveGmailMatch[1]));
          return json(result);
        }

        // ---- GitHub Fork Tracker ----
        if (method === "GET" && path === "/api/github/issues") {
          return json({ issues: listForkIssues(await db.getSettings()) });
        }

        if (method === "GET" && path === "/api/github/prs") {
          return json({ prs: listForkPrs(await db.getSettings()) });
        }

        if (method === "POST" && path === "/api/github/issues/preview") {
          const body = await readBody<{ workItemId?: number }>(req);
          if (!body.workItemId) return errorJson("workItemId is required", 400);
          const wi = await db.getWorkItem(body.workItemId);
          if (!wi) return errorJson("Work item not found", 404);
          const entry = wi.cf_id ? await db.getEntry(wi.cf_id) : null;
          return json(buildSanitizedIssuePreview(wi, entry));
        }

        if (method === "POST" && path === "/api/github/issues/publish") {
          const body = await readBody<{
            workItemId?: number;
            title?: string;
            body?: string;
            commentOnExisting?: boolean;
            confirm?: boolean;
          }>(req);
          if (!body.workItemId) return errorJson("workItemId is required", 400);
          const res = await publishSanitizedIssue(db, await db.getSettings(), body.workItemId, {
            title: body.title || "",
            body: body.body || "",
            commentOnExisting: Boolean(body.commentOnExisting),
            confirm: Boolean(body.confirm),
          });
          return json(res);
        }

        if (method === "POST" && path === "/api/github/ci-push") {
          const body = await readBody<{ workItemId?: number; branchName?: string; confirm?: boolean }>(req);
          if (!body.workItemId || !body.branchName) {
            return errorJson("workItemId and branchName are required", 400);
          }
          const res = await pushCiBranch(db, await db.getSettings(), body.workItemId, {
            branchName: body.branchName,
            confirm: Boolean(body.confirm),
          });
          return json(res);
        }

        // ---- pgsql-bugs Production Triage ----
        if (method === "GET" && path === "/api/bugs") {
          const bugs = await db.listBugReports({
            classification: url.searchParams.get("classification") || undefined,
            severity: url.searchParams.get("severity") || undefined,
            status: url.searchParams.get("status") || undefined,
          });
          return json({ bugs });
        }

        if (method === "POST" && path === "/api/bugs/scan") {
          const body = await readBody<{ days?: number; limit?: number }>(req);
          const job = await jobs.startBugsTriageJob(body);
          return json({ job }, 201);
        }

        if (method === "POST" && path === "/api/bugs") {
          const body = await readBody<{
            message_id?: string;
            subject?: string;
            sender?: string;
            thread_url?: string;
            body_text?: string;
          }>(req);
          if (!body.subject?.trim()) return errorJson("subject is required", 400);
          const cls = classifyBugText(body.subject, body.body_text || "");
          const bug = await db.upsertBugReport({
            message_id: body.message_id?.trim() || `manual-${Date.now()}`,
            subject: body.subject.trim(),
            sender: body.sender || "",
            thread_url: body.thread_url || "",
            reported_at: new Date().toISOString(),
            classification: cls.classification,
            severity: cls.severity,
            confidence: cls.confidence,
            production_signals_json: JSON.stringify(cls.signals),
            summary: (body.body_text || body.subject).slice(0, 300),
            affected_versions: cls.affectedVersions,
            status: "new",
            work_item_id: null,
          });
          return json({ bug }, 201);
        }

        const bugPatchMatch = path.match(/^\/api\/bugs\/(\d+)$/);
        if (method === "PATCH" && bugPatchMatch) {
          const body = await readBody<{ status?: "new" | "triaged" | "reproducing" | "reproduced" | "replied" | "dismissed"; work_item_id?: number | null }>(req);
          if (!body.status) return errorJson("status is required", 400);
          const bug = await db.updateBugReportStatus(Number(bugPatchMatch[1]), body.status, body.work_item_id);
          if (!bug) return errorJson("Bug report not found", 404);
          return json({ bug });
        }

        // ---- Public Companion Hub (Local -> Public ONLY) ----
        if (method === "POST" && path === "/api/hub/token") {
          const body = await readBody<{ token?: string; url?: string; clear?: boolean }>(req);
          if (body.url !== undefined) {
            await db.updateSettings({ publicHubUrl: body.url.trim() });
          }
          if (body.clear) {
            await db.clearHubToken();
            await db.logAudit("hub_token_cleared", "hub", {});
            return json({ ok: true, hubStatus: await db.getHubStatus() });
          }
          if (body.token?.trim()) {
            await db.setHubToken(body.token.trim());
            await db.logAudit("hub_token_saved", "hub", {});
          }
          return json({ ok: true, hubStatus: await db.getHubStatus() });
        }

        if (method === "POST" && path === "/api/hub/publish-opinion") {
          const body = await readBody<{ cfId?: number; backend?: string; verdict?: string; confidence?: string; summary?: string; confirm?: boolean }>(req);
          if (!body.cfId || !body.verdict) return errorJson("cfId and verdict are required", 400);
          const res = await publishOpinionToHub(db, await db.getSettings(), {
            cfId: Number(body.cfId),
            backend: body.backend,
            verdict: body.verdict,
            confidence: body.confidence,
            summary: body.summary,
            confirm: Boolean(body.confirm),
          });
          return json(res, 201);
        }

        if (method === "POST" && path === "/api/hub/pull-opinions") {
          const body = await readBody<{ cfId?: number }>(req);
          if (!body.cfId) return errorJson("cfId is required", 400);
          const res = await pullOpinionsFromHub(db, await db.getSettings(), Number(body.cfId));
          return json(res);
        }

        if (method === "POST" && path === "/api/hub/publish-brief") {
          const body = await readBody<{ slug?: string; title?: string; commitfestLabel?: string; topN?: number; rejectN?: number; confirm?: boolean }>(req);
          const res = await publishBriefToHub(db, await db.getSettings(), {
            slug: body.slug,
            title: body.title,
            commitfestLabel: body.commitfestLabel,
            topN: body.topN,
            rejectN: body.rejectN,
            confirm: Boolean(body.confirm),
          });
          return json(res, 201);
        }

        // ---- Experimental Patch Diff & Inline Review ----
        const diffMatch = path.match(/^\/api\/entries\/(\d+)\/diff$/);
        if (method === "GET" && diffMatch) {
          const cfId = Number(diffMatch[1]);
          const [diff, comments] = await Promise.all([
            fetchPatchDiffForCf(cfId),
            db.listDiffComments(cfId),
          ]);
          return json({ diff, comments });
        }

        const diffCommentsMatch = path.match(/^\/api\/entries\/(\d+)\/diff\/comments$/);
        if (method === "GET" && diffCommentsMatch) {
          return json({ comments: await db.listDiffComments(Number(diffCommentsMatch[1])) });
        }
        if (method === "POST" && diffCommentsMatch) {
          const cfId = Number(diffCommentsMatch[1]);
          const body = await readBody<{ file_path?: string; line_num?: number; line_type?: "add" | "del" | "ctx"; code_snippet?: string; comment_text?: string }>(req);
          if (!body.file_path || !body.comment_text?.trim()) return errorJson("file_path and comment_text are required", 400);
          const comment = await db.addDiffComment({
            cf_id: cfId,
            file_path: body.file_path,
            line_num: Number(body.line_num || 1),
            line_type: body.line_type || "add",
            code_snippet: body.code_snippet || "",
            comment_text: body.comment_text.trim(),
          });
          return json({ comment }, 201);
        }

        const diffCommentDelMatch = path.match(/^\/api\/entries\/(\d+)\/diff\/comments\/(\d+)$/);
        if (method === "DELETE" && diffCommentDelMatch) {
          await db.deleteDiffComment(Number(diffCommentDelMatch[2]));
          return json({ ok: true });
        }

        const diffCompileMatch = path.match(/^\/api\/entries\/(\d+)\/diff\/compile-email$/);
        if (method === "POST" && diffCompileMatch) {
          const cfId = Number(diffCompileMatch[1]);
          const [entry, comments, curSettings] = await Promise.all([
            db.getEntry(cfId),
            db.listDiffComments(cfId),
            db.getSettings(),
          ]);
          if (!entry) return errorJson(`Entry CF ${cfId} not found`, 404);
          if (comments.length === 0) return errorJson("Add at least one inline diff comment first.", 400);
          const compiled = compileInlineCommentsToHackersEmail(entry, comments, curSettings.authorName);
          return json(compiled);
        }

        // ---- Audit Log ----
        if (method === "GET" && path === "/api/audit") {
          return json({ logs: await db.listAuditLogs(100) });
        }

        return errorJson(`Not found: ${method} ${path}`, 404);
      } catch (err) {
        return errorJson(err, 400);
      }
  }

  return { fetch: fetchHandler, db, jobs, settings, setActivePort, authToken: sec.token };
}

export async function createAppServer(opts?: CreateServerOptions) {
  const app = await createAppHandler(opts);
  const port = opts?.port ?? app.settings.port ?? 3432;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 120,
    fetch: app.fetch,
  });
  app.setActivePort(server.port ?? port);
  return { server, db: app.db, jobs: app.jobs, fetch: app.fetch, authToken: app.authToken };
}

if (import.meta.main) {
  const { server, authToken } = await createAppServer();
  console.log(`pgroast-app running at http://127.0.0.1:${server.port} (local-only)`);
  console.log(`Direct tokenized URL: http://127.0.0.1:${server.port}/?token=${authToken}`);
}
