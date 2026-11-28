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

export function renderReleaseCycleRaceSvg(
  cycles: ReleaseCycleSeries[],
  focusMajor: string = "PG20",
): { headline: string; subline: string; svg: string } {
  if (!cycles || cycles.length === 0) {
    return { headline: "Release-Cycle Pace", subline: "No PG17–PG20 cycle data synced yet.", svg: `<div class="empty-state">No cycle data yet.</div>` };
  }

  const pg20 = cycles.find((c) => c.major === "PG20");
  const pg20Last = pg20?.points[pg20.points.length - 1];
  const focus = cycles.find((c) => c.major === focusMajor) || pg20 || cycles[cycles.length - 1]!;
  const focusNum = Number(focus.major.replace(/^PG/i, "")) || 20;
  const prevMajor = `PG${focusNum - 1}`;
  const prev = cycles.find((c) => c.major === prevMajor);
  const focusLast = focus.points[focus.points.length - 1];
  const prevAtSameWk = focusLast ? prev?.points.filter((p) => p.week <= focusLast.week).pop() : undefined;

  let headline = `Postgres Release-Cycle Pace (${focus.major})`;
  let subline = "Cumulative master commits by week since June 25 branch cut";
  if (focusLast && prevAtSameWk && prevAtSameWk.cumCommits > 0) {
    const deltaPct = Math.round(((focusLast.cumCommits - prevAtSameWk.cumCommits) / prevAtSameWk.cumCommits) * 100);
    const sign = deltaPct >= 0 ? "+" : "";
    const wkLabel = focusLast.week >= 52 ? `Full ${focus.major} cycle` : `Through week ${focusLast.week} of ${focus.major}`;
    headline = `${wkLabel}: ${fmtNum(focusLast.cumCommits)} commits vs ${fmtNum(prevAtSameWk.cumCommits)} in ${prevMajor} (${sign}${deltaPct}%)`;
    subline = `Credited Reviewed-by coverage: ${focusLast.reviewPct}% in ${focus.major} vs ${prevAtSameWk.reviewPct}% in ${prevMajor} · June 25 cycle boundary`;
  } else if (focusLast) {
    headline = `${focus.major}: ${fmtNum(focusLast.cumCommits)} commits through week ${focusLast.week}`;
    subline = `Credited Reviewed-by coverage: ${focusLast.reviewPct}% · June 25 cycle boundary`;
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

  const styleFor = (major: string): { stroke: string; width: number; opacity: number; labelColor: string; bold: boolean } => {
    if (major === focus.major) {
      return { stroke: "var(--viz-1)", width: 3.0, opacity: 1, labelColor: "var(--viz-1)", bold: true };
    }
    if (major === prevMajor) {
      return { stroke: "var(--viz-2)", width: 2.1, opacity: 0.9, labelColor: "var(--viz-2)", bold: true };
    }
    return { stroke: "var(--viz-muted-line)", width: 1.5, opacity: 0.65, labelColor: "var(--muted)", bold: false };
  };

  // Prevent overlapping end labels
  const endLabels: Array<{ major: string; x: number; y: number; color: string; bold: boolean }> = [];

  const paths = cycles
    .map((c) => {
      const style = styleFor(c.major);
      const pts = c.points.map((p) => `${xOf(p.week).toFixed(1)},${yOf(p.cumCommits).toFixed(1)}`).join(" ");
      const last = c.points[c.points.length - 1];
      if (last) {
        endLabels.push({
          major: c.major,
          x: xOf(last.week) + 6,
          y: yOf(last.cumCommits) + 3.5,
          color: style.labelColor,
          bold: style.bold,
        });
      }
      const area =
        c.major === focus.major && c.points.length >= 2
          ? `<polygon points="${xOf(c.points[0]!.week).toFixed(1)},${(padT + plotH).toFixed(1)} ${pts} ${xOf(last!.week).toFixed(1)},${(padT + plotH).toFixed(1)}" fill="var(--viz-1)" fill-opacity="0.10" />`
          : "";
      const endDot = last
        ? `<circle cx="${xOf(last.week).toFixed(1)}" cy="${yOf(last.cumCommits).toFixed(1)}" r="${c.major === focus.major ? 4.2 : 2.8}" fill="${style.stroke}" />`
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
    { title: "Reviewed their patches", verb: "Reviewed patches by", color: "var(--viz-2)", baseDeg: 35, nodes: collaborators.reviewedBy.slice(0, 5) },
    { title: "Authors they helped", verb: "Helped author", color: "var(--viz-3)", baseDeg: 145, nodes: collaborators.helpedAuthors.slice(0, 5) },
  ];

  const totalNodes = sectors.reduce((a, s) => a + s.nodes.length, 0);
  if (totalNodes === 0) return "";

  const w = 680;
  const h = 368;
  const cx = w / 2;
  const cy = 196;
  const maxCnt = Math.max(1, ...sectors.flatMap((s) => s.nodes.map((n) => n.count)));

  // Subtle sector dividers & concentric rings (bubbles stay strictly inside r <= 116)
  const rings = [64, 100]
    .map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--viz-grid)" stroke-dasharray="3 3" />`)
    .join("");

  const dividers = [330, 90, 210]
    .map((deg) => {
      const p = polarToCartesian(cx, cy, 118, deg);
      return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--viz-grid)" />`;
    })
    .join("");

  // Collect positioned nodes + external callout label specs for 2-column vertical collision avoidance
  interface PlacedNode {
    sec: (typeof sectors)[number];
    node: CollabNode;
    idx: number;
    deg: number;
    pos: { x: number; y: number };
    knee: { x: number; y: number };
    r: number;
    sw: number;
    side: "left" | "right";
    labelY: number;
  }

  const placed: PlacedNode[] = [];
  for (const sec of sectors) {
    const n = sec.nodes.length;
    sec.nodes.forEach((node, idx) => {
      const spread = n === 1 ? 0 : (idx / (n - 1) - 0.5) * 68;
      const deg = sec.baseDeg + spread;
      const dist = idx === 0 ? 64 : idx <= 2 ? 84 : 100;
      const pos = polarToCartesian(cx, cy, dist, deg);
      const r = 7 + Math.sqrt(node.count / maxCnt) * 9.5;
      const sw = 1.2 + (node.count / maxCnt) * 2.8;
      const knee = polarToCartesian(cx, cy, 122, deg);
      const side: "left" | "right" = knee.x < cx ? "left" : "right";
      placed.push({ sec, node, idx, deg, pos, knee, r, sw, side, labelY: knee.y });
    });
  }

  // Resolve vertical overlaps independently in left and right external label columns
  const MIN_Y = 38;
  const MAX_Y = h - 14;
  const MIN_GAP = 22;
  const resolveColumn = (side: "left" | "right") => {
    const col = placed.filter((p) => p.side === side).sort((a, b) => a.labelY - b.labelY);
    if (col.length === 0) return;
    // Pass 1: push downward to enforce MIN_GAP
    for (let i = 0; i < col.length; i++) {
      const minAllowed = i === 0 ? MIN_Y : col[i - 1]!.labelY + MIN_GAP;
      if (col[i]!.labelY < minAllowed) col[i]!.labelY = minAllowed;
    }
    // Pass 2: clamp bottom & push upward if needed
    const last = col[col.length - 1]!;
    if (last.labelY > MAX_Y) {
      last.labelY = MAX_Y;
      for (let i = col.length - 2; i >= 0; i--) {
        const maxAllowed = col[i + 1]!.labelY - MIN_GAP;
        if (col[i]!.labelY > maxAllowed) col[i]!.labelY = maxAllowed;
      }
    }
    // Pass 3: keep top inside MIN_Y if column is very dense
    if (col[0]!.labelY < MIN_Y) {
      const span = Math.max(1, MAX_Y - MIN_Y);
      const step = col.length > 1 ? Math.min(MIN_GAP, span / (col.length - 1)) : 0;
      col.forEach((p, i) => {
        p.labelY = MIN_Y + i * step;
      });
    }
  };
  resolveColumn("left");
  resolveColumn("right");

  const LEFT_COL_X = cx - 142;
  const RIGHT_COL_X = cx + 142;

  const links: string[] = [];
  const leaders: string[] = [];
  const bubbles: string[] = [];

  for (const item of placed) {
    const { sec, node, deg, pos, knee, r, sw, side, labelY } = item;
    const mid = polarToCartesian(cx, cy, Math.hypot(pos.x - cx, pos.y - cy) * 0.52, deg + 8);
    links.push(
      `<path d="M ${cx} ${cy} Q ${mid.x.toFixed(1)} ${mid.y.toFixed(1)} ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}" fill="none" stroke="${sec.color}" stroke-opacity="0.38" stroke-width="${sw.toFixed(1)}" />`,
    );

    const edgeStart = polarToCartesian(pos.x, pos.y, r + 1.5, deg);
    const labelX = side === "left" ? LEFT_COL_X : RIGHT_COL_X;
    const elbowEndX = side === "left" ? labelX + 6 : labelX - 6;
    leaders.push(
      `<polyline points="${edgeStart.x.toFixed(1)},${edgeStart.y.toFixed(1)} ${knee.x.toFixed(1)},${labelY.toFixed(1)} ${elbowEndX.toFixed(1)},${labelY.toFixed(1)}" fill="none" stroke="${sec.color}" stroke-opacity="0.42" stroke-width="1" />`,
    );

    const initials = node.name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] || "")
      .join("")
      .toUpperCase();
    const shortName = node.name.length > 20 ? `${node.name.slice(0, 19)}…` : node.name;
    const lblAnchor = side === "left" ? "end" : "start";

    bubbles.push(`
      <g class="viz-hoverable" tabindex="0" data-open-hacker="${esc(node.slug)}" data-tip-title="${esc(node.name)} (${esc(node.role)})" data-tip-body="${esc(sec.title)}: ${fmtNum(node.count)} shared commits" data-tip-sub="Click to open /hacker/${esc(node.slug)}">
        <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${sec.color}" fill-opacity="0.9" stroke="var(--surface)" stroke-width="1.8" />
        <text x="${pos.x.toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="${r > 11 ? 9 : 7.8}" font-weight="700" pointer-events="none">${esc(initials)}</text>
        <text x="${labelX.toFixed(1)}" y="${(labelY + 3.5).toFixed(1)}" text-anchor="${lblAnchor}" fill="var(--text)" font-size="10.8" font-weight="500">${esc(shortName)} <tspan fill="var(--dim)" class="mono">(${node.count})</tspan></text>
      </g>
    `);
  }

  const centerInitials = centerName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase();

  // Clean non-overlapping legend bar above the constellation
  const activeSectors = sectors.filter((s) => s.nodes.length > 0);
  const legendHtml = activeSectors
    .map(
      (s) =>
        `<span class="viz-legend-chip"><span class="dot" style="background:${s.color};"></span><span>${esc(s.title)}</span><strong class="mono">${s.nodes.length}</strong></span>`,
    )
    .join("");

  return `
    <div class="viz-constellation-wrap">
      <div class="viz-legend-row" style="margin-bottom:4px;justify-content:center;">${legendHtml}</div>
      <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Collaboration constellation for ${esc(centerName)}">
        ${rings}
        ${dividers}
        ${links.join("")}
        ${leaders.join("")}
        ${bubbles.join("")}
        <circle cx="${cx}" cy="${cy}" r="21" fill="var(--surface)" stroke="var(--viz-1)" stroke-width="2.5" />
        <text x="${cx}" y="${cy + 4.2}" text-anchor="middle" fill="var(--text)" font-size="11.5" font-weight="700">${esc(centerInitials)}</text>
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
      const url = `https://www.postgresql.org/message-id/${encodeURIComponent(t.messageId)}`;
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

