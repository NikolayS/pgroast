// Thin adapter over the precedent corpus (owned by src/corpus). Retrieval is code, not LLM:
// the model writes search queries, this module runs them and hands back rows from the DB.
// Every link in a Precedent comes from the corpus; nothing here is generated.
//
// Backends, tried in order:
//   1. src/corpus/search.ts  -> searchPrecedents({query, before?, kinds?, limit?, includeUndated?})
//      (Postgres database `pgroast`, PGROAST_DSN)
//   2. bundled:precedents.sql.gz -> zero-DB in-memory search over the 2,547 rows shipped in
//      data/precedents.sql.gz (so `npx pgroast` searches all precedents with zero Postgres setup)
//   3. none (both DB and bundled dump missing): no precedents, with a clear warning
//
// Leak guards: `before` is passed to the backend AND re-checked here; the proposal's own
// CommitFest entry / thread is removed from the results.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { REPO_ROOT } from "../thread/fetch.ts";
import type { Precedent } from "./schema.ts";

export interface SearchArgs {
  query: string;
  /** YYYY-MM-DD: only precedents whose dates are strictly before it. */
  before?: string;
  kinds?: string[];
  limit?: number;
  includeUndated?: boolean;
}

export type RawPrecedent = Record<string, unknown>;
export type SearchFn = (args: SearchArgs) => Promise<RawPrecedent[]>;

export interface RetrieveArgs {
  queries: string[];
  /** Directed lookup, e.g. "find the 2018 suggestion of X". */
  hint?: string | null;
  /** YYYY-MM-DD cutoff. */
  before: string;
  /** Keep undated precedents (wiki "do not want" items). Off in evaluation runs. */
  includeUndated?: boolean;
  /** The proposal itself, to keep it out of its own precedent list. */
  self?: { cfId?: number | null; messageIds?: string[] };
  limit?: number;
  perQuery?: number;
  /** Injected for tests; default = auto-detected backend. */
  search?: SearchFn;
  log?: (msg: string) => void;
}

export interface RetrieveResult {
  precedents: Precedent[];
  backend: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Normalisation

function pick(r: RawPrecedent, ...keys: string[]): unknown {
  for (const k of keys) if (r[k] != null) return r[k];
  return undefined;
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asString).filter(Boolean).join(", ");
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function asList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(asString).filter(Boolean);
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        return asList(JSON.parse(s));
      } catch {
        // fall through
      }
    }
    return s ? [s] : [];
  }
  return [];
}

