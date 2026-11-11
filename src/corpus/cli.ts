// PG Roast precedent corpus CLI.
//
//   bun run src/corpus/cli.ts build [--source cf|reverts|wiki|all] [--limit N] [--offline]
//   bun run src/corpus/cli.ts search "<query>" [--before YYYY-MM-DD] [--kind cf,revert,do_not_want] [-n 10] [--json] [--include-undated]
//   bun run src/corpus/cli.ts stats
//   bun run src/corpus/cli.ts selftest

import { crawlCommitfest } from "./cf.ts";
import { applySchema, connect, hasTrgm, store } from "./db.ts";
import { fetchStats, readCached } from "./fetch.ts";
import { collectReverts, git, PG_REPO } from "./reverts.ts";
import { closeSearch, searchPrecedents } from "./search.ts";
import { canonMsgid, extractMsgids, log, unescapeHtml, type Kind } from "./util.ts";
import { collectWiki, WIKI_PAGE } from "./wiki.ts";

type Args = { _: string[]; [k: string]: string | boolean | string[] };

function parseArgs(argv: string[]): Args {
  const a: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t.startsWith("-")) {
      const k = t.replace(/^-+/, "");
      const next = argv[i + 1];
      if (["json", "offline", "include-undated"].includes(k) || next === undefined) a[k] = true;
      else { a[k] = next; i++; }
    } else a._.push(t);
  }
  return a;
}

const KIND_OF: Record<string, Kind> = { cf: "cf", reverts: "revert", wiki: "do_not_want" };

async function build(a: Args) {
  const source = (a.source as string) ?? "all";
  if (!["cf", "reverts", "wiki", "all"].includes(source)) throw new Error("bad --source");
  const limit = a.limit ? Number(a.limit) : undefined;
  const offline = !!a.offline;
  const sql = connect();
  const sch = await applySchema(sql);
  log(sch.trgm ? "pg_trgm: available" : `pg_trgm: NOT available (${sch.trgmError}); title similarity disabled`);
  for (const s of source === "all" ? ["wiki", "reverts", "cf"] : [source]) {
    log(`== building ${s}`);
    const r = s === "cf" ? await crawlCommitfest({ limit, offline })
      : s === "reverts" ? await collectReverts({ limit })
      : await collectWiki({ offline });
    const cov = { ...r.cov, records: r.recs.length, fetch_stats: { ...fetchStats } };
    const st = await store(sql, KIND_OF[s]!, r.recs, r.complete, cov);
    console.log(JSON.stringify({ [s]: { ...cov, ...st, complete: r.complete } }, null, 1));
  }
  await stats(sql);
  await sql.close();
}

async function stats(sql = connect()) {
  const rows = await sql`
    select kind, status, count(*)::int n, min(first_date)::text f1, max(first_date)::text f2,
           min(date)::text d1, max(date)::text d2,
           count(*) filter (where cardinality(thread_urls) > 0)::int with_threads
    from precedent group by 1, 2 order by 1, 2`;
  console.log("kind        status                   rows  w/thread  first_date range        date range");
  for (const r of rows) {
    console.log(`${r.kind.padEnd(11)} ${r.status.padEnd(24)} ${String(r.n).padStart(5)} ${String(r.with_threads).padStart(8)}  ` +
      `${r.f1 ?? "-"}..${r.f2 ?? "-"}  ${r.d1 ?? "-"}..${r.d2 ?? "-"}`);
  }
  const [t] = await sql`select count(*)::int n from precedent`;
  console.log(`total ${t.n} rows; pg_trgm ${(await hasTrgm(sql)) ? "on" : "off"}`);
}