/* ============================================================================
 * 10. STATS: Dark/Medium Verification Pipeline Funnel (Apply -> Compile -> Test -> Live PG SQL)
 * ============================================================================ */
export function renderVerificationPipelineSvg(v: {
  codeRead: number;
  avgFilesRead: number;
  gitApplyClean: number;
  gitApplyConflict: number;
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
}): { headline: string; subline: string; svg: string } {
  const baseN = Math.max(1, v.codeRead);
  const applyTotal = v.gitApplyClean + v.gitApplyConflict;
  const applyPct = applyTotal > 0 ? Math.round((v.gitApplyClean / applyTotal) * 100) : 0;
  const testTotal = v.testPass + v.testFail;
  const testPct = testTotal > 0 ? Math.round((v.testPass / testTotal) * 100) : 0;
  const sqlTotal = v.sqlPass + v.sqlIssue + v.sqlCrash;

  const headline =
    v.codeRead === 0
      ? "Run a Medium or Dark roast to populate the live PostgreSQL build & SQL verification pipeline"
      : `${applyPct}% applied cleanly to master · ${v.compilePass}/${Math.max(1, v.compilePass + v.compileFail)} compiled (-Dcassert, median ${v.medianCompileSec}s) · ${sqlTotal} ran live PG SQL stress tests`;
  const subline = `Real verification evidence across ${fmtNum(v.codeRead)} unique code-verified CommitFest patches (avg ${v.avgFilesRead} C/H/SQL files read per patch)`;

  if (v.codeRead === 0) {
    return { headline, subline, svg: `<div class="empty-state">No Medium/Dark code-verified roasts published yet.</div>` };
  }

  const stages: Array<{
    label: string;
    detail: string;
    segs: Array<{ label: string; count: number; fill: string }>;
  }> = [
    {
      label: "1. Code Diff Read",
      detail: `${v.codeRead} patches · avg ${v.avgFilesRead} files`,
      segs: [{ label: "C/H/SQL diff read", count: v.codeRead, fill: "var(--viz-1)" }],
    },
    {
      label: "2. git apply (master)",
      detail: `${v.gitApplyClean} clean · ${v.gitApplyConflict} bitrot conflict`,
      segs: [
        { label: "Applied cleanly", count: v.gitApplyClean, fill: "var(--viz-2)" },
        { label: "Bitrot / conflict", count: v.gitApplyConflict, fill: "var(--viz-5)" },
      ],
    },
    {
      label: "3. meson compile (-Dcassert)",
      detail: `${v.compilePass} pass · ${v.compileFail} fail · avg ${v.avgCompileSec}s`,
      segs: [
        { label: "Compiled cleanly", count: v.compilePass, fill: "var(--viz-2)" },
        { label: "Compile failed", count: v.compileFail, fill: "var(--viz-5)" },
      ],
    },
    {
      label: "4. Targeted meson test",
      detail: `${v.testPass} pass (${testPct}%) · ${v.testFail} fail · ${v.totalTestsPassed}/${v.totalTestsRun} suites`,
      segs: [
        { label: "Targeted tests passed", count: v.testPass, fill: "var(--viz-2)" },
        { label: "Targeted tests failed", count: v.testFail, fill: "var(--viz-5)" },
      ],
    },
    {
      label: "5. Live Patched PG SQL",
      detail: `${v.totalSqlCases} adversarial SQL cases · ${v.sqlPass} clean · ${v.sqlIssue} error paths · ${v.sqlCrash} crashes`,
      segs: [
        { label: "All SQL stress cases passed", count: v.sqlPass, fill: "var(--viz-2)" },
        { label: "Edge-case / error path triggered", count: v.sqlIssue, fill: "var(--viz-3)" },
        { label: "CRASH / TRAP / ASSERT", count: v.sqlCrash, fill: "var(--viz-5)" },
      ],
    },
  ];

  const w = 680;
  const padL = 178;
  const padR = 54;
  const padT = 8;
  const rowH = 34;
  const gap = 8;
  const plotW = w - padL - padR;

  const rowsHtml = stages
    .map((st, idx) => {
      const y = padT + idx * (rowH + gap);
      const stageTot = st.segs.reduce((a, s) => a + s.count, 0);
      let x = padL;
      const track = `<rect x="${padL}" y="${y}" width="${plotW}" height="20" rx="4" fill="var(--hover)" />`;
      const bars = st.segs
        .filter((s) => s.count > 0)
        .map((s) => {
          const bw = Math.max(4, (s.count / baseN) * plotW);
          const share = Math.round((s.count / Math.max(1, stageTot)) * 100);
          const out = `
            <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(st.label)}: ${esc(s.label)}" data-tip-body="${s.count} of ${stageTot} patches (${share}%)" data-tip-sub="${esc(st.detail)}">
              <rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, bw - 1.5).toFixed(1)}" height="20" rx="3" fill="${s.fill}" fill-opacity="0.88" />
              ${bw > 28 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${y + 13.5}" text-anchor="middle" fill="#fff" font-size="10.5" font-weight="700" class="mono" pointer-events="none">${s.count}</text>` : ""}
            </g>
          `;
          x += bw;
          return out;
        })
        .join("");

      const lbl = `
        <text x="${padL - 10}" y="${y + 13.5}" text-anchor="end" fill="var(--text)" font-size="11.5" font-weight="600">${esc(st.label)}</text>
        <text x="${w - padR + 8}" y="${y + 13.5}" text-anchor="start" fill="var(--viz-axis)" font-size="11" class="mono">${stageTot}/${baseN}</text>
        <text x="${padL}" y="${y + 31}" fill="var(--dim)" font-size="9.5">${esc(st.detail)}</text>
      `;
      return `${track}${bars}${lbl}`;
    })
    .join("");

  const h = padT + stages.length * (rowH + gap) + 4;
  const svg = `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="${esc(headline)}">
      ${rowsHtml}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-1)"></span>Code diff extracted</span>
      <span><span class="dot" style="background:var(--viz-2)"></span>Clean / Pass</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Live SQL edge-case / error path</span>
      <span><span class="dot" style="background:var(--viz-5)"></span>Conflict / Fail / Crash</span>
    </div>
  `;
  return { headline, subline, svg };
}

/* ============================================================================
 * 11. STATS: Model × Verdict & Depth Mix (Horizontal 100% Stacked Bars)
 * ============================================================================ */
export function renderModelVerdictMixSvg(
  models: Array<{
    spec: string;
    backend: string;
    total: number;
    dark: number;
    medium: number;
    light: number;
    verdicts: Record<string, number>;
  }>,
): string {
  const rows = models.slice(0, 7);
  if (rows.length === 0) return `<div class="empty-state">No community model opinions published yet.</div>`;

  const vOrder = [
    { key: "NO-FUNDAMENTAL-OBJECTION", label: "No objection", fill: "var(--viz-2)" },
    { key: "NEEDS-COMMITTER-EYES", label: "Committer eyes", fill: "var(--viz-1)" },
    { key: "NEEDS-DESIGN-DISCUSSION", label: "Design disc.", fill: "var(--viz-3)" },
    { key: "LIKELY-REJECT", label: "Likely reject", fill: "var(--viz-5)" },
  ];

  const w = 620;
  const padL = 188;
  const padR = 46;
  const padT = 8;
  const rowH = 34;
  const gap = 8;
  const plotW = w - padL - padR;

  const body = rows
    .map((m, idx) => {
      const y = padT + idx * (rowH + gap);
      const tot = Math.max(1, m.total);
      let x = padL;
      const segs = vOrder
        .map((v) => {
          const cnt = m.verdicts[v.key] || 0;
          if (cnt <= 0) return "";
          const sw = (cnt / tot) * plotW;
          const pct = Math.round((cnt / tot) * 100);
          const el = `
            <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(m.spec)} × ${esc(v.label)}" data-tip-body="${cnt} of ${m.total} opinions (${pct}%)" data-tip-sub="Depth mix: ${m.dark} Dark · ${m.medium} Medium · ${m.light} Light">
              <rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, sw - 1.2).toFixed(1)}" height="18" rx="3" fill="${v.fill}" fill-opacity="0.88" />
              ${sw > 26 ? `<text x="${(x + sw / 2).toFixed(1)}" y="${y + 12.5}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700" class="mono" pointer-events="none">${cnt}</text>` : ""}
            </g>
          `;
          x += sw;
          return el;
        })
        .join("");

      const shortSpec = m.spec.length > 26 ? `${m.spec.slice(0, 25)}…` : m.spec;
      const depthSub = `${m.dark ? `${m.dark} Dark` : ""}${m.dark && m.light ? " · " : ""}${m.medium ? `${m.medium} Med · ` : ""}${m.light ? `${m.light} Light` : ""}`;
      return `
        <text x="${padL - 8}" y="${y + 12.5}" text-anchor="end" fill="var(--text)" font-size="10.5" font-weight="600" class="mono">${esc(shortSpec)}</text>
        <text x="${padL - 8}" y="${y + 24.5}" text-anchor="end" fill="var(--dim)" font-size="9">${esc(depthSub || m.backend)}</text>
        ${segs}
        <text x="${w - padR + 7}" y="${y + 12.5}" text-anchor="start" fill="var(--viz-axis)" font-size="10.5" class="mono">${m.total}</text>
      `;
    })
    .join("");

  const h = padT + rows.length * (rowH + gap) + 4;
  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Verdict distribution by AI model">
      ${body}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-2)"></span>No objection</span>
      <span><span class="dot" style="background:var(--viz-1)"></span>Committer eyes</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Design disc.</span>
      <span><span class="dot" style="background:var(--viz-5)"></span>Likely reject</span>
    </div>
  `;
}

