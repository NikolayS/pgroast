// Render the proposal (CommitFest entry, visible thread, patch prose) as prompt text.

import type { ProposalInput, ThreadMessage } from "../thread/types.ts";

export interface MaterialOptions {
  /** Total character budget for message bodies. */
  maxThreadChars?: number;
  maxFirstMessageChars?: number;
  maxMessageChars?: number;
  /** Show only the first N visible messages (used for the synthesis prompt). */
  maxMessages?: number;
}

const DEFAULTS = { maxThreadChars: 150_000, maxFirstMessageChars: 30_000, maxMessageChars: 6_000 };

/** "Name <addr>" -> "Name". Addresses are of no use to the model. */
export function displayName(from: string): string {
  return from.replace(/\s*<[^>]*>\s*$/, "").trim() || from;
}

/** Collapse long runs of quoted lines: replies quote the whole thread again and again. */
export function trimQuotes(body: string, keep = 3): string {
  const out: string[] = [];
  let run = 0;
  let trimmed = false;
  for (const line of body.split("\n")) {
    if (/^\s*>/.test(line)) {
      run++;
      if (run <= keep) out.push(line);
      else if (!trimmed) {
        out.push("> [... quoted text trimmed ...]");
        trimmed = true;
      }
    } else {
      if (line.trim() !== "") {
        run = 0;
        trimmed = false;
      }
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n[... message truncated ...]" : s;
}

function renderMessage(m: ThreadMessage, body: string | null): string {
  const head = `### Message #${m.index} | ${displayName(m.from)} | ${m.date.slice(0, 10)} | ${m.subject}`;
  const atts = m.attachments.length ? `\nAttachments: ${m.attachments.map((a) => a.name).join(", ")}` : "";
  return `${head}\n\n${body ?? "[omitted for length]"}${atts}`;
}

export function renderMaterial(p: ProposalInput, opts: MaterialOptions = {}): { text: string; omitted: number } {
  const o = { ...DEFAULTS, ...opts };
  const parts: string[] = [];

  if (p.cf) {
    const cf = p.cf;
    const lines = [`## CommitFest entry ${cf.id}`, `Title: ${cf.title}`, `Authors: ${cf.authors || "(not given)"}`];
    if (cf.tags.length) lines.push(`Tags: ${cf.tags.join(", ")}`);
    if (cf.topic) lines.push(`Topic: ${cf.topic}`);
    if (cf.redacted) {
      lines.push("Status, reviewers, committer and history: withheld (evaluation mode).");
    } else {
      lines.push(`Status: ${cf.status ?? "?"}${cf.statuses.length > 1 ? ` (in ${cf.statuses.length} CommitFests so far)` : ""}`);
      if (cf.reviewers) lines.push(`Reviewers: ${cf.reviewers}`);
      if (cf.committer) lines.push(`Committer: ${cf.committer}`);
      if (cf.targetVersion) lines.push(`Target version: ${cf.targetVersion}`);
    }
    if (cf.history.length) {
      lines.push("History:");
      for (const h of [...cf.history].reverse().slice(-15)) lines.push(`- ${h.when.slice(0, 10)} ${h.who}: ${h.what}`);
    }
    parts.push(lines.join("\n"));
  }

  const all = opts.maxMessages ? p.thread.messages.slice(0, opts.maxMessages) : p.thread.messages;
  const mode: string[] = [];
  if (p.filters.blind != null) mode.push(`blind mode: only the first ${p.filters.blind} messages are shown`);
  if (p.filters.before) mode.push(`only messages before ${p.filters.before} are shown`);
  const shownNote =
    p.filters.blind != null || p.filters.before
      ? `${all.length} messages shown; ${mode.join("; ")}. The rest of the thread is hidden on purpose: judge the idea, do not guess how the discussion went on.`
      : all.length < p.thread.messages.length
        ? `first ${all.length} of ${p.thread.messages.length} messages shown`
        : `all ${all.length} messages shown`;

  // Budget: message #1, then the next nine, then from the newest backwards.
  const bodies = all.map((m, i) => clip(i === 0 ? m.body : trimQuotes(m.body), i === 0 ? o.maxFirstMessageChars : o.maxMessageChars));
  const order = [...all.keys()].slice(0, 10).concat([...all.keys()].slice(10).reverse());
  const keep = new Set<number>();
  let used = 0;
  for (const i of order) {
    if (used + bodies[i]!.length > o.maxThreadChars && keep.size > 0) continue;
    keep.add(i);
    used += bodies[i]!.length;
  }
  const omitted = all.length - keep.size;

  parts.push(
    [
      `## Thread: ${p.thread.subject}`,
      `List: ${p.thread.lists.join(", ") || "?"}. Started ${p.threadStart.slice(0, 10)}. ${shownNote.replace(/\.$/, "")}${omitted ? `; ${omitted} long middle messages omitted for length` : ""}.`,
      ...all.map((m, i) => renderMessage(m, keep.has(i) ? bodies[i]! : null)),
    ].join("\n\n"),
  );

  if (p.patchProse.length) {
    const lines = ["## Patch prose (commit messages, touched files, documentation hunks; code is never shown)"];
    for (const pp of p.patchProse) {
      lines.push(`### ${pp.attachment.name} (attached to message #${pp.fromMessageIndex}, ${pp.attachment.sizeText})`);
      for (const cm of pp.commitMessages) lines.push(`Commit message:\n${cm.subject}\n\n${cm.body}`.trim());
      if (pp.files.length) lines.push(`Files touched:\n${pp.files.map((f) => `- ${f}`).join("\n")}`);
      for (const h of pp.docHunks) lines.push(`Documentation hunk (${h.path}):\n${h.text}`);
      if (pp.commitMessages.length === 0 && pp.docHunks.length === 0) lines.push("(no commit message and no documentation changes in this file)");
      if (pp.truncated) lines.push("(prose truncated for length)");
    }
    parts.push(lines.join("\n\n"));
  } else {
    parts.push("## Patch prose\n\nNo readable patch attachment in the visible messages.");
  }
  return { text: parts.join("\n\n"), omitted };
}

/** All text of the visible proposal, for the URL allow list and quote checks. */
export function materialRawText(p: ProposalInput): string {
  return [
    ...p.thread.messages.map((m) => m.body),
    ...p.patchProse.flatMap((pp) => [...pp.commitMessages.map((c) => c.subject + "\n" + c.body), ...pp.docHunks.map((h) => h.text)]),
  ].join("\n\n");
}
