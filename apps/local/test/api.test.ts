import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../src/db.ts";
import { createAppHandler, createAppServer } from "../src/server.ts";
import { parseUnifiedDiff } from "../src/services/diff.ts";
import type { RoastJson } from "../src/types.ts";

let tempDir = "";
let dbInstance: AppDatabase | null = null;
let appFetch: (req: Request) => Promise<Response>;
let authToken = "";

function req(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (path.startsWith("/api/") && !headers.has("Authorization") && authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  return appFetch(new Request(`http://127.0.0.1:3432${path}`, { ...init, headers }));
}

function makeTestSchema(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "pgroast-api-"));
  const db = await AppDatabase.create({
    schema: makeTestSchema("test_api"),
    secretKeyPath: join(tempDir, ".secret.key"),
  });
  dbInstance = db;

  const sampleRoast: RoastJson = {
    schema_version: 2,
    input: {
      cf: { id: 5879, title: "amcheck: support for GiST", status: "Ready for Committer", authors: "Andrey Borodin (x4m)" },
      thread_url: "https://www.postgresql.org/message-id/flat/5FC1B5B6%40yandex-team.ru",
    },
    verdict: "NEEDS-COMMITTER-EYES",
    confidence: "medium",
    verdict_reasoning: "Solid feature; lock strength question from 2019 remains.",
    objections: [
      {
        title: "Lock strength and concurrent page deletion",
        severity: "fixable",
        novelty: "revisits_precedent",
        failure_scenario: "Concurrent VACUUM deletes page during check.",
        author_must_show: "Explain relation lock level.",
      },
    ],
    priority: {
      audience: "a sizeable minority",
      maintenance_burden: "medium",
      review_cost: "medium",
      recommended_action: "needs champion",
      reason: "Fills amcheck gap",
    },
  };
  await db.ingestRoastResult(5879, sampleRoast, "# Roast 5879");

  const app = await createAppHandler({ db, autoImport: false, port: 3432 });
  appFetch = app.fetch;
  authToken = app.authToken;
});

