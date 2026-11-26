import { flatThreadUrl, parseCommitfestPatch, parseFlatThread } from "../../../src/thread/parse.ts";

export interface MrBodyBlock {
  kind: "text" | "quote";
  content: string;
  lineCount: number;
}

export interface MrAttachment {
  name: string;
  url: string;
  contentType: string;
  sizeText: string;
  isPatch: boolean;
  isNoCfbot: boolean;
}

export interface MrTimelineMessage {
  index: number;
  messageId: string;
  url: string;
  from: string;
  date: string;
  subject: string;
  isAuthor: boolean;
  patchRevision: string | null;
  patchCount: number;
  blocks: MrBodyBlock[];
  attachments: MrAttachment[];
}

export interface MrParticipant {
  name: string;
  count: number;
  isAuthor: boolean;
}

export interface MrDiscussionResult {
  cfId: number;
  threadUrl: string;
  subject: string;
  lists: string[];
  messageCount: number;
  participants: MrParticipant[];
  revisions: Array<{ tag: string; date: string; from: string; messageIndex: number; fileCount: number }>;
  messages: MrTimelineMessage[];
  cachedAt: string;
}

export interface MrDiffLine {
  type: "ctx" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface MrDiffHunk {
  header: string;
  lines: MrDiffLine[];
}

export interface MrDiffFile {
  oldPath: string;
  newPath: string;
  additions: number;
  deletions: number;
  hunks: MrDiffHunk[];
}

export interface MrDiffResult {
  cfId: number;
  source: string;
  compareUrl: string;
  files: MrDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
  cachedAt: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 160;
const USER_AGENT = "pgroast-web/0.3 (+https://github.com/NikolayS/pgroast)";

const threadCache = new Map<number, { expiresAt: number; data: MrDiscussionResult }>();
const diffCache = new Map<number, { expiresAt: number; data: MrDiffResult }>();

function pruneCache<T>(cache: Map<number, { expiresAt: number; data: T }>): void {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Split an email body into readable prose vs collapsible quoted `>` blocks. */
export function splitBodyIntoBlocks(body: string): MrBodyBlock[] {
  const lines = body.replace(/\r/g, "").split("\n");
  const blocks: MrBodyBlock[] = [];
  let curKind: "text" | "quote" | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!curKind || buf.length === 0) return;
    const joined = buf.join("\n").trim();
    if (joined) {
      blocks.push({ kind: curKind, content: joined, lineCount: joined.split("\n").length });
    }
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isQuoteLine = /^>/.test(trimmed);
    const isBlank = trimmed === "";

    if (isBlank && curKind) {
      buf.push("");
      continue;
    }

    const nextKind: "text" | "quote" = isQuoteLine ? "quote" : "text";
    if (curKind !== nextKind) {
      flush();
      curKind = nextKind;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

function inferPatchRevision(attachments: MrAttachment[]): { tag: string | null; patchCount: number } {
  const patchFiles = attachments.filter((a) => a.isPatch && !a.isNoCfbot);
  if (patchFiles.length === 0) return { tag: null, patchCount: 0 };
  for (const a of patchFiles) {
    const m = a.name.match(/\b(v\d+(?:[-_.]\d+)?)\b/i) || a.name.match(/(?:^|[-_.])(v\d+)(?:[-_.]|$)/i);
    if (m?.[1]) return { tag: m[1].toLowerCase(), patchCount: patchFiles.length };
  }
  return { tag: "patch", patchCount: patchFiles.length };
}

function isPatchAttachment(name: string): boolean {
  return /\.(?:patch|diff)(?:\.txt|\.gz)?$/i.test(name);
}

function normalizeToFlatUrl(rawUrl: string): string | null {
  const m = rawUrl.match(/postgresql\.org\/message-id\/(?:flat\/)?([^/?#]+)/i);
  if (!m?.[1]) return null;
  let msgId = m[1];
  try {
    msgId = decodeURIComponent(msgId);
  } catch {
    // keep raw
  }
  return flatThreadUrl(msgId);
}

async function resolveThreadUrlFromCommitfest(cfId: number): Promise<string | null> {
  const res = await fetch(`https://commitfest.postgresql.org/patch/${cfId}/`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const cf = parseCommitfestPatch(html, cfId);
  if (!cf) return null;
  const firstMsgId = cf.threads[0]?.messageId;
  if (firstMsgId) return flatThreadUrl(firstMsgId);
  return cf.threads[0]?.url ? normalizeToFlatUrl(cf.threads[0].url) : null;
}

export async function fetchMrDiscussionForCf(cfId: number, knownThreadUrl?: string): Promise<MrDiscussionResult> {
  const hit = threadCache.get(cfId);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  let flatUrl = knownThreadUrl ? normalizeToFlatUrl(knownThreadUrl) : null;
  if (!flatUrl) {
    flatUrl = await resolveThreadUrlFromCommitfest(cfId);
  }
  if (!flatUrl) {
    throw new Error(`No pgsql-hackers thread linked to CF ${cfId}.`);
  }

  const res = await fetch(flatUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`Could not load pgsql-hackers thread (HTTP ${res.status} from postgresql.org).`);
  }
  const html = await res.text();
  const parsed = parseFlatThread(html);

  const starterName = (parsed.messages[0]?.from || "").trim().toLowerCase();
  const participantMap = new Map<string, MrParticipant>();
  const revisions: MrDiscussionResult["revisions"] = [];
  let autoRevCounter = 0;

  const messages: MrTimelineMessage[] = parsed.messages.map((m, idx) => {
    const cleanFrom = m.from.replace(/\s*<[^>]+>\s*/g, "").trim() || m.from || "Unknown";
    const isAuthor = Boolean(starterName && m.from.trim().toLowerCase() === starterName);
    const existing = participantMap.get(cleanFrom);
    if (existing) {
      existing.count++;
    } else {
      participantMap.set(cleanFrom, { name: cleanFrom, count: 1, isAuthor });
    }

    const attachments: MrAttachment[] = m.attachments.map((a) => ({
      name: a.name,
      url: a.url,
      contentType: a.contentType,
      sizeText: a.sizeText,
      isPatch: isPatchAttachment(a.name),
      isNoCfbot: /nocfbot/i.test(a.name),
    }));

    const rev = inferPatchRevision(attachments);
    let revTag = rev.tag;
    if (revTag === "patch") {
      autoRevCounter++;
      revTag = `patch #${autoRevCounter}`;
    }
    if (revTag && rev.patchCount > 0) {
      revisions.push({
        tag: revTag,
        date: m.date,
        from: cleanFrom,
        messageIndex: idx,
        fileCount: rev.patchCount,
      });
    }

    return {
      index: idx,
      messageId: m.messageId,
      url: m.url,
      from: cleanFrom,
      date: m.date,
      subject: m.subject,
      isAuthor,
      patchRevision: revTag,
      patchCount: rev.patchCount,
      blocks: splitBodyIntoBlocks(m.body),
      attachments,
    };
  });

  const participants = Array.from(participantMap.values()).sort((a, b) => b.count - a.count);
  const data: MrDiscussionResult = {
    cfId,
    threadUrl: flatUrl,
    subject: parsed.subject,
    lists: parsed.lists,
    messageCount: messages.length,
    participants,
    revisions,
    messages,
    cachedAt: new Date().toISOString(),
  };

  pruneCache(threadCache);
  threadCache.set(cfId, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}

export function parseMrUnifiedDiff(rawDiff: string, maxFiles = 50, maxLinesPerFile = 500): {
  files: MrDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
} {
  const files: MrDiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let truncated = false;

  const lines = rawDiff.split(/\r?\n/);
  let currentFile: MrDiffFile | null = null;
  let currentHunk: MrDiffHunk | null = null;
  let oldNum = 0;
  let newNum = 0;
  let fileLineCount = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentFile = {
        oldPath: m?.[1] || "",
        newPath: m?.[2] || "",
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      fileLineCount = 0;
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("--- a/")) {
      if (!currentFile.oldPath) currentFile.oldPath = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      if (!currentFile.newPath) currentFile.newPath = line.slice(6);
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunkMatch) {
      oldNum = Number(hunkMatch[1]);
      newNum = Number(hunkMatch[2]);
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;
    if (fileLineCount >= maxLinesPerFile) {
      truncated = true;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ type: "add", oldLine: null, newLine: newNum++, content: line.slice(1) });
      currentFile.additions++;
      totalAdditions++;
      fileLineCount++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ type: "del", oldLine: oldNum++, newLine: null, content: line.slice(1) });
      currentFile.deletions++;
      totalDeletions++;
      fileLineCount++;
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "ctx", oldLine: oldNum++, newLine: newNum++, content: line.slice(1) });
      fileLineCount++;
    }
  }

  return { files, totalAdditions, totalDeletions, truncated };
}

export async function fetchMrDiffForCf(cfId: number): Promise<MrDiffResult> {
  const hit = diffCache.get(cfId);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  const compareUrl = `https://github.com/postgresql-cfbot/postgresql/compare/master...cf/${cfId}`;
  const diffUrl = `${compareUrl}.diff`;
  const res = await fetch(diffUrl, {
    headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(
      `CFBot patch branch cf/${cfId} is unavailable (HTTP ${res.status}). The patch may need a rebase or have no active CFBot branch.`,
    );
  }
  const rawDiff = await res.text();
  if (!rawDiff.trim()) {
    throw new Error(`CFBot diff for cf/${cfId} is empty (already committed or identical to master).`);
  }

  const parsed = parseMrUnifiedDiff(rawDiff);
  const data: MrDiffResult = {
    cfId,
    source: `postgresql-cfbot branch cf/${cfId}`,
    compareUrl,
    ...parsed,
    cachedAt: new Date().toISOString(),
  };

  pruneCache(diffCache);
  diffCache.set(cfId, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}
