import { renderHackerProfileSkeleton, renderHackersSkeleton } from "./skeletons.ts";
import {
  renderBusFactorQuadrantSvg,
  renderCollabConstellationSvg,
  renderCommitterConcentrationSvg,
  renderRadialUtcClockSvg,
  renderReleaseCycleRaceSvg,
  renderSponsorshipTimelineSvg,
  type ConcentrationYearPoint,
  type ReleaseCycleSeries,
  type SubsystemBusFactorItem,
} from "./viz-charts.ts";

export type HackerWindow = "30d" | "90d" | "1y" | "5y" | "PG20" | "PG19" | "PG18" | "PG17" | "all";
export type HackerLbKind = "committers" | "authors" | "reviewers" | "reporters" | "rising";
export type HackerProfileTab = "commits" | "reviews" | "commitfest" | "lists" | "opinions";

export interface HackersOverviewData {
  synced: boolean;
  window: HackerWindow;
  syncMeta: {
    lastSyncedAt?: string;
    lastCommitAt?: string;
    totalCommitsAll?: number;
    totalPeople?: number;
    totalIdentities?: number;
    multiEmailPeople?: number;
  };
  totals: {
    commits: number;
    activeHackers: number;
    authors: number;
    committers: number;
    reviewers: number;
    reporters: number;
    reviewsGiven: number;
    bugsReported: number;
    committedForOthers: number;
    committedForOthersPct: number;
    reverts: number;
    backpatches: number;
    newHackers: number;
    linesAdded: number;
    linesDeleted: number;
  } | null;
  timeline: Array<{ period: string; commits: number; forOthers?: number; reviews: number; activeHackers: number }>;
  releaseCycles?: ReleaseCycleSeries[];
  concentrationByYear?: ConcentrationYearPoint[];
  rhythmHeatmap: number[][];
  subsystems: SubsystemBusFactorItem[];
  leaderboards: {
    committers: Array<{ slug: string; name: string; role: string; emailCount: number; total: number; forOthers: number; own: number }>;
    authors: Array<{ slug: string; name: string; role: string; emailCount: number; count: number }>;
    reviewers: Array<{ slug: string; name: string; role: string; emailCount: number; count: number }>;
    reporters: Array<{ slug: string; name: string; role: string; emailCount: number; count: number }>;
    rising: Array<{
      slug: string;
      name: string;
      role: string;
      emailCount: number;
      firstSeen: string;
      authored: number;
      reviewed: number;
      reported: number;
      totalActivity: number;
    }>;
  };
}

export interface HackerListItem {
  slug: string;
  name: string;
  role: string;
  affiliations: string[];
  emailDomains: string[];
  emailCount: number;
  firstSeen: string;
  lastSeen: string;
  commitsAuthored: number;
  commitsCommitted: number;
  commitsCommittedForOthers: number;
  reviewsGiven: number;
  bugsReported: number;
  suggestionsGiven: number;
  testsGiven: number;
  cfAuthored: number;
  cfReviewed: number;
  cfCommitted: number;
  topSubsystems: Array<{ name: string; count: number }>;
}

export interface HackerProfileData {
  person: {
    slug: string;
    name: string;
    role: string;
    affiliations: string[];
    emailDomains: string[];
    emailCount: number;
    aliases: string[];
    firstSeen: string;
    lastSeen: string;
    commitsAuthored: number;
    commitsCommitted: number;
    commitsCommittedForOthers: number;
    reviewsGiven: number;
    bugsReported: number;
    suggestionsGiven: number;
    testsGiven: number;
    cfAuthored: number;
    cfReviewed: number;
    cfCommitted: number;
  };
  availableYears: number[];
  selectedYear: number;
  heatmap: Array<{ date: string; count: number }>;
  careerByYear: Array<{ year: string; authored: number; committed: number; reviewed: number; reported: number }>;
  subsystems: Array<{ name: string; count: number; pct: number; projectPct?: number; overIndex?: number }>;
  rhythm: {
    byHour: number[];
    byDow: number[];
    longestStreakDays: number;
    activeDays: number;
  };
  collaborators: {
    committedBy: Array<{ slug: string; name: string; role: string; count: number }>;
    reviewedBy: Array<{ slug: string; name: string; role: string; count: number }>;
    helpedAuthors: Array<{ slug: string; name: string; role: string; count: number }>;
  };
  recentCommits: Array<{
    sha: string;
    committedAt: string;
    subject: string;
    subsystem: string;
    pgMajor: string;
    isRevert: boolean;
    isBackpatch: boolean;
    discussionUrls: string[];
    filesChanged: number;
    insertions: number;
    deletions: number;
    kinds: string[];
  }>;
  recentReviews: Array<{
    sha: string;
    committedAt: string;
    subject: string;
    subsystem: string;
    pgMajor: string;
    discussionUrls: string[];
    kind: string;
    authorSlug: string;
    authorName: string;
  }>;
  commitfestEntries: Array<{
    cf_id: number;
    title: string;
    status: string;
    topic: string;
    authors: string;
    reviewers: string;
    committer: string;
    verdict: string;
  }>;
  opinions: Array<{
    id: number;
    cf_id: number;
    backend: string;
    roast_level: string;
    roast_flavour: string;
    verdict: string;
    confidence: string;
    summary: string;
    created_at: string;
  }>;
  mailingLists?: {
    totalMessages: number;
    byList: Array<{ list: string; count: number }>;
    recentMessages: Array<{
      listName: string;
      messageId: string;
      subject: string;
      sentAt: string;
      hasAttachment: boolean;
      archiveUrl: string;
    }>;
  };
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHttpUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") {
      if ((u.hostname === "www.postgresql.org" || u.hostname === "postgresql.org") && u.pathname.startsWith("/message-id/flat/")) {
        u.pathname = "/message-id/" + u.pathname.slice("/message-id/flat/".length);
      }
      return u.toString();
    }
  } catch {
    // ignore
  }
  return "";
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