function asDate(v: unknown): string | null {
  const s = asString(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
}

const isHttpUrl = (s: string) => /^https?:\/\/\S+$/.test(s);

/** Map a backend row (snake_case or camelCase) to a Precedent without the run-local id. */
export function normalisePrecedent(
  r: RawPrecedent,
): Omit<Precedent, "id" | "matched_queries" | "from_hint" | "score" | "enriched" | "key_quote" | "quote_message_url" | "relevant"> | null {
  const url = asString(pick(r, "url", "link")).trim();
  const title = asString(pick(r, "title")).trim();
  // A precedent without a real link is useless here: we never show one.
  if (!isHttpUrl(url) || !title) return null;
  return {
    source_id: asString(pick(r, "id", "source_id", "sourceId")) || url,
    kind: asString(pick(r, "kind", "type")),
    title,
    status: asString(pick(r, "status", "outcome")),
    date: asDate(pick(r, "date", "decided_at", "decidedAt", "decision_date")),
    first_date: asDate(pick(r, "first_date", "firstDate", "started_at", "startedAt")),
    url,
    thread_urls: asList(pick(r, "thread_urls", "threadUrls", "threads")).filter(isHttpUrl),
    authors: asString(pick(r, "authors", "author")),
    objectors: asString(pick(r, "objectors", "who_objected", "whoObjected")),
    summary: asString(pick(r, "summary", "proposal_summary", "proposalSummary")),
    objection: asString(pick(r, "objection", "objection_summary", "objectionSummary", "reason")),
    touch_points: asList(pick(r, "touch_points", "touchPoints")),
  };
}

/** The message-id at the end of an archive URL, decoded; "" when the URL is not one. */
export function messageIdOfUrl(url: string): string {
  const m = url.match(/\/message-id\/(?:flat\/)?([^?#]+)/) ?? url.match(/postgr\.es\/m\/([^?#]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]!).replace(/\/$/, "");
  } catch {
    return m[1]!;
  }
}

// ---------------------------------------------------------------------------------------------
// Bundled zero-DB fallback (data/precedents.sql.gz)

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "into",
  "is", "it", "its", "of", "on", "or", "pg", "postgres", "postgresql", "support", "add", "allow",
  "that", "the", "this", "to", "use", "using", "when", "with", "without", "not", "can", "via",
]);

function unescapePgCopyField(raw: string): string | null {
  if (raw === "\\N") return null;
  if (!raw.includes("\\")) return raw;
  return raw.replace(/\\(.)/g, (_, c: string) => {
    if (c === "n") return "\n";
    if (c === "r") return "\r";
    if (c === "t") return "\t";
    if (c === "b") return "\b";
    if (c === "f") return "\f";
    return c;
  });
}

function parsePgTextArray(raw: string | null): string[] {
  if (!raw || raw === "{}") return [];
  const s = raw.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return s ? [s] : [];
  const inner = s.slice(1, -1);
  if (!inner) return [];
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (inQuote) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") {
        if (cur && cur !== "NULL") out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  if (cur && cur !== "NULL") out.push(cur);
  return out;
}

function tokenizeQuery(text: string): string[] {
  const toks = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  // Expand snake_case identifiers into both the full token and sub-parts for Postgres symbol matching
  const expanded: string[] = [];
  for (const t of toks) {
    expanded.push(t);
    if (t.includes("_")) {
      for (const part of t.split("_")) {
        if (part.length >= 2 && !STOPWORDS.has(part)) expanded.push(part);
      }
    }
  }
  return [...new Set(expanded)];
}

interface BundledRow {
  raw: RawPrecedent;
  kind: string;
  date: string | null;
  first_date: string | null;
  titleToks: Set<string>;
  summaryToks: Set<string>;
  objectionToks: Set<string>;
  metaToks: Set<string>;
  allText: string;
}

const bundledCache = new Map<string, { rows: BundledRow[]; idf: Map<string, number> }>();

/** Load and index the shipped data/precedents.sql.gz dump once in memory (~20ms). */
export function loadBundledPrecedents(dumpPath: string): { rows: BundledRow[]; idf: Map<string, number> } {
  const cached = bundledCache.get(dumpPath);
  if (cached) return cached;

  const sql = gunzipSync(readFileSync(dumpPath)).toString("utf8");
  const lines = sql.split("\n");
  let cols: string[] | null = null;
  const rows: BundledRow[] = [];
  const df = new Map<string, number>();

  for (const line of lines) {
    if (!cols) {
      const m = line.match(/^COPY\s+public\.precedent\s*\(([^)]+)\)\s+FROM\s+stdin;/i);
      if (m) cols = m[1]!.split(",").map((c) => c.trim());
      continue;
    }
    if (line === "\\.") break;
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < cols.length) continue;

    const get = (name: string): string | null => {
      const idx = cols!.indexOf(name);
      return idx >= 0 ? unescapePgCopyField(parts[idx] ?? "\\N") : null;
    };

    const id = get("id") ?? "";
    const kind = get("kind") ?? "";
    const title = get("title") ?? "";
    const status = get("status") ?? "";
    const date = get("date");
    const first_date = get("first_date");
    const url = get("url") ?? "";
    const thread_urls = parsePgTextArray(get("thread_urls"));
    const authors = parsePgTextArray(get("authors"));
    const objectors = parsePgTextArray(get("objectors"));
    const tags = get("tags") ?? "";
    const summary = get("summary") ?? "";
    const objection = get("objection") ?? "";
    const touch_points = parsePgTextArray(get("touch_points"));

    if (!url || !title) continue;

    const titleToks = new Set(tokenizeQuery(title));
    const summaryToks = new Set(tokenizeQuery(summary));
    const objectionToks = new Set(tokenizeQuery(objection));
    const metaToks = new Set(tokenizeQuery(`${tags} ${touch_points.join(" ")} ${authors.join(" ")}`));
    const docToks = new Set([...titleToks, ...summaryToks, ...objectionToks, ...metaToks]);
    for (const t of docToks) df.set(t, (df.get(t) ?? 0) + 1);

    rows.push({
      raw: {
        id,
        kind,
        title,
        status,
        date,
        first_date,
        url,
        thread_urls,
        authors,
        objectors,
        summary,
        objection,
        touch_points,
      },
      kind,
      date,
      first_date,
      titleToks,
      summaryToks,
      objectionToks,
      metaToks,
      allText: `${title} ${summary} ${objection} ${tags}`.toLowerCase(),
    });
  }

  const N = Math.max(1, rows.length);
  const idf = new Map<string, number>();
  for (const [tok, count] of df) {
    idf.set(tok, Math.log(1 + (N - count + 0.5) / (count + 0.5)));
  }

  const built = { rows, idf };
  bundledCache.set(dumpPath, built);
  return built;
}

