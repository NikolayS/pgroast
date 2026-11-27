export interface MailingListsOverviewData {
  catalogCount: number;
  syncedListsCount: number;
  lastSyncedAt: string;
  totals: {
    totalMessages: number;
    totalThreads: number;
    last24h: number;
    last7d: number;
    last30d: number;
    withAttachments: number;
    linkedMessages: number;
    uniqueHackers: number;
  };
  lists: Array<{
    name: string;
    category: string;
    messageCount: number;
    firstSentAt: string;
    lastSentAt: string;
    lastSyncedAt: string;
    status: string;
  }>;
  daily: Array<{ day: string; count: number }>;
  hotThreads: Array<{
    listName: string;
    subject: string;
    messages: number;
    participants: number;
    hasAttachment: boolean;
    lastSentAt: string;
    messageId: string;
  }>;
  topPosters: Array<{
    slug: string;
    name: string;
    role: string;
    count: number;
    listsCount: number;
  }>;
}

export interface MailingListMessageItem {
  listName: string;
  messageId: string;
  subject: string;
  senderName: string;
  sentAt: string;
  hasAttachment: boolean;
  bodyExcerpt: string;
  personSlug: string;
  archiveUrl: string;
}

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

function renderDailyVolumeSvg(daily: Array<{ day: string; count: number }>): string {
  if (daily.length === 0) return `<div class="empty-state">No daily volume data synced yet.</div>`;
  const w = 620;
  const h = 148;
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxVal = Math.max(1, ...daily.map((d) => d.count));
  const step = plotW / Math.max(1, daily.length);
  const barW = Math.max(4, Math.min(20, step * 0.7));

  const bars = daily
    .map((d, i) => {
      const bh = Math.max(2, (d.count / maxVal) * plotH);
      const x = padL + i * step + (step - barW) / 2;
      const y = padT + plotH - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="var(--accent)"><title>${esc(d.day)}: ${fmtNum(d.count)} messages</title></rect>`;
    })
    .join("");

  const labelStep = Math.max(1, Math.ceil(daily.length / 6));
  const labels = daily
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== daily.length - 1) return "";
      const x = padL + i * step + step / 2;
      return `<text x="${x.toFixed(1)}" y="${h - 6}" text-anchor="middle" fill="var(--dim)" font-size="10">${esc(d.day.slice(5))}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="obs-chart-svg" role="img" aria-label="Daily mailing list volume">
      <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="var(--border)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--border)" />
      <text x="${padL - 5}" y="${padT + 8}" text-anchor="end" fill="var(--dim)" font-size="10">${fmtNum(maxVal)}</text>
      <text x="${padL - 5}" y="${padT + plotH}" text-anchor="end" fill="var(--dim)" font-size="10">0</text>
      ${bars}
      ${labels}
    </svg>
  `;
}

export function renderListMessagesRows(messages: MailingListMessageItem[]): string {
  if (messages.length === 0) {
    return `<div class="empty-state">No archived messages match your filter.</div>`;
  }
  return messages
    .map(
      (m) => `
    <div class="obs-commit-row">
      <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div class="row" style="gap:6px;flex-wrap:wrap;">
          <span class="tag-micro mono">${esc(m.listName)}</span>
          ${m.hasAttachment ? `<span class="pill p-ok">📎 attachment</span>` : ""}
          ${
            m.personSlug
              ? `<button type="button" class="btn btn-ghost btn-sm" style="padding:2px 7px;font-size:11.5px;font-weight:600;" data-open-hacker="${esc(m.personSlug)}">${esc(m.senderName)} →</button>`
              : `<span class="muted" style="font-size:12px;font-weight:600;">${esc(m.senderName || "Unknown")}</span>`
          }
        </div>
        <div class="row" style="gap:8px;font-size:11.5px;">
          <span class="mono dim">${esc(m.sentAt.slice(0, 16).replace("T", " "))} UTC</span>
          <a href="${esc(m.archiveUrl)}" target="_blank" rel="noopener">Thread ↗</a>
        </div>
      </div>
      <div class="obs-commit-subj">${esc(m.subject)}</div>
      ${m.bodyExcerpt ? `<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.45;">${esc(m.bodyExcerpt)}</div>` : ""}
    </div>
  `,
    )
    .join("");
}

export function renderListsTab(params: {
  overview: MailingListsOverviewData | null;
  loading: boolean;
  error: string;
  selectedList: string;
  search: string;
  attachmentsOnly: boolean;
  messages: MailingListMessageItem[];
}): string {
  const { overview, loading, error, selectedList, search, attachmentsOnly, messages } = params;

  if (loading && !overview) {
    return `
      <div class="card">
        <div class="loading-state" style="padding:48px 0;">
          <div class="spinner"></div>
          <div class="muted">Loading PostgreSQL Mailing Lists Archive…</div>
        </div>
      </div>
    `;
  }
  if (error && !overview) {
    return `<div class="card"><div class="empty-state">Failed to load mailing lists archive: ${esc(error)}</div></div>`;
  }
  if (!overview || overview.totals.totalMessages === 0) {
    return `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">Mailing Lists Archive not synced yet</div>
          <p class="muted" style="max-width:520px;margin:0 auto;">Run <code class="mono">bun run web:sync-lists --all --days 14</code> (or <code class="mono">--daemon</code> for continuous sync) to populate PostgreSQL mailing lists.</p>
        </div>
      </div>
    `;
  }

  const t = overview.totals;
  const activeLists = overview.lists.filter((l) => l.messageCount > 0);
  const linkedPct = t.totalMessages > 0 ? Math.round((t.linkedMessages / t.totalMessages) * 100) : 0;

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">PostgreSQL Mailing Lists Archive</h1>
        <div class="page-sub">
          ${overview.catalogCount} public PostgreSQL lists cataloged · ${overview.syncedListsCount} synced · ${fmtNum(t.totalMessages)} messages indexed
          ${overview.lastSyncedAt ? ` · Last synced ${esc(overview.lastSyncedAt.slice(0, 16).replace("T", " "))} UTC` : ""}
        </div>
      </div>
      <span class="pill p-ok">Continuous Sync</span>
    </div>

    <div class="kpis">
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l">Public lists cataloged</div>
        <div class="kpi-v">${overview.catalogCount}</div>
        <div class="kpi-sub">${overview.syncedListsCount} continuously synced</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l"><span class="dot" style="background:var(--accent)"></span>Messages archived</div>
        <div class="kpi-v">${fmtNum(t.totalMessages)}</div>
        <div class="kpi-sub">${fmtNum(t.totalThreads)} threads</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l"><span class="dot" style="background:var(--ok)"></span>Last 24h / 7d</div>
        <div class="kpi-v">${fmtNum(t.last24h)}</div>
        <div class="kpi-sub">${fmtNum(t.last7d)} in last 7 days</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l">Patch / file attachments</div>
        <div class="kpi-v">${fmtNum(t.withAttachments)}</div>
        <div class="kpi-sub">Messages with 📎</div>
      </div>
      <div class="kpi" style="cursor:default;">
        <div class="kpi-l">Linked to Hacker Profiles</div>
        <div class="kpi-v">${linkedPct}%</div>
        <div class="kpi-sub">${fmtNum(t.uniqueHackers)} unified contributors</div>
      </div>
    </div>

    <div class="grid2" style="margin-bottom:14px;">
      <div class="card" style="margin-bottom:0;">
        <div class="card-head">
          <h2>Daily Mailing List Volume (30d)</h2>
          <span class="dim" style="font-size:12px;">${fmtNum(t.last30d)} messages</span>
        </div>
        ${renderDailyVolumeSvg(overview.daily)}
      </div>

      <div class="card" style="margin-bottom:0;">
        <div class="card-head">
          <h2>Top Posters (Last 30d)</h2>
          <span class="dim" style="font-size:12px;">Tap linked names for /hacker/&lt;slug&gt;</span>
        </div>
        <div class="lb-list">
          ${overview.topPosters
            .slice(0, 10)
            .map(
              (p, i) =>
                p.slug
                  ? `
              <button type="button" class="lb-row" data-open-hacker="${esc(p.slug)}">
                <span class="lb-rank mono">${i + 1}</span>
                <span class="lb-name"><strong>${esc(p.name)}</strong> <span class="dim" style="font-size:11px;">· ${p.listsCount} list${p.listsCount === 1 ? "" : "s"}</span></span>
                <span class="lb-count mono">${fmtNum(p.count)}</span>
              </button>
            `
                  : `
              <div class="lb-row" style="cursor:default;">
                <span class="lb-rank mono">${i + 1}</span>
                <span class="lb-name">${esc(p.name)} <span class="dim" style="font-size:11px;">· ${p.listsCount} list${p.listsCount === 1 ? "" : "s"}</span></span>
                <span class="lb-count mono">${fmtNum(p.count)}</span>
              </div>
            `,
            )
            .join("")}
        </div>
      </div>
    </div>

    ${
      overview.hotThreads.length > 0
        ? `
      <div class="card">
        <div class="card-head">
          <h2>Most Active Threads (Last 30d)</h2>
          <span class="dim" style="font-size:12px;">Across all synced lists</span>
        </div>
        <div class="lb-list">
          ${overview.hotThreads
            .slice(0, 10)
            .map(
              (th) => `
            <a class="lb-row" href="https://www.postgresql.org/message-id/flat/${encodeURIComponent(th.messageId)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
              <span class="tag-micro mono" style="flex-shrink:0;">${esc(th.listName)}</span>
              <span class="lb-name">${th.hasAttachment ? "📎 " : ""}${esc(th.subject)}</span>
              <span class="mono dim" style="font-size:11.5px;flex-shrink:0;">${th.messages} msgs · ${th.participants} people ↗</span>
            </a>
          `,
            )
            .join("")}
        </div>
      </div>
    `
        : ""
    }

    <!-- Filterable Archive Browser -->
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Browse &amp; Search Mailing Lists</h2>
          <div class="dim" style="font-size:12px;">Filter by any PostgreSQL mailing list, subject, sender, or patch attachment</div>
        </div>
      </div>

      <div class="chips" role="tablist" aria-label="Filter by mailing list" style="margin-bottom:10px;">
        <button type="button" class="chip ${selectedList === "all" ? "active" : ""}" data-list-filter="all">All lists (${fmtNum(t.totalMessages)})</button>
        ${activeLists
          .slice(0, 18)
          .map(
            (l) => `
          <button type="button" class="chip ${selectedList === l.name ? "active" : ""}" data-list-filter="${esc(l.name)}">
            ${esc(l.name)} <span class="dim">(${fmtNum(l.messageCount)})</span>
          </button>
        `,
          )
          .join("")}
      </div>

      <div class="obs-dir-controls">
        <div class="search-box" style="flex:1;margin-bottom:0;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="lists-search-input" type="search" autocomplete="off" value="${esc(search)}" placeholder="Search subject, sender, or excerpt…" />
        </div>
        <select id="lists-all-select" aria-label="Choose any of the 51 PostgreSQL lists">
          <option value="all" ${selectedList === "all" ? "selected" : ""}>All ${overview.catalogCount} lists</option>
          ${overview.lists
            .map(
              (l) =>
                `<option value="${esc(l.name)}" ${selectedList === l.name ? "selected" : ""}>${esc(l.name)} (${l.messageCount})</option>`,
            )
            .join("")}
        </select>
        <label class="row" style="gap:6px;cursor:pointer;font-size:12.5px;white-space:nowrap;">
          <input type="checkbox" id="lists-att-only" ${attachmentsOnly ? "checked" : ""} />
          <span>📎 Patches / attachments</span>
        </label>
      </div>

      <div class="issue-list" id="lists-messages-mount">
        ${renderListMessagesRows(messages)}
      </div>
    </div>
  `;
}
