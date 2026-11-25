import type { AppDatabase } from "../db.ts";
import type { RoastJson, StatsReport } from "../types.ts";

const CLOSED_STATUS_RE = /^(?:committed|rejected|withdrawn|returned with feedback|moved to next cf)$/i;

export function isClosedCfStatus(status: string): boolean {
  return CLOSED_STATUS_RE.test((status || "").trim());
}

function splitPeople(raw: string): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.replace(/\s*\([^)]*\)\s*/g, "").trim())
    .filter((s) => s.length >= 2);
}

const SUBSYSTEM_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "Planner / Optimizer / Stats", regex: /\b(planner|optimizer|subquery|join|statistics|mcv|cost|pathkey|mergeappend|parallel|explain|analyze|partitionwise)\b/i },
  { label: "Logical Replication / Slots", regex: /\b(logical replication|publication|subscription|replication slot|pgoutput|walsender|two_phase|slot sync|tablesync|conflict)\b/i },
  { label: "WAL / Recovery / Checkpoint", regex: /\b(wal|xlog|checkpoint|archive_mode|standby|timeline|recovery|bgwriter|pg_rewind|pg_basebackup|backup)\b/i },
  { label: "Vacuum / Storage / Buffers / AIO", regex: /\b(vacuum|autovacuum|buffer|aio|io_uring|smgr|storage|visibility map|fsm|hot update|heap|table am|reloption|shared_buffers)\b/i },
  { label: "Index AM / amcheck", regex: /\b(amcheck|gist|gin|btree|nbtree|brin|spgist|index|hash index)\b/i },
  { label: "DDL / Partitioning / COPY", regex: /\b(partition|tablecmds|constraint|not null|domain|alter table|create table|foreign key|generated column|copy|merge)\b/i },
  { label: "Client Tools / pg_dump / pg_upgrade", regex: /\b(pg_dump|pg_restore|pg_upgrade|psql|pgbench|pg_ctl|pg_amcheck|pg_verifybackup|pg_resetwal|pg_combinebackup)\b/i },
  { label: "libpq / Wire / SSL / Security", regex: /\b(libpq|wire protocol|ssl|tls|oauth|scram|gss|rls|privilege|security|password|role|grant|acl)\b/i },
  { label: "Monitoring / pg_stat / Logging", regex: /\b(pg_stat|instrumentation|wait event|log_|histogram|auto_explain|track_|progress)\b/i },
  { label: "SQL / JSON / Types / PL/pgSQL", regex: /\b(json|xml|window|aggregate|plpgsql|pl\/pgsql|collation|regex|multirange|type|cast|numeric|timestamp|uuid|sql\/)\b/i },
  { label: "Build / Meson / Portability / JIT", regex: /\b(meson|windows|mingw|msvc|llvm|jit|pgindent|configure|build|cmake|macos)\b/i },
  { label: "FDW / Contrib / Extensions", regex: /\b(fdw|postgres_fdw|contrib|extension|pg_trgm|pgcrypto|btree_gist|citext)\b/i },
];

function inferSubsystemTopic(topic: string, title: string): string {
  const clean = (topic || "").trim();
  if (clean) return clean;
  for (const rule of SUBSYSTEM_PATTERNS) {
    if (rule.regex.test(title)) return rule.label;
  }
  return "Core / Misc";
}

