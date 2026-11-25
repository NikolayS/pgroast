import type { CfEntryRecord, DiffCommentRecord } from "../types.ts";
import { wrapEmailBody } from "./gates.ts";

export interface ParsedDiffLine {
  type: "ctx" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface ParsedDiffHunk {
  header: string;
  lines: ParsedDiffLine[];
}

export interface ParsedDiffFile {
  oldPath: string;
  newPath: string;
  additions: number;
  deletions: number;
  hunks: ParsedDiffHunk[];
}

export interface PatchDiffResult {
  cfId: number;
  source: string;
  compareUrl: string;
  files: ParsedDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
}

export function parseUnifiedDiff(rawDiff: string, maxFiles = 60, maxLinesPerFile = 600): {
  files: ParsedDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
} {
  const files: ParsedDiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let truncated = false;

  const lines = rawDiff.split(/\r?\n/);
  let currentFile: ParsedDiffFile | null = null;
  let currentHunk: ParsedDiffHunk | null = null;
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

/**
 * Fetches the latest CommitFest patch series unified diff from postgresql-cfbot on GitHub.
 */
export async function fetchPatchDiffForCf(cfId: number): Promise<PatchDiffResult> {
  const compareUrl = `https://github.com/postgresql-cfbot/postgresql/compare/master...cf/${cfId}`;
  const diffUrl = `${compareUrl}.diff`;

  const res = await fetch(diffUrl, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "pgroast-app/0.1",
    },
  });

  if (!res.ok) {
    throw new Error(
      `CFBot patch branch cf/${cfId} is unavailable (HTTP ${res.status} from postgresql-cfbot). The patch may need a rebase or have no active CFBot branch.`,
    );
  }

  const rawDiff = await res.text();
  if (!rawDiff.trim()) {
    throw new Error(`CFBot diff for cf/${cfId} is empty (branch may already be committed or identical to master).`);
  }

  const parsed = parseUnifiedDiff(rawDiff);
  return {
    cfId,
    source: `postgresql-cfbot branch cf/${cfId}`,
    compareUrl,
    ...parsed,
  };
}

/**
 * Compiles inline PR-style diff comments into a clean, 72-col wrapped plain-text
 * pgsql-hackers review email ready for Reply Studio & the 4 Safety Gates.
 */
export function compileInlineCommentsToHackersEmail(
  entry: Pick<CfEntryRecord, "cf_id" | "title" | "thread_url">,
  comments: DiffCommentRecord[],
  authorName = "",
): { subject: string; body: string } {
  const subject = entry.title.startsWith("Re:") ? entry.title : `Re: ${entry.title}`;
  const lines: string[] = [];
  lines.push("Hi,");
  lines.push("");
  lines.push(`I reviewed the latest patch series for CF ${entry.cf_id} and have ${comments.length} inline note${comments.length === 1 ? "" : "s"} below.`);
  lines.push("");

  // Group comments by file path while keeping line order
  const byFile = new Map<string, DiffCommentRecord[]>();
  for (const c of comments) {
    const arr = byFile.get(c.file_path) ?? [];
    arr.push(c);
    byFile.set(c.file_path, arr);
  }

  for (const [filePath, list] of byFile.entries()) {
    list.sort((a, b) => a.line_num - b.line_num);
    for (const c of list) {
      lines.push(`In ${filePath} around line ${c.line_num}:`);
      if (c.code_snippet.trim()) {
        for (const snippetLine of c.code_snippet.split(/\r?\n/).slice(0, 4)) {
          lines.push(`> ${snippetLine}`);
        }
      }
      lines.push("");
      lines.push(c.comment_text.trim());
      lines.push("");
    }
  }

  lines.push(`CommitFest entry: [1]`);
  lines.push("");
  lines.push(`[1] https://commitfest.postgresql.org/patch/${entry.cf_id}/`);
  if (entry.thread_url) {
    lines.push(`[2] ${entry.thread_url}`);
  }
  if (authorName.trim()) {
    lines.push("");
    lines.push(authorName.trim());
  }

  return {
    subject,
    body: wrapEmailBody(lines.join("\n"), 72),
  };
}
