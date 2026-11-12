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
import { CliBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName } from "./roast/llm.ts";
import { closePrecedents } from "./roast/precedents.ts";
import { runRoast, slugFor } from "./roast/pipeline.ts";
import { renderCompactMarkdown, renderMarkdown, renderSummary } from "./roast/render.ts";

const USAGE = `Usage: bun run src/cli.ts <cf-id|cf-url|message-id|thread-url> [options]
       bun run src/cli.ts --self --proposal FILE [--patch FILE ...]
       bun run src/cli.ts page <roast.json> [--out FILE] [--site DIR [--base-url URL]]
       bun run src/cli.ts pushback <cf-id|cf-url|thread-url> [--out DIR] [--backend NAME] [--dry-run] [--offline]
       bun run src/cli.ts batch <commitfest-number> --out DIR [--status open|all|"Needs review"] [--limit K]
                                      [--concurrency N] [--only id,id] [--blind N] [--backend NAME] [--dry-run]
       bun run src/cli.ts doctor      check the installed CLIs and their login
       bun run src/cli.ts init-db     create the precedent database and load the shipped index

  --self           your own proposal, before you send it: same roast, written for the author
                   ("objections to address before you send": fix it, or rebut it in the cover
                   letter); the verdict stays in roast.json and moves down in roast.md
  --proposal FILE  with --self: a draft email on disk instead of a thread
  --patch FILE     with --proposal: a patch file (repeatable); only its commit message, file
                   list and doc hunks are read
  --rounds N       extra rounds after the first pass (default 0): 1 asks every roaster "What
                   did you forget?"; 2 also asks "Are you happy with the results?"; 3 and more
                   add supervisor follow-ups on areas nobody examined

  --blind N        read only the first N messages of the thread (evaluation: judge the idea itself)
  --before DATE    read only messages strictly before DATE (YYYY-MM-DD); also the precedent cutoff
  --hint TEXT      directed precedent lookup, e.g. "the 2018 suggestion of doing X"
  --out DIR        output directory (default: out/<slug>)
  --backend NAME   claude or codex (default: PGROAST_BACKEND, else claude if installed, else codex)
  --no-enrich      do not read precedent threads and do not filter precedents for relevance
  --dry-run        print the prompts, call no model
  --offline        use only cached pages
  -h, --help

pushback: for a long-stuck entry, "what is the real pushback?". Reads the whole thread (every
thread of the CommitFest entry) in parts, one model call per part plus one to merge, and writes
pushback.md and pushback.json: the blocking objections with verified quotes and message links,
who raised them, whether they were resolved, when the thread last moved, and a bucket.
--dry-run prints the number of parts and calls and calls no model.

batch: roasts every selected entry of one commitfest into DIR/cf/<id>/ and writes an index
DIR/README.md. An entry that is already done is skipped, and the run stops at a usage limit, so
the same command continues it later. It commits and pushes nothing.

page: renders a finished roast.json, with no model call, to one self-contained HTML file
(default: roast.html next to the JSON; --out FILE), or with --site DIR to a static layout:
DIR/cf/<cf-id>.html (embeddable card), DIR/cf/<cf-id>.json, DIR/cf/<cf-id>/full.html
(DIR/msg/<message-id>.* for a thread without a CommitFest entry). The card links to
{{PGROAST_BASE_URL}}/cf/<cf-id>/full.html unless --base-url is given. Local files only:
nothing is uploaded or published.

The model runs through an installed Claude Code or Codex CLI on your subscription login.
No API key is used: API key variables are removed from the CLI's environment.

Environment: PGROAST_BACKEND; for claude: PGROAST_ROASTER_MODEL (default opus), PGROAST_CRITIC_MODEL
(default claude-mythos-5-2; also used for synthesis), Opus, Mythos and Fable only; for codex:
PGROAST_CODEX_MODEL (default: the CLI's configured model); PGROAST_CONCURRENCY (3),
PGROAST_LLM_TIMEOUT_MS (900000).

Output: roast.md, roast.json, roast-summary.txt (a draft of at most 10 lines, to rewrite in your
own words) and llm/ (every prompt and reply). Local files only.`;

