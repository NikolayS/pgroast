type TabId = "brief" | "opinions" | "entries" | "coordination" | "connect";

interface HealthInfo {
  database: { version: string; database: string };
  counts: { briefs: number; entries: number; opinions: number };
  oauth: { githubConfigured: boolean; googleConfigured: boolean; devTokenMintEnabled: boolean };
  localWorkbenchUrl: string;
}

interface BriefSummary {
  id: number;
  slug: string;
  title: string;
  commitfest_label: string;
  published_by_handle: string;
  published_by_name: string;
  created_at: string;
}

interface OpinionItem {
  id: number;
  cf_id: number;
  contributor_name: string;
  contributor_handle: string;
  contributor_provider: string;
  backend: string;
  models_json: string;
  verdict: string;
  confidence: string;
  summary: string;
  created_at: string;
}

interface EntryItem {
  cf_id: number;
  title: string;
  status: string;
  topic: string;
  authors: string;
  reviewers: string;
  committer: string;
  thread_url: string;
  verdict: string;
  kind: string;
  seen_in_production: boolean;
}

interface CoordItem {
  id: number;
  cf_id: number | null;
  bug_ref: string;
  title: string;
  status: string;
  assignee_handle: string;
  assignee_name: string;
  note: string;
  updated_at: string;
}

