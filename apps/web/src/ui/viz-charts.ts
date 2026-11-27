// World-class, zero-dependency, CSP-safe, 8-theme-adaptive editorial SVG visualization suite.
// All dynamic values are escaped; tooltips are rendered via textContent by viz-engine.ts.

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

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, rIn: number, rOut: number, startDeg: number, endDeg: number): string {
  const p1 = polarToCartesian(cx, cy, rOut, startDeg);
  const p2 = polarToCartesian(cx, cy, rOut, endDeg);
  const p3 = polarToCartesian(cx, cy, rIn, endDeg);
  const p4 = polarToCartesian(cx, cy, rIn, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOut.toFixed(2)} ${rOut.toFixed(2)} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rIn.toFixed(2)} ${rIn.toFixed(2)} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/* ============================================================================
 * 1. HACKERS: PG17 -> PG20 Release-Cycle Velocity Race + Review Share
 * ============================================================================ */
export interface ReleaseCycleSeries {
  major: string;
  points: Array<{ week: number; commits: number; cumCommits: number; cumReviewed: number; reviewPct: number }>;
}

export function renderReleaseCycleRaceSvg(cycles: ReleaseCycleSeries[]): { headline: string; subline: string; svg: string } {
  if (!cycles || cycles.length === 0) {
    return { headline: "Release-Cycle Pace", subline: "No PG17–PG20 cycle data synced yet.", svg: `<div class="empty-state">No cycle data yet.</div>` };
  }

  const pg20 = cycles.find((c) => c.major === "PG20");
  const pg19 = cycles.find((c) => c.major === "PG19");
  const pg20Last = pg20?.points[pg20.points.length - 1];
  const pg19AtSameWk = pg20Last ? pg19?.points.filter((p) => p.week <= pg20Last.week).pop() : undefined;

  let headline = "PostgreSQL Release-Cycle Pace (PG17–PG20)";
  let subline = "Cumulative master commits by week since June 25 branch cut";
  if (pg20Last && pg19AtSameWk && pg19AtSameWk.cumCommits > 0) {
    const deltaPct = Math.round(((pg20Last.cumCommits - pg19AtSameWk.cumCommits) / pg19AtSameWk.cumCommits) * 100);
    const sign = deltaPct >= 0 ? "+" : "";
    headline = `Through week ${pg20Last.week} of PG20: ${fmtNum(pg20Last.cumCommits)} commits vs ${fmtNum(pg19AtSameWk.cumCommits)} in PG19 (${sign}${deltaPct}%)`;
    subline = `Credited Reviewed-by coverage: ${pg20Last.reviewPct}% in PG20 vs ${pg19AtSameWk.reviewPct}% at week ${pg20Last.week} of PG19 · June 25 cycle boundary`;
  }

  const w = 680;
  const h = 228;
  const padL = 46;
  const padR = 54;
  const padT = 16;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxWeek = 53;
  const maxCum = Math.max(100, ...cycles.flatMap((c) => c.points.map((p) => p.cumCommits)));

  const xOf = (wk: number) => padL + ((wk - 1) / (maxWeek - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - (val / maxCum) * plotH;

  // Shaded Feature Freeze band (~weeks 36-41: March–early April)
  const ffX1 = xOf(36);
  const ffX2 = xOf(42);

  // Horizontal gridlines
  const yTicks = [0, Math.round(maxCum * 0.25), Math.round(maxCum * 0.5), Math.round(maxCum * 0.75), maxCum];
  const gridLines = yTicks
    .map((v) => {
      const y = yOf(v);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="${v === 0 ? "" : "3 3"}" />
        <text x="${padL - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--viz-axis)" font-size="10.5" class="mono">${fmtNum(v)}</text>
      `;
    })
    .join("");

  const xTicks = [1, 13, 26, 39, 52]
    .map((wk) => {
      const x = xOf(wk);
      const lbl = wk === 1 ? "Wk 1 (Jun)" : wk === 13 ? "Wk 13 (Sep)" : wk === 26 ? "Wk 26 (Dec)" : wk === 39 ? "Wk 39 (Mar)" : "Wk 52 (Jun)";
      return `<text x="${x.toFixed(1)}" y="${h - 7}" text-anchor="middle" fill="var(--viz-axis)" font-size="10">${lbl}</text>`;
    })
    .join("");

  const colors: Record<string, { stroke: string; width: number; opacity: number }> = {
    PG17: { stroke: "var(--viz-muted-line)", width: 1.4, opacity: 0.55 },
    PG18: { stroke: "var(--viz-muted-line)", width: 1.6, opacity: 0.75 },
    PG19: { stroke: "var(--viz-2)", width: 2.1, opacity: 0.9 },
    PG20: { stroke: "var(--viz-1)", width: 3.0, opacity: 1 },
  };

  // Prevent overlapping end labels
  const endLabels: Array<{ major: string; x: number; y: number; color: string; bold: boolean }> = [];

  const paths = cycles
    .map((c) => {
      const style = colors[c.major] || { stroke: "var(--viz-axis)", width: 1.5, opacity: 0.7 };
      const pts = c.points.map((p) => `${xOf(p.week).toFixed(1)},${yOf(p.cumCommits).toFixed(1)}`).join(" ");
      const last = c.points[c.points.length - 1];
      if (last) {
        endLabels.push({
          major: c.major,
          x: xOf(last.week) + 6,
          y: yOf(last.cumCommits) + 3.5,
          color: c.major === "PG20" ? "var(--viz-1)" : c.major === "PG19" ? "var(--viz-2)" : "var(--muted)",
          bold: c.major === "PG20" || c.major === "PG19",
        });
      }
      const area =
        c.major === "PG20" && c.points.length >= 2
          ? `<polygon points="${xOf(c.points[0]!.week).toFixed(1)},${(padT + plotH).toFixed(1)} ${pts} ${xOf(last!.week).toFixed(1)},${(padT + plotH).toFixed(1)}" fill="var(--viz-1)" fill-opacity="0.10" />`
          : "";
      const endDot = last
        ? `<circle cx="${xOf(last.week).toFixed(1)}" cy="${yOf(last.cumCommits).toFixed(1)}" r="${c.major === "PG20" ? 4.2 : 2.8}" fill="${style.stroke}" />`
        : "";
      return `${area}<polyline fill="none" stroke="${style.stroke}" stroke-width="${style.width}" stroke-opacity="${style.opacity}" stroke-linejoin="round" stroke-linecap="round" points="${pts}" />${endDot}`;
    })
    .join("");

  // Simple vertical collision resolution for end labels
  endLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i]!.y - endLabels[i - 1]!.y < 13) {
      endLabels[i]!.y = endLabels[i - 1]!.y + 13;
    }
  }
  const labelsSvg = endLabels
    .map(
      (l) =>
        `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" fill="${l.color}" font-size="11" font-weight="${l.bold ? 700 : 500}" class="mono">${esc(l.major)}</text>`,
    )
    .join("");

  // Interactive invisible week slices for crosshair tooltip comparing all cycles at week W
  const hitSlices: string[] = [];
  for (let wk = 1; wk <= maxWeek; wk++) {
    const cx = xOf(wk);
    const sliceW = plotW / maxWeek;
    const rowsAtWk = cycles
      .map((c) => {
        const pt = c.points.filter((p) => p.week <= wk).pop();
        if (!pt || (c.major === "PG20" && pg20Last && wk > pg20Last.week)) return null;
        return `${c.major}: ${fmtNum(pt.cumCommits)} (${pt.reviewPct}% rev)`;
      })
      .filter(Boolean);
    if (rowsAtWk.length === 0) continue;
    hitSlices.push(
      `<rect x="${(cx - sliceW / 2).toFixed(1)}" y="${padT}" width="${sliceW.toFixed(1)}" height="${plotH}" fill="transparent" class="viz-slice" tabindex="0" data-tip-title="Cycle Week ${wk}" data-tip-body="${esc(rowsAtWk.join(" · "))}" data-tip-sub="Cumulative master commits since June 25 branch cut" />`,
    );
  }

  const svg = `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="${esc(headline)}">
      <rect x="${ffX1.toFixed(1)}" y="${padT}" width="${(ffX2 - ffX1).toFixed(1)}" height="${plotH}" fill="var(--viz-3)" fill-opacity="0.08" />
      <text x="${((ffX1 + ffX2) / 2).toFixed(1)}" y="${padT + 11}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5">Feature Freeze</text>
      ${gridLines}
      ${paths}
      ${labelsSvg}
      ${xTicks}
      ${hitSlices.join("")}
    </svg>
  `;
  return { headline, subline, svg };
}

/* ============================================================================
 * 2. HACKERS: Subsystem Bus-Factor Quadrant (Effective Committers vs Commits)
 * ============================================================================ */
export interface SubsystemBusFactorItem {
  name: string;
  commits: number;
  authors: number;
  committers: number;
  busFactor?: number;
  bfCommits?: number;
  effectiveCommitters?: number;
  top1Pct?: number;
  topCommitter?: string;
  topSlug?: string;
}

export function renderBusFactorQuadrantSvg(subsystems: SubsystemBusFactorItem[]): { headline: string; subline: string; svg: string } {
  if (!subsystems || subsystems.length === 0) {
    return { headline: "Subsystem Bus Factor", subline: "No subsystem data.", svg: `<div class="empty-state">No data.</div>` };
  }
  const thin = subsystems.filter((s) => (s.effectiveCommitters ?? s.committers) <= 2.5 && s.commits >= 15);
  const topSub = subsystems[0]!;
  const headline =
    thin.length > 0
      ? `${thin.length} subsystem${thin.length === 1 ? "" : "s"} depend on ≤2.5 effective committers`
      : `${topSub.name} leads with ${fmtNum(topSub.commits)} commits across ${topSub.committers} committers`;
  const subline = "X: effective committers (1/HHI) · Y: commits · circle area: unique authors · red ring: single committer >50%";

  const w = 660;
  const h = 248;
  const padL = 48;
  const padR = 24;
  const padT = 18;
  const padB = 32;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxX = Math.max(8, ...subsystems.map((s) => s.effectiveCommitters ?? s.committers ?? 1)) * 1.1;
  const maxY = Math.max(10, ...subsystems.map((s) => s.commits)) * 1.12;
  const maxAuth = Math.max(1, ...subsystems.map((s) => s.authors));

  const xOf = (v: number) => padL + (v / maxX) * plotW;
  const yOf = (v: number) => padT + plotH - (v / maxY) * plotH;
  const dangerX = xOf(Math.min(2.5, maxX));

  const yTicks = [0, Math.round(maxY * 0.33), Math.round(maxY * 0.66), Math.round(maxY)];
  const xTicks = [0, 2, 4, 6, 8, 10, 12].filter((v) => v <= maxX);

  const grid =
    yTicks
      .map((v) => {
        const y = yOf(v);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="${v === 0 ? "" : "3 3"}" />
                <text x="${padL - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">${fmtNum(v)}</text>`;
      })
      .join("") +
    xTicks
      .map((v) => {
        const x = xOf(v);
        return `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="var(--viz-grid)" />
                <text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="var(--viz-axis)" font-size="10" class="mono">${v}</text>`;
      })
      .join("");

  const placedLabels: Array<{ x: number; y: number; text: string; anchor: string }> = [];
  const dots = subsystems
    .map((s) => {
      const eff = s.effectiveCommitters ?? s.committers ?? 1;
      const cx = xOf(eff);
      const cy = yOf(s.commits);
      const r = 5 + Math.sqrt(s.authors / maxAuth) * 11;
      const top1 = s.top1Pct ?? 0;
      const isRisk = top1 >= 50 || eff <= 2.5;
      const fill = isRisk ? "var(--viz-3)" : "var(--viz-1)";
      const ring = top1 >= 50 ? `stroke="var(--viz-5)" stroke-width="2.2"` : `stroke="var(--surface)" stroke-width="1.2"`;
      const bfText = `${s.busFactor ?? 1} committer${(s.busFactor ?? 1) === 1 ? "" : "s"} landed ${fmtNum(s.bfCommits ?? s.commits)} of ${fmtNum(s.commits)} commits`;
      const topText = s.topCommitter ? `Top: ${s.topCommitter} (${top1}%) · ${eff.toFixed(1)} effective committers · ${s.authors} authors` : `${s.committers} committers · ${s.authors} authors`;

      // Label top 7 subsystems by commit volume or risk
      if (s.commits >= maxY * 0.16 || isRisk) {
        const anchor = cx > w - 135 ? "end" : "start";
        let ly = cy - r - 4;
        for (const prev of placedLabels) {
          if (Math.abs(prev.x - cx) < 95 && Math.abs(prev.y - ly) < 13) {
            ly = prev.y - 13;
          }
        }
        if (ly < padT + 10) ly = cy + r + 12;
        placedLabels.push({ x: anchor === "end" ? cx - r - 3 : cx + r + 3, y: ly, text: s.name.split("/")[0]!.trim(), anchor });
      }

      const clickAttr = s.topSlug ? `data-open-hacker="${esc(s.topSlug)}"` : "";
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="0.76" ${ring} class="viz-hoverable" tabindex="0" ${clickAttr} data-tip-title="${esc(s.name)}" data-tip-body="${esc(bfText)}" data-tip-sub="${esc(topText)}" />`;
    })
    .join("");

  const labels = placedLabels
    .map(
      (l) =>
        `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="${l.anchor}" fill="var(--text)" font-size="10.5" font-weight="500" pointer-events="none">${esc(l.text)}</text>`,
    )
    .join("");

  const svg = `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="${esc(headline)}">
      <rect x="${padL}" y="${padT}" width="${Math.max(0, dangerX - padL).toFixed(1)}" height="${plotH}" fill="var(--viz-5)" fill-opacity="0.07" />
      <text x="${(padL + 5).toFixed(1)}" y="${padT + 12}" fill="var(--viz-5)" font-size="9.5" font-weight="600">Thin bench (≤2.5)</text>
      ${grid}
      ${dots}
      ${labels}
      <text x="${(padL + plotW / 2).toFixed(1)}" y="${h - 0}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5">Effective committers (1 / HHI)</text>
    </svg>
  `;
  return { headline, subline, svg };
}

/* ============================================================================
 * 3. HACKERS: Annual Committer Concentration (100% Stacked) + Bus-Factor Line
 * ============================================================================ */
export interface ConcentrationYearPoint {
  year: string;
  total: number;
  committers: number;
  busFactor: number;
  top1Pct: number;
  rank2_5Pct: number;
  rank6_10Pct: number;
  restPct: number;
}

export function renderCommitterConcentrationSvg(rows: ConcentrationYearPoint[]): { headline: string; subline: string; svg: string } {
  if (!rows || rows.length === 0) {
    return { headline: "Committer Concentration", subline: "No annual data.", svg: `<div class="empty-state">No data.</div>` };
  }
  const latest = rows[rows.length - 1]!;
  const top10 = Math.round((latest.top1Pct + latest.rank2_5Pct + latest.rank6_10Pct) * 10) / 10;
  const headline = `In ${latest.year}, the top 10 committers landed ${top10}% of commits (bus factor: ${latest.busFactor})`;
  const subline = "Stacked share by committer rank (#1, #2–5, #6–10, rest) with 50% bus-factor line overlaid";

  const w = 660;
  const h = 216;
  const padL = 38;
  const padR = 38;
  const padT = 14;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const step = plotW / Math.max(1, rows.length);
  const barW = Math.max(14, Math.min(36, step * 0.64));
  const maxBf = Math.max(10, ...rows.map((r) => r.busFactor));

  const yPct = (p: number) => padT + plotH - (p / 100) * plotH;
  const yBf = (bf: number) => padT + plotH - (bf / maxBf) * plotH;

  const grid = [0, 25, 50, 75, 100]
    .map((p) => {
      const y = yPct(p);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="${p === 50 ? "4 3" : ""}" />
              <text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">${p}%</text>`;
    })
    .join("");

  const bars = rows
    .map((r, i) => {
      const x = padL + i * step + (step - barW) / 2;
      const segs = [
        { pct: r.top1Pct, fill: "var(--viz-5)", op: 0.72 },
        { pct: r.rank2_5Pct, fill: "var(--viz-3)", op: 0.72 },
        { pct: r.rank6_10Pct, fill: "var(--viz-1)", op: 0.7 },
        { pct: r.restPct, fill: "var(--viz-2)", op: 0.55 },
      ];
      let curPct = 0;
      const rects = segs
        .map((sg) => {
          const y1 = yPct(curPct + sg.pct);
          const y0 = yPct(curPct);
          curPct += sg.pct;
          return `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, y0 - y1).toFixed(1)}" fill="${sg.fill}" fill-opacity="${sg.op}" />`;
        })
        .join("");
      const top10Yr = Math.round((r.top1Pct + r.rank2_5Pct + r.rank6_10Pct) * 10) / 10;
      const tipBody = `#1: ${r.top1Pct}% · #2–5: ${r.rank2_5Pct}% · #6–10: ${r.rank6_10Pct}% · Rest: ${r.restPct}%`;
      const tipSub = `Bus factor (50% of commits): ${r.busFactor} of ${r.committers} active committers · Top 10: ${top10Yr}% (${fmtNum(r.total)} commits)`;
      return `
        <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(r.year)} Committer Concentration" data-tip-body="${esc(tipBody)}" data-tip-sub="${esc(tipSub)}">
          ${rects}
          <text x="${(x + barW / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" fill="var(--viz-axis)" font-size="10" class="mono">${esc(r.year.slice(2))}</text>
        </g>
      `;
    })
    .join("");

  const bfLine = rows
    .map((r, i) => `${(padL + i * step + step / 2).toFixed(1)},${yBf(r.busFactor).toFixed(1)}`)
    .join(" ");
  const bfDots = rows
    .map((r, i) => {
      const cx = padL + i * step + step / 2;
      const cy = yBf(r.busFactor);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.4" fill="var(--surface)" stroke="var(--text)" stroke-width="2" pointer-events="none" />
              <text x="${cx.toFixed(1)}" y="${(cy - 7).toFixed(1)}" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="700" class="mono" pointer-events="none">${r.busFactor}</text>`;
    })
    .join("");

  const svg = `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="${esc(headline)}">
      ${grid}
      ${bars}
      <polyline fill="none" stroke="var(--text)" stroke-width="2" points="${bfLine}" pointer-events="none" />
      ${bfDots}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-5)"></span>#1 Committer</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Ranks #2–5</span>
      <span><span class="dot" style="background:var(--viz-1)"></span>Ranks #6–10</span>
      <span><span class="dot" style="background:var(--viz-2)"></span>Everyone else</span>
      <span><span class="dot" style="background:var(--text)"></span>Bus factor (50% threshold)</span>
    </div>
  `;
  return { headline, subline, svg };
}

/* ============================================================================
 * 4. HACKERS: Sponsorship Velocity (Own vs For-Others) + Reviews/Commit Line
 * ============================================================================ */
export function renderSponsorshipTimelineSvg(
  timeline: Array<{ period: string; commits: number; forOthers?: number; reviews: number; activeHackers: number }>,
): string {
  if (!timeline || timeline.length === 0) return `<div class="empty-state">No timeline data in this window.</div>`;
  const w = 660;
  const h = 196;
  const padL = 40;
  const padR = 56;
  const padT = 14;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxCommits = Math.max(1, ...timeline.map((d) => d.commits));
  const ratios = timeline.map((d) => (d.commits > 0 ? d.reviews / d.commits : 0));
  const maxRatio = Math.max(1.2, ...ratios);
  const step = plotW / Math.max(1, timeline.length);
  const barW = Math.max(5, Math.min(24, step * 0.68));

  const yCommit = (v: number) => padT + plotH - (v / maxCommits) * plotH;
  const yRatio = (r: number) => padT + plotH - (r / maxRatio) * plotH;

  const bars = timeline
    .map((d, i) => {
      const x = padL + i * step + (step - barW) / 2;
      const fo = Math.min(d.commits, d.forOthers ?? 0);
      const own = Math.max(0, d.commits - fo);
      const yFo = yCommit(fo);
      const yAll = yCommit(d.commits);
      const y0 = padT + plotH;
      const foPct = d.commits > 0 ? Math.round((fo / d.commits) * 100) : 0;
      const revRatio = d.commits > 0 ? (d.reviews / d.commits).toFixed(2) : "0.00";
      return `
        <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(d.period)}" data-tip-body="${fmtNum(d.commits)} commits (${fmtNum(fo)} for others · ${foPct}%)" data-tip-sub="${fmtNum(d.reviews)} review credits (${revRatio}/commit) · ${fmtNum(d.activeHackers)} active hackers">
          <rect x="${x.toFixed(1)}" y="${yFo.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, y0 - yFo).toFixed(1)}" rx="2" fill="var(--viz-1)" />
          ${own > 0 ? `<rect x="${x.toFixed(1)}" y="${yAll.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, yFo - yAll).toFixed(1)}" rx="2" fill="var(--viz-1)" fill-opacity="0.34" />` : ""}
        </g>
      `;
    })
    .join("");

  const ratioPts = timeline
    .map((d, i) => `${(padL + i * step + step / 2).toFixed(1)},${yRatio(d.commits > 0 ? d.reviews / d.commits : 0).toFixed(1)}`)
    .join(" ");

  const labelStep = Math.max(1, Math.ceil(timeline.length / 7));
  const xLabels = timeline
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== timeline.length - 1) return "";
      return `<text x="${(padL + i * step + step / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" fill="var(--viz-axis)" font-size="10" class="mono">${esc(d.period)}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Sponsorship velocity and review ratio">
      <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="var(--viz-grid)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${(padT + plotH / 2).toFixed(1)}" x2="${w - padR}" y2="${(padT + plotH / 2).toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--border)" />
      <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">${fmtNum(maxCommits)}</text>
      <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">0</text>
      <text x="${w - padR + 5}" y="${padT + 8}" text-anchor="start" fill="var(--viz-2)" font-size="9.5" class="mono">${maxRatio.toFixed(1)}× rev</text>
      ${bars}
      <polyline fill="none" stroke="var(--viz-2)" stroke-width="2" stroke-linejoin="round" points="${ratioPts}" pointer-events="none" />
      ${xLabels}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-1)"></span>Committed for others</span>
      <span><span class="dot" style="background:var(--viz-1);opacity:0.38"></span>Own commits</span>
      <span><span class="dot" style="background:var(--viz-2)"></span>Reviews / commit ratio</span>
    </div>
  `;
}

/* ============================================================================
 * 5. PROFILE: 24-Hour Radial UTC Circadian Clock + Outer Day-of-Week Ring
 * ============================================================================ */
export function renderRadialUtcClockSvg(
  byHour: number[],
  byDow: number[],
  activeDays: number,
  longestStreak: number,
): string {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (total === 0) return `<div class="empty-state">No UTC timestamp data yet.</div>`;

  let peakHour = 0;
  let maxH = 0;
  byHour.forEach((v, h) => {
    if (v > maxH) {
      maxH = v;
      peakHour = h;
    }
  });
  const maxDow = Math.max(1, ...byDow);
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const size = 290;
  const cx = size / 2;
  const cy = size / 2;
  const rInner = 46;
  const rMax = 104;
  const rDowIn = 115;
  const rDowOut = 123;

  const guides = [0.33, 0.66, 1]
    .map(
      (f) =>
        `<circle cx="${cx}" cy="${cy}" r="${(rInner + (rMax - rInner) * f).toFixed(1)}" fill="none" stroke="var(--viz-grid)" stroke-dasharray="2 3" />`,
    )
    .join("");

  const wedges = byHour
    .map((v, h) => {
      const startDeg = h * 15;
      const endDeg = startDeg + 13.4;
      const rOut = rInner + Math.sqrt(v / Math.max(1, maxH)) * (rMax - rInner);
      const pct = Math.round((v / total) * 1000) / 10;
      const isPeak = h === peakHour;
      const fill = isPeak ? "var(--viz-2)" : "var(--viz-1)";
      const op = v === 0 ? 0.08 : (0.28 + (v / Math.max(1, maxH)) * 0.68).toFixed(2);
      const d = sectorPath(cx, cy, rInner, Math.max(rInner + 3, rOut), startDeg, endDeg);
      return `<path d="${d}" fill="${fill}" fill-opacity="${op}" class="viz-hoverable" tabindex="0" data-tip-title="${String(h).padStart(2, "0")}:00 – ${String(h).padStart(2, "0")}:59 UTC" data-tip-body="${fmtNum(v)} credits (${pct}% of activity)" data-tip-sub="${isPeak ? "Peak hacking hour" : "UTC commit & review rhythm"}" />`;
    })
    .join("");

  const hourMarks = [0, 6, 12, 18]
    .map((h) => {
      const p = polarToCartesian(cx, cy, rMax + 9, h * 15);
      return `<text x="${p.x.toFixed(1)}" y="${(p.y + 3).toFixed(1)}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5" class="mono">${String(h).padStart(2, "0")}h</text>`;
    })
    .join("");

  // Outer 7-day DOW ring
  const dowArcs = byDow
    .map((v, d) => {
      const step = 360 / 7;
      const s = d * step + 2;
      const e = (d + 1) * step - 2;
      const op = (0.14 + (v / maxDow) * 0.78).toFixed(2);
      const path = sectorPath(cx, cy, rDowIn, rDowOut, s, e);
      return `<path d="${path}" fill="var(--viz-2)" fill-opacity="${op}" class="viz-hoverable" tabindex="0" data-tip-title="${dowNames[d]} (UTC)" data-tip-body="${fmtNum(v)} credits" data-tip-sub="Outer ring: day-of-week activity" />`;
    })
    .join("");

  return `
    <div class="viz-clock-wrap">
      <svg viewBox="0 0 ${size} ${size}" class="viz-clock-svg" role="img" aria-label="24-hour UTC circadian hacking clock">
        ${guides}
        ${wedges}
        ${dowArcs}
        ${hourMarks}
        <circle cx="${cx}" cy="${cy}" r="${rInner - 2}" fill="var(--surface)" stroke="var(--border)" />
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="var(--viz-axis)" font-size="9" font-weight="600">PEAK UTC</text>
        <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="var(--text)" font-size="16" font-weight="700" class="mono">${String(peakHour).padStart(2, "0")}:00</text>
        <text x="${cx}" y="${cy + 24}" text-anchor="middle" fill="var(--muted)" font-size="9.5" class="mono">${fmtNum(activeDays)}d · ${longestStreak}d strk</text>
      </svg>
    </div>
  `;
}

/* ============================================================================
 * 6. PROFILE: Deterministic 3-Sector Collaboration Constellation (Ego-Graph)
 * ============================================================================ */
export interface CollabNode {
  slug: string;
  name: string;
  role: string;
  count: number;
}

export function renderCollabConstellationSvg(
  centerName: string,
  collaborators: { committedBy: CollabNode[]; reviewedBy: CollabNode[]; helpedAuthors: CollabNode[] },
): string {
  const sectors: Array<{
    title: string;
    verb: string;
    color: string;
    baseDeg: number;
    nodes: CollabNode[];
  }> = [
    { title: "Committed their patches", verb: "Landed patches by", color: "var(--viz-1)", baseDeg: 270, nodes: collaborators.committedBy.slice(0, 5) },
    { title: "Reviewed their patches", verb: "Reviewed patches by", color: "var(--viz-2)", baseDeg: 30, nodes: collaborators.reviewedBy.slice(0, 5) },
    { title: "Authors they helped", verb: "Helped author", color: "var(--viz-3)", baseDeg: 150, nodes: collaborators.helpedAuthors.slice(0, 5) },
  ];

  const totalNodes = sectors.reduce((a, s) => a + s.nodes.length, 0);
  if (totalNodes === 0) return "";

  const w = 680;
  const h = 320;
  const cx = w / 2;
  const cy = h / 2 + 6;
  const maxCnt = Math.max(1, ...sectors.flatMap((s) => s.nodes.map((n) => n.count)));

  // Subtle sector dividers & concentric rings
  const rings = [72, 118]
    .map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--viz-grid)" stroke-dasharray="3 3" />`)
    .join("");

  const dividers = [330, 90, 210]
    .map((deg) => {
      const p = polarToCartesian(cx, cy, 136, deg);
      return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--viz-grid)" />`;
    })
    .join("");

  const sectorHeaders = sectors
    .map((sec) => {
      const p = polarToCartesian(cx, cy, 146, sec.baseDeg);
      const yAdj = Math.max(14, Math.min(h - 8, p.y));
      const xAdj = Math.max(84, Math.min(w - 84, p.x));
      return `<text x="${xAdj.toFixed(1)}" y="${yAdj.toFixed(1)}" text-anchor="middle" fill="${sec.color}" font-size="10.5" font-weight="650">${esc(sec.title)}</text>`;
    })
    .join("");

  const links: string[] = [];
  const bubbles: string[] = [];

  for (const sec of sectors) {
    const n = sec.nodes.length;
    sec.nodes.forEach((node, idx) => {
      const spread = n === 1 ? 0 : ((idx / (n - 1)) - 0.5) * 74;
      const deg = sec.baseDeg + spread;
      // Closer to center = tighter collaboration
      const dist = idx === 0 ? 74 : idx <= 2 ? 98 : 118;
      const pos = polarToCartesian(cx, cy, dist, deg);
      const r = 7 + Math.sqrt(node.count / maxCnt) * 12;
      const sw = 1.2 + (node.count / maxCnt) * 3.2;

      // Quadratic curve control point rotated slightly for elegance
      const mid = polarToCartesian(cx, cy, dist * 0.52, deg + 9);
      links.push(
        `<path d="M ${cx} ${cy} Q ${mid.x.toFixed(1)} ${mid.y.toFixed(1)} ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}" fill="none" stroke="${sec.color}" stroke-opacity="0.38" stroke-width="${sw.toFixed(1)}" />`,
      );

      const initials = node.name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0] || "")
        .join("")
        .toUpperCase();
      const shortName = node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name;
      const lblX = pos.x < cx ? pos.x - r - 5 : pos.x + r + 5;
      const lblAnchor = pos.x < cx ? "end" : "start";

      bubbles.push(`
        <g class="viz-hoverable" tabindex="0" data-open-hacker="${esc(node.slug)}" data-tip-title="${esc(node.name)} (${esc(node.role)})" data-tip-body="${esc(sec.title)}: ${fmtNum(node.count)} shared commits" data-tip-sub="Click to open /hacker/${esc(node.slug)}">
          <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${sec.color}" fill-opacity="0.88" stroke="var(--surface)" stroke-width="1.8" />
          <text x="${pos.x.toFixed(1)}" y="${(pos.y + 3.2).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="${r > 12 ? 9.5 : 8}" font-weight="700" pointer-events="none">${esc(initials)}</text>
          ${idx < 3 ? `<text x="${lblX.toFixed(1)}" y="${(pos.y + 3.5).toFixed(1)}" text-anchor="${lblAnchor}" fill="var(--text)" font-size="10.5" font-weight="500" pointer-events="none">${esc(shortName)} <tspan fill="var(--dim)" class="mono">(${node.count})</tspan></text>` : ""}
        </g>
      `);
    });
  }

  const centerInitials = centerName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase();

  return `
    <div class="viz-constellation-wrap">
      <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Collaboration constellation for ${esc(centerName)}">
        ${rings}
        ${dividers}
        ${links.join("")}
        ${sectorHeaders}
        ${bubbles.join("")}
        <circle cx="${cx}" cy="${cy}" r="22" fill="var(--surface)" stroke="var(--viz-1)" stroke-width="2.6" />
        <text x="${cx}" y="${cy + 4.5}" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="700">${esc(centerInitials)}</text>
      </svg>
    </div>
  `;
}

