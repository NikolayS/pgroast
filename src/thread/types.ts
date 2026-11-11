// Types for the thread / CommitFest input layer.

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
  /** Size as shown by the archive, e.g. "33.5 KB". */
  sizeText: string;
  /** Approximate size in bytes parsed from sizeText, or null. */
  sizeBytes: number | null;
}

export interface ThreadMessage {
  /** 1-based position in the flat thread (archive order = by date). */
  index: number;
  messageId: string;
  /** Permalink of this message in the archive. */
  url: string;
  from: string;
  /** ISO 8601, UTC (the archive shows UTC). */
  date: string;
  subject: string;
  body: string;
  attachments: Attachment[];
}

export interface Thread {
  /** https://www.postgresql.org/message-id/flat/<root message-id> */
  threadUrl: string;
  rootMessageId: string;
  subject: string;
  lists: string[];
  messages: ThreadMessage[];
}

export interface CfThreadRef {
  messageId: string;
  url: string;
  subject: string;
  firstAt: string | null;
  firstBy: string;
  latestAt: string | null;
}

export interface CfHistoryItem {
  when: string;
  who: string;
  what: string;
}

export interface CfEntry {
  id: number;
  url: string;
  title: string;
  /** Status in the most recent CommitFest, e.g. "Needs review". Null when redacted. */
  status: string | null;
  statuses: { cfId: number; cfName: string; status: string }[];
  authors: string;
  reviewers: string;
  committer: string;
  tags: string[];
  topic: string;
  targetVersion: string;
  created: string | null;
  threads: CfThreadRef[];
  history: CfHistoryItem[];
  links: string[];
  /** True when outcome-bearing fields were removed for --blind / --before. */
  redacted: boolean;
}

export interface CommitMessage {
  subject: string;
  body: string;
}

/** The prose parts of one patch attachment. Never contains code hunks. */
export interface PatchProse {
  attachment: Attachment;
  fromMessageIndex: number;
  commitMessages: CommitMessage[];
  /** Paths touched (from the diff headers). Names only. */
  files: string[];
  /** Diff hunks for doc/, README* and *.md / *.sgml / *.rst files only. */
  docHunks: { path: string; text: string }[];
  truncated: boolean;
}

export interface LoadOptions {
  /** Keep only the first N messages. */
  blind?: number;
  /** Keep only messages strictly before this date (YYYY-MM-DD, UTC). */
  before?: string;
  offline?: boolean;
  cacheDir?: string;
  /** Skip attachment download. */
  noAttachments?: boolean;
}

export type InputRef = { kind: "cf"; id: number } | { kind: "msgid"; messageId: string };

export interface ProposalInput {
  /** The CLI argument as given. */
  input: string;
  ref: InputRef;
  cf: CfEntry | null;
  /** The thread after --blind / --before filtering. */
  thread: Thread;
  /** Number of messages in the thread before filtering. */
  totalMessages: number;
  filters: { blind: number | null; before: string | null };
  /** ISO date-time of the first message of the thread. */
  threadStart: string;
  patchProse: PatchProse[];
  warnings: string[];
}
