import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { buildChildEnv, expandHome } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import type {
  AllGatesResult,
  AppSettings,
  DraftAttachment,
  DraftRecord,
  GmailThreadMatch,
  RoastJson,
} from "../types.ts";
import { buildRfc2822Message, runAllDraftGates, wrapEmailBody } from "./gates.ts";
import { getDraftingSkillGuidance } from "./skills.ts";

function runGws(settings: AppSettings, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync("gws", args, {
    encoding: "utf8",
    env: buildChildEnv(settings),
    timeout: 30_000,
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function parseGwsJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // gws sometimes prints a warning line before JSON
    const idx = trimmed.indexOf("{");
    if (idx >= 0) {
      return JSON.parse(trimmed.slice(idx));
    }
    throw new Error(`Unexpected gws output: ${trimmed.slice(0, 200)}`);
  }
}

export function searchGmailThreads(
  settings: AppSettings,
  query: string,
  maxResults = 10,
): GmailThreadMatch[] {
  const listParams = JSON.stringify({
    userId: "me",
    q: query,
    maxResults: Math.min(Math.max(maxResults, 1), 25),
  });
  const listRes = runGws(settings, ["gmail", "users", "messages", "list", "--params", listParams]);
  if (!listRes.ok) {
    throw new Error(`gws messages.list failed: ${listRes.stderr || listRes.stdout || "unknown error"}`);
  }

  const listJson = parseGwsJson(listRes.stdout) as { messages?: Array<{ id: string; threadId: string }> } | null;
  const messages = listJson?.messages ?? [];
  const results: GmailThreadMatch[] = [];

  for (const m of messages.slice(0, maxResults)) {
    const getParams = JSON.stringify({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["Message-ID", "Message-Id", "References", "In-Reply-To", "From", "To", "Cc", "Subject", "Date"],
    });
    const getRes = runGws(settings, ["gmail", "users", "messages", "get", "--params", getParams]);
    if (!getRes.ok) continue;
    try {
      const msg = parseGwsJson(getRes.stdout) as {
        id?: string;
        threadId?: string;
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const hdrs = new Map<string, string>();
      for (const h of msg.payload?.headers ?? []) {
        hdrs.set(h.name.toLowerCase(), h.value);
      }
      results.push({
        gmailMessageId: msg.id || m.id,
        threadId: msg.threadId || m.threadId || "",
        messageIdHeader: hdrs.get("message-id") || "",
        references: hdrs.get("references") || "",
        from: hdrs.get("from") || "",
        to: hdrs.get("to") || "",
        cc: hdrs.get("cc") || "",
        subject: hdrs.get("subject") || "",
        date: hdrs.get("date") || "",
        snippet: msg.snippet || "",
      });
    } catch {
      continue;
    }
  }

  return results;
}

export interface GenerateDraftInput {
  cfId?: number | null;
  workItemId?: number | null;
  kind?: DraftRecord["kind"];
  isReply?: boolean;
  isOtherAuthorThread?: boolean;
  replyToAuthor?: string;
  replyToDate?: string;
  quotedPassage?: string;
  extraNotes?: string;
  includeFootnoteAttachment?: boolean;
  backend?: "template" | "claude" | "agy";
  model?: string;
}

function buildDeterministicDraft(
  input: GenerateDraftInput,
  entryTitle: string,
  roast: RoastJson | null,
  evidenceMd: string,
  threadUrl: string,
  authorName: string,
): { subject: string; body: string; attachments: DraftAttachment[] } {
  const isReply = input.isReply !== false;
  const subject = isReply
    ? (entryTitle.startsWith("Re:") ? entryTitle : `Re: ${entryTitle}`)
    : entryTitle;

  const lines: string[] = [];
  const refs: string[] = [];
  const addRef = (url: string): number => {
    const existing = refs.indexOf(url);
    if (existing !== -1) return existing + 1;
    refs.push(url);
    return refs.length;
  };

  if (isReply) {
    const dateStr = input.replyToDate || "recently";
    const authorStr = input.replyToAuthor || "Author <author@example.com>";
    lines.push(`On ${dateStr}, ${authorStr} wrote:`);
    const quote = (input.quotedPassage || roast?.brief?.author_claims?.[0] || "Could someone review the latest patch version?")
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n");
    lines.push(quote);
    lines.push("");
  } else {
    lines.push("Hi hackers,");
    lines.push("");
  }

  if (evidenceMd.trim()) {
    lines.push("I tested the latest patch series with my AI harness on current upstream master.");
    lines.push("");
    const snippet = evidenceMd
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[#*`]/g, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/\/Users\//.test(l))
      .slice(0, 6)
      .join(" ");
    if (snippet) {
      lines.push(snippet);
      lines.push("");
    }
  } else if (roast) {
    const topObj = roast.objections?.[0];
    const prior = roast.prior_attempts?.[0];
    if (topObj) {
      lines.push(
        `I looked over this proposal with my AI harness and noticed one point worth clarifying: ${topObj.title.toLowerCase()}.`,
      );
      lines.push("");
      if (topObj.failure_scenario) {
        lines.push(topObj.failure_scenario);
        lines.push("");
      }
      if (topObj.author_must_show) {
        lines.push(`Question: ${topObj.author_must_show}`);
        lines.push("");
      }
    } else {
      lines.push("I reviewed the proposal with my AI harness and did not spot a fundamental design objection.");
      lines.push("");
    }
    if (prior?.url) {
      const idx = addRef(prior.thread_urls?.[0] || prior.url);
      lines.push(`For context, there was an earlier discussion on this area [${idx}].`);
      lines.push("");
    }
  } else {
    lines.push(input.extraNotes?.trim() || "I tested the latest patch on current upstream master and have a short note below.");
    lines.push("");
  }

  if (input.extraNotes?.trim() && (evidenceMd.trim() || roast)) {
    lines.push(input.extraNotes.trim());
    lines.push("");
  }

  const attachments: DraftAttachment[] = [];
  if (input.includeFootnoteAttachment && roast) {
    const cfLabel = input.cfId ? `cf-${input.cfId}` : "proposal";
    const attName = `ai-notes-${cfLabel}.txt`;
    lines.push(
      `I attached the longer AI-generated notes as ${attName} for reference (footnote attachment, AI-generated).`,
    );
    lines.push("");
    const attLines = [
      `AI-generated notes for ${entryTitle}`,
      `Prepared by an AI harness; treat as a devil's advocate, not a verdict.`,
      "",
      `Verdict: ${roast.verdict} (confidence: ${roast.confidence || "medium"})`,
      "",
      ...(roast.objections ?? []).map(
        (o, idx) => `${idx + 1}. ${o.title}\n   ${o.failure_scenario || ""}\n   Question: ${o.author_must_show || ""}\n`,
      ),
    ];
    attachments.push({
      filename: attName,
      mimeType: "text/plain",
      contentText: attLines.join("\n"),
    });
  }

  if (input.cfId) {
    const cfRef = addRef(`https://commitfest.postgresql.org/patch/${input.cfId}/`);
    lines.push(`CommitFest entry: [${cfRef}]`);
  }
  if (threadUrl) {
    addRef(threadUrl);
  }

  if (refs.length > 0) {
    lines.push("");
    for (let i = 0; i < refs.length; i++) {
      lines.push(`[${i + 1}] ${refs[i]}`);
    }
  }

  if (authorName.trim()) {
    lines.push("");
    lines.push(authorName.trim());
  }

  return {
    subject,
    body: wrapEmailBody(lines.join("\n"), 72),
    attachments,
  };
}

export async function generateNikDraft(
  db: AppDatabase,
  settings: AppSettings,
  input: GenerateDraftInput,
): Promise<{ subject: string; body: string; attachments: DraftAttachment[]; gates: AllGatesResult; generator: string }> {
  const entry = input.cfId ? await db.getEntry(input.cfId) : null;
  const workItem = input.workItemId ? await db.getWorkItem(input.workItemId) : null;

  let roast: RoastJson | null = null;
  if (entry?.roast_json) {
    try {
      roast = JSON.parse(entry.roast_json) as RoastJson;
    } catch {
      roast = null;
    }
  }

  const title = entry?.title || workItem?.title || "PostgreSQL patch review";
  const threadUrl = entry?.thread_url || "";
  const evidenceMd = workItem?.evidence_md || "";
  const signOff = (settings.authorName || "").trim();
  const skillGuidance = getDraftingSkillGuidance(settings);

  // Start with deterministic template so attachments & fallback are always solid
  const base = buildDeterministicDraft(input, title, roast, evidenceMd, threadUrl, signOff);
  let finalBody = base.body;
  let generator = `template (${skillGuidance.mode})`;

  if (input.backend === "claude" || input.backend === "agy") {
    const prompt = [
      "Write a concise, plain-text PostgreSQL mailing-list email in a direct, technical developer voice.",
      "ACTIVE SKILL GUIDANCE:",
      skillGuidance.guidanceText,
      "",
      "HARD RULES:",
      "- Plain text ONLY. No Markdown fences, no inline backticks, no Markdown links, no headings, no emojis, no em-dashes.",
      "- Wrap prose lines at 72 characters (keep SQL, URLs, and > quotes unwrapped).",
      "- Lowercase SQL keywords.",
      "- NEVER mention any AI model names, agents, skills, harness gates, review gates, subagents, or local machine paths.",
      "- Saying 'My AI harness' or factual AI disclosure ('AI found...') is allowed.",
      input.isReply !== false
        ? `- Reply format: start with exact 'On ${input.replyToDate || "<date>"}, ${input.replyToAuthor || "<Name> <email>"} wrote:', quote relevant passage with '> ', then bottom-post below it.`
        : `- New thread format: start with 'Hi hackers,'${signOff ? ` and sign off with '${signOff}'.` : "."}`,
      signOff ? `- End with sign-off: ${signOff}` : "- Keep sign-off minimal or omit if not specified.",
      "- Number any URLs as [1], [2] in prose and place full URLs at the bottom before sign-off.",
      "",
      `Subject: ${base.subject}`,
      `Entry: ${title}`,
      roast ? `Roast summary: ${roast.verdict}. ${roast.verdict_reasoning || ""}` : "",
      roast?.objections?.[0]
        ? `Primary objection: ${roast.objections[0].title} — ${roast.objections[0].failure_scenario || ""} Question: ${roast.objections[0].author_must_show || ""}`
        : "",
      evidenceMd ? `Local evidence (sanitize before public output):\n${evidenceMd.slice(0, 2000)}` : "",
      input.extraNotes ? `Author notes: ${input.extraNotes}` : "",
      "",
      "Output ONLY the email body text, nothing else.",
    ]
      .filter(Boolean)
      .join("\n");

    const env = buildChildEnv(settings, { stripApiKeys: true });
    let llmOut = "";
    if (input.backend === "claude") {
      const model = input.model || settings.defaultClaudeModel || "opus";
      const res = spawnSync("claude", ["-p", prompt, "--model", model, "--tools", ""], {
        encoding: "utf8",
        env,
        timeout: 120_000,
      });
      if (res.status === 0 && res.stdout.trim()) {
        llmOut = res.stdout.trim();
        generator = `claude:${model}`;
      }
    } else if (input.backend === "agy") {
      const model = input.model || settings.defaultAgyModel || "gemini-4-neon-high";
      const res = spawnSync("agy", ["--model", model, "--disable-slash-commands", "-p", prompt], {
        encoding: "utf8",
        env,
        timeout: 120_000,
      });
      if (res.status === 0 && res.stdout.trim()) {
        llmOut = res.stdout.trim();
        generator = `agy:${model}`;
      }
    }

    if (llmOut) {
      finalBody = wrapEmailBody(llmOut, 72);
    }
  }

  const existingDrafts = input.cfId ? (await db.listDrafts(input.cfId)).length : 0;
  const gates = runAllDraftGates({
    body: finalBody,
    subject: base.subject,
    isReply: input.isReply !== false,
    isOtherAuthorThread: input.isOtherAuthorThread !== false,
    attachments: base.attachments,
    cfId: input.cfId,
    existingDraftCount: existingDrafts,
    knownLatestMessageTime: entry?.latest_message_time,
    selfEmail: settings.gmailAccount,
    selfName: settings.authorName,
    lastSyncedAt: entry?.synced_at,
  });

  return {
    subject: base.subject,
    body: finalBody,
    attachments: base.attachments,
    gates,
    generator,
  };
}

export function hydrateAttachmentsFromDisk(attachments: DraftAttachment[]): DraftAttachment[] {
  return attachments.map((att) => {
    if (att.contentBase64 || att.contentText !== undefined) return att;
    if (att.path) {
      const resolved = expandHome(att.path);
      if (existsSync(resolved)) {
        const buf = readFileSync(resolved);
        return {
          ...att,
          contentBase64: buf.toString("base64"),
        };
      }
    }
    return att;
  });
}

export async function saveDraftToGmail(
  db: AppDatabase,
  settings: AppSettings,
  draftId: number,
): Promise<{
  draft: DraftRecord;
  gmailDraftId: string;
  gmailDraftUrl: string;
  gates: AllGatesResult;
}> {
  const draft = await db.getDraft(draftId);
  if (!draft) {
    throw new Error(`Draft #${draftId} not found`);
  }

  let attachments: DraftAttachment[] = [];
  try {
    attachments = JSON.parse(draft.attachments_json || "[]") as DraftAttachment[];
  } catch {
    attachments = [];
  }
  attachments = hydrateAttachmentsFromDisk(attachments);

  const entry = draft.cf_id ? await db.getEntry(draft.cf_id) : null;
  const existingDrafts = draft.cf_id ? (await db.listDrafts(draft.cf_id)).length : 0;

  // Run ALL 4 safety gates synchronously before calling Gmail Drafts API
  const gates = runAllDraftGates({
    body: draft.body,
    subject: draft.subject,
    isReply: draft.is_reply === 1,
    isOtherAuthorThread: draft.is_other_author_thread === 1,
    attachments,
    cfId: draft.cf_id,
    inReplyTo: draft.in_reply_to,
    existingDraftCount: existingDrafts,
    knownLatestMessageTime: entry?.latest_message_time,
    lastSyncedAt: entry?.synced_at,
  });

  await db.updateDraft(draft.id, { gate_results_json: JSON.stringify(gates) });

  if (gates.hardBlocked) {
    const reasons = [
      ...gates.gates.confidentiality.issues,
      ...gates.gates.cfbot_attachments.issues,
      ...gates.gates.plain_text_etiquette.issues,
    ]
      .filter((i) => i.severity === "block")
      .map((i) => i.message)
      .join(" | ");
    await db.logAudit("gmail_save_draft", `draft:${draft.id}`, { blocked: true, reasons }, "blocked");
    throw new Error(`Safety gate HARD BLOCK: ${reasons}`);
  }

  const mime = buildRfc2822Message({
    from: settings.gmailAccount,
    to: draft.to_addrs,
    cc: draft.cc_addrs,
    subject: draft.subject,
    body: draft.body,
    inReplyTo: draft.in_reply_to,
    references: draft.references_header,
    attachments,
  });

  const payload: { message: { raw: string; threadId?: string } } = {
    message: {
      raw: mime.base64url,
      ...(draft.thread_id.trim() ? { threadId: draft.thread_id.trim() } : {}),
    },
  };

  // HARD GUARANTEE: ONLY calls `gmail users drafts create` — NEVER messages.send or drafts.send!
  const res = runGws(settings, [
    "gmail",
    "users",
    "drafts",
    "create",
    "--params",
    JSON.stringify({ userId: "me" }),
    "--json",
    JSON.stringify(payload),
  ]);

  if (!res.ok) {
    await db.logAudit("gmail_save_draft", `draft:${draft.id}`, { error: res.stderr || res.stdout }, "error");
    throw new Error(`gws drafts.create failed: ${res.stderr || res.stdout}`);
  }

  const parsed = parseGwsJson(res.stdout) as { id?: string } | null;
  const gmailDraftId = parsed?.id || "";
  const gmailDraftUrl = "https://mail.google.com/mail/u/1/#drafts";

  const updated = (await db.updateDraft(draft.id, {
    gmail_draft_id: gmailDraftId,
    gmail_draft_url: gmailDraftUrl,
    gate_results_json: JSON.stringify(gates),
  }))!;

  await db.logAudit("gmail_save_draft", `draft:${draft.id}`, {
    gmailDraftId,
    threadId: draft.thread_id,
    attachmentCount: mime.attachmentCount,
  });

  return { draft: updated, gmailDraftId, gmailDraftUrl, gates };
}
