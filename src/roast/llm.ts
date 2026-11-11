// LLM backend. One entry point: backend.complete({system, prompt, model, schema, label}) -> parsed JSON.
//
// The real backend shells out to an installed CLI in headless mode: Claude Code (`claude -p`) or
// Codex (`codex exec`). Both run on the user's subscription login; API key variables are removed
// from the child's environment and are never read here.
//
// The model gets text in and returns text out, with every tool switched off; all retrieval is
// done by our code. That matters twice: links cannot come from a model-side search, and during
// evaluation the model cannot look up how a thread ended.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, type JsonSchema } from "./schema.ts";

export interface CompleteArgs {
  system: string;
  prompt: string;
  model: string;
  schema: JsonSchema;
  /** Short name for the transcript files, e.g. "roaster-security". */
  label: string;
}

export interface LlmBackend {
  readonly dryRun: boolean;
  complete<T>(args: CompleteArgs): Promise<T>;
  stats(): { calls: number; costUsd: number | null };
}

export type BackendName = "claude" | "codex";
export const BACKENDS: readonly BackendName[] = ["claude", "codex"];

export const DEFAULT_ROASTER_MODEL = "opus";
export const DEFAULT_CRITIC_MODEL = "claude-mythos-5-2";
/** Shown where a model name is needed and the Codex CLI's configured default is used. */
export const CODEX_DEFAULT = "codex-default";

/** Only Opus, Mythos and Fable (the same underlying model as Mythos) are allowed on the claude backend. */
export function assertAllowedModel(model: string): string {
  if (!/(opus|mythos|fable)/i.test(model) || /(sonnet|haiku)/i.test(model)) {
    throw new Error(`model "${model}" is not allowed: on the claude backend PG Roast runs on Opus, Mythos or Fable only`);
  }
  return model;
}

export interface Models {
  roaster: string;
  critic: string;
  synth: string;
  brief: string;
}

type Env = Record<string, string | undefined>;

/**
 * claude: PGROAST_ROASTER_MODEL / PGROAST_CRITIC_MODEL, Opus, Mythos or Fable only.
 * codex: PGROAST_CODEX_MODEL for every stage, or the CLI's configured default. No names are guessed.
 */
export function modelsFromEnv(env: Env = process.env, backend: BackendName = "claude"): Models {
  if (backend === "codex") {
    const m = env.PGROAST_CODEX_MODEL?.trim() || CODEX_DEFAULT;
    return { roaster: m, critic: m, synth: m, brief: m };
  }
  const roaster = assertAllowedModel(env.PGROAST_ROASTER_MODEL || DEFAULT_ROASTER_MODEL);
  const critic = assertAllowedModel(env.PGROAST_CRITIC_MODEL || DEFAULT_CRITIC_MODEL);
  return { roaster, critic, synth: critic, brief: roaster };
}

/** Variables that would make a CLI bill an API key. The CLIs must use their subscription login. */
export const API_KEY_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"] as const;

