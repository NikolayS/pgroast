import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLimitError, parseBatchArgs, parseCommitfestList, runBatch, selectEntries, type BatchEntry } from "../src/batch.ts";
import type { Roast } from "../src/roast/schema.ts";

const row = (id: number, title: string, status: string) =>
  `<tr><td class="wrap-text patch-column"><a href="/patch/${id}/">${title}</a></td><td>${id}</td><td><span class="badge bg-secondary">${status}</span></td><td><a href="?tag=13"><span class="badge" style="background-color: #1a5fb4;">Performance</span></a></td><td></td><td class="cfbot-summary"></td><td></td><td class="wrap-text">Pat Author (pat)</td></tr>`;
const html = `<table><tr><th>Patch</th></tr>${row(30, "Thing &amp; other", "Needs review")}${row(10, "Done thing", "Committed")}${row(20, "Ready thing", "Ready for Committer")}${row(30, "Thing &amp; other", "Needs review")}</table>`;

describe("batch", () => {
  test("the commitfest listing is parsed; open entries are selected in id order", () => {
    const all = parseCommitfestList(html);
    expect(all).toEqual([
      { id: 30, title: "Thing & other", status: "Needs review", authors: "Pat Author (pat)" },
      { id: 10, title: "Done thing", status: "Committed", authors: "Pat Author (pat)" },
      { id: 20, title: "Ready thing", status: "Ready for Committer", authors: "Pat Author (pat)" },
    ]);
    expect(selectEntries(all, {}).map((e) => e.id)).toEqual([20, 30]);
    expect(selectEntries(all, { status: "all" }).map((e) => e.id)).toEqual([10, 20, 30]);
    expect(selectEntries(all, { status: "committed" }).map((e) => e.id)).toEqual([10]);
    expect(selectEntries(all, { limit: 1 }).map((e) => e.id)).toEqual([20]);
    expect(selectEntries(all, { only: [30, 10] }).map((e) => e.id)).toEqual([30]);
  });

  test("arguments", () => {
    expect(parseBatchArgs(["62", "--out", "x", "--blind", "3", "--concurrency", "2", "--only", "5,6"])).toMatchObject({ cf: 62, outDir: "x", blind: 3, concurrency: 2, only: [5, 6] });
    expect(() => parseBatchArgs(["--out", "x"])).toThrow(/commitfest number/);
    expect(() => parseBatchArgs(["62"])).toThrow(/--out/);
    expect(isLimitError("claude returned an error: You've hit your 5-hour limit · resets 4pm")).toBe(true);
    expect(isLimitError("claude returned an error: invalid JSON")).toBe(false);
  });

  test("resumable; a usage limit stops the run without marking the entry failed; an index is written", async () => {
    const out = mkdtempSync(join(tmpdir(), "pgroast-batch-"));
    const entries: BatchEntry[] = [1, 2, 3, 4].map((id) => ({ id, title: `t${id}`, status: "Needs review", authors: "" }));
    const fake = (id: number) => ({ verdict: "NEEDS-COMMITTER-EYES", confidence: "low", objections: [], prior_attempts: [], stats: { wall_ms: 0, llm_calls: 3 } }) as unknown as Roast;
    const calls: number[] = [];
    const base = { cf: 62, outDir: out, concurrency: 1, log: () => undefined, listFn: async () => entries };
    // the renderers need a full Roast; this test is about the control flow, so stop before them
    const first = await runBatch({
      ...base,
      roastOne: async (e) => {
        calls.push(e.id);
        if (e.id === 2) throw new Error("boom");
        if (e.id === 3) throw new Error("claude returned an error: You've hit your 5-hour limit");
        throw new Error(`render:${JSON.stringify(fake(e.id)).length}`);
      },
    });
    expect(calls).toEqual([1, 2, 3]); // 4 is not started after the limit
    expect(first).toMatchObject({ done: 0, failed: 2, selected: 4 });
    expect(first.stopped).toContain("5-hour limit");
    expect(existsSync(join(out, "cf", "2", "error.json"))).toBe(true);
    expect(existsSync(join(out, "cf", "3"))).toBe(false);
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain("Entries selected: 4; done: 0; failed: 2; not yet run: 2.");
  });
});
