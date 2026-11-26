import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import type { RoastJson, RoastObjection, RoastRunRecord } from "../types.ts";
import { buildFailingSummary, buildShortlistAndTop50, classifyEntryKind, detectProductionSignal, extractWorkaroundFinding } from "./shortlist.ts";
import { buildStatsReport } from "./stats.ts";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanVerdict(verdict: string): string {
  if (!verdict || verdict === "UNROASTED") return "Not roasted";
  if (verdict === "NO-FUNDAMENTAL-OBJECTION") return "No fundamental objection";
  if (verdict === "NEEDS-COMMITTER-EYES") return "Needs committer eyes";
  if (verdict === "NEEDS-DESIGN-DISCUSSION") return "Needs design discussion";
  if (verdict === "LIKELY-REJECT") return "Likely reject";
  return verdict;
}

function verdictClass(verdict: string): string {
  if (verdict === "NO-FUNDAMENTAL-OBJECTION") return "ok";
  if (verdict === "NEEDS-COMMITTER-EYES") return "info";
  if (verdict === "NEEDS-DESIGN-DISCUSSION") return "warn";
  if (verdict === "LIKELY-REJECT") return "danger";
  return "neutral";
}

function renderTrackerSnippet(analyticsBeaconUrl?: string): string {
  const safeBeacon = (analyticsBeaconUrl || "").trim();
  const beaconJs = safeBeacon
    ? `
    (function(){
      var u = ${JSON.stringify(safeBeacon)};
      function ping(evt, meta){
        try {
          var body = JSON.stringify({ event: evt, path: location.pathname, meta: meta || {}, ts: new Date().toISOString() });
          if (navigator.sendBeacon) navigator.sendBeacon(u, body);
          else fetch(u, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function(){});
        } catch(e){}
      }
      ping("pageview");
      document.addEventListener("click", function(ev){
        var a = ev.target && ev.target.closest ? ev.target.closest("a[data-track]") : null;
        if (a) ping("click", { track: a.getAttribute("data-track"), href: a.href });
      });
    })();`
    : `
    /* Optional lightweight page-view & outbound-link tracking hook:
       pass analyticsBeaconUrl when exporting, or drop in Plausible/Umami/GoatCounter here.
       Every CommitFest & thread link carries a data-track attribute. */`;
  return `<script>${beaconJs}</script>`;
}

const SNAPSHOT_CSS = `
:root{--bg:#0d1117;--card:#161b22;--elev:#1c2128;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--ok:#3fb950;--warn:#d29922;--danger:#f85149;--purple:#bc8cff;}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.wrap{max-width:1160px;margin:0 auto;}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.banner{background:rgba(210,153,34,0.12);border:1px solid rgba(210,153,34,0.4);border-radius:8px;padding:12px 16px;margin-bottom:18px;font-size:13px;}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px;}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;}
.kpi-label{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em}
.kpi-val{font-size:24px;font-weight:700;margin-top:4px}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap}
.ok{background:rgba(63,185,80,.15);color:var(--ok)}
.info{background:rgba(88,166,255,.15);color:var(--accent)}
.warn{background:rgba(210,153,34,.18);color:var(--warn)}
.danger{background:rgba(248,81,73,.16);color:var(--danger)}
.purple{background:rgba(188,140,255,.16);color:var(--purple)}
.neutral{background:var(--elev);color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;color:var(--muted);background:var(--elev)}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.tab{background:var(--elev);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:600;font-size:12.5px}
.tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.callout{border:1px solid rgba(210,153,34,.45);background:rgba(210,153,34,.08);padding:10px 12px;border-radius:6px;margin:10px 0}
.obj{border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:10px;background:var(--elev)}
.obj.fatal{border-color:rgba(248,81,73,.5);background:rgba(248,81,73,.06)}
.obj.thread{border-color:var(--border);opacity:.88}
.search-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.search-row input,.search-row select{background:var(--elev);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px}
.search-row input{flex:1;min-width:220px}
.muted{color:var(--muted)} .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.links{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{display:inline-block;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--elev);color:var(--text);font-size:12px;font-weight:600}
`;