const state = {
  tab: "brief" as TabId,
  health: null as HealthInfo | null,
  briefs: [] as BriefSummary[],
  selectedBriefSlug: "latest",
  opinions: [] as OpinionItem[],
  entries: [] as EntryItem[],
  entrySearch: "",
  coordination: [] as CoordItem[],
  mintedToken: "",
  mintedHandle: "",
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function verdictPill(v: string): string {
  if (v === "NO-FUNDAMENTAL-OBJECTION") return `<span class="pill p-ok">No fundamental objection</span>`;
  if (v === "NEEDS-COMMITTER-EYES") return `<span class="pill p-info">Needs committer eyes</span>`;
  if (v === "NEEDS-DESIGN-DISCUSSION") return `<span class="pill p-warn">Needs design discussion</span>`;
  if (v === "LIKELY-REJECT") return `<span class="pill p-danger">Likely reject</span>`;
  return `<span class="pill">${esc(v || "Not reviewed")}</span>`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadAll(): Promise<void> {
  const [health, bRes, oRes, eRes, cRes] = await Promise.all([
    api<HealthInfo>("/api/v1/health"),
    api<{ briefs: BriefSummary[] }>("/api/v1/briefs"),
    api<{ opinions: OpinionItem[] }>("/api/v1/opinions"),
    api<{ entries: EntryItem[] }>("/api/v1/entries"),
    api<{ items: CoordItem[] }>("/api/v1/coordination"),
  ]);
  state.health = health;
  state.briefs = bRes.briefs;
  if (bRes.briefs[0] && state.selectedBriefSlug === "latest") {
    state.selectedBriefSlug = bRes.briefs[0].slug;
  }
  state.opinions = oRes.opinions;
  state.entries = eRes.entries;
  state.coordination = cRes.items;
  const f = document.getElementById("footer-db-info");
  if (f && health.database.version) {
    f.textContent = `${health.database.version.split(" on ")[0]} · ${health.database.database}`;
  }
  render();
}

function renderBriefTab(): string {
  const activeSlug = state.briefs[0] ? state.selectedBriefSlug : "";
  if (!activeSlug) {
    return `
      <div class="card">
        <div class="card-head">
          <h2>Interactive CommitFest Brief (Downloadable HTML / Markdown / JSON)</h2>
          <button type="button" class="btn btn-primary" id="goto-connect-btn">Publish First Brief from Local Workbench →</button>
        </div>
        <p class="muted" style="margin:0;">
          No CommitFest brief has been published to this companion yet. Open your local <code>pgroast-app</code>, connect a publish-only token from the <strong>Connect Local</strong> tab, and click <strong>Publish Brief to Companion</strong>.
        </p>
      </div>
    `;
  }
  return `
    <div class="card">
      <div class="card-head">
        <div class="row">
          <h2>Interactive CommitFest Brief</h2>
          <select id="brief-select">
            ${state.briefs.map((b) => `<option value="${esc(b.slug)}" ${b.slug === activeSlug ? "selected" : ""}>${esc(b.title)} (${esc(b.created_at.slice(0, 10))})</option>`).join("")}
          </select>
        </div>
        <div class="row">
          <a class="btn btn-primary btn-sm" href="/briefs/${encodeURIComponent(activeSlug)}/download.html">Download HTML (.html)</a>
          <a class="btn btn-secondary btn-sm" href="/briefs/${encodeURIComponent(activeSlug)}/download.md">Markdown (.md)</a>
          <a class="btn btn-secondary btn-sm" href="/briefs/${encodeURIComponent(activeSlug)}/download.json">JSON (.json)</a>
        </div>
      </div>
      <p class="muted" style="margin:0 0 12px;font-size:12px;">
        Rendered inside a strict <code>sandbox allow-scripts</code> iframe with zero access to your session. Downloaded HTML copies carry <code>default-src 'none'</code> CSP so they work 100% offline.
      </p>
      <iframe class="brief-frame" sandbox="allow-scripts allow-popups" src="/briefs/${encodeURIComponent(activeSlug)}/embed" title="Interactive CommitFest Brief"></iframe>
    </div>
  `;
}

function renderOpinionsTab(): string {
  const localUrl = state.health?.localWorkbenchUrl || "http://127.0.0.1:3432";
  return `
    <div class="card">
      <div class="card-head">
        <h2>Community Model Opinions (${state.opinions.length})</h2>
        <span class="muted" style="font-size:12px;">Every opinion records who ran it + which model family produced it</span>
      </div>
      ${
        state.opinions.length === 0
          ? `<p class="muted">No published model opinions yet. Publish an opinion from your local workbench to share it with Kirk, Andrey, and other reviewers.</p>`
          : `
        <table>
          <thead><tr><th>CF</th><th>Posted By</th><th>Backend / Models</th><th>Verdict</th><th>Summary</th><th>Date</th></tr></thead>
          <tbody>
            ${state.opinions
              .map(
                (o) => `
              <tr>
                <td class="mono">
                  <a href="https://commitfest.postgresql.org/patch/${o.cf_id}/" target="_blank" rel="noopener"><strong>CF ${o.cf_id}</strong> ↗</a>
                  <div style="font-size:11px;margin-top:2px;"><a href="${esc(localUrl)}/?cf=${o.cf_id}" target="_blank" rel="noopener">Open locally ↗</a></div>
                </td>
                <td><strong>${esc(o.contributor_name)}</strong><div class="dim" style="font-size:11px;">@${esc(o.contributor_handle)} · ${esc(o.contributor_provider)}</div></td>
                <td class="mono" style="font-size:11.5px;">${esc(o.backend)} <span class="muted">${esc(o.models_json !== "{}" ? o.models_json : "")}</span></td>
                <td>${verdictPill(o.verdict)}<div class="dim" style="font-size:11px;">${esc(o.confidence)}</div></td>
                <td class="muted">${esc(o.summary || "—")}</td>
                <td class="dim mono" style="font-size:11px;">${esc(o.created_at.slice(0, 10))}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `
      }
    </div>
  `;
}

function renderEntriesTab(): string {
  const localUrl = state.health?.localWorkbenchUrl || "http://127.0.0.1:3432";
  const q = state.entrySearch.trim().toLowerCase();
  const filtered = state.entries.filter(
    (e) => !q || `${e.cf_id} ${e.title} ${e.authors} ${e.reviewers} ${e.committer} ${e.topic}`.toLowerCase().includes(q),
  );
  return `
    <div class="card">
      <div class="card-head">
        <h2>CommitFest Entries (${filtered.length})</h2>
        <input id="pub-entry-search" type="text" value="${esc(state.entrySearch)}" placeholder="Search people (Andrey, Nikolay…), topics, or CF #…" style="width:300px;" />
      </div>
      <table>
        <thead><tr><th>CF</th><th>Proposal &amp; People</th><th>Verdict</th><th>Status</th><th>Links</th></tr></thead>
        <tbody>
          ${
            filtered.length === 0
              ? `<tr><td colspan="5" class="muted">No entries match.</td></tr>`
              : filtered
                  .slice(0, 200)
                  .map(
                    (e) => `
              <tr>
                <td class="mono"><strong>${e.cf_id}</strong></td>
                <td>
                  <div><strong>${esc(e.title)}</strong></div>
                  <div class="muted" style="font-size:11.5px;">${esc(e.authors || "—")}${e.reviewers ? ` · Rev: ${esc(e.reviewers)}` : ""}</div>
                </td>
                <td>${verdictPill(e.verdict)}</td>
                <td class="muted">${esc(e.status || "—")}</td>
                <td style="white-space:nowrap;font-size:12px;">
                  <a href="https://commitfest.postgresql.org/patch/${e.cf_id}/" target="_blank" rel="noopener">CF ↗</a>
                  ${e.thread_url ? ` · <a href="${esc(e.thread_url)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
                  · <a href="${esc(localUrl)}/?cf=${e.cf_id}" target="_blank" rel="noopener">Local ↗</a>
                </td>
              </tr>
            `,
                  )
                  .join("")
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderCoordinationTab(): string {
  return `
    <div class="card">
      <div class="card-head">
        <h2>Shared Team Coordination (${state.coordination.length})</h2>
        <span class="muted" style="font-size:12px;">Opt-in public claims so reviewers don't duplicate effort (private Work Items stay local)</span>
      </div>
      ${
        state.coordination.length === 0
          ? `<p class="muted">No shared coordination items yet. Claim a patch or bug repro via the publish API or your local workbench.</p>`
          : `
        <table>
          <thead><tr><th>Target</th><th>Task</th><th>Status</th><th>Reviewer</th><th>Note</th></tr></thead>
          <tbody>
            ${state.coordination
              .map(
                (c) => `
              <tr>
                <td class="mono">${c.cf_id ? `CF ${c.cf_id}` : esc(c.bug_ref || "General")}</td>
                <td><strong>${esc(c.title)}</strong></td>
                <td><span class="pill p-info">${esc(c.status)}</span></td>
                <td><strong>${esc(c.assignee_name)}</strong> <span class="dim">@${esc(c.assignee_handle)}</span></td>
                <td class="muted">${esc(c.note || "—")}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `
      }
    </div>
  `;
}

function renderConnectTab(): string {
  const oauth = state.health?.oauth;
  return `
    <div class="grid2">
      <div class="card">
        <div class="card-head">
          <h3>1. Security Model (Local → Public Only)</h3>
          <span class="pill p-ok">Zero Localhost Control</span>
        </div>
        <p class="muted" style="margin-top:0;">
          By design, <strong>pgroast.dev never commands your local workbench</strong>. Your private SQLite/PostgreSQL Work Items, CommitFest cookies, Gmail drafts, local worktrees, and AI CLIs stay strictly on <code>127.0.0.1</code>.
        </p>
        <ul class="muted" style="padding-left:18px;margin:0;">
          <li><strong>Local → Public:</strong> you review the exact sanitized payload and push opinions or briefs with a publish-only token.</li>
          <li><strong>Server-side Hard Gate:</strong> every published payload is re-checked to block local paths, cookies, tokens, and internal model codenames.</li>
          <li><strong>Public → Local:</strong> only plain top-level <code>GET</code> links (<code>http://127.0.0.1:3432/?cf=5879</code>) with zero side effects.</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>2. Sign In &amp; Mint a Publish-Only Token</h3>
        </div>
        <div class="row" style="margin-bottom:12px;">
          <a class="btn btn-secondary" href="/auth/github">Sign in with GitHub ${oauth?.githubConfigured ? "" : "(configure env)"}</a>
          <a class="btn btn-secondary" href="/auth/google">Sign in with Google ${oauth?.googleConfigured ? "" : "(configure env)"}</a>
        </div>
        ${
          oauth?.devTokenMintEnabled
            ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;">
            <div class="muted" style="font-size:12px;margin-bottom:8px;"><strong>Local Dev Token Mint</strong> (enabled on localhost for testing with <code>pgroast-app</code>):</div>
            <div class="row" style="margin-bottom:8px;">
              <select id="dev-prov"><option value="github">GitHub</option><option value="google">Google</option></select>
              <input id="dev-handle" type="text" placeholder="Handle (e.g. NikolayS or kwolak)" style="flex:1;" />
              <input id="dev-name" type="text" placeholder="Display name" style="flex:1;" />
              <button type="button" class="btn btn-primary" id="dev-mint-btn">Mint Token</button>
            </div>
            ${
              state.mintedToken
                ? `
              <div style="border:1px solid var(--border-s);border-radius:6px;padding:10px;margin-top:8px;">
                <div style="font-size:12px;margin-bottom:4px;"><strong>Publish-only token for @${esc(state.mintedHandle)}</strong> (copy into <code>pgroast-app</code> → Settings → Public Companion Hub):</div>
                <code class="mono" style="word-break:break-all;font-size:11.5px;">${esc(state.mintedToken)}</code>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }
      </div>
    </div>
  `;
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>("#web-nav .nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.tab);
  });
  const root = document.getElementById("web-main")!;
  if (state.tab === "brief") root.innerHTML = renderBriefTab();
  else if (state.tab === "opinions") root.innerHTML = renderOpinionsTab();
  else if (state.tab === "entries") root.innerHTML = renderEntriesTab();
  else if (state.tab === "coordination") root.innerHTML = renderCoordinationTab();
  else root.innerHTML = renderConnectTab();

  document.getElementById("goto-connect-btn")?.addEventListener("click", () => {
    state.tab = "connect";
    render();
  });
  document.getElementById("brief-select")?.addEventListener("change", (ev) => {
    state.selectedBriefSlug = (ev.target as HTMLSelectElement).value;
    render();
  });
  document.getElementById("pub-entry-search")?.addEventListener("input", (ev) => {
    state.entrySearch = (ev.target as HTMLInputElement).value;
    render();
    const inp = document.getElementById("pub-entry-search") as HTMLInputElement | null;
    inp?.focus();
    inp?.setSelectionRange(inp.value.length, inp.value.length);
  });
  document.getElementById("dev-mint-btn")?.addEventListener("click", async () => {
    const provider = (document.getElementById("dev-prov") as HTMLSelectElement).value;
    const handle = (document.getElementById("dev-handle") as HTMLInputElement).value.trim();
    const name = (document.getElementById("dev-name") as HTMLInputElement).value.trim();
    if (!handle) return;
    const res = await api<{ token: string; contributor: { handle: string } }>("/api/v1/tokens/dev", {
      method: "POST",
      body: JSON.stringify({ provider, handle, name: name || handle }),
    });
    state.mintedToken = res.token;
    state.mintedHandle = res.contributor.handle;
    render();
  });
}

document.querySelectorAll<HTMLButtonElement>("#web-nav .nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.tab = (btn.dataset.tab as TabId) || "brief";
    render();
  });
});
document.getElementById("web-home-btn")?.addEventListener("click", () => {
  state.tab = "brief";
  render();
});
document.getElementById("web-signin-btn")?.addEventListener("click", () => {
  state.tab = "connect";
  render();
});
document.getElementById("web-theme-btn")?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  document.documentElement.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
});

void loadAll();
