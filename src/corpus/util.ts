// Shared helpers: HTML text extraction, message-id links, touch-point rules,
// and the record type every source produces.

export type Kind = "cf" | "revert" | "do_not_want";

/** One row as produced by a source extractor (before it is stored). */
export interface PrecedentRecord {
  id: string;
  kind: Kind;
  rawRef: string; // stable source key; unique per kind
  title: string;
  status: string;
  date: string | null; // decision date, ISO "YYYY-MM-DD[THH:MM:SS]"
  firstDate: string | null;
  url: string;
  threadUrls: string[];
  authors: string[];
  reviewers: string[];
  objectors: string[];
  tags: string;
  summary: string;
  objection: string;
  touchPoints: string[];
  otherLinks: string[];
  provenance: Record<string, unknown>;
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", eacute: "é", oslash: "ø", ouml: "ö", uuml: "ü", auml: "ä", aacute: "á",
};

export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? m;
  });
}

export function stripTags(s: string): string {
  return unescapeHtml(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** "a (x), b (y)" -> ["a (x)", "b (y)"] */
export function splitPeople(s: string): string[] {
  return s.split(/,\s*(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- message-ids

export const FLAT = "https://www.postgresql.org/message-id/flat/";
const SAFE = /[A-Za-z0-9@+=._\-~!$&'*,;:]/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Canonical form of a message-id inside a flat URL (decode, then re-quote). */
export function canonMsgid(raw: string): string {
  const mid = safeDecode(raw.trim()).replace(/^<|>$/g, "").trim();
  let out = "";
  for (const ch of mid) {
    if (SAFE.test(ch)) out += ch;
    else for (const b of new TextEncoder().encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export const flatUrl = (rawMsgid: string) => FLAT + canonMsgid(rawMsgid);

const MSGID_URL_RE =
  /https?:\/\/(?:www\.)?postgresql\.org\/message-id\/(?:flat\/|raw\/|mbox\/)?([^\s"'<>()\[\]]+)|https?:\/\/postgr\.es\/m\/([^\s"'<>()\[\]]+)/g;

export function isMsgidUrl(u: string): boolean {
  return /^https?:\/\/(?:www\.)?postgresql\.org\/message-id\/|^https?:\/\/postgr\.es\/m\//.test(u);
}

/** Raw message-ids found as URLs in text, in order, deduped. */
export function extractMsgids(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MSGID_URL_RE)) {
    const mid = (m[1] ?? m[2] ?? "").replace(/[.,;:]+$/, "");
    if (!mid || mid.startsWith("attachment/")) continue;
    if (!safeDecode(mid).includes("@")) continue;
    if (!out.includes(mid)) out.push(mid);
  }
  return out;
}

// ---------------------------------------------------------------- touch points
// Cheap deterministic keyword rules (no LLM). Hints only.

const TOUCH_RULES: [string, RegExp][] = [
  ["pg_dump / restore", /\bpg_dump(all)?\b|\bpg_restore\b|\bdump\b/i],
  ["psql", /\bpsql\b/i],
  ["new GUC", /\bgucs?\b|\bpostgresql\.conf\b|\bconfiguration (parameter|variable|option)/i],
  ["WAL / replication / standby", /\bwal\b|replication|\bstandby\b|\breplica\b|\bwalsender\b|\bwalreceiver\b|\bfailover\b|logical decoding|\bslot\b|\brecovery\b|\barchiv/i],
  ["planner", /\bplanner\b|\boptimi[sz]er\b|\bplan\b|\bexplain\b|\bjoin\b|\bcost(ing)?\b|\bhint/i],
  ["wire protocol / libpq", /\bprotocol\b|\blibpq\b|\bwire\b/i],
  ["catalog changes", /\bcatalog\b|\bpg_class\b|\bpg_attribute\b|\bsystem view\b|\bpg_proc\b/i],
  ["on-disk format / pg_upgrade", /\bpg_upgrade\b|on-disk|\bpage format\b|\btuple format\b|\bheap format\b/i],
  ["security / privileges", /\bsecurity\b|\bprivilege|\bgrant\b|\brevoke\b|\brole\b|\bpassword\b|\bauth|\bssl\b|\btls\b|\bscram\b|\brls\b|row.level security/i],
  ["SQL syntax / standard", /\bsyntax\b|sql standard|\bsql:20\d\d\b|\bkeyword\b|\bgrammar\b/i],
  ["ABI / extension API", /\bhook\b|\bextension\b|\babi\b|\btable am\b|\bindex am\b|\bcustom scan\b/i],
  ["performance on the hot path", /\bperformance\b|\bspeed ?up\b|\bfaster\b|\bhot path\b|\blatency\b/i],
];

export function touchPoints(text: string): string[] {
  return TOUCH_RULES.filter(([, rx]) => rx.test(text)).map(([n]) => n);
}

/** "2024-09-12 11:08:15" -> "2024-09-12T11:08:15" */
export function normTs(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /(\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d(?::\d\d)?))?/.exec(s);
  if (!m) return null;
  return m[1] + (m[2] ? "T" + m[2] : "");
}

export function log(msg: string) {
  console.error(msg);
}
