// Extract the prose of a patch file: commit message(s), the list of touched paths, and
// diff hunks for documentation files only. Code hunks are dropped here, in code, so no
// later stage can feed them to the model: PG Roast judges the idea, not the lines.

import type { CommitMessage } from "./types.ts";

export interface ProseExtract {
  commitMessages: CommitMessage[];
  files: string[];
  docHunks: { path: string; text: string }[];
  truncated: boolean;
}

export const MAX_COMMIT_MESSAGE_CHARS = 6000;
export const MAX_DOC_HUNK_CHARS = 6000;
export const MAX_DOC_TOTAL_CHARS = 16000;
export const MAX_FILES = 80;

/** Paths whose diff hunks are prose, not code. */
export function isDocPath(path: string): boolean {
  return (
    /^doc\//.test(path) ||
    /(^|\/)README[^/]*$/i.test(path) ||
    /\.(md|sgml|rst|txt)$/i.test(path) && !/(^|\/)(expected|output|sql|data)\//.test(path)
  );
}

function clip(s: string, max: number): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  return { text: s.slice(0, max) + "\n[... truncated ...]", cut: true };
}

/** RFC 2047 "=?UTF-8?q?...?=" subjects, as git format-patch emits for non-ASCII. */
function decodeMimeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=\s*/g, (m, _cs: string, enc: string, data: string) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
      const bytes = data
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(bytes, "latin1").toString("utf8");
    } catch {
      return m;
    }
  });
}

export function extractPatchProse(raw: string): ProseExtract {
  const text = raw.replace(/\r\n/g, "\n");
  let truncated = false;

  // Split into per-file diffs. Everything before the first "diff --git" of a commit is header.
  const lines = text.split("\n");
  const commitMessages: CommitMessage[] = [];
  const files: string[] = [];
  const docHunks: { path: string; text: string }[] = [];
  let docTotal = 0;

  let header: string[] = [];
  let cur: { path: string; lines: string[] } | null = null;

  const flushFile = () => {
    if (!cur) return;
    if (!files.includes(cur.path)) files.push(cur.path);
    if (isDocPath(cur.path) && docTotal < MAX_DOC_TOTAL_CHARS) {
      const c = clip(cur.lines.join("\n"), Math.min(MAX_DOC_HUNK_CHARS, MAX_DOC_TOTAL_CHARS - docTotal));
      truncated ||= c.cut;
      docTotal += c.text.length;
      docHunks.push({ path: cur.path, text: c.text });
    } else if (isDocPath(cur.path)) {
      truncated = true;
    }
    cur = null;
  };

  const flushHeader = () => {
    const cm = parseCommitHeader(header);
    if (cm) {
      const c = clip(cm.body, MAX_COMMIT_MESSAGE_CHARS);
      truncated ||= c.cut;
      commitMessages.push({ subject: cm.subject, body: c.text });
    }
    header = [];
  };

  for (const line of lines) {
    const d = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (d) {
      if (cur) flushFile();
      else flushHeader();
      cur = { path: d[2]!, lines: [line] };
      continue;
    }
    // A new mail header inside a multi-commit file ends the previous commit's last file.
    if (/^From [0-9a-f]{40} /.test(line)) {
      if (cur) flushFile();
      else flushHeader();
      header = [line];
      continue;
    }
    if (cur) cur.lines.push(line);
    else header.push(line);
  }
  if (cur) flushFile();
  else flushHeader();

  if (files.length > MAX_FILES) {
    truncated = true;
    files.length = MAX_FILES;
  }
  return { commitMessages, files, docHunks, truncated };
}

/** Parse a git format-patch mail header block: Subject (with continuation lines) + body. */
function parseCommitHeader(header: string[]): CommitMessage | null {
  const si = header.findIndex((l) => /^Subject:/i.test(l));
  if (si < 0) return null;
  let subject = header[si]!.replace(/^Subject:\s*/i, "");
  let i = si + 1;
  while (i < header.length && /^[ \t]+\S/.test(header[i]!)) {
    subject += " " + header[i]!.trim();
    i++;
  }
  subject = decodeMimeWords(subject)
    .replace(/^\[PATCH[^\]]*\]\s*/i, "")
    .trim();
  // Skip remaining mail headers up to the blank line.
  while (i < header.length && header[i]!.trim() !== "") i++;
  const bodyLines: string[] = [];
  for (i = i + 1; i < header.length; i++) {
    const l = header[i]!;
    if (l === "---") break; // start of the diffstat
    bodyLines.push(l);
  }
  return { subject, body: bodyLines.join("\n").trim() };
}

/** True when an attachment name looks like a text patch or a prose file worth reading. */
export function isReadableAttachment(name: string, contentType: string): boolean {
  if (/\.(gz|bz2|xz|zst|zip|tgz|tar|png|jpe?g|gif|pdf|svg|odt|docx?|xlsx?|bin)$/i.test(name)) return false;
  if (/\.(patch|diff|txt|md|nocfbot)$/i.test(name) || /README/i.test(name)) return true;
  return /^text\//i.test(contentType);
}
