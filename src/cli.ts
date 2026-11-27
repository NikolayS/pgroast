#!/usr/bin/env bun
// pgroast <cf-id|cf-url|message-id|thread-url> [--blind N] [--before DATE] [--hint TEXT] [--out DIR]
//         [--backend claude|codex] [--rounds N] [--self] [--dry-run]
// pgroast --self --proposal FILE [--patch FILE ...]
// pgroast page <roast.json> [--out FILE] [--site DIR [--base-url URL]]
// pgroast pushback <cf-id|cf-url|thread-url> [--out DIR] [--backend claude|codex] [--dry-run] [--offline]
// pgroast doctor
//
// Writes roast.md, roast.json and roast-summary.txt to a local directory. It never posts
// anything anywhere.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_DSN, parseDsn } from "./corpus/db.ts";
import { renderPage, safeUrl, siteFiles } from "./roast/page.ts";
import type { Roast } from "./roast/schema.ts";
import { loadPushbackInput, pushbackSlug, renderPushbackMarkdown, runPushback } from "./roast/pushback.ts";
import { DEFAULT_OUT_ROOT, REPO_ROOT, stats as fetchStats } from "./thread/fetch.ts";
import { loadProposal, validateDate } from "./thread/load.ts";
import { loadLocalProposal } from "./thread/local.ts";
import { runDoctor } from "./roast/doctor.ts";
import {
  isValidRoastFlavour,
  isValidRoastLevel,
  normalizeRoastFlavour,
  normalizeRoastLevel,
  ROAST_FLAVOURS,
  ROAST_LEVELS,
  type RoastFlavour,
  type RoastLevel,
} from "./roast/flavours.ts";
import { BACKENDS, createBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName } from "./roast/llm.ts";
import { closePrecedents } from "./roast/precedents.ts";
import { runRoast, slugFor } from "./roast/pipeline.ts";
import { renderCompactMarkdown, renderMarkdown, renderSummary } from "./roast/render.ts";

export function getCliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function makeStyle(useColor: boolean) {
  const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    cyan: wrap("36"),
    green: wrap("32"),
    yellow: wrap("33"),
    red: wrap("31"),
  };
}

function colorVerdict(verdict: string, useColor: boolean): string {
  const s = makeStyle(useColor);
  if (verdict === "NO-FUNDAMENTAL-OBJECTION") return s.bold(s.green(verdict));
  if (verdict === "NEEDS-COMMITTER-EYES") return s.bold(s.cyan(verdict));
  if (verdict === "NEEDS-DESIGN-DISCUSSION") return s.bold(s.yellow(verdict));
  if (verdict === "LIKELY-REJECT") return s.bold(s.red(verdict));
  return s.bold(verdict);
}