export async function buildStatsReport(db: AppDatabase): Promise<StatsReport> {
  const [rows, bugs, triageCounts] = await Promise.all([
    db.getAllEntriesForStats(),
    db.listBugReports({}),
    db.getTriageSummaryCounts(),
  ]);

  const verdictOrder = [
    "NO-FUNDAMENTAL-OBJECTION",
    "NEEDS-COMMITTER-EYES",
    "NEEDS-DESIGN-DISCUSSION",
    "LIKELY-REJECT",
    "UNROASTED",
  ] as const;

  const totals = {
    total: rows.length,
    open: 0,
    closed: 0,
    roasted: 0,
    unroasted: 0,
    openRoasted: 0,
    openUnroasted: 0,
  };

  const verdictCounts: Record<string, { all: number; open: number }> = {};
  for (const v of verdictOrder) verdictCounts[v] = { all: 0, open: 0 };

  // CF Status x Verdict matrix
  const matrixMap = new Map<string, { status: string; isClosed: boolean; total: number; counts: Record<string, number> }>();

  // Novelty totals across all roasted objections
  const novelty = {
    totalObjections: 0,
    newCount: 0,
    precedentCount: 0,
    openInThreadCount: 0,
    entriesWithNovel: 0,
  };

  // CFBot health
  const cfbot: Record<string, number> = {
    passing: 0,
    needs_rebase: 0,
    failing: 0,
    unknown: 0,
  };

  // Topic breakdown
  const topicMap = new Map<string, { topic: string; total: number; open: number; roasted: number; clean: number; ready: number }>();

  // People leaderboards (open entries)
  const authorCounts = new Map<string, number>();
  const reviewerCounts = new Map<string, number>();
  const committerCounts = new Map<string, number>();
  const rfcNoCommitter: Array<{ cf_id: number; title: string; verdict: string; authors: string; score: number }> = [];

  for (const r of rows) {
    const closed = isClosedCfStatus(r.status);
    const verdictKey = r.verdict && r.verdict.trim() ? r.verdict.trim() : "UNROASTED";
    const isRoasted = verdictKey !== "UNROASTED";

    if (closed) totals.closed++;
    else totals.open++;

    if (isRoasted) {
      totals.roasted++;
      if (!closed) totals.openRoasted++;
    } else {
      totals.unroasted++;
      if (!closed) totals.openUnroasted++;
    }

    if (!verdictCounts[verdictKey]) verdictCounts[verdictKey] = { all: 0, open: 0 };
    verdictCounts[verdictKey]!.all++;
    if (!closed) verdictCounts[verdictKey]!.open++;

    const statusLabel = r.status.trim() || "Unspecified";
    let matRow = matrixMap.get(statusLabel);
    if (!matRow) {
      matRow = {
        status: statusLabel,
        isClosed: closed,
        total: 0,
        counts: {
          "NO-FUNDAMENTAL-OBJECTION": 0,
          "NEEDS-COMMITTER-EYES": 0,
          "NEEDS-DESIGN-DISCUSSION": 0,
          "LIKELY-REJECT": 0,
          UNROASTED: 0,
        },
      };
      matrixMap.set(statusLabel, matRow);
    }
    matRow.total++;
    matRow.counts[verdictKey] = (matRow.counts[verdictKey] ?? 0) + 1;

    // CFBot status (count open entries primarily)
    if (!closed) {
      const cb = (r.cfbot_status || "").toLowerCase();
      if (cb === "passing") cfbot.passing = (cfbot.passing ?? 0) + 1;
      else if (cb === "needs_rebase") cfbot.needs_rebase = (cfbot.needs_rebase ?? 0) + 1;
      else if (cb === "failing") cfbot.failing = (cfbot.failing ?? 0) + 1;
      else cfbot.unknown = (cfbot.unknown ?? 0) + 1;
    }

    // Topic / Subsystem breakdown (uses CF topic if populated, otherwise infers PostgreSQL subsystem from title)
    const topicLabel = inferSubsystemTopic(r.topic, r.title);
    let tEntry = topicMap.get(topicLabel);
    if (!tEntry) {
      tEntry = { topic: topicLabel, total: 0, open: 0, roasted: 0, clean: 0, ready: 0 };
      topicMap.set(topicLabel, tEntry);
    }
    tEntry.total++;
    if (!closed) tEntry.open++;
    if (isRoasted) tEntry.roasted++;
    if (verdictKey === "NO-FUNDAMENTAL-OBJECTION") tEntry.clean++;
    if (/ready for committer/i.test(r.status)) tEntry.ready++;

    // People leaderboards (open patches)
    if (!closed) {
      for (const a of splitPeople(r.authors)) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1);
      for (const rev of splitPeople(r.reviewers)) reviewerCounts.set(rev, (reviewerCounts.get(rev) ?? 0) + 1);
      for (const c of splitPeople(r.committer)) committerCounts.set(c, (committerCounts.get(c) ?? 0) + 1);

      if (/ready for committer/i.test(r.status) && !r.committer.trim()) {
        rfcNoCommitter.push({
          cf_id: r.cf_id,
          title: r.title,
          verdict: verdictKey,
          authors: r.authors,
          score: r.recommended_score,
        });
      }
    }

    // Novelty parsing from roast_json
    if (r.roast_json) {
      try {
        const parsed = JSON.parse(r.roast_json) as RoastJson;
        const objs = parsed.objections ?? [];
        let entryNovel = false;
        for (const o of objs) {
          novelty.totalObjections++;
          const nov =
            o.novelty === "new" || o.novelty === "revisits_precedent" || o.novelty === "open_in_thread"
              ? o.novelty
              : (o.precedent_ids?.length ?? 0) > 0 || (o.precedents?.length ?? 0) > 0
                ? "revisits_precedent"
                : (o.thread_message_refs?.length ?? 0) <= 1
                  ? "new"
                  : "open_in_thread";
          if (nov === "new") {
            novelty.newCount++;
            entryNovel = true;
          } else if (nov === "revisits_precedent") {
            novelty.precedentCount++;
            entryNovel = true;
          } else {
            novelty.openInThreadCount++;
          }
        }
        if (entryNovel) novelty.entriesWithNovel++;
      } catch {
        // ignore malformed json
      }
    }
  }

  const statusOrder = [
    "Ready for Committer",
    "Needs review",
    "Waiting on Author",
    "Committed",
    "Returned with feedback",
    "Withdrawn",
    "Rejected",
    "Moved to next CF",
  ];
  const statusMatrix = [...matrixMap.values()].sort((a, b) => {
    const ia = statusOrder.findIndex((s) => s.toLowerCase() === a.status.toLowerCase());
    const ib = statusOrder.findIndex((s) => s.toLowerCase() === b.status.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return b.total - a.total;
  });

  const topTopics = [...topicMap.values()]
    .sort((a, b) => b.open - a.open || b.total - a.total)
    .slice(0, 12);

  const toLeaderboard = (m: Map<string, number>, limit = 10) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));

  rfcNoCommitter.sort((a, b) => b.score - a.score || b.cf_id - a.cf_id);

  const bugsByClass: Record<string, number> = { production_hit: 0, unclear: 0, synthetic_ai_hunt: 0 };
  const bugsBySeverity: Record<string, number> = {};
  for (const b of bugs) {
    bugsByClass[b.classification] = (bugsByClass[b.classification] ?? 0) + 1;
    bugsBySeverity[b.severity] = (bugsBySeverity[b.severity] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    totals,
    verdicts: verdictOrder.map((verdict) => ({
      verdict,
      all: verdictCounts[verdict]?.all ?? 0,
      open: verdictCounts[verdict]?.open ?? 0,
    })),
    statusMatrix,
    novelty,
    cfbot,
    topTopics,
    leaderboards: {
      authors: toLeaderboard(authorCounts, 10),
      reviewers: toLeaderboard(reviewerCounts, 10),
      committers: toLeaderboard(committerCounts, 10),
    },
    rfcNoCommitter: rfcNoCommitter.slice(0, 20),
    bugs: {
      total: bugs.length,
      byClassification: bugsByClass,
      bySeverity: bugsBySeverity,
    },
    triage: triageCounts,
  };
}