function roleBadge(role: string): string {
  if (role === "Core Team") return `<span class="pill p-warn">Core Team</span>`;
  if (role === "Committer") return `<span class="pill p-info">Committer</span>`;
  if (role === "Major Contributor") return `<span class="pill p-ok">Major Contributor</span>`;
  if (role === "Significant Contributor") return `<span class="pill">Significant Contributor</span>`;
  return `<span class="tag-micro">Contributor</span>`;
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

function renderGlobalRhythmHeatmap(matrix: number[][]): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const maxVal = Math.max(1, ...matrix.flat());
  return `
    <div class="rhythm-grid-wrap">
      <div class="rhythm-hours-head">
        <span></span>
        ${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>`).join("")}
      </div>
      ${days
        .map(
          (day, d) => `
        <div class="rhythm-row">
          <span class="rhythm-day">${day}</span>
          ${(matrix[d] || Array(24).fill(0))
            .map((val, h) => {
              const alpha = val === 0 ? 0.06 : Math.min(0.95, 0.16 + (val / maxVal) * 0.8);
              const hh = String(h).padStart(2, "0");
              return `<span class="rhythm-cell viz-hoverable" tabindex="0" style="background:color-mix(in oklch, var(--viz-1) ${Math.round(alpha * 100)}%, var(--surface-2));" data-tip-title="${day} · ${hh}:00 UTC" data-tip-body="${fmtNum(val)} commit${val === 1 ? "" : "s"}" data-tip-sub="UTC commit timestamp in selected window"></span>`;
            })
            .join("")}
        </div>
      `,
        )
        .join("")}
    </div>
    <div class="dim" style="font-size:11px;margin-top:6px;">UTC hour of day (00–23) across all commits in window — darker cells = peak hacking hours.</div>
  `;
}

function renderYearContributionHeatmap(year: number, entries: Array<{ date: string; count: number }>): string {
  const counts = new Map(entries.map((e) => [e.date, e.count]));
  const maxCnt = Math.max(1, ...entries.map((e) => e.count));

  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dec31 = new Date(Date.UTC(year, 11, 31));
  const startDow = jan1.getUTCDay();
  const startDate = new Date(jan1.getTime() - startDow * 86_400_000);

  const cell = 11;
  const gap = 3;
  const step = cell + gap;
  const padL = 26;
  const padT = 18;
  const weeks = 53;
  const W = padL + weeks * step + 4;
  const H = padT + 7 * step + 4;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabels: string[] = [];
  let lastMonth = -1;
  const rects: string[] = [];

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cur = new Date(startDate.getTime() + (w * 7 + d) * 86_400_000);
      if (cur > dec31) continue;
      if (cur.getUTCFullYear() !== year) continue;
      if (d === 0 && cur.getUTCMonth() !== lastMonth) {
        lastMonth = cur.getUTCMonth();
        monthLabels.push(`<text x="${padL + w * step}" y="12" fill="var(--dim)" font-size="9.5">${months[lastMonth]}</text>`);
      }
      const iso = cur.toISOString().slice(0, 10);
      const val = counts.get(iso) || 0;
      const lvl = val === 0 ? 0 : val <= Math.max(1, maxCnt * 0.25) ? 1 : val <= Math.max(2, maxCnt * 0.5) ? 2 : val <= Math.max(4, maxCnt * 0.75) ? 3 : 4;
      rects.push(
        `<rect class="hm-lvl-${lvl} viz-hoverable" tabindex="0" x="${padL + w * step}" y="${padT + d * step}" width="${cell}" height="${cell}" rx="2" data-tip-title="${iso}" data-tip-body="${val} contribution${val === 1 ? "" : "s"}" data-tip-sub="Commits, reviews &amp; bug reports"></rect>`,
      );
    }
  }

  const dayLabels = [
    { d: 1, t: "Mon" },
    { d: 3, t: "Wed" },
    { d: 5, t: "Fri" },
  ]
    .map((x) => `<text x="0" y="${padT + x.d * step + 9}" fill="var(--dim)" font-size="9">${x.t}</text>`)
    .join("");

  return `
    <div class="hm-scroll">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${year} contribution heatmap">
        ${monthLabels.join("")}
        ${dayLabels}
        ${rects.join("")}
      </svg>
    </div>
  `;
}

function renderCareerChartSvg(
  career: Array<{ year: string; authored: number; committed: number; reviewed: number; reported: number }>,
): string {
  if (career.length === 0) return `<div class="muted" style="font-size:12.5px;">No career timeline recorded yet.</div>`;
  const W = 680;
  const H = 175;
  const padL = 34;
  const padR = 10;
  const padT = 14;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxTotal = Math.max(1, ...career.map((c) => c.authored + c.reviewed + c.reported));
  const step = innerW / Math.max(1, career.length);
  const barW = Math.max(5, Math.min(26, step * 0.65));

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = padT + innerH * (1 - f);
      return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="${f === 0 ? "" : "3,3"}" />
      <text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="9.5">${Math.round(maxTotal * f)}</text>
    `;
    })
    .join("");

  const lblStep = Math.max(1, Math.ceil(career.length / 8));
  const bars = career
    .map((c, i) => {
      const cx = padL + i * step + step / 2;
      const x = cx - barW / 2;
      const hA = (c.authored / maxTotal) * innerH;
      const hR = (c.reviewed / maxTotal) * innerH;
      const hB = (c.reported / maxTotal) * innerH;
      const yA = padT + innerH - hA;
      const yR = yA - hR;
      const yB = yR - hB;
      const total = c.authored + c.reviewed + c.reported;
      const showLbl = career.length <= 12 || i === career.length - 1 || (i % lblStep === 0 && i < career.length - 2);
      const bodyTip = `${fmtNum(c.authored)} authored · ${fmtNum(c.reviewed)} reviewed · ${fmtNum(c.reported)} reported`;
      const subTip = `${fmtNum(c.committed)} committed · ${fmtNum(total)} total credits`;
      return `
      <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(c.year)}" data-tip-body="${esc(bodyTip)}" data-tip-sub="${esc(subTip)}">
        <rect x="${(cx - step / 2).toFixed(1)}" y="${padT}" width="${step.toFixed(1)}" height="${innerH}" fill="transparent" />
        ${hA > 0 ? `<rect x="${x.toFixed(1)}" y="${yA.toFixed(1)}" width="${barW.toFixed(1)}" height="${hA.toFixed(1)}" rx="1.5" fill="var(--viz-1)" />` : ""}
        ${hR > 0 ? `<rect x="${x.toFixed(1)}" y="${yR.toFixed(1)}" width="${barW.toFixed(1)}" height="${hR.toFixed(1)}" rx="1.5" fill="var(--viz-2)" />` : ""}
        ${hB > 0 ? `<rect x="${x.toFixed(1)}" y="${yB.toFixed(1)}" width="${barW.toFixed(1)}" height="${hB.toFixed(1)}" rx="1.5" fill="var(--viz-3)" />` : ""}
        ${showLbl ? `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5" class="mono">${esc(c.year)}</text>` : ""}
      </g>
    `;
    })
    .join("");

  return `
    <svg class="obs-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yearly career contribution breakdown">
      ${grid}
      ${bars}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-1);"></span>Authored</span>
      <span><span class="dot" style="background:var(--viz-2);"></span>Reviewed-by</span>
      <span><span class="dot" style="background:var(--viz-3);"></span>Reported-by</span>
    </div>
  `;
}

export function renderHackersTab(params: {
  overview: HackersOverviewData | null;
  loading: boolean;
  error: string;
  window: HackerWindow;
  lbTab: HackerLbKind;
  directory: HackerListItem[];
  dirSearch: string;
  dirRole: string;
  dirSort: string;
}): string {
  const { overview, loading, error, window: win, lbTab, directory, dirSearch, dirRole, dirSort } = params;
  const windows: Array<{ id: HackerWindow; label: string }> = [
    { id: "PG20", label: "PG20" },
    { id: "PG19", label: "PG19" },
    { id: "PG18", label: "PG18" },
    { id: "30d", label: "30d" },
    { id: "90d", label: "90d" },
    { id: "1y", label: "1 year" },
    { id: "5y", label: "5 years" },
    { id: "all", label: "All-time" },
  ];

  if (loading && !overview) {
    return renderHackersSkeleton();
  }
  if (error && !overview) {
    return `<div class="card"><div class="empty-state">Failed to load hacking stats: ${esc(error)}</div></div>`;
  }
  if (!overview || !overview.synced || !overview.totals) {
    return `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">Hacking Observatory not synced yet</div>
          <p class="muted" style="max-width:520px;margin:0 auto;">Run <code class="mono">bun run web:sync-hackers --fetch</code> to ingest PostgreSQL git history, multi-email identities, and recognized contributors.</p>
        </div>
      </div>
    `;
  }

  const t = overview.totals;
  const meta = overview.syncMeta;
  const maxSubsys = Math.max(1, ...overview.subsystems.map((s) => s.commits));

  const renderLeaderboardBody = (): string => {
    if (lbTab === "committers") {
      const rows = overview.leaderboards.committers;
      const maxTot = Math.max(1, ...rows.map((r) => r.total));
      return rows
        .map((r, i) => {
          const pctAll = Math.max(6, Math.round((r.total / maxTot) * 100));
          const pctOthers = r.total > 0 ? Math.round((r.forOthers / r.total) * 100) : 0;
          return `
            <button type="button" class="obs-lb-row" data-open-hacker="${esc(r.slug)}">
              <span class="lb-rank mono">${i + 1}</span>
              <span class="obs-avatar" style="background:${avatarColor(r.name)};">${esc(personInitials(r.name))}</span>
              <div class="obs-lb-info">
                <div class="obs-lb-top">
                  <strong>${esc(r.name)}</strong>
                  ${roleBadge(r.role)}
                  ${r.emailCount >= 2 ? `<span class="tag-micro" title="Unified across ${r.emailCount} email addresses">${r.emailCount} emails</span>` : ""}
                </div>
                <div class="obs-lb-bar-wrap" style="width:${pctAll}%;">
                  <div class="obs-lb-bar-others" style="width:${pctOthers}%;" title="${r.forOthers} committed for other authors"></div>
                  <div class="obs-lb-bar-own" style="flex:1;" title="${r.own} own commits"></div>
                </div>
              </div>
              <div class="obs-lb-num">
                <strong class="mono">${fmtNum(r.total)}</strong>
                <span class="dim" style="font-size:11px;">${pctOthers}% for others</span>
              </div>
            </button>
          `;
        })
        .join("");
    }
    if (lbTab === "rising") {
      const rows = overview.leaderboards.rising;
      if (rows.length === 0) return `<div class="empty-state">No first-time contributors recorded in this window.</div>`;
      return rows
        .map(
          (r, i) => `
        <button type="button" class="obs-lb-row" data-open-hacker="${esc(r.slug)}">
          <span class="lb-rank mono">${i + 1}</span>
          <span class="obs-avatar" style="background:${avatarColor(r.name)};">${esc(personInitials(r.name))}</span>
          <div class="obs-lb-info">
            <div class="obs-lb-top">
              <strong>${esc(r.name)}</strong>
              <span class="tag-micro">First seen ${esc(r.firstSeen)}</span>
            </div>
            <div class="muted" style="font-size:11.5px;">${r.authored} authored · ${r.reviewed} reviewed · ${r.reported} reported</div>
          </div>
          <div class="obs-lb-num">
            <strong class="mono">${fmtNum(r.totalActivity)}</strong>
            <span class="dim" style="font-size:11px;">credits</span>
          </div>
        </button>
      `,
        )
        .join("");
    }
    const rows =
      lbTab === "authors"
        ? overview.leaderboards.authors
        : lbTab === "reviewers"
          ? overview.leaderboards.reviewers
          : overview.leaderboards.reporters;
    const maxCnt = Math.max(1, ...rows.map((r) => r.count));
    const unit = lbTab === "authors" ? "commits" : lbTab === "reviewers" ? "reviews" : "bugs";
    const color = lbTab === "authors" ? "var(--accent)" : lbTab === "reviewers" ? "var(--ok)" : "var(--warn)";
    return rows
      .map((r, i) => {
        const w = Math.max(5, Math.round((r.count / maxCnt) * 100));
        return `
          <button type="button" class="obs-lb-row" data-open-hacker="${esc(r.slug)}">
            <span class="lb-rank mono">${i + 1}</span>
            <span class="obs-avatar" style="background:${avatarColor(r.name)};">${esc(personInitials(r.name))}</span>
            <div class="obs-lb-info">
              <div class="obs-lb-top">
                <strong>${esc(r.name)}</strong>
                ${roleBadge(r.role)}
                ${r.emailCount >= 2 ? `<span class="tag-micro">${r.emailCount} emails</span>` : ""}
              </div>
              <div class="obs-lb-bar-wrap" style="width:${w}%;"><div style="width:100%;background:${color};"></div></div>
            </div>
            <div class="obs-lb-num">
              <strong class="mono">${fmtNum(r.count)}</strong>
              <span class="dim" style="font-size:11px;">${unit}</span>
            </div>
          </button>
        `;
      })
      .join("");
  };

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">PostgreSQL Hacking Observatory</h1>
        <div class="page-sub">
          ${fmtNum(meta.totalCommitsAll || 0)} commits · ${fmtNum(meta.totalPeople || 0)} unified contributors (${fmtNum(meta.multiEmailPeople || 0)} merged across multiple emails) · Latest commit ${esc((meta.lastCommitAt || "").slice(0, 10))}
        </div>
      </div>
      <div class="chips" role="tablist" aria-label="Time window" style="margin-bottom:0;">
        ${windows
          .map(
            (w) => `
          <button type="button" class="chip ${win === w.id ? "active" : ""}" data-hacker-window="${w.id}">${esc(w.label)}</button>
        `,
          )
          .join("")}
      </div>
    </div>

    <!-- Hero Infographic KPI Strip -->
    <div class="kpis">
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l">Active hackers</div>
        <div class="kpi-v">${fmtNum(t.activeHackers)}</div>
        <div class="kpi-sub">+${fmtNum(t.newHackers)} first-time in window</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l"><span class="dot" style="background:var(--accent)"></span>Commits landed</div>
        <div class="kpi-v">${fmtNum(t.commits)}</div>
        <div class="kpi-sub">${fmtNum(t.backpatches)} backpatched · ${t.reverts} reverts</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l"><span class="dot" style="background:var(--ok)"></span>Committed for others</div>
        <div class="kpi-v" style="color:var(--ok)">${t.committedForOthersPct}%</div>
        <div class="kpi-sub">${fmtNum(t.committedForOthers)} of ${fmtNum(t.commits)} commits</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l"><span class="dot" style="background:#4cb782"></span>Reviewed-by credits</div>
        <div class="kpi-v">${fmtNum(t.reviewsGiven)}</div>
        <div class="kpi-sub">${fmtNum(t.reviewers)} unique reviewers</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l"><span class="dot" style="background:var(--warn)"></span>Bugs reported → fixed</div>
        <div class="kpi-v">${fmtNum(t.bugsReported)}</div>
        <div class="kpi-sub">${fmtNum(t.reporters)} unique reporters</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l">Multi-email unified</div>
        <div class="kpi-v">${fmtNum(meta.multiEmailPeople || 0)}</div>
        <div class="kpi-sub">${fmtNum(meta.totalIdentities || 0)} total identities linked</div>
      </div>
    </div>

    <!-- 1. Hero Chart: obeys selected time window (Release-Cycle Race for PG20/PG19/PG18; Window Activity Timeline for 30d/90d/1y/5y/all) -->
    ${(() => {
      const isPgCycleWindow = win === "PG20" || win === "PG19" || win === "PG18";
      const focusMajor = isPgCycleWindow ? win : "PG20";
      const winLabel = windows.find((w) => w.id === win)?.label || win;
      const race = overview.releaseCycles?.length ? renderReleaseCycleRaceSvg(overview.releaseCycles, focusMajor) : null;

      const sponsorshipCard = (isHero: boolean) => `
      <${isHero ? "section" : "div"} class="card viz-card" ${isHero ? "" : 'style="margin-bottom:0;"'}>
        <div class="card-head">
          <div>
            <div class="viz-kicker">Sponsorship &amp; Review Throughput (${esc(winLabel)})</div>
            <h2${isHero ? ' class="viz-headline"' : ""}>${fmtNum(t.commits)} commits · ${t.committedForOthersPct}% landed for other authors</h2>
            <div class="dim" style="font-size:12px;">Window: ${esc(winLabel)} · ${fmtNum(t.reviewsGiven)} Reviewed-by credits across ${fmtNum(t.activeHackers)} active hackers · Hover any bar for breakdown</div>
          </div>
        </div>
        ${renderSponsorshipTimelineSvg(overview.timeline)}
      </${isHero ? "section" : "div"}>`;

      const raceCard = (isHero: boolean) =>
        race
          ? `
      <${isHero ? "section" : "div"} class="card viz-card" ${isHero ? "" : 'style="margin-bottom:0;"'}>
        <div class="card-head">
          <div>
            <div class="viz-kicker">Release-Cycle Pace (${isHero ? esc(focusMajor) : "Cross-release PG17–PG20"})</div>
            <h2${isHero ? ' class="viz-headline"' : ""}>${esc(race.headline)}</h2>
            <div class="dim" style="font-size:12px;margin-top:2px;">${esc(race.subline)}</div>
          </div>
          ${!isHero ? `<span class="tag-micro">Full PG17–PG20 cycles</span>` : ""}
        </div>
        ${race.svg}
      </${isHero ? "section" : "div"}>`
          : "";

      const cadenceCard = `
      <div class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Global Circadian Cadence (${esc(winLabel)})</div>
            <h2>When Does Postgres Hacking Happen?</h2>
            <div class="dim" style="font-size:12px;">7×24 UTC commit heatmap · Hover any cell</div>
          </div>
        </div>
        ${renderGlobalRhythmHeatmap(overview.rhythmHeatmap)}
      </div>`;

      if (isPgCycleWindow && race) {
        return `
      ${raceCard(true)}
      <div class="grid2" style="margin-bottom:14px;">
        ${sponsorshipCard(false)}
        ${cadenceCard}
      </div>`;
      }

      return `
      ${sponsorshipCard(true)}
      <div class="grid2" style="margin-bottom:14px;">
        ${race ? raceCard(false) : ""}
        ${cadenceCard}
      </div>`;
    })()}

    <!-- 3. Subsystem Bus-Factor Quadrant + Annual Committer Concentration -->
    <div class="grid2" style="margin-bottom:14px;">
      ${(() => {
        const bf = renderBusFactorQuadrantSvg(overview.subsystems);
        return `
        <div class="card viz-card" style="margin-bottom:0;">
          <div class="card-head">
            <div>
              <div class="viz-kicker">Subsystem Bus Factor</div>
              <h2 class="viz-headline">${esc(bf.headline)}</h2>
              <div class="dim" style="font-size:11.5px;margin-top:2px;">${esc(bf.subline)}</div>
            </div>
          </div>
          ${bf.svg}
        </div>
        `;
      })()}
      ${(() => {
        if (!overview.concentrationByYear?.length) return "";
        const conc = renderCommitterConcentrationSvg(overview.concentrationByYear);
        return `
        <div class="card viz-card" style="margin-bottom:0;">
          <div class="card-head">
            <div>
              <div class="viz-kicker">Throughput Concentration (2016–Present)</div>
              <h2 class="viz-headline">${esc(conc.headline)}</h2>
              <div class="dim" style="font-size:11.5px;margin-top:2px;">${esc(conc.subline)}</div>
            </div>
          </div>
          ${conc.svg}
        </div>
        `;
      })()}
    </div>

    <!-- 4. Leaderboards + Subsystem Detail Bars -->
    <div class="grid2" style="margin-bottom:14px;">
      <div class="card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <h2>Leaderboards</h2>
            <div class="dim" style="font-size:12px;">Tap any person to open their full personal profile</div>
          </div>
        </div>
        <div class="chips" role="tablist" aria-label="Leaderboard type">
          <button type="button" class="chip ${lbTab === "committers" ? "active" : ""}" data-hacker-lb="committers">Committers</button>
          <button type="button" class="chip ${lbTab === "authors" ? "active" : ""}" data-hacker-lb="authors">Authors</button>
          <button type="button" class="chip ${lbTab === "reviewers" ? "active" : ""}" data-hacker-lb="reviewers">Reviewers</button>
          <button type="button" class="chip ${lbTab === "reporters" ? "active" : ""}" data-hacker-lb="reporters">Bug Hunters</button>
          <button type="button" class="chip ${lbTab === "rising" ? "active" : ""}" data-hacker-lb="rising">Rising Stars</button>
        </div>
        <div class="obs-lb-list">
          ${renderLeaderboardBody()}
        </div>
      </div>

      <div class="card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <h2>Subsystem Breakdown &amp; 50% Bus Factor</h2>
            <div class="dim" style="font-size:12px;">Minimum committers covering half of each subsystem's commits</div>
          </div>
        </div>
        <div class="subsys-list">
          ${overview.subsystems
            .map((s) => {
              const w = Math.max(5, Math.round((s.commits / maxSubsys) * 100));
              const bf = s.busFactor ?? 1;
              const lowBusFactor = s.commits >= 20 && bf <= 2;
              return `
                <div class="subsys-row" style="cursor:default;">
                  <div class="subsys-head">
                    <span class="hbar-label">${esc(s.name)} ${lowBusFactor ? `<span class="tag-micro tag-wa" title="Bus factor ${bf}: ${bf} committer(s) landed ${s.bfCommits ?? 0}/${s.commits}">BF=${bf}</span>` : `<span class="tag-micro mono">BF=${bf}</span>`}</span>
                    <span class="mono dim">${fmtNum(s.commits)} · ${s.authors} auth · ${s.committers} comm</span>
                  </div>
                  <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;"></div></div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </div>

    <!-- Searchable All-Hackers Directory -->
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Explore All Contributors (${fmtNum(meta.totalPeople || 0)})</h2>
          <div class="dim" style="font-size:12px;">Search by name, alias, company, or email domain (e.g. <code>fujitsu</code>, <code>enterprisedb</code>, <code>amazon</code>)</div>
        </div>
      </div>
      <div class="obs-dir-controls">
        <div class="search-box" style="flex:1;margin-bottom:0;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="hacker-dir-search" type="search" autocomplete="off" value="${esc(dirSearch)}" placeholder="Search hacker name, alias, company, or domain…" />
        </div>
        <select id="hacker-dir-role" aria-label="Filter by role">
          <option value="all" ${dirRole === "all" ? "selected" : ""}>All roles</option>
          <option value="Core Team" ${dirRole === "Core Team" ? "selected" : ""}>Core Team</option>
          <option value="Committer" ${dirRole === "Committer" ? "selected" : ""}>Committers</option>
          <option value="Major Contributor" ${dirRole === "Major Contributor" ? "selected" : ""}>Major Contributors</option>
          <option value="Significant Contributor" ${dirRole === "Significant Contributor" ? "selected" : ""}>Significant Contributors</option>
        </select>
        <select id="hacker-dir-sort" aria-label="Sort contributors">
          <option value="activity" ${dirSort === "activity" ? "selected" : ""}>Total impact</option>
          <option value="committed" ${dirSort === "committed" ? "selected" : ""}>Commits landed</option>
          <option value="reviews" ${dirSort === "reviews" ? "selected" : ""}>Reviews given</option>
          <option value="reported" ${dirSort === "reported" ? "selected" : ""}>Bugs reported</option>
          <option value="recent" ${dirSort === "recent" ? "selected" : ""}>Most recently active</option>
        </select>
      </div>
      <div class="obs-dir-grid" id="hacker-dir-mount">
        ${renderHackerDirectoryCards(directory)}
      </div>
    </div>
  `;
}

export function renderHackerDirectoryCards(directory: HackerListItem[]): string {
  if (directory.length === 0) {
    return `<div class="empty-state" style="grid-column:1 / -1;">No matching contributors found.</div>`;
  }
  return directory
    .map(
      (h) => `
    <button type="button" class="obs-person-card" data-open-hacker="${esc(h.slug)}">
      <div class="obs-person-head">
        <span class="obs-avatar" style="background:${avatarColor(h.name)};">${esc(personInitials(h.name))}</span>
        <div style="min-width:0;flex:1;">
          <div class="obs-person-name">${esc(h.name)}</div>
          <div class="row" style="gap:5px;margin-top:2px;">
            ${roleBadge(h.role)}
            ${h.emailCount >= 2 ? `<span class="tag-micro">${h.emailCount} emails</span>` : ""}
          </div>
        </div>
      </div>
      <div class="obs-person-stats mono">
        <span title="Commits authored"><strong>${fmtNum(h.commitsAuthored)}</strong> auth</span>
        <span title="Reviews credited"><strong>${fmtNum(h.reviewsGiven)}</strong> rev</span>
        <span title="Bugs reported"><strong>${fmtNum(h.bugsReported)}</strong> bug</span>
        ${h.commitsCommitted > 0 ? `<span title="Commits landed"><strong>${fmtNum(h.commitsCommitted)}</strong> comm</span>` : ""}
      </div>
      <div class="obs-person-foot">
        ${h.topSubsystems[0] ? `<span class="tag-micro">${esc(h.topSubsystems[0].name)}</span>` : ""}
        ${h.affiliations[0] ? `<span class="dim" style="font-size:11px;">${esc(h.affiliations[0])}</span>` : h.emailDomains[0] ? `<span class="dim mono" style="font-size:11px;">@${esc(h.emailDomains[0])}</span>` : ""}
      </div>
    </button>
  `,
    )
    .join("");
}

export type HackerCfRoleFilter = "all" | "author" | "reviewer" | "committer";

export function renderHackerProfilePage(params: {
  profile: HackerProfileData | null;
  loading: boolean;
  error: string;
  activeTab: HackerProfileTab;
  cfRoleFilter?: HackerCfRoleFilter;
  backLabel: string;
}): string {
  const { profile, loading, error, activeTab, backLabel } = params;
  const cfRoleFilter: HackerCfRoleFilter = params.cfRoleFilter ?? "all";
  if (loading && !profile) {
    return renderHackerProfileSkeleton();
  }
  if (error || !profile) {
    return `
      <div class="patch-crumb">
        <button type="button" class="back-btn" id="hacker-back-btn">← Back to ${esc(backLabel)}</button>
      </div>
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">Contributor profile not found</div>
          <div class="muted">${esc(error || "No matching PostgreSQL contributor in index yet.")}</div>
        </div>
      </div>
    `;
  }

  const p = profile.person;
  const forOthersPct = p.commitsCommitted > 0 ? Math.round((p.commitsCommittedForOthers / p.commitsCommitted) * 100) : 0;
  const roleTot = Math.max(1, p.commitsAuthored + p.commitsCommittedForOthers + p.reviewsGiven + p.bugsReported);
  const roleSegs = [
    { label: "Authored", val: p.commitsAuthored, color: "var(--viz-1)" },
    { label: "Committed for others", val: p.commitsCommittedForOthers, color: "var(--viz-4)" },
    { label: "Reviewed", val: p.reviewsGiven, color: "var(--viz-2)" },
    { label: "Bugs reported", val: p.bugsReported, color: "var(--viz-3)" },
  ].filter((x) => x.val > 0);

  const personNeedles = Array.from(
    new Set(
      [p.name, ...(p.aliases || [])]
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 2),
    ),
  );
  const matchesPersonField = (field: string) => {
    const low = (field || "").toLowerCase();
    return Boolean(low && personNeedles.some((n) => low.includes(n)));
  };
  const classifiedCfs = profile.commitfestEntries.map((e) => ({
    ...e,
    isAuthor: matchesPersonField(e.authors || ""),
    isReviewer: matchesPersonField(e.reviewers || ""),
    isCommitter: matchesPersonField(e.committer || ""),
  }));
  const cfAuthCount = classifiedCfs.filter((e) => e.isAuthor).length;
  const cfRevCount = classifiedCfs.filter((e) => e.isReviewer).length;
  const cfCommCount = classifiedCfs.filter((e) => e.isCommitter).length;

  const renderCollabGroup = (title: string, items: Array<{ slug: string; name: string; role: string; count: number }>) => `
    <div class="obs-collab-col">
      <div class="sheet-section-label" style="margin-bottom:8px;">${esc(title)}</div>
      ${
        items.length === 0
          ? `<div class="muted" style="font-size:12px;">No recorded pairs yet.</div>`
          : items
              .map(
                (c) => `
          <button type="button" class="lb-row" data-open-hacker="${esc(c.slug)}">
            <span class="obs-avatar obs-avatar-sm" style="background:${avatarColor(c.name)};">${esc(personInitials(c.name))}</span>
            <span class="lb-name">${esc(c.name)}</span>
            <span class="lb-count mono">${c.count}</span>
          </button>
        `,
              )
              .join("")
      }
    </div>
  `;

  const renderFeedTab = (): string => {
    if (activeTab === "commits") {
      if (profile.recentCommits.length === 0) return `<div class="empty-state">No commits recorded yet.</div>`;
      return `
        <div class="issue-list">
          ${profile.recentCommits
            .map((c) => {
              const disc = safeHttpUrl(c.discussionUrls[0]);
              return `
                <div class="obs-commit-row">
                  <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <div class="row" style="gap:6px;">
                      <a class="mono" style="font-size:12px;font-weight:600;" href="https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=${encodeURIComponent(c.sha)}" target="_blank" rel="noopener">${esc(c.sha.slice(0, 10))} ↗</a>
                      <span class="tag-micro">${esc(c.pgMajor)}</span>
                      <span class="tag-micro">${esc(c.subsystem)}</span>
                      ${c.isBackpatch ? `<span class="tag-micro">backpatch</span>` : ""}
                      ${c.isRevert ? `<span class="tag-micro tag-prod">revert</span>` : ""}
                    </div>
                    <div class="row" style="gap:8px;font-size:11.5px;">
                      <span class="mono diff-stat-add">+${c.insertions}</span>
                      <span class="mono diff-stat-del">-${c.deletions}</span>
                      <span class="mono dim">${esc(c.committedAt.slice(0, 10))}</span>
                      ${disc ? `<a href="${esc(disc)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
                    </div>
                  </div>
                  <div class="obs-commit-subj">${esc(c.subject)}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }
    if (activeTab === "reviews") {
      if (profile.recentReviews.length === 0) return `<div class="empty-state">No review or bug-report credits recorded yet.</div>`;
      return `
        <div class="issue-list">
          ${profile.recentReviews
            .map((r) => {
              const disc = safeHttpUrl(r.discussionUrls[0]);
              return `
                <div class="obs-commit-row">
                  <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <div class="row" style="gap:6px;">
                      <span class="pill ${r.kind === "reviewer" ? "p-ok" : r.kind === "reporter" ? "p-warn" : "p-info"}">${esc(r.kind)}</span>
                      <a class="mono" style="font-size:12px;" href="https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=${encodeURIComponent(r.sha)}" target="_blank" rel="noopener">${esc(r.sha.slice(0, 10))} ↗</a>
                      <span class="tag-micro">${esc(r.subsystem)}</span>
                      ${r.authorSlug ? `<button type="button" class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:11px;" data-open-hacker="${esc(r.authorSlug)}">Author: ${esc(r.authorName)}</button>` : ""}
                    </div>
                    <div class="row" style="gap:8px;font-size:11.5px;">
                      <span class="mono dim">${esc(r.committedAt.slice(0, 10))}</span>
                      ${disc ? `<a href="${esc(disc)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
                    </div>
                  </div>
                  <div class="obs-commit-subj">${esc(r.subject)}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }
    if (activeTab === "commitfest") {
      if (classifiedCfs.length === 0) return `<div class="empty-state">No matching CommitFest entries indexed.</div>`;
      const filteredCfs =
        cfRoleFilter === "author"
          ? classifiedCfs.filter((e) => e.isAuthor)
          : cfRoleFilter === "reviewer"
            ? classifiedCfs.filter((e) => e.isReviewer)
            : cfRoleFilter === "committer"
              ? classifiedCfs.filter((e) => e.isCommitter)
              : classifiedCfs;
      const verdictBadge = (v: string) => {
        const up = (v || "").toUpperCase();
        if (!up || up === "UNROASTED") return "";
        const cls =
          up === "LIKELY-REJECT"
            ? "p-bad"
            : up === "NO-FUNDAMENTAL-OBJECTION"
              ? "p-ok"
              : "p-warn";
        return `<span class="pill ${cls}" style="font-size:10.5px;">${esc(up)}</span>`;
      };
      return `
        <div class="mr-participants-bar" style="margin-bottom:10px;" aria-label="Filter CommitFest entries by role">
          <button type="button" class="chip ${cfRoleFilter === "all" ? "active" : ""}" data-hacker-cf-role="all">All (${classifiedCfs.length})</button>
          <button type="button" class="chip ${cfRoleFilter === "author" ? "active" : ""}" data-hacker-cf-role="author">Author (${cfAuthCount})</button>
          <button type="button" class="chip ${cfRoleFilter === "reviewer" ? "active" : ""}" data-hacker-cf-role="reviewer">Reviewer (${cfRevCount})</button>
          <button type="button" class="chip ${cfRoleFilter === "committer" ? "active" : ""}" data-hacker-cf-role="committer">Committer (${cfCommCount})</button>
        </div>
        ${
          filteredCfs.length === 0
            ? `<div class="empty-state">No CommitFest entries as ${esc(cfRoleFilter)}.</div>`
            : `
        <div class="issue-list">
          ${filteredCfs
            .map(
              (e) => `
            <button type="button" class="issue-row" data-open-patch="${e.cf_id}">
              <div class="issue-top">
                <div class="issue-id-group">
                  <span class="mono issue-id">CF ${e.cf_id}</span>
                  ${e.isAuthor ? `<span class="cf-role-pill cf-role-author">Author</span>` : ""}
                  ${e.isReviewer ? `<span class="cf-role-pill cf-role-reviewer">Reviewer</span>` : ""}
                  ${e.isCommitter ? `<span class="cf-role-pill cf-role-committer">Committer</span>` : ""}
                  <span class="issue-status">${esc(e.status || "—")}</span>
                  ${e.topic ? `<span class="tag-micro">${esc(e.topic)}</span>` : ""}
                  ${verdictBadge(e.verdict)}
                </div>
              </div>
              <div class="issue-title">${esc(e.title)}</div>
              <div class="issue-meta">
                <span>Authors: ${esc(e.authors || "—")}</span>
                ${e.reviewers ? `<span>· Rev: ${esc(e.reviewers)}</span>` : ""}
                ${e.committer ? `<span>· Comm: ${esc(e.committer)}</span>` : ""}
              </div>
            </button>
          `,
            )
            .join("")}
        </div>
        `
        }
      `;
    }
    if (activeTab === "lists") {
      const ml = profile.mailingLists;
      if (!ml || ml.recentMessages.length === 0) {
        return `<div class="empty-state">No archived PostgreSQL mailing list messages linked to ${esc(p.name)} yet.</div>`;
      }
      return `
        ${
          ml.byList.length > 0
            ? `<div class="chips" style="margin-bottom:10px;">
                ${ml.byList.map((b) => `<span class="chip" style="cursor:default;"><strong class="mono">${esc(b.list)}</strong> <span class="dim">(${b.count})</span></span>`).join("")}
              </div>`
            : ""
        }
        <div class="issue-list">
          ${ml.recentMessages
            .map(
              (m) => `
            <div class="obs-commit-row">
              <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <div class="row" style="gap:6px;">
                  <span class="tag-micro mono">${esc(m.listName)}</span>
                  ${m.hasAttachment ? `<span class="pill p-ok">📎 attachment</span>` : ""}
                </div>
                <div class="row" style="gap:8px;font-size:11.5px;">
                  <span class="mono dim">${esc(m.sentAt.slice(0, 16).replace("T", " "))} UTC</span>
                  <a href="${esc(m.archiveUrl)}" target="_blank" rel="noopener">Thread ↗</a>
                </div>
              </div>
              <div class="obs-commit-subj">${esc(m.subject)}</div>
            </div>
          `,
            )
            .join("")}
        </div>
      `;
    }
    if (profile.opinions.length === 0) {
      return `<div class="empty-state">No published pgroast roasts attributed to ${esc(p.name)} yet.</div>`;
    }
    return `
      <div class="issue-list">
        ${profile.opinions
          .map(
            (o) => `
          <button type="button" class="issue-row" data-open-patch="${o.cf_id}">
            <div class="issue-top">
              <div class="issue-id-group">
                <span class="mono issue-id">CF ${o.cf_id}</span>
                <span class="tag-micro mono">${esc(o.backend)}</span>
                <span class="issue-status">${esc(o.created_at.slice(0, 10))}</span>
              </div>
            </div>
            <div class="issue-title">${esc(o.summary || "View patch roast")}</div>
          </button>
        `,
          )
          .join("")}
      </div>
    `;
  };

  const hasGitActivity =
    profile.heatmap.length > 0 ||
    profile.careerByYear.length > 0 ||
    profile.subsystems.length > 0 ||
    p.commitsAuthored > 0 ||
    p.commitsCommitted > 0 ||
    p.reviewsGiven > 0 ||
    p.bugsReported > 0 ||
    p.suggestionsGiven > 0 ||
    p.testsGiven > 0;

  return `
    <div class="patch-crumb">
      <button type="button" class="back-btn" id="hacker-back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        <span>Back to ${esc(backLabel)}</span>
      </button>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-secondary btn-sm" id="hacker-copy-url-btn">Copy profile link</button>
        <a class="btn btn-ghost btn-sm" href="https://commitfest.postgresql.org/search/?searchterm=${encodeURIComponent(p.name)}" target="_blank" rel="noopener">CommitFest ↗</a>
      </div>
    </div>

    <!-- Personal Hero Header -->
    <section class="obs-profile-hero">
      <div class="obs-profile-id">
        <span class="obs-avatar obs-avatar-lg" style="background:${avatarColor(p.name)};">${esc(personInitials(p.name))}</span>
        <div style="min-width:0;flex:1;">
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;">
            <h1 class="obs-profile-name">${esc(p.name)}</h1>
            ${roleBadge(p.role)}
            ${p.affiliations.map((a) => `<span class="tag-micro">${esc(a)}</span>`).join("")}
          </div>
          <div class="muted" style="font-size:12.5px;margin-top:5px;">
            ${p.firstSeen ? `Active <strong>${esc(p.firstSeen.slice(0, 4))} – ${esc((p.lastSeen || p.firstSeen).slice(0, 4))}</strong>` : "PostgreSQL contributor"}
            · <strong class="mono">${fmtNum(profile.rhythm.activeDays)}</strong> active days
            ${profile.rhythm.longestStreakDays >= 2 ? ` · longest streak <strong class="mono">${profile.rhythm.longestStreakDays}d</strong>` : ""}
          </div>
          ${
            p.emailCount > 0 || p.aliases.length > 0
              ? `
            <div class="obs-identity-strip">
              ${p.emailCount > 0 ? `<span class="pill">🔗 ${p.emailCount} unified email address${p.emailCount === 1 ? "" : "es"}</span>` : ""}
              ${p.emailDomains.slice(0, 6).map((d) => `<span class="tag-micro mono">@${esc(d)}</span>`).join("")}
              ${p.aliases.length > 0 ? `<span class="dim" style="font-size:11.5px;">Also credited as: ${esc(p.aliases.slice(0, 4).join(", "))}</span>` : ""}
            </div>
          `
              : ""
          }
          ${
            roleSegs.length > 0
              ? `
            <div class="viz-role-strip-wrap">
              <div class="viz-role-bar" role="img" aria-label="Role signature breakdown">
                ${roleSegs
                  .map((s) => {
                    const pct = Math.max(3, Math.round((s.val / roleTot) * 100));
                    return `<div class="viz-role-seg viz-hoverable" style="width:${pct}%;background:${s.color};" tabindex="0" data-tip-title="${esc(s.label)}" data-tip-body="${fmtNum(s.val)} credits (${Math.round((s.val / roleTot) * 100)}% of role mix)"></div>`;
                  })
                  .join("")}
              </div>
              <div class="viz-role-legend">
                ${roleSegs
                  .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${esc(s.label)} <strong class="mono">${Math.round((s.val / roleTot) * 100)}%</strong></span>`)
                  .join("")}
              </div>
            </div>
          `
              : ""
          }
        </div>
      </div>
    </section>

    <!-- Personal Infographic KPIs -->
    <div class="kpis">
      <button type="button" class="kpi kpi-clickable" data-hacker-jump-tab="commits" title="Jump to Recent Commits">
        <div class="kpi-l"><span class="dot" style="background:var(--accent)"></span>Commits authored</div>
        <div class="kpi-v">${fmtNum(p.commitsAuthored)}</div>
        <div class="kpi-sub">Author &amp; co-author</div>
      </button>
      <button type="button" class="kpi kpi-clickable" data-hacker-jump-tab="commits" title="Jump to Recent Commits">
        <div class="kpi-l"><span class="dot" style="background:var(--ok)"></span>Commits landed</div>
        <div class="kpi-v">${fmtNum(p.commitsCommitted)}</div>
        <div class="kpi-sub">${p.commitsCommitted > 0 ? `${fmtNum(p.commitsCommittedForOthers)} for others (${forOthersPct}%)` : "Not a committer"}</div>
      </button>
      <button type="button" class="kpi kpi-clickable" data-hacker-jump-tab="reviews" title="Jump to Reviews & Reports">
        <div class="kpi-l"><span class="dot" style="background:#4cb782"></span>Reviews credited</div>
        <div class="kpi-v" style="color:var(--ok)">${fmtNum(p.reviewsGiven)}</div>
        <div class="kpi-sub">Reviewed-by trailers</div>
      </button>
      <button type="button" class="kpi kpi-clickable" data-hacker-jump-tab="reviews" title="Jump to Reviews & Reports">
        <div class="kpi-l"><span class="dot" style="background:var(--warn)"></span>Bugs reported</div>
        <div class="kpi-v">${fmtNum(p.bugsReported)}</div>
        <div class="kpi-sub">Reported-by → fix landed</div>
      </button>
      <button type="button" class="kpi kpi-clickable" data-hacker-jump-tab="reviews" title="Jump to Reviews & Reports">
        <div class="kpi-l">Suggested / Tested</div>
        <div class="kpi-v">${fmtNum(p.suggestionsGiven + p.testsGiven)}</div>
        <div class="kpi-sub">${fmtNum(p.suggestionsGiven)} sug · ${fmtNum(p.testsGiven)} test</div>
      </button>
      <div class="kpi kpi-clickable ${profile.commitfestEntries.length > 0 ? "kpi-has-data" : ""}" role="button" tabindex="0" data-hacker-jump-tab="commitfest" data-hacker-jump-role="all" title="Jump to CommitFest entries">
        <div class="kpi-l">CommitFest entries</div>
        <div class="kpi-v">${fmtNum(profile.commitfestEntries.length)}</div>
        <div class="kpi-sub">
          <button type="button" class="kpi-role-chip" data-hacker-jump-tab="commitfest" data-hacker-jump-role="author">${cfAuthCount} auth</button>
          · <button type="button" class="kpi-role-chip" data-hacker-jump-tab="commitfest" data-hacker-jump-role="reviewer">${cfRevCount} rev</button>
          · <button type="button" class="kpi-role-chip" data-hacker-jump-tab="commitfest" data-hacker-jump-role="committer">${cfCommCount} comm</button>
        </div>
      </div>
    </div>

    ${
      hasGitActivity
        ? `
    <!-- 52-Week Contribution Heatmap -->
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Contribution Activity (${profile.selectedYear})</h2>
          <div class="dim" style="font-size:12px;">Commits, reviews, and bug reports credited by day</div>
        </div>
        <div class="chips" style="margin-bottom:0;">
          ${profile.availableYears
            .slice(0, 8)
            .map(
              (yr) => `<button type="button" class="chip ${yr === profile.selectedYear ? "active" : ""}" data-hacker-year="${yr}">${yr}</button>`,
            )
            .join("")}
        </div>
      </div>
      ${renderYearContributionHeatmap(profile.selectedYear, profile.heatmap)}
    </div>

    <!-- Career Trajectory + Subsystem Over-Index DNA -->
    <div class="grid2" style="margin-bottom:14px;">
      <div class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Career Trajectory</div>
            <h2>Annual PostgreSQL Credits by Role</h2>
          </div>
          <span class="dim" style="font-size:12px;">Authored · Reviewed · Reported</span>
        </div>
        ${renderCareerChartSvg(profile.careerByYear)}
      </div>

      <div class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Subsystem Signature (vs PG Average)</div>
            <h2>Subsystem DNA &amp; Specialization Over-Index</h2>
          </div>
        </div>
        <div class="subsys-list">
          ${
            profile.subsystems.length === 0
              ? `<div class="muted" style="font-size:12.5px;">No subsystem data recorded yet.</div>`
              : profile.subsystems
                  .slice(0, 8)
                  .map((s) => {
                    const oi = s.overIndex ?? 1;
                    const oiBadge =
                      oi >= 1.5
                        ? `<span class="pill p-ok mono" style="font-size:10px;padding:1px 6px;">${oi.toFixed(1)}× PG avg</span>`
                        : oi > 0
                          ? `<span class="dim mono" style="font-size:10.5px;">${oi.toFixed(1)}×</span>`
                          : "";
                    return `
              <div class="subsys-row viz-hoverable" style="cursor:default;" tabindex="0" data-tip-title="${esc(s.name)}" data-tip-body="${fmtNum(s.count)} credits (${s.pct}% of ${esc(p.name)}'s work)" data-tip-sub="PostgreSQL project baseline: ${s.projectPct ?? "—"}% (${oi.toFixed(1)}× specialization)">
                <div class="subsys-head">
                  <span class="hbar-label">${esc(s.name)} ${oiBadge}</span>
                  <span class="mono dim">${fmtNum(s.count)} (${s.pct}%)</span>
                </div>
                <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(4, s.pct)}%;"></div></div>
              </div>
            `;
                  })
                  .join("")
          }
        </div>
      </div>
    </div>

    <!-- Radial 24h UTC Circadian Clock + Interactive 3-Sector Collaboration Constellation -->
    <div class="grid2" style="margin-bottom:14px;">
      <div class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Circadian Fingerprint (UTC)</div>
            <h2>24-Hour Hacking Clock &amp; Day-of-Week Ring</h2>
            <div class="dim" style="font-size:12px;">Wedge radius ∝ √activity · Outer ring = Sun–Sat UTC</div>
          </div>
        </div>
        ${renderRadialUtcClockSvg(profile.rhythm.byHour, profile.rhythm.byDow, profile.rhythm.activeDays, profile.rhythm.longestStreakDays)}
      </div>

      <div class="card viz-card" style="margin-bottom:0;">
        <div class="card-head">
          <div>
            <div class="viz-kicker">Collaboration Constellation</div>
            <h2>Who ${esc(p.name)} Works Most With</h2>
            <div class="dim" style="font-size:12px;">3 deterministic 120° sectors · Click any collaborator to jump</div>
          </div>
        </div>
        ${renderCollabConstellationSvg(p.name, profile.collaborators) || `<div class="empty-state">No collaboration links recorded yet.</div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>Collaboration Pairs (Full Breakdown)</h2>
          <div class="dim" style="font-size:12px;">Derived from git Author, Committer, and Reviewed-by links — tap anyone to open their profile</div>
        </div>
      </div>
      <div class="obs-collab-grid">
        ${renderCollabGroup("Patches committed by", profile.collaborators.committedBy)}
        ${renderCollabGroup("Patches reviewed by", profile.collaborators.reviewedBy)}
        ${renderCollabGroup("Authors helped (reviewed / committed)", profile.collaborators.helpedAuthors)}
      </div>
    </div>
        `
        : ""
    }

    <!-- Tabbed Activity Feed -->
    <div class="mr-tabs" id="hacker-activity-feed" role="tablist" aria-label="Hacker activity feed">
      <button type="button" class="mr-tab ${activeTab === "commits" ? "active" : ""}" data-hacker-tab="commits">
        <span>Recent Commits</span>
        <span class="mr-tab-count">${profile.recentCommits.length}</span>
      </button>
      <button type="button" class="mr-tab ${activeTab === "reviews" ? "active" : ""}" data-hacker-tab="reviews">
        <span>Reviews &amp; Reports</span>
        <span class="mr-tab-count">${profile.recentReviews.length}</span>
      </button>
      <button type="button" class="mr-tab ${activeTab === "commitfest" ? "active" : ""}" data-hacker-tab="commitfest">
        <span>CommitFest</span>
        <span class="mr-tab-count">${profile.commitfestEntries.length}</span>
      </button>
      <button type="button" class="mr-tab ${activeTab === "lists" ? "active" : ""}" data-hacker-tab="lists">
        <span>Mailing Lists</span>
        <span class="mr-tab-count">${profile.mailingLists?.totalMessages ?? 0}</span>
      </button>
      <button type="button" class="mr-tab ${activeTab === "opinions" ? "active" : ""}" data-hacker-tab="opinions">
        <span>pgroast Roasts</span>
        <span class="mr-tab-count">${profile.opinions.length}</span>
      </button>
    </div>

    ${renderFeedTab()}
  `;
}
