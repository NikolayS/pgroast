import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, runPage } from "../src/cli.ts";
import { BASE_URL_PLACEHOLDER, esc, renderFragment, renderPage, safeMessageId, safeUrl, siteFiles } from "../src/roast/page.ts";
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
import { assemble, describeSchema, FORGOT_PROMPT, HAPPY_PROMPT, loadPrompts, roasterSystem, runRoast, slugFor } from "../src/roast/pipeline.ts";
import { loadInvariantFiles, parseInvariantFile, selectInvariants } from "../src/roast/invariants.ts";
import { loadLocalProposal } from "../src/thread/local.ts";
import { lintRoast, lintText, NO_QUESTION, sentences, toneCheck } from "../src/roast/tone.ts";
import { messageIdOfUrl, normalisePrecedent, recencyBoost, retrievePrecedents, type RawPrecedent, type SearchArgs } from "../src/roast/precedents.ts";
import { renderMarkdown, renderSummary, SUMMARY_HEADER } from "../src/roast/render.ts";
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
  VERDICTS,
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
import type { ProposalInput, Thread } from "../src/thread/types.ts";
import { checkEnrichment, enrichPrecedents, MemoryEnrichmentStore, ownText, selectMessages } from "../src/roast/enrich.ts";

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
  test("only Opus, Mythos and Fable", () => {
    expect(assertAllowedModel("opus")).toBe("opus");
    expect(assertAllowedModel("claude-mythos-5-2")).toBe("claude-mythos-5-2");
    expect(assertAllowedModel("claude-fable-5-2")).toBe("claude-fable-5-2");
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
    author_must_show: "Which extensions are affected?",
    ...over,
  };
}

const OLD_THREAD: Thread = {
  threadUrl: "https://www.postgresql.org/message-id/flat/cf778%40example.org",
  rootMessageId: "cf778@example.org",
  subject: "Unrelated thing",
  lists: ["pgsql-hackers"],
  messages: [
    { index: 1, messageId: "cf778@example.org", url: "https://www.postgresql.org/message-id/cf778%40example.org", from: "An Author <a(at)example(dot)org>", date: "2011-01-01T10:00:00Z", subject: "Unrelated thing", body: "Here is my patch.", attachments: [] },
    { index: 2, messageId: "r1@example.org", url: "https://www.postgresql.org/message-id/r1%40example.org", from: "Nathan Reviewer <n(at)example(dot)org>", date: "2011-01-02T10:00:00Z", subject: "Re: Unrelated thing", body: "> Here is my patch.\n\nI do not see what this buys us\nover a float setting.", attachments: [] },
    { index: 3, messageId: "r2@example.org", url: "https://www.postgresql.org/message-id/r2%40example.org", from: "Late Person <l(at)example(dot)org>", date: "2013-05-05T10:00:00Z", subject: "Re: Unrelated thing", body: "Years later: this was committed after all.", attachments: [] },
  ],
};

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
  if (a.label === "relevance") return { relevant_ids: ["P1", "P2", "P77"] };
  if (a.label === "enrich-P2") {
    return {
      proposal_summary: "A thing that is unrelated.",
      why_not_accepted: "A reviewer saw no use for it.",
      objectors: ["Nathan Reviewer", "Tom Lane"],
      key_quote: "I do not see what this buys us over a float setting.",
      quote_message_index: 2,
    };
  }
  if (a.label.startsWith("enrich-")) throw new Error(`unexpected enrichment ${a.label}`);
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
      priority: { audience: "niche", maintenance_burden: "medium", review_cost: "high", recommended_action: "needs champion", reason: "Few settings need it; guc.c is widely used." },
      provisional_note: "Code not read.",
    } satisfies SynthOutput;
  }
  throw new Error(`unexpected label ${a.label}`);
}

