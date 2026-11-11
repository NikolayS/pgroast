// PG Roast data model: the types of roast.json, the JSON Schemas the model must follow at each
// stage, and a small validator for them. No dependencies.

// ---------------------------------------------------------------------------------------------
// Constants

export const SCHEMA_VERSION = 1;

/** Verbatim from the issue. Never produced by the model. */
export const DISCLOSURE = "Prepared by an AI harness; treat as a devil's advocate, not a verdict.";

export const VERDICTS = [
  "LIKELY-REJECT",
  "NEEDS-DESIGN-DISCUSSION",
  "NEEDS-COMMITTER-EYES",
  "NO-FUNDAMENTAL-OBJECTION",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * Levels of the review pyramid that PG Roast judges (prompts/committer-paranoia.md), base first.
 * 1a understandability, 1b desirability, 2 architecture and design.
 */
export const LEVELS = ["1a", "1b", "2"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_NAMES: Record<Level, string> = {
  "1a": "Level 1a: understandability",
  "1b": "Level 1b: desirability",
  "2": "Level 2: architecture and design",
};
export const levelRank = (l: Level): number => LEVELS.indexOf(l);

/** The 15 touch points of the issue, in the issue's order. */
export const TOUCH_POINTS = [
  { id: "on_disk_pg_upgrade", label: "on-disk format / pg_upgrade" },
  { id: "wal_replication", label: "WAL / replication / standby" },
  { id: "wire_protocol", label: "wire protocol" },
  { id: "catalog", label: "catalog changes" },
  { id: "abi_extension_api", label: "ABI / extension API" },
  { id: "sql_standard_syntax", label: "SQL-standard conflict or non-standard syntax" },
  { id: "new_guc", label: "new GUC" },
  { id: "planner_behaviour", label: "planner behaviour change" },
  { id: "pg_dump_round_trip", label: "pg_dump / restore round-trip" },
  { id: "psql_ux", label: "psql UX conventions" },
  { id: "security_privileges", label: "security / privileges" },
  { id: "backpatchability", label: "backpatchability" },
  { id: "maintenance_burden", label: 'maintenance burden ("who maintains this in 10 years")' },
  { id: "hot_path_performance", label: "performance on the hot path" },
  { id: "does_not_fit", label: "doesn't fit what Postgres is about (extension / external tool / already solved)" },
] as const;
export type TouchPointId = (typeof TOUCH_POINTS)[number]["id"];
export const TOUCH_POINT_IDS = TOUCH_POINTS.map((t) => t.id) as TouchPointId[];

/** Objection categories: a touch point, or one of the non-touch-point classes. */
export const EXTRA_CATEGORIES = ["problem_statement", "desirability", "demand", "prior_rejection", "design"] as const;
export const CATEGORIES = [...TOUCH_POINT_IDS, ...EXTRA_CATEGORIES] as const;
export type Category = (typeof CATEGORIES)[number];

export const ANGLES = [
  "prior-attempts",
  "standards-compat",
  "replication-ondisk",
  "security",
  "maintenance-fit",
  "already-exists",
  "demand",
] as const;
export type Angle = (typeof ANGLES)[number];

export const SEVERITIES = ["fatal", "fixable"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const REFUTATION_KINDS = [
  "none",
  "wrong_facts",
  "precedent_mismatch",
  "outdated_reason",
  "already_handled",
  "not_specific",
  "no_failure_scenario",
] as const;
export type RefutationKind = (typeof REFUTATION_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Stage outputs (what the model returns)

export interface Brief {
  title: string;
  problem: string;
  proposed_design: string;
  user_visible_surface: string[];
  author_claims: string[];
  thread_state: string;
  unclear: string[];
  search_queries: string[];
}

export interface RawObjection {
  title: string;
  level: Level;
  /** Item number in the rubric (1-16), or null. */
  rubric_item: number | null;
  category: Category;
  touch_points: TouchPointId[];
  severity: Severity;
  /** The horror story: what concretely goes wrong, for whom, when. */
  failure_scenario: string;
  /** Why this applies to this proposal (facts from the thread / brief). */
  argument: string;
  /** Ids from the retrieved precedent list (P1, P2, ...). */
  precedent_ids: string[];
  /** Indexes of thread messages relied on. */
  thread_message_refs: number[];
  author_must_show: string;
}

export interface RawPriorAttempt {
  precedent_id: string;
  relation: "same_idea" | "similar_idea" | "related_only";
  what_is_different: string;
  /** A sentence copied verbatim from the precedent text, or null. Verified by code. */
  quote: string | null;
}

export interface RoasterOutput {
  objections: RawObjection[];
  /** Only the prior-attempts roaster fills this. */
  prior_attempts: RawPriorAttempt[];
  /** Why there are no objections from this angle (when the list is empty), else "". */
  no_objection_note: string;
}

export interface CriticVerdict {
  objection_id: string;
  verdict: "survived" | "refuted";
  refutation_kind: RefutationKind;
  reasoning: string;
  /** Set when the objection survives but with a different severity. */
  adjusted_severity: Severity | null;
}

export interface CriticOutput {
  verdicts: CriticVerdict[];
}

export const OWNER_STATES = ["qualified committer engaged", "silent", "none obvious"] as const;
export type OwnerState = (typeof OWNER_STATES)[number];

/**
 * "Will not get committed" is not "should be rejected": this is reported apart from the verdict
 * (rubric, last section) and must never raise the verdict to LIKELY-REJECT by itself.
 */
export interface Committability {
  /** Who would own the aftermath. */
  owner: OwnerState;
  /** Which kind of committer that is (by area), in one sentence. */
  owner_note: string;
  /** What the owner signs for, and for how long. */
  liability: string;
  /** Any sign in the thread that the author stays for fixes. */
  author_follow_up: string;
}

/** "Not now / show demand": a visible outcome, not a fifth verdict. */
export interface NotNow {
  /** True when only the demand / accumulation items (rubric items 3, 5) fail. */
  applies: boolean;
  /** What evidence would change the answer; "" when it does not apply. */
  evidence_that_would_change_it: string;
}

export interface SynthOutput {
  verdict: Verdict;
  confidence: Confidence;
  verdict_reasoning: string;
  /** Lowest pyramid level that fails, or null when none does. */
  failing_level: Level | null;
  /** 0-5 ids of surviving objections, strongest first. */
  ranked_objection_ids: string[];
  touch_points: { id: TouchPointId; hit: boolean; reason: string }[];
  questions: string[];
  prior_attempts: RawPriorAttempt[];
  committability: Committability;
  not_now: NotNow;
  /** What could not be judged without reading the code. */
  provisional_note: string;
}

// ---------------------------------------------------------------------------------------------
// Precedents (normalised by src/roast/precedents.ts; every field comes from the corpus DB)

export interface Precedent {
  /** Run-local id shown to the model: P1, P2, ... */
  id: string;
  /** Id in the corpus, e.g. "cf:5253", "revert:<sha>". */
  source_id: string;
  kind: string;
  title: string;
  status: string;
  /** Decision / close date (ISO) or null. */
  date: string | null;
  /** Thread start date (ISO) or null. */
  first_date: string | null;
  url: string;
  thread_urls: string[];
  authors: string;
  objectors: string;
  summary: string;
  objection: string;
  touch_points: string[];
  /** Which queries found it. */
  matched_queries: string[];
  /** True when found by the --hint directed lookup. */
  from_hint: boolean;
  score: number;
}

// ---------------------------------------------------------------------------------------------
// roast.json

export interface FinalObjection extends RawObjection {
  /** Run-local id, e.g. "security-1". */
  id: string;
  angle: Angle;
  status: "survived" | "refuted";
  critic: {
    refutation_kind: RefutationKind;
    reasoning: string;
    /** Severity the roaster gave, when the critic changed it. */
    original_severity: Severity | null;
  };
  /** Precedents relied on, resolved by code from precedent_ids. Links come from the DB only. */
  precedents: { id: string; title: string; url: string; thread_urls: string[]; date: string | null; status: string }[];
  /** Thread messages relied on, resolved by code. */
  thread_refs: { index: number; from: string; date: string; url: string }[];
  /** Why a surviving objection is not in the ranked list (stop rule, rank cut), else null. */
  not_ranked_reason: string | null;
}

export interface PriorAttempt {
  precedent_id: string;
  source_id: string;
  title: string;
  kind: string;
  status: string;
  /** Link(s): from the corpus DB only. */
  url: string;
  thread_urls: string[];
  date: string | null;
  first_date: string | null;
  /** From the corpus DB; "" when the DB does not record it. */
  who_objected: string;
  /** Verbatim sentence found in the DB text, or null = "quote unavailable". */
  quote: string | null;
  relation: "same_idea" | "similar_idea" | "related_only";
  what_is_different: string;
}

export interface TouchPointResult {
  id: TouchPointId;
  label: string;
  hit: boolean;
  reason: string;
}

export interface SanitizerReport {
  /** URLs in model output that were not in the allowed set, with where they were found. */
  urls_removed: { stage: string; url: string }[];
  /** Precedent ids the model cited that are not in the retrieved list. */
  precedent_ids_dropped: { stage: string; id: string }[];
  /** Thread message indexes the model cited that are not in the visible thread. */
  thread_refs_dropped: { stage: string; index: number }[];
  /** Quotes that were not found verbatim in the precedent text. */
  quotes_dropped: { precedent_id: string; quote: string }[];
}

export interface RoastInputInfo {
  arg: string;
  cf: {
    id: number;
    url: string;
    title: string;
    status: string | null;
    authors: string;
    redacted: boolean;
  } | null;
  thread_url: string;
  subject: string;
  thread_start: string;
  messages_read: number;
  messages_total: number;
  blind: number | null;
  before: string | null;
  hint: string | null;
  attachments_read: string[];
}

export interface Roast {
  schema_version: number;
  tool: string;
  generated_at: string;
  input: RoastInputInfo;
  /** "claude" | "codex" | "dry-run" | "test". */
  backend: string;
  models: { roaster: string; critic: string; synth: string; brief: string };

  verdict: Verdict;
  confidence: Confidence;
  verdict_reasoning: string;
  failing_level: Level | null;
  /** Base-up status of each level: levels above the failing one are not evaluated. */
  levels: { level: Level; name: string; status: "passed" | "failed" | "not_evaluated" }[];

  brief: Brief;
  /** Empty = "no precedent found". */
  prior_attempts: PriorAttempt[];
  /** The ranked surviving objections (the steelman), strongest first. */
  objections: FinalObjection[];
  /** Survived the critic but not listed in the steelman. */
  other_surviving: FinalObjection[];
  refuted: FinalObjection[];
  touch_points: TouchPointResult[];
  questions: string[];
  committability: Committability;
  not_now: NotNow;
  provisional_note: string;
  disclosure: string;

  /** Audit trail. */
  precedents_retrieved: Precedent[];
  /** Precedents dated on or after this day were excluded. */
  precedent_cutoff: string;
  /** Which corpus backend answered; "none" = the search was not done. */
  precedent_backend: string;
  roaster_notes: { angle: Angle; objections: number; note: string }[];
  warnings: string[];
  sanitizer: SanitizerReport;
  stats: { llm_calls: number; wall_ms: number; cost_usd: number | null; dry_run: boolean };
}

// ---------------------------------------------------------------------------------------------
// JSON Schema subset + validator

export type JsonSchema =
  | { type: "string"; enum?: readonly string[]; minLength?: number; nullable?: boolean }
  | { type: "integer" | "number"; minimum?: number; maximum?: number; nullable?: boolean }
  | { type: "boolean"; nullable?: boolean }
  | { type: "array"; items: JsonSchema; minItems?: number; maxItems?: number; nullable?: boolean }
  | {
      type: "object";
      properties: Record<string, JsonSchema>;
      required?: readonly string[];
      nullable?: boolean;
    };

/** Returns a list of problems; empty means valid. Unknown object keys are allowed. */
export function validate(value: unknown, schema: JsonSchema, path = "$"): string[] {
  if (value === null || value === undefined) {
    return schema.nullable && value === null ? [] : [`${path}: expected ${schema.type}, got ${value === null ? "null" : "nothing"}`];
  }
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return [`${path}: expected string, got ${typeName(value)}`];
      if (schema.enum && !schema.enum.includes(value)) {
        return [`${path}: "${value}" is not one of ${schema.enum.join(" | ")}`];
      }
      if (schema.minLength && value.trim().length < schema.minLength) return [`${path}: must not be empty`];
      return [];
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path}: expected ${schema.type}, got ${typeName(value)}`];
      if (schema.type === "integer" && !Number.isInteger(value)) return [`${path}: expected integer`];
      if (schema.minimum != null && value < schema.minimum) return [`${path}: below minimum ${schema.minimum}`];
      if (schema.maximum != null && value > schema.maximum) return [`${path}: above maximum ${schema.maximum}`];
      return [];
    }
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean, got ${typeName(value)}`];
    case "array": {
      if (!Array.isArray(value)) return [`${path}: expected array, got ${typeName(value)}`];
      const errs: string[] = [];
      if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: needs at least ${schema.minItems} items, has ${value.length}`);
      if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path}: at most ${schema.maxItems} items, has ${value.length}`);
      value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)));
      return errs;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return [`${path}: expected object, got ${typeName(value)}`];
      const errs: string[] = [];
      const obj = value as Record<string, unknown>;
      for (const k of schema.required ?? Object.keys(schema.properties)) {
        if (!(k in obj)) errs.push(`${path}.${k}: missing`);
      }
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in obj) errs.push(...validate(obj[k], sub, `${path}.${k}`));
      }
      return errs;
    }
  }
}

