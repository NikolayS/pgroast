import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderBriefMarkdown, renderInteractiveBriefHtml } from "./brief.ts";
import { loadWebConfig, WEB_ROOT, type WebConfig } from "./config.ts";
import { WebDatabase, type PublicEntryRecord } from "./db.ts";
import { fetchMrDiffForCf, fetchMrDiscussionForCf } from "./mr.ts";
import { checkPublicPayloadSafe, securityHeaders } from "./security.ts";

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
    if (k) out[k] = decodeURIComponent(v);
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
    buckets.set(key, arr);
    if (buckets.size > 2000) {
      for (const [k, v] of buckets) {
        if (v.length === 0 || (v[v.length - 1] ?? 0) < cutoff) buckets.delete(k);
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

async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 256 * 1024): Promise<T> {
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > maxBytes) throw new PayloadTooLargeError(maxBytes);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new PayloadTooLargeError(maxBytes);
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
  const oauthStates = new Map<string, { provider: "github" | "google"; expiresAt: number }>();
  let bundleJs = await buildUiJs();

  const htmlPath = join(WEB_ROOT, "src", "ui", "index.html");
  const cssPath = join(WEB_ROOT, "src", "ui", "styles.css");
  const faviconPath = join(WEB_ROOT, "src", "ui", "favicon.svg");
  const touchIconPath = join(WEB_ROOT, "src", "ui", "apple-touch-icon.png");
  const manifestPath = join(WEB_ROOT, "src", "ui", "manifest.webmanifest");
  const cssHash = createHash("sha256").update(readFileSync(cssPath, "utf8")).digest("hex").slice(0, 8);
  const jsHash = createHash("sha256").update(bundleJs).digest("hex").slice(0, 8);
  const favHash = createHash("sha256").update(readFileSync(faviconPath, "utf8")).digest("hex").slice(0, 8);
  const touchHash = existsSync(touchIconPath)
    ? createHash("sha256").update(readFileSync(touchIconPath)).digest("hex").slice(0, 8)
    : favHash;

  function issueOAuthState(provider: "github" | "google"): { state: string; cookie: string } {
    const now = Date.now();
    for (const [k, v] of oauthStates) {
      if (v.expiresAt < now) oauthStates.delete(k);
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

  function enforceRateLimit(key: string): Response | null {
    const rl = rateLimit(key);
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
          .replace("/favicon.svg", `/favicon.svg?v=${favHash}`)
          .replace("/apple-touch-icon.png", `/apple-touch-icon.png?v=${touchHash}`)
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

      // ---- Identity-only OAuth entrypoints & callbacks (GitHub / Google) ----
      if (method === "GET" && path === "/auth/github") {
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
        const userJson = (await userRes.json().catch(() => ({}))) as { login?: string; name?: string; avatar_url?: string };
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
        const userJson = (await userRes.json().catch(() => ({}))) as { sub?: string; email?: string; name?: string; picture?: string };
        const derivedHandle = (userJson.email ? userJson.email.split("@")[0] : userJson.sub || "").trim();
        if (!userRes.ok || !derivedHandle) {
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
        const contributor = await db.upsertContributor({
          provider: "google",
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
        if (!cfg.adminSecret) {
          return errJson("PGROAST_WEB_ADMIN_SECRET is not configured on this server.", 501);
        }
        if (!verifyBearerSecret(req, cfg.adminSecret)) {
          return errJson("Invalid admin bearer secret.", 401);
        }
        const rl = enforceRateLimit(`admin:${getClientIp(req)}`);
        if (rl) return rl;
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
        if (!cfg.allowDevTokenMint) {
          return errJson("Dev token minting is disabled in production; sign in via GitHub or Google OAuth.", 403);
        }
        const rl = enforceRateLimit(`dev:${getClientIp(req)}`);
        if (rl) return rl;
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
        const rl = enforceRateLimit(`pub:${contributor.id}:${getClientIp(req)}`);
        if (rl) return rl;
        const body = await readJson<{ cf_id?: number | null; bug_ref?: string; title?: string; status?: "open" | "in_progress" | "done"; note?: string }>(req, 64 * 1024);
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
      if (err instanceof PayloadTooLargeError) {
        return errJson(err.message, 413);
      }
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
