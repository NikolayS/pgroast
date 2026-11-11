// Eval runner: roast each case in blind mode, exactly as
//   bun run src/cli.ts <thread_url> --blind <blind_n> --before <cutoff_date> [--rounds N]
// would, writing to eval/results/<run-id>/<case-id>[/r<k>]/. Resumable.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName } from "../roast/llm.ts";
import { closePrecedents } from "../roast/precedents.ts";
import { runRoast } from "../roast/pipeline.ts";
import { renderMarkdown } from "../roast/render.ts";
import { loadProposal } from "../thread/load.ts";
import { REPO_ROOT, type EvalCase } from "./cases.ts";

export const RESULTS_DIR = join(REPO_ROOT, "eval", "results");

export interface RunEvalOptions {
  runId: string;
  cases: EvalCase[];
  /** pipeline reflection rounds, as `src/cli.ts --rounds` */
  rounds?: number;
  /** independent repetitions of each case (variance); default 1 */
  repeat?: number;
  concurrency?: number;
  dryRun?: boolean;
  backend?: BackendName;
  offline?: boolean;
  log?: (m: string) => void;
  /** injected for tests */
  roastFn?: typeof runRoast;
  loadFn?: typeof loadProposal;
}

export function caseDir(runId: string, caseId: string, repeat: number, repeats: number): string {
  return repeats > 1 ? join(RESULTS_DIR, runId, caseId, `r${repeat}`) : join(RESULTS_DIR, runId, caseId);
}

export interface CaseMeta {
  case_id: string;
  repeat: number;
  started_at: string;
  wall_ms: number;
  llm_calls: number;
  cost_usd: number | null;
  options: { thread_url: string; blind: number; before: string; rounds: number; hint: string | null; backend: string; models: unknown };
  error: string | null;
}

export async function runEval(o: RunEvalOptions): Promise<{ done: number; skipped: number; failed: number }> {
  const log = o.log ?? ((m: string) => console.error(m));
  const repeats = Math.max(1, o.repeat ?? 1);
  const backendName: BackendName = o.dryRun ? (o.backend ?? "claude") : pickBackend(o.backend);
  const models = modelsFromEnv(process.env, backendName);
  const roast = o.roastFn ?? runRoast;
  const load = o.loadFn ?? loadProposal;
  const jobs: { c: EvalCase; k: number }[] = [];
  for (const c of o.cases) for (let k = 1; k <= repeats; k++) jobs.push({ c, k });
  const res = { done: 0, skipped: 0, failed: 0 };
  mkdirSync(join(RESULTS_DIR, o.runId), { recursive: true });

  const one = async ({ c, k }: { c: EvalCase; k: number }) => {
    const dir = caseDir(o.runId, c.id, k, repeats);
    const tag = repeats > 1 ? `${c.id}/r${k}` : c.id;
    if (existsSync(join(dir, "roast.json"))) {
      res.skipped++;
      log(`[${tag}] roast.json exists, skipped`);
      return;
    }
    mkdirSync(dir, { recursive: true });
    rmSync(join(dir, "error.json"), { force: true });
    const t0 = Date.now();
    const transcriptDir = join(dir, "llm");
    const backend = o.dryRun
      ? new DryRunBackend({ transcriptDir, print: () => undefined })
      : new CliBackend({ backend: backendName, transcriptDir, log: (m) => log(`[${tag}] ${m}`) });
    const meta: CaseMeta = {
      case_id: c.id, repeat: k, started_at: new Date(t0).toISOString(), wall_ms: 0, llm_calls: 0, cost_usd: null,
      options: {
        thread_url: c.thread_url, blind: c.blind_n, before: c.cutoff_date, rounds: o.rounds ?? 0,
        hint: null, backend: o.dryRun ? "dry-run" : backendName, models,
      },
      error: null,
    };
    try {
      log(`[${tag}] loading ${c.thread_url} (blind ${c.blind_n}, before ${c.cutoff_date})`);
      const proposal = await load(c.thread_url, { blind: c.blind_n, before: c.cutoff_date, offline: o.offline });
      const r = await roast(proposal, {
        backend, models, backendName: o.dryRun ? "dry-run" : backendName, hint: null, enrich: true,
        mode: "review", rounds: o.rounds ?? 0, log: (m) => log(`[${tag}] ${m}`),
      });
      r.stats.wall_ms = Date.now() - t0;
      writeFileSync(join(dir, "roast.md"), renderMarkdown(r));
      // roast.json last: its presence marks the case done
      writeFileSync(join(dir, "roast.json"), JSON.stringify(r, null, 2) + "\n");
      Object.assign(meta, { wall_ms: r.stats.wall_ms, llm_calls: r.stats.llm_calls, cost_usd: r.stats.cost_usd });
      res.done++;
      log(`[${tag}] verdict ${r.verdict} (${r.confidence}); ${r.stats.llm_calls} calls; ${Math.round(r.stats.wall_ms / 1000)} s`);
    } catch (e) {
      meta.error = String((e as Error)?.stack ?? e);
      meta.wall_ms = Date.now() - t0;
      meta.llm_calls = backend.stats().calls;
      meta.cost_usd = backend.stats().costUsd;
      writeFileSync(join(dir, "error.json"), JSON.stringify({ error: meta.error }, null, 2) + "\n");
      res.failed++;
      log(`[${tag}] FAILED: ${(e as Error)?.message ?? e}`);
    }
    writeFileSync(join(dir, "case-meta.json"), JSON.stringify(meta, null, 2) + "\n");
  };

  const queue = [...jobs];
  const workers = Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, jobs.length || 1)) }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) await one(j);
  });
  await Promise.all(workers);
  await closePrecedents();
  return res;
}
