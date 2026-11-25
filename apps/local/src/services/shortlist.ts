import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expandHome } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import { countNewObjections } from "../db.ts";
import type {
  CfEntryRecord,
  ExpertSuggestion,
  RoastJson,
  ShortlistEntry,
  Top50RejectEntry,
} from "../types.ts";

interface SubsystemRule {
  subsystem: string;
  keywords: RegExp;
  paths: string[];
  experts: string[];
}

const SUBSYSTEM_RULES: SubsystemRule[] = [
  {
    subsystem: "Index AM / amcheck / B-tree / GiST / GIN",
    keywords: /\b(amcheck|gist|gin|btree|nbtree|brin|spgist|index prefetch|index scan)\b/i,
    paths: ["contrib/amcheck", "src/backend/access/gist", "src/backend/access/nbtree", "src/backend/access/gin"],
    experts: ["Peter Geoghegan", "Heikki Linnakangas", "Tomas Vondra", "Andrey Borodin"],
  },
  {
    subsystem: "WAL / Recovery / Checkpointer / Archiving",
    keywords: /\b(wal|xlog|checkpoint|archive_mode|standby|timeline|recovery|bgwriter)\b/i,
    paths: ["src/backend/access/transam", "src/backend/postmaster/checkpointer.c"],
    experts: ["Heikki Linnakangas", "Michael Paquier", "Robert Haas", "Thomas Munro"],
  },
  {
    subsystem: "Logical Replication / Slots / Publications",
    keywords: /\b(logical replication|publication|subscription|replication slot|pgoutput|walsender|two_phase|slot sync)\b/i,
    paths: ["src/backend/replication/logical", "src/backend/replication/slot.c"],
    experts: ["Amit Kapila", "Peter Eisentraut", "Masahiko Sawada", "Bertrand Drouvot"],
  },
  {
    subsystem: "Planner / Optimizer / Statistics",
    keywords: /\b(planner|optimizer|subquery|join|statistics|extended stat|mcv|cost|pathkey|mergeappend|parallel plan|explain)\b/i,
    paths: ["src/backend/optimizer", "src/backend/statistics"],
    experts: ["Tom Lane", "David Rowley", "Richard Guo", "Dean Rasheed", "Tomas Vondra"],
  },
  {
    subsystem: "Vacuum / Autovacuum / Storage / Buffer Manager / AIO",
    keywords: /\b(vacuum|autovacuum|buffer|aio|io_uring|smgr|storage|visibility map|fsm|hot update|heap|table am|reloption)\b/i,
    paths: ["src/backend/storage/buffer", "src/backend/access/heap", "src/backend/postmaster/autovacuum.c"],
    experts: ["Andres Freund", "Melanie Plageman", "Masahiko Sawada", "Robert Haas", "Thomas Munro"],
  },
  {
    subsystem: "DDL / Tablecmds / Constraints / Partitioning",
    keywords: /\b(partition|tablecmds|constraint|not null|domain|alter table|create table|foreign key|generated column|copy from|copy to)\b/i,
    paths: ["src/backend/commands/tablecmds.c", "src/backend/commands/copyfrom.c"],
    experts: ["Alvaro Herrera", "Dean Rasheed", "Amit Langote", "David Rowley"],
  },
  {
    subsystem: "pg_dump / pg_restore / pg_upgrade / Frontend Tools",
    keywords: /\b(pg_dump|pg_restore|pg_upgrade|psql|pgbench|pg_ctl|pg_amcheck|pg_basebackup)\b/i,
    paths: ["src/bin/pg_dump", "src/bin/pg_upgrade", "src/bin/psql"],
    experts: ["Nathan Bossart", "Daniel Gustafsson", "Tom Lane", "Andrew Dunstan"],
  },
  {
    subsystem: "libpq / Wire Protocol / SSL / Security",
    keywords: /\b(libpq|wire protocol|ssl|tls|oauth|scram|gss|rls|privilege|security|password)\b/i,
    paths: ["src/interfaces/libpq", "src/backend/libpq"],
    experts: ["Jacob Champion", "Daniel Gustafsson", "Michael Paquier", "Stephen Frost"],
  },
  {
    subsystem: "Build / Meson / Windows / Portability / JIT",
    keywords: /\b(meson|windows|mingw|msvc|llvm|jit|pgindent|perltidy|configure|build)\b/i,
    paths: ["meson.build", "src/backend/jit/llvm", "src/port"],
    experts: ["Andres Freund", "Peter Eisentraut", "Thomas Munro", "Andrew Dunstan"],
  },
  {
    subsystem: "JSON / SQL-XML / Window / Aggregates / PL/pgSQL",
    keywords: /\b(jsonb|jsonpath|xml|window|aggregate|plpgsql|pl\/pgsql|collation|regex|multirange)\b/i,
    paths: ["src/backend/utils/adt/jsonb.c", "src/pl/plpgsql"],
    experts: ["Andrew Dunstan", "Tom Lane", "Dean Rasheed", "Jeff Davis"],
  },
  {
    subsystem: "Monitoring / pg_stat Views / Instrumentation",
    keywords: /\b(pg_stat_|instrumentation|wait event|log_.*plan|histogram|checkpointer stats)\b/i,
    paths: ["src/backend/utils/activity"],
    experts: ["Michael Paquier", "Bertrand Drouvot", "Sami Imseih", "Nathan Bossart"],
  },
  {
    subsystem: "FDW / postgres_fdw",
    keywords: /\b(fdw|postgres_fdw|foreign table)\b/i,
    paths: ["contrib/postgres_fdw"],
    experts: ["Etsuro Fujita", "Ashutosh Bapat", "Tom Lane"],
  },
];

