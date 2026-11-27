import type { WebDatabase } from "./db.ts";
import { getHackerMailingListStats } from "./lists-queries.ts";

export type HackerWindow = "30d" | "90d" | "1y" | "5y" | "PG20" | "PG19" | "PG18" | "PG17" | "all";

const VALID_WINDOWS = new Set<HackerWindow>(["30d", "90d", "1y", "5y", "PG20", "PG19", "PG18", "PG17", "all"]);

export function parseHackerWindow(raw?: string | null): HackerWindow {
  const v = (raw || "1y").trim() as HackerWindow;
  return VALID_WINDOWS.has(v) ? v : "1y";
}

function resolveWindowFilter(
  window: HackerWindow,
  latestCommitIso: string,
): { whereSql: string; params: string[]; startIso: string; groupByYear: boolean } {
  const anchorMs = latestCommitIso ? Date.parse(latestCommitIso) : Date.now();
  const baseMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();

  if (window === "all") {
    return { whereSql: "TRUE", params: [], startIso: "1996-01-01T00:00:00Z", groupByYear: true };
  }
  if (window === "5y") {
    const startIso = new Date(baseMs - 5 * 365 * 86_400_000).toISOString();
    return { whereSql: "committed_at >= $1", params: [startIso], startIso, groupByYear: true };
  }
  if (window === "1y") {
    const startIso = new Date(baseMs - 365 * 86_400_000).toISOString();
    return { whereSql: "committed_at >= $1", params: [startIso], startIso, groupByYear: false };
  }
  if (window === "90d") {
    const startIso = new Date(baseMs - 90 * 86_400_000).toISOString();
    return { whereSql: "committed_at >= $1", params: [startIso], startIso, groupByYear: false };
  }
  if (window === "30d") {
    const startIso = new Date(baseMs - 30 * 86_400_000).toISOString();
    return { whereSql: "committed_at >= $1", params: [startIso], startIso, groupByYear: false };
  }
  // PG release cycle filter (PG20, PG19, PG18, PG17)
  const cycleStart: Record<string, string> = {
    PG20: "2026-06-25T00:00:00Z",
    PG19: "2025-06-25T00:00:00Z",
    PG18: "2024-06-25T00:00:00Z",
    PG17: "2023-06-25T00:00:00Z",
  };
  return {
    whereSql: "pg_major = $1",
    params: [window],
    startIso: cycleStart[window] || "2024-01-01T00:00:00Z",
    groupByYear: false,
  };
}