function typeName(v: unknown): string {
  return Array.isArray(v) ? "array" : typeof v;
}

const str: JsonSchema = { type: "string" };
const nonEmpty: JsonSchema = { type: "string", minLength: 1 };
const strList = (min = 0, max?: number): JsonSchema => ({ type: "array", items: nonEmpty, minItems: min, ...(max != null ? { maxItems: max } : {}) });

export const BRIEF_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: nonEmpty,
    problem: nonEmpty,
    proposed_design: nonEmpty,
    user_visible_surface: strList(),
    author_claims: strList(),
    thread_state: str,
    unclear: strList(),
    search_queries: strList(5, 8),
  },
};

const OBJECTION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: nonEmpty,
    level: { type: "string", enum: LEVELS },
    rubric_item: { type: "integer", minimum: 1, maximum: 16, nullable: true },
    category: { type: "string", enum: CATEGORIES },
    touch_points: { type: "array", items: { type: "string", enum: TOUCH_POINT_IDS } },
    severity: { type: "string", enum: SEVERITIES },
    failure_scenario: nonEmpty,
    argument: nonEmpty,
    precedent_ids: { type: "array", items: str },
    thread_message_refs: { type: "array", items: { type: "integer", minimum: 1 } },
    author_must_show: nonEmpty,
  },
};

