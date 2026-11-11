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

export function judgePrompt(c: EvalCase, r: Roast): string {
  const dec = c.decisive_objections.map((d, i) =>
    `D${i + 1}. ${d.who ?? "unknown"}${d.date ? `, ${d.date}` : ""}${d.category ? ` [${d.category}]` : ""}\n    "${clip(String(d.quote ?? ""), 1500)}"`).join("\n");
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