/* ============================================================================
 * 7. STATS: CommitFest Status x AI Verdict Marimekko Mosaic
 * ============================================================================ */
export interface StatusMatrixRow {
  status: string;
  isClosed: boolean;
  total: number;
  counts: Record<string, number>;
}

export function renderStatusVerdictMarimekkoSvg(rows: StatusMatrixRow[]): { headline: string; subline: string; callouts: string; svg: string } {
  const openRows = rows.filter((r) => !r.isClosed && r.total > 0);
  const useRows = openRows.length > 0 ? openRows : rows.filter((r) => r.total > 0);
  if (useRows.length === 0) {
    return { headline: "CommitFest Status × AI Verdict", subline: "No status matrix available.", callouts: "", svg: "" };
  }

  const totalPatches = useRows.reduce((a, r) => a + r.total, 0);
  const rfcRow = useRows.find((r) => r.status.toLowerCase().includes("ready for committer"));
  const nrRow = useRows.find((r) => r.status.toLowerCase().includes("needs review"));
  const rfcReject = rfcRow?.counts["LIKELY-REJECT"] ?? 0;
  const nrClean = nrRow?.counts["NO-FUNDAMENTAL-OBJECTION"] ?? 0;

  const headline =
    rfcRow && rfcReject > 0
      ? `${rfcReject} Ready-for-Committer patch${rfcReject === 1 ? "" : "es"} flagged Likely Reject · ${nrClean} Needs-Review roasted clean`
      : `${fmtNum(totalPatches)} open CommitFest patches mapped from CF status to AI roast verdict`;
  const subline = "Band height = patches in status · segment width = verdict share · click any rectangle to filter Entries";

  const callouts = [
    rfcRow && rfcReject > 0
      ? `<button type="button" class="viz-callout-chip is-warn" data-mx-status="${esc(rfcRow.status)}" data-mx-verdict="LIKELY-REJECT">⚠ ${rfcReject} disagreement${rfcReject === 1 ? "" : "s"}: Ready for Committer × Likely Reject →</button>`
      : "",
    nrRow && nrClean > 0
      ? `<button type="button" class="viz-callout-chip is-ok" data-mx-status="${esc(nrRow.status)}" data-mx-verdict="NO-FUNDAMENTAL-OBJECTION">✓ ${nrClean} promotion candidate${nrClean === 1 ? "" : "s"}: Needs Review × No Objection →</button>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const verdictOrder: Array<{ key: string; label: string; fill: string; hatched?: boolean }> = [
    { key: "NO-FUNDAMENTAL-OBJECTION", label: "No objection", fill: "var(--viz-2)" },
    { key: "NEEDS-COMMITTER-EYES", label: "Committer eyes", fill: "var(--viz-1)" },
    { key: "NEEDS-DESIGN-DISCUSSION", label: "Design disc.", fill: "var(--viz-3)" },
    { key: "LIKELY-REJECT", label: "Likely reject", fill: "var(--viz-5)" },
    { key: "UNROASTED", label: "Not roasted", fill: "url(#viz-hatch)", hatched: true },
  ];

  const w = 680;
  const padL = 162;
  const padR = 44;
  const padT = 8;
  const plotW = w - padL - padR;
  const totalBarH = 190;
  const gapY = 6;

  let curY = padT;
  const bands = useRows
    .map((row) => {
      const bh = Math.max(26, (row.total / Math.max(1, totalPatches)) * totalBarH);
      let curX = padL;
      const segs = verdictOrder
        .map((v) => {
          const cnt = row.counts[v.key] ?? 0;
          if (cnt <= 0) return "";
          const sw = (cnt / Math.max(1, row.total)) * plotW;
          const share = Math.round((cnt / row.total) * 100);
          const highlight =
            (row.status.toLowerCase().includes("ready for committer") && v.key === "LIKELY-REJECT") ||
            (row.status.toLowerCase().includes("needs review") && v.key === "NO-FUNDAMENTAL-OBJECTION");
          const rect = `
            <g class="viz-hoverable" tabindex="0" data-mx-status="${esc(row.status)}" data-mx-verdict="${esc(v.key)}" data-tip-title="${esc(row.status)} × ${esc(v.label)}" data-tip-body="${cnt} of ${row.total} patches (${share}%)" data-tip-sub="Click to filter Entries">
              <rect x="${curX.toFixed(1)}" y="${curY.toFixed(1)}" width="${Math.max(2, sw - 1.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${v.fill}" fill-opacity="${v.hatched ? "1" : "0.86"}" stroke="${highlight ? "var(--text)" : "var(--surface)"}" stroke-width="${highlight ? "1.8" : "1"}" />
              ${sw > 30 && bh >= 22 ? `<text x="${(curX + sw / 2).toFixed(1)}" y="${(curY + bh / 2 + 3.5).toFixed(1)}" text-anchor="middle" fill="${v.hatched ? "var(--muted)" : "#fff"}" font-size="10.5" font-weight="700" class="mono" pointer-events="none">${cnt}</text>` : ""}
            </g>
          `;
          curX += sw;
          return rect;
        })
        .join("");

      const lbl = `
        <text x="${padL - 8}" y="${(curY + bh / 2 + 3.5).toFixed(1)}" text-anchor="end" fill="var(--text)" font-size="11.5" font-weight="600">${esc(row.status)}</text>
        <text x="${w - padR + 7}" y="${(curY + bh / 2 + 3.5).toFixed(1)}" text-anchor="start" fill="var(--viz-axis)" font-size="11" class="mono">${row.total}</text>
      `;
      curY += bh + gapY;
      return `${lbl}${segs}`;
    })
    .join("");

  const h = Math.ceil(curY + 8);

  const svg = `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="${esc(headline)}">
      <defs>
        <pattern id="viz-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--hover)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--border-s)" stroke-width="2" />
        </pattern>
      </defs>
      ${bands}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-2)"></span>No objection</span>
      <span><span class="dot" style="background:var(--viz-1)"></span>Committer eyes</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Design disc.</span>
      <span><span class="dot" style="background:var(--viz-5)"></span>Likely reject</span>
      <span><span class="dot" style="background:var(--border-s)"></span>Not roasted (hatched)</span>
    </div>
  `;
  return { headline, subline, callouts, svg };
}

/* ============================================================================
 * 8. STATS: Subsystem Committer Attention Scatter (Open vs Ready-for-Committer %)
 * ============================================================================ */
export function renderTopicReadinessScatterSvg(
  topics: Array<{ topic: string; total: number; open: number; roasted: number; clean: number; ready: number }>,
): string {
  const pts = topics.filter((t) => (t.open || t.total) > 0).slice(0, 14);
  if (pts.length === 0) return `<div class="empty-state">No subsystem breakdown available.</div>`;

  const w = 600;
  const h = 216;
  const padL = 42;
  const padR = 20;
  const padT = 16;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxOpen = Math.max(5, ...pts.map((p) => p.open || p.total)) * 1.12;
  const readyShares = pts.map((p) => ((p.ready || 0) / Math.max(1, p.open || p.total)) * 100);
  const maxY = Math.max(35, ...readyShares) * 1.15;
  const totOpen = pts.reduce((a, p) => a + (p.open || p.total), 0);
  const totReady = pts.reduce((a, p) => a + (p.ready || 0), 0);
  const avgReadyPct = totOpen > 0 ? Math.round((totReady / totOpen) * 1000) / 10 : 0;

  const xOf = (v: number) => padL + (v / maxOpen) * plotW;
  const yOf = (v: number) => padT + plotH - (v / maxY) * plotH;

  const avgY = yOf(avgReadyPct);
  const yTicks = [0, Math.round(maxY * 0.5), Math.round(maxY)];

  const grid = yTicks
    .map((v) => {
      const y = yOf(v);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="${v === 0 ? "" : "3 3"}" />
              <text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">${v}%</text>`;
    })
    .join("");

  const placed: Array<{ x: number; y: number }> = [];
  const dots = pts
    .map((t, idx) => {
      const openN = t.open || t.total;
      const rPct = Math.round(((t.ready || 0) / Math.max(1, openN)) * 1000) / 10;
      const cx = xOf(openN);
      const cy = yOf(rPct);
      const above = rPct >= avgReadyPct;
      let ly = cy - 9;
      for (const p of placed) {
        if (Math.abs(p.x - cx) < 75 && Math.abs(p.y - ly) < 12) ly = p.y - 12;
      }
      if (ly < padT + 10) ly = cy + 14;
      placed.push({ x: cx, y: ly });
      const anchor = cx > w - 115 ? "end" : "start";
      const lx = anchor === "end" ? cx - 8 : cx + 8;
      const showLbl = idx < 6 || (above && openN >= maxOpen * 0.25);

      return `
        <g class="viz-hoverable" tabindex="0" data-stats-topic="${esc(t.topic)}" data-tip-title="${esc(t.topic)}" data-tip-body="${openN} open · ${t.ready || 0} Ready for Committer (${rPct}%)" data-tip-sub="${t.clean || 0} roasted clean · Click to filter Entries">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${above ? "var(--viz-2)" : "var(--viz-1)"}" stroke="var(--surface)" stroke-width="1.5" />
          ${showLbl ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="var(--text)" font-size="10.5" font-weight="500" pointer-events="none">${esc(t.topic.split("/")[0]!.trim())}</text>` : ""}
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Subsystem open volume vs Ready for Committer share">
      ${grid}
      <line x1="${padL}" y1="${avgY.toFixed(1)}" x2="${w - padR}" y2="${avgY.toFixed(1)}" stroke="var(--viz-2)" stroke-dasharray="4 3" stroke-opacity="0.7" />
      <text x="${w - padR}" y="${(avgY - 4).toFixed(1)}" text-anchor="end" fill="var(--viz-2)" font-size="9.5" class="mono">Brief avg: ${avgReadyPct}% RFC</text>
      ${dots}
      <text x="${(padL + plotW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5">Open CommitFest patches in subsystem</text>
    </svg>
  `;
}

/* ============================================================================
 * 9. LISTS: 30-Day Stacked Area (Linked vs Unlinked) + 7d Moving Average
 * ============================================================================ */
export function renderMailingListAreaMaSvg(daily: Array<{ day: string; count: number; linked?: number }>): string {
  if (!daily || daily.length === 0) return `<div class="empty-state">No daily volume data synced yet.</div>`;
  const w = 640;
  const h = 186;
  const padL = 38;
  const padR = 28;
  const padT = 14;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxVal = Math.max(5, ...daily.map((d) => d.count));
  const step = plotW / Math.max(1, daily.length - 1);
  const xOf = (i: number) => (daily.length === 1 ? padL + plotW / 2 : padL + i * step);
  const yOf = (v: number) => padT + plotH - (v / maxVal) * plotH;

  // 7-day trailing moving average
  const ma = daily.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = daily.slice(start, i + 1);
    return slice.reduce((a, b) => a + b.count, 0) / slice.length;
  });

  const totalLinePts = daily.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.count).toFixed(1)}`).join(" ");
  const linkedLinePts = daily.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.linked ?? d.count).toFixed(1)}`).join(" ");
  const maLinePts = ma.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const yBase = (padT + plotH).toFixed(1);

  const totalArea = `${xOf(0).toFixed(1)},${yBase} ${totalLinePts} ${xOf(daily.length - 1).toFixed(1)},${yBase}`;
  const linkedArea = `${xOf(0).toFixed(1)},${yBase} ${linkedLinePts} ${xOf(daily.length - 1).toFixed(1)},${yBase}`;

  const hitCols = daily
    .map((d, i) => {
      const cx = xOf(i);
      const cw = Math.max(8, plotW / Math.max(1, daily.length));
      const lnk = d.linked ?? d.count;
      const lnkPct = d.count > 0 ? Math.round((lnk / d.count) * 100) : 0;
      return `<rect x="${(cx - cw / 2).toFixed(1)}" y="${padT}" width="${cw.toFixed(1)}" height="${plotH}" fill="transparent" class="viz-slice" tabindex="0" data-tip-title="${esc(d.day)}" data-tip-body="${fmtNum(d.count)} messages · 7d avg: ${ma[i]!.toFixed(1)}" data-tip-sub="${fmtNum(lnk)} (${lnkPct}%) linked to unified hacker profiles" />`;
    })
    .join("");

  const labelStep = Math.max(1, Math.ceil(daily.length / 6));
  const xLabels = daily
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== daily.length - 1) return "";
      return `<text x="${xOf(i).toFixed(1)}" y="${h - 7}" text-anchor="middle" fill="var(--viz-axis)" font-size="10" class="mono">${esc(d.day.slice(5))}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Daily mailing list volume with 7-day moving average">
      <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="var(--viz-grid)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${(padT + plotH / 2).toFixed(1)}" x2="${w - padR}" y2="${(padT + plotH / 2).toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--border)" />
      <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">${fmtNum(maxVal)}</text>
      <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">0</text>
      <polygon points="${totalArea}" fill="var(--viz-1)" fill-opacity="0.16" />
      <polygon points="${linkedArea}" fill="var(--viz-1)" fill-opacity="0.30" />
      <polyline fill="none" stroke="var(--viz-1)" stroke-width="1.6" points="${totalLinePts}" />
      <polyline fill="none" stroke="var(--viz-3)" stroke-width="2.2" stroke-dasharray="5 3" points="${maLinePts}" />
      ${xLabels}
      ${hitCols}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-1)"></span>Git-linked hacker messages</span>
      <span><span class="dot" style="background:var(--viz-1);opacity:0.35"></span>All messages</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>7-day trailing average</span>
    </div>
  `;
}

export function renderInlineSparklineSvg(values: number[]): string {
  if (!values || values.length === 0) return "";
  const w = 68;
  const h = 18;
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="flex-shrink:0;" aria-hidden="true"><polyline fill="none" stroke="var(--viz-1)" stroke-width="1.5" stroke-linejoin="round" points="${pts}" /></svg>`;
}