/* ============================================================================
 * 12. STATS: Bug Fixes vs Features vs Production-Reported Breakdown
 * ============================================================================ */
export function renderKindVerdictComparisonSvg(
  rows: Array<{
    key: "bugfix" | "feature" | "prod";
    label: string;
    total: number;
    open: number;
    committed: number;
    ready: number;
    needsReview: number;
    waiting: number;
    verdicts: Record<string, number>;
  }>,
): string {
  const valid = rows.filter((r) => r.total > 0);
  if (valid.length === 0) return `<div class="empty-state">No patch classification data yet.</div>`;

  const w = 600;
  const padL = 136;
  const padR = 46;
  const padT = 8;
  const rowH = 44;
  const gap = 10;
  const plotW = w - padL - padR;

  const stSegs = (r: (typeof valid)[number]) => {
    const other = Math.max(0, r.total - r.committed - r.ready - r.needsReview - r.waiting);
    return [
      { label: "Committed", count: r.committed, fill: "var(--viz-2)" },
      { label: "Ready for Committer", count: r.ready, fill: "var(--viz-1)" },
      { label: "Needs review", count: r.needsReview, fill: "var(--viz-3)" },
      { label: "Waiting on Author", count: r.waiting, fill: "var(--viz-4)" },
      { label: "Other / Closed", count: other, fill: "var(--border-s)" },
    ];
  };

  const body = valid
    .map((r, idx) => {
      const y = padT + idx * (rowH + gap);
      const tot = Math.max(1, r.total);
      let x = padL;
      const segs = stSegs(r)
        .filter((s) => s.count > 0)
        .map((s) => {
          const sw = (s.count / tot) * plotW;
          const pct = Math.round((s.count / tot) * 100);
          const out = `
            <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(r.label)} — ${esc(s.label)}" data-tip-body="${s.count} of ${r.total} patches (${pct}%)" data-tip-sub="${r.open} open · ${r.verdicts["NO-FUNDAMENTAL-OBJECTION"] || 0} roasted clean · ${r.verdicts["LIKELY-REJECT"] || 0} likely reject">
              <rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, sw - 1.2).toFixed(1)}" height="20" rx="3" fill="${s.fill}" fill-opacity="0.88" />
              ${sw > 28 ? `<text x="${(x + sw / 2).toFixed(1)}" y="${y + 13.5}" text-anchor="middle" fill="${s.fill === "var(--border-s)" ? "var(--text)" : "#fff"}" font-size="10" font-weight="700" class="mono" pointer-events="none">${pct}%</text>` : ""}
            </g>
          `;
          x += sw;
          return out;
        })
        .join("");

      const cleanN = r.verdicts["NO-FUNDAMENTAL-OBJECTION"] || 0;
      const rejN = r.verdicts["LIKELY-REJECT"] || 0;
      return `
        <text x="${padL - 10}" y="${y + 13.5}" text-anchor="end" fill="var(--text)" font-size="11.5" font-weight="600">${esc(r.label)}</text>
        <text x="${padL - 10}" y="${y + 26.5}" text-anchor="end" fill="var(--dim)" font-size="9.5" class="mono">${r.open} open</text>
        ${segs}
        <text x="${w - padR + 7}" y="${y + 13.5}" text-anchor="start" fill="var(--viz-axis)" font-size="11" class="mono">${r.total}</text>
        <text x="${padL}" y="${y + 33}" fill="var(--dim)" font-size="9.5">${r.committed} committed · ${r.ready} RFC · ${cleanN} clean · ${rejN} likely reject</text>
      `;
    })
    .join("");

  const h = padT + valid.length * (rowH + gap) + 4;
  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Bug fixes vs features vs production-reported status breakdown">
      ${body}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-2)"></span>Committed</span>
      <span><span class="dot" style="background:var(--viz-1)"></span>Ready for Committer</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Needs review</span>
      <span><span class="dot" style="background:var(--viz-4)"></span>Waiting on Author</span>
      <span><span class="dot" style="background:var(--border-s)"></span>Other / Closed</span>
    </div>
  `;
}

/* ============================================================================
 * 13. STATS: Opinion Publishing & Roast Depth Velocity Timeline
 * ============================================================================ */
export function renderOpinionVelocitySvg(
  buckets: Array<{ bucket: string; label: string; dark: number; medium: number; light: number; total: number }>,
): string {
  if (!buckets || buckets.length === 0) return `<div class="empty-state">No community opinions published yet.</div>`;

  const w = 600;
  const h = 186;
  const padL = 34;
  const padR = 26;
  const padT = 14;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxY = Math.max(4, ...buckets.map((b) => b.total));
  const step = plotW / Math.max(1, buckets.length);
  const barW = Math.max(6, Math.min(24, step * 0.68));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = padT + plotH * (1 - f);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--viz-grid)" stroke-dasharray="${f === 0 ? "" : "3 3"}" />
              <text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--viz-axis)" font-size="9.5" class="mono">${Math.round(maxY * f)}</text>`;
    })
    .join("");

  const bars = buckets
    .map((b, i) => {
      const x = padL + i * step + (step - barW) / 2;
      const baseY = padT + plotH;
      const hDark = (b.dark / maxY) * plotH;
      const hMed = (b.medium / maxY) * plotH;
      const hLight = (b.light / maxY) * plotH;
      const yDark = baseY - hDark;
      const yMed = yDark - hMed;
      const yLight = yMed - hLight;
      const showLbl = i === 0 || i === buckets.length - 1 || (i % labelEvery === 0 && i < buckets.length - 1);
      return `
        <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(b.label)} UTC" data-tip-body="${b.total} opinion${b.total === 1 ? "" : "s"} published" data-tip-sub="${b.dark} Dark (build+SQL) · ${b.medium} Medium · ${b.light} Light">
          <rect x="${(padL + i * step).toFixed(1)}" y="${padT}" width="${step.toFixed(1)}" height="${plotH}" fill="transparent" />
          ${hDark > 0 ? `<rect x="${x.toFixed(1)}" y="${yDark.toFixed(1)}" width="${barW.toFixed(1)}" height="${hDark.toFixed(1)}" rx="2" fill="var(--viz-3)" />` : ""}
          ${hMed > 0 ? `<rect x="${x.toFixed(1)}" y="${yMed.toFixed(1)}" width="${barW.toFixed(1)}" height="${hMed.toFixed(1)}" rx="2" fill="var(--viz-1)" />` : ""}
          ${hLight > 0 ? `<rect x="${x.toFixed(1)}" y="${yLight.toFixed(1)}" width="${barW.toFixed(1)}" height="${hLight.toFixed(1)}" rx="2" fill="var(--viz-4)" />` : ""}
        </g>
        ${showLbl ? `<text x="${(i === buckets.length - 1 ? x + barW : x + barW / 2).toFixed(1)}" y="${h - 8}" text-anchor="${i === buckets.length - 1 ? "end" : i === 0 ? "start" : "middle"}" fill="var(--viz-axis)" font-size="9" class="mono">${esc(b.label)}</text>` : ""}
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Published AI roast opinions by depth over time">
      ${grid}
      ${bars}
    </svg>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-3)"></span>Dark (code + build + live PG SQL)</span>
      <span><span class="dot" style="background:var(--viz-1)"></span>Medium (code + build + test)</span>
      <span><span class="dot" style="background:var(--viz-4)"></span>Light (thread + precedents)</span>
    </div>
  `;
}

/* ============================================================================
 * 14. STATS: Site Traffic & Community Interest Area Sparkline
 * ============================================================================ */
export function renderTrafficTimelineSvg(
  timeline: Array<{ bucket: string; label: string; hits: number }>,
): string {
  if (!timeline || timeline.length === 0) return `<div class="muted" style="font-size:12px;">No hourly traffic buckets yet.</div>`;

  const w = 680;
  const h = 128;
  const padL = 32;
  const padR = 24;
  const padT = 12;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxY = Math.max(4, ...timeline.map((t) => t.hits));
  const step = timeline.length > 1 ? plotW / (timeline.length - 1) : plotW;
  const xOf = (i: number) => (timeline.length > 1 ? padL + i * step : padL + plotW / 2);
  const yOf = (v: number) => padT + plotH - (v / maxY) * plotH;
  const labelEvery = Math.max(1, Math.ceil(timeline.length / 6));

  const linePts = timeline.map((t, i) => `${xOf(i).toFixed(1)},${yOf(t.hits).toFixed(1)}`).join(" ");
  const areaPts =
    timeline.length > 1
      ? `M${xOf(0).toFixed(1)},${(padT + plotH).toFixed(1)} ` +
        timeline.map((t, i) => `L${xOf(i).toFixed(1)},${yOf(t.hits).toFixed(1)}`).join(" ") +
        ` L${xOf(timeline.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : "";

  const hitsOverlay = timeline
    .map((t, i) => {
      const cx = xOf(i);
      const cy = yOf(t.hits);
      const showLbl = i === 0 || i === timeline.length - 1 || (i % labelEvery === 0 && i < timeline.length - 1);
      return `
        <g class="viz-hoverable" tabindex="0" data-tip-title="${esc(t.label)} UTC" data-tip-body="${fmtNum(t.hits)} page view${t.hits === 1 ? "" : "s"}" data-tip-sub="Zero-cookie hit counter (bots excluded)">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="var(--viz-1)" stroke="var(--surface)" stroke-width="1.5" />
          <rect x="${(cx - Math.max(8, step / 2)).toFixed(1)}" y="${padT}" width="${Math.max(16, step).toFixed(1)}" height="${plotH}" fill="transparent" />
        </g>
        ${showLbl ? `<text x="${cx.toFixed(1)}" y="${h - 6}" text-anchor="${i === timeline.length - 1 ? "end" : i === 0 ? "start" : "middle"}" fill="var(--viz-axis)" font-size="9" class="mono">${esc(t.label)}</text>` : ""}
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Hourly page views">
      <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="var(--viz-grid)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--border)" />
      <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" fill="var(--viz-axis)" font-size="9.5" class="mono">${maxY}</text>
      <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="var(--viz-axis)" font-size="9.5" class="mono">0</text>
      ${areaPts ? `<path d="${areaPts}" fill="var(--viz-1)" fill-opacity="0.14" />` : ""}
      ${timeline.length > 1 ? `<polyline fill="none" stroke="var(--viz-1)" stroke-width="2" stroke-linejoin="round" points="${linePts}" />` : ""}
      ${hitsOverlay}
    </svg>
  `;
}

/* ============================================================================
 * 15. STATS HERO: The Queue (736-Square Unit Chart — 1 clickable square per patch)
 * ============================================================================ */
function verdictColorVar(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return "var(--viz-2)";
  if (v === "NEEDS-COMMITTER-EYES") return "var(--viz-1)";
  if (v === "NEEDS-DESIGN-DISCUSSION") return "var(--viz-3)";
  if (v === "LIKELY-REJECT") return "var(--viz-5)";
  return "transparent";
}

function verdictHumanShort(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return "No objection";
  if (v === "NEEDS-COMMITTER-EYES") return "Committer eyes";
  if (v === "NEEDS-DESIGN-DISCUSSION") return "Design disc.";
  if (v === "LIKELY-REJECT") return "Likely reject";
  return "Unroasted";
}

export function renderQueueUnitChartSvg(
  units: Array<{
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
  }>,
  highlight: "all" | "dark" | "warnings" | "clean" = "all",
): string {
  if (!units || units.length === 0) return `<div class="empty-state">No CommitFest entries indexed.</div>`;

  const allGroups: Array<{
    key: "needs_review" | "waiting" | "rfc" | "closed";
    label: string;
    items: typeof units;
  }> = [
    { key: "needs_review", label: "Needs review", items: units.filter((u) => u.col === "needs_review") },
    { key: "waiting", label: "Waiting on Author", items: units.filter((u) => u.col === "waiting") },
    { key: "rfc", label: "Ready for Committer", items: units.filter((u) => u.col === "rfc") },
    { key: "closed", label: "Closed", items: units.filter((u) => u.col === "closed") },
  ];
  const groups = allGroups.filter((g) => g.items.length > 0);

  const cell = 11;
  const gap = 3;
  const step = cell + gap;
  const colGap = 24;
  const padX = 12;
  const padT = 38;
  const padB = 12;
  const targetRows = 19;

  // Compute grid columns per status group proportional to count AND guarantee
  // every column box is at least wide enough for its title + count subtitle.
  const colsSpec = groups.map((g) => {
    const darkInGroup = g.items.filter((u) => u.isDark).length;
    const subLabel = `n=${g.items.length}${darkInGroup > 0 ? ` · ${darkInGroup} Dark` : ""}`;
    const minColsForHeader = g.key === "waiting" ? 6 : g.key === "rfc" ? 8 : 5;
    const nCols = Math.max(minColsForHeader, Math.ceil(g.items.length / targetRows));
    const nRows = Math.ceil(g.items.length / nCols);
    const gridW = nCols * step - gap;
    const headerMinW = Math.ceil(Math.max(g.label.length * 7.3, subLabel.length * 6.4)) + 6;
    const boxW = Math.max(gridW, headerMinW);
    return { ...g, darkInGroup, subLabel, nCols, nRows, gridW, boxW };
  });

  const maxRows = Math.max(1, ...colsSpec.map((c) => c.nRows));
  const totalW = padX * 2 + colsSpec.reduce((a, c) => a + c.boxW, 0) + Math.max(0, colsSpec.length - 1) * colGap;
  const totalH = padT + maxRows * step + padB;

  const isHighlighted = (u: (typeof units)[number]): boolean => {
    if (highlight === "all") return true;
    if (highlight === "dark") return u.isDark;
    if (highlight === "warnings") {
      return u.col === "rfc" && (u.verdict === "LIKELY-REJECT" || u.verdict === "NEEDS-DESIGN-DISCUSSION" || u.evidenceShort.includes("✗"));
    }
    if (highlight === "clean") {
      return u.col === "needs_review" && u.verdict === "NO-FUNDAMENTAL-OBJECTION";
    }
    return true;
  };

  let curX = padX;
  const parts: string[] = [];

  for (let gi = 0; gi < colsSpec.length; gi++) {
    const g = colsSpec[gi]!;
    if (gi > 0) {
      const divX = curX - colGap / 2;
      parts.push(`<line x1="${divX.toFixed(1)}" y1="8" x2="${divX.toFixed(1)}" y2="${totalH - 8}" stroke="var(--border)" stroke-dasharray="2 3" />`);
    }
    parts.push(
      `<text x="${curX}" y="15" fill="var(--text)" font-size="11.5" font-weight="650">${esc(g.label)}</text>`,
      `<text x="${curX}" y="29" fill="var(--dim)" font-size="10" class="mono">${esc(g.subLabel)}</text>`,
    );

    g.items.forEach((u, idx) => {
      const r = Math.floor(idx / g.nCols);
      const c = idx % g.nCols;
      const x = curX + c * step;
      const y = padT + r * step;
      const unroasted = !u.verdict || u.verdict === "UNROASTED";
      const fill = unroasted ? "transparent" : verdictColorVar(u.verdict);
      const active = isHighlighted(u);
      const opacity = active ? (unroasted ? "0.7" : "0.9") : "0.13";
      const stroke = u.isDark ? "var(--text)" : unroasted ? "var(--border-s)" : "none";
      const sw = u.isDark ? "1.6" : unroasted ? "1.1" : "0";
      const subLine = [
        u.status,
        verdictHumanShort(u.verdict),
        u.isDark ? `Dark (${u.evidenceShort || "verified"})` : u.hasCommunityOpinion ? "Light roast" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const tipSub = `${u.author} · ${u.subsystem} · Click to open patch`;

      parts.push(
        `<g class="viz-hoverable" tabindex="0" data-open-patch="${u.cf_id}" opacity="${opacity}" data-tip-title="CF ${u.cf_id}: ${esc(u.title)}" data-tip-body="${esc(subLine)}" data-tip-sub="${esc(tipSub)}">` +
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2.2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
          `${u.isDark ? `<circle cx="${(x + cell / 2).toFixed(1)}" cy="${(y + cell / 2).toFixed(1)}" r="1.7" fill="var(--bg)" pointer-events="none" />` : ""}` +
          `</g>`,
      );
    });

    curX += g.boxW + colGap;
  }

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 ${totalW} ${totalH}" class="obs-chart-svg" style="min-width:680px;" role="img" aria-label="All ${units.length} CommitFest patches as clickable squares grouped by status and colored by AI verdict">
        ${parts.join("")}
      </svg>
    </div>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-2)"></span>No objection</span>
      <span><span class="dot" style="background:var(--viz-1)"></span>Committer eyes</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Design disc.</span>
      <span><span class="dot" style="background:var(--viz-5)"></span>Likely reject</span>
      <span><span class="dot" style="background:transparent;border:1.5px solid var(--border-s);"></span>Unroasted</span>
      <span><span class="dot" style="background:var(--viz-1);border:1.6px solid var(--text);"></span>Dark-verified (build + live PG SQL)</span>
    </div>
  `;
}

/* ============================================================================
 * 16. STATS: Review Load vs. Committer Capacity (Butterfly / Paired Chart)
 * ============================================================================ */
export function renderLoadVsCapacitySvg(
  rows: Array<{
    subsystem: string;
    openTotal: number;
    rfc: number;
    needsReview: number;
    waiting: number;
    darkCount: number;
    committers12m: number;
    commits12m: number;
    openPerCommitter: number | null;
  }>,
): string {
  const valid = rows.filter((r) => r.openTotal > 0).slice(0, 14);
  if (valid.length === 0) return `<div class="empty-state">No subsystem load data available.</div>`;

  const w = 780;
  const rowH = 26;
  const gap = 5;
  const padT = 26;
  const padB = 10;
  const centerW = 248;
  const sidePad = 38;
  const leftEnd = (w - centerW) / 2; // x where left bars end (grow leftward)
  const rightStart = leftEnd + centerW; // x where right bars start (grow rightward)
  const sideMaxW = leftEnd - sidePad;

  const maxOpen = Math.max(10, ...valid.map((r) => r.openTotal));
  const maxComm = Math.max(5, ...valid.map((r) => r.committers12m));
  const h = padT + valid.length * (rowH + gap) + padB;

  const header = `
    <text x="${leftEnd - 4}" y="14" text-anchor="end" fill="var(--dim)" font-size="10" font-weight="600">← OPEN PATCHES (RFC · Review · Wait)</text>
    <text x="${w / 2}" y="14" text-anchor="middle" fill="var(--dim)" font-size="10" font-weight="600">SUBSYSTEM · LOAD/COMMITTER</text>
    <text x="${rightStart + 4}" y="14" text-anchor="start" fill="var(--dim)" font-size="10" font-weight="600">ACTIVE COMMITTERS (12m) →</text>
    <line x1="${leftEnd}" y1="20" x2="${leftEnd}" y2="${h - 6}" stroke="var(--border)" />
    <line x1="${rightStart}" y1="20" x2="${rightStart}" y2="${h - 6}" stroke="var(--border)" />
  `;

  const body = valid
    .map((r, i) => {
      const y = padT + i * (rowH + gap);
      const barY = y + 5;
      const barH = 14;

      // Left stacked segments growing right-to-left from leftEnd
      const wRfc = (r.rfc / maxOpen) * sideMaxW;
      const wRev = (r.needsReview / maxOpen) * sideMaxW;
      const wWait = (r.waiting / maxOpen) * sideMaxW;
      const xRfc = leftEnd - wRfc;
      const xRev = xRfc - wRev;
      const xWait = xRev - wWait;
      const totalLeftW = wRfc + wRev + wWait;

      // Right bar growing left-to-right from rightStart
      const wComm = (r.committers12m / maxComm) * sideMaxW;

      const ratioTxt = r.openPerCommitter != null ? `${r.openPerCommitter.toFixed(1)}×` : "—";
      const ratioCol = (r.openPerCommitter ?? 0) >= 4.0 ? "var(--viz-5)" : (r.openPerCommitter ?? 0) >= 2.5 ? "var(--viz-3)" : "var(--viz-2)";
      const tipBody = `${r.openTotal} open (${r.rfc} RFC, ${r.needsReview} Needs review, ${r.waiting} Waiting) ÷ ${r.committers12m} active committers = ${ratioTxt}`;
      const tipSub = `${fmtNum(r.commits12m)} commits in last 12m · ${r.darkCount} Dark-verified · Click to filter Entries`;

      return `
        <g class="viz-hoverable" tabindex="0" data-stats-topic="${esc(r.subsystem)}" data-tip-title="${esc(r.subsystem)}" data-tip-body="${esc(tipBody)}" data-tip-sub="${esc(tipSub)}">
          <rect x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent" />
          ${wWait > 0 ? `<rect x="${xWait.toFixed(1)}" y="${barY}" width="${Math.max(1.5, wWait).toFixed(1)}" height="${barH}" rx="2" fill="var(--border-s)" />` : ""}
          ${wRev > 0 ? `<rect x="${xRev.toFixed(1)}" y="${barY}" width="${Math.max(1.5, wRev).toFixed(1)}" height="${barH}" rx="2" fill="var(--viz-3)" fill-opacity="0.85" />` : ""}
          ${wRfc > 0 ? `<rect x="${xRfc.toFixed(1)}" y="${barY}" width="${Math.max(1.5, wRfc).toFixed(1)}" height="${barH}" rx="2" fill="var(--viz-1)" fill-opacity="0.92" />` : ""}
          <text x="${(leftEnd - totalLeftW - 5).toFixed(1)}" y="${barY + 10.5}" text-anchor="end" fill="var(--text)" font-size="10.5" font-weight="600" class="mono">${r.openTotal}</text>

          <text x="${leftEnd + 8}" y="${barY + 10.5}" text-anchor="start" fill="var(--text)" font-size="10.5" font-weight="600">${esc(r.subsystem.length > 28 ? `${r.subsystem.slice(0, 27)}…` : r.subsystem)}</text>
          <text x="${rightStart - 8}" y="${barY + 10.5}" text-anchor="end" fill="${ratioCol}" font-size="10.5" font-weight="700" class="mono">${ratioTxt}</text>

          ${wComm > 0 ? `<rect x="${rightStart}" y="${barY}" width="${Math.max(2, wComm).toFixed(1)}" height="${barH}" rx="2" fill="var(--viz-2)" fill-opacity="0.72" />` : ""}
          <text x="${(rightStart + wComm + 5).toFixed(1)}" y="${barY + 10.5}" text-anchor="start" fill="var(--viz-axis)" font-size="10.5" class="mono">${r.committers12m}</text>
        </g>
      `;
    })
    .join("");

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" style="min-width:660px;" role="img" aria-label="Open CommitFest patches versus 12-month active committers per PostgreSQL subsystem">
        ${header}
        ${body}
      </svg>
    </div>
    <div class="obs-chart-legend">
      <span><span class="dot" style="background:var(--viz-1)"></span>Ready for Committer</span>
      <span><span class="dot" style="background:var(--viz-3)"></span>Needs review</span>
      <span><span class="dot" style="background:var(--border-s)"></span>Waiting on Author</span>
      <span><span class="dot" style="background:var(--viz-2)"></span>Active committers (last 12m, pg_commits)</span>
    </div>
  `;
}

/* ============================================================================
 * 17. STATS: Author Track Record Beeswarm (Prior Credited Commits vs Status)
 * ============================================================================ */
export function renderAuthorBeeswarmSvg(
  dots: Array<{
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
  }>,
): string {
  if (!dots || dots.length === 0) return `<div class="empty-state">No open patches to plot.</div>`;

  const w = 700;
  const padL = 132;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const plotW = w - padL - padR;

  const lanes: Array<{ key: "rfc" | "needs_review" | "waiting"; label: string; height: number }> = [
    { key: "rfc", label: "Ready for Committer", height: 56 },
    { key: "needs_review", label: "Needs review", height: 96 },
    { key: "waiting", label: "Waiting on Author", height: 42 },
  ];

  // Log10(priorCommits + 1) scale from 0 to max (~5000)
  const maxLog = Math.max(3.2, ...dots.map((d) => Math.log10(d.priorCommits + 1)));
  const zeroZoneW = 54; // dedicated left band for 0 prior commits (first-timers)
  const expStartX = padL + zeroZoneW + 14;
  const expW = w - padR - expStartX;

  const xOf = (commits: number, cfId: number): number => {
    if (commits <= 0) {
      // Deterministic horizontal spread inside the 0-commit zone
      const jitter = ((cfId * 2654435761) >>> 0) % 1000 / 1000;
      return padL + 6 + jitter * (zeroZoneW - 12);
    }
    const frac = Math.log10(commits + 1) / maxLog;
    return expStartX + Math.min(1, Math.max(0, frac)) * expW;
  };

  let curY = padT;
  const laneTops = new Map<string, { top: number; height: number; midY: number }>();
  for (const ln of lanes) {
    laneTops.set(ln.key, { top: curY, height: ln.height, midY: curY + ln.height / 2 });
    curY += ln.height + 8;
  }
  const totalH = curY + padB - 8;

  // Ticks on log axis
  const ticks = [1, 3, 10, 30, 100, 300, 1000];
  const gridLines = [
    `<rect x="${padL}" y="${padT - 4}" width="${zeroZoneW}" height="${curY - padT - 4}" rx="4" fill="var(--hover)" />`,
    `<text x="${padL + zeroZoneW / 2}" y="${totalH - 12}" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="600" class="mono">0 (First-time)</text>`,
    `<line x1="${padL + zeroZoneW + 7}" y1="${padT - 4}" x2="${padL + zeroZoneW + 7}" y2="${curY - 8}" stroke="var(--border-s)" stroke-dasharray="3 3" />`,
    ...ticks
      .filter((t) => Math.log10(t + 1) <= maxLog * 1.02)
      .map((t) => {
        const tx = expStartX + (Math.log10(t + 1) / maxLog) * expW;
        return `<line x1="${tx.toFixed(1)}" y1="${padT - 4}" x2="${tx.toFixed(1)}" y2="${curY - 8}" stroke="var(--viz-grid)" stroke-dasharray="2 3" />
                <text x="${tx.toFixed(1)}" y="${totalH - 12}" text-anchor="middle" fill="var(--viz-axis)" font-size="9.5" class="mono">${t}</text>`;
      }),
    `<text x="${(expStartX + expW / 2).toFixed(1)}" y="${totalH - 1}" text-anchor="middle" fill="var(--dim)" font-size="9">Author prior credited PostgreSQL commits (log scale)</text>`,
  ].join("");

  // Lane labels + baselines
  const laneChrome = lanes
    .map((ln) => {
      const m = laneTops.get(ln.key)!;
      const cnt = dots.filter((d) => d.statusRow === ln.key).length;
      return `
        <line x1="${padL}" y1="${m.midY.toFixed(1)}" x2="${w - padR}" y2="${m.midY.toFixed(1)}" stroke="var(--border)" stroke-opacity="0.55" />
        <text x="${padL - 10}" y="${(m.midY - 2).toFixed(1)}" text-anchor="end" fill="var(--text)" font-size="11" font-weight="600">${esc(ln.label)}</text>
        <text x="${padL - 10}" y="${(m.midY + 11).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="9.5" class="mono">n=${cnt}</text>
      `;
    })
    .join("");

  // Deterministic beeswarm vertical packing per (lane, 6px x-bucket)
  const bucketCounts = new Map<string, number>();
  const dotEls = dots
    .map((d) => {
      const m = laneTops.get(d.statusRow)!;
      const cx = xOf(d.priorCommits, d.cf_id);
      const bKey = `${d.statusRow}:${Math.round(cx / 6)}`;
      const idx = bucketCounts.get(bKey) || 0;
      bucketCounts.set(bKey, idx + 1);
      // Alternating above/below midline within lane bounds
      const ring = Math.ceil(idx / 2);
      const sign = idx % 2 === 0 ? 1 : -1;
      const maxSpread = m.height / 2 - 5;
      const rawDy = idx === 0 ? 0 : sign * ring * 5.2;
      const dy = Math.max(-maxSpread, Math.min(maxSpread, rawDy));
      const cy = m.midY + dy;

      const unroasted = !d.verdict || d.verdict === "UNROASTED";
      const fill = unroasted ? "var(--bg)" : verdictColorVar(d.verdict);
      const stroke = d.isDark ? "var(--text)" : unroasted ? "var(--border-s)" : "var(--surface)";
      const r = d.isDark ? 4.3 : 3.4;
      const sw = d.isDark ? 1.5 : 0.8;
      const priorLabel = d.matched ? `${fmtNum(d.priorCommits)} prior PG commits` : "0 prior commits (unmatched in git)";
      return `
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" fill-opacity="${unroasted ? "0.9" : "0.85"}" stroke="${stroke}" stroke-width="${sw}" class="viz-hoverable" tabindex="0" data-open-patch="${d.cf_id}" data-tip-title="CF ${d.cf_id}: ${esc(d.title)}" data-tip-body="${esc(d.author)} (${priorLabel}) · ${esc(verdictHumanShort(d.verdict))}${d.isDark ? " · Dark" : ""}" data-tip-sub="${esc(d.subsystem)} · Click to open patch" />
      `;
    })
    .join("");

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 ${w} ${totalH}" class="obs-chart-svg" style="min-width:640px;" role="img" aria-label="Open CommitFest patches plotted by author prior PostgreSQL commits and status">
        ${gridLines}
        ${laneChrome}
        ${dotEls}
      </svg>
    </div>
  `;
}