function parseJsonArray<T = string>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function getHackerSyncMeta(db: WebDatabase): Promise<Record<string, string>> {
  const rows = (await db.sql.unsafe(`SELECT key, value FROM ${db.t("hacker_sync_state")}`)) as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function getHackersOverview(db: WebDatabase, rawWindow?: string | null) {
  const window = parseHackerWindow(rawWindow);
  const syncMeta = await getHackerSyncMeta(db);
  const totalPeople = Number(syncMeta.total_people || 0);
  const totalCommitsAll = Number(syncMeta.total_commits || 0);

  if (totalCommitsAll === 0) {
    return {
      synced: false,
      window,
      syncMeta,
      totals: null,
      timeline: [],
      rhythmHeatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
      subsystems: [],
      leaderboards: { committers: [], authors: [], reviewers: [], reporters: [], rising: [] },
    };
  }

  const wf = resolveWindowFilter(window, syncMeta.last_commit_at || "");
  const cWhere = wf.whereSql;
  const ccWhere = wf.whereSql.replace(/\bcommitted_at\b/g, "cc.committed_at").replace(/\bpg_major\b/g, "cc.pg_major");
  const periodLen = wf.groupByYear ? 4 : 7; // YYYY vs YYYY-MM

  const [
    commitTotalsRows,
    creditTotalsRows,
    newHackersRows,
    timelineCommitsRows,
    timelineCreditsRows,
    rhythmRows,
    subsysRows,
    topCommittersRows,
    topAuthorsRows,
    topReviewersRows,
    topReportersRows,
    risingRows,
  ] = await Promise.all([
    db.sql.unsafe(
      `SELECT
         COUNT(*)::int AS commits,
         COUNT(*) FILTER (WHERE is_revert)::int AS reverts,
         COUNT(*) FILTER (WHERE is_backpatch)::int AS backpatches,
         COUNT(*) FILTER (WHERE author_person_id IS NOT NULL AND committer_person_id IS NOT NULL AND author_person_id != committer_person_id)::int AS for_others,
         COALESCE(SUM(insertions), 0)::bigint AS insertions,
         COALESCE(SUM(deletions), 0)::bigint AS deletions
       FROM ${db.t("pg_commits")}
       WHERE ${cWhere}`,
      wf.params,
    ) as Promise<
      Array<{
        commits: number;
        reverts: number;
        backpatches: number;
        for_others: number;
        insertions: string | number;
        deletions: string | number;
      }>
    >,
    db.sql.unsafe(
      `SELECT
         COUNT(DISTINCT cc.person_id)::int AS active_hackers,
         COUNT(DISTINCT cc.person_id) FILTER (WHERE cc.credit_kind IN ('author', 'co_author'))::int AS authors,
         COUNT(DISTINCT cc.person_id) FILTER (WHERE cc.credit_kind = 'committer')::int AS committers,
         COUNT(DISTINCT cc.person_id) FILTER (WHERE cc.credit_kind = 'reviewer')::int AS reviewers,
         COUNT(DISTINCT cc.person_id) FILTER (WHERE cc.credit_kind = 'reporter')::int AS reporters,
         COUNT(*) FILTER (WHERE cc.credit_kind = 'reviewer')::int AS reviews_given,
         COUNT(*) FILTER (WHERE cc.credit_kind = 'reporter')::int AS bugs_reported
       FROM ${db.t("commit_credits")} cc
       WHERE ${ccWhere}`,
      wf.params,
    ) as Promise<
      Array<{
        active_hackers: number;
        authors: number;
        committers: number;
        reviewers: number;
        reporters: number;
        reviews_given: number;
        bugs_reported: number;
      }>
    >,
    db.sql.unsafe(
      `SELECT COUNT(*)::int AS cnt
       FROM ${db.t("people")}
       WHERE first_seen_at >= $1 AND first_seen_at != ''`,
      [wf.startIso],
    ) as Promise<Array<{ cnt: number }>>,
    db.sql.unsafe(
      `SELECT
         LEFT(committed_at, ${periodLen}) AS period,
         COUNT(*)::int AS commits,
         COUNT(*) FILTER (WHERE author_person_id IS NOT NULL AND author_person_id != committer_person_id)::int AS for_others
       FROM ${db.t("pg_commits")}
       WHERE ${cWhere}
       GROUP BY 1
       ORDER BY 1 ASC`,
      wf.params,
    ) as Promise<Array<{ period: string; commits: number; for_others: number }>>,
    db.sql.unsafe(
      `SELECT
         LEFT(cc.committed_at, ${periodLen}) AS period,
         COUNT(*) FILTER (WHERE cc.credit_kind = 'reviewer')::int AS reviews,
         COUNT(DISTINCT cc.person_id)::int AS active_hackers
       FROM ${db.t("commit_credits")} cc
       WHERE ${ccWhere}
       GROUP BY 1
       ORDER BY 1 ASC`,
      wf.params,
    ) as Promise<Array<{ period: string; reviews: number; active_hackers: number }>>,
    db.sql.unsafe(
      `SELECT
         EXTRACT(DOW FROM committed_at::timestamptz AT TIME ZONE 'UTC')::int AS dow,
         EXTRACT(HOUR FROM committed_at::timestamptz AT TIME ZONE 'UTC')::int AS hr,
         COUNT(*)::int AS cnt
       FROM ${db.t("pg_commits")}
       WHERE ${cWhere}
       GROUP BY 1, 2`,
      wf.params,
    ) as Promise<Array<{ dow: number; hr: number; cnt: number }>>,
    db.sql.unsafe(
      `SELECT
         primary_subsystem AS name,
         COUNT(*)::int AS commits,
         COUNT(DISTINCT author_person_id)::int AS authors,
         COUNT(DISTINCT committer_person_id)::int AS committers
       FROM ${db.t("pg_commits")}
       WHERE ${cWhere}
       GROUP BY 1
       ORDER BY commits DESC
       LIMIT 14`,
      wf.params,
    ) as Promise<Array<{ name: string; commits: number; authors: number; committers: number }>>,
    db.sql.unsafe(
      `SELECT
         p.slug, p.canonical_name AS name, p.pg_role AS role, p.email_count,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE c.author_person_id IS NOT NULL AND c.author_person_id != c.committer_person_id)::int AS for_others
       FROM ${db.t("pg_commits")} c
       JOIN ${db.t("people")} p ON p.id = c.committer_person_id
       WHERE ${cWhere.replace(/\bcommitted_at\b/g, "c.committed_at").replace(/\bpg_major\b/g, "c.pg_major")}
       GROUP BY p.id
       ORDER BY total DESC
       LIMIT 20`,
      wf.params,
    ) as Promise<
      Array<{ slug: string; name: string; role: string; email_count: number; total: number; for_others: number }>
    >,
    db.sql.unsafe(
      `SELECT p.slug, p.canonical_name AS name, p.pg_role AS role, p.email_count, COUNT(*)::int AS count
       FROM ${db.t("commit_credits")} cc
       JOIN ${db.t("people")} p ON p.id = cc.person_id
       WHERE ${ccWhere} AND cc.credit_kind IN ('author', 'co_author')
       GROUP BY p.id
       ORDER BY count DESC
       LIMIT 20`,
      wf.params,
    ) as Promise<Array<{ slug: string; name: string; role: string; email_count: number; count: number }>>,
    db.sql.unsafe(
      `SELECT p.slug, p.canonical_name AS name, p.pg_role AS role, p.email_count, COUNT(*)::int AS count
       FROM ${db.t("commit_credits")} cc
       JOIN ${db.t("people")} p ON p.id = cc.person_id
       WHERE ${ccWhere} AND cc.credit_kind = 'reviewer'
       GROUP BY p.id
       ORDER BY count DESC
       LIMIT 20`,
      wf.params,
    ) as Promise<Array<{ slug: string; name: string; role: string; email_count: number; count: number }>>,
    db.sql.unsafe(
      `SELECT p.slug, p.canonical_name AS name, p.pg_role AS role, p.email_count, COUNT(*)::int AS count
       FROM ${db.t("commit_credits")} cc
       JOIN ${db.t("people")} p ON p.id = cc.person_id
       WHERE ${ccWhere} AND cc.credit_kind = 'reporter'
       GROUP BY p.id
       ORDER BY count DESC
       LIMIT 20`,
      wf.params,
    ) as Promise<Array<{ slug: string; name: string; role: string; email_count: number; count: number }>>,
    db.sql.unsafe(
      `SELECT
         p.slug, p.canonical_name AS name, p.pg_role AS role, p.email_count, p.first_seen_at,
         COUNT(*) FILTER (WHERE cc.credit_kind IN ('author', 'co_author'))::int AS authored,
         COUNT(*) FILTER (WHERE cc.credit_kind = 'reviewer')::int AS reviewed,
         COUNT(*) FILTER (WHERE cc.credit_kind = 'reporter')::int AS reported,
         COUNT(*)::int AS total_activity
       FROM ${db.t("commit_credits")} cc
       JOIN ${db.t("people")} p ON p.id = cc.person_id
       WHERE ${ccWhere} AND p.first_seen_at >= $${wf.params.length + 1} AND p.first_seen_at != ''
       GROUP BY p.id
       ORDER BY total_activity DESC
       LIMIT 20`,
      [...wf.params, wf.startIso],
    ) as Promise<
      Array<{
        slug: string;
        name: string;
        role: string;
        email_count: number;
        first_seen_at: string;
        authored: number;
        reviewed: number;
        reported: number;
        total_activity: number;
      }>
    >,
  ]);

  const ct = commitTotalsRows[0] ?? { commits: 0, reverts: 0, backpatches: 0, for_others: 0, insertions: 0, deletions: 0 };
  const cr = creditTotalsRows[0] ?? {
    active_hackers: 0,
    authors: 0,
    committers: 0,
    reviewers: 0,
    reporters: 0,
    reviews_given: 0,
    bugs_reported: 0,
  };
  const commitsCount = Number(ct.commits || 0);
  const forOthers = Number(ct.for_others || 0);

  // Merge timeline
  const creditByPeriod = new Map(timelineCreditsRows.map((r) => [r.period, r]));
  const timeline = timelineCommitsRows.map((r) => {
    const c = creditByPeriod.get(r.period);
    return {
      period: r.period,
      commits: Number(r.commits || 0),
      forOthers: Number(r.for_others || 0),
      reviews: Number(c?.reviews || 0),
      activeHackers: Number(c?.active_hackers || 0),
    };
  });

  // Extra world-class Observatory queries (<10ms total on 66k commits):
  // 1) PG17-PG20 weekly cumulative release-cycle race + credited-review %
  // 2) Subsystem committer concentration (Bus Factor 50%, Effective Committers 1/HHI, top committer)
  // 3) Annual committer concentration (top1 / 2-5 / 6-10 / rest + bus factor step line)
  const cWhereAliased = cWhere.replace(/\bcommitted_at\b/g, "c.committed_at").replace(/\bpg_major\b/g, "c.pg_major");
  const [cycleRows, subsysBfRows, concYearRows] = await Promise.all([
    db.sql.unsafe(
      `WITH cycles(pg_major, start_d) AS (
         VALUES ('PG17', DATE '2023-06-25'), ('PG18', DATE '2024-06-25'), ('PG19', DATE '2025-06-25'), ('PG20', DATE '2026-06-25')
       ),
       reviewed AS (
         SELECT DISTINCT commit_sha FROM ${db.t("commit_credits")} WHERE credit_kind = 'reviewer' AND pg_major IN ('PG17','PG18','PG19','PG20')
       )
       SELECT
         c.pg_major,
         LEAST(53, GREATEST(1, 1 + ((LEFT(c.committed_at, 10)::date - cy.start_d) / 7)))::int AS week,
         COUNT(*)::int AS commits,
         COUNT(r.commit_sha)::int AS reviewed_commits
       FROM ${db.t("pg_commits")} c
       JOIN cycles cy ON cy.pg_major = c.pg_major
       LEFT JOIN reviewed r ON r.commit_sha = c.sha
       GROUP BY 1, 2
       ORDER BY 1, 2`,
    ) as Promise<Array<{ pg_major: string; week: number; commits: number; reviewed_commits: number }>>,
    db.sql.unsafe(
      `WITH by_c AS (
         SELECT c.primary_subsystem AS subsys, c.committer_person_id AS pid, COUNT(*)::int AS cnt
         FROM ${db.t("pg_commits")} c
         WHERE ${cWhereAliased} AND c.committer_person_id IS NOT NULL
         GROUP BY 1, 2
       ),
       ranked AS (
         SELECT
           subsys, pid, cnt,
           SUM(cnt) OVER (PARTITION BY subsys ORDER BY cnt DESC, pid)::int AS run_sum,
           SUM(cnt) OVER (PARTITION BY subsys)::int AS tot,
           ROW_NUMBER() OVER (PARTITION BY subsys ORDER BY cnt DESC, pid)::int AS rk
         FROM by_c
       )
       SELECT
         r.subsys AS name,
         MAX(r.tot)::int AS commits,
         COUNT(*)::int AS committers,
         COALESCE(MIN(r.rk) FILTER (WHERE r.run_sum * 2 >= r.tot), 1)::int AS bus_factor,
         COALESCE(MIN(r.run_sum) FILTER (WHERE r.run_sum * 2 >= r.tot), MAX(r.tot))::int AS bf_commits,
         ROUND((1.0 / NULLIF(SUM(POWER(r.cnt::float / NULLIF(r.tot::float, 0), 2)), 0))::numeric, 2)::float AS effective_committers,
         ROUND((MAX(r.cnt)::float * 100.0 / NULLIF(MAX(r.tot)::float, 0))::numeric, 1)::float AS top1_pct,
         (ARRAY_AGG(p.canonical_name ORDER BY r.cnt DESC, r.pid))[1] AS top_committer,
         (ARRAY_AGG(p.slug ORDER BY r.cnt DESC, r.pid))[1] AS top_slug
       FROM ranked r
       JOIN ${db.t("people")} p ON p.id = r.pid
       GROUP BY r.subsys`,
      wf.params,
    ) as Promise<
      Array<{
        name: string;
        commits: number;
        committers: number;
        bus_factor: number;
        bf_commits: number;
        effective_committers: number;
        top1_pct: number;
        top_committer: string;
        top_slug: string;
      }>
    >,
    db.sql.unsafe(
      `WITH by_yr AS (
         SELECT LEFT(committed_at, 4) AS yr, committer_person_id AS pid, COUNT(*)::int AS cnt
         FROM ${db.t("pg_commits")}
         WHERE committed_at >= '2016-01-01' AND committer_person_id IS NOT NULL
         GROUP BY 1, 2
       ),
       ranked AS (
         SELECT
           yr, pid, cnt,
           SUM(cnt) OVER (PARTITION BY yr ORDER BY cnt DESC, pid)::int AS run_sum,
           SUM(cnt) OVER (PARTITION BY yr)::int AS tot,
           ROW_NUMBER() OVER (PARTITION BY yr ORDER BY cnt DESC, pid)::int AS rk
         FROM by_yr
       )
       SELECT
         yr,
         MAX(tot)::int AS total,
         COUNT(*)::int AS committers,
         COALESCE(MIN(rk) FILTER (WHERE run_sum * 2 >= tot), 1)::int AS bus_factor,
         COALESCE(SUM(cnt) FILTER (WHERE rk = 1), 0)::int AS top1,
         COALESCE(SUM(cnt) FILTER (WHERE rk BETWEEN 2 AND 5), 0)::int AS rank2_5,
         COALESCE(SUM(cnt) FILTER (WHERE rk BETWEEN 6 AND 10), 0)::int AS rank6_10,
         COALESCE(SUM(cnt) FILTER (WHERE rk > 10), 0)::int AS rest
       FROM ranked
       GROUP BY yr
       ORDER BY yr ASC`,
    ) as Promise<
      Array<{
        yr: string;
        total: number;
        committers: number;
        bus_factor: number;
        top1: number;
        rank2_5: number;
        rank6_10: number;
        rest: number;
      }>
    >,
  ]);

  // Build cumulative series per PG release cycle
  const cycleMap = new Map<string, Array<{ week: number; commits: number; cumCommits: number; cumReviewed: number; reviewPct: number }>>();
  for (const r of cycleRows) {
    const arr = cycleMap.get(r.pg_major) || [];
    const prev = arr[arr.length - 1];
    const cumCommits = (prev?.cumCommits || 0) + Number(r.commits || 0);
    const cumReviewed = (prev?.cumReviewed || 0) + Number(r.reviewed_commits || 0);
    arr.push({
      week: Number(r.week),
      commits: Number(r.commits || 0),
      cumCommits,
      cumReviewed,
      reviewPct: cumCommits > 0 ? Math.round((cumReviewed / cumCommits) * 1000) / 10 : 0,
    });
    cycleMap.set(r.pg_major, arr);
  }
  const releaseCycles = ["PG17", "PG18", "PG19", "PG20"]
    .filter((m) => cycleMap.has(m))
    .map((m) => ({
      major: m,
      points: cycleMap.get(m)!,
    }));

  const bfMap = new Map(subsysBfRows.map((r) => [r.name, r]));

  // 7x24 UTC heatmap
  const rhythmHeatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rhythmRows) {
    const d = Number(r.dow);
    const h = Number(r.hr);
    if (d >= 0 && d < 7 && h >= 0 && h < 24) {
      rhythmHeatmap[d]![h] = Number(r.cnt || 0);
    }
  }

  return {
    synced: true,
    window,
    syncMeta: {
      lastSyncedAt: syncMeta.last_synced_at || "",
      lastCommitAt: syncMeta.last_commit_at || "",
      totalCommitsAll,
      totalPeople,
      totalIdentities: Number(syncMeta.total_identities || 0),
      multiEmailPeople: Number(syncMeta.multi_email_people || 0),
    },
    totals: {
      commits: commitsCount,
      activeHackers: Number(cr.active_hackers || 0),
      authors: Number(cr.authors || 0),
      committers: Number(cr.committers || 0),
      reviewers: Number(cr.reviewers || 0),
      reporters: Number(cr.reporters || 0),
      reviewsGiven: Number(cr.reviews_given || 0),
      bugsReported: Number(cr.bugs_reported || 0),
      committedForOthers: forOthers,
      committedForOthersPct: commitsCount > 0 ? Math.round((forOthers / commitsCount) * 100) : 0,
      reverts: Number(ct.reverts || 0),
      backpatches: Number(ct.backpatches || 0),
      newHackers: Number(newHackersRows[0]?.cnt || 0),
      linesAdded: Number(ct.insertions || 0),
      linesDeleted: Number(ct.deletions || 0),
    },
    timeline,
    releaseCycles,
    concentrationByYear: concYearRows.map((r) => {
      const tot = Math.max(1, Number(r.total || 0));
      return {
        year: r.yr,
        total: Number(r.total || 0),
        committers: Number(r.committers || 0),
        busFactor: Number(r.bus_factor || 1),
        top1Pct: Math.round((Number(r.top1) / tot) * 1000) / 10,
        rank2_5Pct: Math.round((Number(r.rank2_5) / tot) * 1000) / 10,
        rank6_10Pct: Math.round((Number(r.rank6_10) / tot) * 1000) / 10,
        restPct: Math.round((Number(r.rest) / tot) * 1000) / 10,
      };
    }),
    rhythmHeatmap,
    subsystems: subsysRows.map((s) => {
      const bf = bfMap.get(s.name);
      return {
        name: s.name,
        commits: Number(s.commits || 0),
        authors: Number(s.authors || 0),
        committers: Number(s.committers || 0),
        busFactor: Number(bf?.bus_factor || 1),
        bfCommits: Number(bf?.bf_commits || 0),
        effectiveCommitters: Number(bf?.effective_committers || s.committers || 1),
        top1Pct: Number(bf?.top1_pct || 0),
        topCommitter: bf?.top_committer || "",
        topSlug: bf?.top_slug || "",
      };
    }),
    leaderboards: {
      committers: topCommittersRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        role: r.role,
        emailCount: Number(r.email_count || 0),
        total: Number(r.total || 0),
        forOthers: Number(r.for_others || 0),
        own: Math.max(0, Number(r.total || 0) - Number(r.for_others || 0)),
      })),
      authors: topAuthorsRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        role: r.role,
        emailCount: Number(r.email_count || 0),
        count: Number(r.count || 0),
      })),
      reviewers: topReviewersRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        role: r.role,
        emailCount: Number(r.email_count || 0),
        count: Number(r.count || 0),
      })),
      reporters: topReportersRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        role: r.role,
        emailCount: Number(r.email_count || 0),
        count: Number(r.count || 0),
      })),
      rising: risingRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        role: r.role,
        emailCount: Number(r.email_count || 0),
        firstSeen: (r.first_seen_at || "").slice(0, 10),
        authored: Number(r.authored || 0),
        reviewed: Number(r.reviewed || 0),
        reported: Number(r.reported || 0),
        totalActivity: Number(r.total_activity || 0),
      })),
    },
  };
}

