import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cachePath, fetchText, USER_AGENT } from "../src/thread/fetch.ts";
import { filterMessages, loadProposal, parseInputRef, pickProposalMessages, redactCf } from "../src/thread/load.ts";
import { flatThreadUrl, htmlToText, normTimestamp, parseCommitfestPatch, parseFlatThread, parseSize } from "../src/thread/parse.ts";
import { extractPatchProse, isDocPath, isReadableAttachment } from "../src/thread/patchprose.ts";

const FIX = join(import.meta.dir, "thread-fixtures");
const flatHtml = readFileSync(join(FIX, "flat_int64_gucs.html"), "utf8");
const cfHtml = readFileSync(join(FIX, "cf_patch_5253.html"), "utf8");
const samplePatch = readFileSync(join(FIX, "sample.patch"), "utf8");
const ROOT_ID = "CAJ7c6TMvPz8q+nC=JoKniy7yxPzQYcCTnNFYmsDP-nnWsAOJ2g@mail.gmail.com";

describe("parseFlatThread", () => {
  const t = parseFlatThread(flatHtml);

  test("finds every message, in order", () => {
    expect(t.messages.length).toBe(25);
    expect(t.messages.map((m) => m.index)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(t.messages.map((m) => m.messageId)).size).toBe(25);
    const dates = t.messages.map((m) => m.date);
    expect([...dates].sort()).toEqual(dates);
  });

  test("thread header", () => {
    expect(t.subject).toBe("[PATCH] Support Int64 GUCs");
    expect(t.rootMessageId).toBe(ROOT_ID);
    expect(t.threadUrl).toBe(flatThreadUrl(ROOT_ID));
    expect(t.lists).toEqual(["pgsql-hackers"]);
  });

  test("first message fields", () => {
    const m = t.messages[0]!;
    expect(m.messageId).toBe(ROOT_ID);
    expect(m.from).toBe("Aleksander Alekseev <aleksander(at)timescale(dot)com>");
    expect(m.date).toBe("2024-09-12T11:08:15Z");
    expect(m.subject).toBe("[PATCH] Support Int64 GUCs");
    expect(m.url).toBe("https://www.postgresql.org/message-id/" + encodeURIComponent(ROOT_ID));
    expect(m.body.startsWith("Hi,\n\nAttached is a self-sufficient patch")).toBe(true);
    expect(m.body).not.toContain("<p>");
    expect(m.body).not.toContain("&#x27;");
  });

  test("attachments: name, absolute URL, size", () => {
    const a = t.messages[0]!.attachments;
    expect(a.length).toBe(1);
    expect(a[0]!.name).toBe("v1-0001-Support-64-bit-integer-GUCs.patch");
    expect(a[0]!.url).toBe("https://www.postgresql.org/message-id/attachment/165178/v1-0001-Support-64-bit-integer-GUCs.patch");
    expect(a[0]!.sizeBytes).toBe(Math.round(33.5 * 1024));
    expect(t.messages[1]!.attachments).toEqual([]);
  });

  test("replies keep quoting as text lines", () => {
    const m = t.messages[3]!;
    expect(m.from).toContain("Nathan Bossart");
    expect(m.body).toContain("> Secondly, the following core GUCs are made 64-bit:");
  });

  test("rejects a page without messages", () => {
    expect(() => parseFlatThread("<html><body>Not found</body></html>")).toThrow();
  });
});

describe("parseCommitfestPatch", () => {
  const cf = parseCommitfestPatch(cfHtml, 5253);

  test("fields", () => {
    expect(cf.title).toBe("Support Int64 GUCs");
    expect(cf.status).toBe("Rejected");
    expect(cf.statuses).toEqual([{ cfId: 50, cfName: "2024-11", status: "Rejected" }]);
    expect(cf.authors).toBe("Aleksander Alekseev (a.alekseev), Maxim Orlov (m.orlov)");
    expect(cf.reviewers).toBe("Nathan Bossart (bossartn)");
    expect(cf.created).toBe("2024-09-12T11:11:01Z");
    expect(cf.url).toBe("https://commitfest.postgresql.org/patch/5253/");
  });

  test("thread link", () => {
    expect(cf.threads.length).toBe(1);
    expect(cf.threads[0]!.messageId).toBe(ROOT_ID);
    expect(cf.threads[0]!.url).toBe(flatThreadUrl(ROOT_ID));
    expect(cf.threads[0]!.firstAt).toBe("2024-09-12T11:08:15Z");
    expect(cf.threads[0]!.firstBy).toBe("Aleksander Alekseev");
    expect(cf.threads[0]!.subject).toBe("[PATCH] Support Int64 GUCs");
  });

  test("history", () => {
    expect(cf.history.length).toBeGreaterThanOrEqual(3);
    expect(cf.history[0]).toEqual({
      when: "2024-09-29T21:30:17Z",
      who: "Aleksander Alekseev (aalekseev)",
      what: "Closed in commitfest 2024-11 with status: Rejected",
    });
  });

  test("rejects a non-patch page", () => {
    expect(() => parseCommitfestPatch("<html></html>", 1)).toThrow();
  });
});

