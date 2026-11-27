/**
 * Layout-matched animated grayscale skeleton preloaders (zero layout shift).
 * Every async view renders shimmer rectangles matching its real geometry instead
 * of a tiny centered spinner.
 */

function skelLine(w: string, h = 12, extraStyle = ""): string {
  return `<div class="skel skel-line" style="width:${w};height:${h}px;${extraStyle}"></div>`;
}

function skelRect(w: string, h: number, radius = 10, extraStyle = ""): string {
  return `<div class="skel skel-rect" style="width:${w};height:${h}px;border-radius:${radius}px;${extraStyle}"></div>`;
}

export function renderPageHeadSkeleton(withRightButtons = true): string {
  return `
    <div class="page-head" aria-hidden="true">
      <div class="page-head-main" style="flex:1;">
        ${skelLine("130px", 10, "margin-bottom:8px;")}
        ${skelLine("min(420px, 78%)", 26, "margin-bottom:8px;")}
        ${skelLine("min(560px, 92%)", 13)}
      </div>
      ${
        withRightButtons
          ? `<div class="row" style="gap:6px;">
              ${skelRect("96px", 30, 8)}
              ${skelRect("84px", 30, 8)}
            </div>`
          : ""
      }
    </div>
  `;
}

export function renderKpisSkeleton(count = 4): string {
  const items = Array.from({ length: count })
    .map(
      () => `
    <div class="kpi skel-card-shell" style="cursor:default;">
      ${skelLine("65%", 11, "margin-bottom:10px;")}
      ${skelLine("44%", 24, "margin-bottom:8px;")}
      ${skelLine("82%", 10)}
    </div>`,
    )
    .join("");
  return `<div class="kpis" aria-hidden="true">${items}</div>`;
}

export function renderBriefSkeleton(): string {
  const rows = Array.from({ length: 6 })
    .map(
      () => `
    <div class="skel-list-row">
      <div style="flex:1;min-width:0;">
        ${skelLine("140px", 11, "margin-bottom:7px;")}
        ${skelLine("76%", 15, "margin-bottom:6px;")}
        ${skelLine("52%", 11)}
      </div>
      ${skelRect("86px", 22, 999)}
    </div>`,
    )
    .join("");
  return `
    <div class="skel-page" role="status" aria-label="Loading CommitFest brief">
      ${renderPageHeadSkeleton(true)}
      <div class="card" style="padding:16px 18px;">
        ${skelLine("220px", 15, "margin-bottom:10px;")}
        ${skelLine("92%", 12, "margin-bottom:6px;")}
        ${skelLine("68%", 12)}
      </div>
      ${renderKpisSkeleton(5)}
      <div class="card">
        ${skelLine("180px", 15, "margin-bottom:14px;")}
        <div class="grid2">
          ${skelRect("100%", 180, 10)}
          ${skelRect("100%", 180, 10)}
        </div>
      </div>
      <div class="card">
        ${skelLine("160px", 15, "margin-bottom:12px;")}
        ${rows}
      </div>
    </div>
  `;
}

