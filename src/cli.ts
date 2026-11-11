#!/usr/bin/env bun
// pgroast <cf-id|cf-url|message-id|thread-url> [--blind N] [--before DATE] [--hint TEXT] [--out DIR]
//         [--backend claude|codex] [--rounds N] [--self] [--dry-run]
// pgroast --self --proposal FILE [--patch FILE ...]
// pgroast doctor
//
// Writes roast.md, roast.json and roast-summary.txt to a local directory. It never posts
// anything anywhere.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, stats as fetchStats } from "./thread/fetch.ts";
import { loadProposal, validateDate } from "./thread/load.ts";
import { loadLocalProposal } from "./thread/local.ts";
import { runDoctor } from "./roast/doctor.ts";
import { CliBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName } from "./roast/llm.ts";
import { closePrecedents } from "./roast/precedents.ts";
import { runRoast, slugFor } from "./roast/pipeline.ts";
import { renderMarkdown, renderSummary } from "./roast/render.ts";

const USAGE = `Usage: bun run src/cli.ts <cf-id|cf-url|message-id|thread-url> [options]
       bun run src/cli.ts --self --proposal FILE [--patch FILE ...]
       bun run src/cli.ts doctor      check the installed CLIs and their login

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

The model runs through an installed Claude Code or Codex CLI on your subscription login.
No API key is used: API key variables are removed from the CLI's environment.

Environment: PGROAST_BACKEND; for claude: PGROAST_ROASTER_MODEL (default opus), PGROAST_CRITIC_MODEL
(default claude-mythos-5-2; also used for synthesis), Opus and Mythos only; for codex:
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
  noEnrich?: boolean;
  self?: boolean;
  proposal?: string;
  patches?: string[];
  rounds?: number;
  dryRun: boolean;
  offline: boolean;
}

export function parseArgs(argv: string[]): CliArgs | "help" {
  const a: CliArgs = { input: "", dryRun: false, offline: false };
  const rest = [...argv];
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
  if (a.input === "doctor") a.doctor = true;
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

async function main(): Promise<number> {
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
  if (args.doctor) {
    const d = await runDoctor();
    console.log(d.text);
    return d.ok ? 0 : 1;
  }
  const t0 = Date.now();
  const log = (m: string) => console.error(m);
  const backendName: BackendName = args.dryRun ? (args.backend ?? "claude") : pickBackend(args.backend);
  const models = modelsFromEnv(process.env, backendName);

  log(`reading ${args.proposal ?? args.input} ...`);
  const proposal = args.proposal
    ? loadLocalProposal(args.proposal, args.patches ?? [])
    : await loadProposal(args.input, { blind: args.blind, before: args.before, offline: args.offline });
  log(
    args.proposal
      ? `draft: "${proposal.thread.subject}", ${proposal.patchProse.length} patch file(s) read`
      : `thread: "${proposal.thread.subject}", ${proposal.thread.messages.length} of ${proposal.totalMessages} messages, ${proposal.patchProse.length} patch file(s) read; fetched ${fetchStats.fetched}, cached ${fetchStats.cached}`,
  );

  const outDir = resolve(args.out ?? join(REPO_ROOT, "out", slugFor(proposal)));
  mkdirSync(outDir, { recursive: true });
  const transcriptDir = join(outDir, "llm");
  const backend = args.dryRun ? new DryRunBackend({ transcriptDir }) : new CliBackend({ backend: backendName, transcriptDir, log });
  if (!args.dryRun) log(`backend: ${backendName} CLI (subscription login, no tools)`);

  const roast = await runRoast(proposal, { backend, models, backendName: args.dryRun ? "dry-run" : backendName, hint: args.hint ?? null, enrich: !args.noEnrich, mode: args.self ? "self" : "review", rounds: args.rounds ?? 0, log });
  await closePrecedents();
  roast.stats.wall_ms = Date.now() - t0;

  writeFileSync(join(outDir, "roast.json"), JSON.stringify(roast, null, 2) + "\n");
  writeFileSync(join(outDir, "roast.md"), renderMarkdown(roast));
  writeFileSync(join(outDir, "roast-summary.txt"), renderSummary(roast));
  log("");
  log(`${args.dryRun ? "DRY RUN, placeholder verdict" : "verdict"}: ${roast.verdict} (confidence: ${roast.confidence})`);
  log(`objections: ${roast.objections.length} listed, ${roast.other_surviving.length} more survived, ${roast.refuted.length} refuted; prior attempts: ${roast.prior_attempts.length}`);
  for (const x of roast.rounds.slice(1)) log(`round ${x.round} (${x.kind}): ${x.llm_calls} calls, ${x.new_objections} new objection(s), ${x.new_survived} survived, ${x.revised} revised, ${x.withdrawn} withdrawn`);
  log(`LLM calls: ${roast.stats.llm_calls}; wall time: ${Math.round(roast.stats.wall_ms / 1000)} s`);
  if (!args.dryRun) for (const w of roast.warnings) log(`warning: ${w}`);
  else log(`dry run: prompts are in ${transcriptDir}; roast.md and roast.json hold placeholders`);
  log(`wrote ${join(outDir, "roast.md")}`);
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