export async function searchHackers(
  db: WebDatabase,
  opts?: { search?: string; role?: string; sort?: string; limit?: number },
) {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (opts?.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    const p = `$${params.length}`;
    where.push(
      `(p.canonical_name ILIKE ${p} OR p.slug ILIKE ${p} OR p.affiliations_json ILIKE ${p} OR p.email_domains_json ILIKE ${p} OR EXISTS (SELECT 1 FROM ${db.t("person_identities")} pi WHERE pi.person_id = p.id AND (pi.display_name ILIKE ${p} OR pi.normalized_name ILIKE ${p} OR pi.email_domain ILIKE ${p})))`,
    );
  }
  if (opts?.role && opts.role !== "all") {
    params.push(opts.role);
    where.push(`p.pg_role = $${params.length}`);
  }

  const orderSql =
    opts?.sort === "reviews"
      ? "p.reviews_given DESC, p.commits_authored DESC"
      : opts?.sort === "committed"
        ? "p.commits_committed DESC, p.commits_authored DESC"
        : opts?.sort === "reported"
          ? "p.bugs_reported DESC, p.commits_authored DESC"
          : opts?.sort === "recent"
            ? "p.last_seen_at DESC, p.commits_authored DESC"
            : "(p.commits_authored + p.reviews_given + p.bugs_reported + p.commits_committed_for_others) DESC, p.commits_authored DESC";

  const limit = Math.max(1, Math.min(200, Number(opts?.limit || 60)));
  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = (await db.sql.unsafe(
    `SELECT p.* FROM ${db.t("people")} p ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length}`,
    params,
  )) as Array<{
    id: number;
    slug: string;
    canonical_name: string;
    pg_role: string;
    affiliations_json: string;
    email_domains_json: string;
    email_count: number;
    first_seen_at: string;
    last_seen_at: string;
    commits_authored: number;
    commits_committed: number;
    commits_committed_for_others: number;
    reviews_given: number;
    bugs_reported: number;
    suggestions_given: number;
    tests_given: number;
    cf_authored: number;
    cf_reviewed: number;
    cf_committed: number;
    subsystems_json: string;
  }>;

  return rows.map((r) => ({
    slug: r.slug,
    name: r.canonical_name,
    role: r.pg_role,
    affiliations: parseJsonArray<string>(r.affiliations_json),
    emailDomains: parseJsonArray<string>(r.email_domains_json),
    emailCount: Number(r.email_count || 0),
    firstSeen: (r.first_seen_at || "").slice(0, 10),
    lastSeen: (r.last_seen_at || "").slice(0, 10),
    commitsAuthored: Number(r.commits_authored || 0),
    commitsCommitted: Number(r.commits_committed || 0),
    commitsCommittedForOthers: Number(r.commits_committed_for_others || 0),
    reviewsGiven: Number(r.reviews_given || 0),
    bugsReported: Number(r.bugs_reported || 0),
    suggestionsGiven: Number(r.suggestions_given || 0),
    testsGiven: Number(r.tests_given || 0),
    cfAuthored: Number(r.cf_authored || 0),
    cfReviewed: Number(r.cf_reviewed || 0),
    cfCommitted: Number(r.cf_committed || 0),
    topSubsystems: parseJsonArray<{ name: string; count: number }>(r.subsystems_json).slice(0, 3),
  }));
}

