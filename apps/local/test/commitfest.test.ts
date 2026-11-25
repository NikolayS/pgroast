import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../src/db.ts";
import { buildPgsqlBugsSinceUrl, classifyBugText, parsePgsqlBugsIndexHtml } from "../src/services/bugs.ts";
import { parseMeHtml, parsePatchHtml } from "../src/services/commitfest.ts";
import { parseEntryQuery } from "../src/services/query.ts";
import {
  buildFailingSummary,
  buildShortlistAndTop50,
  classifyEntryKind,
  extractWorkaroundFinding,
  renderShortlistDigestMarkdown,
} from "../src/services/shortlist.ts";
import { exportFrozenStaticSnapshot } from "../src/services/snapshot.ts";
import { buildStatsReport } from "../src/services/stats.ts";
import type { RoastJson } from "../src/types.ts";

describe("CommitFest HTML parsing", () => {
  test("parses patch metadata, CSRF token, cfbot status, links, and stats", () => {
    const html = `
      <html>
        <head><title>amcheck: support for GiST - PostgreSQL Commitfest</title></head>
        <body>
          <h1>amcheck: support for GiST</h1>
          <form method="post">
            <input type="hidden" name="csrfmiddlewaretoken" value="tok_abc123XYZ">
          </form>
          <table>
            <tr><th>Status</th><td>Ready for Committer</td></tr>
            <tr><th>Topic</th><td>Miscellaneous</td></tr>
            <tr><th>Authors</th><td>Andrey Borodin (x4m)</td></tr>
            <tr><th>Reviewers</th><td>Sergey Dudoladov, Miłosz Bieniek</td></tr>
            <tr><th>Committer</th><td></td></tr>
            <tr><th>Target version</th><td>20</td></tr>
            <tr><th>CI (CFBot)</th><td>
              Passed. <a href="https://github.com/postgres/postgres-cfbot/actions/runs/99887766/attempts/1">Summary</a>
              <a href="https://github.com/postgres/postgres-cfbot/actions/runs/99887766/job/1111">Linux pass</a>
              Patch version: v2026, Patch count: 3, First patch: +117−107, All patches: +1309−112
            </td></tr>
          </table>
          <a href="https://www.postgresql.org/message-id/flat/5FC1B5B6-FB35-44A2-AB62-632F14E958C5%40yandex-team.ru">Thread</a>
          <button onclick="annotateMessage(777, '5FC1B5B6')">Annotate</button>
          <a href="/att/v2026-09-25-0001-Move-normalize-tuple-logic.patch">patch</a>
        </body>
      </html>
    `;

    const parsed = parsePatchHtml(5879, html);
    expect(parsed.title).toBe("amcheck: support for GiST");
    expect(parsed.csrfToken).toBe("tok_abc123XYZ");
    expect(parsed.status).toBe("Ready for Committer");
    expect(parsed.authors).toContain("Andrey Borodin");
    expect(parsed.reviewers).toContain("Sergey Dudoladov");
    expect(parsed.cfbotStatus).toBe("passing");
    expect(parsed.cfbotBuildUrl).toContain("/actions/runs/99887766/attempts/1");
    expect(parsed.cfbotStats.version).toBe("v2026");
    expect(parsed.cfbotStats.patchCount).toBe(3);
    expect(parsed.cfbotStats.allAdditions).toBe(1309);
    expect(parsed.cfbotStats.jobs?.length).toBe(1);
    expect(parsed.mailthreadId).toBe("777");
    expect(parsed.attachments).toContain("v2026-09-25-0001-Move-normalize-tuple-logic.patch");
  });

  test("parses /me/ authenticated and unauthenticated states", () => {
    const loggedOut = `<html><body>The website you are trying to log in to (commitfest.postgresql.org)</body></html>`;
    expect(parseMeHtml(loggedOut, "nikolay").authenticated).toBe(false);

    const loggedIn = `
      <html><body>
        <div>Logged in as <a href="/me/">nikolay</a> | <a href="/logout/">Log out</a></div>
        <h2>Patches you are author of</h2>
        <a href="/patch/6100/">Fix race in slot sync</a>
        <h2>Patches you are reviewer of</h2>
        <a href="/patch/5879/">amcheck: support for GiST</a>
      </body></html>
    `;
    const res = parseMeHtml(loggedIn, "nikolay");
    expect(res.authenticated).toBe(true);
    expect(res.username).toBe("nikolay");
    expect(res.entries.length).toBe(2);
    expect(res.entries[0]?.role).toBe("author");
    expect(res.entries[1]?.role).toBe("reviewer");
  });
});

