import type {
  AllGatesResult,
  DraftAttachment,
  GateCheckResult,
  GateIssue,
} from "../types.ts";

// ============================================================================
// Gate 1: Public-Confidentiality Hard Rule (pg-correctness-harness / pg-hackers-lead)
// HARD BLOCK on leaked model names, internal process terms, or local paths.
// Explicitly ALLOWS "My AI harness" and factual AI disclosure ("AI found...", etc.).
// ============================================================================

interface ForbiddenPattern {
  code: string;
  regex: RegExp;
  label: string;
}

const CONFIDENTIALITY_PATTERNS: ForbiddenPattern[] = [
  // Model / vendor names
  { code: "model_opus", regex: /\bopus(?:\s*[\d.]+)?\b/gi, label: "Model name (Opus)" },
  { code: "model_mythos", regex: /\bmythos(?:\s*[\d.]+)?\b/gi, label: "Model name (Mythos)" },
  { code: "model_fable", regex: /\bfable(?:\s*[\d.]+)?\b/gi, label: "Model name (Fable)" },
  { code: "model_sonnet", regex: /\bsonnet(?:\s*[\d.]+)?\b/gi, label: "Model name (Sonnet)" },
  { code: "model_haiku", regex: /\bhaiku(?:\s*[\d.]+)?\b/gi, label: "Model name (Haiku)" },
  { code: "model_claude", regex: /\bclaude(?:\s+code)?\b/gi, label: "Model/tool name (Claude)" },
  { code: "model_gemini", regex: /\bgemini(?:\s*[\d.]+)?\b/gi, label: "Model name (Gemini)" },
  { code: "model_neon", regex: /\b(?:gemini[\s-]*4[\s-]*)?neon(?:[\s-]*(?:high|xhigh|medium))?\b/gi, label: "Model name (Neon)" },
  { code: "model_codex", regex: /\bcodex\b/gi, label: "Model/tool name (Codex)" },
  { code: "model_astra", regex: /\bastra\b/gi, label: "Model name (Astra)" },
  { code: "model_gpt", regex: /\bgpt(?:[-\s]*[\d.]+(?:[-\s]*(?:sol|astra|daybreak))?)?\b/gi, label: "Model name (GPT)" },
  { code: "model_antigravity", regex: /\bantigravity\b/gi, label: "Internal tool name (Antigravity)" },

  // Internal process / skill / gate terminology
  { code: "proc_harness_gate", regex: /\bharness\s+gates?\b/gi, label: "Internal term (harness gate)" },
  { code: "proc_blind_gate", regex: /\bblind\s+(?:review\s+)?gate\b/gi, label: "Internal term (blind gate)" },
  { code: "proc_review_gate", regex: /\b(?:full\s+)?review\s+gate\b/gi, label: "Internal term (review gate)" },
  { code: "proc_duplicate_gate", regex: /\b(?:final\s+)?duplicate\s+gate\b/gi, label: "Internal term (duplicate gate)" },
  { code: "proc_independent_reviewer", regex: /\bindependent\s+reviewers?\b/gi, label: "Internal term (independent reviewer)" },
  { code: "proc_subagent", regex: /\bsub-?agents?\b/gi, label: "Internal term (subagent)" },
  { code: "proc_worker_agent", regex: /\b(?:worker\s+agents?|agent\s+workers?|ai\s+workers?)\b/gi, label: "Internal term (worker agent)" },
  { code: "proc_worker_word", regex: /\bworkers?\b(?=\s+(?:ran|tested|built|checked|verified|found|spawned|worktree))/gi, label: "Internal term (worker)" },
  { code: "proc_skill_harness", regex: /\bpg-correctness-harness\b/gi, label: "Private skill name (pg-correctness-harness)" },
  { code: "proc_skill_lead", regex: /\bpg-hackers-lead\b/gi, label: "Private skill name (pg-hackers-lead)" },
  { code: "proc_skills_repo", regex: /\b[A-Za-z0-9_-]+\/skills\b/gi, label: "Private skills repo reference" },

  // Local machine paths (catch any user's home directory path)
  { code: "local_path_home_dir", regex: /\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s"']*)?/g, label: "Local machine path (/Users/... or /home/...)" },
  { code: "local_path_home_github", regex: /~\/github\/[^\s"']*/g, label: "Local path (~/github/...)" },
  { code: "local_path_home_gitlab", regex: /~\/gitlab\/[^\s"']*/g, label: "Local path (~/gitlab/...)" },
  { code: "local_path_claude_dir", regex: /~\/\.claude(?:\/[^\s"']*)?/g, label: "Local path (~/.claude)" },
];

export function publicConfidentialityCheck(text: string): GateCheckResult {
  const issues: GateIssue[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Skip quoted lines written by someone else in the thread (lines starting with ">")
    if (/^\s*>/.test(line)) continue;

    for (const pat of CONFIDENTIALITY_PATTERNS) {
      pat.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pat.regex.exec(line)) !== null) {
        issues.push({
          code: pat.code,
          severity: "block",
          message: `Public-confidentiality HARD BLOCK: ${pat.label} detected ("${match[0]}"). Remove internal model, skill, gate, agent, or local path references. Only "My AI harness" and factual AI disclosure are allowed publicly.`,
          match: match[0],
          line: i + 1,
        });
      }
    }
  }

  return {
    gate: "confidentiality",
    passed: issues.length === 0,
    blocking: issues.length > 0,
    issues,
  };
}

// ============================================================================
// Gate 2: cfbot Attachment Safety Guard
// cfbot picks the latest message in a thread with .patch / .diff (optionally .gz/.bz2)
// or archives (.tar, .tgz, .tar.gz, .tar.bz2, .zip) unless prefixed with "nocfbot"
// or suffixed with ".txt".
// ============================================================================

const CFBOT_TRIGGER_EXT = /\.(?:patch|diff)(?:\.(?:gz|bz2))?$|\.(?:tar|tgz|tar\.gz|tar\.bz2|zip)$/i;

export function cfbotAttachmentCheck(
  attachments: DraftAttachment[],
  isOtherAuthorThread: boolean,
): GateCheckResult {
  const issues: GateIssue[] = [];

  for (const att of attachments) {
    const name = (att.filename || "").trim();
    if (!name) continue;

    // Warn against attaching raw drafts/logs
    if (/(?:draft|harness|transcript|agent-log|review-notes)/i.test(name)) {
      issues.push({
        code: "internal_attachment_name",
        severity: "warn",
        message: `Attachment "${name}" looks like internal notes/logs; keep drafts and harness logs out of public attachments.`,
        match: name,
      });
    }

    if (isOtherAuthorThread) {
      const lower = name.toLowerCase();
      const triggersCfbot = CFBOT_TRIGGER_EXT.test(lower);
      const isSafePrefix = lower.startsWith("nocfbot");
      const isTxtSuffix = lower.endsWith(".txt");

      if (triggersCfbot && !isSafePrefix && !isTxtSuffix) {
        issues.push({
          code: "cfbot_hijack_risk",
          severity: "block",
          message: `cfbot safety guard: attaching "${name}" to another author's CommitFest thread will cause cfbot to drop their patch series! Rename to "nocfbot-${name}" or "${name}.txt".`,
          match: name,
        });
      }
    }
  }

  const blocking = issues.some((i) => i.severity === "block");
  return {
    gate: "cfbot_attachments",
    passed: issues.length === 0,
    blocking,
    issues,
  };
}

// ============================================================================
// Gate 3: Plain-Text Mailing List Etiquette & Nik-Voice Linter
// ============================================================================

const UPPERCASE_SQL_REGEX = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|FUNCTION|EXTENSION)|ALTER\s+(?:TABLE|SYSTEM|INDEX)|DROP\s+(?:TABLE|INDEX|VIEW)|VACUUM\s+(?:FULL|ANALYZE|VERBOSE))\b/;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const BANNED_FILLER_REGEX = /\b(importantly|notably|crucially|it'?s worth noting)\b/gi;

function isExemptFromWrap(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\s*>/.test(line)) return true; // quoted line
  if (/^On .+ wrote:$/.test(trimmed)) return true; // attribution line
  if (/^\[\d+\]\s+https?:\/\//.test(trimmed)) return true; // numbered URL ref
  if (/https?:\/\/\S+/.test(trimmed)) return true; // contains URL
  if (/^(?:\s{2,}|\t)/.test(line)) return true; // indented code / SQL / output
  if (/^(?:diff --git|@@ |\+\+\+ |--- |\+|-)/.test(line)) return true; // diff hunk
  if (/^(?:select|insert|update|delete|create|alter|drop|explain|vacuum|analyze|with|psql|meson|ninja|git)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function plainTextEtiquetteCheck(
  body: string,
  isReply: boolean,
  subject?: string,
): GateCheckResult {
  const issues: GateIssue[] = [];
  const lines = body.split(/\r?\n/);

  if (!body.trim()) {
    issues.push({
      code: "empty_body",
      severity: "block",
      message: "Email body is empty.",
    });
    return {
      gate: "plain_text_etiquette",
      passed: false,
      blocking: true,
      issues,
    };
  }

  // Check NBSP
  if (body.includes("\u00a0")) {
    issues.push({
      code: "nbsp_present",
      severity: "warn",
      message: "Body contains non-breaking space (U+00A0), which breaks inline SQL copy-paste.",
    });
  }

  // Check Markdown fenced code blocks
  if (/```/.test(body)) {
    issues.push({
      code: "markdown_fence",
      severity: "warn",
      message: "Markdown fenced code blocks (```) are not allowed on pgsql-hackers; put SQL and output in plain text.",
    });
  }

  // Check Markdown links [text](http...)
  const mdLinkMatch = body.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/);
  if (mdLinkMatch) {
    issues.push({
      code: "markdown_link",
      severity: "warn",
      message: `Markdown link found ("${mdLinkMatch[0]}"). Use numbered references [1] and place full URLs at the bottom before sign-off.`,
      match: mdLinkMatch[0],
    });
  }

  let hasQuoteLine = false;
  let hasAttribution = false;
  let firstQuoteIdx = -1;
  let firstNonEmptyNonQuoteIdx = -1;
  let longLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const isQuoted = /^\s*>/.test(line);

    if (/^On .+ wrote:$/.test(trimmed)) hasAttribution = true;
    if (isQuoted) {
      hasQuoteLine = true;
      if (firstQuoteIdx === -1) firstQuoteIdx = i;
      continue;
    }

    if (trimmed && firstNonEmptyNonQuoteIdx === -1 && !/^On .+ wrote:$/.test(trimmed)) {
      firstNonEmptyNonQuoteIdx = i;
    }

    // Inline backticks
    if (/`[^`]+`/.test(line)) {
      issues.push({
        code: "inline_backticks",
        severity: "warn",
        message: `Line ${i + 1} uses inline Markdown backticks. Use plain text without backticks.`,
        line: i + 1,
      });
    }

    // Markdown headings
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      issues.push({
        code: "markdown_heading",
        severity: "warn",
        message: `Line ${i + 1} uses a Markdown heading. Use plain text paragraphs.`,
        line: i + 1,
      });
    }

    // Line length > 78 cols (excluding SQL/URLs/quotes)
    if (line.length > 78 && !isExemptFromWrap(line)) {
      longLines++;
    }

    // Uppercase SQL keywords in non-quoted text
    const sqlMatch = line.match(UPPERCASE_SQL_REGEX);
    if (sqlMatch) {
      issues.push({
        code: "uppercase_sql",
        severity: "warn",
        message: `Line ${i + 1} uses uppercase SQL keyword ("${sqlMatch[1]}"). Nik's style uses lowercase SQL keywords.`,
        match: sqlMatch[1],
        line: i + 1,
      });
    }

    // Em-dashes
    if (line.includes("—")) {
      issues.push({
        code: "em_dash",
        severity: "warn",
        message: `Line ${i + 1} contains an em-dash (—). Avoid em-dashes in Nik's voice.`,
        line: i + 1,
      });
    }

    // Emojis
    if (EMOJI_REGEX.test(line)) {
      issues.push({
        code: "emoji",
        severity: "warn",
        message: `Line ${i + 1} contains an emoji. Keep pgsql-hackers mail strictly plain text.`,
        line: i + 1,
      });
    }

    // Nik-voice banned filler
    BANNED_FILLER_REGEX.lastIndex = 0;
    const fillerMatch = BANNED_FILLER_REGEX.exec(line);
    if (fillerMatch) {
      issues.push({
        code: "banned_filler",
        severity: "warn",
        message: `Line ${i + 1} uses banned AI filler ("${fillerMatch[0]}"). Rewrite directly.`,
        match: fillerMatch[0],
        line: i + 1,
      });
    }
  }

  if (longLines > 0) {
    issues.push({
      code: "line_length",
      severity: "warn",
      message: `${longLines} prose line(s) exceed 78 columns. Wrap prose at 72–75 columns.`,
    });
  }

  if (isReply) {
    if (!hasQuoteLine) {
      issues.push({
        code: "missing_quote",
        severity: "warn",
        message: "Reply is missing a contextual '>' quote. Quote the passage being answered and bottom-post below it.",
      });
    }
    if (!hasAttribution) {
      issues.push({
        code: "missing_attribution",
        severity: "warn",
        message: "Reply is missing the exact 'On <date>, <Name> <email> wrote:' attribution line.",
      });
    }
    if (hasQuoteLine && firstNonEmptyNonQuoteIdx !== -1 && firstNonEmptyNonQuoteIdx < firstQuoteIdx) {
      // Allow a short greeting like "Hi Andrey," before the attribution/quote
      const firstLine = (lines[firstNonEmptyNonQuoteIdx] ?? "").trim();
      if (!/^(?:Hi|Hello|Thanks)\b/i.test(firstLine)) {
        issues.push({
          code: "top_posting",
          severity: "warn",
          message: "Possible top-posting detected (prose appears before the first '>' quote). Bottom-post or interleave replies.",
        });
      }
    }
  } else {
    // New thread checks
    const trimmedBody = body.trim();
    if (!trimmedBody.startsWith("Hi hackers,")) {
      issues.push({
        code: "new_thread_greeting",
        severity: "info",
        message: 'New pgsql-hackers threads should start with "Hi hackers,".',
      });
    }
    if (!/\nNik\s*$/.test(trimmedBody)) {
      issues.push({
        code: "new_thread_signoff",
        severity: "info",
        message: 'New pgsql-hackers threads should sign off with "Nik".',
      });
    }
  }

  if (subject !== undefined && !subject.trim()) {
    issues.push({
      code: "empty_subject",
      severity: "warn",
      message: "Email subject is empty.",
    });
  }

  return {
    gate: "plain_text_etiquette",
    passed: issues.filter((i) => i.severity !== "info").length === 0,
    blocking: issues.some((i) => i.severity === "block"),
    issues,
  };
}

