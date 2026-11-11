// PG Roast evaluation CLI (rules: docs/eval.md).
//
//   bun run src/eval/cli.ts run   [--run-id ID] [--case ID ...] [--rounds N] [--repeat K] [--concurrency 2] [--dry-run] [--backend claude|codex] [--offline]
//   bun run src/eval/cli.ts score <run-id> [--no-judge] [--case ID ...]
//   bun run src/eval/cli.ts list

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BackendName } from "../roast/llm.ts";
import { CASES_PATH, loadCases, type EvalCase } from "./cases.ts";
import { renderReport, scoreRun, writeReport } from "./report.ts";
import { RESULTS_DIR, runEval } from "./run.ts";

const USAGE = `usage:
  bun run src/eval/cli.ts run   [--run-id ID] [--case ID ...] [--rounds N] [--repeat K] [--concurrency 2] [--dry-run] [--backend claude|codex] [--offline] [--cases FILE]
  bun run src/eval/cli.ts score <run-id> [--no-judge] [--case ID ...] [--backend claude|codex] [--cases FILE]
  bun run src/eval/cli.ts list [--cases FILE]
--rounds N passes through to the pipeline (extra reflection rounds, as src/cli.ts --rounds).
--repeat K runs every case K times (r1..rK) to measure variance.`;

interface Args { cmd: string; pos: string[]; cases: string[]; flags: Record<string, string | true> }

export function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? "", pos: [], cases: [], flags: {} };
  const boolFlags = new Set(["dry-run", "no-judge", "offline", "help"]);
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i]!;
    if (t.startsWith("--")) {
      const k = t.slice(2);
      if (boolFlags.has(k)) { a.flags[k] = true; continue; }
      const v = argv[++i];
      if (v === undefined) throw new Error(`--${k} needs a value`);
      if (k === "case") a.cases.push(...v.split(","));
      else a.flags[k] = v;
    } else a.pos.push(t);
  }
  return a;
}

function selectCases(all: EvalCase[], ids: string[]): EvalCase[] {
  if (!ids.length) return all;
  const unknown = ids.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) throw new Error(`unknown case id(s): ${unknown.join(", ")}`);
  return all.filter((c) => ids.includes(c.id));
}

const int = (v: string | true | undefined, def: number, name: string, min = 0, max = 100) => {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer ${min}..${max}`);
  return n;
};

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (!a.cmd || a.flags.help) { console.log(USAGE); return a.cmd ? 0 : 2; }
  const casesPath = typeof a.flags.cases === "string" ? a.flags.cases : CASES_PATH;
  const { cases, problems } = loadCases(casesPath);
  for (const p of problems) console.error(`cases.json: skipped ${p}`);

  if (a.cmd === "list") {
    for (const c of cases) {
      console.log(`${c.id.padEnd(24)} ${c.outcome.padEnd(9)} blind ${String(c.blind_n).padStart(3)}  before ${c.cutoff_date}  post-cutoff ${c.post_training_cutoff ?? "?"}  decisive ${c.decisive_objections.length}  earlier ${c.earlier_attempts.length}  ${c.title}`);
    }
    const runs = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((d) => !d.startsWith(".")) : [];
    console.log(`\nruns: ${runs.join(", ") || "(none)"}`);
    return 0;
  }
  if (a.cmd === "run") {
    const runId = typeof a.flags["run-id"] === "string" ? a.flags["run-id"] : new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("--run-id: letters, digits, . _ - only");
    const sel = selectCases(cases, a.cases);
    console.error(`run ${runId}: ${sel.length} case(s) -> ${join(RESULTS_DIR, runId)}${a.flags["dry-run"] ? " (DRY RUN, no model calls)" : ""}`);
    const r = await runEval({
      runId, cases: sel,
      rounds: int(a.flags.rounds, 0, "rounds", 0, 6),
      repeat: int(a.flags.repeat, 1, "repeat", 1, 10),
      concurrency: int(a.flags.concurrency, 2, "concurrency", 1, 8),
      dryRun: !!a.flags["dry-run"],
      backend: a.flags.backend as BackendName | undefined,
      offline: !!a.flags.offline,
    });
    console.error(`run ${runId}: ${r.done} done, ${r.skipped} skipped (already done), ${r.failed} failed`);
    console.error(`next: bun run src/eval/cli.ts score ${runId}`);
    return r.failed ? 1 : 0;
  }
  if (a.cmd === "score") {
    const runId = a.pos[0];
    if (!runId) throw new Error("score needs a run id");
    const rep = await scoreRun({
      runId, cases: selectCases(cases, a.cases), judge: !a.flags["no-judge"],
      backend: a.flags.backend as BackendName | undefined,
    });
    const out = writeReport(rep, cases);
    console.log(renderReport(rep, cases).split("\n## Cases")[0]);
    console.error(`wrote ${out.md}\nwrote ${out.json}`);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.main) {
  main().then((c) => process.exit(c), (e) => { console.error(`eval: ${(e as Error).message}`); process.exit(1); });
}