const gitExpertCache = new Map<string, ExpertSuggestion[] | null>();

interface ShortlistCacheEntry {
  key: string;
  at: number;
  value: {
    shortlist: ShortlistEntry[];
    top50Closing: Top50RejectEntry[];
    stats: Record<string, number>;
    generatedAt: string;
  };
}
let shortlistCache: ShortlistCacheEntry | null = null;

export function extractTouchedPathsFromRoast(roast: RoastJson | null, title: string): string[] {
  const paths = new Set<string>();
  if (roast?.brief?.touched_files) {
    for (const p of roast.brief.touched_files) {
      if (p && !p.includes("..")) paths.add(p);
    }
  }
  const textToScan = [
    title,
    roast?.brief?.proposed_design || "",
    ...(roast?.touch_points?.map((t) => t.reason || "") ?? []),
  ].join(" ");
  const fileMatch = textToScan.match(/\b(?:src|contrib|doc)\/[A-Za-z0-9_./-]+\.[chyl]\b/g);
  if (fileMatch) {
    for (const f of fileMatch.slice(0, 6)) paths.add(f);
  }
  return Array.from(paths);
}

export function suggestExpertsForEntry(
  entry: Pick<CfEntryRecord, "title" | "topic">,
  roast: RoastJson | null,
  postgresRepo?: string,
): ExpertSuggestion[] {
  const text = `${entry.title} ${entry.topic} ${roast?.brief?.problem || ""} ${roast?.brief?.proposed_design || ""}`;
  const matchedRule = SUBSYSTEM_RULES.find((r) => r.keywords.test(text));
  const touchedPaths = extractTouchedPathsFromRoast(roast, entry.title);
  const queryPaths = touchedPaths.length > 0 ? touchedPaths : (matchedRule?.paths ?? []);

  // Try real git log routing if local Postgres repo exists
  if (postgresRepo && queryPaths.length > 0) {
    const repoPath = expandHome(postgresRepo);
    const cacheKey = `${repoPath}::${queryPaths.join(",")}`;
    if (gitExpertCache.has(cacheKey)) {
      const cached = gitExpertCache.get(cacheKey);
      if (cached && cached.length > 0) return cached;
      // Negative cache hit — skip repeating slow git log, fall through to heuristic
    } else if (existsSync(`${repoPath}/.git`)) {
      try {
        const res = spawnSync(
          "git",
          ["-C", repoPath, "log", "-n", "120", "--format=%cn", "--", ...queryPaths.slice(0, 4)],
          { encoding: "utf8", timeout: 2000 },
        );
        if (res.status === 0 && res.stdout.trim()) {
          const counts = new Map<string, number>();
          for (const line of res.stdout.split(/\r?\n/)) {
            const name = line.trim();
            if (!name) continue;
            counts.set(name, (counts.get(name) ?? 0) + 1);
          }
          const sorted = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([name, commits]): ExpertSuggestion => ({
              name,
              commits,
              source: "git_log",
              subsystem: matchedRule?.subsystem,
            }));
          if (sorted.length > 0) {
            gitExpertCache.set(cacheKey, sorted);
            return sorted;
          }
        }
        gitExpertCache.set(cacheKey, null);
      } catch {
        gitExpertCache.set(cacheKey, null);
      }
    }
  }

  if (matchedRule) {
    return matchedRule.experts.slice(0, 3).map((name, idx) => ({
      name,
      commits: 0,
      source: "subsystem_heuristic",
      subsystem: matchedRule.subsystem,
      ...(idx >= 0 ? {} : {}),
    }));
  }

  return [];
}