// ============================================================================
// Gate 4: Duplicate & Thread Freshness Gate
// ============================================================================

export interface DuplicateGateInput {
  cfId?: number | null;
  subject: string;
  inReplyTo?: string;
  existingDraftCount?: number;
  similarGmailMatches?: Array<{ subject: string; date: string; from: string }>;
  knownLatestMessageTime?: string;
  liveLatestMessageTime?: string;
  lastSyncedAt?: string;
  selfEmail?: string;
  selfName?: string;
}

export function duplicateGateCheck(input: DuplicateGateInput): GateCheckResult {
  const issues: GateIssue[] = [];

  if ((input.existingDraftCount ?? 0) > 1) {
    issues.push({
      code: "multiple_local_drafts",
      severity: "warn",
      message: `Found ${input.existingDraftCount} saved local drafts for this entry. Verify you are not preparing a duplicate reply.`,
    });
  }

  if (input.similarGmailMatches && input.similarGmailMatches.length > 0) {
    const needles = [input.selfEmail, input.selfName]
      .map((s) => (s || "").trim().toLowerCase())
      .filter((s) => s.length >= 3);
    const sentBySelf =
      needles.length > 0
        ? input.similarGmailMatches.filter((m) => {
            const fromLower = m.from.toLowerCase();
            return needles.some((n) => fromLower.includes(n));
          })
        : [];
    if (sentBySelf.length > 0) {
      issues.push({
        code: "recent_self_message",
        severity: "warn",
        message: `Found ${sentBySelf.length} prior message(s) from you on a matching subject/thread (latest: ${sentBySelf[0]?.date || "unknown"}). Confirm this reply adds material new evidence.`,
      });
    }
  }

  if (
    input.knownLatestMessageTime &&
    input.liveLatestMessageTime &&
    input.liveLatestMessageTime > input.knownLatestMessageTime
  ) {
    issues.push({
      code: "thread_moved",
      severity: "warn",
      message: `Thread moved since last local sync (${input.knownLatestMessageTime} -> ${input.liveLatestMessageTime}). Re-read the latest message before sending.`,
    });
  }

  if (!input.lastSyncedAt && input.cfId) {
    issues.push({
      code: "not_recently_synced",
      severity: "info",
      message: "Entry has not been live-synced from CommitFest in this session. Refresh before final send.",
    });
  }

  return {
    gate: "duplicate_freshness",
    passed: issues.filter((i) => i.severity !== "info").length === 0,
    blocking: issues.some((i) => i.severity === "block"),
    issues,
  };
}

