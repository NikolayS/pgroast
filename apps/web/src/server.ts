import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BRIEF_SCRIPT_SHA256, renderBriefMarkdown, renderInteractiveBriefHtml } from "./brief.ts";
import { loadWebConfig, WEB_ROOT, type WebConfig } from "./config.ts";
import { WebDatabase, type PublicEntryRecord } from "./db.ts";
import {
  getHackerProfileBySlug,
  getHackersOverview,
  getTopHackerSlugsForSitemap,
  resolvePeopleLinksForEntry,
  resolvePersonSlugByName,
  searchHackers,
} from "./hackers-queries.ts";
import { getMailingListsOverview, searchMailingListMessages } from "./lists-queries.ts";
import { fetchLiveCommitfestPatch, fetchMrDiffForCf, fetchMrDiscussionForCf, matchThreadToDiff } from "./mr.ts";
import { checkPublicPayloadSafe, safeHttpUrl, securityHeaders } from "./security.ts";
import { getStatsOverview } from "./stats-queries.ts";

const MAX_PG_INT4 = 2_147_483_647;

function parsePositivePgInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PG_INT4) return null;
  return n;
}

const ROOT_PKG_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(WEB_ROOT, "..", "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version || "0.3.0";
  } catch {
    return "0.3.0";
  }
})();

const BOT_UA_RE = /\b(?:bot|crawl|spider|slurp|mediapartners|facebookexternalhit|twitterbot|telegrambot|slackbot|whatsapp|curl|wget|python-requests|go-http-client|headless|uptime|pingdom|datadog)\b/i;

function extractReferrerHost(req: Request, selfOrigin: string): string {
  const ref = req.headers.get("referer") || "";
  if (!ref) return "";
  try {
    const refUrl = new URL(ref);
    const selfHost = new URL(selfOrigin).hostname;
    if (refUrl.hostname === selfHost || refUrl.hostname === "127.0.0.1" || refUrl.hostname === "localhost") {
      return "";
    }
    return refUrl.hostname;
  } catch {
    return "";
  }
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Payload too large (limit ${Math.round(maxBytes / 1024)} KB).`);
  }
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.get("cookie") || "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "local";
}

function verifyBearerSecret(req: Request, expectedSecret: string): boolean {
  if (!expectedSecret) return false;
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return false;
  const a = createHash("sha256").update(auth, "utf8").digest();
  const b = createHash("sha256").update(expectedSecret, "utf8").digest();
  return timingSafeEqual(a, b);
}

function createSlidingRateLimiter(limitPerMinute: number) {
  const buckets = new Map<string, number[]>();
  const windowMs = 60_000;
  return function check(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (buckets.get(key) || []).filter((ts) => ts > cutoff);
    if (arr.length >= limitPerMinute) {
      const oldest = arr[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      buckets.set(key, arr);
      return { ok: false, retryAfterSec };
    }
    arr.push(now);
    buckets.delete(key);
    buckets.set(key, arr);
    if (buckets.size > 2000) {
      for (const [k, v] of buckets) {
        if (v.length === 0 || (v[v.length - 1] ?? 0) < cutoff) buckets.delete(k);
      }
      while (buckets.size > 2000) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey === undefined) break;
        buckets.delete(oldestKey);
      }
    }
    return { ok: true };
  };
}

function renderOAuthResultHtml(opts: {
  ok: boolean;
  provider: string;
  handle?: string;
  name?: string;
  token?: string;
  error?: string;
  localWorkbenchUrl: string;
}): string {
  const title = opts.ok ? `Publish token issued — pgroast` : `Sign-in failed — pgroast`;
  const body = opts.ok
    ? `
      <div class="badge ok">${escAttr(opts.provider.toUpperCase())} verified</div>
      <h1>Publish token ready for @${escAttr(opts.handle || "")}</h1>
      <p class="muted">Signed in as <strong>${escAttr(opts.name || opts.handle || "")}</strong>. Copy this publish-only token once and paste it into your Personal Backoffice → <strong>Settings → Public Companion Hub</strong>.</p>
      <label class="lbl" for="tok">Publish-only token (shown once)</label>
      <textarea id="tok" class="tok" readonly rows="2">${escAttr(opts.token || "")}</textarea>
      <div class="actions">
        <a class="btn primary" href="${escAttr(opts.localWorkbenchUrl)}/" target="_blank" rel="noopener">Open Personal Backoffice ↗</a>
        <a class="btn" href="/">Back to Public App</a>
      </div>
      <p class="hint">This token can only publish sanitized roasts, briefs, and coordination claims. It cannot read private data or control your local machine.</p>
    `
    : `
      <div class="badge err">${escAttr(opts.provider.toUpperCase())} sign-in error</div>
      <h1>Could not complete sign-in</h1>
      <p class="muted">${escAttr(opts.error || "Unknown OAuth error.")}</p>
      <div class="actions">
        <a class="btn primary" href="/?tab=connect">Try again</a>
        <a class="btn" href="/">Back to Public App</a>
      </div>
    `;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    body{margin:0;background:#0b0c0e;color:#e7e9ee;font-family:-apple-system,BlinkMacSystemFont,Inter,Segoe UI,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{max-width:520px;width:100%;background:#13151b;border:1px solid #262a35;border-radius:14px;padding:24px;box-shadow:0 16px 40px rgba(0,0,0,.45);}
    .badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.04em;padding:3px 9px;border-radius:999px;margin-bottom:10px;}
    .badge.ok{background:rgba(46,184,114,.16);color:#4ee093;border:1px solid rgba(46,184,114,.35);}
    .badge.err{background:rgba(235,87,87,.16);color:#ff8686;border:1px solid rgba(235,87,87,.35);}
    h1{font-size:19px;margin:0 0 8px;line-height:1.3;}
    .muted{color:#9ca3b5;font-size:13.5px;line-height:1.5;margin:0 0 16px;}
    .lbl{display:block;font-size:12px;color:#9ca3b5;margin-bottom:6px;font-weight:600;}
    .tok{width:100%;box-sizing:border-box;background:#0b0c0e;color:#f3f4f8;border:1px solid #2f3544;border-radius:9px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;resize:none;}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;}
    .btn{display:inline-flex;align-items:center;justify-content:center;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid #2d3240;background:#1a1d26;color:#e7e9ee;}
    .btn.primary{background:#5e6ad2;border-color:#5e6ad2;color:#fff;}
    .hint{color:#788096;font-size:12px;line-height:1.45;margin:16px 0 0;}
  </style>
</head>
<body><main class="card">${body}</main></body>
</html>`;
}

function escXml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function resolveRequestOrigin(req: Request, cfg: WebConfig): string {
  const rawHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0]!.trim().toLowerCase();
  if (!rawHost || /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(rawHost)) {
    return cfg.publicOrigin;
  }
  if (!cfg.allowedHosts.includes(rawHost)) {
    return cfg.publicOrigin;
  }
  return `https://${rawHost}`;
}

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
  return v || "Not roasted";
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
        ? `Baseline brief pass: ${humanVerdictLabel(baselineVerdict)}. Waiting for additional reviewer roasts to build consensus.`
        : "No reviewer roasts published yet for this patch.",
    };
  }
  const [topVerdict, topCount] = ranked[0]!;
  if (total === 1) {
    return {
      status: "single_opinion" as const,
      leadingVerdict: topVerdict,
      totalOpinions: 1,
      uniqueReviewers: reviewers.size,
      uniqueModels: models.size,
      breakdown: counts,
      headline: `1 roast (${reviewers.size} reviewer): ${humanVerdictLabel(topVerdict)}. Add another run to compare perspectives.`,
    };
  }
  const pct = Math.round((topCount / total) * 100);
  if (ranked.length === 1) {
    return {
      status: "unanimous" as const,
      leadingVerdict: topVerdict,
      totalOpinions: total,
      uniqueReviewers: reviewers.size,
      uniqueModels: models.size,
      breakdown: counts,
      headline: `Unanimous across ${total} roasts (${reviewers.size} reviewer${reviewers.size === 1 ? "" : "s"}): ${humanVerdictLabel(topVerdict)}.`,
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
      headline: `Majority (${topCount}/${total}) lean ${humanVerdictLabel(topVerdict)}, with ${total - topCount} differing roast${total - topCount === 1 ? "" : "s"}.`,
    };
  }
  return {
    status: "split" as const,
    leadingVerdict: topVerdict,
    totalOpinions: total,
    uniqueReviewers: reviewers.size,
    uniqueModels: models.size,
    breakdown: counts,
    headline: `Split roasts across ${total} runs (${reviewers.size} reviewer${reviewers.size === 1 ? "" : "s"}): compare arguments below to find common ground.`,
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

async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 256 * 1024): Promise<T> {
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > maxBytes) throw new PayloadTooLargeError(maxBytes);
  let raw: string;
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new PayloadTooLargeError(maxBytes);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    raw = Buffer.concat(chunks).toString("utf8");
  } else {
    raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new PayloadTooLargeError(maxBytes);
  }
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
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