describe("small parsers", () => {
  test("htmlToText", () => {
    expect(htmlToText("<p>a &lt;b&gt; &amp; c<br>d</p>\n<p>e&#x27;s &#39;f&#39;</p>")).toBe("a <b> & c\nd\n\ne's 'f'");
  });
  test("normTimestamp", () => {
    expect(normTimestamp("2024-09-12 11:08:15")).toBe("2024-09-12T11:08:15Z");
    expect(normTimestamp("2024-09-12 11:08")).toBe("2024-09-12T11:08:00Z");
    expect(normTimestamp("yesterday")).toBeNull();
  });
  test("parseSize", () => {
    expect(parseSize("33.5 KB")).toBe(34304);
    expect(parseSize("2 MB")).toBe(2 * 1024 * 1024);
    expect(parseSize("812 bytes")).toBe(812);
    expect(parseSize("big")).toBeNull();
  });
});

describe("parseInputRef", () => {
  test("CommitFest id and URLs", () => {
    expect(parseInputRef("5253")).toEqual({ kind: "cf", id: 5253 });
    expect(parseInputRef("https://commitfest.postgresql.org/patch/5253/")).toEqual({ kind: "cf", id: 5253 });
    expect(parseInputRef("https://commitfest.postgresql.org/50/5253/")).toEqual({ kind: "cf", id: 5253 });
  });
  test("message-id and thread URLs", () => {
    const want = { kind: "msgid", messageId: ROOT_ID } as const;
    expect(parseInputRef(ROOT_ID)).toEqual(want);
    expect(parseInputRef(`<${ROOT_ID}>`)).toEqual(want);
    expect(parseInputRef(`https://www.postgresql.org/message-id/flat/${ROOT_ID}`)).toEqual(want);
    expect(parseInputRef(`https://www.postgresql.org/message-id/${encodeURIComponent(ROOT_ID)}`)).toEqual(want);
    expect(parseInputRef(`https://postgr.es/m/${ROOT_ID}`)).toEqual(want);
  });
  test("garbage", () => {
    expect(() => parseInputRef("https://example.com/x")).toThrow();
    expect(() => parseInputRef("hello")).toThrow();
  });
});

describe("--blind / --before", () => {
  const t = parseFlatThread(flatHtml);

  test("blind keeps the first N", () => {
    expect(filterMessages(t.messages, { blind: 5 }).map((m) => m.index)).toEqual([1, 2, 3, 4, 5]);
  });
  test("before is strict", () => {
    const d = filterMessages(t.messages, { before: "2024-09-13" });
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((m) => m.date < "2024-09-13T00:00:00Z")).toBe(true);
    expect(filterMessages(t.messages, { before: "2024-09-12" })).toEqual([]);
  });
  test("both apply", () => {
    const both = filterMessages(t.messages, { before: "2024-09-13", blind: 2 });
    expect(both.map((m) => m.index)).toEqual([1, 2]);
    const many = filterMessages(t.messages, { before: "2024-09-13", blind: 1000 });
    expect(many.length).toBe(filterMessages(t.messages, { before: "2024-09-13" }).length);
  });
  test("bad values", () => {
    expect(() => filterMessages(t.messages, { blind: 0 })).toThrow();
    expect(() => filterMessages(t.messages, { before: "13/09/2024" })).toThrow();
  });

  test("redactCf hides the outcome", () => {
    const cf = parseCommitfestPatch(cfHtml, 5253);
    const blind = redactCf(cf, { blind: 5 });
    expect(blind.redacted).toBe(true);
    expect(blind.status).toBeNull();
    expect(blind.statuses).toEqual([]);
    expect(blind.history).toEqual([]);
    expect(blind.reviewers).toBe("");
    expect(JSON.stringify(blind)).not.toContain("Rejected");
    const before = redactCf(cf, { before: "2024-09-20" });
    expect(before.history.length).toBeGreaterThan(0);
    expect(before.history.every((h) => h.when < "2024-09-20")).toBe(true);
    expect(JSON.stringify(before)).not.toContain("Rejected");
    expect(redactCf(cf, {})).toBe(cf);
  });

  test("pickProposalMessages only looks at visible messages", () => {
    const first3 = filterMessages(t.messages, { blind: 3 });
    expect(pickProposalMessages(first3).map((m) => m.index)).toEqual([1]);
    const all = pickProposalMessages(t.messages);
    expect(all[all.length - 1]!.index).toBe(1);
    expect(all.every((m) => m.attachments.length > 0)).toBe(true);
  });
});

