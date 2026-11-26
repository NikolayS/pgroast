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

export interface MrThreadTldr {
  pitch: string;
  latestSummary: string;
  latestBy: string;
  latestDate: string;
  startedDate: string;
  daysIdle: number;
}

export interface MrDiscussionResult {
  cfId: number;
  threadUrl: string;
  subject: string;
  lists: string[];
  messageCount: number;
  participants: MrParticipant[];
  revisions: Array<{ tag: string; date: string; from: string; messageIndex: number; fileCount: number }>;
  tldr: MrThreadTldr;
  messages: MrTimelineMessage[];
  cachedAt: string;
}

export interface MrDiffCommentRef {
  messageIndex: number;
  from: string;
  date: string;
  url: string;
  excerpt: string;
  matchKind: "line" | "file";
}

export interface MrDiffLine {
  type: "ctx" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  content: string;
  comments?: MrDiffCommentRef[];
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
  mentions?: MrDiffCommentRef[];
}

export interface MrDiffResult {
  cfId: number;
  source: string;
  compareUrl: string;
  files: MrDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
  matchedLineComments?: number;
  matchedFileMentions?: number;
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
    // Match v1 / v12 (ignore -0001 patch-series ordinal) or date-style v2026-09
    const dateRev = a.name.match(/\b(v20\d{2}[-_.]\d{2}(?:[-_.]\d{2})?)\b/i);
    if (dateRev?.[1]) return { tag: dateRev[1].toLowerCase(), patchCount: patchFiles.length };
    const m = a.name.match(/(?:^|[-_.])(v\d+)(?:[-_.]|$)/i);
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
    tldr: buildThreadTldr(messages),
    messages,
    cachedAt: new Date().toISOString(),
  };

  pruneCache(threadCache);
  threadCache.set(cfId, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}

