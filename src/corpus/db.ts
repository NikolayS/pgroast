// Postgres access for the precedent corpus (Bun.sql, no npm driver).
//
// PGROAST_DSN accepts either a libpq keyword string ("dbname=pgroast host=/tmp")
// or a URL ("postgres://localhost/pgroast?host=/tmp"). Bun 1.3.5 forwards an
// unknown URL query parameter such as ?host= to the server as a startup GUC,
// which fails, so the DSN is parsed here and a socket directory is turned
// into Bun's `path` option (<dir>/.s.PGSQL.<port>).

import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./fetch.ts";
import type { Kind, PrecedentRecord } from "./util.ts";

export const DEFAULT_DSN = "dbname=pgroast host=/tmp";

export function parseDsn(dsn: string): Record<string, string> {
  const kv: Record<string, string> = {};
  if (/^postgres(ql)?:\/\//.test(dsn)) {
    const u = new URL(dsn);
    if (u.hostname) kv.host = decodeURIComponent(u.hostname);
    if (u.port) kv.port = u.port;
    if (u.username) kv.user = decodeURIComponent(u.username);
    if (u.password) kv.password = decodeURIComponent(u.password);
    const db = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (db) kv.dbname = db;
    for (const [k, v] of u.searchParams) kv[k === "database" ? "dbname" : k] = v;
  } else {
    for (const m of dsn.matchAll(/(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|\S+)/g)) {
      kv[m[1]!] = m[2]!.startsWith("'") ? m[2]!.slice(1, -1).replace(/\\(.)/g, "$1") : m[2]!;
    }
  }
  return kv;
}

export function connect(dsn = process.env.PGROAST_DSN ?? DEFAULT_DSN): SQL {
  const kv = parseDsn(dsn);
  const port = Number(kv.port ?? 5432);
  const opts: Record<string, unknown> = {
    database: kv.dbname ?? "pgroast",
    username: kv.user ?? process.env.PGUSER ?? process.env.USER,
    max: 4,
    idleTimeout: 5,
  };
  if (kv.password) opts.password = kv.password;
  const host = kv.host ?? "/tmp";
  if (host.startsWith("/")) opts.path = join(host, `.s.PGSQL.${port}`);
  else Object.assign(opts, { hostname: host, port });
  return new SQL(opts as ConstructorParameters<typeof SQL>[0]);
}

/** Apply sql/schema.sql; try pg_trgm. Returns whether pg_trgm is usable. */
export async function applySchema(sql: SQL): Promise<{ trgm: boolean; trgmError?: string }> {
  await sql.unsafe(readFileSync(join(ROOT, "sql", "schema.sql"), "utf8"));
  try {
    await sql.unsafe("create extension if not exists pg_trgm");
    await sql.unsafe("create index if not exists precedent_title_trgm_idx on precedent using gin (title gin_trgm_ops)");
    return { trgm: true };
  } catch (e) {
    return { trgm: false, trgmError: String((e as Error).message ?? e).split("\n")[0] };
  }
}

export async function hasTrgm(sql: SQL): Promise<boolean> {
  const r = await sql`select 1 from pg_extension where extname = 'pg_trgm'`;
  return r.length > 0;
}

/**
 * Upsert records on (kind, raw_ref). When `complete`, rows of this kind that
 * the source no longer produced are deleted, so a full rebuild is exact.
 */
export async function store(sql: SQL, kind: Kind, recs: PrecedentRecord[], complete: boolean, coverage: unknown) {
  const payload = JSON.stringify(recs.map((r) => ({
    id: r.id, kind: r.kind, raw_ref: r.rawRef, title: r.title, status: r.status,
    date: r.date, first_date: r.firstDate, url: r.url, thread_urls: r.threadUrls,
    authors: r.authors, reviewers: r.reviewers, objectors: r.objectors, tags: r.tags,
    summary: r.summary, objection: r.objection, touch_points: r.touchPoints,
    other_links: r.otherLinks, provenance: r.provenance,
  })));
  let deleted = 0;
  await sql.begin(async (tx) => {
    await tx`
      insert into precedent as p (id, kind, raw_ref, title, status, date, first_date, url,
        thread_urls, authors, reviewers, objectors, tags, summary, objection,
        touch_points, other_links, provenance, built_at)
      select r.id, r.kind, r.raw_ref, r.title, r.status, left(r.date, 10)::date, left(r.first_date, 10)::date, r.url,
        array(select jsonb_array_elements_text(r.thread_urls)),
        array(select jsonb_array_elements_text(r.authors)),
        array(select jsonb_array_elements_text(r.reviewers)),
        array(select jsonb_array_elements_text(r.objectors)),
        r.tags, r.summary, r.objection,
        array(select jsonb_array_elements_text(r.touch_points)),
        array(select jsonb_array_elements_text(r.other_links)),
        r.provenance, now()
      from jsonb_to_recordset((${payload}::text)::jsonb) as r(
        id text, kind text, raw_ref text, title text, status text, date text, first_date text, url text,
        thread_urls jsonb, authors jsonb, reviewers jsonb, objectors jsonb, tags text, summary text,
        objection text, touch_points jsonb, other_links jsonb, provenance jsonb)
      on conflict (kind, raw_ref) do update set
        id = excluded.id, title = excluded.title, status = excluded.status, date = excluded.date,
        first_date = excluded.first_date, url = excluded.url, thread_urls = excluded.thread_urls,
        authors = excluded.authors, reviewers = excluded.reviewers, objectors = excluded.objectors,
        tags = excluded.tags, summary = excluded.summary, objection = excluded.objection,
        touch_points = excluded.touch_points, other_links = excluded.other_links,
        provenance = excluded.provenance, built_at = excluded.built_at`;
    if (complete) {
      const keys = JSON.stringify(recs.map((r) => r.rawRef));
      const d = await tx`
        delete from precedent where kind = ${kind}
          and raw_ref not in (select jsonb_array_elements_text((${keys}::text)::jsonb))`;
      deleted = d.count ?? 0;
    }
    await tx`
      insert into build_log (kind, built_at, coverage) values (${kind}, now(), (${JSON.stringify(coverage)}::text)::jsonb)
      on conflict (kind) do update set built_at = excluded.built_at, coverage = excluded.coverage`;
  });
  return { upserted: recs.length, deleted };
}
