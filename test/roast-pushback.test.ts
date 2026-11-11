import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli.ts";
import type { CompleteArgs, LlmBackend } from "../src/roast/llm.ts";
import {
  checkMapReply,
  chunkMessages,
  linkMessages,
  mergeThreads,
  pushbackSlug,
  renderMessage,
  renderPushbackMarkdown,
  runPushback,
  type MapCache,
  type Pushback,
  type PushbackInput,
} from "../src/roast/pushback.ts";
import { DISCLOSURE, validate } from "../src/roast/schema.ts";
import { parseCommitfestPatch } from "../src/thread/parse.ts";
import type { ThreadMessage } from "../src/thread/types.ts";

const msg = (n: number, from: string, date: string, body: string, id = `m${n}@example.org`): ThreadMessage => ({
  index: n,
  messageId: id,
  url: `https://www.postgresql.org/message-id/${encodeURIComponent(id)}`,
  from: `${from} <x(at)example(dot)org>`,
  date,
  subject: n === 1 ? "proposal: thing" : "Re: proposal: thing",
  body,
  attachments: [],
});

const T1 = "https://www.postgresql.org/message-id/flat/m1%40example.org";
const T2 = "https://www.postgresql.org/message-id/flat/n1%40example.org";
const thread1 = [
  msg(1, "Pat Author", "2017-10-26T07:00:00Z", "I propose a thing. Patch attached."),
  msg(2, "Rae Reviewer", "2017-11-02T10:00:00Z", "> I propose a thing.\n\nA variable can shadow a column of the same name, and then an existing query changes its meaning.\nThat is not acceptable to me."),
  msg(3, "Pat Author", "2018-01-10T10:00:00Z", "> A variable can shadow a column\n\nNew version: a warning is raised when a variable shadows a column."),
  msg(4, "Sam Second", "2019-05-05T10:00:00Z", "The patch needs a rebase."),
];
const thread2 = [
  msg(1, "Pat Author", "2021-04-15T10:00:00Z", "New implementation attached.", "n1@example.org"),
  msg(2, "Rae Reviewer", "2022-08-20T10:00:00Z", "A warning does not help: the query still changes its meaning silently in production.\nI still think the name resolution rule is wrong.", "n2@example.org"),
  msg(3, "Sam Second", "2019-05-05T10:00:00Z", "The patch needs a rebase.", "m4@example.org"), // the same mail, seen in both threads
  msg(4, "Pat Author", "2024-12-01T10:00:00Z", "Rebased. Nothing else changed.", "n4@example.org"),
];

function input(): PushbackInput {
  const messages = mergeThreads([
    { threadUrl: T1, messages: thread1 },
    { threadUrl: T2, messages: thread2 },
  ]);
  return {
    arg: "1608",
    cf: { id: 1608, url: "https://commitfest.postgresql.org/patch/1608/", title: "a thing", status: "Needs review", statuses: [{ cfId: 59, cfName: "PG20-1", status: "Needs review" }], authors: "Pat Author", reviewers: "", committer: "", tags: [], topic: "", targetVersion: "", created: null, threads: [], history: [], links: [], redacted: false },
    threads: [
      { url: T1, subject: "proposal: thing", messages: 4 },
      { url: T2, subject: "thing, new implementation", messages: 4 },
    ],
    messages,
    warnings: [],
  };
}

class Fake implements LlmBackend {
  readonly dryRun = false;
  calls: CompleteArgs[] = [];
  constructor(private readonly answer: (a: CompleteArgs) => unknown) {}
  stats() {
    return { calls: this.calls.length, costUsd: 0.1 };
  }
  async complete<T>(a: CompleteArgs): Promise<T> {
    this.calls.push(a);
    const v = this.answer(a);
    const errs = validate(v, a.schema);
    if (errs.length) throw new Error(`fake reply for ${a.label} invalid: ${errs.join("; ")}`);
    return v as T;
  }
}

const memCache = (): MapCache & { rows: Map<string, unknown> } => {
  const rows = new Map<string, unknown>();
  return { rows, get: (k) => rows.get(k) ?? null, put: (k, v) => void rows.set(k, v) };
};

