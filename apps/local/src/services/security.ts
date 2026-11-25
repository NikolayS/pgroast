import { randomBytes, timingSafeEqual } from "node:crypto";

export interface LocalSecurityConfig {
  token: string;
  requireAuth: boolean;
  strictUrlTokenOnly: boolean;
}

export function createLocalSecurityConfig(opts?: { requireAuth?: boolean; token?: string }): LocalSecurityConfig {
  const token = (opts?.token || process.env.PGROAST_LOCAL_TOKEN || randomBytes(24).toString("hex")).trim();
  const requireAuth = opts?.requireAuth ?? process.env.PGROAST_DISABLE_LOCAL_AUTH !== "1";
  const strictUrlTokenOnly = process.env.PGROAST_REQUIRE_URL_TOKEN === "1";
  return { token, requireAuth, strictUrlTokenOnly };
}

function safeTokenEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Mythos Localhost Security Gate:
 * 1. Exact Host header allowlist (blocks DNS rebinding).
 * 2. Rejects any foreign or `null` Origin header on /api/* (blocks CSRF & downloaded `file://` briefs).
 * 3. Sends ZERO CORS headers.
 * 4. Requires per-boot Bearer token on all /api/* calls (or ?token= for SSE EventSource).
 */
export function checkLocalhostSecurity(
  req: Request,
  activePort: number,
  sec: LocalSecurityConfig,
): { ok: true } | { ok: false; status: number; error: string } {
  const url = new URL(req.url);
  const path = url.pathname;

  // 1. Exact Host header allowlist (blocks DNS rebinding)
  const rawHost = (req.headers.get("host") || url.host || "").trim().toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${activePort}`,
    `localhost:${activePort}`,
    "127.0.0.1",
    "localhost",
    `[::1]:${activePort}`,
  ]);
  if (rawHost && !allowedHosts.has(rawHost)) {
    return {
      ok: false,
      status: 403,
      error: `Rejected Host header "${rawHost}" (DNS rebinding protection — only 127.0.0.1:${activePort} allowed).`,
    };
  }

  // 2. Reject foreign or null Origin headers (blocks CSRF & file:// downloaded HTML briefs)
  const origin = req.headers.get("origin");
  if (origin !== null) {
    const cleanOrigin = origin.trim().toLowerCase();
    const allowedOrigins = new Set([
      `http://127.0.0.1:${activePort}`,
      `http://localhost:${activePort}`,
      "http://127.0.0.1",
      "http://localhost",
    ]);
    if (cleanOrigin === "null" || !allowedOrigins.has(cleanOrigin)) {
      return {
        ok: false,
        status: 403,
        error: `Rejected cross-origin request from Origin "${origin}". pgroast-app accepts same-origin localhost requests only.`,
      };
    }
  }

  // 3. Per-boot Bearer token check on /api/* routes
  if (sec.requireAuth && path.startsWith("/api/")) {
    const authHeader = (req.headers.get("authorization") || "").trim();
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const queryToken = url.searchParams.get("token") || "";
    const candidate = bearer || (path.endsWith("/stream") ? queryToken : "");
    if (!candidate || !safeTokenEquals(candidate, sec.token)) {
      return {
        ok: false,
        status: 401,
        error: "Missing or invalid localhost session token. Reload http://127.0.0.1:" + activePort + " to refresh your session.",
      };
    }
  }

  return { ok: true };
}

export function localSecurityHeaders(kind: "html" | "asset" | "json"): Record<string, string> {
  if (kind === "json") {
    return {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    };
  }
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com https://lh3.googleusercontent.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}