export function renderUsage(useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR)): string {
  const s = makeStyle(useColor);
  const ver = getCliVersion();
  const cmd = (c: string) => s.cyan(c);
  const h = (t: string) => s.bold(t);
  const d = (t: string) => s.dim(t);

  return [
    `${s.bold("pgroast")} ${d(`v${ver}`)} — AI-assisted Postgres patch roasting: idea scrutiny, code diffs, builds, tests & live SQL stress`,
    "",
    h("Usage:"),
    `  ${cmd("pgroast")} <patch> [options]        Roast a CommitFest ID/URL, message-id, or thread URL`,
    `  ${cmd("pgroast")} <command> [options]      Run a subcommand`,
    "",
    h("Quick Start:"),
    `  ${cmd("pgroast doctor")}                                ${d("Check AI CLIs, Postgres repo, build tools & login")}`,
    `  ${cmd("pgroast 7388 --level light")}                    ${d("Idea & design scrutiny + 2,547 precedents (fast)")}`,
    `  ${cmd("pgroast 7388 --level medium")}                   ${d("+ C/H/SQL diffs, git apply, meson compile & tests")}`,
    `  ${cmd("pgroast 7388 --level dark")}                     ${d("+ isolated patched Postgres live SQL stress & reflection")}`,
    `  ${cmd("pgroast 7388 --level medium --publish")}         ${d("Roast locally, run privacy gate & publish to hub")}`,
    "",
    h("Commands:"),
    `  ${cmd("doctor")}                Check AI CLIs, Postgres repo, meson/ninja/psql, and publish token`,
    `  ${cmd("login")} / ${cmd("whoami")}        Save or inspect your publish-only token (~/.pgroast/auth.json)`,
    `  ${cmd("publish")} <path>        Run confidentiality gate and publish a sanitized roast`,
    `  ${cmd("contribute")} [flags]    Spend leftover weekly OAuth quota on open CommitFest patches`,
    `  ${cmd("batch")} <cf-num>        Roast open entries of a CommitFest in parallel (resumable)`,
    `  ${cmd("shortlist")} <dir>       Rank finished roasts into shortlist and top-reject lists`,
    `  ${cmd("pushback")} <patch>      Extract blocking objections from a long-stuck thread`,
    `  ${cmd("bugs")} [flags]          Triage recent pgsql-bugs (production hits vs synthetic hunts)`,
    `  ${cmd("page")} <roast.json>     Render a standalone HTML report locally (zero LLM calls)`,
    `  ${cmd("init-db")}               Create the local precedent database (2,547 historical rows)`,
    "",
    h("Options:"),
    `  ${cmd("--level L")}             light (idea), medium ${d("(default: +build/test)")}, dark (+live SQL stress)`,
    `  ${cmd("--flavour NAME")}        default ${d("(House Blend)")}, edge-case-hunter, spec-lawyer, systems-architect,`,
    `                        perf-hawk, storage-skeptic, index-specialist, production-dba`,
    `  ${cmd("--backend NAME")}        claude, codex, agy, or dual ${d("(default: PGROAST_BACKEND or auto)")}`,
    `  ${cmd("--model NAME")}          Override model ${d("(e.g. opus, gpt-6.2-astra, gemini-4-neon-high)")}`,
    `  ${cmd("--effort LEVEL")}        Reasoning effort for claude/codex ${d("(low, medium, high, xhigh, max)")}`,
    `  ${cmd("--pg-repo PATH")}        Local postgres.git path for Medium/Dark apply, build & tests`,
    `  ${cmd("--skip-verify")}         Skip local git apply / meson build / live SQL harness`,
    `  ${cmd("--publish")}             Publish sanitized roast to the Public App after finishing`,
    `  ${cmd("--hub URL")}             Target Public App URL for --publish`,
    `  ${cmd("--token TOK")}           Publish token override for --publish`,
    `  ${cmd("--out DIR")}             Output directory ${d("(default: out/<slug>)")}`,
    `  ${cmd("--self")}                Roast your own draft before posting ${d("(use with --proposal FILE)")}`,
    `  ${cmd("--proposal FILE")}       Draft email file on disk ${d("(with --self)")}`,
    `  ${cmd("--patch FILE")}          Patch file on disk ${d("(repeatable, with --proposal)")}`,
    `  ${cmd("--rounds N")}            Extra review rounds 0..6 ${d("(default: 0; dark defaults to 1)")}`,
    `  ${cmd("--blind N")}             Read only the first N messages of the thread`,
    `  ${cmd("--before DATE")}         Read only messages before YYYY-MM-DD ${d("(also precedent cutoff)")}`,
    `  ${cmd("--hint TEXT")}           Directed precedent lookup hint`,
    `  ${cmd("--no-enrich")}           Skip precedent thread reading and relevance filtering`,
    `  ${cmd("--dry-run")}             Build prompts locally without calling any model`,
    `  ${cmd("--offline")}             Use cached archive pages only`,
    `  ${cmd("-V, --version")}         Show pgroast version`,
    `  ${cmd("-h, --help")}            Show this help message`,
    "",
    d("Run 'pgroast <command> --help' for subcommand options."),
    d("All files stay local unless you pass '--publish' or run 'pgroast publish'."),
  ].join("\n");
}

