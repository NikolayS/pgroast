import { describe, expect, test } from "bun:test";
import {
  buildRfc2822Message,
  cfbotAttachmentCheck,
  duplicateGateCheck,
  plainTextEtiquetteCheck,
  publicConfidentialityCheck,
  runAllDraftGates,
  wrapEmailBody,
} from "../src/services/gates.ts";

describe("Safety Gate 1: publicConfidentialityCheck", () => {
  test("HARD BLOCKS leaked model names, internal process terms, and local paths", () => {
    const leaky = [
      "I ran Claude Opus 5.5 and Gemini 4 Neon XHigh through our full review gate.",
      "A blind gate subagent checked /Users/dev/work/postgres using pg-correctness-harness.",
      "See ~/github/skills for our harness gates.",
    ].join("\n");

    const res = publicConfidentialityCheck(leaky);
    expect(res.passed).toBe(false);
    expect(res.blocking).toBe(true);
    const codes = res.issues.map((i) => i.code);
    expect(codes).toContain("model_claude");
    expect(codes).toContain("model_opus");
    expect(codes).toContain("model_gemini");
    expect(codes).toContain("model_neon");
    expect(codes).toContain("proc_review_gate");
    expect(codes).toContain("proc_blind_gate");
    expect(codes).toContain("proc_subagent");
    expect(codes).toContain("proc_skill_harness");
    expect(codes).toContain("proc_harness_gate");
    expect(codes).toContain("local_path_home_dir");
    expect(codes).toContain("local_path_home_github");
  });

  test("ALLOWS 'My AI harness' and factual AI disclosure, and ignores quoted lines", () => {
    const clean = [
      "On Tue, Nov 24, 2026 at 10:00 AM Someone <dev@example.com> wrote:",
      "> Did someone test this with Claude or GPT?",
      "",
      "My AI harness tested v4 on upstream master at 1234567890ab.",
      "AI found one edge case and prepared the attached patch; I have not manually reviewed every line yet.",
      "",
      "Nik",
    ].join("\n");

    const res = publicConfidentialityCheck(clean);
    expect(res.passed).toBe(true);
    expect(res.blocking).toBe(false);
    expect(res.issues.length).toBe(0);
  });
});

describe("Safety Gate 2: cfbotAttachmentCheck", () => {
  test("blocks unprefixed .patch/.diff on another author's CF thread", () => {
    const res = cfbotAttachmentCheck(
      [{ filename: "0001-add-test.patch" }, { filename: "extra.diff.gz" }],
      true,
    );
    expect(res.passed).toBe(false);
    expect(res.blocking).toBe(true);
    expect(res.issues.filter((i) => i.code === "cfbot_hijack_risk").length).toBe(2);
  });

  test("allows nocfbot- prefix or .txt suffix on another author's CF thread", () => {
    const res = cfbotAttachmentCheck(
      [
        { filename: "nocfbot-repro-test.diff" },
        { filename: "0001-suggestion.patch.txt" },
        { filename: "ai-notes-cf-5879.txt" },
      ],
      true,
    );
    expect(res.passed).toBe(true);
    expect(res.blocking).toBe(false);
  });

  test("allows standard vN-0001-*.patch on Nik's own thread", () => {
    const res = cfbotAttachmentCheck([{ filename: "v4-0001-fix-race.patch" }], false);
    expect(res.passed).toBe(true);
    expect(res.blocking).toBe(false);
  });
});