export async function createWebHandler(opts?: {
  db?: WebDatabase;
  config?: Partial<WebConfig>;
  oauthFetch?: typeof fetch;
}) {
  const cfg: WebConfig = { ...loadWebConfig(), ...(opts?.config || {}) };
  const db = opts?.db ?? (await WebDatabase.create({ databaseUrl: cfg.databaseUrl }));
  const oauthFetch = opts?.oauthFetch ?? fetch;
  const rateLimit = createSlidingRateLimiter(cfg.rateLimitPerMinute);
  const mrRateLimit = createSlidingRateLimiter(Math.max(15, Math.min(cfg.rateLimitPerMinute, 30)));
  const cliRegRateLimit = createSlidingRateLimiter(6);
  const oauthStates = new Map<
    string,
    { provider: "github" | "google"; expiresAt: number; cliPort?: number; cliState?: string }
  >();
  let bundleJs = await buildUiJs();

  const htmlPath = join(WEB_ROOT, "src", "ui", "index.html");
  const cssPath = join(WEB_ROOT, "src", "ui", "styles.css");
  const appTsPath = join(WEB_ROOT, "src", "ui", "app.ts");
  const hackersViewPath = join(WEB_ROOT, "src", "ui", "hackers-view.ts");
  const docsViewPath = join(WEB_ROOT, "src", "ui", "docs-view.ts");
  const apiDocsViewPath = join(WEB_ROOT, "src", "ui", "api-docs-view.ts");
  const contributeViewPath = join(WEB_ROOT, "src", "ui", "contribute-view.ts");
  const listsViewPath = join(WEB_ROOT, "src", "ui", "lists-view.ts");
  const statsViewPath = join(WEB_ROOT, "src", "ui", "stats-view.ts");
  const aboutViewPath = join(WEB_ROOT, "src", "ui", "about-view.ts");
  const backofficePromptPath = join(WEB_ROOT, "src", "ui", "backoffice-prompt.ts");
  const skeletonsPath = join(WEB_ROOT, "src", "ui", "skeletons.ts");
  const vizChartsPath = join(WEB_ROOT, "src", "ui", "viz-charts.ts");
  const vizEnginePath = join(WEB_ROOT, "src", "ui", "viz-engine.ts");
  const faviconPath = join(WEB_ROOT, "src", "ui", "favicon.svg");
  const touchIconPath = join(WEB_ROOT, "src", "ui", "apple-touch-icon.png");
  const icon192Path = join(WEB_ROOT, "src", "ui", "icon-192.png");
  const icon512Path = join(WEB_ROOT, "src", "ui", "icon-512.png");
  const swPath = join(WEB_ROOT, "src", "ui", "sw.js");
  const manifestPath = join(WEB_ROOT, "src", "ui", "manifest.webmanifest");

  let appMtime =
    (existsSync(appTsPath) ? statSync(appTsPath).mtimeMs : 0) +
    (existsSync(hackersViewPath) ? statSync(hackersViewPath).mtimeMs : 0) +
    (existsSync(docsViewPath) ? statSync(docsViewPath).mtimeMs : 0) +
    (existsSync(apiDocsViewPath) ? statSync(apiDocsViewPath).mtimeMs : 0) +
    (existsSync(contributeViewPath) ? statSync(contributeViewPath).mtimeMs : 0) +
    (existsSync(listsViewPath) ? statSync(listsViewPath).mtimeMs : 0) +
    (existsSync(statsViewPath) ? statSync(statsViewPath).mtimeMs : 0) +
    (existsSync(aboutViewPath) ? statSync(aboutViewPath).mtimeMs : 0) +
    (existsSync(backofficePromptPath) ? statSync(backofficePromptPath).mtimeMs : 0) +
    (existsSync(skeletonsPath) ? statSync(skeletonsPath).mtimeMs : 0) +
    (existsSync(vizChartsPath) ? statSync(vizChartsPath).mtimeMs : 0) +
    (existsSync(vizEnginePath) ? statSync(vizEnginePath).mtimeMs : 0);
  let cssMtime = existsSync(cssPath) ? statSync(cssPath).mtimeMs : 0;
  let favMtime = existsSync(faviconPath) ? statSync(faviconPath).mtimeMs : 0;
  let cssHash = createHash("sha256").update(readFileSync(cssPath, "utf8")).digest("hex").slice(0, 8);
  let jsHash = createHash("sha256").update(bundleJs).digest("hex").slice(0, 8);
  let favHash = createHash("sha256").update(readFileSync(faviconPath, "utf8")).digest("hex").slice(0, 8);
  let touchHash = existsSync(touchIconPath)
    ? createHash("sha256").update(readFileSync(touchIconPath)).digest("hex").slice(0, 8)
    : favHash;

  // Seamless zero-downtime UI asset reload whenever UI files change on disk
  async function refreshUiAssetsIfChanged(): Promise<void> {
    try {
      const curAppMtime =
        (existsSync(appTsPath) ? statSync(appTsPath).mtimeMs : 0) +
        (existsSync(hackersViewPath) ? statSync(hackersViewPath).mtimeMs : 0) +
        (existsSync(docsViewPath) ? statSync(docsViewPath).mtimeMs : 0) +
        (existsSync(apiDocsViewPath) ? statSync(apiDocsViewPath).mtimeMs : 0) +
        (existsSync(contributeViewPath) ? statSync(contributeViewPath).mtimeMs : 0) +
        (existsSync(listsViewPath) ? statSync(listsViewPath).mtimeMs : 0) +
        (existsSync(statsViewPath) ? statSync(statsViewPath).mtimeMs : 0) +
        (existsSync(aboutViewPath) ? statSync(aboutViewPath).mtimeMs : 0) +
        (existsSync(backofficePromptPath) ? statSync(backofficePromptPath).mtimeMs : 0) +
        (existsSync(skeletonsPath) ? statSync(skeletonsPath).mtimeMs : 0) +
        (existsSync(vizChartsPath) ? statSync(vizChartsPath).mtimeMs : 0) +
        (existsSync(vizEnginePath) ? statSync(vizEnginePath).mtimeMs : 0);
      if (curAppMtime !== appMtime) {
        bundleJs = await buildUiJs();
        jsHash = createHash("sha256").update(bundleJs).digest("hex").slice(0, 8);
        appMtime = curAppMtime;
      }
      const curCssMtime = existsSync(cssPath) ? statSync(cssPath).mtimeMs : 0;
      if (curCssMtime !== cssMtime) {
        cssHash = createHash("sha256").update(readFileSync(cssPath, "utf8")).digest("hex").slice(0, 8);
        cssMtime = curCssMtime;
      }
      const curFavMtime = existsSync(faviconPath) ? statSync(faviconPath).mtimeMs : 0;
      if (curFavMtime !== favMtime) {
        favHash = createHash("sha256").update(readFileSync(faviconPath, "utf8")).digest("hex").slice(0, 8);
        favMtime = curFavMtime;
      }
    } catch {
      // keep previous valid bundle on transient mid-save read
    }
  }

  function parseCliCallbackParams(u: URL): { cliPort?: number; cliState?: string } {
    const portRaw = u.searchParams.get("cli_port") || u.searchParams.get("port") || "";
    const stateRaw = (u.searchParams.get("cli_state") || u.searchParams.get("state") || "").trim();
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return {};
    if (!/^[a-f0-9]{16,128}$/i.test(stateRaw)) return {};
    return { cliPort: port, cliState: stateRaw };
  }

  function issueOAuthState(
    provider: "github" | "google",
    cli?: { cliPort?: number; cliState?: string },
  ): { state: string; cookie: string } {
    const now = Date.now();
    for (const [k, v] of oauthStates) {
      if (v.expiresAt < now) oauthStates.delete(k);
    }
    while (oauthStates.size >= 500) {
      const oldest = oauthStates.keys().next().value;
      if (oldest === undefined) break;
      oauthStates.delete(oldest);
    }
    const state = randomBytes(16).toString("hex");
    oauthStates.set(state, {
      provider,
      expiresAt: now + 10 * 60_000,
      ...(cli?.cliPort && cli?.cliState ? { cliPort: cli.cliPort, cliState: cli.cliState } : {}),
    });
    const secure = cfg.publicOrigin.startsWith("https://") ? "; Secure" : "";
    return {
      state,
      cookie: `pgroast_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${secure}`,
    };
  }

  function consumeOAuthState(
    req: Request,
    provider: "github" | "google",
    stateParam: string,
  ): { ok: true; cliPort?: number; cliState?: string } | { ok: false } {
    if (!stateParam) return { ok: false };
    const cookies = parseCookies(req);
    const cookieState = cookies["pgroast_oauth_state"] || "";
    const entry = oauthStates.get(stateParam);
    oauthStates.delete(stateParam);
    if (!entry || entry.provider !== provider || entry.expiresAt < Date.now()) return { ok: false };
    if (!cookieState || cookieState !== stateParam) return { ok: false };
    return { ok: true, cliPort: entry.cliPort, cliState: entry.cliState };
  }

  function oauthCliRedirect(cliPort: number, cliState: string, token: string, handle: string): Response {
    const secure = cfg.publicOrigin.startsWith("https://") ? "; Secure" : "";
    const qs = new URLSearchParams({ token, state: cliState, handle });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `http://127.0.0.1:${cliPort}/callback?${qs.toString()}`,
        "Cache-Control": "no-store",
        "Set-Cookie": `pgroast_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0${secure}`,
      },
    });
  }

  function oauthHtmlResponse(html: string, status = 200): Response {
    const secure = cfg.publicOrigin.startsWith("https://") ? "; Secure" : "";
    return new Response(html, {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": `pgroast_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0${secure}`,
        ...securityHeaders("app"),
      },
    });
  }

  function enforceRateLimit(key: string, limiter: typeof rateLimit = rateLimit): Response | null {
    const rl = limiter(key);
    if (rl.ok) return null;
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(rl.retryAfterSec),
        ...securityHeaders("json"),
      },
    });
  }

  async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // ---- Static UI ----
      if (method === "GET" && (path === "/favicon.svg" || path === "/favicon.ico")) {
        const cache = url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache";
        return new Response(readFileSync(faviconPath, "utf8"), {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": cache,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && path === "/apple-touch-icon.png" && existsSync(touchIconPath)) {
        const cache = url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache";
        return new Response(readFileSync(touchIconPath), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": cache,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && (path === "/icon-192.png" || path === "/icon-512.png")) {
        const filePath = path === "/icon-192.png" ? icon192Path : icon512Path;
        if (existsSync(filePath)) {
          return new Response(readFileSync(filePath), {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=86400",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
      }
      if (method === "GET" && path === "/sw.js" && existsSync(swPath)) {
        return new Response(readFileSync(swPath, "utf8"), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
            "Service-Worker-Allowed": "/",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && path === "/manifest.webmanifest" && existsSync(manifestPath)) {
        return new Response(readFileSync(manifestPath, "utf8"), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && path === "/openapi.json") {
        const origin = resolveRequestOrigin(req, cfg);
        const spec = {
          openapi: "3.1.0",
          info: {
            title: "pgroast Public Companion API",
            version: ROOT_PKG_VERSION,
            description: "Read-only CommitFest intelligence, multi-model roasts, Postgres Hacking Observatory, Mailing Lists Archive, and Weekly Quota Auto-Contribute queue.",
          },
          servers: [{ url: origin }],
          paths: {
            "/api/v1/health": { get: { summary: "Service health, version, and DB counts" } },
            "/api/v1/entries": { get: { summary: "List indexed CommitFest entries", parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }] } },
            "/api/v1/entries/{cf_id}": { get: { summary: "Get patch consensus, roasts, and claims", parameters: [{ name: "cf_id", in: "path", required: true, schema: { type: "integer" } }] } },
            "/api/v1/opinions": { get: { summary: "List recent attributed community roasts" } },
            "/api/v1/stats/overview": { get: { summary: "Live CommitFest intelligence, build/SQL verification pipeline, subsystem readiness, and unified author telemetry" } },
            "/api/v1/hackers/overview": { get: { summary: "PostgreSQL Hacking Observatory overview & charts", parameters: [{ name: "window", in: "query", schema: { type: "string" } }] } },
            "/api/v1/hackers": { get: { summary: "Search unified PostgreSQL contributors", parameters: [{ name: "search", in: "query", schema: { type: "string" } }] } },
            "/api/v1/hackers/{slug}": { get: { summary: "Unified multi-email contributor profile", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }] } },
            "/api/v1/lists/overview": { get: { summary: "49 PostgreSQL mailing lists overview & sparklines" } },
            "/api/v1/lists/messages": { get: { summary: "Search archived PostgreSQL mailing list messages", parameters: [{ name: "list", in: "query", schema: { type: "string" } }, { name: "search", in: "query", schema: { type: "string" } }] } },
            "/api/v1/contribute/status": { get: { summary: "Live CommitFest roast coverage & active soft leases" } },
            "/api/v1/contribute/next": { get: { summary: "Claim or dry-run preview next uncovered CommitFest patch", parameters: [{ name: "backend", in: "query", schema: { type: "string" } }, { name: "strategy", in: "query", schema: { type: "string" } }, { name: "dry_run", in: "query", schema: { type: "integer" } }] } },
          },
        };
        return new Response(JSON.stringify(spec, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", ...securityHeaders("json") },
        });
      }

      if (method === "GET" && path === "/robots.txt") {
        const origin = resolveRequestOrigin(req, cfg);
        const body = [
          "# pgroast — PostgreSQL CommitFest collaboration & adversarial pre-review",
          `# LLM / AI crawler guide: ${origin}/llms.txt`,
          `# Full LLM digest: ${origin}/llms-full.txt`,
          "",
          "User-agent: *",
          "Allow: /",
          "Disallow: /auth/",
          "Disallow: /api/v1/tokens/",
          "Disallow: /api/v1/admin/",
          "Disallow: /api/v1/publish/",
          "",
          `Sitemap: ${origin}/sitemap.xml`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            Vary: "Host",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && path === "/sitemap.xml") {
        const origin = resolveRequestOrigin(req, cfg);
        const [entries, briefs, topHackers] = await Promise.all([
          db.listEntries({ limit: 1000 }),
          db.listBriefs(),
          getTopHackerSlugsForSitemap(db, 150).catch(() => []),
        ]);
        const latestDate = (briefs[0]?.created_at || new Date().toISOString()).slice(0, 10);
        const staticUrls: Array<{ loc: string; lastmod: string; changefreq: string; priority: string }> = [
          { loc: `${origin}/`, lastmod: latestDate, changefreq: "daily", priority: "1.0" },
          { loc: `${origin}/?tab=hackers`, lastmod: latestDate, changefreq: "daily", priority: "0.9" },
          { loc: `${origin}/lists`, lastmod: latestDate, changefreq: "hourly", priority: "0.9" },
          { loc: `${origin}/?tab=stats`, lastmod: latestDate, changefreq: "daily", priority: "0.8" },
          { loc: `${origin}/?tab=entries`, lastmod: latestDate, changefreq: "daily", priority: "0.8" },
          { loc: `${origin}/roasts`, lastmod: latestDate, changefreq: "hourly", priority: "0.8" },
          { loc: `${origin}/?tab=coordination`, lastmod: latestDate, changefreq: "daily", priority: "0.6" },
          { loc: `${origin}/?tab=connect`, lastmod: latestDate, changefreq: "weekly", priority: "0.6" },
          { loc: `${origin}/contribute`, lastmod: latestDate, changefreq: "daily", priority: "0.9" },
          { loc: `${origin}/docs`, lastmod: latestDate, changefreq: "weekly", priority: "0.8" },
          { loc: `${origin}/about`, lastmod: latestDate, changefreq: "weekly", priority: "0.8" },
          { loc: `${origin}/llms.txt`, lastmod: latestDate, changefreq: "daily", priority: "0.6" },
        ];
        const entryUrls = entries.map((e) => ({
          loc: `${origin}/patch/${e.cf_id}`,
          lastmod: (e.updated_at || latestDate).slice(0, 10),
          changefreq: "weekly",
          priority: e.verdict && e.verdict !== "UNROASTED" ? "0.7" : "0.5",
        }));
        const hackerUrls = topHackers.map((h) => ({
          loc: `${origin}/hacker/${encodeURIComponent(h.slug)}`,
          lastmod: (h.last_seen_at || latestDate).slice(0, 10),
          changefreq: "weekly",
          priority: "0.6",
        }));
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          [...staticUrls, ...entryUrls, ...hackerUrls]
            .map(
              (u) =>
                `  <url><loc>${escXml(u.loc)}</loc><lastmod>${escXml(u.lastmod)}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
            )
            .join("\n") +
          `\n</urlset>\n`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=1800",
            Vary: "Host",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET" && (path === "/llms.txt" || path === "/llms-full.txt")) {
        const isFull = path === "/llms-full.txt";
        const origin = resolveRequestOrigin(req, cfg);
        const [briefs, latestBrief, entries, opinions] = await Promise.all([
          db.listBriefs(),
          db.getBrief("latest"),
          db.listEntries({ limit: 1000 }),
          db.listOpinions(undefined, 100),
        ]);
        const shortlist = latestBrief
          ? (JSON.parse(latestBrief.shortlist_json || "[]") as Array<{ cf_id: number; title: string; verdict?: string; status?: string; authors?: string }>)
          : [];
        const closing = latestBrief
          ? (JSON.parse(latestBrief.closing_json || "[]") as Array<{ cf_id: number; title: string; verdict?: string; status?: string }>)
          : [];
        const lines: string[] = [
          "# pgroast",
          "",
          "> Open-source Postgres CommitFest collaboration hub where human reviewers and AI assistants run adversarial design pre-reviews (\"roasts\") of Postgres patches, compare multi-model roasts, and hand off verified reviews to pgsql-hackers.",
          "",
          "## How pgroast works",
          "",
          "- **Humans + AIs together:** Reviewers run a private local Backoffice (`apps/local`) with their own AI CLIs (Claude, Codex, Gemini/agy, or cross-family dual mode) to pre-review CommitFest entries or their own draft patches (`pgroast --self`), then explicitly publish sanitized roasts to this public hub.",
          "- **Roast levels (Verification Depth):** `light` (idea, thread, and 2,547 historical precedents only; no code read, no compile), `medium` (reads C/H/SQL diffs + surrounding postgres.git context, runs `git apply`, incremental `meson compile -Dcassert=true`, and targeted `meson test`), `dark` (everything in `medium` plus boots a throwaway patched Postgres cluster over Unix socket, runs adversarial pure-SQL stress tests and `EXPLAIN (ANALYZE, BUFFERS)` checks via `psql`, inspects `postgres.log` for crashes/TRAP/PANIC, and runs a reflection pass).",
          "- **Reviewer archetypes:** `default` (House Blend), `edge-case-hunter` (The Edge-Case Hunter), `spec-lawyer` (The Spec Lawyer), `systems-architect` (The Systems Architect), `perf-hawk` (The Perf Hawk), `storage-skeptic` (The Storage Skeptic), `index-specialist` (The Index Specialist), `production-dba` (The Production DBA). Fictional engineering focus personas — never human committers (AI makes mistakes all the time). Every report and roast records its roast level and archetype.",
          "- **Human ownership:** AI roasts are never final committer verdicts and nothing is auto-posted. A human reviewer takes ownership of a patch, verifies the code and thread, and sends their own review to `pgsql-hackers`.",
          "",
          "## Live CommitFest Snapshot",
          "",
          `- Public hub: ${origin}/`,
          `- Source code (Apache-2.0): https://github.com/NikolayS/pgroast`,
          `- Indexed CommitFest entries: ${entries.length}`,
          `- Published roasts: ${opinions.length}`,
          `- Published CommitFest briefs: ${briefs.length}${latestBrief ? ` (latest: ${latestBrief.title}, ${latestBrief.commitfest_label})` : ""}`,
          "",
          "## Key Pages",
          "",
          `- [CommitFest Brief & Shortlist](${origin}/): Triage summary, verdict breakdown, shortlist, and closing/rethinking candidates.`,
          `- [Postgres Hacking Observatory](${origin}/?tab=hackers): Interactive infographics, velocity charts, 7x24 UTC heatmap, bus factor, multi-email unified leaderboards, and personal contributor profiles (\`/hacker/<slug>\`).`,
          `- [CommitFest Stats & Leaderboards](${origin}/?tab=stats): Verdict heatmap, subsystem health, and clickable top authors, reviewers, and committers.`,
          `- [All CommitFest Entries](${origin}/?tab=entries): Searchable directory of ${entries.length} patches with status and verdict filters.`,
          `- [Community Roasts](${origin}/roasts): Attributed multi-model, multi-flavour roasts.`,
          `- [Personal Backoffice Setup](${origin}/?tab=connect): How to run your own local workbench and publish roasts.`,
          `- [About pgroast — What Roasting Means](${origin}/about): Why we roast Postgres patches, why idea and design scrutiny is the foundation of all roast levels (Light, Medium, Dark), and how the 7-angle + Critic pipeline works.`,
          `- [Docs, All Features & Weekly Quota Auto-Contribute](${origin}/docs): Complete feature directory, CLI reference, live CommitFest coverage progress, and weekly OAuth quota donation setup.`,
          `- [XML Sitemap](${origin}/sitemap.xml): Complete index of all patch collaboration pages.`,
          `- [Full LLM Digest](${origin}/llms-full.txt): Expanded Markdown with live roasts and full shortlist.`,
          "",
        ];
        if (opinions.length > 0) {
          lines.push("## Recent Community Roasts", "");
          for (const op of opinions.slice(0, isFull ? 100 : 15)) {
            const entry = entries.find((e) => e.cf_id === op.cf_id);
            const title = entry ? entry.title : `CF ${op.cf_id}`;
            lines.push(
              `- [CF ${op.cf_id}: ${title}](${origin}/patch/${op.cf_id}) — **${op.verdict}** by @${op.contributor_handle} (${op.backend}, level: ${op.roast_level || "medium"}, flavour: ${op.roast_flavour || "default"})`,
            );
            if (isFull && op.summary) {
              lines.push(`  > ${op.summary.replace(/\s+/g, " ").trim()}`);
            }
          }
          lines.push("");
        }
        if (shortlist.length > 0) {
          lines.push("## Top Shortlisted Patches", "");
          for (const s of shortlist.slice(0, isFull ? 40 : 20)) {
            lines.push(
              `- [CF ${s.cf_id}: ${s.title}](${origin}/patch/${s.cf_id}) — ${s.verdict || "UNROASTED"} (${s.status || "Open"}${s.authors ? `, by ${s.authors}` : ""})`,
            );
          }
          lines.push("");
        }
        if (isFull && closing.length > 0) {
          lines.push("## Worth Closing or Rethinking", "");
          for (const c of closing.slice(0, 50)) {
            lines.push(`- [CF ${c.cf_id}: ${c.title}](${origin}/patch/${c.cf_id}) — ${c.verdict || "UNROASTED"} (${c.status || "Open"})`);
          }
          lines.push("");
        }
        lines.push(
          "## Public Read-Only API & Downloads",
          "",
          `- Health & counts: \`GET ${origin}/api/v1/health\``,
          `- Entries list: \`GET ${origin}/api/v1/entries?limit=300\``,
          `- Patch consensus & roasts: \`GET ${origin}/api/v1/entries/<cf_id>\``,
          `- Parsed pgsql-hackers thread: \`GET ${origin}/api/v1/entries/<cf_id>/thread\``,
          `- Live CFBot unified diff: \`GET ${origin}/api/v1/entries/<cf_id>/diff\``,
          `- Hacking Observatory overview: \`GET ${origin}/api/v1/hackers/overview?window=1y\``,
          `- Contributor directory: \`GET ${origin}/api/v1/hackers?search=<q>&role=<role>&sort=activity\``,
          `- Individual contributor profile: \`GET ${origin}/api/v1/hackers/<slug>\` (web page: \`${origin}/hacker/<slug>\`)`,
          `- Community quota coverage status: \`GET ${origin}/api/v1/contribute/status\``,
          `- Next soft-leased CommitFest patch: \`GET ${origin}/api/v1/contribute/next?backend=claude&dry_run=1\``,
          `- Latest brief (Markdown): \`GET ${origin}/briefs/latest/download.md\``,
          `- Latest brief (JSON): \`GET ${origin}/briefs/latest/download.json\``,
          "",
        );
        return new Response(lines.join("\n"), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=900",
            Vary: "Host",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const patchPageMatch = path.match(/^\/patch\/(\d+)\/?$/);
      const hackerPageMatch = path.match(/^\/hacker\/([a-z0-9-]+)\/?$/i);
      const isDocsPage = path === "/docs" || path === "/docs/";
      const isContributePage = path === "/contribute" || path === "/contribute/";
      const isListsPage = path === "/lists" || path === "/lists/";
      const isAboutPage = path === "/about" || path === "/about/";
      const isRoastsPage = path === "/roasts" || path === "/roasts/";
      if (method === "GET" && (path === "/" || path === "/index.html" || patchPageMatch || hackerPageMatch || isDocsPage || isContributePage || isListsPage || isAboutPage || isRoastsPage)) {
        await refreshUiAssetsIfChanged();
        const origin = resolveRequestOrigin(req, cfg);
        const cfId = parsePositivePgInt(patchPageMatch?.[1] || url.searchParams.get("cf")) ?? 0;
        const hackerSlug = hackerPageMatch?.[1]?.toLowerCase() || "";
        let title = "pgroast — PostgreSQL CommitFest Collaboration & Hacking Observatory";
        let desc = "Explore PostgreSQL hacking activity, contributor profiles, CommitFest patches, -hackers discussions, live diffs, and multi-model AI pre-reviews.";
        let canonical = `${origin}/`;
        let jsonLd: Record<string, unknown> = {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "pgroast",
          url: `${origin}/`,
          description: desc,
        };
        if (isDocsPage) {
          canonical = `${origin}/docs`;
          title = "Docs & Complete Feature Catalog — pgroast";
          desc = "Complete directory of every pgroast feature, architecture overview, CLI command reference, and public APIs.";
        } else if (isContributePage) {
          canonical = `${origin}/contribute`;
          title = "Weekly Quota Auto-Contribute & Live CommitFest Coverage — pgroast";
          desc = "Donate unused weekly OAuth quota (Claude, Codex, Antigravity) to pre-review open PostgreSQL CommitFest patches, preview the live queue, and track community coverage.";
        } else if (isListsPage) {
          canonical = `${origin}/lists`;
          title = "PostgreSQL Mailing Lists Archive (Continuous Sync) — pgroast";
          desc = "Continuously synced archive across 51 PostgreSQL public mailing lists with full-text search, active threads, and unified /hacker/<slug> contributor profiles.";
        } else if (isAboutPage) {
          canonical = `${origin}/about`;
          title = "About pgroast — What Roasting Postgres Patches Means";
          desc = "How pgroast uses AI to review and scrutinize Postgres CommitFest patches — starting with the idea itself across Light, Medium, and Dark roast levels.";
        } else if (isRoastsPage) {
          canonical = `${origin}/roasts`;
          title = "Community Roasts — pgroast";
          desc = "Browse attributed multi-model Postgres patch roasts across Light, Medium, and Dark verification depths.";
        } else if (hackerSlug) {
          canonical = `${origin}/hacker/${encodeURIComponent(hackerSlug)}`;
          const profile = await getHackerProfileBySlug(db, hackerSlug).catch(() => null);
          if (profile) {
            const p = profile.person;
            title = `${p.name} (${p.role}) — PostgreSQL Hacking Profile · pgroast`;
            desc = `${p.commitsAuthored} commits authored · ${p.reviewsGiven} reviews credited · ${p.bugsReported} bugs reported · ${p.commitsCommitted} commits landed`;
            jsonLd = {
              "@context": "https://schema.org",
              "@type": "Person",
              name: p.name,
              jobTitle: `PostgreSQL ${p.role}`,
              url: canonical,
              description: desc,
            };
          } else {
            title = `${hackerSlug} — PostgreSQL Hacker Profile · pgroast`;
          }
        } else if (cfId > 0) {
          canonical = `${origin}/patch/${cfId}`;
          let entry = await db.getEntry(cfId);
          if (!entry) {
            const live = await fetchLiveCommitfestPatch(cfId);
            if (live) {
              await db.upsertPublicEntry(live);
              entry = await db.getEntry(cfId);
            }
          }
          if (entry) {
            title = `CF ${entry.cf_id}: ${entry.title} — pgroast`;
            const parts = [
              entry.verdict ? humanVerdictLabel(entry.verdict) : "Not roasted",
              entry.status || "",
              entry.authors ? `by ${entry.authors}` : "",
            ].filter(Boolean);
            desc = parts.join(" · ");
            jsonLd = {
              "@context": "https://schema.org",
              "@type": "DiscussionForumPosting",
              headline: `CF ${entry.cf_id}: ${entry.title}`,
              url: canonical,
              description: desc,
              author: entry.authors ? { "@type": "Person", name: entry.authors } : undefined,
              dateModified: entry.updated_at || undefined,
              isPartOf: { "@type": "WebSite", name: "pgroast", url: `${origin}/` },
            };
          } else {
            title = `CF ${cfId} — pgroast`;
          }
        }
        const safeLd = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
        const ogTags = [
          `<link rel="canonical" href="${escAttr(canonical)}" />`,
          `<link rel="alternate" type="text/markdown" title="pgroast LLMs Guide" href="${escAttr(origin)}/llms.txt" />`,
          `<meta name="description" content="${escAttr(desc)}" />`,
          `<meta property="og:type" content="${cfId > 0 ? "article" : "website"}" />`,
          `<meta property="og:site_name" content="pgroast" />`,
          `<meta property="og:url" content="${escAttr(canonical)}" />`,
          `<meta property="og:title" content="${escAttr(title)}" />`,
          `<meta property="og:description" content="${escAttr(desc)}" />`,
          `<meta name="twitter:card" content="summary" />`,
          `<meta name="twitter:title" content="${escAttr(title)}" />`,
          `<meta name="twitter:description" content="${escAttr(desc)}" />`,
          `<script type="application/ld+json">${safeLd}</script>`,
        ].join("\n  ");
        const html = readFileSync(htmlPath, "utf8")
          .replace(/<title>[^<]*<\/title>/, () => `<title>${escAttr(title)}</title>\n  ${ogTags}`)
          .replace("/favicon.svg", () => `/favicon.svg?v=${favHash}`)
          .replace("/apple-touch-icon.png", () => `/apple-touch-icon.png?v=${touchHash}`)
          .replace("/styles.css", () => `/styles.css?v=${cssHash}`)
          .replace("/app.js", () => `/app.js?v=${jsHash}`);
        const ua = req.headers.get("user-agent") || "";
        if (!BOT_UA_RE.test(ua)) {
          void db.recordPageView({
            path: hackerSlug ? `/hacker/${hackerSlug}` : cfId > 0 ? `/patch/${cfId}` : "/",
            cfId: cfId > 0 ? cfId : null,
            refHost: extractReferrerHost(req, origin),
          });
        }
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            ...securityHeaders("app"),
          },
        });
      }
      if (method === "GET" && path === "/theme-init.js") {
        const initScript = `(function(){try{var v={dark:"#0b0c0e",light:"#ffffff",paper:"#f7f3ea",espresso:"#14100d",nord:"#2e3440",tokyo:"#1a1b26",postgres:"#f6f9fc",contrast:"#000000"};var m=localStorage.getItem("pgroast-web-theme")||"system";var d=localStorage.getItem("pgroast-web-theme-day");var n=localStorage.getItem("pgroast-web-theme-night");if(!v[d])d="paper";if(!v[n])n="espresso";var dark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var r=m==="system"?(dark?n:d):(v[m]?m:(dark?n:d));document.documentElement.setAttribute("data-theme",r);var meta=document.getElementById("meta-theme-color");if(meta&&v[r])meta.setAttribute("content",v[r]);}catch(e){}})();`;
        return new Response(initScript, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
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
        await refreshUiAssetsIfChanged();
        const cache = url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-store";
        return new Response(bundleJs, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": cache,
            ...securityHeaders("app"),
          },
        });
      }

      // ---- Health & Privacy-Friendly View Counts ----
      if (method === "GET" && path === "/api/v1/views") {
        return json(await db.getPageViewSummary(), 200, req);
      }

      if (method === "GET" && path === "/api/v1/stats/overview") {
        return json(await getStatsOverview(db), 200, req);
      }

      // ---- Hacking Observatory & Unified Personal Profiles ----
      if (method === "GET" && path === "/api/v1/hackers/overview") {
        const overview = await getHackersOverview(db, url.searchParams.get("window"));
        return json(overview, 200, req);
      }

      if (method === "GET" && path === "/api/v1/hackers/resolve") {
        const slug = await resolvePersonSlugByName(db, url.searchParams.get("name") || "");
        return json({ slug }, 200, req);
      }

      if (method === "GET" && path === "/api/v1/hackers") {
        const hackers = await searchHackers(db, {
          search: url.searchParams.get("search") || undefined,
          role: url.searchParams.get("role") || undefined,
          sort: url.searchParams.get("sort") || undefined,
          limit: Number(url.searchParams.get("limit") || 60),
        });
        return json({ hackers }, 200, req);
      }

      const hackerDetailMatch = path.match(/^\/api\/v1\/hackers\/([a-z0-9-]+)$/i);
      if (method === "GET" && hackerDetailMatch) {
        const slug = hackerDetailMatch[1]!.toLowerCase();
        const yearParam = url.searchParams.get("year");
        const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
        const profile = await getHackerProfileBySlug(db, slug, year);
        if (!profile) return errJson("Hacker profile not found", 404);
        const ua = req.headers.get("user-agent") || "";
        if (req.headers.get("x-pgroast-view") === "1" && !BOT_UA_RE.test(ua)) {
          void db.recordPageView({ path: `/hacker/${slug}`, cfId: null, refHost: "" });
        }
        return json(profile, 200, req);
      }

      // ---- Weekly Quota Auto-Contribute Work Queue & Coverage Progress ----
      if (method === "GET" && path === "/api/v1/contribute/status") {
        const coverage = await db.getCommunityCoverage();
        return json(coverage, 200, req);
      }

      if (method === "GET" && path === "/api/v1/contribute/next") {
        const rl = enforceRateLimit(`contribute:${getClientIp(req)}`);
        if (rl) return rl;
        const rawBackend = (url.searchParams.get("backend") || "claude").toLowerCase().trim();
        const allowedBackends = new Set(["claude", "codex", "agy", "dual"]);
        const backend = allowedBackends.has(rawBackend) ? rawBackend : "claude";
        const rawStrategy = (url.searchParams.get("strategy") || "unroasted-first").toLowerCase().trim();
        const strategy =
          rawStrategy === "cross-model-second-opinion" || rawStrategy === "ready-for-committer"
            ? rawStrategy
            : "unroasted-first";
        const topics = (url.searchParams.get("topics") || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const flavour = (url.searchParams.get("flavour") || url.searchParams.get("flavor") || "auto-by-subsystem").trim();
        const rawLevel = (url.searchParams.get("level") || url.searchParams.get("roast_level") || "medium").toLowerCase().trim();
        const roastLevel = rawLevel === "light" || rawLevel === "dark" ? rawLevel : "medium";
        const dryRun = url.searchParams.get("dry_run") === "1" || url.searchParams.get("dry_run") === "true";
        const excludeCfIds = (url.searchParams.get("exclude") || "")
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        const leaseMinutes = Number(url.searchParams.get("lease_minutes") || 45);

        let contributorHandle = "";
        const authHeader = req.headers.get("authorization") || "";
        if (authHeader.toLowerCase().startsWith("bearer ")) {
          const contributor = await db.verifyPublishToken(authHeader);
          if (contributor) contributorHandle = contributor.handle;
        }

        const next = await db.claimNextContributePatch({
          backend,
          strategy,
          topics,
          flavour,
          roastLevel,
          contributorHandle,
          excludeCfIds,
          dryRun,
          leaseMinutes: Number.isFinite(leaseMinutes) ? leaseMinutes : 45,
        });
        const coverage = await db.getCommunityCoverage();
        return json({ ...next, coverage }, 200, req);
      }

      // ---- Full PostgreSQL Mailing Lists Archive ----
      if (method === "GET" && path === "/api/v1/lists/overview") {
        const overview = await getMailingListsOverview(db);
        return json(overview, 200, req);
      }

      if (method === "GET" && path === "/api/v1/lists/messages") {
        const messages = await searchMailingListMessages(db, {
          list: url.searchParams.get("list") || undefined,
          search: url.searchParams.get("search") || undefined,
          hasAttachment: url.searchParams.get("attachments") === "1",
          personSlug: url.searchParams.get("hacker") || undefined,
          limit: Number(url.searchParams.get("limit") || 60),
        });
        return json({ messages }, 200, req);
      }

      if (method === "GET" && path === "/api/v1/health") {
        const [pgInfo, counts, views] = await Promise.all([
          db.getServerInfo(),
          db.getCounts(),
          db.getPageViewTotals(),
        ]);
        const pgMajor = pgInfo.version.match(/PostgreSQL\s+(\d+)/i)?.[0] || "PostgreSQL";
        return json({
          ok: true,
          app: "pgroast-web",
          version: ROOT_PKG_VERSION,
          database: { version: pgMajor, database: pgInfo.database },
          counts,
          views,
          oauth: {
            githubConfigured: Boolean(cfg.githubClientId && cfg.githubClientSecret),
            googleConfigured: Boolean(cfg.googleClientId && cfg.googleClientSecret),
            devTokenMintEnabled: cfg.allowDevTokenMint,
          },
          localWorkbenchUrl: cfg.localWorkbenchUrl,
        }, 200, req);
      }

      // ---- 1-command CLI browser login & zero-friction CLI registration ----
      if (method === "GET" && path === "/auth/cli") {
        const cli = parseCliCallbackParams(url);
        const ghOk = Boolean(cfg.githubClientId && cfg.githubClientSecret);
        const goOk = Boolean(cfg.googleClientId && cfg.googleClientSecret);
        const qs = cli.cliPort && cli.cliState ? `?cli_port=${cli.cliPort}&cli_state=${encodeURIComponent(cli.cliState)}` : "";
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Sign in to pgroast CLI</title><style>body{margin:0;background:#0b0c0e;color:#e7e9ee;font-family:-apple-system,BlinkMacSystemFont,Inter,Segoe UI,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}.card{max-width:420px;width:100%;background:#13151b;border:1px solid #262a35;border-radius:14px;padding:24px;}h1{font-size:19px;margin:0 0 8px;}p{color:#9ca3b5;font-size:13.5px;line-height:1.5;margin:0 0 18px;}.btns{display:flex;flex-direction:column;gap:10px;}.btn{display:flex;align-items:center;justify-content:center;padding:11px 16px;border-radius:9px;font-size:14px;font-weight:600;text-decoration:none;border:1px solid #2d3240;background:#1a1d26;color:#e7e9ee;}.btn.primary{background:#5e6ad2;border-color:#5e6ad2;color:#fff;}</style></head><body><main class="card"><h1>Sign in to pgroast CLI</h1><p>Issues a publish-only token for your local CLI (~/.pgroast/auth.json). Nothing is ever posted to pgsql-hackers or CommitFest.</p><div class="btns">${ghOk ? `<a class="btn primary" href="/auth/github${qs}">Continue with GitHub</a>` : ""}${goOk ? `<a class="btn${ghOk ? "" : " primary"}" href="/auth/google${qs}">Continue with Google</a>` : ""}${!ghOk && !goOk ? `<p>OAuth is not configured on this server. Run <code>npx pgroast login</code> in your terminal for automatic CLI registration.</p>` : ""}</div></main></body></html>`;
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders("app") },
        });
      }

      if (method === "POST" && path === "/api/v1/auth/cli-register") {
        const rl = enforceRateLimit(`cli-reg:${getClientIp(req)}`, cliRegRateLimit);
        if (rl) return rl;
        const body = await readJson<{ handle?: string; name?: string; avatarUrl?: string }>(req, 16 * 1024);
        const handle = String(body.handle || "").trim();
        const name = String(body.name || handle).trim().slice(0, 80);
        const avatarUrl = String(body.avatarUrl || "").trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,38}$/.test(handle)) {
          return errJson("Handle must be 2–39 characters (letters, digits, '.', '_', '-').", 400);
        }
        const gate = checkPublicPayloadSafe(`${handle} ${name}`);
        if (!gate.safe) {
          return errJson(`Blocked by Public-Confidentiality Gate: ${gate.reasons.join("; ")}`, 422);
        }
        const registered = await db.registerCliContributor({ handle, name, avatarUrl });
        if ("conflict" in registered) {
          return errJson(`Handle "@${handle}" is already claimed. Pick another handle with --handle.`, 409);
        }
        return new Response(
          JSON.stringify({
            contributor: {
              handle: registered.contributor.handle,
              name: registered.contributor.name,
              provider: registered.contributor.provider,
            },
            prefix: registered.prefix,
            token: registered.token,
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              ...securityHeaders("json"),
            },
          },
        );
      }

      // ---- Identity-only OAuth entrypoints & callbacks (GitHub / Google) ----
      if (method === "GET" && path === "/auth/github") {
        const rl = enforceRateLimit(`oauth:${getClientIp(req)}`);
        if (rl) return rl;
        if (!cfg.githubClientId || !cfg.githubClientSecret) {
          return errJson("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not configured on this server. Set GitHub OAuth env vars or issue a team token via `bun run web:mint-token`.", 501);
        }
        const cli = parseCliCallbackParams(url);
        const { state, cookie } = issueOAuthState("github", cli);
        const redirectUri = `${cfg.publicOrigin}/auth/github/callback`;
        const ghUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(cfg.githubClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${encodeURIComponent(state)}`;
        return new Response(null, {
          status: 302,
          headers: {
            Location: ghUrl,
            "Set-Cookie": cookie,
            "Cache-Control": "no-store",
          },
        });
      }

      if (method === "GET" && path === "/auth/github/callback") {
        if (!cfg.githubClientId || !cfg.githubClientSecret) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "github",
              error: "GitHub OAuth is not configured on this server.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            501,
          );
        }
        const errParam = url.searchParams.get("error");
        if (errParam) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "github",
              error: url.searchParams.get("error_description") || errParam,
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            400,
          );
        }
        const code = (url.searchParams.get("code") || "").trim();
        const stateParam = (url.searchParams.get("state") || "").trim();
        const stateCheck = consumeOAuthState(req, "github", stateParam);
        if (!code || !stateCheck.ok) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "github",
              error: "Invalid or expired OAuth state. Please start sign-in again.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            400,
          );
        }
        const redirectUri = `${cfg.publicOrigin}/auth/github/callback`;
        const tokenRes = await oauthFetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: cfg.githubClientId,
            client_secret: cfg.githubClientSecret,
            code,
            redirect_uri: redirectUri,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
        if (!tokenRes.ok || !tokenJson.access_token) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "github",
              error: tokenJson.error_description || tokenJson.error || "GitHub token exchange failed.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            502,
          );
        }
        const userRes = await oauthFetch("https://api.github.com/user", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${tokenJson.access_token}`,
            "User-Agent": "pgroast-web",
          },
          signal: AbortSignal.timeout(10_000),
        });
        const userJson = (await userRes.json().catch(() => ({}))) as { id?: number | string; login?: string; name?: string; avatar_url?: string };
        if (!userRes.ok || !userJson.login) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "github",
              error: "Could not read GitHub user profile.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            502,
          );
        }
        const contributor = await db.upsertContributor({
          provider: "github",
          providerUserId: userJson.id != null ? String(userJson.id) : undefined,
          handle: userJson.login,
          name: userJson.name || userJson.login,
          avatarUrl: userJson.avatar_url || "",
        });
        const minted = await db.mintPublishToken(contributor.id, "github-oauth");
        if (stateCheck.cliPort && stateCheck.cliState) {
          return oauthCliRedirect(stateCheck.cliPort, stateCheck.cliState, minted.token, contributor.handle);
        }
        return oauthHtmlResponse(
          renderOAuthResultHtml({
            ok: true,
            provider: "github",
            handle: contributor.handle,
            name: contributor.name,
            token: minted.token,
            localWorkbenchUrl: cfg.localWorkbenchUrl,
          }),
          200,
        );
      }

      if (method === "GET" && path === "/auth/google") {
        const rl = enforceRateLimit(`oauth:${getClientIp(req)}`);
        if (rl) return rl;
        if (!cfg.googleClientId || !cfg.googleClientSecret) {
          return errJson("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured on this server. Set Google OAuth env vars or issue a team token via `bun run web:mint-token`.", 501);
        }
        const cli = parseCliCallbackParams(url);
        const { state, cookie } = issueOAuthState("google", cli);
        const redirectUri = `${cfg.publicOrigin}/auth/google/callback`;
        const gUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(cfg.googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("openid profile email")}&state=${encodeURIComponent(state)}`;
        return new Response(null, {
          status: 302,
          headers: {
            Location: gUrl,
            "Set-Cookie": cookie,
            "Cache-Control": "no-store",
          },
        });
      }

      if (method === "GET" && path === "/auth/google/callback") {
        if (!cfg.googleClientId || !cfg.googleClientSecret) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "google",
              error: "Google OAuth is not configured on this server.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            501,
          );
        }
        const errParam = url.searchParams.get("error");
        if (errParam) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "google",
              error: errParam,
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            400,
          );
        }
        const code = (url.searchParams.get("code") || "").trim();
        const stateParam = (url.searchParams.get("state") || "").trim();
        const stateCheck = consumeOAuthState(req, "google", stateParam);
        if (!code || !stateCheck.ok) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "google",
              error: "Invalid or expired OAuth state. Please start sign-in again.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            400,
          );
        }
        const redirectUri = `${cfg.publicOrigin}/auth/google/callback`;
        const form = new URLSearchParams({
          client_id: cfg.googleClientId,
          client_secret: cfg.googleClientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        });
        const tokenRes = await oauthFetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: form.toString(),
          signal: AbortSignal.timeout(10_000),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
        if (!tokenRes.ok || !tokenJson.access_token) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "google",
              error: tokenJson.error_description || tokenJson.error || "Google token exchange failed.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            502,
          );
        }
        const userRes = await oauthFetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        const userJson = (await userRes.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
        const googleSub = (userJson.sub || "").trim();
        if (!userRes.ok || !googleSub) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "google",
              error: "Could not read Google user profile.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            502,
          );
        }
        if (userJson.email && userJson.email_verified !== true) {
          return oauthHtmlResponse(
            renderOAuthResultHtml({
              ok: false,
              provider: "google",
              error: "Google account email must be verified before minting a publish token.",
              localWorkbenchUrl: cfg.localWorkbenchUrl,
            }),
            403,
          );
        }
        const derivedHandle = (userJson.email ? userJson.email.split("@")[0] : `google-${googleSub.slice(-8)}`).trim();
        const contributor = await db.upsertContributor({
          provider: "google",
          providerUserId: googleSub,
          handle: derivedHandle,
          name: userJson.name || derivedHandle,
          avatarUrl: userJson.picture || "",
        });
        const minted = await db.mintPublishToken(contributor.id, "google-oauth");
        if (stateCheck.cliPort && stateCheck.cliState) {
          return oauthCliRedirect(stateCheck.cliPort, stateCheck.cliState, minted.token, contributor.handle);
        }
        return oauthHtmlResponse(
          renderOAuthResultHtml({
            ok: true,
            provider: "google",
            handle: contributor.handle,
            name: contributor.name,
            token: minted.token,
            localWorkbenchUrl: cfg.localWorkbenchUrl,
          }),
          200,
        );
      }

      // Admin-authenticated team token minting (works even when OAuth apps are not set up yet)
      if (method === "POST" && path === "/api/v1/admin/tokens") {
        const rl = enforceRateLimit(`admin:${getClientIp(req)}`);
        if (rl) return rl;
        if (!cfg.adminSecret) {
          return errJson("PGROAST_WEB_ADMIN_SECRET is not configured on this server.", 501);
        }
        if (!verifyBearerSecret(req, cfg.adminSecret)) {
          return errJson("Invalid admin bearer secret.", 401);
        }
        const body = await readJson<{ provider?: "github" | "google"; handle?: string; name?: string; avatarUrl?: string; label?: string }>(req, 16 * 1024);
        const handle = (body.handle || "").trim();
        if (!handle) return errJson("handle is required", 400);
        const provider = body.provider === "google" ? "google" : "github";
        const contributor = await db.upsertContributor({
          provider,
          handle,
          name: (body.name || handle).trim(),
          avatarUrl: body.avatarUrl || "",
        });
        const minted = await db.mintPublishToken(contributor.id, body.label || "team-invite");
        return json({ contributor, token: minted.token, prefix: minted.prefix }, 201);
      }

      // Local-dev token minting so Nik / Kirk can test local->public publishing immediately before setting OAuth apps
      if (method === "POST" && path === "/api/v1/tokens/dev") {
        const rl = enforceRateLimit(`dev:${getClientIp(req)}`);
        if (rl) return rl;
        if (!cfg.allowDevTokenMint) {
          return errJson("Dev token minting is disabled in production; sign in via GitHub or Google OAuth.", 403);
        }
        const body = await readJson<{ provider?: "github" | "google"; handle?: string; name?: string; avatarUrl?: string; label?: string }>(req, 16 * 1024);
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

        const briefOrigin = resolveRequestOrigin(req, cfg);
        if (kind === "download.md") {
          return new Response(renderBriefMarkdown(brief, briefOrigin), {
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
        const html = renderInteractiveBriefHtml(brief, cfg.localWorkbenchUrl, briefOrigin);
        const ua = req.headers.get("user-agent") || "";
        if (!BOT_UA_RE.test(ua)) {
          void db.recordPageView({
            path: `/briefs/${brief.slug}/${kind}`,
            cfId: null,
            refHost: extractReferrerHost(req, briefOrigin),
          });
        }
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...(kind === "download.html" ? { "Content-Disposition": `attachment; filename="${brief.slug}.html"` } : {}),
            ...securityHeaders("sandbox_brief", { briefScriptHash: BRIEF_SCRIPT_SHA256 }),
          },
        });
      }

      // ---- Public Entries & Attributed Opinions ----
      if (method === "GET" && path === "/api/v1/entries") {
        const rawLimit = Number(url.searchParams.get("limit") || 300);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(2000, Math.trunc(rawLimit))) : 300;
        const entries = await db.listEntries({
          search: url.searchParams.get("search") || undefined,
          verdict: url.searchParams.get("verdict") || undefined,
          limit,
        });
        return json({ entries }, 200, req);
      }

      const entryDetailMatch = path.match(/^\/api\/v1\/entries\/(\d+)$/);
      if (method === "GET" && entryDetailMatch) {
        const cfId = parsePositivePgInt(entryDetailMatch[1]);
        if (!cfId) return errJson("Invalid cf_id", 400);
        let [entry, opinions, coordination] = await Promise.all([
          db.getEntry(cfId),
          db.listOpinions(cfId, 100),
          db.listCoordination(cfId),
        ]);
        if (!entry) {
          const live = await fetchLiveCommitfestPatch(cfId);
          if (live) {
            await db.upsertPublicEntry(live);
            entry = await db.getEntry(cfId);
          }
        }
        const peopleLinks = await resolvePeopleLinksForEntry(db, entry).catch(() => ({
          authors: [],
          reviewers: [],
          committer: [],
        }));
        const consensus = computePatchConsensus(opinions, entry?.verdict);
        const ua = req.headers.get("user-agent") || "";
        if (req.headers.get("x-pgroast-view") === "1" && !BOT_UA_RE.test(ua)) {
          void db.recordPageView({ path: `/patch/${cfId}`, cfId, refHost: "" });
        }
        return json({ cf_id: cfId, entry, opinions, coordination, consensus, peopleLinks }, 200, req);
      }

      const entryThreadMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/thread$/);
      if (method === "GET" && entryThreadMatch) {
        const rl = enforceRateLimit(`mr:${getClientIp(req)}`, mrRateLimit);
        if (rl) return rl;
        const cfId = parsePositivePgInt(entryThreadMatch[1]);
        if (!cfId) return errJson("Invalid cf_id", 400);
        const entry = await db.getEntry(cfId);
        try {
          const discussion = await fetchMrDiscussionForCf(
            cfId,
            entry?.thread_url || undefined,
            entry?.authors || undefined,
          );
          return json(discussion, 200, req);
        } catch (err) {
          return errJson(err instanceof Error ? err.message : String(err), 404);
        }
      }

      const entryDiffMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/diff$/);
      if (method === "GET" && entryDiffMatch) {
        const rl = enforceRateLimit(`mr:${getClientIp(req)}`, mrRateLimit);
        if (rl) return rl;
        const cfId = parsePositivePgInt(entryDiffMatch[1]);
        if (!cfId) return errJson("Invalid cf_id", 400);
        try {
          const entry = await db.getEntry(cfId);
          const [diff, discussion] = await Promise.all([
            fetchMrDiffForCf(cfId),
            fetchMrDiscussionForCf(cfId, entry?.thread_url || undefined, entry?.authors || undefined).catch(() => null),
          ]);
          return json(matchThreadToDiff(diff, discussion), 200, req);
        } catch (err) {
          return errJson(err instanceof Error ? err.message : String(err), 404);
        }
      }

      if (method === "GET" && path === "/api/v1/opinions") {
        const cfIdParam = url.searchParams.get("cfId");
        const parsedCfId = cfIdParam ? parsePositivePgInt(cfIdParam) : undefined;
        if (cfIdParam && !parsedCfId) return errJson("Invalid cfId", 400);
        const limitParam = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 1000);
        const opinions = await db.listOpinions(parsedCfId ?? undefined, limitParam);
        return json({ opinions, total: opinions.length }, 200, req);
      }

      const entryOpMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/opinions$/);
      if (method === "GET" && entryOpMatch) {
        const cfId = parsePositivePgInt(entryOpMatch[1]);
        if (!cfId) return errJson("Invalid cf_id", 400);
        return json({ cf_id: cfId, opinions: await db.listOpinions(cfId, 50) });
      }

      // ---- Explicit Publish API (Local -> Public ONLY, Publish-Only Bearer Token + Confidentiality Gate) ----
      if (method === "POST" && path === "/api/v1/publish/opinion") {
        const rlIp = enforceRateLimit(`pubip:${getClientIp(req)}`);
        if (rlIp) return rlIp;
        const auth = req.headers.get("authorization") || "";
        const contributor = await db.verifyPublishToken(auth);
        if (!contributor) return errJson("Valid publish-only Bearer token required.", 401);
        const rl = enforceRateLimit(`pub:${contributor.id}:${getClientIp(req)}`);
        if (rl) return rl;

        const body = await readJson<{
          cf_id?: number;
          entry?: Partial<PublicEntryRecord>;
          backend?: string;
          roast_level?: string;
          roast_flavour?: string;
          models?: Record<string, string> | string;
          models_json?: Record<string, string> | string;
          verdict?: string;
          confidence?: string;
          summary?: string;
        }>(req, 256 * 1024);
        const cfId = parsePositivePgInt(body.cf_id);
        if (!cfId || !body.verdict?.trim()) {
          return errJson("Valid positive cf_id and verdict are required", 400);
        }
        const safety = checkPublicPayloadSafe(body);
        if (!safety.safe) {
          return errJson(`Public-Confidentiality HARD BLOCK: ${safety.reasons.join("; ")}`, 422);
        }
        const sanitizedEntry = body.entry
          ? {
              ...body.entry,
              thread_url: body.entry.thread_url ? safeHttpUrl(body.entry.thread_url) : "",
            }
          : undefined;
        const saved = await db.publishOpinion({
          cf_id: cfId,
          entry: sanitizedEntry,
          contributor,
          backend: (body.backend || "ai-harness").slice(0, 60),
          roast_level: body.roast_level || "medium",
          roast_flavour: body.roast_flavour || "default",
          models: body.models ?? body.models_json,
          verdict: body.verdict.trim(),
          confidence: body.confidence || "medium",
          summary: body.summary || "",
        });
        return json({ opinion: saved }, 201);
      }

      if (method === "POST" && path === "/api/v1/publish/brief") {
        const rlIp = enforceRateLimit(`pubip:${getClientIp(req)}`);
        if (rlIp) return rlIp;
        const auth = req.headers.get("authorization") || "";
        const contributor = await db.verifyPublishToken(auth);
        if (!contributor) return errJson("Valid publish-only Bearer token required.", 401);
        const rl = enforceRateLimit(`pub:${contributor.id}:${getClientIp(req)}`);
        if (rl) return rl;

        const body = await readJson<{
          slug?: string;
          title?: string;
          commitfestLabel?: string;
          stats?: unknown;
          shortlist?: unknown[];
          closing?: unknown[];
          entries?: Array<Partial<PublicEntryRecord> & { cf_id: number }>;
        }>(req, cfg.maxPublishBytes);
        if (!body.title?.trim()) return errJson("title is required", 400);

        const rawSlug = body.slug || `cf-${new Date().toISOString().slice(0, 10)}`;
        const safeSlug = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || `brief-${Date.now()}`;
        const principal = `${contributor.provider.toLowerCase()}:${contributor.handle.trim().toLowerCase()}`;

        if (cfg.briefMaintainers.length > 0) {
          if (!cfg.briefMaintainers.includes(principal)) {
            return errJson("Only authorized hub brief maintainers may publish CommitFest briefs.", 403);
          }
        } else {
          const { slugOwners, allPublishers } = await db.getBriefOwners();
          const existingOwner = slugOwners.get(safeSlug);
          if (existingOwner && existingOwner !== principal) {
            return errJson("Only the brief owner or configured brief maintainers can overwrite this brief slug.", 403);
          }
          if (allPublishers.size > 0 && !allPublishers.has(principal)) {
            return errJson(
              "Brief publishing is restricted to existing hub brief maintainers. Set PGROAST_WEB_BRIEF_MAINTAINERS (e.g. github:handle) to authorize additional handles.",
              403,
            );
          }
        }

        const safety = checkPublicPayloadSafe(body);
        if (!safety.safe) {
          return errJson(`Public-Confidentiality HARD BLOCK: ${safety.reasons.join("; ")}`, 422);
        }
        const brief = await db.savePublishedBrief({
          slug: safeSlug,
          title: body.title.trim(),
          commitfestLabel: body.commitfestLabel || "CommitFest",
          contributor,
          stats: body.stats ?? {},
          shortlist: body.shortlist ?? [],
          closing: body.closing ?? [],
          entries: (body.entries ?? []).filter((e) => parsePositivePgInt(e.cf_id) !== null),
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
        const rlIp = enforceRateLimit(`pubip:${getClientIp(req)}`);
        if (rlIp) return rlIp;
        const auth = req.headers.get("authorization") || "";
        const contributor = await db.verifyPublishToken(auth);
        if (!contributor) return errJson("Valid publish-only Bearer token required.", 401);
        const rl = enforceRateLimit(`pub:${contributor.id}:${getClientIp(req)}`);
        if (rl) return rl;
        const body = await readJson<{ cf_id?: number | null; bug_ref?: string; title?: string; status?: "open" | "in_progress" | "done"; note?: string }>(req, 64 * 1024);
        if (!body.title?.trim()) return errJson("title is required", 400);
        const cfId = body.cf_id == null ? null : parsePositivePgInt(body.cf_id);
        if (body.cf_id != null && cfId === null) return errJson("Invalid cf_id", 400);
        const safety = checkPublicPayloadSafe(body);
        if (!safety.safe) {
          return errJson(`Public-Confidentiality HARD BLOCK: ${safety.reasons.join("; ")}`, 422);
        }
        const item = await db.upsertCoordination({
          cf_id: cfId,
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
      if (err instanceof PayloadTooLargeError) {
        return errJson(err.message, 413);
      }
      console.error("[pgroast-web] unhandled error:", err);
      return errJson("Internal server error.", 500);
    }
  }

  return { fetch: fetchHandler, db, config: cfg };
}

export async function createWebServer(opts?: { db?: WebDatabase; config?: Partial<WebConfig> }) {
  const app = await createWebHandler(opts);
  const server = Bun.serve({
    hostname: app.config.host,
    port: app.config.port,
    maxRequestBodySize: Math.max(app.config.maxPublishBytes + 65536, 5 * 1024 * 1024),
    fetch: app.fetch,
  });
  return { server, db: app.db, config: app.config, fetch: app.fetch };
}

if (import.meta.main) {
  const { server, config } = await createWebServer();
  console.log(`pgroast-web running at http://${config.host}:${server.port} (public companion)`);
}
