// Pure scoring functions. The rules are those in docs/eval.md, fixed before
// any result existed. Nothing here calls a model or the network.

import type { FinalObjection, Roast, Verdict } from "../roast/schema.ts";
import { msgidOf, type EvalCase, type Outcome } from "./cases.ts";

// ---------------------------------------------------------------- (a) verdict

const LENIENT: Record<Outcome, readonly Verdict[]> = {
  rejected: ["LIKELY-REJECT", "NEEDS-DESIGN-DISCUSSION"],
  accepted: ["NO-FUNDAMENTAL-OBJECTION", "NEEDS-COMMITTER-EYES"],
  reverted: ["LIKELY-REJECT", "NEEDS-DESIGN-DISCUSSION", "NEEDS-COMMITTER-EYES"],
};
const STRICT: Record<Outcome, readonly Verdict[]> = {
  rejected: ["LIKELY-REJECT"],
  accepted: ["NO-FUNDAMENTAL-OBJECTION"],
  reverted: ["LIKELY-REJECT", "NEEDS-DESIGN-DISCUSSION"],
};

export function verdictMatch(outcome: Outcome, verdict: Verdict): { lenient: boolean; strict: boolean } {
  return { lenient: LENIENT[outcome].includes(verdict), strict: STRICT[outcome].includes(verdict) };
}

// ---------------------------------------------------------------- objections by bucket

export type Bucket = "listed" | "other_surviving" | "refuted" | "withdrawn";

export interface BucketedObjection {
  id: string;
  bucket: Bucket;
  severity: string;
  title: string;
  category: string;
  level: string;
  failure_scenario: string;
  argument: string;
  critic_reasoning: string;
}

export function bucketedObjections(r: Roast): BucketedObjection[] {
  const out: BucketedObjection[] = [];
  const add = (list: FinalObjection[] | undefined, bucket: Bucket) => {
    for (const o of list ?? []) {
      out.push({
        id: o.id, bucket, severity: o.severity, title: o.title, category: o.category, level: o.level,
        failure_scenario: o.failure_scenario, argument: o.argument, critic_reasoning: o.critic?.reasoning ?? "",
      });
    }
  };
  add(r.objections, "listed");
  add(r.other_surviving, "other_surviving");
  add(r.refuted, "refuted");
  add((r as Roast & { withdrawn?: FinalObjection[] }).withdrawn, "withdrawn");
  return out;
}

// ---------------------------------------------------------------- (b) decisive objection

export type JudgeResult = "found" | "partially" | "not_found";

export interface JudgeItem {
  decisive_index: number;
  result: JudgeResult;
  objection_id: string | null;
  reason: string;
}

export interface DecisiveScore {
  status: "scored" | "n/a" | "not_scored";
  /** best result across the case's decisive objections */
  result: JudgeResult | null;
  objection_id: string | null;
  /** looked up by code from the roast, not taken from the judge */
  bucket: Bucket | null;
  reason: string;
  /** headline: found in listed or other_surviving */
  found_surviving: boolean;
  items: (JudgeItem & { bucket: Bucket | null })[];
}

const RANK: Record<JudgeResult, number> = { found: 2, partially: 1, not_found: 0 };
const BUCKET_RANK: Record<Bucket, number> = { listed: 3, other_surviving: 2, refuted: 1, withdrawn: 0 };

export function scoreDecisive(c: EvalCase, r: Roast, judge: JudgeItem[] | null): DecisiveScore {
  if (!c.decisive_objections.length) {
    return { status: "n/a", result: null, objection_id: null, bucket: null, reason: "case has no decisive objection", found_surviving: false, items: [] };
  }
  if (!judge) {
    return { status: "not_scored", result: null, objection_id: null, bucket: null, reason: "judge not run", found_surviving: false, items: [] };
  }
  const byId = new Map(bucketedObjections(r).map((o) => [o.id, o.bucket]));
  const items = judge.map((j) => {
    const bucket = j.objection_id ? (byId.get(j.objection_id) ?? null) : null;
    // an id the roast does not contain cannot support "found"
    const result: JudgeResult = j.result !== "not_found" && !bucket ? "not_found" : j.result;
    return { ...j, result, bucket, reason: bucket || j.result === "not_found" ? j.reason : `${j.reason} [judge cited unknown id ${j.objection_id}]` };
  });
  const best = [...items].sort((a, b) =>
    RANK[b.result] - RANK[a.result] || (b.bucket ? BUCKET_RANK[b.bucket] : -1) - (a.bucket ? BUCKET_RANK[a.bucket] : -1))[0];
  if (!best) {
    return { status: "not_scored", result: null, objection_id: null, bucket: null, reason: "judge returned no items", found_surviving: false, items };
  }
  return {
    status: "scored",
    result: best.result,
    objection_id: best.result === "not_found" ? null : best.objection_id,
    bucket: best.result === "not_found" ? null : best.bucket,
    reason: best.reason,
    found_surviving: best.result === "found" && (best.bucket === "listed" || best.bucket === "other_surviving"),
    items,
  };
}

