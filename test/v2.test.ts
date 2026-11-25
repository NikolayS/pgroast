import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBatchArgs } from "../src/batch.ts";
import {
  analyzeBugSignals,
  BUG_TRIAGE_SCHEMA,
  heuristicClassification,
  parseBugsArchiveMonth,
  parseBugsArgs,
  rankBugReports,
  runBugsTriage,
  type BugClassification,
} from "../src/bugs.ts";
import { parseArgs } from "../src/cli.ts";
import { findSubsystemExperts, inferFilesFromRoast, parseGitLogExperts } from "../src/experts.ts";
import { renderDoctor, type DoctorResult } from "../src/roast/doctor.ts";
import {
  agyArgs,
  agyDriver,
  agyPrompt,
  API_KEY_VARS,
  childEnv,
  CliBackend,
  DEFAULT_AGY_CRITIC_MODEL,
  DEFAULT_AGY_MODEL,
  DualBackend,
  modelsFromEnv,
  parseAgyJson,
  pickBackend,
  resolveClaudeEnv,
  routeDualStage,
  type CompleteArgs,
  type LlmBackend,
} from "../src/roast/llm.ts";
import { renderMaterial } from "../src/roast/material.ts";
import { runRoast } from "../src/roast/pipeline.ts";
import { renderCompactMarkdown, renderMarkdown, stripInternalIds } from "../src/roast/render.ts";
import {
  ANGLES,
  CRITIC_SCHEMA,
  SCHEMA_VERSION,
  TOUCH_POINT_IDS,
  validate,
  type Brief,
  type CriticOutput,
  type RawObjection,
  type Roast,
  type RoasterOutput,
  type SynthOutput,
} from "../src/roast/schema.ts";
import {
  buildShortlist,
  parseShortlistArgs,
  renderRejectMarkdown,
  renderShortlistMarkdown,
  runShortlist,
  scoreEntry,
} from "../src/shortlist.ts";
import { cachePath } from "../src/thread/fetch.ts";
import {
  inferPatchVersion,
  isNocfbotAttachment,
  loadProposal,
  mergeProposalThreads,
  pickProposalMessages,
} from "../src/thread/load.ts";
import { flatThreadUrl } from "../src/thread/parse.ts";
import type { ProposalInput, Thread, ThreadMessage } from "../src/thread/types.ts";

// -----------------------------------------------------------------------------
// 1. agy backend, dual cross-family backend, CLAUDE_CONFIG_DIR auto-detect

