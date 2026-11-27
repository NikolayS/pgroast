import { statfsSync } from "node:fs";
import type { WebDatabase } from "./db.ts";
import { normalizePersonName, parsePersonRef } from "./hackers.ts";

export interface ParsedListMessage {
  listName: string;
  messageId: string;
  threadKey: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  sentAt: string;
  hasAttachment: boolean;
  bodyExcerpt: string;
}

export const CORE_PG_LISTS = [
  "pgsql-hackers",
  "pgsql-bugs",
  "pgsql-committers",
  "pgsql-general",
  "pgsql-performance",
  "pgsql-admin",
  "pgsql-docs",
  "pgsql-announce",
  "pgsql-sql",
  "pgsql-novice",
  "pgsql-interfaces",
  "pgsql-jdbc",
  "pgsql-odbc",
  "pgsql-patches",
  "pgsql-advocacy",
  "pgsql-www",
  "pgsql-pkg-debian",
  "pgsql-pkg-yum",
  "pgsql-pkg-docker",
  "pgsql-translators",
  "pgsql-testers",
  "pgsql-perffarm",
  "pgsql-rrreviewers",
  "pgsql-jobs",
  "pgsql-chat",
];

export function classifyListCategory(name: string): string {
  if (/^pgsql-(?:hackers|committers|bugs|patches|docs|testers|perffarm|rrreviewers|cluster-hackers|gui-dev)/.test(name)) {
    return "development";
  }
  if (/^pgsql-(?:general|admin|performance|sql|novice|announce|interfaces|jdbc|odbc|php|ports|cygwin)/.test(name)) {
    return "users";
  }
  if (/^pgsql-pkg-/.test(name)) return "packaging";
  if (/^pgsql-(?:de|es|fr|in|it|iw|nl|pt|ru|tr|zh)-/.test(name)) return "regional";
  return "community";
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x1f4ce;/gi, "📎")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeThreadKey(subject: string): string {
  return subject
    .replace(/📎/g, " ")
    .replace(/^(?:\s*(?:re|fwd|fw)\s*:\s*)+/i, "")
    .replace(/^\s*\[(?:hackers|bugs|general|admin|patch[^\]]*|rfc|wip)\]\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 180);
}

export function parseMailingListsCatalog(html: string): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="\/list\/(pgsql-[a-z0-9-]+)\/"/gi)) {
    if (m[1]) seen.add(m[1].toLowerCase());
  }
  return Array.from(seen).sort();
}