describe("pipeline (fake model)", () => {
  const p = proposal(5);
  const searches: SearchArgs[] = [];
  const backend = new FakeBackend(fakeAnswers);
  const store = new MemoryEnrichmentStore();
  const enrichPrompts: string[] = [];
  const run = runRoast(p, {
    enrichStore: store,
    enrichLoadThread: async (id) => {
      if (id !== "cf778@example.org") throw new Error(`unexpected thread ${id}`);
      return OLD_THREAD;
    },
    enrichClosers: async () => [],
    backend,
    models: modelsFromEnv({}),
    hint: "the 2018 suggestion",
    search: async (a) => (searches.push(a), PRECEDENTS),
    log: () => undefined,
    now: () => new Date("2026-11-11T00:00:00Z"),
  });

  test("stages: 1 brief, 7 roasters, 1 critic, 1 synthesis; the right models", async () => {
    const r = await run;
    expect(backend.calls.map((c) => c.label).sort()).toEqual(["brief", "critic", "enrich-P2", "relevance", ...ANGLES.map((a) => `roaster-${a}`), "synth"].sort());
    expect(r.stats.llm_calls).toBe(12);
    void enrichPrompts;
    for (const c of backend.calls) {
      expect(c.model).toBe(c.label === "critic" || c.label === "synth" ? "claude-mythos-5-2" : "opus");
    }
  });

  test("prompts carry the rubric verbatim, the angle, the precedents by id, and no links", async () => {
    await run;
    const rubric = readFileSync(join(import.meta.dir, "..", "prompts", "committer-paranoia.md"), "utf8").trim();
    for (const c of backend.calls.filter((c) => /^(roaster-|critic|synth)/.test(c.label))) expect(c.system).toContain(rubric);
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
    expect(r.sanitizer.precedent_ids_dropped.map((d) => d.id)).toEqual(["P77", "P9", "P44"]);
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
    expect(a!.enriched).toBe(false);
    expect(a!.quote_url).toBeNull();
    // P2 had no recorded reason: it was enriched from its thread, and the invented quote was
    // replaced by the sentence that code verified against message #2.
    expect(b!.enriched).toBe(true);
    expect(b!.reason).toBe("A reviewer saw no use for it.");
    expect(b!.who_objected).toBe("Tom Lane"); // the corpus value wins over the summary's
    expect(b!.quote).toBe("I do not see what this buys us over a float setting.");
    expect(b!.quote_url).toBe("https://www.postgresql.org/message-id/r1%40example.org");
    expect(r.sanitizer.quotes_dropped.length).toBe(1);
  });

  test("enrichment: one call per thread, cut at the decision date, cached, checked by code", async () => {
    const r = await run;
    expect(r.enrichment).toMatchObject({ candidates: 1, from_cache: 0, new_calls: 1, failed: 0, quotes_verified: 1, objectors_dropped: 1, relevance_pass: "done", relevant: 2 });
    const call = backend.calls.find((c) => c.label === "enrich-P2")!;
    expect(call.model).toBe("opus");
    expect(call.prompt).toContain("### Message #2 | Nathan Reviewer | 2011-01-02");
    expect(call.prompt).not.toContain("committed after all"); // dated after the decision (2012-01-01)
    expect(call.prompt).toContain("Messages shown: 2 of 2.");
    const row = [...store.rows.values()][0]!;
    expect(row).toMatchObject({ raw_ref: "cf:778", as_of: "2012-01-01", objectors: ["Nathan Reviewer"], quote_message_url: "https://www.postgresql.org/message-id/r1%40example.org" });
    const p2 = r.precedents_retrieved.find((x) => x.id === "P2")!;
    expect(p2).toMatchObject({ enriched: true, relevant: true });
    expect(r.precedents_retrieved.find((x) => x.id === "P1")).toMatchObject({ enriched: false, relevant: true });
    const sec = backend.calls.find((c) => c.label === "roaster-security")!;
    expect(sec.prompt).toContain("why it was not accepted (AI summary of its thread): A reviewer saw no use for it.");
    expect(sec.prompt).toContain('key sentence, verbatim from its thread: "I do not see what this buys us over a float setting."');
    expect(renderMarkdown(r)).toContain("(AI summary of the linked thread; check it there):** A reviewer saw no use for it.");
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
    expect(r.warnings.some((w) => w.includes('review angle "security" failed'))).toBe(true);
    expect(r.roaster_notes.length).toBe(7);
    expect(r.disclosure).toBe("Prepared by an AI harness; treat as a devil's advocate, not a verdict.");
    expect(r.input.blind).toBe(5);
    expect(r.input.cf?.status).toBeNull();
    expect(r.precedent_cutoff).toBe("2024-09-12");
  });

  test("markdown is rendered from the JSON", async () => {
    const r = await run;
    const md = renderMarkdown(r);
    expect(md).toContain("# Design pre-review: Support Int64 GUCs");
    expect(md).toContain("## 3. Objections a reviewer is likely to raise");
    expect(md).toContain("**Question for the author.** Which extensions are affected?");
    expect(md).not.toMatch(/steelman|PG Roast|roaster/i);
    expect(md).toContain("- Tone check: ");
    expect(md.match(new RegExp(DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))!.length).toBe(2);
    expect(md).toContain("**LIKELY-REJECT** (confidence: medium)");
    expect(md).toContain("### 1. Same idea was rejected for API churn");
    expect(md).toContain("- **Who objected:** Tom Lane");
    expect(md).toContain('- **Reason (quote):** "We would be breaking the GUC API for a handful of settings."');
    expect(md).toContain('- **Reason (quote):** "I do not see what this buys us over a float setting." ([message](https://www.postgresql.org/message-id/r1%40example.org))');
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
    expect(md).toContain("### Refuted in the counter-check");
    expect(md).toContain("`maintenance-fit-2` Docs are thin. Refuted (not specific): Applies to any patch.");
    expect(md).toContain("blind mode, first 5");
    expect(md).toContain("(status withheld)");
    expect(md).not.toContain("INVENTED");
    // every link in the markdown is one the code knows
    const links = [...md.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]!);
    const ok = new Set([r.input.thread_url, r.input.cf!.url, ...p.thread.messages.map((m) => m.url), ...r.precedents_retrieved.flatMap((x) => [x.url, ...x.thread_urls, x.quote_message_url ?? ""])]);
    expect(links.length).toBeGreaterThan(3);
    for (const l of links) expect(ok.has(l)).toBe(true);
  });
});