describe("pushback: input and chunks", () => {
  test("threads are merged by date, one copy per message-id, numbered 1..N", () => {
    const m = input().messages;
    expect(m.map((x) => x.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(m.map((x) => x.messageId)).toEqual(["m1@example.org", "m2@example.org", "m3@example.org", "m4@example.org", "n1@example.org", "n2@example.org", "n4@example.org"]);
    expect(m[5]!.threadUrl).toBe(T2);
    expect(pushbackSlug(input())).toBe("pushback-cf-1608");
  });

  test("chunks are consecutive and size-capped; long messages are cut; quoted runs are collapsed", () => {
    const m = input().messages;
    const all = chunkMessages(m, 100_000);
    expect(all.length).toBe(1);
    const small = chunkMessages(m, 260);
    expect(small.flat().map((x) => x.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(small.length).toBeGreaterThan(2);
    for (const c of small) expect(c.length === 1 || c.map(renderMessage).join("\n\n").length <= 260).toBe(true);
    const long = renderMessage({ ...m[0]!, body: "x".repeat(20_000) });
    expect(long.length).toBeLessThan(5200);
    expect(long).toContain("[... message cut here ...]");
    expect(renderMessage(m[1]!)).toContain("### Message #2 | Rae Reviewer | 2017-11-02 |");
    expect(renderMessage(m[1]!)).not.toContain("example(dot)org");
  });

  test("a map reply is checked against the messages: own text only, known and later messages only", () => {
    const m = input().messages;
    const checks = { quotes_verified: 0, quotes_dropped: 0, candidates_dropped: 0, resolving_refs_dropped: 0 };
    const out = checkMapReply(
      {
        objections: [
          { message_index: 2, objection: "Shadowing changes the meaning of queries.", key_quote: "A variable can shadow a column of the same name, and then an existing query changes its meaning.", answered_in_part: true, answered_by_message_index: 3 },
          { message_index: 3, objection: "Quoted, not said.", key_quote: "A variable can shadow a column", answered_in_part: true, answered_by_message_index: 2 }, // only quoted there; answer is earlier
          { message_index: 2, objection: "Invented quote.", key_quote: "This whole feature is a mistake and must be dropped.", answered_in_part: false, answered_by_message_index: null },
          { message_index: 99, objection: "No such message.", key_quote: null, answered_in_part: false, answered_by_message_index: null },
        ],
        responses: [
          { message_index: 3, responds_to: "shadowing", kind: "new version", summary: "A warning was added." },
          { message_index: 42, responds_to: "x", kind: "rebuttal", summary: "y" },
        ],
        state_note: "",
      },
      m.slice(0, 4),
      1,
      { c: 1, r: 1 },
      checks,
    );
    expect(out.candidates.map((c) => [c.id, c.message.index, c.message.from, c.quote != null, c.answered_in_part, c.answered_by?.index ?? null])).toEqual([
      ["C1", 2, "Rae Reviewer", true, true, 3],
      ["C2", 3, "Pat Author", false, false, null],
      ["C3", 2, "Rae Reviewer", false, false, null],
    ]);
    expect(out.candidates[0]!.message.url).toBe("https://www.postgresql.org/message-id/m2%40example.org");
    expect(out.responses.map((r) => r.id)).toEqual(["R1"]);
    expect(checks).toEqual({ quotes_verified: 1, quotes_dropped: 2, candidates_dropped: 1, resolving_refs_dropped: 1 });
  });
});

describe("pushback: run (fake model)", () => {
  const answers = (bucket: string, evidence: number[]) => (a: CompleteArgs): unknown => {
    if (a.label.startsWith("pushback-map-")) {
      const has = (n: number) => a.prompt.includes(`### Message #${n} |`);
      return {
        objections: [
          ...(has(2) ? [{ message_index: 2, objection: "A variable can shadow a column and change what a query means.", key_quote: "A variable can shadow a column of the same name, and then an existing query changes its meaning.", answered_in_part: has(3), answered_by_message_index: has(3) ? 3 : null }] : []),
          ...(has(6) ? [{ message_index: 6, objection: "A warning does not remove the shadowing problem.", key_quote: "I still think the name resolution rule is wrong.", answered_in_part: false, answered_by_message_index: null }] : []),
          ...(has(4) ? [{ message_index: 4, objection: "Needs a rebase.", key_quote: "Rebase it, obviously.", answered_in_part: false, answered_by_message_index: null }] : []),
        ],
        responses: has(3) ? [{ message_index: 3, responds_to: "shadowing of columns", kind: "new version", summary: "A warning is raised on shadowing. See https://evil.example/x" }] : [],
        state_note: "Discussion of name resolution.",
      };
    }
    if (a.label === "pushback-reduce") {
      const cands = JSON.parse(a.prompt.split("# Candidate objections\n\n")[1]!.split("\n\n# Responses")[0]!) as { id: string; message: number }[];
      const idOf = (n: number) => cands.find((c) => c.message === n)!.id;
      return {
        objections: [
          { title: "Variables can shadow columns", statement: "A variable with the name of a column can change the meaning of an existing query.", candidate_ids: [idOf(2), idOf(6).toLowerCase(), "C77"], status: "unresolved", resolved_by_message_indexes: [3, 1, 500], status_reasoning: "The objection is repeated in message #6 after the warning of message #3.", blocking: true },
          { title: "Rebase", statement: "The patch obviously needed a rebase!", candidate_ids: [idOf(4)], status: "resolved", resolved_by_message_indexes: [], status_reasoning: "Rebased later.", blocking: false },
          { title: "Made up", statement: "Nothing.", candidate_ids: ["C99"], status: "unresolved", resolved_by_message_indexes: [], status_reasoning: "x", blocking: true },
        ],
        summary: "The open point is name resolution: see message #2 and message #6, and https://evil.example/thread. The warning of message #3 did not settle it. Message #77 does not exist.",
        bucket,
        bucket_reason: "The basic rule is contested and versions keep coming.",
        superseded_by: bucket === "dead or superseded" ? "another feature" : null,
        superseded_evidence_message_indexes: evidence,
      };
    }
    if (a.label === "tone-repair") return { rewrites: [{ n: 1, text: "The patch needed a rebase." }] };
    throw new Error(`unexpected ${a.label}`);
  };

  const cache = memCache();
  const backend = new Fake(answers("stuck: needs design rethink", []));
  const run = runPushback(input(), { backend, models: { map: "opus", reduce: "claude-mythos-5-2" }, cache, chunkChars: 700, log: () => undefined, now: () => new Date("2026-11-11T00:00:00Z") });

  test("map per chunk on the roaster model, one reduce on the critic model, one tone repair", async () => {
    const r = await run;
    const maps = backend.calls.filter((c) => c.label.startsWith("pushback-map-"));
    expect(maps.length).toBe(r.stats.chunks);
    expect(maps.length).toBeGreaterThan(1);
    expect(maps.every((c) => c.model === "opus")).toBe(true);
    expect(backend.calls.find((c) => c.label === "pushback-reduce")!.model).toBe("claude-mythos-5-2");
    expect(backend.calls.filter((c) => c.label === "tone-repair").length).toBe(1);
    expect(r.stats.llm_calls).toBe(maps.length + 2);
    expect(maps.map((c) => c.prompt).join("\n")).toContain("### Message #7 |"); // the whole thread, not a blind prefix
    expect(backend.calls.find((c) => c.label === "pushback-reduce")!.prompt).toContain("Last message: #7, 2024-12-01 (Pat Author)");
    expect(backend.calls.find((c) => c.label === "pushback-reduce")!.prompt).not.toContain("https://");
  });

  test("people, dates, quotes and links come from the messages; unknown ids and bad resolving refs are dropped", async () => {
    const r = await run;
    expect(r.objections.map((o) => o.title)).toEqual(["Variables can shadow columns", "Rebase"]);
    const o = r.objections[0]!;
    expect(o).toMatchObject({ status: "unresolved", blocking: true, raised_by: ["Rae Reviewer"], first_raised: "2017-11-02T10:00:00Z", last_raised: "2022-08-20T10:00:00Z" });
    expect(o.candidates.map((c) => [c.message.index, c.quote])).toEqual([
      [2, "A variable can shadow a column of the same name, and then an existing query changes its meaning."],
      [6, "I still think the name resolution rule is wrong."],
    ]);
    expect(o.resolved_by.map((m) => m.index)).toEqual([3]); // #1 is not later, #500 does not exist
    expect(r.checks).toMatchObject({ quotes_verified: 2, quotes_dropped: 1 });
    expect(r.checks.resolving_refs_dropped).toBe(2);
    expect(r.sanitizer.precedent_ids_dropped.map((d) => d.id)).toEqual(["C77", "C99"]);
    expect(r.warnings.join("\n")).toContain('"Made up" names no known candidate');
    // "resolved" with no later message that shows it is not accepted as resolved
    expect(r.objections[1]).toMatchObject({ status: "partly resolved", blocking: false });
    expect(r.warnings.join("\n")).toContain('"Rebase" was marked "resolved" with no later message');
    expect(r.input).toMatchObject({ messages: 7, last_message: "2024-12-01T10:00:00Z", last_message_from: "Pat Author", messages_per_year: { "2017": 2, "2018": 1, "2019": 1, "2021": 1, "2022": 1, "2024": 1 } });
    expect(r.bucket).toBe("stuck: needs design rethink");
    expect(r.superseded_by).toBeNull();
  });

  test("links from the model are removed, the tone lint runs, the disclosure is verbatim", async () => {
    const r = await run;
    expect(JSON.stringify(r.summary)).not.toContain("evil.example");
    expect(JSON.stringify(r.responses)).not.toContain("evil.example");
    expect(r.sanitizer.urls_removed.length).toBe(2);
    expect(r.objections[1]!.statement).toBe("The patch needed a rebase.");
    expect(r.tone_lint).toMatchObject({ hits_found: 2, sentences_rewritten: 1, repair_call: "done", remaining: [] });
    expect(r.disclosure).toBe(DISCLOSURE);
  });

  test("markdown: built by code, message numbers become links, every link is a message or thread of the entry", async () => {
    const r = await run;
    const md = renderPushbackMarkdown(r);
    expect(md).toContain("# Open objections: a thing");
    expect(md.split(DISCLOSURE).length - 1).toBe(2);
    expect(md).toContain("- Last moved: 2024-12-01 (Pat Author)");
    expect(md).toContain("**Recommended bucket: stuck: needs design rethink.**");
    expect(md).toContain("see message [#2](https://www.postgresql.org/message-id/m2%40example.org) and message [#6](https://www.postgresql.org/message-id/n2%40example.org)");
    expect(md).toContain("Message #77 does not exist."); // unknown number: left as text
    expect(md).toContain('- [#6 (Rae Reviewer, 2022-08-20)](https://www.postgresql.org/message-id/n2%40example.org): "I still think the name resolution rule is wrong."');
    expect(md).toContain("- **Raised by:** Rae Reviewer; first 2017-11-02, last 2022-08-20");
    expect(md).toContain("quote unavailable. In short: Needs a rebase.");
    expect(md.replace(/pgroast/g, "")).not.toMatch(/roast|steelman/i);
    const ok = new Set([T1, T2, "https://commitfest.postgresql.org/patch/1608/", ...input().messages.map((m) => m.url)]);
    const links = [...md.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(6);
    for (const l of links) expect(ok.has(l)).toBe(true);
    expect(linkMessages("messages #2 and message #9", new Map([[2, "https://x/2"]]))).toBe("messages [#2](https://x/2) and message #9");
  });

  test("a second run takes the map replies from the cache", async () => {
    const first = await run;
    const b2 = new Fake(answers("stuck: needs design rethink", []));
    const r2 = await runPushback(input(), { backend: b2, models: { map: "opus", reduce: "claude-mythos-5-2" }, cache, chunkChars: 700, log: () => undefined });
    expect(cache.rows.size).toBe(first.stats.chunks);
    expect(b2.calls.some((c) => c.label.startsWith("pushback-map-"))).toBe(false);
    expect(r2.stats.map_from_cache).toBe(first.stats.chunks);
    expect(r2.objections.map((o) => o.title)).toEqual(first.objections.map((o) => o.title));
  });

  test('"dead or superseded" needs a message that shows it; age and silence are not evidence', async () => {
    const none: Pushback = await runPushback(input(), { backend: new Fake(answers("dead or superseded", [900])), models: { map: "opus", reduce: "claude-mythos-5-2" }, cache: null, log: () => undefined });
    expect(none.bucket).toBe("stuck: needs design rethink");
    expect(none.superseded_by).toBeNull();
    expect(none.warnings.join("\n")).toContain("age and silence are not evidence");
    const shown = await runPushback(input(), { backend: new Fake(answers("dead or superseded", [7])), models: { map: "opus", reduce: "claude-mythos-5-2" }, cache: null, log: () => undefined });
    expect(shown.bucket).toBe("dead or superseded");
    expect(shown.superseded_by).toBe("another feature");
    expect(shown.superseded_evidence.map((m) => m.index)).toEqual([7]);
    expect(renderPushbackMarkdown(shown)).toContain("Superseded by: another feature; shown in [#7 (Pat Author, 2024-12-01)]");
  });

  test("a part that fails is reported; the run goes on", async () => {
    const b = new Fake((a) => {
      if (a.label === "pushback-map-1") throw new Error("boom");
      return answers("active", [])(a);
    });
    const r = await runPushback(input(), { backend: b, models: { map: "opus", reduce: "claude-mythos-5-2" }, cache: null, chunkChars: 700, log: () => undefined });
    expect(r.warnings.join("\n")).toContain("part 1 (messages #1 to #");
    expect(r.chunk_notes.some((n) => n.chunk === 1)).toBe(false);
  });
});

describe("pushback: CLI and CommitFest page", () => {
  test("arguments", () => {
    expect(parseArgs(["pushback", "1608", "--dry-run"])).toMatchObject({ pushback: true, input: "1608", dryRun: true });
    expect(() => parseArgs(["pushback"])).toThrow(/pushback needs/);
    expect(() => parseArgs(["pushback", "1608", "--blind", "3"])).toThrow(/whole thread/);
    expect(() => parseArgs(["pushback", "1608", "--self"])).toThrow(/does not apply/);
  });

  test("a CommitFest entry whose Emails row holds a nested table still lists its threads", () => {
    const html = `<table class="table table-bordered"><tr><th>Title</th><td>declarative session variables</td></tr>
<tr><th>Emails</th><td><dl>
<dt><a href="https://www.postgresql.org/message-id/flat/a+b@mail.example.org">proposal: schema variables</a></dt>
<dd>First at <a href="https://www.postgresql.org/message-id/a+b@mail.example.org">2017-10-26 07:21:24</a> by Pat Author &lt;p at example.org&gt;<br/>
Latest at <a href="https://www.postgresql.org/message-id/z@mail.example.org">2026-04-03 19:10:13</a> by Pat Author<br/>
<div><h4>Annotations</h4><table><thead><tr><th>When</th><th>Who</th></tr></thead></table></div></dd>
<dt><a href="https://www.postgresql.org/message-id/flat/second@mail.example.org">new implementation</a></dt>
<dd>First at <a href="https://www.postgresql.org/message-id/second@mail.example.org">2021-04-15 10:00:00</a> by Pat Author<br/></dd>
</dl></td></tr>
<tr><th>History</th><td><table><tr><th>When</th><th>Who</th><th>What</th></tr></table></td></tr></table>`;
    const cf = parseCommitfestPatch(html, 1608);
    expect(cf.threads.map((t) => t.messageId)).toEqual(["a+b@mail.example.org", "second@mail.example.org"]);
    expect(cf.threads[0]!.latestAt).toContain("2026-04-03");
  });
});