export function renderStatsSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading CommitFest stats">
      ${renderPageHeadSkeleton(true)}
      <div class="card">
        ${skelLine("210px", 11, "margin-bottom:8px;")}
        ${skelLine("62%", 20, "margin-bottom:14px;")}
        ${skelRect("100%", 310, 10)}
      </div>
      <div class="grid2" style="margin-bottom:14px;">
        <div class="card" style="margin-bottom:0;">
          ${skelLine("180px", 16, "margin-bottom:12px;")}
          ${skelRect("100%", 72, 8, "margin-bottom:8px;")}
          ${skelRect("100%", 72, 8, "margin-bottom:8px;")}
          ${skelRect("100%", 72, 8)}
        </div>
        <div class="card" style="margin-bottom:0;">
          ${skelLine("180px", 16, "margin-bottom:12px;")}
          ${skelRect("100%", 72, 8, "margin-bottom:8px;")}
          ${skelRect("100%", 72, 8, "margin-bottom:8px;")}
          ${skelRect("100%", 72, 8)}
        </div>
      </div>
      <div class="card">
        ${skelLine("240px", 16, "margin-bottom:14px;")}
        ${skelRect("100%", 260, 10)}
      </div>
    </div>
  `;
}

export function renderHackersSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading PostgreSQL Hacking Observatory">
      ${renderPageHeadSkeleton(true)}
      ${renderKpisSkeleton(4)}
      <div class="grid2" style="margin-bottom:14px;">
        <div class="card" style="margin-bottom:0;">
          ${skelLine("190px", 15, "margin-bottom:12px;")}
          ${skelRect("100%", 220, 10)}
        </div>
        <div class="card" style="margin-bottom:0;">
          ${skelLine("190px", 15, "margin-bottom:12px;")}
          ${skelRect("100%", 220, 10)}
        </div>
      </div>
      <div class="card">
        ${skelLine("220px", 15, "margin-bottom:12px;")}
        ${Array.from({ length: 6 })
          .map(() => `<div class="skel-list-row">${skelRect("28px", 28, 999)}${skelLine("45%", 13)}${skelLine("90px", 12, "margin-left:auto;")}</div>`)
          .join("")}
      </div>
    </div>
  `;
}

export function renderHackerProfileSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading contributor profile">
      <div class="patch-crumb" aria-hidden="true">${skelRect("130px", 28, 8)}</div>
      <div class="card" style="padding:20px;">
        <div class="row" style="gap:16px;align-items:center;">
          ${skelRect("60px", 60, 999)}
          <div style="flex:1;">
            ${skelLine("240px", 24, "margin-bottom:8px;")}
            ${skelLine("340px", 13)}
          </div>
        </div>
      </div>
      ${renderKpisSkeleton(4)}
      <div class="card">
        ${skelLine("180px", 15, "margin-bottom:12px;")}
        ${skelRect("100%", 150, 10)}
      </div>
      <div class="grid2">
        <div class="card">${skelRect("100%", 200, 10)}</div>
        <div class="card">${skelRect("100%", 200, 10)}</div>
      </div>
    </div>
  `;
}

export function renderListsSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading PostgreSQL Mailing Lists Archive">
      ${renderPageHeadSkeleton(true)}
      ${renderKpisSkeleton(4)}
      <div class="card">
        <div class="row" style="gap:8px;margin-bottom:14px;">
          ${skelRect("100%", 36, 8, "flex:1;")}
          ${skelRect("120px", 36, 8)}
        </div>
        ${Array.from({ length: 8 })
          .map(
            () => `
          <div class="skel-list-row">
            <div style="flex:1;">
              ${skelLine("68%", 14, "margin-bottom:6px;")}
              ${skelLine("42%", 11)}
            </div>
            ${skelLine("76px", 11)}
          </div>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

export function renderContributeCoverageSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading live CommitFest coverage">
      ${renderKpisSkeleton(4)}
      ${skelRect("100%", 16, 999, "margin-bottom:12px;")}
      <div class="row" style="gap:12px;flex-wrap:wrap;">
        ${skelLine("140px", 11)}
        ${skelLine("140px", 11)}
        ${skelLine("140px", 11)}
      </div>
    </div>
  `;
}

export function renderConnectSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading Setup Backoffice">
      ${renderPageHeadSkeleton(false)}
      <div class="grid2" style="margin-bottom:12px;">
        <div class="card" style="margin-bottom:0;padding:18px;">
          ${skelLine("140px", 18, "margin-bottom:10px;")}
          ${skelLine("90%", 12, "margin-bottom:8px;")}
          ${skelLine("82%", 12, "margin-bottom:8px;")}
          ${skelLine("74%", 12)}
        </div>
        <div class="card" style="margin-bottom:0;padding:18px;">
          ${skelLine("160px", 18, "margin-bottom:10px;")}
          ${skelLine("92%", 12, "margin-bottom:8px;")}
          ${skelLine("80%", 12, "margin-bottom:8px;")}
          ${skelLine("70%", 12)}
        </div>
      </div>
      <div class="card" style="padding:18px;">
        ${skelLine("240px", 18, "margin-bottom:10px;")}
        ${skelLine("75%", 12, "margin-bottom:14px;")}
        <div class="row" style="gap:8px;margin-bottom:14px;">
          ${skelRect("160px", 36, 8)}
          ${skelRect("160px", 36, 8)}
        </div>
        ${skelRect("100%", 110, 10)}
      </div>
    </div>
  `;
}