describe("enrichment checks", () => {
  const prec = (over: Partial<Precedent>): Precedent => ({
    id: "P1", source_id: "cf:778", kind: "cf", title: "Unrelated thing", status: "Rejected", date: "2012-01-01", first_date: "2011-01-01",
    url: "https://commitfest.postgresql.org/patch/778/", thread_urls: [OLD_THREAD.threadUrl], authors: "", objectors: "", summary: "", objection: "",
    touch_points: [], matched_queries: [], from_hint: false, score: 1, enriched: false, key_quote: null, quote_message_url: null, relevant: null, ...over,
  });
  const base = { proposal_summary: "s", why_not_accepted: "w", objectors: [], key_quote: null, quote_message_index: null };

  test("a quote must be the named message's own words", () => {
    const m = OLD_THREAD.messages;
    expect(checkEnrichment({ ...base, key_quote: "I do not see what this buys us over a float setting.", quote_message_index: 2 }, m).quote_message_url).toBe(m[1]!.url);
    expect(checkEnrichment({ ...base, key_quote: "I do not see what this buys us over a float setting.", quote_message_index: 1 }, m).key_quote).toBeNull();
    expect(checkEnrichment({ ...base, key_quote: "Here is my patch.", quote_message_index: 2 }, m).key_quote).toBeNull(); // only quoted there
    expect(checkEnrichment({ ...base, key_quote: "I do not see ... a float setting.", quote_message_index: 2 }, m).key_quote).toBeNull(); // no ellipsis
    expect(checkEnrichment({ ...base, key_quote: "This is a bad idea, full stop, forever.", quote_message_index: 2 }, m).key_quote).toBeNull();
    expect(checkEnrichment({ ...base, key_quote: "I do not see what this buys us over a float setting.", quote_message_index: 9 }, m).dropped[0]).toContain("not shown");
    expect(ownText("> a\nb\n > c")).toBe("b");
  });

  test("objectors must be senders in the thread", () => {
    const c = checkEnrichment({ ...base, objectors: ["nathan reviewer", "Tom Lane", "Nathan Reviewer"] }, OLD_THREAD.messages);
    expect(c.objectors).toEqual(["Nathan Reviewer"]);
    expect(c.dropped.length).toBe(1);
  });

  test("selectMessages: first 3, last 8, closers; capped", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ ...OLD_THREAD.messages[0]!, index: i + 1, from: i === 14 ? "Closer Person (closer) <c(at)x>" : "Someone <s(at)x>", body: "x".repeat(100) }));
    expect(selectMessages(msgs, ["Closer Person (closerp)"]).map((m) => m.index)).toEqual([1, 2, 3, 15, 23, 24, 25, 26, 27, 28, 29, 30]);
    const big = msgs.map((m) => ({ ...m, body: "y".repeat(9000) }));
    const sel = selectMessages(big, ["Closer Person"]);
    expect(sel.map((m) => m.index).slice(0, 3)).toEqual([1, 2, 3]);
    expect(sel.reduce((n, m) => n + Math.min(m.body.length, m.index === 1 ? 10000 : 5000), 0)).toBeLessThanOrEqual(60000);
    expect(sel[sel.length - 1]!.index).toBe(30);
  });

  test("cache hit makes no call; the proposal's own thread and undated rows in eval mode are never read", async () => {
    const store = new MemoryEnrichmentStore();
    const backend = new FakeBackend(() => ({ ...base, objectors: ["Nathan Reviewer"] }));
    const common = { backend, model: "opus", system: "S", store, evalMode: true, selfMessageIds: [] as string[], loadThreadFn: async () => OLD_THREAD, closersFn: async () => [] };
    const p1 = prec({});
    await enrichPrecedents([p1], common);
    expect(backend.calls.length).toBe(1);
    expect(p1).toMatchObject({ enriched: true, objection: "w", objectors: "Nathan Reviewer" });
    const p2 = prec({});
    const again = await enrichPrecedents([p2], common);
    expect(backend.calls.length).toBe(1);
    expect(again.stats.from_cache).toBe(1);
    expect(p2.enriched).toBe(true);

    let loaded = 0;
    const guard = { ...common, store: new MemoryEnrichmentStore(), loadThreadFn: async () => (loaded++, OLD_THREAD) };
    const own = prec({});
    const undated = prec({ id: "P2", date: null, first_date: null });
    const hasReason = prec({ id: "P3", objection: "recorded" });
    const res = await enrichPrecedents([own, undated, hasReason], { ...guard, selfMessageIds: ["cf778@example.org"] });
    expect(loaded).toBe(0);
    expect(res.stats.candidates).toBe(0);
    expect([own.enriched, undated.enriched, hasReason.enriched]).toEqual([false, false, false]);

    const failing = await enrichPrecedents([prec({})], { ...guard, loadThreadFn: async () => { throw new Error("404"); } });
    expect(failing.stats.failed).toBe(1);
    expect(failing.warnings[0]).toContain("could not be enriched");
  });
});

