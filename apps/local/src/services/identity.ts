import { spawnSync } from "node:child_process";
import { buildChildEnv } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import type { AppSettings, ContributorIdentity } from "../types.ts";

export function getCurrentContributor(settings: AppSettings): ContributorIdentity {
  const handle = (settings.authHandle || settings.cfUsername || settings.gmailAccount || "").trim();
  const name = (settings.authName || settings.authorName || handle || "Local reviewer").trim();
  const provider: ContributorIdentity["provider"] =
    settings.authProvider === "github" || settings.authProvider === "google"
      ? settings.authProvider
      : "local";
  return {
    provider,
    handle,
    name,
    avatarUrl: settings.authAvatarUrl || "",
    signedIn: provider !== "local" && Boolean(handle),
  };
}

export async function connectGitHubIdentity(
  db: AppDatabase,
  settings: AppSettings,
): Promise<{ identity: ContributorIdentity; settings: AppSettings }> {
  const env = buildChildEnv(settings);
  const res = spawnSync("gh", ["api", "user"], { encoding: "utf8", env, timeout: 15_000 });
  if (res.status !== 0) {
    const errText = (res.stderr || res.stdout || "").trim();
    throw new Error(
      `GitHub CLI (gh) is not signed in. Run \`gh auth login\` in your terminal, then click Connect GitHub again.${errText ? ` (${errText.slice(0, 140)})` : ""}`,
    );
  }
  const parsed = JSON.parse(res.stdout || "{}") as {
    login?: string;
    name?: string;
    avatar_url?: string;
  };
  const login = (parsed.login || "").trim();
  if (!login) throw new Error("Could not read GitHub login from `gh api user`.");

  const patch: Partial<AppSettings> = {
    authProvider: "github",
    authHandle: login,
    authName: (parsed.name || login).trim(),
    authAvatarUrl: parsed.avatar_url || "",
  };
  if (!settings.authorName.trim()) {
    patch.authorName = (parsed.name || login).trim();
  }
  if (!settings.githubFork.trim()) {
    patch.githubFork = `${login}/postgres`;
  }
  const updated = await db.updateSettings(patch);
  await db.logAudit("auth_github_connect", login, { name: patch.authName });
  return { identity: getCurrentContributor(updated), settings: updated };
}

export async function connectGoogleIdentity(
  db: AppDatabase,
  settings: AppSettings,
): Promise<{ identity: ContributorIdentity; settings: AppSettings }> {
  const env = buildChildEnv(settings);
  const res = spawnSync(
    "gws",
    ["gmail", "users", "getProfile", "--params", JSON.stringify({ userId: "me" })],
    { encoding: "utf8", env, timeout: 15_000 },
  );
  if (res.status !== 0) {
    const errText = (res.stderr || res.stdout || "").trim();
    throw new Error(
      `Google Workspace CLI (gws) is not signed in. Run \`gws auth login --scopes gmail.modify\` in your terminal, then click Connect Google again.${errText ? ` (${errText.slice(0, 140)})` : ""}`,
    );
  }
  const raw = (res.stdout || "").trim();
  const jsonStart = raw.indexOf("{");
  const parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : "{}") as {
    emailAddress?: string;
  };
  const email = (parsed.emailAddress || "").trim();
  if (!email) throw new Error("Could not read Google email address from `gws gmail users getProfile`.");

  const displayName = settings.authorName.trim() || email.split("@")[0] || email;
  const patch: Partial<AppSettings> = {
    authProvider: "google",
    authHandle: email,
    authName: displayName,
    authAvatarUrl: "",
  };
  if (!settings.gmailAccount.trim()) {
    patch.gmailAccount = email;
  }
  if (!settings.authorName.trim()) {
    patch.authorName = displayName;
  }
  const updated = await db.updateSettings(patch);
  await db.logAudit("auth_google_connect", email, { name: displayName });
  return { identity: getCurrentContributor(updated), settings: updated };
}

export async function disconnectIdentity(db: AppDatabase): Promise<{ identity: ContributorIdentity; settings: AppSettings }> {
  const updated = await db.updateSettings({
    authProvider: "",
    authHandle: "",
    authName: "",
    authAvatarUrl: "",
  });
  await db.logAudit("auth_disconnect", "identity", {});
  return { identity: getCurrentContributor(updated), settings: updated };
}