/** The environment for a spawned CLI: the caller's, without any API key variable. */
export function childEnv(env: Env = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v != null && !(API_KEY_VARS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

export function onPath(bin: string): string | null {
  return Bun.which(bin);
}

/** --backend / PGROAST_BACKEND, else claude when installed, else codex. */
export function pickBackend(flag: string | undefined, env: Env = process.env, which: (b: string) => string | null = onPath): BackendName {
  const want = (flag ?? env.PGROAST_BACKEND ?? "").trim().toLowerCase();
  if (want) {
    if (!(BACKENDS as readonly string[]).includes(want)) throw new Error(`unknown backend "${want}": use claude or codex`);
    return want as BackendName;
  }
  if (which("claude")) return "claude";
  if (which("codex")) return "codex";
  throw new Error("neither the claude nor the codex CLI is on PATH: install Claude Code or Codex CLI and sign in (run `pgroast doctor`)");
}

// ---------------------------------------------------------------------------------------------
// JSON extraction

/** Pull the first complete top-level JSON object out of a model reply. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  for (let start = t.indexOf("{"); start >= 0; start = t.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(t.slice(start, i + 1));
          } catch {
            break; // try the next "{"
          }
        }
      }
    }
  }
  throw new Error("no JSON object found in the reply");
}

export function parseAndValidate<T>(text: string, schema: JsonSchema): { value?: T; errors: string[] } {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
  const errors = validate(value, schema);
  return errors.length ? { errors } : { value: value as T, errors: [] };
}

export function repairPrompt(prompt: string, badReply: string, errors: string[]): string {
  return [
    prompt,
    "",
    "---",
    "Your previous reply was rejected by the validator:",
    ...errors.slice(0, 20).map((e) => `- ${e}`),
    "",
    "Previous reply:",
    badReply.slice(0, 20000),
    "",
    "Return the corrected JSON object only. Keep the content; fix the format.",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Concurrency

export class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Transcript

export class Transcript {
  private n = 0;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  next(label: string): string {
    this.n++;
    return join(this.dir, `${String(this.n).padStart(2, "0")}-${label.replace(/[^A-Za-z0-9_.-]+/g, "_")}`);
  }
  write(base: string, suffix: string, content: string): void {
    writeFileSync(base + suffix, content);
  }
}

function promptFile(args: CompleteArgs): string {
  return `# model: ${args.model}\n# label: ${args.label}\n\n===== SYSTEM =====\n${args.system}\n\n===== PROMPT =====\n${args.prompt}\n`;
}

// ---------------------------------------------------------------------------------------------
// CLI backends: Claude Code (`claude -p`) and Codex (`codex exec`)

export interface RawReply {
  text: string;
  costUsd: number | null;
  model: string;
  durationMs: number;
  usage: unknown;
}

/** How to run one CLI: the command line, what goes to stdin, how to read the output. */
export interface CliDriver {
  name: BackendName;
  bin: string;
  checkModel(model: string): void;
  argv(args: CompleteArgs): string[];
  stdin(args: CompleteArgs, prompt: string): string;
  parse(stdout: string): RawReply;
  /** What to tell the user when a call fails because nobody is signed in. */
  loginHint: string;
}

/**
 * Claude Code keeps one login per config directory, and "CLAUDE_CONFIG_DIR not set" is a
 * different login from "CLAUDE_CONFIG_DIR=~/.claude". A shell alias that sets the variable for
 * interactive use therefore leaves a plain `claude -p` on another, possibly expired, login.
 */
export function claudeLoginHint(env: Env = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return (
    "run `claude` and sign in with your subscription (/login), then try again. " +
    (dir
      ? `This run used the login of CLAUDE_CONFIG_DIR=${dir}`
      : "CLAUDE_CONFIG_DIR is not set here, so the CLI's default login was used. If `claude` works for you interactively, check whether you start it through an alias that sets CLAUDE_CONFIG_DIR (`alias | grep claude`), and set the same value for pgroast, for example CLAUDE_CONFIG_DIR=~/.claude pgroast ...")
  );
}

/**
 * Flags that take every tool away from the model:
 *   --tools ""            no built-in tools
 *   --strict-mcp-config   no MCP servers (none are passed)
 *   --safe-mode           no CLAUDE.md, skills, plugins, hooks, custom agents
 *   --disable-slash-commands
 * The init event of the stream is then checked: if it lists any tool or MCP server, the call fails.
 */
export function claudeArgs(model: string, system: string): string[] {
  return [
    "-p",
    "--model",
    model,
    "--system-prompt",
    system,
    "--tools",
    "",
    "--strict-mcp-config",
    "--safe-mode",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

/** Read the stream-json output of `claude -p`. Throws when a tool is present or used. */
export function parseClaudeStream(stdout: string): RawReply {
  let text: string | null = null;
  let costUsd: number | null = null;
  let model = "";
  let durationMs = 0;
  let usage: unknown = null;
  let sawInit = false;
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init") {
      sawInit = true;
      const tools = (ev.tools as unknown[]) ?? [];
      const mcp = (ev.mcp_servers as unknown[]) ?? [];
      if (tools.length > 0 || mcp.length > 0) {
        throw new Error(
          `the model session has tools (${JSON.stringify(tools)}) or MCP servers (${JSON.stringify(mcp)}); refusing to use its output`,
        );
      }
      // The subscription login must be in use, never an API key.
      if (ev.apiKeySource != null && ev.apiKeySource !== "none") {
        throw new Error(`claude is using an API key (source: ${String(ev.apiKeySource)}); PG Roast runs on the subscription login only`);
      }
      model = String(ev.model ?? "");
    } else if (ev.type === "assistant") {
      const content = ((ev.message as Record<string, unknown> | undefined)?.content as { type?: string }[]) ?? [];
      if (content.some((c) => c.type === "tool_use" || c.type === "server_tool_use")) {
        throw new Error("the model tried to call a tool; refusing to use its output");
      }
    } else if (ev.type === "result") {
      if (ev.is_error) throw new Error(`claude returned an error: ${String(ev.result ?? ev.subtype ?? "unknown")}`);
      text = String(ev.result ?? "");
      costUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null;
      durationMs = typeof ev.duration_ms === "number" ? ev.duration_ms : 0;
      usage = ev.usage ?? null;
    }
  }
  if (!sawInit) throw new Error("no init event in the claude output; cannot confirm that tools are off");
  if (text == null) throw new Error("no result event in the claude output");
  if (model && !/(opus|mythos|fable)/i.test(model)) throw new Error(`claude answered with model "${model}", which is not allowed`);
  return { text, costUsd, model, durationMs, usage };
}

export function claudeDriver(bin = process.env.PGROAST_CLAUDE_BIN ?? "claude"): CliDriver {
  return {
    name: "claude",
    bin,
    checkModel: (m) => void assertAllowedModel(m),
    argv: (a) => claudeArgs(a.model, a.system),
    stdin: (_a, prompt) => prompt,
    parse: parseClaudeStream,
    get loginHint() {
      return claudeLoginHint();
    },
  };
}

/** Codex features that give the model a way to act or look things up. All are switched off. */
export const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "browser_use",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "tool_suggest",
  "skill_search",
  "memories",
] as const;

/**
 * `codex exec` has no single "no tools" switch, so several layers are used:
 *   --disable <feature>    shell, apps, plugins, browser, computer use, ... off
 *   -c web_search="disabled"
 *   --ignore-user-config   no user MCP servers or profiles (the login is still used)
 *   --ignore-rules, --ephemeral, --skip-git-repo-check
 *   -s read-only           and an empty working directory: nothing to read, no network, no writes
 * and then the event stream is checked: any item that is not a message or reasoning fails the call.
 */
export function codexArgs(model: string, cwd: string): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-s",
    "read-only",
    "-C",
    cwd,
    "-c",
    'web_search="disabled"',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ["--disable", f]),
    ...(model && model !== CODEX_DEFAULT ? ["-m", model] : []),
    "-", // the prompt comes from stdin
  ];
}