export async function getHackerProfileBySlug(db: WebDatabase, slug: string, requestedYear?: number | null) {
  const cleanSlug = slug.trim().toLowerCase();
  const rows = (await db.sql.unsafe(`SELECT * FROM ${db.t("people")} WHERE slug = $1`, [cleanSlug])) as Array<{
    id: number;
    slug: string;
    canonical_name: string;
    pg_role: string;
    affiliations_json: string;
    email_domains_json: string;
    email_count: number;
    first_seen_at: string;
    last_seen_at: string;
    commits_authored: number;
    commits_committed: number;
    commits_committed_for_others: number;
    reviews_given: number;
    bugs_reported: number;
    suggestions_given: number;
    tests_given: number;
    cf_authored: number;
    cf_reviewed: number;
    cf_committed: number;
    subsystems_json: string;
  }>;
  const p = rows[0];
  if (!p) return null;

  const pid = Number(p.id);
  const [
    aliasRows,
    careerRows,
    dayRows,
    rhythmRows,
    committedByRows,
    reviewedByRows,
    helpedAuthorsRows,
    recentCommitsRows,
    recentReviewsRows,
    cfRows,
    opinionRows,
  ] = await Promise.all([
    db.sql.unsafe(
      `SELECT DISTINCT display_name FROM ${db.t("person_identities")} WHERE person_id = $1 AND display_name != '' LIMIT 20`,
      [pid],
    ) as Promise<Array<{ display_name: string }>>,
    db.sql.unsafe(
      `SELECT
         LEFT(committed_at, 4) AS year,
         COUNT(*) FILTER (WHERE credit_kind IN ('author', 'co_author'))::int AS authored,
         COUNT(*) FILTER (WHERE credit_kind = 'committer')::int AS committed,
         COUNT(*) FILTER (WHERE credit_kind = 'reviewer')::int AS reviewed,
         COUNT(*) FILTER (WHERE credit_kind = 'reporter')::int AS reported
       FROM ${db.t("commit_credits")}
       WHERE person_id = $1
       GROUP BY 1
       ORDER BY 1 ASC`,
      [pid],
    ) as Promise<Array<{ year: string; authored: number; committed: number; reviewed: number; reported: number }>>,
    db.sql.unsafe(
      `SELECT LEFT(committed_at, 10) AS day, COUNT(*)::int AS cnt
       FROM ${db.t("commit_credits")}
       WHERE person_id = $1
       GROUP BY 1
       ORDER BY 1 ASC`,
      [pid],
    ) as Promise<Array<{ day: string; cnt: number }>>,
    db.sql.unsafe(
      `SELECT
         EXTRACT(DOW FROM committed_at::timestamptz AT TIME ZONE 'UTC')::int AS dow,
         EXTRACT(HOUR FROM committed_at::timestamptz AT TIME ZONE 'UTC')::int AS hr,
         COUNT(*)::int AS cnt
       FROM ${db.t("commit_credits")}
       WHERE person_id = $1
       GROUP BY 1, 2`,
      [pid],
    ) as Promise<Array<{ dow: number; hr: number; cnt: number }>>,
    // Top committers who landed this person's authored commits
    db.sql.unsafe(
      `SELECT cp.slug, cp.canonical_name AS name, cp.pg_role AS role, COUNT(*)::int AS count
       FROM ${db.t("commit_credits")} a
       JOIN ${db.t("pg_commits")} c ON c.sha = a.commit_sha
       JOIN ${db.t("people")} cp ON cp.id = c.committer_person_id
       WHERE a.person_id = $1 AND a.credit_kind IN ('author', 'co_author') AND cp.id != $1
       GROUP BY cp.id
       ORDER BY count DESC
       LIMIT 8`,
      [pid],
    ) as Promise<Array<{ slug: string; name: string; role: string; count: number }>>,
    // Top reviewers who reviewed this person's authored commits
    db.sql.unsafe(
      `SELECT rp.slug, rp.canonical_name AS name, rp.pg_role AS role, COUNT(*)::int AS count
       FROM ${db.t("commit_credits")} a
       JOIN ${db.t("commit_credits")} r ON r.commit_sha = a.commit_sha AND r.credit_kind = 'reviewer'
       JOIN ${db.t("people")} rp ON rp.id = r.person_id
       WHERE a.person_id = $1 AND a.credit_kind IN ('author', 'co_author') AND rp.id != $1
       GROUP BY rp.id
       ORDER BY count DESC
       LIMIT 8`,
      [pid],
    ) as Promise<Array<{ slug: string; name: string; role: string; count: number }>>,
    // Top authors whose patches this person reviewed or committed
    db.sql.unsafe(
      `SELECT ap.slug, ap.canonical_name AS name, ap.pg_role AS role, COUNT(*)::int AS count
       FROM ${db.t("commit_credits")} me
       JOIN ${db.t("commit_credits")} a ON a.commit_sha = me.commit_sha AND a.credit_kind IN ('author', 'co_author')
       JOIN ${db.t("people")} ap ON ap.id = a.person_id
       WHERE me.person_id = $1 AND me.credit_kind IN ('reviewer', 'committer') AND ap.id != $1
       GROUP BY ap.id
       ORDER BY count DESC
       LIMIT 8`,
      [pid],
    ) as Promise<Array<{ slug: string; name: string; role: string; count: number }>>,
    db.sql.unsafe(
      `SELECT c.sha, c.committed_at, c.subject, c.primary_subsystem, c.pg_major,
              c.is_revert, c.is_backpatch, c.discussion_urls_json, c.files_changed, c.insertions, c.deletions,
              ARRAY_AGG(DISTINCT cc.credit_kind) AS kinds
       FROM ${db.t("commit_credits")} cc
       JOIN ${db.t("pg_commits")} c ON c.sha = cc.commit_sha
       WHERE cc.person_id = $1 AND cc.credit_kind IN ('author', 'co_author', 'committer')
       GROUP BY c.sha
       ORDER BY c.committed_at DESC
       LIMIT 30`,
      [pid],
    ) as Promise<
      Array<{
        sha: string;
        committed_at: string;
        subject: string;
        primary_subsystem: string;
        pg_major: string;
        is_revert: boolean;
        is_backpatch: boolean;
        discussion_urls_json: string;
        files_changed: number;
        insertions: number;
        deletions: number;
        kinds: string[] | string;
      }>
    >,
    db.sql.unsafe(
      `SELECT c.sha, c.committed_at, c.subject, c.primary_subsystem, c.pg_major,
              c.discussion_urls_json, cc.credit_kind,
              ap.slug AS author_slug, ap.canonical_name AS author_name
       FROM ${db.t("commit_credits")} cc
       JOIN ${db.t("pg_commits")} c ON c.sha = cc.commit_sha
       LEFT JOIN ${db.t("people")} ap ON ap.id = c.author_person_id
       WHERE cc.person_id = $1 AND cc.credit_kind IN ('reviewer', 'reporter', 'tester', 'suggester', 'analyzer')
       ORDER BY c.committed_at DESC
       LIMIT 30`,
      [pid],
    ) as Promise<
      Array<{
        sha: string;
        committed_at: string;
        subject: string;
        primary_subsystem: string;
        pg_major: string;
        discussion_urls_json: string;
        credit_kind: string;
        author_slug: string | null;
        author_name: string | null;
      }>
    >,
    db.sql.unsafe(
      `SELECT cf_id, title, status, topic, authors, reviewers, committer, verdict
       FROM ${db.t("public_entries")}
       WHERE authors ILIKE $1 OR reviewers ILIKE $1 OR committer ILIKE $1
       ORDER BY recommended_score DESC, cf_id DESC
       LIMIT 40`,
      [`%${p.canonical_name}%`],
    ) as Promise<
      Array<{
        cf_id: number;
        title: string;
        status: string;
        topic: string;
        authors: string;
        reviewers: string;
        committer: string;
        verdict: string;
      }>
    >,
    db.sql.unsafe(
      `SELECT id, cf_id, backend, roast_level, roast_flavour, verdict, confidence, summary, created_at
       FROM ${db.t("public_opinions")}
       WHERE LOWER(contributor_name) = LOWER($1) OR LOWER(contributor_handle) = LOWER($2)
       ORDER BY created_at DESC
       LIMIT 20`,
      [p.canonical_name, p.slug],
    ) as Promise<
      Array<{
        id: number;
        cf_id: number;
        backend: string;
        roast_level: string;
        roast_flavour: string;
        verdict: string;
        confidence: string;
        summary: string;
        created_at: string;
      }>
    >,
  ]);

  // Available years & selected year heatmap
  const availableYears = Array.from(new Set(dayRows.map((d) => Number(d.day.slice(0, 4))).filter((y) => y >= 1996))).sort(
    (a, b) => b - a,
  );
  const selectedYear =
    requestedYear && availableYears.includes(requestedYear)
      ? requestedYear
      : availableYears[0] || new Date().getUTCFullYear();
  const yearPrefix = `${selectedYear}-`;
  const heatmap = dayRows
    .filter((d) => d.day.startsWith(yearPrefix))
    .map((d) => ({ date: d.day, count: Number(d.cnt || 0) }));

  // Longest active-day streak
  let longestStreakDays = 0;
  let curStreak = 0;
  let prevDayMs = -1;
  for (const d of dayRows) {
    const ms = Date.parse(`${d.day}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    if (prevDayMs >= 0 && Math.round((ms - prevDayMs) / 86_400_000) === 1) {
      curStreak++;
    } else {
      curStreak = 1;
    }
    if (curStreak > longestStreakDays) longestStreakDays = curStreak;
    prevDayMs = ms;
  }

  // Rhythm arrays
  const byHour = Array<number>(24).fill(0);
  const byDow = Array<number>(7).fill(0);
  for (const r of rhythmRows) {
    const d = Number(r.dow);
    const h = Number(r.hr);
    const c = Number(r.cnt || 0);
    if (d >= 0 && d < 7) byDow[d]! += c;
    if (h >= 0 && h < 24) byHour[h]! += c;
  }

  // Subsystem DNA percentages
  const rawSubsystems = parseJsonArray<{ name: string; count: number }>(p.subsystems_json);
  const subTotal = rawSubsystems.reduce((acc, s) => acc + Number(s.count || 0), 0);
  const subsystems = rawSubsystems.map((s) => ({
    name: s.name,
    count: Number(s.count || 0),
    pct: subTotal > 0 ? Math.round((Number(s.count || 0) / subTotal) * 100) : 0,
  }));

  const distinctAliases = Array.from(new Set(aliasRows.map((a) => a.display_name)))
    .filter((n) => n.toLowerCase() !== p.canonical_name.toLowerCase())
    .slice(0, 8);

  return {
    person: {
      slug: p.slug,
      name: p.canonical_name,
      role: p.pg_role,
      affiliations: parseJsonArray<string>(p.affiliations_json),
      emailDomains: parseJsonArray<string>(p.email_domains_json),
      emailCount: Number(p.email_count || 0),
      aliases: distinctAliases,
      firstSeen: (p.first_seen_at || "").slice(0, 10),
      lastSeen: (p.last_seen_at || "").slice(0, 10),
      commitsAuthored: Number(p.commits_authored || 0),
      commitsCommitted: Number(p.commits_committed || 0),
      commitsCommittedForOthers: Number(p.commits_committed_for_others || 0),
      reviewsGiven: Number(p.reviews_given || 0),
      bugsReported: Number(p.bugs_reported || 0),
      suggestionsGiven: Number(p.suggestions_given || 0),
      testsGiven: Number(p.tests_given || 0),
      cfAuthored: Number(p.cf_authored || 0),
      cfReviewed: Number(p.cf_reviewed || 0),
      cfCommitted: Number(p.cf_committed || 0),
    },
    availableYears,
    selectedYear,
    heatmap,
    careerByYear: careerRows.map((r) => ({
      year: r.year,
      authored: Number(r.authored || 0),
      committed: Number(r.committed || 0),
      reviewed: Number(r.reviewed || 0),
      reported: Number(r.reported || 0),
    })),
    subsystems: await (async () => {
      const baselineRows = (await db.sql.unsafe(
        `SELECT primary_subsystem AS name, COUNT(*)::int AS cnt FROM ${db.t("pg_commits")} GROUP BY 1`,
      )) as Array<{ name: string; cnt: number }>;
      const baseTot = Math.max(1, baselineRows.reduce((a, r) => a + Number(r.cnt || 0), 0));
      const basePctMap = new Map(baselineRows.map((r) => [r.name, (Number(r.cnt || 0) / baseTot) * 100]));
      return subsystems.map((s) => {
        const projPct = Math.max(0.5, basePctMap.get(s.name) || 5);
        const overIndex = Math.round((s.pct / projPct) * 10) / 10;
        return { ...s, projectPct: Math.round(projPct * 10) / 10, overIndex };
      });
    })(),
    rhythm: {
      byHour,
      byDow,
      longestStreakDays,
      activeDays: dayRows.length,
    },
    collaborators: {
      committedBy: committedByRows.map((r) => ({ slug: r.slug, name: r.name, role: r.role, count: Number(r.count || 0) })),
      reviewedBy: reviewedByRows.map((r) => ({ slug: r.slug, name: r.name, role: r.role, count: Number(r.count || 0) })),
      helpedAuthors: helpedAuthorsRows.map((r) => ({ slug: r.slug, name: r.name, role: r.role, count: Number(r.count || 0) })),
    },
    recentCommits: recentCommitsRows.map((r) => ({
      sha: r.sha,
      committedAt: r.committed_at,
      subject: r.subject,
      subsystem: r.primary_subsystem,
      pgMajor: r.pg_major,
      isRevert: Boolean(r.is_revert),
      isBackpatch: Boolean(r.is_backpatch),
      discussionUrls: parseJsonArray<string>(r.discussion_urls_json),
      filesChanged: Number(r.files_changed || 0),
      insertions: Number(r.insertions || 0),
      deletions: Number(r.deletions || 0),
      kinds: Array.isArray(r.kinds) ? r.kinds : String(r.kinds || "").replace(/[{}]/g, "").split(",").filter(Boolean),
    })),
    recentReviews: recentReviewsRows.map((r) => ({
      sha: r.sha,
      committedAt: r.committed_at,
      subject: r.subject,
      subsystem: r.primary_subsystem,
      pgMajor: r.pg_major,
      discussionUrls: parseJsonArray<string>(r.discussion_urls_json),
      kind: r.credit_kind,
      authorSlug: r.author_slug || "",
      authorName: r.author_name || "",
    })),
    commitfestEntries: cfRows,
    opinions: opinionRows,
    mailingLists: await getHackerMailingListStats(db, pid),
  };
}

export async function getTopHackerSlugsForSitemap(db: WebDatabase, limit = 150): Promise<Array<{ slug: string; last_seen_at: string }>> {
  return (await db.sql.unsafe(
    `SELECT slug, last_seen_at
     FROM ${db.t("people")}
     WHERE (commits_authored + reviews_given + commits_committed) >= 3
     ORDER BY (commits_authored + reviews_given + commits_committed) DESC
     LIMIT $1`,
    [limit],
  )) as Array<{ slug: string; last_seen_at: string }>;
}

export async function resolvePersonSlugByName(db: WebDatabase, rawName: string): Promise<string | null> {
  const q = rawName.trim();
  if (!q) return null;
  const direct = (await db.sql.unsafe(
    `SELECT slug FROM ${db.t("people")} WHERE LOWER(canonical_name) = LOWER($1) LIMIT 1`,
    [q],
  )) as Array<{ slug: string }>;
  if (direct[0]?.slug) return direct[0].slug;
  const byId = (await db.sql.unsafe(
    `SELECT p.slug FROM ${db.t("person_identities")} pi
     JOIN ${db.t("people")} p ON p.id = pi.person_id
     WHERE LOWER(pi.display_name) = LOWER($1) OR pi.normalized_name = LOWER($1)
     LIMIT 1`,
    [q],
  )) as Array<{ slug: string }>;
  return byId[0]?.slug ?? null;
}