export interface CliArgs {
  input: string;
  blind?: number;
  before?: string;
  hint?: string;
  out?: string;
  backend?: BackendName;
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

export function parseArgs(argv: string[]): CliArgs | "help" {
  const a: CliArgs = { input: "", dryRun: false, offline: false };
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
        if (b !== "claude" && b !== "codex") throw new Error("--backend must be claude or codex");
        a.backend = b;
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
        if (flag.startsWith("--")) throw new Error(`unknown option ${flag}`);
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
  const env = { ...process.env, ...(kv.host ? { PGHOST: kv.host } : {}), ...(kv.port ? { PGPORT: kv.port } : {}), ...(kv.user ? { PGUSER: kv.user } : {}) };
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
  if (process.argv[2] === "batch") return (await import("./batch.ts")).batchMain(process.argv.slice(3));
  let args: CliArgs | "help";
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`pgroast: ${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args === "help") {
    console.log(USAGE);
    return 0;
  }
  if (args.page) {
    runPage(args.page, (m) => console.error(m));
    return 0;
  }
  if (args.initDb) return initDb();
  if (args.doctor) {
    const d = await runDoctor();
    console.log(d.text);
    return d.ok ? 0 : 1;
  }
  const t0 = Date.now();
  const log = (m: string) => console.error(m);
  const backendName: BackendName = args.dryRun ? (args.backend ?? "claude") : pickBackend(args.backend);
  const models = modelsFromEnv(process.env, backendName);

  if (args.pushback) {
    log(`reading ${args.input} (whole thread) ...`);
    const input = await loadPushbackInput(args.input, { offline: args.offline, noAttachments: true });
    const outDir = resolve(args.out ?? join(DEFAULT_OUT_ROOT, pushbackSlug(input)));
    mkdirSync(outDir, { recursive: true });
    const transcriptDir = join(outDir, "llm");
    const backend = args.dryRun ? new DryRunBackend({ transcriptDir, print: () => undefined }) : new CliBackend({ backend: backendName, transcriptDir, log });
    const result = await runPushback(input, { backend, models: { map: models.roaster, reduce: models.critic }, backendName: args.dryRun ? "dry-run" : backendName, log });
    result.stats.wall_ms = Date.now() - t0;
    writeFileSync(join(outDir, "pushback.json"), JSON.stringify(result, null, 2) + "\n");
    writeFileSync(join(outDir, "pushback.md"), renderPushbackMarkdown(result));
    log("");
    if (args.dryRun) log(`dry run: no model was called; prompts are in ${transcriptDir}`);
    else {
      log(`bucket: ${result.bucket}`);
      log(`objections: ${result.objections.length} (${result.objections.filter((o) => o.blocking).length} blocking), from ${result.candidates.length} candidates`);
      for (const w of result.warnings) log(`warning: ${w}`);
    }
    log(`model calls: ${result.stats.llm_calls}; parts: ${result.stats.chunks}; wall time: ${Math.round(result.stats.wall_ms / 1000)} s`);
    log(`wrote ${join(outDir, "pushback.md")}`);
    log(`wrote ${join(outDir, "pushback.json")}`);
    return 0;
  }

  log(`reading ${args.proposal ?? args.input} ...`);
  const proposal = args.proposal
    ? loadLocalProposal(args.proposal, args.patches ?? [])
    : await loadProposal(args.input, { blind: args.blind, before: args.before, offline: args.offline });
  log(
    args.proposal
      ? `draft: "${proposal.thread.subject}", ${proposal.patchProse.length} patch file(s) read`
      : `thread: "${proposal.thread.subject}", ${proposal.thread.messages.length} of ${proposal.totalMessages} messages, ${proposal.patchProse.length} patch file(s) read; fetched ${fetchStats.fetched}, cached ${fetchStats.cached}`,
  );

  const outDir = resolve(args.out ?? join(DEFAULT_OUT_ROOT, slugFor(proposal)));
  mkdirSync(outDir, { recursive: true });
  const transcriptDir = join(outDir, "llm");
  const backend = args.dryRun ? new DryRunBackend({ transcriptDir }) : new CliBackend({ backend: backendName, transcriptDir, log });
  if (!args.dryRun) log(`backend: ${backendName} CLI (subscription login, no tools)`);

  const roast = await runRoast(proposal, { backend, models, backendName: args.dryRun ? "dry-run" : backendName, hint: args.hint ?? null, enrich: !args.noEnrich, mode: args.self ? "self" : "review", rounds: args.rounds ?? 0, log });
  await closePrecedents();
  roast.stats.wall_ms = Date.now() - t0;

  writeFileSync(join(outDir, "roast.json"), JSON.stringify(roast, null, 2) + "\n");
  writeFileSync(join(outDir, "roast.md"), renderCompactMarkdown(roast));
  writeFileSync(join(outDir, "roast-full.md"), renderMarkdown(roast));
  writeFileSync(join(outDir, "roast-summary.txt"), renderSummary(roast));
  log("");
  log(`${args.dryRun ? "DRY RUN, placeholder verdict" : "verdict"}: ${roast.verdict} (confidence: ${roast.confidence})`);
  log(`objections: ${roast.objections.length} listed, ${roast.other_surviving.length} more survived, ${roast.refuted.length} refuted; prior attempts: ${roast.prior_attempts.length}`);
  for (const x of roast.rounds.slice(1)) log(`round ${x.round} (${x.kind}): ${x.llm_calls} calls, ${x.new_objections} new objection(s), ${x.new_survived} survived, ${x.revised} revised, ${x.withdrawn} withdrawn`);
  log(`LLM calls: ${roast.stats.llm_calls}; wall time: ${Math.round(roast.stats.wall_ms / 1000)} s`);
  if (!args.dryRun) for (const w of roast.warnings) log(`warning: ${w}`);
  else log(`dry run: prompts are in ${transcriptDir}; roast.md and roast.json hold placeholders`);
  log(`wrote ${join(outDir, "roast.md")} (short report; roast-full.md has everything)`);
  log(`wrote ${join(outDir, "roast.json")}`);
  log(`wrote ${join(outDir, "roast-summary.txt")}`);
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