describe("assemble guards", () => {
  const base = (over: Partial<FinalObjection>): FinalObjection => ({
    ...obj({}),
    id: "x-1",
    angle: "demand",
    round: 0,
    revised_in_round: null,
    withdrawal: null,
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

  test("a listed level 1 objection makes the verdict at least NEEDS-DESIGN-DISCUSSION", () => {
    const run = (level: "1b" | "2", verdict: SynthOutput["verdict"]) => {
      const warnings: string[] = [];
      const a = assemble({ synth: synth({ verdict, ranked_objection_ids: ["x-1"] }), objections: [base({ level })], precedents: [], threadText: "", report: emptyReport(), warnings });
      return { verdict: a.verdict, warnings };
    };
    expect(run("1b", "NEEDS-COMMITTER-EYES").verdict).toBe("NEEDS-DESIGN-DISCUSSION");
    expect(run("1b", "NEEDS-COMMITTER-EYES").warnings.join(" ")).toContain("listed a level 1b objection (x-1)");
    expect(run("1b", "NO-FUNDAMENTAL-OBJECTION").verdict).toBe("NEEDS-DESIGN-DISCUSSION");
    expect(run("2", "NEEDS-COMMITTER-EYES").verdict).toBe("NEEDS-COMMITTER-EYES");
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
    expect(printed.length).toBe(11); // + the relevance pass; enrichment is skipped in a dry run
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
    expect(parseArgs(["7608", "--self", "--rounds", "2"])).toMatchObject({ input: "7608", self: true, rounds: 2 });
    expect(parseArgs(["--self", "--proposal", "d.txt", "--patch", "a.patch", "--patch=b.patch"])).toMatchObject({ self: true, proposal: "d.txt", patches: ["a.patch", "b.patch"] });
    expect(() => parseArgs(["--proposal", "d.txt"])).toThrow(/--self/);
    expect(() => parseArgs(["1", "--self", "--proposal", "d.txt"])).toThrow(/not both/);
    expect(() => parseArgs(["1", "--patch", "a.patch"])).toThrow(/--proposal/);
    expect(() => parseArgs(["--self", "--proposal", "d.txt", "--blind", "3"])).toThrow(/draft/);
    expect(() => parseArgs(["1", "--rounds", "-1"])).toThrow();
  });
});

// ----------------------------------------------------------------------------- rounds, invariants, self mode

const INVARIANT = parseInvariantFile(
  "invariants/testsub.md",
  `---
subsystem: testsub
paths:
  - src/backend/access/nbtree/
  - src/include/access/nbtree.h
---

# testsub invariants

## Tell VACUUM about deferred work
- Rule: record deferred cleanup in the metapage.
- Failure when broken: bloat comes back.
- Source: https://example.org/inv-source (a reviewer, 2026-11-11)
`,
)!;

describe("rounds, invariants and self mode (fake model)", () => {
  const p: ProposalInput = {
    ...proposal(5),
    patchProse: [
      {
        attachment: { name: "v1-0001.patch", url: "https://www.postgresql.org/message-id/attachment/1/v1-0001.patch", contentType: "text/x-patch", sizeText: "1 KB", sizeBytes: 1024 },
        fromMessageIndex: 1,
        commitMessages: [{ subject: "Add a thing.", body: "" }],
        files: ["src/backend/access/nbtree/nbtpage.c", "doc/src/sgml/config.sgml"],
        docHunks: [],
        truncated: false,
      },
    ],
  };
  const none = { objections: [], revised: [], withdrawn: [], note: "" };
  const backend = new FakeBackend((a) => {
    if (a.label === "round1-demand") return { ...none, objections: [obj({ title: "Nobody measured it", level: "1b", category: "demand", touch_points: [] })], note: "Looked again at the numbers." };
    if (a.label === "round1-maintenance-fit") return { ...none, withdrawn: [{ objection_id: "maintenance-fit-1", reason: "too early" }] };
    if (a.label === "round2-maintenance-fit") return { ...none, withdrawn: [{ objection_id: "maintenance-fit-1", reason: "The critic is right: the old API can stay." }] };
    if (a.label === "round2-prior-attempts") {
      return {
        ...none,
        revised: [{ objection_id: "prior-attempts-1", objection: obj({ title: "Same idea was rejected; say what changed", level: "1b", category: "prior_rejection", severity: "fixable", precedent_ids: ["P1"], argument: "See https://example.org/inv-source and https://example.org/invented." }) }],
        withdrawn: [{ objection_id: "demand-1", reason: "not mine" }],
      };
    }
    if (/^round[12]-/.test(a.label)) return none;
    if (a.label === "critic-round1") return { verdicts: [{ objection_id: "demand-r1-1", verdict: "survived", refutation_kind: "none", reasoning: "Fair.", adjusted_severity: null }] };
    if (a.label === "critic-round2") return { verdicts: [{ objection_id: "prior-attempts-1", verdict: "survived", refutation_kind: "none", reasoning: "Still stands.", adjusted_severity: null }] };
    if (a.label === "round3-supervisor") {
      return {
        follow_ups: [
          { angle: "demand", uncovered_area: "what other databases do", instruction: "Check whether the material says what other systems offer." },
          { angle: "security", uncovered_area: "privileges", instruction: "Check." }, // that roaster failed in round 0: dropped
        ],
        coverage_note: "Nobody compared with other systems.",
      };
    }
    if (a.label === "round3-followup1-demand") return { objections: [obj({ title: "Other systems do not have it either", level: "1b", category: "demand", touch_points: [] })], prior_attempts: [], no_objection_note: "" };
    if (a.label === "critic-round3") return { verdicts: [{ objection_id: "demand-r3-1", verdict: "refuted", refutation_kind: "not_specific", reasoning: "Says nothing about this proposal.", adjusted_severity: null }] };
    if (a.label === "round4-supervisor") return { follow_ups: [], coverage_note: "Covered." };
    if (a.label === "synth") {
      return {
        ...(fakeAnswers(a) as object),
        self_advice: [
          { objection_id: "prior-attempts-1", action: "rebut", how: "Say in the cover letter what changed since the earlier thread." },
          { objection_id: "maintenance-fit-1", action: "fix", how: "x" }, // withdrawn: dropped
        ],
      };
    }
    return fakeAnswers(a);
  });
  const run = runRoast(p, {
    enrich: false,
    backend,
    models: modelsFromEnv({}),
    search: async () => PRECEDENTS,
    log: () => undefined,
    rounds: 6,
    mode: "self",
    invariants: [INVARIANT],
    now: () => new Date("2026-11-11T00:00:00Z"),
  });
  const call = (label: string) => backend.calls.find((c) => c.label === label)!;

  test("round 1 and 2 ask the two questions verbatim, with the roaster's own answers", async () => {
    await run;
    expect(FORGOT_PROMPT).toBe("What did you forget?");
    expect(HAPPY_PROMPT).toBe("Are you happy with the results?");
    expect(call("round1-demand").prompt.endsWith("# Question\n\nWhat did you forget?")).toBe(true);
    expect(call("round2-demand").prompt.endsWith("# Question\n\nAre you happy with the results?")).toBe(true);
    expect(call("round1-demand").prompt).toContain("No user asked for it");
    expect(call("round1-demand").prompt).not.toContain("Extensions break"); // another roaster's objection
    expect(call("round2-demand").prompt).toContain("Nobody measured it"); // its own round-1 addition
    expect(call("round2-maintenance-fit").prompt).toContain('"status": "refuted"');
    expect(backend.calls.some((c) => c.label === "round1-security")).toBe(false); // failed in round 0
    for (const c of backend.calls) expect(/^(brief|relevance|roaster-|critic|round\d+-|synth)/.test(c.label)).toBe(true);
  });

  test("each round is recorded: calls, new objections, what survived, revisions, withdrawals", async () => {
    const r = await run;
    expect(r.rounds_requested).toBe(6);
    expect(r.rounds.map((x) => [x.round, x.kind, x.llm_calls, x.new_objections, x.new_survived, x.revised, x.withdrawn])).toEqual([
      [0, "initial", 8, 4, 3, 0, 0],
      [1, "what_did_you_forget", 7, 1, 1, 0, 0],
      [2, "are_you_happy", 7, 0, 0, 1, 1],
      [3, "supervisor", 3, 1, 0, 0, 0],
      [4, "supervisor", 1, 0, 0, 0, 0], // empty list: the loop ends before rounds 5 and 6
    ]);
    expect(r.rounds[3]!.follow_ups).toEqual([{ angle: "demand", uncovered_area: "what other databases do" }]);
    expect(r.stats.llm_calls).toBe(1 + 8 + 7 + 7 + 3 + 1 + 1); // brief, rounds 0-4, synthesis
    const all = [...r.objections, ...r.other_surviving, ...r.refuted, ...r.withdrawn];
    expect(all.find((o) => o.id === "demand-r1-1")).toMatchObject({ round: 1, status: "survived" });
    expect(all.find((o) => o.id === "demand-r3-1")).toMatchObject({ round: 3, status: "refuted" });
    expect(all.find((o) => o.id === "demand-1")).toMatchObject({ round: 0, withdrawal: null });
  });

  test("withdrawal is recorded with its reason, not deleted; a roaster cannot touch others' objections", async () => {
    const r = await run;
    expect(r.withdrawn.map((o) => o.id)).toEqual(["maintenance-fit-1"]);
    expect(r.withdrawn[0]).toMatchObject({ status: "withdrawn", withdrawal: { round: 2, reason: "The critic is right: the old API can stay." } });
    expect(r.objections.some((o) => o.id === "maintenance-fit-1")).toBe(false);
    expect(call("synth").prompt).not.toContain('"id": "maintenance-fit-1"');
    const w = r.warnings.join("\n");
    expect(w).toContain('round 1: "maintenance-fit" returned revisions or withdrawals; ignored');
    expect(w).toContain('"prior-attempts" tried to withdraw "demand-1"');
    const revised = r.objections.find((o) => o.id === "prior-attempts-1")!;
    expect(revised).toMatchObject({ round: 0, revised_in_round: 2, severity: "fixable", title: "Same idea was rejected; say what changed" });
    expect(call("critic-round2").prompt).toContain("One verdict per id: prior-attempts-1.");
  });

  test("invariants: chosen by touched path, given verbatim to two roasters and the critic, source link allowed", async () => {
    const r = await run;
    expect(r.invariants_loaded).toEqual(["invariants/testsub.md"]);
    for (const l of ["roaster-replication-ondisk", "roaster-maintenance-fit", "critic", "round1-maintenance-fit", "critic-round2"]) {
      expect(call(l).system).toContain("## Subsystem invariants to check explicitly");
      expect(call(l).system).toContain(INVARIANT.text);
    }
    for (const l of ["roaster-demand", "roaster-prior-attempts", "synth", "round3-supervisor"]) expect(call(l).system).not.toContain("Subsystem invariants");
    const revised = r.objections.find((o) => o.id === "prior-attempts-1")!;
    expect(revised.argument).toContain("https://example.org/inv-source"); // read from the file by code
    expect(revised.argument).not.toContain("https://example.org/invented");
    expect(selectInvariants(["src/backend/access/heap/heapam.c"], [INVARIANT])).toEqual([]);
    expect(selectInvariants([], [INVARIANT])).toEqual([]);
    expect(selectInvariants(["src/include/access/nbtree.h"], [INVARIANT]).length).toBe(1);
    expect(parseInvariantFile("x.md", "# no front matter")).toBeNull();
    const real = loadInvariantFiles();
    expect(real.some((f) => f.file === "invariants/README.md")).toBe(false);
    for (const f of real) expect(f.paths.length).toBeGreaterThan(0);
  });

  test("self mode: same verdict rules, advice per surviving objection, verdict lower in the markdown", async () => {
    const r = await run;
    expect(r.mode).toBe("self");
    expect(VERDICTS).toContain(r.verdict);
    expect(r.self_advice).toEqual([{ objection_id: "prior-attempts-1", action: "rebut", how: "Say in the cover letter what changed since the earlier thread." }]);
    expect(call("synth").system).toContain("## Self mode: the reader is the author");
    expect(call("roaster-demand").system).not.toContain("Self mode");
    const md = renderMarkdown(r);
    expect(md).toContain("# Design pre-review (self check):");
    expect(md).toContain("## 3. Objections to address before you send");
    expect(md).toContain("**Before you send: rebut it in the cover letter.** Say in the cover letter what changed");
    expect(md).toContain("Threads to cite or to distinguish yourself from: [");
    expect(md).not.toContain("## 1. Verdict");
    expect(md.indexOf("## How a reviewer would likely classify it")).toBeGreaterThan(md.indexOf("## Priority"));
    expect(md.indexOf("## Priority")).toBeGreaterThan(md.indexOf("## 3. Objections to address"));
    expect(md).toContain("### Withdrawn in a later round");
    expect(md).toContain("| 2 | \"Are you happy with the results?\" | 7 | 0 | 0 | 1 | 1 |");
    expect(md).toContain("- Subsystem invariants checked: invariants/testsub.md");
    expect(md).toContain("- **Recommended action:** needs champion");
  });

  test("roast-summary.txt: at most 10 plain lines, the draft header first, built by code", async () => {
    const r = await run;
    const before = backend.calls.length;
    const txt = renderSummary(r);
    expect(backend.calls.length).toBe(before);
    const lines = txt.trimEnd().split("\n");
    expect(lines[0]).toBe(SUMMARY_HEADER);
    expect(SUMMARY_HEADER).toBe("DRAFT — rewrite in your own words before using; AI-generated");
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(txt).not.toMatch(/[*#`\[\]]{2}|^#|\]\(/m);
    expect(txt).toContain(`Verdict (merits of the idea only, no code read): ${r.verdict}`);
    expect(txt).toContain("(rebut in the cover letter)");
    expect(txt).toContain("Priority: needs champion; audience niche;");
    const many = { ...r, objections: [...r.objections, ...r.objections, ...r.objections], questions: ["q?"], not_now: { applies: true, evidence_that_would_change_it: "e" } };
    expect(renderSummary(many).trimEnd().split("\n").length).toBeLessThanOrEqual(10);
  });

  test("default is zero extra rounds and review mode", async () => {
    const b = new FakeBackend(fakeAnswers);
    const r = await runRoast(proposal(5), { enrich: false, backend: b, models: modelsFromEnv({}), search: async () => PRECEDENTS, log: () => undefined, invariants: [INVARIANT] });
    expect(r.rounds.length).toBe(1);
    expect(r.rounds_requested).toBe(0);
    expect(r.mode).toBe("review");
    expect(r.self_advice).toEqual([]);
    expect(r.invariants_loaded).toEqual([]); // no patch, no touched files
    expect(r.priority.recommended_action).toBe("needs champion");
    expect(b.calls.some((c) => c.label.startsWith("round"))).toBe(false);
    const md = renderMarkdown(r);
    expect(md).toContain("## 1. Verdict");
    expect(md).toContain("## Priority");
    expect(md).not.toContain("### Rounds");
  });

  test("a draft on disk: one message, patch prose only, never code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-self-"));
    writeFileSync(join(dir, "draft.txt"), "Subject: [PATCH] Add foo\n\nHi hackers,\n\nI propose foo.\n");
    writeFileSync(join(dir, "code.c"), "int main(void) { return secret_code(); }\n");
    const lp = loadLocalProposal(join(dir, "draft.txt"), [join(FIX, "sample.patch"), join(dir, "code.c")], new Date("2026-11-11T00:00:00Z"));
    expect(lp.thread.subject).toBe("[PATCH] Add foo");
    expect(lp.thread.messages.length).toBe(1);
    expect(lp.patchProse.map((x) => x.attachment.name)).toEqual(["sample.patch"]);
    expect(lp.warnings.join(" ")).toContain("code.c is not a patch");
    expect(slugFor(lp)).toBe("self-draft");
    const b = new FakeBackend((a) => (a.label === "brief" ? BRIEF : stubFor(a.schema)));
    const r = await runRoast(lp, { enrich: false, backend: b, models: modelsFromEnv({}), search: async () => [], log: () => undefined, mode: "self", invariants: [] });
    for (const c of b.calls) expect(c.prompt).not.toContain("secret_code");
    expect(b.calls[0]!.prompt).toContain("I propose foo.");
    expect(renderMarkdown(r)).toContain("- Draft, not sent: draft.txt");
    expect(renderMarkdown(r)).not.toContain("]()");
  });
});

// ----------------------------------------------------------------------------- tone

describe("tone lint", () => {
  const rules = (t: string) => lintText(t).map((h) => `${h.rule}:${h.match.toLowerCase()}`);

  test("flags intensifiers, hyperbole, sarcasm, internal vocabulary, remarks about the author, exclamation marks", () => {
    expect(rules("This is obviously wrong.")).toEqual(["intensifier:obviously"]);
    expect(rules("The patch clearly breaks pg_upgrade. Of course it does.")).toEqual(["intensifier:clearly", "intensifier:of course"]);
    expect(rules("One could simply use a float, trivially.")).toEqual(["intensifier:simply"]); // one hit per rule and sentence
    expect(rules("That is nonsense, and the design is ridiculous.")).toEqual(["hyperbole:nonsense"]);
    expect(rules("Good luck getting that past a committer.")).toEqual(["sarcasm:good luck"]);
    expect(rules("Expect a beat down. This roast is long.")).toEqual(["roast vocabulary:beat down", "roast vocabulary:roast"]);
    expect(rules("You failed to say who needs it.")).toEqual(["about the author:you failed to"]);
    expect(rules("The author does not understand WAL.")).toEqual(["about the author:the author does not understand"]);
    expect(rules("It breaks replication!")).toEqual(["exclamation mark:!"]);
  });

  test("leaves calm text alone, including != and code spans", () => {
    for (const t of [
      "The proposal does not say which settings need more than 31 bits.",
      "A standby that replays this record with wal_level != logical would see a different page.",
      "The check `if (!found)` is described in message #3. Which callers rely on it?",
      "pgroast and pg_upgrade are tool names. A clear statement of the problem is missing.",
      "",
    ]) {
      expect(lintText(t)).toEqual([]);
    }
    expect(sentences("One. Two? Three!\nFour")).toEqual(["One.", "Two?", "Three!", "Four"]);
  });

  const toned = async (answer: (a: CompleteArgs) => unknown) => {
    const b = new FakeBackend((a) => {
      if (a.label === "tone-repair") return answer(a);
      if (a.label === "roaster-demand") {
        return { objections: [obj({ title: "Obviously nobody needs this!", level: "1b", category: "demand", touch_points: [], author_must_show: "Evidence of demand." })], prior_attempts: [], no_objection_note: "" };
      }
      if (a.label.startsWith("roaster-")) return { objections: [], prior_attempts: [], no_objection_note: "" };
      if (a.label === "critic") return { verdicts: [{ objection_id: "demand-1", verdict: "survived", refutation_kind: "none", reasoning: "It stands. The author is lazy.", adjusted_severity: null }] };
      if (a.label === "synth") return { ...(fakeAnswers(a) as object), ranked_objection_ids: ["demand-1"], prior_attempts: [], verdict: "NEEDS-DESIGN-DISCUSSION" };
      return fakeAnswers(a);
    });
    const r = await runRoast(proposal(5), { enrich: false, backend: b, models: modelsFromEnv({}), search: async () => [], log: () => undefined });
    return { r, b };
  };

  test("one repair call rewrites only the flagged sentences; the rest is listed in roast.json and the run section", async () => {
    const { r, b } = await toned((a) => {
      const items = JSON.parse(a.prompt.split("# Flagged sentences\n\n")[1]!.split("\n\n# Task")[0]!) as { n: number; sentence: string; flagged: string[] }[];
      expect(items.map((i) => i.sentence)).toEqual(["Obviously nobody needs this!", "Evidence of demand.", "The author is lazy."]);
      expect(items[0]!.flagged).toEqual(['intensifier: "Obviously"', 'exclamation mark: "!"']);
      expect(items[1]!.flagged).toEqual(["must end with one question the author can answer"]);
      return {
        rewrites: [
          { n: 1, text: "The material does not show who needs this" },
          { n: 2, text: "Which users asked for it? See https://example.org/made-up" },
          { n: 3, text: "The proposal is clearly incomplete." }, // still flagged
          { n: 9, text: "ignored" },
        ],
      };
    });
    const calls = b.calls.filter((c) => c.label === "tone-repair");
    expect(calls.length).toBe(1);
    expect(calls[0]!.model).toBe("claude-mythos-5-2");
    const o = r.objections[0]!;
    expect(o.title).toBe("The material does not show who needs this");
    expect(o.author_must_show).toContain("Which users asked for it?");
    expect(o.author_must_show).not.toContain("example.org");
    expect(o.critic.reasoning).toBe("It stands. The proposal is clearly incomplete."); // the unflagged sentence is untouched
    expect(r.tone_lint).toMatchObject({ hits_found: 4, sentences_rewritten: 3, repair_call: "done" });
    expect(r.tone_lint.remaining.map((h) => [h.path, h.rule, h.match])).toEqual([
      ["objections[0].author_must_show", NO_QUESTION, ""], // the scrubbed link left it without a final question mark
      ["objections[0].critic.reasoning", "intensifier", "clearly"],
    ]);
    expect(r.warnings.join(" ")).toContain("tone lint: 2 finding(s) remain");
    const md = renderMarkdown(r);
    expect(md).toContain("- Tone check: ");
    expect(md).toContain('  - `objections[0].critic.reasoning`: intensifier ("clearly")');
    expect(r.disclosure).toBe("Prepared by an AI harness; treat as a devil's advocate, not a verdict.");
  });

  test("a failed repair call leaves the text, records every hit; clean text needs no call", async () => {
    const { r, b } = await toned(() => {
      throw new Error("boom");
    });
    expect(r.tone_lint).toMatchObject({ hits_found: 4, sentences_rewritten: 0, repair_call: "failed" });
    expect(r.tone_lint.remaining.length).toBe(4);
    expect(r.objections[0]!.title).toBe("Obviously nobody needs this!");
    expect(b.calls.filter((c) => c.label === "tone-repair").length).toBe(1);

    const clean = structuredClone(r);
    clean.objections[0]!.title = "Demand is not shown";
    clean.objections[0]!.author_must_show = "Who asked for it?";
    clean.objections[0]!.critic.reasoning = "It stands.";
    expect(lintRoast(clean).hits).toEqual([]);
    expect(await toneCheck(clean)).toMatchObject({ hits_found: 0, repair_call: "not needed", remaining: [] });
    // archive quotes are not ours to rewrite
    clean.prior_attempts = [{ ...({} as (typeof r.prior_attempts)[number]), quote: "This is a terrible idea!", what_is_different: "x", reason: "Obviously bad", enriched: false }];
    expect(lintRoast(clean).hits).toEqual([]);
    clean.prior_attempts[0]!.enriched = true; // an AI summary is ours
    expect(lintRoast(clean).hits.map((h) => h.path)).toEqual(["prior_attempts[0].reason"]);
  });

  test("the prompts carry the tone rules", () => {
    const pr = loadPrompts();
    for (const t of [pr.roasterCommon, pr.critic, pr.synth]) {
      expect(t).toContain("## Tone of everything you write");
      expect(t).toContain("of thinking, not a voice");
    }
  });
});

// ----------------------------------------------------------------------------- page

describe("page and site layout", () => {
  const base = runRoast(proposal(5), {
    enrichStore: new MemoryEnrichmentStore(),
    enrichLoadThread: async () => OLD_THREAD,
    enrichClosers: async () => [],
    backend: new FakeBackend(fakeAnswers),
    models: modelsFromEnv({}),
    search: async () => PRECEDENTS,
    log: () => undefined,
    now: () => new Date("2026-11-11T00:00:00Z"),
  });
  const TAGS = new Set("html head meta title style body main p h1 h2 h3 ul ol li a section span code dl dt dd div table thead tbody tr th td strong footer".split(" "));
  const tagsOf = (html: string) => new Set([...html.replace(/<!DOCTYPE html>/, "").replace(/<style>[\s\S]*?<\/style>/, "<style></style>").matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)/g)].map((m) => m[1]!.toLowerCase()));

  test("the full page holds every objection, listed or not, refuted or not, and the disclosure twice", async () => {
    const r = await base;
    const html = renderPage(r);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.split(esc(DISCLOSURE)).length - 1).toBe(2);
    expect(html.indexOf(esc(DISCLOSURE))).toBeLessThan(html.indexOf("<h1>"));
    expect(html).toContain("<h1>Design pre-review: Support Int64 GUCs</h1>");
    for (const o of [...r.objections, ...r.other_surviving, ...r.refuted]) {
      expect(html).toContain(`id="${o.id}"`);
      expect(html).toContain(esc(o.critic.reasoning));
    }
    expect(r.refuted.length).toBeGreaterThan(0);
    expect(html).toContain("Refuted in the counter-check (not specific). Applies to any patch.");
    expect(html).toContain("<h2>Touch points</h2>");
    expect(html).toContain("<h2>Committability</h2>");
    expect(html).toContain("<dt>Recommended action</dt><dd>needs champion</dd>");
    expect(html).toContain("Subsystem invariants: none loaded");
    expect(html).toContain("Tone check: 0 finding(s)");
    expect(html).toContain("Which settings need more than 31 bits?");
    expect(html).toContain('href="https://commitfest.postgresql.org/patch/5253/"');
    // self-contained: no scripts, no external resources, light and dark, mobile viewport
    expect(html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(|\ssrc=|\son[a-z]+=/i);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain('name="viewport"');
    for (const t of tagsOf(html)) expect(TAGS.has(t)).toBe(true);
    expect(html).not.toMatch(/steelman|PG Roast|roaster/i);
  });

  test("hostile text and links are escaped: nothing from roast.json becomes markup or a script link", async () => {
    const r = structuredClone(await base);
    const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)> ' \` & </style></title>`;
    r.input.cf!.title = evil;
    r.input.subject = evil;
    r.input.cf!.authors = evil;
    r.input.cf!.url = "javascript:alert(3)";
    r.input.thread_url = `https://www.postgresql.org/x" onmouseover="alert(4)`;
    r.verdict = evil as typeof r.verdict;
    r.verdict_reasoning = evil;
    r.questions = [evil];
    r.brief.problem = evil;
    r.priority.reason = evil;
    r.priority.recommended_action = evil as typeof r.priority.recommended_action;
    r.committability.liability = evil;
    r.warnings = [evil];
    r.disclosure = evil;
    r.generated_at = evil;
    r.invariants_loaded = [evil];
    for (const o of [...r.objections, ...r.refuted, ...r.other_surviving]) {
      o.id = evil;
      o.title = evil;
      o.argument = evil;
      o.failure_scenario = evil;
      o.author_must_show = evil;
      o.critic.reasoning = evil;
      o.angle = evil as typeof o.angle;
      o.precedents = [{ id: "P1", title: evil, url: "data:text/html,<script>alert(5)</script>", thread_urls: ["JaVaScRiPt:alert(6)", "https://ok.example/thread"], date: evil, status: evil }];
      o.thread_refs = [{ index: 1, from: evil, date: evil, url: " javascript:alert(7)" }];
    }
    for (const x of r.prior_attempts) {
      x.title = evil;
      x.url = "vbscript:x";
      x.quote = evil;
      x.quote_url = "javascript:alert(8)";
      x.reason = evil;
      x.who_objected = evil;
      x.thread_urls = [evil];
    }
    for (const t of r.touch_points) {
      t.hit = true;
      t.reason = evil;
      t.label = evil;
    }
    for (const html of [renderPage(r), renderFragment(r, `${BASE_URL_PLACEHOLDER}/cf/1/full.html`), renderFragment(r, `javascript:alert(9)`), renderFragment(r, `x" onclick="alert(10)`)]) {
      expect(html).not.toMatch(/<script|<img/i);
      expect(html).not.toMatch(/href="\s*(javascript|vbscript|data):/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=\s*"/i);
      for (const m of html.matchAll(/href="([^"]*)"/g)) expect(m[1]!.startsWith("https://") || m[1]!.startsWith(BASE_URL_PLACEHOLDER)).toBe(true);
      for (const t of tagsOf(html)) expect(TAGS.has(t)).toBe(true);
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
    const page = renderPage(r);
    expect(page.match(/<title>/g)!.length).toBe(1);
    expect(page.match(/<\/style>/g)!.length).toBe(1);
    expect(page).toContain('href="https://ok.example/thread"');
    expect(esc(`<a href="x" onclick='y'>&\``)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;");
    expect(safeUrl("https://www.postgresql.org/message-id/x%40y")).toBe("https://www.postgresql.org/message-id/x%40y");
    for (const u of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "https://a b", 'https://a/"x', "", null, "ftp://x"]) expect(safeUrl(u)).toBeNull();
  });

  test("fragment: a card without html/head, pgroast- classes, inline styles, no scripts, verdict, questions, priority, disclosure", async () => {
    const r = await base;
    const f = renderFragment(r, `${BASE_URL_PLACEHOLDER}/cf/5253/full.html`);
    expect(f.startsWith('<div class="pgroast-card"')).toBe(true);
    expect(f).not.toMatch(/<html|<head|<body|<style|<script|<link|<!DOCTYPE/i);
    const classes = [...f.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    expect(classes.length).toBeGreaterThan(5);
    for (const c of classes) expect(c.startsWith("pgroast-")).toBe(true);
    for (const m of f.matchAll(/<(p|div|ol)\b([^>]*)>/g)) expect(m[2]).toContain('style="');
    expect(f).toContain(esc(DISCLOSURE));
    expect(f).toContain(`Pre-review verdict: <strong>${r.verdict}</strong>`);
    expect(f).toContain('<li class="pgroast-question">Which settings need more than 31 bits?</li>');
    expect(f).toContain("Priority: needs champion; audience: niche;");
    expect(f).toContain('href="{{PGROAST_BASE_URL}}/cf/5253/full.html"');
    expect(f.replace(/pgroast-|PGROAST_/g, "")).not.toMatch(/roast/i);
  });

  test("site layout: cf/<id>.html, .json, <id>/full.html; msg/<id> for a thread; nothing else; local files only", async () => {
    const r = await base;
    const files = siteFiles(r);
    expect(files.map((f) => f.path)).toEqual(["cf/5253.html", "cf/5253.json", "cf/5253/full.html"]);
    expect(JSON.parse(files[1]!.content)).toEqual(JSON.parse(JSON.stringify(r)));
    expect(files[2]!.content.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(siteFiles(r, "https://example.org/pre/")[0]!.content).toContain('href="https://example.org/pre/cf/5253/full.html"');

    const thread = { ...r, input: { ...r.input, cf: null, thread_url: "https://www.postgresql.org/message-id/flat/CAJ7c6%2Bx%3Dy%40mail.gmail.com" } };
    expect(siteFiles(thread).map((f) => f.path)).toEqual(["msg/CAJ7c6_x_y_mail.gmail.com.html", "msg/CAJ7c6_x_y_mail.gmail.com.json", "msg/CAJ7c6_x_y_mail.gmail.com/full.html"]);
    expect(safeMessageId("../../etc/passwd@x")).toBe("__.._etc_passwd_x");
    expect(safeMessageId("../../etc/passwd@x")).not.toContain("/");
    expect(() => siteFiles({ ...r, input: { ...r.input, cf: null, thread_url: "" } })).toThrow(/neither/);

    const dir = mkdtempSync(join(tmpdir(), "pgroast-site-"));
    writeFileSync(join(dir, "roast.json"), JSON.stringify(r));
    const written = runPage({ json: join(dir, "roast.json"), site: join(dir, "site") });
    expect(written.map((w) => w.slice(dir.length + 1))).toEqual(["site/cf/5253.html", "site/cf/5253.json", "site/cf/5253/full.html"]);
    expect(existsSync(join(dir, "site", "index.html"))).toBe(false);
    expect(runPage({ json: join(dir, "roast.json") })).toEqual([join(dir, "roast.html")]);
    expect(readFileSync(join(dir, "roast.html"), "utf8")).toBe(renderPage(r));
    writeFileSync(join(dir, "old.json"), JSON.stringify({ verdict: "x" }));
    expect(() => runPage({ json: join(dir, "old.json") })).toThrow(/not a roast.json of this version/);

    expect(parseArgs(["page", "out/x/roast.json", "--site", "site", "--base-url=https://example.org/p"])).toMatchObject({ page: { json: "out/x/roast.json", site: "site", baseUrl: "https://example.org/p" } });
    expect(() => parseArgs(["page"])).toThrow(/roast.json/);
    expect(() => parseArgs(["page", "a.json", "--out", "x.html", "--site", "d"])).toThrow(/not both/);
    expect(() => parseArgs(["page", "a.json", "--site", "d", "--base-url", "javascript:alert(1)"])).toThrow(/http/);
    expect(() => parseArgs(["page", "a.json", "--upload"])).toThrow(/unknown option/);
    // no publishing code: the page module and the CLI have no network call
    for (const f of ["src/roast/page.ts", "src/cli.ts"]) expect(readFileSync(join(import.meta.dir, "..", f), "utf8")).not.toMatch(/\bfetch\(|Bun\.serve|https\.request|XMLHttpRequest|net\.connect/);
  });
});