async function search(a: Args) {
  const query = a._[1];
  if (!query) throw new Error('usage: search "<query>" [--before YYYY-MM-DD] [--kind ...] [-n 10] [--json]');
  const res = await searchPrecedents({
    query,
    before: a.before as string | undefined,
    kinds: a.kind ? (String(a.kind).split(",") as Kind[]) : undefined,
    limit: a.n ? Number(a.n) : 10,
    includeUndated: !!a["include-undated"],
  });
  await closeSearch();
  if (a.json) {
    console.log(JSON.stringify({ query, before: a.before ?? null, results: res }, null, 1));
    return;
  }
  if (!res.length) { console.log("no precedent found"); return; }
  res.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. [${r.kind}/${r.status}] ${r.date ?? r.first_date ?? "undated"}  ${r.title}  (${r.match} ${r.score})`);
    console.log(`    ${r.url}`);
    for (const t of r.thread_urls.slice(0, 2)) console.log(`    thread: ${t}`);
    if (r.objection) {
      const o = r.objection.replace(/\s+/g, " ");
      console.log(`    objection: ${o.slice(0, 200)}${o.length > 200 ? "..." : ""}`);
    }
  });
}

// ------------------------------------------------------------------ selftest

async function selftest() {
  const fails: string[] = [];
  const check = (ok: unknown, msg: string) => { if (!ok) fails.push(msg); };
  const sql = connect();
  try {
    await sql`select 1`;
  } catch (e) {
    console.log("FAIL database not reachable:", String(e));
    process.exit(1);
  }
  const [schema] = await sql`
    select to_regclass('precedent') is not null as t,
           exists (select 1 from pg_attribute where attrelid = to_regclass('precedent') and attname = 'tsv' and attgenerated = 's') as gen,
           exists (select 1 from pg_indexes where tablename = 'precedent' and indexdef ilike '%using gin (tsv)%') as gin,
           exists (select 1 from pg_constraint where conname = 'precedent_kind_raw_ref_key') as uniq`;
  check(schema.t && schema.gen && schema.gin && schema.uniq, `schema incomplete: ${JSON.stringify(schema)}`);
  const [cnt] = await sql`select count(*)::int n, count(*) filter (where tsv = ''::tsvector)::int empty from precedent`;
  check(cnt.n > 0, "precedent table is empty");
  check(cnt.empty === 0, `${cnt.empty} rows with empty tsvector`);
  const kinds = await sql`select kind, count(*)::int n from precedent group by 1`;
  for (const k of ["cf", "revert", "do_not_want"]) check(kinds.some((r: any) => r.kind === k && r.n > 0), `no rows of kind ${k}`);
  const r1 = await searchPrecedents({ query: "optimizer hints", sql });
  check(r1.length > 0, "search 'optimizer hints' returned nothing");
  const r2 = await searchPrecedents({ query: `'); drop table precedent; -- " OR *:`, sql });
  check(Array.isArray(r2), "hostile query raised");
  const r3 = await searchPrecedents({ query: "revert", before: "2010-01-01", sql });
  check(r3.every((r) => (r.date ?? "") < "2010-01-01" && (r.first_date ?? "") < "2010-01-01" && (r.date || r.first_date)),
    "--before leaked a row dated on/after the cutoff or an undated row");

  // URL patterns, in SQL
  const bad = await sql`
    select id, url from precedent where not (
      (kind = 'cf' and url ~ '^https://commitfest\\.postgresql\\.org/patch/[0-9]+/$' and url = 'https://commitfest.postgresql.org/' || raw_ref || '/')
      or (kind = 'revert' and url ~ '^https://git\\.postgresql\\.org/gitweb/\\?p=postgresql\\.git;a=commit;h=[0-9a-f]{40}$' and url like '%=' || raw_ref)
      or (kind = 'do_not_want' and url ~ '^https://wiki\\.postgresql\\.org/wiki/Not_Worth_Doing#[A-Za-z0-9_.-]+$'))
    union all
    select id, t from precedent, unnest(thread_urls) t
    where t !~ '^https://www\\.postgresql\\.org/message-id/flat/[^[:space:]/?#]+@[^[:space:]/?#]+$'
    union all
    select id, t from precedent, unnest(other_links) t where t !~ '^https?://[^[:space:]]+$'`;
  for (const b of bad) check(false, `${b.id}: bad url ${b.url}`);

  // provenance: every thread message-id appears in the cached source page / git output
  const wikiHtml = readCached(WIKI_PAGE) ?? "";
  const rows = await sql`select id, kind, raw_ref, url, thread_urls, provenance from precedent`;
  let prov = 0;
  for (const r of rows) {
    let ids: Set<string>;
    if (r.kind === "cf") {
      const pid = /^patch\/(\d+)$/.exec(r.raw_ref)?.[1];
      const page = readCached(r.provenance.cache_url ?? r.url) ?? "";
      check(pid && page.includes(`/patch/${pid}`), `${r.id}: patch id not found in cached source page`);
      ids = new Set([...page.matchAll(/message-id\/flat\/([^"]+)"/g)].map((m) => canonMsgid(unescapeHtml(m[1]!))));
    } else if (r.kind === "revert") {
      const reverted = ((r.provenance.reverted_commits ?? []) as { hash: string }[]).map((c) => c.hash);
      const g = await git("show", "-s", "--format=%B", r.raw_ref, ...reverted);
      check(g.code === 0, `${r.id}: commit not in ${PG_REPO}`);
      ids = new Set(extractMsgids(g.out).map(canonMsgid));
    } else {
      const anchor = r.url.split("#")[1];
      check(wikiHtml.includes(`id="${anchor}"`), `${r.id}: anchor not on cached wiki page`);
      ids = new Set(extractMsgids(wikiHtml).map(canonMsgid));
    }
    for (const t of r.thread_urls as string[]) {
      prov++;
      check(ids.has(t.replace("https://www.postgresql.org/message-id/flat/", "")), `${r.id}: thread ${t} not found in its source`);
    }
  }
  console.log(JSON.stringify({ rows: cnt.n, kinds, url_violations: bad.length, threads_checked: prov, failures: fails.length, trgm: await hasTrgm(sql) }));
  for (const f of fails.slice(0, 30)) console.log("FAIL", f);
  await sql.close();
  await closeSearch();
  if (fails.length) process.exit(1);
  console.log("selftest OK");
}

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0];
try {
  if (cmd === "build") await build(a);
  else if (cmd === "search") await search(a);
  else if (cmd === "stats") { const s = connect(); await stats(s); await s.close(); }
  else if (cmd === "selftest") await selftest();
  else {
    console.error("usage: cli.ts build|search|stats|selftest   (see header of src/corpus/cli.ts)");
    process.exit(2);
  }
} catch (e) {
  console.error(String((e as Error).stack ?? e));
  process.exit(1);
}