export function renderThreadHeatScatterSvg(
  threads: Array<{ listName: string; subject: string; messages: number; participants: number; hasAttachment: boolean; messageId: string }>,
): string {
  if (!threads || threads.length === 0) return "";
  const w = 620;
  const h = 178;
  const padL = 36;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxM = Math.max(5, ...threads.map((t) => t.messages)) * 1.1;
  const maxP = Math.max(3, ...threads.map((t) => t.participants)) * 1.15;
  const xOf = (m: number) => padL + (m / maxM) * plotW;
  const yOf = (p: number) => padT + plotH - (p / maxP) * plotH;

  const dots = threads
    .map((t) => {
      const cx = xOf(t.messages);
      const cy = yOf(t.participants);
      const url = `https://www.postgresql.org/message-id/flat/${encodeURIComponent(t.messageId)}`;
      return `
        <a href="${esc(url)}" target="_blank" rel="noopener">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${t.hasAttachment ? "var(--viz-2)" : "var(--surface)"}" stroke="${t.hasAttachment ? "var(--surface)" : "var(--viz-1)"}" stroke-width="2" class="viz-hoverable" data-tip-title="${esc(t.subject)}" data-tip-body="${t.messages} messages · ${t.participants} participants · ${esc(t.listName)}" data-tip-sub="${t.hasAttachment ? "📎 Includes patch/attachment · Click to read thread" : "Text discussion · Click to read thread"}" />
        </a>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Active thread heat: messages vs participants">
      <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="var(--viz-grid)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--border)" />
      <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">${Math.round(maxP)}</text>
      <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="var(--viz-axis)" font-size="10" class="mono">0</text>
      ${dots}
      <text x="${(padL + plotW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5">Messages in thread (Y: distinct participants · filled = 📎 attachment)</text>
    </svg>
  `;
}
