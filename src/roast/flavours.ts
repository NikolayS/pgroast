export const ROAST_LEVELS = ["light", "medium", "dark"] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

export const ROAST_FLAVOURS = [
  "default",
  "edge-case-hunter",
  "spec-lawyer",
  "systems-architect",
  "perf-hawk",
  "storage-skeptic",
  "index-specialist",
  "production-dba",
] as const;
export type RoastFlavour = (typeof ROAST_FLAVOURS)[number];

export interface RoastLevelInfo {
  id: RoastLevel;
  label: string;
  shortLabel: string;
  description: string;
  promptInstruction: string;
}

export interface RoastFlavourInfo {
  id: RoastFlavour;
  label: string;
  shortLabel: string;
  description: string;
  promptInstruction: string;
}

export const ROAST_LEVEL_META: Record<RoastLevel, RoastLevelInfo> = {
  light: {
    id: "light",
    label: "Light roast",
    shortLabel: "Light",
    description: "Constructive, author-friendly pre-flight check focused on real blockers and clear fix paths.",
    promptInstruction: [
      "Roast level: LIGHT.",
      "- Be constructive, calm, and author-friendly while staying technically honest.",
      "- Focus only on clear, material design blockers and show concrete paths to fix or narrow the proposal.",
      "- Skip pedantic nitpicks and speculative objections; do not inflate fixable design points into fatal blockers.",
    ].join("\n"),
  },
  medium: {
    id: "medium",
    label: "Medium roast",
    shortLabel: "Medium",
    description: "Standard balanced PostgreSQL committer pre-review across all seven angles.",
    promptInstruction: "",
  },
  dark: {
    id: "dark",
    label: "Dark roast",
    shortLabel: "Dark",
    description: "Uncompromising, harsh adversarial stress-test that challenges every assumption and maintenance cost.",
    promptInstruction: [
      "Roast level: DARK (maximum adversarial rigor).",
      "- Be relentless, blunt, and deeply skeptical — zero sugar-coating, zero benefit of the doubt.",
      "- Stress-test every hand-wavy claim: demand proof of real user demand, attack hidden 10-year maintenance burdens, challenge why this cannot live in an extension or external tool, and hunt for subtle crash-recovery, WAL, pg_upgrade, locking, concurrency, and backwards-compatibility traps.",
      "- State hard conclusions plainly and directly, while staying strictly grounded in technical evidence (never personal attacks or ad-hominem remarks).",
    ].join("\n"),
  },
};

export const ROAST_FLAVOUR_META: Record<RoastFlavour, RoastFlavourInfo> = {
  default: {
    id: "default",
    label: "House Blend",
    shortLabel: "House Blend",
    description: "Balanced, neutral PostgreSQL design pre-review across all core angles.",
    promptInstruction: "",
  },
  "edge-case-hunter": {
    id: "edge-case-hunter",
    label: "The Edge-Case Hunter",
    shortLabel: "The Edge-Case Hunter",
    description: "Sharp, terse scrutiny of planner/executor edge cases, catalog/ABI invariants, memory contexts, and under-thought corners.",
    promptInstruction: [
      "Review archetype: THE EDGE-CASE HUNTER (planner, parser & query semantics focus).",
      "- Write in a concise, sharp, skeptical engineering voice that spots under-thought assumptions quickly.",
      "- Scrutinize planner/executor semantics, catalog and syscache invariants, memory-context lifetimes, transaction/subtransaction abort paths, NULL handling, and surprising corner-case interactions with existing SQL features.",
      "- Call out vague specifications or half-baked designs directly.",
    ].join("\n"),
  },
  "spec-lawyer": {
    id: "spec-lawyer",
    label: "The Spec Lawyer",
    shortLabel: "The Spec Lawyer",
    description: "SQL standard rigor, syntax/naming consistency, documentation clarity, wire protocol, and portability discipline.",
    promptInstruction: [
      "Review archetype: THE SPEC LAWYER (SQL standard, syntax & docs focus).",
      "- Write in a crisp, methodical, standards-conscious voice.",
      "- Scrutinize SQL standard compliance and future standard conflicts, syntax and GUC naming consistency, psql/client UX, wire protocol compatibility, documentation completeness, and cross-platform/build cleanliness.",
    ].join("\n"),
  },
  "systems-architect": {
    id: "systems-architect",
    label: "The Systems Architect",
    shortLabel: "The Systems Architect",
    description: "Architecture-first review pyramid, parallelism/locking/shared-memory safety, and 10-year maintainability.",
    promptInstruction: [
      "Review archetype: THE SYSTEMS ARCHITECT (architecture, concurrency & maintainability focus).",
      "- Write in an analytical, architecture-first voice that moves cleanly from problem framing and desirability to design modularity.",
      "- Scrutinize shared memory, locking hierarchy, parallelism safety, pg_upgrade/on-disk compatibility, extensibility boundaries, and long-term maintenance burden ('who maintains this in 10 years?').",
    ].join("\n"),
  },
  "perf-hawk": {
    id: "perf-hawk",
    label: "The Perf Hawk",
    shortLabel: "The Perf Hawk",
    description: "Hot-path CPU/cache performance, AIO/buffer-manager/WAL invariants, ABI/atomics rigor, and benchmark proof.",
    promptInstruction: [
      "Review archetype: THE PERF HAWK (hot path, low-level internals & benchmarks focus).",
      "- Write in a direct, low-level systems-engineering voice focused on performance and correctness under concurrency.",
      "- Scrutinize hot-path overhead, buffer manager and WAL/AIO interactions, memory ordering/atomics, ABI stability, and whether performance claims have credible benchmark methodology.",
    ].join("\n"),
  },
  "storage-skeptic": {
    id: "storage-skeptic",
    label: "The Storage Skeptic",
    shortLabel: "The Storage Skeptic",
    description: "Storage, WAL/crash-recovery, standby replay, clean abstractions, and simplifying state machines.",
    promptInstruction: [
      "Review archetype: THE STORAGE SKEPTIC (WAL, crash safety & storage focus).",
      "- Write in a clear, pragmatic, storage-and-recovery focused voice.",
      "- Scrutinize WAL logging, crash recovery, standby replay, on-disk page format, pg_upgrade safety, state-machine simplicity, and whether a cleaner abstraction avoids brittle edge cases.",
    ].join("\n"),
  },
  "index-specialist": {
    id: "index-specialist",
    label: "The Index Specialist",
    shortLabel: "The Index Specialist",
    description: "Index access methods (GiST/GIN/B-tree), planner selectivity, concurrency/page-split edge cases, and AM extensibility.",
    promptInstruction: [
      "Review archetype: THE INDEX SPECIALIST (indexing, access methods & planner focus).",
      "- Write in a sharp, practical, algorithm-and-internals focused voice.",
      "- Scrutinize index access methods (GiST, GIN, B-tree, opclasses), planner/executor cost-model assumptions, concurrency/locking and page-split edge cases, extensibility for custom AMs/datatypes, and whether claims hold up on realistic workloads and benchmarks.",
    ].join("\n"),
  },
  "production-dba": {
    id: "production-dba",
    label: "The Production DBA",
    shortLabel: "The Production DBA",
    description: "User-facing pragmatism, DBA operability, pg_upgrade safety, avoiding GUC sprawl, and big-picture fit.",
    promptInstruction: [
      "Review archetype: THE PRODUCTION DBA (operability, upgrades & real-world demand focus).",
      "- Write in a practical, user-and-DBA-centered voice.",
      "- Scrutinize real-world operational value, pg_upgrade friction, GUC sprawl, observability, release-note explainability, and whether mainstream Postgres users actually need this complexity in core.",
    ].join("\n"),
  },
};