// ---------------------------------------------------------------- (c) earlier attempt

export interface CorpusThreadRow {
  id: string;
  date: string | null;
  first_date: string | null;
  thread_urls: string[];
}

export type EarlierStatus = "found" | "retrieved_only" | "not_found" | "not in corpus" | "n/a";

export interface EarlierScore {
  status: EarlierStatus;
  /** earlier-attempt thread ids that are in the corpus, with the row ids holding them */
  in_corpus: { msgid: string; rows: string[]; retrievable_before_cutoff: boolean }[];
  matched: string[];
}

/** before-rule of docs/corpus.md: every known date strictly before cutoff */
function datedBefore(row: CorpusThreadRow, cutoff: string): boolean {
  const a = row.first_date ?? row.date, b = row.date ?? row.first_date;
  return !!a && !!b && a < cutoff && b < cutoff;
}

export function scoreEarlier(c: EvalCase, r: Roast, corpusRows: CorpusThreadRow[]): EarlierScore {
  const wanted = [...new Set(c.earlier_attempts.map((e) => msgidOf(e.thread_url)).filter((x): x is string => !!x))];
  if (!wanted.length) return { status: "n/a", in_corpus: [], matched: [] };
  const rowsByMsgid = new Map<string, CorpusThreadRow[]>();
  for (const row of corpusRows) {
    for (const t of row.thread_urls) {
      const m = msgidOf(t);
      if (m && wanted.includes(m)) rowsByMsgid.set(m, [...(rowsByMsgid.get(m) ?? []), row]);
    }
  }
  const inCorpus = wanted.filter((m) => rowsByMsgid.has(m)).map((m) => ({
    msgid: m,
    rows: rowsByMsgid.get(m)!.map((x) => x.id),
    retrievable_before_cutoff: rowsByMsgid.get(m)!.some((x) => datedBefore(x, c.cutoff_date)),
  }));
  const ids = (urls: string[]) => urls.map(msgidOf).filter((x): x is string => !!x);
  const prior = new Set((r.prior_attempts ?? []).flatMap((p) => ids(p.thread_urls ?? [])));
  const retrieved = new Set((r.precedents_retrieved ?? []).flatMap((p) => ids(p.thread_urls ?? [])));
  const inPrior = wanted.filter((m) => prior.has(m));
  if (inPrior.length) return { status: "found", in_corpus: inCorpus, matched: inPrior };
  const inRetrieved = wanted.filter((m) => retrieved.has(m));
  if (inRetrieved.length) return { status: "retrieved_only", in_corpus: inCorpus, matched: inRetrieved };
  if (!inCorpus.length) return { status: "not in corpus", in_corpus: [], matched: [] };
  return { status: "not_found", in_corpus: inCorpus, matched: [] };
}

// ---------------------------------------------------------------- (d) false alarms

export function survivingFatal(r: Roast): number {
  return [...(r.objections ?? []), ...(r.other_surviving ?? [])].filter((o) => o.severity === "fatal").length;
}

export function isFalseAlarm(c: EvalCase, r: Roast): boolean | null {
  if (c.outcome !== "accepted") return null;
  return r.verdict === "LIKELY-REJECT" || r.verdict === "NEEDS-DESIGN-DISCUSSION";
}

// ---------------------------------------------------------------- per case + aggregate

