// Score a run and write eval/results/<run-id>/report.{md,json}.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../corpus/db.ts";
import { flatUrl } from "../corpus/util.ts";
import { CliBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName, type LlmBackend } from "../roast/llm.ts";
import type { Roast } from "../roast/schema.ts";
import { msgidOf, type EvalCase } from "./cases.ts";
import { runClassify, runJudge, type ClassifyItem } from "./judge.ts";
import { RESULTS_DIR, type CaseMeta } from "./run.ts";
import { headline, scoreCase, type CaseScore, type CorpusThreadRow, type Headline, type JudgeItem } from "./score.ts";

const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);

/** Corpus rows holding any of the given thread message-ids. */
export async function corpusRowsFor(msgids: string[]): Promise<CorpusThreadRow[]> {
  if (!msgids.length) return [];
  const sql = connect();
  try {
    const urls = JSON.stringify([...new Set(msgids)].map(flatUrl));
    const rows = await sql`
      select id, to_char(date, 'YYYY-MM-DD') as date, to_char(first_date, 'YYYY-MM-DD') as first_date,
             array_to_json(thread_urls)::text as thread_urls
      from precedent
      where thread_urls && array(select jsonb_array_elements_text((${urls}::text)::jsonb))`;
    return rows.map((r: { id: string; date: string | null; first_date: string | null; thread_urls: string }) =>
      ({ id: r.id, date: r.date, first_date: r.first_date, thread_urls: JSON.parse(r.thread_urls) as string[] }));
  } finally {
    await sql.close();
  }
}

export interface ScoreOptions {
  runId: string;
  cases: EvalCase[];
  judge?: boolean;
  backend?: BackendName;
  log?: (m: string) => void;
  /** injected for tests */
  judgeBackend?: (dir: string, dryRun: boolean) => LlmBackend;
  corpusRows?: CorpusThreadRow[];
}

export interface Report {
  run_id: string;
  scored_at: string;
  /** true when any roast in the run came from the DryRunBackend */
  dry_run: boolean;
  rules: string;
  cases_in_file: number;
  cases_scored: number;
  repeats: number;
  headline: Headline;
  by_post_training_cutoff: { true: Headline; false: Headline; unknown: Headline };
  by_outcome: Record<string, Headline>;
  /** by the most fundamental level of the decisive objection (idea / design / implementation / unclassified) */
  by_decisive_level: Record<string, Headline>;
  by_repeat: Headline[] | null;
  agreement: { case_id: string; verdicts: (string | null)[]; modal_share: number }[] | null;
  scores: CaseScore[];
  totals: { roast_calls: number; judge_calls: number; cost_usd: number | null; wall_ms: number };
}

function repeatDirs(runId: string, caseId: string): { k: number; dir: string }[] {
  const base = join(RESULTS_DIR, runId, caseId);
  if (!existsSync(base)) return [];
  const rs = readdirSync(base).filter((d) => /^r\d+$/.test(d)).map((d) => ({ k: Number(d.slice(1)), dir: join(base, d) }));
  return rs.length ? rs.sort((a, b) => a.k - b.k) : [{ k: 1, dir: base }];
}

