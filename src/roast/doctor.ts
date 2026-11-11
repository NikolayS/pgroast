// `pgroast doctor`: which CLIs are installed, their versions, and whether a trivial completion
// works on each with the subscription login. No API key is read or needed anywhere.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_KEY_VARS, BACKENDS, CliBackend, childEnv, claudeDriver, codexDriver, modelsFromEnv, onPath, runCli, type BackendName } from "./llm.ts";
import type { JsonSchema } from "./schema.ts";

export interface DoctorResult {
  backend: BackendName;
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

export async function checkBackend(name: BackendName, opts: { skipCompletion?: boolean } = {}): Promise<DoctorResult> {
  const cwd = mkdtempSync(join(tmpdir(), "pgroast-doctor-"));
  const driver = name === "codex" ? codexDriver(cwd) : claudeDriver();
  const path = onPath(driver.bin);
  const res: DoctorResult = { backend: name, found: !!path, path, version: null, model: "", completion: "skipped", error: null, hint: null, wallMs: 0 };
  if (!path) {
    res.hint = name === "claude" ? "install Claude Code, then run `claude` and sign in" : "install Codex CLI, then run `codex login`";
    return res;
  }
  try {
    const v = await runCli(driver.bin, ["--version"], "", cwd, 20_000);
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
  lines.push(`Claude Code login in use: ${env.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}` : "the default one (CLAUDE_CONFIG_DIR is not set)"}. Each config directory has its own login.`);
  const set = API_KEY_VARS.filter((k) => env[k]);
  lines.push(
    set.length
      ? `API key variables set in this shell (${set.join(", ")}): ignored. PG Roast removes them from the CLI's environment and uses the subscription login.`
      : "No API key variables are set; none are needed. PG Roast uses the CLI's subscription login.",
  );
  const usable = results.filter((r) => r.completion === "ok").map((r) => r.backend);
  lines.push(usable.length ? `Usable backends: ${usable.join(", ")}.` : "No usable backend. Sign in to one of the CLIs and run `pgroast doctor` again.");
  return lines.join("\n");
}

export async function runDoctor(): Promise<{ text: string; ok: boolean }> {
  void childEnv; // the CLIs are always spawned through runCli, which strips API key variables
  const results: DoctorResult[] = [];
  for (const b of BACKENDS) results.push(await checkBackend(b));
  return { text: renderDoctor(results), ok: results.some((r) => r.completion === "ok") };
}
