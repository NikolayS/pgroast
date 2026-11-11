// The roast pipeline: brief -> retrieval (code) -> roasters (parallel) -> critic -> synthesis
// -> assembly (code). Everything the model returns passes through src/roast/sanitize.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../thread/fetch.ts";
import type { ProposalInput, Thread } from "../thread/types.ts";
import { loadInvariantFiles, renderInvariants, selectInvariants, type InvariantFile } from "./invariants.ts";
import { ENRICH_SCHEMA, RELEVANCE_SCHEMA, enrichPrecedents, openPgEnrichmentStore, type EnrichmentStore } from "./enrich.ts";
import type { LlmBackend } from "./llm.ts";
import { materialRawText, renderMaterial } from "./material.ts";
import { renderPrecedentsForPrompt, retrievePrecedents, type SearchFn } from "./precedents.ts";
import { AllowedUrls, emptyReport, filterPrecedentIds, filterThreadRefs, scrubUrls, verifyQuote } from "./sanitize.ts";
import {
  ANGLES,
  BRIEF_SCHEMA,
  CRITIC_SCHEMA,
  DISCLOSURE,
  LEVELS,
  LEVEL_NAMES,
  REFLECT_SCHEMA,
  ROASTER_SCHEMA,
  SCHEMA_VERSION,
  SUPERVISOR_SCHEMA,
  SYNTH_SCHEMA,
  SYNTH_SELF_SCHEMA,
  TOUCH_POINTS,
  levelRank,
  type Angle,
  type Brief,
  type CriticOutput,
  type FinalObjection,
  type JsonSchema,
  type Level,
  type Precedent,
  type PriorAttempt,
  type RawObjection,
  type RawPriorAttempt,
  type ReflectOutput,
  type Roast,
  type RoundRecord,
  type SelfAdvice,
  type SupervisorOutput,
  type RoasterOutput,
  type SanitizerReport,
  type SynthOutput,
  type TouchPointResult,
  type Verdict,
} from "./schema.ts";

export interface RunOptions {
  backend: LlmBackend;
  models: { roaster: string; critic: string; synth: string; brief: string };
  /** "self" = the author's own pre-flight check: same pipeline, other framing. */
  mode?: "review" | "self";
  /** Extra rounds after the first pass (default 0). 1 = "What did you forget?", 2 = + "Are you happy with the results?", 3+ = supervisor follow-ups. */
  rounds?: number;
  /** Injected for tests; default = the files under invariants/. */
  invariants?: InvariantFile[];
  /** Recorded in roast.json: "claude" | "codex". */
  backendName?: string;
  hint?: string | null;
  /** Injected precedent search (tests). Default: the corpus adapter. */
  search?: SearchFn;
  /** false = no enrichment and no relevance pass (--no-enrich). */
  enrich?: boolean;
  enrichMax?: number;
  /** undefined = the table in the corpus database; null = no cache. */
  enrichStore?: EnrichmentStore | null;
  enrichLoadThread?: (messageId: string) => Promise<Thread>;
  enrichClosers?: (p: Precedent) => Promise<string[]>;
  /** At most this many precedents are shown to the roasters. */
  precedentLimit?: number;
  promptsDir?: string;
  angles?: readonly Angle[];
  log?: (msg: string) => void;
  now?: () => Date;
}

// ---------------------------------------------------------------------------------------------
// Prompts

export interface Prompts {
  rubric: string;
  brief: string;
  roasterCommon: string;
  angles: Record<Angle, string>;
  critic: string;
  synth: string;
  enrich: string;
  relevance: string;
  reflect: string;
  supervisor: string;
  synthSelf: string;
}

/** The two reflection questions, verbatim from the issue. */
export const FORGOT_PROMPT = "What did you forget?";
export const HAPPY_PROMPT = "Are you happy with the results?";

export function loadPrompts(dir: string = join(REPO_ROOT, "prompts")): Prompts {
  const read = (f: string) => readFileSync(join(dir, f), "utf8").trim();
  return {
    // Read from disk at run time and included verbatim: the rubric has its own owner.
    rubric: read("committer-paranoia.md"),
    brief: read("brief.md"),
    roasterCommon: read("roaster-common.md"),
    angles: Object.fromEntries(ANGLES.map((a) => [a, read(`roaster-${a}.md`)])) as Record<Angle, string>,
    critic: read("critic.md"),
    synth: read("synth.md"),
    enrich: read("enrich.md"),
    relevance: read("relevance.md"),
    reflect: read("reflect.md"),
    supervisor: read("supervisor.md"),
    synthSelf: read("synth-self.md"),
  };
}