export function runAllDraftGates(params: {
  body: string;
  subject: string;
  isReply: boolean;
  isOtherAuthorThread: boolean;
  attachments: DraftAttachment[];
  cfId?: number | null;
  inReplyTo?: string;
  existingDraftCount?: number;
  similarGmailMatches?: Array<{ subject: string; date: string; from: string }>;
  knownLatestMessageTime?: string;
  liveLatestMessageTime?: string;
  lastSyncedAt?: string;
  selfEmail?: string;
  selfName?: string;
}): AllGatesResult {
  const combinedPublicText = `${params.subject}\n${params.body}\n${params.attachments
    .map((a) => `${a.filename}\n${a.contentText || ""}`)
    .join("\n")}`;

  const confidentiality = publicConfidentialityCheck(combinedPublicText);
  const cfbot_attachments = cfbotAttachmentCheck(params.attachments, params.isOtherAuthorThread);
  const plain_text_etiquette = plainTextEtiquetteCheck(params.body, params.isReply, params.subject);
  const duplicate_freshness = duplicateGateCheck({
    cfId: params.cfId,
    subject: params.subject,
    inReplyTo: params.inReplyTo,
    existingDraftCount: params.existingDraftCount,
    similarGmailMatches: params.similarGmailMatches,
    knownLatestMessageTime: params.knownLatestMessageTime,
    liveLatestMessageTime: params.liveLatestMessageTime,
    lastSyncedAt: params.lastSyncedAt,
    selfEmail: params.selfEmail,
    selfName: params.selfName,
  });

  const allGates = [confidentiality, cfbot_attachments, plain_text_etiquette, duplicate_freshness];
  const blockCount = allGates.reduce(
    (sum, g) => sum + g.issues.filter((i) => i.severity === "block").length,
    0,
  );
  const warningCount = allGates.reduce(
    (sum, g) => sum + g.issues.filter((i) => i.severity === "warn").length,
    0,
  );
  const hardBlocked = confidentiality.blocking || cfbot_attachments.blocking || plain_text_etiquette.blocking;

  return {
    canSaveDraft: !hardBlocked,
    hardBlocked,
    warningCount,
    blockCount,
    gates: {
      confidentiality,
      cfbot_attachments,
      plain_text_etiquette,
      duplicate_freshness,
    },
  };
}

