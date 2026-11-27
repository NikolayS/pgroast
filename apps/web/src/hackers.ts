import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WebDatabase } from "./db.ts";
import { safeHttpUrl } from "./security.ts";

export type CreditKind =
  | "author"
  | "committer"
  | "co_author"
  | "reviewer"
  | "reporter"
  | "suggester"
  | "tester"
  | "analyzer";

export type PgRole =
  | "Core Team"
  | "Committer"
  | "Major Contributor"
  | "Significant Contributor"
  | "Contributor";

export interface ParsedPersonRef {
  name: string;
  normalizedName: string;
  email: string;
  domain: string;
  affiliation: string;
}

export interface ParsedCommit {
  sha: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
  gitAuthor: ParsedPersonRef;
  gitCommitter: ParsedPersonRef;
  trailers: Array<{ kind: CreditKind; person: ParsedPersonRef }>;
  discussionUrls: string[];
  isRevert: boolean;
  isBackpatch: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
  primarySubsystem: string;
  subsystems: string[];
  pgMajor: string;
}

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "fastmail.com",
  "fastmail.fm",
  "iki.fi",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.ru",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "postgresql.org",
  "users.noreply.github.com",
  "noreply.github.com",
]);

const KNOWN_PG_HANDLES: Record<string, string> = {
  tgl: "tom lane",
  rhaas: "robert haas",
  petere: "peter eisentraut",
  alvherre: "alvaro herrera",
  heikki: "heikki linnakangas",
  andres: "andres freund",
  bruce: "bruce momjian",
  momjian: "bruce momjian",
  x4m: "andrey borodin",
  x4mmm: "andrey borodin",
  wolakk: "kirk wolak",
  akorotkov: "alexander korotkov",
  drowley: "david rowley",
  akapila: "amit kapila",
  masahiko: "masahiko sawada",
  fujii: "fujii masao",
  tmunro: "thomas munro",
  pgeoghegan: "peter geoghegan",
  mp: "michael paquier",
  michael: "michael paquier",
  tvondra: "tomas vondra",
  magnus: "magnus hagander",
  mha: "magnus hagander",
  jdavis: "jeff davis",
  jkatz: "jonathan katz",
  dpage: "dave page",
  sfrost: "stephen frost",
  andrew: "andrew dunstan",
  adunstan: "andrew dunstan",
  dean: "dean rasheed",
  drasheed: "dean rasheed",
  nathan: "nathan bossart",
  nbossart: "nathan bossart",
  jeltf: "jelte fennema-nio",
  dnolen: "daniel gustafsson",
  dgustafsson: "daniel gustafsson",
  melanie: "melanie plageman",
};

const KNOWN_NAME_EQUIVALENTS: Record<string, string> = {
  "masao fujii": "fujii masao",
  "kuroda hayato": "hayato kuroda",
  "hou zhijie": "zhijie hou",
  "sawada masahiko": "masahiko sawada",
  "horiguchi kyotaro": "kyotaro horiguchi",
  "amit langote": "amit langote",
  "michael paquier": "michael paquier",
  "alvaro herrera": "alvaro herrera",
  "jelte fennema": "jelte fennema-nio",
  "thomas lane": "tom lane",
  "robert m haas": "robert haas",
  "bruce r momjian": "bruce momjian",
  "jonathan s katz": "jonathan katz",
  "peter j eisentraut": "peter eisentraut",
  "vikram aditya": "vikram aditya",
};