function isTrivialDocOrComment(title: string): boolean {
  return /^(?:docs?:|typo|fix typo|add a .*comment|comment fix)/i.test(title.trim());
}

export function classifyEntryKind(title: string, roast: RoastJson | null): "bugfix" | "feature" {
  const t = `${title} ${roast?.brief?.problem || ""}`;
  if (
    /\b(fix(?:es|ed|ing)?|bug|bugfix|crash(?:es|ed|ing)?|segfault|race condition|memory leak|fd leak|file descriptor leak|corruption|corrupt|wrong result|missing rows|deadlock|regression|oom|assertion fail|prevent\b.*(?:crash|corruption|loss|leak)|handle inheritance|incorrect(?:ly)?|broken|hangs?)\b/i.test(
      title,
    )
  ) {
    return "bugfix";
  }
  if (/\b(regression|data loss|corruption|segfault|crash|memory leak|deadlock|wrong results?)\b/i.test(t) && !/\b(add support|new guc|new syntax|new feature|implement\b)\b/i.test(title)) {
    return "bugfix";
  }
  return "feature";
}

export function detectProductionSignal(title: string, roast: RoastJson | null): { seen: boolean; signal: string } {
  const combined = [
    title,
    roast?.brief?.problem || "",
    ...(roast?.brief?.author_claims ?? []),
    roast?.brief?.thread_state || "",
  ].join("\n");

  const rules: Array<{ label: string; regex: RegExp }> = [
    { label: "Reported from production cluster", regex: /\b(in production|production (?:cluster|database|db|server|workload|system|incident|outage)|prod cluster|real[- ]world production)\b/i },
    { label: "Hit during production upgrade", regex: /\b(after upgrading|during pg_upgrade|upgrade from (?:pg|postgres(?:ql)?)?\s*\d+)\b/i },
    { label: "Live operational incident / outage", regex: /\b(outage|downtime|customer(?:s)? hit|hit on our (?:primary|standby|replica|cluster)|real users? hit)\b/i },
  ];
  for (const r of rules) {
    if (r.regex.test(combined)) return { seen: true, signal: r.label };
  }
  return { seen: false, signal: "" };
}

export function extractWorkaroundFinding(roast: RoastJson | null): string {
  if (!roast) return "";
  const objs = roast.objections ?? [];
  for (const o of objs) {
    const isAlready =
      /already[-_ ]?exists|maintenance[-_ ]?fit/i.test(o.category || "") ||
      /\b(already exists|already solves|workaround|covered by|can already be done|external tool|separate service|pg_amcheck|existing extension)\b/i.test(
        `${o.title} ${o.argument || ""} ${o.failure_scenario || ""}`,
      );
    if (isAlready) {
      const detail = o.title || o.argument || "";
      return detail.slice(0, 180);
    }
  }
  return "";
}

export function buildFailingSummary(roast: RoastJson | null): string {
  if (!roast) return "";
  const lvl = roast.failing_level ? `Fails at level ${roast.failing_level}` : "";
  const cats = Array.from(
    new Set(
      (roast.objections ?? [])
        .map((o) => (o.category || "").replace(/[-_]+/g, " ").trim())
        .filter(Boolean),
    ),
  ).slice(0, 3);
  if (lvl && cats.length) return `${lvl}: ${cats.join(", ")}`;
  if (lvl) return lvl;
  if (cats.length) return cats.join(", ");
  return "";
}

