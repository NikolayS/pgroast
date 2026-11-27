// `pgroast doctor`: which CLIs are installed, their versions, and whether a trivial completion
// works on each with the subscription login. No API key is read or needed anywhere.

import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  API_KEY_VARS,
  CLI_BACKENDS,
  CliBackend,
  agyDriver,
  childEnv,
  claudeDriver,
  codexDriver,
  modelsFromEnv,
  onPath,
  runCli,
  type SingleBackendName,
} from "./llm.ts";
import type { JsonSchema } from "./schema.ts";
import { detectLocalPgRepo } from "./verify.ts";
import { DEFAULT_HUB_URL, resolvePublishToken } from "../publish.ts";

export interface DoctorResult {
  backend: SingleBackendName;
  found: boolean;
  path: string | null;
  version: string | null;
  model: string;
  completion: "ok" | "failed" | "skipped";
  error: string | null;
  hint: string | null;
  wallMs: number;
}

const PING_SCHEMA: JsonSchema = { type: "object", properties: { ok: { type: "boolean" } } };

export async function checkBackend(name: SingleBackendName, opts: { skipCompletion?: boolean } = {}): Promise<DoctorResult> {
  const cwd = mkdtempSync(join(tmpdir(), "pgroast-doctor-"));
  const driver = name === "codex" ? codexDriver(cwd) : name === "agy" ? agyDriver(cwd) : claudeDriver();
  const path = onPath(driver.bin);
  const res: DoctorResult = { backend: name, found: !!path, path, version: null, model: "", completion: "skipped", error: null, hint: null, wallMs: 0 };
  if (!path) {
    res.hint =
      name === "claude"
        ? "install Claude Code, then run `claude` and sign in"
        : name === "codex"
          ? "install Codex CLI, then run `codex login`"
          : "install Antigravity CLI (`agy`), then sign in";
    return res;
  }
  try {
    const v = await runCli(driver.bin, ["--version"], "", cwd, 20_000, driver.env ? driver.env() : childEnv());
    res.version = v.stdout.trim().split("\n")[0] || null;
  } catch (e) {
    res.error = `--version failed: ${(e as Error).message}`;
  }
  let model: string;
  try {
    model = modelsFromEnv(process.env, name).roaster;
  } catch (e) {
    res.completion = "failed";
    res.error = (e as Error).message;
    return res;
  }
  res.model = model;
  if (opts.skipCompletion) return res;

  const t0 = Date.now();
  try {
    const backend = new CliBackend({ backend: name, transcriptDir: join(cwd, "llm"), timeoutMs: 120_000, log: () => undefined });
    const out = await backend.complete<{ ok: boolean }>({
      label: "doctor",
      model,
      system: "You are a JSON emitter. Reply with one JSON object and nothing else.",
      prompt: 'Reply with exactly {"ok":true}',
      schema: PING_SCHEMA,
    });
    res.completion = out.ok === true ? "ok" : "failed";
    if (out.ok !== true) res.error = "unexpected reply";
  } catch (e) {
    res.completion = "failed";
    res.error = (e as Error).message.replace(/\s+/g, " ").slice(0, 600);
    res.hint = `if you are not signed in: ${driver.loginHint}`;
  }
  res.wallMs = Date.now() - t0;
  return res;
}

export function renderDoctor(results: DoctorResult[], env: Record<string, string | undefined> = process.env): string {
  const lines: string[] = ["pgroast doctor", ""];
  for (const r of results) {
    lines.push(`${r.backend}:`);
    if (!r.found) {
      lines.push("  CLI: not found on PATH", `  -> ${r.hint}`, "");
      continue;
    }
    lines.push(`  CLI: ${r.path}`);
    lines.push(`  version: ${r.version ?? "unknown"}`);
    lines.push(`  model: ${r.model || "?"}`);
    lines.push(
      r.completion === "ok"
        ? `  completion: ok (${Math.round(r.wallMs / 1000)} s; tools off, subscription login)`
        : r.completion === "skipped"
          ? "  completion: not tested"
          : `  completion: FAILED: ${r.error}`,
    );
    if (r.completion === "failed" && r.hint) lines.push(`  -> ${r.hint}`);
    lines.push("");
  }
  const home = env.HOME || homedir();
  const autoDir = !env.CLAUDE_CONFIG_DIR && existsSync(join(home, ".claude", ".claude.json")) ? join(home, ".claude") : null;
  lines.push(
    `Claude Code login in use: ${
      env.CLAUDE_CONFIG_DIR
        ? `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`
        : autoDir
          ? `auto-detected CLAUDE_CONFIG_DIR=${autoDir} (~/.claude/.claude.json found)`
          : "the default one (CLAUDE_CONFIG_DIR is not set)"
    }. Each config directory has its own login.`,
  );
  const set = API_KEY_VARS.filter((k) => env[k]);
  lines.push(
    set.length
      ? `API key variables set in this shell (${set.join(", ")}): ignored. PG Roast removes them from the CLI's environment and uses the subscription login.`
      : "No API key variables are set; none are needed. PG Roast uses the CLI's subscription login.",
  );
  const usable: string[] = results.filter((r) => r.completion === "ok").map((r) => r.backend);
  if (usable.includes("claude") && usable.includes("agy")) {
    usable.push("dual (claude + agy cross-family)");
  }
  lines.push(usable.length ? `Usable backends: ${usable.join(", ")}.` : "No usable backend. Sign in to one of the CLIs and run `pgroast doctor` again.");

  // Medium / Dark build & live SQL verification readiness + publish token status
  const pgRepo = detectLocalPgRepo(env.PGROAST_PG_REPO);
  const tools = ["git", "meson", "ninja", "psql"].map((t) => `${t}:${onPath(t) ? "ok" : "missing"}`).join("  ");
  lines.push("");
  lines.push("Verification environment (Medium / Dark roasts):");
  lines.push(`  postgres.git: ${pgRepo ?? "not found (set PGROAST_PG_REPO or pass --pg-repo PATH for build/test/live SQL)"}`);
  lines.push(`  tools:        ${tools}`);

  const pub = resolvePublishToken();
  lines.push(
    pub.token
      ? `Publish login: configured (${pub.token.slice(0, 18)}… via ${pub.source} -> ${env.PGROAST_PUBLIC_HUB_URL || pub.hubUrl || DEFAULT_HUB_URL})`
      : "Publish login: not set (local roasting needs no login; run `pgroast login --token <tok>` to publish)",
  );
  return lines.join("\n");
}

export async function runDoctor(): Promise<{ text: string; ok: boolean }> {
  void childEnv; // the CLIs are always spawned through runCli, which strips API key variables
  const results: DoctorResult[] = [];
  for (const b of CLI_BACKENDS) results.push(await checkBackend(b));
  return { text: renderDoctor(results), ok: results.some((r) => r.completion === "ok") };
}
