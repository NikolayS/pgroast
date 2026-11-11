// Tone lint: a deterministic check over every prose field of a roast, before files are
// written. What a person may forward must read as a calm, respectful, evidence-first review.
// On a hit, one repair call asks the synthesis model to rephrase only the flagged sentences;
// what is still flagged afterwards is listed in roast.json (`tone_lint.remaining`).
//
// Verbatim quotes from the archives are not prose of ours and are not checked.

import type { LlmBackend } from "./llm.ts";
import { scrubUrls, type AllowedUrls } from "./sanitize.ts";
import { TONE_REPAIR_SCHEMA, type SanitizerReport, type FinalObjection, type Roast, type ToneHit, type ToneLint } from "./schema.ts";

export interface ToneRule {
  id: string;
  re: RegExp;
}

const words = (id: string, list: string[]): ToneRule => ({
  id,
  re: new RegExp(`\\b(?:${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|")})\\b`, "i"),
});

export const TONE_RULES: ToneRule[] = [
  words("intensifier", [
    "obviously", "clearly", "simply", "of course", "trivially", "needless to say", "plainly wrong",
    "any competent", "everyone knows", "everybody knows", "it goes without saying", "no-brainer", "by definition wrong",
  ]),
  words("hyperbole", [
    "nonsense", "ridiculous", "absurd", "laughable", "insane", "crazy", "stupid", "dumb", "idiotic", "garbage", "terrible",
    "horrible", "awful", "atrocious", "disaster", "disastrous", "nightmare", "horror story", "abomination",
    "hopeless", "worthless", "useless", "a joke", "dead on arrival", "doomed", "utterly", "completely broken", "totally",
  ]),
  words("sarcasm", [
    "good luck", "nice try", "yeah right", "surprise surprise", "surprise, surprise", "so-called", "lol", "sigh", "oh great",
    "what could possibly go wrong", "who would have thought", "brilliant idea", "bless", "pray tell", "hand-waving", "handwaving",
    "hand-wavy", "handwavy",
  ]),
  words("roast vocabulary", ["roast", "roasts", "roasted", "roasting", "roaster", "roasters", "beat down", "beatdown", "beat-down", "takedown", "smackdown", "rejector", "kill the patch", "shoot down", "shot down", "tear apart", "torn apart"]),
  words("about the author", [
    "you failed to", "you forgot", "you neglected", "you ignored", "you did not bother", "you didn't bother", "you clearly", "you should have known",
    "the author failed", "the author fails", "the author forgot", "the author neglected", "the author ignored", "the author ignores",
    "the author did not bother", "the author didn't bother", "the author does not understand", "the author doesn't understand",
    "the author is unaware", "the author has no idea", "the author never bothered", "the author is wrong", "authors failed",
    "lazy", "sloppy", "amateur", "amateurish", "incompetent", "clueless", "ignorant",
  ]),
  // "!" is fine in "!=" and inside `code`; code spans are removed before the check.
  { id: "exclamation mark", re: /!(?!=)/ },
];

/** Rule id for an objection's question to the author that is not a question. */
export const NO_QUESTION = "does not end in a question";

const stripCode = (s: string) => s.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));

/** Sentences of a text, as substrings of it (so a rewrite can replace exactly one). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!]["')\]]*)\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function lintText(text: string, path = ""): ToneHit[] {
  const hits: ToneHit[] = [];
  for (const sentence of sentences(text)) {
    const bare = stripCode(sentence);
    for (const rule of TONE_RULES) {
      const m = bare.match(rule.re);
      if (m) hits.push({ path, rule: rule.id, match: m[0], sentence });
    }
  }
  return hits;
}

export interface ProseField {
  path: string;
  get(): string;
  set(v: string): void;
  /** The objection's question to the author: must end with "?". */
  question?: boolean;
}

