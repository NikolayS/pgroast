// Scoring tests with fake roasts and a fake judge. No model, no network, no DB.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmBackend } from "../src/roast/llm.ts";
import type { Roast } from "../src/roast/schema.ts";
import { msgidOf, parseCases, type EvalCase } from "../src/eval/cases.ts";
import { judgePrompt } from "../src/eval/judge.ts";
import { renderReport, scoreRun } from "../src/eval/report.ts";
import { RESULTS_DIR } from "../src/eval/run.ts";
import { headline, scoreCase, scoreDecisive, scoreEarlier, survivingFatal, verdictMatch, type CorpusThreadRow } from "../src/eval/score.ts";

const FLAT = "https://www.postgresql.org/message-id/flat/";

function obj(id: string, severity: "fatal" | "fixable", title = id) {
  return { id, severity, title, category: "design", level: "1b", failure_scenario: `fs ${id}`, argument: `arg ${id}`, critic: { reasoning: "", refutation_kind: "none", original_severity: null } };
}

function roast(p: Partial<Record<string, unknown>> = {}): Roast {
  return {
    verdict: "LIKELY-REJECT", confidence: "high", backend: "test",
    objections: [obj("prior-1", "fatal"), obj("maint-1", "fixable")],
    other_surviving: [obj("sec-1", "fatal")],
    refuted: [obj("std-1", "fatal")],
    withdrawn: [],
    prior_attempts: [], precedents_retrieved: [],
    stats: { llm_calls: 10, wall_ms: 60_000, cost_usd: 1.5, dry_run: false },
    ...p,
  } as unknown as Roast;
}

const CASE: EvalCase = parseCases([{
  id: "c1", title: "pg_dump --where", outcome: "rejected", thread_url: FLAT + "a%40b.c", cutoff_date: "2020-01-01", blind_n: 3,
  decisive_objections: [{ who: "Tom", date: "2020-02-01", quote: "use COPY (SELECT ...) instead" }, { who: "Robert", quote: "breaks restore" }],
  earlier_attempts: [{ thread_url: "https://postgr.es/m/old%40x.org" }], post_training_cutoff: false,
}]).cases[0]!;

describe("cases", () => {
  test("loader keeps valid cases and reports bad ones", () => {
    const { cases, problems } = parseCases([
      { id: "ok", outcome: "Accepted", thread_url: "x@y", cutoff_date: "2024-01-01", blind_n: 2 },
      { id: "bad", outcome: "maybe", thread_url: "", cutoff_date: "x", blind_n: 0 },
      { id: "ok", outcome: "rejected", thread_url: "x@y", cutoff_date: "2024-01-01", blind_n: 2 },
    ]);
    expect(cases.map((c) => [c.id, c.outcome, c.post_training_cutoff])).toEqual([["ok", "accepted", null]]);
    expect(problems.length).toBe(2);
    expect(problems[1]).toContain("duplicate id");
  });
  test("message-id normalisation", () => {
    expect(msgidOf("https://postgr.es/m/old%40x.org")).toBe("old@x.org");
    expect(msgidOf(FLAT + "old@x.org")).toBe("old@x.org");
    expect(msgidOf("https://www.postgresql.org/message-id/old@x.org?foo#bar")).toBe("old@x.org");
    expect(msgidOf("<old@x.org>")).toBe("old@x.org");
    expect(msgidOf("https://example.com/nothing")).toBeNull();
  });
});

describe("(a) verdict", () => {
  test("mapping fixed in docs/eval.md", () => {
    expect(verdictMatch("rejected", "NEEDS-DESIGN-DISCUSSION")).toEqual({ lenient: true, strict: false });
    expect(verdictMatch("rejected", "LIKELY-REJECT")).toEqual({ lenient: true, strict: true });
    expect(verdictMatch("rejected", "NEEDS-COMMITTER-EYES")).toEqual({ lenient: false, strict: false });
    expect(verdictMatch("accepted", "NEEDS-COMMITTER-EYES")).toEqual({ lenient: true, strict: false });
    expect(verdictMatch("accepted", "NEEDS-DESIGN-DISCUSSION")).toEqual({ lenient: false, strict: false });
    expect(verdictMatch("reverted", "NEEDS-COMMITTER-EYES")).toEqual({ lenient: true, strict: false });
    expect(verdictMatch("reverted", "NO-FUNDAMENTAL-OBJECTION")).toEqual({ lenient: false, strict: false });
  });
});

describe("(b) decisive", () => {
  test("bucket comes from the roast, best item wins", () => {
    const d = scoreDecisive(CASE, roast(), [
      { decisive_index: 1, result: "partially", objection_id: "maint-1", reason: "r1" },
      { decisive_index: 2, result: "found", objection_id: "sec-1", reason: "r2" },
    ]);
    expect(d).toMatchObject({ status: "scored", result: "found", objection_id: "sec-1", bucket: "other_surviving", found_surviving: true });
  });
  test("found but refuted is not a headline hit", () => {
    const d = scoreDecisive(CASE, roast(), [{ decisive_index: 1, result: "found", objection_id: "std-1", reason: "r" }]);
    expect(d).toMatchObject({ result: "found", bucket: "refuted", found_surviving: false });
  });
  test("an unknown id cannot be 'found'", () => {
    const d = scoreDecisive(CASE, roast(), [{ decisive_index: 1, result: "found", objection_id: "ghost-9", reason: "r" }]);
    expect(d.result).toBe("not_found");
    expect(d.items[0]!.reason).toContain("unknown id");
  });
  test("n/a without decisive objections; not_scored without judge", () => {
    expect(scoreDecisive({ ...CASE, decisive_objections: [] }, roast(), null).status).toBe("n/a");
    expect(scoreDecisive(CASE, roast(), null).status).toBe("not_scored");
  });
  test("judge prompt has quotes and ids but no buckets", () => {
    const p = judgePrompt(CASE, roast());
    expect(p).toContain("use COPY (SELECT ...) instead");
    expect(p).toContain("id: std-1");
    expect(p).not.toMatch(/refuted|other_surviving/);
  });
});

