import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.ts";
import {
  API_KEY_VARS,
  assertAllowedModel,
  childEnv,
  ClaudeCliBackend,
  CliBackend,
  claudeArgs,
  codexArgs,
  CODEX_DEFAULT,
  parseCodexStream,
  pickBackend,
  DryRunBackend,
  extractJson,
  modelsFromEnv,
  parseClaudeStream,
  Semaphore,
  stubFor,
  type CompleteArgs,
  type LlmBackend,
} from "../src/roast/llm.ts";
import { renderMaterial, trimQuotes } from "../src/roast/material.ts";
import { assemble, describeSchema, loadPrompts, roasterSystem, runRoast, slugFor } from "../src/roast/pipeline.ts";
import { messageIdOfUrl, normalisePrecedent, recencyBoost, retrievePrecedents, type RawPrecedent, type SearchArgs } from "../src/roast/precedents.ts";
import { renderMarkdown } from "../src/roast/render.ts";
import { AllowedUrls, emptyReport, filterPrecedentIds, REMOVED_LINK, scrubUrls, verifyQuote } from "../src/roast/sanitize.ts";
import {
  ANGLES,
  BRIEF_SCHEMA,
  CRITIC_SCHEMA,
  DISCLOSURE,
  ROASTER_SCHEMA,
  SYNTH_SCHEMA,
  TOUCH_POINT_IDS,
  TOUCH_POINTS,
  validate,
  type Brief,
  type CriticOutput,
  type FinalObjection,
  type Precedent,
  type RawObjection,
  type RoasterOutput,
  type SynthOutput,
} from "../src/roast/schema.ts";
import { filterMessages, redactCf } from "../src/thread/load.ts";
import { parseCommitfestPatch, parseFlatThread } from "../src/thread/parse.ts";
import type { ProposalInput } from "../src/thread/types.ts";

const FIX = join(import.meta.dir, "thread-fixtures");
const flatHtml = readFileSync(join(FIX, "flat_int64_gucs.html"), "utf8");
const cfHtml = readFileSync(join(FIX, "cf_patch_5253.html"), "utf8");

function proposal(blind: number | null = 5): ProposalInput {
  const full = parseFlatThread(flatHtml);
  const filters = { blind, before: null };
  return {
    input: "5253",
    ref: { kind: "cf", id: 5253 },
    cf: redactCf(parseCommitfestPatch(cfHtml, 5253), filters),
    thread: { ...full, messages: filterMessages(full.messages, filters) },
    totalMessages: full.messages.length,
    filters,
    threadStart: full.messages[0]!.date,
    patchProse: [],
    warnings: [],
  };
}

// ----------------------------------------------------------------------------- schema

describe("validate", () => {
  test("accepts stubs of every stage schema", () => {
    for (const s of [BRIEF_SCHEMA, ROASTER_SCHEMA, CRITIC_SCHEMA, SYNTH_SCHEMA]) {
      expect(validate(stubFor(s), s)).toEqual([]);
    }
  });
  test("reports type, enum, missing key, and list size problems with paths", () => {
    const bad = { objections: [{ title: "", level: "9", severity: "fatal" }], prior_attempts: "no", no_objection_note: 1 };
    const errs = validate(bad, ROASTER_SCHEMA).join("\n");
    expect(errs).toContain("$.objections[0].title: must not be empty");
    expect(errs).toContain('$.objections[0].level: "9" is not one of');
    expect(errs).toContain("$.objections[0].failure_scenario: missing");
    expect(errs).toContain("$.prior_attempts: expected array, got string");
    expect(errs).toContain("$.no_objection_note: expected string, got number");
    expect(validate({ ...(stubFor(BRIEF_SCHEMA) as object), search_queries: ["a"] }, BRIEF_SCHEMA)[0]).toContain("at least 5");
  });
  test("nullable", () => {
    const s = stubFor(SYNTH_SCHEMA) as SynthOutput;
    expect(s.failing_level).toBeNull();
    expect(validate({ ...s, verdict: null }, SYNTH_SCHEMA).length).toBe(1);
  });
  test("there are 15 touch points and 7 angles", () => {
    expect(TOUCH_POINTS.length).toBe(15);
    expect(new Set(TOUCH_POINT_IDS).size).toBe(15);
    expect(ANGLES.length).toBe(7);
    expect(ANGLES).toContain("demand");
  });
});

// ----------------------------------------------------------------------------- llm