describe("Safety Gate 3: plainTextEtiquetteCheck & wrapEmailBody", () => {
  test("flags Markdown fences, backticks, links, NBSP, uppercase SQL, emojis, em-dashes, and missing quotes", () => {
    const bad = [
      "## Summary",
      "Here is `SELECT * FROM pg_class` — importantly, see [link](https://example.com) 🚀",
      "```sql",
      "SELECT 1;\u00a0",
      "```",
    ].join("\n");

    const res = plainTextEtiquetteCheck(bad, true, "Re: test");
    expect(res.passed).toBe(false);
    const codes = res.issues.map((i) => i.code);
    expect(codes).toContain("markdown_fence");
    expect(codes).toContain("markdown_link");
    expect(codes).toContain("markdown_heading");
    expect(codes).toContain("inline_backticks");
    expect(codes).toContain("nbsp_present");
    expect(codes).toContain("uppercase_sql");
    expect(codes).toContain("em_dash");
    expect(codes).toContain("emoji");
    expect(codes).toContain("banned_filler");
    expect(codes).toContain("missing_quote");
    expect(codes).toContain("missing_attribution");
  });

  test("passes a clean Nik-voice bottom-posted plain-text reply", () => {
    const good = [
      "On Tue, Nov 24, 2026 at 10:00 AM Andrey Borodin <x4mmm@yandex-team.ru> wrote:",
      "> Here is v2026-09-25 with the new TAP test.",
      "",
      "My AI harness tested v2026-09-25 on upstream master at 1234567890ab.",
      "The new TAP test passes with assertions enabled. I checked select 1",
      "and ran isolation checks [1].",
      "",
      "[1] https://commitfest.postgresql.org/patch/5879/",
      "",
      "Nik",
    ].join("\n");

    const res = plainTextEtiquetteCheck(good, true, "Re: amcheck: support for GiST");
    expect(res.passed).toBe(true);
    expect(res.issues.length).toBe(0);
  });

  test("wrapEmailBody wraps prose at 72 cols while preserving URLs and > quotes", () => {
    const input = [
      "> This is a very long quoted line from another author that exceeds seventy two columns and must not be reflowed.",
      "",
      "This is a long plain prose paragraph written by Nik that should wrap cleanly around seventy two columns without breaking words.",
      "",
      "[1] https://www.postgresql.org/message-id/flat/5FC1B5B6-FB35-44A2-AB62-632F14E958C5%40yandex-team.ru",
    ].join("\n");

    const wrapped = wrapEmailBody(input, 72);
    const lines = wrapped.split("\n");
    expect(lines[0]).toContain("must not be reflowed.");
    expect(lines.some((l) => l.startsWith("[1] https://"))).toBe(true);
    const proseLines = lines.filter((l) => l && !l.startsWith(">") && !l.startsWith("[1]"));
    expect(proseLines.length).toBeGreaterThanOrEqual(2);
    for (const pl of proseLines) {
      expect(pl.length).toBeLessThanOrEqual(72);
    }
  });
});

describe("Safety Gate 4 & Combined Runner + RFC 2822 MIME Builder", () => {
  test("flags stale thread when live message time moved forward", () => {
    const res = duplicateGateCheck({
      cfId: 5879,
      subject: "Re: amcheck",
      knownLatestMessageTime: "2026-09-25T10:00:00Z",
      liveLatestMessageTime: "2026-11-24T12:00:00Z",
      lastSyncedAt: "2026-11-24T12:00:00Z",
    });
    expect(res.passed).toBe(false);
    expect(res.issues.some((i) => i.code === "thread_moved")).toBe(true);
  });

  test("runAllDraftGates blocks saving if confidentiality fails", () => {
    const res = runAllDraftGates({
      subject: "Re: test",
      body: "Tested with Claude Fable 5.2.",
      isReply: false,
      isOtherAuthorThread: false,
      attachments: [],
    });
    expect(res.hardBlocked).toBe(true);
    expect(res.canSaveDraft).toBe(false);
  });

  test("buildRfc2822Message creates valid threaded multipart/mixed MIME with base64 attachments", () => {
    const msg = buildRfc2822Message({
      from: "nik@postgres.ai",
      to: "pgsql-hackers@lists.postgresql.org",
      cc: "x4mmm@yandex-team.ru",
      subject: "Re: amcheck: support for GiST",
      inReplyTo: "5FC1B5B6-FB35-44A2-AB62-632F14E958C5@yandex-team.ru",
      references: "<older@example.com>",
      body: "On Tue, Nov 24, 2026, Andrey wrote:\n> Hello\n\nLooks good.\n\nNik",
      attachments: [
        {
          filename: "nocfbot-repro.diff",
          mimeType: "text/x-diff",
          contentText: "diff --git a/foo.c b/foo.c\n+int x = 1;\n",
        },
      ],
    });

    expect(msg.attachmentCount).toBe(1);
    expect(msg.raw).toContain("From: nik@postgres.ai\r\n");
    expect(msg.raw).toContain("To: pgsql-hackers@lists.postgresql.org\r\n");
    expect(msg.raw).toContain("Cc: x4mmm@yandex-team.ru\r\n");
    expect(msg.raw).toContain("In-Reply-To: <5FC1B5B6-FB35-44A2-AB62-632F14E958C5@yandex-team.ru>\r\n");
    expect(msg.raw).toContain("References: <older@example.com> <5FC1B5B6-FB35-44A2-AB62-632F14E958C5@yandex-team.ru>\r\n");
    expect(msg.raw).toContain('Content-Type: multipart/mixed; boundary="');
    expect(msg.raw).toContain('Content-Disposition: attachment; filename="nocfbot-repro.diff"');
    expect(msg.base64url).not.toContain("+");
    expect(msg.base64url).not.toContain("/");
    expect(msg.base64url).not.toContain("=");
  });
});
