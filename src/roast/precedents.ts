// Thin adapter over the precedent corpus (owned by src/corpus). Retrieval is code, not LLM:
// the model writes search queries, this module runs them and hands back rows from the DB.
// Every link in a Precedent comes from the corpus; nothing here is generated.
//
// Backends, tried in order:
//   1. src/corpus/search.ts  -> searchPrecedents({query, before?, kinds?, limit?, includeUndated?})
//      (Postgres database `pgroast`, PGROAST_DSN)
//   2. none (module or database missing): no precedents, with a clear warning
//
// Leak guards: `before` is passed to the backend AND re-checked here; the proposal's own
// CommitFest entry / thread is removed from the results.

import { existsSync } from "node:fs";
import { join } from "node:path";
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
// Backends

let cachedBackend: { name: string; fn: SearchFn | null; warning?: string } | null = null;
let closeFn: (() => Promise<void>) | null = null;

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