export function renderListPageSkeleton(titleLabel = "Loading items"): string {
  return `
    <div class="skel-page" role="status" aria-label="${titleLabel}">
      ${renderPageHeadSkeleton(true)}
      <div class="card" style="padding:14px 16px;">
        <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          ${skelRect("260px", 34, 8, "flex:1;")}
          ${skelRect("90px", 30, 999)}
          ${skelRect("90px", 30, 999)}
          ${skelRect("90px", 30, 999)}
        </div>
        ${Array.from({ length: 8 })
          .map(
            () => `
          <div class="skel-list-row">
            <div style="flex:1;">
              ${skelLine("120px", 11, "margin-bottom:7px;")}
              ${skelLine("78%", 15, "margin-bottom:6px;")}
              ${skelLine("50%", 11)}
            </div>
            ${skelRect("92px", 22, 999)}
          </div>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

export function renderPatchOverviewSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading patch opinions">
      <div class="card" style="padding:16px;">
        ${skelLine("190px", 16, "margin-bottom:10px;")}
        ${skelLine("65%", 12, "margin-bottom:12px;")}
        ${skelRect("100%", 10, 999)}
      </div>
      <div class="card" style="padding:16px;">
        <div class="row" style="gap:10px;align-items:center;margin-bottom:12px;">
          ${skelRect("32px", 32, 999)}
          <div style="flex:1;">
            ${skelLine("180px", 14, "margin-bottom:6px;")}
            ${skelLine("240px", 11)}
          </div>
          ${skelRect("96px", 22, 999)}
        </div>
        ${skelLine("96%", 12, "margin-bottom:7px;")}
        ${skelLine("92%", 12, "margin-bottom:7px;")}
        ${skelLine("74%", 12)}
      </div>
    </div>
  `;
}

export function renderDiscussionSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading discussion thread">
      <div class="card" style="padding:16px;">
        ${skelLine("160px", 13, "margin-bottom:10px;")}
        ${skelLine("94%", 12, "margin-bottom:6px;")}
        ${skelLine("80%", 12)}
      </div>
      ${Array.from({ length: 4 })
        .map(
          () => `
        <div class="card" style="padding:16px;">
          <div class="row" style="gap:10px;align-items:center;margin-bottom:10px;">
            ${skelRect("28px", 28, 999)}
            ${skelLine("170px", 13)}
            ${skelLine("90px", 11, "margin-left:auto;")}
          </div>
          ${skelLine("96%", 12, "margin-bottom:6px;")}
          ${skelLine("88%", 12, "margin-bottom:6px;")}
          ${skelLine("62%", 12)}
        </div>`,
        )
        .join("")}
    </div>
  `;
}

export function renderDiffSkeleton(): string {
  return `
    <div class="skel-page" role="status" aria-label="Loading unified diff">
      <div class="card" style="padding:16px;">
        <div class="row" style="gap:10px;margin-bottom:14px;">
          ${skelLine("260px", 15)}
          ${skelRect("60px", 20, 999, "margin-left:auto;")}
        </div>
        ${Array.from({ length: 12 })
          .map((_, i) => skelLine(`${52 + ((i * 19) % 44)}%`, 11, "margin-bottom:7px;"))
          .join("")}
      </div>
    </div>
  `;
}