describe("extractPatchProse", () => {
  const p = extractPatchProse(samplePatch);

  test("commit messages, with a folded Subject", () => {
    expect(p.commitMessages.length).toBe(2);
    expect(p.commitMessages[0]!.subject).toBe("Add frobnicate_mode GUC and document it properly");
    expect(p.commitMessages[0]!.body).toContain("Users asked for a way to frobnicate.");
    expect(p.commitMessages[0]!.body).not.toContain("files changed");
    expect(p.commitMessages[1]!.subject).toBe("Add README for frobnication");
  });
  test("lists touched files", () => {
    expect(p.files).toEqual(["doc/src/sgml/config.sgml", "src/backend/utils/misc/guc.c", "src/backend/frob/README"]);
  });
  test("keeps doc and README hunks, never code", () => {
    expect(p.docHunks.map((h) => h.path)).toEqual(["doc/src/sgml/config.sgml", "src/backend/frob/README"]);
    expect(p.docHunks[0]!.text).toContain("guc-frobnicate-mode");
    expect(p.docHunks[1]!.text).toContain("State lives in shared memory.");
    expect(JSON.stringify(p)).not.toContain("secret_code_line");
  });
  test("path and attachment classification", () => {
    expect(isDocPath("doc/src/sgml/ref/psql-ref.sgml")).toBe(true);
    expect(isDocPath("src/backend/access/nbtree/README")).toBe(true);
    expect(isDocPath("contrib/foo/README.md")).toBe(true);
    expect(isDocPath("src/backend/utils/misc/guc.c")).toBe(false);
    expect(isDocPath("src/test/regress/expected/foo.out")).toBe(false);
    expect(isReadableAttachment("v3-0001-x.patch", "application/octet-stream")).toBe(true);
    expect(isReadableAttachment("bench.tar.gz", "application/gzip")).toBe(false);
    expect(isReadableAttachment("flame.svg", "image/svg+xml")).toBe(false);
    expect(isReadableAttachment("notes", "text/plain")).toBe(true);
  });
  test("a plain text file gives nothing", () => {
    const e = extractPatchProse("just some benchmark numbers\n1 2 3\n");
    expect(e.commitMessages).toEqual([]);
    expect(e.files).toEqual([]);
  });
});

