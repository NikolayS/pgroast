import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WebDatabase } from "../src/db.ts";
import {
  classifySubsystem,
  IdentityResolver,
  parseCommitTrailers,
  parseContributorsHtml,
  parsePersonRef,
  syncHackersToDb,
} from "../src/hackers.ts";
import {
  parseMailingListsCatalog,
  parseMboxText,
  parseSincePageHtml,
  upsertMailingListMessages,
} from "../src/lists.ts";
import { matchThreadToDiff, parseMrUnifiedDiff, splitBodyIntoBlocks } from "../src/mr.ts";
import { createWebHandler } from "../src/server.ts";

let db: WebDatabase;
let appFetch: (req: Request) => Promise<Response>;
let pubToken = "";

function req(path: string, init?: RequestInit): Promise<Response> {
  return appFetch(new Request(`http://127.0.0.1:3433${path}`, init));
}

beforeAll(async () => {
  const schema = `test_web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db = await WebDatabase.create({
    databaseUrl: process.env.PGROAST_WEB_DATABASE_URL || "postgres://localhost:5432/pgroast_web",
    schema,
  });
  const app = await createWebHandler({ db, config: { allowDevTokenMint: true } });
  appFetch = app.fetch;
});

afterAll(async () => {
  await db.dropSchemaAndClose();
});

describe("pgroast-web public companion API & security gates", () => {
  test("mints publish-only token, blocks confidential leaks, and publishes/downloads Kirk's brief", async () => {
    const mintRes = await req("/api/v1/tokens/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "github", handle: "NikolayS", name: "Nikolay Samokhvalov" }),
    });
    expect(mintRes.status).toBe(201);
    const mintJson = (await mintRes.json()) as { token: string };
    expect(mintJson.token.startsWith("pgroast_pub_")).toBe(true);
    pubToken = mintJson.token;

    // Unauthenticated publish must fail 401
    const unauth = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cf_id: 5879, verdict: "NEEDS-COMMITTER-EYES" }),
    });
    expect(unauth.status).toBe(401);

    // Confidential payload (local path / internal model codename) MUST be hard-blocked 422
    const leak = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        cf_id: 5879,
        backend: "claude-fable",
        verdict: "NEEDS-COMMITTER-EYES",
        summary: "Tested in /Users/nik/work/postgres",
      }),
    });
    expect(leak.status).toBe(422);

    // Clean sanitized opinion succeeds
    const okOp = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        cf_id: 5879,
        entry: { cf_id: 5879, title: "amcheck: support for GiST", status: "Ready for Committer", authors: "Andrey Borodin" },
        backend: "ai-harness",
        verdict: "NEEDS-COMMITTER-EYES",
        confidence: "high",
        summary: "Verified lock behavior and concurrent vacuum handling.",
      }),
    });
    expect(okOp.status).toBe(201);

    // Publish interactive brief and verify sandboxed CSP + offline meta CSP download
    const briefRes = await req("/api/v1/publish/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        slug: "pg20-3-brief",
        title: "PG20-3 CommitFest Triage Brief",
        commitfestLabel: "PG20-3 (#62)",
        stats: {
          totals: { total: 1, open: 1, closed: 0, roasted: 1, unroasted: 0 },
          verdicts: [{ verdict: "NEEDS-COMMITTER-EYES", all: 1, open: 1 }],
        },
        shortlist: [{ cf_id: 5879, title: "amcheck: support for GiST", status: "Ready for Committer", authors: "Andrey Borodin", verdict: "NEEDS-COMMITTER-EYES", kind: "feature" }],
        closing: [],
        entries: [{ cf_id: 5879, title: "amcheck: support for GiST", status: "Ready for Committer", authors: "Andrey Borodin", verdict: "NEEDS-COMMITTER-EYES" }],
      }),
    });
    expect(briefRes.status).toBe(201);

    const dlHtml = await req("/briefs/pg20-3-brief/download.html");
    expect(dlHtml.status).toBe(200);
    expect(dlHtml.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    const htmlText = await dlHtml.text();
    expect(htmlText).toContain("default-src 'none'");
    expect(htmlText).toContain("PG20-3 CommitFest Triage Brief");
    expect(htmlText).toContain("amcheck: support for GiST");

    const dlMd = await req("/briefs/pg20-3-brief/download.md");
    expect(dlMd.status).toBe(200);
    expect(await dlMd.text()).toContain("CF 5879");

    // Patch collaboration endpoint returns entry, opinions, and single_opinion status for 1 run
    const patchRes = await req("/api/v1/entries/5879");
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as { consensus: { status: string; totalOpinions: number }; opinions: unknown[] };
    expect(patchJson.consensus.status).toBe("single_opinion");
    expect(patchJson.consensus.totalOpinions).toBe(1);
    expect(patchJson.opinions.length).toBe(1);

    // Patch HTML page renders dynamic title & OG tags + PWA icons
    const patchHtmlRes = await req("/patch/5879");
    expect(patchHtmlRes.status).toBe(200);
    const patchHtml = await patchHtmlRes.text();
    expect(patchHtml).toContain("CF 5879: amcheck: support for GiST");
    expect(patchHtml).toContain("og:title");
    expect(patchHtml).toContain("/apple-touch-icon.png");
    expect(patchHtml).toContain("/manifest.webmanifest");

    const touchRes = await req("/apple-touch-icon.png");
    expect(touchRes.status).toBe(200);
    expect(touchRes.headers.get("content-type")).toBe("image/png");
    const touchBytes = new Uint8Array(await touchRes.arrayBuffer());
    expect(touchBytes[0]).toBe(137);
    expect(touchBytes[1]).toBe(80);

    const manifestRes = await req("/manifest.webmanifest");
    expect(manifestRes.status).toBe(200);
    const manifestJson = (await manifestRes.json()) as { short_name: string };
    expect(manifestJson.short_name).toBe("pgroast");

    // SEO & GEO endpoints: robots.txt, sitemap.xml, llms.txt, llms-full.txt
    const robotsRes = await req("/robots.txt");
    expect(robotsRes.status).toBe(200);
    const robotsText = await robotsRes.text();
    expect(robotsText).toContain("Sitemap:");
    expect(robotsText).toContain("/llms.txt");

    const sitemapRes = await req("/sitemap.xml");
    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.headers.get("content-type")).toContain("application/xml");
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain("<urlset");
    expect(sitemapXml).toContain("/patch/5879");

    const llmsRes = await req("/llms.txt");
    expect(llmsRes.status).toBe(200);
    const llmsText = await llmsRes.text();
    expect(llmsText).toContain("# pgroast");
    expect(llmsText).toContain("Roast levels");
    expect(llmsText).toContain("/patch/5879");

    const llmsFullRes = await req("/llms-full.txt");
    expect(llmsFullRes.status).toBe(200);
    expect(await llmsFullRes.text()).toContain("Recent Community Roasts");

    expect(patchHtml).toContain('rel="canonical"');
    expect(patchHtml).toContain("application/ld+json");

    // Health reports package version and privacy-friendly page-view counter tracks hits
    const healthRes = await req("/api/v1/health");
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { version: string; views: { total: number } };
    expect(healthJson.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(healthJson.views.total).toBeGreaterThanOrEqual(1);

    const viewsRes = await req("/api/v1/views");
    expect(viewsRes.status).toBe(200);
    const viewsJson = (await viewsRes.json()) as { total: number; topPatches: Array<{ cf_id: number; hits: number }> };
    expect(viewsJson.total).toBeGreaterThanOrEqual(1);
    expect(viewsJson.topPatches.some((p) => p.cf_id === 5879)).toBe(true);

    // Roast level + archetype round-trip on published opinion
    const darkOp = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        cf_id: 5879,
        backend: "claude",
        roast_level: "dark",
        roast_flavour: "edge-case-hunter",
        verdict: "NEEDS-DESIGN-DISCUSSION",
        confidence: "high",
        summary: "Dark roast as The Edge-Case Hunter checking locking invariants.",
      }),
    });
    expect(darkOp.status).toBe(201);
    const darkJson = (await darkOp.json()) as { opinion: { roast_level: string; roast_flavour: string } };
    expect(darkJson.opinion.roast_level).toBe("dark");
    expect(darkJson.opinion.roast_flavour).toBe("edge-case-hunter");
  });

  test("GitHub & Google OAuth callbacks, admin invite tokens, size cap, and rate limiting", async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "gho_test_token" }), { status: 200 });
      }
      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify({ id: 4201, login: "kirk-pg", name: "Kirk Wolak", avatar_url: "https://avatars.githubusercontent.com/u/1" }), { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "ya29_test_token" }), { status: 200 });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return new Response(JSON.stringify({ sub: "123", email: "andrey@example.com", email_verified: true, name: "Andrey Borodin", picture: "" }), { status: 200 });
      }
      return new Response("not mocked", { status: 404 });
    }) as typeof fetch;

    const oauthApp = await createWebHandler({
      db,
      config: {
        publicOrigin: "https://pgroast.postgres.ai",
        githubClientId: "gh_id",
        githubClientSecret: "gh_sec",
        googleClientId: "g_id",
        googleClientSecret: "g_sec",
        adminSecret: "super-secret-admin",
        rateLimitPerMinute: 5,
        allowDevTokenMint: false,
      },
      oauthFetch: mockFetch,
    });

    // 1. GitHub OAuth flow
    const ghStart = await oauthApp.fetch(new Request("http://127.0.0.1:3433/auth/github"));
    expect(ghStart.status).toBe(302);
    const ghLoc = new URL(ghStart.headers.get("location")!);
    const ghState = ghLoc.searchParams.get("state")!;
    const ghCookie = ghStart.headers.get("set-cookie")!.split(";")[0]!;

    // Bad state must fail 400
    const badCb = await oauthApp.fetch(
      new Request(`http://127.0.0.1:3433/auth/github/callback?code=abc&state=wrong`, {
        headers: { Cookie: ghCookie },
      }),
    );
    expect(badCb.status).toBe(400);

    // Valid state succeeds and issues working token
    const ghStart2 = await oauthApp.fetch(new Request("http://127.0.0.1:3433/auth/github"));
    const ghState2 = new URL(ghStart2.headers.get("location")!).searchParams.get("state")!;
    const ghCookie2 = ghStart2.headers.get("set-cookie")!.split(";")[0]!;
    const ghCb = await oauthApp.fetch(
      new Request(`http://127.0.0.1:3433/auth/github/callback?code=valid_code&state=${ghState2}`, {
        headers: { Cookie: ghCookie2 },
      }),
    );
    expect(ghCb.status).toBe(200);
    const ghHtml = await ghCb.text();
    expect(ghHtml).toContain("@kirk-pg");
    const tokenMatch = ghHtml.match(/pgroast_pub_[A-Za-z0-9_-]+/);
    expect(tokenMatch).not.toBeNull();

    // 2. Google OAuth flow
    const gStart = await oauthApp.fetch(new Request("http://127.0.0.1:3433/auth/google"));
    expect(gStart.status).toBe(302);
    const gState = new URL(gStart.headers.get("location")!).searchParams.get("state")!;
    const gCookie = gStart.headers.get("set-cookie")!.split(";")[0]!;
    const gCb = await oauthApp.fetch(
      new Request(`http://127.0.0.1:3433/auth/google/callback?code=g_code&state=${gState}`, {
        headers: { Cookie: gCookie },
      }),
    );
    expect(gCb.status).toBe(200);
    const gHtml = await gCb.text();
    expect(gHtml).toContain("@andrey");
    expect(gHtml).toContain("pgroast_pub_");

    // 3. Admin invite token endpoint
    const badAdmin = await oauthApp.fetch(
      new Request("http://127.0.0.1:3433/api/v1/admin/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
        body: JSON.stringify({ handle: "andrey" }),
      }),
    );
    expect(badAdmin.status).toBe(401);

    const okAdmin = await oauthApp.fetch(
      new Request("http://127.0.0.1:3433/api/v1/admin/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer super-secret-admin" },
        body: JSON.stringify({ handle: "x4m", name: "Andrey Borodin" }),
      }),
    );
    expect(okAdmin.status).toBe(201);
    const adminToken = ((await okAdmin.json()) as { token: string }).token;
    expect(adminToken.startsWith("pgroast_pub_")).toBe(true);

    // 4. Payload size limit (>256 KB opinion) returns 413
    const hugeRes = await oauthApp.fetch(
      new Request("http://127.0.0.1:3433/api/v1/publish/opinion", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ cf_id: 5879, verdict: "NEEDS-COMMITTER-EYES", summary: "x".repeat(300_000) }),
      }),
    );
    expect(hugeRes.status).toBe(413);

    // 5. Rate limiter triggers 429 after 5 publishes/min
    let hit429 = false;
    for (let i = 0; i < 6; i++) {
      const r = await oauthApp.fetch(
        new Request("http://127.0.0.1:3433/api/v1/publish/opinion", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ cf_id: 5879, verdict: "NEEDS-COMMITTER-EYES", summary: `run ${i}` }),
        }),
      );
      if (r.status === 429) {
        hit429 = true;
        expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  test("MR helpers split quoted -hackers blocks and parse unified diffs cleanly", () => {
    const blocks = splitBodyIntoBlocks("Hi,\n\n> On Tue, Alice wrote:\n> > old quote\n\nLooks good to me!\n");
    expect(blocks.length).toBe(3);
    expect(blocks[0]?.kind).toBe("text");
    expect(blocks[1]?.kind).toBe("quote");
    expect(blocks[1]?.lineCount).toBe(2);
    expect(blocks[2]?.kind).toBe("text");
    expect(blocks[2]?.content).toContain("Looks good to me!");

    const diff = parseMrUnifiedDiff(
      "diff --git a/src/foo.c b/src/foo.c\n--- a/src/foo.c\n+++ b/src/foo.c\n@@ -10,2 +10,3 @@\n ctx\n-old\n+new1\n+new2\n",
    );
    expect(diff.files.length).toBe(1);
    expect(diff.totalAdditions).toBe(2);
    expect(diff.totalDeletions).toBe(1);
    expect(diff.files[0]?.hunks[0]?.lines.length).toBe(4);

    // Inline line + file mention matching from -hackers thread onto diff
    const richDiff = parseMrUnifiedDiff(
      "diff --git a/src/backend/replication/walsender.c b/src/backend/replication/walsender.c\n" +
        "--- a/src/backend/replication/walsender.c\n" +
        "+++ b/src/backend/replication/walsender.c\n" +
        "@@ -100,2 +100,3 @@\n" +
        " ctx\n" +
        "+if (MyReplicationSlot != NULL && slot_is_logical)\n" +
        "+    pgstat_report_stat_xact_commit(false);\n",
    );
    const matched = matchThreadToDiff(
      { cfId: 6992, source: "cf/6992", compareUrl: "https://example.com", ...richDiff, cachedAt: "2026-11-26T00:00:00Z" },
      {
        cfId: 6992,
        threadUrl: "https://example.com/t",
        subject: "Fix walsender stats",
        lists: ["pgsql-hackers"],
        messageCount: 2,
        participants: [],
        revisions: [],
        tldr: { pitch: "", latestSummary: "", latestBy: "", latestDate: "", startedDate: "", daysIdle: 0 },
        cachedAt: "2026-11-26T00:00:00Z",
        messages: [
          {
            index: 0,
            messageId: "m1",
            url: "https://example.com/m1",
            from: "Reviewer One",
            date: "2026-11-25T10:00:00Z",
            subject: "Re: Fix",
            isAuthor: false,
            patchRevision: null,
            patchCount: 0,
            attachments: [],
            blocks: [
              { kind: "quote", content: "> +if (MyReplicationSlot != NULL && slot_is_logical)", lineCount: 1 },
              { kind: "text", content: "Should we also guard against physical slots here?", lineCount: 1 },
            ],
          },
          {
            index: 1,
            messageId: "m2",
            url: "https://example.com/m2",
            from: "Reviewer Two",
            date: "2026-11-26T10:00:00Z",
            subject: "Re: Fix",
            isAuthor: false,
            patchRevision: null,
            patchCount: 0,
            attachments: [],
            blocks: [
              { kind: "text", content: "I checked walsender.c and the TAP test passes locally.", lineCount: 1 },
            ],
          },
        ],
      },
    );
    expect(matched.matchedLineComments).toBe(1);
    expect(matched.matchedFileMentions).toBe(1);
    expect(matched.files[0]?.hunks[0]?.lines[1]?.comments?.[0]?.excerpt).toContain("physical slots");
    expect(matched.files[0]?.mentions?.[0]?.from).toBe("Reviewer Two");
  });

  test("P0 security regressions: dev auth default-off, brief XSS & authorization, opinion non-wipe, Google sub isolation, Host allowlist, token leak", async () => {
    // 1. Dev token minting defaults OFF even on 127.0.0.1 unless PGROAST_WEB_DEV_AUTH=1 on loopback origin
    const savedDev = process.env.PGROAST_WEB_DEV_AUTH;
    const savedOrigin = process.env.PGROAST_WEB_ORIGIN;
    delete process.env.PGROAST_WEB_DEV_AUTH;
    process.env.PGROAST_WEB_ORIGIN = "https://pgroast.postgres.ai";
    const { loadWebConfig } = await import("../src/config.ts");
    expect(loadWebConfig().allowDevTokenMint).toBe(false);
    process.env.PGROAST_WEB_DEV_AUTH = "1";
    expect(loadWebConfig().allowDevTokenMint).toBe(false); // non-loopback publicOrigin blocks dev auth!
    process.env.PGROAST_WEB_ORIGIN = "http://127.0.0.1:3433";
    expect(loadWebConfig().allowDevTokenMint).toBe(true);
    if (savedDev === undefined) delete process.env.PGROAST_WEB_DEV_AUTH;
    else process.env.PGROAST_WEB_DEV_AUTH = savedDev;
    if (savedOrigin === undefined) delete process.env.PGROAST_WEB_ORIGIN;
    else process.env.PGROAST_WEB_ORIGIN = savedOrigin;

    // 2. Non-owner / non-maintainer CANNOT overwrite existing brief OR hijack latest brief (403)
    const attackerMint = await req("/api/v1/tokens/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "github", handle: "random-attacker", name: "Attacker" }),
    });
    expect(attackerMint.status).toBe(201);
    const attackerToken = ((await attackerMint.json()) as { token: string }).token;

    const hijackSameSlug = await req("/api/v1/publish/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${attackerToken}` },
      body: JSON.stringify({ slug: "pg20-3-brief", title: "Hijacked Brief" }),
    });
    expect(hijackSameSlug.status).toBe(403);

    const hijackNewSlug = await req("/api/v1/publish/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${attackerToken}` },
      body: JSON.stringify({ slug: "attacker-latest", title: "Hijacked Latest" }),
    });
    expect(hijackNewSlug.status).toBe(403);

    // Cross-provider impersonation check: google:NikolayS CANNOT overwrite brief owned by github:NikolayS (403)
    const googleSameHandleMint = await req("/api/v1/tokens/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", handle: "NikolayS", name: "Spoofed Google User" }),
    });
    expect(googleSameHandleMint.status).toBe(201);
    const googleSameHandleToken = ((await googleSameHandleMint.json()) as { token: string }).token;
    const crossProviderHijack = await req("/api/v1/publish/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${googleSameHandleToken}` },
      body: JSON.stringify({ slug: "pg20-3-brief", title: "Cross-Provider Hijack" }),
    });
    expect(crossProviderHijack.status).toBe(403);

    // 3. Stored XSS & javascript: URL defense in briefs (hash-based CSP, no unsafe-inline script, coerced ints)
    const xssBriefRes = await req("/api/v1/publish/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        slug: "xss-check-brief",
        title: "XSS Defense Brief",
        commitfestLabel: "PG20-3",
        stats: {
          totals: { total: "<script>alert(1)</script>", open: 1, closed: 0 },
          verdicts: [{ verdict: "NEEDS-COMMITTER-EYES", all: "<img src=x onerror=alert(1)>", open: 1 }],
        },
        shortlist: [
          {
            cf_id: 7777,
            title: "Safe $$' title test",
            status: "Needs review",
            authors: "Author",
            verdict: "NEEDS-COMMITTER-EYES",
            kind: "bugfix",
            seen_in_production: true,
            workaround: "Use EXPLAIN",
            thread_url: "javascript:alert(document.domain)",
          },
        ],
        closing: [],
        entries: [
          {
            cf_id: 7777,
            title: "Safe $$' title test",
            status: "Needs review",
            authors: "Author",
            verdict: "NEEDS-COMMITTER-EYES",
            kind: "bugfix",
            seen_in_production: true,
            workaround: "Use EXPLAIN",
            thread_url: "javascript:alert(1)",
          },
        ],
      }),
    });
    expect(xssBriefRes.status).toBe(201);
    const xssHtmlRes = await req("/briefs/xss-check-brief/embed");
    expect(xssHtmlRes.status).toBe(200);
    const xssCsp = xssHtmlRes.headers.get("content-security-policy") || "";
    expect(xssCsp).toContain("script-src 'sha256-");
    expect(xssCsp).not.toContain("script-src 'unsafe-inline'");
    const xssHtml = await xssHtmlRes.text();
    expect(xssHtml).not.toContain("javascript:alert");
    expect(xssHtml).not.toContain("<script>alert(1)</script>");
    expect(xssHtml).not.toContain("onerror=alert");

    // 4. Opinion publish MUST NOT wipe canonical public_entries fields (kind, seen_in_production, workaround)
    const opOn7777 = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${attackerToken}` },
      body: JSON.stringify({
        cf_id: 7777,
        entry: { cf_id: 7777, title: "Overwritten?", status: "Closed" },
        backend: "claude",
        verdict: "LIKELY-REJECT",
        summary: "Checking non-wipe invariant.",
      }),
    });
    expect(opOn7777.status).toBe(201);
    const entry7777 = await db.getEntry(7777);
    expect(entry7777?.kind).toBe("bugfix");
    expect(entry7777?.seen_in_production).toBe(true);
    expect(entry7777?.workaround).toBe("Use EXPLAIN");
    expect(entry7777?.title).toBe("Safe $$' title test");

    // 5. Title containing $$ / $' renders cleanly in SSR HTML without replacement corruption
    const ssr7777 = await (await req("/patch/7777")).text();
    expect(ssr7777).toContain("CF 7777: Safe $$' title test");

    // 6. X-Forwarded-Host cache-poisoning rejection + Vary: Host
    const poisonedRobots = await req("/robots.txt", {
      headers: { "X-Forwarded-Host": "evil.attacker.tld" },
    });
    expect(poisonedRobots.headers.get("vary")).toContain("Host");
    const poisonedText = await poisonedRobots.text();
    expect(poisonedText).not.toContain("evil.attacker.tld");

    // 7. Base64url pgroast_pub_ token leak with _ or - is blocked 422
    const leakPubTok = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        cf_id: 7777,
        verdict: "NEEDS-COMMITTER-EYES",
        summary: "Oops leaked pgroast_pub_abcDEF_123-45678901234567890",
      }),
    });
    expect(leakPubTok.status).toBe(422);

    // 8. Google OAuth sub separation: two accounts with same email local-part NEVER collide, and unverified email is rejected
    const googleCollisionFetch = (async (input: string | URL | Request) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (u === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      if (u === "https://openidconnect.googleapis.com/v1/userinfo") {
        const auth = input instanceof Request ? input.headers.get("authorization") : "";
        void auth;
        return new Response(
          JSON.stringify({ sub: "google-sub-different-999", email: "andrey@other-domain.org", email_verified: true, name: "Other Andrey" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const gApp = await createWebHandler({
      db,
      config: { publicOrigin: "https://pgroast.postgres.ai", googleClientId: "gid", googleClientSecret: "gsec" },
      oauthFetch: googleCollisionFetch,
    });
    const gs = await gApp.fetch(new Request("http://127.0.0.1:3433/auth/google"));
    const st = new URL(gs.headers.get("location")!).searchParams.get("state")!;
    const ck = gs.headers.get("set-cookie")!.split(";")[0]!;
    const gcb = await gApp.fetch(
      new Request(`http://127.0.0.1:3433/auth/google/callback?code=c&state=${st}`, { headers: { Cookie: ck } }),
    );
    expect(gcb.status).toBe(200);
    const gcbHtml = await gcb.text();
    expect(gcbHtml).toContain("@andrey-"); // distinct suffixed handle, NOT colliding with @andrey (sub=123)!

    // 9. Overflowing cf_id returns 400 (not 500 PG int4 overflow)
    const bigCf = await req("/api/v1/entries/99999999999999");
    expect(bigCf.status).toBe(400);

    // 10. SPA navigation header X-PgRoast-View: 1 increments page_views
    const beforeViews = ((await (await req("/api/v1/views")).json()) as { total: number }).total;
    await req("/api/v1/entries/7777", { headers: { "X-PgRoast-View": "1", "User-Agent": "Mozilla/5.0" } });
    // Give fire-and-forget insert a moment to flush
    await new Promise((r) => setTimeout(r, 80));
    const afterViews = ((await (await req("/api/v1/views")).json()) as { total: number }).total;
    expect(afterViews).toBeGreaterThan(beforeViews);
  });

  test("Hacking Observatory: multi-email identity resolution, git sync, APIs, SSR /hacker/:slug, and zero raw email exposure", async () => {
    // 1. Unit tests for IdentityResolver, trailers, subsystems, contributors HTML
    const resolver = new IdentityResolver();
    const r1 = parsePersonRef("David Rowley <drowley@postgresql.org>")!;
    const r2 = parsePersonRef("David Rowley <dgrowleyml@gmail.com>")!;
    const r3 = parsePersonRef("Hayato Kuroda (Fujitsu) <kuroda.hayato@fujitsu.com>")!;
    const r4 = parsePersonRef("Álvaro Herrera <alvherre@alvh.no-ip.org>")!;
    const r5 = parsePersonRef("Alvaro Herrera <alvherre@postgresql.org>")!;
    // Identity Resolution v2: obfuscated emails, transliteration variants, and reverse-initial handles
    const r6 = parsePersonRef("Andrey Borodin")!;
    const r7 = parsePersonRef("Andrew Borodin")!;
    const r8 = parsePersonRef("Andrey Borodin (x4mmm at yandex-team.ru)")!;
    const r9 = parsePersonRef("Kirk Wolak")!;
    const r10 = parsePersonRef("wolakk")!;
    const r11 = parsePersonRef("Nikolay Samokhvalov <nik@postgres.ai>")!;
    const r12 = parsePersonRef("Nik Samokhvalov")!;
    resolver.observe(r1, "git_committer");
    resolver.observe(r2, "git_author");
    resolver.observe(r3, "trailer");
    resolver.observe(r4, "git_author");
    resolver.observe(r5, "git_committer");
    resolver.observe(r6, "trailer");
    resolver.observe(r7, "trailer");
    resolver.observe(r8, "trailer");
    resolver.observe(r9, "trailer");
    resolver.observe(r10, "trailer");
    resolver.observe(r11, "contributors_page", true);
    resolver.observe(r12, "trailer");
    const mat = resolver.materialize();
    expect(mat.people.length).toBe(6);
    const samMatches = mat.people.filter((p) => p.canonicalName.toLowerCase().includes("samokhvalov"));
    expect(samMatches.length).toBe(1);
    expect(samMatches[0]?.slug).toBe("nikolay-samokhvalov");
    const david = mat.people.find((p) => p.slug === "david-rowley");
    expect(david?.emailCount).toBe(2);
    expect(david?.emailDomains).toContain("postgresql.org");
    expect(david?.emailDomains).toContain("gmail.com");
    const hayato = mat.people.find((p) => p.slug === "hayato-kuroda");
    expect(hayato?.affiliations).toContain("Fujitsu");
    const alvaro = mat.people.find((p) => p.slug === "alvaro-herrera");
    expect(alvaro?.emailCount).toBe(2);
    const borodinMatches = mat.people.filter((p) => p.canonicalName.toLowerCase().includes("borodin"));
    expect(borodinMatches.length).toBe(1);
    expect(borodinMatches[0]?.emailCount).toBeGreaterThanOrEqual(1);
    expect(borodinMatches[0]?.emailDomains).toContain("yandex-team.ru");
    const wolakMatches = mat.people.filter((p) => p.canonicalName.toLowerCase().includes("wolak") || p.slug.includes("wolak"));
    expect(wolakMatches.length).toBe(1);
    expect(wolakMatches[0]?.slug).toBe("kirk-wolak");

    const trailers = parseCommitTrailers(
      "Fix planner costing edge case.\n\nAuthor: Hayato Kuroda (Fujitsu) <kuroda.hayato@fujitsu.com>\nReviewed-by: David Rowley <dgrowleyml@gmail.com>, Álvaro Herrera <alvherre@alvh.no-ip.org>\nReported-by: Jane Tester <jane@example.org>\nDiscussion: https://postgr.es/m/test-123\nBackpatch-through: 17\n",
    );
    expect(trailers.isBackpatch).toBe(true);
    expect(trailers.discussionUrls).toEqual(["https://postgr.es/m/test-123"]);
    expect(trailers.trailers.filter((t) => t.kind === "reviewer").length).toBe(2);
    expect(trailers.trailers.find((t) => t.kind === "reporter")?.person.name).toBe("Jane Tester");

    expect(classifySubsystem("src/backend/optimizer/path/costsize.c")).toBe("Optimizer / Planner");
    expect(classifySubsystem("src/backend/storage/smgr/md.c")).toBe("Storage & WAL");
    expect(classifySubsystem("src/backend/replication/walsender.c")).toBe("Replication");

    const seeds = parseContributorsHtml(
      `<h2>Core Team</h2><table><thead><tr><th scope="col">Contributor</th><th scope="col">Contribution</th></tr></thead><tbody><tr><td><a href="/community/people/petere/">Peter Eisentraut</a> (peter.eisentraut at enterprisedb.com)<br/><a href="https://enterprisedb.com/">EDB</a><br/>Dresden, Germany</td><td>Build system and docs</td></tr></tbody></table>` +
        `<h2>Major Contributors</h2><table><tr><td>David Rowley</td><td>Microsoft</td><td>Planner</td></tr></table>` +
        `<h2>Significant Contributors</h2><table><tr><td><a href="/community/people/rybalkina/">Elena Rybalkina</a> (rybalkina at example.org)</td><td><a href="/community/people/nikolay/">Nikolay Samokhvalov</a> (nik at postgres.ai)</td></tr></table>` +
        `<h2>Past Contributors</h2><table><tr><td>Someone Old</td><td>Another Old</td></tr></table>`,
    );
    expect(seeds.length).toBe(4);
    expect(seeds[0]?.name).toBe("Peter Eisentraut");
    expect(seeds[0]?.role).toBe("Core Team");
    expect(seeds[0]?.company).toBe("EDB");
    expect(seeds[0]?.email).toBe("peter.eisentraut@enterprisedb.com");
    expect(seeds[1]?.role).toBe("Major Contributor");
    const rybalkina = seeds.find((s) => s.name === "Elena Rybalkina");
    expect(rybalkina?.role).toBe("Significant Contributor");
    expect(rybalkina?.company).toBe(""); // NEVER polluted by neighbor cell Nikolay Samokhvalov!
    const nikolay = seeds.find((s) => s.name === "Nikolay Samokhvalov");
    expect(nikolay?.role).toBe("Significant Contributor");
    expect(nikolay?.email).toBe("nik@postgres.ai");

    // 2. Real mini git repo sync + API + SSR + privacy check
    const tmpRepo = mkdtempSync(join(tmpdir(), "pgroast-git-test-"));
    try {
      const git = (args: string[], envExtra?: Record<string, string>) =>
        execFileSync("git", args, {
          cwd: tmpRepo,
          env: { ...process.env, ...envExtra },
          stdio: "pipe",
        });

      git(["init", "-b", "master"]);
      git(["config", "user.name", "David Rowley"]);
      git(["config", "user.email", "drowley@postgresql.org"]);

      mkdirSync(join(tmpRepo, "src/backend/optimizer/path"), { recursive: true });
      writeFileSync(join(tmpRepo, "src/backend/optimizer/path/costsize.c"), "/* v1 */\nint cost_seqscan(void) { return 1; }\n");
      git(["add", "."]);
      git(
        [
          "commit",
          "-m",
          "Optimize seqscan path costing\n\nAuthor: David Rowley <dgrowleyml@gmail.com>\nReviewed-by: Hayato Kuroda (Fujitsu) <kuroda.hayato@fujitsu.com>\nReported-by: Jane Tester <jane.secret@example.org>\nDiscussion: https://postgr.es/m/seqscan-1\n",
        ],
        {
          GIT_AUTHOR_NAME: "David Rowley",
          GIT_AUTHOR_EMAIL: "dgrowleyml@gmail.com",
          GIT_AUTHOR_DATE: "2026-10-15T14:00:00Z",
          GIT_COMMITTER_NAME: "David Rowley",
          GIT_COMMITTER_EMAIL: "drowley@postgresql.org",
          GIT_COMMITTER_DATE: "2026-10-15T14:00:00Z",
        },
      );

      mkdirSync(join(tmpRepo, "src/backend/replication"), { recursive: true });
      writeFileSync(join(tmpRepo, "src/backend/replication/walsender.c"), "/* v1 */\nvoid WalSndLoop(void) {}\n");
      git(["add", "."]);
      git(
        [
          "commit",
          "-m",
          "Fix logical walsender shutdown race\n\nAuthor: Hayato Kuroda (Fujitsu) <kuroda.hayato@fujitsu.com>\nReviewed-by: David Rowley <drowley@postgresql.org>\nBackpatch-through: 17\n",
        ],
        {
          GIT_AUTHOR_NAME: "Hayato Kuroda",
          GIT_AUTHOR_EMAIL: "kuroda.hayato@fujitsu.com",
          GIT_AUTHOR_DATE: "2026-11-10T09:30:00Z",
          GIT_COMMITTER_NAME: "David Rowley",
          GIT_COMMITTER_EMAIL: "drowley@postgresql.org",
          GIT_COMMITTER_DATE: "2026-11-10T09:30:00Z",
        },
      );

      const syncStats = await syncHackersToDb(db, {
        repoPath: tmpRepo,
        ref: "HEAD",
        fetchContributors: false,
        log: () => {},
      });
      expect(syncStats.commitsCount).toBe(2);
      expect(syncStats.multiEmailPeople).toBeGreaterThanOrEqual(1);

      // Overview API
      const ovRes = await req("/api/v1/hackers/overview?window=all");
      expect(ovRes.status).toBe(200);
      const ovText = await ovRes.text();
      expect(ovText).not.toContain("dgrowleyml@gmail.com");
      expect(ovText).not.toContain("kuroda.hayato@fujitsu.com");
      expect(ovText).not.toContain("jane.secret@example.org");
      const ov = JSON.parse(ovText) as {
        synced: boolean;
        totals: { commits: number; committedForOthers: number; reviewsGiven: number; bugsReported: number; backpatches: number };
        syncMeta: { multiEmailPeople: number };
        releaseCycles: Array<{ major: string; totalCommits: number }>;
        concentrationByYear: Array<{ year: string; total: number; busFactor50: number }>;
        subsystems: Array<{ name: string; busFactor: number; effectiveCommitters: number }>;
      };
      expect(ov.synced).toBe(true);
      expect(ov.totals.commits).toBe(2);
      expect(ov.totals.committedForOthers).toBe(1);
      expect(ov.totals.reviewsGiven).toBe(2);
      expect(ov.totals.bugsReported).toBe(1);
      expect(ov.totals.backpatches).toBe(1);
      expect(ov.syncMeta.multiEmailPeople).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(ov.releaseCycles)).toBe(true);
      expect(Array.isArray(ov.concentrationByYear)).toBe(true);
      expect(ov.concentrationByYear.length).toBeGreaterThanOrEqual(1);
      expect(ov.subsystems[0]?.busFactor).toBeGreaterThanOrEqual(1);
      expect(ov.subsystems[0]?.effectiveCommitters).toBeGreaterThan(0);

      // Directory search by affiliation ("fujitsu")
      const dirRes = await req("/api/v1/hackers?search=fujitsu");
      expect(dirRes.status).toBe(200);
      const dirText = await dirRes.text();
      expect(dirText).not.toContain("kuroda.hayato@fujitsu.com");
      const dirJson = JSON.parse(dirText) as { hackers: Array<{ slug: string; affiliations: string[] }> };
      expect(dirJson.hackers.some((h) => h.slug === "hayato-kuroda")).toBe(true);

      // Resolve by name
      const resolveRes = await req("/api/v1/hackers/resolve?name=David%20Rowley");
      expect(resolveRes.status).toBe(200);
      expect(((await resolveRes.json()) as { slug: string | null }).slug).toBe("david-rowley");

      // Individual profile API + privacy check
      const profRes = await req("/api/v1/hackers/david-rowley");
      expect(profRes.status).toBe(200);
      const profText = await profRes.text();
      expect(profText).not.toContain("dgrowleyml@gmail.com");
      expect(profText).not.toContain("drowley@postgresql.org");
      const prof = JSON.parse(profText) as {
        person: { slug: string; emailCount: number; emailDomains: string[]; commitsCommitted: number; commitsCommittedForOthers: number; reviewsGiven: number };
        collaborators: { helpedAuthors: Array<{ slug: string }> };
      };
      expect(prof.person.slug).toBe("david-rowley");
      expect(prof.person.emailCount).toBe(2);
      expect(prof.person.emailDomains).toContain("gmail.com");
      expect(prof.person.emailDomains).toContain("postgresql.org");
      expect(prof.person.commitsCommitted).toBe(2);
      expect(prof.person.commitsCommittedForOthers).toBe(1);
      expect(prof.person.reviewsGiven).toBe(1);
      expect(prof.collaborators.helpedAuthors.some((c) => c.slug === "hayato-kuroda")).toBe(true);

      // SSR /hacker/:slug page metadata + JSON-LD + zero raw emails
      const ssrHacker = await (await req("/hacker/david-rowley")).text();
      expect(ssrHacker).toContain("David Rowley (Contributor) — PostgreSQL Hacking Profile · pgroast");
      expect(ssrHacker).toContain('"@type":"Person"');
      expect(ssrHacker).not.toContain("dgrowleyml@gmail.com");
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  test("Weekly Quota Auto-Contribute queue, soft-lease deduplication, auto-by-subsystem archetype routing, and /docs SSR", async () => {
    // Seed 2 unroasted open patches across distinct subsystems
    await db.upsertPublicEntry({
      cf_id: 9101,
      title: "Reduce WAL full-page writes during checkpoint",
      status: "Ready for Committer",
      topic: "Storage & WAL",
      authors: "Alice Dev",
      verdict: "UNROASTED",
    });
    await db.upsertPublicEntry({
      cf_id: 9102,
      title: "Add B-tree index deduplication metrics",
      status: "Needs review",
      topic: "Indexing",
      authors: "Bob Dev",
      verdict: "UNROASTED",
    });

    // 1. Dry-run preview does NOT acquire a lease
    const dryRes = await req("/api/v1/contribute/next?backend=claude&strategy=unroasted-first&flavour=auto-by-subsystem&dry_run=1");
    expect(dryRes.status).toBe(200);
    const dryJson = (await dryRes.json()) as {
      patch: { cf_id: number } | null;
      suggestedFlavour: string;
      leaseExpiresAt: string | null;
      coverage: { activeLeases: unknown[]; totalOpen: number };
    };
    expect(dryJson.patch?.cf_id).toBe(9101);
    expect(dryJson.suggestedFlavour).toBe("storage-skeptic");
    expect(dryJson.leaseExpiresAt).toBeNull();
    expect(dryJson.coverage.activeLeases.length).toBe(0);

    // 2. Real claim acquires a 45m soft lease for claude on 9101
    const claim1 = await (await req("/api/v1/contribute/next?backend=claude&strategy=unroasted-first&flavour=auto-by-subsystem")).json() as {
      patch: { cf_id: number } | null;
      suggestedFlavour: string;
      leaseExpiresAt: string | null;
      coverage: { activeLeases: Array<{ cf_id: number; backend: string }> };
    };
    expect(claim1.patch?.cf_id).toBe(9101);
    expect(claim1.suggestedFlavour).toBe("storage-skeptic");
    expect(claim1.leaseExpiresAt).not.toBeNull();
    expect(claim1.coverage.activeLeases.some((l) => l.cf_id === 9101 && l.backend === "claude")).toBe(true);

    // 3. Second claude worker skips soft-leased 9101 and gets 9102 with index-specialist!
    const claim2 = await (await req("/api/v1/contribute/next?backend=claude&strategy=unroasted-first&flavour=auto-by-subsystem")).json() as {
      patch: { cf_id: number } | null;
      suggestedFlavour: string;
    };
    expect(claim2.patch?.cf_id).toBe(9102);
    expect(claim2.suggestedFlavour).toBe("index-specialist");

    // 4. Coverage status endpoint reports live progress & active leases
    const statusRes = await req("/api/v1/contribute/status");
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as { totalOpen: number; activeLeases: unknown[] };
    expect(statusJson.totalOpen).toBeGreaterThanOrEqual(2);
    expect(statusJson.activeLeases.length).toBeGreaterThanOrEqual(2);

    // 5. SSR /docs, /contribute, and /about routes render separate titles and OG metadata
    const docsHtml = await (await req("/docs")).text();
    expect(docsHtml).toContain("Docs &amp; Complete Feature Catalog — pgroast");
    const contributeHtml = await (await req("/contribute")).text();
    expect(contributeHtml).toContain("Weekly Quota Auto-Contribute &amp; Live CommitFest Coverage — pgroast");
    const aboutHtml = await (await req("/about")).text();
    expect(aboutHtml).toContain("About pgroast — What Roasting Postgres Patches Means");
    const roastsHtml = await (await req("/roasts")).text();
    expect(roastsHtml).toContain("Community Roasts — pgroast");
  });

  test("Mailing Lists Archive: catalog/since/mbox parsers, unified hacker linking, APIs, and /lists SSR", async () => {
    const lists = parseMailingListsCatalog(
      `<a href="/list/pgsql-hackers/">hackers</a><a href="/list/pgsql-bugs/">bugs</a><a href="/list/pgsql-general/">general</a>`,
    );
    expect(lists).toEqual(["pgsql-bugs", "pgsql-general", "pgsql-hackers"]);

    const sinceParsed = parseSincePageHtml(
      `<h1>pgsql-hackers 2026-11-26</h1><tbody><tr><th scope="row"><a href="/message-id/abc123%40example.org">Re: [PATCH] Optimize seqscan &#x1f4ce;</a></th><td>David Rowley</td><td>14:22</td></tr></tbody><a href="/list/pgsql-hackers/since/202611270000">Next</a>`,
      "pgsql-hackers",
      "2026-11-26",
    );
    expect(sinceParsed.messages.length).toBe(1);
    expect(sinceParsed.messages[0]?.messageId).toBe("abc123@example.org");
    expect(sinceParsed.messages[0]?.hasAttachment).toBe(true);
    expect(sinceParsed.messages[0]?.sentAt).toBe("2026-11-26T14:22:00Z");
    expect(sinceParsed.nextPath).toBe("/list/pgsql-hackers/since/202611270000");

    const mboxParsed = parseMboxText(
      `From dgrowleyml@gmail.com Thu Nov 26 15:00:00 2026\nMessage-ID: <mbox-999@gmail.com>\nDate: Thu, 26 Nov 2026 15:00:00 +0000\nFrom: David Rowley <dgrowleyml@gmail.com>\nSubject: Re: Optimize seqscan\n\n> quoted line ignored\nAttached is v2 with benchmark numbers.\n`,
      "pgsql-hackers",
    );
    expect(mboxParsed.length).toBe(1);
    expect(mboxParsed[0]?.messageId).toBe("mbox-999@gmail.com");
    expect(mboxParsed[0]?.bodyExcerpt).toContain("Attached is v2");
    expect(mboxParsed[0]?.bodyExcerpt).not.toContain("quoted line ignored");

    const up = await upsertMailingListMessages(db, "pgsql-hackers", [...sinceParsed.messages, ...mboxParsed]);
    expect(up.inserted).toBe(2);
    expect(up.linkedPeople).toBe(2); // both linked to David Rowley from earlier test!

    // Overview API
    const ov = (await (await req("/api/v1/lists/overview")).json()) as {
      totals: { totalMessages: number; linkedMessages: number };
      lists: Array<{ name: string; messageCount: number }>;
    };
    expect(ov.totals.totalMessages).toBeGreaterThanOrEqual(2);
    expect(ov.totals.linkedMessages).toBeGreaterThanOrEqual(2);
    expect(ov.lists.some((l) => l.name === "pgsql-hackers" && l.messageCount >= 2)).toBe(true);

    // Search API (with attachment filter)
    const msgRes = (await (await req("/api/v1/lists/messages?list=pgsql-hackers&attachments=1")).json()) as {
      messages: Array<{ messageId: string; personSlug: string }>;
    };
    expect(msgRes.messages.some((m) => m.messageId === "abc123@example.org" && m.personSlug === "david-rowley")).toBe(true);

    // Hacker profile now includes linked mailing list activity!
    const prof = (await (await req("/api/v1/hackers/david-rowley")).json()) as {
      mailingLists: { totalMessages: number; byList: Array<{ list: string; count: number }> };
    };
    expect(prof.mailingLists.totalMessages).toBeGreaterThanOrEqual(2);
    expect(prof.mailingLists.byList[0]?.list).toBe("pgsql-hackers");

    // SSR /lists route
    const listsHtml = await (await req("/lists")).text();
    expect(listsHtml).toContain("PostgreSQL Mailing Lists Archive (Continuous Sync) — pgroast");
  });

  test("CommitFest Stats Observatory API (/api/v1/stats/overview) computes live verification funnel, queue units & unified authors", async () => {
    const res = await req("/api/v1/stats/overview");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      totals: {
        total: number;
        open: number;
        closed: number;
        roastedOpen: number;
        totalOpinions: number;
        closedBreakdown: { committed: number; moved: number; withdrawn: number; rejected: number; returned: number };
      };
      queueUnits: Array<{ cf_id: number; col: string; verdict: string }>;
      statusVsEvidence: { committerWarnings: unknown[]; cleanPickups: unknown[] };
      darkMatrix: Array<{ cf_id: number; breakRank: number }>;
      loadVsCapacity: Array<{ subsystem: string; openTotal: number; committers12m: number }>;
      authorBeeswarm: { dots: unknown[]; matchedCount: number; firstTimerCount: number };
      productionHits: unknown[];
      calibration: { rows: unknown[]; totalClosedWithVerdict: number; totalClosedWithoutVerdict: number };
      statusMatrix: unknown[];
      subsystems: unknown[];
      kindComparison: unknown[];
      verification: { byModel: unknown[]; radar: Record<string, unknown[]> };
      contributors: { authors: unknown[]; roasters: unknown[] };
      traffic: { total: number; timeline: unknown[] };
    };
    expect(data.totals.total).toBeGreaterThanOrEqual(1);
    expect(data.totals.open + data.totals.closed).toBe(data.totals.total);
    expect(data.queueUnits.length).toBe(data.totals.total);
    expect(Array.isArray(data.statusVsEvidence.committerWarnings)).toBe(true);
    expect(Array.isArray(data.statusVsEvidence.cleanPickups)).toBe(true);
    expect(Array.isArray(data.darkMatrix)).toBe(true);
    expect(Array.isArray(data.loadVsCapacity)).toBe(true);
    expect(data.authorBeeswarm.dots.length).toBe(data.totals.open);
    expect(Array.isArray(data.productionHits)).toBe(true);
    expect(Array.isArray(data.calibration.rows)).toBe(true);
    expect(Array.isArray(data.statusMatrix)).toBe(true);
    expect(Array.isArray(data.subsystems)).toBe(true);
    expect(data.kindComparison.length).toBe(3);
    expect(Array.isArray(data.verification.byModel)).toBe(true);
    expect(Array.isArray(data.verification.radar.darkCleanRfc)).toBe(true);
    expect(Array.isArray(data.contributors.authors)).toBe(true);
    expect(typeof data.traffic.total).toBe("number");
  });
});