/** Render a schema as a compact TypeScript-like shape for the prompt. */
export function describeSchema(s: JsonSchema, indent = ""): string {
  const nul = s.nullable ? " | null" : "";
  switch (s.type) {
    case "string":
      return (s.enum ? s.enum.map((e) => JSON.stringify(e)).join(" | ") : "string") + nul;
    case "integer":
    case "number": {
      const range = s.minimum != null || s.maximum != null ? ` (${s.minimum ?? ""}..${s.maximum ?? ""})` : "";
      return s.type + range + nul;
    }
    case "boolean":
      return "boolean" + nul;
    case "array": {
      const lim = [s.minItems != null ? `min ${s.minItems}` : "", s.maxItems != null ? `max ${s.maxItems}` : ""].filter(Boolean).join(", ");
      return `[ ${describeSchema(s.items, indent)} ]${lim ? ` (${lim} items)` : ""}${nul}`;
    }
    case "object": {
      const inner = Object.entries(s.properties)
        .map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${describeSchema(v, indent + "  ")}`)
        .join(",\n");
      return `{\n${inner}\n${indent}}${nul}`;
    }
  }
}

const TOUCH_POINT_LIST = TOUCH_POINTS.map((t) => `- \`${t.id}\`: ${t.label}`).join("\n");

function outputContract(schema: JsonSchema, withTouchPoints: boolean): string {
  return [
    "## Output contract",
    "",
    "One JSON object of this shape (all keys required; no text before or after it, no code fence):",
    "",
    describeSchema(schema),
    ...(withTouchPoints ? ["", "Touch point ids:", "", TOUCH_POINT_LIST] : []),
  ].join("\n");
}

function withRubric(head: string, rubric: string, tail: string): string {
  return `${head}\n\n---\n\n# Rubric (prompts/committer-paranoia.md, verbatim)\n\n${rubric}\n\n---\n\n${tail}`;
}

/** Angles that get the subsystem invariants (the critic gets them too). */
export const INVARIANT_ANGLES: readonly Angle[] = ["replication-ondisk", "maintenance-fit"];

const withInvariants = (angle: Angle, invariants: string) => (invariants && INVARIANT_ANGLES.includes(angle) ? `\n\n${invariants}` : "");

export function roasterSystem(p: Prompts, angle: Angle, invariants = ""): string {
  return withRubric(p.roasterCommon, p.rubric, `${p.angles[angle]}${withInvariants(angle, invariants)}\n\n${outputContract(ROASTER_SCHEMA, true)}`);
}
export function reflectSystem(p: Prompts, angle: Angle, invariants = ""): string {
  return withRubric(p.roasterCommon, p.rubric, `${p.angles[angle]}${withInvariants(angle, invariants)}\n\n${p.reflect}\n\n${outputContract(REFLECT_SCHEMA, true)}`);
}
export function criticSystem(p: Prompts, invariants = ""): string {
  return withRubric(p.critic, p.rubric, `${invariants ? `${invariants}\n\n` : ""}${outputContract(CRITIC_SCHEMA, false)}`);
}
export function synthSystem(p: Prompts, self = false): string {
  return withRubric(p.synth, p.rubric, `${self ? `${p.synthSelf}\n\n` : ""}${outputContract(self ? SYNTH_SELF_SCHEMA : SYNTH_SCHEMA, true)}`);
}
export function supervisorSystem(p: Prompts): string {
  return `${p.supervisor}\n\n${outputContract(SUPERVISOR_SCHEMA, false)}`;
}
export function briefSystem(p: Prompts): string {
  return `${p.brief}\n\n${outputContract(BRIEF_SCHEMA, false)}`;
}

// ---------------------------------------------------------------------------------------------
// Helpers

function reviewDate(p: ProposalInput, now: Date): string {
  if (p.filters.blind == null && !p.filters.before) return now.toISOString().slice(0, 10);
  const last = p.thread.messages[p.thread.messages.length - 1]!.date.slice(0, 10);
  return last;
}

function header(p: ProposalInput, now: Date): string {
  const evalMode = p.filters.blind != null || !!p.filters.before;
  return evalMode
    ? `Date of this review: ${reviewDate(p, now)} (the date of the last visible message). Nothing after that date exists for you.`
    : `Date of this review: ${reviewDate(p, now)}.`;
}

export function slugFor(p: ProposalInput): string {
  const base =
    p.ref.kind === "cf"
      ? `cf-${p.ref.id}`
      : p.ref.kind === "local"
        ? "self-" + p.ref.name.replace(/\.[A-Za-z0-9]+$/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
        : "msg-" +
        p.thread.rootMessageId
          .replace(/@.*$/, "")
          .replace(/[^A-Za-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
  return base + (p.filters.blind != null ? `-blind${p.filters.blind}` : "") + (p.filters.before ? `-before${p.filters.before}` : "");
}

function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

// ---------------------------------------------------------------------------------------------
// Assembly (pure code; exported for tests)

export interface AssembleArgs {
  synth: SynthOutput;
  objections: FinalObjection[];
  precedents: Precedent[];
  /** Raw text of the visible thread, for quote checks. */
  threadText: string;
  report: SanitizerReport;
  warnings: string[];
}

export interface Assembled {
  verdict: Verdict;
  failing_level: Level | null;
  levels: Roast["levels"];
  objections: FinalObjection[];
  other_surviving: FinalObjection[];
  refuted: FinalObjection[];
  withdrawn: FinalObjection[];
  touch_points: TouchPointResult[];
  prior_attempts: PriorAttempt[];
}

export function resolvePriorAttempts(
  raw: RawPriorAttempt[],
  precedents: Precedent[],
  threadText: string,
  report: SanitizerReport,
  stage: string,
): PriorAttempt[] {
  const known = new Map(precedents.map((p) => [p.id, p]));
  const out: PriorAttempt[] = [];
  for (const r of raw) {
    const [id] = filterPrecedentIds([r.precedent_id], known, stage, report);
    if (!id || out.some((o) => o.precedent_id === id)) continue;
    const p = known.get(id)!;
    // An AI summary is never a quote source: only corpus text, the verified key sentence, the thread.
    const sources = p.enriched ? [p.key_quote ?? "", threadText] : [p.objection, p.summary, p.title, p.key_quote ?? "", threadText];
    let quote = verifyQuote(r.quote, sources);
    if (r.quote && !quote) report.quotes_dropped.push({ precedent_id: id, quote: r.quote });
    let quote_url: string | null = quote && p.key_quote && verifyQuote(quote, [p.key_quote]) ? p.quote_message_url : null;
    if (!quote && p.key_quote) {
      // Fall back to the sentence that code verified against the precedent's thread.
      quote = p.key_quote;
      quote_url = p.quote_message_url;
    }
    out.push({
      precedent_id: id,
      source_id: p.source_id,
      title: p.title,
      kind: p.kind,
      status: p.status,
      url: p.url,
      thread_urls: p.thread_urls,
      date: p.date,
      first_date: p.first_date,
      who_objected: p.objectors,
      quote,
      quote_url,
      enriched: p.enriched,
      reason: p.objection,
      relation: r.relation,
      what_is_different: r.what_is_different,
    });
  }
  return out;
}

export function assemble(a: AssembleArgs): Assembled {
  const { synth, warnings } = a;
  const survived = a.objections.filter((o) => o.status === "survived");
  const refuted = a.objections.filter((o) => o.status === "refuted");
  const withdrawn = a.objections.filter((o) => o.status === "withdrawn");
  const byId = new Map(survived.map((o) => [o.id, o]));

  // Ranked list: surviving objections only, no duplicates, at most 5.
  let ranked: FinalObjection[] = [];
  for (const id of synth.ranked_objection_ids) {
    const o = byId.get(id.trim());
    if (!o) {
      warnings.push(`synthesis ranked "${id}", which is not a surviving objection; dropped`);
      continue;
    }
    if (!ranked.includes(o)) ranked.push(o);
  }
  ranked = ranked.slice(0, 5);

  // Base-up rule (the rubric's operating rule): the first failing level leads, and objections
  // from higher levels are not listed; those levels are reported as "not evaluated".
  let failing: Level | null = synth.failing_level;
  if (ranked.length > 0) {
    const lowest = LEVELS[Math.min(...ranked.map((o) => levelRank(o.level)))]!;
    if (failing == null) {
      // The model listed objections but named no failing level: fine when they are all fixable.
      if (ranked.some((o) => o.severity === "fatal")) {
        failing = LEVELS[Math.min(...ranked.filter((o) => o.severity === "fatal").map((o) => levelRank(o.level)))]!;
        warnings.push(`synthesis gave no failing level but ranked a fatal objection; set to ${failing}`);
      }
    } else if (levelRank(lowest) < levelRank(failing) && ranked.some((o) => o.level === lowest && o.severity === "fatal")) {
      warnings.push(`synthesis named level ${failing} as failing but ranked a fatal objection at level ${lowest}; set to ${lowest}`);
      failing = lowest;
    }
  }
  if (failing != null) {
    const f = levelRank(failing);
    const kept: FinalObjection[] = [];
    for (const o of ranked) {
      if (levelRank(o.level) > f) {
        o.not_ranked_reason = `level ${o.level} is above the failing level ${failing}: not evaluated (base-up stop rule)`;
      } else kept.push(o);
    }
    // Stable: the failing level leads, then anything the model ranked from below it.
    ranked = [...kept.filter((o) => levelRank(o.level) === f), ...kept.filter((o) => levelRank(o.level) < f)];
  }
  const rankedSet = new Set(ranked);
  const other = survived.filter((o) => !rankedSet.has(o));
  for (const o of other) {
    o.not_ranked_reason ??=
      failing != null && levelRank(o.level) > levelRank(failing)
        ? `level ${o.level} is above the failing level ${failing}: not evaluated (base-up stop rule)`
        : "not among the strongest objections";
  }
  const levels = LEVELS.map((level) => ({
    level,
    name: LEVEL_NAMES[level],
    status:
      failing == null || levelRank(level) < levelRank(failing)
        ? ("passed" as const)
        : level === failing
          ? ("failed" as const)
          : ("not_evaluated" as const),
  }));
  for (const o of ranked) o.not_ranked_reason = null;

  // Prior attempts.
  const prior = resolvePriorAttempts(synth.prior_attempts, a.precedents, a.threadText, a.report, "synth");

  // Verdict guards.
  let verdict = synth.verdict;
  const fatalRanked = ranked.filter((o) => o.severity === "fatal");
  if (verdict === "LIKELY-REJECT" && fatalRanked.length === 0 && !prior.some((p) => p.relation === "same_idea")) {
    warnings.push("synthesis said LIKELY-REJECT with no surviving fatal objection and no same-idea prior attempt; downgraded to NEEDS-DESIGN-DISCUSSION");
    verdict = "NEEDS-DESIGN-DISCUSSION";
  }
  if (verdict === "NO-FUNDAMENTAL-OBJECTION" && fatalRanked.length > 0) {
    warnings.push("synthesis said NO-FUNDAMENTAL-OBJECTION but ranked a fatal objection; changed to NEEDS-DESIGN-DISCUSSION");
    verdict = "NEEDS-DESIGN-DISCUSSION";
  }

  // Touch points: all 15, once each, in the issue's order.
  const given = new Map(synth.touch_points.map((t) => [t.id, t]));
  const touch: TouchPointResult[] = TOUCH_POINTS.map((t) => {
    const g = given.get(t.id);
    if (!g) warnings.push(`synthesis did not report touch point "${t.id}"; marked as not hit`);
    let hit = g?.hit ?? false;
    let reason = hit ? (g?.reason ?? "").trim() : "";
    // A ranked objection about a touch point means the touch point is hit.
    const src = ranked.find((o) => o.category === t.id || o.touch_points.includes(t.id));
    if (src && !hit) {
      hit = true;
      reason = `see objection ${src.id}: ${src.title}`;
    }
    if (hit && !reason) reason = src ? `see objection ${src.id}: ${src.title}` : "(no reason given)";
    return { id: t.id, label: t.label, hit, reason };
  });

  return { verdict, failing_level: failing, levels, objections: ranked, other_surviving: other, refuted, withdrawn, touch_points: touch, prior_attempts: prior };
}

// ---------------------------------------------------------------------------------------------
// The run

export async function runRoast(proposal: ProposalInput, opts: RunOptions): Promise<Roast> {
  const t0 = Date.now();
  const log = opts.log ?? ((m: string) => console.error(m));
  const now = (opts.now ?? (() => new Date()))();
  const prompts = loadPrompts(opts.promptsDir);
  const { backend, models } = opts;
  const angles = opts.angles ?? ANGLES;
  const warnings: string[] = [...proposal.warnings];
  const report = emptyReport();
  const evalMode = proposal.filters.blind != null || !!proposal.filters.before;

  const material = renderMaterial(proposal);
  if (material.omitted) warnings.push(`${material.omitted} long messages in the middle of the thread were left out of the prompts`);
  const threadText = materialRawText(proposal);
  const head = header(proposal, now);

  // URLs the output may contain, before the precedents are known.
  const allowed = new AllowedUrls();
  allowed.add(proposal.thread.threadUrl);
  for (const m of proposal.thread.messages) allowed.add(m.url);
  if (proposal.cf) allowed.add(proposal.cf.url);
  allowed.addFromText(threadText);
  allowed.addFromText(prompts.rubric);

  // Subsystem invariants: files whose path prefixes match what the patch touches.
  const touched = [...new Set(proposal.patchProse.flatMap((pp) => pp.files))];
  const invariantFiles = selectInvariants(touched, opts.invariants ?? loadInvariantFiles());
  const invariantsText = renderInvariants(invariantFiles);
  for (const f of invariantFiles) for (const u of f.sourceUrls) allowed.add(u);
  if (invariantFiles.length) log(`invariants: ${invariantFiles.map((f) => f.file).join(", ")}`);
  const selfMode = opts.mode === "self";
  const maxRounds = Math.max(0, Math.floor(opts.rounds ?? 0));

  // a. Brief
  log("brief ...");
  let brief = await backend.complete<Brief>({
    label: "brief",
    model: models.brief,
    system: briefSystem(prompts),
    prompt: `${head}\n\n${material.text}\n\n# Task\n\nWrite the brief and the search queries. JSON only.`,
    schema: BRIEF_SCHEMA,
  });
  brief = scrubUrls(brief, allowed, "brief", report);
  if (backend.dryRun) {
    // The stub has no usable queries; search by the subject so the later prompts are realistic.
    const subject = proposal.thread.subject.replace(/^\s*(\[[^\]]*\]|re:)\s*/gi, "").trim();
    brief = { ...brief, title: subject, search_queries: dedupeBy([subject, proposal.cf?.title ?? subject], (s) => s) };
  }

  // b. Retrieval (code)
  const cutoff = proposal.filters.before ?? proposal.threadStart.slice(0, 10);
  log(`precedent search (before ${cutoff}) ...`);
  const retrieved = await retrievePrecedents({
    queries: brief.search_queries,
    hint: opts.hint ?? null,
    before: cutoff,
    includeUndated: !evalMode,
    self: {
      cfId: proposal.cf?.id ?? null,
      messageIds: [proposal.thread.rootMessageId, ...(proposal.cf?.threads.map((t) => t.messageId) ?? [])].filter(Boolean),
    },
    search: opts.search,
    limit: opts.enrich === false ? (opts.precedentLimit ?? 15) : 24,
    log,
  });
  warnings.push(...retrieved.warnings);
  const pool = retrieved.precedents;

  // b2. Lazy enrichment: read the threads of the top candidates that have no recorded reason.
  let enrichment: Roast["enrichment"] = null;
  if (pool.length > 0 && opts.enrich !== false && !backend.dryRun) {
    log("enriching precedents ...");
    const store = opts.enrichStore === undefined ? await openPgEnrichmentStore() : opts.enrichStore;
    if (!store) warnings.push("the enrichment table could not be opened: precedent summaries are not cached in this run");
    const res = await enrichPrecedents(pool, {
      backend,
      model: models.roaster,
      system: `${prompts.enrich}\n\n${outputContract(ENRICH_SCHEMA, false)}`,
      store,
      max: opts.enrichMax ?? 8,
      evalMode,
      selfMessageIds: [proposal.thread.rootMessageId, ...(proposal.cf?.threads.map((t) => t.messageId) ?? [])].filter(Boolean),
      loadThreadFn: opts.enrichLoadThread,
      closersFn: opts.enrichClosers,
      log,
    });
    if (opts.enrichStore === undefined) await store?.close?.();
    warnings.push(...res.warnings);
    enrichment = { ...res.stats, relevance_pass: "skipped", relevant: pool.length };
    log(`enrichment: ${res.stats.candidates} candidates, ${res.stats.from_cache} from cache, ${res.stats.new_calls} new, ${res.stats.failed} failed`);
  }

  // b3. Relevance pass: one call, ids only. The roasters see only what it keeps.
  let precedents = pool.slice(0, opts.precedentLimit ?? 15);
  if (pool.length > 0 && opts.enrich !== false) {
    try {
      const rel = await backend.complete<{ relevant_ids: string[] }>({
        label: "relevance",
        model: models.roaster,
        system: `${prompts.relevance}\n\n${outputContract(RELEVANCE_SCHEMA, false)}`,
        prompt: `${head}\n\n# Brief\n\n${JSON.stringify(brief, null, 1)}\n\n# Candidates\n\n${renderPrecedentsForPrompt(pool)}\n\n# Task\n\nReturn the ids of the relevant candidates. JSON only.`,
        schema: RELEVANCE_SCHEMA,
      });
      if (!backend.dryRun) {
        const ids = filterPrecedentIds(rel.relevant_ids, new Map(pool.map((p) => [p.id, p])), "relevance", report);
        for (const p of pool) p.relevant = ids.includes(p.id);
        precedents = ids.map((id) => pool.find((p) => p.id === id)!).slice(0, opts.precedentLimit ?? 15);
        enrichment = { ...(enrichment ?? { candidates: 0, from_cache: 0, new_calls: 0, failed: 0, quotes_verified: 0, quotes_dropped: 0, objectors_dropped: 0 }), relevance_pass: "done", relevant: precedents.length };
        log(`relevance: ${precedents.length} of ${pool.length} candidates kept`);
      }
    } catch (e) {
      warnings.push(`the relevance pass failed (${(e as Error).message.split("\n")[0]}); the roasters got the top candidates unfiltered`);
      if (enrichment) enrichment.relevance_pass = "failed";
    }
  }
  const knownPrecedents = new Map(precedents.map((p) => [p.id, p]));
  for (const p of precedents) {
    allowed.add(p.url);
    for (const u of p.thread_urls) allowed.add(u);
    allowed.add(p.quote_message_url);
  }
  const precedentText =
    retrieved.backend === "none"
      ? "The precedent index is not available in this run: no search was done. Do not cite any earlier thread, commit or decision as a precedent, and do not claim that none exists."
      : precedents.length === 0 && pool.length > 0
        ? `The corpus search returned ${pool.length} candidates and none of them is about the same or a similar idea. No precedent found. Do not cite any earlier thread, commit or decision as a precedent.`
        : renderPrecedentsForPrompt(precedents);
  log(`precedents: ${precedents.length} shown to the roasters, ${pool.length} retrieved (backend: ${retrieved.backend})`);

  const shared = [
    head,
    `# Brief\n\n${JSON.stringify(brief, null, 1)}`,
    `# Material\n\n${material.text}`,
    `# Precedents (retrieved by code; keyword search, so check relevance)\n\n${precedentText}`,
  ].join("\n\n");

  // c. Roasters, independent, in parallel (the backend limits concurrency)
  log(`roasters: ${angles.join(", ")} ...`);
  const visible = new Set(proposal.thread.messages.map((m) => m.index));
  const msgByIndex = new Map(proposal.thread.messages.map((m) => [m.index, m]));
  const roasterNotes: Roast["roaster_notes"] = [];
  const objections: FinalObjection[] = [];
  const rounds: RoundRecord[] = [];
  let roasterPrior: RawPriorAttempt[] = [];

  /** Sanitise one raw objection and resolve its references. Links come from code. */
  const resolve = (o: RawObjection, stage: string) => {
    const precedent_ids = filterPrecedentIds(o.precedent_ids, knownPrecedents, stage, report);
    const refs = filterThreadRefs(o.thread_message_refs, visible, stage, report);
    return {
      ...o,
      precedent_ids,
      thread_message_refs: refs,
      touch_points: [...new Set(o.touch_points)],
      precedents: precedent_ids.map((id) => {
        const p = knownPrecedents.get(id)!;
        return { id, title: p.title, url: p.url, thread_urls: p.thread_urls, date: p.date, status: p.status };
      }),
      thread_refs: refs.map((n) => {
        const m = msgByIndex.get(n)!;
        return { index: n, from: m.from.replace(/\s*<[^>]*>\s*$/, ""), date: m.date, url: m.url };
      }),
    };
  };
  const addObjections = (angle: Angle, raws: RawObjection[], round: number, stage: string): FinalObjection[] => {
    const added: FinalObjection[] = [];
    for (const o of raws) {
      const n = objections.filter((x) => x.angle === angle && x.round === round).length + 1;
      const fo: FinalObjection = {
        ...resolve(o, stage),
        id: round === 0 ? `${angle}-${n}` : `${angle}-r${round}-${n}`,
        angle,
        round,
        revised_in_round: null,
        status: "survived",
        withdrawal: null,
        critic: { refutation_kind: "none", reasoning: "", original_severity: null },
        not_ranked_reason: null,
      };
      objections.push(fo);
      added.push(fo);
    }
    return added;
  };

  const forPrompt = (o: FinalObjection) => ({
    id: o.id,
    angle: o.angle,
    title: o.title,
    level: o.level,
    rubric_item: o.rubric_item,
    category: o.category,
    touch_points: o.touch_points,
    severity: o.severity,
    failure_scenario: o.failure_scenario,
    argument: o.argument,
    precedent_ids: o.precedent_ids,
    thread_message_refs: o.thread_message_refs,
    author_must_show: o.author_must_show,
  });
  const withVerdict = (o: FinalObjection) => ({
    ...forPrompt(o),
    round: o.round,
    status: o.status,
    critic_reasoning: o.critic.reasoning,
    severity_before_critic: o.critic.original_severity,
    ...(o.withdrawal ? { withdrawn_because: o.withdrawal.reason } : {}),
  });

  /** d. Critic: tries to refute the given objections; one verdict each. */
  const runCritic = async (targets: FinalObjection[], label: string): Promise<void> => {
    if (targets.length === 0 && !backend.dryRun) return;
    log(`${label} ...`);
    const earlier = objections.filter((o) => !targets.includes(o) && o.status !== "withdrawn");
    const critic = scrubUrls(
      await backend.complete<CriticOutput>({
        label,
        model: models.critic,
        system: criticSystem(prompts, invariantsText),
        prompt: [
          shared,
          ...(earlier.length && targets.length ? [`# Objections already checked in earlier rounds (for duplicate detection only; give no verdict on these)\n\n${JSON.stringify(earlier.map((o) => ({ id: o.id, title: o.title, status: o.status })), null, 1)}`] : []),
          `# Objections to refute\n\n${JSON.stringify(targets.map(forPrompt), null, 1)}`,
          `# Task\n\nTry to refute each objection. One verdict per id: ${targets.map((o) => o.id).join(", ") || "(none)"}. JSON only.`,
        ].join("\n\n"),
        schema: CRITIC_SCHEMA,
      }),
      allowed,
      label,
      report,
    );
    const verdicts = new Map(critic.verdicts.map((v) => [v.objection_id.trim(), v]));
    for (const o of targets) {
      const v = verdicts.get(o.id);
      if (!v) {
        warnings.push(`the critic gave no verdict on ${o.id}; kept as survived, unchecked`);
        o.critic.reasoning = "(the critic gave no verdict; this objection was not checked)";
        continue;
      }
      o.status = v.verdict;
      o.critic.refutation_kind = v.verdict === "refuted" ? v.refutation_kind : "none";
      o.critic.reasoning = v.reasoning;
      if (v.verdict === "survived" && v.adjusted_severity && v.adjusted_severity !== o.severity) {
        o.critic.original_severity = o.severity;
        o.severity = v.adjusted_severity;
      }
    }
    const ok = targets.filter((o) => o.status === "survived").length;
    log(`${label}: ${ok} survived, ${targets.length - ok} refuted`);
  };

  // Round 0: the first pass.
  let callsBefore = backend.stats().calls;
  const outputs = await Promise.all(
    angles.map(async (angle) => {
      try {
        const out = await backend.complete<RoasterOutput>({
          label: `roaster-${angle}`,
          model: models.roaster,
          system: roasterSystem(prompts, angle, invariantsText),
          prompt: `${shared}\n\n# Task\n\nRoast this proposal from your angle (${angle}). Zero objections is a valid answer. JSON only.`,
          schema: ROASTER_SCHEMA,
        });
        return { angle, out, error: null as string | null };
      } catch (e) {
        return { angle, out: null, error: (e as Error).message };
      }
    }),
  );
  if (outputs.every((o) => o.error)) throw new Error(`every roaster failed; first error: ${outputs[0]!.error}`);

  const ran: Angle[] = [];
  for (const { angle, out, error } of outputs) {
    if (!out) {
      warnings.push(`roaster "${angle}" failed and is missing from this roast: ${error}`);
      roasterNotes.push({ angle, objections: 0, note: `FAILED: ${error}` });
      continue;
    }
    ran.push(angle);
    const stage = `roaster-${angle}`;
    const clean = scrubUrls(out, allowed, stage, report);
    addObjections(angle, clean.objections, 0, stage);
    if (angle === "prior-attempts") roasterPrior = clean.prior_attempts;
    else if (clean.prior_attempts.length) warnings.push(`roaster "${angle}" returned prior attempts; ignored (only the prior-attempts roaster may)`);
    roasterNotes.push({ angle, objections: clean.objections.length, note: clean.no_objection_note });
  }
  log(`objections raised: ${objections.length}`);
  await runCritic([...objections], "critic");
  rounds.push({
    round: 0,
    kind: "initial",
    llm_calls: backend.stats().calls - callsBefore,
    new_objections: objections.length,
    new_survived: objections.filter((o) => o.status === "survived").length,
    revised: 0,
    withdrawn: 0,
    follow_ups: [],
    note: "",
  });

  // Extra rounds (--rounds N). Same evidence rules, same no-tools guarantee; a round may add nothing.
  const answersOf = (angle: Angle) => ({
    objections: objections.filter((o) => o.angle === angle).map(withVerdict),
    note: roasterNotes.find((n) => n.angle === angle)?.note ?? "",
  });
  for (let round = 1; round <= maxRounds; round++) {
    callsBefore = backend.stats().calls;
    const fresh: FinalObjection[] = [];
    const rec: RoundRecord = { round, kind: round === 1 ? "what_did_you_forget" : round === 2 ? "are_you_happy" : "supervisor", llm_calls: 0, new_objections: 0, new_survived: 0, revised: 0, withdrawn: 0, follow_ups: [], note: "" };

    if (round <= 2) {
      // Reflection: every roaster that ran gets one short question about its own answer.
      const question = round === 1 ? FORGOT_PROMPT : HAPPY_PROMPT;
      log(`round ${round}: "${question}" ...`);
      const replies = await Promise.all(
        ran.map(async (angle) => {
          try {
            const out = await backend.complete<ReflectOutput>({
              label: `round${round}-${angle}`,
              model: models.roaster,
              system: reflectSystem(prompts, angle, invariantsText),
              prompt: `${shared}\n\n# Your answers so far (angle: ${angle})${round >= 2 ? ", with the critic's verdicts" : ""}\n\n${JSON.stringify(answersOf(angle), null, 1)}\n\n# Question\n\n${question}`,
              schema: REFLECT_SCHEMA,
            });
            return { angle, out };
          } catch (e) {
            warnings.push(`round ${round}: roaster "${angle}" failed: ${(e as Error).message.split("\n")[0]}`);
            return { angle, out: null };
          }
        }),
      );
      for (const { angle, out } of replies) {
        if (!out) continue;
        const stage = `round${round}-${angle}`;
        const clean = scrubUrls(out, allowed, stage, report);
        fresh.push(...addObjections(angle, clean.objections, round, stage));
        if (round >= 2) {
          const own = (id: string) => objections.find((o) => o.id === id.trim() && o.angle === angle && o.status !== "withdrawn");
          for (const w of clean.withdrawn) {
            const o = own(w.objection_id);
            if (!o) {
              warnings.push(`round ${round}: "${angle}" tried to withdraw "${w.objection_id}", which is not an open objection of its own; ignored`);
              continue;
            }
            // Recorded with its reason, never deleted.
            o.status = "withdrawn";
            o.withdrawal = { round, reason: w.reason };
            rec.withdrawn++;
          }
          for (const rv of clean.revised) {
            const o = own(rv.objection_id);
            if (!o) {
              warnings.push(`round ${round}: "${angle}" tried to revise "${rv.objection_id}", which is not an open objection of its own; ignored`);
              continue;
            }
            Object.assign(o, resolve(rv.objection, stage), { revised_in_round: round, status: "survived", critic: { refutation_kind: "none", reasoning: "", original_severity: null } });
            if (!fresh.includes(o)) fresh.push(o);
            rec.revised++;
          }
        } else if (clean.withdrawn.length || clean.revised.length) {
          warnings.push(`round 1: "${angle}" returned revisions or withdrawals; ignored (round 1 only adds)`);
        }
        if (clean.note.trim()) rec.note += `${angle}: ${clean.note.trim()} `;
      }
    } else {
      // Supervisor: names what nobody examined; an empty list ends the loop.
      log(`round ${round}: supervisor ...`);
      let sup: SupervisorOutput;
      try {
        sup = scrubUrls(
          await backend.complete<SupervisorOutput>({
            label: `round${round}-supervisor`,
            model: models.critic,
            system: supervisorSystem(prompts),
            prompt: [
              head,
              `# Brief\n\n${JSON.stringify(brief, null, 1)}`,
              `# Files touched by the patch\n\n${touched.length ? touched.map((f) => `- ${f}`).join("\n") : "(no patch read)"}`,
              `# Objections so far\n\n${JSON.stringify(objections.map(withVerdict), null, 1)}`,
              `# Roaster notes\n\n${roasterNotes.map((n) => `- ${n.angle}: ${n.objections} objection(s) in the first pass. ${n.note}`).join("\n")}`,
              `# Angles you can send back\n\n${ran.join(", ")}`,
              "# Task\n\nName up to 3 uncovered areas, or none. JSON only.",
            ].join("\n\n"),
            schema: SUPERVISOR_SCHEMA,
          }),
          allowed,
          `round${round}-supervisor`,
          report,
        );
      } catch (e) {
        warnings.push(`round ${round}: the supervisor failed: ${(e as Error).message.split("\n")[0]}; rounds stopped`);
        break;
      }
      rec.note = sup.coverage_note;
      const follow = sup.follow_ups.filter((f) => ran.includes(f.angle)).slice(0, 3);
      rec.follow_ups = follow.map((f) => ({ angle: f.angle, uncovered_area: f.uncovered_area }));
      const replies = await Promise.all(
        follow.map(async (f, i) => {
          try {
            const out = await backend.complete<RoasterOutput>({
              label: `round${round}-followup${i + 1}-${f.angle}`,
              model: models.roaster,
              system: roasterSystem(prompts, f.angle, invariantsText),
              prompt: `${shared}\n\n# Your answers so far (angle: ${f.angle})\n\n${JSON.stringify(answersOf(f.angle), null, 1)}\n\n# Follow-up from the supervisor\n\nArea not covered: ${f.uncovered_area}\n\n${f.instruction}\n\n# Task\n\nExamine this area only, from your angle (${f.angle}). Return only new objections about it; do not repeat earlier ones. An empty list is a valid answer: say in no_objection_note what you checked. JSON only.`,
              schema: ROASTER_SCHEMA,
            });
            return { f, out };
          } catch (e) {
            warnings.push(`round ${round}: follow-up for "${f.angle}" failed: ${(e as Error).message.split("\n")[0]}`);
            return { f, out: null };
          }
        }),
      );
      for (const { f, out } of replies) {
        if (!out) continue;
        const stage = `round${round}-${f.angle}`;
        fresh.push(...addObjections(f.angle, scrubUrls(out, allowed, stage, report).objections, round, stage));
      }
      if (follow.length === 0) {
        rec.llm_calls = backend.stats().calls - callsBefore;
        rounds.push(rec);
        log(`round ${round}: the supervisor found the coverage adequate; rounds end`);
        break;
      }
    }

    const added = fresh.filter((o) => o.round === round);
    await runCritic(fresh, `critic-round${round}`);
    rec.new_objections = added.length;
    rec.new_survived = added.filter((o) => o.status === "survived").length;
    rec.llm_calls = backend.stats().calls - callsBefore;
    rounds.push(rec);
    log(`round ${round}: ${rec.new_objections} new (${rec.new_survived} survived), ${rec.revised} revised, ${rec.withdrawn} withdrawn`);
  }

  // e. Synthesis
  log("synthesis ...");
  const synthMaterial = renderMaterial(proposal, { maxMessages: 3, maxThreadChars: 40_000 });
  const live = objections.filter((o) => o.status !== "withdrawn");
  const synth = scrubUrls(
    await backend.complete<SynthOutput>({
      label: "synth",
      model: models.synth,
      system: synthSystem(prompts, selfMode),
      prompt: [
        head,
        `# Brief\n\n${JSON.stringify(brief, null, 1)}`,
        `# Material (start of the thread and patch prose)\n\n${synthMaterial.text}`,
        `# Precedents (retrieved by code)\n\n${precedentText}`,
        `# Prior attempts proposed by the prior-attempts roaster\n\n${JSON.stringify(roasterPrior, null, 1)}`,
        `# Objections with the critic's verdicts\n\n${JSON.stringify(
          live.map((o) => ({ ...forPrompt(o), critic_verdict: o.status, critic_reasoning: o.critic.reasoning, severity_before_critic: o.critic.original_severity })),
          null,
          1,
        )}`,
        `# Roaster notes\n\n${roasterNotes.map((n) => `- ${n.angle}: ${n.objections} objection(s). ${n.note}`).join("\n")}`,
        `# Task\n\nWrite the synthesis${selfMode ? " for the author (self mode)" : ""}. JSON only.`,
      ].join("\n\n"),
      schema: selfMode ? SYNTH_SELF_SCHEMA : SYNTH_SCHEMA,
    }),
    allowed,
    "synth",
    report,
  );

  const asm = assemble({ synth, objections, precedents, threadText, report, warnings });
  if (retrieved.backend === "none") {
    warnings.push('prior attempts: the corpus was not searched, so an empty list does NOT mean "no precedent found"');
  }

  // "Not now" is for the case where only demand / accumulation fails; it is not a verdict.
  const notNow = { ...synth.not_now, evidence_that_would_change_it: synth.not_now.applies ? synth.not_now.evidence_that_would_change_it : "" };
  if (notNow.applies && asm.objections.some((o) => o.severity === "fatal")) {
    warnings.push('synthesis set "not now" although a fatal objection is listed; "not now" is meant for the case where only demand or accumulation fails');
  }
  if (notNow.applies && !notNow.evidence_that_would_change_it.trim()) {
    warnings.push('synthesis set "not now" without saying what evidence would change it');
  }

  // Self mode: advice per surviving objection, in the model's order; unknown ids are dropped.
  const selfAdvice: SelfAdvice[] = [];
  if (selfMode) {
    const surviving = new Set([...asm.objections, ...asm.other_surviving].map((o) => o.id));
    for (const a of synth.self_advice ?? []) {
      const id = a.objection_id.trim();
      if (surviving.has(id) && !selfAdvice.some((x) => x.objection_id === id)) selfAdvice.push({ ...a, objection_id: id });
      else if (!surviving.has(id)) warnings.push(`self advice for "${a.objection_id}", which is not a surviving objection; dropped`);
    }
  }

  const st = backend.stats();
  return {
    schema_version: SCHEMA_VERSION,
    tool: "pgroast/0.1",
    generated_at: now.toISOString(),
    input: {
      arg: proposal.input,
      cf: proposal.cf
        ? {
            id: proposal.cf.id,
            url: proposal.cf.url,
            title: proposal.cf.title,
            status: proposal.cf.status,
            authors: proposal.cf.authors,
            redacted: proposal.cf.redacted,
          }
        : null,
      thread_url: proposal.thread.threadUrl,
      subject: proposal.thread.subject,
      thread_start: proposal.threadStart,
      messages_read: proposal.thread.messages.length,
      messages_total: proposal.totalMessages,
      blind: proposal.filters.blind,
      before: proposal.filters.before,
      hint: opts.hint ?? null,
      attachments_read: proposal.patchProse.map((p) => p.attachment.name),
    },
    mode: selfMode ? "self" : "review",
    backend: opts.backendName ?? (backend.dryRun ? "dry-run" : "claude"),
    models,
    verdict: asm.verdict,
    confidence: synth.confidence,
    verdict_reasoning: synth.verdict_reasoning,
    failing_level: asm.failing_level,
    levels: asm.levels,
    brief,
    prior_attempts: asm.prior_attempts,
    objections: asm.objections,
    other_surviving: asm.other_surviving,
    refuted: asm.refuted,
    withdrawn: asm.withdrawn,
    touch_points: asm.touch_points,
    questions: synth.questions.slice(0, 5),
    committability: synth.committability,
    not_now: notNow,
    priority: synth.priority,
    self_advice: selfAdvice,
    provisional_note: synth.provisional_note,
    disclosure: DISCLOSURE,
    precedents_retrieved: pool,
    enrichment,
    precedent_cutoff: cutoff,
    precedent_backend: retrieved.backend,
    roaster_notes: roasterNotes,
    rounds_requested: maxRounds,
    rounds,
    invariants_loaded: invariantFiles.map((f) => f.file),
    warnings,
    sanitizer: report,
    stats: { llm_calls: st.calls, wall_ms: Date.now() - t0, cost_usd: st.costUsd, dry_run: backend.dryRun },
  };
}
