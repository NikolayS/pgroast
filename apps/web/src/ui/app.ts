type TabId = "brief" | "stats" | "entries" | "opinions" | "coordination" | "connect";
type MrTabId = "overview" | "discussion" | "changes";

interface MrBodyBlock {
  kind: "text" | "quote";
  content: string;
  lineCount: number;
}

interface MrAttachment {
  name: string;
  url: string;
  contentType: string;
  sizeText: string;
  isPatch: boolean;
  isNoCfbot: boolean;
}

interface MrTimelineMessage {
  index: number;
  messageId: string;
  url: string;
  from: string;
  date: string;
  subject: string;
  isAuthor: boolean;
  patchRevision: string | null;
  patchCount: number;
  blocks: MrBodyBlock[];
  attachments: MrAttachment[];
}

interface MrThreadTldr {
  pitch: string;
  latestSummary: string;
  latestBy: string;
  latestDate: string;
  startedDate: string;
  daysIdle: number;
}

interface MrDiscussionData {
  cfId: number;
  threadUrl: string;
  subject: string;
  lists: string[];
  messageCount: number;
  participants: Array<{ name: string; count: number; isAuthor: boolean }>;
  revisions: Array<{ tag: string; date: string; from: string; messageIndex: number; fileCount: number }>;
  tldr?: MrThreadTldr;
  messages: MrTimelineMessage[];
  cachedAt: string;
}

interface MrDiffCommentRef {
  messageIndex: number;
  from: string;
  date: string;
  url: string;
  excerpt: string;
  matchKind: "line" | "file";
}

interface MrDiffLine {
  type: "ctx" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  content: string;
  comments?: MrDiffCommentRef[];
}

interface MrDiffHunk {
  header: string;
  lines: MrDiffLine[];
}

interface MrDiffFile {
  oldPath: string;
  newPath: string;
  additions: number;
  deletions: number;
  hunks: MrDiffHunk[];
  mentions?: MrDiffCommentRef[];
}

interface MrDiffData {
  cfId: number;
  source: string;
  compareUrl: string;
  files: MrDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
  matchedLineComments?: number;
  matchedFileMentions?: number;
  cachedAt: string;
}

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

interface BriefStats {
  totals?: { total?: number; open?: number; closed?: number; roasted?: number; unroasted?: number; openRoasted?: number; openUnroasted?: number };
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

interface BriefDetail {
  id: number;
  slug: string;
  title: string;
  commitfest_label: string;
  published_by_handle: string;
  published_by_name: string;
  created_at: string;
  stats: BriefStats;
  shortlist: BriefShortlistItem[];
  closing: BriefClosingItem[];
  entries: EntryItem[];
}

interface OpinionItem {
  id: number;
  cf_id: number;
  contributor_name: string;
  contributor_handle: string;
  contributor_provider: string;
  contributor_avatar?: string;
  backend: string;
  roast_level?: string;
  roast_flavour?: string;
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
  topic?: string;
  authors: string;
  reviewers?: string;
  committer?: string;
  thread_url?: string;
  verdict: string;
  confidence?: string;
  kind?: string;
  seen_in_production?: boolean;
  workaround?: string;
  failing_summary?: string;
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

interface PatchConsensus {
  status: "unanimous" | "majority" | "split" | "baseline_only";
  leadingVerdict: string;
  totalOpinions: number;
  uniqueReviewers: number;
  uniqueModels: number;
  breakdown: Record<string, number>;
  headline: string;
}

interface PatchPageData {
  cf_id: number;
  entry: EntryItem | null;
  opinions: OpinionItem[];
  coordination: CoordItem[];
  consensus: PatchConsensus;
}

const state = {
  tab: "brief" as TabId,
  returnTab: "brief" as TabId,
  activePatchId: null as number | null,
  mrTab: "overview" as MrTabId,
  patchLoading: false,
  patchData: null as PatchPageData | null,
  mrDiscussionLoading: false,
  mrDiscussionError: "",
  mrDiscussion: null as MrDiscussionData | null,
  mrDiffLoading: false,
  mrDiffError: "",
  mrDiff: null as MrDiffData | null,
  mrAuthorFilter: "all",
  mrDiffOnlyCommented: false,
  mrViewedFiles: new Set<string>(),
  statsLbTab: "authors" as "authors" | "reviewers" | "committers",
  health: null as HealthInfo | null,
  briefs: [] as BriefSummary[],
  selectedBriefSlug: "latest",
  briefDetail: null as BriefDetail | null,
  briefSegment: "shortlist" as "shortlist" | "closing",
  shortlistFilter: "all" as "all" | "bugfix" | "feature" | "prod",
  opinions: [] as OpinionItem[],
  entries: [] as EntryItem[],
  entrySearch: "",
  entryVerdict: "all",
  entryStatus: "all",
  entryLimit: 60,
  coordination: [] as CoordItem[],
  mintedToken: "",
  mintedHandle: "",
  introCollapsed: (() => {
    try {
      return localStorage.getItem("pgroast-web-intro-collapsed") === "1";
    } catch {
      return false;
    }
  })(),
};

const VERDICT_META: Record<string, { label: string; short: string; color: string; pillClass: string }> = {
  "NO-FUNDAMENTAL-OBJECTION": { label: "No fundamental objection", short: "No objection", color: "#4cb782", pillClass: "p-ok" },
  "NEEDS-COMMITTER-EYES": { label: "Needs committer eyes", short: "Committer eyes", color: "#5e6ad2", pillClass: "p-info" },
  "NEEDS-DESIGN-DISCUSSION": { label: "Needs design discussion", short: "Design disc.", color: "#e0a83c", pillClass: "p-warn" },
  "LIKELY-REJECT": { label: "Likely reject", short: "Likely reject", color: "#eb5757", pillClass: "p-danger" },
  UNROASTED: { label: "Not reviewed", short: "Not reviewed", color: "#737682", pillClass: "" },
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getVerdictMeta(v: string) {
  return VERDICT_META[v || "UNROASTED"] ?? { label: v || "Not reviewed", short: v || "Not reviewed", color: "#737682", pillClass: "" };
}

function verdictPill(v: string): string {
  const m = getVerdictMeta(v);
  return `<span class="pill ${m.pillClass}">${esc(m.label)}</span>`;
}

function verdictDot(v: string): string {
  const m = getVerdictMeta(v);
  return `<span class="dot" style="background:${m.color}" title="${esc(m.label)}"></span>`;
}

const CHEVRON_SVG = `<svg class="issue-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

function renderSvgDonut(segments: Array<{ label: string; value: number; color: string }>): string {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) return "";
  const cx = 60;
  const cy = 60;
  const r = 44;
  const sw = 13;
  let startDeg = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / total;
      const sweepDeg = frac * 360;
      const curStart = startDeg;
      startDeg += sweepDeg;
      if (frac >= 0.9999) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      }
      const a0 = ((curStart - 90) * Math.PI) / 180;
      const a1 = ((curStart + sweepDeg - 90) * Math.PI) / 180;
      const x1 = cx + r * Math.cos(a0);
      const y1 = cy + r * Math.sin(a0);
      const x2 = cx + r * Math.cos(a1);
      const y2 = cy + r * Math.sin(a1);
      const largeArc = sweepDeg > 180 ? 1 : 0;
      return `<path d="M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-linecap="butt"><title>${esc(s.label)}: ${s.value}</title></path>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 120 120" width="112" height="112" style="flex-shrink:0;" aria-label="Verdict distribution">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(128,128,128,0.16)" stroke-width="${sw}" />
      ${arcs}
      <text x="${cx}" y="57" text-anchor="middle" fill="currentColor" font-size="18" font-weight="600">${total}</text>
      <text x="${cx}" y="71" text-anchor="middle" fill="var(--dim)" font-size="9.5">entries</text>
    </svg>
  `;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function getLocalBackofficeUrl(cfId?: number | null): string {
  const base = (state.health?.localWorkbenchUrl || "http://127.0.0.1:3432").replace(/\/$/, "");
  return cfId && cfId > 0 ? `${base}/?cf=${cfId}` : `${base}/`;
}

function syncTopBackofficeLink(): void {
  const link = document.getElementById("web-backoffice-top-btn") as HTMLAnchorElement | null;
  if (link) {
    link.href = getLocalBackofficeUrl(state.activePatchId);
  }
}

function copyTextWithFeedback(btn: HTMLElement, text: string, defaultLabel: string): void {
  void navigator.clipboard?.writeText(text).then(
    () => {
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = defaultLabel;
      }, 1500);
    },
    () => {
      btn.textContent = "Copy failed";
      setTimeout(() => {
        btn.textContent = defaultLabel;
      }, 1500);
    },
  );
}

function parseRouteFromLocation(): { patchId: number | null; tab: TabId } {
  const u = new URL(window.location.href);
  const pathMatch = u.pathname.match(/^\/patch\/(\d+)\/?$/);
  const cfParam = Number(pathMatch?.[1] || u.searchParams.get("cf") || 0);
  if (cfParam > 0) return { patchId: cfParam, tab: state.tab };
  const tabParam = u.searchParams.get("tab") as TabId | null;
  const validTabs: TabId[] = ["brief", "stats", "entries", "opinions", "coordination", "connect"];
  return { patchId: null, tab: tabParam && validTabs.includes(tabParam) ? tabParam : "brief" };
}

async function loadMrDiscussion(cfId: number): Promise<void> {
  if (state.mrDiscussion?.cfId === cfId || state.mrDiscussionLoading) return;
  state.mrDiscussionLoading = true;
  state.mrDiscussionError = "";
  render();
  try {
    const data = await api<MrDiscussionData>(`/api/v1/entries/${cfId}/thread`);
    if (state.activePatchId !== cfId) return;
    state.mrDiscussion = data;
    state.mrDiscussionLoading = false;
    render();
  } catch (err) {
    if (state.activePatchId !== cfId) return;
    state.mrDiscussionLoading = false;
    state.mrDiscussionError = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function loadMrDiff(cfId: number): Promise<void> {
  if (state.mrDiff?.cfId === cfId || state.mrDiffLoading) return;
  state.mrDiffLoading = true;
  state.mrDiffError = "";
  render();
  try {
    const data = await api<MrDiffData>(`/api/v1/entries/${cfId}/diff`);
    if (state.activePatchId !== cfId) return;
    state.mrDiff = data;
    state.mrDiffLoading = false;
    render();
  } catch (err) {
    if (state.activePatchId !== cfId) return;
    state.mrDiffLoading = false;
    state.mrDiffError = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function openPatchPage(cfId: number, pushHistory = true): Promise<void> {
  if (!state.activePatchId) state.returnTab = state.tab;
  state.activePatchId = cfId;
  state.mrTab = "overview";
  state.patchLoading = true;
  state.patchData = null;
  state.mrDiscussion = null;
  state.mrDiscussionLoading = false;
  state.mrDiscussionError = "";
  state.mrDiff = null;
  state.mrDiffLoading = false;
  state.mrDiffError = "";
  state.mrAuthorFilter = "all";
  state.mrDiffOnlyCommented = false;
  state.mrViewedFiles = new Set<string>();
  syncTopBackofficeLink();

  if (pushHistory) {
    try {
      window.history.pushState({ patchId: cfId, tab: state.returnTab }, "", `/patch/${cfId}`);
    } catch {
      // ignore
    }
  }
  render();
  window.scrollTo({ top: 0 });

  try {
    const data = await api<PatchPageData>(`/api/v1/entries/${cfId}`);
    if (state.activePatchId !== cfId) return;
    state.patchData = data;
    state.patchLoading = false;
    const title = data.entry?.title ? `CF ${cfId}: ${data.entry.title} — pgroast` : `CF ${cfId} — pgroast`;
    document.title = title;
    render();
  } catch {
    if (state.activePatchId !== cfId) return;
    state.patchLoading = false;
    render();
  }
}

function navigateToTab(tab: TabId, pushHistory = true): void {
  state.activePatchId = null;
  state.patchData = null;
  state.patchLoading = false;
  state.tab = tab;
  syncTopBackofficeLink();
  document.title = "pgroast — Public CommitFest App";
  if (pushHistory) {
    try {
      const targetUrl = tab === "brief" ? "/" : `/?tab=${encodeURIComponent(tab)}`;
      window.history.pushState({ patchId: null, tab }, "", targetUrl);
    } catch {
      // ignore
    }
  }
  render();
  window.scrollTo({ top: 0 });
}

async function loadBriefDetail(slug: string): Promise<void> {
  if (!slug) {
    state.briefDetail = null;
    return;
  }
  state.briefDetail = await api<BriefDetail>(`/api/v1/briefs/${encodeURIComponent(slug)}`);
}

async function loadAll(): Promise<void> {
  try {
    const route = parseRouteFromLocation();
    state.tab = route.tab;

    const [health, bRes, oRes, cRes] = await Promise.all([
      api<HealthInfo>("/api/v1/health"),
      api<{ briefs: BriefSummary[] }>("/api/v1/briefs"),
      api<{ opinions: OpinionItem[] }>("/api/v1/opinions"),
      api<{ items: CoordItem[] }>("/api/v1/coordination"),
    ]);
    state.health = health;
    state.briefs = bRes.briefs;
    state.opinions = oRes.opinions;
    state.coordination = cRes.items;

    if (bRes.briefs[0]) {
      if (state.selectedBriefSlug === "latest") state.selectedBriefSlug = bRes.briefs[0].slug;
      await loadBriefDetail(state.selectedBriefSlug);
      // Avoid downloading all 736 entries twice: reuse entries already inside the published brief!
      if (state.briefDetail?.entries?.length) {
        state.entries = state.briefDetail.entries;
      } else {
        const eRes = await api<{ entries: EntryItem[] }>("/api/v1/entries?limit=1000");
        state.entries = eRes.entries;
      }
    } else {
      const eRes = await api<{ entries: EntryItem[] }>("/api/v1/entries?limit=1000");
      state.entries = eRes.entries;
    }

    const f = document.getElementById("footer-db-info");
    if (f) {
      f.textContent = `${health.database.version || "PostgreSQL"} · ${health.counts.entries} entries · ${health.counts.opinions} opinions`;
    }
    syncTopBackofficeLink();

    if (route.patchId) {
      await openPatchPage(route.patchId, false);
    } else {
      render();
    }
  } catch (err) {
    const root = document.getElementById("web-main");
    if (root) {
      root.innerHTML = `<div class="card"><div class="empty-state">Failed to load companion data: ${esc(err instanceof Error ? err.message : String(err))}</div></div>`;
    }
  }
}

/* ---- Space Switcher (Public App <-> Personal Backoffice) ---- */
function openSpaceSwitcher(): void {
  const backdrop = document.getElementById("space-backdrop");
  const body = document.getElementById("space-sheet-body");
  const trigger = document.getElementById("web-space-btn");
  if (!backdrop || !body) return;

  const cfId = state.activePatchId;
  const backofficeHref = getLocalBackofficeUrl(cfId);
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

  body.innerHTML = `
    <div class="space-card is-current">
      <div class="space-card-head">
        <span class="space-card-title"><span class="space-dot" style="background:var(--ok)"></span>Public App</span>
        <span class="space-badge-here">You are here</span>
      </div>
      <p class="space-card-desc">
        Shared community hub at <code class="mono">${esc(window.location.host)}</code>. Compare multiple reviewers' AI opinions, build common ground on each patch, and share links.
      </p>
    </div>

    <div class="space-card is-backoffice">
      <div class="space-card-head">
        <span class="space-card-title"><span class="space-dot" style="background:var(--warn)"></span>Personal Backoffice</span>
        <span class="space-badge-local">Private · Local</span>
      </div>
      <p class="space-card-desc">
        Your private workspace on <code class="mono">${esc(getLocalBackofficeUrl().replace(/\/$/, ""))}</code> — compile Postgres, run your AI models, inspect diffs, keep private Work Items &amp; Gmail drafts, and push sanitized opinions up here.
      </p>
      <div class="row" style="gap:8px;margin-top:2px;">
        <a class="btn btn-primary" style="flex:1;" href="${esc(backofficeHref)}" target="_blank" rel="noopener">
          ${cfId ? `Work on CF ${cfId} in Backoffice ↗` : "Open Personal Backoffice ↗"}
        </a>
        <button type="button" class="btn btn-secondary" id="space-copy-local-btn">Copy link</button>
      </div>
      ${
        isMobile
          ? `<div class="dim" style="font-size:11.5px;line-height:1.4;">On iPhone? Tap <strong>Copy link</strong> to open <code class="mono">${esc(backofficeHref)}</code> on your laptop where <code class="mono">bun run app:local</code> is running.</div>`
          : ""
      }
    </div>

    <button type="button" class="btn btn-ghost" id="space-goto-setup-btn" style="width:100%;">
      How Public ↔ Backoffice collaboration works →
    </button>
  `;

  body.querySelector<HTMLElement>("#space-copy-local-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, backofficeHref, "Copy link");
  });
  body.querySelector("#space-goto-setup-btn")?.addEventListener("click", () => {
    closeSpaceSwitcher();
    navigateToTab("connect");
  });

  backdrop.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  document.body.classList.add("sheet-open");
}

function closeSpaceSwitcher(): void {
  const backdrop = document.getElementById("space-backdrop");
  const trigger = document.getElementById("web-space-btn");
  if (!backdrop) return;
  backdrop.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sheet-open");
}

/* ---- Full-Fledged Patch Collaboration Page (/patch/:id) ---- */
function formatOpinionProfile(o: OpinionItem): string {
  const lv = (o.roast_level || "medium").toLowerCase();
  const fl = (o.roast_flavour || "default").toLowerCase();
  const lvLabel = lv === "dark" ? "Dark roast" : lv === "light" ? "Light roast" : "Medium roast";
  const flNames: Record<string, string> = {
    default: "Default",
    "tom-lane": "Tom Lane",
    "peter-eisentraut": "Peter Eisentraut",
    "robert-haas": "Robert Haas",
    "andres-freund": "Andres Freund",
    "heikki-linnakangas": "Heikki Linnakangas",
    "bruce-momjian": "Bruce Momjian",
  };
  const flLabel = flNames[fl] || fl;
  return `${lvLabel} · ${flLabel}`;
}

function formatModelsLabel(modelsJson: string): string {
  if (!modelsJson || modelsJson === "{}") return "";
  try {
    const obj = JSON.parse(modelsJson) as Record<string, string>;
    const vals = Object.entries(obj)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k}: ${v}`);
    return vals.join(" · ");
  } catch {
    return modelsJson;
  }
}