export interface CliArgs {
  input: string;
  blind?: number;
  before?: string;
  hint?: string;
  out?: string;
  backend?: BackendName;
  model?: string;
  effort?: string;
  pgRepo?: string;
  skipVerify?: boolean;
  publish?: boolean;
  hubUrl?: string;
  token?: string;
  roastLevel?: RoastLevel;
  roastFlavour?: RoastFlavour;
  doctor?: boolean;
  initDb?: boolean;
  noEnrich?: boolean;
  self?: boolean;
  proposal?: string;
  patches?: string[];
  rounds?: number;
  page?: { json: string; out?: string; site?: string; baseUrl?: string };
  pushback?: boolean;
  dryRun: boolean;
  offline: boolean;
}

export function parseArgs(argv: string[]): CliArgs | "help" | "version" {
  const a: CliArgs = { input: "", dryRun: false, offline: false };
  if (argv[0] === "version") return "version";
  if (argv[0] === "page") return parsePageArgs(argv.slice(1));
  const rest = [...argv];
  if (rest[0] === "pushback") {
    rest.shift();
    a.pushback = true;
  }
  const value = (flag: string, inline: string | undefined): string => {
    const v = inline ?? rest.shift();
    if (v == null || v === "") throw new Error(`${flag} needs a value`);
    return v;
  };
  while (rest.length) {
    const tok = rest.shift()!;
    const eq = tok.startsWith("--") && tok.includes("=") ? tok.indexOf("=") : -1;
    const flag = eq > 0 ? tok.slice(0, eq) : tok;
    const inline = eq > 0 ? tok.slice(eq + 1) : undefined;
    switch (flag) {
      case "-h":
      case "--help":
        return "help";
      case "-v":
      case "-V":
      case "--version":
        return "version";
      case "--blind": {
        const n = Number(value(flag, inline));
        if (!Number.isInteger(n) || n < 1) throw new Error("--blind needs a positive integer");
        a.blind = n;
        break;
      }
      case "--before":
        a.before = validateDate(value(flag, inline));
        break;
      case "--hint":
        a.hint = value(flag, inline);
        break;
      case "--out":
        a.out = value(flag, inline);
        break;
      case "--backend": {
        const b = value(flag, inline).toLowerCase();
        if (!(BACKENDS as readonly string[]).includes(b)) {
          throw new Error("--backend must be claude, codex, agy, or dual");
        }
        a.backend = b as BackendName;
        break;
      }
      case "--model":
        a.model = value(flag, inline).trim();
        break;
      case "--effort":
        a.effort = value(flag, inline).trim().toLowerCase();
        break;
      case "--pg-repo":
        a.pgRepo = value(flag, inline);
        break;
      case "--skip-verify":
        a.skipVerify = true;
        break;
      case "--publish":
        a.publish = true;
        break;
      case "--hub":
        a.hubUrl = value(flag, inline);
        break;
      case "--token":
        a.token = value(flag, inline);
        break;
      case "--roast-level":
      case "--level": {
        const lv = value(flag, inline).toLowerCase();
        if (!isValidRoastLevel(lv)) {
          throw new Error(`--roast-level must be one of: ${ROAST_LEVELS.join(", ")}`);
        }
        a.roastLevel = normalizeRoastLevel(lv);
        break;
      }
      case "--flavour":
      case "--flavor": {
        const fl = value(flag, inline);
        if (!isValidRoastFlavour(fl)) {
          throw new Error(`--flavour must be one of: ${ROAST_FLAVOURS.join(", ")}`);
        }
        a.roastFlavour = normalizeRoastFlavour(fl);
        break;
      }
      case "--self":
        a.self = true;
        break;
      case "--proposal":
        a.proposal = value(flag, inline);
        break;
      case "--patch":
        (a.patches ??= []).push(value(flag, inline));
        break;
      case "--rounds": {
        const n = Number(value(flag, inline));
        if (!Number.isInteger(n) || n < 0 || n > 6) throw new Error("--rounds needs an integer from 0 to 6");
        a.rounds = n;
        break;
      }
      case "--no-enrich":
        a.noEnrich = true;
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--offline":
        a.offline = true;
        break;
      default:
        if (flag.startsWith("-") && flag !== "-") throw new Error(`unknown option ${flag}`);
        if (a.input) throw new Error(`unexpected argument "${tok}"`);
        a.input = tok;
    }
  }
  if (a.pushback) {
    if (!a.input) throw new Error("pushback needs a CommitFest patch id or URL, or a thread URL");
    for (const [k, name] of [["blind", "--blind"], ["before", "--before"], ["hint", "--hint"], ["self", "--self"], ["proposal", "--proposal"], ["rounds", "--rounds"], ["noEnrich", "--no-enrich"]] as const) {
      if (a[k] != null) throw new Error(`${name} does not apply to pushback (it reads the whole thread)`);
    }
    if (a.patches?.length) throw new Error("--patch does not apply to pushback");
    return a;
  }
  if (a.input === "doctor") a.doctor = true;
  if (a.input === "init-db") a.initDb = true;
  if (a.proposal) {
    if (!a.self) throw new Error("--proposal is for your own draft: use it with --self");
    if (a.input) throw new Error("give either a thread or --proposal FILE, not both");
    if (a.blind != null || a.before) throw new Error("--blind and --before do not apply to a draft on disk");
    return a;
  }
  if (a.patches?.length) throw new Error("--patch needs --self --proposal FILE");
  if (!a.input) throw new Error("missing input: a CommitFest patch id or URL, a message-id, or a thread URL (or --self --proposal FILE)");
  return a;
}