describe("Shortlist & Top-50 Engine + pgsql-bugs Triage", () => {
  test("ranks Top Shortlist and Top 50 Closing/Rethinking accurately", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-sl-"));
    const schema = `test_sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const db = await AppDatabase.create({ schema, secretKeyPath: join(dir, ".secret.key") });
    try {
      const strong: RoastJson = {
        input: { cf: { id: 6617, title: "Fix a file descriptor leak when using io_method=io_uring", status: "Ready for Committer", authors: "Alice" } },
        verdict: "NO-FUNDAMENTAL-OBJECTION",
        confidence: "high",
        objections: [],
        priority: { audience: "most users", maintenance_burden: "low", review_cost: "low", recommended_action: "proceed", reason: "Clear leak fix" },
      };
      const rejectable: RoastJson = {
        input: { cf: { id: 5845, title: "Carefully exposing information without authentication", status: "Needs review", authors: "Bob" } },
        verdict: "LIKELY-REJECT",
        confidence: "high",
        objections: [{ title: "Separate service already solves this", severity: "fatal", author_must_show: "Why this must live in core postmaster" }],
        not_now: { applies: true, evidence_that_would_change_it: "Show real operator demand that external tools cannot meet." },
        priority: { audience: "niche", maintenance_burden: "high", review_cost: "high", recommended_action: "park", reason: "Does not fit core" },
      };

      await db.ingestRoastResult(6617, strong, "# strong");
      await db.ingestRoastResult(5845, rejectable, "# reject");

      const data = await buildShortlistAndTop50(db, { topN: 10, rejectN: 10, includeExperts: true });
      expect(data.shortlist.length).toBe(1);
      expect(data.shortlist[0]?.cf_id).toBe(6617);
      expect(data.shortlist[0]?.experts.length).toBeGreaterThan(0);

      expect(data.top50Closing.length).toBe(1);
      expect(data.top50Closing[0]?.cf_id).toBe(5845);
      expect(data.top50Closing[0]?.next_step_for_author).toContain("operator demand");

      const md = renderShortlistDigestMarkdown(data);
      expect(md).toContain("CommitFest Shortlist");
      expect(md).toContain("CF 6617");
      expect(md).toContain("CF 5845");
    } finally {
      await db.dropSchemaAndClose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  test("classifies pgsql-bugs production hits vs synthetic AI bug hunts", () => {
    const prod = classifyBugText(
      "BUG #19201: wrong results on partitioned join after upgrading to PostgreSQL 18.2",
      "We hit this in production on our 4 TB primary cluster after upgrading from 17 to 18.2. Our customer billing queries started returning missing rows.",
    );
    expect(prod.classification).toBe("production_hit");
    expect(prod.severity).toBe("wrong_results");
    expect(prod.affectedVersions).toContain("18.2");

    const synth = classifyBugText(
      "Assertion failure found by sqlsmith fuzzing on master HEAD",
      "While auditing the planner with an AI static analysis tool and sqlsmith fuzzer on git master, I noticed a crafted query triggers an assertion.",
    );
    expect(synth.classification).toBe("synthetic_ai_hunt");
    expect(synth.severity).toBe("crash");
  });

  test("builds 12-digit postgresql.org /since/ URL and parses index + Next link", () => {
    const url = buildPgsqlBugsSinceUrl(new Date("2026-11-11T15:30:00Z"));
    expect(url).toBe("https://www.postgresql.org/list/pgsql-bugs/since/202611110000/");

    const sampleHtml = `
      <a href="/list/pgsql-bugs/before/202611110000" rel="nofollow">Prev</a>
      <a href="/list/pgsql-bugs/since/202611160000" rel="nofollow">Next</a>
      <a href="/message-id/19876-fb930ea061e49748%40postgresql.org">BUG #19876: repo &#x27;pgdg16&#x27; missing repodata</a>
      <a href="/message-id/abc%40mail.gmail.com">Re: BUG #19876: repo &#x27;pgdg16&#x27; missing repodata &#x1f4ce;</a>
    `;
    const parsed = parsePgsqlBugsIndexHtml(sampleHtml);
    expect(parsed.nextUrl).toBe("https://www.postgresql.org/list/pgsql-bugs/since/202611160000/");
    expect(parsed.entries.length).toBe(2);
    expect(parsed.entries[0]?.messageId).toBe("19876-fb930ea061e49748@postgresql.org");
    expect(parsed.entries[0]?.subject).toBe("BUG #19876: repo 'pgdg16' missing repodata");
    expect(parsed.entries[0]?.isReply).toBe(false);
    expect(parsed.entries[1]?.isReply).toBe(true);
  });

  test("parses structured query tokens, computes Stats report, and persists triage & saved searches", async () => {
    const q = parseEntryQuery('status:ready no:committer verdict:clean has:novel author:"Tom Lane" tag:shortlist vacuum');
    expect(q.status).toBe("Ready for Committer");
    expect(q.noCommitter).toBe(true);
    expect(q.verdict).toBe("NO-FUNDAMENTAL-OBJECTION");
    expect(q.hasNovel).toBe(true);
    expect(q.author).toBe("Tom Lane");
    expect(q.tag).toBe("shortlist");
    expect(q.freeText).toEqual(["vacuum"]);

    const dir = mkdtempSync(join(tmpdir(), "pgroast-stats-"));
    const schema = `test_stats_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const db = await AppDatabase.create({ schema, secretKeyPath: join(dir, ".secret.key") });
    try {
      const clean: RoastJson = {
        input: { cf: { id: 7001, title: "Fix fd leak in io_uring", status: "Ready for Committer", authors: "Alice" } },
        verdict: "NO-FUNDAMENTAL-OBJECTION",
        confidence: "high",
        objections: [{ title: "Minor doc gap", severity: "fixable", novelty: "new" }],
      };
      await db.ingestRoastResult(7001, clean, "# md");
      await db.upsertEntryMetadata({ cf_id: 7002, title: "Unroasted new feature", status: "Needs review", authors: "Bob" });
      await db.upsertEntryTriage(7001, { starred: true, tags: ["shortlist"], notes: "Check on Linux" });
      await db.saveSearch("My RFC Queue", "status:ready no:committer");

      const report = await buildStatsReport(db);
      expect(report.totals.total).toBe(2);
      expect(report.totals.roasted).toBe(1);
      expect(report.totals.unroasted).toBe(1);
      expect(report.novelty.newCount).toBe(1);
      expect(report.rfcNoCommitter.length).toBe(1);
      expect(report.triage.starred).toBe(1);
      expect((await db.listSavedSearches()).length).toBe(1);

      const filtered = await db.listEntries({ search: "status:ready no:committer is:starred tag:shortlist" });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.cf_id).toBe(7001);

      const unroasted = await db.listEntries({ search: "is:unroasted" });
      expect(unroasted.total).toBe(1);
      expect(unroasted.items[0]?.cf_id).toBe(7002);

      // #193: bugfix vs feature split, workaround extraction, known-company prod signal, frozen static snapshot
      expect(classifyEntryKind("Fix fd leak in io_uring", clean)).toBe("bugfix");
      expect(classifyEntryKind("Add new COPY TO NULL sink", null)).toBe("feature");

      const withWorkaround: RoastJson = {
        input: { cf: { id: 7003, title: "COPY TO null sink", status: "Needs review", authors: "Carol" } },
        verdict: "LIKELY-REJECT",
        failing_level: "1b",
        objections: [
          {
            title: "pg_amcheck already covers reading the whole heap",
            category: "already-exists",
            severity: "fatal",
            argument: "Use pg_amcheck verify_heapam() instead.",
          },
        ],
      };
      expect(extractWorkaroundFinding(withWorkaround)).toContain("pg_amcheck");
      expect(buildFailingSummary(withWorkaround)).toBe("Fails at level 1b: already exists");
      await db.ingestRoastResult(7003, withWorkaround, "# reject");

      const knownCoBug = classifyBugText(
        "BUG #19950: standby crash after upgrade",
        "Hit on our standby cluster after upgrading to 18.2.",
        "eng@stripe.com",
      );
      expect(knownCoBug.classification).toBe("production_hit");
      expect(knownCoBug.signals.some((s) => s.includes("Known company"))).toBe(true);

      const snapDir = join(dir, "snap");
      const snap = await exportFrozenStaticSnapshot(db, { outDir: snapDir, topN: 10, rejectN: 10 });
      expect(existsSync(snap.indexPath)).toBe(true);
      expect(snap.entryPagesCount).toBe(2);
      const snapHtml = readFileSync(snap.indexPath, "utf8");
      expect(snapHtml).toContain("AI-prepared first pass");
      expect(snapHtml).toContain("CF page");
      expect(snapHtml).toContain("pg_amcheck");
      expect(snapHtml).not.toContain("Check on Linux"); // private notes must NEVER leak into public snapshot!
    } finally {
      await db.dropSchemaAndClose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