export function scoreForShortlist(entry: CfEntryRecord, roast: RoastJson): {
  eligible: boolean;
  score: number;
  reasons: string[];
} {
  const verdict = roast.verdict || entry.verdict;
  if (verdict === "LIKELY-REJECT") {
    return { eligible: false, score: 0, reasons: [] };
  }

  const objections = roast.objections ?? [];
  const fatalCount = objections.filter((o) => o.severity === "fatal").length;
  if (fatalCount > 0) {
    return { eligible: false, score: 0, reasons: [] };
  }

  const action = roast.priority?.recommended_action || entry.priority_action || "";
  if (action === "park" || action === "close: dead or superseded" || action === "withdraw and resubmit") {
    return { eligible: false, score: 0, reasons: [] };
  }

  let score = 0;
  const reasons: string[] = [];

  if (verdict === "NO-FUNDAMENTAL-OBJECTION") {
    score += 42;
    reasons.push("No fundamental design objection");
  } else if (verdict === "NEEDS-COMMITTER-EYES") {
    score += 30;
    reasons.push("Ready for committer judgment");
  } else if (verdict === "NEEDS-DESIGN-DISCUSSION") {
    // Only consider if Ready for Committer and low objection count
    if (!/ready for committer/i.test(entry.status) || objections.length > 1) {
      return { eligible: false, score: 0, reasons: [] };
    }
    score += 10;
  } else {
    return { eligible: false, score: 0, reasons: [] };
  }

  if (/ready for committer/i.test(entry.status)) {
    score += 18;
    reasons.push("Marked Ready for Committer");
  } else if (/needs review/i.test(entry.status)) {
    score += 6;
  } else if (/waiting on author/i.test(entry.status)) {
    score -= 12;
  }

  const audience = roast.priority?.audience || "";
  if (audience === "most users") {
    score += 16;
    reasons.push("Broad impact (most users)");
  } else if (audience === "a sizeable minority") {
    score += 11;
    reasons.push("Substantial user value");
  } else if (audience === "niche") {
    score -= 4;
  }

  if (action === "proceed") {
    score += 12;
    reasons.push("Recommended: proceed");
  } else if (action === "needs champion") {
    score += 10;
    reasons.push("Needs committer champion");
  }

  if (roast.confidence === "high") score += 7;
  else if (roast.confidence === "low") score -= 6;

  // Andrey's principle: "worth effort, not merely easy" — boost substantive patches/bugfixes over trivial comment typos
  if (!isTrivialDocOrComment(entry.title)) {
    score += 8;
  } else {
    score -= 6;
  }

  if (roast.committability?.owner === "qualified committer engaged") {
    score += 6;
    reasons.push("Committer already engaged");
  }

  // Bug fixes / race / leak / crash fixes are high value; seen-in-production gets extra weight (#193)
  const kind = classifyEntryKind(entry.title, roast);
  const prod = detectProductionSignal(entry.title, roast);
  if (prod.seen) {
    score += 12;
    reasons.push("Seen in production");
  }
  if (kind === "bugfix") {
    score += 6;
    reasons.push("Bug fix / reliability");
  }

  score -= objections.length * 4;
  if (roast.not_now?.applies) score -= 25;

  return {
    eligible: score >= 35,
    score: Math.round(score),
    reasons: reasons.slice(0, 4),
  };
}

export function scoreForClosingOrRethinking(entry: CfEntryRecord, roast: RoastJson): {
  eligible: boolean;
  score: number;
  reasons: string[];
  nextStep: string;
} {
  const verdict = roast.verdict || entry.verdict;
  const action = roast.priority?.recommended_action || entry.priority_action || "";
  const objections = roast.objections ?? [];
  const fatalObjs = objections.filter((o) => o.severity === "fatal");
  const sameIdeaPrior = (roast.prior_attempts ?? []).filter((p) => p.relation === "same_idea");

  let score = 0;
  const reasons: string[] = [];

  if (verdict === "LIKELY-REJECT") {
    score += 60;
    reasons.push("Verdict: LIKELY-REJECT");
  }
  if (action === "close: dead or superseded") {
    score += 45;
    reasons.push("Dead or superseded");
  } else if (action === "withdraw and resubmit") {
    score += 38;
    reasons.push("Needs withdraw and fresh resubmit");
  } else if (action === "park") {
    score += 34;
    reasons.push("Recommended to park");
  } else if (action === "needs design rethink") {
    score += 30;
    reasons.push("Needs fundamental design rethink");
  } else if (action === "fix design first") {
    score += 18;
    reasons.push("Unresolved design blockers");
  }

  if (fatalObjs.length > 0) {
    score += fatalObjs.length * 22;
    reasons.push(`${fatalObjs.length} fatal objection(s)`);
  }

  if (roast.not_now?.applies) {
    score += 24;
    reasons.push("Demand / motivation not demonstrated");
  }

  if (sameIdeaPrior.length > 0) {
    score += 18;
    reasons.push(`Repeats prior returned/rejected attempt (${sameIdeaPrior[0]?.title || "prior thread"})`);
  }

  if (verdict === "NEEDS-DESIGN-DISCUSSION" && objections.length >= 4) {
    score += 15;
    reasons.push(`${objections.length} surviving design objections`);
  }

  if (roast.priority?.audience === "niche" || roast.priority?.audience === "unclear") {
    score += 8;
  }
  if (roast.priority?.maintenance_burden === "high") {
    score += 8;
    reasons.push("High long-term maintenance burden");
  }
  if (/waiting on author/i.test(entry.status)) {
    score += 6;
  }

  // Never put clean NO-FUNDAMENTAL-OBJECTION entries in closing list
  if (verdict === "NO-FUNDAMENTAL-OBJECTION") {
    return { eligible: false, score: 0, reasons: [], nextStep: "" };
  }

  const nextStep =
    roast.not_now?.evidence_that_would_change_it ||
    objections[0]?.author_must_show ||
    roast.priority?.reason ||
    roast.questions?.[0] ||
    "Address the primary design objection on-list or withdraw until motivation and design are settled.";

  return {
    eligible: score >= 28,
    score: Math.round(score),
    reasons: reasons.slice(0, 4),
    nextStep,
  };
}