function cleanQuoteForDisplay(raw: string): string {
  return raw
    .split("\n")
    .map((ln) => ln.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

function quotePreviewLine(raw: string, maxLen = 84): string {
  const clean = cleanQuoteForDisplay(raw)
    .split("\n")
    .map((l) => l.replace(/^>+\s*/, "").trim())
    .find((l) => l.length > 0) || "";
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen).trimEnd()}…` : clean;
}

function renderMrDiscussionTab(cfId: number, backofficeHref: string): string {
  if (state.mrDiscussionLoading) {
    return `
      <div class="card">
        <div class="loading-state" style="padding:36px 0;">
          <div class="spinner"></div>
          <div class="muted">Loading pgsql-hackers discussion thread for CF ${cfId}…</div>
        </div>
      </div>
    `;
  }
  if (state.mrDiscussionError) {
    return `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">Could not load -hackers discussion</div>
          <div class="muted" style="margin-bottom:12px;">${esc(state.mrDiscussionError)}</div>
          <div class="row" style="justify-content:center;gap:8px;">
            <button type="button" class="btn btn-secondary" id="mr-retry-thread-btn">Retry</button>
            <a class="btn btn-primary" href="https://commitfest.postgresql.org/patch/${cfId}/" target="_blank" rel="noopener">Open on CommitFest ↗</a>
          </div>
        </div>
      </div>
    `;
  }
  const disc = state.mrDiscussion;
  if (!disc || disc.messages.length === 0) {
    return `<div class="card"><div class="empty-state">No messages found on this thread yet.</div></div>`;
  }

  const tldr = disc.tldr;
  const visibleMessages =
    state.mrAuthorFilter && state.mrAuthorFilter !== "all"
      ? disc.messages.filter((m) => m.from === state.mrAuthorFilter)
      : disc.messages;
  const hasLongQuotes = visibleMessages.some((m) => m.blocks.some((b) => b.kind === "quote" && b.lineCount > 6));

  return `
    ${
      tldr
        ? `
      <section class="mr-tldr-card" aria-label="Thread summary and history">
        <div class="mr-tldr-head">
          <strong style="font-size:13px;">Thread TL;DR &amp; Patch History</strong>
          <span class="mono dim" style="font-size:11.5px;">
            ${tldr.startedDate ? `Started ${esc(tldr.startedDate)}` : ""}
            ${tldr.latestDate ? ` · Last active ${esc(tldr.latestDate)} (${tldr.daysIdle === 0 ? "today" : `${tldr.daysIdle}d ago`})` : ""}
          </span>
        </div>
        <div class="mr-tldr-grid">
          ${
            tldr.pitch
              ? `
            <div class="mr-tldr-box">
              <div class="mr-tldr-label">Opening pitch (#1 · ${esc(disc.messages[0]?.from || "Author")})</div>
              <p>${esc(tldr.pitch)}</p>
            </div>
          `
              : ""
          }
          ${
            disc.messages.length > 1 && tldr.latestSummary
              ? `
            <div class="mr-tldr-box">
              <div class="mr-tldr-label">Latest reply (#${disc.messages.length} · ${esc(tldr.latestBy)})</div>
              <p>${esc(tldr.latestSummary)}</p>
            </div>
          `
              : ""
          }
        </div>
        ${
          disc.revisions.length > 0
            ? `
          <div class="mr-rev-strip" aria-label="Patch revision history">
            <span class="dim" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Revisions:</span>
            ${disc.revisions
              .map(
                (r, idx) => `
              ${idx > 0 ? `<span class="dim">→</span>` : ""}
              <button type="button" class="chip" data-jump-msg="${r.messageIndex}" title="Uploaded by ${esc(r.from)} (${r.fileCount} file${r.fileCount === 1 ? "" : "s"})">
                <span class="dot" style="background:var(--ok)"></span>
                <strong class="mono">${esc(r.tag)}</strong>
                <span class="dim">${esc(r.date.slice(0, 10))}</span>
              </button>
            `,
              )
              .join("")}
          </div>
        `
            : ""
        }
      </section>
    `
        : ""
    }

    <div class="mr-toolbar">
      <div class="row" style="gap:6px;">
        <span class="tag-micro"><strong>${visibleMessages.length}${visibleMessages.length !== disc.messageCount ? `/${disc.messageCount}` : ""}</strong> messages</span>
        <span class="tag-micro"><strong>${disc.participants.length}</strong> participants</span>
        ${disc.revisions.length ? `<span class="tag-micro" style="color:var(--ok);"><strong>${disc.revisions.length}</strong> patch upload${disc.revisions.length === 1 ? "" : "s"}</span>` : ""}
      </div>
      <div class="row" style="gap:6px;">
        ${hasLongQuotes ? `<button type="button" class="btn btn-ghost btn-sm" id="mr-toggle-quotes-btn">Expand long quotes</button>` : ""}
        <button type="button" class="btn btn-secondary btn-sm" id="mr-jump-latest-btn">Latest ↓</button>
        <a class="btn btn-backoffice btn-sm" href="${esc(backofficeHref)}" target="_blank" rel="noopener">Reply in Backoffice ↗</a>
      </div>
    </div>

    ${
      disc.participants.length > 1
        ? `
      <div class="chips" style="margin-bottom:12px;" aria-label="Filter by participant">
        <button type="button" class="chip ${state.mrAuthorFilter === "all" ? "active" : ""}" data-mr-author="all">All (${disc.messageCount})</button>
        ${disc.participants
          .slice(0, 10)
          .map(
            (p) => `
          <button type="button" class="chip ${state.mrAuthorFilter === p.name ? "active" : ""}" data-mr-author="${esc(p.name)}">
            ${esc(p.name)}${p.isAuthor ? " · Author" : ""} <span class="dim">(${p.count})</span>
          </button>
        `,
          )
          .join("")}
      </div>
    `
        : ""
    }

    <div class="mr-timeline" id="mr-timeline">
      ${visibleMessages
        .map((m) => {
          const initials = (m.from || "?").slice(0, 2).toUpperCase();
          const sysEvent =
            m.patchRevision && m.patchCount > 0
              ? `
            <div class="mr-sys-event">
              <span class="mr-sys-icon">↑</span>
              <span><strong>${esc(m.from)}</strong> uploaded <strong class="mono">${esc(m.patchRevision)}</strong> (${m.patchCount} patch file${m.patchCount === 1 ? "" : "s"}) · <span class="mono dim">${esc(m.date.slice(0, 10))}</span></span>
            </div>
          `
              : "";
          const bodyHtml = m.blocks
            .map((b) => {
              if (b.kind === "quote") {
                const cleaned = cleanQuoteForDisplay(b.content);
                // Short inline quotes (<= 6 lines) stay readable inline so interleaved replies make sense!
                if (b.lineCount <= 6) {
                  return `<blockquote class="mr-quote-inline">${esc(cleaned)}</blockquote>`;
                }
                const preview = quotePreviewLine(b.content);
                return `
                  <details class="mr-quote-fold">
                    <summary>
                      <span>▸ Quoted (${b.lineCount} lines)</span>
                      ${preview ? `<span class="mr-quote-preview">&ldquo;${esc(preview)}&rdquo;</span>` : ""}
                    </summary>
                    <pre class="mr-quote-pre">${esc(cleaned)}</pre>
                  </details>
                `;
              }
              return `<p class="mr-text-block">${esc(b.content)}</p>`;
            })
            .join("");
          const attHtml =
            m.attachments.length > 0
              ? `
            <div class="mr-att-row">
              ${m.attachments
                .map(
                  (a) => `
                <a class="mr-att-chip ${a.isPatch && !a.isNoCfbot ? "is-patch" : ""}" href="${esc(a.url)}" target="_blank" rel="noopener">
                  <span>${a.isPatch ? "🩹" : "📎"}</span>
                  <span class="mono">${esc(a.name)}</span>
                  ${a.sizeText ? `<span class="dim">${esc(a.sizeText)}</span>` : ""}
                </a>
              `,
                )
                .join("")}
            </div>
          `
              : "";
          return `
            ${sysEvent}
            <article class="mr-msg ${m.isAuthor ? "is-author" : ""}" id="mr-msg-${m.index}">
              <div class="mr-msg-head">
                <div class="mr-msg-author">
                  <span class="mr-avatar">${esc(initials)}</span>
                  <strong style="font-size:13px;">${esc(m.from)}</strong>
                  ${m.isAuthor ? `<span class="mr-author-badge">Author</span>` : ""}
                  ${m.patchRevision ? `<span class="mr-rev-badge mono">${esc(m.patchRevision)}</span>` : ""}
                </div>
                <div class="row" style="gap:8px;font-size:11.5px;">
                  <span class="mono dim">#${m.index + 1} · ${esc(m.date.slice(0, 16).replace("T", " "))} UTC</span>
                  <a href="${esc(m.url)}" target="_blank" rel="noopener">Archive ↗</a>
                </div>
              </div>
              <div class="mr-msg-body">${bodyHtml || `<span class="muted">(empty body)</span>`}</div>
              ${attHtml}
            </article>
          `;
        })
        .join("")}
    </div>

    <div class="collab-cta" style="margin-top:14px;">
      <div style="font-weight:600;font-size:13.5px;">Read-only archive view</div>
      <div class="muted" style="font-size:12.5px;">
        Public discussions never auto-post to <code>pgsql-hackers</code>. Open CF ${cfId} in your Personal Backoffice to draft a plain-text 72-column reply with all 4 safety gates.
      </div>
      <div class="row" style="gap:8px;">
        <a class="btn btn-primary btn-sm" href="${esc(backofficeHref)}" target="_blank" rel="noopener">Draft reply in Backoffice ↗</a>
        <a class="btn btn-secondary btn-sm" href="${esc(disc.threadUrl)}" target="_blank" rel="noopener">Original postgresql.org thread ↗</a>
      </div>
    </div>
  `;
}

function renderMrDiffTab(cfId: number, backofficeHref: string): string {
  if (state.mrDiffLoading) {
    return `
      <div class="card">
        <div class="loading-state" style="padding:36px 0;">
          <div class="spinner"></div>
          <div class="muted">Fetching latest CFBot unified diff (master…cf/${cfId}) and matching -hackers comments…</div>
        </div>
      </div>
    `;
  }
  if (state.mrDiffError) {
    return `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">CFBot diff unavailable</div>
          <div class="muted" style="max-width:520px;margin:0 auto 12px;">${esc(state.mrDiffError)}</div>
          <div class="row" style="justify-content:center;gap:8px;">
            <button type="button" class="btn btn-secondary" id="mr-retry-diff-btn">Retry</button>
            <a class="btn btn-primary" href="https://commitfest.postgresql.org/patch/${cfId}/" target="_blank" rel="noopener">Check patch on CommitFest ↗</a>
          </div>
        </div>
      </div>
    `;
  }
  const diff = state.mrDiff;
  if (!diff || diff.files.length === 0) {
    return `<div class="card"><div class="empty-state">No diff hunks available for CF ${cfId}.</div></div>`;
  }

  const lineCountForFile = (f: MrDiffFile) =>
    f.hunks.reduce((acc, h) => acc + h.lines.reduce((a, l) => a + (l.comments?.length || 0), 0), 0);
  const totalCommented = diff.files.filter((f) => lineCountForFile(f) > 0 || (f.mentions?.length || 0) > 0).length;
  const visibleFiles = state.mrDiffOnlyCommented
    ? diff.files.filter((f) => lineCountForFile(f) > 0 || (f.mentions?.length || 0) > 0)
    : diff.files;
  const viewedCount = diff.files.filter((f) => state.mrViewedFiles.has(f.newPath || f.oldPath)).length;
  const viewedPct = diff.files.length > 0 ? Math.round((viewedCount / diff.files.length) * 100) : 0;

  return `
    <div class="mr-toolbar">
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        <span class="tag-micro"><strong>${diff.files.length}</strong> file${diff.files.length === 1 ? "" : "s"}</span>
        <span class="mono diff-stat-add">+${diff.totalAdditions}</span>
        <span class="mono diff-stat-del">-${diff.totalDeletions}</span>
        ${
          (diff.matchedLineComments || 0) + (diff.matchedFileMentions || 0) > 0
            ? `<span class="tag-micro" style="color:var(--accent-t);">💬 ${diff.matchedLineComments || 0} inline · ${diff.matchedFileMentions || 0} file mention${(diff.matchedFileMentions || 0) === 1 ? "" : "s"}</span>`
            : ""
        }
        ${diff.truncated ? `<span class="tag-micro tag-wa">Truncated for fast browsing</span>` : ""}
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap;">
        ${
          totalCommented > 0
            ? `<button type="button" class="btn ${state.mrDiffOnlyCommented ? "btn-primary" : "btn-ghost"} btn-sm" id="mr-diff-commented-btn">💬 Commented (${totalCommented})</button>`
            : ""
        }
        <button type="button" class="btn btn-ghost btn-sm" id="mr-toggle-files-btn">Collapse all</button>
        <a class="btn btn-secondary btn-sm" href="${esc(diff.compareUrl)}" target="_blank" rel="noopener">GitHub Compare ↗</a>
        <a class="btn btn-backoffice btn-sm" href="${esc(backofficeHref)}" target="_blank" rel="noopener">Comment inline in Backoffice ↗</a>
      </div>
    </div>

    <div class="diff-viewed-bar">
      <div class="row" style="justify-content:space-between;width:100%;font-size:12px;">
        <span class="muted">Review progress: <strong style="color:var(--text);">${viewedCount} / ${diff.files.length}</strong> files viewed</span>
        <span class="mono dim">${viewedPct}%</span>
      </div>
      <div class="diff-viewed-track"><div class="diff-viewed-fill" style="width:${viewedPct}%;"></div></div>
    </div>

    <div class="diff-file-nav" aria-label="Changed files">
      ${diff.files
        .map((f, idx) => {
          const fp = f.newPath || f.oldPath;
          const shortName = fp.split("/").slice(-2).join("/");
          const cCount = lineCountForFile(f) + (f.mentions?.length || 0);
          const isViewed = state.mrViewedFiles.has(fp);
          return `
            <button type="button" class="diff-nav-pill ${isViewed ? "is-viewed" : ""}" data-jump-diff-file="${idx}" title="${esc(fp)}">
              ${isViewed ? `<span style="color:var(--ok);">✓</span>` : ""}
              <span class="mono">${esc(shortName)}</span>
              ${cCount > 0 ? `<span class="diff-nav-comm">💬 ${cCount}</span>` : ""}
              <span class="mono diff-stat-add">+${f.additions}</span>
            </button>
          `;
        })
        .join("")}
    </div>

    <div class="diff-files" id="mr-diff-files">
      ${visibleFiles
        .map((f, idx) => {
          const origIdx = diff.files.indexOf(f);
          const fp = f.newPath || f.oldPath;
          const isViewed = state.mrViewedFiles.has(fp);
          const lineCommentsInFile = lineCountForFile(f);
          const mentionCount = f.mentions?.length || 0;
          const openByDefault = !isViewed && (idx < 5 || lineCommentsInFile > 0 || mentionCount > 0);
          return `
        <details class="diff-file ${isViewed ? "is-viewed" : ""}" id="diff-file-${origIdx}" ${openByDefault ? "open" : ""}>
          <summary>
            <span class="diff-path">${esc(fp)}</span>
            <span class="row" style="gap:8px;flex-shrink:0;">
              ${lineCommentsInFile > 0 ? `<span class="tag-micro" style="color:var(--accent-t);">💬 ${lineCommentsInFile} inline</span>` : ""}
              ${mentionCount > 0 ? `<span class="tag-micro">💬 ${mentionCount} file</span>` : ""}
              <span class="mono diff-stat-add">+${f.additions}</span>
              <span class="mono diff-stat-del">-${f.deletions}</span>
              <label class="diff-viewed-toggle" data-viewed-wrap="1">
                <input type="checkbox" data-mark-viewed="${esc(fp)}" ${isViewed ? "checked" : ""} />
                <span>Viewed</span>
              </label>
            </span>
          </summary>
          ${
            f.mentions && f.mentions.length > 0
              ? `
            <details class="diff-file-mentions">
              <summary>💬 ${f.mentions.length} pgsql-hackers message${f.mentions.length === 1 ? "" : "s"} mention <code class="mono">${esc(fp.split("/").pop() || fp)}</code></summary>
              <div class="diff-mentions-list">
                ${f.mentions
                  .map(
                    (m) => `
                  <div class="diff-comment-card">
                    <div class="diff-comment-head">
                      <strong>${esc(m.from)}</strong>
                      <span class="mono dim">#${m.messageIndex + 1} · ${esc(m.date.slice(0, 10))}</span>
                      <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto;padding:2px 7px;font-size:11px;" data-open-disc-msg="${m.messageIndex}">View in Discussion →</button>
                    </div>
                    <div class="diff-comment-body">${esc(m.excerpt)}</div>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </details>
          `
              : ""
          }
          <div class="diff-scroll">
            <table class="diff-table">
              <tbody>
                ${f.hunks
                  .map(
                    (h) => `
                  <tr class="diff-hunk"><td colspan="3">${esc(h.header)}</td></tr>
                  ${h.lines
                    .map(
                      (ln) => `
                    <tr class="diff-${ln.type} ${ln.comments?.length ? "diff-has-comment" : ""}">
                      <td class="diff-ln">${ln.oldLine ?? ""}</td>
                      <td class="diff-ln">${ln.newLine ?? ""}</td>
                      <td class="diff-code">${ln.type === "add" ? "+" : ln.type === "del" ? "-" : " "}${esc(ln.content)}</td>
                    </tr>
                    ${
                      ln.comments && ln.comments.length > 0
                        ? `
                      <tr class="diff-inline-row">
                        <td colspan="3">
                          <div class="diff-inline-thread">
                            ${ln.comments
                              .map(
                                (c) => `
                              <div class="diff-comment-card">
                                <div class="diff-comment-head">
                                  <span class="diff-comment-badge">💬 Matched from -hackers</span>
                                  <strong>${esc(c.from)}</strong>
                                  <span class="mono dim">#${c.messageIndex + 1} · ${esc(c.date.slice(0, 10))}</span>
                                  <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto;padding:2px 7px;font-size:11px;" data-open-disc-msg="${c.messageIndex}">Read thread #${c.messageIndex + 1} →</button>
                                </div>
                                <div class="diff-comment-body">${esc(c.excerpt)}</div>
                              </div>
                            `,
                              )
                              .join("")}
                          </div>
                        </td>
                      </tr>
                    `
                        : ""
                    }
                  `,
                    )
                    .join("")}
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </details>
      `;
        })
        .join("")}
    </div>
  `;
}

function renderPatchPage(): string {
  const cfId = state.activePatchId!;
  const slMatch = state.briefDetail?.shortlist.find((x) => x.cf_id === cfId);
  const clMatch = state.briefDetail?.closing.find((x) => x.cf_id === cfId);
  const listMatch = state.entries.find((e) => e.cf_id === cfId);
  const dbEntry = state.patchData?.entry;

  const title = dbEntry?.title || listMatch?.title || slMatch?.title || clMatch?.title || `CommitFest Patch #${cfId}`;
  const verdict = dbEntry?.verdict || listMatch?.verdict || slMatch?.verdict || clMatch?.verdict || "UNROASTED";
  const status = dbEntry?.status || listMatch?.status || slMatch?.status || clMatch?.status || "";
  const topic = dbEntry?.topic || listMatch?.topic || "";
  const authors = dbEntry?.authors || listMatch?.authors || slMatch?.authors || clMatch?.authors || "";
  const reviewers = dbEntry?.reviewers || listMatch?.reviewers || "";
  const committer = dbEntry?.committer || listMatch?.committer || "";
  const threadUrl = dbEntry?.thread_url || listMatch?.thread_url || slMatch?.thread_url || clMatch?.thread_url || "";
  const kind = dbEntry?.kind || listMatch?.kind || slMatch?.kind || "";
  const seenInProd = Boolean(dbEntry?.seen_in_production || listMatch?.seen_in_production || slMatch?.seen_in_production);
  const workaround = dbEntry?.workaround || listMatch?.workaround || slMatch?.workaround || clMatch?.workaround || "";
  const failingSummary = dbEntry?.failing_summary || clMatch?.failing_summary || "";
  const reasons = slMatch?.reasons || clMatch?.reasons || [];
  const nextStep = clMatch?.next_step_for_author || "";
  const experts = slMatch?.experts || [];

  const opinions = state.patchData?.opinions ?? state.opinions.filter((o) => o.cf_id === cfId);
  const coordination = state.patchData?.coordination ?? state.coordination.filter((c) => c.cf_id === cfId);
  const consensus = state.patchData?.consensus;

  const backLabel =
    state.returnTab === "entries"
      ? "Entries"
      : state.returnTab === "opinions"
        ? "Opinions"
        : state.returnTab === "stats"
          ? "Stats"
          : "Brief";
  const backofficeHref = getLocalBackofficeUrl(cfId);

  // Build visual consensus bar segments
  const breakdownEntries: Array<[string, number]> = consensus && consensus.totalOpinions > 0
    ? Object.entries(consensus.breakdown).sort((a, b) => b[1] - a[1])
    : verdict && verdict !== "UNROASTED"
      ? [[verdict, 1]]
      : [];
  const barTotal = breakdownEntries.reduce((acc, [, n]) => acc + n, 0);

  const consensusBadge = !consensus || consensus.status === "baseline_only"
    ? `<span class="pill">Baseline brief pass</span>`
    : consensus.status === "unanimous"
      ? `<span class="pill p-ok">Unanimous agreement</span>`
      : consensus.status === "majority"
        ? `<span class="pill p-info">Majority consensus</span>`
        : `<span class="pill p-warn">Split opinions</span>`;

  // Unique contributor + model pairs
  const contributorChips = opinions.map((o) => {
    const handle = o.contributor_handle ? `@${o.contributor_handle}` : o.contributor_name;
    return `<span class="opinion-model-badge">${verdictDot(o.verdict)} <strong>${esc(handle)}</strong> <span class="dim">·</span> <span class="mono">${esc(o.backend)}</span></span>`;
  });

  const kvRows: Array<[string, string]> = [];
  if (status) kvRows.push(["CF Status", esc(status)]);
  if (topic) kvRows.push(["Subsystem", esc(topic)]);
  if (authors) kvRows.push(["Authors", esc(authors)]);
  if (reviewers) kvRows.push(["Reviewers", esc(reviewers)]);
  if (committer) kvRows.push(["Committer", esc(committer)]);

  return `
    <div class="patch-crumb">
      <button type="button" class="back-btn" id="patch-back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        <span>Back to ${backLabel}</span>
      </button>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-secondary btn-sm" id="patch-copy-url-btn">Copy link</button>
        <a class="btn btn-primary btn-sm" href="https://commitfest.postgresql.org/patch/${cfId}/" target="_blank" rel="noopener">CommitFest ↗</a>
        ${threadUrl ? `<a class="btn btn-secondary btn-sm" href="${esc(threadUrl)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
      </div>
    </div>

    <div class="patch-hero">
      <div class="row" style="gap:7px;">
        <span class="mono" style="font-size:13px;font-weight:600;color:var(--muted);">CF ${cfId}</span>
        ${verdictPill(verdict)}
        ${status ? `<span class="tag-micro">${esc(status)}</span>` : ""}
        ${kind === "bugfix" ? `<span class="tag-micro">Bug fix</span>` : kind ? `<span class="tag-micro">Feature</span>` : ""}
        ${seenInProd ? `<span class="tag-micro tag-prod">Seen in production</span>` : ""}
        ${workaround ? `<span class="tag-micro tag-wa">Workaround noted</span>` : ""}
      </div>
      <h1 class="patch-hero-title">${esc(title)}</h1>
      <div class="muted" style="font-size:12.5px;">
        ${authors ? `Authors: <strong>${esc(authors)}</strong>` : ""}
        ${reviewers ? ` · Reviewers: ${esc(reviewers)}` : ""}
        ${committer ? ` · Committer: ${esc(committer)}` : ""}
      </div>
    </div>

    <div class="mr-tabs" role="tablist" aria-label="Patch MR views">
      <button type="button" class="mr-tab ${state.mrTab === "overview" ? "active" : ""}" data-mr-tab="overview">
        <span>Overview &amp; Consensus</span>
        <span class="mr-tab-count">${opinions.length}</span>
      </button>
      <button type="button" class="mr-tab ${state.mrTab === "discussion" ? "active" : ""}" data-mr-tab="discussion">
        <span>Discussion</span>
        ${state.mrDiscussion ? `<span class="mr-tab-count">${state.mrDiscussion.messageCount}</span>` : ""}
      </button>
      <button type="button" class="mr-tab ${state.mrTab === "changes" ? "active" : ""}" data-mr-tab="changes">
        <span>Changes</span>
        ${state.mrDiff ? `<span class="mr-tab-count">${state.mrDiff.files.length}</span>` : ""}
      </button>
    </div>

    ${
      state.mrTab === "discussion"
        ? renderMrDiscussionTab(cfId, backofficeHref)
        : state.mrTab === "changes"
          ? renderMrDiffTab(cfId, backofficeHref)
          : `
    <div class="patch-grid">
      <div class="patch-main">
        <!-- 1. Common Ground & Consensus -->
        <section class="consensus-card">
          <div class="card-head" style="margin-bottom:6px;">
            <h2>Common Ground &amp; Consensus</h2>
            ${consensusBadge}
          </div>
          <p class="consensus-headline">
            ${
              state.patchLoading
                ? "Loading reviewer opinions and consensus…"
                : esc(
                    consensus?.headline ||
                      "Compare multiple reviewers' local AI runs on this patch to find where models and reviewers agree or disagree.",
                  )
            }
          </p>
          ${
            barTotal > 0
              ? `
            <div class="consensus-bar" aria-label="Verdict consensus breakdown">
              ${breakdownEntries
                .map(([v, count]) => {
                  const m = getVerdictMeta(v);
                  const w = Math.max(4, Math.round((count / barTotal) * 100));
                  return `<div class="consensus-seg" style="width:${w}%;background:${m.color}" title="${esc(m.label)}: ${count}"></div>`;
                })
                .join("")}
            </div>
            <div class="consensus-legend">
              ${breakdownEntries
                .map(([v, count]) => {
                  const m = getVerdictMeta(v);
                  return `<span><span class="dot" style="background:${m.color};margin-right:5px;"></span>${esc(m.label)}: <strong class="mono">${count}</strong></span>`;
                })
                .join("")}
            </div>
          `
              : ""
          }
          ${
            contributorChips.length > 0
              ? `<div class="row" style="margin-top:12px;gap:6px;">${contributorChips.join("")}</div>`
              : ""
          }
        </section>

        <!-- 2. Reviewer & AI Opinions Feed -->
        <section>
          <div class="card-head" style="margin-bottom:10px;">
            <h2>Reviewer &amp; AI Opinions (${opinions.length})</h2>
            <span class="dim" style="font-size:12px;">Published from each reviewer's local workbench</span>
          </div>

          <div class="opinion-feed">
            ${opinions
              .map((o) => {
                const initials = (o.contributor_name || o.contributor_handle || "?").slice(0, 2).toUpperCase();
                const modelsText = formatModelsLabel(o.models_json);
                return `
              <article class="opinion-card">
                <div class="opinion-head">
                  <div class="opinion-who">
                    <div class="opinion-avatar">
                      ${o.contributor_avatar ? `<img src="${esc(o.contributor_avatar)}" alt="${esc(o.contributor_name)}" />` : esc(initials)}
                    </div>
                    <div>
                      <div class="opinion-name">${esc(o.contributor_name || o.contributor_handle)}</div>
                      <div class="opinion-sub">@${esc(o.contributor_handle)} · ${esc(o.contributor_provider)} · ${esc(o.created_at.slice(0, 10))}</div>
                    </div>
                  </div>
                  <div class="row" style="gap:6px;">
                    <span class="opinion-model-badge mono">${esc(o.backend)}</span>
                    <span class="opinion-model-badge">${esc(formatOpinionProfile(o))}</span>
                    ${verdictPill(o.verdict)}
                  </div>
                </div>
                ${modelsText ? `<div class="dim mono" style="font-size:11.5px;">Models: ${esc(modelsText)} · Confidence: ${esc(o.confidence || "medium")}</div>` : `<div class="dim" style="font-size:11.5px;">Confidence: ${esc(o.confidence || "medium")}</div>`}
                <div class="opinion-body">${esc(o.summary || "No summary text included.")}</div>
              </article>
            `;
              })
              .join("")}

            <!-- Baseline CommitFest Brief Pass -->
            ${
              verdict !== "UNROASTED" || reasons.length > 0 || workaround || failingSummary || nextStep
                ? `
              <article class="opinion-card is-baseline">
                <div class="opinion-head">
                  <div class="opinion-who">
                    <div class="opinion-avatar" style="background:var(--hover);color:var(--muted);">CF</div>
                    <div>
                      <div class="opinion-name">CommitFest Brief — Baseline Pass</div>
                      <div class="opinion-sub">
                        ${esc(state.briefDetail?.commitfest_label || "CommitFest")}
                        ${state.briefDetail?.published_by_handle ? ` · published by @${esc(state.briefDetail.published_by_handle)}` : ""}
                        ${state.briefDetail?.created_at ? ` · ${esc(state.briefDetail.created_at.slice(0, 10))}` : ""}
                      </div>
                    </div>
                  </div>
                  ${verdictPill(verdict)}
                </div>

                ${
                  failingSummary
                    ? `<div class="sheet-callout sheet-callout-warn"><strong>Failing level:</strong> ${esc(failingSummary)}</div>`
                    : ""
                }
                ${
                  workaround
                    ? `<div class="sheet-callout sheet-callout-warn"><strong>Already exists / workaround:</strong> ${esc(workaround)}</div>`
                    : ""
                }
                ${
                  reasons.length > 0
                    ? `<div class="opinion-body">${reasons.map((r) => `• ${esc(r)}`).join("\n")}</div>`
                    : `<div class="muted" style="font-size:13px;">Baseline triage verdict from the published CommitFest batch. Open CF ${cfId} in your local workbench to inspect the full objection breakdown and diff.</div>`
                }
                ${
                  nextStep
                    ? `<div class="sheet-callout"><strong>Suggested next step for author:</strong> ${esc(nextStep)}</div>`
                    : ""
                }
              </article>
            `
                : ""
            }

            <!-- Contribute CTA -->
            <div class="collab-cta">
              <div style="font-weight:600;font-size:13.5px;">Add your AI's opinion on CF ${cfId}</div>
              <div class="muted" style="font-size:12.5px;line-height:1.5;">
                Each reviewer runs their own local <strong>Personal Backoffice</strong> with their preferred AI (Claude, Gemini, Codex, Grok, etc.) and local PostgreSQL build, then clicks <strong>Publish Opinion</strong> to share sanitized findings here so the team can compare perspectives and derive common ground.
              </div>
              <div class="row" style="gap:8px;margin-top:2px;">
                <a class="btn btn-backoffice" href="${esc(backofficeHref)}" target="_blank" rel="noopener">Open CF ${cfId} in Personal Backoffice ↗</a>
                <button type="button" class="btn btn-secondary" id="patch-copy-local-cta">Copy local link</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. Team Coordination on this Patch -->
        <section class="card">
          <div class="card-head">
            <h2>Team Coordination on CF ${cfId} (${coordination.length})</h2>
            <span class="dim" style="font-size:12px;">Avoid duplicate review effort</span>
          </div>
          ${
            coordination.length === 0
              ? `<div class="muted" style="font-size:12.5px;">No reviewer has posted a public claim on CF ${cfId} yet. Claim a review angle or repro from your local workbench to let others know what you're checking.</div>`
              : `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${coordination
                .map(
                  (c) => `
                <div class="sheet-callout">
                  <div class="row" style="justify-content:space-between;margin-bottom:4px;">
                    <strong>${esc(c.title)}</strong>
                    <span class="pill p-info">${esc(c.status)}</span>
                  </div>
                  <div class="muted" style="font-size:12px;">
                    <strong>${esc(c.assignee_name)}</strong> (@${esc(c.assignee_handle)}) · ${esc(c.updated_at.slice(0, 10))}
                  </div>
                  ${c.note ? `<div style="margin-top:5px;font-size:12.5px;">${esc(c.note)}</div>` : ""}
                </div>
              `,
                )
                .join("")}
            </div>
          `
          }
        </section>
      </div>

      <!-- Right Sidebar -->
      <aside class="patch-aside">
        ${
          kvRows.length
            ? `
          <div class="card" style="margin-bottom:0;">
            <div class="sheet-section-label" style="margin-bottom:8px;">Patch Details</div>
            <div class="sheet-kv" style="border:none;padding:0;background:transparent;">
              ${kvRows.map(([k, v]) => `<div class="dim">${k}</div><div>${v}</div>`).join("")}
            </div>
          </div>
        `
            : ""
        }

        ${
          experts.length > 0
            ? `
          <div class="card" style="margin-bottom:0;">
            <div class="sheet-section-label" style="margin-bottom:8px;">Active Subsystem Reviewers</div>
            <div class="row" style="gap:6px;">
              ${experts.map((e) => `<span class="tag-micro">${esc(e.name)}</span>`).join("")}
            </div>
          </div>
        `
            : ""
        }

        <div class="space-handoff-box">
          <div class="space-card-head">
            <span class="space-card-title" style="font-size:13px;"><span class="space-dot" style="background:var(--warn)"></span>Personal Backoffice</span>
            <span class="space-badge-local">Private · Local</span>
          </div>
          <div class="muted" style="font-size:12px;line-height:1.45;">
            Compile Postgres, run your AI harness, review the patch diff, keep private Work Items, and draft <code>-hackers</code> emails locally.
          </div>
          <a class="btn btn-primary" style="width:100%;height:38px;" href="${esc(backofficeHref)}" target="_blank" rel="noopener">Work on CF ${cfId} in Backoffice ↗</a>
          <div class="row" style="gap:6px;">
            <button type="button" class="btn btn-secondary" style="flex:1;" id="patch-copy-local-side">Copy local link</button>
            <a class="btn btn-ghost" href="https://github.com/NikolayS/pgroast" target="_blank" rel="noopener">Install ↗</a>
          </div>
        </div>
      </aside>
    </div>
    `
    }
  `;
}

/* ---- First-Class Public Stats Tab ---- */
function renderStatsTab(): string {
  const brief = state.briefDetail;
  if (!brief) {
    return `<div class="card"><div class="empty-state">No CommitFest brief stats published yet.</div></div>`;
  }
  const stats = brief.stats || {};
  const verdicts = stats.verdicts ?? [];
  const vCount = (k: string) => verdicts.find((x) => x.verdict === k)?.all ?? 0;
  const total = stats.totals?.total ?? state.entries.length;
  const openCount = stats.totals?.open ?? 0;
  const closedCount = stats.totals?.closed ?? 0;
  const roasted = stats.totals?.roasted ?? Math.max(0, total - vCount("UNROASTED"));
  const coveragePct = total > 0 ? Math.round((roasted / total) * 100) : 0;
  const rfcCount = (stats.statusMatrix ?? []).find((r) => r.status.toLowerCase().includes("ready for committer"))?.total ?? 0;

  const donutSegments = [
    { key: "NO-FUNDAMENTAL-OBJECTION", label: "No fundamental objection", value: vCount("NO-FUNDAMENTAL-OBJECTION"), color: "#4cb782" },
    { key: "NEEDS-COMMITTER-EYES", label: "Needs committer eyes", value: vCount("NEEDS-COMMITTER-EYES"), color: "#5e6ad2" },
    { key: "NEEDS-DESIGN-DISCUSSION", label: "Needs design discussion", value: vCount("NEEDS-DESIGN-DISCUSSION"), color: "#e0a83c" },
    { key: "LIKELY-REJECT", label: "Likely reject", value: vCount("LIKELY-REJECT"), color: "#eb5757" },
    { key: "UNROASTED", label: "Not reviewed", value: vCount("UNROASTED"), color: "#737682" },
  ];

  const matrixRows = stats.statusMatrix ?? [];
  const maxMatrixCell = Math.max(
    1,
    ...matrixRows.flatMap((r) => [
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

  // Subsystems with open + clean + ready breakdown
  const topics = (stats.topTopics ?? []).slice(0, 14);
  const maxTopicTotal = Math.max(1, ...topics.map((t) => t.total || t.open));

  // Compute leaderboards from stats.leaderboards OR derive from entries on the fly if absent!
  const deriveLeaderboard = (field: "authors" | "reviewers" | "committer"): Array<{ name: string; count: number }> => {
    const counts = new Map<string, number>();
    for (const e of state.entries) {
      const raw = (e[field] || "").trim();
      if (!raw || raw === "—") continue;
      for (const part of raw.split(/,\s*/)) {
        const clean = part.replace(/\s*\([^)]*\)\s*/g, "").trim();
        if (!clean || clean === "—") continue;
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  };

  const authorsLb = stats.leaderboards?.authors?.length ? stats.leaderboards.authors.slice(0, 15) : deriveLeaderboard("authors");
  const reviewersLb = stats.leaderboards?.reviewers?.length ? stats.leaderboards.reviewers.slice(0, 15) : deriveLeaderboard("reviewers");
  const committersLb = stats.leaderboards?.committers?.length ? stats.leaderboards.committers.slice(0, 15) : deriveLeaderboard("committer");

  // Multi-model opinion stats
  const uniqueOpReviewers = new Set(state.opinions.map((o) => o.contributor_handle || o.contributor_name)).size;
  const uniqueOpModels = new Set(state.opinions.map((o) => o.backend)).size;

  const renderLbCard = (id: "authors" | "reviewers" | "committers", title: string, rows: Array<{ name: string; count: number }>) => `
    <div class="card lb-card ${state.statsLbTab !== id ? "mobile-hidden" : ""}" style="margin-bottom:0;">
      <div class="card-head" style="margin-bottom:8px;">
        <h3>${title}</h3>
        <span class="dim" style="font-size:11.5px;">Tap to filter</span>
      </div>
      <div class="lb-list">
        ${
          rows.length === 0
            ? `<div class="muted" style="font-size:12px;">No data.</div>`
            : rows
                .map(
                  (r, i) => `
            <button type="button" class="lb-row" data-stats-person="${esc(r.name)}">
              <span class="lb-rank mono">${i + 1}</span>
              <span class="lb-name">${esc(r.name)}</span>
              <span class="lb-count mono">${r.count}</span>
            </button>
          `,
                )
                .join("")
        }
      </div>
    </div>
  `;

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">CommitFest Stats &amp; Intelligence</h1>
        <div class="page-sub">${esc(brief.commitfest_label)} · Updated ${esc(brief.created_at.slice(0, 10))} · Click any metric, cell, subsystem, or person to drill into Entries</div>
      </div>
      <div class="row" style="gap:6px;">
        <a class="btn btn-secondary btn-sm" href="/briefs/${encodeURIComponent(brief.slug)}/download.html">Download HTML</a>
        <a class="btn btn-ghost btn-sm" href="/briefs/${encodeURIComponent(brief.slug)}/download.json">JSON</a>
      </div>
    </div>

    <div class="kpis">
      <button type="button" class="kpi" data-jump-verdict="all">
        <div class="kpi-l">Total entries</div>
        <div class="kpi-v">${total}</div>
        <div class="kpi-sub">${openCount} open · ${closedCount} closed</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="all">
        <div class="kpi-l">AI review coverage</div>
        <div class="kpi-v">${coveragePct}%</div>
        <div class="kpi-sub">${roasted} of ${total} reviewed</div>
      </button>
      <button type="button" class="kpi" data-stats-status="Ready for Committer">
        <div class="kpi-l"><span class="dot" style="background:var(--ok)"></span>Ready for Committer</div>
        <div class="kpi-v" style="color:var(--ok)">${rfcCount}</div>
        <div class="kpi-sub">Tap to view queue</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NO-FUNDAMENTAL-OBJECTION">
        <div class="kpi-l"><span class="dot" style="background:#4cb782"></span>No objection</div>
        <div class="kpi-v">${vCount("NO-FUNDAMENTAL-OBJECTION")}</div>
        <div class="kpi-sub">Clean design signal</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="LIKELY-REJECT">
        <div class="kpi-l"><span class="dot" style="background:#eb5757"></span>Likely reject</div>
        <div class="kpi-v" style="color:var(--danger)">${vCount("LIKELY-REJECT")}</div>
        <div class="kpi-sub">Closing candidates</div>
      </button>
      <button type="button" class="kpi" id="stats-goto-opinions">
        <div class="kpi-l">Community opinions</div>
        <div class="kpi-v">${state.opinions.length}</div>
        <div class="kpi-sub">${uniqueOpReviewers} reviewers · ${uniqueOpModels} models</div>
      </button>
    </div>

    <div class="grid2" style="margin-bottom:14px;">
      <div class="card" style="margin-bottom:0;">
        <div class="card-head">
          <h2>Verdict Distribution</h2>
          <span class="dim" style="font-size:12px;">Tap any verdict to filter</span>
        </div>
        <div class="donut-row">
          ${renderSvgDonut(donutSegments)}
          <div class="legend">
            ${donutSegments
              .map((s) => {
                const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
                return `
              <button type="button" class="legend-btn" data-jump-verdict="${s.key}">
                <span class="legend-left"><span class="dot" style="background:${s.color}"></span><span>${esc(s.label)}</span></span>
                <span class="mono"><strong>${s.value}</strong> <span class="dim">(${pct}%)</span></span>
              </button>
            `;
              })
              .join("")}
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:0;">
        <div class="card-head">
          <h2>Top PostgreSQL Subsystems</h2>
          <span class="dim" style="font-size:12px;">Open · Clean · Ready</span>
        </div>
        <div class="subsys-list">
          ${
            topics
              .map((t) => {
                const tTotal = Math.max(1, t.total || t.open);
                const wAll = Math.max(4, Math.round((tTotal / maxTopicTotal) * 100));
                const cleanPct = Math.round(((t.clean || 0) / tTotal) * 100);
                const readyPct = Math.round(((t.ready || 0) / tTotal) * 100);
                return `
              <button type="button" class="subsys-row" data-stats-topic="${esc(t.topic)}">
                <div class="subsys-head">
                  <span class="hbar-label">${esc(t.topic)}</span>
                  <span class="mono dim">${t.open || t.total} open${t.clean ? ` · <span style="color:var(--ok)">${t.clean} clean</span>` : ""}${t.ready ? ` · <span style="color:var(--accent-t)">${t.ready} RFC</span>` : ""}</span>
                </div>
                <div class="subsys-bar" style="width:${wAll}%;">
                  ${cleanPct > 0 ? `<div style="width:${cleanPct}%;background:var(--ok);"></div>` : ""}
                  ${readyPct > 0 ? `<div style="width:${readyPct}%;background:var(--accent);"></div>` : ""}
                  <div style="flex:1;background:rgb(94 106 210 / 0.35);"></div>
                </div>
              </button>
            `;
              })
              .join("") || `<div class="muted">No subsystem breakdown included in this brief.</div>`
          }
        </div>
      </div>
    </div>

    ${
      matrixRows.length
        ? `
      <div class="card">
        <div class="card-head">
          <h2>CommitFest Status × Verdict Heatmap</h2>
          <span class="dim" style="font-size:12px;">Click any cell to open matching patches</span>
        </div>
        <div class="table-scroll">
          <table class="matrix">
            <thead>
              <tr>
                <th>CF Status</th>
                <th class="num">Total</th>
                <th class="num">No objection</th>
                <th class="num">Committer eyes</th>
                <th class="num">Design disc.</th>
                <th class="num">Likely reject</th>
                <th class="num">Not reviewed</th>
              </tr>
            </thead>
            <tbody>
              ${matrixRows
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
      </div>
    `
        : ""
    }

    <div class="card-head" style="margin:16px 0 10px;">
      <h2>Community Leaderboards</h2>
      <span class="dim" style="font-size:12px;">Click any contributor to see their patches</span>
    </div>

    <div class="lb-mobile-seg" role="tablist" aria-label="Leaderboard categories">
      <button type="button" class="seg-btn ${state.statsLbTab === "authors" ? "active" : ""}" data-lb-tab="authors">Authors</button>
      <button type="button" class="seg-btn ${state.statsLbTab === "reviewers" ? "active" : ""}" data-lb-tab="reviewers">Reviewers</button>
      <button type="button" class="seg-btn ${state.statsLbTab === "committers" ? "active" : ""}" data-lb-tab="committers">Committers</button>
    </div>

    <div class="lb-grid">
      ${renderLbCard("authors", "Top Authors", authorsLb)}
      ${renderLbCard("reviewers", "Top Reviewers", reviewersLb)}
      ${renderLbCard("committers", "Top Committers", committersLb)}
    </div>
  `;
}

function jumpToEntries(opts: { verdict?: string; status?: string; search?: string; focusSearch?: boolean }): void {
  state.activePatchId = null;
  state.tab = "entries";
  if (opts.verdict !== undefined) state.entryVerdict = opts.verdict;
  if (opts.status !== undefined) state.entryStatus = opts.status;
  if (opts.search !== undefined) state.entrySearch = opts.search;
  state.entryLimit = 60;
  navigateToTab("entries");
  if (opts.focusSearch) {
    setTimeout(() => {
      const inp = document.getElementById("pub-entry-search") as HTMLInputElement | null;
      inp?.focus();
    }, 60);
  }
}

/* ---- Brief Tab (Native Linear UI) ---- */
function renderBriefListHtml(brief: BriefDetail): string {
  if (state.briefSegment === "shortlist") {
    const bugfixCount = brief.shortlist.filter((x) => x.kind === "bugfix").length;
    const featureCount = brief.shortlist.filter((x) => x.kind !== "bugfix").length;
    const prodCount = brief.shortlist.filter((x) => x.seen_in_production).length;
    const items = brief.shortlist.filter((x) => {
      if (state.shortlistFilter === "bugfix") return x.kind === "bugfix";
      if (state.shortlistFilter === "feature") return x.kind !== "bugfix";
      if (state.shortlistFilter === "prod") return Boolean(x.seen_in_production);
      return true;
    });
    return `
      <div class="chips" role="tablist" aria-label="Shortlist filters">
        <button type="button" class="chip ${state.shortlistFilter === "all" ? "active" : ""}" data-sl-filter="all">All (${brief.shortlist.length})</button>
        <button type="button" class="chip ${state.shortlistFilter === "bugfix" ? "active" : ""}" data-sl-filter="bugfix">Bug fixes (${bugfixCount})</button>
        <button type="button" class="chip ${state.shortlistFilter === "feature" ? "active" : ""}" data-sl-filter="feature">Features (${featureCount})</button>
        <button type="button" class="chip ${state.shortlistFilter === "prod" ? "active" : ""}" data-sl-filter="prod">In production (${prodCount})</button>
      </div>
      <div class="issue-list">
        ${
          items.length === 0
            ? `<div class="empty-state">No shortlist items match this filter.</div>`
            : items
                .map(
                  (x, idx) => `
          <button type="button" class="issue-row" data-open-patch="${x.cf_id}">
            <div class="issue-top">
              <div class="issue-id-group">
                ${verdictDot(x.verdict)}
                <span class="mono issue-id">#${idx + 1} · CF ${x.cf_id}</span>
                <span class="issue-status">${esc(x.status)}</span>
              </div>
              ${CHEVRON_SVG}
            </div>
            <div class="issue-title">${esc(x.title)}</div>
            <div class="issue-meta">
              <span class="tag-micro">${x.kind === "bugfix" ? "Bug fix" : "Feature"}</span>
              ${x.seen_in_production ? `<span class="tag-micro tag-prod">In prod</span>` : ""}
              ${x.workaround ? `<span class="tag-micro tag-wa">Workaround</span>` : ""}
              <span>${esc(x.authors || "—")}</span>
            </div>
            ${x.reasons?.length ? `<div class="issue-reason">${esc(x.reasons.join(" · "))}</div>` : ""}
          </button>
        `,
                )
                .join("")
        }
      </div>
    `;
  }

  return `
    <div class="issue-list">
      ${
        brief.closing.length === 0
          ? `<div class="empty-state">No closing or rethinking candidates in this brief.</div>`
          : brief.closing
              .map(
                (x, idx) => `
        <button type="button" class="issue-row" data-open-patch="${x.cf_id}">
          <div class="issue-top">
            <div class="issue-id-group">
              ${verdictDot(x.verdict)}
              <span class="mono issue-id">#${idx + 1} · CF ${x.cf_id}</span>
              <span class="issue-status">${esc(x.status)}</span>
            </div>
            ${CHEVRON_SVG}
          </div>
          <div class="issue-title">${esc(x.title)}</div>
          <div class="issue-meta">
            ${x.workaround ? `<span class="tag-micro tag-wa">Workaround / exists</span>` : ""}
            <span>${esc(x.authors || "—")}</span>
          </div>
          ${x.failing_summary || x.reasons?.length ? `<div class="issue-reason">${esc(x.failing_summary || (x.reasons ?? []).join(" · "))}</div>` : ""}
        </button>
      `,
              )
              .join("")
      }
    </div>
  `;
}

function renderIntroCard(): string {
  if (state.introCollapsed) {
    return `
      <div class="intro-collapsed">
        <div class="intro-collapsed-text">
          <span class="intro-bean" aria-hidden="true">☕</span>
          <span><strong>How pgroast works:</strong> reviewers and AIs roast CommitFest patches (and their own drafts) by level and flavour; humans verify findings and deliver reviews to <code class="mono">pgsql-hackers</code>.</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="intro-toggle-btn">Show guide ▾</button>
      </div>
    `;
  }

  return `
    <section class="intro-card" aria-label="How pgroast works">
      <div class="intro-head">
        <div>
          <div class="intro-kicker">Open-source PostgreSQL CommitFest collaboration</div>
          <h2 class="intro-title">Review CommitFest patches together — humans + AIs</h2>
          <p class="intro-lead">
            CommitFest has hundreds of open patches waiting for review. Each contributor runs a private local <strong>Backoffice</strong> with their own AI models to adversarial-review (&ldquo;roast&rdquo;) patches — or pre-check their own patch before posting — then publishes sanitized opinions here so we can compare notes and find common ground.
          </p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm intro-hide-btn" id="intro-toggle-btn" title="Collapse intro guide">Hide guide ▴</button>
      </div>

      <div class="intro-grid">
        <div class="intro-step">
          <div class="intro-step-head">
            <span class="intro-num">1</span>
            <strong>Roast any patch — or your own</strong>
          </div>
          <p>
            Run design and architecture pre-reviews against any CommitFest entry or <code class="mono">pgsql-hackers</code> thread, checked against 2,500+ prior rejected attempts and reverts. Authors can also roast their own local draft (<code class="mono">pgroast --self</code>) before submitting.
          </p>
        </div>

        <div class="intro-step">
          <div class="intro-step-head">
            <span class="intro-num">2</span>
            <strong>Choose a roast level</strong>
          </div>
          <div class="intro-pills">
            <span class="intro-rbadge intro-rbadge-light">Light</span>
            <span class="intro-rbadge intro-rbadge-medium">Medium</span>
            <span class="intro-rbadge intro-rbadge-dark">Dark</span>
          </div>
          <p>
            <strong>Light</strong> gives constructive author pre-flight feedback. <strong>Medium</strong> runs a balanced committer review. <strong>Dark</strong> stress-tests maintenance burden, demand, WAL/locking edge cases, and core vs. extension fit without pulling punches.
          </p>
        </div>

        <div class="intro-step">
          <div class="intro-step-head">
            <span class="intro-num">3</span>
            <strong>Pick a hacker flavour</strong>
          </div>
          <div class="intro-flavour-list">
            <span class="chip">Default</span>
            <span class="chip">Tom Lane</span>
            <span class="chip">Peter Eisentraut</span>
            <span class="chip">Robert Haas</span>
            <span class="chip">Andres Freund</span>
            <span class="chip">Heikki Linnakangas</span>
            <span class="chip">Bruce Momjian</span>
          </div>
          <p>
            Focus the review through AI-simulated technical lenses and styles. Every report and public opinion remembers its roast level and flavour.
          </p>
        </div>

        <div class="intro-step intro-step-human">
          <div class="intro-step-head">
            <span class="intro-num">4</span>
            <strong>A human takes ownership → <code class="mono">pgsql-hackers</code></strong>
          </div>
          <p>
            AI roasts are starting points, never committer decisions, and nothing is ever auto-posted. A human reviewer claims a patch, reads the code and thread, checks every finding, and sends their own verified review to <code class="mono">pgsql-hackers</code>.
          </p>
        </div>
      </div>

      <div class="intro-foot">
        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" id="intro-setup-btn">Set up your Backoffice →</button>
          <button type="button" class="btn btn-secondary btn-sm" id="intro-opinions-btn">See live opinions (${state.opinions.length})</button>
        </div>
        <span class="dim" style="font-size:12px;">Tap any patch below to open its consensus, <code class="mono">-hackers</code> discussion, and live diff.</span>
      </div>
    </section>
  `;
}

function renderBriefTab(): string {
  const brief = state.briefDetail;
  if (!brief) {
    return `
      ${renderIntroCard()}
      <div class="card">
        <div class="card-head">
          <h2>Interactive CommitFest Brief</h2>
          <button type="button" class="btn btn-primary btn-sm" id="goto-connect-btn">Connect Backoffice →</button>
        </div>
        <p class="muted" style="margin:0;">
          No CommitFest brief has been published to this companion yet. Publish one from your local Personal Backoffice.
        </p>
      </div>
    `;
  }

  const stats = brief.stats || {};
  const verdicts = stats.verdicts ?? [];
  const vCount = (k: string) => verdicts.find((x) => x.verdict === k)?.all ?? 0;
  const total = stats.totals?.total ?? brief.entries.length;
  const openCount = stats.totals?.open ?? 0;
  const closedCount = stats.totals?.closed ?? 0;

  const donutSegments = [
    { key: "NO-FUNDAMENTAL-OBJECTION", label: "No fundamental objection", value: vCount("NO-FUNDAMENTAL-OBJECTION"), color: "#4cb782" },
    { key: "NEEDS-COMMITTER-EYES", label: "Needs committer eyes", value: vCount("NEEDS-COMMITTER-EYES"), color: "#5e6ad2" },
    { key: "NEEDS-DESIGN-DISCUSSION", label: "Needs design discussion", value: vCount("NEEDS-DESIGN-DISCUSSION"), color: "#e0a83c" },
    { key: "LIKELY-REJECT", label: "Likely reject", value: vCount("LIKELY-REJECT"), color: "#eb5757" },
    { key: "UNROASTED", label: "Not reviewed", value: vCount("UNROASTED"), color: "#737682" },
  ];

  const topTopics = (stats.topTopics ?? []).slice(0, 8);
  const maxTopic = Math.max(1, ...topTopics.map((t) => t.open || t.total));
  const matrixRows = stats.statusMatrix ?? [];

  return `
    <div class="page-head">
      <div style="min-width:0;flex:1;">
        <h1 class="page-title">${esc(brief.title)}</h1>
        <div class="page-sub">
          ${esc(brief.commitfest_label)} · ${esc(brief.created_at.slice(0, 10))}
          ${brief.published_by_handle ? `· @${esc(brief.published_by_handle)}` : ""}
        </div>
      </div>
      <div class="row" style="gap:6px;">
        ${
          state.briefs.length > 1
            ? `<select id="brief-select" aria-label="Select brief">${state.briefs.map((b) => `<option value="${esc(b.slug)}" ${b.slug === brief.slug ? "selected" : ""}>${esc(b.title)}</option>`).join("")}</select>`
            : ""
        }
        <div class="export-wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="export-toggle-btn" aria-expanded="false">
            Export
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="export-menu" id="export-menu" hidden>
            <a class="export-item" href="/briefs/${encodeURIComponent(brief.slug)}/download.html"><span>Offline HTML</span><span class="dim">.html</span></a>
            <a class="export-item" href="/briefs/${encodeURIComponent(brief.slug)}/download.md"><span>Markdown</span><span class="dim">.md</span></a>
            <a class="export-item" href="/briefs/${encodeURIComponent(brief.slug)}/download.json"><span>Raw JSON</span><span class="dim">.json</span></a>
            <a class="export-item" href="/briefs/${encodeURIComponent(brief.slug)}/embed" target="_blank" rel="noopener"><span>Standalone view ↗</span><span class="dim">tab</span></a>
          </div>
        </div>
      </div>
    </div>

    ${renderIntroCard()}

    <div class="kpis">
      <button type="button" class="kpi" data-jump-verdict="all">
        <div class="kpi-l">Total entries</div>
        <div class="kpi-v">${total}</div>
        <div class="kpi-sub">${openCount} open · ${closedCount} closed</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NO-FUNDAMENTAL-OBJECTION">
        <div class="kpi-l"><span class="dot" style="background:#4cb782"></span>No objection</div>
        <div class="kpi-v" style="color:var(--ok)">${vCount("NO-FUNDAMENTAL-OBJECTION")}</div>
        <div class="kpi-sub">Tap to view</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NEEDS-COMMITTER-EYES">
        <div class="kpi-l"><span class="dot" style="background:#5e6ad2"></span>Committer eyes</div>
        <div class="kpi-v" style="color:var(--accent-t)">${vCount("NEEDS-COMMITTER-EYES")}</div>
        <div class="kpi-sub">Tap to view</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NEEDS-DESIGN-DISCUSSION">
        <div class="kpi-l"><span class="dot" style="background:#e0a83c"></span>Design disc.</div>
        <div class="kpi-v" style="color:var(--warn)">${vCount("NEEDS-DESIGN-DISCUSSION")}</div>
        <div class="kpi-sub">Tap to view</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="LIKELY-REJECT">
        <div class="kpi-l"><span class="dot" style="background:#eb5757"></span>Likely reject</div>
        <div class="kpi-v" style="color:var(--danger)">${vCount("LIKELY-REJECT")}</div>
        <div class="kpi-sub">Tap to view</div>
      </button>
      <button type="button" class="kpi" data-toggle-seg="closing">
        <div class="kpi-l">Shortlist / Close</div>
        <div class="kpi-v">${brief.shortlist.length} / ${brief.closing.length}</div>
        <div class="kpi-sub">Prioritized</div>
      </button>
    </div>

    <details class="insights-fold" ${window.innerWidth >= 768 ? "open" : ""}>
      <summary>
        <span>Charts &amp; Status Matrix</span>
        <svg class="fold-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="insights-body">
        <div class="grid2" style="margin-bottom:${matrixRows.length ? "14px" : "0"};">
          <div>
            <div class="sheet-section-label" style="margin-bottom:10px;">Verdict distribution</div>
            <div class="donut-row">
              ${renderSvgDonut(donutSegments)}
              <div class="legend">
                ${donutSegments
                  .map(
                    (s) => `
                  <button type="button" class="legend-btn" data-jump-verdict="${s.key}">
                    <span class="legend-left"><span class="dot" style="background:${s.color}"></span><span>${esc(s.label)}</span></span>
                    <strong class="mono">${s.value}</strong>
                  </button>
                `,
                  )
                  .join("")}
              </div>
            </div>
          </div>

          <div>
            <div class="sheet-section-label" style="margin-bottom:10px;">Top subsystems (open)</div>
            <div class="hbar-list">
              ${
                topTopics
                  .map(
                    (t) => `
                <div class="hbar-item">
                  <div class="hbar-top">
                    <span class="hbar-label" title="${esc(t.topic)}">${esc(t.topic)}</span>
                    <span class="mono dim">${t.open || t.total}</span>
                  </div>
                  <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(((t.open || t.total) / maxTopic) * 100)}%"></div></div>
                </div>
              `,
                  )
                  .join("") || `<div class="muted">No topic breakdown.</div>`
              }
            </div>
          </div>
        </div>

        ${
          matrixRows.length
            ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;">
            <div class="sheet-section-label" style="margin-bottom:8px;">CommitFest Status × Verdict (tap any cell)</div>
            <div class="table-scroll">
              <table class="matrix">
                <thead>
                  <tr>
                    <th>CF Status</th>
                    <th class="num">Total</th>
                    <th class="num">Clean</th>
                    <th class="num">Eyes</th>
                    <th class="num">Design</th>
                    <th class="num">Reject</th>
                    <th class="num">Unrev.</th>
                  </tr>
                </thead>
                <tbody>
                  ${matrixRows
                    .map(
                      (row) => `
                    <tr>
                      <td><strong>${esc(row.status)}</strong></td>
                      <td class="num">${row.total}</td>
                      <td class="num matrix-cell" data-mx-status="${esc(row.status)}" data-mx-verdict="NO-FUNDAMENTAL-OBJECTION">${row.counts["NO-FUNDAMENTAL-OBJECTION"] ?? 0}</td>
                      <td class="num matrix-cell" data-mx-status="${esc(row.status)}" data-mx-verdict="NEEDS-COMMITTER-EYES">${row.counts["NEEDS-COMMITTER-EYES"] ?? 0}</td>
                      <td class="num matrix-cell" data-mx-status="${esc(row.status)}" data-mx-verdict="NEEDS-DESIGN-DISCUSSION">${row.counts["NEEDS-DESIGN-DISCUSSION"] ?? 0}</td>
                      <td class="num matrix-cell" data-mx-status="${esc(row.status)}" data-mx-verdict="LIKELY-REJECT">${row.counts["LIKELY-REJECT"] ?? 0}</td>
                      <td class="num dim matrix-cell" data-mx-status="${esc(row.status)}" data-mx-verdict="UNROASTED">${row.counts.UNROASTED ?? 0}</td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        `
            : ""
        }
      </div>
    </details>

    <div class="seg-bar" role="tablist" aria-label="Brief lists">
      <button type="button" class="seg-btn ${state.briefSegment === "shortlist" ? "active" : ""}" data-brief-seg="shortlist">
        Shortlist <span class="seg-count">${brief.shortlist.length}</span>
      </button>
      <button type="button" class="seg-btn ${state.briefSegment === "closing" ? "active" : ""}" data-brief-seg="closing">
        Closing / Rethink <span class="seg-count">${brief.closing.length}</span>
      </button>
    </div>

    <div id="brief-list-mount">
      ${renderBriefListHtml(brief)}
    </div>
  `;
}

/* ---- Entries Tab (DOM-only search updates so iOS keyboard never drops!) ---- */
function getFilteredEntries(): EntryItem[] {
  const q = state.entrySearch.trim().toLowerCase();
  const v = state.entryVerdict;
  const st = state.entryStatus.toLowerCase();
  return state.entries.filter((e) => {
    const okQ = !q || `${e.cf_id} ${e.title} ${e.authors} ${e.reviewers || ""} ${e.committer || ""} ${e.topic || ""}`.toLowerCase().includes(q);
    const okV = v === "all" || (e.verdict || "UNROASTED") === v;
    const okS = st === "all" || (e.status || "").toLowerCase().includes(st);
    return okQ && okV && okS;
  });
}

function renderEntriesRowsHtml(filtered: EntryItem[]): string {
  if (filtered.length === 0) {
    return `<div class="empty-state">No entries match your current filter.</div>`;
  }
  const shown = filtered.slice(0, state.entryLimit);
  const remaining = filtered.length - shown.length;
  return `
    ${shown
      .map(
        (e) => `
      <button type="button" class="issue-row" data-open-patch="${e.cf_id}">
        <div class="issue-top">
          <div class="issue-id-group">
            ${verdictDot(e.verdict)}
            <span class="mono issue-id">CF ${e.cf_id}</span>
            <span class="issue-status">${esc(e.status || "—")}</span>
          </div>
          ${CHEVRON_SVG}
        </div>
        <div class="issue-title">${esc(e.title)}</div>
        <div class="issue-meta">
          ${e.topic ? `<span class="tag-micro">${esc(e.topic)}</span>` : ""}
          <span>${esc(e.authors || "—")}${e.reviewers ? ` · Rev: ${esc(e.reviewers)}` : ""}</span>
        </div>
      </button>
    `,
      )
      .join("")}
    ${
      remaining > 0
        ? `<div class="load-more-wrap"><button type="button" class="btn btn-secondary" id="entries-load-more">Show more (${remaining} remaining)</button></div>`
        : ""
    }
  `;
}

function updateEntriesListOnly(): void {
  const filtered = getFilteredEntries();
  const countEl = document.getElementById("entries-count-badge");
  if (countEl) countEl.textContent = `${filtered.length} of ${state.entries.length}`;
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.hidden = !state.entrySearch;
  const mount = document.getElementById("entries-list-mount");
  if (!mount) return;
  mount.innerHTML = renderEntriesRowsHtml(filtered);
  bindPatchRowClicks(mount);
  mount.querySelector("#entries-load-more")?.addEventListener("click", () => {
    state.entryLimit += 80;
    updateEntriesListOnly();
  });
}

function renderEntriesTab(): string {
  const filtered = getFilteredEntries();
  const verdictChips: Array<[string, string, string]> = [
    ["all", "All verdicts", ""],
    ["NO-FUNDAMENTAL-OBJECTION", "No objection", "#4cb782"],
    ["NEEDS-COMMITTER-EYES", "Committer eyes", "#5e6ad2"],
    ["NEEDS-DESIGN-DISCUSSION", "Design disc.", "#e0a83c"],
    ["LIKELY-REJECT", "Likely reject", "#eb5757"],
    ["UNROASTED", "Not reviewed", "#737682"],
  ];
  const statusChips: Array<[string, string]> = [
    ["all", "All statuses"],
    ["Ready for Committer", "Ready for Committer"],
    ["Needs review", "Needs review"],
    ["Waiting on Author", "Waiting on Author"],
  ];

  return `
    <div class="search-sticky">
      <div class="row" style="justify-content:space-between;margin-bottom:8px;">
        <h1 class="page-title" style="font-size:16px;">CommitFest Entries</h1>
        <span class="mono dim" id="entries-count-badge" style="font-size:12px;">${filtered.length} of ${state.entries.length}</span>
      </div>
      <div class="search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="pub-entry-search" type="search" inputmode="search" autocomplete="off" value="${esc(state.entrySearch)}" placeholder="Search CF #, title, author, reviewer, topic…" />
        <button type="button" class="search-clear" id="search-clear-btn" aria-label="Clear search" ${state.entrySearch ? "" : "hidden"}>×</button>
      </div>
      <div class="chips" role="tablist" aria-label="Verdict filter">
        ${verdictChips
          .map(
            ([val, label, dot]) => `
          <button type="button" class="chip ${state.entryVerdict === val ? "active" : ""}" data-entry-verdict="${val}">
            ${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${label}
          </button>
        `,
          )
          .join("")}
      </div>
      <div class="chips" role="tablist" aria-label="Status filter" style="margin-bottom:2px;">
        ${statusChips
          .map(
            ([val, label]) => `
          <button type="button" class="chip ${state.entryStatus.toLowerCase() === val.toLowerCase() ? "active" : ""}" data-entry-status="${esc(val)}">
            ${esc(label)}
          </button>
        `,
          )
          .join("")}
      </div>
    </div>

    <div class="issue-list" id="entries-list-mount">
      ${renderEntriesRowsHtml(filtered)}
    </div>
  `;
}

/* ---- Opinions Tab ---- */
function renderOpinionsTab(): string {
  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">Community Model Opinions (${state.opinions.length})</h1>
        <div class="page-sub">Every opinion shows who ran it and which AI produced it — tap any row to open the patch consensus page</div>
      </div>
    </div>
    ${
      state.opinions.length === 0
        ? `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600;color:var(--text);margin-bottom:6px;">No individual reviewer opinions published yet</div>
          <p class="muted" style="max-width:520px;margin:0 auto 12px;">
            Each reviewer installs their own local Personal Backoffice from <a href="https://github.com/NikolayS/pgroast" target="_blank" rel="noopener">github.com/NikolayS/pgroast</a>, runs their AI models locally on a patch, and clicks <strong>Publish Opinion</strong> to compare findings here and derive common ground.
          </p>
          <button type="button" class="btn btn-primary" id="goto-connect-btn">How to connect your Backoffice →</button>
        </div>
      </div>
    `
        : `
      <div class="issue-list">
        ${state.opinions
          .map(
            (o) => `
          <button type="button" class="issue-row" data-open-patch="${o.cf_id}">
            <div class="issue-top">
              <div class="issue-id-group">
                ${verdictDot(o.verdict)}
                <span class="mono issue-id">CF ${o.cf_id}</span>
                <span class="issue-status">${esc(o.created_at.slice(0, 10))}</span>
              </div>
              ${CHEVRON_SVG}
            </div>
            <div class="issue-title" style="font-size:13.5px;">${esc(o.summary || "View patch consensus & full opinion")}</div>
            <div class="issue-meta">
              ${verdictPill(o.verdict)}
              <span class="tag-micro">${esc(o.contributor_name)} (@${esc(o.contributor_handle)})</span>
              <span class="tag-micro mono">${esc(o.backend)}</span>
              <span class="tag-micro">${esc(formatOpinionProfile(o))}</span>
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

/* ---- Coordination Tab ---- */
function renderCoordinationTab(): string {
  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">Team Coordination (${state.coordination.length})</h1>
        <div class="page-sub">Opt-in public claims so reviewers don't duplicate effort (private Work Items stay local)</div>
      </div>
    </div>
    ${
      state.coordination.length === 0
        ? `<div class="card"><div class="empty-state">No shared coordination items yet. Claim a patch or bug repro from your local Personal Backoffice.</div></div>`
        : `
      <div class="issue-list">
        ${state.coordination
          .map(
            (c) => `
          <button type="button" class="issue-row" ${c.cf_id ? `data-open-patch="${c.cf_id}"` : 'style="cursor:default;"'}>
            <div class="issue-top">
              <span class="mono issue-id">${c.cf_id ? `CF ${c.cf_id}` : esc(c.bug_ref || "General")}</span>
              <span class="pill p-info">${esc(c.status)}</span>
            </div>
            <div class="issue-title">${esc(c.title)}</div>
            <div class="issue-meta">
              <span class="tag-micro">${esc(c.assignee_name)} (@${esc(c.assignee_handle)})</span>
              ${c.note ? `<span>${esc(c.note)}</span>` : ""}
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

/* ---- Backoffice & Space Guide Tab ---- */
function renderConnectTab(): string {
  const oauth = state.health?.oauth;
  const backofficeHref = getLocalBackofficeUrl();
  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">Public App ↔ Personal Backoffice</h1>
        <div class="page-sub">Everyone runs their own private backoffice locally and shares sanitized opinions here to build common ground</div>
      </div>
    </div>

    <div class="grid2" style="margin-bottom:12px;">
      <div class="space-card is-current">
        <div class="space-card-head">
          <span class="space-card-title"><span class="space-dot" style="background:var(--ok)"></span>Public App</span>
          <span class="space-badge-here">You are here</span>
        </div>
        <p class="space-card-desc">
          Hosted at <code class="mono">${esc(window.location.host)}</code>. Safe to share patch collaboration links (<code class="mono">/patch/5879</code>) with committers, authors, and teammates.
        </p>
        <ul class="muted" style="padding-left:18px;margin:0;font-size:12.5px;display:flex;flex-direction:column;gap:5px;">
          <li>Per-patch collaboration pages showing all reviewers' AI opinions &amp; consensus</li>
          <li>Interactive CommitFest briefs &amp; offline HTML/MD/JSON downloads</li>
          <li>Shared team claims so reviewers avoid duplicating effort</li>
        </ul>
      </div>

      <div class="space-card is-backoffice">
        <div class="space-card-head">
          <span class="space-card-title"><span class="space-dot" style="background:var(--warn)"></span>Personal Backoffice</span>
          <span class="space-badge-local">Private · Local</span>
        </div>
        <p class="space-card-desc">
          Installed on your own laptop from <a href="https://github.com/NikolayS/pgroast" target="_blank" rel="noopener">github.com/NikolayS/pgroast</a> and running at <code class="mono">${esc(backofficeHref.replace(/\/$/, ""))}</code>. Never exposed online.
        </p>
        <ul class="muted" style="padding-left:18px;margin:0;font-size:12.5px;display:flex;flex-direction:column;gap:5px;">
          <li>Compile Postgres, apply patches, inspect diffs, and run your preferred AI models</li>
          <li>Private Local Work Items, CommitFest cookies, and Gmail drafts</li>
          <li>Explicitly publish sanitized opinions &amp; briefs up to this Public App</li>
        </ul>
        <div class="row" style="gap:8px;margin-top:4px;">
          <a class="btn btn-primary" style="flex:1;height:38px;" href="${esc(backofficeHref)}" target="_blank" rel="noopener">Open Personal Backoffice ↗</a>
          <button type="button" class="btn btn-secondary" style="height:38px;" id="connect-copy-cmd-btn">Copy start cmd</button>
        </div>
        <div class="dim mono" style="font-size:11.5px;">Start locally: <code>bun run app:local</code></div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="card-head">
          <h3>How moving back &amp; forth works</h3>
          <span class="pill p-ok">Zero Localhost Control</span>
        </div>
        <ul class="muted" style="padding-left:18px;margin:0;font-size:12.5px;display:flex;flex-direction:column;gap:7px;">
          <li><strong>Public → Backoffice:</strong> open any patch page (<code class="mono">/patch/5879</code>) and click <strong>Work on CF 5879 in Backoffice ↗</strong> to jump straight to that patch in your local workbench.</li>
          <li><strong>Backoffice → Public:</strong> click <strong>Public App ↗</strong> in your Backoffice sidebar or Workbench header to open the shared patch page here.</li>
          <li><strong>Publishing:</strong> data only flows <strong>Backoffice → Public</strong> when you explicitly click Publish, checked by a server-side confidentiality gate.</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Publish-Only Token (Backoffice → Public)</h3>
        </div>
        <div class="sheet-actions" style="margin-bottom:12px;">
          <a class="btn btn-secondary btn-lg" href="/auth/github">Sign in with GitHub ${oauth?.githubConfigured ? "" : "(not configured)"}</a>
          <a class="btn btn-secondary btn-lg" href="/auth/google">Sign in with Google ${oauth?.googleConfigured ? "" : "(not configured)"}</a>
        </div>
        ${
          oauth?.devTokenMintEnabled
            ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;">
            <div class="muted" style="font-size:12px;margin-bottom:8px;"><strong>Local Dev Token Mint</strong> (localhost only):</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <select id="dev-prov"><option value="github">GitHub</option><option value="google">Google</option></select>
              <input id="dev-handle" type="text" placeholder="Handle (e.g. NikolayS)" />
              <input id="dev-name" type="text" placeholder="Display name" />
              <button type="button" class="btn btn-primary btn-lg" id="dev-mint-btn">Mint Publish Token</button>
            </div>
            ${
              state.mintedToken
                ? `
              <div class="sheet-callout" style="margin-top:10px;">
                <div style="font-size:12px;margin-bottom:4px;"><strong>Token for @${esc(state.mintedHandle)}</strong>:</div>
                <code class="mono" style="word-break:break-all;font-size:12px;">${esc(state.mintedToken)}</code>
              </div>
            `
                : ""
            }
          </div>
        `
            : `<div class="muted" style="font-size:12px;border-top:1px solid var(--border);padding-top:10px;">Sign in with GitHub or Google above (when OAuth is configured), or ask the hub admin to issue a team publish token via <code class="mono">bun run web:mint-token --handle &lt;you&gt;</code> and paste it in Backoffice → Settings.</div>`
        }
      </div>
    </div>
  `;
}

/* ---- Event Binding ---- */
function bindPatchRowClicks(container: HTMLElement | Document): void {
  container.querySelectorAll<HTMLElement>("[data-open-patch]").forEach((el) => {
    el.addEventListener("click", () => {
      const cfId = Number(el.dataset.openPatch);
      if (cfId > 0) void openPatchPage(cfId, true);
    });
  });
}

function bindBriefListEvents(): void {
  const brief = state.briefDetail;
  if (!brief) return;

  document.querySelectorAll<HTMLButtonElement>("[data-sl-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.shortlistFilter = (btn.dataset.slFilter as typeof state.shortlistFilter) || "all";
      const mount = document.getElementById("brief-list-mount");
      if (mount) {
        mount.innerHTML = renderBriefListHtml(brief);
        bindBriefListEvents();
      }
    });
  });

  const mount = document.getElementById("brief-list-mount");
  if (mount) bindPatchRowClicks(mount);
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>("#web-nav .nav-link, #web-bottom-nav .btab").forEach((btn) => {
    btn.classList.toggle("active", !state.activePatchId && btn.dataset.tab === state.tab);
  });

  const root = document.getElementById("web-main")!;
  if (state.activePatchId) {
    root.innerHTML = renderPatchPage();
    const cfId = state.activePatchId;
    const publicShareHref = `${window.location.origin}/patch/${cfId}`;
    const backofficeHref = getLocalBackofficeUrl(cfId);

    document.getElementById("patch-back-btn")?.addEventListener("click", () => {
      navigateToTab(state.returnTab);
    });
    document.getElementById("patch-copy-url-btn")?.addEventListener("click", (ev) => {
      copyTextWithFeedback(ev.currentTarget as HTMLElement, publicShareHref, "Copy link");
    });
    document.getElementById("patch-copy-local-cta")?.addEventListener("click", (ev) => {
      copyTextWithFeedback(ev.currentTarget as HTMLElement, backofficeHref, "Copy local link");
    });
    document.getElementById("patch-copy-local-side")?.addEventListener("click", (ev) => {
      copyTextWithFeedback(ev.currentTarget as HTMLElement, backofficeHref, "Copy local link");
    });

    // GitLab MR-style tab switching (Overview / Discussion / Changes)
    document.querySelectorAll<HTMLButtonElement>("[data-mr-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = (btn.dataset.mrTab as MrTabId) || "overview";
        state.mrTab = next;
        if (next === "discussion") {
          void loadMrDiscussion(cfId);
        } else if (next === "changes") {
          void loadMrDiff(cfId);
        }
        render();
      });
    });

    // Discussion tab controls
    document.getElementById("mr-retry-thread-btn")?.addEventListener("click", () => {
      state.mrDiscussion = null;
      state.mrDiscussionError = "";
      void loadMrDiscussion(cfId);
    });
    document.getElementById("mr-jump-latest-btn")?.addEventListener("click", () => {
      const msgs = document.querySelectorAll("#mr-timeline .mr-msg");
      msgs[msgs.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("mr-toggle-quotes-btn")?.addEventListener("click", (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      const folds = Array.from(document.querySelectorAll<HTMLDetailsElement>("#mr-timeline details.mr-quote-fold"));
      const anyClosed = folds.some((d) => !d.open);
      folds.forEach((d) => {
        d.open = anyClosed;
      });
      btn.textContent = anyClosed ? "Collapse long quotes" : "Expand long quotes";
    });
    document.querySelectorAll<HTMLButtonElement>("[data-mr-author]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.mrAuthorFilter = btn.dataset.mrAuthor || "all";
        render();
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-jump-msg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.mrAuthorFilter !== "all") {
          state.mrAuthorFilter = "all";
          render();
        }
        document.getElementById(`mr-msg-${btn.dataset.jumpMsg}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    // Changes tab controls
    document.getElementById("mr-retry-diff-btn")?.addEventListener("click", () => {
      state.mrDiff = null;
      state.mrDiffError = "";
      void loadMrDiff(cfId);
    });
    document.getElementById("mr-diff-commented-btn")?.addEventListener("click", () => {
      state.mrDiffOnlyCommented = !state.mrDiffOnlyCommented;
      render();
    });
    document.getElementById("mr-toggle-files-btn")?.addEventListener("click", (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      const files = Array.from(document.querySelectorAll<HTMLDetailsElement>("#mr-diff-files details.diff-file"));
      const anyOpen = files.some((d) => d.open);
      files.forEach((d) => {
        d.open = !anyOpen;
      });
      btn.textContent = anyOpen ? "Expand all" : "Collapse all";
    });
    document.querySelectorAll<HTMLButtonElement>("[data-jump-diff-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.jumpDiffFile;
        const el = document.getElementById(`diff-file-${idx}`) as HTMLDetailsElement | null;
        if (el) {
          el.open = true;
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    document.querySelectorAll<HTMLElement>("[data-viewed-wrap]").forEach((lbl) => {
      lbl.addEventListener("click", (ev) => ev.stopPropagation());
    });
    document.querySelectorAll<HTMLInputElement>("[data-mark-viewed]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const fp = cb.dataset.markViewed || "";
        if (!fp) return;
        if (cb.checked) state.mrViewedFiles.add(fp);
        else state.mrViewedFiles.delete(fp);
        render();
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-open-disc-msg]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msgIdx = btn.dataset.openDiscMsg;
        state.mrTab = "discussion";
        state.mrAuthorFilter = "all";
        if (!state.mrDiscussion && !state.mrDiscussionLoading) {
          await loadMrDiscussion(cfId);
        } else {
          render();
        }
        setTimeout(() => {
          document.getElementById(`mr-msg-${msgIdx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      });
    });
    return;
  }

  if (state.tab === "brief") root.innerHTML = renderBriefTab();
  else if (state.tab === "stats") root.innerHTML = renderStatsTab();
  else if (state.tab === "entries") root.innerHTML = renderEntriesTab();
  else if (state.tab === "opinions") root.innerHTML = renderOpinionsTab();
  else if (state.tab === "coordination") root.innerHTML = renderCoordinationTab();
  else root.innerHTML = renderConnectTab();

  // Stats tab events
  if (state.tab === "stats") {
    document.getElementById("stats-goto-opinions")?.addEventListener("click", () => navigateToTab("opinions"));
    document.querySelectorAll<HTMLElement>("[data-stats-status]").forEach((el) => {
      el.addEventListener("click", () => {
        jumpToEntries({ status: el.dataset.statsStatus || "all", verdict: "all", search: "" });
      });
    });
    document.querySelectorAll<HTMLElement>("[data-stats-topic]").forEach((el) => {
      el.addEventListener("click", () => {
        jumpToEntries({ search: el.dataset.statsTopic || "", verdict: "all", status: "all" });
      });
    });
    document.querySelectorAll<HTMLElement>("[data-stats-person]").forEach((el) => {
      el.addEventListener("click", () => {
        jumpToEntries({ search: el.dataset.statsPerson || "", verdict: "all", status: "all" });
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-lb-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.statsLbTab = (btn.dataset.lbTab as typeof state.statsLbTab) || "authors";
        render();
      });
    });
  }

  // Shared row links (Opinions / Coordination)
  if (state.tab === "opinions" || state.tab === "coordination") {
    bindPatchRowClicks(root);
  }

  // Brief tab events
  document.getElementById("goto-connect-btn")?.addEventListener("click", () => {
    navigateToTab("connect");
  });
  document.getElementById("intro-setup-btn")?.addEventListener("click", () => {
    navigateToTab("connect");
  });
  document.getElementById("intro-opinions-btn")?.addEventListener("click", () => {
    navigateToTab("opinions");
  });
  document.getElementById("intro-toggle-btn")?.addEventListener("click", () => {
    state.introCollapsed = !state.introCollapsed;
    try {
      localStorage.setItem("pgroast-web-intro-collapsed", state.introCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
    render();
  });

  const exportBtn = document.getElementById("export-toggle-btn");
  const exportMenu = document.getElementById("export-menu");
  exportBtn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!exportMenu) return;
    const open = exportMenu.hidden;
    exportMenu.hidden = !open;
    exportBtn.setAttribute("aria-expanded", String(open));
  });

  document.getElementById("brief-select")?.addEventListener("change", async (ev) => {
    state.selectedBriefSlug = (ev.target as HTMLSelectElement).value;
    await loadBriefDetail(state.selectedBriefSlug);
    if (state.briefDetail?.entries?.length) state.entries = state.briefDetail.entries;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-brief-seg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.briefSegment = (btn.dataset.briefSeg as "shortlist" | "closing") || "shortlist";
      document.querySelectorAll<HTMLButtonElement>("[data-brief-seg]").forEach((b) => {
        b.classList.toggle("active", b.dataset.briefSeg === state.briefSegment);
      });
      const mount = document.getElementById("brief-list-mount");
      if (mount && state.briefDetail) {
        mount.innerHTML = renderBriefListHtml(state.briefDetail);
        bindBriefListEvents();
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-jump-verdict]").forEach((el) => {
    el.addEventListener("click", () => {
      jumpToEntries({ verdict: el.dataset.jumpVerdict || "all", status: "all" });
    });
  });

  document.querySelectorAll<HTMLElement>("[data-toggle-seg]").forEach((el) => {
    el.addEventListener("click", () => {
      state.briefSegment = state.briefSegment === "shortlist" ? "closing" : "shortlist";
      render();
      document.getElementById("brief-list-mount")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll<HTMLElement>("[data-mx-status]").forEach((td) => {
    td.addEventListener("click", () => {
      jumpToEntries({
        status: td.dataset.mxStatus || "all",
        verdict: td.dataset.mxVerdict || "all",
        search: "",
      });
    });
  });

  if (state.tab === "brief") bindBriefListEvents();

  // Entries tab events (DOM-only updates so iOS keyboard stays open & steady!)
  if (state.tab === "entries") {
    const searchInput = document.getElementById("pub-entry-search") as HTMLInputElement | null;
    searchInput?.addEventListener("input", () => {
      state.entrySearch = searchInput.value;
      state.entryLimit = 60;
      updateEntriesListOnly();
    });
    document.getElementById("search-clear-btn")?.addEventListener("click", () => {
      state.entrySearch = "";
      state.entryLimit = 60;
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      updateEntriesListOnly();
    });
    document.querySelectorAll<HTMLButtonElement>("[data-entry-verdict]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.entryVerdict = btn.dataset.entryVerdict || "all";
        state.entryLimit = 60;
        document.querySelectorAll<HTMLButtonElement>("[data-entry-verdict]").forEach((b) => {
          b.classList.toggle("active", b.dataset.entryVerdict === state.entryVerdict);
        });
        updateEntriesListOnly();
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-entry-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.entryStatus = btn.dataset.entryStatus || "all";
        state.entryLimit = 60;
        document.querySelectorAll<HTMLButtonElement>("[data-entry-status]").forEach((b) => {
          b.classList.toggle("active", (b.dataset.entryStatus || "").toLowerCase() === state.entryStatus.toLowerCase());
        });
        updateEntriesListOnly();
      });
    });
    const mount = document.getElementById("entries-list-mount");
    if (mount) {
      bindPatchRowClicks(mount);
      mount.querySelector("#entries-load-more")?.addEventListener("click", () => {
        state.entryLimit += 80;
        updateEntriesListOnly();
      });
    }
  }

  // Connect / Backoffice tab events
  document.getElementById("connect-copy-cmd-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, "bun run app:local", "Copy start cmd");
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

/* ---- Global Shell Listeners ---- */
document.querySelectorAll<HTMLButtonElement>("#web-nav .nav-link, #web-bottom-nav .btab").forEach((btn) => {
  btn.addEventListener("click", () => {
    navigateToTab((btn.dataset.tab as TabId) || "brief");
  });
});

document.getElementById("web-home-btn")?.addEventListener("click", () => {
  navigateToTab("brief");
});

document.getElementById("web-space-btn")?.addEventListener("click", () => {
  openSpaceSwitcher();
});

document.getElementById("space-close-btn")?.addEventListener("click", closeSpaceSwitcher);
document.getElementById("space-backdrop")?.addEventListener("click", (ev) => {
  if (ev.target === ev.currentTarget) closeSpaceSwitcher();
});

document.getElementById("web-quick-search-btn")?.addEventListener("click", () => {
  jumpToEntries({ focusSearch: true });
});

const WEB_THEMES: Array<{ id: string; label: string; bg: string; accent: string }> = [
  { id: "dark", label: "Midnight", bg: "#0b0c0e", accent: "#5e6ad2" },
  { id: "light", label: "Daylight", bg: "#ffffff", accent: "#5e6ad2" },
  { id: "paper", label: "Warm Paper", bg: "#f7f3ea", accent: "#9a4a1c" },
  { id: "espresso", label: "Espresso", bg: "#14100d", accent: "#c97842" },
  { id: "nord", label: "Nord", bg: "#2e3440", accent: "#88c0d0" },
  { id: "tokyo", label: "Tokyo Night", bg: "#1a1b26", accent: "#7aa2f7" },
  { id: "postgres", label: "Postgres Classic", bg: "#f6f9fc", accent: "#336791" },
  { id: "contrast", label: "High Contrast", bg: "#000000", accent: "#6cb6ff" },
];
const validWebThemeIds = new Set(WEB_THEMES.map((t) => t.id));

function applyWebTheme(themeId: string, persist = true): void {
  const id = validWebThemeIds.has(themeId) ? themeId : "dark";
  document.documentElement.setAttribute("data-theme", id);
  const meta = document.getElementById("meta-theme-color");
  const info = WEB_THEMES.find((t) => t.id === id);
  if (meta && info) meta.setAttribute("content", info.bg);
  if (persist) {
    try {
      localStorage.setItem("pgroast-web-theme", id);
    } catch {
      // ignore private browsing storage errors
    }
  }
  const menu = document.getElementById("web-theme-menu");
  if (menu) {
    menu.innerHTML =
      `<div class="theme-menu-head">Theme</div>` +
      WEB_THEMES.map(
        (t) => `
        <button type="button" class="theme-opt ${t.id === id ? "active" : ""}" role="menuitemradio" aria-checked="${t.id === id}" data-pick-theme="${t.id}">
          <span class="theme-swatch" style="background:${t.bg};"><span class="theme-swatch-accent" style="background:${t.accent};"></span></span>
          <span>${esc(t.label)}</span>
          ${t.id === id ? `<span class="theme-check">✓</span>` : ""}
        </button>
      `,
      ).join("");
  }
}

function closeThemeMenu(): void {
  const menu = document.getElementById("web-theme-menu");
  const btn = document.getElementById("web-theme-btn");
  if (menu && !menu.hidden) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

document.getElementById("web-theme-btn")?.addEventListener("click", (ev) => {
  ev.stopPropagation();
  const menu = document.getElementById("web-theme-menu");
  const btn = document.getElementById("web-theme-btn");
  if (!menu) return;
  const opening = menu.hidden;
  menu.hidden = !opening;
  btn?.setAttribute("aria-expanded", String(opening));
});

document.getElementById("web-theme-menu")?.addEventListener("click", (ev) => {
  ev.stopPropagation();
  const pick = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-pick-theme]");
  if (!pick?.dataset.pickTheme) return;
  applyWebTheme(pick.dataset.pickTheme, true);
  closeThemeMenu();
});

// Close dropdown menus when clicking outside
document.addEventListener("click", () => {
  const exportMenu = document.getElementById("export-menu");
  if (exportMenu && !exportMenu.hidden) exportMenu.hidden = true;
  closeThemeMenu();
});

// Browser / iPhone Back-swipe navigation
window.addEventListener("popstate", () => {
  const route = parseRouteFromLocation();
  if (route.patchId) {
    void openPatchPage(route.patchId, false);
  } else {
    state.activePatchId = null;
    state.patchData = null;
    state.tab = route.tab;
    syncTopBackofficeLink();
    document.title = "pgroast — Public CommitFest App";
    render();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    closeSpaceSwitcher();
    closeThemeMenu();
  }
});

// Restore saved or system theme on load
try {
  const saved = localStorage.getItem("pgroast-web-theme");
  if (saved && validWebThemeIds.has(saved)) {
    applyWebTheme(saved, false);
  } else if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    applyWebTheme("light", false);
  } else {
    applyWebTheme("dark", false);
  }
} catch {
  applyWebTheme("dark", false);
}

void loadAll();