/** Every prose field a model wrote and a person may read. Quotes from the archives are left out. */
export function proseFields(r: Roast): ProseField[] {
  const out: ProseField[] = [];
  const add = <T extends object>(obj: T, key: keyof T, path: string, question = false) => {
    if (typeof obj[key] === "string") out.push({ path, get: () => obj[key] as string, set: (v) => void ((obj[key] as string) = v), question });
  };
  const list = (arr: string[], path: string) => arr.forEach((_, i) => out.push({ path: `${path}[${i}]`, get: () => arr[i]!, set: (v) => void (arr[i] = v) }));
  const objection = (o: FinalObjection, path: string, ranked: boolean) => {
    add(o, "title", `${path}.title`);
    add(o, "failure_scenario", `${path}.failure_scenario`);
    add(o, "argument", `${path}.argument`);
    add(o, "author_must_show", `${path}.author_must_show`, ranked);
    add(o.critic, "reasoning", `${path}.critic.reasoning`);
    if (o.not_ranked_reason != null) add(o, "not_ranked_reason", `${path}.not_ranked_reason`);
    if (o.withdrawal) add(o.withdrawal, "reason", `${path}.withdrawal.reason`);
  };

  add(r, "verdict_reasoning", "verdict_reasoning");
  add(r, "provisional_note", "provisional_note");
  add(r.brief, "problem", "brief.problem");
  add(r.brief, "proposed_design", "brief.proposed_design");
  add(r.brief, "thread_state", "brief.thread_state");
  list(r.brief.user_visible_surface, "brief.user_visible_surface");
  list(r.brief.author_claims, "brief.author_claims");
  list(r.questions, "questions");
  r.objections.forEach((o, i) => objection(o, `objections[${i}]`, true));
  r.other_surviving.forEach((o, i) => objection(o, `other_surviving[${i}]`, true));
  r.refuted.forEach((o, i) => objection(o, `refuted[${i}]`, false));
  r.withdrawn.forEach((o, i) => objection(o, `withdrawn[${i}]`, false));
  r.prior_attempts.forEach((p, i) => {
    add(p, "what_is_different", `prior_attempts[${i}].what_is_different`);
    if (p.enriched) add(p, "reason", `prior_attempts[${i}].reason`); // an AI summary, not a quote
  });
  r.touch_points.forEach((t, i) => add(t, "reason", `touch_points[${i}].reason`));
  add(r.committability, "owner_note", "committability.owner_note");
  add(r.committability, "liability", "committability.liability");
  add(r.committability, "author_follow_up", "committability.author_follow_up");
  add(r.not_now, "evidence_that_would_change_it", "not_now.evidence_that_would_change_it");
  add(r.priority, "reason", "priority.reason");
  r.self_advice.forEach((a, i) => add(a, "how", `self_advice[${i}].how`));
  r.roaster_notes.forEach((n, i) => add(n, "note", `roaster_notes[${i}].note`));
  r.rounds.forEach((x, i) => add(x, "note", `rounds[${i}].note`));
  return out;
}

function lintField(f: ProseField): ToneHit[] {
  const text = f.get();
  const hits = lintText(text, f.path);
  if (f.question && text.trim() && !/\?["')\]]*\s*$/.test(text)) {
    const all = sentences(text);
    hits.push({ path: f.path, rule: NO_QUESTION, match: "", sentence: all[all.length - 1] ?? text });
  }
  return hits;
}

/** All hits in a roast. Pure: no model, no change. */
export function lintRoast(r: Roast): { fields: number; hits: ToneHit[] } {
  const fields = proseFields(r);
  return { fields: fields.length, hits: fields.flatMap(lintField) };
}

export interface ToneRepairOptions {
  backend: LlmBackend;
  model: string;
  /** System prompt (prompts/tone.md plus the output contract). */
  system: string;
  allowed: AllowedUrls;
  report: SanitizerReport;
  log?: (m: string) => void;
}

/**
 * Lint; on hits, one repair call for the flagged sentences only; lint again. Changes the roast
 * in place and returns the record for roast.json. Without `repair` (or in a dry run) it only lints.
 */
export async function toneCheck(r: Roast, repair?: ToneRepairOptions): Promise<ToneLint> {
  const first = lintRoast(r);
  const result: ToneLint = { fields_checked: first.fields, hits_found: first.hits.length, sentences_rewritten: 0, repair_call: "not needed", remaining: first.hits };
  if (first.hits.length === 0) return result;
  if (!repair || repair.backend.dryRun) return { ...result, repair_call: "skipped" };

  // One item per flagged sentence of a field.
  const fields = new Map(proseFields(r).map((f) => [f.path, f]));
  const items: { n: number; path: string; sentence: string; flagged: string[] }[] = [];
  for (const h of first.hits) {
    const item = items.find((x) => x.path === h.path && x.sentence === h.sentence);
    const why = h.rule === NO_QUESTION ? "must end with one question the author can answer" : `${h.rule}: "${h.match}"`;
    if (item) item.flagged.push(why);
    else items.push({ n: items.length + 1, path: h.path, sentence: h.sentence, flagged: [why] });
  }
  try {
    const reply = scrubUrls(
      await repair.backend.complete<{ rewrites: { n: number; text: string }[] }>({
        label: "tone-repair",
        model: repair.model,
        system: repair.system,
        prompt: `# Flagged sentences\n\n${JSON.stringify(items.map(({ n, sentence, flagged }) => ({ n, sentence, flagged })), null, 1)}\n\n# Task\n\nRewrite each flagged sentence. One rewrite per number. JSON only.`,
        schema: TONE_REPAIR_SCHEMA,
      }),
      repair.allowed,
      "tone-repair",
      repair.report,
    );
    for (const rw of reply.rewrites) {
      const item = items.find((x) => x.n === rw.n);
      const f = item && fields.get(item.path);
      const text = rw.text.replace(/\s+/g, " ").trim();
      if (!item || !f || !text || !f.get().includes(item.sentence)) continue;
      f.set(f.get().replace(item.sentence, () => text));
      result.sentences_rewritten++;
    }
    result.repair_call = "done";
  } catch (e) {
    repair.log?.(`tone repair failed: ${(e as Error).message.split("\n")[0]}`);
    result.repair_call = "failed";
  }
  result.remaining = lintRoast(r).hits;
  return result;
}
