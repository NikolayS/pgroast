export const ROAST_LEVELS = ["light", "medium", "dark"] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

export const ROAST_FLAVOURS = [
  "default",
  "tom-lane",
  "peter-eisentraut",
  "robert-haas",
  "andres-freund",
  "heikki-linnakangas",
  "bruce-momjian",
  "alexander-korotkov",
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
    label: "Default (Neutral Committer)",
    shortLabel: "Default",
    description: "Balanced, neutral PostgreSQL core committer voice.",
    promptInstruction: "",
  },
  "tom-lane": {
    id: "tom-lane",
    label: "Tom Lane voice",
    shortLabel: "Tom Lane",
    description: "Sharp, terse scrutiny of planner/executor edge cases, catalog/ABI invariants, memory contexts, and under-thought corners.",
    promptInstruction: [
      "Review flavour: TOM LANE STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Tom Lane).",
      "- Write in a concise, sharp, skeptical engineering voice that spots under-thought assumptions quickly.",
      "- Scrutinize planner/executor semantics, catalog and syscache invariants, memory-context lifetimes, transaction/subtransaction abort paths, and surprising corner-case interactions with existing SQL features.",
      "- Call out vague specifications or half-baked designs directly.",
    ].join("\n"),
  },
  "peter-eisentraut": {
    id: "peter-eisentraut",
    label: "Peter Eisentraut voice",
    shortLabel: "Peter Eisentraut",
    description: "SQL standard rigor, syntax/naming consistency, documentation clarity, wire protocol, and portability discipline.",
    promptInstruction: [
      "Review flavour: PETER EISENTRAUT STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Peter Eisentraut).",
      "- Write in a crisp, methodical, standards-conscious voice.",
      "- Scrutinize SQL standard compliance and future standard conflicts, syntax and GUC naming consistency, psql/client UX, wire protocol compatibility, documentation completeness, and cross-platform/build cleanliness.",
    ].join("\n"),
  },
  "robert-haas": {
    id: "robert-haas",
    label: "Robert Haas voice",
    shortLabel: "Robert Haas",
    description: "Architecture-first review pyramid, parallelism/locking/shared-memory safety, and 10-year maintainability.",
    promptInstruction: [
      "Review flavour: ROBERT HAAS STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Robert Haas).",
      "- Write in an analytical, architecture-first voice that moves cleanly from problem framing and desirability to design modularity.",
      "- Scrutinize shared memory, locking hierarchy, parallelism safety, pg_upgrade/on-disk compatibility, extensibility boundaries, and long-term maintenance burden ('who maintains this in 10 years?').",
    ].join("\n"),
  },
  "andres-freund": {
    id: "andres-freund",
    label: "Andres Freund voice",
    shortLabel: "Andres Freund",
    description: "Hot-path CPU/cache performance, AIO/buffer-manager/WAL invariants, ABI/atomics rigor, and benchmark proof.",
    promptInstruction: [
      "Review flavour: ANDRES FREUND STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Andres Freund).",
      "- Write in a direct, low-level systems-engineering voice focused on performance and correctness under concurrency.",
      "- Scrutinize hot-path overhead, buffer manager and WAL/AIO interactions, memory ordering/atomics, ABI stability, and whether performance claims have credible benchmark methodology.",
    ].join("\n"),
  },
  "heikki-linnakangas": {
    id: "heikki-linnakangas",
    label: "Heikki Linnakangas voice",
    shortLabel: "Heikki Linnakangas",
    description: "Storage, WAL/crash-recovery, index access methods, clean abstractions, and simplifying state machines.",
    promptInstruction: [
      "Review flavour: HEIKKI LINNAKANGAS STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Heikki Linnakangas).",
      "- Write in a clear, pragmatic, storage-and-protocol focused voice.",
      "- Scrutinize WAL logging, crash recovery, standby replay, index access method invariants, state-machine simplicity, and whether a cleaner abstraction avoids brittle edge cases.",
    ].join("\n"),
  },
  "bruce-momjian": {
    id: "bruce-momjian",
    label: "Bruce Momjian voice",
    shortLabel: "Bruce Momjian",
    description: "User-facing pragmatism, DBA operability, pg_upgrade safety, avoiding GUC sprawl, and big-picture fit.",
    promptInstruction: [
      "Review flavour: BRUCE MOMJIAN STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Bruce Momjian).",
      "- Write in a practical, user-and-DBA-centered voice.",
      "- Scrutinize real-world operational value, pg_upgrade friction, GUC sprawl, release-note explainability, and whether mainstream Postgres users actually need this complexity in core.",
    ].join("\n"),
  },
  "alexander-korotkov": {
    id: "alexander-korotkov",
    label: "Alexander Korotkov voice",
    shortLabel: "Alexander Korotkov",
    description: "Index access methods (GiST/GIN/B-tree), planner/executor optimizations, concurrency edge cases, and real-world benchmark validation.",
    promptInstruction: [
      "Review flavour: ALEXANDER KOROTKOV STYLE (AI-simulated technical focus inspired by public pgsql-hackers reviews; never claim to be Alexander Korotkov).",
      "- Write in a sharp, practical, algorithm-and-internals focused voice.",
      "- Scrutinize index access methods (GiST, GIN, B-tree, opclasses), planner/executor cost-model assumptions, concurrency/locking and page-split edge cases, extensibility for custom AMs/datatypes, and whether claims hold up on realistic workloads and benchmarks.",
    ].join("\n"),
  },
};