/** Build a zero-DB SearchFn over the shipped data/precedents.sql.gz file. */
export function createBundledSearch(dumpPath: string): SearchFn {
  const { rows, idf } = loadBundledPrecedents(dumpPath);
  return async (args: SearchArgs): Promise<RawPrecedent[]> => {
    const qToks = tokenizeQuery(args.query);
    if (qToks.length === 0) return [];
    const qLower = args.query.trim().toLowerCase();
    const kinds = args.kinds?.length ? new Set(args.kinds) : null;
    const limit = args.limit ?? 10;

    const scored: { raw: RawPrecedent; score: number }[] = [];
    for (const row of rows) {
      if (kinds && !kinds.has(row.kind)) continue;
      if (args.before) {
        if (row.date && row.date.slice(0, 10) >= args.before) continue;
        if (row.first_date && row.first_date.slice(0, 10) >= args.before) continue;
        if (!row.date && !row.first_date && !args.includeUndated) continue;
      }

      let score = 0;
      let matched = 0;
      for (const t of qToks) {
        const w = idf.get(t) ?? 1.5;
        let hit = false;
        if (row.titleToks.has(t)) {
          score += 3.2 * w;
          hit = true;
        }
        if (row.summaryToks.has(t)) {
          score += 1.4 * w;
          hit = true;
        }
        if (row.objectionToks.has(t)) {
          score += 1.1 * w;
          hit = true;
        }
        if (row.metaToks.has(t)) {
          score += 0.9 * w;
          hit = true;
        }
        // Prefix boost for Postgres stems (e.g. "normaliz" matching "normalization")
        if (!hit && t.length >= 4) {
          for (const dt of row.titleToks) {
            if (dt.startsWith(t) || t.startsWith(dt.slice(0, Math.max(4, dt.length - 2)))) {
              score += 1.6 * w;
              hit = true;
              break;
            }
          }
        }
        if (hit) matched++;
      }
      if (matched === 0) continue;
      // Reward matching multiple query terms and exact phrase matches
      score *= 0.6 + 0.4 * (matched / qToks.length);
      if (qLower.length >= 6 && row.allText.includes(qLower)) score *= 1.5;
      scored.push({ raw: row.raw, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.raw);
  };
}

// ---------------------------------------------------------------------------------------------
// Backends

let cachedBackend: { name: string; fn: SearchFn | null; warning?: string } | null = null;
let closeFn: (() => Promise<void>) | null = null;

/** Reset cached backend (used by tests). */
export function resetBackendCache(): void {
  cachedBackend = null;
  closeFn = null;
}

/** Close the corpus connection pool, so the process can exit. Safe to call at any time. */
export async function closePrecedents(): Promise<void> {
  try {
    await closeFn?.();
  } catch {
    // nothing to do
  }
}

/** Find a working search backend. Never throws. */
export async function detectBackend(root: string = REPO_ROOT): Promise<{ name: string; fn: SearchFn | null; warning?: string }> {
  if (cachedBackend && root === REPO_ROOT) return cachedBackend;
  const problems: string[] = [];
  let found: { name: string; fn: SearchFn | null; warning?: string } | null = null;

  const tsPath = join(root, "src", "corpus", "search.ts");
  if (existsSync(tsPath)) {
    try {
      const mod = (await import(tsPath)) as { searchPrecedents?: unknown; closeSearch?: unknown };
      if (typeof mod.searchPrecedents === "function") {
        const fn = mod.searchPrecedents as (a: SearchArgs) => Promise<unknown>;
        // Probe once: the module may load while its database is not there.
        await Promise.race([
          fn({ query: "postgres", limit: 1 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("probe timed out after 8 s")), 8000)),
        ]);
        closeFn = typeof mod.closeSearch === "function" ? (mod.closeSearch as () => Promise<void>) : null;
        found = {
          name: "src/corpus/search.ts",
          fn: async (a) => {
            const res = await fn(a);
            return (Array.isArray(res) ? res : ((res as { results?: unknown[] })?.results ?? [])) as RawPrecedent[];
          },
        };
      } else {
        problems.push("src/corpus/search.ts does not export searchPrecedents");
      }
    } catch (e) {
      problems.push(`src/corpus/search.ts is not usable: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  // Automatic zero-DB fallback: search the 2,547 rows bundled in data/precedents.sql.gz directly in memory.
  if (!found) {
    const dumpPath = join(root, "data", "precedents.sql.gz");
    if (existsSync(dumpPath)) {
      try {
        const bundledFn = createBundledSearch(dumpPath);
        found = {
          name: "bundled:precedents.sql.gz",
          fn: bundledFn,
        };
        // Bundled fallback gives full 2,547-row coverage without local Postgres: clear DB auth noise.
        problems.length = 0;
      } catch (e) {
        problems.push(`bundled precedents.sql.gz failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }

  const result = found
    ? { ...found, ...(problems.length ? { warning: problems.join("; ") } : {}) }
    : {
        name: "none",
        fn: null,
        warning: `precedent corpus unavailable (${problems.join("; ") || "src/corpus/search.ts not found"}): prior-attempt search was NOT done`,
      };
  if (root === REPO_ROOT) cachedBackend = result;
  return result;
}

// ---------------------------------------------------------------------------------------------
// Retrieval

const RRF_K = 10;

/** Recency factor 1.0-1.5: newer precedents first by default ("don't dig too deep into history"). */
export function recencyBoost(dateIso: string | null, cutoff: string): number {
  if (!dateIso) return 1;
  const years = (Date.parse(cutoff) - Date.parse(dateIso.slice(0, 10))) / (365.25 * 86400e3);
  if (!Number.isFinite(years)) return 1;
  return 1 + 0.5 * Math.max(0, 1 - Math.max(0, years) / 15);
}

export async function retrievePrecedents(args: RetrieveArgs): Promise<RetrieveResult> {
  const warnings: string[] = [];
  const log = args.log ?? (() => undefined);
  let search = args.search;
  let backendName = "injected";
  if (!search) {
    const b = await detectBackend();
    backendName = b.name;
    if (b.warning) warnings.push(b.warning);
    if (!b.fn) return { precedents: [], backend: b.name, warnings };
    search = b.fn;
  }

  const limit = args.limit ?? 15;
  const perQuery = args.perQuery ?? 8;
  const selfIds = new Set((args.self?.messageIds ?? []).filter(Boolean));
  const selfCf = args.self?.cfId != null ? String(args.self.cfId) : null;
  const hintYears = new Set(args.hint?.match(/\b(?:19|20)\d{2}\b/g) ?? []);

  type Acc = Omit<Precedent, "id" | "enriched" | "key_quote" | "quote_message_url" | "relevant">;
  const byKey = new Map<string, Acc>();
  const queries: { q: string; hint: boolean }[] = [
    ...(args.hint ? [{ q: args.hint, hint: true }] : []),
    ...[...new Set(args.queries.map((q) => q.trim()).filter(Boolean))].map((q) => ({ q, hint: false })),
  ];

  let failures = 0;
  for (const { q, hint } of queries) {
    let rows: RawPrecedent[];
    try {
      rows = await search({ query: q, before: args.before, limit: hint ? perQuery * 2 : perQuery, includeUndated: args.includeUndated });
    } catch (e) {
      failures++;
      warnings.push(`precedent search failed for "${q}": ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    log(`  precedents: "${q}" -> ${rows.length}`);
    rows.forEach((raw, rank) => {
      const p = normalisePrecedent(raw);
      if (!p) return;
      // Leak guard 1: nothing dated on or after the cutoff, whatever the backend did.
      for (const d of [p.date, p.first_date]) if (d && d.slice(0, 10) >= args.before) return;
      if (!p.date && !p.first_date && !args.includeUndated) return;
      // Leak guard 2: not the proposal itself.
      if (selfCf && (p.source_id === `cf:${selfCf}` || new RegExp(`/patch/${selfCf}/?$`).test(p.url))) return;
      if ([p.url, ...p.thread_urls].some((u) => selfIds.has(messageIdOfUrl(u)))) return;

      const date = p.date ?? p.first_date;
      let s = (1 / (RRF_K + rank)) * recencyBoost(date, args.before);
      if (hint) {
        s *= 3;
        if (date && hintYears.has(date.slice(0, 4))) s *= 2;
        if (p.first_date && hintYears.has(p.first_date.slice(0, 4))) s *= 2;
      }
      const key = p.source_id;
      const cur = byKey.get(key);
      if (cur) {
        cur.score += s;
        if (!cur.matched_queries.includes(q)) cur.matched_queries.push(q);
        cur.from_hint ||= hint;
      } else {
        byKey.set(key, { ...p, matched_queries: [q], from_hint: hint, score: s });
      }
    });
  }
  if (failures === queries.length && queries.length > 0) {
    warnings.push("every precedent search failed: prior-attempt search was NOT done");
  }

  const precedents = [...byKey.values()]
    .sort((a, b) => b.score - a.score || a.source_id.localeCompare(b.source_id))
    .slice(0, limit)
    .map((p, i) => ({
      id: `P${i + 1}`,
      ...p,
      score: Math.round(p.score * 1000) / 1000,
      enriched: false,
      key_quote: null,
      quote_message_url: null,
      relevant: null,
    }));
  return { precedents, backend: backendName, warnings };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " [...]" : s);

/** Render the retrieved list for a prompt. Links are left out on purpose: the model cites ids. */
export function renderPrecedentsForPrompt(precedents: Precedent[]): string {
  if (precedents.length === 0) {
    return "No precedent found in the corpus. Do not cite any earlier thread, commit or decision as a precedent.";
  }
  return precedents
    .map((p) => {
      const lines = [
        `[${p.id}] ${p.title}`,
        `  kind: ${p.kind || "?"}; outcome: ${p.status || "?"}; decided: ${p.date?.slice(0, 10) ?? "unknown"}; started: ${p.first_date?.slice(0, 10) ?? "unknown"}${p.from_hint ? "; found by the user's hint" : ""}`,
      ];
      if (p.authors) lines.push(`  authors: ${p.authors}`);
      if (p.objectors) lines.push(`  who objected: ${p.objectors}`);
      if (p.touch_points.length) lines.push(`  touch points: ${p.touch_points.join(", ")}`);
      if (p.summary) lines.push(`  proposal: ${clip(p.summary.replace(/\s+/g, " "), 800)}`);
      lines.push(
        `  ${p.enriched ? "why it was not accepted (AI summary of its thread)" : "objection / reason recorded"}: ${p.objection ? clip(p.objection.replace(/\s+/g, " "), 1500) : "(not recorded in the corpus)"}`,
      );
      if (p.key_quote) lines.push(`  key sentence, verbatim from its thread: "${p.key_quote.replace(/\s+/g, " ")}"`);
      return lines.join("\n");
    })
    .join("\n\n");
}