describe("(c) earlier attempt", () => {
  const rows: CorpusThreadRow[] = [{ id: "cf:1", date: "2019-05-01", first_date: "2019-01-01", thread_urls: [FLAT + "old@x.org"] }];
  test("n/a / not in corpus / not_found / retrieved_only / found", () => {
    expect(scoreEarlier({ ...CASE, earlier_attempts: [] }, roast(), rows).status).toBe("n/a");
    expect(scoreEarlier(CASE, roast(), []).status).toBe("not in corpus");
    const nf = scoreEarlier(CASE, roast(), rows);
    expect(nf.status).toBe("not_found");
    expect(nf.in_corpus).toEqual([{ msgid: "old@x.org", rows: ["cf:1"], retrievable_before_cutoff: true }]);
    expect(scoreEarlier(CASE, roast({ precedents_retrieved: [{ thread_urls: [FLAT + "old%40x.org"] }] }), rows).status).toBe("retrieved_only");
    expect(scoreEarlier(CASE, roast({ prior_attempts: [{ thread_urls: [FLAT + "old@x.org"] }] }), rows).status).toBe("found");
  });
  test("retrievable_before_cutoff follows the --before rule", () => {
    const late = [{ ...rows[0]!, date: "2020-01-01" }];
    expect(scoreEarlier(CASE, roast(), late).in_corpus[0]!.retrievable_before_cutoff).toBe(false);
  });
});

describe("(d) false alarms and headline", () => {
  test("surviving fatal counts listed + other_surviving only", () => {
    expect(survivingFatal(roast())).toBe(2);
  });
  test("headline", () => {
    const acc: EvalCase = { ...CASE, id: "a1", outcome: "accepted", decisive_objections: [], earlier_attempts: [], post_training_cutoff: true };
    const s = [
      scoreCase(CASE, roast(), [{ decisive_index: 1, result: "found", objection_id: "prior-1", reason: "" }], [], { repeat: 1 }),
      scoreCase(acc, roast({ verdict: "NEEDS-DESIGN-DISCUSSION" }), null, [], { repeat: 1 }),
      scoreCase(acc, null, null, [], { repeat: 1, error: "boom" }),
    ];
    const h = headline(s);
    expect(h.cases).toBe(3);
    expect(h.errors).toBe(1);
    expect(h.verdict_lenient).toEqual({ num: 1, den: 2, pct: 50 });
    expect(h.decisive_found).toEqual({ num: 1, den: 1, pct: 100 });
    expect(h.earlier_not_in_corpus).toBe(1);
    expect(h.false_alarm_rate).toEqual({ num: 1, den: 1, pct: 100 });
    expect(s[1]!.false_alarm).toBe(true);
  });
});

describe("scoreRun end to end (fake judge, injected corpus rows)", () => {
  const runId = `_test-${process.pid}`;
  afterAll(() => rmSync(join(RESULTS_DIR, runId), { recursive: true, force: true }));
  test("reads roast.json, calls the judge once, caches it, writes a report", async () => {
    const dir = join(RESULTS_DIR, runId, "c1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "roast.json"), JSON.stringify(roast({ prior_attempts: [{ thread_urls: [FLAT + "old@x.org"] }] })));
    let calls = 0;
    const fake = (): LlmBackend => ({
      dryRun: false,
      stats: () => ({ calls, costUsd: 0.25 }),
      complete: async <T,>() => {
        calls++;
        return { items: [{ decisive_index: 1, result: "found", objection_id: "prior-1", reason: "same: use COPY" }] } as T;
      },
    });
    const rows = [{ id: "cf:1", date: "2019-05-01", first_date: "2019-01-01", thread_urls: [FLAT + "old@x.org"] }];
    const rep = await scoreRun({ runId, cases: [CASE], judgeBackend: fake, corpusRows: rows, log: () => undefined });
    expect(calls).toBe(1);
    expect(rep.scores[0]).toMatchObject({ verdict_lenient: true, verdict_strict: true, surviving_fatal: 2 });
    expect(rep.scores[0]!.decisive).toMatchObject({ result: "found", bucket: "listed" });
    expect(rep.scores[0]!.earlier!.status).toBe("found");
    expect(rep.scores[0]!.cost).toMatchObject({ roast_calls: 10, judge_calls: 1, cost_usd: 1.75 });
    expect(JSON.parse(readFileSync(join(dir, "judge.json"), "utf8")).items.length).toBe(1);
    // second scoring uses the cached judge reply
    await scoreRun({ runId, cases: [CASE], judgeBackend: fake, corpusRows: rows, log: () => undefined });
    expect(calls).toBe(1);
    const md = renderReport(rep, [CASE]);
    expect(md).toContain("(a) verdict match**: 1/1 (100%) lenient");
    expect(md).toContain("| c1 | rejected | no | LIKELY-REJECT (high) | yes | yes | found | listed | found | 2 | 10+1 | $1.75 | 60 s |");
  });
});