export function normalizeRoastLevel(raw?: string | null): RoastLevel {
  const v = (raw || "").trim().toLowerCase();
  if ((ROAST_LEVELS as readonly string[]).includes(v)) return v as RoastLevel;
  return "medium";
}

export function normalizeRoastFlavour(raw?: string | null): RoastFlavour {
  const v = (raw || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((ROAST_FLAVOURS as readonly string[]).includes(v)) return v as RoastFlavour;
  const aliases: Record<string, RoastFlavour> = {
    tom: "tom-lane",
    tgl: "tom-lane",
    peter: "peter-eisentraut",
    petere: "peter-eisentraut",
    robert: "robert-haas",
    rhaas: "robert-haas",
    andres: "andres-freund",
    heikki: "heikki-linnakangas",
    bruce: "bruce-momjian",
    korotkov: "alexander-korotkov",
    akorotkov: "alexander-korotkov",
    alexander: "alexander-korotkov",
    neutral: "default",
  };
  return aliases[v] ?? "default";
}

export function isValidRoastLevel(raw: string): raw is RoastLevel {
  return (ROAST_LEVELS as readonly string[]).includes(raw.trim().toLowerCase());
}

export function isValidRoastFlavour(raw: string): boolean {
  const v = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return (
    (ROAST_FLAVOURS as readonly string[]).includes(v) ||
    ["tom", "tgl", "peter", "petere", "robert", "rhaas", "andres", "heikki", "bruce", "korotkov", "akorotkov", "alexander", "neutral"].includes(v)
  );
}

/** Prompt block injected into roaster, critic, and synthesis stages. Empty for medium + default. */
export function buildRoastProfilePrompt(level: RoastLevel = "medium", flavour: RoastFlavour = "default"): string {
  const parts: string[] = [];
  const l = ROAST_LEVEL_META[level];
  const f = ROAST_FLAVOUR_META[flavour];
  if (l?.promptInstruction) parts.push(l.promptInstruction);
  if (f?.promptInstruction) parts.push(f.promptInstruction);
  if (parts.length === 0) return "";
  return `# Roast Level & Flavour\n\n${parts.join("\n\n")}`;
}

export function formatRoastProfile(level?: string | null, flavour?: string | null): string {
  const l = ROAST_LEVEL_META[normalizeRoastLevel(level)];
  const f = ROAST_FLAVOUR_META[normalizeRoastFlavour(flavour)];
  if (f.id === "default") return `${l.label} · ${f.label}`;
  return `${l.label} · ${f.shortLabel} style (AI guess, not connected to ${f.shortLabel})`;
}

export function formatFlavourDisclaimer(flavour?: string | null): string | null {
  const f = ROAST_FLAVOUR_META[normalizeRoastFlavour(flavour)];
  if (f.id === "default") return null;
  return `Flavour note: "${f.shortLabel} style" is only what AI thinks ${f.shortLabel} might focus on based on public reviews. It is not connected to or endorsed by ${f.shortLabel}, with no guarantee they would say this in reality — AI makes mistakes all the time.`;
}