export interface CaseScore {
  case_id: string;
  title: string;
  outcome: Outcome;
  post_training_cutoff: boolean | null;
  repeat: number;
  verdict: Verdict | null;
  confidence: string | null;
  error: string | null;
  verdict_lenient: boolean | null;
  verdict_strict: boolean | null;
  decisive: DecisiveScore | null;
  earlier: EarlierScore | null;
  surviving_fatal: number | null;
  false_alarm: boolean | null;
  cost: { roast_calls: number; judge_calls: number; cost_usd: number | null; wall_ms: number | null };
}

export function scoreCase(c: EvalCase, r: Roast | null, judge: JudgeItem[] | null, corpusRows: CorpusThreadRow[],
  extra: { repeat: number; error?: string | null; judgeCalls?: number; judgeCost?: number | null; wallMs?: number | null }): CaseScore {
  const base = {
    case_id: c.id, title: c.title, outcome: c.outcome, post_training_cutoff: c.post_training_cutoff, repeat: extra.repeat,
  };
  if (!r) {
    return {
      ...base, verdict: null, confidence: null, error: extra.error ?? "no roast.json",
      verdict_lenient: null, verdict_strict: null, decisive: null, earlier: null, surviving_fatal: null, false_alarm: null,
      cost: { roast_calls: 0, judge_calls: extra.judgeCalls ?? 0, cost_usd: null, wall_ms: extra.wallMs ?? null },
    };
  }
  const vm = verdictMatch(c.outcome, r.verdict);
  const rc = r.stats?.cost_usd ?? null, jc = extra.judgeCost ?? null;
  return {
    ...base, verdict: r.verdict, confidence: r.confidence, error: null,
    verdict_lenient: vm.lenient, verdict_strict: vm.strict,
    decisive: scoreDecisive(c, r, judge),
    earlier: scoreEarlier(c, r, corpusRows),
    surviving_fatal: survivingFatal(r),
    false_alarm: isFalseAlarm(c, r),
    cost: {
      roast_calls: r.stats?.llm_calls ?? 0, judge_calls: extra.judgeCalls ?? 0,
      cost_usd: rc === null && jc === null ? null : (rc ?? 0) + (jc ?? 0),
      wall_ms: extra.wallMs ?? r.stats?.wall_ms ?? null,
    },
  };
}

export interface Ratio { num: number; den: number; pct: number | null }
const ratio = (num: number, den: number): Ratio => ({ num, den, pct: den ? Math.round((1000 * num) / den) / 10 : null });

export interface Headline {
  cases: number;
  errors: number;
  verdict_lenient: Ratio;
  verdict_strict: Ratio;
  decisive_found: Ratio;
  decisive_found_or_partial: Ratio;
  decisive_found_but_refuted: number;
  earlier_found: Ratio;
  earlier_not_in_corpus: number;
  earlier_retrieved_only: number;
  false_alarm_rate: Ratio;
}

export function headline(scores: CaseScore[]): Headline {
  const ok = scores.filter((s) => !s.error);
  const dec = ok.filter((s) => s.decisive?.status === "scored");
  const ear = ok.filter((s) => s.earlier && s.earlier.status !== "n/a" && s.earlier.status !== "not in corpus");
  const acc = ok.filter((s) => s.outcome === "accepted");
  return {
    cases: scores.length,
    errors: scores.length - ok.length,
    verdict_lenient: ratio(ok.filter((s) => s.verdict_lenient).length, ok.length),
    verdict_strict: ratio(ok.filter((s) => s.verdict_strict).length, ok.length),
    decisive_found: ratio(dec.filter((s) => s.decisive!.found_surviving).length, dec.length),
    decisive_found_or_partial: ratio(dec.filter((s) => s.decisive!.result === "found" || s.decisive!.result === "partially").length, dec.length),
    decisive_found_but_refuted: dec.filter((s) => s.decisive!.result === "found" && s.decisive!.bucket === "refuted").length,
    earlier_found: ratio(ear.filter((s) => s.earlier!.status === "found").length, ear.length),
    earlier_not_in_corpus: ok.filter((s) => s.earlier?.status === "not in corpus").length,
    earlier_retrieved_only: ok.filter((s) => s.earlier?.status === "retrieved_only").length,
    false_alarm_rate: ratio(acc.filter((s) => s.false_alarm).length, acc.length),
  };
}