function parsePageArgs(argv: string[]): CliArgs | "help" {
  const page: NonNullable<CliArgs["page"]> = { json: "" };
  const rest = [...argv];
  while (rest.length) {
    const tok = rest.shift()!;
    const eq = tok.startsWith("--") && tok.includes("=") ? tok.indexOf("=") : -1;
    const flag = eq > 0 ? tok.slice(0, eq) : tok;
    const inline = eq > 0 ? tok.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? rest.shift();
      if (v == null || v === "") throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "-h" || flag === "--help") return "help";
    else if (flag === "--out") page.out = value();
    else if (flag === "--site") page.site = value();
    else if (flag === "--base-url") {
      const u = value();
      if (!safeUrl(u)) throw new Error("--base-url must be an http(s) URL");
      page.baseUrl = u;
    } else if (flag.startsWith("--")) throw new Error(`unknown option ${flag} for page`);
    else if (page.json) throw new Error(`unexpected argument "${tok}"`);
    else page.json = tok;
  }
  if (!page.json) throw new Error("page needs the path of a roast.json");
  if (page.out && page.site) throw new Error("give --out FILE or --site DIR, not both");
  if (page.baseUrl && !page.site) throw new Error("--base-url is for --site");
  return { input: "page", dryRun: false, offline: false, page };
}

/** `pgroast page`: roast.json -> static HTML. No model, no network, local files only. */
export function runPage(page: NonNullable<CliArgs["page"]>, log: (m: string) => void = () => undefined): string[] {
  let roast: Roast;
  try {
    roast = JSON.parse(readFileSync(page.json, "utf8")) as Roast;
  } catch (e) {
    throw new Error(`cannot read ${page.json}: ${(e as Error).message}`);
  }
  const missing = ["verdict", "objections", "other_surviving", "refuted", "withdrawn", "touch_points", "questions", "committability", "priority", "rounds", "invariants_loaded", "disclosure", "brief", "input"].filter(
    (k) => (roast as unknown as Record<string, unknown>)?.[k] == null,
  );
  if (missing.length) throw new Error(`${page.json} is not a roast.json of this version (missing: ${missing.join(", ")}); run the roast again`);
  const written: string[] = [];
  const write = (file: string, content: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(file);
    log(`wrote ${file}`);
  };
  if (page.site) {
    const dir = resolve(page.site);
    for (const f of siteFiles(roast, page.baseUrl)) write(join(dir, f.path), f.content);
  } else {
    write(resolve(page.out ?? join(dirname(page.json), "roast.html")), renderPage(roast));
  }
  return written;
}

