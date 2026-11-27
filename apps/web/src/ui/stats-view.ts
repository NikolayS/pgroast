import type { DarkMatrixRow, StatsOverviewData, TriageTableRow } from "../stats-queries.ts";
import { renderStatsSkeleton } from "./skeletons.ts";
import {
  renderAuthorBeeswarmSvg,
  renderLoadVsCapacitySvg,
  renderQueueUnitChartSvg,
} from "./viz-charts.ts";

export type StatsQueueFilter = "all" | "dark" | "warnings" | "clean";
export type StatsDarkFilter = "all" | "issues" | "clean";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n: number): string {
  return Number(n || 0).toLocaleString("en-US");
}

function pctWithN(part: number, total: number): string {
  if (!total || total <= 0) return `0/0`;
  return `${Math.round((part / total) * 100)}% (${fmtNum(part)}/${fmtNum(total)})`;
}

function verdictPill(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return `<span class="pill p-ok">No objection</span>`;
  if (v === "NEEDS-COMMITTER-EYES") return `<span class="pill p-info">Committer eyes</span>`;
  if (v === "NEEDS-DESIGN-DISCUSSION") return `<span class="pill p-warn">Design disc.</span>`;
  if (v === "LIKELY-REJECT") return `<span class="pill p-danger">Likely reject</span>`;
  return `<span class="pill">Unroasted</span>`;
}

function verdictLabel(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return "No objection";
  if (v === "NEEDS-COMMITTER-EYES") return "Committer eyes";
  if (v === "NEEDS-DESIGN-DISCUSSION") return "Design discussion";
  if (v === "LIKELY-REJECT") return "Likely reject";
  return "Unroasted";
}

function renderTriageRows(rows: TriageTableRow[], emptyMsg: string): string {
  if (rows.length === 0) {
    return `<div class="muted" style="font-size:12.5px;padding:12px 0;">${esc(emptyMsg)}</div>`;
  }
  return `
    <div class="st-triage-list">
      ${rows
        .map((r) => {
          const reasonCls =
            r.reasonTag === "Likely reject" || r.reasonTag.includes("conflict") || r.reasonTag.includes("failed")
              ? "p-danger"
              : r.reasonTag === "Dark verified"
                ? "p-ok"
                : r.reasonTag === "Design debate"
                  ? "p-warn"
                  : "p-info";
          const commitsBadge =
            r.authorPriorCommits == null
              ? "new"
              : r.authorPriorCommits === 0
                ? "0 commits"
                : `${fmtNum(r.authorPriorCommits)} commits`;
          return `
        <button type="button" class="st-triage-row" data-open-patch="${r.cf_id}">
          <div class="st-triage-top">
            <span class="mono" style="font-weight:700;color:var(--accent-t);">CF ${r.cf_id}</span>
            <span class="pill ${reasonCls}" style="font-size:10.5px;padding:1px 7px;">${esc(r.reasonTag)}</span>
            ${verdictPill(r.verdict)}
            <span class="tag-micro">${esc(r.subsystem)}</span>
          </div>
          <div class="st-triage-title">${esc(r.title)}</div>
          <div class="st-triage-meta">
            <span>${esc(r.author)} <span class="dim mono">(${commitsBadge})</span></span>
            ${r.evidenceShort ? `<span class="mono dim">${esc(r.evidenceShort)}</span>` : ""}
            ${r.failingSummary ? `<span style="color:var(--warn);">${esc(r.failingSummary)}</span>` : ""}
          </div>
        </button>
      `;
        })
        .join("")}
    </div>
  `;
}

function matrixCell(status: "ok" | "warn" | "fail" | "skip", label: string): string {
  const cls =
    status === "ok"
      ? "dm-ok"
      : status === "warn"
        ? "dm-warn"
        : status === "fail"
          ? "dm-fail"
          : "dm-skip";
  return `<span class="dm-cell mono ${cls}">${esc(label)}</span>`;
}