export async function scoreRun(o: ScoreOptions): Promise<Report> {
  const log = o.log ?? ((m: string) => console.error(m));
  const runDir = join(RESULTS_DIR, o.runId);
  if (!existsSync(runDir)) throw new Error(`no such run: ${runDir}`);
  const wanted = o.cases.flatMap((c) => c.earlier_attempts.map((e) => msgidOf(e.thread_url)).filter((x): x is string => !!x));
  const corpusRows = o.corpusRows ?? (await corpusRowsFor(wanted));
  const scores: CaseScore[] = [];
  let repeats = 1;
  let dryRun = false;
  for (const c of o.cases) {
    const dirs = repeatDirs(o.runId, c.id);
    if (!dirs.length) continue; // case not part of this run
    repeats = Math.max(repeats, dirs.length);
    for (const { k, dir } of dirs) {
      const r = readJson<Roast>(join(dir, "roast.json"));
      if (r?.backend === "dry-run") dryRun = true;
      const meta = readJson<CaseMeta>(join(dir, "case-meta.json"));
      const err = readJson<{ error: string }>(join(dir, "error.json"));
      let judge: JudgeItem[] | null = null;
      let judgeCalls = 0;
      let judgeCost: number | null = null;
      let classify: ClassifyItem[] | null = null;
      if (r && c.decisive_objections.length) {
        const dry = r.backend === "dry-run";
        const mk = () => o.judgeBackend?.(dir, dry) ?? (dry
          ? new DryRunBackend({ transcriptDir: join(dir, "judge-llm"), print: () => undefined })
          : new CliBackend({ backend: pickBackend(o.backend), transcriptDir: join(dir, "judge-llm"), log }));
        const model = modelsFromEnv(process.env, dry ? "claude" : pickBackend(o.backend)).critic;
        // 1. level classification: sees the case only, never the roast; runs first
        const cc = readJson<{ items: ClassifyItem[]; calls: number; cost_usd: number | null }>(join(dir, "classify.json"));
        if (cc) {
          classify = cc.items;
          judgeCalls += cc.calls;
          judgeCost = cc.cost_usd;
        } else if (o.judge !== false) {
          const b = mk();
          try {
            classify = await runClassify(c, b, model);
            writeFileSync(join(dir, "classify.json"), JSON.stringify({ items: classify, calls: b.stats().calls, cost_usd: b.stats().costUsd, model, dry_run: dry }, null, 2) + "\n");
          } catch (e) {
            log(`[${c.id}] classify failed: ${(e as Error).message}`);
          }
          judgeCalls += b.stats().calls;
          judgeCost = b.stats().costUsd;
        }
        // 2. judge: roast objections vs decisive objections
        const cached = readJson<{ items: JudgeItem[]; calls: number; cost_usd: number | null }>(join(dir, "judge.json"));
        const addCost = (x: number | null) => { judgeCost = judgeCost === null && x === null ? null : (judgeCost ?? 0) + (x ?? 0); };
        if (cached) {
          judge = cached.items;
          judgeCalls += cached.calls;
          addCost(cached.cost_usd);
        } else if (o.judge !== false) {
          const b = mk();
          try {
            judge = await runJudge(c, r, b, model);
            writeFileSync(join(dir, "judge.json"), JSON.stringify({ items: judge, calls: b.stats().calls, cost_usd: b.stats().costUsd, model, dry_run: dry }, null, 2) + "\n");
            log(`[${c.id}${dirs.length > 1 ? `/r${k}` : ""}] judged`);
          } catch (e) {
            log(`[${c.id}] judge failed: ${(e as Error).message}`);
          }
          judgeCalls += b.stats().calls;
          addCost(b.stats().costUsd);
        }
      }
      scores.push(scoreCase(c, r, judge, corpusRows, {
        repeat: k, error: r ? null : (err?.error?.split("\n")[0] ?? "no roast.json (not run yet)"),
        judgeCalls, judgeCost, wallMs: meta?.wall_ms ?? null, classify,
      }));
    }
  }
  const pick = (v: boolean | null) => scores.filter((s) => s.post_training_cutoff === v);
  const byRepeat = repeats > 1
    ? Array.from({ length: repeats }, (_, i) => headline(scores.filter((s) => s.repeat === i + 1)))
    : null;
  const agreement = repeats > 1
    ? [...new Set(scores.map((s) => s.case_id))].map((id) => {
        const vs = scores.filter((s) => s.case_id === id).map((s) => s.verdict);
        const counts = new Map<string | null, number>();
        for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1);
        return { case_id: id, verdicts: vs, modal_share: Math.max(...counts.values()) / vs.length };
      })
    : null;
  const costs = scores.map((s) => s.cost.cost_usd);
  return {
    run_id: o.runId,
    scored_at: new Date().toISOString(),
    dry_run: dryRun,
    rules: "docs/eval.md",
    cases_in_file: o.cases.length,
    cases_scored: new Set(scores.map((s) => s.case_id)).size,
    repeats,
    headline: headline(scores),
    by_post_training_cutoff: { true: headline(pick(true)), false: headline(pick(false)), unknown: headline(pick(null)) },
    by_outcome: Object.fromEntries(["rejected", "accepted", "reverted"].map((k) => [k, headline(scores.filter((s) => s.outcome === k))])),
    by_decisive_level: Object.fromEntries(["idea", "design", "implementation", "unclassified"].map((k) =>
      [k, headline(scores.filter((s) => (s.decisive_level ?? "unclassified") === k))])),
    by_repeat: byRepeat,
    agreement,
    scores,
    totals: {
      roast_calls: scores.reduce((a, s) => a + s.cost.roast_calls, 0),
      judge_calls: scores.reduce((a, s) => a + s.cost.judge_calls, 0),
      cost_usd: costs.every((c) => c === null) ? null : Math.round(costs.reduce<number>((a, c) => a + (c ?? 0), 0) * 100) / 100,
      wall_ms: scores.reduce((a, s) => a + (s.cost.wall_ms ?? 0), 0),
    },
  };
}

