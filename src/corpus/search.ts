// Precedent search. Imported directly by the roaster.
//
// 1. AND path: websearch_to_tsquery('english', q), ranked by ts_rank_cd over
//    the weighted tsv (title A, summary+tags B, objection C).
// 2. If that yields fewer than `limit` rows: OR-of-terms fallback — the
//    query's english lexemes, each prefix-matched, OR'ed (to_tsquery('simple')
//    so the already-stemmed lexemes are not stemmed again), expanded with the
//    small SYNONYMS map, ranked by the number of distinct query terms covered
//    (title matches count twice), then ts_rank_cd.
// 3. If pg_trgm is installed: similarity(title, q) is added to the score and
//    titles with similarity > 0.3 are also candidates.
// Only stored rows are returned, so every URL is one the build read from a source.

import type { SQL } from "bun";
import { connect, hasTrgm } from "./db.ts";
import type { Kind } from "./util.ts";

export interface Precedent {
  id: string;
  kind: Kind;
  title: string;
  status: string;
  date: string | null;       // decision date, YYYY-MM-DD
  first_date: string | null; // thread start / reverted commit, YYYY-MM-DD
  url: string;
  thread_urls: string[];
  authors: string[];
  reviewers: string[];
  objectors: string[];
  tags: string;
  summary: string;
  objection: string;
  touch_points: string[];
  score: number;
  match: "and" | "or" | "trgm";
}

export interface SearchOptions {
  query: string;
  /** YYYY-MM-DD: keep only rows whose every known date is strictly before this. */
  before?: string;
  kinds?: Kind[];
  limit?: number;
  /** With `before`: also keep rows that have no date at all (wiki items). */
  includeUndated?: boolean;
  sql?: SQL;
}

// words that carry no signal in proposal titles; dropped in the OR fallback only
const WEAK = new Set(["add", "adding", "support", "allow", "new", "option", "use", "make", "patch", "feature", "pg"]);

// Small curated synonym map over english-stemmed lexemes, used in the OR
// fallback only. A query term counts as covered if it or any synonym matches.
export const SYNONYMS: Record<string, string[]> = {
  planner: ["optim"],
  optim: ["planner"],
  pooler: ["pool", "pgbouncer", "pgpool"],
  pool: ["pooler", "pgbouncer", "pgpool"],
  posit: ["order", "reorder", "attnum"],
  timestamp: ["time", "date"],
};

let shared: SQL | null = null;
let trgmCache: boolean | null = null;

export async function closeSearch() {
  if (shared) await shared.close();
  shared = null;
}

export async function searchPrecedents(o: SearchOptions): Promise<Precedent[]> {
  const sql = o.sql ?? (shared ??= connect());
  const limit = Math.max(1, Math.min(o.limit ?? 10, 200));
  const q = o.query.trim();
  if (!q) return [];
  if (o.before && !/^\d{4}-\d\d-\d\d$/.test(o.before)) throw new Error("before must be YYYY-MM-DD");
  if (trgmCache === null || o.sql) trgmCache = await hasTrgm(sql);
  const trgm = trgmCache;
  const kinds = o.kinds?.length ? o.kinds : null;
  const before = o.before ?? null;
  const undated = !!o.includeUndated;

  const filters = sql`
    (${kinds === null} or p.kind in (select jsonb_array_elements_text((${JSON.stringify(kinds ?? [])}::text)::jsonb)))
    and (${before}::date is null
         or (coalesce(p.first_date, p.date) < ${before}::date and coalesce(p.date, p.first_date) < ${before}::date)
         or (${undated} and p.first_date is null and p.date is null))`;
  const trgmExpr = trgm ? sql`similarity(p.title, ${q})` : sql`0::real`;
  const cols = sql`
    p.id, p.kind, p.title, p.status, to_char(p.date, 'YYYY-MM-DD') as date,
    to_char(p.first_date, 'YYYY-MM-DD') as first_date, p.url,
    array_to_json(p.thread_urls)::text as thread_urls, array_to_json(p.authors)::text as authors,
    array_to_json(p.reviewers)::text as reviewers, array_to_json(p.objectors)::text as objectors,
    p.tags, p.summary, p.objection, array_to_json(p.touch_points)::text as touch_points`;

  const andRows = await sql`
    select ${cols}, ts_rank_cd(p.tsv, w.q, 1) + 0.5 * ${trgmExpr} as score, 'and' as match
    from precedent p, websearch_to_tsquery('english', ${q}) w(q)
    where numnode(w.q) > 0 and p.tsv @@ w.q and ${filters}
    order by score desc, p.id limit ${limit}`;
  let rows = [...andRows];

  if (rows.length < limit) {
    const lex = await sql`
      select coalesce(array_agg(l order by l), '{}') as lexemes
      from unnest(tsvector_to_array(to_tsvector('english', ${q}))) l
      where l ~ '^[[:alnum:]_.-]+$'`;
    const lexemes = ((lex[0]?.lexemes ?? []) as string[]).filter((l) => !WEAK.has(l));
    const seen = rows.map((r) => r.id as string);
    if (lexemes.length) {
      const groups = lexemes.map((l) => [l, ...(SYNONYMS[l] ?? [])]);
      const orq = [...new Set(groups.flat())].map((l) => `'${l}':*`).join(" | ");
      const g = JSON.stringify(groups);
      // rank by how many distinct query terms (with synonyms) a row covers,
      // title matches counting twice, then by ts_rank_cd
      const orRows = await sql`
        select ${cols},
          (select count(*) from jsonb_array_elements((${g}::text)::jsonb) grp
            where p.tsv @@ to_tsquery('simple', (select string_agg(quote_literal(x) || ':*', ' | ')
                                                 from jsonb_array_elements_text(grp) x)))
          + (select count(*) from jsonb_array_elements((${g}::text)::jsonb) grp
            where p.tsv @@ to_tsquery('simple', (select string_agg(quote_literal(x) || ':*A', ' | ')
                                                 from jsonb_array_elements_text(grp) x)))
          + ts_rank_cd(p.tsv, to_tsquery('simple', ${orq}), 1) + 0.5 * ${trgmExpr} as score, 'or' as match
        from precedent p
        where p.tsv @@ to_tsquery('simple', ${orq}) and ${filters}
          and p.id not in (select jsonb_array_elements_text((${JSON.stringify(seen)}::text)::jsonb))
        order by score desc, p.id limit ${limit - rows.length}`;
      rows = rows.concat([...orRows]);
    }
    if (trgm && rows.length < limit) {
      const seen2 = rows.map((r) => r.id as string);
      const tRows = await sql`
        select ${cols}, 0.5 * similarity(p.title, ${q}) as score, 'trgm' as match
        from precedent p
        where similarity(p.title, ${q}) > 0.3 and ${filters} and p.id not in (select jsonb_array_elements_text((${JSON.stringify(seen2)}::text)::jsonb))
        order by score desc, p.id limit ${limit - rows.length}`;
      rows = rows.concat([...tRows]);
    }
  }
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, status: r.status, date: r.date, first_date: r.first_date,
    url: r.url, thread_urls: JSON.parse(r.thread_urls), authors: JSON.parse(r.authors),
    reviewers: JSON.parse(r.reviewers), objectors: JSON.parse(r.objectors), tags: r.tags,
    summary: r.summary, objection: r.objection, touch_points: JSON.parse(r.touch_points),
    score: Math.round(Number(r.score) * 10000) / 10000, match: r.match,
  }));
}
