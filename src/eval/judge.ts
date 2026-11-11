// (b) judge: one model call per case, through the roast LLM backend (critic
// model, no tools). It compares the case's decisive objections with the
// objections the roast produced. Buckets are NOT shown to the judge (so a
// "refuted" label cannot bias it); code looks the bucket up afterwards.

import type { JsonSchema, Roast } from "../roast/schema.ts";
import type { LlmBackend } from "../roast/llm.ts";
import type { EvalCase } from "./cases.ts";
import { bucketedObjections, type JudgeItem } from "./score.ts";

export const JUDGE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          decisive_index: { type: "integer", minimum: 1 },
          result: { type: "string", enum: ["found", "partially", "not_found"] },
          objection_id: { type: "string", nullable: true },
          reason: { type: "string" },
        },
        required: ["decisive_index", "result", "objection_id", "reason"],
      },
    },
  },
  required: ["items"],
};

export const JUDGE_SYSTEM = `You grade an automated reviewer of PostgreSQL proposals.

You get (1) the objection(s) that actually decided a historical proposal (who raised it, when, a quote), and (2) the list of objections the reviewer produced without seeing that discussion.

For EACH decisive objection, answer:
- "found": one reviewer objection states the same core reason: the same mechanism, risk or concern, even in different words or with a different example.
- "partially": a reviewer objection is in the same area but weaker or more generic (e.g. "maintenance burden" where the real reason was a specific maintenance problem), or covers only part of the real reason.
- "not_found": no reviewer objection matches.

Give the id of the single best-matching reviewer objection (null for not_found) and one short sentence explaining the match or the miss. Judge only by the text given; do not use what you may remember about the real thread. Be strict: topical overlap is not a match. Reply with JSON only.`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** The decisive objections as shown to the classifier and the judge. */
export function decisiveList(c: EvalCase): string {
  return c.decisive_objections.map((d, i) => {
    const src = d.message_url ? "" : d.source ? `\n    (source: ${clip(String(d.source), 200)})` : "";
    return `D${i + 1}. ${d.who ?? "unknown"}${d.date ? `, ${d.date}` : ""}${d.category ? ` [${d.category}]` : ""}\n    "${clip(String(d.quote ?? ""), 1500)}"${src}`;
  }).join("\n");
}

export function judgePrompt(c: EvalCase, r: Roast): string {
  const dec = decisiveList(c);
  const objs = bucketedObjections(r).map((o) =>
    `- id: ${o.id}\n  title: ${o.title}\n  severity: ${o.severity}; category: ${o.category}; level: ${o.level}\n  failure scenario: ${clip(o.failure_scenario, 900)}\n  argument: ${clip(o.argument, 900)}`).join("\n");
  return `Proposal: ${c.title}
Outcome: ${c.outcome}

Decisive objection(s) from the real discussion:
${dec}

Reviewer objections (${bucketedObjections(r).length}):
${objs || "(none)"}

Return {"items": [...]} with one item per decisive objection; decisive_index is the number after D.`;
}

export async function runJudge(c: EvalCase, r: Roast, backend: LlmBackend, model: string): Promise<JudgeItem[]> {
  const out = await backend.complete<{ items: JudgeItem[] }>({
    system: JUDGE_SYSTEM, prompt: judgePrompt(c, r), model, schema: JUDGE_SCHEMA, label: "judge",
  });
  return out.items.filter((i) => i.decisive_index >= 1 && i.decisive_index <= c.decisive_objections.length);
}

// ---------------------------------------------------------------- level classification
// A separate call that sees only the case (never the roast), so the label is
// independent of what the roast said. Levels from prompts/committer-paranoia.md.

export type DecisiveLevel = "idea" | "design" | "implementation";

export interface ClassifyItem {
  decisive_index: number;
  level: DecisiveLevel;
  reason: string;
}

export const CLASSIFY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          decisive_index: { type: "integer", minimum: 1 },
          level: { type: "string", enum: ["idea", "design", "implementation"] },
          reason: { type: "string" },
        },
        required: ["decisive_index", "level", "reason"],
      },
    },
  },
  required: ["items"],
};

export const CLASSIFY_SYSTEM = `You classify objections raised against PostgreSQL proposals by the level of the review pyramid they belong to (Robert Haas's patch review hierarchy, as used by the PG Roast rubric):

- "idea" (levels 1a and 1b): understandability and desirability. Is the problem clear, is it worth solving at all, does it belong in core, is there demand, is it a non-standard or unwanted feature, was it rejected before as an idea.
- "design" (level 2): architecture and design in broad strokes. Given the goal, is the approach right: interfaces, user-visible behaviour, compatibility, on-disk/WAL/protocol/catalog consequences, security model, interaction with other subsystems, maintenance cost of the chosen approach.
- "implementation" (levels 3-5): code structure, specific bugs, crashes, test or buildfarm failures, performance regressions of the particular code, missing docs/tests, style. An objection that needs the code (or running it) to be seen.

Classify by what the objection is about, not by who raised it or how the proposal ended. Reply with JSON only.`;

export function classifyPrompt(c: EvalCase): string {
  return `Proposal: ${c.title}

Decisive objection(s):
${decisiveList(c)}

Return {"items": [...]} with one item per decisive objection (decisive_index is the number after D): level and one short sentence of reason.`;
}

export async function runClassify(c: EvalCase, backend: LlmBackend, model: string): Promise<ClassifyItem[]> {
  const out = await backend.complete<{ items: ClassifyItem[] }>({
    system: CLASSIFY_SYSTEM, prompt: classifyPrompt(c), model, schema: CLASSIFY_SCHEMA, label: "classify",
  });
  return out.items.filter((i) => i.decisive_index >= 1 && i.decisive_index <= c.decisive_objections.length);
}

/** Case label: the most fundamental level among its decisive objections. */
export function caseLevel(items: ClassifyItem[]): DecisiveLevel | null {
  for (const l of ["idea", "design", "implementation"] as const) if (items.some((i) => i.level === l)) return l;
  return null;
}