describe("v2 llm backends (agy, dual, CLAUDE_CONFIG_DIR)", () => {
  test("API_KEY_VARS strips GEMINI_API_KEY and GOOGLE_API_KEY", () => {
    expect(API_KEY_VARS).toContain("GEMINI_API_KEY");
    expect(API_KEY_VARS).toContain("GOOGLE_API_KEY");
    const env = childEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/h",
      GEMINI_API_KEY: "secret-g",
      GOOGLE_API_KEY: "secret-gg",
      ANTHROPIC_API_KEY: "secret-a",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/tmp/h" });
  });

  test("resolveClaudeEnv auto-detects ~/.claude when .claude.json exists and CLAUDE_CONFIG_DIR is unset", () => {
    const auto = resolveClaudeEnv(
      { HOME: "/Users/test", ANTHROPIC_API_KEY: "drop" },
      (p) => p === "/Users/test/.claude/.claude.json",
    );
    expect(auto).toEqual({ HOME: "/Users/test", CLAUDE_CONFIG_DIR: "/Users/test/.claude" });

    const explicit = resolveClaudeEnv(
      { HOME: "/Users/test", CLAUDE_CONFIG_DIR: "/custom/dir" },
      () => true,
    );
    expect(explicit.CLAUDE_CONFIG_DIR).toBe("/custom/dir");

    const absent = resolveClaudeEnv({ HOME: "/Users/test" }, () => false);
    expect(absent.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  test("pickBackend supports agy, dual, and fallback claude > codex > agy", () => {
    const onlyAgy = (b: string) => (b === "agy" ? "/bin/agy" : null);
    const all = (b: string) => `/bin/${b}`;
    expect(pickBackend("agy", {}, all)).toBe("agy");
    expect(pickBackend("dual", {}, all)).toBe("dual");
    expect(pickBackend(undefined, { PGROAST_BACKEND: "dual" }, all)).toBe("dual");
    expect(pickBackend(undefined, {}, onlyAgy)).toBe("agy");
  });

  test("agy flags, combined prompt, and parseAgyJson validation", () => {
    const combined = agyPrompt("SYS", "USR");
    expect(combined).toContain("SYS");
    expect(combined).toContain("You have no tools");
    expect(combined.endsWith("USR")).toBe(true);

    const argv = agyArgs("gemini-4-neon-high", combined);
    expect(argv).toEqual([
      "--model",
      "gemini-4-neon-high",
      "--disable-slash-commands",
      "--output-format",
      "json",
      "-p",
      combined,
    ]);

    const ok = parseAgyJson(
      JSON.stringify({
        status: "SUCCESS",
        response: '{"verdicts":[]}',
        duration_seconds: 2.5,
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
    expect(ok.text).toBe('{"verdicts":[]}');
    expect(ok.durationMs).toBe(2500);
    expect(ok.costUsd).toBeNull();

    // Rejects non-SUCCESS, multi-turn (tool calls!), and empty response.
    expect(() => parseAgyJson(JSON.stringify({ status: "ERROR", error: "quota" }))).toThrow(/ERROR/);
    expect(() => parseAgyJson(JSON.stringify({ status: "SUCCESS", response: "{}", num_turns: 2 }))).toThrow(/2 turns/);
    expect(() => parseAgyJson(JSON.stringify({ status: "SUCCESS", response: "   ", num_turns: 1 }))).toThrow(/empty response/);
    expect(() => parseAgyJson("not json")).toThrow(/no JSON object/);

    const drv = agyDriver("/tmp/empty");
    const repairArgv = drv.argv(
      { label: "x", model: "gemini-4-neon-high", system: "S", prompt: "ORIG", schema: CRITIC_SCHEMA },
      "REPAIRED",
    );
    expect(repairArgv[repairArgv.length - 1]).toContain("REPAIRED");
    expect(drv.stdin({ label: "x", model: "gemini-4-neon-high", system: "S", prompt: "ORIG", schema: CRITIC_SCHEMA }, "REPAIRED")).toBe("");
  });

  test("CliBackend with agy driver runs cleanly with injected runner", async () => {
    const b = new CliBackend({
      backend: "agy",
      transcriptDir: mkdtempSync(join(tmpdir(), "pgroast-agy-")),
      log: () => undefined,
      runner: async (args) => ({
        text: '{"verdicts":[]}',
        costUsd: null,
        model: args.model,
        durationMs: 12,
        usage: null,
      }),
    });
    const out = await b.complete<CriticOutput>({
      label: "critic",
      model: DEFAULT_AGY_MODEL,
      system: "SYS",
      prompt: "USR",
      schema: CRITIC_SCHEMA,
    });
    expect(out).toEqual({ verdicts: [] });
    expect(b.driver.name).toBe("agy");
  });

  test("DualBackend splits roasters across Claude and agy and puts Critic/Synth on opposite families", async () => {
    expect(modelsFromEnv({}, "agy")).toEqual({
      roaster: DEFAULT_AGY_MODEL,
      critic: DEFAULT_AGY_MODEL,
      synth: DEFAULT_AGY_MODEL,
      brief: DEFAULT_AGY_MODEL,
    });
    const dm = modelsFromEnv({ PGROAST_CRITIC_MODEL: "claude-fable-5-2" }, "dual");
    expect(dm.roaster).toBe(`opus+${DEFAULT_AGY_MODEL}`);
    expect(dm.critic).toBe(DEFAULT_AGY_CRITIC_MODEL);
    expect(dm.synth).toBe("claude-fable-5-2");

    // Flip critic to claude via PGROAST_DUAL_CRITIC_BACKEND=claude.
    const flipped = modelsFromEnv({ PGROAST_DUAL_CRITIC_BACKEND: "claude" }, "dual");
    expect(flipped.critic).toBe("claude-mythos-5-2");
    expect(flipped.synth).toBe(DEFAULT_AGY_CRITIC_MODEL);

    const seen: { family: string; label: string; model: string }[] = [];
    const dual = new DualBackend({
      transcriptDir: mkdtempSync(join(tmpdir(), "pgroast-dual-")),
      log: () => undefined,
      env: { PGROAST_CRITIC_MODEL: "claude-fable-5-2" },
      runner: async (family, args) => {
        seen.push({ family, label: args.label, model: args.model });
        return { text: '{"verdicts":[]}', costUsd: null, model: args.model, durationMs: 1, usage: null };
      },
    });
    for (const angle of ANGLES) {
      await dual.complete({ label: `roaster-${angle}`, model: "ignored", system: "S", prompt: "P", schema: CRITIC_SCHEMA });
    }
    await dual.complete({ label: "critic", model: "ignored", system: "S", prompt: "P", schema: CRITIC_SCHEMA });
    await dual.complete({ label: "synth", model: "ignored", system: "S", prompt: "P", schema: CRITIC_SCHEMA });

    const roasterFamilies = seen.filter((s) => s.label.startsWith("roaster-")).map((s) => s.family);
    expect(roasterFamilies).toContain("claude");
    expect(roasterFamilies).toContain("agy");
    expect(seen.find((s) => s.label === "critic")).toEqual({
      family: "agy",
      label: "critic",
      model: DEFAULT_AGY_CRITIC_MODEL,
    });
    expect(seen.find((s) => s.label === "synth")).toEqual({
      family: "claude",
      label: "synth",
      model: "claude-fable-5-2",
    });
    expect(dual.stats().calls).toBe(ANGLES.length + 2);
    expect(routeDualStage("critic", "claude")).toEqual({ backend: "claude", role: "critic" });
    expect(routeDualStage("synth", "claude")).toEqual({ backend: "agy", role: "synth" });
  });

  test("renderDoctor reports agy and dual availability when both claude and agy are ok", () => {
    const results: DoctorResult[] = [
      { backend: "claude", found: true, path: "/bin/claude", version: "2.0", model: "opus", completion: "ok", error: null, hint: null, wallMs: 1000 },
      { backend: "codex", found: false, path: null, version: null, model: "", completion: "skipped", error: null, hint: "install codex", wallMs: 0 },
      { backend: "agy", found: true, path: "/bin/agy", version: "1.0", model: DEFAULT_AGY_MODEL, completion: "ok", error: null, hint: null, wallMs: 1200 },
    ];
    const txt = renderDoctor(results, { HOME: "/nonexistent" });
    expect(txt).toContain("agy:");
    expect(txt).toContain("Usable backends: claude, agy, dual (claude + agy cross-family).");
  });

  test("CLI and batch accept --backend agy and --backend dual", () => {
    expect(parseArgs(["5879", "--backend", "agy"])).toMatchObject({ backend: "agy" });
    expect(parseArgs(["5879", "--backend", "dual"])).toMatchObject({ backend: "dual" });
    expect(parseBatchArgs(["62", "--out", "/tmp/o", "--backend", "dual"])).toMatchObject({ backend: "dual" });
    expect(parseBatchArgs(["62", "--out", "/tmp/o", "--backend", "agy"])).toMatchObject({ backend: "agy" });
  });
});

// -----------------------------------------------------------------------------
// 2. Thread & patch loading: latest patch across ALL senders, nocfbot skip, multi-thread CF

function makeMsg(over: Partial<ThreadMessage>): ThreadMessage {
  return {
    index: 1,
    messageId: "m1@example.org",
    url: "https://www.postgresql.org/message-id/m1%40example.org",
    from: "Original Author <orig@example.org>",
    date: "2015-05-01T10:00:00Z",
    subject: "archive_mode = shared",
    body: "Initial patch.",
    attachments: [],
    ...over,
  };
}

describe("v2 thread and patch loading", () => {
  test("pickProposalMessages picks latest patch from ANY sender and skips nocfbot attachments", () => {
    const msgs: ThreadMessage[] = [
      makeMsg({
        index: 1,
        from: "Original Starter <orig@example.org>",
        date: "2015-05-01T10:00:00Z",
        attachments: [{ name: "v1-0001-archive-shared.patch", url: "https://www.postgresql.org/a/1", contentType: "text/x-patch", sizeText: "10 KB", sizeBytes: 10240 }],
      }),
      makeMsg({
        index: 2,
        from: "Kirill Reshke <kirill@example.org>",
        date: "2026-10-15T12:00:00Z",
        attachments: [{ name: "v8-0001-archive-shared.patch", url: "https://www.postgresql.org/a/2", contentType: "text/x-patch", sizeText: "18 KB", sizeBytes: 18432 }],
      }),
      makeMsg({
        index: 3,
        from: "Nikolay Samokhvalov <nik@example.org>",
        date: "2026-11-01T12:00:00Z",
        attachments: [{ name: "nocfbot-repro-test.diff", url: "https://www.postgresql.org/a/3", contentType: "text/x-patch", sizeText: "2 KB", sizeBytes: 2048 }],
      }),
    ];
    expect(isNocfbotAttachment("nocfbot-repro-test.diff")).toBe(true);
    expect(isNocfbotAttachment("foo.nocfbot")).toBe(true);
    expect(isNocfbotAttachment("v8-0001-archive-shared.patch")).toBe(false);

    const picked = pickProposalMessages(msgs);
    expect(picked.map((m) => m.index)).toEqual([2, 1]);
    expect(picked[0]!.from).toContain("Kirill Reshke");
    expect(inferPatchVersion(["nocfbot-x.diff", "v8-0001-archive-shared.patch"])).toBe("v8");
    expect(inferPatchVersion(["v13-0001-foo.patch"])).toBe("v13");
    expect(inferPatchVersion(["v20251216-0001-Move.patch"])).toBe("v20251216");
    expect(inferPatchVersion(["fix-typo.patch"])).toBeNull();
  });

  test("mergeProposalThreads merges chronologically, deduplicates by messageId, preserves threadUrl", () => {
    const t1: Thread = {
      threadUrl: flatThreadUrl("root1@example.org"),
      rootMessageId: "root1@example.org",
      subject: "Thread 1",
      lists: ["pgsql-hackers"],
      messages: [
        makeMsg({ index: 1, messageId: "root1@example.org", date: "2025-01-01T10:00:00Z" }),
        makeMsg({ index: 2, messageId: "mid@example.org", date: "2025-03-01T10:00:00Z" }),
      ],
    };
    const t2: Thread = {
      threadUrl: flatThreadUrl("root2@example.org"),
      rootMessageId: "root2@example.org",
      subject: "Thread 2",
      lists: ["pgsql-hackers", "pgsql-bugs"],
      messages: [
        makeMsg({ index: 1, messageId: "mid@example.org", date: "2025-03-01T10:00:00Z" }),
        makeMsg({ index: 2, messageId: "late@example.org", date: "2026-06-01T10:00:00Z" }),
      ],
    };
    const merged = mergeProposalThreads([t1, t2]);
    expect(merged.messages.map((m) => [m.index, m.messageId])).toEqual([
      [1, "root1@example.org"],
      [2, "mid@example.org"],
      [3, "late@example.org"],
    ]);
    expect(merged.messages[2]!.threadUrl).toBe(t2.threadUrl);
    expect(merged.lists).toEqual(["pgsql-hackers", "pgsql-bugs"]);
  });

  test("loadProposal reads all threads on multi-thread CF entry, except in --blind mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-multi-"));
    const put = (url: string, body: string) => {
      const p = cachePath(url, dir);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, body);
    };
    const cfHtml = `
      <table class="table table-bordered">
        <tr><th>Title</th><td>Multi thread patch</td></tr>
        <tr><th>Status</th><td><a href="/62/">2026-11</a> <span class="badge bg-info">Needs review</span></td></tr>
        <tr><th>Authors</th><td>Alice</td></tr>
        <tr><th>Emails</th><td>
          <dt><a href="https://www.postgresql.org/message-id/flat/t1%40ex.org">Old thread</a></dt>
          <dd>First at <a href="#">2024-01-01 10:00:00</a> by Alice<br>Latest at <a href="#">2024-02-01 10:00:00</a></dd>
          <dt><a href="https://www.postgresql.org/message-id/flat/t2%40ex.org">Revived thread</a></dt>
          <dd>First at <a href="#">2026-01-01 10:00:00</a> by Bob<br>Latest at <a href="#">2026-02-01 10:00:00</a></dd>
        </td></tr>
      </table>`;
    const threadPage = (msgid: string, from: string, date: string, att: string) => `
      <h1 id="flatMsgSubject">Patch subject</h1>
      <span class="listname"><a href="#">pgsql-hackers</a></span>
      <table class="message-header">
        <tr><th>From:</th><td>${from}</td></tr>
        <tr><th>Date:</th><td>${date}</td></tr>
        <tr><th>Subject:</th><td>Patch subject</td></tr>
        <tr><th>Message-ID:</th><td><a href="#">${msgid}</a></td></tr>
      </table>
      <div class="message-content"><p>Hello patch.</p></div>
      <table class="message-attachments">
        <tr><th><a href="/message-id/attachment/1/${att}">${att}</a></th><td>text/x-patch</td><td>1 KB</td></tr>
      </table>`;
    const diff = "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Work\n\nBody.\n---\ndiff --git a/src/a.c b/src/a.c\n+x\n";

    put("https://commitfest.postgresql.org/patch/9999/", cfHtml);
    put(flatThreadUrl("t1@ex.org"), threadPage("t1@ex.org", "Alice", "2024-01-01 10:00:00", "v1-0001-work.patch"));
    put(flatThreadUrl("t2@ex.org"), threadPage("t2@ex.org", "Bob", "2026-01-01 10:00:00", "v8-0001-work.patch"));
    put("https://www.postgresql.org/message-id/attachment/1/v1-0001-work.patch", diff);
    put("https://www.postgresql.org/message-id/attachment/1/v8-0001-work.patch", diff);

    const full = await loadProposal("9999", { offline: true, cacheDir: dir });
    expect(full.thread.messages.length).toBe(2);
    expect(full.threadsRead?.length).toBe(2);
    expect(full.latestPatchFrom).toBe("Bob");
    expect(full.latestPatchVersion).toBe("v8");
    expect(full.latestPatchDate).toBe("2026-01-01T10:00:00Z");
    expect(full.patchProse[0]!.isLatest).toBe(true);
    expect(full.patchProse[0]!.attachment.name).toBe("v8-0001-work.patch");
    const mat = renderMaterial(full).text;
    expect(mat).toContain("Merged across 2 attached threads");
    expect(mat).toContain("Latest patch set being evaluated: version v8, from Bob, on 2026-01-01");

    // In --blind mode, only earliest thread is read.
    const blind = await loadProposal("9999", { blind: 1, offline: true, cacheDir: dir });
    expect(blind.thread.messages.length).toBe(1);
    expect(blind.threadsRead?.length).toBe(1);
    expect(blind.latestPatchVersion).toBe("v1");
  });
});

// -----------------------------------------------------------------------------
// 3. Novelty separation, Critic v2 (duplicate + upgrade to fatal), clean prose

class FakeBackend implements LlmBackend {
  readonly dryRun = false;
  calls: CompleteArgs[] = [];
  constructor(private readonly fn: (a: CompleteArgs) => unknown) {}
  stats() {
    return { calls: this.calls.length, costUsd: 0 };
  }
  async complete<T>(a: CompleteArgs): Promise<T> {
    this.calls.push(a);
    const v = this.fn(a);
    const errs = validate(v, a.schema);
    if (errs.length) throw new Error(`invalid ${a.label}: ${errs.join("; ")}`);
    return v as T;
  }
}

describe("v2 pipeline: novelty, critic duplicate + upgrade, clean lead prose", () => {
  test("stripInternalIds removes [P3] and angle-id references from lead prose", () => {
    expect(stripInternalIds("One objection, prior-attempts-1: lock level from [P3] is unanswered.")).toBe(
      "One objection: lock level from an earlier attempt is unanswered.",
    );
    expect(stripInternalIds("See standards-compat-2 and already-exists-1 ([P1]).")).toBe(
      "See the main objection and the main objection.",
    );
  });

  test("duplicate verdict stays separate from refuted; severity upgrade to fatal works; compact MD groups by novelty", async () => {
    const prop: ProposalInput = {
      input: "5879",
      ref: { kind: "cf", id: 5879 },
      cf: {
        id: 5879,
        url: "https://commitfest.postgresql.org/patch/5879/",
        title: "amcheck: support for GiST",
        status: "Ready for Committer",
        statuses: [],
        authors: "Andrey Borodin",
        reviewers: "",
        committer: "",
        tags: [],
        topic: "",
        targetVersion: "",
        created: "2025-06-30T11:34:22Z",
        threads: [],
        history: [],
        links: [],
        redacted: false,
      },
      thread: {
        threadUrl: "https://www.postgresql.org/message-id/flat/abc@example.org",
        rootMessageId: "abc@example.org",
        subject: "amcheck: support for GiST",
        lists: ["pgsql-hackers"],
        messages: [makeMsg({ index: 1, date: "2025-06-30T11:34:22Z" })],
      },
      totalMessages: 1,
      filters: { blind: null, before: null },
      threadStart: "2025-06-30T11:34:22Z",
      patchProse: [],
      latestPatchFrom: "Kirill Reshke <k@example.org>",
      latestPatchDate: "2026-09-25T10:00:00Z",
      latestPatchVersion: "v8",
      warnings: [],
    };

    const mkObj = (over: Partial<RawObjection>): RawObjection => ({
      title: "Default title",
      level: "2",
      rubric_item: 7,
      category: "design",
      touch_points: [],
      severity: "fixable",
      novelty: "new",
      failure_scenario: "Concurrent VACUUM deletes a page during index check.",
      argument: "The proposal does not explain lock ordering under concurrent page deletion.",
      precedent_ids: [],
      thread_message_refs: [1],
      author_must_show: "Which lock level prevents concurrent page deletion?",
      ...over,
    });

    const backend = new FakeBackend((a) => {
      if (a.label === "brief") {
        return {
          title: "amcheck: support for GiST",
          problem: "No amcheck for GiST.",
          proposed_design: "Walk GiST tree depth-first.",
          user_visible_surface: ["gist_index_check()"],
          author_claims: ["Works on 9 opclasses."],
          thread_state: "Active.",
          unclear: ["Lock strength."],
          search_queries: ["q1", "q2", "q3", "q4", "q5"],
        } satisfies Brief;
      }
      if (a.label === "roaster-prior-attempts") {
        return {
          objections: [
            mkObj({
              title: "Lock strength from 2019 attempt unanswered",
              novelty: "revisits_precedent",
              severity: "fixable",
              argument: "In [P1] a reviewer asked about lock strength and page deletion.",
            }),
          ],
          prior_attempts: [],
          no_objection_note: "",
        } satisfies RoasterOutput;
      }
      if (a.label === "roaster-maintenance-fit") {
        return {
          objections: [
            mkObj({
              title: "Same lock-strength concern from maintenance angle",
              novelty: "new",
              severity: "fixable",
            }),
            mkObj({
              title: "Open thread debate on pg_amcheck scope",
              novelty: "open_in_thread",
              severity: "fixable",
              author_must_show: "Will pg_amcheck support ship separately?",
            }),
          ],
          prior_attempts: [],
          no_objection_note: "",
        } satisfies RoasterOutput;
      }
      if (a.label.startsWith("roaster-")) return { objections: [], prior_attempts: [], no_objection_note: "" };
      if (a.label === "critic") {
        return {
          verdicts: [
            {
              objection_id: "prior-attempts-1",
              verdict: "survived",
              refutation_kind: "none",
              duplicate_of: null,
              reasoning: "Blocks concurrent safety unless lock ordering is proven.",
              adjusted_severity: "fatal", // upgraded from fixable -> fatal!
            },
            {
              objection_id: "maintenance-fit-1",
              verdict: "duplicate",
              refutation_kind: "none",
              duplicate_of: "prior-attempts-1",
              reasoning: "Same lock strength issue.",
              adjusted_severity: null,
            },
            {
              objection_id: "maintenance-fit-2",
              verdict: "survived",
              refutation_kind: "none",
              duplicate_of: null,
              reasoning: "Open in thread.",
              adjusted_severity: null,
            },
          ],
        } satisfies CriticOutput;
      }
      if (a.label === "synth") {
        return {
          verdict: "LIKELY-REJECT",
          confidence: "high",
          verdict_reasoning: "prior-attempts-1 blocks concurrent safety based on [P1].",
          failing_level: "2",
          ranked_objection_ids: ["maintenance-fit-2", "prior-attempts-1"],
          touch_points: TOUCH_POINT_IDS.map((id) => ({ id, hit: false, reason: "" })),
          questions: ["Which lock prevents concurrent page deletion?"],
          prior_attempts: [],
          committability: { owner: "silent", owner_note: "GiST committer", liability: "amcheck", author_follow_up: "active" },
          not_now: { applies: false, evidence_that_would_change_it: "" },
          priority: { audience: "a sizeable minority", maintenance_burden: "medium", review_cost: "medium", recommended_action: "fix design first", reason: "Need lock proof." },
          provisional_note: "No code read.",
        } satisfies SynthOutput;
      }
      throw new Error(`unexpected ${a.label}`);
    });

    const r = await runRoast(prop, {
      backend,
      models: modelsFromEnv({}),
      enrich: false,
      search: async () => [],
      log: () => undefined,
    });

    expect(r.schema_version).toBe(SCHEMA_VERSION);
    expect(r.schema_version).toBe(2);
    expect(r.refuted).toEqual([]);
    expect(r.duplicates?.map((d) => d.id)).toEqual(["maintenance-fit-1"]);
    expect(r.duplicates?.[0]!.critic.duplicate_of).toBe("prior-attempts-1");
    const upgraded = r.objections.find((o) => o.id === "prior-attempts-1")!;
    expect(upgraded.severity).toBe("fatal");
    expect(upgraded.critic.original_severity).toBe("fixable");
    expect(upgraded.novelty).toBe("revisits_precedent");

    const short = renderCompactMarkdown(r);
    expect(short).toContain("## New & unraised objections");
    expect(short).toContain("## Already open in thread");
    expect(short).toContain("patch v8, from Kirill Reshke, 2026-09-25");
    // Lead prose strips internal IDs; metadata/appendix keeps them.
    const verdictSection = short.split("## New & unraised objections")[0]!;
    expect(verdictSection).not.toContain("prior-attempts-1");
    expect(verdictSection).not.toContain("[P1]");
    expect(short).toContain("1 duplicate(s)");

    const full = renderMarkdown(r);
    expect(full).toContain("### Duplicates merged in the counter-check");
    expect(full).toContain("Duplicate of `prior-attempts-1`");
  });
});

// -----------------------------------------------------------------------------
// 4. Experts + Shortlist

describe("v2 experts and shortlist", () => {
  test("parseGitLogExperts weights recency, commits, and Reviewed-by trailers", () => {
    const log = [
      "2026-11-20T10:00:00Z|Andrey Borodin|x4m@yandex-team.ru",
      "Fix GiST split.",
      "",
      "Reviewed-by: Peter Geoghegan <pg@bowt.ie>, Kirill Reshke <k@example.org>",
      "---END---",
      "2024-01-01T10:00:00Z|Old Committer|old@example.org",
      "Old change.",
      "---END---",
    ].join("\n");
    const experts = parseGitLogExperts(log, new Date("2026-11-25T00:00:00Z"));
    expect(experts[0]!.name).toBe("Andrey Borodin");
    expect(experts[0]!.commits).toBe(1);
    expect(experts.map((e) => e.name)).toContain("Peter Geoghegan");
    expect(experts.find((e) => e.name === "Peter Geoghegan")!.reviews).toBe(1);
    // Recent reviewer beats 2.9-year-old single commit due to recency decay.
    expect(experts.find((e) => e.name === "Peter Geoghegan")!.score).toBeGreaterThan(
      experts.find((e) => e.name === "Old Committer")!.score,
    );
  });

  test("findSubsystemExperts queries a real temp git repo and degrades gracefully on missing repo", () => {
    expect(findSubsystemExperts("/nonexistent/repo", ["src/a.c"])).toEqual([]);
    const repo = mkdtempSync(join(tmpdir(), "pgroast-git-"));
    const run = (argv: string[]) => spawnSync("git", ["-C", repo, ...argv], { encoding: "utf8" });
    run(["init"]);
    run(["config", "user.name", "Heikki Linnakangas"]);
    run(["config", "user.email", "heikki@example.org"]);
    mkdirSync(join(repo, "contrib", "amcheck"), { recursive: true });
    writeFileSync(join(repo, "contrib", "amcheck", "verify_nbtree.c"), "/* test */\n");
    run(["add", "."]);
    run(["commit", "-m", "Add check\n\nReviewed-by: Andrey Borodin <x4m@example.org>"]);

    // Even a new file in contrib/amcheck resolves to parent directory contrib/amcheck!
    const found = findSubsystemExperts(repo, ["contrib/amcheck/verify_gist.c"]);
    expect(found.map((e) => e.name)).toEqual(["Heikki Linnakangas", "Andrey Borodin"]);
  });

  test("shortlist scores, separates shortlist vs top-reject, includes author next steps, works on v1 JSON", () => {
    const mkRoast = (id: number, over: Partial<Roast>): Roast => ({
      schema_version: 1,
      tool: "pgroast/0.1",
      generated_at: "2026-11-12T00:00:00Z",
      input: {
        arg: String(id),
        cf: { id, url: `https://commitfest.postgresql.org/patch/${id}/`, title: `Patch ${id}`, status: "Needs review", authors: "Author A", redacted: false },
        thread_url: `https://www.postgresql.org/message-id/flat/p${id}@ex.org`,
        subject: `Patch ${id}`,
        thread_start: "2026-01-01T00:00:00Z",
        messages_read: 10,
        messages_total: 10,
        blind: null,
        before: null,
        hint: null,
        attachments_read: [],
      },
      mode: "review",
      backend: "claude",
      models: { roaster: "opus", critic: "claude-mythos-5-2", synth: "claude-mythos-5-2", brief: "opus" },
      verdict: "NEEDS-COMMITTER-EYES",
      confidence: "high",
      verdict_reasoning: "Solid idea.",
      failing_level: null,
      levels: [],
      brief: { title: `Patch ${id}`, problem: "p", proposed_design: "d", user_visible_surface: [], author_claims: [], thread_state: "", unclear: [], search_queries: [] },
      prior_attempts: [],
      objections: [],
      other_surviving: [],
      refuted: [],
      withdrawn: [],
      touch_points: [],
      questions: ["Does it handle pg_upgrade?"],
      committability: { owner: "silent", owner_note: "GiST committer", liability: "low", author_follow_up: "active" },
      not_now: { applies: false, evidence_that_would_change_it: "" },
      priority: { audience: "most users", maintenance_burden: "low", review_cost: "medium", recommended_action: "proceed", reason: "Broad benefit." },
      self_advice: [],
      provisional_note: "",
      disclosure: "Prepared by an AI harness; treat as a devil's advocate, not a verdict.",
      precedents_retrieved: [],
      precedent_cutoff: "2026-01-01",
      precedent_backend: "pg",
      enrichment: null,
      roaster_notes: [],
      rounds_requested: 0,
      rounds: [],
      invariants_loaded: [],
      warnings: [],
      tone_lint: { fields_checked: 0, hits_found: 0, sentences_rewritten: 0, repair_call: "not needed", remaining: [] },
      sanitizer: { urls_removed: [], precedent_ids_dropped: [], thread_refs_dropped: [], quotes_dropped: [] },
      stats: { llm_calls: 10, wall_ms: 1000, cost_usd: null, dry_run: false },
      ...over,
    });

    const strong = mkRoast(101, {
      verdict: "NO-FUNDAMENTAL-OBJECTION",
      priority: { audience: "most users", maintenance_burden: "low", review_cost: "low", recommended_action: "proceed", reason: "High impact speedup for contrib/amcheck." },
    });
    const dead = mkRoast(202, {
      verdict: "LIKELY-REJECT",
      not_now: { applies: true, evidence_that_would_change_it: "Real production workload showing 20% gain." },
      priority: { audience: "niche", maintenance_burden: "high", review_cost: "high", recommended_action: "close: dead or superseded", reason: "Superseded by core feature." },
    });

    expect(inferFilesFromRoast(strong)).toContain("contrib/amcheck");
    expect(scoreEntry(strong, "a", "101").attentionScore).toBeGreaterThan(scoreEntry(dead, "b", "202").attentionScore);
    expect(scoreEntry(dead, "b", "202").rejectScore).toBeGreaterThan(scoreEntry(strong, "a", "101").rejectScore);

    const built = buildShortlist(
      [
        { slug: "101", path: "cf/101/roast.json", roast: strong },
        { slug: "202", path: "cf/202/roast.json", roast: dead },
      ],
      { top: 10, reject: 10 },
    );
    expect(built.shortlist.map((e) => e.cfId)).toEqual([101]);
    expect(built.reject_list.map((e) => e.cfId)).toEqual([202]);
    expect(built.reject_list[0]!.nextStepForAuthor).toContain("Real production workload");

    const smd = renderShortlistMarkdown(built);
    const rmd = renderRejectMarkdown(built);
    expect(smd).toContain("CommitFest Shortlist");
    expect(smd).toContain("CF 101");
    expect(rmd).toContain("Next step for author");
    expect(rmd).toContain("CF 202");

    // End-to-end runShortlist on disk
    const batchDir = mkdtempSync(join(tmpdir(), "pgroast-shortlist-"));
    mkdirSync(join(batchDir, "cf", "101"), { recursive: true });
    mkdirSync(join(batchDir, "cf", "202"), { recursive: true });
    writeFileSync(join(batchDir, "cf", "101", "roast.json"), JSON.stringify(strong));
    writeFileSync(join(batchDir, "cf", "202", "roast.json"), JSON.stringify(dead));
    const outDir = join(batchDir, "digest");
    const run = runShortlist({ batchDir, outDir, top: 5, reject: 5, log: () => undefined });
    expect(existsSync(join(outDir, "shortlist.md"))).toBe(true);
    expect(existsSync(join(outDir, "top-reject.md"))).toBe(true);
    expect(existsSync(join(outDir, "shortlist.json"))).toBe(true);
    expect(run.result.total_entries).toBe(2);

    expect(parseShortlistArgs(["/tmp/b", "--top", "15", "--reject=40", "--pg-repo", "/pg"])).toEqual({
      batchDir: "/tmp/b",
      top: 15,
      reject: 40,
      pgRepo: "/pg",
    });
  });
});

// -----------------------------------------------------------------------------
// 5. pgsql-bugs production-impact triage

describe("v2 pgsql-bugs triage", () => {
  const archiveHtml = `
    <table>
      <tr>
        <td><a href="/message-id/prod1%40ex.org">BUG #19001: Data corruption after pg_upgrade in production</a></td>
        <td>Jane Ops</td>
        <td>2026-11-22 14:10:00</td>
      </tr>
      <tr>
        <td><a href="/message-id/prod1-re%40ex.org">Re: BUG #19001: Data corruption after pg_upgrade in production</a></td>
        <td>Tom Lane</td>
        <td>2026-11-23 09:00:00</td>
      </tr>
      <tr>
        <td><a href="/message-id/fuzz1%40ex.org">BUG #19002: TRAP: failedAssertion in 19devel found by sqlsmith</a></td>
        <td>Fuzz Bot</td>
        <td>2026-11-24 08:00:00</td>
      </tr>
    </table>`;

  test("parseBugsArchiveMonth deduplicates BUG threads and parses dates/authors", () => {
    const items = parseBugsArchiveMonth(archiveHtml, "2026-11");
    expect(items.length).toBe(2);
    expect(items.map((i) => i.messageId)).toEqual(["fuzz1@ex.org", "prod1@ex.org"]);
    expect(items[1]!.author).toBe("Jane Ops");
  });

  test("analyzeBugSignals and heuristicClassification separate production hits from synthetic hunts", () => {
    const prodThread: Thread = {
      threadUrl: flatThreadUrl("prod1@ex.org"),
      rootMessageId: "prod1@ex.org",
      subject: "BUG #19001: Data corruption after pg_upgrade",
      lists: ["pgsql-bugs"],
      messages: [
        makeMsg({
          index: 1,
          messageId: "prod1@ex.org",
          date: "2026-11-22T14:10:00Z",
          body: "We hit data corruption in production on PostgreSQL 17.2 right after upgrading from PG 16.4.\nSELECT * FROM orders fails with invalid page.",
        }),
      ],
    };
    const fuzzThread: Thread = {
      threadUrl: flatThreadUrl("fuzz1@ex.org"),
      rootMessageId: "fuzz1@ex.org",
      subject: "BUG #19002: assertion failure",
      lists: ["pgsql-bugs"],
      messages: [
        makeMsg({
          index: 1,
          messageId: "fuzz1@ex.org",
          date: "2026-11-24T08:00:00Z",
          body: "Found while fuzzing with sqlsmith on 19devel built from master with --enable-cassert: TRAP: failedAssertion.",
        }),
      ],
    };

    const ps = analyzeBugSignals(prodThread);
    const pc = heuristicClassification(prodThread, ps);
    expect(pc.origin).toBe("production_hit");
    expect(pc.impact).toBe("data_loss_or_corruption");
    expect(pc.pg_versions).toEqual(["17.2", "16.4"]);
    expect(pc.has_reproducer).toBe(true);

    const fs = analyzeBugSignals(fuzzThread);
    const fc = heuristicClassification(fuzzThread, fs);
    expect(fc.origin).toBe("synthetic_ai_hunt");
  });

  test("runBugsTriage ranks production hits first, verifies quotes, and writes markdown + JSON", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "pgroast-bugs-"));
    const threads: Record<string, Thread> = {
      "prod1@ex.org": {
        threadUrl: flatThreadUrl("prod1@ex.org"),
        rootMessageId: "prod1@ex.org",
        subject: "BUG #19001: Missing rows in production",
        lists: ["pgsql-bugs"],
        messages: [
          makeMsg({
            index: 1,
            messageId: "prod1@ex.org",
            date: "2026-11-22T14:10:00Z",
            from: "Jane Ops <jane@ex.org>",
            body: "Our production cluster on PostgreSQL 17.2 returns missing rows after index scan.",
          }),
        ],
      },
      "fuzz1@ex.org": {
        threadUrl: flatThreadUrl("fuzz1@ex.org"),
        rootMessageId: "fuzz1@ex.org",
        subject: "BUG #19002: sqlsmith crash on 19devel",
        lists: ["pgsql-bugs"],
        messages: [
          makeMsg({
            index: 1,
            messageId: "fuzz1@ex.org",
            date: "2026-11-24T08:00:00Z",
            from: "Fuzz Bot <fuzz@ex.org>",
            body: "sqlsmith generated query hits assertion failure on 19devel.",
          }),
        ],
      },
    };
    const llm = new FakeBackend((a) => {
      if (a.prompt.includes("Jane Ops")) {
        return {
          origin: "production_hit",
          impact: "wrong_results",
          pg_versions: ["17.2"],
          has_reproducer: false,
          summary: "Production PG 17.2 returns missing rows on index scan.",
          evidence_quote: "Our production cluster on PostgreSQL 17.2 returns missing rows after index scan.",
        } satisfies BugClassification;
      }
      return {
        origin: "synthetic_ai_hunt",
        impact: "crash_or_oom",
        pg_versions: ["19devel"],
        has_reproducer: true,
        summary: "Synthetic sqlsmith assertion failure on devel.",
        evidence_quote: "invented quote that is not in the thread at all",
      } satisfies BugClassification;
    });

    const { report } = await runBugsTriage({
      days: 14,
      limit: 10,
      outDir,
      now: new Date("2026-11-25T00:00:00Z"),
      log: () => undefined,
      fetchArchive: async () => archiveHtml,
      loadThreadFn: async (id) => threads[id]!,
      llmBackend: llm,
    });

    expect(report.bugs.length).toBe(2);
    // Production hit MUST rank above synthetic hunt even though synthetic is newer!
    expect(report.bugs[0]!.message_id).toBe("prod1@ex.org");
    expect(report.bugs[0]!.origin).toBe("production_hit");
    expect(report.bugs[0]!.quote_verified).toBe(true);
    expect(report.bugs[1]!.message_id).toBe("fuzz1@ex.org");
    expect(report.bugs[1]!.quote_verified).toBe(false);
    expect(report.warnings.some((w) => w.includes("unverified evidence_quote"))).toBe(true);

    const md = readFileSync(join(outDir, "bugs-triage.md"), "utf8");
    expect(md).toContain("## Production Hits (Highest Priority) (1)");
    expect(md).toContain("## Synthetic / Fuzzer / AI Bug Hunts (1)");
    expect(md.indexOf("Production Hits")).toBeLessThan(md.indexOf("Synthetic / Fuzzer"));
    expect(existsSync(join(outDir, "bugs-triage.json"))).toBe(true);

    expect(parseBugsArgs(["--days", "7", "--limit=20", "--backend", "agy", "--dry-run"])).toEqual({
      days: 7,
      limit: 20,
      backend: "agy",
      dryRun: true,
    });
    expect(validate(report.bugs[0]!, BUG_TRIAGE_SCHEMA)).toEqual([]);
    expect(rankBugReports([...report.bugs].reverse())[0]!.message_id).toBe("prod1@ex.org");
  });
});

