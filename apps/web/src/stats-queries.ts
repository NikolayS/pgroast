import type { WebDatabase } from "./db.ts";

export interface StatsVerificationItem {
  cf_id: number;
  title: string;
  status: string;
  verdict: string;
  evidence: string;
  modelSpec: string;
  compileSec: number | null;
}

export interface QueueUnitPatch {
  cf_id: number;
  title: string;
  author: string;
  subsystem: string;
  status: string;
  col: "needs_review" | "waiting" | "rfc" | "closed";
  verdict: string;
  isDark: boolean;
  hasCommunityOpinion: boolean;
  score: number;
  evidenceShort: string;
}

export interface TriageTableRow {
  cf_id: number;
  title: string;
  author: string;
  authorSlug: string | null;
  authorPriorCommits: number | null;
  subsystem: string;
  status: string;
  verdict: string;
  confidence: string;
  isDark: boolean;
  evidenceShort: string;
  failingSummary: string;
  workaround: string;
  score: number;
  reasonTag: string;
}

export interface DarkMatrixRow {
  cf_id: number;
  title: string;
  author: string;
  status: string;
  verdict: string;
  filesRead: number;
  apply: "clean" | "conflict" | "no_patch" | "none";
  compile: "pass" | "fail" | "none";
  compileSec: number | null;
  tests: "pass" | "fail" | "none";
  testsLabel: string;
  sql: "pass" | "issue" | "crash" | "none";
  sqlCases: number;
  modelSpec: string;
  breakRank: number;
}

export interface LoadVsCapacityRow {
  subsystem: string;
  openTotal: number;
  rfc: number;
  needsReview: number;
  waiting: number;
  darkCount: number;
  committers12m: number;
  commits12m: number;
  openPerCommitter: number | null;
}

export interface AuthorBeeswarmDot {
  cf_id: number;
  title: string;
  author: string;
  authorSlug: string | null;
  priorCommits: number;
  matched: boolean;
  statusRow: "rfc" | "needs_review" | "waiting";
  verdict: string;
  isDark: boolean;
  subsystem: string;
}

export interface CalibrationRow {
  verdict: string;
  committed: number;
  withdrawn: number;
  moved: number;
  rejected: number;
  totalClosed: number;
}

export interface StatsOverviewData {
  generatedAt: string;
  commitfestLabel: string;
  latestBriefSlug: string;
  totals: {
    total: number;
    open: number;
    closed: number;
    closedBreakdown: {
      committed: number;
      moved: number;
      withdrawn: number;
      rejected: number;
      returned: number;
    };
    roastedLive: number;
    roastedOpen: number;
    unroastedOpen: number;
    withOpinions: number;
    withDark: number;
    withMultiOpinion: number;
    rfcOpen: number;
    rfcWithOpinion: number;
    rfcClean: number;
    needsReviewOpen: number;
    waitingOpen: number;
    bugfixes: number;
    features: number;
    prodHits: number;
    totalOpinions: number;
    uniqueReviewers: number;
    uniqueModels: number;
  };
  queueUnits: QueueUnitPatch[];
  statusVsEvidence: {
    committerWarnings: TriageTableRow[];
    cleanPickups: TriageTableRow[];
  };
  darkMatrix: DarkMatrixRow[];
  loadVsCapacity: LoadVsCapacityRow[];
  authorBeeswarm: {
    dots: AuthorBeeswarmDot[];
    matchedCount: number;
    unmatchedCount: number;
    firstTimerCount: number;
    firstTimerStuckInReview: number;
    firstTimerClean: number;
  };
  productionHits: TriageTableRow[];
  calibration: {
    rows: CalibrationRow[];
    totalClosedWithVerdict: number;
    totalClosedWithoutVerdict: number;
  };
  // Backwards-compatible summary fields for external API consumers
  verdicts: Array<{ verdict: string; all: number; open: number }>;
  statusMatrix: Array<{
    status: string;
    isClosed: boolean;
    total: number;
    counts: Record<string, number>;
  }>;
  verification: {
    darkRuns: number;
    darkUniquePatches: number;
    mediumRuns: number;
    lightRuns: number;
    codeRead: number;
    avgFilesRead: number;
    gitApplyClean: number;
    gitApplyConflict: number;
    gitApplyNoPatch: number;
    compilePass: number;
    compileFail: number;
    avgCompileSec: number;
    medianCompileSec: number;
    testPass: number;
    testFail: number;
    totalTestsPassed: number;
    totalTestsRun: number;
    sqlPass: number;
    sqlIssue: number;
    sqlCrash: number;
    totalSqlCases: number;
    byModel: Array<{
      spec: string;
      backend: string;
      total: number;
      dark: number;
      medium: number;
      light: number;
      verdicts: Record<string, number>;
    }>;
    radar: {
      conflicts: StatsVerificationItem[];
      testOrBuildFails: StatsVerificationItem[];
      sqlIssues: StatsVerificationItem[];
      darkCleanRfc: StatsVerificationItem[];
    };
  };
  subsystems: Array<{
    topic: string;
    total: number;
    open: number;
    roasted: number;
    darkVerified: number;
    clean: number;
    ready: number;
    likelyReject: number;
  }>;
  kindComparison: Array<{
    key: "bugfix" | "feature" | "prod";
    label: string;
    total: number;
    open: number;
    committed: number;
    ready: number;
    needsReview: number;
    waiting: number;
    verdicts: Record<string, number>;
  }>;
  opinionVelocity: Array<{
    bucket: string;
    label: string;
    dark: number;
    medium: number;
    light: number;
    total: number;
  }>;
  contributors: {
    authors: Array<{
      name: string;
      slug: string | null;
      role: string;
      total: number;
      committed: number;
      ready: number;
      needsReview: number;
      waiting: number;
      other: number;
      darkVerified: number;
    }>;
    roasters: Array<{
      handle: string;
      name: string;
      total: number;
      dark: number;
      medium: number;
      light: number;
      models: string[];
    }>;
    roleDistribution: Array<{
      role: string;
      patches: number;
      open: number;
      committed: number;
    }>;
  };
  traffic: {
    total: number;
    last24h: number;
    last7d: number;
    timeline: Array<{ bucket: string; label: string; hits: number }>;
    topPatches: Array<{
      cf_id: number;
      hits: number;
      title: string;
      status: string;
      verdict: string;
      hasDark: boolean;
    }>;
    topReferrers: Array<{ ref_host: string; hits: number }>;
  };
}

