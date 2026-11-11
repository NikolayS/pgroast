// Self mode without a thread: the author's draft email and optional patch files on disk.
// The same rule as for attachments applies: only the prose of a patch reaches the model.

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { extractPatchProse } from "./patchprose.ts";
import type { PatchProse, ProposalInput } from "./types.ts";

export const MAX_LOCAL_PATCH_BYTES = 8 * 1024 * 1024;

export function loadLocalProposal(proposalFile: string, patchFiles: string[] = [], now: Date = new Date()): ProposalInput {
  const text = readFileSync(proposalFile, "utf8").replace(/\r\n/g, "\n");
  if (!text.trim()) throw new Error(`${proposalFile} is empty`);
  const warnings: string[] = [];

  // A draft may start with mail headers; "Subject:" gives the title, else the first line does.
  const lines = text.split("\n");
  const subj = lines.slice(0, 15).find((l) => /^Subject:/i.test(l));
  const subject = (subj ? subj.replace(/^Subject:\s*/i, "") : (lines.find((l) => l.trim()) ?? "")).trim().slice(0, 200);
  const name = basename(proposalFile);
  const date = now.toISOString().replace(/\.\d+Z$/, "Z");

  const patchProse: PatchProse[] = [];
  for (const f of patchFiles) {
    const size = statSync(f).size;
    const att = { name: basename(f), url: "", contentType: "text/x-patch", sizeText: `${(size / 1024).toFixed(1)} KB`, sizeBytes: size };
    if (size > MAX_LOCAL_PATCH_BYTES) {
      warnings.push(`patch ${att.name} (${att.sizeText}) is too large; not read`);
      continue;
    }
    const raw = readFileSync(f, "utf8");
    if (raw.includes("\u0000")) {
      warnings.push(`patch ${att.name} looks binary; skipped`);
      continue;
    }
    const prose = extractPatchProse(raw);
    if (prose.files.length === 0 && prose.commitMessages.length === 0) {
      // Not a diff: it could be source code, and code never goes to the model.
      warnings.push(`${att.name} is not a patch (no diff found); not read`);
      continue;
    }
    patchProse.push({ attachment: att, fromMessageIndex: 1, ...prose });
  }

  return {
    input: name,
    ref: { kind: "local", name },
    cf: null,
    thread: {
      threadUrl: "",
      rootMessageId: "",
      subject,
      lists: ["(draft, not sent)"],
      messages: [
        {
          index: 1,
          messageId: "",
          url: "",
          from: "The author (draft, not sent yet)",
          date,
          subject,
          body: text.trim(),
          attachments: patchProse.map((p) => p.attachment),
        },
      ],
    },
    totalMessages: 1,
    filters: { blind: null, before: null },
    threadStart: date,
    patchProse,
    warnings,
  };
}