describe("v2 embedded basic skills and custom override", () => {
  test("loads built-in default skills and allows custom directory override", async () => {
    const { loadSkill, loadSkills } = await import("../src/skills.ts");
    const builtins = loadSkills("");
    const names = builtins.map((s) => s.name);
    expect(names).toContain("hackers-review");
    expect(names).toContain("patch-verify");
    expect(names).toContain("bug-triage");
    expect(builtins.every((s) => s.source === "builtin")).toBe(true);

    const customDir = mkdtempSync(join(tmpdir(), "pgroast-skills-"));
    try {
      mkdirSync(join(customDir, "custom-extra"), { recursive: true });
      writeFileSync(join(customDir, "hackers-review.md"), "# Custom review rules\n");
      writeFileSync(join(customDir, "custom-extra", "SKILL.md"), "# Extra skill\n");

      const merged = loadSkills(customDir);
      const review = merged.find((s) => s.name === "hackers-review");
      const verify = merged.find((s) => s.name === "patch-verify");
      const extra = loadSkill("custom-extra", customDir);

      expect(review?.source).toBe("custom");
      expect(review?.content).toContain("Custom review rules");
      expect(verify?.source).toBe("builtin");
      expect(extra?.source).toBe("custom");
      expect(extra?.content).toContain("Extra skill");
    } finally {
      rmSync(customDir, { recursive: true, force: true });
    }
  });
});