const CLOSED_STATUSES = new Set([
  "committed",
  "rejected",
  "returned with feedback",
  "withdrawn",
  "moved to different cf",
]);

function isClosedStatus(st: string): boolean {
  return CLOSED_STATUSES.has((st || "").trim().toLowerCase());
}

/**
 * Deterministic mapping from CommitFest topic + title to the EXACT 14 canonical
 * `pg_commits.primary_subsystem` names so CommitFest review load aligns 1-to-1
 * with 12-month PostgreSQL committer capacity from `pg_commits`.
 */
function classifyCanonicalSubsystem(topic: string, title: string): string {
  const hay = `${topic || ""} ${title || ""}`.toLowerCase();
  if (/\b(planner|optimizer|plan|statistics|pg_stats|mcv|ndistinct|selectivity|cost|join|subquery|memoize|pathkey|reloptinfo|explain|partitionwise|semi-join|antijoin|or-to-any|saop|equivalence class|self-join)\b/.test(hay)) {
    return "Optimizer / Planner";
  }
  if (/\b(wal|xlog|checkpoint|recovery|archive|pg_rewind|pg_wal|backup|pg_basebackup|lsn|redo|standby|vacuum|autovacuum|freeze|xid|multixact|clog|slru|visibility|heap|tableam|toast|smgr|buffer|aio|io_uring|fsm|bgwriter|checkpointer|tablespace)\b/.test(hay)) {
    return "Storage & WAL";
  }
  if (/\b(btree|nbtree|gin|gist|spgist|brin|hash index|index|amcheck|opclass|bloom|reindex|pg_trgm)\b/.test(hay)) {
    return "Indexing & Access Methods";
  }
  if (/\b(replication|logical|walsender|walreceiver|subscription|publication|slot|pgoutput|decoding|sync rep|conflict|origin|two-phase)\b/.test(hay)) {
    return "Replication";
  }
  if (/\b(executor|parallel|sort|hashjoin|aggregate|window|jit|llvm|simd|tuplestore|tuplesort|merge join|gather|exec|node[a-z]+|hashagg|grouping|cte)\b/.test(hay)) {
    return "Executor";
  }
  if (/\b(partition|ddl|alter |create |drop |copy |constraint|foreign key|trigger|schema|temp table|catalog|pg_class|pg_attribute|pg_depend|pg_proc|pg_get_|view|matview|sequence|event trigger|policy|rls|grant|revoke|role|acl|search_path)\b/.test(hay)) {
    return "Catalog & DDL";
  }
  if (/\b(psql|pg_dump|pg_restore|pg_upgrade|pgbench|initdb|libpq|ecpg|pg_ctl|pg_combinebackup|pg_verifybackup|pg_createsubscriber|pg_amcheck|pg_isready|client|fe_utils|prompt|tab completion|psqlrc)\b/.test(hay)) {
    return "Client & psql";
  }
  if (/\b(contrib|extension|fdw|postgres_fdw|file_fdw|pg_stat_statements|pg_buffercache|pg_walinspect|pg_visibility|pgcrypto|hstore|ltree|citext|dblink|pageinspect|pg_prewarm|amcheck|uuid-ossp|earthdistance|btree_gist|btree_gin)\b/.test(hay)) {
    return "Contrib & Extensions";
  }
  if (/\b(doc|docs|documentation|sgml|manpage|manual|readme|glossary)\b/.test(hay)) {
    return "Documentation";
  }
  if (/\b(tap test|regress|isolation|test_|meson test|pg_regress|test suite|flaky test|perl test)\b/.test(hay)) {
    return "Tests & TAP";
  }
  if (/\b(meson|configure|autoconf|cmake|msvc|windows|win32|mingw|macos|freebsd|compiler|clang|gcc|bison|flex|build|warning|portability|c99|c11|c23|sanitize|valgrind|ubsan|asan)\b/.test(hay)) {
    return "Build & Portability";
  }
  if (/\b(json|jsonb|jsonpath|unicode|collation|regex|regexp|range|multirange|date|timestamp|timestamptz|interval|numeric|bytea|uuid|inet|cidr|macaddr|text|varchar|array|enum|domain|composite|record|xml|to_char|to_date|encode|decode|base64|ascii|utf8|type|cast|operator|builtin)\b/.test(hay)) {
    return "Types & Builtins";
  }
  if (/\b(parser|grammar|gram\.y|lexer|scan\.l|syntax|sql standard|merge |returning |select |insert |update |delete |plpgsql|plpython|plperl|pltcl|procedure|function|overloading|default arg)\b/.test(hay)) {
    return "Parser & SQL";
  }
  return "Postmaster & Core";
}

function formatModelSpec(backend: string, modelsJson: string): string {
  const b = (backend || "ai").toLowerCase().trim();
  if (modelsJson && modelsJson !== "{}") {
    try {
      const obj = JSON.parse(modelsJson) as Record<string, string>;
      if (obj.spec && obj.spec.trim()) return obj.spec.trim();
      const raw = (obj.critic || obj.synth || obj.roaster || "").trim();
      if (raw && raw !== "codex-default") {
        if (raw.includes("/")) return raw;
        const norm = raw.replace(/-(xhigh|high|medium|low|max|ultra)$/i, ":$1");
        if (/^(?:gpt-|o[134]|codex)/i.test(norm) || b === "codex") return `openai/${norm}`;
        if (/^(?:claude|opus|fable|mythos)/i.test(norm) || b === "claude") {
          return `anthropic/${norm.toLowerCase() === "opus" ? "claude-opus" : norm}`;
        }
        if (/^gemini/i.test(norm) || b === "agy") return `google/${norm}`;
        return `${b}/${norm}`;
      }
    } catch {
      // ignore
    }
  }
  return b === "codex" ? "openai/codex" : b === "claude" ? "anthropic/claude" : b;
}