export async function buildShortlistAndTop50(
  db: AppDatabase,
  opts?: { topN?: number; rejectN?: number; includeExperts?: boolean },
): Promise<{
  shortlist: ShortlistEntry[];
  top50Closing: Top50RejectEntry[];
  stats: Record<string, number>;
  generatedAt: string;
}> {
  const topN = Math.min(Math.max(opts?.topN ?? 20, 1), 100);
  const rejectN = Math.min(Math.max(opts?.rejectN ?? 50, 1), 150);
  const [settings, stats] = await Promise.all([db.getSettings(), db.getVerdictStats()]);
  const includeExperts = opts?.includeExperts !== false;
  const cacheKey = `${topN}:${rejectN}:${includeExperts ? 1 : 0}:${settings.postgresRepo}:${JSON.stringify(stats)}`;
  if (shortlistCache && shortlistCache.key === cacheKey && Date.now() - shortlistCache.at < 30_000) {
    return shortlistCache.value;
  }
  const rows = await db.getAllEntriesWithRoasts();

  const shortlistCandidates: ShortlistEntry[] = [];
  const closingCandidates: Top50RejectEntry[] = [];

  for (const row of rows) {
    // Exclude already-closed CommitFest entries from active Shortlist / Top-50 Closing queues
    if (/^(?:committed|rejected|withdrawn|returned with feedback|moved to next cf)$/i.test((row.status || "").trim())) {
      continue;
    }

    let roast: RoastJson;
    try {
      roast = JSON.parse(row.roast_json) as RoastJson;
    } catch {
      continue;
    }

    const kind = classifyEntryKind(row.title, roast);
    const prod = detectProductionSignal(row.title, roast);
    const workaround = extractWorkaroundFinding(roast);

    const sl = scoreForShortlist(row, roast);
    if (sl.eligible) {
      shortlistCandidates.push({
        cf_id: row.cf_id,
        title: row.title,
        status: row.status || roast.input?.cf?.status || "",
        authors: row.authors || roast.input?.cf?.authors || "",
        verdict: roast.verdict || row.verdict,
        confidence: String(roast.confidence || row.confidence || ""),
        kind,
        seen_in_production: prod.seen,
        production_signal: prod.signal,
        workaround,
        score: sl.score,
        reasons: sl.reasons,
        audience: roast.priority?.audience || "",
        review_cost: roast.priority?.review_cost || "",
        objection_count: roast.objections?.length ?? row.objection_count,
        new_objection_count: countNewObjections(roast),
        prior_attempts_count: roast.prior_attempts?.length ?? row.prior_attempts_count,
        priority_action: roast.priority?.recommended_action || row.priority_action,
        first_objection: roast.objections?.[0]?.title || "",
        thread_url: row.thread_url || roast.input?.thread_url || "",
        experts: [],
      });
    }

    const cl = scoreForClosingOrRethinking(row, roast);
    if (cl.eligible) {
      closingCandidates.push({
        cf_id: row.cf_id,
        title: row.title,
        status: row.status || roast.input?.cf?.status || "",
        authors: row.authors || roast.input?.cf?.authors || "",
        verdict: roast.verdict || row.verdict,
        confidence: String(roast.confidence || row.confidence || ""),
        kind,
        workaround,
        failing_summary: buildFailingSummary(roast),
        score: cl.score,
        recommended_action: roast.priority?.recommended_action || row.priority_action || "rethink",
        reasons: cl.reasons,
        next_step_for_author: cl.nextStep,
        objection_count: roast.objections?.length ?? row.objection_count,
        prior_attempts_count: roast.prior_attempts?.length ?? row.prior_attempts_count,
        thread_url: row.thread_url || roast.input?.thread_url || "",
      });
    }
  }

  shortlistCandidates.sort((a, b) => b.score - a.score || a.objection_count - b.objection_count || b.cf_id - a.cf_id);
  closingCandidates.sort((a, b) => b.score - a.score || b.objection_count - a.objection_count || a.cf_id - b.cf_id);

  const shortlist = shortlistCandidates.slice(0, topN);
  if (includeExperts) {
    const byId = new Map(rows.map((r) => [r.cf_id, r]));
    for (const item of shortlist) {
      const row = byId.get(item.cf_id);
      if (!row) continue;
      try {
        const roast = JSON.parse(row.roast_json) as RoastJson;
        item.experts = suggestExpertsForEntry(row, roast, settings.postgresRepo);
      } catch {
        item.experts = suggestExpertsForEntry(row, null, settings.postgresRepo);
      }
    }
  }

  const result = {
    shortlist,
    top50Closing: closingCandidates.slice(0, rejectN),
    stats,
    generatedAt: new Date().toISOString(),
  };
  shortlistCache = { key: cacheKey, at: Date.now(), value: result };
  return result;
}