function renderDarkEvidenceTable(rows: DarkMatrixRow[], filter: StatsDarkFilter): string {
  const shown =
    filter === "issues"
      ? rows.filter((r) => r.breakRank < 5)
      : filter === "clean"
        ? rows.filter((r) => r.breakRank === 5)
        : rows;

  if (shown.length === 0) {
    return `<div class="muted" style="font-size:12.5px;padding:12px 0;">No Dark-verified patches match this filter.</div>`;
  }

  return `
    <div class="table-scroll">
      <table class="dm-table" id="stats-dark-matrix-table">
        <thead>
          <tr>
            <th>Patch</th>
            <th class="num">Files</th>
            <th>Apply</th>
            <th>Compile</th>
            <th>Tests</th>
            <th>Live PG SQL</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          ${shown
            .map((r) => {
              const applyCell =
                r.apply === "clean"
                  ? matrixCell("ok", "✓ clean")
                  : r.apply === "conflict"
                    ? matrixCell("fail", "✗ conflict")
                    : matrixCell("skip", "—");
              const compCell =
                r.compile === "pass"
                  ? matrixCell("ok", `✓ ${r.compileSec ?? "?"}s`)
                  : r.compile === "fail"
                    ? matrixCell("fail", "✗ fail")
                    : matrixCell("skip", "—");
              const testCell =
                r.tests === "pass"
                  ? matrixCell("ok", `✓ ${r.testsLabel}`)
                  : r.tests === "fail"
                    ? matrixCell("fail", `✗ ${r.testsLabel}`)
                    : matrixCell("skip", "—");
              const sqlCell =
                r.sql === "pass"
                  ? matrixCell("ok", `✓ ${r.sqlCases} ok`)
                  : r.sql === "issue"
                    ? matrixCell("warn", `⚠ ${r.sqlCases} cases`)
                    : r.sql === "crash"
                      ? matrixCell("fail", "✗ CRASH")
                      : matrixCell("skip", "—");
              return `
            <tr class="dm-row" data-open-patch="${r.cf_id}" tabindex="0">
              <td>
                <div class="dm-patch-cell">
                  <span class="mono" style="font-weight:700;color:var(--accent-t);">CF ${r.cf_id}</span>
                  <span class="dm-patch-title">${esc(r.title)}</span>
                </div>
                <div class="dim" style="font-size:11px;">${esc(r.author)} · ${esc(r.status)}</div>
              </td>
              <td class="num mono dim">${r.filesRead || "—"}</td>
              <td>${applyCell}</td>
              <td>${compCell}</td>
              <td>${testCell}</td>
              <td>${sqlCell}</td>
              <td>${verdictPill(r.verdict)}</td>
            </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderStatsObservatory(params: {
  data: StatsOverviewData | null;
  loading: boolean;
  error: string;
  queueFilter: StatsQueueFilter;
  darkFilter: StatsDarkFilter;
}): string {
  const { data, loading, error, queueFilter, darkFilter } = params;

  if (loading && !data) {
    return renderStatsSkeleton();
  }
  if (error && !data) {
    return `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">Could not load live CommitFest stats</div>
          <div class="muted" style="margin-bottom:10px;">${esc(error)}</div>
          <button type="button" class="btn btn-primary btn-sm" id="stats-refresh-btn">Retry</button>
        </div>
      </div>
    `;
  }
  if (!data) {
    return `<div class="card"><div class="empty-state">No CommitFest data indexed yet.</div></div>`;
  }

  const t = data.totals;
  const v = data.verification;
  const cb = t.closedBreakdown;
  const warnings = data.statusVsEvidence.committerWarnings;
  const pickups = data.statusVsEvidence.cleanPickups;
  const bs = data.authorBeeswarm;
  const topBottle = data.loadVsCapacity[0];

  const darkIssuesCnt = data.darkMatrix.filter((r) => r.breakRank < 5).length;
  const darkCleanCnt = data.darkMatrix.filter((r) => r.breakRank === 5).length;

  return `
    <div class="page-head">
      <div class="page-head-main">
        <div class="viz-kicker">CommitFest Intelligence Observatory</div>
        <h1 class="page-title">${esc(data.commitfestLabel)} — Queue, Proof &amp; Bottlenecks</h1>
        <div class="page-sub">
          ${fmtNum(t.total)} patches (${fmtNum(t.open)} open · ${fmtNum(t.closed)} closed: ${cb.committed} committed, ${cb.moved} moved, ${cb.withdrawn} withdrawn, ${cb.rejected + cb.returned} rejected/returned) ·
          Open roast coverage: <strong>${pctWithN(t.roastedOpen, t.open)}</strong> ·
          <strong>${fmtNum(t.withDark)}</strong> unique Dark-verified patches (${fmtNum(v.darkRuns)} runs)
        </div>
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost btn-sm" data-open-about="#roast-levels">What is a roast?</button>
        <button type="button" class="btn btn-secondary btn-sm" id="stats-refresh-btn">Refresh live</button>
        <a class="btn btn-ghost btn-sm" href="/api/v1/stats/overview" target="_blank" rel="noopener">API JSON ↗</a>
        ${data.latestBriefSlug ? `<a class="btn btn-ghost btn-sm" href="/briefs/${encodeURIComponent(data.latestBriefSlug)}/download.html">HTML</a>` : ""}
      </div>
    </div>

    <!-- 1. HERO UNIT CHART: THE QUEUE (ALL 736 PATCHES, 1 SQUARE = 1 PATCH) -->
    <section class="card viz-card" id="stats-queue-hero">
      <div class="card-head">
        <div>
          <div class="viz-kicker">1. The Queue — Every Patch as One Clickable Square</div>
          <h2 class="viz-headline">
            ${fmtNum(t.open)} open patches (${fmtNum(t.needsReviewOpen)} Needs review · ${fmtNum(t.waitingOpen)} Waiting · ${fmtNum(t.rfcOpen)} Ready for Committer)
          </h2>
          <div class="dim" style="font-size:12px;margin-top:2px;">
            Sorted by priority score top-to-bottom within each column · Color = effective AI verdict (Dark &gt; Light &gt; Baseline) · Bordered dot = Dark build+SQL verified · Hover or click any square
          </div>
        </div>
        <div class="chips" role="tablist" aria-label="Highlight patches in queue" style="margin:0;">
          <button type="button" class="chip ${queueFilter === "all" ? "active" : ""}" data-stats-qfilter="all">All (${fmtNum(t.total)})</button>
          <button type="button" class="chip ${queueFilter === "dark" ? "active" : ""}" data-stats-qfilter="dark">Dark-verified (${fmtNum(t.withDark)})</button>
          <button type="button" class="chip ${queueFilter === "warnings" ? "active" : ""}" data-stats-qfilter="warnings">RFC warnings (${warnings.length})</button>
          <button type="button" class="chip ${queueFilter === "clean" ? "active" : ""}" data-stats-qfilter="clean">Clean pickups (${pickups.length})</button>
        </div>
      </div>
      ${renderQueueUnitChartSvg(data.queueUnits, queueFilter)}
    </section>

    <!-- 2. STATUS VS. EVIDENCE: TWO ACTIONABLE RANKED TABLES -->
    <div class="grid2" style="margin-bottom:14px;">
      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">2A. Committer Warnings</div>
            <h2>Ready for Committer with Flags (${warnings.length})</h2>
            <div class="dim" style="font-size:12px;">Marked RFC on CommitFest, yet AI flagged Likely Reject, Design Debate, or a Dark apply/test failure</div>
          </div>
        </div>
        ${renderTriageRows(warnings.slice(0, 8), "No Ready-for-Committer disagreements right now.")}
      </section>

      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">2B. Cheapest Clean Pickups</div>
            <h2>Needs Review Roasted Clean (${pickups.length})</h2>
            <div class="dim" style="font-size:12px;">No fundamental objection survived counter-check — sorted by Dark verification &amp; priority score</div>
          </div>
        </div>
        ${renderTriageRows(pickups.slice(0, 8), "No clean Needs-review candidates right now.")}
      </section>
    </div>

    <!-- 3. DARK EVIDENCE MATRIX: 1 ROW PER UNIQUE DARK-VERIFIED PATCH -->
    <section class="card viz-card" id="stats-verification-pipeline">
      <div class="card-head">
        <div>
          <div class="viz-kicker">3. Real PostgreSQL 20devel Dark Evidence Matrix</div>
          <h2 class="viz-headline">
            ${fmtNum(v.gitApplyClean)}/${fmtNum(v.codeRead)} applied to master · ${fmtNum(v.compilePass)}/${fmtNum(v.compilePass + v.compileFail)} compiled (-Dcassert, median ${v.medianCompileSec}s) · ${fmtNum(v.testPass)}/${fmtNum(v.testPass + v.testFail)} passed meson test · ${fmtNum(v.totalSqlCases)} live SQL cases
          </h2>
          <div class="dim" style="font-size:12px;margin-top:2px;">
            1 row per unique verified patch (n=${data.darkMatrix.length}), sorted by the step where it falls off · Click any row to read the full build log and SQL findings
          </div>
        </div>
        <div class="chips" role="tablist" aria-label="Filter Dark evidence matrix" style="margin:0;">
          <button type="button" class="chip ${darkFilter === "all" ? "active" : ""}" data-stats-dfilter="all">All (${data.darkMatrix.length})</button>
          <button type="button" class="chip ${darkFilter === "issues" ? "active" : ""}" data-stats-dfilter="issues">Breaks / SQL warnings (${darkIssuesCnt})</button>
          <button type="button" class="chip ${darkFilter === "clean" ? "active" : ""}" data-stats-dfilter="clean">All clean (${darkCleanCnt})</button>
        </div>
      </div>
      ${renderDarkEvidenceTable(data.darkMatrix, darkFilter)}
    </section>

    <!-- 4. REVIEW LOAD VS. COMMITTER CAPACITY + 5. AUTHOR TRACK RECORD BEESWARM -->
    <section class="card viz-card">
      <div class="card-head">
        <div>
          <div class="viz-kicker">4. Structural Bottlenecks — CommitFest Queue × PostgreSQL Git Capacity</div>
          <h2 class="viz-headline">
            ${
              topBottle && topBottle.openPerCommitter != null
                ? `${topBottle.subsystem} has the highest load: ${topBottle.openTotal} open patches ÷ ${topBottle.committers12m} active committers (${topBottle.openPerCommitter.toFixed(1)}×)`
                : "Open CommitFest review load compared against 12-month active committers per subsystem"
            }
          </h2>
          <div class="dim" style="font-size:12px;margin-top:2px;">
            Both CommitFest entries and the last 12 months of <code class="mono">pg_commits</code> mapped to the same 14 canonical subsystems · Sorted by open patches per active committer · Click any row to filter Entries
          </div>
        </div>
      </div>
      ${renderLoadVsCapacitySvg(data.loadVsCapacity)}
    </section>

    <section class="card viz-card">
      <div class="card-head">
        <div>
          <div class="viz-kicker">5. Author Track Record vs. Queue Status (Beeswarm)</div>
          <h2 class="viz-headline">
            ${fmtNum(bs.firstTimerCount)} open patches from first-time authors — ${fmtNum(bs.firstTimerStuckInReview)} in Needs review, ${fmtNum(bs.firstTimerClean)} roasted clean
          </h2>
          <div class="dim" style="font-size:12px;margin-top:2px;">
            1 dot per open patch (n=${bs.dots.length}; ${fmtNum(bs.matchedCount)} matched to unified <code class="mono">people</code> git history, ${fmtNum(bs.unmatchedCount)} unmatched at 0) · Click any dot to open patch
          </div>
        </div>
      </div>
      ${renderAuthorBeeswarmSvg(bs.dots)}
    </section>

    <!-- 6. PRODUCTION-REPORTED PATCHES (EXACT TABLE) + ROAST CALIBRATION (COUNTS ONLY) -->
    <div class="grid2" style="margin-bottom:14px;">
      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">6A. Production-Hit Patches (n=${data.productionHits.length})</div>
            <h2>
              ${
                data.productionHits.length > 0 && data.productionHits.every((p) => p.status.toLowerCase().includes("needs review"))
                  ? `All ${data.productionHits.length} production-reported patches are still in Needs review`
                  : `${data.productionHits.length} patches linked to real production reports`
              }
            </h2>
            <div class="dim" style="font-size:12px;">Zero percentages on small n — every production-hit patch listed directly for triage</div>
          </div>
        </div>
        ${
          data.productionHits.length === 0
            ? `<div class="muted" style="font-size:12.5px;">No patches flagged as seen in production.</div>`
            : `
          <div class="table-scroll">
            <table class="dm-table" data-stats-prod-table>
              <thead>
                <tr>
                  <th>Patch</th>
                  <th>Status</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                ${data.productionHits
                  .map(
                    (p) => `
                  <tr class="dm-row" data-open-patch="${p.cf_id}" tabindex="0">
                    <td>
                      <div class="dm-patch-cell">
                        <span class="mono" style="font-weight:700;color:var(--accent-t);">CF ${p.cf_id}</span>
                        <span class="dm-patch-title">${esc(p.title)}</span>
                      </div>
                      <div class="dim" style="font-size:11px;">${esc(p.author)}${p.workaround ? ` · Workaround: ${esc(p.workaround)}` : ""}</div>
                    </td>
                    <td><span class="tag-micro">${esc(p.status)}</span></td>
                    <td>${verdictPill(p.verdict)}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        }
      </section>

      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">6B. Calibration, Attention &amp; Provenance</div>
            <h2>
              ${
                data.calibration.totalClosedWithVerdict > 0
                  ? `AI Verdict vs. Final CommitFest Outcome (n=${data.calibration.totalClosedWithVerdict})`
                  : "Outcome Calibration Starts on Next CommitFest Closes"
              }
            </h2>
            <div class="dim" style="font-size:12px;">
              ${
                data.calibration.totalClosedWithVerdict > 0
                  ? `Counts only (no percentages below n=30 per cell) · ${data.calibration.totalClosedWithVerdict} closed with pre-close verdict · ${data.calibration.totalClosedWithoutVerdict} closed before roasting began`
                  : `All ${fmtNum(data.calibration.totalClosedWithoutVerdict)} currently closed patches finished before roasting began · ${fmtNum(t.roastedOpen)} open roasted patches are now tracked for final commit/reject accuracy`
              }
            </div>
          </div>
        </div>
        ${
          data.calibration.totalClosedWithVerdict > 0
            ? `
          <div class="table-scroll" style="margin-bottom:14px;">
            <table class="dm-table">
              <thead>
                <tr>
                  <th>AI Verdict</th>
                  <th class="num">Committed</th>
                  <th class="num">Moved</th>
                  <th class="num">Withdrawn</th>
                  <th class="num">Rejected</th>
                  <th class="num">Total closed</th>
                </tr>
              </thead>
              <tbody>
                ${data.calibration.rows
                  .map(
                    (r) => `
                  <tr>
                    <td>${verdictPill(r.verdict)}</td>
                    <td class="num mono">${r.committed}</td>
                    <td class="num mono">${r.moved}</td>
                    <td class="num mono">${r.withdrawn}</td>
                    <td class="num mono">${r.rejected}</td>
                    <td class="num mono dim">${r.totalClosed}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
            : `
          <div style="border:1px dashed var(--border-s);border-radius:var(--r-sm);padding:10px 12px;margin-bottom:14px;background:var(--hover);font-size:12.5px;color:var(--muted);line-height:1.5;">
            We hide the calibration matrix while closed pre-roast n=0 (no empty zero-tables or tiny-sample percentages). As soon as roasted open patches are committed, moved, withdrawn, or rejected, counts appear here automatically.
          </div>
        `
        }

        <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:14px;" id="site-traffic">
          <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
            <strong style="font-size:12.5px;">Most Viewed Patches</strong>
            <span class="dim mono" style="font-size:11px;">${fmtNum(data.traffic.total)} views total · ${fmtNum(data.traffic.last24h)} (24h) · zero cookies</span>
          </div>
          ${
            data.traffic.topPatches.length === 0
              ? `<div class="muted" style="font-size:12px;">No patch views recorded yet.</div>`
              : `<div class="lb-list">
                  ${data.traffic.topPatches
                    .slice(0, 5)
                    .map(
                      (p, i) => `
                    <button type="button" class="lb-row" data-open-patch="${p.cf_id}">
                      <span class="lb-rank mono">${i + 1}</span>
                      <span class="mono" style="color:var(--accent-t);font-size:11.5px;min-width:50px;">CF ${p.cf_id}</span>
                      <span class="lb-name">${esc(p.title)}</span>
                      <span class="lb-count mono">${p.hits}</span>
                    </button>
                  `,
                    )
                    .join("")}
                </div>`
          }
        </div>

        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
            <strong style="font-size:12.5px;">Opinion Provenance (Model × Roast Depth)</strong>
            <span class="dim mono" style="font-size:11px;">${fmtNum(t.totalOpinions)} attributed opinions</span>
          </div>
          ${
            v.byModel.length === 0
              ? `<div class="muted" style="font-size:12px;">No attributed community opinions yet.</div>`
              : `
            <div class="table-scroll">
              <table class="dm-table">
                <thead>
                  <tr>
                    <th>Model / Spec</th>
                    <th class="num">Dark</th>
                    <th class="num">Medium</th>
                    <th class="num">Light</th>
                    <th class="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${v.byModel
                    .map(
                      (m) => `
                    <tr>
                      <td class="mono" style="font-size:11.5px;">${esc(m.spec)}</td>
                      <td class="num mono">${m.dark}</td>
                      <td class="num mono">${m.medium}</td>
                      <td class="num mono">${m.light}</td>
                      <td class="num mono" style="font-weight:700;">${m.total}</td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          }
        </div>
      </section>
    </div>
  `;
}