const PRIOR_ATTEMPT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    precedent_id: nonEmpty,
    relation: { type: "string", enum: ["same_idea", "similar_idea", "related_only"] },
    what_is_different: nonEmpty,
    quote: { type: "string", nullable: true },
  },
};

export const ROASTER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    objections: { type: "array", items: OBJECTION_SCHEMA, maxItems: 4 },
    prior_attempts: { type: "array", items: PRIOR_ATTEMPT_SCHEMA },
    no_objection_note: str,
  },
};

export const CRITIC_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          objection_id: nonEmpty,
          verdict: { type: "string", enum: ["survived", "refuted"] },
          refutation_kind: { type: "string", enum: REFUTATION_KINDS },
          reasoning: nonEmpty,
          adjusted_severity: { type: "string", enum: SEVERITIES, nullable: true },
        },
      },
    },
  },
};

export const SYNTH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    confidence: { type: "string", enum: CONFIDENCES },
    verdict_reasoning: nonEmpty,
    failing_level: { type: "string", enum: LEVELS, nullable: true },
    ranked_objection_ids: { type: "array", items: nonEmpty, maxItems: 5 },
    touch_points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: TOUCH_POINT_IDS },
          hit: { type: "boolean" },
          reason: str,
        },
      },
    },
    questions: strList(0, 5),
    prior_attempts: { type: "array", items: PRIOR_ATTEMPT_SCHEMA },
    committability: {
      type: "object",
      properties: {
        owner: { type: "string", enum: OWNER_STATES },
        owner_note: str,
        liability: nonEmpty,
        author_follow_up: nonEmpty,
      },
    },
    not_now: {
      type: "object",
      properties: {
        applies: { type: "boolean" },
        evidence_that_would_change_it: str,
      },
    },
    provisional_note: str,
  },
};
