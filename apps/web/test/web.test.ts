import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WebDatabase } from "../src/db.ts";
import { parseMrUnifiedDiff, splitBodyIntoBlocks } from "../src/mr.ts";
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
  const app = await createWebHandler({ db });
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

    // Patch HTML page renders dynamic title & OG tags
    const patchHtmlRes = await req("/patch/5879");
    expect(patchHtmlRes.status).toBe(200);
    const patchHtml = await patchHtmlRes.text();
    expect(patchHtml).toContain("CF 5879: amcheck: support for GiST");
    expect(patchHtml).toContain("og:title");
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
  });
});