afterAll(async () => {
  await dbInstance?.dropSchemaAndClose();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("HTTP API & SPA smoke integration tests", () => {
  test("Bun.serve binds cleanly to 127.0.0.1 and shuts down cleanly", async () => {
    const tmpDb = await AppDatabase.create({
      schema: makeTestSchema("test_serve"),
      secretKeyPath: join(tempDir, ".serve.key"),
    });
    const started = await createAppServer({ db: tmpDb, port: 0, autoImport: false });
    expect(started.server.hostname).toBe("127.0.0.1");
    expect(started.server.port).toBeGreaterThan(0);
    started.server.stop(true);
    await tmpDb.dropSchemaAndClose();
  });

  test("serves HTML, CSS, and Bun-bundled JS SPA", async () => {
    const htmlRes = await req("/");
    expect(htmlRes.status).toBe(200);
    expect(await htmlRes.text()).toContain("PgRoast");

    const cssRes = await req("/styles.css");
    expect(cssRes.status).toBe(200);
    expect(await cssRes.text()).toContain("--accent:");

    const jsRes = await req("/app.js");
    expect(jsRes.status).toBe(200);
    expect(await jsRes.text()).toContain("/api/shortlist");
  });

  test("GET /api/health, /api/entries, /api/entries/:id, /api/shortlist", async () => {
    const health = (await (await req("/api/health")).json()) as { ok: boolean; entriesCount: number; host: string };
    expect(health.ok).toBe(true);
    expect(health.host).toBe("127.0.0.1");
    expect(health.entriesCount).toBe(1);

    const entries = (await (await req("/api/entries?search=GiST")).json()) as { total: number; items: Array<{ cf_id: number }> };
    expect(entries.total).toBe(1);
    expect(entries.items[0]?.cf_id).toBe(5879);

    const detail = (await (await req("/api/entries/5879")).json()) as {
      entry: { cf_id: number };
      roast: { verdict: string };
      experts: Array<{ name: string }>;
    };
    expect(detail.entry.cf_id).toBe(5879);
    expect(detail.roast.verdict).toBe("NEEDS-COMMITTER-EYES");
    expect(detail.experts.length).toBeGreaterThan(0);

    const shortlist = (await (await req("/api/shortlist")).json()) as { shortlist: Array<{ cf_id: number }> };
    expect(shortlist.shortlist[0]?.cf_id).toBe(5879);

    const mdRes = await req("/api/shortlist?format=markdown");
    expect(mdRes.status).toBe(200);
    expect(await mdRes.text()).toContain("CF 5879");
  });

  test("POST /api/drafts/check-gates and /api/drafts/generate", async () => {
    const blockedRes = await req("/api/drafts/check-gates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Re: amcheck",
        body: "Tested with Claude Opus 5.5 in /Users/nik/work/postgres.",
        isReply: true,
        isOtherAuthorThread: true,
        attachments: [{ filename: "0001-bad.patch" }],
      }),
    });
    const blockedJson = (await blockedRes.json()) as { gates: { hardBlocked: boolean; blockCount: number } };
    expect(blockedJson.gates.hardBlocked).toBe(true);
    expect(blockedJson.gates.blockCount).toBeGreaterThanOrEqual(3);

    const genRes = await req("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cfId: 5879,
        isReply: true,
        includeFootnoteAttachment: true,
        backend: "template",
      }),
    });
    const genJson = (await genRes.json()) as {
      subject: string;
      body: string;
      attachments: Array<{ filename: string }>;
      gates: { hardBlocked: boolean };
    };
    expect(genJson.subject).toContain("amcheck: support for GiST");
    expect(genJson.body.toLowerCase()).toContain("my ai harness");
    expect(genJson.attachments.length).toBe(1);
    expect(genJson.gates.hardBlocked).toBe(false);
  });

  test("Settings, encrypted cookie storage, guarded CF mutations, Work Items, and Bugs API", async () => {
    const setRes = await req("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hetznerSshHost: "root@hetzner-test" }),
    });
    const setJson = (await setRes.json()) as { settings: { hetznerSshHost: string } };
    expect(setJson.settings.hetznerSshHost).toBe("root@hetzner-test");

    // Store cookie and verify it never leaks in GET /api/settings
    const cookieRes = await req("/api/cf/auth/cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookieHeader: "sessionid=secret_abc_999; csrftoken=csrf_111" }),
    });
    expect(cookieRes.status).toBe(200);
    const getSettingsText = await (await req("/api/settings")).text();
    expect(getSettingsText).toContain('"hasSessionCookie":true');
    expect(getSettingsText).not.toContain("secret_abc_999");

    // Mutating CF endpoint MUST reject without confirm: true
    const unconfirmed = await req("/api/cf/5879/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "committer", confirm: false }),
    });
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.text()).toContain("confirm: true");

    // Create Work Item and test sanitized GitHub issue preview
    const wiRes = await req("/api/work-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cf_id: 5879,
        title: "amcheck: support for GiST",
        evidence_md: "My AI harness ran TAP suite on master.",
      }),
    });
    const wiJson = (await wiRes.json()) as { workItem: { id: number } };
    expect(wiRes.status).toBe(201);

    const previewRes = await req("/api/github/issues/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workItemId: wiJson.workItem.id }),
    });
    const previewJson = (await previewRes.json()) as { body: string; gate: { blocking: boolean } };
    expect(previewJson.gate.blocking).toBe(false);
    expect(previewJson.body).toContain("https://commitfest.postgresql.org/patch/5879/");

    // Manual bug triage endpoint
    const bugRes = await req("/api/bugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "BUG #19300: OOM crash in production after PG19 upgrade",
        body_text: "Our production cluster hit OOM after upgrading to PostgreSQL 19.0.",
      }),
    });
    expect(bugRes.status).toBe(201);
    const bugJson = (await bugRes.json()) as { bug: { classification: string; severity: string } };
    expect(bugJson.bug.classification).toBe("production_hit");
    expect(bugJson.bug.severity).toBe("crash");

    // Global Search API across CF entries, Work Items, and pgsql-bugs
    const searchRes = await req("/api/search?q=GiST");
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as {
      entries: Array<{ cf_id: number }>;
      workItems: Array<{ id: number }>;
    };
    expect(searchJson.entries.some((e) => e.cf_id === 5879)).toBe(true);
    expect(searchJson.workItems.some((w) => w.id === wiJson.workItem.id)).toBe(true);

    // Get single Work Item
    const wiGet = await req(`/api/work-items/${wiJson.workItem.id}`);
    expect(wiGet.status).toBe(200);

    // Record & read contributor-attributed model opinions
    const opPost = await req("/api/entries/5879/opinions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backend: "claude",
        verdict: "NEEDS-COMMITTER-EYES",
        confidence: "high",
        contributorName: "Kirk Wolak",
        contributorHandle: "kwolak",
        contributorProvider: "github",
      }),
    });
    expect(opPost.status).toBe(201);
    const opGet = await req("/api/entries/5879/opinions");
    const opGetJson = (await opGet.json()) as { opinions: Array<{ contributor_handle: string }> };
    expect(opGetJson.opinions.some((o) => o.contributor_handle === "kwolak")).toBe(true);
  });

  test("Mythos localhost security hardening blocks DNS rebinding, foreign/null Origin, and missing Bearer token", async () => {
    // Missing Bearer token -> 401
    const noTok = await appFetch(new Request("http://127.0.0.1:3432/api/health"));
    expect(noTok.status).toBe(401);
    expect(noTok.headers.get("access-control-allow-origin")).toBeNull();

    // DNS rebinding Host header -> 403
    const badHost = await appFetch(
      new Request("http://127.0.0.1:3432/api/health", {
        headers: { Host: "evil.example.com", Authorization: `Bearer ${authToken}` },
      }),
    );
    expect(badHost.status).toBe(403);

    // Foreign Origin (even pgroast.dev!) -> 403
    const foreignOrigin = await appFetch(
      new Request("http://127.0.0.1:3432/api/health", {
        headers: { Origin: "https://pgroast.dev", Authorization: `Bearer ${authToken}` },
      }),
    );
    expect(foreignOrigin.status).toBe(403);

    // Null Origin (downloaded file:// HTML brief) -> 403
    const nullOrigin = await appFetch(
      new Request("http://127.0.0.1:3432/api/health", {
        headers: { Origin: "null", Authorization: `Bearer ${authToken}` },
      }),
    );
    expect(nullOrigin.status).toBe(403);

    // HTML includes strict CSP, Cache-Control: no-store & X-Frame-Options: DENY
    const rootRes = await appFetch(new Request("http://127.0.0.1:3432/"));
    expect(rootRes.headers.get("x-frame-options")).toBe("DENY");
    expect(rootRes.headers.get("cache-control")).toBe("no-store");
    expect(rootRes.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(rootRes.headers.get("content-security-policy")).toContain("form-action 'self'");

    // Reject shell-injection targetBranch on build-test job
    const badBranch = await req("/api/jobs/build-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cfId: 5879, targetBranch: "master; rm -rf /" }),
    });
    expect(badBranch.status).toBe(400);
    expect(await badBranch.text()).toContain("Invalid targetBranch");
  });

  test("Experimental unified diff parser + inline comments compile cleanly to -hackers plain text", async () => {
    const sampleDiff = [
      "diff --git a/contrib/amcheck/verify_gist.c b/contrib/amcheck/verify_gist.c",
      "--- a/contrib/amcheck/verify_gist.c",
      "+++ b/contrib/amcheck/verify_gist.c",
      "@@ -10,2 +10,3 @@ gist_check_parent(Relation rel)",
      " \tLockBuffer(buf, BUFFER_LOCK_SHARE);",
      "+\t/* verify tuple keys */",
      " \tUnlockReleaseBuffer(buf);",
    ].join("\n");
    const parsed = parseUnifiedDiff(sampleDiff);
    expect(parsed.files.length).toBe(1);
    expect(parsed.totalAdditions).toBe(1);
    expect(parsed.files[0]?.newPath).toBe("contrib/amcheck/verify_gist.c");

    const addComment = await req("/api/entries/5879/diff/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: "contrib/amcheck/verify_gist.c",
        line_num: 11,
        line_type: "add",
        code_snippet: "/* verify tuple keys */",
        comment_text: "Does this need ShareLock on the relation to guard against concurrent VACUUM page deletion?",
      }),
    });
    expect(addComment.status).toBe(201);

    const compiledRes = await req("/api/entries/5879/diff/compile-email", { method: "POST" });
    expect(compiledRes.status).toBe(200);
    const compiled = (await compiledRes.json()) as { subject: string; body: string };
    expect(compiled.subject).toContain("amcheck: support for GiST");
    expect(compiled.body).toContain("contrib/amcheck/verify_gist.c around line 11");
    expect(compiled.body).toContain("> /* verify tuple keys */");
    expect(compiled.body).toContain("[1] https://commitfest.postgresql.org/patch/5879/");
  });
});
