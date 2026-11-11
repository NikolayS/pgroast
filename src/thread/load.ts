// Resolve a CLI argument to a CommitFest entry and/or a mailing-list thread, fetch it
// (cached, polite), apply --blind / --before, and collect the prose of the proposal's patches.

import { fetchText } from "./fetch.ts";
import { flatThreadUrl, parseCommitfestPatch, parseFlatThread } from "./parse.ts";
import { extractPatchProse, isReadableAttachment, MAX_DOC_HUNK_CHARS } from "./patchprose.ts";
import type {
  CfEntry,
  InputRef,
  LoadOptions,
  PatchProse,
  ProposalInput,
  Thread,
  ThreadMessage,
} from "./types.ts";

/** Attachments larger than this are not downloaded. */
export const MAX_ATTACHMENT_BYTES = 1536 * 1024;
/** At most this many attachments are read per run. */
export const MAX_ATTACHMENTS = 8;

export function parseInputRef(arg: string): InputRef {
  const s = arg.trim();
  if (/^\d+$/.test(s)) return { kind: "cf", id: Number(s) };

  const cf = s.match(/^https?:\/\/commitfest\.postgresql\.org\/(?:patch\/(\d+)|\d+\/(\d+))\/?/i);
  if (cf) return { kind: "cf", id: Number(cf[1] ?? cf[2]) };

  const arch = s.match(
    /^https?:\/\/(?:www\.)?postgresql\.org\/message-id\/(?:flat\/|raw\/|mbox\/)?([^?#]+?)\/?(?:[?#].*)?$/i,
  );
  const short = s.match(/^https?:\/\/postgr\.es\/m\/([^?#]+?)\/?(?:[?#].*)?$/i);
  const raw = arch?.[1] ?? short?.[1];
  if (raw) {
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      // keep as is
    }
    return { kind: "msgid", messageId: id };
  }
  if (/^<?[^\s<>@]+@[^\s<>@]+>?$/.test(s)) return { kind: "msgid", messageId: s.replace(/^<|>$/g, "") };
  throw new Error(
    `cannot understand input "${arg}": expected a CommitFest patch id or URL, a message-id, or a postgresql.org thread URL`,
  );
}

export function validateDate(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + "T00:00:00Z"))) {
    throw new Error(`bad date "${d}": expected YYYY-MM-DD`);
  }
  return d;
}

/** Apply --before (strictly before the date, UTC) and --blind (first N). Both may apply. */
export function filterMessages(
  messages: ThreadMessage[],
  opts: { blind?: number | null; before?: string | null },
): ThreadMessage[] {
  let out = messages;
  if (opts.before) {
    const cutoff = validateDate(opts.before) + "T00:00:00Z";
    out = out.filter((m) => m.date !== "" && m.date < cutoff);
  }
  if (opts.blind != null) {
    if (!Number.isInteger(opts.blind) || opts.blind < 1) throw new Error("--blind needs a positive integer");
    out = out.slice(0, opts.blind);
  }
  return out;
}

/**
 * Remove what would reveal the outcome. With --blind the whole status/history/reviewer
 * part goes; with only --before, history entries before the cutoff are kept.
 */
export function redactCf(cf: CfEntry, opts: { blind?: number | null; before?: string | null }): CfEntry {
  if (opts.blind == null && !opts.before) return cf;
  const cutoff = opts.before ? opts.before + "T00:00:00Z" : null;
  return {
    ...cf,
    status: null,
    statuses: [],
    reviewers: "",
    committer: "",
    targetVersion: "",
    links: [],
    history:
      opts.blind == null && cutoff
        ? cf.history.filter((h) => h.when < cutoff && !/^Closed in commitfest/i.test(h.what))
        : [],
    threads: cf.threads.map((t) => ({ ...t, latestAt: null })),
    redacted: true,
  };
}

/** Messages whose attachments describe the proposal: the first with a patch, and the author's latest. */
export function pickProposalMessages(messages: ThreadMessage[]): ThreadMessage[] {
  const withPatch = messages.filter((m) => m.attachments.some((a) => isReadableAttachment(a.name, a.contentType)));
  if (withPatch.length === 0) return [];
  const first = withPatch[0]!;
  const author = messages[0]?.from ?? first.from;
  const latestByAuthor = [...withPatch].reverse().find((m) => m.from === author) ?? first;
  return latestByAuthor === first ? [first] : [latestByAuthor, first];
}

async function loadPatchProse(
  messages: ThreadMessage[],
  opts: LoadOptions,
  warnings: string[],
): Promise<PatchProse[]> {
  const out: PatchProse[] = [];
  let budget = MAX_ATTACHMENTS;
  for (const msg of pickProposalMessages(messages)) {
    for (const att of msg.attachments) {
      if (!isReadableAttachment(att.name, att.contentType)) continue;
      if (budget <= 0) {
        warnings.push(`attachment limit (${MAX_ATTACHMENTS}) reached; ${att.name} not read`);
        continue;
      }
      if (att.sizeBytes != null && att.sizeBytes > MAX_ATTACHMENT_BYTES) {
        warnings.push(`attachment ${att.name} (${att.sizeText}) is too large; not read`);
        continue;
      }
      budget--;
      const text = await fetchText(att.url, {
        offline: opts.offline,
        cacheDir: opts.cacheDir,
        maxBytes: MAX_ATTACHMENT_BYTES,
      });
      if (text == null) {
        warnings.push(`attachment ${att.name} could not be read`);
        continue;
      }
      if (text.includes("\u0000")) {
        warnings.push(`attachment ${att.name} looks binary; skipped`);
        continue;
      }
      const prose = extractPatchProse(text);
      if (prose.files.length === 0 && prose.commitMessages.length === 0) {
        // Not a diff. Keep it only when it is plainly a prose file (README, notes).
        if (!/README|\.(md|txt)$/i.test(att.name)) continue;
        const cut = text.length > MAX_DOC_HUNK_CHARS;
        out.push({
          attachment: att,
          fromMessageIndex: msg.index,
          commitMessages: [],
          files: [],
          docHunks: [{ path: att.name, text: cut ? text.slice(0, MAX_DOC_HUNK_CHARS) + "\n[... truncated ...]" : text }],
          truncated: cut,
        });
        continue;
      }
      out.push({ attachment: att, fromMessageIndex: msg.index, ...prose });
    }
  }
  return out;
}

export async function loadCfEntry(id: number, opts: LoadOptions = {}): Promise<CfEntry> {
  const url = `https://commitfest.postgresql.org/patch/${id}/`;
  const html = await fetchText(url, { offline: opts.offline, cacheDir: opts.cacheDir });
  if (html == null) throw new Error(`CommitFest patch ${id} not found (${url})`);
  return parseCommitfestPatch(html, id);
}

export async function loadThread(messageId: string, opts: LoadOptions = {}): Promise<Thread> {
  const url = flatThreadUrl(messageId);
  const html = await fetchText(url, { offline: opts.offline, cacheDir: opts.cacheDir });
  if (html == null) throw new Error(`thread not found: ${url}`);
  return parseFlatThread(html);
}

export async function loadProposal(arg: string, opts: LoadOptions = {}): Promise<ProposalInput> {
  const ref = parseInputRef(arg);
  const warnings: string[] = [];
  const filters = { blind: opts.blind ?? null, before: opts.before ? validateDate(opts.before) : null };

  let cf: CfEntry | null = null;
  let messageId: string;
  if (ref.kind === "cf") {
    const full = await loadCfEntry(ref.id, opts);
    if (full.threads.length === 0) throw new Error(`CommitFest patch ${ref.id} has no mailing-list thread attached`);
    // The proposal thread is the one that started first.
    const sorted = [...full.threads].sort((a, b) => (a.firstAt ?? "9999").localeCompare(b.firstAt ?? "9999"));
    messageId = sorted[0]!.messageId;
    if (sorted.length > 1) {
      warnings.push(
        `CommitFest entry has ${sorted.length} threads; only the earliest is read (${sorted[0]!.url}). Others: ` +
          sorted
            .slice(1)
            .map((t) => t.url)
            .join(", "),
      );
    }
    cf = redactCf(full, filters);
  } else if (ref.kind === "msgid") {
    messageId = ref.messageId;
  } else {
    throw new Error("a local draft is loaded with loadLocalProposal(), not from the archives");
  }

  const full = await loadThread(messageId, opts);
  const messages = filterMessages(full.messages, filters);
  if (messages.length === 0) {
    throw new Error(
      `no messages left after filtering (thread has ${full.messages.length}, first on ${full.messages[0]!.date}; --before ${filters.before ?? "-"}, --blind ${filters.blind ?? "-"})`,
    );
  }
  if (ref.kind === "msgid" && full.rootMessageId !== ref.messageId) {
    warnings.push(`the given message is not the thread root; reading the whole thread from ${full.threadUrl}`);
  }
  const thread: Thread = { ...full, messages };
  const patchProse = opts.noAttachments ? [] : await loadPatchProse(messages, opts, warnings);

  return {
    input: arg,
    ref,
    cf,
    thread,
    totalMessages: full.messages.length,
    filters,
    threadStart: full.messages[0]!.date,
    patchProse,
    warnings,
  };
}
