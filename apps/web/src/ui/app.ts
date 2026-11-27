import { renderAboutTab } from "./about-view.ts";
import {
  API_ENDPOINTS,
  buildApiCodeSnippet,
  buildEndpointPath,
  type ApiLang,
} from "./api-docs-view.ts";
import {
  buildQuotaAgentPrompt,
  renderContributeTab,
  type CommunityCoverageData,
  type QuotaPreviewResult,
} from "./contribute-view.ts";
import {
  filterDocsFeatures,
  renderDocsFeatureCards,
  renderDocsTab,
  type DocsCategory,
} from "./docs-view.ts";
import {
  renderHackerDirectoryCards,
  renderHackerProfilePage,
  renderHackersTab,
  type HackerLbKind,
  type HackerListItem,
  type HackerProfileData,
  type HackerProfileTab,
  type HackersOverviewData,
  type HackerWindow,
} from "./hackers-view.ts";

import type { StatsOverviewData } from "../stats-queries.ts";
import {
  renderListMessagesRows,
  renderListsTab,
  type MailingListMessageItem,
  type MailingListsOverviewData,
} from "./lists-view.ts";
import {
  renderStatsObservatory,
  type StatsDarkFilter,
  type StatsQueueFilter,
} from "./stats-view.ts";
import { initVizInteractions } from "./viz-engine.ts";

type TabId = "brief" | "hackers" | "lists" | "stats" | "entries" | "opinions" | "coordination" | "connect" | "contribute" | "docs" | "about";
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
  isThreadStarter?: boolean;
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
  participants: Array<{ name: string; count: number; isAuthor: boolean; isThreadStarter?: boolean }>;
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

interface PageViewsInfo {
  total: number;
  last24h: number;
  last7d: number;
  topPatches: Array<{ cf_id: number; hits: number }>;
  topReferrers: Array<{ ref_host: string; hits: number }>;
}

interface HealthInfo {
  version?: string;
  database: { version: string; database: string };
  counts: { briefs: number; entries: number; opinions: number };
  views?: { total: number; last24h: number; last7d: number };
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
  entry_title?: string;
  entry_status?: string;
  entry_authors?: string;
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
  status: "unanimous" | "single_opinion" | "majority" | "split" | "baseline_only";
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
  activeHackerSlug: null as string | null,
  hackerProfile: null as HackerProfileData | null,
  hackerProfileLoading: false,
  hackerProfileError: "",
  hackerProfileTab: "commits" as HackerProfileTab,
  hackersOverview: null as HackersOverviewData | null,
  hackersLoading: false,
  hackersError: "",
  hackersWindow: "1y" as HackerWindow,
  hackersLbTab: "committers" as HackerLbKind,
  hackersDirectory: [] as HackerListItem[],
  hackersDirSearch: "",
  hackersDirRole: "all",
  hackersDirSort: "activity",
  docsCoverage: null as CommunityCoverageData | null,
  docsCoverageLoading: false,
  docsCategory: "all" as DocsCategory,
  docsSearch: "",
  apiEndpointId: "health",
  apiLang: "curl" as ApiLang,
  apiParams: {} as Record<string, string>,
  apiLiveStatus: "",
  apiLiveOk: null as boolean | null,
  apiLiveMeta: "",
  apiLiveBody: "",
  apiLiveLoading: false,
  quotaPreviewBackend: "claude",
  quotaPreviewStrategy: "unroasted-first",
  quotaPreviewFlavour: "auto-by-subsystem",
  quotaPreviewLevel: "medium",
  quotaPreviewLoading: false,
  quotaPreviewError: "",
  quotaPreviewResult: null as QuotaPreviewResult | null,
  listsOverview: null as MailingListsOverviewData | null,
  listsLoading: false,
  listsError: "",
  listsSelected: "all",
  listsSearch: "",
  listsAttachmentsOnly: false,
  listsMessages: [] as MailingListMessageItem[],
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
  mrOpenFiles: new Set<string>(),
  mrInitializedOpenFiles: false,
  statsLbTab: "authors" as "authors" | "reviewers" | "committers",
  statsOverview: null as StatsOverviewData | null,
  statsLoading: false,
  statsError: "",
  statsQueueFilter: "all" as StatsQueueFilter,
  statsDarkFilter: "all" as StatsDarkFilter,
  health: null as HealthInfo | null,
  views: null as PageViewsInfo | null,
  briefs: [] as BriefSummary[],
  selectedBriefSlug: "latest",
  briefDetail: null as BriefDetail | null,
  briefSegment: "shortlist" as "shortlist" | "closing",
  shortlistFilter: "all" as "all" | "bugfix" | "feature" | "prod",
  opinions: [] as OpinionItem[],
  opSearch: "",
  opLevel: "all" as "all" | "dark" | "medium" | "light",
  opVerdict: "all",
  opModel: "all",
  opSort: "newest" as "newest" | "depth" | "critical" | "cf_desc",
  opPage: 1,
  opPageSize: 25,
  entries: [] as EntryItem[],
  entrySearch: "",
  entryVerdict: "all",
  entryStatus: "all",
  entryLimit: 60,
  coordination: [] as CoordItem[],
  mintedToken: "",
  mintedHandle: "",
  devMintError: "",
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
  UNROASTED: { label: "Not roasted", short: "Not roasted", color: "#737682", pillClass: "" },
};

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
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    // invalid URL
  }
  return "";
}

function safeInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getVerdictMeta(v: string) {
  return VERDICT_META[v || "UNROASTED"] ?? { label: v || "Not roasted", short: v || "Not roasted", color: "#737682", pillClass: "" };
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
  const mergedHeaders = { "Content-Type": "application/json", ...(init?.headers || {}) };
  const res = await fetch(url, { ...init, headers: mergedHeaders });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function getLocalBackofficeUrl(cfId?: number | null): string {
  const base = (safeHttpUrl(state.health?.localWorkbenchUrl) || "http://127.0.0.1:3432").replace(/\/$/, "");
  return cfId && cfId > 0 ? `${base}/?cf=${cfId}` : `${base}/`;
}

function syncTopBackofficeLink(): void {
  // Topbar button opens the Backoffice Setup tab so first-time visitors never hit a dead localhost link.
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

function parseRouteFromLocation(): { patchId: number | null; hackerSlug: string | null; tab: TabId; mrTab: MrTabId; hash: string } {
  const u = new URL(window.location.href);
  const pathMatch = u.pathname.match(/^\/patch\/(\d+)\/?$/);
  const cfParam = Number(pathMatch?.[1] || u.searchParams.get("cf") || 0);
  const viewParam = u.searchParams.get("view");
  const mrTab: MrTabId = viewParam === "discussion" || viewParam === "changes" ? viewParam : "overview";
  if (cfParam > 0) return { patchId: cfParam, hackerSlug: null, tab: state.tab, mrTab, hash: u.hash };
  const hackerMatch = u.pathname.match(/^\/hacker\/([a-z0-9-]+)\/?$/i);
  if (hackerMatch?.[1]) {
    return { patchId: null, hackerSlug: hackerMatch[1].toLowerCase(), tab: "hackers", mrTab: "overview", hash: u.hash };
  }
  if (/^\/docs\/?$/i.test(u.pathname)) {
    return { patchId: null, hackerSlug: null, tab: "docs", mrTab: "overview", hash: u.hash };
  }
  if (/^\/contribute\/?$/i.test(u.pathname)) {
    return { patchId: null, hackerSlug: null, tab: "contribute", mrTab: "overview", hash: u.hash };
  }
  if (/^\/lists\/?$/i.test(u.pathname)) {
    return { patchId: null, hackerSlug: null, tab: "lists", mrTab: "overview", hash: u.hash };
  }
  if (/^\/about\/?$/i.test(u.pathname)) {
    return { patchId: null, hackerSlug: null, tab: "about", mrTab: "overview", hash: u.hash };
  }
  const tabParam = u.searchParams.get("tab") as TabId | null;
  const validTabs: TabId[] = ["brief", "hackers", "lists", "stats", "entries", "opinions", "coordination", "connect", "contribute", "docs", "about"];
  return {
    patchId: null,
    hackerSlug: null,
    tab: tabParam && validTabs.includes(tabParam) ? tabParam : "brief",
    mrTab: "overview",
    hash: u.hash,
  };
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
    state.mrOpenFiles = new Set<string>();
    data.files.forEach((f, idx) => {
      const fp = f.newPath || f.oldPath;
      const hasComments =
        f.hunks.some((h) => h.lines.some((l) => (l.comments?.length || 0) > 0)) || (f.mentions?.length || 0) > 0;
      if (!state.mrViewedFiles.has(fp) && (idx < 5 || hasComments)) {
        state.mrOpenFiles.add(fp);
      }
    });
    state.mrInitializedOpenFiles = true;
    render();
  } catch (err) {
    if (state.activePatchId !== cfId) return;
    state.mrDiffLoading = false;
    state.mrDiffError = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function openPatchPage(cfId: number, pushHistory = true, initialMrTab: MrTabId = "overview"): Promise<void> {
  if (!state.activePatchId && !state.activeHackerSlug) state.returnTab = state.tab;
  state.activeHackerSlug = null;
  state.hackerProfile = null;
  state.hackerProfileLoading = false;
  state.activePatchId = cfId;
  state.mrTab = initialMrTab;
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
  state.mrOpenFiles = new Set<string>();
  state.mrInitializedOpenFiles = false;
  syncTopBackofficeLink();

  if (pushHistory) {
    try {
      const qs = initialMrTab === "overview" ? "" : `?view=${encodeURIComponent(initialMrTab)}`;
      window.history.pushState({ patchId: cfId, tab: state.returnTab, mrTab: initialMrTab }, "", `/patch/${cfId}${qs}`);
    } catch {
      // ignore
    }
  }
  render();
  window.scrollTo({ top: 0 });

  if (initialMrTab === "discussion") void loadMrDiscussion(cfId);
  else if (initialMrTab === "changes") void loadMrDiff(cfId);

  try {
    const data = await api<PatchPageData>(`/api/v1/entries/${cfId}`, {
      headers: pushHistory ? { "X-PgRoast-View": "1" } : undefined,
    });
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

let hackerDirTimer: ReturnType<typeof setTimeout> | null = null;

async function loadHackersOverview(win?: HackerWindow): Promise<void> {
  if (win) state.hackersWindow = win;
  const reqWin = state.hackersWindow;
  state.hackersLoading = true;
  state.hackersError = "";
  render();
  try {
    const data = await api<HackersOverviewData>(`/api/v1/hackers/overview?window=${encodeURIComponent(reqWin)}`);
    if (state.hackersWindow !== reqWin) return;
    state.hackersOverview = data;
    state.hackersLoading = false;
    render();
  } catch (err) {
    if (state.hackersWindow !== reqWin) return;
    state.hackersLoading = false;
    state.hackersError = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function loadHackersDirectory(updateDomOnly = false): Promise<void> {
  const qs = new URLSearchParams();
  if (state.hackersDirSearch.trim()) qs.set("search", state.hackersDirSearch.trim());
  if (state.hackersDirRole && state.hackersDirRole !== "all") qs.set("role", state.hackersDirRole);
  if (state.hackersDirSort) qs.set("sort", state.hackersDirSort);
  qs.set("limit", "60");
  try {
    const data = await api<{ hackers: HackerListItem[] }>(`/api/v1/hackers?${qs.toString()}`);
    state.hackersDirectory = data.hackers;
    if (updateDomOnly) {
      const mount = document.getElementById("hacker-dir-mount");
      if (mount) {
        mount.innerHTML = renderHackerDirectoryCards(state.hackersDirectory);
        bindHackerClicks(mount);
        return;
      }
    }
    if (state.tab === "hackers" && !state.activeHackerSlug && !state.activePatchId) {
      render();
    }
  } catch {
    // keep previous directory list on transient error
  }
}

async function openHackerProfile(slug: string, pushHistory = true, year?: number): Promise<void> {
  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) return;
  const switchingPerson = state.activeHackerSlug !== cleanSlug;
  if (!state.activeHackerSlug && !state.activePatchId) state.returnTab = state.tab;
  state.activePatchId = null;
  state.patchData = null;
  state.activeHackerSlug = cleanSlug;
  state.hackerProfileLoading = true;
  state.hackerProfileError = "";
  if (switchingPerson) {
    state.hackerProfile = null;
    state.hackerProfileTab = "commits";
  }

  if (pushHistory && switchingPerson) {
    try {
      window.history.pushState({ hackerSlug: cleanSlug, tab: state.returnTab }, "", `/hacker/${encodeURIComponent(cleanSlug)}`);
    } catch {
      // ignore
    }
  }
  render();
  if (switchingPerson) window.scrollTo({ top: 0 });

  try {
    const qs = year ? `?year=${encodeURIComponent(String(year))}` : "";
    const data = await api<HackerProfileData>(`/api/v1/hackers/${encodeURIComponent(cleanSlug)}${qs}`, {
      headers: pushHistory && switchingPerson ? { "X-PgRoast-View": "1" } : undefined,
    });
    if (state.activeHackerSlug !== cleanSlug) return;
    state.hackerProfile = data;
    state.hackerProfileLoading = false;
    document.title = `${data.person.name} — PostgreSQL Hacker Profile | pgroast`;
    render();
  } catch (err) {
    if (state.activeHackerSlug !== cleanSlug) return;
    state.hackerProfileLoading = false;
    state.hackerProfileError = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function openHackerByName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const res = await api<{ slug: string | null }>(`/api/v1/hackers/resolve?name=${encodeURIComponent(trimmed)}`);
    if (res.slug) {
      await openHackerProfile(res.slug, true);
      return;
    }
  } catch {
    // fallback to entries search below
  }
  jumpToEntries({ search: trimmed, verdict: "all", status: "all" });
}

async function loadDocsCoverage(force = false): Promise<void> {
  if (state.docsCoverageLoading) return;
  if (state.docsCoverage && !force) return;
  state.docsCoverageLoading = true;
  if (state.tab === "contribute") render();
  try {
    state.docsCoverage = await api<CommunityCoverageData>("/api/v1/contribute/status");
  } catch {
    // ignore transient errors
  } finally {
    state.docsCoverageLoading = false;
    if (state.tab === "contribute" && !state.activePatchId && !state.activeHackerSlug) render();
  }
}

async function loadStatsOverview(force = false): Promise<void> {
  if (state.statsLoading) return;
  if (state.statsOverview && !force) return;
  state.statsLoading = true;
  state.statsError = "";
  if (state.tab === "stats" && !state.activePatchId && !state.activeHackerSlug) render();
  try {
    state.statsOverview = await api<StatsOverviewData>("/api/v1/stats/overview");
  } catch (err) {
    state.statsError = err instanceof Error ? err.message : String(err);
  } finally {
    state.statsLoading = false;
    if (state.tab === "stats" && !state.activePatchId && !state.activeHackerSlug) render();
  }
}

async function runQuotaPreview(): Promise<void> {
  state.quotaPreviewLoading = true;
  state.quotaPreviewError = "";
  render();
  try {
    const qs = new URLSearchParams({
      backend: state.quotaPreviewBackend,
      strategy: state.quotaPreviewStrategy,
      flavour: state.quotaPreviewFlavour,
      level: state.quotaPreviewLevel,
      dry_run: "1",
    });
    const res = await api<QuotaPreviewResult & { coverage?: CommunityCoverageData }>(`/api/v1/contribute/next?${qs.toString()}`);
    state.quotaPreviewResult = {
      patch: res.patch,
      suggestedFlavour: res.suggestedFlavour,
      suggestedLevel: res.suggestedLevel,
      reason: res.reason,
      leaseExpiresAt: res.leaseExpiresAt,
    };
    if (res.coverage) state.docsCoverage = res.coverage;
  } catch (err) {
    state.quotaPreviewError = err instanceof Error ? err.message : String(err);
  } finally {
    state.quotaPreviewLoading = false;
    render();
  }
}

let listsSearchTimer: ReturnType<typeof setTimeout> | null = null;

async function loadListsOverview(): Promise<void> {
  if (state.listsLoading) return;
  state.listsLoading = true;
  state.listsError = "";
  if (state.tab === "lists") render();
  try {
    state.listsOverview = await api<MailingListsOverviewData>("/api/v1/lists/overview");
  } catch (err) {
    state.listsError = err instanceof Error ? err.message : String(err);
  } finally {
    state.listsLoading = false;
    if (state.tab === "lists" && !state.activePatchId && !state.activeHackerSlug) render();
  }
}

async function loadListsMessages(updateDomOnly = false): Promise<void> {
  const qs = new URLSearchParams({ limit: "60" });
  if (state.listsSelected && state.listsSelected !== "all") qs.set("list", state.listsSelected);
  if (state.listsSearch.trim()) qs.set("search", state.listsSearch.trim());
  if (state.listsAttachmentsOnly) qs.set("attachments", "1");
  try {
    const res = await api<{ messages: MailingListMessageItem[] }>(`/api/v1/lists/messages?${qs.toString()}`);
    state.listsMessages = res.messages;
    if (updateDomOnly) {
      const mount = document.getElementById("lists-messages-mount");
      if (mount) {
        mount.innerHTML = renderListMessagesRows(state.listsMessages);
        bindHackerClicks(mount);
        return;
      }
    }
    if (state.tab === "lists" && !state.activePatchId && !state.activeHackerSlug) render();
  } catch {
    // keep previous list on transient error
  }
}

function navigateToTab(tab: TabId, pushHistory = true, hash = ""): void {
  state.activePatchId = null;
  state.patchData = null;
  state.patchLoading = false;
  state.activeHackerSlug = null;
  state.hackerProfile = null;
  state.hackerProfileLoading = false;
  state.tab = tab;
  syncTopBackofficeLink();
  document.title =
    tab === "hackers"
      ? "PostgreSQL Hacking Observatory — pgroast"
      : tab === "lists"
        ? "PostgreSQL Mailing Lists Archive — pgroast"
        : tab === "contribute"
          ? "Weekly Quota Auto-Contribute — pgroast"
          : tab === "docs"
            ? "Docs & Complete Feature Catalog — pgroast"
            : tab === "about"
              ? "About pgroast — What Roasting PostgreSQL Patches Means"
              : "pgroast — Public CommitFest App";
  if (pushHistory) {
    try {
      const targetUrl =
        (tab === "brief"
          ? "/"
          : tab === "docs"
            ? "/docs"
            : tab === "contribute"
              ? "/contribute"
              : tab === "lists"
                ? "/lists"
                : tab === "about"
                  ? "/about"
                  : `/?tab=${encodeURIComponent(tab)}`) + hash;
      window.history.pushState({ patchId: null, hackerSlug: null, tab }, "", targetUrl);
    } catch {
      // ignore
    }
  }
  render();
  if (tab === "hackers") {
    if (!state.hackersOverview && !state.hackersLoading) void loadHackersOverview();
    if (state.hackersDirectory.length === 0) void loadHackersDirectory();
  } else if (tab === "lists") {
    if (!state.listsOverview && !state.listsLoading) void loadListsOverview();
    if (state.listsMessages.length === 0) void loadListsMessages();
  } else if (tab === "contribute") {
    void loadDocsCoverage();
  } else if (tab === "stats") {
    void loadStatsOverview();
  }
  if (hash) {
    const id = hash.replace(/^#/, "");
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  } else {
    window.scrollTo({ top: 0 });
  }
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

    // On direct /patch/:id or /hacker/:slug visits, start fetching details immediately in parallel so first paint is instant!
    const patchPromise = route.patchId ? openPatchPage(route.patchId, false, route.mrTab) : null;
    const hackerPromise = route.hackerSlug ? openHackerProfile(route.hackerSlug, false) : null;
    if (!route.patchId && !route.hackerSlug && route.tab === "hackers") {
      void loadHackersOverview();
      void loadHackersDirectory();
    } else if (!route.patchId && !route.hackerSlug && route.tab === "lists") {
      void loadListsOverview();
      void loadListsMessages();
    } else if (!route.patchId && !route.hackerSlug && route.tab === "contribute") {
      void loadDocsCoverage();
    } else if (!route.patchId && !route.hackerSlug && route.tab === "stats") {
      void loadStatsOverview();
    }

    const [health, views, bRes, oRes, cRes] = await Promise.all([
      api<HealthInfo>("/api/v1/health"),
      api<PageViewsInfo>("/api/v1/views").catch(() => null),
      api<{ briefs: BriefSummary[] }>("/api/v1/briefs"),
      api<{ opinions: OpinionItem[] }>("/api/v1/opinions?limit=1000"),
      api<{ items: CoordItem[] }>("/api/v1/coordination"),
    ]);
    state.health = health;
    state.views = views;
    state.briefs = bRes.briefs;
    state.opinions = oRes.opinions;
    state.coordination = cRes.items;

    if (bRes.briefs[0]) {
      if (state.selectedBriefSlug === "latest") state.selectedBriefSlug = bRes.briefs[0].slug;
      await loadBriefDetail(state.selectedBriefSlug);
      // Avoid downloading all entries twice: reuse entries already inside the published brief!
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

    // Overlay live community opinion verdicts (Dark > Medium > Light) onto entries so Entries stays in sync with live opinions!
    if (state.opinions.length > 0 && state.entries.length > 0) {
      const lvRank: Record<string, number> = { dark: 3, medium: 2, light: 1 };
      const bestByCf = new Map<number, OpinionItem>();
      for (const op of state.opinions) {
        const prev = bestByCf.get(op.cf_id);
        const rCur = lvRank[(op.roast_level || "light").toLowerCase()] || 0;
        const rPrev = prev ? lvRank[(prev.roast_level || "light").toLowerCase()] || 0 : -1;
        if (!prev || rCur > rPrev || (rCur === rPrev && op.created_at > prev.created_at)) {
          bestByCf.set(op.cf_id, op);
        }
      }
      state.entries = state.entries.map((e) => {
        const best = bestByCf.get(e.cf_id);
        return best && best.verdict ? { ...e, verdict: best.verdict } : e;
      });
    }

    const f = document.getElementById("footer-db-info");
    if (f) {
      const ver = health.version ? `v${health.version}` : "";
      const verLink = ver
        ? `<a class="footer-ver mono" href="https://github.com/NikolayS/pgroast/releases/tag/${encodeURIComponent(ver)}" target="_blank" rel="noopener">${esc(ver)}</a> · `
        : "";
      const viewTotal = safeInt(views?.total ?? health.views?.total ?? 0);
      const viewsPart = ` · <a class="footer-ver" href="/?tab=stats#site-traffic" id="footer-views-link">${viewTotal} view${viewTotal === 1 ? "" : "s"}</a>`;
      f.innerHTML = `${verLink}${esc(health.database.version || "PostgreSQL")} · ${safeInt(health.counts.entries)} entries · ${safeInt(health.counts.opinions)} opinions${viewsPart}`;
      document.getElementById("footer-views-link")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        navigateToTab("stats", true, "#site-traffic");
      });
    }
    syncTopBackofficeLink();

    if (patchPromise) {
      await patchPromise;
      render();
    } else if (hackerPromise) {
      await hackerPromise;
      render();
    } else {
      render();
      if (route.hash) {
        const id = route.hash.replace(/^#/, "");
        setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
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
        <button type="button" class="btn btn-primary" style="flex:1;" id="space-goto-setup-btn">Set up Backoffice →</button>
        <a class="btn btn-secondary" href="${esc(backofficeHref)}" target="_blank" rel="noopener" title="Already running bun run app:local on your machine?">
          ${cfId ? `Open CF ${cfId} locally ↗` : "Open local ↗"}
        </a>
        <button type="button" class="btn btn-ghost" id="space-copy-local-btn">Copy</button>
      </div>
      ${
        isMobile
          ? `<div class="dim" style="font-size:11.5px;line-height:1.4;">On mobile? Tap <strong>Copy</strong> to open <code class="mono">${esc(backofficeHref)}</code> on your laptop where <code class="mono">bun run app:local</code> is running.</div>`
          : `<div class="dim" style="font-size:11.5px;line-height:1.4;">Already running <code class="mono">bun run app:local</code>? Use <strong>Open local ↗</strong>. First time? Click <strong>Set up Backoffice →</strong>.</div>`
      }
    </div>

    <div class="row" style="gap:8px;">
      <button type="button" class="btn btn-ghost" id="space-goto-docs-btn" style="flex:1;">
        Docs &amp; All Features →
      </button>
      <button type="button" class="btn btn-ghost" id="space-goto-team-btn" style="flex:1;">
        Team (${state.coordination.length}) →
      </button>
    </div>
  `;

  body.querySelector<HTMLElement>("#space-copy-local-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, backofficeHref, "Copy");
  });
  body.querySelector("#space-goto-setup-btn")?.addEventListener("click", () => {
    closeSpaceSwitcher();
    navigateToTab("connect");
  });
  body.querySelector("#space-goto-docs-btn")?.addEventListener("click", () => {
    closeSpaceSwitcher();
    navigateToTab("docs");
  });
  body.querySelector("#space-goto-team-btn")?.addEventListener("click", () => {
    closeSpaceSwitcher();
    navigateToTab("coordination");
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
    default: "House Blend",
    "edge-case-hunter": "The Edge-Case Hunter",
    "spec-lawyer": "The Spec Lawyer",
    "systems-architect": "The Systems Architect",
    "perf-hawk": "The Perf Hawk",
    "storage-skeptic": "The Storage Skeptic",
    "index-specialist": "The Index Specialist",
    "production-dba": "The Production DBA",
    // Silent fallback for legacy saved rows (never render living people's names)
    "tom-lane": "The Edge-Case Hunter",
    "peter-eisentraut": "The Spec Lawyer",
    "robert-haas": "The Systems Architect",
    "andres-freund": "The Perf Hawk",
    "heikki-linnakangas": "The Storage Skeptic",
    "bruce-momjian": "The Production DBA",
    "alexander-korotkov": "The Index Specialist",
  };
  const flLabel = flNames[fl] || fl;
  return fl === "default" ? `${lvLabel} · ${flLabel}` : `${lvLabel} · ${flLabel} (AI persona)`;
}

function formatOpinionModelSpec(backend: string, modelsJson: string): string {
  const b = (backend || "ai").toLowerCase().trim();
  if (modelsJson && modelsJson !== "{}") {
    try {
      const obj = JSON.parse(modelsJson) as Record<string, string>;
      if (obj.spec && obj.spec.trim()) return obj.spec.trim();
      const raw = (obj.critic || obj.synth || obj.roaster || "").trim();
      if (raw && raw !== "codex-default") {
        if (raw.includes("/")) return raw;
        const norm = raw.replace(/-(xhigh|high|medium|low|max|ultra)$/i, ":$1");
        if (/^(?:gpt-|o[134]|codex)/i.test(norm) || b === "codex") return `openai/${norm}`;
        if (/^(?:claude|opus|fable|mythos)/i.test(norm) || b === "claude") {
          return `anthropic/${norm.toLowerCase() === "opus" ? "claude-opus" : norm}`;
        }
        if (/^gemini/i.test(norm) || b === "agy") return `google/${norm}`;
        return `${b}/${norm}`;
      }
    } catch {
      // fallback below
    }
  }
  return b;
}

function formatModelsLabel(modelsJson: string): string {
  if (!modelsJson || modelsJson === "{}") return "";
  try {
    const obj = JSON.parse(modelsJson) as Record<string, string>;
    const vals = Object.entries(obj)
      .filter(([k, v]) => k !== "spec" && k !== "evidence" && Boolean(v))
      .map(([k, v]) => `${k}: ${v}`);
    return vals.join(" · ");
  } catch {
    return modelsJson;
  }
}

function extractOpinionEvidence(o: OpinionItem): string[] {
  if (o.models_json && o.models_json !== "{}") {
    try {
      const obj = JSON.parse(o.models_json) as Record<string, string>;
      if (obj.evidence && obj.evidence.trim()) {
        return obj.evidence
          .split(/\s*\|\s*|\s*·\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      // ignore
    }
  }
  const lv = (o.roast_level || "light").toLowerCase();
  return lv === "light" ? ["Thread + Precedents (no code read)"] : [];
}

function renderEvidenceStrip(badges: string[]): string {
  if (!badges.length) return "";
  const clsFor = (b: string): string => {
    const low = b.toLowerCase();
    if (/(?:fail|crash|error|rejected)/.test(low)) return "ev-err";
    if (/(?:passed|clean|applied|compiled|cassert|sql|live)/.test(low) && !/skipped|no code/.test(low)) return "ev-ok";
    if (/(?:skipped|no code|timeout|partial)/.test(low)) return "ev-warn";
    return "ev-neutral";
  };
  return `<div class="opinion-evidence-strip" aria-label="Verification evidence">${badges
    .map((b) => `<span class="ev-pill ${clsFor(b)}">${esc(b)}</span>`)
    .join("")}</div>`;
}

function formatInlineMd(escaped: string): string {
  let out = escaped;
  // Safe links [label](https://...)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
  });
  // Inline code
  out = out.replace(/`([^`\n]+)`/g, `<code class="mono">$1</code>`);
  // Bold
  out = out.replace(/\*\*([^*\n]+)\*\*/g, `<strong>$1</strong>`);
  // Italic
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, `$1<em>$2</em>`);
  return out;
}

function renderOpinionMarkdown(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return `<p class="muted">No summary text included.</p>`;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let paraLines: string[] = [];

  const flushPara = () => {
    if (paraLines.length === 0) return;
    blocks.push(`<p>${paraLines.map((l) => formatInlineMd(esc(l))).join("<br/>")}</p>`);
    paraLines = [];
  };
  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    blocks.push(`<${listType}>${listItems.map((it) => `<li>${formatInlineMd(esc(it))}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      if (inCode) {
        blocks.push(`<pre class="op-code mono"><code>${esc(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    const hMatch = trimmed.match(/^(#{2,4})\s+(.+)$/);
    if (hMatch) {
      flushPara();
      flushList();
      const tag = hMatch[1]!.length <= 3 ? "h4" : "h5";
      blocks.push(`<${tag} class="op-h">${formatInlineMd(esc(hMatch[2]!))}</${tag}>`);
      continue;
    }
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ulMatch[1]!);
      continue;
    }
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushPara();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(olMatch[1]!);
      continue;
    }
    flushList();
    paraLines.push(trimmed);
  }
  if (inCode && codeLines.length > 0) {
    blocks.push(`<pre class="op-code mono"><code>${esc(codeLines.join("\n"))}</code></pre>`);
  }
  flushPara();
  flushList();
  return blocks.join("");
}

function summarizeOpinionPreview(md: string): string {
  const lines = (md || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("**Verification:**"));
  const first = (lines[0] || "View patch consensus & full opinion")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/, "");
  return first.length > 220 ? `${first.slice(0, 219).trimEnd()}…` : first;
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
              <div class="mr-tldr-label">${disc.messages[0]?.isAuthor ? "Opening pitch" : "Opening post"} (#1 · ${esc(disc.messages[0]?.from || "Starter")}${disc.messages[0]?.isThreadStarter && !disc.messages[0]?.isAuthor ? " · Thread starter" : ""})</div>
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
        <button type="button" class="btn btn-backoffice btn-sm" data-goto-connect="1">Reply via Backoffice →</button>
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
            ${esc(p.name)}${p.isAuthor ? " · Patch Author" : p.isThreadStarter ? " · Starter" : ""} <span class="dim">(${p.count})</span>
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
                .map((a) => {
                  const safeAtt = safeHttpUrl(a.url);
                  return safeAtt
                    ? `
                <a class="mr-att-chip ${a.isPatch && !a.isNoCfbot ? "is-patch" : ""}" href="${esc(safeAtt)}" target="_blank" rel="noopener">
                  <span>${a.isPatch ? "🩹" : "📎"}</span>
                  <span class="mono">${esc(a.name)}</span>
                  ${a.sizeText ? `<span class="dim">${esc(a.sizeText)}</span>` : ""}
                </a>
              `
                    : `<span class="mr-att-chip"><span>📎</span><span class="mono">${esc(a.name)}</span></span>`;
                })
                .join("")}
            </div>
          `
              : "";
          const safeMsgUrl = safeHttpUrl(m.url);
          return `
            ${sysEvent}
            <article class="mr-msg ${m.isAuthor ? "is-author" : ""}" id="mr-msg-${m.index}">
              <div class="mr-msg-head">
                <div class="mr-msg-author">
                  <span class="mr-avatar">${esc(initials)}</span>
                  <strong style="font-size:13px;">${esc(m.from)}</strong>
                  ${m.isAuthor ? `<span class="mr-author-badge">Patch Author</span>` : m.isThreadStarter ? `<span class="mr-starter-badge">Thread Starter</span>` : ""}
                  ${m.patchRevision ? `<span class="mr-rev-badge mono">${esc(m.patchRevision)}</span>` : ""}
                </div>
                <div class="row" style="gap:8px;font-size:11.5px;">
                  <span class="mono dim">#${m.index + 1} · ${esc(m.date.slice(0, 16).replace("T", " "))} UTC</span>
                  ${safeMsgUrl ? `<a href="${esc(safeMsgUrl)}" target="_blank" rel="noopener">Archive ↗</a>` : ""}
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
        Public discussions never auto-post to <code>pgsql-hackers</code>. Open CF ${cfId} in your local Personal Backoffice to draft a plain-text 72-column reply.
      </div>
      <div class="row" style="gap:8px;">
        <button type="button" class="btn btn-primary btn-sm" data-goto-connect="1">Set up Backoffice →</button>
        <a class="btn btn-secondary btn-sm" href="${esc(backofficeHref)}" target="_blank" rel="noopener" title="Already running bun run app:local locally?">Open locally (127.0.0.1) ↗</a>
        ${safeHttpUrl(disc.threadUrl) ? `<a class="btn btn-ghost btn-sm" href="${esc(safeHttpUrl(disc.threadUrl))}" target="_blank" rel="noopener">Original postgresql.org thread ↗</a>` : ""}
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
        ${safeHttpUrl(diff.compareUrl) ? `<a class="btn btn-secondary btn-sm" href="${esc(safeHttpUrl(diff.compareUrl))}" target="_blank" rel="noopener">GitHub Compare ↗</a>` : ""}
        <button type="button" class="btn btn-backoffice btn-sm" data-goto-connect="1">Review via Backoffice →</button>
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
      ${visibleFiles
        .map((f) => {
          const origIdx = diff.files.indexOf(f);
          const fp = f.newPath || f.oldPath;
          const shortName = fp.split("/").slice(-2).join("/");
          const cCount = lineCountForFile(f) + (f.mentions?.length || 0);
          const isViewed = state.mrViewedFiles.has(fp);
          return `
            <button type="button" class="diff-nav-pill ${isViewed ? "is-viewed" : ""}" data-jump-diff-file="${origIdx}" title="${esc(fp)}">
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
          const isOpen = state.mrInitializedOpenFiles
            ? state.mrOpenFiles.has(fp)
            : !isViewed && (idx < 5 || lineCommentsInFile > 0 || mentionCount > 0);
          return `
        <details class="diff-file ${isViewed ? "is-viewed" : ""}" id="diff-file-${origIdx}" data-diff-fp="${esc(fp)}" ${isOpen ? "open" : ""}>
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
          : state.returnTab === "coordination"
            ? "Team"
            : "Brief";
  const backofficeHref = getLocalBackofficeUrl(cfId);
  const safeThreadUrl = safeHttpUrl(threadUrl);

  // Build visual consensus bar segments
  const breakdownEntries: Array<[string, number]> = consensus && consensus.totalOpinions > 0
    ? Object.entries(consensus.breakdown).sort((a, b) => b[1] - a[1])
    : verdict && verdict !== "UNROASTED"
      ? [[verdict, 1]]
      : [];
  const barTotal = breakdownEntries.reduce((acc, [, n]) => acc + n, 0);

  const consensusBadge = !consensus || consensus.status === "baseline_only"
    ? `<span class="pill">Baseline brief pass</span>`
    : consensus.status === "single_opinion"
      ? `<span class="pill p-info">1 opinion</span>`
      : consensus.status === "unanimous"
        ? `<span class="pill p-ok">Unanimous agreement</span>`
        : consensus.status === "majority"
          ? `<span class="pill p-info">Majority consensus</span>`
          : `<span class="pill p-warn">Split opinions</span>`;

  const hasBaselineCard =
    verdict !== "UNROASTED" || reasons.length > 0 || Boolean(workaround) || Boolean(failingSummary) || Boolean(nextStep);
  const totalShownOpinions = opinions.length + (hasBaselineCard ? 1 : 0);
  const opinionsSubLabel =
    opinions.length > 0 && hasBaselineCard
      ? `${opinions.length} community run${opinions.length === 1 ? "" : "s"} · 1 baseline brief pass`
      : opinions.length > 0
        ? `${opinions.length} published from local workbenches`
        : hasBaselineCard
          ? "1 baseline CommitFest brief pass · 0 individual reviewer runs yet"
          : "Published from each reviewer's local workbench";

  // Unique contributor + exact model spec pairs
  const contributorChips = opinions.map((o) => {
    const handle = o.contributor_handle ? `@${o.contributor_handle}` : o.contributor_name;
    const spec = formatOpinionModelSpec(o.backend, o.models_json);
    const lv = (o.roast_level || "light").toLowerCase();
    return `<span class="opinion-model-badge">${verdictDot(o.verdict)} <strong>${esc(handle)}</strong> <span class="dim">·</span> <span class="mono">${esc(spec)}</span> <span class="dim">·</span> <span>${esc(lv)}</span></span>`;
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
        ${safeThreadUrl ? `<a class="btn btn-secondary btn-sm" href="${esc(safeThreadUrl)}" target="_blank" rel="noopener">Thread ↗</a>` : ""}
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
        <span class="mr-tab-count">${totalShownOpinions}</span>
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
            <h2>Reviewer &amp; AI Opinions (${totalShownOpinions})</h2>
            <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap;">
              <span class="dim" style="font-size:12px;">${esc(opinionsSubLabel)}</span>
              <button type="button" class="about-link-inline" data-open-about="#roast-levels">What is a roast?</button>
            </div>
          </div>

          <div class="opinion-feed">
            ${opinions
              .map((o) => {
                const initials = (o.contributor_name || o.contributor_handle || "?").slice(0, 2).toUpperCase();
                const modelsText = formatModelsLabel(o.models_json);
                const evidenceBadges = extractOpinionEvidence(o);
                return `
              <article class="opinion-card">
                <div class="opinion-head">
                  <div class="opinion-who">
                    <div class="opinion-avatar">
                      ${safeHttpUrl(o.contributor_avatar) ? `<img src="${esc(safeHttpUrl(o.contributor_avatar))}" alt="${esc(o.contributor_name)}" />` : esc(initials)}
                    </div>
                    <div>
                      <div class="opinion-name">${esc(o.contributor_name || o.contributor_handle)}</div>
                      <div class="opinion-sub">@${esc(o.contributor_handle)} · ${esc(o.contributor_provider)} · ${esc(o.created_at.slice(0, 10))}</div>
                    </div>
                  </div>
                  <div class="row" style="gap:6px;flex-wrap:wrap;">
                    <span class="opinion-model-badge mono">${esc(formatOpinionModelSpec(o.backend, o.models_json))}</span>
                    <span class="opinion-model-badge">${esc(formatOpinionProfile(o))}</span>
                    ${verdictPill(o.verdict)}
                  </div>
                </div>
                ${renderEvidenceStrip(evidenceBadges)}
                ${modelsText ? `<div class="dim mono" style="font-size:11.5px;">Models: ${esc(modelsText)} · Confidence: ${esc(o.confidence || "medium")}</div>` : `<div class="dim" style="font-size:11.5px;">Confidence: ${esc(o.confidence || "medium")}</div>`}
                <div class="opinion-body">${renderOpinionMarkdown(o.summary || "")}</div>
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
                    : `
                  <div class="muted" style="font-size:13px;line-height:1.5;">
                    Baseline triage verdict from the published CommitFest batch (not a detailed shortlist write-up yet). Read the live thread and code right here, or publish a full review from your local Backoffice:
                    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;">
                      <button type="button" class="btn btn-secondary btn-sm" data-jump-mr-tab="discussion">Read -hackers Discussion →</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-jump-mr-tab="changes">Inspect CFBot Diff →</button>
                    </div>
                  </div>
                `
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
                Each reviewer runs their own local <strong>Personal Backoffice</strong> with their preferred AI (Claude, Gemini, Codex, etc.) and local PostgreSQL build, then clicks <strong>Publish Opinion</strong> to share sanitized findings here so the team can compare perspectives and derive common ground.
              </div>
              <div class="row" style="gap:8px;margin-top:2px;flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-sm" data-goto-connect="1">Set up Personal Backoffice →</button>
                <a class="btn btn-backoffice btn-sm" href="${esc(backofficeHref)}" target="_blank" rel="noopener" title="Already running bun run app:local locally?">Open locally (127.0.0.1) ↗</a>
                <button type="button" class="btn btn-secondary btn-sm" id="patch-copy-local-cta">Copy local link</button>
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

        <div class="card" style="margin-bottom:0;">
          <div class="sheet-section-label" style="margin-bottom:8px;">Run via CLI (<code class="mono">npx pgroast</code>)</div>
          <div class="cli-bar" style="margin-bottom:6px;">
            <span class="cli-bar-label">Roast</span>
            <code class="mono cli-bar-cmd">npx pgroast ${cfId} --roast-level medium --flavour default</code>
            <button type="button" class="btn btn-ghost btn-sm" data-copy-cli="npx pgroast ${cfId} --roast-level medium --flavour default">Copy</button>
          </div>
          <div class="cli-bar" style="margin-bottom:6px;">
            <span class="cli-bar-label">Thread</span>
            <code class="mono cli-bar-cmd">npx pgroast pushback ${cfId}</code>
            <button type="button" class="btn btn-ghost btn-sm" data-copy-cli="npx pgroast pushback ${cfId}">Copy</button>
          </div>
          <div class="cli-bar">
            <span class="cli-bar-label">Publish</span>
            <code class="mono cli-bar-cmd">npx pgroast publish ./out/cf-${cfId}/roast.json</code>
            <button type="button" class="btn btn-ghost btn-sm" data-copy-cli="npx pgroast publish ./out/cf-${cfId}/roast.json">Copy</button>
          </div>
        </div>

        <div class="space-handoff-box">
          <div class="space-card-head">
            <span class="space-card-title" style="font-size:13px;"><span class="space-dot" style="background:var(--warn)"></span>Personal Backoffice</span>
            <span class="space-badge-local">Private · Local</span>
          </div>
          <div class="muted" style="font-size:12px;line-height:1.45;">
            Compile Postgres, run your AI models, review the patch diff, keep private Work Items, and draft <code>-hackers</code> emails locally.
          </div>
          <button type="button" class="btn btn-primary" style="width:100%;height:38px;" data-goto-connect="1">Set up Personal Backoffice →</button>
          <div class="row" style="gap:6px;">
            <a class="btn btn-secondary" style="flex:1;" href="${esc(backofficeHref)}" target="_blank" rel="noopener" title="Already running bun run app:local on your laptop?">Open locally ↗</a>
            <button type="button" class="btn btn-ghost" id="patch-copy-local-side">Copy</button>
          </div>
        </div>
      </aside>
    </div>
    `
    }
  `;
}

/* ---- First-Class Public Stats Observatory Tab ---- */
function renderStatsTab(): string {
  return renderStatsObservatory({
    data: state.statsOverview,
    loading: state.statsLoading,
    error: state.statsError,
    queueFilter: state.statsQueueFilter,
    darkFilter: state.statsDarkFilter,
  });
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
          <span><strong>How pgroast works:</strong> reviewers and AIs roast CommitFest patches (and their own drafts) by level and flavour; humans verify findings and deliver reviews to <code class="mono">pgsql-hackers</code>. <button type="button" class="about-link-inline" data-open-about="">What is a roast?</button></span>
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
            CommitFest has hundreds of open patches waiting for review. Each contributor runs a private local <strong>Backoffice</strong> with their own AI models to review and scrutinize (&ldquo;roast&rdquo;) patches — starting with the idea itself, then testing the code — and publishes sanitized opinions here so we can compare notes. <button type="button" class="about-link-inline" data-open-about="">Read why we roast patches →</button>
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
            <strong>Pick a reviewer archetype</strong>
          </div>
          <div class="intro-flavour-list">
            <span class="chip">House Blend</span>
            <span class="chip">The Edge-Case Hunter</span>
            <span class="chip">The Spec Lawyer</span>
            <span class="chip">The Systems Architect</span>
            <span class="chip">The Perf Hawk</span>
            <span class="chip">The Storage Skeptic</span>
            <span class="chip">The Index Specialist</span>
            <span class="chip">The Production DBA</span>
          </div>
          <p>
            Fictional PostgreSQL review personas that focus the AI on specific risk areas — never real human committers (AI makes mistakes all the time). Every report and opinion records its roast level and archetype.
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
  const roastedCount = stats.totals?.roasted ?? Math.max(0, total - vCount("UNROASTED"));
  const unroastedCount = Math.max(0, total - roastedCount);

  const donutSegments = [
    { key: "NO-FUNDAMENTAL-OBJECTION", label: "No fundamental objection", value: vCount("NO-FUNDAMENTAL-OBJECTION"), color: "#4cb782" },
    { key: "NEEDS-COMMITTER-EYES", label: "Needs committer eyes", value: vCount("NEEDS-COMMITTER-EYES"), color: "#5e6ad2" },
    { key: "NEEDS-DESIGN-DISCUSSION", label: "Needs design discussion", value: vCount("NEEDS-DESIGN-DISCUSSION"), color: "#e0a83c" },
    { key: "LIKELY-REJECT", label: "Likely reject", value: vCount("LIKELY-REJECT"), color: "#eb5757" },
    { key: "UNROASTED", label: "Not roasted", value: vCount("UNROASTED"), color: "#737682" },
  ];

  const topTopics = (stats.topTopics ?? []).slice(0, 8);
  const maxTopic = Math.max(1, ...topTopics.map((t) => t.open || t.total));
  const matrixRows = stats.statusMatrix ?? [];

  return `
    <div class="page-head">
      <div class="page-head-main">
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

    <div class="cli-bar" style="margin-bottom:14px;">
      <span class="cli-bar-label">CLI</span>
      <code class="mono cli-bar-cmd">npx pgroast batch 62 --out ./out/cf62 --status open --concurrency 3 &amp;&amp; npx pgroast shortlist ./out/cf62</code>
      <button type="button" class="btn btn-ghost btn-sm" data-copy-cli="npx pgroast batch 62 --out ./out/cf62 --status open --concurrency 3 && npx pgroast shortlist ./out/cf62">Copy</button>
    </div>

    <div class="kpis">
      <button type="button" class="kpi" data-jump-verdict="all">
        <div class="kpi-l">Roasted / Total</div>
        <div class="kpi-v">${roastedCount} <span class="dim" style="font-size:14px;font-weight:500;">/ ${total}</span></div>
        <div class="kpi-sub">${unroastedCount} unroasted · ${openCount} open · ${closedCount} closed</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NO-FUNDAMENTAL-OBJECTION">
        <div class="kpi-l"><span class="dot" style="background:#4cb782"></span>No objection</div>
        <div class="kpi-v" style="color:var(--ok)">${vCount("NO-FUNDAMENTAL-OBJECTION")}</div>
        <div class="kpi-sub">Roasted clean</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NEEDS-COMMITTER-EYES">
        <div class="kpi-l"><span class="dot" style="background:#5e6ad2"></span>Committer eyes</div>
        <div class="kpi-v" style="color:var(--accent-t)">${vCount("NEEDS-COMMITTER-EYES")}</div>
        <div class="kpi-sub">Needs sign-off</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="NEEDS-DESIGN-DISCUSSION">
        <div class="kpi-l"><span class="dot" style="background:#e0a83c"></span>Design disc.</div>
        <div class="kpi-v" style="color:var(--warn)">${vCount("NEEDS-DESIGN-DISCUSSION")}</div>
        <div class="kpi-sub">Needs debate</div>
      </button>
      <button type="button" class="kpi" data-jump-verdict="LIKELY-REJECT">
        <div class="kpi-l"><span class="dot" style="background:#eb5757"></span>Likely reject</div>
        <div class="kpi-v" style="color:var(--danger)">${vCount("LIKELY-REJECT")}</div>
        <div class="kpi-sub">Hard blockers</div>
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
    ["UNROASTED", "Not roasted", "#737682"],
  ];
  const statusChips: Array<[string, string]> = [
    ["all", "All statuses"],
    ["Ready for Committer", "Ready for Committer"],
    ["Needs review", "Needs review"],
    ["Waiting on Author", "Waiting on Author"],
  ];
  const hasCustomStatus =
    state.entryStatus !== "all" &&
    !statusChips.some(([val]) => val.toLowerCase() === state.entryStatus.toLowerCase());

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
        ${
          hasCustomStatus
            ? `<button type="button" class="chip active" id="clear-custom-status-chip" title="Click to clear status filter">${esc(state.entryStatus)} ×</button>`
            : ""
        }
      </div>
    </div>

    <div class="cli-bar" style="margin-bottom:10px;">
      <span class="cli-bar-label">Bulk CLI</span>
      <code class="mono cli-bar-cmd">npx pgroast batch 62 --out ./out/cf62 --status ${esc(state.entryStatus === "all" ? "open" : state.entryStatus.includes(" ") ? `"${state.entryStatus}"` : state.entryStatus)} --backend codex --roast-level medium --flavour default --concurrency 3</code>
      <button type="button" class="btn btn-ghost btn-sm" data-copy-cli='npx pgroast batch 62 --out ./out/cf62 --status ${esc(state.entryStatus === "all" ? "open" : state.entryStatus.includes(" ") ? `"${state.entryStatus}"` : state.entryStatus)} --backend codex --roast-level medium --flavour default --concurrency 3'>Copy</button>
    </div>

    <div class="issue-list" id="entries-list-mount">
      ${renderEntriesRowsHtml(filtered)}
    </div>
  `;
}

/* ---- Opinions Tab (Search, Depth/Verdict/Model Filter, Sort & Pagination) ---- */
const OPINION_LEVEL_RANK: Record<string, number> = { dark: 3, medium: 2, light: 1 };
const OPINION_CRITICAL_RANK: Record<string, number> = {
  "LIKELY-REJECT": 4,
  "NEEDS-DESIGN-DISCUSSION": 3,
  "NEEDS-COMMITTER-EYES": 2,
  "NO-FUNDAMENTAL-OBJECTION": 1,
};

function resolveOpinionTitle(o: OpinionItem): string {
  if (o.entry_title && o.entry_title.trim()) return o.entry_title.trim();
  const match = state.entries.find((e) => e.cf_id === o.cf_id);
  return match?.title || "";
}

function getFilteredOpinions(): OpinionItem[] {
  const q = state.opSearch.trim().toLowerCase();
  const lv = state.opLevel;
  const v = state.opVerdict;
  const m = state.opModel;

  const filtered = state.opinions.filter((o) => {
    const oLv = (o.roast_level || "light").toLowerCase();
    if (lv !== "all" && oLv !== lv) return false;
    if (v !== "all" && (o.verdict || "UNROASTED") !== v) return false;
    const spec = formatOpinionModelSpec(o.backend, o.models_json);
    if (m !== "all" && spec !== m) return false;
    if (q) {
      const title = resolveOpinionTitle(o);
      const hay = `${o.cf_id} ${title} ${o.entry_authors || ""} ${o.contributor_name} ${o.contributor_handle} ${spec} ${o.roast_flavour || ""} ${o.summary || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  if (state.opSort === "depth") {
    sorted.sort(
      (a, b) =>
        (OPINION_LEVEL_RANK[(b.roast_level || "light").toLowerCase()] || 0) -
          (OPINION_LEVEL_RANK[(a.roast_level || "light").toLowerCase()] || 0) ||
        b.created_at.localeCompare(a.created_at),
    );
  } else if (state.opSort === "critical") {
    sorted.sort(
      (a, b) =>
        (OPINION_CRITICAL_RANK[b.verdict] || 0) - (OPINION_CRITICAL_RANK[a.verdict] || 0) ||
        (OPINION_LEVEL_RANK[(b.roast_level || "light").toLowerCase()] || 0) -
          (OPINION_LEVEL_RANK[(a.roast_level || "light").toLowerCase()] || 0) ||
        b.created_at.localeCompare(a.created_at),
    );
  } else if (state.opSort === "cf_desc") {
    sorted.sort((a, b) => b.cf_id - a.cf_id || b.created_at.localeCompare(a.created_at));
  } else {
    sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return sorted;
}

function renderOpinionsRowsHtml(filtered: OpinionItem[]): string {
  if (filtered.length === 0) {
    return `<div class="empty-state">No opinions match your current search or filter.</div>`;
  }
  const pageSize = Math.max(10, state.opPageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, state.opPage), totalPages);
  state.opPage = page;
  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const rowsHtml = slice
    .map((o) => {
      const title = resolveOpinionTitle(o);
      const preview = summarizeOpinionPreview(o.summary || "");
      const lv = (o.roast_level || "light").toLowerCase();
      const lvPillCls = lv === "dark" ? "p-warn" : lv === "medium" ? "p-info" : "";
      return `
      <button type="button" class="issue-row" data-open-patch="${o.cf_id}">
        <div class="issue-top">
          <div class="issue-id-group">
            ${verdictDot(o.verdict)}
            <span class="mono issue-id">CF ${o.cf_id}</span>
            ${o.entry_status ? `<span class="issue-status">${esc(o.entry_status)}</span>` : ""}
            <span class="dim mono" style="font-size:11px;">${esc(o.created_at.slice(0, 10))}</span>
          </div>
          ${CHEVRON_SVG}
        </div>
        <div class="issue-title" style="font-size:14px;">${esc(title || preview)}</div>
        ${title && preview ? `<div class="opinion-row-preview">${esc(preview)}</div>` : ""}
        <div class="issue-meta">
          ${verdictPill(o.verdict)}
          <span class="pill ${lvPillCls}" style="font-size:10.5px;padding:1px 7px;">${esc(formatOpinionProfile(o))}</span>
          <span class="tag-micro mono">${esc(formatOpinionModelSpec(o.backend, o.models_json))}</span>
          <span class="tag-micro">${esc(o.contributor_name)} (@${esc(o.contributor_handle)})</span>
          ${extractOpinionEvidence(o)
            .slice(0, 3)
            .map((b) => `<span class="tag-micro">${esc(b)}</span>`)
            .join("")}
        </div>
      </button>
    `;
    })
    .join("");

  const pagerHtml =
    totalPages > 1 || filtered.length > 25
      ? `
    <div class="op-pagination" aria-label="Opinions pagination">
      <div class="dim mono" style="font-size:12px;">
        Showing ${start + 1}–${Math.min(start + slice.length, filtered.length)} of ${filtered.length}
      </div>
      <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" id="op-prev-page" ${page <= 1 ? "disabled" : ""}>← Prev</button>
        <span class="mono" style="font-size:12px;padding:0 6px;">Page ${page} / ${totalPages}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="op-next-page" ${page >= totalPages ? "disabled" : ""}>Next →</button>
        <select id="op-page-size" aria-label="Items per page" style="height:30px;padding:0 8px;border-radius:7px;border:1px solid var(--border-s);background:var(--surface);color:var(--text);font-size:12px;">
          ${[25, 50, 100].map((n) => `<option value="${n}" ${pageSize === n ? "selected" : ""}>${n} / page</option>`).join("")}
        </select>
      </div>
    </div>
  `
      : "";

  return `${rowsHtml}${pagerHtml}`;
}

function bindOpinionsListOnlyEvents(): void {
  const mount = document.getElementById("opinions-list-mount");
  if (!mount) return;
  bindPatchRowClicks(mount);
  mount.querySelector("#op-prev-page")?.addEventListener("click", () => {
    if (state.opPage > 1) {
      state.opPage--;
      updateOpinionsListOnly();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  mount.querySelector("#op-next-page")?.addEventListener("click", () => {
    state.opPage++;
    updateOpinionsListOnly();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  mount.querySelector<HTMLSelectElement>("#op-page-size")?.addEventListener("change", (ev) => {
    state.opPageSize = Number((ev.target as HTMLSelectElement).value) || 25;
    state.opPage = 1;
    updateOpinionsListOnly();
  });
}

function updateOpinionsListOnly(): void {
  const filtered = getFilteredOpinions();
  const countEl = document.getElementById("opinions-count-badge");
  if (countEl) countEl.textContent = `${filtered.length} of ${state.opinions.length}`;
  const clearBtn = document.getElementById("op-search-clear-btn");
  if (clearBtn) clearBtn.hidden = !state.opSearch;
  const mount = document.getElementById("opinions-list-mount");
  if (!mount) return;
  mount.innerHTML = renderOpinionsRowsHtml(filtered);
  bindOpinionsListOnlyEvents();
}

function renderOpinionsTab(): string {
  const filtered = getFilteredOpinions();
  const darkCnt = state.opinions.filter((o) => (o.roast_level || "light").toLowerCase() === "dark").length;
  const medCnt = state.opinions.filter((o) => (o.roast_level || "light").toLowerCase() === "medium").length;
  const lightCnt = state.opinions.length - darkCnt - medCnt;
  const modelSpecs = Array.from(new Set(state.opinions.map((o) => formatOpinionModelSpec(o.backend, o.models_json)))).sort();

  const verdictChips: Array<[string, string, string]> = [
    ["all", "All verdicts", ""],
    ["NO-FUNDAMENTAL-OBJECTION", "Clean", "#4cb782"],
    ["NEEDS-COMMITTER-EYES", "Committer eyes", "#5e6ad2"],
    ["NEEDS-DESIGN-DISCUSSION", "Design disc.", "#e0a83c"],
    ["LIKELY-REJECT", "Likely reject", "#eb5757"],
  ];

  return `
    <div class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">Community Model Opinions <span class="dim mono" id="opinions-count-badge" style="font-size:15px;font-weight:500;">${filtered.length} of ${state.opinions.length}</span></h1>
        <div class="page-sub">Search, filter by roast depth, verdict, or model, and sort — tap any row to open full verification logs · <button type="button" class="about-link-inline" data-open-about="#roast-levels">What do Light / Medium / Dark mean?</button></div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="opinions-goto-team-btn">Team claims (${state.coordination.length}) →</button>
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
      <div class="filter-bar">
        <div class="op-controls">
          <div class="search-box" style="flex:1;margin-bottom:0;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input id="op-search-input" type="search" autocomplete="off" value="${esc(state.opSearch)}" placeholder="Search CF #, patch title, author, model, or review text…" />
            <button type="button" class="search-clear" id="op-search-clear-btn" aria-label="Clear search" ${state.opSearch ? "" : "hidden"}>×</button>
          </div>
          <select id="op-model-select" aria-label="Filter by AI model">
            <option value="all" ${state.opModel === "all" ? "selected" : ""}>All models (${modelSpecs.length})</option>
            ${modelSpecs.map((sp) => `<option value="${esc(sp)}" ${state.opModel === sp ? "selected" : ""}>${esc(sp)}</option>`).join("")}
          </select>
          <select id="op-sort-select" aria-label="Sort opinions">
            <option value="newest" ${state.opSort === "newest" ? "selected" : ""}>Sort: Newest first</option>
            <option value="depth" ${state.opSort === "depth" ? "selected" : ""}>Sort: Deepest (Dark → Light)</option>
            <option value="critical" ${state.opSort === "critical" ? "selected" : ""}>Sort: Most critical first</option>
            <option value="cf_desc" ${state.opSort === "cf_desc" ? "selected" : ""}>Sort: CF # descending</option>
          </select>
        </div>
        <div class="chips" role="tablist" aria-label="Verification depth filter">
          <button type="button" class="chip ${state.opLevel === "all" ? "active" : ""}" data-op-level="all">All depths <span class="dim">(${state.opinions.length})</span></button>
          <button type="button" class="chip ${state.opLevel === "dark" ? "active" : ""}" data-op-level="dark"><span class="dot" style="background:var(--warn)"></span>Dark (build + SQL) <span class="dim">(${darkCnt})</span></button>
          ${medCnt > 0 ? `<button type="button" class="chip ${state.opLevel === "medium" ? "active" : ""}" data-op-level="medium"><span class="dot" style="background:var(--accent)"></span>Medium (build + test) <span class="dim">(${medCnt})</span></button>` : ""}
          <button type="button" class="chip ${state.opLevel === "light" ? "active" : ""}" data-op-level="light"><span class="dot" style="background:var(--muted)"></span>Light (idea + precedents) <span class="dim">(${lightCnt})</span></button>
        </div>
        <div class="chips" role="tablist" aria-label="Verdict filter" style="margin-bottom:2px;">
          ${verdictChips
            .map(
              ([val, label, dot]) => `
            <button type="button" class="chip ${state.opVerdict === val ? "active" : ""}" data-op-verdict="${val}">
              ${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${label}
            </button>
          `,
            )
            .join("")}
        </div>
      </div>

      <div class="issue-list" id="opinions-list-mount">
        ${renderOpinionsRowsHtml(filtered)}
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
function buildBackofficeInstallPrompt(): string {
  const origin = window.location.origin;
  return [
    "Install and configure the pgroast Personal Backoffice on this machine:",
    "",
    "1. Check prerequisites: git, bun (>= 1.3.5), PostgreSQL 18 or 19 (local or Docker), and at least one signed-in AI CLI (claude or codex).",
    "2. Clone https://github.com/NikolayS/pgroast.git (or git pull if already cloned) and run `bun install`.",
    "3. Configure PostgreSQL:",
    "   - If I already have local PostgreSQL 18/19 running, reuse it and write `.env` with matching `PGROAST_DSN` and `PGROAST_DATABASE_URL`.",
    "   - Otherwise start the bundled Postgres 19 container: `docker compose -f apps/local/docker-compose.yml up -d` and copy `.env.example` to `.env`.",
    `4. Set \`PGROAST_PUBLIC_HUB_URL=${origin}\` in \`.env\`.`,
    "5. Run `bun run src/cli.ts init-db` to load the 2,547-row precedent index, and `bun run src/cli.ts doctor` to verify my AI CLI login.",
    "6. Start the local Backoffice with `bun run app:local`, verify http://127.0.0.1:3432 responds, and show me the link plus what optional settings (CommitFest login, publish token, local Postgres git clone) I can configure next.",
  ].join("\n");
}

function renderConnectTab(): string {
  const oauth = state.health?.oauth;
  const backofficeHref = getLocalBackofficeUrl();
  const agentPrompt = buildBackofficeInstallPrompt();
  const manualShellCmd = [
    "git clone https://github.com/NikolayS/pgroast.git && cd pgroast",
    "bun install",
    "docker compose -f apps/local/docker-compose.yml up -d",
    "cp .env.example .env",
    "bun run src/cli.ts init-db",
    "bun run app:local",
  ].join("\n");

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
        <div class="row" style="gap:8px;margin-top:4px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" style="flex:1;height:38px;" id="connect-copy-prompt-btn">Copy AI Agent Install Prompt</button>
          <a class="btn btn-secondary" style="height:38px;" href="${esc(backofficeHref)}" target="_blank" rel="noopener" title="Already running bun run app:local on your laptop?">Open local ↗</a>
        </div>
        <div class="dim" style="font-size:11.5px;">Paste the prompt into Claude Code, Codex, Cursor, or Antigravity — or open <code class="mono">${esc(backofficeHref.replace(/\/$/, ""))}</code> if already running.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div class="card-head">
        <div>
          <h3>QuickStart: Ask your AI coding agent to install &amp; configure</h3>
          <div class="dim" style="font-size:12px;">Works with Claude Code, Codex, Cursor, Windsurf, or Antigravity — detects your local Postgres or starts Docker PG 19 automatically.</div>
        </div>
        <div class="row" style="gap:6px;">
          <button type="button" class="btn btn-primary btn-sm" id="connect-copy-prompt-card-btn">Copy prompt</button>
          <button type="button" class="btn btn-secondary btn-sm" id="connect-copy-cmd-btn">Copy start cmd</button>
        </div>
      </div>
      <pre class="agent-prompt-pre mono" id="connect-agent-prompt-text">${esc(agentPrompt)}</pre>
      <details class="agent-manual-fold">
        <summary>Prefer manual terminal commands?</summary>
        <pre class="agent-prompt-pre mono" style="margin-top:8px;">${esc(manualShellCmd)}</pre>
      </details>
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
          ${
            oauth?.githubConfigured
              ? `<a class="btn btn-secondary btn-lg" href="/auth/github">Sign in with GitHub</a>`
              : `<button type="button" class="btn btn-secondary btn-lg" disabled title="GitHub OAuth is not configured on this server">Sign in with GitHub (not configured)</button>`
          }
          ${
            oauth?.googleConfigured
              ? `<a class="btn btn-secondary btn-lg" href="/auth/google">Sign in with Google</a>`
              : `<button type="button" class="btn btn-secondary btn-lg" disabled title="Google OAuth is not configured on this server">Sign in with Google (not configured)</button>`
          }
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
            ${state.devMintError ? `<div class="sheet-callout sheet-callout-warn" style="margin-top:10px;font-size:12px;">${esc(state.devMintError)}</div>` : ""}
            ${
              state.mintedToken
                ? `
              <div class="sheet-callout" style="margin-top:10px;">
                <div class="row" style="justify-content:space-between;margin-bottom:4px;">
                  <strong style="font-size:12px;">Token for @${esc(state.mintedHandle)}</strong>
                  <button type="button" class="btn btn-secondary btn-sm" id="dev-copy-token-btn">Copy token</button>
                </div>
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
  container.querySelectorAll<Element>("[data-open-patch]").forEach((el) => {
    const go = () => {
      const cfId = Number(el.getAttribute("data-open-patch"));
      if (cfId > 0) void openPatchPage(cfId, true);
    };
    el.addEventListener("click", go);
    if (el.tagName.toLowerCase() !== "button" && el.tagName.toLowerCase() !== "a") {
      el.addEventListener("keydown", (ev) => {
        const ke = ev as KeyboardEvent;
        if (ke.key === "Enter" || ke.key === " ") {
          ke.preventDefault();
          go();
        }
      });
    }
  });
}

function bindCliCopyButtons(container: HTMLElement | Document): void {
  container.querySelectorAll<HTMLButtonElement>("[data-copy-cli]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-copy-cli") || "";
      if (cmd) copyTextWithFeedback(btn, cmd, btn.textContent || "Copy");
    });
  });
}

function bindHackerClicks(container: HTMLElement | Document): void {
  container.querySelectorAll<Element>("[data-open-hacker]").forEach((el) => {
    const activate = () => {
      const slug = el.getAttribute("data-open-hacker") || "";
      if (slug) void openHackerProfile(slug, true);
    };
    el.addEventListener("click", activate);
    if (el.tagName.toLowerCase() !== "button" && el.tagName.toLowerCase() !== "a") {
      el.addEventListener("keydown", (ev) => {
        const ke = ev as KeyboardEvent;
        if (ke.key === "Enter" || ke.key === " ") {
          ke.preventDefault();
          activate();
        }
      });
    }
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

const MOBILE_MORE_TABS = new Set<TabId>(["about", "lists", "contribute", "docs", "coordination", "connect"]);

function openMoreSheet(): void {
  const backdrop = document.getElementById("more-backdrop");
  const body = document.getElementById("more-sheet-body");
  const trigger = document.getElementById("web-mobile-more-btn");
  if (!backdrop || !body) return;

  const items: Array<{ tab: TabId; title: string; sub: string; badge?: string }> = [
    { tab: "about", title: "About pgroast", sub: "What roasting means, idea scrutiny first, and the story" },
    { tab: "lists", title: "Mailing Lists Archive", sub: "All 49 PostgreSQL lists · live sync & search" },
    { tab: "contribute", title: "Auto-Contribute Quota", sub: "Donate leftover weekly AI quota to roast patches" },
    { tab: "docs", title: "Docs, CLI & API Explorer", sub: "Stripe-style OpenAPI docs + CLI playground" },
    { tab: "coordination", title: "Team Coordination", sub: "Opt-in reviewer claims", badge: String(state.coordination.length) },
    { tab: "connect", title: "Setup Personal Backoffice", sub: "Run local builds, diffs & publish opinions" },
  ];

  body.innerHTML = `
    <div class="more-nav-grid">
      ${items
        .map(
          (it) => `
        <button type="button" class="more-nav-item ${!state.activePatchId && !state.activeHackerSlug && state.tab === it.tab ? "is-active" : ""}" data-more-tab="${it.tab}">
          <div style="min-width:0;flex:1;">
            <div class="more-nav-title">${esc(it.title)}</div>
            <div class="more-nav-sub">${esc(it.sub)}</div>
          </div>
          ${it.badge ? `<span class="pill mono">${esc(it.badge)}</span>` : ""}
          ${CHEVRON_SVG}
        </button>
      `,
        )
        .join("")}
    </div>
  `;

  body.querySelectorAll<HTMLButtonElement>("[data-more-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.moreTab as TabId;
      closeMoreSheet();
      if (t) navigateToTab(t);
    });
  });

  backdrop.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  document.body.classList.add("sheet-open");
}

function closeMoreSheet(): void {
  const backdrop = document.getElementById("more-backdrop");
  const trigger = document.getElementById("web-mobile-more-btn");
  if (!backdrop) return;
  backdrop.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sheet-open");
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>("#web-nav .nav-link, #web-bottom-nav .btab[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", !state.activePatchId && !state.activeHackerSlug && btn.dataset.tab === state.tab);
  });
  const moreBtn = document.getElementById("web-mobile-more-btn");
  if (moreBtn) {
    moreBtn.classList.toggle("active", !state.activePatchId && !state.activeHackerSlug && MOBILE_MORE_TABS.has(state.tab));
  }

  const root = document.getElementById("web-main")!;
  if (state.activeHackerSlug) {
    const backLabel =
      state.returnTab === "stats"
        ? "Stats"
        : state.returnTab === "entries"
          ? "Entries"
          : state.returnTab === "brief"
            ? "Brief"
            : "Hackers";
    root.innerHTML = renderHackerProfilePage({
      profile: state.hackerProfile,
      loading: state.hackerProfileLoading,
      error: state.hackerProfileError,
      activeTab: state.hackerProfileTab,
      backLabel,
    });
    const slug = state.activeHackerSlug;
    document.getElementById("hacker-back-btn")?.addEventListener("click", () => {
      navigateToTab(state.returnTab === "hackers" ? "hackers" : state.returnTab);
    });
    document.getElementById("hacker-copy-url-btn")?.addEventListener("click", (ev) => {
      copyTextWithFeedback(ev.currentTarget as HTMLElement, `${window.location.origin}/hacker/${encodeURIComponent(slug)}`, "Copy profile link");
    });
    document.querySelectorAll<HTMLButtonElement>("[data-hacker-year]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const yr = Number(btn.dataset.hackerYear);
        if (yr > 1990) void openHackerProfile(slug, false, yr);
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-hacker-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.hackerProfileTab = (btn.dataset.hackerTab as HackerProfileTab) || "commits";
        render();
      });
    });
    bindHackerClicks(root);
    bindPatchRowClicks(root);
    return;
  }

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
      copyTextWithFeedback(ev.currentTarget as HTMLElement, backofficeHref, "Copy");
    });
    bindCliCopyButtons(root);
    document.querySelectorAll<HTMLElement>("[data-goto-connect]").forEach((el) => {
      el.addEventListener("click", () => navigateToTab("connect"));
    });

    const switchMrTab = (next: MrTabId) => {
      state.mrTab = next;
      try {
        const qs = next === "overview" ? "" : `?view=${encodeURIComponent(next)}`;
        window.history.replaceState({ patchId: cfId, tab: state.returnTab, mrTab: next }, "", `/patch/${cfId}${qs}`);
      } catch {
        // ignore
      }
      if (next === "discussion" && state.mrDiscussion?.cfId !== cfId && !state.mrDiscussionLoading) {
        void loadMrDiscussion(cfId);
        return;
      }
      if (next === "changes" && state.mrDiff?.cfId !== cfId && !state.mrDiffLoading) {
        void loadMrDiff(cfId);
        return;
      }
      render();
    };

    // GitLab MR-style tab switching (Overview / Discussion / Changes)
    document.querySelectorAll<HTMLButtonElement>("[data-mr-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchMrTab((btn.dataset.mrTab as MrTabId) || "overview");
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-jump-mr-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchMrTab((btn.dataset.jumpMrTab as MrTabId) || "overview");
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
        const fp = d.dataset.diffFp || "";
        if (fp) {
          if (!anyOpen) state.mrOpenFiles.add(fp);
          else state.mrOpenFiles.delete(fp);
        }
      });
      btn.textContent = anyOpen ? "Expand all" : "Collapse all";
    });
    document.querySelectorAll<HTMLDetailsElement>("#mr-diff-files details.diff-file").forEach((d) => {
      d.addEventListener("toggle", () => {
        const fp = d.dataset.diffFp || "";
        if (!fp) return;
        if (d.open) state.mrOpenFiles.add(fp);
        else state.mrOpenFiles.delete(fp);
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-jump-diff-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.jumpDiffFile;
        const el = document.getElementById(`diff-file-${idx}`) as HTMLDetailsElement | null;
        if (el) {
          el.open = true;
          const fp = el.dataset.diffFp || "";
          if (fp) state.mrOpenFiles.add(fp);
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
        if (cb.checked) {
          state.mrViewedFiles.add(fp);
          state.mrOpenFiles.delete(fp);
        } else {
          state.mrViewedFiles.delete(fp);
          state.mrOpenFiles.add(fp);
        }
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
  else if (state.tab === "hackers") {
    root.innerHTML = renderHackersTab({
      overview: state.hackersOverview,
      loading: state.hackersLoading,
      error: state.hackersError,
      window: state.hackersWindow,
      lbTab: state.hackersLbTab,
      directory: state.hackersDirectory,
      dirSearch: state.hackersDirSearch,
      dirRole: state.hackersDirRole,
      dirSort: state.hackersDirSort,
    });
  } else if (state.tab === "lists") {
    root.innerHTML = renderListsTab({
      overview: state.listsOverview,
      loading: state.listsLoading,
      error: state.listsError,
      selectedList: state.listsSelected,
      search: state.listsSearch,
      attachmentsOnly: state.listsAttachmentsOnly,
      messages: state.listsMessages,
    });
  } else if (state.tab === "stats") root.innerHTML = renderStatsTab();
  else if (state.tab === "entries") root.innerHTML = renderEntriesTab();
  else if (state.tab === "opinions") root.innerHTML = renderOpinionsTab();
  else if (state.tab === "coordination") root.innerHTML = renderCoordinationTab();
  else if (state.tab === "contribute") {
    root.innerHTML = renderContributeTab({
      origin: window.location.origin,
      coverage: state.docsCoverage,
      coverageLoading: state.docsCoverageLoading,
      previewBackend: state.quotaPreviewBackend,
      previewStrategy: state.quotaPreviewStrategy,
      previewFlavour: state.quotaPreviewFlavour,
      previewLevel: state.quotaPreviewLevel,
      previewLoading: state.quotaPreviewLoading,
      previewError: state.quotaPreviewError,
      previewResult: state.quotaPreviewResult,
    });
  } else if (state.tab === "docs") {
    root.innerHTML = renderDocsTab({
      origin: window.location.origin,
      category: state.docsCategory,
      search: state.docsSearch,
      apiEndpointId: state.apiEndpointId,
      apiLang: state.apiLang,
      apiParams: state.apiParams,
      apiLiveStatus: state.apiLiveStatus,
      apiLiveOk: state.apiLiveOk,
      apiLiveMeta: state.apiLiveMeta,
      apiLiveBody: state.apiLiveBody,
      apiLiveLoading: state.apiLiveLoading,
    });
  } else if (state.tab === "about") {
    root.innerHTML = renderAboutTab();
  } else root.innerHTML = renderConnectTab();

  bindCliCopyButtons(root);

  if (state.tab === "about") {
    root.querySelectorAll<HTMLElement>("[data-about-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = (btn.getAttribute("data-about-nav") as TabId) || "brief";
        navigateToTab(target);
      });
    });
  }

  // Contribute tab events
  if (state.tab === "contribute") {
    bindPatchRowClicks(root);
    document.getElementById("contrib-jump-setup-btn")?.addEventListener("click", () => {
      document.getElementById("quota-setup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("contrib-refresh-btn")?.addEventListener("click", () => {
      void loadDocsCoverage(true);
    });
    document.getElementById("contrib-copy-prompt-btn")?.addEventListener("click", (ev) => {
      copyTextWithFeedback(ev.currentTarget as HTMLElement, buildQuotaAgentPrompt(window.location.origin), "Copy agent prompt");
    });
    document.getElementById("contrib-goto-backoffice-btn")?.addEventListener("click", () => {
      navigateToTab("connect");
    });
    document.getElementById("contrib-goto-docs-btn")?.addEventListener("click", () => {
      navigateToTab("docs", true, "#cli-reference");
    });
    document.getElementById("qp-backend")?.addEventListener("change", (ev) => {
      state.quotaPreviewBackend = (ev.target as HTMLSelectElement).value || "claude";
      render();
    });
    document.getElementById("qp-strategy")?.addEventListener("change", (ev) => {
      state.quotaPreviewStrategy = (ev.target as HTMLSelectElement).value || "unroasted-first";
      render();
    });
    document.getElementById("qp-flavour")?.addEventListener("change", (ev) => {
      state.quotaPreviewFlavour = (ev.target as HTMLSelectElement).value || "auto-by-subsystem";
      render();
    });
    document.getElementById("qp-level")?.addEventListener("change", (ev) => {
      state.quotaPreviewLevel = (ev.target as HTMLSelectElement).value || "medium";
      render();
    });
    document.getElementById("quota-preview-btn")?.addEventListener("click", () => {
      void runQuotaPreview();
    });
  }

  // Docs & All Features tab events
  if (state.tab === "docs") {
    const bindDocsCardActions = (container: HTMLElement | Document) => {
      container.querySelectorAll<HTMLButtonElement>("[data-docs-nav]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = (btn.dataset.docsNav as TabId) || "brief";
          navigateToTab(target);
        });
      });
      container.querySelectorAll<HTMLButtonElement>("[data-copy-snippet]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const text = btn.dataset.copySnippet || "";
          if (text) copyTextWithFeedback(btn, text, btn.textContent || "Copy");
        });
      });
    };
    bindDocsCardActions(root);

    const updateDocsFeaturesOnly = () => {
      const mount = document.getElementById("docs-feature-mount");
      if (!mount) return;
      mount.innerHTML = renderDocsFeatureCards(filterDocsFeatures(state.docsCategory, state.docsSearch));
      bindDocsCardActions(mount);
    };
    const docsSearchInput = document.getElementById("docs-feature-search") as HTMLInputElement | null;
    docsSearchInput?.addEventListener("input", () => {
      state.docsSearch = docsSearchInput.value;
      updateDocsFeaturesOnly();
    });
    document.querySelectorAll<HTMLButtonElement>("[data-docs-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.docsCategory = (btn.dataset.docsCat as DocsCategory) || "all";
        document.querySelectorAll<HTMLButtonElement>("[data-docs-cat]").forEach((b) => {
          b.classList.toggle("active", b.dataset.docsCat === state.docsCategory);
        });
        updateDocsFeaturesOnly();
      });
    });

    // Interactive CLI Playground builder
    const updateCliPlayground = () => {
      const cmd = (document.getElementById("pg-cli-cmd") as HTMLSelectElement | null)?.value || "contribute";
      const backend = (document.getElementById("pg-cli-backend") as HTMLSelectElement | null)?.value || "codex";
      const modelRaw = ((document.getElementById("pg-cli-model") as HTMLInputElement | null)?.value || "").trim();
      const flavour = (document.getElementById("pg-cli-flavour") as HTMLSelectElement | null)?.value || "default";
      const level = (document.getElementById("pg-cli-level") as HTMLSelectElement | null)?.value || "medium";
      const target = ((document.getElementById("pg-cli-target") as HTMLInputElement | null)?.value || "7508").trim() || "7508";

      const mMatch = modelRaw.match(/^(.+?):(low|medium|high|xhigh|max|ultra)$/i);
      const baseModel = mMatch ? mMatch[1]! : modelRaw;
      const effort = mMatch ? mMatch[2]!.toLowerCase() : "";
      const envPrefix =
        backend === "codex" && modelRaw
          ? `PGROAST_CODEX_MODEL=${modelRaw} `
          : backend === "claude" && baseModel && baseModel !== "opus"
            ? `PGROAST_ROASTER_MODEL=${baseModel} PGROAST_CRITIC_MODEL=${baseModel} `
            : backend === "agy" && baseModel
              ? `PGROAST_AGY_MODEL=${baseModel} `
              : "";

      let built = "";
      if (cmd === "roast") {
        const fl = flavour === "auto-by-subsystem" ? "default" : flavour;
        built = `${envPrefix}npx pgroast@next ${target} --backend ${backend} --roast-level ${level} --flavour ${fl}`;
      } else if (cmd === "contribute") {
        const qb = backend === "dual" ? "claude" : backend;
        built = `PGROAST_PUBLISH_TOKEN=pgroast_pub_YOUR_TOKEN npx pgroast@next contribute --once --backend ${qb}${baseModel ? ` --model ${baseModel}` : ""}${effort ? ` --effort ${effort}` : ""} --flavour ${flavour} --level ${level} --publish`;
      } else if (cmd === "batch") {
        const fl = flavour === "auto-by-subsystem" ? "default" : flavour;
        const cfNum = /^\d{1,3}$/.test(target) ? target : "62";
        built = `${envPrefix}npx pgroast@next batch ${cfNum} --out ./out/cf${cfNum} --status open --concurrency 3 --backend ${backend} --roast-level ${level} --flavour ${fl}`;
      } else if (cmd === "pushback") {
        built = `${envPrefix}npx pgroast@next pushback ${target} --backend ${backend}`;
      } else if (cmd === "shortlist") {
        built = `npx pgroast@next shortlist ./out/cf62 --top 20 --reject 50 --pg-repo ~/postgres`;
      } else if (cmd === "bugs") {
        built = `${envPrefix}npx pgroast@next bugs --days 14 --limit 30 --backend ${backend}`;
      } else {
        built = `PGROAST_PUBLISH_TOKEN=pgroast_pub_YOUR_TOKEN npx pgroast@next publish ./out/cf-${target}/roast.json`;
      }
      const outEl = document.getElementById("pg-cli-output");
      if (outEl) outEl.textContent = built;
    };
    ["pg-cli-cmd", "pg-cli-backend", "pg-cli-model", "pg-cli-flavour", "pg-cli-level", "pg-cli-target"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", updateCliPlayground);
      document.getElementById(id)?.addEventListener("input", updateCliPlayground);
    });
    document.getElementById("pg-cli-copy-btn")?.addEventListener("click", (ev) => {
      const txt = document.getElementById("pg-cli-output")?.textContent || "";
      if (txt) copyTextWithFeedback(ev.currentTarget as HTMLElement, txt, "Copy");
    });

    // Stripe-style 3-column Interactive API Reference
    const getActiveApiEp = () => API_ENDPOINTS.find((e) => e.id === state.apiEndpointId) || API_ENDPOINTS[0]!;
    const refreshStripeCodeOnly = () => {
      const ep = getActiveApiEp();
      const pre = document.getElementById("stripe-code-pre");
      const urlEl = document.getElementById("stripe-url-preview");
      if (pre) pre.textContent = buildApiCodeSnippet(ep, state.apiLang, window.location.origin, state.apiParams);
      if (urlEl) urlEl.textContent = `${ep.method} ${buildEndpointPath(ep, state.apiParams)}`;
    };
    document.querySelectorAll<HTMLButtonElement>("[data-api-select]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextId = btn.dataset.apiSelect || "health";
        if (nextId !== state.apiEndpointId) {
          state.apiEndpointId = nextId;
          state.apiParams = {};
          state.apiLiveStatus = "";
          state.apiLiveOk = null;
          state.apiLiveMeta = "";
          state.apiLiveBody = "";
          render();
        }
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-api-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.apiLang = (btn.dataset.apiLang as ApiLang) || "curl";
        document.querySelectorAll<HTMLButtonElement>("[data-api-lang]").forEach((b) => {
          b.classList.toggle("active", b.dataset.apiLang === state.apiLang);
        });
        refreshStripeCodeOnly();
      });
    });
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-api-param]").forEach((inp) => {
      const onChange = () => {
        const k = inp.getAttribute("data-api-param") || "";
        if (!k) return;
        state.apiParams[k] = inp.value;
        refreshStripeCodeOnly();
      };
      inp.addEventListener("input", onChange);
      inp.addEventListener("change", onChange);
    });
    document.getElementById("stripe-copy-code-btn")?.addEventListener("click", (ev) => {
      const txt = document.getElementById("stripe-code-pre")?.textContent || "";
      if (txt) copyTextWithFeedback(ev.currentTarget as HTMLElement, txt, "Copy");
    });
    document.getElementById("stripe-try-btn")?.addEventListener("click", async () => {
      const ep = getActiveApiEp();
      if (ep.method !== "GET") return;
      const targetPath = buildEndpointPath(ep, state.apiParams);
      state.apiLiveLoading = true;
      state.apiLiveBody = "Fetching live PostgreSQL response…";
      render();
      const t0 = performance.now();
      try {
        const res = await fetch(targetPath, { headers: { Accept: "application/json, text/plain" } });
        const ms = Math.round(performance.now() - t0);
        const raw = await res.text();
        let pretty = raw;
        try {
          pretty = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          // plain text
        }
        state.apiLiveStatus = `${res.status} ${res.statusText || (res.ok ? "OK" : "ERROR")}`;
        state.apiLiveOk = res.ok;
        state.apiLiveMeta = `${ms} ms · ${raw.length.toLocaleString()} B`;
        state.apiLiveBody = pretty.length > 20000 ? `${pretty.slice(0, 20000)}\n… (truncated ${pretty.length - 20000} bytes)` : pretty;
      } catch (err) {
        state.apiLiveStatus = "NETWORK ERROR";
        state.apiLiveOk = false;
        state.apiLiveMeta = "";
        state.apiLiveBody = err instanceof Error ? err.message : String(err);
      } finally {
        state.apiLiveLoading = false;
        render();
      }
    });
  }

  // Hackers Observatory tab events
  if (state.tab === "hackers") {
    bindHackerClicks(root);
    document.querySelectorAll<HTMLButtonElement>("[data-hacker-window]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextWin = (btn.dataset.hackerWindow as HackerWindow) || "1y";
        void loadHackersOverview(nextWin);
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-hacker-lb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.hackersLbTab = (btn.dataset.hackerLb as HackerLbKind) || "committers";
        render();
      });
    });
    const dirInput = document.getElementById("hacker-dir-search") as HTMLInputElement | null;
    dirInput?.addEventListener("input", () => {
      state.hackersDirSearch = dirInput.value;
      if (hackerDirTimer) clearTimeout(hackerDirTimer);
      hackerDirTimer = setTimeout(() => {
        void loadHackersDirectory(true);
      }, 200);
    });
    document.getElementById("hacker-dir-role")?.addEventListener("change", (ev) => {
      state.hackersDirRole = (ev.target as HTMLSelectElement).value || "all";
      void loadHackersDirectory(true);
    });
    document.getElementById("hacker-dir-sort")?.addEventListener("change", (ev) => {
      state.hackersDirSort = (ev.target as HTMLSelectElement).value || "activity";
      void loadHackersDirectory(true);
    });
  }

  // Mailing Lists Archive tab events
  if (state.tab === "lists") {
    bindHackerClicks(root);
    document.querySelectorAll<HTMLButtonElement>("[data-list-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.listsSelected = btn.dataset.listFilter || "all";
        render();
        void loadListsMessages(true);
      });
    });
    document.getElementById("lists-all-select")?.addEventListener("change", (ev) => {
      state.listsSelected = (ev.target as HTMLSelectElement).value || "all";
      render();
      void loadListsMessages(true);
    });
    document.getElementById("lists-att-only")?.addEventListener("change", (ev) => {
      state.listsAttachmentsOnly = (ev.target as HTMLInputElement).checked;
      void loadListsMessages(true);
    });
    const listInput = document.getElementById("lists-search-input") as HTMLInputElement | null;
    listInput?.addEventListener("input", () => {
      state.listsSearch = listInput.value;
      if (listsSearchTimer) clearTimeout(listsSearchTimer);
      listsSearchTimer = setTimeout(() => {
        void loadListsMessages(true);
      }, 200);
    });
  }

  // Stats tab events
  if (state.tab === "stats") {
    bindPatchRowClicks(root);
    bindHackerClicks(root);
    document.getElementById("stats-refresh-btn")?.addEventListener("click", () => void loadStatsOverview(true));
    document.querySelectorAll<HTMLButtonElement>("[data-stats-qfilter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.statsQueueFilter = (btn.dataset.statsQfilter as StatsQueueFilter) || "all";
        render();
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-stats-dfilter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.statsDarkFilter = (btn.dataset.statsDfilter as StatsDarkFilter) || "all";
        render();
      });
    });
    document.querySelectorAll<Element>("[data-stats-topic]").forEach((el) => {
      const activate = () => {
        const topic = (el.getAttribute("data-stats-topic") || "").split("/")[0]!.trim();
        jumpToEntries({ search: topic, verdict: "all", status: "all" });
      };
      el.addEventListener("click", activate);
      if (el.tagName.toLowerCase() !== "button") {
        el.addEventListener("keydown", (ev) => {
          const ke = ev as KeyboardEvent;
          if (ke.key === "Enter" || ke.key === " ") {
            ke.preventDefault();
            activate();
          }
        });
      }
    });
  }

  // Opinions tab events (search, depth/verdict/model filters, sort, pagination)
  if (state.tab === "opinions") {
    bindOpinionsListOnlyEvents();
    document.getElementById("opinions-goto-team-btn")?.addEventListener("click", () => navigateToTab("coordination"));
    const opSearch = document.getElementById("op-search-input") as HTMLInputElement | null;
    opSearch?.addEventListener("input", () => {
      state.opSearch = opSearch.value;
      state.opPage = 1;
      updateOpinionsListOnly();
    });
    document.getElementById("op-search-clear-btn")?.addEventListener("click", () => {
      state.opSearch = "";
      state.opPage = 1;
      if (opSearch) {
        opSearch.value = "";
        opSearch.focus();
      }
      updateOpinionsListOnly();
    });
    document.getElementById("op-model-select")?.addEventListener("change", (ev) => {
      state.opModel = (ev.target as HTMLSelectElement).value || "all";
      state.opPage = 1;
      updateOpinionsListOnly();
    });
    document.getElementById("op-sort-select")?.addEventListener("change", (ev) => {
      state.opSort = ((ev.target as HTMLSelectElement).value as typeof state.opSort) || "newest";
      state.opPage = 1;
      updateOpinionsListOnly();
    });
    document.querySelectorAll<HTMLButtonElement>("[data-op-level]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.opLevel = ((btn.dataset.opLevel as typeof state.opLevel) || "all");
        state.opPage = 1;
        render();
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-op-verdict]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.opVerdict = btn.dataset.opVerdict || "all";
        state.opPage = 1;
        render();
      });
    });
  }

  // Coordination tab row links
  if (state.tab === "coordination") {
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

  document.querySelectorAll<Element>("[data-mx-status]").forEach((el) => {
    const activate = () => {
      jumpToEntries({
        status: el.getAttribute("data-mx-status") || "all",
        verdict: el.getAttribute("data-mx-verdict") || "all",
        search: "",
      });
    };
    el.addEventListener("click", activate);
    if (el.tagName.toLowerCase() !== "button") {
      el.addEventListener("keydown", (ev) => {
        const ke = ev as KeyboardEvent;
        if (ke.key === "Enter" || ke.key === " ") {
          ke.preventDefault();
          activate();
        }
      });
    }
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
        render();
      });
    });
    document.getElementById("clear-custom-status-chip")?.addEventListener("click", () => {
      state.entryStatus = "all";
      state.entryLimit = 60;
      render();
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
  const installPromptText = buildBackofficeInstallPrompt();
  document.getElementById("connect-copy-prompt-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, installPromptText, "Copy AI Agent Install Prompt");
  });
  document.getElementById("connect-copy-prompt-card-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, installPromptText, "Copy prompt");
  });
  document.getElementById("connect-copy-cmd-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, "bun run app:local", "Copy start cmd");
  });
  document.getElementById("dev-copy-token-btn")?.addEventListener("click", (ev) => {
    copyTextWithFeedback(ev.currentTarget as HTMLElement, state.mintedToken, "Copy token");
  });
  document.getElementById("dev-mint-btn")?.addEventListener("click", async () => {
    const provider = (document.getElementById("dev-prov") as HTMLSelectElement).value;
    const handle = (document.getElementById("dev-handle") as HTMLInputElement).value.trim();
    const name = (document.getElementById("dev-name") as HTMLInputElement).value.trim();
    if (!handle) {
      state.devMintError = "Please enter a handle first.";
      render();
      return;
    }
    state.devMintError = "";
    try {
      const res = await api<{ token: string; contributor: { handle: string } }>("/api/v1/tokens/dev", {
        method: "POST",
        body: JSON.stringify({ provider, handle, name: name || handle }),
      });
      state.mintedToken = res.token;
      state.mintedHandle = res.contributor.handle;
    } catch (err) {
      state.devMintError = err instanceof Error ? err.message : String(err);
    }
    render();
  });
}

/* ---- Global Shell Listeners ---- */
document.querySelectorAll<HTMLButtonElement>("#web-nav .nav-link[data-tab], #web-bottom-nav .btab[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab as TabId | undefined;
    if (tab) navigateToTab(tab);
  });
});

document.getElementById("web-backoffice-top-btn")?.addEventListener("click", () => {
  navigateToTab("connect");
});

document.getElementById("web-home-btn")?.addEventListener("click", () => {
  navigateToTab("brief");
});

document.getElementById("footer-about-link")?.addEventListener("click", (ev) => {
  ev.preventDefault();
  navigateToTab("about");
});

document.getElementById("web-main")?.addEventListener("click", (ev) => {
  const trigger = (ev.target as Element | null)?.closest<HTMLElement>("[data-open-about]");
  if (!trigger) return;
  ev.preventDefault();
  ev.stopPropagation();
  const hash = trigger.getAttribute("data-open-about") || "";
  navigateToTab("about", true, hash);
});

document.getElementById("footer-contribute-link")?.addEventListener("click", (ev) => {
  ev.preventDefault();
  navigateToTab("contribute");
});

document.getElementById("footer-docs-link")?.addEventListener("click", (ev) => {
  ev.preventDefault();
  navigateToTab("docs");
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
const DEFAULT_DAY_THEME = "paper";
const DEFAULT_NIGHT_THEME = "espresso";

let webThemeMode: string = "system";
let webDayTheme: string = DEFAULT_DAY_THEME;
let webNightTheme: string = DEFAULT_NIGHT_THEME;
const systemDarkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function isSystemNight(): boolean {
  if (systemDarkMq) return systemDarkMq.matches;
  return false;
}

function getResolvedWebTheme(): string {
  if (webThemeMode === "system") {
    return isSystemNight() ? webNightTheme : webDayTheme;
  }
  return validWebThemeIds.has(webThemeMode) ? webThemeMode : DEFAULT_DAY_THEME;
}

function renderWebThemeMenu(): void {
  const menu = document.getElementById("web-theme-menu");
  if (!menu) return;
  const isSys = webThemeMode === "system";
  const dayInfo = WEB_THEMES.find((t) => t.id === webDayTheme) || WEB_THEMES[2]!;
  const nightInfo = WEB_THEMES.find((t) => t.id === webNightTheme) || WEB_THEMES[3]!;
  const nowLabel = isSystemNight() ? "Night" : "Day";
  const optsHtml = (selected: string) =>
    WEB_THEMES.map((t) => `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.label)}</option>`).join("");

  menu.innerHTML =
    `<div class="theme-menu-head">Appearance</div>` +
    `<button type="button" class="theme-opt ${isSys ? "active" : ""}" role="menuitemradio" aria-checked="${isSys}" data-pick-theme="system">` +
    `<span class="theme-swatch" style="background:linear-gradient(135deg,${dayInfo.bg} 50%,${nightInfo.bg} 50%);"><span class="theme-swatch-accent" style="background:${isSystemNight() ? nightInfo.accent : dayInfo.accent};"></span></span>` +
    `<span>System <span class="dim" style="font-size:11px;">(${nowLabel})</span></span>` +
    `${isSys ? `<span class="theme-check">✓</span>` : ""}` +
    `</button>` +
    `<div class="theme-sys-box">` +
    `<label class="theme-sys-row"><span>☀ Day</span><select id="web-theme-day-sel" aria-label="Day theme">${optsHtml(webDayTheme)}</select></label>` +
    `<label class="theme-sys-row"><span>☾ Night</span><select id="web-theme-night-sel" aria-label="Night theme">${optsHtml(webNightTheme)}</select></label>` +
    `</div>` +
    `<div class="theme-menu-divider"></div>` +
    `<div class="theme-menu-head">Fixed Theme</div>` +
    WEB_THEMES.map(
      (t) => `
      <button type="button" class="theme-opt ${!isSys && t.id === webThemeMode ? "active" : ""}" role="menuitemradio" aria-checked="${!isSys && t.id === webThemeMode}" data-pick-theme="${t.id}">
        <span class="theme-swatch" style="background:${t.bg};"><span class="theme-swatch-accent" style="background:${t.accent};"></span></span>
        <span>${esc(t.label)}</span>
        ${!isSys && t.id === webThemeMode ? `<span class="theme-check">✓</span>` : ""}
      </button>
    `,
    ).join("");
}

function applyWebTheme(modeOrId: string, persist = true): void {
  webThemeMode = modeOrId === "system" || validWebThemeIds.has(modeOrId) ? modeOrId : "system";
  const resolved = getResolvedWebTheme();
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.getElementById("meta-theme-color");
  const info = WEB_THEMES.find((t) => t.id === resolved);
  if (meta && info) meta.setAttribute("content", info.bg);
  if (persist) {
    try {
      localStorage.setItem("pgroast-web-theme", webThemeMode);
      localStorage.setItem("pgroast-web-theme-day", webDayTheme);
      localStorage.setItem("pgroast-web-theme-night", webNightTheme);
    } catch {
      // ignore private browsing storage errors
    }
  }
  renderWebThemeMenu();
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
  if (opening) renderWebThemeMenu();
  menu.hidden = !opening;
  btn?.setAttribute("aria-expanded", String(opening));
});

document.getElementById("web-theme-menu")?.addEventListener("click", (ev) => {
  ev.stopPropagation();
  const pick = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-pick-theme]");
  if (!pick?.dataset.pickTheme) return;
  applyWebTheme(pick.dataset.pickTheme, true);
  if (pick.dataset.pickTheme !== "system") closeThemeMenu();
});

document.getElementById("web-theme-menu")?.addEventListener("change", (ev) => {
  ev.stopPropagation();
  const target = ev.target as HTMLSelectElement;
  if (target.id === "web-theme-day-sel" && validWebThemeIds.has(target.value)) {
    webDayTheme = target.value;
    applyWebTheme("system", true);
  } else if (target.id === "web-theme-night-sel" && validWebThemeIds.has(target.value)) {
    webNightTheme = target.value;
    applyWebTheme("system", true);
  }
});

systemDarkMq?.addEventListener?.("change", () => {
  if (webThemeMode === "system") applyWebTheme("system", false);
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
    void openPatchPage(route.patchId, false, route.mrTab);
  } else if (route.hackerSlug) {
    void openHackerProfile(route.hackerSlug, false);
  } else {
    state.activePatchId = null;
    state.patchData = null;
    state.activeHackerSlug = null;
    state.hackerProfile = null;
    state.tab = route.tab;
    syncTopBackofficeLink();
    document.title =
      route.tab === "hackers"
        ? "PostgreSQL Hacking Observatory — pgroast"
        : route.tab === "lists"
          ? "PostgreSQL Mailing Lists Archive — pgroast"
          : route.tab === "contribute"
            ? "Weekly Quota Auto-Contribute — pgroast"
            : route.tab === "docs"
              ? "Docs & Complete Feature Catalog — pgroast"
              : route.tab === "about"
                ? "About pgroast — What Roasting PostgreSQL Patches Means"
                : "pgroast — Public CommitFest App";
    render();
    if (route.tab === "hackers") {
      if (!state.hackersOverview && !state.hackersLoading) void loadHackersOverview();
      if (state.hackersDirectory.length === 0) void loadHackersDirectory();
    } else if (route.tab === "lists") {
      if (!state.listsOverview && !state.listsLoading) void loadListsOverview();
      if (state.listsMessages.length === 0) void loadListsMessages();
    } else if (route.tab === "contribute") {
      void loadDocsCoverage();
    } else if (route.tab === "stats") {
      void loadStatsOverview();
    }
  }
});

document.getElementById("web-mobile-more-btn")?.addEventListener("click", () => openMoreSheet());
document.getElementById("more-close-btn")?.addEventListener("click", () => closeMoreSheet());
document.getElementById("more-backdrop")?.addEventListener("click", (ev) => {
  if (ev.target === ev.currentTarget) closeMoreSheet();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    closeSpaceSwitcher();
    closeMoreSheet();
    closeThemeMenu();
  }
});

// Restore saved or system theme on load (default: System -> Warm Paper at day, Espresso at night)
try {
  const savedDay = localStorage.getItem("pgroast-web-theme-day");
  const savedNight = localStorage.getItem("pgroast-web-theme-night");
  if (savedDay && validWebThemeIds.has(savedDay)) webDayTheme = savedDay;
  if (savedNight && validWebThemeIds.has(savedNight)) webNightTheme = savedNight;
  const saved = localStorage.getItem("pgroast-web-theme");
  if (saved && (saved === "system" || validWebThemeIds.has(saved))) {
    applyWebTheme(saved, false);
  } else {
    applyWebTheme("system", false);
  }
} catch {
  applyWebTheme("system", false);
}

initVizInteractions();
void loadAll();
