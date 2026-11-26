import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderBriefMarkdown, renderInteractiveBriefHtml } from "./brief.ts";
import { loadWebConfig, WEB_ROOT, type WebConfig } from "./config.ts";
import { WebDatabase, type PublicEntryRecord } from "./db.ts";
import { fetchMrDiffForCf, fetchMrDiscussionForCf } from "./mr.ts";
import { checkPublicPayloadSafe, securityHeaders } from "./security.ts";

function escAttr(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanVerdictLabel(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return "No fundamental objection";
  if (v === "NEEDS-COMMITTER-EYES") return "Needs committer eyes";
  if (v === "NEEDS-DESIGN-DISCUSSION") return "Needs design discussion";
  if (v === "LIKELY-REJECT") return "Likely reject";
  return v || "Not reviewed";
}

function computePatchConsensus(
  opinions: Array<{ verdict: string; contributor_handle: string; contributor_name: string; backend: string }>,
  baselineVerdict?: string,
) {
  const counts: Record<string, number> = {};
  const reviewers = new Set<string>();
  const models = new Set<string>();
  for (const op of opinions) {
    const v = op.verdict || "UNROASTED";
    counts[v] = (counts[v] || 0) + 1;
    if (op.contributor_handle || op.contributor_name) reviewers.add(op.contributor_handle || op.contributor_name);
    if (op.backend) models.add(op.backend);
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = opinions.length;
  if (total === 0) {
    return {
      status: "baseline_only" as const,
      leadingVerdict: baselineVerdict || "UNROASTED",
      totalOpinions: 0,
      uniqueReviewers: 0,
      uniqueModels: 0,
      breakdown: counts,
      headline: baselineVerdict && baselineVerdict !== "UNROASTED"
        ? `Baseline brief pass: ${humanVerdictLabel(baselineVerdict)}. Waiting for additional reviewer AI opinions to build consensus.`
        : "No reviewer AI opinions published yet for this patch.",
    };
  }
  const [topVerdict, topCount] = ranked[0]!;
  const pct = Math.round((topCount / total) * 100);
  if (ranked.length === 1) {
    return {
      status: "unanimous" as const,
      leadingVerdict: topVerdict,
      totalOpinions: total,
      uniqueReviewers: reviewers.size,
      uniqueModels: models.size,
      breakdown: counts,
      headline: `Unanimous across ${total} opinion${total === 1 ? "" : "s"} (${reviewers.size} reviewer${reviewers.size === 1 ? "" : "s"}): ${humanVerdictLabel(topVerdict)}.`,
    };
  }
  if (pct >= 60) {
    return {
      status: "majority" as const,
      leadingVerdict: topVerdict,
      totalOpinions: total,
      uniqueReviewers: reviewers.size,
      uniqueModels: models.size,
      breakdown: counts,
      headline: `Majority (${topCount}/${total}) lean ${humanVerdictLabel(topVerdict)}, with ${total - topCount} differing opinion${total - topCount === 1 ? "" : "s"}.`,
    };
  }
  return {
    status: "split" as const,
    leadingVerdict: topVerdict,
    totalOpinions: total,
    uniqueReviewers: reviewers.size,
    uniqueModels: models.size,
    breakdown: counts,
    headline: `Split opinions across ${total} runs (${reviewers.size} reviewer${reviewers.size === 1 ? "" : "s"}): compare arguments below to find common ground.`,
  };
}

function json(data: unknown, status = 200, req?: Request): Response {
  const payload = JSON.stringify(data);
  const acceptEnc = req?.headers.get("accept-encoding") || "";
  if (payload.length > 2048 && /\bgzip\b/i.test(acceptEnc)) {
    const gz = Bun.gzipSync(Buffer.from(payload, "utf8"));
    return new Response(gz, {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        Vary: "Accept-Encoding",
        ...securityHeaders("json"),
      },
    });
  }
  return new Response(payload, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders("json"),
    },
  });
}

