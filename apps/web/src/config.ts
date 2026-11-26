import { dirname, resolve } from "node:path";

export const WEB_ROOT = resolve(dirname(import.meta.dir));

export interface WebConfig {
  port: number;
  host: string;
  publicOrigin: string;
  briefsOrigin: string;
  localWorkbenchUrl: string;
  databaseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  adminSecret: string;
  maxPublishBytes: number;
  rateLimitPerMinute: number;
  allowDevTokenMint: boolean;
  briefMaintainers: string[];
  allowedHosts: string[];
}

function parseCsvList(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadWebConfig(): WebConfig {
  const port = Number(process.env.PGROAST_WEB_PORT || process.env.PORT || 3433);
  const host = process.env.PGROAST_WEB_HOST || "127.0.0.1";
  const publicOrigin = (process.env.PGROAST_WEB_ORIGIN || `http://${host}:${port}`).replace(/\/$/, "");
  const isLoopbackOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(publicOrigin);

  const allowedSet = new Set<string>(["pgroast.dev", "www.pgroast.dev", "pgroast.postgres.ai"]);
  try {
    allowedSet.add(new URL(publicOrigin).host.toLowerCase());
  } catch {
    // ignore malformed origin
  }
  for (const h of parseCsvList(process.env.PGROAST_WEB_ALLOWED_HOSTS)) {
    allowedSet.add(h);
  }

  return {
    port,
    host,
    publicOrigin,
    briefsOrigin: (process.env.PGROAST_BRIEFS_ORIGIN || "").replace(/\/$/, ""),
    localWorkbenchUrl: (process.env.PGROAST_LOCAL_WORKBENCH_URL || "http://127.0.0.1:3432").replace(/\/$/, ""),
    databaseUrl:
      process.env.PGROAST_WEB_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgres://localhost:5432/pgroast_web",
    githubClientId: process.env.GITHUB_CLIENT_ID || "",
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    adminSecret: process.env.PGROAST_WEB_ADMIN_SECRET || "",
    maxPublishBytes: Math.max(65536, Number(process.env.PGROAST_WEB_MAX_PUBLISH_BYTES || 4 * 1024 * 1024)),
    rateLimitPerMinute: Math.max(5, Number(process.env.PGROAST_WEB_RATE_LIMIT_PER_MIN || 60)),
    allowDevTokenMint: process.env.PGROAST_WEB_DEV_AUTH === "1" && isLoopbackOrigin,
    briefMaintainers: parseCsvList(process.env.PGROAST_WEB_BRIEF_MAINTAINERS),
    allowedHosts: Array.from(allowedSet),
  };
}