const CODEX_TEXT_ITEMS = new Set(["agent_message", "reasoning"]);

/** Read the JSONL events of `codex exec --json`. Throws when the model used any tool. */
export function parseCodexStream(stdout: string): RawReply {
  let text: string | null = null;
  let usage: unknown = null;
  let model = "";
  let sawEvent = false;
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    sawEvent = true;
    const type = String(ev.type ?? "");
    if (typeof ev.model === "string") model = ev.model;
    if (type.startsWith("item.")) {
      const item = (ev.item ?? {}) as Record<string, unknown>;
      const kind = String(item.type ?? item.item_type ?? "");
      if (kind === "error") throw new Error(`codex reported an error: ${String(item.message ?? "unknown")}`);
      if (!CODEX_TEXT_ITEMS.has(kind)) {
        throw new Error(`the model used a tool (${kind || "unknown item"}); refusing to use its output`);
      }
      if (kind === "agent_message" && type === "item.completed") text = String(item.text ?? "");
    } else if (type === "turn.failed" || type === "error") {
      const err = (ev.error ?? ev) as Record<string, unknown>;
      throw new Error(`codex failed: ${String(err.message ?? JSON.stringify(ev)).slice(0, 500)}`);
    } else if (type === "turn.completed") {
      usage = ev.usage ?? null;
    }
  }
  if (!sawEvent) throw new Error("no events in the codex output; cannot confirm that no tool was used");
  if (text == null) throw new Error("no final message in the codex output");
  return { text, costUsd: null, model: model || CODEX_DEFAULT, durationMs: 0, usage };
}