// ---------------------------------------------------------------- markdown

const pct = (r: { num: number; den: number; pct: number | null }) => (r.den ? `${r.num}/${r.den} (${r.pct}%)` : "n/a");
const yn = (b: boolean | null) => (b === null ? "–" : b ? "yes" : "no");

function headlineTable(rows: [string, Headline][]): string {
  const h = "| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |\n|---|---:|---|---|---|---|---|---|\n";
  return h + rows.map(([n, x]) =>
    `| ${n} | ${x.cases}${x.errors ? ` (${x.errors} err)` : ""} | ${pct(x.verdict_lenient)} | ${pct(x.verdict_strict)} | ${pct(x.decisive_found)} | ${pct(x.decisive_found_or_partial)} | ${pct(x.earlier_found)} | ${pct(x.false_alarm_rate)} |`).join("\n") + "\n";
}

export function renderReport(rep: Report, cases: EvalCase[]): string {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const H = rep.headline;
  let md = `# PG Roast eval: run \`${rep.run_id}\`\n\n`;
  md += `Scored ${rep.scored_at}. Rules: [docs/eval.md](../../../docs/eval.md) (fixed before any result). `;
  md += `${rep.cases_scored} of ${rep.cases_in_file} cases in this run${rep.repeats > 1 ? `, ${rep.repeats} repeats each` : ""}.\n\n`;
  if (rep.dry_run) md += `> **Dry run**: placeholder verdicts from the DryRunBackend; these numbers mean nothing.\n\n`;
  md += `## Headline\n\n`;
  md += `- **(a) verdict match**: ${pct(H.verdict_lenient)} lenient, ${pct(H.verdict_strict)} strict\n`;
  md += `- **(b) decisive objection found** (listed or other surviving): ${pct(H.decisive_found)}; found or partially: ${pct(H.decisive_found_or_partial)}; found but refuted by the critic: ${H.decisive_found_but_refuted}\n`;
  md += `- **(c) earlier attempt found** (in prior attempts): ${pct(H.earlier_found)}; retrieved but not listed: ${H.earlier_retrieved_only}; not in corpus (corpus gap, excluded): ${H.earlier_not_in_corpus}\n`;
  md += `- **(d) false-alarm rate on accepted cases**: ${pct(H.false_alarm_rate)}\n\n`;
  md += `### Split by post_training_cutoff\n\nThe models may remember how famous old threads ended; post-cutoff cases cannot be recalled.\n\n`;
  md += headlineTable([["all", H], ["post-cutoff (true)", rep.by_post_training_cutoff.true], ["pre-cutoff (false)", rep.by_post_training_cutoff.false], ...(rep.by_post_training_cutoff.unknown.cases ? [["unknown", rep.by_post_training_cutoff.unknown] as [string, Headline]] : [])]);
  md += `\n### Split by outcome\n\n` + headlineTable(Object.entries(rep.by_outcome).filter(([, h]) => h.cases));
  md += `\n### Split by level of the decisive objection\n\nLevel from a separate classify call that saw only the case, never the roast (idea = rubric 1a/1b, design = 2, implementation = 3-5). An implementation-level reason (a bug, a buildfarm failure) is usually invisible to an idea-level review of the first few emails; those cases are shown apart, not averaged in.\n\n`;
  md += headlineTable(Object.entries(rep.by_decisive_level).filter(([, h]) => h.cases));
  const inWin = rep.scores.filter((s) => s.decisive_in_window);
  if (inWin.length) {
    md += `\n> **Decisive objection inside the shown window** (position <= blind_n; the roast could read it): ${[...new Set(inWin.map((s) => s.case_id))].join(", ")}. A "found" here may be reading, not foresight.\n`;
  }
  if (rep.by_repeat) {
    md += `\n### Per repeat\n\n` + headlineTable(rep.by_repeat.map((h, i) => [`r${i + 1}`, h] as [string, Headline]));
    md += `\nVerdict agreement across repeats:\n\n| case | verdicts | modal share |\n|---|---|---:|\n`;
    md += rep.agreement!.map((a) => `| ${a.case_id} | ${a.verdicts.map((v) => v ?? "error").join(", ")} | ${Math.round(a.modal_share * 100)}% |`).join("\n") + "\n";
  }
  md += `\n## Cases\n\n| case | outcome | post-cutoff | decisive level | verdict | (a) lenient | strict | (b) decisive | bucket | (c) earlier | fatal surviving | calls (roast+judge) | cost | wall |\n|---|---|---|---|---|---|---|---|---|---|---:|---|---:|---:|\n`;
  for (const s of rep.scores) {
    const tag = (rep.repeats > 1 ? `${s.case_id}/r${s.repeat}` : s.case_id) + (s.decisive_in_window ? " ⚑" : "");
    const lvl = s.decisive_level ?? "–";
    if (s.error) {
      md += `| ${tag} | ${s.outcome} | ${yn(s.post_training_cutoff)} | ${lvl} | ERROR: ${s.error.replace(/\|/g, "/").slice(0, 80)} | | | | | | | ${s.cost.roast_calls}+${s.cost.judge_calls} | | |\n`;
      continue;
    }
    const d = s.decisive!;
    md += `| ${tag} | ${s.outcome} | ${yn(s.post_training_cutoff)} | ${lvl} | ${s.verdict} (${s.confidence}) | ${yn(s.verdict_lenient)} | ${yn(s.verdict_strict)} | ${d.status === "scored" ? d.result : d.status} | ${d.bucket ?? "–"} | ${s.earlier!.status} | ${s.surviving_fatal} | ${s.cost.roast_calls}+${s.cost.judge_calls} | ${s.cost.cost_usd === null ? "–" : `$${s.cost.cost_usd.toFixed(2)}`} | ${s.cost.wall_ms === null ? "–" : `${Math.round(s.cost.wall_ms / 1000)} s`} |\n`;
  }
  const t = rep.totals;
  md += `\n⚑ = decisive objection inside the shown window.\n`;
  md += `\nTotals: ${t.roast_calls} roast calls + ${t.judge_calls} judge calls; cost ${t.cost_usd === null ? "not reported" : `$${t.cost_usd}`}; wall ${Math.round(t.wall_ms / 60000)} min (sum over cases).\n`;

  md += `\n## Misses\n\n`;
  const misses = rep.scores.filter((s) => !s.error && (s.verdict_lenient === false || (s.decisive?.status === "scored" && !s.decisive.found_surviving) || s.earlier?.status === "not_found" || s.earlier?.status === "retrieved_only"));
  if (!misses.length) md += `None.\n`;
  for (const s of misses) {
    const c = byId.get(s.case_id)!;
    md += `### ${s.case_id}${rep.repeats > 1 ? ` r${s.repeat}` : ""}: ${c.title}\n\n`;
    if (s.verdict_lenient === false) md += `- **Verdict**: ${s.verdict}, but the outcome was ${s.outcome}.${s.false_alarm ? ` False alarm (${s.surviving_fatal} surviving fatal).` : ""}\n`;
    if (s.decisive?.status === "scored" && !s.decisive.found_surviving) {
      md += `- **Decisive objection** (${s.decisive_level ?? "unclassified"}-level${s.decisive_in_window ? ", inside the shown window" : ""}): ${s.decisive.result}${s.decisive.bucket ? ` (best match ${s.decisive.objection_id}, ${s.decisive.bucket})` : ""}. ${s.decisive.reason}\n`;
      for (const [i, d] of c.decisive_objections.entries()) {
        const lv = s.decisive_levels.find((x) => x.decisive_index === i + 1)?.level;
        md += `  - D${i + 1}${lv ? ` [${lv}]` : ""} ${d.who ?? ""}${d.date ? `, ${d.date}` : ""}: "${String(d.quote ?? "").replace(/\s+/g, " ").slice(0, 300)}"${d.message_url ? ` ([message](${d.message_url}))` : d.source ? ` (source: ${String(d.source).slice(0, 120)})` : ""}\n`;
      }
    }
    if (s.earlier?.status === "not_found" || s.earlier?.status === "retrieved_only") {
      md += `- **Earlier attempt** ${s.earlier.status === "retrieved_only" ? "retrieved but not listed as a prior attempt" : "not found"}: ${c.earlier_attempts.map((e) => e.thread_url).join(", ")}`;
      md += ` (in corpus as ${s.earlier.in_corpus.map((x) => `${x.rows.join("/")}${x.retrievable_before_cutoff ? "" : ", dated on/after cutoff"}`).join("; ")})\n`;
    }
    md += `\n`;
  }
  return md;
}

export function writeReport(rep: Report, cases: EvalCase[]): { md: string; json: string } {
  const dir = join(RESULTS_DIR, rep.run_id);
  const md = join(dir, "report.md"), json = join(dir, "report.json");
  writeFileSync(json, JSON.stringify(rep, null, 2) + "\n");
  writeFileSync(md, renderReport(rep, cases));
  return { md, json };
}