describe("extractJson", () => {
  test("plain, fenced, and with prose around", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: "}" } });
    expect(extractJson('Here you go: {"a":"x \\" {"} trailing')).toEqual({ a: 'x " {' });
    expect(extractJson('a set {x, y} then {"ok":true}')).toEqual({ ok: true });
  });
  test("throws when there is none", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("models", () => {
  test("only Opus and Mythos", () => {
    expect(assertAllowedModel("opus")).toBe("opus");
    expect(assertAllowedModel("claude-mythos-5-2")).toBe("claude-mythos-5-2");
    expect(() => assertAllowedModel("sonnet")).toThrow();
    expect(() => assertAllowedModel("claude-haiku-5-5")).toThrow();
    expect(() => assertAllowedModel("gpt-x")).toThrow();
  });
  test("defaults and env", () => {
    expect(modelsFromEnv({})).toEqual({ roaster: "opus", critic: "claude-mythos-5-2", synth: "claude-mythos-5-2", brief: "opus" });
    expect(modelsFromEnv({ PGROAST_ROASTER_MODEL: "claude-opus-5-5", PGROAST_CRITIC_MODEL: "opus" }).critic).toBe("opus");
    expect(() => modelsFromEnv({ PGROAST_ROASTER_MODEL: "sonnet" })).toThrow();
  });
});

describe("backend selection and API keys", () => {
  test("API key variables never reach the CLI", () => {
    const env = childEnv({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "a", ANTHROPIC_AUTH_TOKEN: "b", OPENAI_API_KEY: "c", CODEX_API_KEY: "d", X: undefined });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(API_KEY_VARS).toContain("ANTHROPIC_API_KEY");
    expect(API_KEY_VARS).toContain("OPENAI_API_KEY");
  });
  test("--backend, PGROAST_BACKEND, then claude if installed, else codex", () => {
    const both = (b: string) => `/bin/${b}`;
    const onlyCodex = (b: string) => (b === "codex" ? "/bin/codex" : null);
    expect(pickBackend("codex", {}, both)).toBe("codex");
    expect(pickBackend(undefined, { PGROAST_BACKEND: "codex" }, both)).toBe("codex");
    expect(pickBackend("claude", { PGROAST_BACKEND: "codex" }, both)).toBe("claude");
    expect(pickBackend(undefined, {}, both)).toBe("claude");
    expect(pickBackend(undefined, {}, onlyCodex)).toBe("codex");
    expect(() => pickBackend(undefined, {}, () => null)).toThrow(/doctor/);
    expect(() => pickBackend("gemini", {}, both)).toThrow(/unknown backend/);
  });
  test("codex models: PGROAST_CODEX_MODEL or the CLI default, no name guessed", () => {
    expect(modelsFromEnv({}, "codex").roaster).toBe(CODEX_DEFAULT);
    expect(modelsFromEnv({ PGROAST_CODEX_MODEL: "some-model", PGROAST_ROASTER_MODEL: "opus" }, "codex")).toEqual({ roaster: "some-model", critic: "some-model", synth: "some-model", brief: "some-model" });
    expect(codexArgs(CODEX_DEFAULT, "/tmp/x")).not.toContain("-m");
    const a = codexArgs("some-model", "/tmp/x");
    expect(a[a.indexOf("-m") + 1]).toBe("some-model");
  });
  test("codex flags: read-only sandbox, no user config, shell and web search off, prompt from stdin", () => {
    const a = codexArgs(CODEX_DEFAULT, "/tmp/x");
    expect(a[0]).toBe("exec");
    expect(a[a.indexOf("-s") + 1]).toBe("read-only");
    expect(a[a.indexOf("-C") + 1]).toBe("/tmp/x");
    for (const f of ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) expect(a).toContain(f);
    expect(a).toContain('web_search="disabled"');
    for (const f of ["shell_tool", "unified_exec", "apps", "plugins", "browser_use"]) expect(a[a.indexOf(f) - 1]).toBe("--disable");
    expect(a[a.length - 1]).toBe("-");
    expect(a.some((x) => x.includes("dangerously"))).toBe(false);
  });
  test("codex stream: last message wins; any tool item, error or empty output is refused", () => {
    const ev = (o: object) => JSON.stringify(o);
    const ok = [
      ev({ type: "thread.started", thread_id: "t" }),
      ev({ type: "turn.started" }),
      ev({ type: "item.completed", item: { id: "1", type: "reasoning", text: "thinking" } }),
      ev({ type: "item.completed", item: { id: "2", type: "agent_message", text: '{"ok":true}' } }),
      ev({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 3 } }),
    ].join("\n");
    const r = parseCodexStream(ok);
    expect(r.text).toBe('{"ok":true}');
    expect(r.costUsd).toBeNull();
    expect(r.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
    for (const kind of ["command_execution", "web_search", "mcp_tool_call", "file_change"]) {
      const bad = [ev({ type: "item.started", item: { id: "1", type: kind } }), ev({ type: "item.completed", item: { id: "2", type: "agent_message", text: "{}" } })].join("\n");
      expect(() => parseCodexStream(bad)).toThrow(/used a tool/);
    }
    expect(() => parseCodexStream(ev({ type: "turn.failed", error: { message: "not logged in" } }))).toThrow(/not logged in/);
    expect(() => parseCodexStream("")).toThrow(/no events/);
    expect(() => parseCodexStream(ev({ type: "turn.completed" }))).toThrow(/no final message/);
  });
  test("the codex driver puts the system text first and accepts any model name", async () => {
    let seen = "";
    const b: CliBackend = new CliBackend({
      backend: "codex",
      transcriptDir: mkdtempSync(join(tmpdir(), "pgroast-llm-test-")),
      log: () => undefined,
      runner: async (a, prompt) => ((seen = b.driver.stdin(a, prompt)), { text: '{"verdicts":[]}', costUsd: null, model: CODEX_DEFAULT, durationMs: 1, usage: null }),
    });
    await b.complete({ label: "critic", model: CODEX_DEFAULT, system: "SYSTEM TEXT", prompt: "USER TEXT", schema: CRITIC_SCHEMA });
    expect(seen.indexOf("SYSTEM TEXT")).toBe(0);
    expect(seen).toContain("You have no tools");
    expect(seen.endsWith("USER TEXT")).toBe(true);
    expect(b.stats()).toEqual({ calls: 1, costUsd: null });
  });
});

describe("claude CLI backend", () => {
  const init = (tools: string[], mcp: unknown[] = [], model = "claude-opus-5-5") =>
    JSON.stringify({ type: "system", subtype: "init", tools, mcp_servers: mcp, model });
  const result = (text: string) => JSON.stringify({ type: "result", is_error: false, result: text, total_cost_usd: 0.01, duration_ms: 5 });

  test("flags switch every tool off", () => {
    const a = claudeArgs("opus", "SYS");
    expect(a.slice(0, 3)).toEqual(["-p", "--model", "opus"]);
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    for (const f of ["--strict-mcp-config", "--safe-mode", "--disable-slash-commands", "--no-session-persistence"]) expect(a).toContain(f);
    expect(a).not.toContain("--dangerously-skip-permissions");
    expect(a.some((x) => x.startsWith("--mcp-config") || x.startsWith("--allowed"))).toBe(false);
  });

  test("parses a clean stream", () => {
    const r = parseClaudeStream([init([]), result('{"a":1}')].join("\n"));
    expect(r.text).toBe('{"a":1}');
    expect(r.costUsd).toBe(0.01);
    expect(r.model).toBe("claude-opus-5-5");
  });

  test("refuses output when the session has tools, MCP servers, a tool call, or a wrong model", () => {
    expect(() => parseClaudeStream([init(["WebSearch"]), result("{}")].join("\n"))).toThrow(/has tools/);
    expect(() => parseClaudeStream([init([], [{ name: "x" }]), result("{}")].join("\n"))).toThrow(/MCP/);
    const toolUse = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebFetch" }] } });
    expect(() => parseClaudeStream([init([]), toolUse, result("{}")].join("\n"))).toThrow(/tried to call a tool/);
    expect(() => parseClaudeStream([init([], [], "claude-sonnet-5-5"), result("{}")].join("\n"))).toThrow(/not allowed/);
    const keyed = JSON.stringify({ type: "system", subtype: "init", tools: [], mcp_servers: [], model: "claude-opus-5-5", apiKeySource: "ANTHROPIC_API_KEY" });
    expect(() => parseClaudeStream([keyed, result("{}")].join("\n"))).toThrow(/API key/);
    expect(() => parseClaudeStream(result("{}"))).toThrow(/no init event/);
    expect(() => parseClaudeStream(init([]))).toThrow(/no result/);
  });

  test("one repair retry, then success; transcript is written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-llm-test-"));
    const prompts: string[] = [];
    const replies = ['{"verdicts": "oops"}', '{"verdicts": []}'];
    const b = new ClaudeCliBackend({
      transcriptDir: dir,
      log: () => undefined,
      runner: async (_a, prompt) => {
        prompts.push(prompt);
        return { text: replies.shift()!, costUsd: 0.5, model: "claude-mythos-5-2", durationMs: 1, usage: null };
      },
    });
    const out = await b.complete<CriticOutput>({ label: "critic", model: "claude-mythos-5-2", system: "S", prompt: "P", schema: CRITIC_SCHEMA });
    expect(out).toEqual({ verdicts: [] });
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("rejected by the validator");
    expect(prompts[1]).toContain("$.verdicts: expected array, got string");
    expect(b.stats()).toEqual({ calls: 2, costUsd: 1 });
    const files = readdirSync(dir).sort();
    expect(files).toContain("01-critic.prompt.txt");
    expect(files).toContain("01-critic.response.txt");
    expect(files).toContain("02-critic-repair.response.txt");
    expect(readFileSync(join(dir, "01-critic.prompt.txt"), "utf8")).toContain("===== SYSTEM =====\nS");
  });

  test("gives up after the repair retry", async () => {
    const b = new ClaudeCliBackend({
      transcriptDir: mkdtempSync(join(tmpdir(), "pgroast-llm-test-")),
      log: () => undefined,
      runner: async () => ({ text: "not json", costUsd: null, model: "claude-opus-5-5", durationMs: 1, usage: null }),
    });
    await expect(b.complete({ label: "x", model: "opus", system: "", prompt: "", schema: CRITIC_SCHEMA })).rejects.toThrow(/still invalid/);
    expect(b.stats().calls).toBe(2);
  });

  test("refuses a model that is not allowed before calling anything", async () => {
    let called = false;
    const b = new ClaudeCliBackend({
      transcriptDir: mkdtempSync(join(tmpdir(), "pgroast-llm-test-")),
      runner: async () => ((called = true), { text: "{}", costUsd: 0, model: "", durationMs: 0, usage: null }),
    });
    await expect(b.complete({ label: "x", model: "sonnet", system: "", prompt: "", schema: CRITIC_SCHEMA })).rejects.toThrow(/not allowed/);
    expect(called).toBe(false);
  });

  test("semaphore limits concurrency", async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});

