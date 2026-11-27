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

export interface StatsOverviewData {
  generatedAt: string;
  commitfestLabel: string;
  latestBriefSlug: string;
  totals: {
    total: number;
    open: number;
    closed: number;
    roastedLive: number;
    roastedOpen: number;
    unroastedOpen: number;
    withOpinions: number;
    withDark: number;
    withMultiOpinion: number;
    rfcOpen: number;
    rfcWithOpinion: number;
    rfcClean: number;
    bugfixes: number;
    features: number;
    prodHits: number;
    totalOpinions: number;
    uniqueReviewers: number;
    uniqueModels: number;
  };
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

function classifySubsystem(topic: string, title: string): string {
  const rawTopic = (topic || "").trim();
  if (rawTopic && rawTopic.toLowerCase() !== "unknown") return rawTopic;
  const hay = `${rawTopic} ${title}`.toLowerCase();
  if (/\b(planner|optimizer|statistics|stats|analyze|cost|join|subquery|memoize|path|reloptinfo|selectivity|explain)\b/.test(hay)) {
    return "Planner / Optimizer / Stats";
  }
  if (/\b(wal|xlog|checkpoint|recovery|archive|pg_rewind|pg_wal|backup|pg_basebackup|lsn|redo|standby)\b/.test(hay)) {
    return "WAL / Recovery / Checkpoint";
  }
  if (/\b(btree|nbtree|gin|gist|spgist|brin|hash index|index|amcheck|opclass|bloom)\b/.test(hay)) {
    return "Index AM / amcheck";
  }
  if (/\b(replication|logical|walsender|walreceiver|subscription|publication|slot|pgoutput|decoding)\b/.test(hay)) {
    return "Replication / Logical";
  }
  if (/\b(vacuum|autovacuum|freeze|xid|multixact|clog|slru|visibility|heap|tableam|toast|smgr|buffer|aio|io_uring)\b/.test(hay)) {
    return "Storage / Vacuum / Buffer";
  }
  if (/\b(partition|ddl|alter table|create table|copy|drop|constraint|foreign key|trigger|schema|temp table)\b/.test(hay)) {
    return "DDL / Partitioning / COPY";
  }
  if (/\b(executor|parallel|sort|hashjoin|aggregate|window|jit|llvm|simd|tuplestore|tuplesort|memoize)\b/.test(hay)) {
    return "Executor / Parallel / JIT";
  }
  if (/\b(psql|pg_dump|pg_restore|pg_upgrade|pgbench|initdb|libpq|ecpg|pg_ctl|client|fe_utils)\b/.test(hay)) {
    return "Client / Binaries / Tools";
  }
  if (/\b(json|jsonb|jsonpath|sql|parser|grammar|regex|collation|unicode|type|range|multirange|date|timestamp|numeric|xml)\b/.test(hay)) {
    return "SQL / Types / JSON";
  }
  if (/\b(pg_stat|monitor|logging|guc|wait event|progress|inspect|pg_buffercache|contrib|extension|fdw|postgres_fdw)\b/.test(hay)) {
    return "Observability / Contrib / FDW";
  }
  if (/\b(auth|ssl|tls|oauth|scram|gss|ldap|role|grant|rls|security|privilege|password)\b/.test(hay)) {
    return "Security / Auth / Roles";
  }
  if (/\b(plpgsql|plpython|plperl|pltcl|procedure|function)\b/.test(hay)) {
    return "Procedural Languages";
  }
  return "Core / Misc";
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
  const tmPass = raw.match(/tests\s*(?:✓|pass)[^|]*\((\d+)\/(\d+)\)/i);
  if (tmPass) {
    tests = "pass";
    testsPassed = Number(tmPass[1]);
    testsTotal = Number(tmPass[2]);
  } else if (/tests\s*(?:✗|fail)/i.test(raw)) {
    tests = "fail";
    const tf = raw.match(/tests\s*(?:✗|fail)[^|]*\((\d+)\s+fail/i);
    testsTotal = tf ? Math.max(1, Number(tf[1])) : 1;
  }

  let sql: "pass" | "issue" | "crash" | "none" = "none";
  let sqlCases = 0;
  const sqlCaseMatch = raw.match(/live (?:PG )?SQL[^|]*\((\d+)\s+case/i);
  if (sqlCaseMatch) sqlCases = Number(sqlCaseMatch[1]);
  if (/live (?:PG )?SQL[^|]*(?:✗|crash|assert)/i.test(raw)) sql = "crash";
  else if (/live (?:PG )?SQL[^|]*⚠/i.test(raw)) sql = "issue";
  else if (/live (?:PG )?SQL[^|]*(?:✓|ok|pass)/i.test(raw)) sql = "pass";

  return { raw, filesRead, gitApply, compile, compileSec, tests, testsPassed, testsTotal, sql, sqlCases };
}

function normNameKey(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEVEL_RANK: Record<string, number> = { dark: 3, medium: 2, light: 1 };

export async function getStatsOverview(db: WebDatabase): Promise<StatsOverviewData> {
  const [
    entriesRows,
    opinionsRows,
    peopleRows,
    identRows,
    briefRows,
    pvSummary,
    pvBucketRows,
  ] = await Promise.all([
    db.sql.unsafe(
      `SELECT cf_id, title, status, topic, authors, reviewers, committer, verdict, confidence, kind, seen_in_production
       FROM ${db.t("public_entries")}
       ORDER BY cf_id DESC`,
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
      `SELECT id, slug, canonical_name, pg_role FROM ${db.t("people")}`,
    ) as Promise<Array<{ id: number; slug: string; canonical_name: string; pg_role: string }>>,
    db.sql.unsafe(
      `SELECT person_id, display_name, normalized_name FROM ${db.t("person_identities")} WHERE COALESCE(display_name, '') != '' OR COALESCE(normalized_name, '') != ''`,
    ) as Promise<Array<{ person_id: number; display_name: string; normalized_name: string }>>,
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

  // Build normalized-name -> unified person lookup so CommitFest authors link to /hacker/<slug>!
  const personById = new Map(peopleRows.map((p) => [Number(p.id), p]));
  const personByName = new Map<string, { slug: string; canonicalName: string; role: string }>();
  for (const p of peopleRows) {
    const k = normNameKey(p.canonical_name);
    if (k && !personByName.has(k)) {
      personByName.set(k, { slug: p.slug, canonicalName: p.canonical_name, role: p.pg_role || "Contributor" });
    }
  }
  for (const idRow of identRows) {
    const p = personById.get(Number(idRow.person_id));
    if (!p) continue;
    for (const raw of [idRow.display_name, idRow.normalized_name]) {
      const k = normNameKey(raw);
      if (k && !personByName.has(k)) {
        personByName.set(k, { slug: p.slug, canonicalName: p.canonical_name, role: p.pg_role || "Contributor" });
      }
    }
  }

  // Group opinions by cf_id and compute best opinion per patch (dark > medium > light, then latest)
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

  // Deduplicated latest code-verified opinion per patch for accurate pipeline funnel
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
    } else if (lv === "medium") {
      mediumRuns++;
    } else {
      lightRuns++;
    }

    const spec = formatModelSpec(op.backend, op.models_json);
    uniqueModelsSet.add(spec);
    const revKey = (op.contributor_handle || op.contributor_name || "").trim();
    if (revKey) uniqueReviewersSet.add(revKey);

    // By-model stats
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

    // By-contributor roaster stats
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

    // Opinion velocity bucket (YYYY-MM-DDTHH)
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

    // Best verified opinion per cf_id (dark/medium with evidence)
    if (lv === "dark" || lv === "medium") {
      const ev = parseEvidence(op.models_json);
      const prev = bestVerifiedByCf.get(cfId);
      if (!prev || (LEVEL_RANK[lv] || 0) > (LEVEL_RANK[(prev.op.roast_level || "light").toLowerCase()] || 0)) {
        bestVerifiedByCf.set(cfId, { op, ev, modelSpec: spec });
      }
    }
  }

  // Compute Verification Pipeline Funnel across unique verified patches
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

  for (const [cfId, item] of bestVerifiedByCf.entries()) {
    const { op, ev, modelSpec } = item;
    const entry = entryById.get(cfId);
    const info: StatsVerificationItem = {
      cf_id: cfId,
      title: entry?.title || `CF ${cfId}`,
      status: entry?.status || "Open",
      verdict: op.verdict || entry?.verdict || "UNROASTED",
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
    } else if (ev.gitApply === "no_patch") {
      gitApplyNoPatch++;
    }

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

    if (
      ev.gitApply === "clean" &&
      ev.compile === "pass" &&
      (entry?.status || "").toLowerCase().includes("ready for committer")
    ) {
      darkCleanRfc.push(info);
    }
  }

  compileSecs.sort((a, b) => a - b);
  const avgCompileSec =
    compileSecs.length > 0 ? Math.round((compileSecs.reduce((a, b) => a + b, 0) / compileSecs.length) * 10) / 10 : 0;
  const medianCompileSec = compileSecs.length > 0 ? compileSecs[Math.floor(compileSecs.length / 2)]! : 0;

  // Walk all CommitFest entries with LIVE merged effective verdict
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

  let openCount = 0;
  let closedCount = 0;
  let roastedLive = 0;
  let roastedOpen = 0;
  let unroastedOpen = 0;
  let withOpinions = 0;
  let withMultiOpinion = 0;
  let rfcOpen = 0;
  let rfcWithOpinion = 0;
  let rfcClean = 0;
  let bugfixes = 0;
  let features = 0;
  let prodHits = 0;

  for (const e of entriesRows) {
    const cfId = Number(e.cf_id);
    const ops = opinionsByCf.get(cfId) || [];
    if (ops.length > 0) withOpinions++;
    if (ops.length >= 2) withMultiOpinion++;

    // Effective verdict: prefer highest-depth community opinion (dark > medium > light), else baseline entry verdict
    let effVerdict = (e.verdict || "").trim() || "UNROASTED";
    if (ops.length > 0) {
      const sortedOps = [...ops].sort(
        (a, b) =>
          (LEVEL_RANK[(b.roast_level || "light").toLowerCase()] || 0) -
            (LEVEL_RANK[(a.roast_level || "light").toLowerCase()] || 0) ||
          b.created_at.localeCompare(a.created_at),
      );
      if (sortedOps[0]?.verdict) effVerdict = sortedOps[0].verdict;
    }
    if (!VERDICT_KEYS.includes(effVerdict)) effVerdict = "UNROASTED";

    const st = (e.status || "Unknown").trim() || "Unknown";
    const stLow = st.toLowerCase();
    const closed = isClosedStatus(st);
    const isRoasted = effVerdict !== "UNROASTED";
    const isDark = darkCfSet.has(cfId);
    const isRfc = stLow.includes("ready for committer");
    const isCommitted = stLow === "committed";
    const isNeedsReview = stLow.includes("needs review");
    const isWaiting = stLow.includes("waiting on author");

    if (closed) closedCount++;
    else openCount++;

    if (isRoasted) {
      roastedLive++;
      if (!closed) roastedOpen++;
    } else if (!closed) {
      unroastedOpen++;
    }

    if (isRfc) {
      rfcOpen++;
      if (ops.length > 0) rfcWithOpinion++;
      if (effVerdict === "NO-FUNDAMENTAL-OBJECTION") rfcClean++;
    }

    verdictAll[effVerdict] = (verdictAll[effVerdict] || 0) + 1;
    if (!closed) verdictOpen[effVerdict] = (verdictOpen[effVerdict] || 0) + 1;

    // Status × Verdict Matrix
    let sm = statusMap.get(st);
    if (!sm) {
      sm = { status: st, isClosed: closed, total: 0, counts: Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0])) };
      statusMap.set(st, sm);
    }
    sm.total++;
    sm.counts[effVerdict] = (sm.counts[effVerdict] || 0) + 1;

    // Subsystem breakdown
    const sub = classifySubsystem(e.topic, e.title);
    let ss = subsysMap.get(sub);
    if (!ss) {
      ss = { topic: sub, total: 0, open: 0, roasted: 0, darkVerified: 0, clean: 0, ready: 0, likelyReject: 0 };
      subsysMap.set(sub, ss);
    }
    ss.total++;
    if (!closed) ss.open++;
    if (isRoasted) ss.roasted++;
    if (isDark) ss.darkVerified++;
    if (effVerdict === "NO-FUNDAMENTAL-OBJECTION") ss.clean++;
    if (isRfc) ss.ready++;
    if (effVerdict === "LIKELY-REJECT") ss.likelyReject++;

    // Kind & Production comparison
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

    // Unified Author cross-link to `people`
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

      // Attribute patch to the highest-ranking role among its authors for Role Distribution
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

  // Sort Status Matrix: open statuses first (Needs review, Ready for Committer, Waiting on Author), then closed
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

  // Format Opinion Velocity buckets chronologically (keep up to 24 latest active buckets)
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

  // Format Traffic Timeline chronologically
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
      roastedLive,
      roastedOpen,
      unroastedOpen,
      withOpinions,
      withDark: darkCfSet.size,
      withMultiOpinion,
      rfcOpen,
      rfcWithOpinion,
      rfcClean,
      bugfixes,
      features,
      prodHits,
      totalOpinions: opinionsRows.length,
      uniqueReviewers: uniqueReviewersSet.size,
      uniqueModels: uniqueModelsSet.size,
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
    subsystems: Array.from(subsysMap.values()).sort((a, b) => b.open - a.open || b.total - a.total),
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
      topPatches: pvSummary.topPatches.slice(0, 10).map((p) => {
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