function errJson(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

async function buildUiJs(): Promise<string> {
  const entry = join(WEB_ROOT, "src", "ui", "app.ts");
  if (!existsSync(entry)) return "";
  const res = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: false,
  });
  if (!res.success || !res.outputs[0]) {
    throw new Error(res.logs.map((l) => l.message).join("\n"));
  }
  return await res.outputs[0].text();
}

export async function createWebHandler(opts?: { db?: WebDatabase; config?: Partial<WebConfig> }) {
  const cfg: WebConfig = { ...loadWebConfig(), ...(opts?.config || {}) };
  const db = opts?.db ?? (await WebDatabase.create({ databaseUrl: cfg.databaseUrl }));
  let bundleJs = await buildUiJs();

  const htmlPath = join(WEB_ROOT, "src", "ui", "index.html");
  const cssPath = join(WEB_ROOT, "src", "ui", "styles.css");
  const faviconPath = join(WEB_ROOT, "src", "ui", "favicon.svg");
  const cssHash = createHash("sha256").update(readFileSync(cssPath, "utf8")).digest("hex").slice(0, 8);
  const jsHash = createHash("sha256").update(bundleJs).digest("hex").slice(0, 8);

  async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // ---- Static UI ----
      if (method === "GET" && (path === "/favicon.svg" || path === "/favicon.ico")) {
        return new Response(readFileSync(faviconPath, "utf8"), {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && path === "/robots.txt") {
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
        });
      }
      const patchPageMatch = path.match(/^\/patch\/(\d+)\/?$/);
      if (method === "GET" && (path === "/" || path === "/index.html" || patchPageMatch)) {
        const cfId = Number(patchPageMatch?.[1] || url.searchParams.get("cf") || 0);
        let title = "pgroast — Public CommitFest Triage & Collaboration";
        let desc = "PostgreSQL CommitFest pre-review triage briefs, multi-model reviewer opinions, and common-ground consensus.";
        if (cfId > 0) {
          const entry = await db.getEntry(cfId);
          if (entry) {
            title = `CF ${entry.cf_id}: ${entry.title} — pgroast`;
            const parts = [
              entry.verdict ? humanVerdictLabel(entry.verdict) : "Not reviewed",
              entry.status || "",
              entry.authors ? `by ${entry.authors}` : "",
            ].filter(Boolean);
            desc = parts.join(" · ");
          } else {
            title = `CF ${cfId} — pgroast`;
          }
        }
        const ogTags = [
          `<meta name="description" content="${escAttr(desc)}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="pgroast" />`,
          `<meta property="og:title" content="${escAttr(title)}" />`,
          `<meta property="og:description" content="${escAttr(desc)}" />`,
          `<meta name="twitter:card" content="summary" />`,
          `<meta name="twitter:title" content="${escAttr(title)}" />`,
          `<meta name="twitter:description" content="${escAttr(desc)}" />`,
        ].join("\n  ");
        const html = readFileSync(htmlPath, "utf8")
          .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(title)}</title>\n  ${ogTags}`)
          .replace("/styles.css", `/styles.css?v=${cssHash}`)
          .replace("/app.js", `/app.js?v=${jsHash}`);
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            ...securityHeaders("app"),
          },
        });
      }
      if (method === "GET" && path === "/styles.css") {
        const cache = url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-store";
        return new Response(readFileSync(cssPath, "utf8"), {
          headers: {
            "Content-Type": "text/css; charset=utf-8",
            "Cache-Control": cache,
            ...securityHeaders("app"),
          },
        });
      }
      if (method === "GET" && path === "/app.js") {
        if (process.env.PGROAST_WEB_DEV === "1") bundleJs = await buildUiJs();
        const cache = url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-store";
        return new Response(bundleJs, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": cache,
            ...securityHeaders("app"),
          },
        });
      }

      // ---- Health ----
      if (method === "GET" && path === "/api/v1/health") {
        const pgInfo = await db.getServerInfo();
        const pgMajor = pgInfo.version.match(/PostgreSQL\s+(\d+)/i)?.[0] || "PostgreSQL";
        const briefs = await db.listBriefs();
        const opinions = await db.listOpinions(undefined, 1000);
        const entries = await db.listEntries({ limit: 1000 });
        return json({
          ok: true,
          app: "pgroast-web",
          database: { version: pgMajor, database: pgInfo.database },
          counts: {
            briefs: briefs.length,
            entries: entries.length,
            opinions: opinions.length,
          },
          oauth: {
            githubConfigured: Boolean(cfg.githubClientId && cfg.githubClientSecret),
            googleConfigured: Boolean(cfg.googleClientId && cfg.googleClientSecret),
            devTokenMintEnabled: cfg.allowDevTokenMint,
          },
          localWorkbenchUrl: cfg.localWorkbenchUrl,
        }, 200, req);
      }

      // ---- Identity-only OAuth entrypoints (GitHub / Google) ----
      if (method === "GET" && path === "/auth/github") {
        if (!cfg.githubClientId) {
          return errJson("GITHUB_CLIENT_ID is not configured on this server. Use local dev token minting or set GitHub OAuth env vars.", 501);
        }
        const redirectUri = `${cfg.publicOrigin}/auth/github/callback`;
        const ghUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(cfg.githubClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
        return Response.redirect(ghUrl, 302);
      }

      if (method === "GET" && path === "/auth/google") {
        if (!cfg.googleClientId) {
          return errJson("GOOGLE_CLIENT_ID is not configured on this server. Use local dev token minting or set Google OAuth env vars.", 501);
        }
        const redirectUri = `${cfg.publicOrigin}/auth/google/callback`;
        const gUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(cfg.googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("openid profile email")}`;
        return Response.redirect(gUrl, 302);
      }

      // Local-dev token minting so Nik / Kirk can test local->public publishing immediately before setting OAuth apps
      if (method === "POST" && path === "/api/v1/tokens/dev") {
        if (!cfg.allowDevTokenMint) {
          return errJson("Dev token minting is disabled in production; sign in via GitHub or Google OAuth.", 403);
        }
        const body = await readJson<{ provider?: "github" | "google"; handle?: string; name?: string; avatarUrl?: string; label?: string }>(req);
        const handle = (body.handle || "").trim();
        if (!handle) return errJson("handle is required", 400);
        const provider = body.provider === "google" ? "google" : "github";
        const contributor = await db.upsertContributor({
          provider,
          handle,
          name: (body.name || handle).trim(),
          avatarUrl: body.avatarUrl || "",
        });
        const minted = await db.mintPublishToken(contributor.id, body.label || "local-workbench");
        return json({ contributor, token: minted.token, prefix: minted.prefix }, 201);
      }

      // ---- Briefs (Kirk's interactive & downloadable reports) ----
      if (method === "GET" && path === "/api/v1/briefs") {
        return json({ briefs: await db.listBriefs() });
      }

      const briefJsonMatch = path.match(/^\/api\/v1\/briefs\/([^/]+)$/);
      if (method === "GET" && briefJsonMatch) {
        const brief = await db.getBrief(briefJsonMatch[1]);
        if (!brief) return errJson("No brief published yet", 404);
        return json({
          id: brief.id,
          slug: brief.slug,
          title: brief.title,
          commitfest_label: brief.commitfest_label,
          published_by_handle: brief.published_by_handle,
          published_by_name: brief.published_by_name,
          created_at: brief.created_at,
          stats: JSON.parse(brief.stats_json || "{}"),
          shortlist: JSON.parse(brief.shortlist_json || "[]"),
          closing: JSON.parse(brief.closing_json || "[]"),
          entries: JSON.parse(brief.entries_json || "[]"),
        }, 200, req);
      }

      const briefEmbedMatch = path.match(/^\/briefs\/([^/]+)\/(embed|download\.html|download\.md|download\.json)$/);
      if (method === "GET" && briefEmbedMatch) {
        const slug = briefEmbedMatch[1]!;
        const kind = briefEmbedMatch[2]!;
        const brief = await db.getBrief(slug);
        if (!brief) return errJson("Brief not found", 404);

        if (kind === "download.md") {
          return new Response(renderBriefMarkdown(brief), {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="${brief.slug}.md"`,
              ...securityHeaders("json"),
            },
          });
        }
        if (kind === "download.json") {
          const payload = {
            slug: brief.slug,
            title: brief.title,
            commitfest_label: brief.commitfest_label,
            published_by_handle: brief.published_by_handle,
            created_at: brief.created_at,
            stats: JSON.parse(brief.stats_json || "{}"),
            shortlist: JSON.parse(brief.shortlist_json || "[]"),
            closing: JSON.parse(brief.closing_json || "[]"),
            entries: JSON.parse(brief.entries_json || "[]"),
          };
          return new Response(JSON.stringify(payload, null, 2), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Disposition": `attachment; filename="${brief.slug}.json"`,
              ...securityHeaders("json"),
            },
          });
        }
        const html = renderInteractiveBriefHtml(brief, cfg.localWorkbenchUrl);
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...(kind === "download.html" ? { "Content-Disposition": `attachment; filename="${brief.slug}.html"` } : {}),
            ...securityHeaders("sandbox_brief"),
          },
        });
      }

      // ---- Public Entries & Attributed Opinions ----
      if (method === "GET" && path === "/api/v1/entries") {
        const entries = await db.listEntries({
          search: url.searchParams.get("search") || undefined,
          verdict: url.searchParams.get("verdict") || undefined,
          limit: Number(url.searchParams.get("limit") || 300),
        });
        return json({ entries }, 200, req);
      }

      const entryDetailMatch = path.match(/^\/api\/v1\/entries\/(\d+)$/);
      if (method === "GET" && entryDetailMatch) {
        const cfId = Number(entryDetailMatch[1]);
        const [entry, opinions, coordination] = await Promise.all([
          db.getEntry(cfId),
          db.listOpinions(cfId, 100),
          db.listCoordination(cfId),
        ]);
        const consensus = computePatchConsensus(opinions, entry?.verdict);
        return json({ cf_id: cfId, entry, opinions, coordination, consensus }, 200, req);
      }

      const entryThreadMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/thread$/);
      if (method === "GET" && entryThreadMatch) {
        const cfId = Number(entryThreadMatch[1]);
        const entry = await db.getEntry(cfId);
        try {
          const discussion = await fetchMrDiscussionForCf(cfId, entry?.thread_url || undefined);
          return json(discussion, 200, req);
        } catch (err) {
          return errJson(err instanceof Error ? err.message : String(err), 404);
        }
      }

      const entryDiffMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/diff$/);
      if (method === "GET" && entryDiffMatch) {
        const cfId = Number(entryDiffMatch[1]);
        try {
          const diff = await fetchMrDiffForCf(cfId);
          return json(diff, 200, req);
        } catch (err) {
          return errJson(err instanceof Error ? err.message : String(err), 404);
        }
      }

      if (method === "GET" && path === "/api/v1/opinions") {
        const cfIdParam = url.searchParams.get("cfId");
        const opinions = await db.listOpinions(cfIdParam ? Number(cfIdParam) : undefined, 150);
        return json({ opinions }, 200, req);
      }

      const entryOpMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/opinions$/);
      if (method === "GET" && entryOpMatch) {
        const cfId = Number(entryOpMatch[1]);
        return json({ cf_id: cfId, opinions: await db.listOpinions(cfId, 50) });
      }

      // ---- Explicit Publish API (Local -> Public ONLY, Publish-Only Bearer Token + Confidentiality Gate) ----
      if (method === "POST" && path === "/api/v1/publish/opinion") {
        const auth = req.headers.get("authorization") || "";
        const contributor = await db.verifyPublishToken(auth);
        if (!contributor) return errJson("Valid publish-only Bearer token required.", 401);

        const body = await readJson<{
          cf_id?: number;
          entry?: Partial<PublicEntryRecord>;
          backend?: string;
          roast_level?: string;
          roast_flavour?: string;
          models?: Record<string, string> | string;
          verdict?: string;
          confidence?: string;
          summary?: string;
        }>(req);
        if (!body.cf_id || !body.verdict?.trim()) {
          return errJson("cf_id and verdict are required", 400);
        }
        const safety = checkPublicPayloadSafe(body);
        if (!safety.safe) {
          return errJson(`Public-Confidentiality HARD BLOCK: ${safety.reasons.join("; ")}`, 422);
        }
        const saved = await db.publishOpinion({
          cf_id: Number(body.cf_id),
          entry: body.entry,
          contributor,
          backend: (body.backend || "ai-harness").slice(0, 60),
          roast_level: body.roast_level || "medium",
          roast_flavour: body.roast_flavour || "default",
          models: body.models,
          verdict: body.verdict.trim(),
          confidence: body.confidence || "medium",
          summary: body.summary || "",
        });
        return json({ opinion: saved }, 201);
      }

      if (method === "POST" && path === "/api/v1/publish/brief") {
        const auth = req.headers.get("authorization") || "";
        const contributor = await db.verifyPublishToken(auth);
        if (!contributor) return errJson("Valid publish-only Bearer token required.", 401);

        const body = await readJson<{
          slug?: string;
          title?: string;
          commitfestLabel?: string;
          stats?: unknown;
          shortlist?: unknown[];
          closing?: unknown[];
          entries?: Array<Partial<PublicEntryRecord> & { cf_id: number }>;
        }>(req);
        if (!body.title?.trim()) return errJson("title is required", 400);

        const safety = checkPublicPayloadSafe(body);
        if (!safety.safe) {
          return errJson(`Public-Confidentiality HARD BLOCK: ${safety.reasons.join("; ")}`, 422);
        }
        const brief = await db.savePublishedBrief({
          slug: body.slug || `cf-${new Date().toISOString().slice(0, 10)}`,
          title: body.title.trim(),
          commitfestLabel: body.commitfestLabel || "CommitFest",
          contributor,
          stats: body.stats ?? {},
          shortlist: body.shortlist ?? [],
          closing: body.closing ?? [],
          entries: body.entries ?? [],
        });
        return json({
          brief: {
            id: brief.id,
            slug: brief.slug,
            title: brief.title,
            created_at: brief.created_at,
            htmlDownloadUrl: `${cfg.publicOrigin}/briefs/${brief.slug}/download.html`,
            markdownDownloadUrl: `${cfg.publicOrigin}/briefs/${brief.slug}/download.md`,
            jsonDownloadUrl: `${cfg.publicOrigin}/briefs/${brief.slug}/download.json`,
          },
        }, 201);
      }

      // ---- Shared Team Coordination (Anchored to CF # or bug ref) ----
      if (method === "GET" && path === "/api/v1/coordination") {
        return json({ items: await db.listCoordination() });
      }

      if (method === "POST" && path === "/api/v1/coordination") {
        const auth = req.headers.get("authorization") || "";
        const contributor = await db.verifyPublishToken(auth);
        if (!contributor) return errJson("Valid publish-only Bearer token required.", 401);
        const body = await readJson<{ cf_id?: number | null; bug_ref?: string; title?: string; status?: "open" | "in_progress" | "done"; note?: string }>(req);
        if (!body.title?.trim()) return errJson("title is required", 400);
        const safety = checkPublicPayloadSafe(body);
        if (!safety.safe) {
          return errJson(`Public-Confidentiality HARD BLOCK: ${safety.reasons.join("; ")}`, 422);
        }
        const item = await db.upsertCoordination({
          cf_id: body.cf_id ?? null,
          bug_ref: body.bug_ref || "",
          title: body.title.trim(),
          status: body.status || "in_progress",
          contributor,
          note: body.note || "",
        });
        return json({ item }, 201);
      }

      return errJson(`Not found: ${method} ${path}`, 404);
    } catch (err) {
      return errJson(err instanceof Error ? err.message : String(err), 500);
    }
  }

  return { fetch: fetchHandler, db, config: cfg };
}

export async function createWebServer(opts?: { db?: WebDatabase; config?: Partial<WebConfig> }) {
  const app = await createWebHandler(opts);
  const server = Bun.serve({
    hostname: app.config.host,
    port: app.config.port,
    fetch: app.fetch,
  });
  return { server, db: app.db, config: app.config, fetch: app.fetch };
}

if (import.meta.main) {
  const { server, config } = await createWebServer();
  console.log(`pgroast-web running at http://${config.host}:${server.port} (public companion)`);
}
