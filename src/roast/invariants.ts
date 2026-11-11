// Subsystem invariants (invariants/*.md): rules harvested from senior reviewers, each with a
// source. A file is given to the roasters when one of its `paths:` prefixes matches a file the
// patch touches. The files are included verbatim; their Source links are allowed in the output
// because they are read from the file here, never taken from model output.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../thread/fetch.ts";
import { extractUrls } from "./sanitize.ts";

export interface InvariantFile {
  /** Path relative to the repository, e.g. "invariants/nbtree.md". */
  file: string;
  subsystem: string;
  paths: string[];
  /** The whole file, verbatim. */
  text: string;
  sourceUrls: string[];
}

export function parseInvariantFile(file: string, text: string): InvariantFile | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const front = m[1]!;
  const subsystem = front.match(/^subsystem:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const paths: string[] = [];
  let inPaths = false;
  for (const line of front.split("\n")) {
    if (/^paths:\s*$/.test(line)) inPaths = true;
    else if (inPaths && /^\s+-\s+/.test(line)) paths.push(line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
    else if (/^\S/.test(line)) inPaths = false;
  }
  if (paths.length === 0) return null;
  return { file, subsystem, paths, text: text.trim(), sourceUrls: [...new Set(extractUrls(text))] };
}

export function loadInvariantFiles(dir: string = join(REPO_ROOT, "invariants")): InvariantFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => parseInvariantFile(`invariants/${f}`, readFileSync(join(dir, f), "utf8")))
    .filter((x): x is InvariantFile => x != null);
}

/** The invariant files whose path prefixes match at least one touched file. None without a patch. */
export function selectInvariants(touched: string[], all: InvariantFile[]): InvariantFile[] {
  return all.filter((inv) => inv.paths.some((p) => touched.some((t) => t === p || t.startsWith(p))));
}

export function renderInvariants(files: InvariantFile[]): string {
  if (files.length === 0) return "";
  return [
    "## Subsystem invariants to check explicitly",
    "",
    "The patch touches files of the subsystems below. These are rules harvested from senior reviewers'",
    "feedback, each with its source. They are exactly the kind of rule that is easy to miss. For each",
    'one ask: "does the proposal say how it upholds this?" If the material does not say, and the rule',
    "applies to what the proposal changes, that is an objection (level 2, rubric item 7), and it cites",
    "the invariant's Source link as written in the entry. If the rule does not apply to this proposal,",
    "or the material shows it is upheld, raise nothing.",
    "",
    ...files.map((f) => `### ${f.file}\n\n${f.text}`),
  ].join("\n");
}