const FLAVOUR_ALIASES: Record<string, RoastFlavour> = {
  // Friendly short lens aliases
  "house-blend": "default",
  balanced: "default",
  neutral: "default",
  planner: "edge-case-hunter",
  "edge-case": "edge-case-hunter",
  standards: "spec-lawyer",
  spec: "spec-lawyer",
  architecture: "systems-architect",
  architect: "systems-architect",
  performance: "perf-hawk",
  perf: "perf-hawk",
  storage: "storage-skeptic",
  wal: "storage-skeptic",
  indexing: "index-specialist",
  index: "index-specialist",
  operability: "production-dba",
  dba: "production-dba",
  ops: "production-dba",
  // Silent backward-compat mapping for previously saved JSON/DB rows
  "tom-lane": "edge-case-hunter",
  "peter-eisentraut": "spec-lawyer",
  "robert-haas": "systems-architect",
  "andres-freund": "perf-hawk",
  "heikki-linnakangas": "storage-skeptic",
  "bruce-momjian": "production-dba",
  "alexander-korotkov": "index-specialist",
};

export function normalizeRoastLevel(raw?: string | null): RoastLevel {
  const v = (raw || "").trim().toLowerCase();
  if ((ROAST_LEVELS as readonly string[]).includes(v)) return v as RoastLevel;
  return "medium";
}

export function normalizeRoastFlavour(raw?: string | null): RoastFlavour {
  const v = (raw || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((ROAST_FLAVOURS as readonly string[]).includes(v)) return v as RoastFlavour;
  return FLAVOUR_ALIASES[v] ?? "default";
}

export function isValidRoastLevel(raw: string): raw is RoastLevel {
  return (ROAST_LEVELS as readonly string[]).includes(raw.trim().toLowerCase());
}

export function isValidRoastFlavour(raw: string): boolean {
  const v = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return (ROAST_FLAVOURS as readonly string[]).includes(v) || Object.prototype.hasOwnProperty.call(FLAVOUR_ALIASES, v);
}

/** Prompt block injected into roaster, critic, and synthesis stages. Empty for medium + default. */
export function buildRoastProfilePrompt(level: RoastLevel = "medium", flavour: RoastFlavour = "default"): string {
  const parts: string[] = [];
  const l = ROAST_LEVEL_META[level];
  const f = ROAST_FLAVOUR_META[flavour];
  if (l?.promptInstruction) parts.push(l.promptInstruction);
  if (f?.promptInstruction) parts.push(f.promptInstruction);
  if (parts.length === 0) return "";
  return `# Roast Level & Reviewer Archetype\n\n${parts.join("\n\n")}`;
}

export function formatRoastProfile(level?: string | null, flavour?: string | null): string {
  const l = ROAST_LEVEL_META[normalizeRoastLevel(level)];
  const f = ROAST_FLAVOUR_META[normalizeRoastFlavour(flavour)];
  if (f.id === "default") return `${l.label} · ${f.label}`;
  return `${l.label} · ${f.label} (AI persona)`;
}

export function formatFlavourDisclaimer(flavour?: string | null): string | null {
  const f = ROAST_FLAVOUR_META[normalizeRoastFlavour(flavour)];
  if (f.id === "default") return null;
  return `Persona note: "${f.label}" is a fictional AI review archetype focusing on specific Postgres engineering risks, not a human committer verdict — AI makes mistakes all the time.`;
}