/**
 * Create the precedent database and load the shipped index. Uses createdb, gunzip and psql with
 * the usual libpq environment (PGHOST, PGPORT, PGUSER); the database name is `pgroast`, or
 * the dbname of PGROAST_DSN.
 */
function initDb(): number {
  const dump = join(REPO_ROOT, "data", "precedents.sql.gz");
  if (!existsSync(dump)) {
    console.error(`pgroast: ${dump} is missing`);
    return 1;
  }
  const kv = parseDsn(process.env.PGROAST_DSN ?? DEFAULT_DSN);
  const db = kv.dbname ?? "pgroast";
  const env = {
    ...process.env,
    ...(kv.host ? { PGHOST: kv.host } : {}),
    ...(kv.port ? { PGPORT: kv.port } : {}),
    ...(kv.user ? { PGUSER: kv.user } : {}),
    ...(kv.password ? { PGPASSWORD: kv.password } : {}),
  };
  const run = (cmd: string, argv: string[], input?: Buffer) => spawnSync(cmd, argv, { env, input, encoding: "utf8", maxBuffer: 1 << 28 });
  const has = run("psql", ["-XAtq", "-d", db, "-c", "select to_regclass('public.precedent') is not null"]);
  if (has.error) {
    console.error("pgroast: psql was not found on PATH; install the Postgres client tools");
    return 1;
  }
  if (has.status === 0 && has.stdout.trim() === "t") {
    const n = run("psql", ["-XAtq", "-d", db, "-c", "select count(*) from precedent"]);
    console.log(`database "${db}" already holds the precedent index (${n.stdout.trim()} rows); nothing to do`);
    return 0;
  }
  if (has.status !== 0) {
    const c = run("createdb", [db]);
    if (c.status !== 0) {
      console.error(`pgroast: createdb ${db} failed: ${(c.stderr || c.error?.message || "").trim()}\nIs Postgres running? Set PGROAST_DSN (for example "dbname=pgroast host=localhost") if it is not on the local socket.`);
      return 1;
    }
    console.log(`created database "${db}"`);
  }
  const load = run("psql", ["-Xq", "-v", "ON_ERROR_STOP=1", "-d", db], gunzipSync(readFileSync(dump)));
  if (load.status !== 0) {
    console.error(`pgroast: loading the index failed: ${(load.stderr || "").trim().split("\n").slice(0, 5).join("\n")}`);
    return 1;
  }
  const n = run("psql", ["-XAtq", "-d", db, "-c", "select count(*) from precedent"]);
  console.log(`loaded the precedent index into "${db}": ${n.stdout.trim()} rows`);
  return 0;
}

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.log(renderUsage());
    return 0;
  }
  if (rawArgs[0] === "batch") return (await import("./batch.ts")).batchMain(rawArgs.slice(1));
  if (rawArgs[0] === "shortlist") return (await import("./shortlist.ts")).shortlistMain(rawArgs.slice(1));
  if (rawArgs[0] === "bugs") return (await import("./bugs.ts")).bugsMain(rawArgs.slice(1));
  if (rawArgs[0] === "publish") return (await import("./publish.ts")).publishMain(rawArgs.slice(1));
  if (rawArgs[0] === "login") return (await import("./publish.ts")).loginMain(rawArgs.slice(1), "login");
  if (rawArgs[0] === "whoami") return (await import("./publish.ts")).loginMain(rawArgs.slice(1), "whoami");
  if (rawArgs[0] === "contribute") return (await import("./contribute.ts")).contributeMain(rawArgs.slice(1));
  let args: CliArgs | "help" | "version";
  try {
    args = parseArgs(rawArgs);
  } catch (e) {
    console.error(`pgroast: ${(e as Error).message}`);
    console.error("Run 'pgroast --help' for usage.");
    return 2;
  }
  if (args === "version") {
    console.log(`pgroast ${getCliVersion()}`);
    return 0;
  }
  if (args === "help") {
    console.log(renderUsage());
    return 0;
  }
  if (args.page) {
    runPage(args.page, (m) => console.log(m));
    return 0;
  }
  if (args.initDb) return initDb();
  if (args.doctor) {
    const d = await runDoctor();
    console.log(d.text);
    return d.ok ? 0 : 1;
  }
  const t0 = Date.now();
  const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  const st = makeStyle(useColor);
  const log = (m: string) => console.log(m);
  const warn = (m: string) => console.error(m);
  const backendName: BackendName = args.dryRun ? (args.backend ?? "claude") : pickBackend(args.backend);
  const modelEnv: Record<string, string | undefined> = { ...process.env };
  if (args.model) {
    if (backendName === "codex") modelEnv.PGROAST_CODEX_MODEL = args.model;
    else if (backendName === "agy") {
      modelEnv.PGROAST_AGY_MODEL = args.model;
      modelEnv.PGROAST_AGY_CRITIC_MODEL = args.model;
    } else {
      modelEnv.PGROAST_ROASTER_MODEL = args.model;
      modelEnv.PGROAST_CRITIC_MODEL = args.model;
    }
  }
  if (args.effort) {
    modelEnv.PGROAST_CODEX_EFFORT = args.effort;
    modelEnv.PGROAST_CLAUDE_EFFORT = args.effort;
  } else if ((backendName === "claude" || backendName === "dual") && !modelEnv.PGROAST_CLAUDE_EFFORT) {
    modelEnv.PGROAST_CLAUDE_EFFORT = "high";
  }
  const models = modelsFromEnv(modelEnv, backendName);

  if (args.pushback) {
    log(`reading ${args.input} (whole thread) ...`);
    const input = await loadPushbackInput(args.input, { offline: args.offline, noAttachments: true });
    const outDir = resolve(args.out ?? join(DEFAULT_OUT_ROOT, pushbackSlug(input)));
    mkdirSync(outDir, { recursive: true });
    const transcriptDir = join(outDir, "llm");
    const backend = args.dryRun ? new DryRunBackend({ transcriptDir, print: () => undefined }) : createBackend(backendName, { transcriptDir, log });
    const result = await runPushback(input, { backend, models: { map: models.roaster, reduce: models.critic }, backendName: args.dryRun ? "dry-run" : backendName, log });
    result.stats.wall_ms = Date.now() - t0;
    writeFileSync(join(outDir, "pushback.json"), JSON.stringify(result, null, 2) + "\n");
    writeFileSync(join(outDir, "pushback.md"), renderPushbackMarkdown(result));
    log("");
    if (args.dryRun) log(`dry run: no model was called; prompts are in ${transcriptDir}`);
    else {
      log(`${st.bold("bucket:")} ${result.bucket}`);
      log(`${st.bold("objections:")} ${result.objections.length} (${result.objections.filter((o) => o.blocking).length} blocking), from ${result.candidates.length} candidates`);
      for (const w of result.warnings) warn(`warning: ${w}`);
    }
    log(`model calls: ${result.stats.llm_calls}; parts: ${result.stats.chunks}; wall time: ${Math.round(result.stats.wall_ms / 1000)} s`);
    log(`wrote ${join(outDir, "pushback.md")}`);
    log(`wrote ${join(outDir, "pushback.json")}`);
    return 0;
  }

  let publishAuth: { token: string; hubUrl: string } | null = null;
  if (args.publish && !args.dryRun) {
    const { ensurePublishAuth } = await import("./publish.ts");
    const auth = await ensurePublishAuth({
      hubUrl: args.hubUrl,
      explicitToken: args.token,
      log,
    });
    publishAuth = { token: auth.token, hubUrl: auth.hubUrl };
  }

  log(`reading ${args.proposal ?? args.input} ...`);
  const includeCode = (args.roastLevel ?? "medium") !== "light";
  const maxCodeChars = (args.roastLevel ?? "medium") === "dark" ? 85_000 : 55_000;
  const proposal = args.proposal
    ? loadLocalProposal(args.proposal, args.patches ?? [], new Date(), { includeCode, maxCodeChars })
    : await loadProposal(args.input, {
        blind: args.blind,
        before: args.before,
        offline: args.offline,
        includeCode,
        maxCodeChars,
      });
  log(
    args.proposal
      ? `draft: "${proposal.thread.subject}", ${proposal.patchProse.length} patch file(s) read`
      : `thread: "${proposal.thread.subject}", ${proposal.thread.messages.length} of ${proposal.totalMessages} messages, ${proposal.patchProse.length} patch file(s) read; fetched ${fetchStats.fetched}, cached ${fetchStats.cached}`,
  );

  const outDir = resolve(args.out ?? join(DEFAULT_OUT_ROOT, slugFor(proposal)));
  mkdirSync(outDir, { recursive: true });
  const transcriptDir = join(outDir, "llm");
  const backend = args.dryRun ? new DryRunBackend({ transcriptDir }) : createBackend(backendName, { transcriptDir, log });
  if (!args.dryRun) log(`backend: ${backendName} CLI (subscription login, no tools)`);

  const roast = await runRoast(proposal, {
    backend,
    models,
    backendName: args.dryRun ? "dry-run" : backendName,
    hint: args.hint ?? null,
    enrich: !args.noEnrich,
    mode: args.self ? "self" : "review",
    roastLevel: args.roastLevel,
    roastFlavour: args.roastFlavour,
    pgRepo: args.pgRepo,
    skipVerify: args.skipVerify,
    offline: args.offline,
    rounds: args.rounds,
    log,
  });
  await closePrecedents();
  roast.stats.wall_ms = Date.now() - t0;

  const summaryText = renderSummary(roast);
  writeFileSync(join(outDir, "roast.json"), JSON.stringify(roast, null, 2) + "\n");
  writeFileSync(join(outDir, "roast.md"), renderCompactMarkdown(roast));
  writeFileSync(join(outDir, "roast-full.md"), renderMarkdown(roast));
  writeFileSync(join(outDir, "roast-summary.txt"), summaryText);
  log("");
  log(`${st.bold(args.dryRun ? "DRY RUN, placeholder verdict:" : "verdict:")} ${colorVerdict(roast.verdict, useColor)} ${st.dim(`(confidence: ${roast.confidence})`)}`);
  log(`${st.bold("objections:")} ${roast.objections.length} listed, ${roast.other_surviving.length} more survived, ${roast.refuted.length} refuted; prior attempts: ${roast.prior_attempts.length}`);
  if (roast.verification?.evidenceBadges?.length) {
    log(`${st.bold("verification:")} ${roast.verification.evidenceBadges.join(" · ")}`);
  }
  for (const x of roast.rounds.slice(1)) log(`round ${x.round} (${x.kind}): ${x.llm_calls} calls, ${x.new_objections} new objection(s), ${x.new_survived} survived, ${x.revised} revised, ${x.withdrawn} withdrawn`);
  log(`LLM calls: ${roast.stats.llm_calls}; wall time: ${Math.round(roast.stats.wall_ms / 1000)} s`);
  if (!args.dryRun) for (const w of roast.warnings) warn(`warning: ${w}`);
  else log(`dry run: prompts are in ${transcriptDir}; roast.md and roast.json hold placeholders`);
  log(`wrote ${join(outDir, "roast.md")} (short report; roast-full.md has everything)`);
  log(`wrote ${join(outDir, "roast.json")}`);
  log(`wrote ${join(outDir, "roast-summary.txt")}`);

  if (args.publish && !args.dryRun && publishAuth) {
    const { publishRoastOpinion } = await import("./publish.ts");
    const pub = await publishRoastOpinion({
      roast,
      summaryTxt: summaryText,
      hubUrl: publishAuth.hubUrl,
      token: publishAuth.token,
    });
    log(`${st.bold(st.green("published:"))} ${pub.patchUrl}`);
  }
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`pgroast: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