function extractCleanExcerpt(blocks: MrBodyBlock[], maxLen = 280): string {
  const paragraphs: string[] = [];
  for (const b of blocks) {
    if (b.kind !== "text") continue;
    const rawLines = b.content.split("\n");
    const kept: string[] = [];
    for (const ln of rawLines) {
      const t = ln.trim();
      if (!t) {
        if (kept.length > 0) {
          paragraphs.push(kept.join(" "));
          kept.length = 0;
        }
        continue;
      }
      if (/^On\s+.+wrote:\s*$/i.test(t)) continue;
      if (/^(?:Hi|Hello|Hey|Dear)\b[^.?!]{0,45}[,!:]*\s*$/i.test(t)) continue;
      if (/^(?:Regards|Thanks|Thank you|Cheers|Best|Best regards)[,!.\s]*$/i.test(t)) continue;
      if (/^--\s*$/.test(t)) break;
      // Skip ASCII table dividers, psql result borders, and raw diff hunks
      if (/^[-=+~|_\s]{4,}$/.test(t)) continue;
      if (/^(?:diff --git|@@\s|---\s+a\/|\+\+\+\s+b\/|\(\d+\s+rows?\)$)/i.test(t)) continue;
      // If we already have a full prose sentence, stop before an indented SQL/code block
      if ((paragraphs.length > 0 || kept.join(" ").length >= 90) && (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|EXPLAIN|postgres[=#])\b/i.test(t) || /^\s{2,}\S/.test(ln))) {
        break;
      }
      kept.push(t);
    }
    if (kept.length > 0) paragraphs.push(kept.join(" "));
    if (paragraphs.join(" ").length >= maxLen) break;
  }

  let prose = paragraphs
    .join(" ")
    .replace(/^(?:Hi|Hello|Hey|Dear)\b[^,.!?\n]{0,35}[,!]\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!prose) return "";
  if (prose.length <= maxLen) return prose;
  const cut = prose.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (lastStop > 80) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function buildThreadTldr(messages: MrTimelineMessage[]): MrThreadTldr {
  const first = messages[0];
  const last = messages[messages.length - 1];
  const startedDate = first?.date?.slice(0, 10) || "";
  const latestDate = last?.date?.slice(0, 10) || "";
  let daysIdle = 0;
  if (last?.date) {
    const ts = Date.parse(last.date);
    if (Number.isFinite(ts)) {
      daysIdle = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
    }
  }
  return {
    pitch: first ? extractCleanExcerpt(first.blocks, 320) : "",
    latestSummary: last ? extractCleanExcerpt(last.blocks, 240) : "",
    latestBy: last?.from || "",
    latestDate,
    startedDate,
    daysIdle,
  };
}

function normalizeCodeSnippet(s: string): string {
  return s
    .replace(/^[>\s+|]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfulDiffLine(content: string): boolean {
  const norm = normalizeCodeSnippet(content);
  if (norm.length < 22) return false;
  if (/^(\/\*|\*\/|\*|\/\/|#include|\{|\}|return\b|break;|continue;|else\b)/.test(norm)) return false;
  if (!/[a-zA-Z_][a-zA-Z0-9_]{2,}/.test(norm)) return false;
  return true;
}

/**
 * Best-effort cross-matching of pgsql-hackers discussion messages onto unified diff
 * lines (via quoted code snippets) and files (via filename mentions).
 */
export function matchThreadToDiff(diff: MrDiffResult, discussion: MrDiscussionResult | null): MrDiffResult {
  if (!discussion || discussion.messages.length === 0) return diff;

  const preparedMsgs = discussion.messages.map((m) => {
    const quotePairs: Array<{ normQuote: string; replyExcerpt: string }> = [];
    for (let i = 0; i < m.blocks.length; i++) {
      const b = m.blocks[i]!;
      const normQuote = b.content
        .split("\n")
        .map((ln) => normalizeCodeSnippet(ln))
        .join("\n");
      if (b.kind === "quote") {
        const nextText = m.blocks[i + 1]?.kind === "text" ? extractCleanExcerpt([m.blocks[i + 1]!], 240) : "";
        quotePairs.push({ normQuote, replyExcerpt: nextText || extractCleanExcerpt(m.blocks, 200) });
      } else if (/^\s*[+-]\s*\S/.test(b.content) || /;\s*$/.test(b.content)) {
        quotePairs.push({ normQuote, replyExcerpt: extractCleanExcerpt(m.blocks, 200) });
      }
    }
    const fullText = m.blocks.map((b) => b.content).join("\n");
    return { m, quotePairs, fullText, excerpt: extractCleanExcerpt(m.blocks, 220) };
  });

  let matchedLineComments = 0;
  let matchedFileMentions = 0;

  const enrichedFiles: MrDiffFile[] = diff.files.map((file) => {
    const filePath = file.newPath || file.oldPath;
    const baseName = filePath.split("/").pop() || filePath;
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fileMentionRe = baseName.length >= 5 ? new RegExp(`(?<![A-Za-z0-9_.-])${escapedBase}(?![A-Za-z0-9_.-])`, "i") : null;

    const lineMatchedMsgs = new Set<number>();
    const enrichedHunks: MrDiffHunk[] = file.hunks.map((hunk) => {
      const hunkUsedMsgs = new Set<number>();
      const enrichedLines: MrDiffLine[] = hunk.lines.map((ln) => {
        if (!isMeaningfulDiffLine(ln.content)) return ln;
        const normLine = normalizeCodeSnippet(ln.content);
        const hits: MrDiffCommentRef[] = [];

        for (const pm of preparedMsgs) {
          if (hunkUsedMsgs.has(pm.m.index)) continue;
          const matchPair = pm.quotePairs.find((qp) => qp.normQuote.includes(normLine));
          if (matchPair) {
            hunkUsedMsgs.add(pm.m.index);
            lineMatchedMsgs.add(pm.m.index);
            hits.push({
              messageIndex: pm.m.index,
              from: pm.m.from,
              date: pm.m.date,
              url: pm.m.url,
              excerpt: matchPair.replyExcerpt || pm.excerpt,
              matchKind: "line",
            });
            matchedLineComments++;
            if (hits.length >= 3) break;
          }
        }
        return hits.length > 0 ? { ...ln, comments: hits } : ln;
      });
      return { ...hunk, lines: enrichedLines };
    });

    const mentions: MrDiffCommentRef[] = [];
    if (fileMentionRe) {
      for (const pm of preparedMsgs) {
        if (lineMatchedMsgs.has(pm.m.index)) continue;
        if (fileMentionRe.test(pm.fullText)) {
          mentions.push({
            messageIndex: pm.m.index,
            from: pm.m.from,
            date: pm.m.date,
            url: pm.m.url,
            excerpt: pm.excerpt,
            matchKind: "file",
          });
          matchedFileMentions++;
          if (mentions.length >= 8) break;
        }
      }
    }

    return {
      ...file,
      hunks: enrichedHunks,
      ...(mentions.length > 0 ? { mentions } : {}),
    };
  });

  return {
    ...diff,
    files: enrichedFiles,
    matchedLineComments,
    matchedFileMentions,
  };
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
