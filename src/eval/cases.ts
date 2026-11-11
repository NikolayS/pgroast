// Eval cases: eval/cases.json (owned by the evalset agent). This loader is
// tolerant: it accepts the documented fields, reports problems per case, and
// keeps unknown fields so the report can show them.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonMsgid } from "../corpus/util.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const CASES_PATH = join(REPO_ROOT, "eval", "cases.json");

export type Outcome = "rejected" | "accepted" | "reverted";

export interface DecisiveObjection {
  who?: string;
  date?: string;
  message_url?: string;
  quote?: string;
  category?: string;
  /** where the quote comes from when there is no message_url (e.g. a revert commit message) */
  source?: string;
  [k: string]: unknown;
}

export interface EarlierAttempt {
  thread_url: string;
  [k: string]: unknown;
}

export interface EvalCase {
  id: string;
  title: string;
  outcome: Outcome;
  thread_url: string;
  first_message_id?: string;
  cutoff_date: string;
  blind_n: number;
  decisive_objections: DecisiveObjection[];
  earlier_attempts: EarlierAttempt[];
  post_training_cutoff: boolean | null;
  commit?: string | null;
  revert_commit?: string | null;
  /** 1-based position of the decisive message in the flat thread, if known. */
  decisive_objection_position?: number | null;
  /** Hint for directed precedent lookup, only if the case file provides one. */
  hint?: string | null;
  [k: string]: unknown;
}

const OUTCOMES = new Set(["rejected", "accepted", "reverted"]);

/** Parse cases; throws on a file-level problem, returns per-case problems. */
export function parseCases(json: unknown): { cases: EvalCase[]; problems: string[] } {
  const arr = Array.isArray(json) ? json : (json as { cases?: unknown })?.cases;
  if (!Array.isArray(arr)) throw new Error("cases.json: expected an array or {cases: [...]}");
  const cases: EvalCase[] = [];
  const problems: string[] = [];
  const ids = new Set<string>();
  arr.forEach((raw, i) => {
    const c = raw as Record<string, unknown>;
    const where = `case[${i}]${typeof c?.id === "string" ? ` (${c.id})` : ""}`;
    const bad: string[] = [];
    if (typeof c?.id !== "string" || !c.id) bad.push("id missing");
    else if (ids.has(c.id)) bad.push("duplicate id");
    const outcome = typeof c?.outcome === "string" ? c.outcome.toLowerCase() : "";
    if (!OUTCOMES.has(outcome)) bad.push(`outcome must be rejected|accepted|reverted, got ${JSON.stringify(c?.outcome)}`);
    if (typeof c?.thread_url !== "string" || !c.thread_url) bad.push("thread_url missing");
    if (typeof c?.cutoff_date !== "string" || !/^\d{4}-\d\d-\d\d/.test(c.cutoff_date)) bad.push("cutoff_date missing or not YYYY-MM-DD");
    const blind = Number(c?.blind_n);
    if (!Number.isInteger(blind) || blind < 1) bad.push("blind_n must be a positive integer");
    if (bad.length) {
      problems.push(`${where}: ${bad.join("; ")}`);
      return;
    }
    ids.add(c.id as string);
    const ptc = c.post_training_cutoff;
    cases.push({
      ...c,
      id: c.id as string,
      title: typeof c.title === "string" ? c.title : (c.id as string),
      outcome: outcome as Outcome,
      thread_url: c.thread_url as string,
      cutoff_date: (c.cutoff_date as string).slice(0, 10),
      blind_n: blind,
      decisive_objections: Array.isArray(c.decisive_objections) ? (c.decisive_objections as DecisiveObjection[]) : [],
      earlier_attempts: (Array.isArray(c.earlier_attempts) ? (c.earlier_attempts as EarlierAttempt[]) : [])
        .filter((e) => e && typeof e.thread_url === "string" && e.thread_url),
      post_training_cutoff: typeof ptc === "boolean" ? ptc : null,
      decisive_objection_position: Number.isInteger(c.decisive_objection_position) ? (c.decisive_objection_position as number) : null,
    });
  });
  return { cases, problems };
}

export function loadCases(path = CASES_PATH): { cases: EvalCase[]; problems: string[] } {
  if (!existsSync(path)) throw new Error(`${path} does not exist yet`);
  return parseCases(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Message-id of a thread/message URL (or a bare id), in the corpus's
 * canonical form: the part after /message-id/[flat|raw|mbox/] or postgr.es/m/,
 * without query/fragment, percent-decoded, <> stripped, re-quoted.
 */
export function msgidOf(urlOrId: string): string | null {
  let s = urlOrId.trim();
  const m = /(?:postgresql\.org\/message-id\/(?:flat\/|raw\/|mbox\/)?|postgr\.es\/m\/)([^?#\s]+)/.exec(s);
  if (m) s = m[1]!;
  else if (/^https?:/.test(s)) return null;
  s = s.replace(/\/+$/, "");
  const c = canonMsgid(s);
  return c.includes("@") ? c : null;
}

/** True when the decisive objection's message is inside the shown window (position <= blind_n). */
export function decisiveInWindow(c: EvalCase): boolean {
  return c.decisive_objection_position != null && c.decisive_objection_position <= c.blind_n;
}
