// CommitFest source: Rejected / Returned with feedback / Withdrawn patches.

import { fetchPage, fetchStats, isCached } from "./fetch.ts";
import {
  flatUrl, log, normTs, splitPeople, stripTags, touchPoints, unescapeHtml,
  type PrecedentRecord,
} from "./util.ts";

export const CF_BASE = "https://commitfest.postgresql.org";
export const CF_STATUSES: Record<number, string> = {
  6: "Rejected",
  7: "Returned with feedback",
  8: "Withdrawn",
};
const NEGATIVE = new Set(Object.values(CF_STATUSES).map((s) => s.toLowerCase()));

export interface CfInfo { id: number; name: string | null; state: string | null; start: string | null; end: string | null }

export function parseArchive(h: string): CfInfo[] {
  const out = new Map<number, CfInfo>();
  const re = /href="\/(\d+)\/">([^<]+)<\/a>\s*\(([^-)]+?)\s*-\s*(\d{4}-\d\d-\d\d)\s*\S\s*(\d{4}-\d\d-\d\d)\)/g;
  for (const m of h.matchAll(re)) {
    out.set(Number(m[1]), { id: Number(m[1]), name: m[2]!.trim(), state: m[3]!.trim(), start: m[4]!, end: m[5]! });
  }
  for (const m of h.matchAll(/href="\/(\d+)\/"/g)) {
    const id = Number(m[1]);
    if (!out.has(id)) out.set(id, { id, name: null, state: null, start: null, end: null });
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}

export interface CfListRow {
  id: number; title: string; status: string | null; tags: string[];
  authors: string; reviewers: string; committer: string; latestMail: string | null;
}

export function parseList(h: string): CfListRow[] {
  const rows: CfListRow[] = [];
  for (const m of h.matchAll(/<tr>\s*<td class="wrap-text patch-column">([\s\S]*?)<\/tr>/g)) {
    const body = m[1]!;
    const pm = /<a href="\/patch\/(\d+)\/">([\s\S]*?)<\/a>/.exec(body);
    if (!pm) continue;
    const st = /<span class="badge[^"]*">([^<]+)<\/span>/.exec(body);
    const tags = [...body.matchAll(/<span class="badge" style="[^"]*"(?: title="[^"]*")?>([^<]+)<\/span>/g)]
      .map((t) => unescapeHtml(t[1]!));
    const lm = /title="(\d{4}-\d\d-\d\d[ \d:]*)"/.exec(body);
    const wraps = [...body.matchAll(/<td class="wrap-text">([\s\S]*?)<\/td>/g)].map((w) => stripTags(w[1]!));
    rows.push({
      id: Number(pm[1]), title: stripTags(pm[2]!), status: st ? st[1]!.trim() : null, tags,
      authors: wraps[0] ?? "", reviewers: wraps[1] ?? "", committer: wraps[2] ?? "",
      latestMail: lm ? lm[1]!.trim() : null,
    });
  }
  return rows;
}

export interface CfThread { msgid: string; subject: string; firstAt: string | null; firstBy: string; latestAt: string | null }
export interface CfPatch {
  title: string; created: string | null;
  statuses: { cf: number; cfName: string; status: string }[]; // as listed (newest first)
  tags: string[]; targetVersion: string; authors: string; reviewers: string; committer: string;
  threads: CfThread[]; history: { when: string | null; who: string; what: string }[]; otherLinks: string[];
}

