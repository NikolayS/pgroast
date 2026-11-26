import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WebDatabase } from "../src/db.ts";
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

    // Patch collaboration endpoint returns entry, opinions, and unanimous consensus
    const patchRes = await req("/api/v1/entries/5879");
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as { consensus: { status: string; totalOpinions: number }; opinions: unknown[] };
    expect(patchJson.consensus.status).toBe("unanimous");
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
    expect(await llmsFullRes.text()).toContain("Recent Community Opinions");

    expect(patchHtml).toContain('rel="canonical"');
    expect(patchHtml).toContain("application/ld+json");

    // Health reports package version and privacy-friendly page-view counter tracks hits
    const healthRes = await req("/api/v1/health");
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { version: string; views: { total: number } };
    expect(healthJson.version).toMatch(/^0\.3\./);
    expect(healthJson.views.total).toBeGreaterThanOrEqual(1);

    const viewsRes = await req("/api/v1/views");
    expect(viewsRes.status).toBe(200);
    const viewsJson = (await viewsRes.json()) as { total: number; topPatches: Array<{ cf_id: number; hits: number }> };
    expect(viewsJson.total).toBeGreaterThanOrEqual(1);
    expect(viewsJson.topPatches.some((p) => p.cf_id === 5879)).toBe(true);

    // Roast level + flavour round-trip on published opinion
    const darkOp = await req("/api/v1/publish/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        cf_id: 5879,
        backend: "claude",
        roast_level: "dark",
        roast_flavour: "tom-lane",
        verdict: "NEEDS-DESIGN-DISCUSSION",
        confidence: "high",
        summary: "Dark roast in Tom Lane voice checking locking invariants.",
      }),
    });
    expect(darkOp.status).toBe(201);
    const darkJson = (await darkOp.json()) as { opinion: { roast_level: string; roast_flavour: string } };
    expect(darkJson.opinion.roast_level).toBe("dark");
    expect(darkJson.opinion.roast_flavour).toBe("tom-lane");
  });

  test("GitHub & Google OAuth callbacks, admin invite tokens, size cap, and rate limiting", async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "gho_test_token" }), { status: 200 });
      }
      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify({ login: "kirk-pg", name: "Kirk Wolak", avatar_url: "https://avatars.githubusercontent.com/u/1" }), { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "ya29_test_token" }), { status: 200 });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return new Response(JSON.stringify({ sub: "123", email: "andrey@example.com", name: "Andrey Borodin", picture: "" }), { status: 200 });
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
});
