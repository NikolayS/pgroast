// Parser tests against pages cached from the live sites on 2026-11-11.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { finalStatus, parseArchive, parseList, parsePatch, patchRecord } from "../src/corpus/cf.ts";
import { parseDsn } from "../src/corpus/db.ts";
import { revertReason } from "../src/corpus/reverts.ts";
import { canonMsgid, extractMsgids, flatUrl, touchPoints } from "../src/corpus/util.ts";
import { parseWiki } from "../src/corpus/wiki.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");

describe("commitfest", () => {
  test("archive lists CFs 3..63", () => {
    const cfs = parseArchive(fx("cf_archive.html"));
    expect(cfs.length).toBe(61);
    expect(cfs[0]!.id).toBe(3);
    expect(cfs.at(-1)!.id).toBe(63);
    expect(cfs.find((c) => c.id === 61)).toMatchObject({ name: "PG20-2", state: "Closed", start: "2026-09-01" });
  });

  test("list page rows", () => {
    const rows = parseList(fx("cf_50_status6.html"));
    expect(rows.map((r) => r.id)).toEqual([5253, 5340]);
    expect(rows[0]).toMatchObject({
      title: "Support Int64 GUCs", status: "Rejected",
      authors: "Aleksander Alekseev (a.alekseev), Maxim Orlov (m.orlov)",
      reviewers: "Nathan Bossart (bossartn)", latestMail: "2024-09-29 21:31:33",
    });
    expect(rows[1]!.tags).toEqual(["Refactoring Only"]);
  });

  test("patch page: multi-CF history, final status, thread, dates", () => {
    const p = parsePatch(fx("cf_patch_1032.html"))!;
    expect(p.title).toBe("possibility to specify sort columns for psql describe commands in verbose mode");
    expect(p.statuses.length).toBe(4);
    expect(p.statuses[0]!.cf).toBe(16); // newest first on the site
    expect(finalStatus(p)).toBe("Rejected");
    expect(p.threads.length).toBe(1);
    expect(p.threads[0]!.msgid).toBe("CAFj8pRBHxkuBxtwxnh0=ha22+rxA3Hg8+opyZDAWC12pvefDNw@mail.gmail.com");
    const r = patchRecord(1032, p, "Rejected");
    expect(r.date).toBe("2018-01-12T15:11:50");
    expect(r.firstDate).toBe("2017-02-23T" + p.threads[0]!.firstAt!.slice(11));
    expect(r.url).toBe("https://commitfest.postgresql.org/patch/1032/");
    expect(r.threadUrls).toEqual([
      "https://www.postgresql.org/message-id/flat/CAFj8pRBHxkuBxtwxnh0=ha22+rxA3Hg8+opyZDAWC12pvefDNw@mail.gmail.com",
    ]);
    expect(r.authors).toEqual(["Pavel Stehule (okbobcz)"]);
    expect(r.touchPoints).toContain("psql");
  });

  test("non-patch HTML does not parse", () => {
    expect(parsePatch(fx("cf_archive.html"))).toBeNull();
  });
});

describe("wiki", () => {
  const items = parseWiki(fx("wiki_not_worth_doing.html"));
  test("71 items, 6 under Features We Do Not Want", () => {
    expect(items.length).toBe(71);
    const dnw = items.filter((i) => i.doNotWant);
    expect(dnw.map((i) => i.title)).toEqual([
      "Rewrite the code in a different language",
      '"Oracle-style" optimizer hints',
      "Embedded server",
      "Obfuscated function source code",
      "Indeterminate behavior for the GROUP BY clause",
      "On-disk bitmap indexes",
    ]);
    expect(dnw.every((i) => i.anchor === "Features_We_Do_Not_Want")).toBe(true);
  });
  test("slash headings use URL-safe legacy anchor", () => {
    const it = items.find((i) => i.title.startsWith("Modify the planner to better estimate caching"))!;
    expect(it.anchor).toBe("Optimizer_.2F_Executor");
  });
  test("hints item text and links", () => {
    const h = items.find((i) => i.title.includes("optimizer hints"))!;
    expect(h.description).toStartWith("Optimizer hints, as implemented in Oracle");
    const rw = items.find((i) => i.title.startsWith("Rewrite the code"))!;
    expect(extractMsgids(rw.links.join(" ")).map(flatUrl)).toEqual([
      "https://www.postgresql.org/message-id/flat/CAASwCXdQUiuUnhycdRvrUmHuzk5PsaGxr54U4t34teQjcjb=AQ@mail.gmail.com",
      "https://www.postgresql.org/message-id/flat/CANvSX4wsVhDrqy4Ku81wHs--aViYthJ_G5G-2VeZ=JboEE9TNQ@mail.gmail.com",
    ]);
  });
});

describe("helpers", () => {
  test("message-id canonicalisation is idempotent and decodes %XX", () => {
    expect(canonMsgid("abc%3Ddef%40x.org")).toBe("abc=def@x.org");
    expect(canonMsgid(canonMsgid("a b/c@d"))).toBe(canonMsgid("a b/c@d"));
    expect(extractMsgids("Discussion: https://postgr.es/m/123.456@foo.bar.\nsee https://www.postgresql.org/message-id/attachment/1/x.patch"))
      .toEqual(["123.456@foo.bar"]);
  });
  test("revert reason drops subject and trailers", () => {
    const body = "Revert \"x\"\n\nIt broke things.\n\nDiscussion: https://postgr.es/m/a@b\nBackpatch-through: 17";
    expect(revertReason(body, 'Revert "x"')).toBe("It broke things.");
  });
  test("touch points", () => {
    expect(touchPoints("pg_dump WHERE clause filter")).toEqual(["pg_dump / restore"]);
  });
  test("DSN parsing: keyword and URL with socket host", () => {
    expect(parseDsn("dbname=pgroast host=/tmp")).toEqual({ dbname: "pgroast", host: "/tmp" });
    expect(parseDsn("postgres://localhost/pgroast?host=/tmp")).toMatchObject({ dbname: "pgroast", host: "/tmp" });
  });
});