export function formatPgSinceStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}`
  );
}

export function parseSincePageHtml(
  html: string,
  listName: string,
  fallbackDateYmd: string,
): { messages: ParsedListMessage[]; nextPath: string | null } {
  const messages: ParsedListMessage[] = [];
  let currentYmd = fallbackDateYmd;

  // Detect active date header on page (e.g. <h1>pgsql-hackers ... 2026-11-26</h1> or <h3>2026-11-26</h3>)
  const dateHeader = html.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (dateHeader?.[1]) currentYmd = dateHeader[1];

  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = tbodyMatch?.[1] || html;

  for (const rowMatch of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] || "";
    const rowDate = rowHtml.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (rowDate?.[1] && !rowHtml.includes("/message-id/")) {
      currentYmd = rowDate[1];
      continue;
    }

    const linkMatch = rowHtml.match(/<a[^>]+href="\/message-id\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch?.[1]) continue;

    let messageId = linkMatch[1].replace(/^flat\//i, "").replace(/\/$/, "");
    try {
      messageId = decodeURIComponent(messageId);
    } catch {
      // keep raw
    }
    const rawSubjHtml = linkMatch[2] || "";
    const hasAttachment = /&#x1f4ce;|📎|attachment/i.test(rawSubjHtml);
    const subject = decodeHtmlEntities(rawSubjHtml.replace(/<[^>]+>/g, " ")).replace(/\s*📎\s*/g, " ").trim();

    const tds = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
      decodeHtmlEntities((m[1] || "").replace(/<[^>]+>/g, " ")),
    );
    const senderName = tds[0] || "";
    const timeText = tds[1] || "";

    let sentAt = `${currentYmd}T00:00:00Z`;
    const fullTs = timeText.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
    const hmOnly = timeText.match(/^(\d{2}:\d{2})(?::(\d{2}))?$/);
    if (fullTs) {
      sentAt = `${fullTs[1]}T${fullTs[2]}:${fullTs[3] || "00"}Z`;
    } else if (hmOnly) {
      sentAt = `${currentYmd}T${hmOnly[1]}:${hmOnly[2] || "00"}Z`;
    }

    messages.push({
      listName,
      messageId,
      threadKey: normalizeThreadKey(subject),
      subject,
      senderName,
      senderEmail: "",
      sentAt,
      hasAttachment,
      bodyExcerpt: "",
    });
  }

  const nextMatch = html.match(/<a[^>]+href="(\/list\/[^"]+\/since\/\d+\/?)"[^>]*>\s*Next\s*<\/a>/i);
  return { messages, nextPath: nextMatch?.[1] || null };
}

/**
 * Parses an mbox stream chunk-by-chunk (no full-file memory blowup, zero temp files on disk)
 * and invokes `onMessage` for each parsed RFC 2822 message.
 */
export function parseMboxText(mboxText: string, listName: string): ParsedListMessage[] {
  const out: ParsedListMessage[] = [];
  const rawMsgs = mboxText.split(/\r?\n(?=From \S+ )/);
  for (const raw of rawMsgs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const sepIdx = trimmed.search(/\r?\n\r?\n/);
    const headerBlock = sepIdx >= 0 ? trimmed.slice(0, sepIdx) : trimmed;
    const bodyBlock = sepIdx >= 0 ? trimmed.slice(sepIdx + 2) : "";

    // Unfold RFC 2822 continuation lines
    const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
    const headers = new Map<string, string>();
    for (const line of unfolded.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const k = line.slice(0, colon).trim().toLowerCase();
      const v = line.slice(colon + 1).trim();
      if (!headers.has(k)) headers.set(k, v);
    }

    const rawMid = (headers.get("message-id") || "").replace(/^<|>$/g, "").trim();
    if (!rawMid) continue;
    const subject = (headers.get("subject") || "(no subject)").replace(/\s+/g, " ").trim();
    const fromRaw = headers.get("from") || "";
    const parsedSender = parsePersonRef(fromRaw);
    const dateRaw = headers.get("date") || "";
    const parsedDate = Date.parse(dateRaw);
    const sentAt = Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : new Date().toISOString();
    const ct = headers.get("content-type") || "";
    const hasAttachment = /multipart\/mixed|attachment|\.patch|\.diff/i.test(`${ct}\n${bodyBlock.slice(0, 600)}`);

    // Clean short excerpt (strip quoted lines & signatures, cap at 360 chars)
    const cleanExcerpt = bodyBlock
      .split(/\r?\n/)
      .filter((ln) => !ln.startsWith(">") && !/^--+\s*$/.test(ln) && !/^Content-/i.test(ln))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 360);

    out.push({
      listName,
      messageId: rawMid,
      threadKey: normalizeThreadKey(subject),
      subject,
      senderName: parsedSender?.name || fromRaw.replace(/<[^>]+>/g, "").trim() || "Unknown",
      senderEmail: parsedSender?.email || "",
      sentAt,
      hasAttachment,
      bodyExcerpt: cleanExcerpt,
    });
  }
  return out;
}

export function checkDiskFreeGb(path = "/"): number {
  try {
    const st = statfsSync(path);
    return Math.round(((Number(st.bavail) * Number(st.bsize)) / (1024 * 1024 * 1024)) * 10) / 10;
  } catch {
    return 999;
  }
}

async function loadPeopleLookup(db: WebDatabase): Promise<{
  byEmail: Map<string, number>;
  byNormName: Map<string, number>;
}> {
  const [idRows, peopleRows] = await Promise.all([
    db.sql.unsafe(
      `SELECT person_id, email_lower, normalized_name FROM ${db.t("person_identities")}`,
    ) as Promise<Array<{ person_id: number; email_lower: string; normalized_name: string }>>,
    db.sql.unsafe(
      `SELECT id, canonical_name FROM ${db.t("people")}`,
    ) as Promise<Array<{ id: number; canonical_name: string }>>,
  ]);
  const byEmail = new Map<string, number>();
  const byNormName = new Map<string, number>();
  for (const r of idRows) {
    if (r.email_lower) byEmail.set(r.email_lower, Number(r.person_id));
    if (r.normalized_name) byNormName.set(r.normalized_name, Number(r.person_id));
  }
  for (const p of peopleRows) {
    const norm = normalizePersonName(p.canonical_name);
    if (norm && !byNormName.has(norm)) byNormName.set(norm, Number(p.id));
  }
  return { byEmail, byNormName };
}

export async function upsertMailingListMessages(
  db: WebDatabase,
  listName: string,
  messages: ParsedListMessage[],
  lookup?: { byEmail: Map<string, number>; byNormName: Map<string, number> },
): Promise<{ inserted: number; linkedPeople: number }> {
  const lkp = lookup ?? (await loadPeopleLookup(db));
  let inserted = 0;
  let linkedPeople = 0;
  const nowIso = new Date().toISOString();

  // Deduplicate by messageId within this batch
  const dedup = new Map<string, ParsedListMessage>();
  for (const m of messages) {
    if (m.messageId) dedup.set(m.messageId, m);
  }
  const unique = Array.from(dedup.values());

  const CHUNK = 150;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const m of slice) {
      let personId: number | null = null;
      if (m.senderEmail && lkp.byEmail.has(m.senderEmail.toLowerCase())) {
        personId = lkp.byEmail.get(m.senderEmail.toLowerCase())!;
      } else {
        const norm = normalizePersonName(m.senderName);
        if (norm && lkp.byNormName.has(norm)) {
          personId = lkp.byNormName.get(norm)!;
        }
      }
      if (personId !== null) linkedPeople++;
      const b = params.length;
      tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
      params.push(
        listName,
        m.messageId.slice(0, 300),
        m.threadKey,
        m.subject.slice(0, 500),
        m.senderName.slice(0, 200),
        personId,
        m.sentAt,
        m.hasAttachment,
        m.bodyExcerpt.slice(0, 500),
      );
    }
    if (tuples.length === 0) continue;
    await db.sql.unsafe(
      `INSERT INTO ${db.t("mailing_list_messages")} (
        list_name, message_id, thread_key, subject, sender_name, person_id, sent_at, has_attachment, body_excerpt
      ) VALUES ${tuples.join(",")}
      ON CONFLICT (list_name, message_id) DO UPDATE SET
        subject = CASE WHEN EXCLUDED.subject != '' THEN EXCLUDED.subject ELSE ${db.t("mailing_list_messages")}.subject END,
        sender_name = CASE WHEN EXCLUDED.sender_name != '' THEN EXCLUDED.sender_name ELSE ${db.t("mailing_list_messages")}.sender_name END,
        person_id = COALESCE(EXCLUDED.person_id, ${db.t("mailing_list_messages")}.person_id),
        has_attachment = (${db.t("mailing_list_messages")}.has_attachment OR EXCLUDED.has_attachment),
        body_excerpt = CASE WHEN EXCLUDED.body_excerpt != '' THEN EXCLUDED.body_excerpt ELSE ${db.t("mailing_list_messages")}.body_excerpt END`,
      params,
    );
    inserted += slice.length;
  }

  // Recompute summary row for this list
  const aggRows = (await db.sql.unsafe(
    `SELECT COUNT(*)::int AS cnt, MIN(sent_at) AS first_at, MAX(sent_at) AS last_at
     FROM ${db.t("mailing_list_messages")}
     WHERE list_name = $1`,
    [listName],
  )) as Array<{ cnt: number; first_at: string | null; last_at: string | null }>;
  const agg = aggRows[0] ?? { cnt: 0, first_at: "", last_at: "" };
  const watermark = agg.last_at ? formatPgSinceStamp(new Date(agg.last_at)) : formatPgSinceStamp(new Date());

  await db.sql.unsafe(
    `INSERT INTO ${db.t("mailing_lists")} (name, category, message_count, first_sent_at, last_sent_at, watermark, last_synced_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'synced')
     ON CONFLICT (name) DO UPDATE SET
       category = EXCLUDED.category,
       message_count = EXCLUDED.message_count,
       first_sent_at = CASE WHEN EXCLUDED.first_sent_at != '' THEN EXCLUDED.first_sent_at ELSE ${db.t("mailing_lists")}.first_sent_at END,
       last_sent_at = CASE WHEN EXCLUDED.last_sent_at != '' THEN EXCLUDED.last_sent_at ELSE ${db.t("mailing_lists")}.last_sent_at END,
       watermark = EXCLUDED.watermark,
       last_synced_at = EXCLUDED.last_synced_at,
       status = 'synced'`,
    [listName, classifyListCategory(listName), Number(agg.cnt || 0), agg.first_at || "", agg.last_at || "", watermark, nowIso],
  );

  return { inserted, linkedPeople };
}

export async function syncMailingListsIncremental(
  db: WebDatabase,
  opts?: {
    lists?: string[];
    allLists?: boolean;
    days?: number;
    maxPagesPerList?: number;
    minFreeDiskGb?: number;
    pgCookie?: string;
    mboxMonths?: string[];
    log?: (msg: string) => void;
    fetchFn?: typeof fetch;
  },
): Promise<{
  listsSynced: number;
  messagesUpserted: number;
  linkedPeople: number;
  catalogCount: number;
}> {
  const log = opts?.log ?? ((m: string) => console.log(`[lists-sync] ${m}`));
  const fn = opts?.fetchFn ?? fetch;
  const minFreeGb = opts?.minFreeDiskGb ?? 5;
  const freeGb = checkDiskFreeGb("/");
  if (freeGb < minFreeGb) {
    throw new Error(`Disk free space guard triggered (${freeGb} GB free < ${minFreeGb} GB minimum). Stopping sync safely.`);
  }

  // 1. Discover full postgresql.org mailing lists catalog
  let catalog: string[] = [...CORE_PG_LISTS];
  try {
    const res = await fn("https://www.postgresql.org/list/", {
      headers: { "User-Agent": "pgroast-web/0.3 (+https://github.com/NikolayS/pgroast)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const discovered = parseMailingListsCatalog(await res.text());
      if (discovered.length >= 20) catalog = discovered;
    }
  } catch (err) {
    log(`Catalog fetch fallback (${err instanceof Error ? err.message : String(err)})`);
  }

  // Register all discovered lists in mailing_lists table so full catalog is visible immediately
  for (const name of catalog) {
    await db.sql.unsafe(
      `INSERT INTO ${db.t("mailing_lists")} (name, category, status)
       VALUES ($1, $2, 'cataloged')
       ON CONFLICT (name) DO NOTHING`,
      [name, classifyListCategory(name)],
    );
  }

  const targetLists = opts?.lists?.length
    ? opts.lists
    : opts?.allLists
      ? catalog
      : CORE_PG_LISTS.filter((l) => catalog.includes(l));

  const lookup = await loadPeopleLookup(db);
  const days = Math.max(1, Math.min(365, opts?.days ?? 7));
  const maxPages = Math.max(1, Math.min(120, opts?.maxPagesPerList ?? Math.max(days + 2, 10)));
  const cookie = (opts?.pgCookie || process.env.PGROAST_PG_COOKIE || "").trim();

  let listsSynced = 0;
  let messagesUpserted = 0;
  let linkedPeople = 0;

  for (const listName of targetLists) {
    const curFree = checkDiskFreeGb("/");
    if (curFree < minFreeGb) {
      log(`Stopping early: disk free ${curFree} GB < ${minFreeGb} GB safety threshold.`);
      break;
    }

    // Optional authenticated .mbox historical backfill for specific YYYYMM months
    if (opts?.mboxMonths?.length && cookie) {
      for (const ym of opts.mboxMonths) {
        if (!/^\d{6}$/.test(ym)) continue;
        const mboxUrl = `https://www.postgresql.org/list/${encodeURIComponent(listName)}/mbox/${encodeURIComponent(listName)}.${ym}`;
        try {
          const r = await fn(mboxUrl, {
            headers: {
              "User-Agent": "pgroast-web/0.3 (+https://github.com/NikolayS/pgroast)",
              Cookie: cookie,
            },
            redirect: "manual",
            signal: AbortSignal.timeout(45_000),
          });
          if (r.status === 200) {
            const text = await r.text();
            const parsed = parseMboxText(text, listName);
            const res = await upsertMailingListMessages(db, listName, parsed, lookup);
            messagesUpserted += res.inserted;
            linkedPeople += res.linkedPeople;
            await db.sql.unsafe(
              `UPDATE ${db.t("mailing_lists")} SET backfill_month = $1 WHERE name = $2`,
              [ym, listName],
            );
            log(`  ${listName} mbox ${ym}: ${res.inserted} msgs (${res.linkedPeople} linked)`);
          } else {
            log(`  ${listName} mbox ${ym}: HTTP ${r.status} (check PGROAST_PG_COOKIE)`);
          }
        } catch (err) {
          log(`  ${listName} mbox ${ym} error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Incremental public /since/<YYYYMMDDHHMM>/ sync
    const existingRows = (await db.sql.unsafe(
      `SELECT watermark FROM ${db.t("mailing_lists")} WHERE name = $1`,
      [listName],
    )) as Array<{ watermark: string }>;
    const existingWm = existingRows[0]?.watermark || "";
    const sinceDate = new Date(Date.now() - days * 86_400_000);
    const defaultStamp = formatPgSinceStamp(sinceDate);
    // If watermark is older than defaultStamp or we requested explicit days > 1, start from defaultStamp on first sync
    let nextPath: string | null = `/list/${encodeURIComponent(listName)}/since/${existingWm && existingWm > defaultStamp ? existingWm : defaultStamp}/`;

    const listMessages: ParsedListMessage[] = [];
    const visited = new Set<string>();
    for (let page = 0; page < maxPages && nextPath; page++) {
      if (visited.has(nextPath)) break;
      visited.add(nextPath);
      const stampMatch = nextPath.match(/\/since\/(\d{4})(\d{2})(\d{2})/);
      const pageYmd = stampMatch ? `${stampMatch[1]}-${stampMatch[2]}-${stampMatch[3]}` : new Date().toISOString().slice(0, 10);
      try {
        const res = await fn(`https://www.postgresql.org${nextPath}`, {
          headers: { "User-Agent": "pgroast-web/0.3 (+https://github.com/NikolayS/pgroast)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) break;
        const html = await res.text();
        const parsed = parseSincePageHtml(html, listName, pageYmd);
        listMessages.push(...parsed.messages);
        nextPath = parsed.nextPath;
      } catch {
        break;
      }
    }

    const res = await upsertMailingListMessages(db, listName, listMessages, lookup);
    listsSynced++;
    messagesUpserted += res.inserted;
    linkedPeople += res.linkedPeople;
    if (res.inserted > 0) {
      log(`  ${listName}: ${res.inserted} messages synced (${res.linkedPeople} linked to unified hackers)`);
    }
  }

  return { listsSynced, messagesUpserted, linkedPeople, catalogCount: catalog.length };
}