export function codexDriver(cwd: string, bin = process.env.PGROAST_CODEX_BIN ?? "codex"): CliDriver {
  return {
    name: "codex",
    bin,
    checkModel: () => undefined,
    argv: (a) => codexArgs(a.model, cwd),
    // codex exec has no system-prompt flag: the instructions lead the prompt.
    stdin: (a, prompt) =>
      `${a.system}\n\n---\n\nYou have no tools in this task and need none: do not run commands, read files or search. Answer from the text below only.\n\n${prompt}`,
    parse: parseCodexStream,
    loginHint: "run `codex login` and sign in with your ChatGPT subscription, then try again",
  };
}

export interface CliBackendOptions {
  backend?: BackendName;
  transcriptDir: string;
  concurrency?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
  /** Injected for tests: replaces the process spawn. */
  runner?: (args: CompleteArgs, prompt: string) => Promise<RawReply>;
}

/** Run a CLI once: argv, stdin in, stdout out. API key variables are removed from its environment. */
export function runCli(bin: string, argv: string[], stdin: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { cwd, stdio: ["pipe", "pipe", "pipe"], env: childEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
}

export class CliBackend implements LlmBackend {
  readonly dryRun = false;
  readonly driver: CliDriver;
  private calls = 0;
  private cost = 0;
  private costKnown = true;
  private readonly sem: Semaphore;
  private readonly transcript: Transcript;
  private readonly cwd: string;

  constructor(private readonly opts: CliBackendOptions) {
    this.sem = new Semaphore(opts.concurrency ?? Number(process.env.PGROAST_CONCURRENCY || 3));
    this.transcript = new Transcript(opts.transcriptDir);
    // An empty directory: nothing for a session to pick up, even if a tool slipped through.
    this.cwd = mkdtempSync(join(tmpdir(), "pgroast-llm-"));
    this.driver = (opts.backend ?? "claude") === "codex" ? codexDriver(this.cwd) : claudeDriver();
  }

  stats() {
    return { calls: this.calls, costUsd: this.costKnown ? this.cost : null };
  }

  private async runOnce(args: CompleteArgs, prompt: string): Promise<RawReply> {
    if (this.opts.runner) return this.opts.runner(args, prompt);
    const timeoutMs = this.opts.timeoutMs ?? Number(process.env.PGROAST_LLM_TIMEOUT_MS || 900_000);
    const d = this.driver;
    const r = await runCli(d.bin, d.argv(args), d.stdin(args, prompt), this.cwd, timeoutMs);
    try {
      return d.parse(r.stdout);
    } catch (e) {
      const detail = `${r.stdout.slice(-300)} ${r.stderr.slice(-500)}`;
      const login = /log ?in|sign ?in|auth|unauthori[sz]ed|401|credential/i.test(detail + (e as Error).message) ? ` Not signed in? ${d.loginHint}.` : "";
      throw new Error(`${(e as Error).message} (${d.name} exit ${r.code}; stderr: ${r.stderr.trim().slice(-400)})${login}`);
    }
  }

  async complete<T>(args: CompleteArgs): Promise<T> {
    this.driver.checkModel(args.model);
    return this.sem.run(async () => {
      const log = this.opts.log ?? ((m: string) => console.error(m));
      let prompt = args.prompt;
      let lastErrors: string[] = [];
      // One call, plus one repair retry when the reply is not valid JSON for the schema.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const base = this.transcript.next(attempt === 1 ? args.label : `${args.label}-repair`);
        this.transcript.write(base, ".prompt.txt", promptFile({ ...args, prompt }));
        const t0 = Date.now();
        this.calls++;
        let reply: RawReply;
        try {
          reply = await this.runOnce(args, prompt);
        } catch (e) {
          this.transcript.write(base, ".error.txt", String((e as Error).message));
          throw e;
        }
        if (reply.costUsd == null) this.costKnown = false;
        else this.cost += reply.costUsd;
        this.transcript.write(base, ".response.txt", reply.text);
        const parsed = parseAndValidate<T>(reply.text, args.schema);
        this.transcript.write(
          base,
          ".meta.json",
          JSON.stringify(
            {
              label: args.label,
              attempt,
              backend: this.driver.name,
              requested_model: args.model,
              model: reply.model,
              wall_ms: Date.now() - t0,
              cost_usd: reply.costUsd,
              usage: reply.usage,
              validation_errors: parsed.errors,
            },
            null,
            1,
          ),
        );
        log(`  llm ${args.label}${attempt > 1 ? " (repair)" : ""}: ${reply.model}, ${Math.round((Date.now() - t0) / 1000)} s${parsed.errors.length ? `, INVALID: ${parsed.errors[0]}` : ""}`);
        if (parsed.value !== undefined) return parsed.value;
        lastErrors = parsed.errors;
        prompt = repairPrompt(args.prompt, reply.text, parsed.errors);
      }
      throw new Error(`"${args.label}": reply still invalid after one repair retry: ${lastErrors.slice(0, 5).join("; ")}`);
    });
  }
}

