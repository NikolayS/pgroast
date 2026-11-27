import type { StatsOverviewData, StatsVerificationItem } from "../stats-queries.ts";
import {
  renderKindVerdictComparisonSvg,
  renderModelVerdictMixSvg,
  renderOpinionVelocitySvg,
  renderStatusVerdictMarimekkoSvg,
  renderTopicReadinessScatterSvg,
  renderTrafficTimelineSvg,
  renderVerificationPipelineSvg,
} from "./viz-charts.ts";

export type StatsRadarTab = "darkCleanRfc" | "conflicts" | "testOrBuildFails" | "sqlIssues";

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

function pct(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

function avatarColor(name: string): string {
  const palette = ["#5e6ad2", "#4cb782", "#c97842", "#2f78a8", "#8b6ce8", "#c2444e", "#2b8a82", "#b87a28"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function roleBadge(role: string): string {
  if (role === "Core Team") return `<span class="pill p-warn">Core Team</span>`;
  if (role === "Committer") return `<span class="pill p-info">Committer</span>`;
  if (role === "Major Contributor") return `<span class="pill p-ok">Major Contributor</span>`;
  if (role === "Significant Contributor") return `<span class="pill">Significant</span>`;
  if (role === "Contributor") return `<span class="tag-micro">Contributor</span>`;
  return `<span class="tag-micro dim">New</span>`;
}

function verdictPill(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return `<span class="pill p-ok">No objection</span>`;
  if (v === "NEEDS-COMMITTER-EYES") return `<span class="pill p-info">Committer eyes</span>`;
  if (v === "NEEDS-DESIGN-DISCUSSION") return `<span class="pill p-warn">Design disc.</span>`;
  if (v === "LIKELY-REJECT") return `<span class="pill p-danger">Likely reject</span>`;
  return `<span class="pill">Unroasted</span>`;
}

function verdictDot(v: string): string {
  const col =
    v === "NO-FUNDAMENTAL-OBJECTION"
      ? "#4cb782"
      : v === "NEEDS-COMMITTER-EYES"
        ? "#5e6ad2"
        : v === "NEEDS-DESIGN-DISCUSSION"
          ? "#e0a83c"
          : v === "LIKELY-REJECT"
            ? "#eb5757"
            : "#737682";
  return `<span class="dot" style="background:${col}"></span>`;
}

function renderRadarList(items: StatsVerificationItem[], emptyMsg: string): string {
  if (items.length === 0) {
    return `<div class="muted" style="font-size:12.5px;padding:10px 0;">${esc(emptyMsg)}</div>`;
  }
  return `
    <div class="stats-radar-list">
      ${items
        .map(
          (it) => `
        <button type="button" class="stats-radar-row" data-open-patch="${it.cf_id}">
          <div class="stats-radar-top">
            <span class="mono" style="font-weight:700;color:var(--accent-t);">CF ${it.cf_id}</span>
            <span class="tag-micro">${esc(it.status)}</span>
            ${verdictPill(it.verdict)}
            <span class="tag-micro mono">${esc(it.modelSpec)}</span>
          </div>
          <div class="stats-radar-title">${esc(it.title)}</div>
          <div class="dim mono" style="font-size:11px;line-height:1.4;">${esc(it.evidence)}</div>
        </button>
      `,
        )
        .join("")}
    </div>
  `;
}

export function renderStatsObservatory(params: {
  data: StatsOverviewData | null;
  loading: boolean;
  error: string;
  radarTab: StatsRadarTab;
  contributorTab: "authors" | "roasters" | "roles";
  renderDonut: (segments: Array<{ key: string; label: string; value: number; color: string }>) => string;
}): string {
  const { data, loading, error, radarTab, contributorTab, renderDonut } = params;

  if (loading && !data) {
    return `
      <div class="card">
        <div class="loading-state" style="padding:48px 0;">
          <div class="spinner"></div>
          <div class="muted">Computing live CommitFest intelligence &amp; PostgreSQL verification telemetry…</div>
        </div>
      </div>
    `;
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
  const liveCovPct = pct(t.roastedLive, t.total);
  const openCovPct = pct(t.roastedOpen, t.open);
  const applyPct = pct(v.gitApplyClean, v.gitApplyClean + v.gitApplyConflict);
  const vCount = (k: string) => data.verdicts.find((x) => x.verdict === k)?.all ?? 0;

  const donutSegments = [
    { key: "NO-FUNDAMENTAL-OBJECTION", label: "No fundamental objection", value: vCount("NO-FUNDAMENTAL-OBJECTION"), color: "#4cb782" },
    { key: "NEEDS-COMMITTER-EYES", label: "Needs committer eyes", value: vCount("NEEDS-COMMITTER-EYES"), color: "#5e6ad2" },
    { key: "NEEDS-DESIGN-DISCUSSION", label: "Needs design discussion", value: vCount("NEEDS-DESIGN-DISCUSSION"), color: "#e0a83c" },
    { key: "LIKELY-REJECT", label: "Likely reject", value: vCount("LIKELY-REJECT"), color: "#eb5757" },
    { key: "UNROASTED", label: "Not roasted", value: vCount("UNROASTED"), color: "#737682" },
  ];

  const pipeline = renderVerificationPipelineSvg(v);
  const mosaic = renderStatusVerdictMarimekkoSvg(data.statusMatrix);

  const maxMatrixCell = Math.max(
    1,
    ...data.statusMatrix.flatMap((r) => [
      r.counts["NO-FUNDAMENTAL-OBJECTION"] ?? 0,
      r.counts["NEEDS-COMMITTER-EYES"] ?? 0,
      r.counts["NEEDS-DESIGN-DISCUSSION"] ?? 0,
      r.counts["LIKELY-REJECT"] ?? 0,
    ]),
  );
  const heatStyle = (val: number, rgb: string) => {
    if (!val) return "";
    const alpha = Math.min(0.32, 0.06 + (val / maxMatrixCell) * 0.26).toFixed(2);
    return `background:rgb(${rgb} / ${alpha});font-weight:600;`;
  };

  const topics = data.subsystems.slice(0, 14);
  const maxTopicTotal = Math.max(1, ...topics.map((x) => x.open || x.total));

  const radarTabs: Array<{ id: StatsRadarTab; label: string; count: number; cls: string }> = [
    { id: "darkCleanRfc", label: "Dark-Verified RFC", count: v.radar.darkCleanRfc.length, cls: "p-ok" },
    { id: "conflicts", label: "Bitrot / Apply Conflicts", count: v.radar.conflicts.length, cls: "p-danger" },
    { id: "testOrBuildFails", label: "Build / Test Failures", count: v.radar.testOrBuildFails.length, cls: "p-danger" },
    { id: "sqlIssues", label: "Live PG SQL Edge-Cases", count: v.radar.sqlIssues.length, cls: "p-warn" },
  ];
  const activeRadarItems = v.radar[radarTab] || [];
  const radarEmptyMsg: Record<StatsRadarTab, string> = {
    darkCleanRfc: "No Ready-for-Committer patches have completed Dark build verification yet.",
    conflicts: "No git apply conflicts detected across verified patches.",
    testOrBuildFails: "No meson compile or targeted test failures recorded yet.",
    sqlIssues: "No live PostgreSQL SQL edge-case errors triggered yet.",
  };

  const maxAuthorTotal = Math.max(1, ...data.contributors.authors.map((a) => a.total));
  const maxTrafficHits = Math.max(1, ...data.traffic.topPatches.map((p) => p.hits));

  return `
    <div class="page-head">
      <div style="min-width:0;flex:1;">
        <div class="viz-kicker">CommitFest Intelligence &amp; Verification Observatory</div>
        <h1 class="page-title">CommitFest Stats &amp; Live Build Telemetry</h1>
        <div class="page-sub">
          ${esc(data.commitfestLabel)} · Live PostgreSQL aggregation across ${fmtNum(t.total)} patches &amp; ${fmtNum(t.totalOpinions)} attributed AI opinions (${fmtNum(v.darkRuns)} Dark build+SQL verified) · Click any bar, dot, cell, or hacker to drill down
        </div>
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" id="stats-refresh-btn">Refresh live</button>
        <a class="btn btn-ghost btn-sm" href="/api/v1/stats/overview" target="_blank" rel="noopener">API JSON ↗</a>
        ${data.latestBriefSlug ? `<a class="btn btn-ghost btn-sm" href="/briefs/${encodeURIComponent(data.latestBriefSlug)}/download.html">HTML</a>` : ""}
      </div>
    </div>

    <!-- LIVE HERO KPI STRIP -->
    <div class="kpis">
      <button type="button" class="kpi" data-jump-verdict="all">
        <div class="kpi-l">Open CommitFest Queue</div>
        <div class="kpi-v mono">${fmtNum(t.open)}</div>
        <div class="kpi-sub">${fmtNum(t.total)} total · ${fmtNum(t.closed)} closed</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="all">
        <div class="kpi-l"><span class="dot" style="background:var(--viz-1)"></span>Live Roast Coverage</div>
        <div class="kpi-v mono">${liveCovPct}%</div>
        <div class="kpi-sub">${fmtNum(t.roastedOpen)}/${fmtNum(t.open)} open (${openCovPct}%) · ${fmtNum(t.unroastedOpen)} unroasted</div>
      </button>
      <button type="button" class="kpi" id="stats-jump-dark-pipeline">
        <div class="kpi-l"><span class="dot" style="background:var(--viz-3)"></span>Dark Build + SQL Verified</div>
        <div class="kpi-v mono" style="color:var(--warn)">${fmtNum(t.withDark)}</div>
        <div class="kpi-sub">${applyPct}% apply clean · median ${v.medianCompileSec}s build</div>
      </button>
      <button type="button" class="kpi" data-stats-status="Ready for Committer">
        <div class="kpi-l"><span class="dot" style="background:var(--ok)"></span>Ready for Committer</div>
        <div class="kpi-v mono" style="color:var(--ok)">${fmtNum(t.rfcOpen)}</div>
        <div class="kpi-sub">${fmtNum(t.rfcWithOpinion)} with opinion · ${fmtNum(t.rfcClean)} clean</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="LIKELY-REJECT">
        <div class="kpi-l"><span class="dot" style="background:#eb5757"></span>Bug Fixes &amp; Prod Hits</div>
        <div class="kpi-v mono">${fmtNum(t.bugfixes)}</div>
        <div class="kpi-sub">${fmtNum(t.prodHits)} seen in production · ${fmtNum(t.features)} features</div>
      </button>
      <button type="button" class="kpi" id="stats-goto-opinions">
        <div class="kpi-l">Community Opinions</div>
        <div class="kpi-v mono">${fmtNum(t.totalOpinions)}</div>
        <div class="kpi-sub">${fmtNum(t.uniqueModels)} model spec${t.uniqueModels === 1 ? "" : "s"} · ${fmtNum(t.withMultiOpinion)} multi-opinion</div>
      </button>
    </div>

    <!-- ROW 1: REAL POSTGRESQL VERIFICATION & BUILD PIPELINE + LIVE RADAR -->
    <section class="card viz-card" id="stats-verification-pipeline">
      <div class="card-head">
        <div>
          <div class="viz-kicker">Real PostgreSQL 20devel Verification Pipeline (Medium &amp; Dark Roasts)</div>
          <h2 class="viz-headline">${esc(pipeline.headline)}</h2>
          <div class="dim" style="font-size:12px;margin-top:2px;">${esc(pipeline.subline)}</div>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;">
          <span class="pill p-warn mono">${fmtNum(v.darkRuns)} Dark</span>
          ${v.mediumRuns > 0 ? `<span class="pill p-info mono">${fmtNum(v.mediumRuns)} Medium</span>` : ""}
          <span class="pill mono">${fmtNum(v.lightRuns)} Light</span>
        </div>
      </div>

      ${pipeline.svg}

      <div class="stats-radar-wrap">
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <div class="chips" role="tablist" aria-label="Verification radar categories" style="margin:0;">
            ${radarTabs
              .map(
                (rt) => `
              <button type="button" class="chip ${radarTab === rt.id ? "active" : ""}" data-stats-radar="${rt.id}">
                ${esc(rt.label)} <span class="mono dim">(${rt.count})</span>
              </button>
            `,
              )
              .join("")}
          </div>
          <span class="dim" style="font-size:11.5px;">Click any patch to inspect full build &amp; SQL verification logs</span>
        </div>
        ${renderRadarList(activeRadarItems, radarEmptyMsg[radarTab])}
      </div>
    </section>

    <!-- ROW 2: LIVE MERGED COMMITFEST STATUS x AI VERDICT MARIMEKKO MOSAIC -->
    ${
      data.statusMatrix.length > 0
        ? `
      <section class="card viz-card">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Live CommitFest Status × AI Roast Verdict Mosaic</div>
            <h2 class="viz-headline">${esc(mosaic.headline)}</h2>
            <div class="dim" style="font-size:12px;margin-top:2px;">${esc(mosaic.subline)} · Merged live with Dark &amp; Light community opinions</div>
          </div>
        </div>
        ${mosaic.callouts ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px;">${mosaic.callouts}</div>` : ""}
        ${mosaic.svg}
        <details style="margin-top:12px;">
          <summary class="dim" style="font-size:12px;cursor:pointer;">Show exact live counts heatmap table (${data.statusMatrix.length} statuses)</summary>
          <div class="table-scroll" style="margin-top:8px;">
            <table class="matrix">
              <thead>
                <tr>
                  <th>CF Status</th>
                  <th class="num">Total</th>
                  <th class="num">No objection</th>
                  <th class="num">Committer eyes</th>
                  <th class="num">Design disc.</th>
                  <th class="num">Likely reject</th>
                  <th class="num">Not roasted</th>
                </tr>
              </thead>
              <tbody>
                ${data.statusMatrix
                  .map((row) => {
                    const cOk = row.counts["NO-FUNDAMENTAL-OBJECTION"] ?? 0;
                    const cEyes = row.counts["NEEDS-COMMITTER-EYES"] ?? 0;
                    const cDesign = row.counts["NEEDS-DESIGN-DISCUSSION"] ?? 0;
                    const cRej = row.counts["LIKELY-REJECT"] ?? 0;
                    const cUn = row.counts.UNROASTED ?? 0;
                    return `
                  <tr>
                    <td><strong>${esc(row.status)}</strong></td>
                    <td class="num">${row.total}</td>
                    <td class="num matrix-cell" style="${heatStyle(cOk, "76 183 130")}" data-mx-status="${esc(row.status)}" data-mx-verdict="NO-FUNDAMENTAL-OBJECTION">${cOk}</td>
                    <td class="num matrix-cell" style="${heatStyle(cEyes, "94 106 210")}" data-mx-status="${esc(row.status)}" data-mx-verdict="NEEDS-COMMITTER-EYES">${cEyes}</td>
                    <td class="num matrix-cell" style="${heatStyle(cDesign, "224 168 60")}" data-mx-status="${esc(row.status)}" data-mx-verdict="NEEDS-DESIGN-DISCUSSION">${cDesign}</td>
                    <td class="num matrix-cell" style="${heatStyle(cRej, "235 87 87")}" data-mx-status="${esc(row.status)}" data-mx-verdict="LIKELY-REJECT">${cRej}</td>
                    <td class="num dim matrix-cell" data-mx-status="${esc(row.status)}" data-mx-verdict="UNROASTED">${cUn}</td>
                  </tr>
                `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    `
        : ""
    }

    <!-- ROW 3: MODEL CALIBRATION & VERDICT MIX + OPINION PUBLISHING VELOCITY -->
    <div class="grid2" style="margin-bottom:14px;">
      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Model Attribution &amp; Calibration</div>
            <h2>Verdict Mix by <code class="mono">provider/model:effort</code></h2>
            <div class="dim" style="font-size:12px;">Hover any segment for exact verdict counts and Light/Medium/Dark mix</div>
          </div>
        </div>
        ${renderModelVerdictMixSvg(v.byModel)}
      </section>

      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Community Roasting Throughput</div>
            <h2>Published Opinions Over Time by Depth</h2>
            <div class="dim" style="font-size:12px;">Dark (code + compile + live PG SQL) vs Light (thread + precedents)</div>
          </div>
        </div>
        ${renderOpinionVelocitySvg(data.opinionVelocity)}
      </section>
    </div>

    <!-- ROW 4: SUBSYSTEM COMMITTER ATTENTION QUADRANT + BUGFIX vs FEATURE BREAKDOWN -->
    <div class="grid2" style="margin-bottom:14px;">
      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Subsystem Committer Attention Quadrant</div>
            <h2>Open Volume vs Ready-for-Committer %</h2>
            <div class="dim" style="font-size:12px;">Live subsystem classification across all ${fmtNum(t.total)} entries · click to filter</div>
          </div>
        </div>
        ${renderTopicReadinessScatterSvg(topics)}
        <details style="margin-top:10px;">
          <summary class="dim" style="font-size:12px;cursor:pointer;">Show all ${topics.length} subsystem bars (${topics.reduce((a, x) => a + x.darkVerified, 0)} Dark verified)</summary>
          <div class="subsys-list" style="margin-top:8px;">
            ${topics
              .map((tp) => {
                const tTotal = Math.max(1, tp.open || tp.total);
                const wAll = Math.max(6, Math.round((tTotal / maxTopicTotal) * 100));
                const cleanPct = Math.round(((tp.clean || 0) / tTotal) * 100);
                const readyPct = Math.round(((tp.ready || 0) / tTotal) * 100);
                return `
              <button type="button" class="subsys-row" data-stats-topic="${esc(tp.topic)}">
                <div class="subsys-head">
                  <span class="hbar-label">${esc(tp.topic)}</span>
                  <span class="mono dim">${tp.open} open${tp.darkVerified ? ` · <span style="color:var(--warn)">${tp.darkVerified} dark</span>` : ""}${tp.clean ? ` · <span style="color:var(--ok)">${tp.clean} clean</span>` : ""}${tp.ready ? ` · <span style="color:var(--accent-t)">${tp.ready} RFC</span>` : ""}</span>
                </div>
                <div class="subsys-bar" style="width:${wAll}%;">
                  ${cleanPct > 0 ? `<div style="width:${cleanPct}%;background:var(--ok);"></div>` : ""}
                  ${readyPct > 0 ? `<div style="width:${readyPct}%;background:var(--accent);"></div>` : ""}
                  <div style="flex:1;background:rgb(94 106 210 / 0.32);"></div>
                </div>
              </button>
            `;
              })
              .join("")}
          </div>
        </details>
      </section>

      <section class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Patch Kind &amp; Verdict Signal</div>
            <h2>Bug Fixes vs Features &amp; Live Verdict Mix</h2>
            <div class="dim" style="font-size:12px;">Status progression by patch class plus overall live verdict distribution</div>
          </div>
        </div>
        ${renderKindVerdictComparisonSvg(data.kindComparison)}
        <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">
          <div class="donut-row">
            ${renderDonut(donutSegments)}
            <div class="legend">
              ${donutSegments
                .map((s) => {
                  const p = pct(s.value, t.total);
                  return `
                <button type="button" class="legend-btn" data-jump-verdict="${s.key}">
                  <span class="legend-left"><span class="dot" style="background:${s.color}"></span><span>${esc(s.label)}</span></span>
                  <span class="mono"><strong>${s.value}</strong> <span class="dim">(${p}%)</span></span>
                </button>
              `;
                })
                .join("")}
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ROW 5: UNIFIED COMMITFEST CONTRIBUTORS (LINKED TO /hacker/<slug>!) -->
    <section class="card viz-card">
      <div class="card-head">
        <div>
          <div class="viz-kicker">CommitFest × PostgreSQL Hacker Directory</div>
          <h2>Active CommitFest Authors, Quota Contributors &amp; Role Split</h2>
          <div class="dim" style="font-size:12px;">Cross-linked to unified multi-email <code class="mono">/hacker/&lt;slug&gt;</code> profiles · click any linked hacker to open their profile</div>
        </div>
        <div class="chips" role="tablist" aria-label="CommitFest contributor views" style="margin:0;">
          <button type="button" class="chip ${contributorTab === "authors" ? "active" : ""}" data-stats-contrib-tab="authors">Top Patch Authors (${data.contributors.authors.length})</button>
          <button type="button" class="chip ${contributorTab === "roasters" ? "active" : ""}" data-stats-contrib-tab="roasters">AI Quota Roasters (${data.contributors.roasters.length})</button>
          <button type="button" class="chip ${contributorTab === "roles" ? "active" : ""}" data-stats-contrib-tab="roles">By PG Role (${data.contributors.roleDistribution.length})</button>
        </div>
      </div>

      ${
        contributorTab === "authors"
          ? `
        <div class="stats-author-grid">
          ${data.contributors.authors
            .map((a, idx) => {
              const barW = Math.max(12, Math.round((a.total / maxAuthorTotal) * 100));
              const cPct = pct(a.committed, a.total);
              const rPct = pct(a.ready, a.total);
              const nPct = pct(a.needsReview, a.total);
              const wPct = pct(a.waiting, a.total);
              const clickAttr = a.slug
                ? `data-open-hacker="${esc(a.slug)}"`
                : `data-stats-person="${esc(a.name)}"`;
              return `
            <button type="button" class="stats-author-row" ${clickAttr}>
              <div class="stats-author-top">
                <span class="lb-rank mono">${idx + 1}</span>
                <span class="obs-avatar-sm" style="background:${avatarColor(a.name)}">${esc(personInitials(a.name))}</span>
                <span class="stats-author-name">${esc(a.name)}</span>
                ${roleBadge(a.role)}
                <span class="lb-count mono">${a.total}</span>
              </div>
              <div class="stats-author-bar-wrap">
                <div class="subsys-bar" style="width:${barW}%;height:7px;">
                  ${cPct > 0 ? `<div style="width:${cPct}%;background:var(--viz-2);" title="Committed: ${a.committed}"></div>` : ""}
                  ${rPct > 0 ? `<div style="width:${rPct}%;background:var(--viz-1);" title="Ready for Committer: ${a.ready}"></div>` : ""}
                  ${nPct > 0 ? `<div style="width:${nPct}%;background:var(--viz-3);" title="Needs review: ${a.needsReview}"></div>` : ""}
                  ${wPct > 0 ? `<div style="width:${wPct}%;background:var(--viz-4);" title="Waiting on Author: ${a.waiting}"></div>` : ""}
                  <div style="flex:1;background:var(--border-s);"></div>
                </div>
                <span class="dim mono" style="font-size:10.5px;white-space:nowrap;">
                  ${a.committed ? `${a.committed} committed` : ""}${a.committed && a.ready ? " · " : ""}${a.ready ? `${a.ready} RFC` : ""}${!a.committed && !a.ready ? `${a.needsReview} review` : ""}${a.darkVerified ? ` · ${a.darkVerified} dark` : ""}
                </span>
              </div>
            </button>
          `;
            })
            .join("")}
        </div>
        <div class="obs-chart-legend" style="margin-top:10px;">
          <span><span class="dot" style="background:var(--viz-2)"></span>Committed</span>
          <span><span class="dot" style="background:var(--viz-1)"></span>Ready for Committer</span>
          <span><span class="dot" style="background:var(--viz-3)"></span>Needs review</span>
          <span><span class="dot" style="background:var(--viz-4)"></span>Waiting on Author</span>
        </div>
      `
          : contributorTab === "roasters"
            ? `
        <div class="lb-list">
          ${
            data.contributors.roasters.length === 0
              ? `<div class="muted" style="font-size:12.5px;">No community AI opinions published yet.</div>`
              : data.contributors.roasters
                  .map(
                    (r, i) => `
              <div class="lb-row" style="cursor:default;flex-wrap:wrap;gap:8px;">
                <span class="lb-rank mono">${i + 1}</span>
                <span class="obs-avatar-sm" style="background:${avatarColor(r.name)}">${esc(personInitials(r.name))}</span>
                <span class="lb-name"><strong>${esc(r.name)}</strong> <span class="dim mono">@${esc(r.handle)}</span></span>
                <div class="row" style="gap:5px;flex-wrap:wrap;">
                  ${r.dark ? `<span class="pill p-warn mono">${r.dark} Dark</span>` : ""}
                  ${r.medium ? `<span class="pill p-info mono">${r.medium} Med</span>` : ""}
                  ${r.light ? `<span class="pill mono">${r.light} Light</span>` : ""}
                  ${r.models.slice(0, 2).map((m) => `<span class="tag-micro mono">${esc(m)}</span>`).join("")}
                </div>
                <span class="lb-count mono">${r.total}</span>
              </div>
            `,
                  )
                  .join("")
          }
        </div>
      `
            : `
        <div class="subsys-list">
          ${(() => {
            const maxRoleN = Math.max(1, ...data.contributors.roleDistribution.map((r) => r.patches));
            return data.contributors.roleDistribution
              .map((r) => {
                const wAll = Math.max(8, Math.round((r.patches / maxRoleN) * 100));
                const commPct = pct(r.committed, r.patches);
                return `
                <div class="subsys-row" style="cursor:default;">
                  <div class="subsys-head">
                    <span class="row" style="gap:6px;">${roleBadge(r.role)} <strong>${esc(r.role)}</strong></span>
                    <span class="mono dim">${fmtNum(r.patches)} patches · ${fmtNum(r.open)} open · <span style="color:var(--ok)">${fmtNum(r.committed)} committed (${commPct}%)</span></span>
                  </div>
                  <div class="subsys-bar" style="width:${wAll}%;">
                    ${commPct > 0 ? `<div style="width:${commPct}%;background:var(--viz-2);"></div>` : ""}
                    <div style="flex:1;background:var(--viz-1);opacity:0.55;"></div>
                  </div>
                </div>
              `;
              })
              .join("");
          })()}
        </div>
      `
      }
    </section>

    <!-- ROW 6: SITE TRAFFIC & COMMUNITY INTEREST -->
    <section class="card viz-card" id="site-traffic">
      <div class="card-head">
        <div>
          <div class="viz-kicker">Zero-Cookie PostgreSQL Telemetry</div>
          <h2>Site Traffic &amp; Patch Interest</h2>
          <div class="dim" style="font-size:12px;">Privacy-friendly hit counter stored in PostgreSQL — zero cookies, zero IPs, bots excluded.</div>
        </div>
        <span class="pill p-info mono">${fmtNum(data.traffic.total)} total · ${fmtNum(data.traffic.last24h)} (24h) · ${fmtNum(data.traffic.last7d)} (7d)</span>
      </div>

      <div style="margin-bottom:14px;">
        ${renderTrafficTimelineSvg(data.traffic.timeline)}
      </div>

      <div class="grid2">
        <div>
          <div class="sheet-section-label" style="margin-bottom:8px;">Most Viewed Patches</div>
          ${
            data.traffic.topPatches.length === 0
              ? `<div class="muted" style="font-size:12.5px;">No individual patch views recorded yet.</div>`
              : `<div class="lb-list">
                  ${data.traffic.topPatches
                    .map((p, idx) => {
                      const barPct = Math.max(8, Math.round((p.hits / maxTrafficHits) * 100));
                      return `
                    <button type="button" class="lb-row" data-open-patch="${p.cf_id}" style="position:relative;overflow:hidden;">
                      <span class="lb-rank mono">${idx + 1}</span>
                      ${verdictDot(p.verdict)}
                      <span class="mono" style="color:var(--accent-t);font-size:11.5px;min-width:52px;">CF ${p.cf_id}</span>
                      <span class="lb-name">${esc(p.title)}</span>
                      ${p.hasDark ? `<span class="pill p-warn" style="font-size:10px;padding:1px 6px;">Dark</span>` : ""}
                      <span class="lb-count mono">${p.hits}</span>
                      <span style="position:absolute;left:0;bottom:0;height:2px;width:${barPct}%;background:var(--viz-1);opacity:0.45;pointer-events:none;"></span>
                    </button>
                  `;
                    })
                    .join("")}
                </div>`
          }
        </div>
        <div>
          <div class="sheet-section-label" style="margin-bottom:8px;">Top Referrers</div>
          ${
            data.traffic.topReferrers.length === 0
              ? `<div class="muted" style="font-size:12.5px;">Direct visits so far — external referrer hosts appear here automatically when links are shared on pgsql-hackers, GitHub, or social.</div>`
              : `<div class="lb-list">
                  ${data.traffic.topReferrers
                    .map(
                      (r, idx) => `
                    <div class="lb-row" style="cursor:default;">
                      <span class="lb-rank mono">${idx + 1}</span>
                      <span class="lb-name mono">${esc(r.ref_host)}</span>
                      <span class="lb-count mono">${r.hits}</span>
                    </div>
                  `,
                    )
                    .join("")}
                </div>`
          }
        </div>
      </div>
    </section>
  `;
}