function fields(h: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of h.matchAll(/<th[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    if (!out.has(m[1]!.trim())) out.set(m[1]!.trim(), m[2]!);
  }
  return out;
}

export function parsePatch(h: string): CfPatch | null {
  if (!h.includes("<th>Title</th>")) return null;
  const f = fields(h);
  const statuses = [...(f.get("Status") ?? "").matchAll(
    /<a href="\/(\d+)\/">([^<]+)<\/a>[^:<]*:\s*<span class="badge[^"]*">([^<]+)<\/span>/g,
  )].map((m) => ({ cf: Number(m[1]), cfName: m[2]!.trim(), status: m[3]!.trim() }));
  const tags = [...(f.get("Tags") ?? "").matchAll(/<span class="badge"[^>]*>([^<]+)<\/span>/g)]
    .map((m) => unescapeHtml(m[1]!));
  const reviewers = (f.get("Reviewers") ?? "").replace(/<a class="btn[\s\S]*?<\/a>/g, "");
  const threads: CfThread[] = [];
  for (const dm of (f.get("Emails") ?? "").matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
    const a = /<a href="(https:\/\/www\.postgresql\.org\/message-id\/flat\/([^"]+))">([\s\S]*?)<\/a>/.exec(dm[1]!);
    if (!a) continue;
    const first = /First at <a[^>]*>([^<]+)<\/a> by ([^<]*?)(?:<br|$)/.exec(dm[2]!);
    const latest = /Latest at <a[^>]*>([^<]+)<\/a>/.exec(dm[2]!);
    threads.push({
      msgid: unescapeHtml(a[2]!),
      subject: stripTags(a[3]!),
      firstAt: first ? normTs(first[1]) : null,
      firstBy: first ? unescapeHtml(first[2]!).replace(/\s*<.*$/, "").trim() : "",
      latestAt: latest ? normTs(latest[1]) : null,
    });
  }
  const history: CfPatch["history"] = [];
  const hm = /<th>History<\/th>([\s\S]*?)<\/table>/.exec(h);
  if (hm) {
    for (const r of hm[1]!.matchAll(/<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
      history.push({ when: normTs(r[1]), who: stripTags(r[2]!), what: stripTags(r[3]!) });
    }
  }
  return {
    title: stripTags(f.get("Title") ?? ""),
    created: normTs(stripTags(f.get("Created") ?? "")),
    statuses, tags,
    targetVersion: stripTags(f.get("Target version") ?? ""),
    authors: stripTags(f.get("Authors") ?? f.get("Author") ?? ""),
    reviewers: stripTags(reviewers),
    committer: stripTags(f.get("Committer") ?? ""),
    threads, history,
    otherLinks: [...(f.get("Links") ?? "").matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => unescapeHtml(m[1]!)),
  };
}

/** Final status = status in the highest CF id (the site lists newest first). */
export function finalStatus(p: CfPatch): string | null {
  if (!p.statuses.length) return null;
  return p.statuses.reduce((a, b) => (b.cf > a.cf ? b : a)).status;
}

export function patchRecord(pid: number, p: CfPatch, final: string): PrecedentRecord {
  let close: string | null = null;
  for (const h of p.history) {
    const m = /^Closed in commitfest (\S+) with status: (.+)$/.exec(h.what);
    if (m && m[2]!.trim().toLowerCase() === final.toLowerCase() && h.when && (!close || h.when > close)) close = h.when;
  }
  const firsts = p.threads.map((t) => t.firstAt).filter((x): x is string => !!x).sort();
  const firstDate = firsts[0] ?? p.created;
  const subjects = p.threads.map((t) => t.subject).filter(Boolean);
  let summary = p.title;
  if (p.tags.length) summary += "\nTags: " + p.tags.join(", ");
  if (subjects.length) summary += "\nThreads: " + subjects.join("; ");
  const url = `${CF_BASE}/patch/${pid}/`;
  return {
    id: `cf:${pid}`, kind: "cf", rawRef: `patch/${pid}`,
    title: p.title, status: final, date: close, firstDate, url,
    threadUrls: [...new Set(p.threads.map((t) => flatUrl(t.msgid)))],
    authors: splitPeople(p.authors), reviewers: splitPeople(p.reviewers), objectors: [],
    tags: p.tags.join(", "), summary, objection: "",
    touchPoints: touchPoints([p.title, ...p.tags, ...subjects].join(" ")),
    otherLinks: p.otherLinks,
    provenance: {
      source: "commitfest patch page", cache_url: url, committer: p.committer,
      target_version: p.targetVersion, cf_history: p.statuses,
      decided_at: close, first_at: firstDate,
      date_source: close ? "history 'Closed in commitfest' line" : null,
    },
  };
}