describe("fetchText", () => {
  const noSleep = async () => undefined;
  const quiet = () => undefined;

  test("sends the User-Agent, caches, and never refetches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-test-"));
    const calls: { url: string; ua: string | null; method: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ua: new Headers(init?.headers).get("user-agent"), method: init?.method ?? "GET" });
      return new Response("hello", { status: 200 });
    }) as unknown as typeof fetch;
    const url = "https://www.postgresql.org/message-id/flat/cache-test-1@example.org";
    expect(await fetchText(url, { cacheDir: dir, fetchImpl, sleepImpl: noSleep, log: quiet })).toBe("hello");
    expect(await fetchText(url, { cacheDir: dir, fetchImpl, sleepImpl: noSleep, log: quiet })).toBe("hello");
    expect(calls.length).toBe(1);
    expect(calls[0]!.ua).toBe(USER_AGENT);
    expect(calls[0]!.method).toBe("GET");
    expect(existsSync(cachePath(url, dir))).toBe(true);
  });

  test("backs off on 429 and 5xx, then succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-test-"));
    const statuses = [429, 503, 200];
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      const s = statuses.shift()!;
      return new Response(s === 200 ? "ok" : "busy", { status: s, headers: s === 429 ? { "retry-after": "7" } : {} });
    }) as unknown as typeof fetch;
    const url = "https://www.postgresql.org/message-id/flat/retry-test@example.org";
    const body = await fetchText(url, { cacheDir: dir, fetchImpl, sleepImpl: async (ms) => void sleeps.push(ms), log: quiet });
    expect(body).toBe("ok");
    expect(sleeps).toContain(7000);
    expect(sleeps.filter((s) => s >= 5000).length).toBe(2);
  });

  test("keeps at least a second between requests to one host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-test-"));
    const sleeps: number[] = [];
    const fetchImpl = (async () => new Response("x", { status: 200 })) as unknown as typeof fetch;
    const o = { cacheDir: dir, fetchImpl, sleepImpl: async (ms: number) => void sleeps.push(ms), log: quiet };
    await fetchText("https://commitfest.postgresql.org/patch/900001/", o);
    await fetchText("https://commitfest.postgresql.org/patch/900002/", o);
    expect(sleeps.some((s) => s >= 1000)).toBe(true);
  });

  test("404 is cached; offline miss is null; other hosts and http are refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-test-"));
    let n = 0;
    const fetchImpl = (async () => (n++, new Response("no", { status: 404 }))) as unknown as typeof fetch;
    const url = "https://www.postgresql.org/message-id/flat/missing@example.org";
    const o = { cacheDir: dir, fetchImpl, sleepImpl: noSleep, log: quiet };
    expect(await fetchText(url, o)).toBeNull();
    expect(await fetchText(url, o)).toBeNull();
    expect(n).toBe(1);
    expect(await fetchText("https://www.postgresql.org/message-id/flat/other@example.org", { ...o, offline: true })).toBeNull();
    expect(n).toBe(1);
    await expect(fetchText("https://example.com/", o)).rejects.toThrow(/allow list/);
    await expect(fetchText("http://www.postgresql.org/", o)).rejects.toThrow(/allow list/);
  });
});

describe("loadProposal (offline, from fixtures)", () => {
  function primeCache(): string {
    const dir = mkdtempSync(join(tmpdir(), "pgroast-test-"));
    const put = (url: string, body: string) => {
      const p = cachePath(url, dir);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    };
    put("https://commitfest.postgresql.org/patch/5253/", cfHtml);
    put(flatThreadUrl(ROOT_ID), flatHtml);
    put("https://www.postgresql.org/message-id/attachment/165178/v1-0001-Support-64-bit-integer-GUCs.patch", samplePatch);
    return dir;
  }

  test("CommitFest id, blind mode", async () => {
    const p = await loadProposal("5253", { blind: 5, offline: true, cacheDir: primeCache() });
    expect(p.cf?.title).toBe("Support Int64 GUCs");
    expect(p.cf?.redacted).toBe(true);
    expect(p.thread.messages.length).toBe(5);
    expect(p.totalMessages).toBe(25);
    expect(p.threadStart).toBe("2024-09-12T11:08:15Z");
    expect(p.patchProse.length).toBe(1);
    expect(p.patchProse[0]!.fromMessageIndex).toBe(1);
    expect(p.patchProse[0]!.commitMessages.length).toBe(2);
    expect(JSON.stringify(p)).not.toContain("Rejected");
    expect(JSON.stringify(p.patchProse)).not.toContain("secret_code_line");
  });

  test("thread URL, no filters", async () => {
    const p = await loadProposal(`https://www.postgresql.org/message-id/flat/${ROOT_ID}`, { offline: true, cacheDir: primeCache() });
    expect(p.cf).toBeNull();
    expect(p.thread.messages.length).toBe(25);
    expect(p.filters).toEqual({ blind: null, before: null });
    // Later patch versions are not in the cache: reported, not fatal.
    expect(p.warnings.some((w) => w.includes("could not be read"))).toBe(true);
  });

  test("a cutoff before the thread start is an error", async () => {
    await expect(loadProposal("5253", { before: "2020-01-01", offline: true, cacheDir: primeCache() })).rejects.toThrow(/no messages left/);
  });
});