export async function exportFrozenStaticSnapshot(
  db: AppDatabase,
  opts?: {
    outDir?: string;
    topN?: number;
    rejectN?: number;
    analyticsBeaconUrl?: string;
  },
): Promise<{
  outDir: string;
  indexPath: string;
  entryPagesCount: number;
  frozenAt: string;
}> {
  const frozenAt = new Date().toISOString();
  const stamp = frozenAt.slice(0, 16).replace(/[:T]/g, "-");
  const outDir = opts?.outDir || join(DATA_DIR, "snapshots", `snapshot-${stamp}`);
  const cfDir = join(outDir, "cf");
  mkdirSync(cfDir, { recursive: true });

  const topN = opts?.topN ?? 40;
  const rejectN = opts?.rejectN ?? 50;
  const [sl, stats, allWithRoasts] = await Promise.all([
    buildShortlistAndTop50(db, { topN, rejectN, includeExperts: true }),
    buildStatsReport(db),
    db.getAllEntriesWithRoasts(),
  ]);
  const tracker = renderTrackerSnippet(opts?.analyticsBeaconUrl);

  // Collect all entries linked from shortlist + top50Closing + all open roasted entries for frozen pages
  const allRoasted = allWithRoasts.filter(
    (r) => !/^(?:committed|rejected|withdrawn|returned with feedback|moved to next cf)$/i.test((r.status || "").trim()),
  );
  const entryIds = new Set<number>();
  for (const x of sl.shortlist) entryIds.add(x.cf_id);
  for (const x of sl.top50Closing) entryIds.add(x.cf_id);
  for (const x of allRoasted) entryIds.add(x.cf_id);

  let entryPagesCount = 0;
  for (const cfId of entryIds) {
    const entry = await db.getEntry(cfId);
    if (!entry) continue;
    let roast: RoastJson | null = null;
    if (entry.roast_json) {
      try {
        roast = JSON.parse(entry.roast_json) as RoastJson;
      } catch {
        roast = null;
      }
    }
    const runs: RoastRunRecord[] = await db.listRoastRuns(cfId);
    const workaround = extractWorkaroundFinding(roast);
    const failingSummary = buildFailingSummary(roast);
    const objs = roast?.objections ?? [];
    const novelObjs = objs.filter((o) => o.novelty !== "open_in_thread");
    const threadObjs = objs.filter((o) => o.novelty === "open_in_thread");
    const slItem = sl.shortlist.find((x) => x.cf_id === cfId);

    const renderObj = (o: RoastObjection, isThread = false) => `
      <div class="obj ${o.severity === "fatal" ? "fatal" : isThread ? "thread" : ""}">
        <div style="margin-bottom:5px;">
          <span class="pill ${o.severity === "fatal" ? "danger" : "warn"}">${esc(o.severity || "fixable")}</span>
          ${o.category ? `<span class="pill neutral">${esc(o.category.replace(/[-_]+/g, " "))}</span>` : ""}
          <strong>${esc(o.title)}</strong>
        </div>
        ${o.failure_scenario ? `<p style="margin:4px 0;"><strong>Scenario:</strong> ${esc(o.failure_scenario)}</p>` : ""}
        ${o.argument ? `<p class="muted" style="margin:4px 0;">${esc(o.argument)}</p>` : ""}
        ${o.author_must_show ? `<p style="margin:6px 0 0;"><strong>Question for author:</strong> ${esc(o.author_must_show)}</p>` : ""}
      </div>
    `;

    const opinionsHtml =
      runs.length > 0
        ? `
      <div class="card">
        <h3 style="margin-top:0;">Model opinions (${runs.length})</h3>
        <table>
          <thead><tr><th>Run by</th><th>Backend / Models</th><th>Verdict</th><th>Confidence</th><th>Date</th></tr></thead>
          <tbody>
            ${runs
              .map(
                (r) => {
                  const who = r.contributor_name || r.contributor_handle || "Local user";
                  const handlePart =
                    r.contributor_handle && r.contributor_handle !== r.contributor_name
                      ? ` (${r.contributor_provider === "github" ? "@" : ""}${r.contributor_handle})`
                      : "";
                  const provBadge =
                    r.contributor_provider && r.contributor_provider !== "local"
                      ? ` <span class="pill neutral">${esc(r.contributor_provider)}</span>`
                      : "";
                  return `<tr>
                <td><strong>${esc(who)}</strong><span class="muted">${esc(handlePart)}</span>${provBadge}</td>
                <td class="mono">${esc(r.backend)} ${esc(r.models_json && r.models_json !== "{}" ? r.models_json : "")}</td>
                <td><span class="pill ${verdictClass(r.verdict)}">${esc(humanVerdict(r.verdict))}</span></td>
                <td>${esc(r.confidence || "—")}</td>
                <td class="muted">${esc(r.created_at.slice(0, 10))}</td>
              </tr>`;
                },
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
        : "";

    const pageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;" />
<title>CF ${entry.cf_id}: ${esc(entry.title)} — PG Roast Snapshot</title>
<style>${SNAPSHOT_CSS}</style>
</head>
<body>
<div class="wrap">
  <div style="margin-bottom:12px;"><a href="../index.html">← Back to CommitFest Snapshot</a></div>
  <div class="banner">
    <strong>Frozen AI-prepared first pass</strong> (snapshot ${esc(frozenAt.slice(0, 10))}). Treat counts and verdicts as estimates for human triage, not committer decisions. Read the CF thread before acting.
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div>
        <div>
          <span class="mono" style="font-weight:700;">CF ${entry.cf_id}</span>
          <span class="pill ${verdictClass(entry.verdict)}">${esc(humanVerdict(entry.verdict))}</span>
          ${entry.status ? `<span class="pill neutral">${esc(entry.status)}</span>` : ""}
          ${slItem ? `<span class="pill ${slItem.kind === "bugfix" ? "info" : "purple"}">${slItem.kind === "bugfix" ? "Bug fix" : "Feature"}</span>` : ""}
        </div>
        <h1 style="margin:8px 0 4px;font-size:20px;">${esc(entry.title)}</h1>
        <div class="muted">Authors: ${esc(entry.authors || "—")}${entry.reviewers ? ` · Reviewers: ${esc(entry.reviewers)}` : ""}</div>
      </div>
      <div class="links">
        <a class="btn" href="https://commitfest.postgresql.org/patch/${entry.cf_id}/" target="_blank" rel="noopener" data-track="cf-page-${entry.cf_id}">CF page ↗</a>
        ${entry.thread_url ? `<a class="btn" href="${esc(entry.thread_url)}" target="_blank" rel="noopener" data-track="cf-thread-${entry.cf_id}">CF thread ↗</a>` : ""}
      </div>
    </div>
    ${failingSummary ? `<p style="margin:10px 0 0;font-weight:600;color:var(--warn);">${esc(failingSummary)}</p>` : ""}
    ${workaround ? `<div class="callout"><strong>Already exists / workaround:</strong> ${esc(workaround)}</div>` : ""}
  </div>

  <div class="card">
    <h2 style="margin-top:0;font-size:16px;">Fast scan summary</h2>
    <p>${esc(roast?.verdict_reasoning || "No summary recorded.")}</p>
    ${roast?.brief?.problem ? `<p class="muted"><strong>Problem:</strong> ${esc(roast.brief.problem)}</p>` : ""}
    ${
      slItem?.experts?.length
        ? `<p><strong>Suggested reviewers:</strong> ${slItem.experts.map((e) => `<span class="pill neutral">${esc(e.name)}</span>`).join(" ")}</p>`
        : ""
    }
    ${novelObjs.length ? `<h3>Key objections (${novelObjs.length})</h3>${novelObjs.map((o) => renderObj(o, false)).join("")}` : ""}
    ${threadObjs.length ? `<h3>Already discussed on thread (${threadObjs.length})</h3>${threadObjs.map((o) => renderObj(o, true)).join("")}` : ""}
    ${
      roast?.questions?.length
        ? `<h3>Questions for author</h3><ul>${roast.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`
        : ""
    }
    ${entry.thread_url ? `<p style="margin-top:14px;"><a class="btn" href="${esc(entry.thread_url)}" target="_blank" rel="noopener" data-track="cf-thread-bottom-${entry.cf_id}">Read the full CF thread ↗</a></p>` : ""}
  </div>

  ${opinionsHtml}
</div>
${tracker}
</body>
</html>`;

    writeFileSync(join(cfDir, `${cfId}.html`), pageHtml, "utf8");
    entryPagesCount++;
  }

  const bugfixes = sl.shortlist.filter((x) => x.kind === "bugfix");
  const features = sl.shortlist.filter((x) => x.kind === "feature");

  const renderShortlistRows = (items: typeof sl.shortlist) =>
    items
      .map(
        (x, idx) => `
      <tr data-kind="${x.kind}" data-prod="${x.seen_in_production ? "1" : "0"}">
        <td class="mono muted">${idx + 1}</td>
        <td class="mono">
          <a href="./cf/${x.cf_id}.html" data-track="entry-${x.cf_id}"><strong>${x.cf_id}</strong></a>
          <div style="margin-top:3px;font-size:11px;">
            <a href="https://commitfest.postgresql.org/patch/${x.cf_id}/" target="_blank" rel="noopener" data-track="cf-page-${x.cf_id}">CF page ↗</a>
            ${x.thread_url ? ` · <a href="${esc(x.thread_url)}" target="_blank" rel="noopener" data-track="cf-thread-${x.cf_id}">CF thread ↗</a>` : ""}
          </div>
        </td>
        <td>
          <div><a href="./cf/${x.cf_id}.html" data-track="entry-${x.cf_id}"><strong>${esc(x.title)}</strong></a></div>
          <div style="margin-top:3px;">
            <span class="pill ${x.kind === "bugfix" ? "info" : "purple"}">${x.kind === "bugfix" ? "Bug fix" : "Feature"}</span>
            ${x.seen_in_production ? `<span class="pill danger">Seen in production</span>` : ""}
            ${x.workaround ? `<span class="pill warn" title="${esc(x.workaround)}">Workaround noted</span>` : ""}
            <span class="muted" style="font-size:12px;">${esc(x.authors || "—")}</span>
          </div>
        </td>
        <td>
          <span class="pill ${verdictClass(x.verdict)}">${esc(humanVerdict(x.verdict))}</span>
          <div class="muted" style="font-size:11.5px;margin-top:3px;">${esc(x.status || "—")}</div>
        </td>
        <td class="muted" style="font-size:12px;">${esc(x.reasons.join(" · "))}</td>
        <td>${x.experts.map((e) => `<span class="pill neutral">${esc(e.name)}</span>`).join(" ") || "—"}</td>
      </tr>
    `,
      )
      .join("");

  const allOpenRowsHtml = allRoasted
    .map((r) => {
      let parsed: RoastJson | null = null;
      try { parsed = JSON.parse(r.roast_json) as RoastJson; } catch { parsed = null; }
      const kind = classifyEntryKind(r.title, parsed);
      const prod = detectProductionSignal(r.title, parsed);
      const wa = extractWorkaroundFinding(parsed);
      return `
        <tr data-search="${esc(`${r.cf_id} ${r.title} ${r.authors} ${r.reviewers} ${r.status}`).toLowerCase()}" data-verdict="${esc(r.verdict)}" data-kind="${kind}" data-prod="${prod.seen ? "1" : "0"}">
          <td class="mono">
            <a href="./cf/${r.cf_id}.html" data-track="entry-${r.cf_id}"><strong>${r.cf_id}</strong></a>
            <div style="margin-top:2px;font-size:11px;white-space:nowrap;">
              <a href="https://commitfest.postgresql.org/patch/${r.cf_id}/" target="_blank" rel="noopener" data-track="cf-page-${r.cf_id}">CF page ↗</a>
              ${r.thread_url ? ` · <a href="${esc(r.thread_url)}" target="_blank" rel="noopener" data-track="cf-thread-${r.cf_id}">CF thread ↗</a>` : ""}
            </div>
          </td>
          <td>
            <div><a href="./cf/${r.cf_id}.html" data-track="entry-${r.cf_id}"><strong>${esc(r.title)}</strong></a></div>
            <div style="margin-top:3px;">
              <span class="pill ${kind === "bugfix" ? "info" : "purple"}">${kind === "bugfix" ? "Bug fix" : "Feature"}</span>
              ${prod.seen ? `<span class="pill danger">Seen in production</span>` : ""}
              ${wa ? `<span class="pill warn" title="${esc(wa)}">Workaround noted</span>` : ""}
              <span class="muted" style="font-size:12px;">${esc(r.authors || "—")}</span>
            </div>
          </td>
          <td><span class="pill ${verdictClass(r.verdict)}">${esc(humanVerdict(r.verdict))}</span></td>
          <td class="muted" style="font-size:12px;">${esc(r.status || "—")}</td>
          <td class="mono muted">${r.new_objection_count} new / ${r.objection_count}</td>
        </tr>
      `;
    })
    .join("");

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;" />
<title>PG Roast: Frozen CommitFest Snapshot (${esc(frozenAt.slice(0, 10))})</title>
<style>${SNAPSHOT_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1 style="margin:0 0 6px;">PG Roast: Frozen CommitFest Snapshot</h1>
  <div class="muted" style="margin-bottom:14px;">Snapshot frozen on ${esc(frozenAt.slice(0, 19).replace("T", " "))} UTC · Static, unchanging view for review &amp; feedback</div>

  <div class="banner">
    <strong>AI-prepared first pass:</strong> numbers and verdicts are estimates to help committers and reviewers decide where to look first. Nothing here is a committer decision. Open the <strong>CF page</strong> and <strong>CF thread</strong> to judge for yourself.
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Total entries</div><div class="kpi-val">${stats.totals.total}</div><div class="muted" style="font-size:11.5px;">${stats.totals.open} open · ${stats.totals.closed} closed</div></div>
    <div class="kpi"><div class="kpi-label">No fundamental objection</div><div class="kpi-val" style="color:var(--ok)">${sl.stats["NO-FUNDAMENTAL-OBJECTION"] ?? 0}</div></div>
    <div class="kpi"><div class="kpi-label">Needs committer eyes</div><div class="kpi-val" style="color:var(--accent)">${sl.stats["NEEDS-COMMITTER-EYES"] ?? 0}</div></div>
    <div class="kpi"><div class="kpi-label">Needs design discussion</div><div class="kpi-val" style="color:var(--warn)">${sl.stats["NEEDS-DESIGN-DISCUSSION"] ?? 0}</div></div>
    <div class="kpi"><div class="kpi-label">Likely reject</div><div class="kpi-val" style="color:var(--danger)">${sl.stats["LIKELY-REJECT"] ?? 0}</div></div>
    <div class="kpi"><div class="kpi-label">Not roasted</div><div class="kpi-val" style="color:var(--muted)">${sl.stats.UNROASTED ?? 0}</div></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0;">Shortlist: Worth Committer Attention (${sl.shortlist.length})</h2>
    <div class="tabs">
      <button class="tab active" onclick="filterSl('all', this)">All (${sl.shortlist.length})</button>
      <button class="tab" onclick="filterSl('bugfix', this)">Bug fixes (${bugfixes.length})</button>
      <button class="tab" onclick="filterSl('feature', this)">Features (${features.length})</button>
      <button class="tab" onclick="filterSl('prod', this)">Seen in production (${sl.shortlist.filter((x) => x.seen_in_production).length})</button>
    </div>
    <table id="sl-table">
      <thead><tr><th>#</th><th>CF</th><th>Proposal</th><th>Verdict &amp; Status</th><th>Why it stands out</th><th>Suggested reviewers</th></tr></thead>
      <tbody>${renderShortlistRows(sl.shortlist)}</tbody>
    </table>
  </div>

  <div class="card">
    <h2 style="margin-top:0;">Worth Closing or Rethinking (${sl.top50Closing.length})</h2>
    <table>
      <thead><tr><th>#</th><th>CF</th><th>Proposal</th><th>Verdict / Failing Level</th><th>Workaround / Reasons</th><th>Next step for author</th></tr></thead>
      <tbody>
        ${sl.top50Closing
          .map(
            (c, idx) => `
          <tr>
            <td class="mono muted">${idx + 1}</td>
            <td class="mono">
              <a href="./cf/${c.cf_id}.html" data-track="entry-${c.cf_id}"><strong>${c.cf_id}</strong></a>
              <div style="margin-top:3px;font-size:11px;">
                <a href="https://commitfest.postgresql.org/patch/${c.cf_id}/" target="_blank" rel="noopener" data-track="cf-page-${c.cf_id}">CF page ↗</a>
                ${c.thread_url ? ` · <a href="${esc(c.thread_url)}" target="_blank" rel="noopener" data-track="cf-thread-${c.cf_id}">CF thread ↗</a>` : ""}
              </div>
            </td>
            <td><a href="./cf/${c.cf_id}.html" data-track="entry-${c.cf_id}"><strong>${esc(c.title)}</strong></a><div class="muted" style="font-size:11.5px;">${esc(c.authors || "—")} · ${esc(c.status || "—")}</div></td>
            <td>
              <span class="pill ${verdictClass(c.verdict)}">${esc(humanVerdict(c.verdict))}</span>
              ${c.failing_summary ? `<div style="font-size:11.5px;color:var(--warn);margin-top:3px;">${esc(c.failing_summary)}</div>` : ""}
            </td>
            <td style="font-size:12px;">
              ${c.workaround ? `<div style="margin-bottom:4px;"><span class="pill warn">Already exists / workaround</span> ${esc(c.workaround)}</div>` : ""}
              ${esc(c.reasons.join("; "))}
            </td>
            <td class="muted" style="font-size:12px;">${esc(c.next_step_for_author)}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2 style="margin-top:0;">All Open Roasted Entries (${allRoasted.length})</h2>
    <div class="search-row">
      <input id="all-q" type="text" placeholder="Filter by CF #, title, author, status..." oninput="filterAll()" />
      <select id="all-verdict" onchange="filterAll()">
        <option value="all">All verdicts</option>
        <option value="NO-FUNDAMENTAL-OBJECTION">No fundamental objection</option>
        <option value="NEEDS-COMMITTER-EYES">Needs committer eyes</option>
        <option value="NEEDS-DESIGN-DISCUSSION">Needs design discussion</option>
        <option value="LIKELY-REJECT">Likely reject</option>
      </select>
      <select id="all-kind" onchange="filterAll()">
        <option value="all">Bug fixes + Features</option>
        <option value="bugfix">Bug fixes only</option>
        <option value="feature">Features only</option>
        <option value="prod">Seen in production</option>
      </select>
    </div>
    <table id="all-table">
      <thead><tr><th>CF</th><th>Proposal</th><th>Verdict</th><th>CF Status</th><th>Objections</th></tr></thead>
      <tbody>${allOpenRowsHtml}</tbody>
    </table>
  </div>
</div>
<script>
function filterSl(mode, btn){
  document.querySelectorAll('.tab').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('#sl-table tbody tr').forEach(function(tr){
    var show = mode === 'all' || (mode === 'prod' ? tr.dataset.prod === '1' : tr.dataset.kind === mode);
    tr.style.display = show ? '' : 'none';
  });
}
function filterAll(){
  var q = (document.getElementById('all-q').value || '').trim().toLowerCase();
  var v = document.getElementById('all-verdict').value;
  var k = document.getElementById('all-kind').value;
  document.querySelectorAll('#all-table tbody tr').forEach(function(tr){
    var okQ = !q || (tr.dataset.search || '').indexOf(q) !== -1;
    var okV = v === 'all' || tr.dataset.verdict === v;
    var okK = k === 'all' || (k === 'prod' ? tr.dataset.prod === '1' : tr.dataset.kind === k);
    tr.style.display = (okQ && okV && okK) ? '' : 'none';
  });
}
</script>
${tracker}
</body>
</html>`;

  const indexPath = join(outDir, "index.html");
  writeFileSync(indexPath, indexHtml, "utf8");
  await db.logAudit("export_static_snapshot", outDir, {
    entries: entryPagesCount,
    shortlist: sl.shortlist.length,
    closing: sl.top50Closing.length,
  });

  return { outDir, indexPath, entryPagesCount, frozenAt };
}