function listOnlyRecord(pid: number, cf: number, row: CfListRow): PrecedentRecord {
  return {
    id: `cf:${pid}`, kind: "cf", rawRef: `patch/${pid}`,
    title: row.title, status: row.status ?? "", date: null, firstDate: null,
    url: `${CF_BASE}/patch/${pid}/`, threadUrls: [],
    authors: splitPeople(row.authors), reviewers: splitPeople(row.reviewers), objectors: [],
    tags: row.tags.join(", "),
    summary: row.title + (row.tags.length ? "\nTags: " + row.tags.join(", ") : ""),
    objection: "", touchPoints: touchPoints(row.title + " " + row.tags.join(" ")), otherLinks: [],
    provenance: { source: "commitfest list page only (patch page not fetched)", cache_url: `${CF_BASE}/${cf}/`, cf, latest_mail: row.latestMail },
  };
}

export async function crawlCommitfest(opts: { limit?: number; offline?: boolean }) {
  const arch = await fetchPage(CF_BASE + "/archive/", opts);
  if (!arch) throw new Error("cannot read CommitFest archive page");
  const cfs = parseArchive(arch);
  const order: number[] = [];
  const latestRow = new Map<number, { cf: number; row: CfListRow }>();
  const cov: Record<string, unknown> = { commitfests: `${cfs[0]?.id}..${cfs.at(-1)?.id} (${cfs.length})` };
  let listOk = 0;
  const listMissing: string[] = [];
  for (const st of [6, 7, 8]) { // Rejected first, then RwF, then Withdrawn
    for (const cf of cfs) {
      const url = `${CF_BASE}/${cf.id}/?status=${st}`;
      const h = await fetchPage(url, opts);
      if (h === null) { listMissing.push(url); continue; }
      listOk++;
      for (const row of parseList(h)) {
        if (row.status !== CF_STATUSES[st]) continue; // defensive
        if (!latestRow.has(row.id)) order.push(row.id);
        const prev = latestRow.get(row.id);
        if (!prev || cf.id > prev.cf) latestRow.set(row.id, { cf: cf.id, row });
      }
    }
  }
  Object.assign(cov, { list_pages_ok: listOk, list_pages_missing: listMissing, unique_patches_in_lists: order.length });
  log(`cf: ${listOk} list pages, ${order.length} unique patches`);
  const todo = opts.limit ? order.slice(0, opts.limit) : order;
  const recs: PrecedentRecord[] = [];
  const c = { patch_pages_ok: 0, patch_pages_missing: 0, patch_pages_unparsed: 0, dropped_final_not_negative: 0, list_only_rows: 0 };
  const finalElsewhere: Record<string, number> = {};
  let n = 0;
  for (const pid of todo) {
    n++;
    const url = `${CF_BASE}/patch/${pid}/`;
    const wasCached = isCached(url);
    const h = await fetchPage(url, opts);
    if (!wasCached && n % 100 === 0) log(`  patch pages: ${n}/${todo.length} ${JSON.stringify(fetchStats)}`);
    const lr = latestRow.get(pid)!;
    const p = h ? parsePatch(h) : null;
    if (!p) {
      if (h) { c.patch_pages_unparsed++; log(`  patch ${pid}: page did not parse`); } else c.patch_pages_missing++;
      c.list_only_rows++;
      recs.push(listOnlyRecord(pid, lr.cf, lr.row));
      continue;
    }
    c.patch_pages_ok++;
    const final = finalStatus(p) ?? lr.row.status ?? "";
    if (!NEGATIVE.has(final.toLowerCase())) {
      c.dropped_final_not_negative++;
      finalElsewhere[final] = (finalElsewhere[final] ?? 0) + 1;
      continue;
    }
    recs.push(patchRecord(pid, p, CF_STATUSES[[6, 7, 8].find((k) => CF_STATUSES[k]!.toLowerCase() === final.toLowerCase())!]!));
  }
  Object.assign(cov, c, { final_status_of_dropped: finalElsewhere, skipped_by_limit: order.length - todo.length });
  return { recs, cov, complete: !opts.limit && c.patch_pages_missing === 0 };
}
