import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BRIEF_SCRIPT_SHA256, renderBriefMarkdown, renderInteractiveBriefHtml } from "./brief.ts";
import { loadWebConfig, WEB_ROOT, type WebConfig } from "./config.ts";
import { WebDatabase, type PublicEntryRecord } from "./db.ts";
import { fetchMrDiffForCf, fetchMrDiscussionForCf, matchThreadToDiff } from "./mr.ts";
import { checkPublicPayloadSafe, safeHttpUrl, securityHeaders } from "./security.ts";

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
      <p class="hint">This token can only publish sanitized opinions, briefs, and coordination claims. It cannot read private data or control your local machine.</p>
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
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0]!.trim().toLowerCase();
  return `${proto === "http" ? "http" : "https"}://${rawHost}`;
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
        ? `Baseline brief pass: ${humanVerdictLabel(baselineVerdict)}. Waiting for additional reviewer AI opinions to build consensus.`
        : "No reviewer AI opinions published yet for this patch.",
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
      headline: `1 reviewer opinion (${reviewers.size} reviewer): ${humanVerdictLabel(topVerdict)}. Add another run to compare perspectives.`,
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
      headline: `Unanimous across ${total} opinions (${reviewers.size} reviewer${reviewers.size === 1 ? "" : "s"}): ${humanVerdictLabel(topVerdict)}.`,
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
  const oauthStates = new Map<string, { provider: "github" | "google"; expiresAt: number }>();
  let bundleJs = await buildUiJs();

  const htmlPath = join(WEB_ROOT, "src", "ui", "index.html");
  const cssPath = join(WEB_ROOT, "src", "ui", "styles.css");
  const appTsPath = join(WEB_ROOT, "src", "ui", "app.ts");
  const faviconPath = join(WEB_ROOT, "src", "ui", "favicon.svg");
  const touchIconPath = join(WEB_ROOT, "src", "ui", "apple-touch-icon.png");
  const manifestPath = join(WEB_ROOT, "src", "ui", "manifest.webmanifest");

  let appMtime = existsSync(appTsPath) ? statSync(appTsPath).mtimeMs : 0;
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
      const curAppMtime = existsSync(appTsPath) ? statSync(appTsPath).mtimeMs : 0;
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

  function issueOAuthState(provider: "github" | "google"): { state: string; cookie: string } {
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
    oauthStates.set(state, { provider, expiresAt: now + 10 * 60_000 });
    const secure = cfg.publicOrigin.startsWith("https://") ? "; Secure" : "";
    return {
      state,
      cookie: `pgroast_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${secure}`,
    };
  }

  function consumeOAuthState(req: Request, provider: "github" | "google", stateParam: string): boolean {
    if (!stateParam) return false;
    const cookies = parseCookies(req);
    const cookieState = cookies["pgroast_oauth_state"] || "";
    const entry = oauthStates.get(stateParam);
    oauthStates.delete(stateParam);
    if (!entry || entry.provider !== provider || entry.expiresAt < Date.now()) return false;
    if (!cookieState || cookieState !== stateParam) return false;
    return true;
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
      if (method === "GET" && path === "/manifest.webmanifest" && existsSync(manifestPath)) {
        return new Response(readFileSync(manifestPath, "utf8"), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
          },
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
        const [entries, briefs] = await Promise.all([db.listEntries({ limit: 1000 }), db.listBriefs()]);
        const latestDate = (briefs[0]?.created_at || new Date().toISOString()).slice(0, 10);
        const staticUrls: Array<{ loc: string; lastmod: string; changefreq: string; priority: string }> = [
          { loc: `${origin}/`, lastmod: latestDate, changefreq: "daily", priority: "1.0" },
          { loc: `${origin}/?tab=stats`, lastmod: latestDate, changefreq: "daily", priority: "0.8" },
          { loc: `${origin}/?tab=entries`, lastmod: latestDate, changefreq: "daily", priority: "0.8" },
          { loc: `${origin}/?tab=opinions`, lastmod: latestDate, changefreq: "hourly", priority: "0.8" },
          { loc: `${origin}/?tab=coordination`, lastmod: latestDate, changefreq: "daily", priority: "0.6" },
          { loc: `${origin}/?tab=connect`, lastmod: latestDate, changefreq: "weekly", priority: "0.6" },
          { loc: `${origin}/llms.txt`, lastmod: latestDate, changefreq: "daily", priority: "0.6" },
        ];
        const entryUrls = entries.map((e) => ({
          loc: `${origin}/patch/${e.cf_id}`,
          lastmod: (e.updated_at || latestDate).slice(0, 10),
          changefreq: "weekly",
          priority: e.verdict && e.verdict !== "UNROASTED" ? "0.7" : "0.5",
        }));
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          [...staticUrls, ...entryUrls]
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
          "> Open-source PostgreSQL CommitFest collaboration hub where human reviewers and AI assistants perform adversarial design pre-reviews (\"roasts\") of PostgreSQL patches, compare multi-model opinions, and hand off verified reviews to pgsql-hackers.",
          "",
          "## How pgroast works",
          "",
          "- **Humans + AIs together:** Reviewers run a private local Backoffice (`apps/local`) with their own AI CLIs (Claude, Codex, Gemini/agy, or cross-family dual mode) to pre-review CommitFest entries or their own draft patches (`pgroast --self`), then explicitly publish sanitized opinions to this public hub.",
          "- **Roast levels:** `light` (constructive author pre-flight checklist), `medium` (balanced committer design review), `dark` (harsh adversarial stress-test on maintenance burden, demand, WAL/locking edge cases, and core vs. extension fit).",
          "- **Hacker flavours:** `default`, `tom-lane`, `peter-eisentraut`, `robert-haas`, `andres-freund`, `heikki-linnakangas`, `bruce-momjian`, `alexander-korotkov`. Flavours are not connected to the real people — they are only what AI thinks that hacker might focus on, with no guarantee they would say it in reality (AI makes mistakes all the time). Every report and opinion records its level and flavour.",
          "- **Human ownership:** AI roasts are never final committer verdicts and nothing is auto-posted. A human reviewer takes ownership of a patch, verifies the code and thread, and sends their own review to `pgsql-hackers`.",
          "",
          "## Live CommitFest Snapshot",
          "",
          `- Public hub: ${origin}/`,
          `- Source code (Apache-2.0): https://github.com/NikolayS/pgroast`,
          `- Indexed CommitFest entries: ${entries.length}`,
          `- Published reviewer/AI opinions: ${opinions.length}`,
          `- Published CommitFest briefs: ${briefs.length}${latestBrief ? ` (latest: ${latestBrief.title}, ${latestBrief.commitfest_label})` : ""}`,
          "",
          "## Key Pages",
          "",
          `- [CommitFest Brief & Shortlist](${origin}/): Triage summary, verdict breakdown, shortlist, and closing/rethinking candidates.`,
          `- [CommitFest Stats & Leaderboards](${origin}/?tab=stats): Verdict heatmap, subsystem health, and clickable top authors, reviewers, and committers.`,
          `- [All CommitFest Entries](${origin}/?tab=entries): Searchable directory of ${entries.length} patches with status and verdict filters.`,
          `- [Community AI Opinions](${origin}/?tab=opinions): Attributed multi-model, multi-flavour review opinions.`,
          `- [Personal Backoffice Setup](${origin}/?tab=connect): How to run your own local workbench and publish opinions.`,
          `- [XML Sitemap](${origin}/sitemap.xml): Complete index of all patch collaboration pages.`,
          `- [Full LLM Digest](${origin}/llms-full.txt): Expanded Markdown with live opinions and full shortlist.`,
          "",
        ];
        if (opinions.length > 0) {
          lines.push("## Recent Community Opinions", "");
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
          `- Patch consensus & opinions: \`GET ${origin}/api/v1/entries/<cf_id>\``,
          `- Parsed pgsql-hackers thread: \`GET ${origin}/api/v1/entries/<cf_id>/thread\``,
          `- Live CFBot unified diff: \`GET ${origin}/api/v1/entries/<cf_id>/diff\``,
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
      if (method === "GET" && (path === "/" || path === "/index.html" || patchPageMatch)) {
        await refreshUiAssetsIfChanged();
        const origin = resolveRequestOrigin(req, cfg);
        const cfId = parsePositivePgInt(patchPageMatch?.[1] || url.searchParams.get("cf")) ?? 0;
        let title = "pgroast — PostgreSQL CommitFest Collaboration & AI Pre-Review";
        let desc = "Review PostgreSQL CommitFest patches together with humans and AIs: light/medium/dark roasts, hacker flavours, GitLab-style -hackers threads, live diffs, and common-ground consensus.";
        let canonical = `${origin}/`;
        let jsonLd: Record<string, unknown> = {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "pgroast",
          url: `${origin}/`,
          description: desc,
        };
        if (cfId > 0) {
          canonical = `${origin}/patch/${cfId}`;
          const entry = await db.getEntry(cfId);
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
            path: cfId > 0 ? `/patch/${cfId}` : "/",
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

      // ---- Identity-only OAuth entrypoints & callbacks (GitHub / Google) ----
      if (method === "GET" && path === "/auth/github") {
        const rl = enforceRateLimit(`oauth:${getClientIp(req)}`);
        if (rl) return rl;
        if (!cfg.githubClientId || !cfg.githubClientSecret) {
          return errJson("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not configured on this server. Set GitHub OAuth env vars or issue a team token via `bun run web:mint-token`.", 501);
        }
        const { state, cookie } = issueOAuthState("github");
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
        if (!code || !consumeOAuthState(req, "github", stateParam)) {
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
        const { state, cookie } = issueOAuthState("google");
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
        if (!code || !consumeOAuthState(req, "google", stateParam)) {
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
        const ua = req.headers.get("user-agent") || "";
        if (!BOT_UA_RE.test(ua)) {
          const briefOrigin = resolveRequestOrigin(req, cfg);
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
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.trunc(rawLimit))) : 300;
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
        const [entry, opinions, coordination] = await Promise.all([
          db.getEntry(cfId),
          db.listOpinions(cfId, 100),
          db.listCoordination(cfId),
        ]);
        const consensus = computePatchConsensus(opinions, entry?.verdict);
        const ua = req.headers.get("user-agent") || "";
        if (req.headers.get("x-pgroast-view") === "1" && !BOT_UA_RE.test(ua)) {
          void db.recordPageView({ path: `/patch/${cfId}`, cfId, refHost: "" });
        }
        return json({ cf_id: cfId, entry, opinions, coordination, consensus }, 200, req);
      }

      const entryThreadMatch = path.match(/^\/api\/v1\/entries\/(\d+)\/thread$/);
      if (method === "GET" && entryThreadMatch) {
        const rl = enforceRateLimit(`mr:${getClientIp(req)}`, mrRateLimit);
        if (rl) return rl;
        const cfId = parsePositivePgInt(entryThreadMatch[1]);
        if (!cfId) return errJson("Invalid cf_id", 400);
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
        const rl = enforceRateLimit(`mr:${getClientIp(req)}`, mrRateLimit);
        if (rl) return rl;
        const cfId = parsePositivePgInt(entryDiffMatch[1]);
        if (!cfId) return errJson("Invalid cf_id", 400);
        try {
          const entry = await db.getEntry(cfId);
          const [diff, discussion] = await Promise.all([
            fetchMrDiffForCf(cfId),
            fetchMrDiscussionForCf(cfId, entry?.thread_url || undefined).catch(() => null),
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
        const opinions = await db.listOpinions(parsedCfId ?? undefined, 150);
        return json({ opinions }, 200, req);
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
          models: body.models,
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
        const handleLower = contributor.handle.trim().toLowerCase();

        if (cfg.briefMaintainers.length > 0) {
          if (!cfg.briefMaintainers.includes(handleLower)) {
            return errJson("Only authorized hub brief maintainers may publish CommitFest briefs.", 403);
          }
        } else {
          const { slugOwners, allPublishers } = await db.getBriefOwners();
          const existingOwner = slugOwners.get(safeSlug);
          if (existingOwner && existingOwner !== handleLower) {
            return errJson("Only the brief owner or configured brief maintainers can overwrite this brief slug.", 403);
          }
          if (allPublishers.size > 0 && !allPublishers.has(handleLower)) {
            return errJson(
              "Brief publishing is restricted to existing hub brief maintainers. Set PGROAST_WEB_BRIEF_MAINTAINERS to authorize additional handles.",
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