export function renderShortlistDigestMarkdown(data: {
  shortlist: ShortlistEntry[];
  top50Closing: Top50RejectEntry[];
  stats: Record<string, number>;
}): string {
  const lines: string[] = [];
  lines.push("# CommitFest Shortlist & Triage Digest");
  lines.push("");
  lines.push("> Prepared by an AI harness; treat as a triage aid, not a committer decision.");
  lines.push("");
  lines.push(
    `Evaluated ${data.stats.TOTAL ?? 0} entries: ` +
      `${data.stats["NO-FUNDAMENTAL-OBJECTION"] ?? 0} NO-FUNDAMENTAL-OBJECTION, ` +
      `${data.stats["NEEDS-COMMITTER-EYES"] ?? 0} NEEDS-COMMITTER-EYES, ` +
      `${data.stats["NEEDS-DESIGN-DISCUSSION"] ?? 0} NEEDS-DESIGN-DISCUSSION, ` +
      `${data.stats["LIKELY-REJECT"] ?? 0} LIKELY-REJECT.`,
  );
  lines.push("");
  lines.push(`## Top ${data.shortlist.length} Patches Worth Committer Attention (CommitFest Shortlist)`);
  lines.push("");
  for (let i = 0; i < data.shortlist.length; i++) {
    const s = data.shortlist[i]!;
    const experts = s.experts.map((e) => e.name).join(", ");
    lines.push(`${i + 1}. CF ${s.cf_id}: ${s.title} (${s.verdict}${s.status ? `, ${s.status}` : ""})`);
    lines.push(`   URL: https://commitfest.postgresql.org/patch/${s.cf_id}/`);
    if (s.reasons.length) lines.push(`   Why: ${s.reasons.join("; ")}`);
    if (s.first_objection) lines.push(`   Open point: ${s.first_objection}`);
    if (experts) lines.push(`   Suggested subsystem reviewers: ${experts}`);
  }
  lines.push("");
  lines.push(`## Top ${data.top50Closing.length} Patches Worth Closing or Rethinking`);
  lines.push("");
  for (let i = 0; i < data.top50Closing.length; i++) {
    const c = data.top50Closing[i]!;
    lines.push(`${i + 1}. CF ${c.cf_id}: ${c.title} [${c.recommended_action}]`);
    lines.push(`   URL: https://commitfest.postgresql.org/patch/${c.cf_id}/`);
    lines.push(`   Reasons: ${c.reasons.join("; ")}`);
    lines.push(`   Next step for author: ${c.next_step_for_author}`);
  }
  lines.push("");
  return lines.join("\n");
}