// ============================================================================
// Plain-Text Prose Wrapper (72-75 cols, preserving SQL, URLs, and '>' quotes)
// ============================================================================

export function wrapEmailBody(text: string, maxCol = 72): string {
  const lines = text.replace(/\u00a0/g, " ").split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    if (line.length <= maxCol || isExemptFromWrap(line)) {
      out.push(line);
      continue;
    }
    const words = line.split(/\s+/);
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxCol) {
        current += " " + word;
      } else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out.join("\n");
}

// ============================================================================
// RFC 2822 Plain-Text / Multipart MIME Builder (for Gmail Drafts API)
// ============================================================================

export interface Rfc2822Input {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: DraftAttachment[];
  date?: Date;
}

function sanitizeHeaderValue(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

function formatMessageIdHeader(id: string): string {
  const clean = sanitizeHeaderValue(id);
  if (!clean) return "";
  if (clean.startsWith("<") && clean.endsWith(">")) return clean;
  return `<${clean.replace(/^<|>$/g, "")}>`;
}

function chunkBase64(b64: string, width = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += width) {
    chunks.push(b64.slice(i, i + width));
  }
  return chunks.join("\r\n");
}

export function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildRfc2822Message(input: Rfc2822Input): {
  raw: string;
  base64url: string;
  attachmentCount: number;
} {
  const headers: string[] = [];
  headers.push(`From: ${sanitizeHeaderValue(input.from)}`);
  headers.push(`To: ${sanitizeHeaderValue(input.to)}`);
  if (input.cc?.trim()) {
    headers.push(`Cc: ${sanitizeHeaderValue(input.cc)}`);
  }
  headers.push(`Subject: ${sanitizeHeaderValue(input.subject)}`);
  headers.push(`Date: ${(input.date ?? new Date()).toUTCString()}`);
  headers.push("MIME-Version: 1.0");

  const inReplyTo = input.inReplyTo ? formatMessageIdHeader(input.inReplyTo) : "";
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }

  let refs = sanitizeHeaderValue(input.references || "");
  if (inReplyTo) {
    if (!refs) {
      refs = inReplyTo;
    } else if (!refs.includes(inReplyTo)) {
      refs = `${refs} ${inReplyTo}`;
    }
  }
  if (refs) {
    headers.push(`References: ${refs}`);
  }

  const normalizedBody = input.body.replace(/\r?\n/g, "\r\n");
  const validAttachments = (input.attachments ?? []).filter(
    (a) => a.filename && (a.contentBase64 || a.contentText !== undefined),
  );

  let raw: string;
  if (validAttachments.length === 0) {
    headers.push('Content-Type: text/plain; charset="utf-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    raw = `${headers.join("\r\n")}\r\n\r\n${normalizedBody}\r\n`;
  } else {
    const boundary = `----=_pgroast_app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts: string[] = [];
    parts.push(
      `--${boundary}\r\n` +
        `Content-Type: text/plain; charset="utf-8"\r\n` +
        `Content-Transfer-Encoding: 8bit\r\n\r\n` +
        `${normalizedBody}\r\n`,
    );

    for (const att of validAttachments) {
      const safeFilename = sanitizeHeaderValue(att.filename).replace(/"/g, "");
      const mimeType = att.mimeType || (safeFilename.endsWith(".md") ? "text/markdown" : "text/plain");
      const b64 = att.contentBase64
        ? att.contentBase64.replace(/\s+/g, "")
        : Buffer.from(att.contentText ?? "", "utf8").toString("base64");

      parts.push(
        `--${boundary}\r\n` +
          `Content-Type: ${mimeType}; name="${safeFilename}"\r\n` +
          `Content-Disposition: attachment; filename="${safeFilename}"\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n` +
          `${chunkBase64(b64)}\r\n`,
      );
    }

    parts.push(`--${boundary}--\r\n`);
    raw = `${headers.join("\r\n")}\r\n\r\n${parts.join("")}`;
  }

  return {
    raw,
    base64url: toBase64Url(raw),
    attachmentCount: validAttachments.length,
  };
}
