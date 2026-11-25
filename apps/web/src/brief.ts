import type { PublishedBriefRecord } from "./db.ts";

interface BriefStats {
  totals?: {
    total?: number;
    open?: number;
    closed?: number;
    roasted?: number;
    unroasted?: number;
    openRoasted?: number;
    openUnroasted?: number;
  };
  verdicts?: Array<{ verdict: string; all: number; open: number }>;
  statusMatrix?: Array<{ status: string; isClosed: boolean; total: number; counts: Record<string, number> }>;
  topTopics?: Array<{ topic: string; total: number; open: number; roasted: number; clean: number; ready: number }>;
  leaderboards?: {
    authors?: Array<{ name: string; count: number }>;
    reviewers?: Array<{ name: string; count: number }>;
    committers?: Array<{ name: string; count: number }>;
  };
}

interface BriefShortlistItem {
  cf_id: number;
  title: string;
  status: string;
  authors: string;
  verdict: string;
  kind?: string;
  seen_in_production?: boolean;
  workaround?: string;
  reasons?: string[];
  experts?: Array<{ name: string }>;
  thread_url?: string;
}

interface BriefClosingItem {
  cf_id: number;
  title: string;
  status: string;
  authors: string;
  verdict: string;
  workaround?: string;
  failing_summary?: string;
  recommended_action?: string;
  reasons?: string[];
  next_step_for_author?: string;
  thread_url?: string;
}

interface BriefEntryItem {
  cf_id: number;
  title: string;
  status: string;
  topic?: string;
  authors: string;
  reviewers?: string;
  committer?: string;
  verdict: string;
  kind?: string;
  seen_in_production?: boolean;
  workaround?: string;
  thread_url?: string;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanVerdict(v: string): string {
  if (!v || v === "UNROASTED") return "Not reviewed";
  if (v === "NO-FUNDAMENTAL-OBJECTION") return "No fundamental objection";
  if (v === "NEEDS-COMMITTER-EYES") return "Needs committer eyes";
  if (v === "NEEDS-DESIGN-DISCUSSION") return "Needs design discussion";
  if (v === "LIKELY-REJECT") return "Likely reject";
  return v;
}

function verdictDotColor(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return "#4cb782";
  if (v === "NEEDS-COMMITTER-EYES") return "#5e6ad2";
  if (v === "NEEDS-DESIGN-DISCUSSION") return "#e0a83c";
  if (v === "LIKELY-REJECT") return "#eb5757";
  return "#7c7e87";
}

function renderSvgDonut(segments: Array<{ label: string; value: number; color: string }>): string {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) return "";
  const r = 46;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const circles = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const dash = (s.value / total) * c;
      const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}" stroke-width="14" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      offset += dash;
      return el;
    })
    .join("");
  return `
    <svg viewBox="0 0 120 120" width="128" height="128" aria-label="Verdict distribution">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(128,128,128,0.15)" stroke-width="14" />
      ${circles}
      <text x="60" y="57" text-anchor="middle" fill="currentColor" font-size="18" font-weight="600">${total}</text>
      <text x="60" y="72" text-anchor="middle" fill="#8b8d98" font-size="9.5">entries</text>
    </svg>
  `;
}

/**
 * Generates Kirk's standalone, interactive, offline-safe HTML brief.
 * Carries a strict meta CSP (`default-src 'none'`) so opening it from `file://` can never make network calls.
 */
