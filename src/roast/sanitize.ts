// Anti-hallucination guards, applied by code to everything the model returns.
//
//  - A URL may appear in the output only if it is in the allowed set: the thread itself, links
//    written inside the visible thread, the CommitFest entry, and links of retrieved precedents.
//    Any other URL is cut out and reported.
//  - Precedents are cited by run-local id (P1, P2, ...). Unknown ids are dropped. The links shown
//    for a precedent are copied from the corpus row by code, never taken from model text.
//  - Thread messages are cited by index. Unknown indexes are dropped.
//  - A quote is kept only if it is found verbatim (modulo whitespace) in the corpus row or the thread.

import type { Precedent, SanitizerReport } from "./schema.ts";

export const REMOVED_LINK = "[link removed: not in the retrieved set]";

const URL_RE = /\bhttps?:\/\/[^\s<>"'`\])}]+/gi;
/** Scheme-less references to the places a fabricated precedent would point at. */
const BARE_RE =
  /(?<![\w/.@-])(?:www\.)?(?:postgr\.es\/m|postgresql\.org\/message-id|commitfest\.postgresql\.org|git\.postgresql\.org|wiki\.postgresql\.org|github\.com|youtu\.be|youtube\.com)\/[^\s<>"'`\])}]+/gi;

export function normaliseUrl(u: string): string {
  let s = u.trim().replace(/[.,;:!?]+$/, "");
  s = s.replace(/^(?!https?:\/\/)/i, "https://");
  s = s.replace(/^http:\/\//i, "https://").replace(/^https:\/\/www\./i, "https://");
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep as is
  }
  s = s.replace(/#.*$/, (h) => (/#[A-Za-z]/.test(h) ? h : ""));
  // postgr.es/m/X and postgresql.org/message-id/[flat/]X name the same thing.
  s = s.replace(/^https:\/\/postgr\.es\/m\//i, "https://postgresql.org/message-id/");
  s = s.replace(/^(https:\/\/postgresql\.org\/message-id\/)flat\//i, "$1");
  const m = s.match(/^(https:\/\/)([^/]+)(.*)$/);
  if (m) s = m[1]! + m[2]!.toLowerCase() + m[3]!;
  return s.replace(/\/+$/, "");
}

export function extractUrls(text: string): string[] {
  return [...(text.match(URL_RE) ?? []), ...(text.match(BARE_RE) ?? [])];
}

export class AllowedUrls {
  private readonly set = new Set<string>();
  add(url: string | null | undefined): void {
    if (url) this.set.add(normaliseUrl(url));
  }
  addFromText(text: string): void {
    for (const u of extractUrls(text)) this.add(u);
  }
  has(url: string): boolean {
    return this.set.has(normaliseUrl(url));
  }
  get size(): number {
    return this.set.size;
  }
}

export function emptyReport(): SanitizerReport {
  return { urls_removed: [], precedent_ids_dropped: [], thread_refs_dropped: [], quotes_dropped: [] };
}

/** Replace every URL that is not allowed, in every string of a JSON value. Returns a copy. */
export function scrubUrls<T>(value: T, allowed: AllowedUrls, stage: string, report: SanitizerReport): T {
  const scrub = (s: string): string => {
    const cut = (u: string): string => {
      const trail = u.match(/[.,;:!?]+$/)?.[0] ?? "";
      const core = trail ? u.slice(0, -trail.length) : u;
      if (allowed.has(core)) return u;
      report.urls_removed.push({ stage, url: core });
      return REMOVED_LINK + trail;
    };
    return s.replace(URL_RE, cut).replace(BARE_RE, cut);
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Keep only ids that are in the retrieved list. Accepts "P3", "[P3]", "p3". */
export function filterPrecedentIds(ids: string[], known: Map<string, Precedent>, stage: string, report: SanitizerReport): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw).trim().replace(/^\[|\]$/g, "").toUpperCase();
    if (known.has(id)) {
      if (!out.includes(id)) out.push(id);
    } else {
      report.precedent_ids_dropped.push({ stage, id: String(raw) });
    }
  }
  return out;
}

export function filterThreadRefs(refs: number[], visible: Set<number>, stage: string, report: SanitizerReport): number[] {
  const out: number[] = [];
  for (const r of refs) {
    if (visible.has(r)) {
      if (!out.includes(r)) out.push(r);
    } else {
      report.thread_refs_dropped.push({ stage, index: r });
    }
  }
  return out;
}

/** Fold whitespace, quote styles and case so a quote can be matched against its source. */
export function foldForQuote(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const MIN_QUOTE_CHARS = 20;

/**
 * Return the quote if it is found verbatim in one of the sources, else null.
 * An ellipsis ("..." or "[...]") splits the quote; every part must be found.
 */
export function verifyQuote(quote: string | null | undefined, sources: string[]): string | null {
  if (!quote) return null;
  const q = quote.trim().replace(/^["'“]+|["'”]+$/g, "");
  if (foldForQuote(q).length < MIN_QUOTE_CHARS) return null;
  const parts = q
    .split(/\[\.\.\.\]|\.\.\.|…/)
    .map(foldForQuote)
    .map((p) => p.replace(/^[.,;:]+|[.,;:]+$/g, "").trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const folded = sources.map(foldForQuote);
  const ok = folded.some((src) => parts.every((p) => p.length >= 8 && src.includes(p)));
  return ok ? q : null;
}
