// HTML parsers for postgresql.org flat thread pages and CommitFest patch pages.
// Regex-based on purpose: no dependencies, and the two page layouts are stable and simple.

import type { Attachment, CfEntry, CfHistoryItem, CfThreadRef, Thread, ThreadMessage } from "./types.ts";

const ARCHIVE = "https://www.postgresql.org";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

/** Strip tags and collapse whitespace: for single-line fields. */
export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert a message body to plain text, keeping line structure. */
export function htmlToText(html: string): string {
  const s = html
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?(p|div|pre|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/^ (?=\S)/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "2024-09-12 11:08:15" -> "2024-09-12T11:08:15Z"; null when not a timestamp. */
export function normTimestamp(s: string): string | null {
  const m = s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return null;
  const time = m[2]!.length === 5 ? m[2] + ":00" : m[2];
  return `${m[1]}T${time}Z`;
}

export function parseSize(s: string): number | null {
  const m = s.trim().match(/^([\d.]+)\s*(bytes|B|KB|kB|MB|GB)$/i);
  if (!m) return null;
  const unit = m[2]!.toLowerCase();
  const mult = unit === "kb" ? 1024 : unit === "mb" ? 1024 ** 2 : unit === "gb" ? 1024 ** 3 : 1;
  return Math.round(Number(m[1]) * mult);
}

export function messageUrl(messageId: string): string {
  return `${ARCHIVE}/message-id/${encodeURIComponent(messageId)}`;
}

export function flatThreadUrl(messageId: string): string {
  return `${ARCHIVE}/message-id/flat/${encodeURIComponent(messageId)}`;
}

function headerField(block: string, name: string): string {
  const re = new RegExp(`<th[^>]*>\\s*${name}:\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i");
  const m = block.match(re);
  return m ? stripTags(m[1]!) : "";
}

function parseAttachments(block: string): Attachment[] {
  const out: Attachment[] = [];
  const table = block.match(/<table[^>]*message-attachments[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return out;
  const rowRe =
    /<tr>\s*<th[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const m of table[1]!.matchAll(rowRe)) {
    const href = decodeEntities(m[1]!);
    const sizeText = stripTags(m[4]!);
    out.push({
      name: stripTags(m[2]!),
      url: href.startsWith("http") ? href : ARCHIVE + href,
      contentType: stripTags(m[3]!),
      sizeText,
      sizeBytes: parseSize(sizeText),
    });
  }
  return out;
}

export interface ThreadSelectOption {
  messageId: string;
  date: string | null;
  from: string;
  hasAttachment: boolean;
}

export interface ParsedSingleMessage {
  message: ThreadMessage;
  lists: string[];
  /** All messages listed in <select id="thread_select">, if present on the page. */
  threadMessages: ThreadSelectOption[];
  /** Message IDs linked from <ul class="message-responses"> ("In response to" / "Responses"). */
  responseIds: string[];
}

function decodeMsgIdToken(raw: string): string {
  const unescaped = decodeEntities(raw).trim().replace(/\/+$/, "");
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

/**
 * Parse a single non-flat archive page: https://www.postgresql.org/message-id/<msgid>.
 * Reuses the same message-header / message-content / message-attachments markup as /flat/,
 * and also extracts the full thread index from <select id="thread_select"> (ignoring
 * unrelated chronological Next/Previous list links in <table class="... message-nav">).
 */
export function parseSingleMessagePage(html: string): ParsedSingleMessage {
  const lists = [
    ...new Set([...html.matchAll(/<span class="listname"><a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]!.trim())),
  ];

  const parts = html.split(/<table[^>]*class="[^"]*message-header[^"]*"[^>]*>/i).slice(1);
  let message: ThreadMessage | null = null;
  for (const part of parts) {
    const headerEnd = part.indexOf("</table>");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    if (!/<th[^>]*>\s*From:/i.test(header)) continue;
    const rest = part.slice(headerEnd);

    const idM = header.match(/<th[^>]*>\s*Message-ID:\s*<\/th>\s*<td[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const messageId = idM ? stripTags(idM[1]!) : "";
    if (!messageId) continue;
    const bodyM = rest.match(/<div class="message-content">([\s\S]*?)<\/div>/i);
    const date = normTimestamp(headerField(header, "Date"));
    message = {
      index: 1,
      messageId,
      url: messageUrl(messageId),
      from: headerField(header, "From"),
      date: date ?? "",
      subject: headerField(header, "Subject"),
      body: bodyM ? htmlToText(bodyM[1]!) : "",
      attachments: parseAttachments(rest),
    };
    break;
  }
  if (!message) throw new Error("no message found: not a postgresql.org message page");

  const threadMessages: ThreadSelectOption[] = [];
  const seenThreadIds = new Set<string>();
  const selectM = html.match(/<select[^>]*id="thread_select"[^>]*>([\s\S]*?)<\/select>/i);
  if (selectM) {
    for (const opt of selectM[1]!.matchAll(/<option\s+[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
      const msgId = decodeMsgIdToken(opt[1]!);
      if (!msgId || seenThreadIds.has(msgId)) continue;
      seenThreadIds.add(msgId);
      const rawText = opt[2]!;
      const hasAttachment = /&#x1f4ce;|&#128206;|\u{1F4CE}/iu.test(rawText);
      const plain = stripTags(rawText);
      const fromM = plain.match(/\bfrom\s+(.+?)(?:\s*\u{1F4CE})?$/u);
      threadMessages.push({
        messageId: msgId,
        date: normTimestamp(plain),
        from: fromM ? fromM[1]!.trim() : "",
        hasAttachment,
      });
    }
  }

  const responseIds: string[] = [];
  const seenResp = new Set<string>();
  for (const ul of html.matchAll(/<ul[^>]*class="[^"]*message-responses[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi)) {
    for (const a of ul[1]!.matchAll(/<a\s+[^>]*href="\/message-id\/([^"?#]+)"/gi)) {
      const rawPath = a[1]!;
      if (/^(?:flat|raw|mbox|attachment|resend)\//i.test(rawPath)) continue;
      const msgId = decodeMsgIdToken(rawPath);
      if (!msgId || msgId === message.messageId || seenResp.has(msgId)) continue;
      seenResp.add(msgId);
      responseIds.push(msgId);
    }
  }

  return { message, lists, threadMessages, responseIds };
}

/**
 * Pick which message IDs to fetch from a thread's <select id="thread_select"> entries
 * when /flat/ is unavailable. Always keeps chronological order and, on long threads,
 * prioritizes the opening proposal, messages with patch attachments, and the latest replies.
 */
export function selectNonFlatMessageIds(
  options: ThreadSelectOption[],
  limit: number,
  filters?: { before?: string | null; blind?: number | null },
): { selected: string[]; totalBeforeLimit: number; truncated: boolean } {
  const deduped: ThreadSelectOption[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    if (!o.messageId || seen.has(o.messageId)) continue;
    seen.add(o.messageId);
    deduped.push(o);
  }
  deduped.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  let filtered = deduped;
  if (filters?.before) {
    const cutoff = filters.before + "T00:00:00Z";
    filtered = filtered.filter((o) => !o.date || o.date < cutoff);
  }
  if (filters?.blind != null && filters.blind > 0) {
    filtered = filtered.slice(0, filters.blind);
  }

  const totalBeforeLimit = filtered.length;
  if (totalBeforeLimit <= limit) {
    return { selected: filtered.map((o) => o.messageId), totalBeforeLimit, truncated: false };
  }

  const chosen = new Set<number>();
  const addIdx = (i: number) => {
    if (i >= 0 && i < filtered.length && chosen.size < limit) chosen.add(i);
  };

  // 1. Opening proposal + early context
  const headCount = Math.min(4, Math.max(1, Math.floor(limit * 0.15)));
  for (let i = 0; i < headCount; i++) addIdx(i);

  // 2. Latest messages (current consensus / review state)
  const tailCount = Math.min(14, Math.max(2, Math.floor(limit * 0.4)));
  for (let i = filtered.length - 1; i >= Math.max(0, filtered.length - tailCount); i--) addIdx(i);

  // 3. Messages with attachments (latest revisions first, then earliest revision)
  const attIndices: number[] = [];
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i]!.hasAttachment) attIndices.push(i);
  }
  if (attIndices.length > 0) {
    addIdx(attIndices[0]!);
    for (let k = attIndices.length - 1; k >= Math.max(0, attIndices.length - 6); k--) {
      addIdx(attIndices[k]!);
    }
  }

  // 4. Fill remaining slots with evenly-spaced middle messages so timeline stays representative
  const remaining = limit - chosen.size;
  if (remaining > 0) {
    const unchosen: number[] = [];
    for (let i = 0; i < filtered.length; i++) {
      if (!chosen.has(i)) unchosen.push(i);
    }
    const step = unchosen.length / remaining;
    for (let k = 0; k < remaining; k++) {
      const idx = unchosen[Math.min(unchosen.length - 1, Math.floor(k * step))];
      if (idx != null) chosen.add(idx);
    }
  }

  const ordered = [...chosen].sort((a, b) => a - b).map((i) => filtered[i]!.messageId);
  return { selected: ordered, totalBeforeLimit, truncated: true };
}

/**
 * Parse https://www.postgresql.org/message-id/flat/<msgid>.
 * Throws when the page holds no message (e.g. an error page).
 */
export function parseFlatThread(html: string): Thread {
  const subjM = html.match(/<h1[^>]*id="flatMsgSubject"[^>]*>([\s\S]*?)<\/h1>/i);
  const lists = [
    ...new Set([...html.matchAll(/<span class="listname"><a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]!.trim())),
  ];

  // Each message starts with a header table that holds a "From:" row. The page-level
  // header table (only "Lists:") is skipped by that test.
  const parts = html.split(/<table[^>]*class="[^"]*message-header[^"]*"[^>]*>/i).slice(1);
  const messages: ThreadMessage[] = [];
  for (const part of parts) {
    const headerEnd = part.indexOf("</table>");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    if (!/<th[^>]*>\s*From:/i.test(header)) continue;
    const rest = part.slice(headerEnd);

    const idM = header.match(/<th[^>]*>\s*Message-ID:\s*<\/th>\s*<td[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const messageId = idM ? stripTags(idM[1]!) : "";
    if (!messageId) continue;
    const bodyM = rest.match(/<div class="message-content">([\s\S]*?)<\/div>/i);
    const date = normTimestamp(headerField(header, "Date"));
    messages.push({
      index: messages.length + 1,
      messageId,
      url: messageUrl(messageId),
      from: headerField(header, "From"),
      date: date ?? "",
      subject: headerField(header, "Subject"),
      body: bodyM ? htmlToText(bodyM[1]!) : "",
      attachments: parseAttachments(rest),
    });
  }
  if (messages.length === 0) throw new Error("no messages found: not a flat thread page");
  const root = messages[0]!;
  return {
    threadUrl: flatThreadUrl(root.messageId),
    rootMessageId: root.messageId,
    subject: subjM ? stripTags(subjM[1]!) : root.subject,
    lists,
    messages,
  };
}

function cfFields(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const tableM = html.match(/<table class="table table-bordered">([\s\S]*)/i);
  if (!tableM) return out;
  // Top-level rows only: "History" holds a nested table, so cut it off first.
  const histAt = tableM[1]!.search(/<th>\s*History\s*<\/th>/i);
  const main = histAt >= 0 ? tableM[1]!.slice(0, histAt) : tableM[1]!;
  for (const m of main.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)(?=<th[^>]*>|$)/gi)) {
    out.set(stripTags(m[1]!), m[2]!);
  }
  // "Emails" is the last row before "History" and can hold a nested table (annotations) with
  // its own <th> cells: take the whole rest of the main table for it.
  const emailsAt = main.search(/<th>\s*Emails\s*<\/th>/i);
  if (emailsAt >= 0) out.set("Emails", main.slice(emailsAt).replace(/^<th>\s*Emails\s*<\/th>\s*<td[^>]*>/i, ""));
  return out;
}

/** Parse https://commitfest.postgresql.org/patch/<id>/. */
export function parseCommitfestPatch(html: string, id: number): CfEntry {
  const f = cfFields(html);
  const get = (k: string) => f.get(k) ?? "";
  const title = stripTags(get("Title"));
  if (!title) throw new Error(`CommitFest patch ${id}: no title found (not a patch page?)`);

  const statuses = [
    ...get("Status").matchAll(
      /<a href="\/(\d+)\/">([^<]+)<\/a>[^<]*<span class="badge[^"]*">([^<]+)<\/span>/g,
    ),
  ].map((m) => ({ cfId: Number(m[1]), cfName: m[2]!.trim(), status: m[3]!.trim() }));
  const latest = [...statuses].sort((a, b) => b.cfId - a.cfId)[0];

  const tags = [...get("Tags").matchAll(/<span class="badge"[^>]*>([^<]+)<\/span>/g)].map((m) =>
    decodeEntities(m[1]!).trim(),
  );

  const threads: CfThreadRef[] = [];
  for (const m of get("Emails").matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
    const a = m[1]!.match(/<a href="https:\/\/www\.postgresql\.org\/message-id\/flat\/([^"]+)">([\s\S]*?)<\/a>/);
    if (!a) continue;
    let messageId = decodeEntities(a[1]!);
    try {
      messageId = decodeURIComponent(messageId);
    } catch {
      // keep as is
    }
    const first = m[2]!.match(/First at <a[^>]*>([^<]+)<\/a> by ([\s\S]*?)<br/);
    const last = m[2]!.match(/Latest at <a[^>]*>([^<]+)<\/a>/);
    threads.push({
      messageId,
      url: flatThreadUrl(messageId),
      subject: stripTags(a[2]!),
      firstAt: first ? normTimestamp(first[1]!) : null,
      firstBy: first ? stripTags(first[2]!).replace(/\s*<.*$/, "") : "",
      latestAt: last ? normTimestamp(last[1]!) : null,
    });
  }

  const history: CfHistoryItem[] = [];
  const histM = html.match(/<th>\s*History\s*<\/th>([\s\S]*?)<\/table>/i);
  if (histM) {
    for (const r of histM[1]!.matchAll(
      /<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g,
    )) {
      history.push({
        when: normTimestamp(r[1]!) ?? r[1]!.trim(),
        who: stripTags(r[2]!),
        what: stripTags(r[3]!),
      });
    }
  }

  const reviewers = stripTags(get("Reviewers").replace(/<a class="btn[\s\S]*?<\/a>/g, ""));
  return {
    id,
    url: `https://commitfest.postgresql.org/patch/${id}/`,
    title,
    status: latest?.status ?? null,
    statuses,
    authors: stripTags(get("Authors") || get("Author")),
    reviewers,
    committer: stripTags(get("Committer")),
    tags,
    topic: stripTags(get("Topic")),
    targetVersion: stripTags(get("Target version")),
    created: normTimestamp(stripTags(get("Created"))),
    threads,
    history,
    links: [...get("Links").matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => decodeEntities(m[1]!)),
    redacted: false,
  };
}
