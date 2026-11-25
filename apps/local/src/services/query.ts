export interface ParsedEntryQuery {
  freeText: string[];
  verdict?: string;
  status?: string;
  openOnly?: boolean;
  closedOnly?: boolean;
  cfbot?: string;
  hasNovel?: boolean;
  starredOnly?: boolean;
  unvisitedOnly?: boolean;
  unroastedOnly?: boolean;
  mineOnly?: boolean;
  noCommitter?: boolean;
  noReviewer?: boolean;
  tag?: string;
  author?: string;
  reviewer?: string;
  topic?: string;
}

export interface SavedSearchPreset {
  id: string;
  name: string;
  query: string;
  description: string;
}

export const BUILTIN_SAVED_SEARCHES: SavedSearchPreset[] = [
  {
    id: "rfc-no-committer",
    name: "Ready for Committer, no committer",
    query: "status:ready no:committer",
    description: "Open patches marked Ready for Committer without an assigned committer",
  },
  {
    id: "clean-needs-reviewer",
    name: "Clean verdict, needs reviewer",
    query: "verdict:clean status:open no:reviewer",
    description: "NO-FUNDAMENTAL-OBJECTION open patches with no reviewer listed yet",
  },
  {
    id: "novel-objections",
    name: "Has NEW novel objections",
    query: "status:open has:novel",
    description: "Open roasted patches where AI surfaced new or precedent-linked objections",
  },
  {
    id: "unroasted-open",
    name: "Unroasted open patches",
    query: "status:open is:unroasted",
    description: "Open CommitFest patches that have not been roasted yet",
  },
  {
    id: "ci-needs-attention",
    name: "Needs rebase / CI failing",
    query: "status:open cfbot:fail",
    description: "Open patches with failing CFBot builds or needing rebase",
  },
  {
    id: "starred-queue",
    name: "★ Starred",
    query: "is:starred",
    description: "Your locally starred CommitFest entries",
  },
];

const VERDICT_ALIASES: Record<string, string> = {
  clean: "NO-FUNDAMENTAL-OBJECTION",
  nfo: "NO-FUNDAMENTAL-OBJECTION",
  "no-fundamental-objection": "NO-FUNDAMENTAL-OBJECTION",
  committer: "NEEDS-COMMITTER-EYES",
  nce: "NEEDS-COMMITTER-EYES",
  "needs-committer-eyes": "NEEDS-COMMITTER-EYES",
  design: "NEEDS-DESIGN-DISCUSSION",
  ndd: "NEEDS-DESIGN-DISCUSSION",
  "needs-design-discussion": "NEEDS-DESIGN-DISCUSSION",
  reject: "LIKELY-REJECT",
  "likely-reject": "LIKELY-REJECT",
  unroasted: "UNROASTED",
  none: "UNROASTED",
};

const STATUS_ALIASES: Record<string, string> = {
  ready: "Ready for Committer",
  rfc: "Ready for Committer",
  review: "Needs review",
  author: "Waiting on Author",
  woa: "Waiting on Author",
  committed: "Committed",
  returned: "Returned with feedback",
  withdrawn: "Withdrawn",
  rejected: "Rejected",
  moved: "Moved to next CF",
};

/**
 * Parses structured search tokens mixed with free text.
 * Supports quoted values like `author:"Tom Lane"` or `topic:"Query Performance"`.
 */
export function parseEntryQuery(raw: string): ParsedEntryQuery {
  const out: ParsedEntryQuery = { freeText: [] };
  const input = (raw || "").trim();
  if (!input) return out;

  const tokens: string[] = [];
  const tokenRe = /([a-zA-Z_]+:"[^"]*"|"[^"]+"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(input)) !== null) {
    tokens.push(m[1]!);
  }

  for (const tok of tokens) {
    const colonIdx = tok.indexOf(":");
    if (colonIdx > 0 && !tok.startsWith('"')) {
      const key = tok.slice(0, colonIdx).toLowerCase();
      const val = tok.slice(colonIdx + 1).replace(/^"|"$/g, "").trim();
      const valLower = val.toLowerCase();
      if (!val) continue;

      if (key === "verdict" || key === "v") {
        const mapped = VERDICT_ALIASES[valLower];
        if (mapped === "UNROASTED") out.unroastedOnly = true;
        else if (mapped) out.verdict = mapped;
        else out.verdict = val.toUpperCase();
        continue;
      }
      if (key === "status" || key === "s") {
        if (valLower === "open") out.openOnly = true;
        else if (valLower === "closed") out.closedOnly = true;
        else out.status = STATUS_ALIASES[valLower] || val;
        continue;
      }
      if (key === "cfbot" || key === "ci") {
        if (valLower === "pass" || valLower === "passing" || valLower === "ok") out.cfbot = "passing";
        else if (valLower === "rebase" || valLower === "needs_rebase") out.cfbot = "needs_rebase";
        else if (valLower === "fail" || valLower === "failing" || valLower === "broken") out.cfbot = "failing_or_rebase";
        continue;
      }
      if (key === "has") {
        if (valLower === "novel" || valLower === "new") out.hasNovel = true;
        else if (valLower === "star" || valLower === "starred") out.starredOnly = true;
        continue;
      }
      if (key === "is") {
        if (valLower === "starred" || valLower === "star") out.starredOnly = true;
        else if (valLower === "unvisited" || valLower === "unread") out.unvisitedOnly = true;
        else if (valLower === "unroasted") out.unroastedOnly = true;
        else if (valLower === "mine") out.mineOnly = true;
        else if (valLower === "open") out.openOnly = true;
        else if (valLower === "closed") out.closedOnly = true;
        continue;
      }
      if (key === "no") {
        if (valLower === "committer") out.noCommitter = true;
        else if (valLower === "reviewer" || valLower === "reviewers") out.noReviewer = true;
        continue;
      }
      if (key === "tag" || key === "t") {
        out.tag = valLower;
        continue;
      }
      if (key === "author" || key === "from") {
        out.author = val;
        continue;
      }
      if (key === "reviewer") {
        out.reviewer = val;
        continue;
      }
      if (key === "topic") {
        out.topic = val;
        continue;
      }
    }
    out.freeText.push(tok.replace(/^"|"$/g, ""));
  }

  return out;
}
