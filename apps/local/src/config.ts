import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AppSettings } from "./types.ts";

export const APP_ROOT = resolve(dirname(import.meta.dir));
export const DATA_DIR = resolve(process.env.PGROAST_APP_DATA_DIR || join(APP_ROOT, "data"));
export const DEFAULT_DATABASE_URL =
  process.env.PGROAST_DATABASE_URL || process.env.DATABASE_URL || "postgres://localhost:5432/pgroast_app";
export const LEGACY_SQLITE_PATH = resolve(process.env.PGROAST_APP_DB_PATH || join(DATA_DIR, "pgroast-app.sqlite"));
export const LOGS_DIR = join(DATA_DIR, "logs");
export const SECRET_KEY_PATH = join(DATA_DIR, ".secret.key");

export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function detectClaudeConfigDir(): string {
  if (process.env.CLAUDE_CONFIG_DIR) return expandHome(process.env.CLAUDE_CONFIG_DIR);
  return join(homedir(), ".claude");
}

function detectPgroastRepo(): string {
  if (process.env.PGROAST_REPO) return expandHome(process.env.PGROAST_REPO);
  const monorepoRoot = resolve(APP_ROOT, "..", "..");
  if (existsSync(join(monorepoRoot, "src", "cli.ts"))) return monorepoRoot;
  const sibling = resolve(APP_ROOT, "..", "pgroast");
  if (existsSync(join(sibling, "src", "cli.ts"))) return sibling;
  const homeCandidate = join(homedir(), "pgroast");
  if (existsSync(join(homeCandidate, "src", "cli.ts"))) return homeCandidate;
  return monorepoRoot;
}

function detectPostgresRepo(): string {
  if (process.env.PGROAST_POSTGRES_REPO) return expandHome(process.env.PGROAST_POSTGRES_REPO);
  const candidates = [
    join(homedir(), "postgres"),
    join(homedir(), "github", "postgres"),
    join(homedir(), "work", "postgres"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, ".git"))) return c;
  }
  return "";
}

export function getDefaultSettings(): AppSettings {
  return {
    port: Number(process.env.PGROAST_APP_PORT || 3432),
    host: "127.0.0.1",
    authorName: process.env.PGROAST_AUTHOR_NAME || "",
    pgroastRepo: detectPgroastRepo(),
    roastDataDir: process.env.PGROAST_DATA_DIR ? expandHome(process.env.PGROAST_DATA_DIR) : "",
    postgresRepo: detectPostgresRepo(),
    worktreesRoot: expandHome(
      process.env.PGROAST_WORKTREES_ROOT || join(DATA_DIR, "worktrees"),
    ),
    // Empty = use built-in basic skills; set to a local directory to override/extend with custom skills
    skillsRepo: process.env.PGROAST_SKILLS_REPO ? expandHome(process.env.PGROAST_SKILLS_REPO) : "",
    githubFork: process.env.PGROAST_GITHUB_FORK || "",
    gmailAccount: process.env.PGROAST_GMAIL_ACCOUNT || "",
    cfUsername: process.env.PGROAST_CF_USERNAME || "",
    hetznerSshHost: process.env.PGROAST_HETZNER_SSH_HOST || "",
    hetznerRemoteRepo: process.env.PGROAST_HETZNER_REMOTE_REPO || "~/postgres",
    claudeConfigDir: detectClaudeConfigDir(),
    defaultBackend: "auto",
    defaultClaudeModel: "opus",
    defaultAgyModel: "gemini-4-neon-high",
    interestedTopics: "",
    publicHubUrl: process.env.PGROAST_PUBLIC_HUB_URL || "https://pgroast.postgres.ai",
    authProvider: "",
    authHandle: "",
    authName: "",
    authAvatarUrl: "",
    onboardingCompleted: false,
  };
}

export function ensureDataDirs(settings?: AppSettings): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  if (settings?.worktreesRoot) {
    mkdirSync(expandHome(settings.worktreesRoot), { recursive: true });
  }
}

export function buildChildEnv(
  settings: AppSettings,
  options?: { stripApiKeys?: boolean; extra?: Record<string, string> },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }

  const home = homedir();
  const extraPaths = [
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
  ];
  const currentPath = env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
  const merged = [...extraPaths, ...currentPath.split(":")].filter(Boolean);
  env.PATH = Array.from(new Set(merged)).join(":");

  const claudeDir = expandHome(settings.claudeConfigDir);
  if (claudeDir && !env.CLAUDE_CONFIG_DIR) {
    env.CLAUDE_CONFIG_DIR = claudeDir;
  }

  if (options?.stripApiKeys) {
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.GEMINI_API_KEY;
    delete env.GOOGLE_API_KEY;
  }

  if (options?.extra) {
    Object.assign(env, options.extra);
  }
  return env;
}

function getOrCreateSecretKey(keyPath = SECRET_KEY_PATH): Buffer {
  mkdirSync(dirname(keyPath), { recursive: true });
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, "utf8").trim();
    const buf = Buffer.from(raw, "hex");
    if (buf.length === 32) return buf;
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("hex") + "\n", { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Ignore on filesystems that don't support chmod
  }
  return key;
}

export function encryptSecret(plaintext: string, keyPath = SECRET_KEY_PATH): string {
  if (!plaintext) return "";
  const key = getOrCreateSecretKey(keyPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(ciphertext: string, keyPath = SECRET_KEY_PATH): string {
  if (!ciphertext) return "";
  if (!ciphertext.startsWith("v1:")) return "";
  const parts = ciphertext.split(":");
  if (parts.length !== 4) return "";
  const [, ivHex, tagHex, dataHex] = parts;
  if (!ivHex || !tagHex || !dataHex) return "";
  try {
    const key = getOrCreateSecretKey(keyPath);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}