/** Kept as a name for the default backend. */
export class ClaudeCliBackend extends CliBackend {
  constructor(opts: Omit<CliBackendOptions, "backend">) {
    super({ ...opts, backend: "claude" });
  }
}

// ---------------------------------------------------------------------------------------------
// Dry run: print the prompts, call nothing, return a stub that fits the schema.

export function stubFor(schema: JsonSchema): unknown {
  if (schema.nullable) return null;
  switch (schema.type) {
    case "string":
      return schema.enum ? schema.enum[0] : "(dry run)";
    case "integer":
    case "number":
      return schema.minimum ?? 0;
    case "boolean":
      return false;
    case "array":
      return Array.from({ length: schema.minItems ?? 0 }, () => stubFor(schema.items));
    case "object":
      return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, stubFor(v)]));
  }
}

export class DryRunBackend implements LlmBackend {
  readonly dryRun = true;
  private calls = 0;
  private readonly transcript: Transcript | null;
  constructor(
    private readonly opts: { transcriptDir?: string; print?: (s: string) => void; stubs?: Record<string, unknown> } = {},
  ) {
    this.transcript = opts.transcriptDir ? new Transcript(opts.transcriptDir) : null;
  }
  stats() {
    return { calls: this.calls, costUsd: 0 };
  }
  async complete<T>(args: CompleteArgs): Promise<T> {
    this.calls++;
    const text = promptFile(args);
    if (this.transcript) this.transcript.write(this.transcript.next(args.label), ".prompt.txt", text);
    (this.opts.print ?? ((s: string) => console.log(s)))(
      `\n######## DRY RUN: ${args.label} (model ${args.model}; ${text.length} chars; not sent) ########\n${text}`,
    );
    return (this.opts.stubs?.[args.label] ?? stubFor(args.schema)) as T;
  }
}