// ----------------------------------------------------------------------------- sanitize

describe("sanitizer", () => {
  const allowed = new AllowedUrls();
  allowed.add("https://www.postgresql.org/message-id/flat/abc%2Bd%40mail.example.org");
  allowed.add("https://commitfest.postgresql.org/patch/5253/");

  test("keeps allowed links in any spelling, removes the rest", () => {
    const report = emptyReport();
    const out = scrubUrls(
      {
        a: "see https://postgr.es/m/abc+d@mail.example.org, and https://www.postgresql.org/message-id/CAfake123@mail.gmail.com.",
        b: ["commitfest.postgresql.org/patch/5253 is fine", "but commitfest.postgresql.org/patch/9999/ is not"],
        c: { d: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=deadbeef" },
        n: 5,
      },
      allowed,
      "test",
      report,
    );
    expect(out.a).toBe(`see https://postgr.es/m/abc+d@mail.example.org, and ${REMOVED_LINK}.`);
    expect(out.b[0]).toBe("commitfest.postgresql.org/patch/5253 is fine");
    expect(out.b[1]).toBe(`but ${REMOVED_LINK} is not`);
    expect(out.c.d).toBe(REMOVED_LINK);
    expect(out.n).toBe(5);
    expect(report.urls_removed.map((u) => u.url)).toEqual([
      "https://www.postgresql.org/message-id/CAfake123@mail.gmail.com",
      "commitfest.postgresql.org/patch/9999/",
      "https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=deadbeef",
    ]);
  });

  test("precedent ids: only known ones", () => {
    const known = new Map([["P1", {} as Precedent], ["P2", {} as Precedent]]);
    const report = emptyReport();
    expect(filterPrecedentIds(["P1", "[p2]", "P7", "cf:123", "P1"], known, "s", report)).toEqual(["P1", "P2"]);
    expect(report.precedent_ids_dropped.map((d) => d.id)).toEqual(["P7", "cf:123"]);
  });

  test("quotes must be verbatim in a source", () => {
    const src = ["This undoes a poorly-thought-out choice in commit 970a18687f9b3058,\nnamely to export guc.c's internal variable data_directory.  The authoritative variable is DataDir."];
    expect(verifyQuote("This undoes a poorly-thought-out choice in commit 970a18687f9b3058, namely to export guc.c’s internal variable data_directory.", src)).not.toBeNull();
    expect(verifyQuote('"poorly-thought-out choice ... The authoritative variable is DataDir"', src)).not.toBeNull();
    expect(verifyQuote("This was a poorly designed choice that nobody wanted to maintain.", src)).toBeNull();
    expect(verifyQuote("poorly", src)).toBeNull();
    expect(verifyQuote(null, src)).toBeNull();
    expect(verifyQuote("we do not want this in core, period", [""])).toBeNull();
  });
});

// ----------------------------------------------------------------------------- precedents

function row(id: string, over: Partial<RawPrecedent> = {}): RawPrecedent {
  return {
    id,
    kind: "cf",
    title: `Title of ${id}`,
    status: "Rejected",
    date: "2020-05-01",
    first_date: "2019-11-01",
    url: `https://commitfest.postgresql.org/patch/${id.replace(/\D/g, "") || "1"}/`,
    thread_urls: [`https://www.postgresql.org/message-id/flat/${id.replace(/\W/g, "")}@example.org`],
    authors: ["A"],
    objectors: ["Tom Lane"],
    summary: "s",
    objection: "o",
    touch_points: ["new GUC"],
    ...over,
  };
}

describe("precedent adapter", () => {
  test("normalises rows; drops rows without a real link", () => {
    const p = normalisePrecedent(row("cf:12", { authors: ["A", "B"], thread_urls: '["https://www.postgresql.org/message-id/flat/x@y"]' }))!;
    expect(p.source_id).toBe("cf:12");
    expect(p.authors).toBe("A, B");
    expect(p.objectors).toBe("Tom Lane");
    expect(p.thread_urls).toEqual(["https://www.postgresql.org/message-id/flat/x@y"]);
    expect(normalisePrecedent(row("cf:13", { url: "" }))).toBeNull();
    expect(normalisePrecedent(row("cf:13", { url: "see archives" }))).toBeNull();
    expect(normalisePrecedent({ id: "x", title: "T", link: "https://a.example/b", firstDate: "2001-02-03" })?.first_date).toBe("2001-02-03");
  });

  test("messageIdOfUrl", () => {
    expect(messageIdOfUrl("https://www.postgresql.org/message-id/flat/a%2Bb%40c.d")).toBe("a+b@c.d");
    expect(messageIdOfUrl("https://postgr.es/m/a+b@c.d")).toBe("a+b@c.d");
    expect(messageIdOfUrl("https://commitfest.postgresql.org/patch/1/")).toBe("");
  });

  test("passes the cutoff down, re-checks it, removes the proposal itself, dedupes, numbers P1..", async () => {
    const seen: SearchArgs[] = [];
    const search = async (a: SearchArgs) => {
      seen.push(a);
      return [
        row("cf:1"),
        row("cf:2", { date: "2024-09-29" }), // decided after the cutoff: a leak if kept
        row("cf:3", { first_date: "2024-09-12", date: null }),
        row("cf:5253"), // the proposal's own CommitFest entry
        row("cf:6", { thread_urls: ["https://www.postgresql.org/message-id/flat/self%40example.org"] }),
        row("wiki:x", { date: null, first_date: null, kind: "do_not_want" }),
        row("cf:1"),
      ];
    };
    const r = await retrievePrecedents({
      queries: ["int64 guc", "int64 guc", "64-bit settings"],
      before: "2024-09-12",
      self: { cfId: 5253, messageIds: ["self@example.org"] },
      search,
    });
    expect(seen.length).toBe(2);
    expect(seen.every((a) => a.before === "2024-09-12" && !a.includeUndated)).toBe(true);
    expect(r.precedents.map((p) => p.source_id)).toEqual(["cf:1"]);
    expect(r.precedents[0]!.id).toBe("P1");
    expect(r.precedents[0]!.matched_queries).toEqual(["int64 guc", "64-bit settings"]);
    expect(r.warnings).toEqual([]);

    const live = await retrievePrecedents({ queries: ["q"], before: "2024-09-12", includeUndated: true, search });
    expect(live.precedents.map((p) => p.source_id)).toContain("wiki:x");
  });

  test("hint results go first; recent beats old", async () => {
    const search = async (a: SearchArgs) =>
      a.query.includes("2018")
        ? [row("cf:18", { date: "2018-07-01", first_date: "2018-03-01" })]
        : [row("cf:old", { date: "2006-01-01", first_date: "2005-01-01" }), row("cf:new", { date: "2024-01-01", first_date: "2023-01-01" })];
    const r = await retrievePrecedents({ queries: ["q1"], hint: "the 2018 suggestion of X", before: "2025-01-01", search });
    expect(r.precedents.map((p) => p.source_id)).toEqual(["cf:18", "cf:new", "cf:old"]);
    expect(r.precedents[0]!.from_hint).toBe(true);
    expect(recencyBoost("2024-06-01", "2025-01-01")).toBeGreaterThan(recencyBoost("2010-06-01", "2025-01-01"));
    expect(recencyBoost(null, "2025-01-01")).toBe(1);
  });

  test("a failing search degrades to no precedents with a warning", async () => {
    const r = await retrievePrecedents({
      queries: ["a", "b"],
      before: "2025-01-01",
      search: async () => {
        throw new Error("connection refused");
      },
    });
    expect(r.precedents).toEqual([]);
    expect(r.warnings.join(" ")).toContain("NOT done");
  });
});

// ----------------------------------------------------------------------------- material

describe("material", () => {
  test("trimQuotes collapses long quoted runs", () => {
    const body = ["On Monday X wrote:", "> a", "> b", "> c", "> d", "> e", "", "My reply.", "> q1", "More."].join("\n");
    expect(trimQuotes(body)).toBe(["On Monday X wrote:", "> a", "> b", "> c", "> [... quoted text trimmed ...]", "", "My reply.", "> q1", "More."].join("\n"));
  });
  test("blind material says so and hides the outcome and addresses", () => {
    const m = renderMaterial(proposal(5)).text;
    expect(m).toContain("blind mode: only the first 5 messages are shown");
    expect(m).toContain("withheld (evaluation mode)");
    expect(m).toContain("### Message #5 |");
    expect(m).not.toContain("### Message #6 |");
    expect(m).not.toContain("Rejected");
    expect(m).toContain("### Message #1 | Aleksander Alekseev | 2024-09-12 |");
  });
  test("the budget keeps the first messages", () => {
    const r = renderMaterial(proposal(null), { maxThreadChars: 6000 });
    expect(r.omitted).toBeGreaterThan(0);
    expect(r.text).toContain("Attached is a self-sufficient patch");
    expect(r.text).toContain("[omitted for length]");
  });
});

// ----------------------------------------------------------------------------- pipeline

const PRECEDENTS: RawPrecedent[] = [
  row("cf:777", {
    title: "64-bit GUC values",
    objection: "I do not think widening every integer GUC is worth the churn in extensions. We would be breaking the GUC API for a handful of settings.",
    objectors: ["Tom Lane"],
    date: "2019-03-01",
    first_date: "2018-11-01",
    thread_urls: ["https://www.postgresql.org/message-id/flat/old-thread%40example.org"],
  }),
  row("cf:778", { title: "Unrelated thing", objection: "", date: "2012-01-01", first_date: "2011-01-01" }),
];

function obj(over: Partial<RawObjection>): RawObjection {
  return {
    title: "T",
    level: "2",
    rubric_item: 9,
    category: "abi_extension_api",
    touch_points: ["abi_extension_api"],
    severity: "fixable",
    failure_scenario: "An extension compiled against the old struct crashes.",
    argument: "Message #1 says the GUC structs change.",
    precedent_ids: [],
    thread_message_refs: [1],
    author_must_show: "A list of affected extensions.",
    ...over,
  };
}

class FakeBackend implements LlmBackend {
  readonly dryRun = false;
  calls: CompleteArgs[] = [];
  constructor(private readonly answer: (a: CompleteArgs) => unknown) {}
  stats() {
    return { calls: this.calls.length, costUsd: 0.42 };
  }
  async complete<T>(a: CompleteArgs): Promise<T> {
    this.calls.push(a);
    const v = this.answer(a);
    const errs = validate(v, a.schema);
    if (errs.length) throw new Error(`fake reply for ${a.label} invalid: ${errs.join("; ")}`);
    return v as T;
  }
}

const BRIEF: Brief = {
  title: "64-bit integer GUCs",
  problem: "Some settings need values above 2^31.",
  proposed_design: "Add an int64 GUC type.",
  user_visible_surface: ["DefineCustomInt64Variable()"],
  author_claims: ["Needed by the 64-bit XID patch set"],
  thread_state: "Five messages visible.",
  unclear: ["Which GUCs need it"],
  search_queries: ["int64 guc", "64-bit guc", "guc integer range", "bigint settings", "DefineCustomInt64Variable"],
};

function fakeAnswers(a: CompleteArgs): unknown {
  if (a.label === "brief") return BRIEF;
  if (a.label === "roaster-prior-attempts") {
    return {
      objections: [
        obj({
          title: "Same idea was rejected for API churn",
          level: "1b",
          category: "prior_rejection",
          severity: "fatal",
          precedent_ids: ["P1", "P9"],
          thread_message_refs: [1, 99],
          argument: "See [P1] and https://www.postgresql.org/message-id/flat/INVENTED@mail.gmail.com for the earlier discussion.",
        }),
      ],
      prior_attempts: [
        { precedent_id: "P1", relation: "same_idea", what_is_different: "nothing, same idea", quote: "We would be breaking the GUC API for a handful of settings." },
        { precedent_id: "P2", relation: "related_only", what_is_different: "Different area.", quote: "Tom said this is a terrible idea and always will be." },
        { precedent_id: "P44", relation: "same_idea", what_is_different: "x", quote: null },
      ],
      no_objection_note: "",
    } satisfies RoasterOutput;
  }
  if (a.label === "roaster-maintenance-fit") {
    return { objections: [obj({ title: "Extensions break", severity: "fatal" }), obj({ title: "Docs are thin", severity: "fixable" })], prior_attempts: [], no_objection_note: "" };
  }
  if (a.label === "roaster-demand") {
    return { objections: [obj({ title: "No user asked for it", level: "1b", category: "demand", touch_points: [], rubric_item: 3 })], prior_attempts: [], no_objection_note: "" };
  }
  if (a.label === "roaster-security") throw new Error("boom");
  if (a.label.startsWith("roaster-")) return { objections: [], prior_attempts: [], no_objection_note: "Nothing from this angle." };
  if (a.label === "critic") {
    return {
      verdicts: [
        { objection_id: "prior-attempts-1", verdict: "survived", refutation_kind: "none", reasoning: "The precedent matches.", adjusted_severity: null },
        { objection_id: "maintenance-fit-1", verdict: "survived", refutation_kind: "none", reasoning: "Real, but a new version can keep the old API.", adjusted_severity: "fixable" },
        { objection_id: "maintenance-fit-2", verdict: "refuted", refutation_kind: "not_specific", reasoning: "Applies to any patch.", adjusted_severity: null },
        // no verdict for demand-1
      ],
    } satisfies CriticOutput;
  }
  if (a.label === "synth") {
    return {
      verdict: "LIKELY-REJECT",
      confidence: "medium",
      verdict_reasoning: "prior-attempts-1 decides it.",
      failing_level: "1b",
      ranked_objection_ids: ["maintenance-fit-1", "prior-attempts-1", "maintenance-fit-2", "demand-1", "nope-3"],
      touch_points: TOUCH_POINT_IDS.filter((id) => id !== "wire_protocol").map((id) => ({ id, hit: id === "new_guc", reason: id === "new_guc" ? "adds a GUC type" : "" })),
      questions: ["Which settings need more than 31 bits?"],
      prior_attempts: [
        { precedent_id: "P1", relation: "same_idea", what_is_different: "nothing, same idea", quote: "We would be breaking the GUC API for a handful of settings." },
        { precedent_id: "P2", relation: "related_only", what_is_different: "Different area.", quote: "Tom said this is a terrible idea and always will be." },
        { precedent_id: "P44", relation: "same_idea", what_is_different: "x", quote: null },
      ],
      committability: { owner: "silent", owner_note: "someone who knows guc.c", liability: "the GUC API, forever", author_follow_up: "no sign either way" },
      not_now: { applies: true, evidence_that_would_change_it: "Two extensions that need it." },
      provisional_note: "Code not read.",
    } satisfies SynthOutput;
  }
  throw new Error(`unexpected label ${a.label}`);
}

describe("pipeline (fake model)", () => {
  const p = proposal(5);
  const searches: SearchArgs[] = [];
  const backend = new FakeBackend(fakeAnswers);
  const run = runRoast(p, {
    backend,
    models: modelsFromEnv({}),
    hint: "the 2018 suggestion",
    search: async (a) => (searches.push(a), PRECEDENTS),
    log: () => undefined,
    now: () => new Date("2026-11-11T00:00:00Z"),
  });

  test("stages: 1 brief, 7 roasters, 1 critic, 1 synthesis; the right models", async () => {
    const r = await run;
    expect(backend.calls.map((c) => c.label).sort()).toEqual(["brief", "critic", ...ANGLES.map((a) => `roaster-${a}`), "synth"].sort());
    expect(r.stats.llm_calls).toBe(10);
    for (const c of backend.calls) {
      expect(c.model).toBe(c.label === "critic" || c.label === "synth" ? "claude-mythos-5-2" : "opus");
    }
  });

  test("prompts carry the rubric verbatim, the angle, the precedents by id, and no links", async () => {
    await run;
    const rubric = readFileSync(join(import.meta.dir, "..", "prompts", "committer-paranoia.md"), "utf8").trim();
    for (const c of backend.calls.filter((c) => c.label !== "brief")) expect(c.system).toContain(rubric);
    const sec = backend.calls.find((c) => c.label === "roaster-security")!;
    expect(sec.system).toContain("Your angle: security and privileges");
    expect(sec.system).toContain("Zero objections is a valid answer");
    expect(sec.system).toContain("`pg_dump_round_trip`");
    expect(sec.prompt).toContain("[P1] 64-bit GUC values");
    expect(sec.prompt).toContain("who objected: Tom Lane");
    expect(sec.prompt).not.toContain("old-thread");
    expect(sec.prompt).not.toContain("commitfest.postgresql.org/patch/777");
    expect(sec.prompt).toContain("blind mode: only the first 5 messages");
    expect(sec.prompt).not.toContain("Rejected by");
    const critic = backend.calls.find((c) => c.label === "critic")!;
    expect(critic.prompt).toContain('"id": "prior-attempts-1"');
    expect(critic.system).toContain("try to refute every objection");
  });

  test("retrieval is cut off at the thread start and gets the hint", async () => {
    await run;
    expect(searches.every((s) => s.before === "2024-09-12" && !s.includeUndated)).toBe(true);
    expect(searches[0]!.query).toBe("the 2018 suggestion");
    expect(searches.length).toBe(6);
  });

  test("fabricated links, unknown precedent ids and bad message refs are removed", async () => {
    const r = await run;
    const o = r.objections.find((x) => x.id === "prior-attempts-1")!;
    expect(o.argument).not.toContain("INVENTED");
    expect(o.argument).toContain("[link removed");
    expect(o.precedent_ids).toEqual(["P1"]);
    expect(o.precedents).toEqual([
      {
        id: "P1",
        title: "64-bit GUC values",
        url: "https://commitfest.postgresql.org/patch/777/",
        thread_urls: ["https://www.postgresql.org/message-id/flat/old-thread%40example.org"],
        date: "2019-03-01",
        status: "Rejected",
      },
    ]);
    expect(o.thread_message_refs).toEqual([1]);
    expect(o.thread_refs[0]!.url).toBe(p.thread.messages[0]!.url);
    expect(r.sanitizer.urls_removed.length).toBe(1);
    expect(r.sanitizer.precedent_ids_dropped.map((d) => d.id)).toEqual(["P9", "P44"]);
    expect(r.sanitizer.thread_refs_dropped.map((d) => d.index)).toEqual([99]);
    // the removed link survives only in the audit list
    expect(JSON.stringify({ ...r, sanitizer: null })).not.toContain("INVENTED");
    expect(r.sanitizer.urls_removed[0]!.url).toContain("INVENTED");
  });

  test("prior attempts: link, date and objector from the DB; quote only when verbatim", async () => {
    const r = await run;
    expect(r.prior_attempts.map((a) => a.precedent_id)).toEqual(["P1", "P2"]);
    const [a, b] = r.prior_attempts;
    expect(a!.url).toBe("https://commitfest.postgresql.org/patch/777/");
    expect(a!.who_objected).toBe("Tom Lane");
    expect(a!.date).toBe("2019-03-01");
    expect(a!.quote).toBe("We would be breaking the GUC API for a handful of settings.");
    expect(b!.quote).toBeNull();
    expect(r.sanitizer.quotes_dropped.length).toBe(1);
  });

  test("critic verdicts: refuted kept apart, severity adjusted, missing verdict flagged", async () => {
    const r = await run;
    expect(r.refuted.map((o) => o.id)).toEqual(["maintenance-fit-2"]);
    expect(r.refuted[0]!.critic.refutation_kind).toBe("not_specific");
    const mf = [...r.objections, ...r.other_surviving].find((o) => o.id === "maintenance-fit-1")!;
    expect(mf.severity).toBe("fixable");
    expect(mf.critic.original_severity).toBe("fatal");
    expect(r.warnings.some((w) => w.includes("no verdict on demand-1"))).toBe(true);
  });

  test("base-up rule: failing level leads, higher-level fixable objections are not listed", async () => {
    const r = await run;
    expect(r.failing_level).toBe("1b");
    expect(r.objections.map((o) => o.id)).toEqual(["prior-attempts-1", "demand-1"]);
    expect(r.other_surviving.map((o) => o.id)).toEqual(["maintenance-fit-1"]);
    expect(r.other_surviving[0]!.not_ranked_reason).toContain("base-up stop rule");
    expect(r.warnings.some((w) => w.includes('"maintenance-fit-2"'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('"nope-3"'))).toBe(true);
    expect(r.verdict).toBe("LIKELY-REJECT");
  });

  test("all 15 touch points, in order; a failed roaster is reported", async () => {
    const r = await run;
    expect(r.touch_points.map((t) => t.id)).toEqual(TOUCH_POINT_IDS);
    expect(r.touch_points.find((t) => t.id === "new_guc")).toMatchObject({ hit: true, reason: "adds a GUC type" });
    expect(r.touch_points.find((t) => t.id === "wire_protocol")!.hit).toBe(false);
    expect(r.warnings.some((w) => w.includes('touch point "wire_protocol"'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('roaster "security" failed'))).toBe(true);
    expect(r.roaster_notes.length).toBe(7);
    expect(r.disclosure).toBe("Prepared by an AI harness; treat as a devil's advocate, not a verdict.");
    expect(r.input.blind).toBe(5);
    expect(r.input.cf?.status).toBeNull();
    expect(r.precedent_cutoff).toBe("2024-09-12");
  });

  test("markdown is rendered from the JSON", async () => {
    const r = await run;
    const md = renderMarkdown(r);
    expect(md).toContain("# PG Roast: Support Int64 GUCs");
    expect(md.match(new RegExp(DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))!.length).toBe(2);
    expect(md).toContain("**LIKELY-REJECT** (confidence: medium)");
    expect(md).toContain("### 1. Same idea was rejected for API churn");
    expect(md).toContain("- **Who objected:** Tom Lane");
    expect(md).toContain('- **Reason (quote):** "We would be breaking the GUC API for a handful of settings."');
    expect(md).toContain("- **Reason (quote):** quote unavailable");
    expect(md).toContain("- **What is different this time:** nothing, same idea");
    expect(md).toContain("| new GUC | **yes** | adds a GUC type |");
    expect(md.match(/^\| .* \| (\*\*yes\*\*|no) \|/gm)!.length).toBe(15);
    expect(md).toContain("1. Which settings need more than 31 bits?");
    expect(md).toContain("- Level 1a: understandability: passed");
    expect(md).toContain("- Level 1b: desirability: failed");
    expect(md).toContain("- Level 2: architecture and design: not evaluated");
    expect(md).toContain("- **Owner:** silent. someone who knows guc.c");
    expect(md).toContain("- **Liability:** the GUC API, forever");
    expect(md).toContain("**Not now / show demand: yes.** This is an outcome, not a rejection. Evidence that would change it: Two extensions that need it.");
    expect(r.not_now.applies).toBe(true);
    expect(r.committability.owner).toBe("silent");
    expect(r.warnings.some((w) => w.includes('"not now" although a fatal objection'))).toBe(true);
    expect(md).toContain("### Refuted by the critic");
    expect(md).toContain("`maintenance-fit-2` Docs are thin. Refuted (not specific): Applies to any patch.");
    expect(md).toContain("blind mode, first 5");
    expect(md).toContain("(status withheld)");
    expect(md).not.toContain("INVENTED");
    // every link in the markdown is one the code knows
    const links = [...md.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]!);
    const ok = new Set([r.input.thread_url, r.input.cf!.url, ...p.thread.messages.map((m) => m.url), ...r.precedents_retrieved.flatMap((x) => [x.url, ...x.thread_urls])]);
    expect(links.length).toBeGreaterThan(3);
    for (const l of links) expect(ok.has(l)).toBe(true);
  });
});

describe("assemble guards", () => {
  const base = (over: Partial<FinalObjection>): FinalObjection => ({
    ...obj({}),
    id: "x-1",
    angle: "demand",
    status: "survived",
    critic: { refutation_kind: "none", reasoning: "", original_severity: null },
    precedents: [],
    thread_refs: [],
    not_ranked_reason: null,
    ...over,
  });
  const synth = (over: Partial<SynthOutput>): SynthOutput => ({
    ...(stubFor(SYNTH_SCHEMA) as SynthOutput),
    touch_points: TOUCH_POINT_IDS.map((id) => ({ id, hit: false, reason: "" })),
    ...over,
  });

  test("LIKELY-REJECT without a fatal objection or a same-idea precedent is downgraded", () => {
    const warnings: string[] = [];
    const a = assemble({
      synth: synth({ verdict: "LIKELY-REJECT", ranked_objection_ids: ["x-1"], failing_level: "2" }),
      objections: [base({})],
      precedents: [],
      threadText: "",
      report: emptyReport(),
      warnings,
    });
    expect(a.verdict).toBe("NEEDS-DESIGN-DISCUSSION");
    expect(warnings.join(" ")).toContain("downgraded");
  });

  test("NO-FUNDAMENTAL-OBJECTION cannot stand next to a ranked fatal objection", () => {
    const a = assemble({
      synth: synth({ verdict: "NO-FUNDAMENTAL-OBJECTION", ranked_objection_ids: ["x-1"] }),
      objections: [base({ severity: "fatal", level: "1a" })],
      precedents: [],
      threadText: "",
      report: emptyReport(),
      warnings: [],
    });
    expect(a.verdict).toBe("NEEDS-DESIGN-DISCUSSION");
    expect(a.failing_level).toBe("1a");
  });

  test("strict stop rule: nothing above the failing level is listed, even when fatal", () => {
    const a = assemble({
      synth: synth({ verdict: "LIKELY-REJECT", failing_level: "1a", ranked_objection_ids: ["d-1", "a-1", "c-1"] }),
      objections: [base({ id: "a-1", level: "1a", severity: "fatal" }), base({ id: "c-1", level: "2", severity: "fixable" }), base({ id: "d-1", level: "2", severity: "fatal" })],
      precedents: [],
      threadText: "",
      report: emptyReport(),
      warnings: [],
    });
    expect(a.objections.map((o) => o.id)).toEqual(["a-1"]);
    expect(a.other_surviving.map((o) => o.id)).toEqual(["c-1", "d-1"]);
    expect(a.other_surviving.every((o) => o.not_ranked_reason!.includes("not evaluated"))).toBe(true);
    expect(a.levels.map((l) => l.status)).toEqual(["failed", "not_evaluated", "not_evaluated"]);
  });

  test("a ranked objection forces its touch point to hit; zero objections is fine", () => {
    const a = assemble({
      synth: synth({ verdict: "NEEDS-COMMITTER-EYES", ranked_objection_ids: ["x-1"] }),
      objections: [base({ category: "wal_replication", touch_points: ["catalog"] })],
      precedents: [],
      threadText: "",
      report: emptyReport(),
      warnings: [],
    });
    expect(a.touch_points.filter((t) => t.hit).map((t) => t.id)).toEqual(["wal_replication", "catalog"]);
    const none = assemble({ synth: synth({ verdict: "NO-FUNDAMENTAL-OBJECTION" }), objections: [], precedents: [], threadText: "", report: emptyReport(), warnings: [] });
    expect(none.verdict).toBe("NO-FUNDAMENTAL-OBJECTION");
    expect(none.objections).toEqual([]);
    expect(none.failing_level).toBeNull();
    expect(none.levels.map((l) => l.status)).toEqual(["passed", "passed", "passed"]);
  });
});

describe("dry run and misc", () => {
  test("dry run prints every prompt, calls nothing, and still produces a valid shape", async () => {
    const printed: string[] = [];
    const backend = new DryRunBackend({ print: (s) => printed.push(s) });
    const r = await runRoast(proposal(3), { backend, models: modelsFromEnv({}), search: async () => PRECEDENTS, log: () => undefined });
    expect(printed.length).toBe(10);
    expect(printed.every((s) => s.includes("DRY RUN") && s.includes("not sent"))).toBe(true);
    expect(r.stats.dry_run).toBe(true);
    expect(r.touch_points.length).toBe(15);
    expect(renderMarkdown(r)).toContain("DRY RUN");
  });

  test("no corpus: the roast says the search was not done", async () => {
    const backend = new FakeBackend((a) => (a.label === "brief" ? BRIEF : a.label === "synth" ? { ...(stubFor(SYNTH_SCHEMA) as object), verdict: "NO-FUNDAMENTAL-OBJECTION" } : stubFor(a.schema)));
    const r = await runRoast(proposal(2), {
      backend,
      models: modelsFromEnv({}),
      search: async () => {
        throw new Error("db down");
      },
      log: () => undefined,
    });
    expect(r.prior_attempts).toEqual([]);
    expect(r.warnings.join(" ")).toContain("NOT done");
    expect(backend.calls.some((c) => c.label === "critic")).toBe(false); // nothing to refute
    expect(r.stats.llm_calls).toBe(9);
  });

  test("slug, schema description, prompts", () => {
    expect(slugFor(proposal(5))).toBe("cf-5253-blind5");
    expect(slugFor({ ...proposal(null), ref: { kind: "msgid", messageId: "x" } })).toBe("msg-CAJ7c6TMvPz8q-nC-JoKniy7yxPzQYcCTnNFYmsD");
    const d = describeSchema(ROASTER_SCHEMA);
    expect(d).toContain('"severity": "fatal" | "fixable"');
    expect(d).toContain('"rubric_item": integer (1..16) | null');
    expect(d).toContain("(max 4 items)");
    const prompts = loadPrompts();
    for (const a of ANGLES) expect(roasterSystem(prompts, a)).toContain("Your angle:");
    expect(prompts.roasterCommon).toContain("We do not want a reviewer, we want a rejector");
  });

  test("CLI arguments", () => {
    expect(parseArgs(["5253", "--blind", "5", "--before=2024-10-01", "--hint", "the 2018 idea", "--out", "/tmp/x", "--dry-run"])).toEqual({
      input: "5253",
      blind: 5,
      before: "2024-10-01",
      hint: "the 2018 idea",
      out: "/tmp/x",
      dryRun: true,
      offline: false,
    });
    expect(parseArgs(["7608", "--backend", "codex"])).toMatchObject({ backend: "codex" });
    expect(parseArgs(["doctor"])).toMatchObject({ doctor: true });
    expect(() => parseArgs(["1", "--backend", "gpt"])).toThrow();
    expect(parseArgs(["--help"])).toBe("help");
    expect(() => parseArgs([])).toThrow(/missing input/);
    expect(() => parseArgs(["1", "--blind", "0"])).toThrow();
    expect(() => parseArgs(["1", "--before", "soon"])).toThrow();
    expect(() => parseArgs(["1", "--post"])).toThrow(/unknown option/);
  });
});
