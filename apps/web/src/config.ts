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
  allowDevTokenMint: boolean;
}

export function loadWebConfig(): WebConfig {
  const port = Number(process.env.PGROAST_WEB_PORT || process.env.PORT || 3433);
  const host = process.env.PGROAST_WEB_HOST || "127.0.0.1";
  const publicOrigin = (process.env.PGROAST_WEB_ORIGIN || `http://${host}:${port}`).replace(/\/$/, "");
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
    allowDevTokenMint:
      process.env.PGROAST_WEB_DEV_AUTH === "1" ||
      host === "127.0.0.1" ||
      host === "localhost",
  };
}