const INVALID_PERSON_RE =
  /^(?:unknown|none|n\/a|various|multiple|others|pgsql-hackers|postgres|postgresql|root|test|author|reviewer|committer|the author|all|several|myself|me)$/i;

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizePersonName(raw: string): string {
  let s = stripDiacritics(raw)
    .replace(/["'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Flip "Last, First" -> "First Last" when there is a single comma and two name parts
  const commaParts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2 && commaParts[0]!.split(/\s+/).length === 1 && commaParts[1]!.split(/\s+/).length <= 2) {
    s = `${commaParts[1]} ${commaParts[0]}`;
  }
  s = s
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (KNOWN_NAME_EQUIVALENTS[s]) return KNOWN_NAME_EQUIVALENTS[s]!;
  return s;
}

export function slugifyPerson(name: string): string {
  const base = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "contributor";
}

export function parsePersonRef(raw: string): ParsedPersonRef | null {
  let s = raw.trim();
  if (!s) return null;

  // Extract email from <...>, obfuscated "(local at domain.tld)" / "local [at] domain.tld", or bare email token
  let email = "";
  const angleMatch = s.match(/<([^>\s]+@[^>\s]+)>/);
  if (angleMatch?.[1]) {
    email = angleMatch[1].trim().toLowerCase();
    s = s.replace(angleMatch[0], " ").trim();
  } else {
    const obfMatch = s.match(/[\[(<]?\s*([A-Za-z0-9._%+-]+)\s+(?:at|\[at\]|\(at\))\s+([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*[\])>]?/i);
    if (obfMatch?.[1] && obfMatch?.[2]) {
      email = `${obfMatch[1].trim().toLowerCase()}@${obfMatch[2].trim().toLowerCase()}`;
      s = s.replace(obfMatch[0], " ").trim();
    } else {
      const bareMatch = s.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
      if (bareMatch?.[1]) {
        email = bareMatch[1].trim().toLowerCase();
        s = s.replace(bareMatch[0], " ").trim();
      }
    }
  }

  // Extract parenthetical org/affiliation like "Hayato Kuroda (Fujitsu)"
  // Ignore non-organization notes and obfuscated addresses
  let affiliation = "";
  const parenMatch = s.match(/\(([^()]{2,45})\)/);
  if (parenMatch?.[1]) {
    const candidate = parenMatch[1].trim();
    if (
      !/@|http|github|gitlab|\bat\s+[a-z0-9.-]+\.[a-z]{2,}/i.test(candidate) &&
      !/^(?:earlier|previous|initial|original|first|later|older|v\d+|part\s*\d+|patch|draft|test|tests|docs?|review|bug|fix|analysis|suggestion|help|idea)/i.test(
        candidate,
      )
    ) {
      affiliation = candidate;
    }
    s = s.replace(parenMatch[0], " ").trim();
  }

  // Strip surrounding quotes, stray angle brackets/parens, and trailing punctuation
  s = s
    .replace(/^["'`<>()]+|["'`<>()]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,;:]+$/g, "")
    .trim();

  // If no name, derive from email local part
  if (!s && email) {
    const local = email.split("@")[0] || "";
    if (KNOWN_PG_HANDLES[local]) {
      s = KNOWN_PG_HANDLES[local]!;
    } else {
      s = local.replace(/[._-]+/g, " ").trim();
    }
  }

  const normalizedName = normalizePersonName(s);
  if (!normalizedName || normalizedName.length < 2 || INVALID_PERSON_RE.test(normalizedName)) {
    return null;
  }
  // Drop obvious non-name prose sentences from sloppy trailers
  if (normalizedName.split(/\s+/).length > 5 || /https?:|commit\s+[0-9a-f]{6}/i.test(normalizedName)) {
    return null;
  }

  const domain = email.includes("@") ? email.split("@")[1]!.toLowerCase() : "";
  return {
    name: s || normalizedName,
    normalizedName,
    email,
    domain,
    affiliation,
  };
}

export function splitTrailerPeople(rawValue: string): ParsedPersonRef[] {
  // Split lists like "Alice <a@x>, Bob <b@y>" or "Alice, Bob, and Charlie"
  // Avoid splitting commas inside parentheses or quotes
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < rawValue.length; i++) {
    const ch = rawValue[i]!;
    if (ch === "(" || ch === "<") depth++;
    else if (ch === ")" || ch === ">") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());

  const out: ParsedPersonRef[] = [];
  for (const part of parts) {
    // Also split "Alice and Bob" when no email angle brackets span across
    const subParts = part.includes("<") ? [part] : part.split(/\s+and\s+/i);
    for (const sp of subParts) {
      const cleaned = sp.replace(/^and\s+/i, "").trim();
      const parsed = parsePersonRef(cleaned);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

export function classifySubsystem(filePath: string): string {
  const p = filePath.toLowerCase();
  if (p.startsWith("doc/")) return "Documentation";
  if (p.startsWith("src/test/")) return "Tests & TAP";
  if (p.startsWith("contrib/")) return "Contrib & Extensions";
  if (p.startsWith("src/bin/") || p.startsWith("src/interfaces/")) return "Client & psql";
  if (p.startsWith("src/backend/optimizer/") || p.startsWith("src/include/optimizer/")) return "Optimizer / Planner";
  if (p.startsWith("src/backend/executor/") || p.startsWith("src/include/executor/")) return "Executor";
  if (p.startsWith("src/backend/replication/") || p.startsWith("src/include/replication/")) return "Replication";
  if (
    p.startsWith("src/backend/storage/") ||
    p.startsWith("src/include/storage/") ||
    p.startsWith("src/backend/access/transam/") ||
    p.startsWith("src/include/access/xlog")
  ) {
    return "Storage & WAL";
  }
  if (p.startsWith("src/backend/access/") || p.startsWith("src/include/access/")) {
    return "Indexing & Access Methods";
  }
  if (
    p.startsWith("src/backend/catalog/") ||
    p.startsWith("src/backend/commands/") ||
    p.startsWith("src/include/catalog/") ||
    p.startsWith("src/include/commands/")
  ) {
    return "Catalog & DDL";
  }
  if (
    p.startsWith("src/backend/parser/") ||
    p.startsWith("src/backend/nodes/") ||
    p.startsWith("src/backend/rewrite/") ||
    p.startsWith("src/include/parser/") ||
    p.startsWith("src/include/nodes/")
  ) {
    return "Parser & SQL";
  }
  if (p.startsWith("src/backend/utils/adt/")) return "Types & Builtins";
  if (
    p.startsWith("src/port/") ||
    p.startsWith("config/") ||
    p.includes("meson.build") ||
    p.includes("makefile") ||
    p.startsWith("configure")
  ) {
    return "Build & Portability";
  }
  return "Postmaster & Core";
}

export function classifyPgMajor(isoDate: string): string {
  const d = isoDate.slice(0, 10);
  if (d >= "2026-06-25") return "PG20";
  if (d >= "2025-06-25") return "PG19";
  if (d >= "2024-06-25") return "PG18";
  if (d >= "2023-06-25") return "PG17";
  if (d >= "2022-06-25") return "PG16";
  if (d >= "2021-06-25") return "PG15";
  if (d >= "2020-06-25") return "PG14";
  if (d >= "2019-06-25") return "PG13";
  if (d >= "2018-06-25") return "PG12";
  if (d >= "2017-06-25") return "PG11";
  if (d >= "2016-06-25") return "PG10";
  return "PG<=9.6";
}

export function parseCommitTrailers(body: string): {
  trailers: Array<{ kind: CreditKind; person: ParsedPersonRef }>;
  discussionUrls: string[];
  isBackpatch: boolean;
} {
  const trailers: Array<{ kind: CreditKind; person: ParsedPersonRef }> = [];
  const discussionUrls: string[] = [];
  let isBackpatch = false;

  const lines = body.split(/\r?\n/);
  const trailerMap: Array<{ re: RegExp; kind: CreditKind }> = [
    { re: /^Author:\s*(.+)$/i, kind: "author" },
    { re: /^Co-authored-by:\s*(.+)$/i, kind: "co_author" },
    { re: /^Reviewed-by:\s*(.+)$/i, kind: "reviewer" },
    { re: /^Reported-by:\s*(.+)$/i, kind: "reporter" },
    { re: /^Suggested-by:\s*(.+)$/i, kind: "suggester" },
    { re: /^Tested-by:\s*(.+)$/i, kind: "tester" },
    { re: /^Analyzed-by:\s*(.+)$/i, kind: "analyzer" },
    { re: /^Diagnosed-by:\s*(.+)$/i, kind: "analyzer" },
  ];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Backpatch-through:/i.test(line) || /\bback-?patch(?:ed|ing)?\s+to\b/i.test(line)) {
      isBackpatch = true;
    }
    const discMatch = line.match(/^Discussion:\s*(\S+)/i);
    if (discMatch?.[1]) {
      const safe = safeHttpUrl(discMatch[1]);
      if (safe) discussionUrls.push(safe);
      continue;
    }
    for (const tm of trailerMap) {
      const m = line.match(tm.re);
      if (m?.[1]) {
        for (const p of splitTrailerPeople(m[1])) {
          trailers.push({ kind: tm.kind, person: p });
        }
        break;
      }
    }
  }
  return { trailers, discussionUrls, isBackpatch };
}

export interface ContributorRoleSeed {
  name: string;
  normalizedName: string;
  role: PgRole;
  company: string;
  email?: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseContributorsHtml(html: string): ContributorRoleSeed[] {
  const seeds: ContributorRoleSeed[] = [];
  const roleForHeading = (headingText: string): PgRole | null => {
    const h = headingText.trim().toLowerCase();
    if (h === "core team") return "Core Team";
    if (h === "major contributors" || h === "past major contributors") return "Major Contributor";
    if (h === "significant contributors") return "Significant Contributor";
    return null;
  };

  // Split by ALL <h2> headings so sections never bleed into later headings (e.g. Past Contributors)
  const h2Matches: Array<{ idx: number; end: number; title: string }> = [];
  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = h2Re.exec(html)) !== null) {
    const title = decodeHtmlEntities(hm[1]!.replace(/<[^>]+>/g, " "));
    h2Matches.push({ idx: hm.index, end: hm.index + hm[0].length, title });
  }

  const pushCellPerson = (rawCellHtml: string, role: PgRole, explicitCompany = "") => {
    // Live postgresql.org Core Team / Major Contributors cells separate Name+Email, Company, Location with <br/>
    const brParts = rawCellHtml.split(/<br\s*\/?>/i);
    const firstLine = decodeHtmlEntities(brParts[0]!.replace(/<[^>]+>/g, " "));
    const parsed = parsePersonRef(firstLine);
    if (!parsed) return;
    if (parsed.normalizedName.split(/\s+/).length < 2 || INVALID_PERSON_RE.test(parsed.normalizedName)) return;

    let company = explicitCompany;
    if (!company && brParts.length >= 2) {
      const seg1Html = brParts[1] || "";
      const seg1Text = decodeHtmlEntities(seg1Html.replace(/<[^>]+>/g, " "));
      // Company line either has an <a href=...> link OR is followed by a 3rd <br/> location line
      if (seg1Text && seg1Text !== "-" && (/<a\b/i.test(seg1Html) || brParts.length >= 3)) {
        company = seg1Text;
      }
    }
    seeds.push({
      name: parsed.name,
      normalizedName: parsed.normalizedName,
      role,
      company: company === "-" ? "" : company,
      email: parsed.email || undefined,
    });
  };

  for (let i = 0; i < h2Matches.length; i++) {
    const role = roleForHeading(h2Matches[i]!.title);
    if (!role) continue;
    const start = h2Matches[i]!.end;
    const end = i + 1 < h2Matches.length ? h2Matches[i + 1]!.idx : html.length;
    const slice = html.slice(start, end);

    const hasContribBioHeader = /<th[^>]*>\s*Contributor\s*<\/th>/i.test(slice);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(slice)) !== null) {
      const rawCells = Array.from(rm[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]!);
      if (rawCells.length === 0) continue;

      if (hasContribBioHeader) {
        // 2-column table: <td>Name (email)<br/>Company<br/>Location</td><td>Bio paragraph</td>
        pushCellPerson(rawCells[0]!, role);
      } else if (
        rawCells.length >= 3 &&
        !/<br\s*\/?>/i.test(rawCells[0]!) &&
        !/\bat\s+[a-z0-9.-]+\.[a-z]{2,}/i.test(rawCells[1]!) &&
        !/\/community\/people\//i.test(rawCells[1]!)
      ) {
        // Legacy 3-column table layout: <td>Name</td><td>Company</td><td>Contribution</td>
        const company = decodeHtmlEntities(rawCells[1]!.replace(/<[^>]+>/g, " "));
        pushCellPerson(rawCells[0]!, role, company);
      } else {
        // Multi-column contributor grid (e.g. Significant Contributors: 2 people per row!)
        for (const cellHtml of rawCells) {
          pushCellPerson(cellHtml, role);
        }
      }
    }
  }
  return seeds;
}

/**
 * Multi-Email Identity Resolution Engine using Disjoint-Set (Union-Find).
 * Unifies multiple email addresses, name spellings, diacritics, and `.mailmap` aliases
 * into a single canonical person record.
 */
export class IdentityResolver {
  private parent: number[] = [];
  private emailToNode = new Map<string, number>();
  private normNameToNode = new Map<string, number>();

  private nodeNames = new Map<number, Map<string, number>>();
  private nodeEmails = new Map<number, Set<string>>();
  private nodeDomains = new Map<number, Set<string>>();
  private nodeAffiliations = new Map<number, Set<string>>();
  private nodeIdentities = new Map<number, Map<string, { email: string; domain: string; displayName: string; normalizedName: string; source: string }>>();
  private nodePreferredName = new Map<number, string>();
  private nodeRole = new Map<number, PgRole>();

  private find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r]!;
    let cur = x;
    while (this.parent[cur] !== r) {
      const nxt = this.parent[cur]!;
      this.parent[cur] = r;
      cur = nxt;
    }
    return r;
  }

  private createNode(): number {
    const id = this.parent.length;
    this.parent.push(id);
    this.nodeNames.set(id, new Map());
    this.nodeEmails.set(id, new Set());
    this.nodeDomains.set(id, new Set());
    this.nodeAffiliations.set(id, new Set());
    this.nodeIdentities.set(id, new Map());
    return id;
  }

  private union(a: number, b: number): number {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    this.parent[rb] = ra;

    for (const [k, cnt] of this.nodeNames.get(rb) || []) {
      const m = this.nodeNames.get(ra)!;
      m.set(k, (m.get(k) || 0) + cnt);
    }
    for (const e of this.nodeEmails.get(rb) || []) this.nodeEmails.get(ra)!.add(e);
    for (const d of this.nodeDomains.get(rb) || []) this.nodeDomains.get(ra)!.add(d);
    for (const aff of this.nodeAffiliations.get(rb) || []) this.nodeAffiliations.get(ra)!.add(aff);
    for (const [ik, iv] of this.nodeIdentities.get(rb) || []) {
      if (!this.nodeIdentities.get(ra)!.has(ik)) this.nodeIdentities.get(ra)!.set(ik, iv);
    }
    if (!this.nodePreferredName.has(ra) && this.nodePreferredName.has(rb)) {
      this.nodePreferredName.set(ra, this.nodePreferredName.get(rb)!);
    }
    const roleRank = (r?: PgRole) =>
      r === "Core Team" ? 5 : r === "Committer" ? 4 : r === "Major Contributor" ? 3 : r === "Significant Contributor" ? 2 : 1;
    if (roleRank(this.nodeRole.get(rb)) > roleRank(this.nodeRole.get(ra))) {
      this.nodeRole.set(ra, this.nodeRole.get(rb)!);
    }
    return ra;
  }

  addMailmapFile(mailmapContent: string): void {
    for (const rawLine of mailmapContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      // Format: Proper Name <proper@email> [Alias Name] [<alias@email>]
      const emails = Array.from(line.matchAll(/<([^>\s]+@[^>\s]+)>/g)).map((m) => m[1]!.trim().toLowerCase());
      const firstEmailIdx = line.indexOf("<");
      const properName = firstEmailIdx > 0 ? line.slice(0, firstEmailIdx).trim() : "";
      const ref = parsePersonRef(properName && emails[0] ? `${properName} <${emails[0]}>` : line);
      if (!ref) continue;
      const root = this.observe(ref, "git_mailmap", true);
      if (properName) this.nodePreferredName.set(root, properName);
      for (const extraEmail of emails.slice(1)) {
        const aliasRef: ParsedPersonRef = {
          name: properName || ref.name,
          normalizedName: ref.normalizedName,
          email: extraEmail,
          domain: extraEmail.split("@")[1] || "",
          affiliation: "",
        };
        const other = this.observe(aliasRef, "git_mailmap");
        this.union(root, other);
      }
    }
  }

  addContributorSeed(seed: ContributorRoleSeed): void {
    const email = (seed.email || "").trim().toLowerCase();
    const ref: ParsedPersonRef = {
      name: seed.name,
      normalizedName: seed.normalizedName,
      email,
      domain: email.includes("@") ? email.split("@")[1] || "" : "",
      affiliation: seed.company,
    };
    const root = this.observe(ref, "contributors_page", true);
    this.nodePreferredName.set(root, seed.name);
    const roleRank = (r?: PgRole) =>
      r === "Core Team" ? 5 : r === "Committer" ? 4 : r === "Major Contributor" ? 3 : r === "Significant Contributor" ? 2 : 1;
    if (roleRank(seed.role) > roleRank(this.nodeRole.get(root))) {
      this.nodeRole.set(root, seed.role);
    }
  }

  observe(ref: ParsedPersonRef, source: string, preferDisplayName = false): number {
    const norm = ref.normalizedName;
    const email = ref.email && !ref.email.includes("noreply") ? ref.email : "";
    const isMultiWordName = norm.split(/\s+/).length >= 2;

    let emailNode = email ? this.emailToNode.get(email) : undefined;
    let nameNode = isMultiWordName ? this.normNameToNode.get(norm) : undefined;

    // Also try known handle alias from email local-part for @postgresql.org
    if (nameNode === undefined && email.endsWith("@postgresql.org")) {
      const local = email.split("@")[0] || "";
      const mapped = KNOWN_PG_HANDLES[local];
      if (mapped) nameNode = this.normNameToNode.get(mapped);
    }

    let root: number;
    if (emailNode !== undefined && nameNode !== undefined) {
      root = this.union(emailNode, nameNode);
    } else if (emailNode !== undefined) {
      root = this.find(emailNode);
    } else if (nameNode !== undefined) {
      root = this.find(nameNode);
    } else {
      root = this.createNode();
    }

    if (email) this.emailToNode.set(email, root);
    if (isMultiWordName) this.normNameToNode.set(norm, root);

    const namesMap = this.nodeNames.get(root)!;
    namesMap.set(ref.name, (namesMap.get(ref.name) || 0) + 1);
    if (preferDisplayName) this.nodePreferredName.set(root, ref.name);

    if (email) {
      this.nodeEmails.get(root)!.add(email);
      if (ref.domain) this.nodeDomains.get(root)!.add(ref.domain);
    }
    if (ref.affiliation) {
      this.nodeAffiliations.get(root)!.add(ref.affiliation);
    }
    const idKey = `${email}|${ref.name}`;
    if (!this.nodeIdentities.get(root)!.has(idKey)) {
      this.nodeIdentities.get(root)!.set(idKey, {
        email,
        domain: ref.domain,
        displayName: ref.name,
        normalizedName: norm,
        source,
      });
    }
    return root;
  }

  resolveRoot(ref: ParsedPersonRef): number {
    return this.find(this.observe(ref, "lookup"));
  }

  /**
   * Post-pass consolidation across the entire contributor graph:
   * 1) Non-generic shared email local-parts (e.g. x4mmm@yandex-team.ru + x4mmm@gmail.com)
   * 2) Middle-initial / middle-name stripping (David G. Rowley <-> David Rowley)
   * 3) Safe first-name transliteration/nickname variants sharing a rare surname (Andrey Borodin <-> Andrew Borodin)
   * 4) Unambiguous single-word handle resolution (wolakk <-> Kirk Wolak, drowley <-> David Rowley)
   */
  private consolidate(): void {
    const GENERIC_LOCALS = new Set([
      "admin", "info", "mail", "dev", "test", "root", "user", "postgres", "pgsql", "hello", "contact", "support",
      "david", "peter", "michael", "andrew", "alex", "robert", "thomas", "james", "john", "daniel", "chris",
      "mark", "paul", "kevin", "brian", "steve", "jason", "martin", "kevin", "richard", "eric", "scott", "ryan",
    ]);
    const COMMON_SURNAMES = new Set([
      "li", "wang", "chen", "zhang", "liu", "yang", "huang", "wu", "zhou", "xu", "sun", "ma", "zhu", "hu", "lin",
      "kim", "lee", "park", "choi", "jung", "smith", "johnson", "williams", "brown", "jones", "miller", "davis",
      "garcia", "rodriguez", "wilson", "martinez", "anderson", "taylor", "thomas", "moore", "jackson", "martin",
      "white", "harris", "clark", "lewis", "robinson", "walker", "young", "allen", "king", "wright", "scott",
      "kumar", "sharma", "singh", "patel", "gupta", "tanaka", "suzuki", "sato", "watanabe", "takahashi", "ito",
    ]);
    const FIRST_CANON: Record<string, string> = {
      andrey: "andrew", andrei: "andrew", andrew: "andrew", andy: "andrew",
      alexander: "alexander", aleksander: "alexander", aleksandr: "alexander", alex: "alexander", sasha: "alexander",
      nikolay: "nicholas", nikolai: "nicholas", nicholas: "nicholas", nicolas: "nicholas", nick: "nicholas", nik: "nicholas",
      sergey: "sergey", sergei: "sergey",
      dmitry: "dmitry", dmitrii: "dmitry", dmitri: "dmitry",
      mikhail: "michael", michael: "michael", mike: "michael",
      evgeny: "eugene", evgenii: "eugene", evgeniy: "eugene", eugene: "eugene",
      yury: "yury", yuri: "yury", iurii: "yury", yurii: "yury",
      aleksey: "alexey", alexey: "alexey", aleksei: "alexey", alexei: "alexey",
      vyacheslav: "vyacheslav", viacheslav: "vyacheslav",
      vitaly: "vitaly", vitalii: "vitaly", vitaliy: "vitaly",
      maksim: "maxim", maxim: "maxim",
      viktor: "victor", victor: "victor",
      konstantin: "konstantin", constantine: "konstantin",
      pavel: "paul", paul: "paul",
      tom: "thomas", thomas: "thomas",
      dave: "david", david: "david",
      rob: "robert", bob: "robert", robert: "robert",
      pete: "peter", peter: "peter",
      steve: "stephen", stephen: "stephen", steven: "stephen",
      dan: "daniel", daniel: "daniel",
      jeff: "jeffrey", jeffrey: "jeffrey",
      greg: "gregory", gregory: "gregory",
      matt: "matthew", matthew: "matthew",
      chris: "christopher", christopher: "christopher",
      jon: "jonathan", jonathan: "jonathan",
      ben: "benjamin", benjamin: "benjamin",
      jim: "james", james: "james",
      bill: "william", will: "william", william: "william",
      ken: "kenneth", kenneth: "kenneth",
      ed: "edward", edward: "edward",
      tim: "timothy", timothy: "timothy",
      joe: "joseph", joseph: "joseph",
      josh: "joshua", joshua: "joshua",
      sam: "samuel", samuel: "samuel",
    };

    const getRoots = () => {
      const s = new Set<number>();
      for (let i = 0; i < this.parent.length; i++) s.add(this.find(i));
      return Array.from(s);
    };

    // Pass 1: Shared distinctive email local-part across domains (length >= 5)
    const localToRoots = new Map<string, Set<number>>();
    for (const r of getRoots()) {
      for (const em of this.nodeEmails.get(r) || []) {
        const local = (em.split("@")[0] || "").replace(/[+].*$/, "").trim();
        if (local.length >= 5 && !GENERIC_LOCALS.has(local) && !/^\d+$/.test(local)) {
          if (!localToRoots.has(local)) localToRoots.set(local, new Set());
          localToRoots.get(local)!.add(r);
        }
      }
    }
    for (const set of localToRoots.values()) {
      if (set.size >= 2 && set.size <= 4) {
        const arr = Array.from(set);
        for (let i = 1; i < arr.length; i++) this.union(arr[0]!, arr[i]!);
      }
    }

    // Build normalized name profiles per root
    const rootTokens = (r: number): string[][] => {
      const out: string[][] = [];
      for (const id of this.nodeIdentities.get(r)?.values() || []) {
        if (!id.normalizedName) continue;
        const toks = id.normalizedName.split(/\s+/).filter(Boolean);
        if (toks.length > 0) out.push(toks);
      }
      return out;
    };

    // Pass 2: Middle-initial / middle-name stripping + First-name transliteration/nickname merge
    const firstLastMap = new Map<string, Set<number>>();
    const canonFirstLastMap = new Map<string, Set<number>>();
    const surnameCount = new Map<string, Set<number>>();

    for (const r of getRoots()) {
      for (const toks of rootTokens(r)) {
        if (toks.length < 2) continue;
        const first = toks[0]!;
        const last = toks[toks.length - 1]!;
        if (first.length < 2 || last.length < 3) continue;
        if (!surnameCount.has(last)) surnameCount.set(last, new Set());
        surnameCount.get(last)!.add(r);

        // Exact first + last (collapses "David G. Rowley" -> "david rowley")
        if (toks.length >= 2 && !COMMON_SURNAMES.has(last)) {
          const flKey = `${first}|${last}`;
          if (!firstLastMap.has(flKey)) firstLastMap.set(flKey, new Set());
          firstLastMap.get(flKey)!.add(r);
        }
        // Canonical first + last (collapses "Andrey Borodin" <-> "Andrew Borodin")
        if (last.length >= 5 && !COMMON_SURNAMES.has(last)) {
          const cf = FIRST_CANON[first] || first;
          const cflKey = `${cf}|${last}`;
          if (!canonFirstLastMap.has(cflKey)) canonFirstLastMap.set(cflKey, new Set());
          canonFirstLastMap.get(cflKey)!.add(r);
        }
      }
    }
    for (const set of firstLastMap.values()) {
      if (set.size >= 2 && set.size <= 3) {
        const arr = Array.from(set);
        for (let i = 1; i < arr.length; i++) this.union(arr[0]!, arr[i]!);
      }
    }
    for (const [key, set] of canonFirstLastMap.entries()) {
      const last = key.split("|")[1] || "";
      const totalWithSurname = surnameCount.get(last)?.size ?? 0;
      // Only merge transliteration variants when <= 3 nodes share that surname in the whole Postgres corpus
      if (set.size >= 2 && totalWithSurname <= 3) {
        const arr = Array.from(set);
        for (let i = 1; i < arr.length; i++) this.union(arr[0]!, arr[i]!);
      }
    }

    // Pass 3: Unambiguous single-word handle resolution (e.g. "wolakk" -> "Kirk Wolak")
    const handleCandidates = new Map<string, Set<number>>();
    const addHandleKey = (h: string, r: number) => {
      if (h.length < 4) return;
      if (!handleCandidates.has(h)) handleCandidates.set(h, new Set());
      handleCandidates.get(h)!.add(r);
    };

    const currentRoots = getRoots();
    const singleTokenRoots: Array<{ root: number; handle: string }> = [];

    for (const r of currentRoots) {
      const toksList = rootTokens(r);
      const hasMulti = toksList.some((t) => t.length >= 2);
      if (hasMulti) {
        for (const toks of toksList) {
          if (toks.length < 2) continue;
          const first = toks[0]!.replace(/[^a-z0-9]/g, "");
          const last = toks[toks.length - 1]!.replace(/[^a-z0-9]/g, "");
          if (first.length < 2 || last.length < 3) continue;
          addHandleKey(`${first[0]}${last}`, r);       // drowley
          addHandleKey(`${last}${first[0]}`, r);       // wolakk
          addHandleKey(`${first}${last[0]}`, r);       // kirkw
          addHandleKey(`${first}${last}`, r);          // kirkwolak
          if (last.length >= 6 && !COMMON_SURNAMES.has(last)) {
            addHandleKey(last, r);                     // unique long surname
          }
        }
        // Also index their existing email local-parts as handle keys
        for (const em of this.nodeEmails.get(r) || []) {
          const local = (em.split("@")[0] || "").replace(/[^a-z0-9]/g, "");
          if (local.length >= 4 && !GENERIC_LOCALS.has(local)) addHandleKey(local, r);
        }
      } else {
        // Single-word handle node
        for (const toks of toksList) {
          if (toks.length === 1) {
            const h = toks[0]!.replace(/[^a-z0-9]/g, "");
            if (h.length >= 4) singleTokenRoots.push({ root: r, handle: h });
          }
        }
      }
    }

    for (const item of singleTokenRoots) {
      const mapped = KNOWN_PG_HANDLES[item.handle];
      if (mapped) {
        const target = this.normNameToNode.get(mapped);
        if (target !== undefined) {
          this.union(target, item.root);
          continue;
        }
      }
      const matches = handleCandidates.get(item.handle);
      if (matches && matches.size === 1) {
        const target = Array.from(matches)[0]!;
        this.union(target, item.root);
      }
    }
  }

  materialize(): {
    rootToIndex: Map<number, number>;
    people: Array<{
      slug: string;
      canonicalName: string;
      pgRole: PgRole;
      affiliations: string[];
      emailDomains: string[];
      emailCount: number;
      identities: Array<{ email: string; domain: string; displayName: string; normalizedName: string; source: string }>;
    }>;
  } {
    this.consolidate();
    const roots = new Set<number>();
    for (let i = 0; i < this.parent.length; i++) roots.add(this.find(i));

    const usedSlugs = new Set<string>();
    const rootToIndex = new Map<number, number>();
    const people: Array<{
      slug: string;
      canonicalName: string;
      pgRole: PgRole;
      affiliations: string[];
      emailDomains: string[];
      emailCount: number;
      identities: Array<{ email: string; domain: string; displayName: string; normalizedName: string; source: string }>;
    }> = [];

    for (const r of roots) {
      const preferred = this.nodePreferredName.get(r);
      const nameEntries = Array.from(this.nodeNames.get(r)?.entries() || []);
      // Pick best display name: preferred > mixed-case multi-word with highest frequency
      nameEntries.sort((a, b) => {
        const aGood = /[A-Z]/.test(a[0]) && a[0].includes(" ") ? 1 : 0;
        const bGood = /[A-Z]/.test(b[0]) && b[0].includes(" ") ? 1 : 0;
        if (bGood !== aGood) return bGood - aGood;
        return b[1] - a[1];
      });
      const canonicalName = preferred || nameEntries[0]?.[0] || "Contributor";
      const baseSlug = slugifyPerson(canonicalName);
      let slug = baseSlug;
      let suffix = 2;
      while (usedSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix++}`;
      }
      usedSlugs.add(slug);

      const domains = Array.from(this.nodeDomains.get(r) || []).sort((a, b) => {
        const aGen = GENERIC_EMAIL_DOMAINS.has(a) ? 1 : 0;
        const bGen = GENERIC_EMAIL_DOMAINS.has(b) ? 1 : 0;
        if (aGen !== bGen) return aGen - bGen;
        return a.localeCompare(b);
      });

      const idx = people.length;
      rootToIndex.set(r, idx);
      people.push({
        slug,
        canonicalName,
        pgRole: this.nodeRole.get(r) || "Contributor",
        affiliations: Array.from(this.nodeAffiliations.get(r) || []).slice(0, 6),
        emailDomains: domains.slice(0, 10),
        emailCount: this.nodeEmails.get(r)?.size || 0,
        identities: Array.from(this.nodeIdentities.get(r)?.values() || []),
      });
    }

    return { rootToIndex, people };
  }
}

export async function readPostgresGitLog(
  repoPath: string,
  opts?: { ref?: string; since?: string; maxCount?: number },
): Promise<ParsedCommit[]> {
  const ref = opts?.ref || "HEAD";
  const args = [
    "-C",
    repoPath,
    "log",
    "--first-parent",
    ref,
    "--numstat",
    "--format=\x1e%H\x1f%aI\x1f%cI\x1f%an\x1f%ae\x1f%cn\x1f%ce\x1f%s\x1f%b\x1d",
  ];
  if (opts?.since) args.push(`--since=${opts.since}`);
  if (opts?.maxCount && opts.maxCount > 0) args.push(`-n`, String(opts.maxCount));

  const proc = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
  const commits: ParsedCommit[] = [];
  let buf = "";
  let stderr = "";

  const processRecord = (chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return;
    const endBodyIdx = trimmed.indexOf("\x1d");
    if (endBodyIdx === -1) return;
    const headerPart = trimmed.slice(0, endBodyIdx);
    const numstatPart = trimmed.slice(endBodyIdx + 1);
    const fields = headerPart.split("\x1f");
    if (fields.length < 9) return;

    const sha = fields[0]!.trim();
    const authoredAt = fields[1]!.trim();
    const committedAt = fields[2]!.trim();
    const an = fields[3]!.trim();
    const ae = fields[4]!.trim();
    const cn = fields[5]!.trim();
    const ce = fields[6]!.trim();
    const subject = fields[7]!.trim();
    const body = fields.slice(8).join("\x1f");

    const gitAuthor = parsePersonRef(`${an} <${ae}>`) || {
      name: an || "Unknown",
      normalizedName: normalizePersonName(an || "unknown") || "unknown",
      email: ae.toLowerCase(),
      domain: ae.includes("@") ? ae.split("@")[1]!.toLowerCase() : "",
      affiliation: "",
    };
    const gitCommitter = parsePersonRef(`${cn} <${ce}>`) || gitAuthor;

    const { trailers, discussionUrls, isBackpatch } = parseCommitTrailers(body);
    const isRevert = /^revert\b/i.test(subject);

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    const subsysCounts = new Map<string, number>();

    for (const line of numstatPart.split(/\r?\n/)) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      filesChanged++;
      const ins = m[1] === "-" ? 0 : Number(m[1]);
      const del = m[2] === "-" ? 0 : Number(m[2]);
      insertions += ins;
      deletions += del;
      const sub = classifySubsystem(m[3]!);
      subsysCounts.set(sub, (subsysCounts.get(sub) || 0) + Math.max(1, ins + del));
    }

    const rankedSubsys = Array.from(subsysCounts.entries()).sort((a, b) => b[1] - a[1]);
    const primarySubsystem = rankedSubsys[0]?.[0] || "Postmaster & Core";
    const subsystems = rankedSubsys.slice(0, 4).map(([s]) => s);

    commits.push({
      sha,
      authoredAt,
      committedAt,
      subject,
      gitAuthor,
      gitCommitter,
      trailers,
      discussionUrls,
      isRevert,
      isBackpatch,
      filesChanged,
      insertions,
      deletions,
      primarySubsystem,
      subsystems,
      pgMajor: classifyPgMajor(committedAt),
    });
  };

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (d: string) => {
    buf += d;
    let idx = buf.indexOf("\x1e");
    while (idx !== -1) {
      const nextIdx = buf.indexOf("\x1e", idx + 1);
      if (nextIdx === -1) break;
      processRecord(buf.slice(idx + 1, nextIdx));
      buf = buf.slice(nextIdx);
      idx = 0;
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (d: string) => {
    stderr += d;
  });

  await new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (buf.startsWith("\x1e")) processRecord(buf.slice(1));
      if (code !== 0) reject(new Error(`git log failed (exit ${code}): ${stderr.slice(0, 300)}`));
      else resolve();
    });
  });

  return commits;
}

export async function syncHackersToDb(
  db: WebDatabase,
  opts: {
    repoPath: string;
    ref?: string;
    since?: string;
    maxCount?: number;
    fetchContributors?: boolean;
    log?: (msg: string) => void;
  },
): Promise<{
  commitsCount: number;
  peopleCount: number;
  identitiesCount: number;
  multiEmailPeople: number;
  creditsCount: number;
}> {
  const log = opts.log ?? ((m: string) => console.log(`[hackers-sync] ${m}`));
  const resolver = new IdentityResolver();

  // 1. Load .mailmap from repo if present
  const mailmapPath = join(opts.repoPath, ".mailmap");
  if (existsSync(mailmapPath)) {
    resolver.addMailmapFile(readFileSync(mailmapPath, "utf8"));
  }

  // 2. Fetch official Recognized Contributors page (Core Team, Major, Significant)
  if (opts.fetchContributors !== false) {
    try {
      const res = await fetch("https://www.postgresql.org/community/contributors/", {
        headers: { "User-Agent": "pgroast-web/0.3 (+https://github.com/NikolayS/pgroast)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const html = await res.text();
        const seeds = parseContributorsHtml(html);
        for (const s of seeds) resolver.addContributorSeed(s);
        log(`Loaded ${seeds.length} recognized contributors from postgresql.org`);
      }
    } catch (err) {
      log(`Skipped postgresql.org contributors fetch (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // 3. Stream git log from local postgres.git
  log(`Reading git log from ${opts.repoPath} (${opts.ref || "HEAD"})…`);
  const commits = await readPostgresGitLog(opts.repoPath, {
    ref: opts.ref,
    since: opts.since,
    maxCount: opts.maxCount,
  });
  log(`Parsed ${commits.length} commits; resolving multi-email identities…`);

  // 4. First pass: observe all git committers/authors/trailers into Union-Find
  const committerRoots = new Set<number>();
  for (const c of commits) {
    const cRoot = resolver.observe(c.gitCommitter, "git_committer");
    committerRoots.add(cRoot);
    resolver.observe(c.gitAuthor, "git_author");
    for (const t of c.trailers) {
      resolver.observe(t.person, "git_trailer");
    }
  }

  // Also observe CommitFest public_entries names so people without git commits yet can still resolve!
  const cfEntries = await db.listEntries({ limit: 1000 });
  const cfNameMap = new Map<string, { authored: number; reviewed: number; committed: number }>();
  const bumpCf = (rawList: string, field: "authored" | "reviewed" | "committed") => {
    for (const part of (rawList || "").split(/,\s*/)) {
      const ref = parsePersonRef(part);
      if (!ref) continue;
      resolver.observe(ref, "commitfest");
      const cur = cfNameMap.get(ref.normalizedName) || { authored: 0, reviewed: 0, committed: 0 };
      cur[field]++;
      cfNameMap.set(ref.normalizedName, cur);
    }
  };
  for (const e of cfEntries) {
    bumpCf(e.authors, "authored");
    bumpCf(e.reviewers, "reviewed");
    bumpCf(e.committer, "committed");
  }

  // 5. Materialize unified people
  const { rootToIndex, people } = resolver.materialize();

  // Promote anyone who committed >= 5 commits to Committer (unless already Core Team)
  const committerCounts = new Map<number, number>();
  for (const c of commits) {
    const idx = rootToIndex.get(resolver.resolveRoot(c.gitCommitter));
    if (idx !== undefined) committerCounts.set(idx, (committerCounts.get(idx) || 0) + 1);
  }
  for (const [idx, cnt] of committerCounts) {
    const p = people[idx]!;
    if (cnt >= 5 && p.pgRole !== "Core Team") {
      p.pgRole = "Committer";
    }
  }

  // 6. Compute per-person rollups & normalized credits
  interface PersonAcc {
    firstSeen: string;
    lastSeen: string;
    authored: number;
    committed: number;
    committedForOthers: number;
    reviews: number;
    bugs: number;
    suggestions: number;
    tests: number;
    cfAuthored: number;
    cfReviewed: number;
    cfCommitted: number;
    subsystems: Map<string, number>;
  }
  const accs: PersonAcc[] = people.map(() => ({
    firstSeen: "",
    lastSeen: "",
    authored: 0,
    committed: 0,
    committedForOthers: 0,
    reviews: 0,
    bugs: 0,
    suggestions: 0,
    tests: 0,
    cfAuthored: 0,
    cfReviewed: 0,
    cfCommitted: 0,
    subsystems: new Map(),
  }));

  const touchDate = (acc: PersonAcc, iso: string) => {
    if (!iso) return;
    if (!acc.firstSeen || iso < acc.firstSeen) acc.firstSeen = iso;
    if (!acc.lastSeen || iso > acc.lastSeen) acc.lastSeen = iso;
  };

  // Apply CommitFest counts
  for (const e of cfEntries) {
    const apply = (rawList: string, field: "cfAuthored" | "cfReviewed" | "cfCommitted") => {
      for (const part of (rawList || "").split(/,\s*/)) {
        const ref = parsePersonRef(part);
        if (!ref) continue;
        const idx = rootToIndex.get(resolver.resolveRoot(ref));
        if (idx !== undefined) accs[idx]![field]++;
      }
    };
    apply(e.authors, "cfAuthored");
    apply(e.reviewers, "cfReviewed");
    apply(e.committer, "cfCommitted");
  }

  const commitRows: Array<{
    sha: string;
    committedAt: string;
    authoredAt: string;
    subject: string;
    authorIdx: number;
    committerIdx: number;
    isRevert: boolean;
    isBackpatch: boolean;
    primarySubsystem: string;
    subsystemsJson: string;
    discussionUrlsJson: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    pgMajor: string;
  }> = [];

  const creditRows: Array<{
    sha: string;
    personIdx: number;
    kind: CreditKind;
    committedAt: string;
    pgMajor: string;
    primarySubsystem: string;
  }> = [];

  for (const c of commits) {
    const committerIdx = rootToIndex.get(resolver.resolveRoot(c.gitCommitter))!;
    const trailerAuthors = c.trailers
      .filter((t) => t.kind === "author")
      .map((t) => rootToIndex.get(resolver.resolveRoot(t.person))!)
      .filter((x) => x !== undefined);
    const gitAuthorIdx = rootToIndex.get(resolver.resolveRoot(c.gitAuthor))!;
    const primaryAuthorIdx = trailerAuthors[0] ?? gitAuthorIdx;

    const seenCredits = new Set<string>();
    const addCredit = (personIdx: number, kind: CreditKind) => {
      const k = `${personIdx}:${kind}`;
      if (seenCredits.has(k)) return;
      seenCredits.add(k);
      creditRows.push({
        sha: c.sha,
        personIdx,
        kind,
        committedAt: c.committedAt,
        pgMajor: c.pgMajor,
        primarySubsystem: c.primarySubsystem,
      });
      const acc = accs[personIdx]!;
      touchDate(acc, c.committedAt);
      acc.subsystems.set(c.primarySubsystem, (acc.subsystems.get(c.primarySubsystem) || 0) + 1);
      if (kind === "author" || kind === "co_author") acc.authored++;
      else if (kind === "committer") acc.committed++;
      else if (kind === "reviewer") acc.reviews++;
      else if (kind === "reporter") acc.bugs++;
      else if (kind === "suggester") acc.suggestions++;
      else if (kind === "tester") acc.tests++;
    };

    addCredit(committerIdx, "committer");
    if (trailerAuthors.length > 0) {
      for (const aIdx of trailerAuthors) addCredit(aIdx, "author");
    } else {
      addCredit(gitAuthorIdx, "author");
    }

    // Track "committed for others" when no commit author is the committer
    const authorSet = new Set(trailerAuthors.length > 0 ? trailerAuthors : [gitAuthorIdx]);
    if (!authorSet.has(committerIdx)) {
      accs[committerIdx]!.committedForOthers++;
    }

    for (const t of c.trailers) {
      if (t.kind === "author") continue;
      const pIdx = rootToIndex.get(resolver.resolveRoot(t.person));
      if (pIdx !== undefined) addCredit(pIdx, t.kind);
    }

    commitRows.push({
      sha: c.sha,
      committedAt: c.committedAt,
      authoredAt: c.authoredAt,
      subject: c.subject.slice(0, 300),
      authorIdx: primaryAuthorIdx,
      committerIdx,
      isRevert: c.isRevert,
      isBackpatch: c.isBackpatch,
      primarySubsystem: c.primarySubsystem,
      subsystemsJson: JSON.stringify(c.subsystems),
      discussionUrlsJson: JSON.stringify(c.discussionUrls.slice(0, 4)),
      filesChanged: c.filesChanged,
      insertions: c.insertions,
      deletions: c.deletions,
      pgMajor: c.pgMajor,
    });
  }

  // 7. Write cleanly to PostgreSQL 19 inside fast batched SQL
  const now = new Date().toISOString();
  log(`Writing ${people.length} unified people, ${commitRows.length} commits, ${creditRows.length} credits to PostgreSQL…`);

  // Rebuild observatory tables without touching public_entries, opinions, briefs, OR mailing_list_messages!
  // (Never TRUNCATE people CASCADE because mailing_list_messages references people(id) with ON DELETE SET NULL.)
  await db.sql.unsafe(`UPDATE ${db.t("mailing_list_messages")} SET person_id = NULL WHERE person_id IS NOT NULL`);
  await db.sql.unsafe(`TRUNCATE ${db.t("commit_credits")}, ${db.t("pg_commits")}, ${db.t("person_identities")} RESTART IDENTITY`);
  await db.sql.unsafe(`DELETE FROM ${db.t("people")}`);

  // Batch-insert people and capture assigned DB IDs
  const indexToDbId = new Int32Array(people.length);
  const PEOPLE_BATCH = 250;
  for (let start = 0; start < people.length; start += PEOPLE_BATCH) {
    const slice = people.slice(start, start + PEOPLE_BATCH);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (let i = 0; i < slice.length; i++) {
      const idx = start + i;
      const p = slice[i]!;
      const acc = accs[idx]!;
      const topSubsys = Array.from(acc.subsystems.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));
      const base = params.length;
      params.push(
        p.slug,
        p.canonicalName,
        p.pgRole,
        JSON.stringify(p.affiliations),
        JSON.stringify(p.emailDomains),
        p.emailCount,
        acc.firstSeen,
        acc.lastSeen,
        acc.authored,
        acc.committed,
        acc.committedForOthers,
        acc.reviews,
        acc.bugs,
        acc.suggestions,
        acc.tests,
        acc.cfAuthored,
        acc.cfReviewed,
        acc.cfCommitted,
        JSON.stringify(topSubsys),
        now,
      );
      tuples.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20})`,
      );
    }
    const inserted = (await db.sql.unsafe(
      `INSERT INTO ${db.t("people")} (
        slug, canonical_name, pg_role, affiliations_json, email_domains_json, email_count,
        first_seen_at, last_seen_at, commits_authored, commits_committed, commits_committed_for_others,
        reviews_given, bugs_reported, suggestions_given, tests_given,
        cf_authored, cf_reviewed, cf_committed, subsystems_json, updated_at
      ) VALUES ${tuples.join(",")} RETURNING id, slug`,
      params,
    )) as Array<{ id: number; slug: string }>;
    const slugMap = new Map(inserted.map((r) => [r.slug, Number(r.id)]));
    for (let i = 0; i < slice.length; i++) {
      indexToDbId[start + i] = slugMap.get(slice[i]!.slug)!;
    }
  }

  // Batch-insert person_identities
  const allIdentities: Array<{
    personId: number;
    email: string;
    domain: string;
    displayName: string;
    normalizedName: string;
    source: string;
  }> = [];
  for (let i = 0; i < people.length; i++) {
    const pid = indexToDbId[i]!;
    for (const id of people[i]!.identities) {
      allIdentities.push({ personId: pid, ...id });
    }
  }
  const ID_BATCH = 500;
  for (let start = 0; start < allIdentities.length; start += ID_BATCH) {
    const slice = allIdentities.slice(start, start + ID_BATCH);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const row of slice) {
      const b = params.length;
      params.push(row.personId, row.email, row.domain, row.displayName, row.normalizedName, row.source);
      tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    }
    await db.sql.unsafe(
      `INSERT INTO ${db.t("person_identities")} (person_id, email_lower, email_domain, display_name, normalized_name, source)
       VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
      params,
    );
  }

  // Batch-insert pg_commits
  const COMMIT_BATCH = 400;
  for (let start = 0; start < commitRows.length; start += COMMIT_BATCH) {
    const slice = commitRows.slice(start, start + COMMIT_BATCH);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const c of slice) {
      const b = params.length;
      params.push(
        c.sha,
        c.committedAt,
        c.authoredAt,
        c.subject,
        indexToDbId[c.authorIdx]!,
        indexToDbId[c.committerIdx]!,
        c.isRevert,
        c.isBackpatch,
        c.primarySubsystem,
        c.subsystemsJson,
        c.discussionUrlsJson,
        c.filesChanged,
        c.insertions,
        c.deletions,
        c.pgMajor,
      );
      tuples.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15})`,
      );
    }
    await db.sql.unsafe(
      `INSERT INTO ${db.t("pg_commits")} (
        sha, committed_at, authored_at, subject, author_person_id, committer_person_id,
        is_revert, is_backpatch, primary_subsystem, subsystems_json, discussion_urls_json,
        files_changed, insertions, deletions, pg_major
      ) VALUES ${tuples.join(",")} ON CONFLICT (sha) DO NOTHING`,
      params,
    );
  }

  // Batch-insert commit_credits
  const CREDIT_BATCH = 800;
  for (let start = 0; start < creditRows.length; start += CREDIT_BATCH) {
    const slice = creditRows.slice(start, start + CREDIT_BATCH);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const cr of slice) {
      const b = params.length;
      params.push(cr.sha, indexToDbId[cr.personIdx]!, cr.kind, cr.committedAt, cr.pgMajor, cr.primarySubsystem);
      tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    }
    await db.sql.unsafe(
      `INSERT INTO ${db.t("commit_credits")} (commit_sha, person_id, credit_kind, committed_at, pg_major, primary_subsystem)
       VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
      params,
    );
  }

  // Re-link any archived mailing_list_messages against the newly unified people & person_identities
  await db.sql.unsafe(
    `UPDATE ${db.t("mailing_list_messages")} m
     SET person_id = COALESCE(
       (SELECT pi.person_id FROM ${db.t("person_identities")} pi
        WHERE pi.normalized_name = LOWER(TRIM(m.sender_name))
        LIMIT 1),
       (SELECT p.id FROM ${db.t("people")} p
        WHERE LOWER(p.canonical_name) = LOWER(TRIM(m.sender_name))
        LIMIT 1)
     )
     WHERE m.person_id IS NULL AND m.sender_name != ''`,
  );

  const multiEmailPeople = people.filter((p) => p.emailCount >= 2).length;
  const metaPairs: Array<[string, string]> = [
    ["last_git_sha", commitRows[0]?.sha || ""],
    ["last_commit_at", commitRows[0]?.committedAt || ""],
    ["last_synced_at", now],
    ["total_commits", String(commitRows.length)],
    ["total_people", String(people.length)],
    ["total_identities", String(allIdentities.length)],
    ["multi_email_people", String(multiEmailPeople)],
  ];
  for (const [k, v] of metaPairs) {
    await db.sql.unsafe(
      `INSERT INTO ${db.t("hacker_sync_state")} (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [k, v, now],
    );
  }

  log(
    `Done! ${commitRows.length} commits, ${people.length} people (${multiEmailPeople} with multiple emails unified), ${creditRows.length} credits.`,
  );
  return {
    commitsCount: commitRows.length,
    peopleCount: people.length,
    identitiesCount: allIdentities.length,
    multiEmailPeople,
    creditsCount: creditRows.length,
  };
}