export function renderInteractiveBriefHtml(brief: PublishedBriefRecord, localWorkbenchUrl = "http://127.0.0.1:3432"): string {
  const stats = JSON.parse(brief.stats_json || "{}") as BriefStats;
  const shortlist = JSON.parse(brief.shortlist_json || "[]") as BriefShortlistItem[];
  const closing = JSON.parse(brief.closing_json || "[]") as BriefClosingItem[];
  const entries = JSON.parse(brief.entries_json || "[]") as BriefEntryItem[];

  const verdicts = stats.verdicts ?? [];
  const vCount = (k: string) => verdicts.find((x) => x.verdict === k)?.all ?? 0;
  const donutSvg = renderSvgDonut([
    { label: "No fundamental objection", value: vCount("NO-FUNDAMENTAL-OBJECTION"), color: "#4cb782" },
    { label: "Needs committer eyes", value: vCount("NEEDS-COMMITTER-EYES"), color: "#5e6ad2" },
    { label: "Needs design discussion", value: vCount("NEEDS-DESIGN-DISCUSSION"), color: "#e0a83c" },
    { label: "Likely reject", value: vCount("LIKELY-REJECT"), color: "#eb5757" },
    { label: "Not reviewed", value: vCount("UNROASTED"), color: "#7c7e87" },
  ]);

  const topTopics = (stats.topTopics ?? []).slice(0, 10);
  const maxTopic = Math.max(1, ...topTopics.map((t) => t.open || t.total));

  const matrixRows = (stats.statusMatrix ?? [])
    .map(
      (row) => `
      <tr>
        <td><strong>${esc(row.status)}</strong></td>
        <td class="num">${row.total}</td>
        <td class="num clickable" data-filter-status="${esc(row.status)}" data-filter-verdict="NO-FUNDAMENTAL-OBJECTION">${row.counts["NO-FUNDAMENTAL-OBJECTION"] ?? 0}</td>
        <td class="num clickable" data-filter-status="${esc(row.status)}" data-filter-verdict="NEEDS-COMMITTER-EYES">${row.counts["NEEDS-COMMITTER-EYES"] ?? 0}</td>
        <td class="num clickable" data-filter-status="${esc(row.status)}" data-filter-verdict="NEEDS-DESIGN-DISCUSSION">${row.counts["NEEDS-DESIGN-DISCUSSION"] ?? 0}</td>
        <td class="num clickable" data-filter-status="${esc(row.status)}" data-filter-verdict="LIKELY-REJECT">${row.counts["LIKELY-REJECT"] ?? 0}</td>
        <td class="num muted">${row.counts.UNROASTED ?? 0}</td>
      </tr>
    `,
    )
    .join("");

  const slRows = shortlist
    .map(
      (x, idx) => `
      <tr data-kind="${esc(x.kind || "feature")}" data-prod="${x.seen_in_production ? "1" : "0"}" data-wa="${x.workaround ? "1" : "0"}">
        <td class="num muted">${idx + 1}</td>
        <td class="mono">
          <strong>CF ${x.cf_id}</strong>
          <div class="links">
            <a href="https://commitfest.postgresql.org/patch/${x.cf_id}/" target="_blank" rel="noopener">CF ↗</a>
            ${x.thread_url ? `<a href="${esc(x.thread_url)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
            <a href="${esc(localWorkbenchUrl)}/?cf=${x.cf_id}" target="_blank" rel="noopener">Local ↗</a>
          </div>
        </td>
        <td>
          <div><strong>${esc(x.title)}</strong></div>
          <div class="sub">
            <span class="pill"><i style="background:${x.kind === "bugfix" ? "#5e6ad2" : "#9b82f3"}"></i>${x.kind === "bugfix" ? "Bug fix" : "Feature"}</span>
            ${x.seen_in_production ? `<span class="pill"><i style="background:#eb5757"></i>Seen in production</span>` : ""}
            ${x.workaround ? `<span class="pill" title="${esc(x.workaround)}"><i style="background:#e0a83c"></i>Workaround noted</span>` : ""}
            <span class="muted">${esc(x.authors || "—")}</span>
          </div>
        </td>
        <td>
          <span class="pill"><i style="background:${verdictDotColor(x.verdict)}"></i>${esc(humanVerdict(x.verdict))}</span>
          <div class="muted" style="font-size:11px;margin-top:3px;">${esc(x.status)}</div>
        </td>
        <td class="muted">${esc((x.reasons ?? []).join(" · "))}</td>
        <td>${(x.experts ?? []).map((e) => `<span class="pill">${esc(e.name)}</span>`).join(" ") || "—"}</td>
      </tr>
    `,
    )
    .join("");

  const clRows = closing
    .map(
      (x, idx) => `
      <tr>
        <td class="num muted">${idx + 1}</td>
        <td class="mono">
          <strong>CF ${x.cf_id}</strong>
          <div class="links">
            <a href="https://commitfest.postgresql.org/patch/${x.cf_id}/" target="_blank" rel="noopener">CF ↗</a>
            ${x.thread_url ? `<a href="${esc(x.thread_url)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
          </div>
        </td>
        <td>
          <div><strong>${esc(x.title)}</strong></div>
          <div class="muted" style="font-size:11.5px;">${esc(x.authors || "—")} · ${esc(x.status)}</div>
        </td>
        <td>
          <span class="pill"><i style="background:${verdictDotColor(x.verdict)}"></i>${esc(humanVerdict(x.verdict))}</span>
          ${x.failing_summary ? `<div style="font-size:11.5px;color:#e0a83c;margin-top:3px;">${esc(x.failing_summary)}</div>` : ""}
        </td>
        <td class="muted">
          ${x.workaround ? `<div style="margin-bottom:4px;"><span class="pill"><i style="background:#e0a83c"></i>Already exists / workaround</span> ${esc(x.workaround)}</div>` : ""}
          ${esc((x.reasons ?? []).join(" · "))}
        </td>
        <td class="muted">${esc(x.next_step_for_author || "")}</td>
      </tr>
    `,
    )
    .join("");

  const allRows = entries
    .map(
      (e) => `
      <tr data-search="${esc(`${e.cf_id} ${e.title} ${e.authors} ${e.reviewers || ""} ${e.committer || ""} ${e.topic || ""}`).toLowerCase()}" data-verdict="${esc(e.verdict || "UNROASTED")}" data-status="${esc(e.status || "")}">
        <td class="mono">
          <strong>${e.cf_id}</strong>
          <div class="links">
            <a href="https://commitfest.postgresql.org/patch/${e.cf_id}/" target="_blank" rel="noopener">CF ↗</a>
            ${e.thread_url ? `<a href="${esc(e.thread_url)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
          </div>
        </td>
        <td>
          <div><strong>${esc(e.title)}</strong></div>
          <div class="muted" style="font-size:11.5px;">${esc(e.authors || "—")}${e.reviewers ? ` · Rev: ${esc(e.reviewers)}` : ""}</div>
        </td>
        <td><span class="pill"><i style="background:${verdictDotColor(e.verdict)}"></i>${esc(humanVerdict(e.verdict))}</span></td>
        <td class="muted">${esc(e.status || "—")}</td>
        <td class="muted">${esc(e.topic || "—")}</td>
      </tr>
    `,
    )
    .join("");

  const bugfixCount = shortlist.filter((x) => x.kind === "bugfix").length;
  const featureCount = shortlist.filter((x) => x.kind !== "bugfix").length;
  const prodCount = shortlist.filter((x) => x.seen_in_production).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;" />
<title>${esc(brief.title)} — CommitFest Interactive Brief</title>
<style>
:root{--bg:#0c0d0f;--card:#141518;--border:rgba(255,255,255,.08);--border-s:rgba(255,255,255,.15);--text:#ececef;--muted:#9a9ba3;--dim:#7c7e87;--accent:#5e6ad2;--accent-t:#8f98f0;--hover:rgba(255,255,255,.04)}
@media (prefers-color-scheme:light){:root{--bg:#ffffff;--card:#ffffff;--border:rgba(0,0,0,.08);--border-s:rgba(0,0,0,.15);--text:#1a1b1e;--muted:#5f6168;--dim:#74767e;--accent:#5e6ad2;--accent-t:#4e5bc4;--hover:rgba(0,0,0,.04)}}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto}
a{color:var(--accent-t);text-decoration:none} a:hover{text-decoration:underline}
h1{font-size:20px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:14px;font-weight:600;margin:0 0 12px;letter-spacing:-.01em}
.muted{color:var(--muted)} .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.num{text-align:right;font-variant-numeric:tabular-nums}
.banner{border:1px solid var(--border-s);border-radius:8px;padding:11px 14px;margin:14px 0 18px;font-size:12.5px;color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin-bottom:18px}
.kpi{border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.kpi-l{font-size:12px;color:var(--dim);font-weight:500}
.kpi-v{font-size:22px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}
.grid2{display:grid;grid-template-columns:1.1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
.card{border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border-radius:99px;border:1px solid var(--border);font-size:11px;font-weight:500;white-space:nowrap}
.pill i{width:6px;height:6px;border-radius:50%;display:inline-block}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tab{height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font:500 12px inherit}
.tab:hover{background:var(--hover);color:var(--text)}
.tab.active{background:var(--hover);color:var(--text);border-color:var(--border-s)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;padding:7px 10px;font-size:12px;font-weight:500;color:var(--dim);border-bottom:1px solid var(--border)}
td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
tr:last-child td{border-bottom:none}
.links{display:flex;gap:8px;margin-top:3px;font-size:11px}
.sub{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px}
.hbar{display:grid;grid-template-columns:175px 1fr 42px;gap:8px;align-items:center;margin-bottom:7px;font-size:12px}
.hbar-t{height:7px;border-radius:99px;background:var(--hover);overflow:hidden}
.hbar-f{height:100%;background:var(--accent);border-radius:99px}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.controls input,.controls select{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--border-s);background:transparent;color:var(--text);font:12.5px inherit}
.controls input{flex:1;min-width:220px}
.clickable{cursor:pointer} .clickable:hover{background:var(--hover);color:var(--accent-t)}
.donut-row{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.legend{display:flex;flex-direction:column;gap:6px;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(brief.title)}</h1>
  <div class="muted" style="font-size:12px;">
    ${esc(brief.commitfest_label)} · Published ${esc(brief.created_at.slice(0, 16).replace("T", " "))} UTC
    ${brief.published_by_handle ? `by <strong>${esc(brief.published_by_name || brief.published_by_handle)}</strong> (@${esc(brief.published_by_handle)})` : ""}
    · Self-contained offline brief (zero external network calls)
  </div>

  <div class="banner">
    <strong>AI-prepared first pass:</strong> counts and verdicts are triage estimates to help committers and reviewers decide where to look first — never committer decisions. Always verify on <a href="https://commitfest.postgresql.org/" target="_blank" rel="noopener">commitfest.postgresql.org</a> and the <code>pgsql-hackers</code> thread.
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-l">Total entries</div><div class="kpi-v">${stats.totals?.total ?? entries.length}</div><div class="muted" style="font-size:11px;">${stats.totals?.open ?? 0} open · ${stats.totals?.closed ?? 0} closed</div></div>
    <div class="kpi"><div class="kpi-l">No fundamental objection</div><div class="kpi-v" style="color:#4cb782">${vCount("NO-FUNDAMENTAL-OBJECTION")}</div></div>
    <div class="kpi"><div class="kpi-l">Needs committer eyes</div><div class="kpi-v" style="color:#5e6ad2">${vCount("NEEDS-COMMITTER-EYES")}</div></div>
    <div class="kpi"><div class="kpi-l">Needs design discussion</div><div class="kpi-v" style="color:#e0a83c">${vCount("NEEDS-DESIGN-DISCUSSION")}</div></div>
    <div class="kpi"><div class="kpi-l">Likely reject</div><div class="kpi-v" style="color:#eb5757">${vCount("LIKELY-REJECT")}</div></div>
    <div class="kpi"><div class="kpi-l">Shortlist / Closing</div><div class="kpi-v">${shortlist.length} / ${closing.length}</div></div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Verdict distribution</h2>
      <div class="donut-row">
        ${donutSvg}
        <div class="legend">
          <div><span class="pill"><i style="background:#4cb782"></i>No fundamental objection</span> <strong>${vCount("NO-FUNDAMENTAL-OBJECTION")}</strong></div>
          <div><span class="pill"><i style="background:#5e6ad2"></i>Needs committer eyes</span> <strong>${vCount("NEEDS-COMMITTER-EYES")}</strong></div>
          <div><span class="pill"><i style="background:#e0a83c"></i>Needs design discussion</span> <strong>${vCount("NEEDS-DESIGN-DISCUSSION")}</strong></div>
          <div><span class="pill"><i style="background:#eb5757"></i>Likely reject</span> <strong>${vCount("LIKELY-REJECT")}</strong></div>
          <div><span class="pill"><i style="background:#7c7e87"></i>Not reviewed</span> <strong>${vCount("UNROASTED")}</strong></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Top PostgreSQL subsystems (open entries)</h2>
      ${topTopics
        .map(
          (t) => `
        <div class="hbar">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(t.topic)}">${esc(t.topic)}</div>
          <div class="hbar-t"><div class="hbar-f" style="width:${Math.round(((t.open || t.total) / maxTopic) * 100)}%"></div></div>
          <div class="num muted">${t.open || t.total}</div>
        </div>
      `,
        )
        .join("") || `<div class="muted">No topic breakdown included.</div>`}
    </div>
  </div>

  ${
    matrixRows
      ? `
    <div class="card">
      <h2>CommitFest Status × Verdict Matrix <span class="muted" style="font-weight:400;font-size:12px;">(click any cell to filter full table below)</span></h2>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>CF Status</th><th class="num">Total</th><th class="num">Clean</th><th class="num">Committer eyes</th><th class="num">Design disc.</th><th class="num">Likely reject</th><th class="num">Not reviewed</th></tr></thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </div>
    </div>
  `
      : ""
  }

  <div class="card">
    <h2>Shortlist: Worth Committer Attention (${shortlist.length})</h2>
    <div class="tabs">
      <button class="tab active" data-sl-tab="all">All (${shortlist.length})</button>
      <button class="tab" data-sl-tab="bugfix">Bug fixes (${bugfixCount})</button>
      <button class="tab" data-sl-tab="feature">Features (${featureCount})</button>
      <button class="tab" data-sl-tab="prod">Seen in production (${prodCount})</button>
    </div>
    <div style="overflow-x:auto;">
      <table id="sl-table">
        <thead><tr><th class="num">#</th><th>CF</th><th>Proposal</th><th>Verdict &amp; Status</th><th>Why it stands out</th><th>Suggested reviewers</th></tr></thead>
        <tbody>${slRows || `<tr><td colspan="6" class="muted">No shortlist entries.</td></tr>`}</tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <h2>Worth Closing or Rethinking (${closing.length})</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th class="num">#</th><th>CF</th><th>Proposal</th><th>Verdict / Failing Level</th><th>Workaround / Reasons</th><th>Actionable next step</th></tr></thead>
        <tbody>${clRows || `<tr><td colspan="6" class="muted">No closing candidates.</td></tr>`}</tbody>
      </table>
    </div>
  </div>

  <div class="card" id="all-entries-card">
    <h2>All Entries (${entries.length})</h2>
    <div class="controls">
      <input id="q" type="text" placeholder="Filter by CF #, title, author, reviewer, committer, or topic…" />
      <select id="vf">
        <option value="all">All verdicts</option>
        <option value="NO-FUNDAMENTAL-OBJECTION">No fundamental objection</option>
        <option value="NEEDS-COMMITTER-EYES">Needs committer eyes</option>
        <option value="NEEDS-DESIGN-DISCUSSION">Needs design discussion</option>
        <option value="LIKELY-REJECT">Likely reject</option>
        <option value="UNROASTED">Not reviewed</option>
      </select>
      <select id="sf">
        <option value="all">All statuses</option>
        <option value="Ready for Committer">Ready for Committer</option>
        <option value="Needs review">Needs review</option>
        <option value="Waiting on Author">Waiting on Author</option>
      </select>
    </div>
    <div style="overflow-x:auto;">
      <table id="all-table">
        <thead><tr><th>CF</th><th>Proposal &amp; People</th><th>Verdict</th><th>Status</th><th>Topic</th></tr></thead>
        <tbody>${allRows}</tbody>
      </table>
    </div>
  </div>
</div>

<script>
(function(){
  document.querySelectorAll('[data-sl-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-sl-tab]').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      var mode = btn.getAttribute('data-sl-tab');
      document.querySelectorAll('#sl-table tbody tr').forEach(function(tr){
        var show = true;
        if (mode === 'bugfix') show = tr.getAttribute('data-kind') === 'bugfix';
        else if (mode === 'feature') show = tr.getAttribute('data-kind') !== 'bugfix';
        else if (mode === 'prod') show = tr.getAttribute('data-prod') === '1';
        tr.style.display = show ? '' : 'none';
      });
    });
  });

  var qEl = document.getElementById('q');
  var vfEl = document.getElementById('vf');
  var sfEl = document.getElementById('sf');
  function filterAll(){
    var q = (qEl.value || '').trim().toLowerCase();
    var v = vfEl.value;
    var s = sfEl.value.toLowerCase();
    document.querySelectorAll('#all-table tbody tr').forEach(function(tr){
      var okQ = !q || (tr.getAttribute('data-search') || '').indexOf(q) !== -1;
      var okV = v === 'all' || tr.getAttribute('data-verdict') === v;
      var okS = s === 'all' || (tr.getAttribute('data-status') || '').toLowerCase().indexOf(s) !== -1;
      tr.style.display = (okQ && okV && okS) ? '' : 'none';
    });
  }
  qEl.addEventListener('input', filterAll);
  vfEl.addEventListener('change', filterAll);
  sfEl.addEventListener('change', filterAll);

  document.querySelectorAll('[data-filter-status]').forEach(function(td){
    td.addEventListener('click', function(){
      var st = td.getAttribute('data-filter-status') || 'all';
      var vd = td.getAttribute('data-filter-verdict') || 'all';
      vfEl.value = vd;
      sfEl.value = ['Ready for Committer','Needs review','Waiting on Author'].indexOf(st) !== -1 ? st : 'all';
      qEl.value = '';
      filterAll();
      document.getElementById('all-entries-card').scrollIntoView({ behavior: 'smooth' });
    });
  });
})();
</script>
</body>
</html>`;
}

export function renderBriefMarkdown(brief: PublishedBriefRecord): string {
  const shortlist = JSON.parse(brief.shortlist_json || "[]") as BriefShortlistItem[];
  const closing = JSON.parse(brief.closing_json || "[]") as BriefClosingItem[];
  const lines: string[] = [
    `# ${brief.title}`,
    "",
    `> ${brief.commitfest_label} · Published ${brief.created_at.slice(0, 10)} · AI-prepared first pass (triage aid, not a committer decision).`,
    "",
    `## Shortlist: Worth Committer Attention (${shortlist.length})`,
    "",
  ];
  shortlist.forEach((x, i) => {
    lines.push(`${i + 1}. **CF ${x.cf_id}: ${x.title}** (${humanVerdict(x.verdict)}${x.status ? `, ${x.status}` : ""})`);
    lines.push(`   - CommitFest: https://commitfest.postgresql.org/patch/${x.cf_id}/`);
    if (x.thread_url) lines.push(`   - Thread: ${x.thread_url}`);
    if (x.reasons?.length) lines.push(`   - Why: ${x.reasons.join("; ")}`);
  });
  lines.push("", `## Worth Closing or Rethinking (${closing.length})`, "");
  closing.forEach((x, i) => {
    lines.push(`${i + 1}. **CF ${x.cf_id}: ${x.title}** (${humanVerdict(x.verdict)})`);
    lines.push(`   - CommitFest: https://commitfest.postgresql.org/patch/${x.cf_id}/`);
    if (x.failing_summary) lines.push(`   - Failing: ${x.failing_summary}`);
    if (x.next_step_for_author) lines.push(`   - Next step: ${x.next_step_for_author}`);
  });
  return lines.join("\n") + "\n";
}