function parseEvidence(modelsJson: string): {
  raw: string;
  filesRead: number;
  gitApply: "clean" | "conflict" | "no_patch" | "none";
  compile: "pass" | "fail" | "none";
  compileSec: number | null;
  tests: "pass" | "fail" | "none";
  testsPassed: number;
  testsTotal: number;
  testsLabel: string;
  sql: "pass" | "issue" | "crash" | "none";
  sqlCases: number;
} {
  let raw = "";
  try {
    raw = String((JSON.parse(modelsJson || "{}") as Record<string, string>).evidence || "");
  } catch {
    raw = "";
  }
  const filesMatch = raw.match(/Code Diff \((\d+)\s+file/i);
  const filesRead = filesMatch ? Number(filesMatch[1]) : 0;

  let gitApply: "clean" | "conflict" | "no_patch" | "none" = "none";
  if (/git apply\s*(?:✓|clean)/i.test(raw)) gitApply = "clean";
  else if (/git apply\s*(?:✗|conflict)/i.test(raw)) gitApply = "conflict";
  else if (/No patch/i.test(raw)) gitApply = "no_patch";

  let compile: "pass" | "fail" | "none" = "none";
  let compileSec: number | null = null;
  if (/meson compile\s*(?:\([^)]*\))?\s*(?:✓|pass)/i.test(raw)) {
    compile = "pass";
    const sm = raw.match(/meson compile[^|]*\((\d+)s\)/i);
    if (sm) compileSec = Number(sm[1]);
  } else if (/meson compile\s*(?:\([^)]*\))?\s*(?:✗|fail)/i.test(raw)) {
    compile = "fail";
  }

  let tests: "pass" | "fail" | "none" = "none";
  let testsPassed = 0;
  let testsTotal = 0;
  let testsLabel = "—";
  const tmPass = raw.match(/tests\s*(?:✓|pass)[^|]*\((\d+)\/(\d+)\)/i);
  if (tmPass) {
    tests = "pass";
    testsPassed = Number(tmPass[1]);
    testsTotal = Number(tmPass[2]);
    testsLabel = `${testsPassed}/${testsTotal}`;
  } else if (/tests\s*(?:✗|fail)/i.test(raw)) {
    tests = "fail";
    const tf = raw.match(/tests\s*(?:✗|fail)[^|]*\((\d+)\s+fail/i);
    testsTotal = tf ? Math.max(1, Number(tf[1])) : 1;
    testsLabel = tf ? `${tf[1]} fail` : "fail";
  }

  let sql: "pass" | "issue" | "crash" | "none" = "none";
  let sqlCases = 0;
  const sqlCaseMatch = raw.match(/live (?:PG )?SQL[^|]*\((\d+)\s+case/i);
  if (sqlCaseMatch) sqlCases = Number(sqlCaseMatch[1]);
  if (/live (?:PG )?SQL[^|]*(?:✗|crash|assert)/i.test(raw)) sql = "crash";
  else if (/live (?:PG )?SQL[^|]*⚠/i.test(raw)) sql = "issue";
  else if (/live (?:PG )?SQL[^|]*(?:✓|ok|pass)/i.test(raw)) sql = "pass";

  return { raw, filesRead, gitApply, compile, compileSec, tests, testsPassed, testsTotal, testsLabel, sql, sqlCases };
}

function normNameKey(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function primaryAuthorName(raw: string): string {
  const first = (raw || "").split(/,\s*/)[0] || "";
  return first.replace(/\s*\([^)]*\)\s*/g, "").trim() || first.trim() || "Unknown";
}

const LEVEL_RANK: Record<string, number> = { dark: 3, medium: 2, light: 1 };

export async function getStatsOverview(db: WebDatabase): Promise<StatsOverviewData> {
  const cutoff12m = new Date(Date.now() - 365 * 86_400_000).toISOString();

  const [
    entriesRows,
    opinionsRows,
    peopleRows,
    identRows,
    commitSubRows,
    briefRows,
    pvSummary,
    pvBucketRows,
  ] = await Promise.all([
    db.sql.unsafe(
      `SELECT cf_id, title, status, topic, authors, reviewers, committer, verdict, confidence, kind, seen_in_production, workaround, failing_summary, recommended_score
       FROM ${db.t("public_entries")}
       ORDER BY recommended_score DESC, cf_id DESC`,
    ) as Promise<Array<{
      cf_id: number;
      title: string;
      status: string;
      topic: string;
      authors: string;
      reviewers: string;
      committer: string;
      verdict: string;
      confidence: string;
      kind: string;
      seen_in_production: boolean;
      workaround: string;
      failing_summary: string;
      recommended_score: number;
    }>>,
    db.sql.unsafe(
      `SELECT id, cf_id, contributor_name, contributor_handle, backend, roast_level, roast_flavour, models_json, verdict, confidence, created_at
       FROM ${db.t("public_opinions")}
       ORDER BY created_at DESC`,
    ) as Promise<Array<{
      id: number;
      cf_id: number;
      contributor_name: string;
      contributor_handle: string;
      backend: string;
      roast_level: string;
      roast_flavour: string;
      models_json: string;
      verdict: string;
      confidence: string;
      created_at: string;
    }>>,
    db.sql.unsafe(
      `SELECT id, slug, canonical_name, pg_role, commits_authored FROM ${db.t("people")}`,
    ) as Promise<Array<{ id: number; slug: string; canonical_name: string; pg_role: string; commits_authored: number }>>,
    db.sql.unsafe(
      `SELECT person_id, display_name, normalized_name FROM ${db.t("person_identities")} WHERE COALESCE(display_name, '') != '' OR COALESCE(normalized_name, '') != ''`,
    ) as Promise<Array<{ person_id: number; display_name: string; normalized_name: string }>>,
    db.sql.unsafe(
      `SELECT primary_subsystem AS subsystem, COUNT(*)::int AS commits, COUNT(DISTINCT committer_person_id)::int AS committers
       FROM ${db.t("pg_commits")}
       WHERE committed_at >= $1
       GROUP BY 1`,
      [cutoff12m],
    ) as Promise<Array<{ subsystem: string; commits: number; committers: number }>>,
    db.sql.unsafe(
      `SELECT slug, commitfest_label FROM ${db.t("published_briefs")} ORDER BY created_at DESC LIMIT 1`,
    ) as Promise<Array<{ slug: string; commitfest_label: string }>>,
    db.getPageViewSummary(),
    db.sql.unsafe(
      `SELECT left(created_at, 13) AS bucket, COUNT(*)::int AS hits
       FROM ${db.t("page_views")}
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 36`,
    ) as Promise<Array<{ bucket: string; hits: number }>>,
  ]);

  const latestBrief = briefRows[0];
  const entryById = new Map(entriesRows.map((e) => [Number(e.cf_id), e]));

  // Unified person lookup with prior credited commits for Author Track Record beeswarm
  const personById = new Map(peopleRows.map((p) => [Number(p.id), p]));
  const personByName = new Map<string, { slug: string; canonicalName: string; role: string; commitsAuthored: number }>();
  for (const p of peopleRows) {
    const k = normNameKey(p.canonical_name);
    if (k && !personByName.has(k)) {
      personByName.set(k, {
        slug: p.slug,
        canonicalName: p.canonical_name,
        role: p.pg_role || "Contributor",
        commitsAuthored: Number(p.commits_authored || 0),
      });
    }
  }
  for (const idRow of identRows) {
    const p = personById.get(Number(idRow.person_id));
    if (!p) continue;
    for (const raw of [idRow.display_name, idRow.normalized_name]) {
      const k = normNameKey(raw);
      if (k && !personByName.has(k)) {
        personByName.set(k, {
          slug: p.slug,
          canonicalName: p.canonical_name,
          role: p.pg_role || "Contributor",
          commitsAuthored: Number(p.commits_authored || 0),
        });
      }
    }
  }

  // Group opinions by cf_id
  const opinionsByCf = new Map<number, typeof opinionsRows>();
  const darkCfSet = new Set<number>();
  const uniqueReviewersSet = new Set<string>();
  const uniqueModelsSet = new Set<string>();
  let darkRuns = 0;
  let mediumRuns = 0;
  let lightRuns = 0;

  const modelStatsMap = new Map<string, {
    spec: string;
    backend: string;
    total: number;
    dark: number;
    medium: number;
    light: number;
    verdicts: Record<string, number>;
  }>();
  const roasterMap = new Map<string, {
    handle: string;
    name: string;
    total: number;
    dark: number;
    medium: number;
    light: number;
    models: Set<string>;
  }>();
  const opVelMap = new Map<string, { dark: number; medium: number; light: number }>();
  const bestVerifiedByCf = new Map<number, {
    op: (typeof opinionsRows)[number];
    ev: ReturnType<typeof parseEvidence>;
    modelSpec: string;
  }>();

  for (const op of opinionsRows) {
    const cfId = Number(op.cf_id);
    let arr = opinionsByCf.get(cfId);
    if (!arr) {
      arr = [];
      opinionsByCf.set(cfId, arr);
    }
    arr.push(op);

    const lv = (op.roast_level || "light").toLowerCase();
    if (lv === "dark") {
      darkRuns++;
      darkCfSet.add(cfId);
    } else if (lv === "medium") mediumRuns++;
    else lightRuns++;

    const spec = formatModelSpec(op.backend, op.models_json);
    uniqueModelsSet.add(spec);
    const revKey = (op.contributor_handle || op.contributor_name || "").trim();
    if (revKey) uniqueReviewersSet.add(revKey);

    let ms = modelStatsMap.get(spec);
    if (!ms) {
      ms = { spec, backend: op.backend || "ai", total: 0, dark: 0, medium: 0, light: 0, verdicts: {} };
      modelStatsMap.set(spec, ms);
    }
    ms.total++;
    if (lv === "dark") ms.dark++;
    else if (lv === "medium") ms.medium++;
    else ms.light++;
    const vKey = op.verdict || "UNROASTED";
    ms.verdicts[vKey] = (ms.verdicts[vKey] || 0) + 1;

    const handle = (op.contributor_handle || "anonymous").trim();
    let rm = roasterMap.get(handle);
    if (!rm) {
      rm = { handle, name: op.contributor_name || handle, total: 0, dark: 0, medium: 0, light: 0, models: new Set() };
      roasterMap.set(handle, rm);
    }
    rm.total++;
    if (lv === "dark") rm.dark++;
    else if (lv === "medium") rm.medium++;
    else rm.light++;
    rm.models.add(spec);

    const hrBucket = (op.created_at || "").slice(0, 13);
    if (hrBucket) {
      let vb = opVelMap.get(hrBucket);
      if (!vb) {
        vb = { dark: 0, medium: 0, light: 0 };
        opVelMap.set(hrBucket, vb);
      }
      if (lv === "dark") vb.dark++;
      else if (lv === "medium") vb.medium++;
      else vb.light++;
    }

    if (lv === "dark" || lv === "medium") {
      const ev = parseEvidence(op.models_json);
      const prev = bestVerifiedByCf.get(cfId);
      if (!prev || (LEVEL_RANK[lv] || 0) > (LEVEL_RANK[(prev.op.roast_level || "light").toLowerCase()] || 0)) {
        bestVerifiedByCf.set(cfId, { op, ev, modelSpec: spec });
      }
    }
  }

  // Build Dark Evidence Matrix (1 row per unique verified patch, sorted by where it breaks first)
  let codeRead = 0;
  let filesSum = 0;
  let gitApplyClean = 0;
  let gitApplyConflict = 0;
  let gitApplyNoPatch = 0;
  let compilePass = 0;
  let compileFail = 0;
  const compileSecs: number[] = [];
  let testPass = 0;
  let testFail = 0;
  let totalTestsPassed = 0;
  let totalTestsRun = 0;
  let sqlPass = 0;
  let sqlIssue = 0;
  let sqlCrash = 0;
  let totalSqlCases = 0;

  const conflicts: StatsVerificationItem[] = [];
  const testOrBuildFails: StatsVerificationItem[] = [];
  const sqlIssues: StatsVerificationItem[] = [];
  const darkCleanRfc: StatsVerificationItem[] = [];
  const darkMatrix: DarkMatrixRow[] = [];

  for (const [cfId, item] of bestVerifiedByCf.entries()) {
    const { op, ev, modelSpec } = item;
    const entry = entryById.get(cfId);
    const title = entry?.title || `CF ${cfId}`;
    const status = entry?.status || "Open";
    const verdict = op.verdict || entry?.verdict || "UNROASTED";
    const info: StatsVerificationItem = {
      cf_id: cfId,
      title,
      status,
      verdict,
      evidence: ev.raw,
      modelSpec,
      compileSec: ev.compileSec,
    };

    if (ev.filesRead > 0 || ev.gitApply !== "none") {
      codeRead++;
      filesSum += ev.filesRead;
    }
    if (ev.gitApply === "clean") gitApplyClean++;
    else if (ev.gitApply === "conflict") {
      gitApplyConflict++;
      conflicts.push(info);
    } else if (ev.gitApply === "no_patch") gitApplyNoPatch++;

    if (ev.compile === "pass") {
      compilePass++;
      if (ev.compileSec != null) compileSecs.push(ev.compileSec);
    } else if (ev.compile === "fail") {
      compileFail++;
      testOrBuildFails.push(info);
    }

    if (ev.tests === "pass") {
      testPass++;
      totalTestsPassed += ev.testsPassed;
      totalTestsRun += ev.testsTotal;
    } else if (ev.tests === "fail") {
      testFail++;
      totalTestsRun += ev.testsTotal;
      if (ev.compile !== "fail") testOrBuildFails.push(info);
    }

    totalSqlCases += ev.sqlCases;
    if (ev.sql === "pass") sqlPass++;
    else if (ev.sql === "issue") {
      sqlIssue++;
      sqlIssues.push(info);
    } else if (ev.sql === "crash") {
      sqlCrash++;
      sqlIssues.unshift(info);
    }

    if (ev.gitApply === "clean" && ev.compile === "pass" && status.toLowerCase().includes("ready for committer")) {
      darkCleanRfc.push(info);
    }

    // Break rank: 0 = crash, 1 = apply conflict, 2 = compile fail, 3 = test fail, 4 = SQL edge-case, 5 = all clean
    let breakRank = 5;
    if (ev.sql === "crash") breakRank = 0;
    else if (ev.gitApply === "conflict") breakRank = 1;
    else if (ev.compile === "fail") breakRank = 2;
    else if (ev.tests === "fail") breakRank = 3;
    else if (ev.sql === "issue") breakRank = 4;

    darkMatrix.push({
      cf_id: cfId,
      title,
      author: primaryAuthorName(entry?.authors || ""),
      status,
      verdict,
      filesRead: ev.filesRead,
      apply: ev.gitApply,
      compile: ev.compile,
      compileSec: ev.compileSec,
      tests: ev.tests,
      testsLabel: ev.testsLabel,
      sql: ev.sql,
      sqlCases: ev.sqlCases,
      modelSpec,
      breakRank,
    });
  }

  darkMatrix.sort((a, b) => a.breakRank - b.breakRank || b.cf_id - a.cf_id);
  compileSecs.sort((a, b) => a - b);
  const avgCompileSec =
    compileSecs.length > 0 ? Math.round((compileSecs.reduce((a, b) => a + b, 0) / compileSecs.length) * 10) / 10 : 0;
  const medianCompileSec = compileSecs.length > 0 ? compileSecs[Math.floor(compileSecs.length / 2)]! : 0;

  // Walk all 736 entries for Queue Units, Status vs Evidence, Load vs Capacity, Author Beeswarm, Production Hits, Calibration
  const VERDICT_KEYS = [
    "NO-FUNDAMENTAL-OBJECTION",
    "NEEDS-COMMITTER-EYES",
    "NEEDS-DESIGN-DISCUSSION",
    "LIKELY-REJECT",
    "UNROASTED",
  ];
  const verdictAll: Record<string, number> = Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0]));
  const verdictOpen: Record<string, number> = Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0]));
  const statusMap = new Map<string, { status: string; isClosed: boolean; total: number; counts: Record<string, number> }>();
  const subsysMap = new Map<string, {
    topic: string;
    total: number;
    open: number;
    roasted: number;
    darkVerified: number;
    clean: number;
    ready: number;
    needsReview: number;
    waiting: number;
    likelyReject: number;
  }>();

  const makeKindAcc = (key: "bugfix" | "feature" | "prod", label: string) => ({
    key,
    label,
    total: 0,
    open: 0,
    committed: 0,
    ready: 0,
    needsReview: 0,
    waiting: 0,
    verdicts: Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0])) as Record<string, number>,
  });
  const kindBug = makeKindAcc("bugfix", "Bug Fixes");
  const kindFeat = makeKindAcc("feature", "Features");
  const kindProd = makeKindAcc("prod", "Seen in Production");

  const authorMap = new Map<string, {
    name: string;
    slug: string | null;
    role: string;
    total: number;
    committed: number;
    ready: number;
    needsReview: number;
    waiting: number;
    other: number;
    darkVerified: number;
  }>();
  const roleMap = new Map<string, { role: string; patches: number; open: number; committed: number }>();

  const queueUnits: QueueUnitPatch[] = [];
  const committerWarnings: TriageTableRow[] = [];
  const cleanPickups: TriageTableRow[] = [];
  const productionHits: TriageTableRow[] = [];
  const beeswarmDots: AuthorBeeswarmDot[] = [];

  const calMap = new Map<string, CalibrationRow>();
  for (const vk of VERDICT_KEYS.slice(0, 4)) {
    calMap.set(vk, { verdict: vk, committed: 0, withdrawn: 0, moved: 0, rejected: 0, totalClosed: 0 });
  }
  let totalClosedWithVerdict = 0;
  let totalClosedWithoutVerdict = 0;

  let openCount = 0;
  let closedCount = 0;
  const closedBreakdown = { committed: 0, moved: 0, withdrawn: 0, rejected: 0, returned: 0 };
  let roastedLive = 0;
  let roastedOpen = 0;
  let unroastedOpen = 0;
  let withOpinions = 0;
  let withMultiOpinion = 0;
  let rfcOpen = 0;
  let rfcWithOpinion = 0;
  let rfcClean = 0;
  let needsReviewOpen = 0;
  let waitingOpen = 0;
  let bugfixes = 0;
  let features = 0;
  let prodHits = 0;
  let matchedAuthorsOpen = 0;
  let unmatchedAuthorsOpen = 0;
  let firstTimerCount = 0;
  let firstTimerStuckInReview = 0;
  let firstTimerClean = 0;

  for (const e of entriesRows) {
    const cfId = Number(e.cf_id);
    const ops = opinionsByCf.get(cfId) || [];
    if (ops.length > 0) withOpinions++;
    if (ops.length >= 2) withMultiOpinion++;

    let effVerdict = (e.verdict || "").trim() || "UNROASTED";
    let effConfidence = (e.confidence || "medium").trim() || "medium";
    if (ops.length > 0) {
      const sortedOps = [...ops].sort(
        (a, b) =>
          (LEVEL_RANK[(b.roast_level || "light").toLowerCase()] || 0) -
            (LEVEL_RANK[(a.roast_level || "light").toLowerCase()] || 0) ||
          b.created_at.localeCompare(a.created_at),
      );
      if (sortedOps[0]?.verdict) effVerdict = sortedOps[0].verdict;
      if (sortedOps[0]?.confidence) effConfidence = sortedOps[0].confidence;
    }
    if (!VERDICT_KEYS.includes(effVerdict)) effVerdict = "UNROASTED";

    const st = (e.status || "Unknown").trim() || "Unknown";
    const stLow = st.toLowerCase();
    const closed = isClosedStatus(st);
    const isRoasted = effVerdict !== "UNROASTED";
    const isDark = darkCfSet.has(cfId);
    const verified = bestVerifiedByCf.get(cfId);
    const isRfc = stLow.includes("ready for committer");
    const isCommitted = stLow === "committed";
    const isNeedsReview = stLow.includes("needs review");
    const isWaiting = stLow.includes("waiting on author");

    if (closed) {
      closedCount++;
      if (isCommitted) closedBreakdown.committed++;
      else if (stLow.includes("moved")) closedBreakdown.moved++;
      else if (stLow.includes("withdrawn")) closedBreakdown.withdrawn++;
      else if (stLow.includes("rejected")) closedBreakdown.rejected++;
      else closedBreakdown.returned++;

      if (isRoasted) {
        totalClosedWithVerdict++;
        const cr = calMap.get(effVerdict);
        if (cr) {
          cr.totalClosed++;
          if (isCommitted) cr.committed++;
          else if (stLow.includes("withdrawn")) cr.withdrawn++;
          else if (stLow.includes("moved")) cr.moved++;
          else cr.rejected++;
        }
      } else {
        totalClosedWithoutVerdict++;
      }
    } else {
      openCount++;
      if (isRfc) rfcOpen++;
      else if (isNeedsReview) needsReviewOpen++;
      else if (isWaiting) waitingOpen++;
    }

    if (isRoasted) {
      roastedLive++;
      if (!closed) roastedOpen++;
    } else if (!closed) {
      unroastedOpen++;
    }

    if (isRfc) {
      if (ops.length > 0) rfcWithOpinion++;
      if (effVerdict === "NO-FUNDAMENTAL-OBJECTION") rfcClean++;
    }

    verdictAll[effVerdict] = (verdictAll[effVerdict] || 0) + 1;
    if (!closed) verdictOpen[effVerdict] = (verdictOpen[effVerdict] || 0) + 1;

    let sm = statusMap.get(st);
    if (!sm) {
      sm = { status: st, isClosed: closed, total: 0, counts: Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0])) };
      statusMap.set(st, sm);
    }
    sm.total++;
    sm.counts[effVerdict] = (sm.counts[effVerdict] || 0) + 1;

    const sub = classifyCanonicalSubsystem(e.topic, e.title);
    let ss = subsysMap.get(sub);
    if (!ss) {
      ss = { topic: sub, total: 0, open: 0, roasted: 0, darkVerified: 0, clean: 0, ready: 0, needsReview: 0, waiting: 0, likelyReject: 0 };
      subsysMap.set(sub, ss);
    }
    ss.total++;
    if (!closed) ss.open++;
    if (isRoasted) ss.roasted++;
    if (isDark) ss.darkVerified++;
    if (effVerdict === "NO-FUNDAMENTAL-OBJECTION") ss.clean++;
    if (isRfc) ss.ready++;
    else if (isNeedsReview) ss.needsReview++;
    else if (isWaiting) ss.waiting++;
    if (effVerdict === "LIKELY-REJECT") ss.likelyReject++;

    const addToKind = (acc: ReturnType<typeof makeKindAcc>) => {
      acc.total++;
      if (!closed) acc.open++;
      if (isCommitted) acc.committed++;
      else if (isRfc) acc.ready++;
      else if (isNeedsReview) acc.needsReview++;
      else if (isWaiting) acc.waiting++;
      acc.verdicts[effVerdict] = (acc.verdicts[effVerdict] || 0) + 1;
    };
    if (e.kind === "bugfix") {
      bugfixes++;
      addToKind(kindBug);
    } else {
      features++;
      addToKind(kindFeat);
    }
    if (e.seen_in_production) {
      prodHits++;
      addToKind(kindProd);
    }

    // Match primary author to `people`
    const firstAuthor = primaryAuthorName(e.authors || "");
    const firstMatch = firstAuthor !== "Unknown" ? personByName.get(normNameKey(firstAuthor)) : undefined;
    const authorDisplay = firstMatch ? firstMatch.canonicalName : firstAuthor;
    const authorSlug = firstMatch ? firstMatch.slug : null;
    const priorCommits = firstMatch ? firstMatch.commitsAuthored : 0;

    // Short Dark evidence string
    const evShort = verified
      ? [
          verified.ev.gitApply === "clean" ? "apply ✓" : verified.ev.gitApply === "conflict" ? "apply ✗" : "",
          verified.ev.compile === "pass" ? `build ${verified.ev.compileSec ?? ""}s` : verified.ev.compile === "fail" ? "build ✗" : "",
          verified.ev.tests === "pass" ? `tests ${verified.ev.testsLabel}` : verified.ev.tests === "fail" ? `tests ✗` : "",
          verified.ev.sql === "crash" ? "SQL CRASH" : verified.ev.sql === "issue" ? `SQL ⚠ (${verified.ev.sqlCases})` : verified.ev.sql === "pass" ? `SQL ✓ (${verified.ev.sqlCases})` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

    // 1. Queue Unit Square
    const col: QueueUnitPatch["col"] = closed
      ? "closed"
      : isRfc
        ? "rfc"
        : isWaiting
          ? "waiting"
          : "needs_review";
    queueUnits.push({
      cf_id: cfId,
      title: e.title,
      author: authorDisplay,
      subsystem: sub,
      status: st,
      col,
      verdict: effVerdict,
      isDark,
      hasCommunityOpinion: ops.length > 0,
      score: Number(e.recommended_score || 0),
      evidenceShort: evShort,
    });

    // 2. Status vs Evidence rows
    const makeTriageRow = (reasonTag: string): TriageTableRow => ({
      cf_id: cfId,
      title: e.title,
      author: authorDisplay,
      authorSlug,
      authorPriorCommits: firstMatch ? priorCommits : null,
      subsystem: sub,
      status: st,
      verdict: effVerdict,
      confidence: effConfidence,
      isDark,
      evidenceShort: evShort,
      failingSummary: (e.failing_summary || "").trim(),
      workaround: (e.workaround || "").trim(),
      score: Number(e.recommended_score || 0),
      reasonTag,
    });

    const hasDarkFailure = Boolean(
      verified &&
        (verified.ev.gitApply === "conflict" ||
          verified.ev.compile === "fail" ||
          verified.ev.tests === "fail" ||
          verified.ev.sql === "crash"),
    );

    if (isRfc && (effVerdict === "LIKELY-REJECT" || hasDarkFailure || effVerdict === "NEEDS-DESIGN-DISCUSSION")) {
      const reasonTag =
        effVerdict === "LIKELY-REJECT"
          ? "Likely reject"
          : verified?.ev.gitApply === "conflict"
            ? "Apply conflict"
            : verified?.ev.tests === "fail"
              ? "Tests failed"
              : verified?.ev.compile === "fail"
                ? "Compile failed"
                : "Design debate";
      committerWarnings.push(makeTriageRow(reasonTag));
    }

    if (isNeedsReview && effVerdict === "NO-FUNDAMENTAL-OBJECTION" && !hasDarkFailure) {
      cleanPickups.push(makeTriageRow(isDark ? "Dark verified" : ops.length > 0 ? "Light verified" : "Baseline clean"));
    }

    if (e.seen_in_production) {
      productionHits.push(makeTriageRow(st));
    }

    // 5. Author Track Record Beeswarm (open patches only)
    if (!closed) {
      const statusRow: AuthorBeeswarmDot["statusRow"] = isRfc ? "rfc" : isWaiting ? "waiting" : "needs_review";
      if (firstMatch) matchedAuthorsOpen++;
      else unmatchedAuthorsOpen++;
      if (!firstMatch || priorCommits === 0) {
        firstTimerCount++;
        if (isNeedsReview) firstTimerStuckInReview++;
        if (effVerdict === "NO-FUNDAMENTAL-OBJECTION") firstTimerClean++;
      }
      beeswarmDots.push({
        cf_id: cfId,
        title: e.title,
        author: authorDisplay,
        authorSlug,
        priorCommits,
        matched: Boolean(firstMatch),
        statusRow,
        verdict: effVerdict,
        isDark,
        subsystem: sub,
      });
    }

    // Unified Author leaderboard (kept for API compatibility)
    const rawAuthors = (e.authors || "").trim();
    if (rawAuthors && rawAuthors !== "—") {
      const seenAuthorForPatch = new Set<string>();
      const rolesSeenForPatch = new Set<string>();
      for (const part of rawAuthors.split(/,\s*/)) {
        const clean = part.replace(/\s*\([^)]*\)\s*/g, "").trim();
        if (!clean || clean === "—") continue;
        const matched = personByName.get(normNameKey(clean));
        const key = matched ? `slug:${matched.slug}` : `raw:${normNameKey(clean)}`;
        if (seenAuthorForPatch.has(key)) continue;
        seenAuthorForPatch.add(key);

        const displayName = matched ? matched.canonicalName : clean;
        const role = matched ? matched.role : "New / Unlinked";
        rolesSeenForPatch.add(role);

        let am = authorMap.get(key);
        if (!am) {
          am = {
            name: displayName,
            slug: matched ? matched.slug : null,
            role,
            total: 0,
            committed: 0,
            ready: 0,
            needsReview: 0,
            waiting: 0,
            other: 0,
            darkVerified: 0,
          };
          authorMap.set(key, am);
        }
        am.total++;
        if (isCommitted) am.committed++;
        else if (isRfc) am.ready++;
        else if (isNeedsReview) am.needsReview++;
        else if (isWaiting) am.waiting++;
        else am.other++;
        if (isDark) am.darkVerified++;
      }

      const roleOrder = ["Core Team", "Committer", "Major Contributor", "Significant Contributor", "Contributor", "New / Unlinked"];
      const topRole = roleOrder.find((r) => rolesSeenForPatch.has(r)) || "New / Unlinked";
      let rm = roleMap.get(topRole);
      if (!rm) {
        rm = { role: topRole, patches: 0, open: 0, committed: 0 };
        roleMap.set(topRole, rm);
      }
      rm.patches++;
      if (!closed) rm.open++;
      if (isCommitted) rm.committed++;
    }
  }

  // Sort Status vs Evidence lists by actionable priority
  const warnRank = (r: TriageTableRow): number => {
    if (r.verdict === "LIKELY-REJECT") return 0;
    if (r.reasonTag === "Apply conflict" || r.reasonTag === "Compile failed" || r.reasonTag === "Tests failed") return 1;
    if (r.isDark) return 2;
    return 3;
  };
  committerWarnings.sort((a, b) => warnRank(a) - warnRank(b) || b.score - a.score || b.cf_id - a.cf_id);
  cleanPickups.sort(
    (a, b) =>
      Number(b.isDark) - Number(a.isDark) ||
      (b.confidence === "high" ? 1 : 0) - (a.confidence === "high" ? 1 : 0) ||
      b.score - a.score ||
      b.cf_id - a.cf_id,
  );

  // Build Review Load vs Committer Capacity (1-to-1 join with pg_commits 12-month active committers!)
  const commitSubMap = new Map(
    commitSubRows.map((r) => [String(r.subsystem), { commits: Number(r.commits || 0), committers: Number(r.committers || 0) }]),
  );
  const loadVsCapacity: LoadVsCapacityRow[] = Array.from(subsysMap.values())
    .filter((s) => s.open > 0)
    .map((s) => {
      const git = commitSubMap.get(s.topic) || { commits: 0, committers: 0 };
      const ratio = git.committers > 0 ? Math.round((s.open / git.committers) * 10) / 10 : null;
      return {
        subsystem: s.topic,
        openTotal: s.open,
        rfc: s.ready,
        needsReview: s.needsReview,
        waiting: s.waiting,
        darkCount: s.darkVerified,
        committers12m: git.committers,
        commits12m: git.commits,
        openPerCommitter: ratio,
      };
    })
    .sort((a, b) => (b.openPerCommitter ?? 999) - (a.openPerCommitter ?? 999) || b.openTotal - a.openTotal);

  const statusPriority = (st: string): number => {
    const s = st.toLowerCase();
    if (s.includes("needs review")) return 0;
    if (s.includes("ready for committer")) return 1;
    if (s.includes("waiting on author")) return 2;
    if (s === "committed") return 3;
    if (s.includes("moved")) return 4;
    if (s.includes("withdrawn")) return 5;
    return 6;
  };
  const statusMatrix = Array.from(statusMap.values()).sort(
    (a, b) => statusPriority(a.status) - statusPriority(b.status) || b.total - a.total,
  );

  const opinionVelocity = Array.from(opVelMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-24)
    .map(([bucket, v]) => ({
      bucket,
      label: `${bucket.slice(5, 10)} ${bucket.slice(11, 13)}h`,
      dark: v.dark,
      medium: v.medium,
      light: v.light,
      total: v.dark + v.medium + v.light,
    }));

  const trafficTimeline = [...pvBucketRows]
    .reverse()
    .slice(-24)
    .map((r) => ({
      bucket: String(r.bucket),
      label: `${String(r.bucket).slice(5, 10)} ${String(r.bucket).slice(11, 13)}h`,
      hits: Number(r.hits || 0),
    }));

  const roleOrder = ["Core Team", "Committer", "Major Contributor", "Significant Contributor", "Contributor", "New / Unlinked"];
  const roleDistribution = roleOrder
    .map((role) => roleMap.get(role))
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.patches > 0));

  return {
    generatedAt: new Date().toISOString(),
    commitfestLabel: latestBrief?.commitfest_label || "PostgreSQL CommitFest",
    latestBriefSlug: latestBrief?.slug || "latest",
    totals: {
      total: entriesRows.length,
      open: openCount,
      closed: closedCount,
      closedBreakdown,
      roastedLive,
      roastedOpen,
      unroastedOpen,
      withOpinions,
      withDark: darkCfSet.size,
      withMultiOpinion,
      rfcOpen,
      rfcWithOpinion,
      rfcClean,
      needsReviewOpen,
      waitingOpen,
      bugfixes,
      features,
      prodHits,
      totalOpinions: opinionsRows.length,
      uniqueReviewers: uniqueReviewersSet.size,
      uniqueModels: uniqueModelsSet.size,
    },
    queueUnits,
    statusVsEvidence: {
      committerWarnings: committerWarnings.slice(0, 14),
      cleanPickups: cleanPickups.slice(0, 14),
    },
    darkMatrix,
    loadVsCapacity,
    authorBeeswarm: {
      dots: beeswarmDots,
      matchedCount: matchedAuthorsOpen,
      unmatchedCount: unmatchedAuthorsOpen,
      firstTimerCount,
      firstTimerStuckInReview,
      firstTimerClean,
    },
    productionHits,
    calibration: {
      rows: Array.from(calMap.values()),
      totalClosedWithVerdict,
      totalClosedWithoutVerdict,
    },
    verdicts: VERDICT_KEYS.map((k) => ({
      verdict: k,
      all: verdictAll[k] || 0,
      open: verdictOpen[k] || 0,
    })),
    statusMatrix,
    verification: {
      darkRuns,
      darkUniquePatches: darkCfSet.size,
      mediumRuns,
      lightRuns,
      codeRead,
      avgFilesRead: codeRead > 0 ? Math.round((filesSum / codeRead) * 10) / 10 : 0,
      gitApplyClean,
      gitApplyConflict,
      gitApplyNoPatch,
      compilePass,
      compileFail,
      avgCompileSec,
      medianCompileSec,
      testPass,
      testFail,
      totalTestsPassed,
      totalTestsRun,
      sqlPass,
      sqlIssue,
      sqlCrash,
      totalSqlCases,
      byModel: Array.from(modelStatsMap.values()).sort((a, b) => b.total - a.total),
      radar: {
        conflicts: conflicts.slice(0, 12),
        testOrBuildFails: testOrBuildFails.slice(0, 12),
        sqlIssues: sqlIssues.slice(0, 12),
        darkCleanRfc: darkCleanRfc.slice(0, 12),
      },
    },
    subsystems: Array.from(subsysMap.values())
      .map(({ needsReview: _n, waiting: _w, ...rest }) => rest)
      .sort((a, b) => b.open - a.open || b.total - a.total),
    kindComparison: [kindBug, kindFeat, kindProd],
    opinionVelocity,
    contributors: {
      authors: Array.from(authorMap.values())
        .sort((a, b) => b.total - a.total || b.committed - a.committed)
        .slice(0, 18),
      roasters: Array.from(roasterMap.values())
        .map((r) => ({
          handle: r.handle,
          name: r.name,
          total: r.total,
          dark: r.dark,
          medium: r.medium,
          light: r.light,
          models: Array.from(r.models),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12),
      roleDistribution,
    },
    traffic: {
      total: pvSummary.total,
      last24h: pvSummary.last24h,
      last7d: pvSummary.last7d,
      timeline: trafficTimeline,
      topPatches: pvSummary.topPatches.slice(0, 5).map((p) => {
        const e = entryById.get(p.cf_id);
        return {
          cf_id: p.cf_id,
          hits: p.hits,
          title: e?.title || `CF ${p.cf_id}`,
          status: e?.status || "",
          verdict: e?.verdict || "UNROASTED",
          hasDark: darkCfSet.has(p.cf_id),
        };
      }),
      topReferrers: pvSummary.topReferrers.slice(0, 10),
    },
  };
}
