import type {
  AllGatesResult,
  AppSettings,
  AuditLogRecord,
  BugReportRecord,
  CfAuthStatus,
  CfEntryListItem,
  CfEntryRecord,
  ContributorIdentity,
  DiffCommentRecord,
  DoctorCheckItem,
  DraftAttachment,
  DraftRecord,
  EntryTriageRecord,
  ExpertSuggestion,
  GmailThreadMatch,
  JobRecord,
  RoastJson,
  RoastObjection,
  RoastRunRecord,
  SavedSearchRecord,
  ShortlistEntry,
  StatsReport,
  Top50RejectEntry,
  WorkItemRecord,
} from "../types.ts";

type ViewId = "shortlist" | "stats" | "explorer" | "workbench" | "bugs" | "work_items" | "jobs" | "settings";
type WorkbenchTab = "roast" | "diff" | "build" | "reply" | "cf_fork";

interface PatchDiffFileUi {
  oldPath: string;
  newPath: string;
  additions: number;
  deletions: number;
  hunks: Array<{
    header: string;
    lines: Array<{ type: "ctx" | "add" | "del"; oldLine: number | null; newLine: number | null; content: string }>;
  }>;
}

interface PatchDiffUi {
  cfId: number;
  source: string;
  compareUrl: string;
  files: PatchDiffFileUi[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
}

interface AppState {
  view: ViewId;
  stats: Record<string, number>;
  settings: AppSettings | null;
  identity: ContributorIdentity | null;
  cfAuth: CfAuthStatus | null;
  hubStatus: { url: string; hasToken: boolean } | null;

  shortlistTab: "top20" | "top50";
  shortlistKindFilter: "all" | "bugfix" | "feature" | "prod" | "my_topics";
  shortlist: ShortlistEntry[];
  top50Closing: Top50RejectEntry[];
  shortlistSearch: string;

  entries: CfEntryListItem[];
  entriesTotal: number;
  explorerSearch: string;
  explorerVerdict: string;
  explorerStatus: string;
  explorerMine: boolean;
  explorerStarred: boolean;
  explorerSort: string;
  savedSearchPresets: Array<{ id: string; name: string; query: string; description: string }>;
  customSavedSearches: SavedSearchRecord[];

  statsReport: StatsReport | null;

  selectedCfId: number | null;
  workbenchTab: WorkbenchTab;
  roastLevel: "light" | "medium" | "dark";
  roastFlavour: string;
  diffData: PatchDiffUi | null;
  diffComments: DiffCommentRecord[];
  diffLoading: boolean;
  diffError: string;
  detail: {
    entry: CfEntryRecord;
    roast: RoastJson | null;
    experts: ExpertSuggestion[];
    lightRoast?: {
      cf_id: number;
      title: string;
      checks: Array<{ id: string; label: string; status: "ok" | "check" | "warn"; detail: string }>;
      experimentalHeadsUp: string[];
      workaround: string;
      markdown: string;
    };
    runs?: RoastRunRecord[];
    triage?: EntryTriageRecord;
    workItems: WorkItemRecord[];
    drafts: DraftRecord[];
    jobs: JobRecord[];
  } | null;

  activeDraft: {
    id: number | null;
    isReply: boolean;
    isOtherAuthorThread: boolean;
    threadId: string;
    inReplyTo: string;
    referencesHeader: string;
    to: string;
    cc: string;
    subject: string;
    body: string;
    attachments: DraftAttachment[];
    gates: AllGatesResult | null;
    gmailMatches: GmailThreadMatch[];
    gmailDraftUrl: string;
  };

  bugs: BugReportRecord[];
  bugClassFilter: string;
  bugSeverityFilter: string;

  jobs: JobRecord[];
  jobsTab: "work_items" | "jobs";
  workItems: WorkItemRecord[];
  focusedWorkItemId: number | null;
  openConsoleIds: string[];
  activeConsoleId: string | null;
  consoles: Record<string, { job: JobRecord; log: string; unread: boolean; done: boolean }>;
  drawerMode: "normal" | "minimized" | "maximized";
  drawerHeight: number;

  doctorChecks: DoctorCheckItem[];
  auditLogs: AuditLogRecord[];
  aiSummary: {
    available: Array<"claude" | "codex" | "agy">;
    dualReady: boolean;
    recommendedDefault: string;
  } | null;
  skillsSummary: {
    mode: "builtin" | "custom";
    count: number;
    names?: string[];
    customDir: string;
    customDirValid: boolean;
  } | null;
  onboardingStep: number;
  onboardingSkillsMode: "builtin" | "custom";
  contributeData: {
    configPath: string;
    config: {
      hubUrl: string;
      autoPublish: boolean;
      strategy: string;
      roastLevel: string;
      roastFlavour: string;
      topics: string[];
      backends: Record<
        "claude" | "codex" | "agy",
        { enabled: boolean; resetDayUtc: string; resetHourUtc: number; windowHoursBeforeReset: number; maxPatchesPerWindow: number }
      >;
    };
    windows: Record<string, { nextResetAt: string; hoursUntilReset: number; inWindow: boolean; windowKey: string; countdownLabel: string; used: number; cap: number }>;
    history: Array<{ at: string; cfId: number; title: string; backend: string; flavour: string; level: string; verdict: string; published: boolean; error?: string }>;
    coverage: {
      totalOpen: number;
      baselineRoastedOpen: number;
      opinionsTotal: number;
      openWith1PlusOpinion: number;
      openWith2PlusOpinions: number;
      unroastedOpen: number;
      activeLeases: Array<{ cf_id: number; backend: string }>;
    } | null;
  } | null;
  contributePreview: {
    backend: string;
    preview: {
      patch: { cf_id: number; title: string; status: string; topic: string } | null;
      suggestedFlavour: string;
      suggestedLevel: string;
      reason: string;
    };
  } | null;

  bulkRoast: {
    mode: "queue" | "batch";
    backend: "codex" | "claude" | "agy" | "dual";
    model: string;
    effort: string;
    strategy: "unroasted-first" | "ready-for-committer" | "cross-model-second-opinion";
    flavour: string;
    level: "light" | "medium" | "dark";
    count: number;
    workers: number;
    publish: boolean;
    cfNumber: number;
    status: string;
  };

  loading: {
    shortlist: boolean;
    stats: boolean;
    explorer: boolean;
    detail: boolean;
    bugs: boolean;
    jobs: boolean;
    settings: boolean;
  };
  loadingMessage: string;
}

const state: AppState = {
  view: "shortlist",
  stats: {},
  settings: null,
  identity: null,
  cfAuth: null,
  hubStatus: null,

  shortlistTab: "top20",
  shortlistKindFilter: "all",
  shortlist: [],
  top50Closing: [],
  shortlistSearch: "",

  entries: [],
  entriesTotal: 0,
  explorerSearch: "",
  explorerVerdict: "all",
  explorerStatus: "all",
  explorerMine: false,
  explorerStarred: false,
  explorerSort: "score",
  savedSearchPresets: [],
  customSavedSearches: [],

  statsReport: null,

  selectedCfId: null,
  workbenchTab: "roast",
  roastLevel: (["light", "medium", "dark"].includes(localStorage.getItem("pgroast-roast-level") || "")
    ? (localStorage.getItem("pgroast-roast-level") as "light" | "medium" | "dark")
    : "medium"),
  roastFlavour: localStorage.getItem("pgroast-roast-flavour") || "default",
  diffData: null,
  diffComments: [],
  diffLoading: false,
  diffError: "",
  detail: null,

  activeDraft: {
    id: null,
    isReply: true,
    isOtherAuthorThread: true,
    threadId: "",
    inReplyTo: "",
    referencesHeader: "",
    to: "pgsql-hackers@lists.postgresql.org",
    cc: "",
    subject: "",
    body: "",
    attachments: [],
    gates: null,
    gmailMatches: [],
    gmailDraftUrl: "",
  },

  bugs: [],
  bugClassFilter: "all",
  bugSeverityFilter: "all",

  jobs: [],
  jobsTab: "work_items",
  workItems: [],
  focusedWorkItemId: null,
  openConsoleIds: [],
  activeConsoleId: null,
  consoles: {},
  drawerMode: "normal",
  drawerHeight: 260,

  doctorChecks: [],
  auditLogs: [],
  aiSummary: null,
  skillsSummary: null,
  onboardingStep: 1,
  onboardingSkillsMode: "builtin",
  contributeData: null,
  contributePreview: null,
  bulkRoast: {
    mode: "queue",
    backend: "codex",
    model: "gpt-6.2-astra",
    effort: "xhigh",
    strategy: "unroasted-first",
    flavour: "default",
    level: "dark",
    count: 150,
    workers: 2,
    publish: true,
    cfNumber: 62,
    status: "open",
  },

  loading: {
    shortlist: true,
    stats: false,
    explorer: false,
    detail: false,
    bugs: false,
    jobs: false,
    settings: false,
  },
  loadingMessage: "Loading…",
};

const jobStreams = new Map<string, EventSource>();

// ---------------- Helpers ----------------

function esc(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class ApiRequestError extends Error {
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly hint: string;
  readonly details: string;

  constructor(opts: { message: string; method: string; url: string; status: number | null; hint: string; details: string }) {
    super(opts.message);
    this.name = "ApiRequestError";
    this.method = opts.method;
    this.url = opts.url;
    this.status = opts.status;
    this.hint = opts.hint;
    this.details = opts.details;
  }
}

function classifyApiError(method: string, url: string, status: number | null, raw: string): ApiRequestError {
  if (status === null) {
    return new ApiRequestError({
      message: `Cannot reach local pgroast-app server (${method} ${url})`,
      method,
      url,
      status: null,
      hint: "The local server may have restarted, stopped, or timed out while syncing. Click Retry, or check that `bun run app:local` is running on 127.0.0.1:3432.",
      details: `${method} ${url}\nNetwork error: ${raw || "Failed to fetch"}`,
    });
  }
  let hint = "Inspect the technical details below and retry.";
  if (status === 401 || status === 403) {
    hint = "Authentication required or expired. Check your CommitFest cookies or CLI login in Settings & Health.";
  } else if (status === 404) {
    hint = "Resource or route was not found. Refresh the page if the server was recently updated.";
  } else if (status >= 500) {
    if (/commitfest\.postgresql\.org|ECONN|ETIMEDOUT|HTTP 5\d\d|HTTP 4\d\d/i.test(raw)) {
      hint = "Upstream service (commitfest.postgresql.org or postgresql.org) returned an error or timed out. Wait a few seconds and click Retry.";
    } else if (/gws|gmail/i.test(raw)) {
      hint = "Gmail CLI (`gws`) failed. Run `gws auth login --scopes gmail.modify` and re-check Doctor in Settings.";
    } else {
      hint = "The local backend hit an error. Expand Details below or check Settings & Health (Doctor).";
    }
  }
  return new ApiRequestError({
    message: raw ? raw.slice(0, 140) : `Request failed (HTTP ${status})`,
    method,
    url,
    status,
    hint,
    details: `${method} ${url}\nHTTP ${status}\n${raw || "(empty response)"}`,
  });
}

function bootstrapLocalSessionToken(): string {
  try {
    const u = new URL(window.location.href);
    const fromUrl = u.searchParams.get("token");
    if (fromUrl) {
      sessionStorage.setItem("pgroast-session-token", fromUrl);
      u.searchParams.delete("token");
      window.history.replaceState({}, "", u.pathname + (u.search ? u.search : "") + u.hash);
      return fromUrl;
    }
    const meta = document.querySelector<HTMLMetaElement>('meta[name="pgroast-session-token"]')?.content?.trim();
    if (meta) {
      sessionStorage.setItem("pgroast-session-token", meta);
      return meta;
    }
    return sessionStorage.getItem("pgroast-session-token") || "";
  } catch {
    return "";
  }
}

const LOCAL_SESSION_TOKEN = bootstrapLocalSessionToken();

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  let res: Response;
  const authHeaders: Record<string, string> = LOCAL_SESSION_TOKEN
    ? { Authorization: `Bearer ${LOCAL_SESSION_TOKEN}` }
    : {};
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...authHeaders, ...(init?.headers || {}) },
      ...init,
    });
  } catch (err) {
    throw classifyApiError(method, url, null, err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text };
  }
  if (!res.ok) {
    const errObj = parsed as { error?: string };
    const msg = errObj.error || text || `HTTP ${res.status}`;
    // If the local server restarted while this tab was open, reload once cleanly to pick up the new per-boot token
    if (res.status === 401 && /localhost session token/i.test(msg)) {
      const lastReload = Number(sessionStorage.getItem("pgroast-token-reload-ts") || "0");
      if (Date.now() - lastReload > 5000) {
        sessionStorage.setItem("pgroast-token-reload-ts", String(Date.now()));
        sessionStorage.removeItem("pgroast-session-token");
        window.location.reload();
      }
    }
    throw classifyApiError(method, url, res.status, msg);
  }
  return parsed as T;
}

function setTopProgress(): void {
  const bar = document.getElementById("topbar-progress");
  if (!bar) return;
  const busy = Object.values(state.loading).some(Boolean);
  bar.hidden = !busy;
}

function renderLoader(label: string): string {
  return `<div class="loader-state"><span class="spinner"></span><span>${esc(label)}</span></div>`;
}

function toast(
  msg: string,
  kind: "ok" | "error" | "warn" | "info" = "info",
  opts?: { hint?: string; details?: string; onRetry?: () => void; actionLabel?: string; onAction?: () => void; durationMs?: number },
): void {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const hintHtml = opts?.hint ? `<div class="toast-hint">${esc(opts.hint)}</div>` : "";
  const detailsHtml = opts?.details
    ? `<details class="toast-details"><summary>Technical details</summary><pre>${esc(opts.details)}</pre></details>`
    : "";
  const hasActions = Boolean(opts?.onRetry || (opts?.actionLabel && opts?.onAction));
  const actionsHtml = hasActions
    ? `<div class="toast-actions">
        ${opts?.actionLabel && opts?.onAction ? `<button type="button" class="btn btn-primary btn-sm" data-toast-action="1">${esc(opts.actionLabel)}</button>` : ""}
        ${opts?.onRetry ? `<button type="button" class="btn btn-secondary btn-sm" data-toast-retry="1">Retry</button>` : ""}
      </div>`
    : "";
  el.innerHTML = `
    <div class="toast-head">
      <div class="toast-title">${esc(msg)}</div>
      <button type="button" class="drawer-tab-close" data-toast-close="1" title="Dismiss" aria-label="Dismiss">×</button>
    </div>
    ${hintHtml}
    ${detailsHtml}
    ${actionsHtml}
  `;
  stack.appendChild(el);

  const dismissMs = opts?.durationMs ?? (kind === "error" ? 14000 : opts?.onAction ? 9000 : 4800);
  const timer = setTimeout(() => el.remove(), dismissMs);
  el.querySelector("[data-toast-close]")?.addEventListener("click", () => {
    clearTimeout(timer);
    el.remove();
  });
  el.querySelector("[data-toast-retry]")?.addEventListener("click", () => {
    clearTimeout(timer);
    el.remove();
    opts?.onRetry?.();
  });
  el.querySelector("[data-toast-action]")?.addEventListener("click", () => {
    clearTimeout(timer);
    el.remove();
    opts?.onAction?.();
  });
}

function toastError(err: unknown, context?: string, onRetry?: () => void): void {
  if (err instanceof ApiRequestError) {
    toast(context ? `${context}: ${err.message}` : err.message, "error", {
      hint: err.hint,
      details: err.details,
      onRetry,
    });
    return;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const isNet = /failed to fetch|load failed|networkerror/i.test(raw);
  toast(
    context ? `${context}: ${isNet ? "Cannot reach local server" : raw}` : isNet ? "Cannot reach local server" : raw,
    "error",
    {
      hint: isNet
        ? "The local server may have restarted or stopped. Click Retry, or verify `bun run app:local` is running."
        : "Expand details below to see the exact error.",
      details: raw,
      onRetry,
    },
  );
}

function humanVerdictLabel(verdict: string): string {
  if (!verdict || verdict === "UNROASTED") return "Not roasted";
  if (verdict === "NO-FUNDAMENTAL-OBJECTION") return "No fundamental objection";
  if (verdict === "NEEDS-COMMITTER-EYES") return "Needs committer eyes";
  if (verdict === "NEEDS-DESIGN-DISCUSSION") return "Needs design discussion";
  if (verdict === "LIKELY-REJECT") return "Likely reject";
  return verdict;
}

function verdictPill(verdict: string): string {
  if (!verdict || verdict === "UNROASTED") return `<span class="pill pill-neutral">Not roasted</span>`;
  if (verdict === "NO-FUNDAMENTAL-OBJECTION") return `<span class="pill pill-ok">No fundamental objection</span>`;
  if (verdict === "NEEDS-COMMITTER-EYES") return `<span class="pill pill-info">Needs committer eyes</span>`;
  if (verdict === "NEEDS-DESIGN-DISCUSSION") return `<span class="pill pill-warn">Needs design discussion</span>`;
  if (verdict === "LIKELY-REJECT") return `<span class="pill pill-danger">Likely reject</span>`;
  return `<span class="pill pill-neutral">${esc(verdict)}</span>`;
}

function cfbotPill(status: string): string {
  if (!status) return `<span class="dim">—</span>`;
  if (status === "passing") return `<span class="pill pill-ok">cfbot pass</span>`;
  if (status === "needs_rebase") return `<span class="pill pill-warn">needs rebase</span>`;
  if (status === "failing") return `<span class="pill pill-danger">cfbot fail</span>`;
  return `<span class="pill pill-neutral">${esc(status)}</span>`;
}

function jobStatusPill(status: string): string {
  if (status === "succeeded") return `<span class="pill pill-ok">succeeded</span>`;
  if (status === "running") return `<span class="pill pill-info">running</span>`;
  if (status === "failed") return `<span class="pill pill-danger">failed</span>`;
  if (status === "cancelled") return `<span class="pill pill-warn">cancelled</span>`;
  return `<span class="pill pill-neutral">${esc(status)}</span>`;
}

function inferObjectionNovelty(obj: RoastObjection): "new" | "revisits_precedent" | "open_in_thread" {
  if (obj.novelty === "new" || obj.novelty === "revisits_precedent" || obj.novelty === "open_in_thread") {
    return obj.novelty;
  }
  const hasPrecedent = (obj.precedent_ids?.length ?? 0) > 0 || (obj.precedents?.length ?? 0) > 0;
  if (hasPrecedent) return "revisits_precedent";
  if ((obj.thread_message_refs?.length ?? 0) <= 1) return "new";
  return "open_in_thread";
}

function showConfirmModal(opts: {
  title: string;
  bodyHtml: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}): void {
  const backdrop = document.getElementById("modal-backdrop")!;
  const titleEl = document.getElementById("modal-title")!;
  const bodyEl = document.getElementById("modal-body")!;
  const footerEl = document.getElementById("modal-footer")!;

  titleEl.textContent = opts.title;
  bodyEl.innerHTML = opts.bodyHtml;
  footerEl.innerHTML = `
    <button class="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
    <button class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" id="modal-confirm-btn">${esc(opts.confirmLabel)}</button>
  `;
  backdrop.hidden = false;

  const close = () => {
    backdrop.hidden = true;
  };
  document.getElementById("modal-cancel-btn")?.addEventListener("click", close);
  document.getElementById("modal-close-x")?.addEventListener("click", close);
  document.getElementById("modal-confirm-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("modal-confirm-btn") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      await opts.onConfirm();
      close();
    } catch (err) {
      toastError(err);
      if (btn) btn.disabled = false;
    }
  });
}

// ---------------- Live SSE Job Streaming (Multi-Console Drawer) ----------------

function applyDrawerLayout(): void {
  const drawer = document.getElementById("log-drawer");
  if (!drawer) return;
  drawer.classList.toggle("minimized", state.drawerMode === "minimized");
  drawer.classList.toggle("maximized", state.drawerMode === "maximized");
  if (state.drawerMode === "normal") {
    drawer.style.height = `${state.drawerHeight}px`;
  } else {
    drawer.style.height = "";
  }

  const minBtn = document.getElementById("drawer-minimize-btn");
  if (minBtn) {
    minBtn.textContent = state.drawerMode === "minimized" ? "▲" : "—";
    minBtn.title = state.drawerMode === "minimized" ? "Restore console" : "Minimize console";
  }
  const maxBtn = document.getElementById("drawer-maximize-btn");
  if (maxBtn) {
    maxBtn.textContent = state.drawerMode === "maximized" ? "⤡" : "⤢";
    maxBtn.title = state.drawerMode === "maximized" ? "Restore console size" : "Maximize console";
  }
}

function updateLogsButtonLabel(): void {
  const btn = document.getElementById("toggle-drawer-btn");
  if (!btn) return;
  const count = state.openConsoleIds.length;
  btn.textContent = count > 0 ? `Logs (${count})` : "Logs";
}

function renderDrawer(scrollToBottom = false): void {
  const tabsEl = document.getElementById("drawer-tabs");
  const term = document.getElementById("drawer-terminal");
  const titleEl = document.getElementById("drawer-job-title");
  const idEl = document.getElementById("drawer-job-id");
  const statusEl = document.getElementById("drawer-job-status");
  const cancelBtn = document.getElementById("drawer-cancel-btn");
  const clearDoneBtn = document.getElementById("drawer-clear-done-btn");
  if (!tabsEl || !term || !titleEl || !idEl || !statusEl || !cancelBtn) return;

  applyDrawerLayout();
  updateLogsButtonLabel();

  if (state.openConsoleIds.length === 0) {
    tabsEl.innerHTML = `<span class="muted" style="padding:0 6px;font-size:11.5px;">No open consoles</span>`;
    titleEl.textContent = "Live Job Terminal";
    idEl.textContent = "";
    statusEl.textContent = "idle";
    statusEl.className = "pill pill-neutral";
    cancelBtn.hidden = true;
    if (clearDoneBtn) clearDoneBtn.hidden = true;
    term.textContent = "Launch any action or open a job from Jobs & Live Logs to inspect its output.";
    return;
  }

  if (!state.activeConsoleId || !state.consoles[state.activeConsoleId]) {
    state.activeConsoleId = state.openConsoleIds[state.openConsoleIds.length - 1] ?? null;
  }

  tabsEl.innerHTML = state.openConsoleIds
    .map((id) => {
      const c = state.consoles[id];
      if (!c) return "";
      const active = id === state.activeConsoleId;
      const shortTitle = c.job.title.length > 34 ? `${c.job.title.slice(0, 33)}…` : c.job.title;
      return `
        <div class="drawer-tab ${active ? "active" : ""}" data-console-tab="${esc(id)}" role="tab" aria-selected="${active}" title="${esc(c.job.title)} (${esc(c.job.status)})">
          <span class="drawer-tab-dot ${esc(c.job.status)}"></span>
          <span class="drawer-tab-label">${esc(shortTitle)}</span>
          ${c.unread && !active ? `<span class="drawer-tab-unread" title="New output"></span>` : ""}
          <button class="drawer-tab-close" data-console-close="${esc(id)}" title="Close console tab" aria-label="Close tab">×</button>
        </div>
      `;
    })
    .join("");

  const active = state.activeConsoleId ? state.consoles[state.activeConsoleId] : null;
  if (active) {
    active.unread = false;
    titleEl.textContent = active.job.title;
    idEl.textContent = active.job.id;
    statusEl.textContent = active.job.status;
    statusEl.className = `pill ${
      active.job.status === "succeeded"
        ? "pill-ok"
        : active.job.status === "failed"
          ? "pill-danger"
          : active.job.status === "cancelled"
            ? "pill-warn"
            : "pill-info"
    }`;
    cancelBtn.hidden = !(active.job.status === "running" || active.job.status === "queued");

    const nearBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 48;
    term.textContent = active.log || (active.done ? "(no output)" : "Connecting to live log stream…");
    if (scrollToBottom || nearBottom) {
      term.scrollTop = term.scrollHeight;
    }
  }

  if (clearDoneBtn) {
    const finishedCount = state.openConsoleIds.filter((id) => {
      const st = state.consoles[id]?.job.status;
      return st && st !== "running" && st !== "queued";
    }).length;
    clearDoneBtn.hidden = !(state.openConsoleIds.length > 1 && finishedCount > 0);
  }
}

function selectConsoleTab(jobId: string): void {
  const c = state.consoles[jobId];
  if (!c) return;
  state.activeConsoleId = jobId;
  c.unread = false;
  if (state.drawerMode === "minimized") {
    state.drawerMode = "normal";
  }
  const drawer = document.getElementById("log-drawer");
  if (drawer) drawer.hidden = false;
  renderDrawer(true);
}

function closeConsoleTab(jobId: string): void {
  const idx = state.openConsoleIds.indexOf(jobId);
  if (idx === -1) return;
  state.openConsoleIds.splice(idx, 1);

  const es = jobStreams.get(jobId);
  const c = state.consoles[jobId];
  // Only close the EventSource when the job is already finished (keep running jobs streaming in background if needed, or close stream safely since server retains full log file)
  if (es) {
    es.close();
    jobStreams.delete(jobId);
  }
  if (c && c.done) {
    delete state.consoles[jobId];
  } else {
    delete state.consoles[jobId];
  }

  if (state.activeConsoleId === jobId) {
    const nextIdx = Math.min(idx, state.openConsoleIds.length - 1);
    state.activeConsoleId = nextIdx >= 0 ? (state.openConsoleIds[nextIdx] ?? null) : null;
  }

  if (state.openConsoleIds.length === 0) {
    const drawer = document.getElementById("log-drawer");
    if (drawer) drawer.hidden = true;
  }
  renderDrawer(true);
}

function closeFinishedConsoleTabs(): void {
  const toClose = state.openConsoleIds.filter((id) => {
    const st = state.consoles[id]?.job.status;
    return st && st !== "running" && st !== "queued";
  });
  for (const id of toClose) {
    closeConsoleTab(id);
  }
}

function ensureJobStream(job: JobRecord): void {
  if (!state.consoles[job.id]) {
    state.consoles[job.id] = {
      job: { ...job },
      log: "",
      unread: false,
      done: job.status !== "running" && job.status !== "queued",
    };
  } else {
    state.consoles[job.id]!.job = { ...job };
  }

  if (!state.openConsoleIds.includes(job.id)) {
    state.openConsoleIds.push(job.id);
  }

  // If already streaming or already loaded complete logs, don't open a duplicate stream
  if (jobStreams.has(job.id)) return;
  const entry = state.consoles[job.id]!;
  if (entry.done && entry.log.length > 0) return;

  entry.log = "";
  const streamTok = LOCAL_SESSION_TOKEN ? `?token=${encodeURIComponent(LOCAL_SESSION_TOKEN)}` : "";
  const es = new EventSource(`/api/jobs/${encodeURIComponent(job.id)}/stream${streamTok}`);
  jobStreams.set(job.id, es);

  es.addEventListener("log", (ev: MessageEvent) => {
    const cur = state.consoles[job.id];
    if (!cur) {
      es.close();
      jobStreams.delete(job.id);
      return;
    }
    cur.log += ev.data + "\n";
    if (state.activeConsoleId === job.id) {
      const term = document.getElementById("drawer-terminal");
      if (term) {
        const nearBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 64;
        term.textContent = cur.log;
        if (nearBottom) term.scrollTop = term.scrollHeight;
      }
    } else {
      cur.unread = true;
      renderDrawer(false);
    }
  });

  es.addEventListener("done", (ev: MessageEvent) => {
    const cur = state.consoles[job.id];
    try {
      const info = JSON.parse(ev.data) as { status: JobRecord["status"] };
      if (cur) {
        cur.job = { ...cur.job, status: info.status };
        cur.done = true;
      }
      if (job.status === "running" || job.status === "queued") {
        toast(`Job ${job.id} ${info.status}`, info.status === "succeeded" ? "ok" : "warn");
      }
    } catch {
      if (cur) cur.done = true;
    }
    es.close();
    jobStreams.delete(job.id);
    renderDrawer(false);
    void refreshJobsList();
    if (state.selectedCfId && job.cf_id === state.selectedCfId) {
      void loadEntryDetail(state.selectedCfId);
    }
    if (job.kind === "bugs_triage") {
      void loadBugs();
    }
  });

  es.onerror = () => {
    es.close();
    jobStreams.delete(job.id);
  };
}

function openJobStream(job: JobRecord): void {
  const drawer = document.getElementById("log-drawer")!;
  ensureJobStream(job);
  state.activeConsoleId = job.id;
  if (state.consoles[job.id]) state.consoles[job.id]!.unread = false;
  drawer.hidden = false;
  if (state.drawerMode === "minimized") {
    state.drawerMode = "normal";
  }
  renderDrawer(true);
}

// ---------------- Data Loaders ----------------

function updateSidebarIdentity(): void {
  const id = state.identity;
  const avEl = document.getElementById("sidebar-id-avatar");
  const nameEl = document.getElementById("sidebar-id-name");
  const subEl = document.getElementById("sidebar-id-sub");
  if (!avEl || !nameEl || !subEl) return;

  if (id && id.signedIn) {
    if (id.avatarUrl) {
      avEl.innerHTML = `<img src="${esc(id.avatarUrl)}" alt="${esc(id.name)}" />`;
    } else {
      avEl.textContent = (id.name || id.handle || "?").slice(0, 2).toUpperCase();
    }
    nameEl.textContent = id.name || id.handle;
    const provLabel = id.provider === "github" ? "GitHub" : id.provider === "google" ? "Google" : "Local";
    const handleDisp = id.provider === "github" && id.handle ? `@${id.handle}` : id.handle;
    subEl.textContent = `${handleDisp} · ${provLabel}`;
  } else {
    const localName = state.settings?.authorName || state.settings?.cfUsername || "";
    avEl.textContent = localName ? localName.slice(0, 2).toUpperCase() : "?";
    nameEl.textContent = localName || "Not signed in";
    subEl.textContent = "Connect GitHub / Google";
  }
}

async function loadHealth(): Promise<void> {
  const data = await api<{
    version?: string;
    entriesCount: number;
    verdictStats: Record<string, number>;
    cfAuth: CfAuthStatus;
    settings: AppSettings;
    identity?: ContributorIdentity;
    hubStatus?: { url: string; hasToken: boolean };
    aiSummary?: AppState["aiSummary"];
    skillsSummary?: AppState["skillsSummary"];
  }>("/api/health");
  const verEl = document.getElementById("sidebar-version");
  if (verEl && data.version) {
    const tag = `v${data.version}`;
    verEl.innerHTML = `<a href="https://github.com/NikolayS/pgroast/releases/tag/${encodeURIComponent(tag)}" target="_blank" rel="noopener" title="Release notes on GitHub">pgroast ${esc(tag)}</a>`;
  }
  state.stats = data.verdictStats;
  state.cfAuth = data.cfAuth;
  state.settings = data.settings;
  if (data.identity) state.identity = data.identity;
  if (data.hubStatus) state.hubStatus = data.hubStatus;
  if (data.aiSummary) state.aiSummary = data.aiSummary;
  if (data.skillsSummary) state.skillsSummary = data.skillsSummary;

  updateSidebarIdentity();
  updateLocalSpaceSwitcher();
  const cntEl = document.getElementById("sidebar-entry-count");
  if (cntEl) cntEl.textContent = `${data.entriesCount} CF entries`;
  const authEl = document.getElementById("sidebar-auth-status");
  if (authEl) {
    authEl.textContent = data.cfAuth.verifiedUser
      ? `CF: ${data.cfAuth.verifiedUser} (verified)`
      : data.cfAuth.hasSessionCookie
        ? `CF: ${data.cfAuth.username || "cookie set"}`
        : "CF: read-only API";
  }
}

async function loadWorkItems(): Promise<void> {
  try {
    const res = await api<{ workItems: WorkItemRecord[] }>("/api/work-items");
    state.workItems = res.workItems;
    const activeCount = state.workItems.filter((w) => w.status !== "closed" && w.status !== "posted").length;
    const badge = document.getElementById("work-items-badge");
    if (badge) {
      badge.textContent = String(activeCount);
      badge.hidden = activeCount === 0;
    }
  } catch (err) {
    toastError(err, "Failed to load Work Items");
  }
}

async function openWorkItem(workItemId: number): Promise<void> {
  state.focusedWorkItemId = workItemId;
  state.view = "work_items";
  updateNavUi();
  await loadWorkItems();
  render();
  setTimeout(() => {
    document.getElementById(`wi-card-${workItemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 60);
}

async function loadShortlist(): Promise<void> {
  state.loading.shortlist = true;
  state.loadingMessage = "Ranking Top 20 Shortlist & Top 50 Triage…";
  setTopProgress();
  if (state.shortlist.length === 0) render();
  try {
    const data = await api<{
      shortlist: ShortlistEntry[];
      top50Closing: Top50RejectEntry[];
      stats: Record<string, number>;
    }>("/api/shortlist?top=40&reject=50");
    state.shortlist = data.shortlist;
    state.top50Closing = data.top50Closing;
    state.stats = data.stats;
  } catch (err) {
    toastError(err);
  } finally {
    state.loading.shortlist = false;
    setTopProgress();
    render();
  }
}

async function loadStats(): Promise<void> {
  state.loading.stats = true;
  state.loadingMessage = "Computing CommitFest & Roast analytics…";
  setTopProgress();
  if (!state.statsReport) render();
  try {
    state.statsReport = await api<StatsReport>("/api/stats");
  } catch (err) {
    toastError(err);
  } finally {
    state.loading.stats = false;
    setTopProgress();
    render();
  }
}

async function loadSavedSearches(): Promise<void> {
  try {
    const res = await api<{
      presets: AppState["savedSearchPresets"];
      custom: SavedSearchRecord[];
    }>("/api/saved-searches");
    state.savedSearchPresets = res.presets;
    state.customSavedSearches = res.custom;
  } catch {
    // non-fatal
  }
}

async function loadEntries(): Promise<void> {
  state.loading.explorer = true;
  state.loadingMessage =
    state.explorerVerdict !== "all"
      ? `Loading ${state.explorerVerdict} entries…`
      : "Loading CommitFest entries…";
  setTopProgress();
  render();
  try {
    const params = new URLSearchParams();
    if (state.explorerSearch) params.set("search", state.explorerSearch);
    if (state.explorerVerdict !== "all") params.set("verdict", state.explorerVerdict);
    if (state.explorerStatus !== "all") params.set("status", state.explorerStatus);
    if (state.explorerMine) params.set("mine", "1");
    if (state.explorerStarred) params.set("starred", "1");
    params.set("sort", state.explorerSort);
    params.set("limit", "500");

    const data = await api<{
      total: number;
      items: AppState["entries"];
      stats: Record<string, number>;
    }>(`/api/entries?${params.toString()}`);
    state.entries = data.items;
    state.entriesTotal = data.total;
    state.stats = data.stats;
  } catch (err) {
    toastError(err);
  } finally {
    const active = document.activeElement as HTMLInputElement | null;
    const wasSearchFocused = active?.id === "exp-search";
    const selStart = wasSearchFocused ? active.selectionStart : null;
    const selEnd = wasSearchFocused ? active.selectionEnd : null;
    state.loading.explorer = false;
    setTopProgress();
    render();
    if (wasSearchFocused) {
      const nextInp = document.getElementById("exp-search") as HTMLInputElement | null;
      if (nextInp) {
        nextInp.focus();
        if (selStart != null && selEnd != null) {
          try { nextInp.setSelectionRange(selStart, selEnd); } catch { /* ignore */ }
        }
      }
    }
  }
}

async function loadEntryDetail(cfId: number): Promise<void> {
  state.selectedCfId = cfId;
  state.loading.detail = true;
  state.loadingMessage = `Loading CF #${cfId} & subsystem experts…`;
  setTopProgress();
  render();
  try {
    const data = await api<NonNullable<AppState["detail"]>>(`/api/entries/${cfId}`);
    state.detail = data;

    // Populate active draft from newest local draft or initialize clean draft for this entry
    const latestDraft = data.drafts[0];
    if (latestDraft) {
      let atts: DraftAttachment[] = [];
      let gates: AllGatesResult | null = null;
      try { atts = JSON.parse(latestDraft.attachments_json || "[]") as DraftAttachment[]; } catch { atts = []; }
      try { gates = latestDraft.gate_results_json ? (JSON.parse(latestDraft.gate_results_json) as AllGatesResult) : null; } catch { gates = null; }
      state.activeDraft = {
        id: latestDraft.id,
        isReply: latestDraft.is_reply === 1,
        isOtherAuthorThread: latestDraft.is_other_author_thread === 1,
        threadId: latestDraft.thread_id,
        inReplyTo: latestDraft.in_reply_to,
        referencesHeader: latestDraft.references_header,
        to: latestDraft.to_addrs || "pgsql-hackers@lists.postgresql.org",
        cc: latestDraft.cc_addrs || "",
        subject: latestDraft.subject || `Re: ${data.entry.title}`,
        body: latestDraft.body,
        attachments: atts,
        gates,
        gmailMatches: [],
        gmailDraftUrl: latestDraft.gmail_draft_url || "",
      };
    } else {
      state.activeDraft = {
        id: null,
        isReply: true,
        isOtherAuthorThread: true,
        threadId: "",
        inReplyTo: data.entry.latest_message_id || "",
        referencesHeader: data.entry.latest_message_id || "",
        to: "pgsql-hackers@lists.postgresql.org",
        cc: "",
        subject: `Re: ${data.entry.title}`,
        body: "",
        attachments: [],
        gates: null,
        gmailMatches: [],
        gmailDraftUrl: "",
      };
    }
  } finally {
    state.loading.detail = false;
    setTopProgress();
    render();
  }
}

async function loadDiffForEntry(cfId: number): Promise<void> {
  if (state.diffLoading) return;
  state.diffLoading = true;
  state.diffError = "";
  render();
  try {
    const res = await api<{ diff: PatchDiffUi; comments: DiffCommentRecord[] }>(`/api/entries/${cfId}/diff`);
    state.diffData = res.diff;
    state.diffComments = res.comments;
    state.diffError = "";
  } catch (err) {
    state.diffData = null;
    state.diffError = err instanceof Error ? err.message : String(err);
    toastError(err, `CF #${cfId} diff`, () => void loadDiffForEntry(cfId));
  } finally {
    state.diffLoading = false;
    render();
  }
}

function getPublicAppUrl(cfId?: number | null): string {
  const base = (state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai").replace(/\/$/, "");
  return cfId && cfId > 0 ? `${base}/patch/${cfId}` : `${base}/`;
}

function updateLocalSpaceSwitcher(): void {
  const link = document.getElementById("local-space-public-link") as HTMLAnchorElement | null;
  const desc = document.getElementById("local-space-public-desc");
  const cfId = state.view === "workbench" ? state.selectedCfId : null;
  const url = getPublicAppUrl(cfId);
  if (link) link.href = url;
  if (desc) {
    const cleanHost = getPublicAppUrl().replace(/^https?:\/\//, "").replace(/\/$/, "");
    desc.textContent = cfId
      ? `Jump to CF #${cfId} in the Public App (${cleanHost}) to browse or share.`
      : `Browse or share public CommitFest briefs & team opinions at ${cleanHost}.`;
  }
}

async function openEntry(cfId: number): Promise<void> {
  state.view = "workbench";
  state.selectedCfId = cfId;
  state.detail = null;
  state.diffData = null;
  state.diffComments = [];
  state.diffError = "";
  updateNavUi();
  updateLocalSpaceSwitcher();
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("cf", String(cfId));
    window.history.replaceState(null, "", u.toString());
  } catch {
    // ignore
  }
  try {
    await loadEntryDetail(cfId);
  } catch {
    // If not in DB yet, try refreshing directly from CommitFest
    toast(`CF ${cfId} not local yet — fetching from CommitFest…`, "info");
    try {
      state.loading.detail = true;
      state.loadingMessage = `Fetching CF #${cfId} from commitfest.postgresql.org…`;
      setTopProgress();
      render();
      await api(`/api/cf/${cfId}/refresh`, { method: "POST" });
      await loadEntryDetail(cfId);
    } catch (err) {
      state.loading.detail = false;
      setTopProgress();
      render();
      toastError(err);
    }
  }
}

async function loadBugs(): Promise<void> {
  state.loading.bugs = true;
  state.loadingMessage = "Loading pgsql-bugs triage queue…";
  setTopProgress();
  if (state.bugs.length === 0) render();
  try {
    const params = new URLSearchParams();
    if (state.bugClassFilter !== "all") params.set("classification", state.bugClassFilter);
    if (state.bugSeverityFilter !== "all") params.set("severity", state.bugSeverityFilter);
    const data = await api<{ bugs: BugReportRecord[] }>(`/api/bugs?${params.toString()}`);
    state.bugs = data.bugs;
  } catch (err) {
    toastError(err);
  } finally {
    state.loading.bugs = false;
    setTopProgress();
    render();
  }
}

async function refreshJobsList(): Promise<void> {
  state.loading.jobs = true;
  setTopProgress();
  try {
    const data = await api<{ jobs: JobRecord[] }>("/api/jobs");
    state.jobs = data.jobs;
    const running = state.jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    const badge = document.getElementById("running-jobs-badge");
    if (badge) {
      badge.textContent = String(running);
      badge.hidden = running === 0;
    }
  } catch (err) {
    toastError(err);
  } finally {
    state.loading.jobs = false;
    setTopProgress();
    if (state.view === "jobs") render();
  }
}

async function loadSettingsAndDoctor(): Promise<void> {
  state.loading.settings = true;
  state.loadingMessage = "Running local environment doctor…";
  setTopProgress();
  if (state.doctorChecks.length === 0) render();
  try {
    const [settingsRes, doctorRes, auditRes, contribRes] = await Promise.all([
      api<{
        settings: AppSettings;
        identity?: ContributorIdentity;
        cfAuth: CfAuthStatus;
        hubStatus?: { url: string; hasToken: boolean };
        aiSummary?: AppState["aiSummary"];
        skillsSummary?: AppState["skillsSummary"];
      }>("/api/settings"),
      api<{
        checks: DoctorCheckItem[];
        aiSummary?: AppState["aiSummary"];
        skillsSummary?: AppState["skillsSummary"];
      }>("/api/doctor"),
      api<{ logs: AuditLogRecord[] }>("/api/audit"),
      api<AppState["contributeData"]>("/api/contribute/state").catch(() => null),
    ]);
    state.settings = settingsRes.settings;
    if (settingsRes.identity) {
      state.identity = settingsRes.identity;
      updateSidebarIdentity();
    }
    if (settingsRes.hubStatus) state.hubStatus = settingsRes.hubStatus;
    state.cfAuth = settingsRes.cfAuth;
    state.doctorChecks = doctorRes.checks;
    state.auditLogs = auditRes.logs;
    if (contribRes) state.contributeData = contribRes;
    if (doctorRes.aiSummary) state.aiSummary = doctorRes.aiSummary;
    if (settingsRes.skillsSummary) state.skillsSummary = settingsRes.skillsSummary;
  } catch (err) {
    toastError(err);
  } finally {
    state.loading.settings = false;
    setTopProgress();
    render();
  }
}

// ---------------- Navigation ----------------

const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
  shortlist: {
    title: "Shortlist & Triage",
    subtitle: "Top 20 CommitFest Shortlist + Top 50 Worth Closing / Rethinking (open entries)",
  },
  stats: {
    title: "Stats & Insights",
    subtitle: "CommitFest coverage, CF Status × Verdict matrix, novelty & reviewer bottlenecks",
  },
  explorer: {
    title: "CommitFest Explorer",
    subtitle: "Saved searches, structured query syntax, novelty signals, stars, tags & CFBot status",
  },
  workbench: {
    title: "Entry Deep-Dive & Workbench",
    subtitle: "Roast v2, Isolated Build/Test, Dual AI Review + Blind Gate, gws Reply Studio & Fork Sync",
  },
  bugs: {
    title: "pgsql-bugs Production Triage",
    subtitle: "Surface real production user hits above synthetic AI bug-hunt noise",
  },
  work_items: {
    title: "Work Items (Local Only)",
    subtitle: "Private local workspaces in PostgreSQL — repro notes, worktrees, status, and optional sanitized fork issues",
  },
  jobs: {
    title: "Jobs & Live Logs",
    subtitle: "Background roast, build/test, AI review, blind verify, and Hetzner runs",
  },
  settings: {
    title: "Settings & Health",
    subtitle: "GitHub/Google Identity, Local CLI Doctor, CommitFest Login, Skills & Audit Log",
  },
};

function updateNavUi(): void {
  document.querySelectorAll<HTMLButtonElement>(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
  });
  const meta = VIEW_META[state.view];
  const t = document.getElementById("view-title");
  const s = document.getElementById("view-subtitle");
  if (t) t.textContent = meta.title;
  if (s) s.textContent = meta.subtitle;
}

async function switchView(view: ViewId): Promise<void> {
  state.view = view;
  updateNavUi();
  render();
  if (view === "shortlist") await loadShortlist();
  else if (view === "stats") await loadStats();
  else if (view === "explorer") {
    if (state.savedSearchPresets.length === 0) void loadSavedSearches();
    await loadEntries();
  } else if (view === "workbench") {
    if (!state.selectedCfId && state.shortlist[0]) {
      await loadEntryDetail(state.shortlist[0].cf_id);
    } else if (!state.selectedCfId && state.entries[0]) {
      await loadEntryDetail(state.entries[0].cf_id);
    }
  } else if (view === "bugs") await loadBugs();
  else if (view === "work_items") {
    await loadWorkItems();
    render();
  } else if (view === "jobs") {
    await refreshJobsList();
    render();
  }
  else if (view === "settings") await loadSettingsAndDoctor();
}

// ---------------- Renderers ----------------

function renderShortlistView(): string {
  const s = state.stats;
  const q = state.shortlistSearch.trim().toLowerCase();
  const baseTop = state.shortlist.filter(
    (x) => !q || String(x.cf_id).includes(q) || x.title.toLowerCase().includes(q) || x.authors.toLowerCase().includes(q),
  );
  const bugfixCount = baseTop.filter((x) => x.kind === "bugfix").length;
  const featureCount = baseTop.filter((x) => x.kind === "feature").length;
  const prodCount = baseTop.filter((x) => x.seen_in_production).length;

  const myTopicsList = (state.settings?.interestedTopics || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const matchesMyTopics = (x: ShortlistEntry) =>
    myTopicsList.length > 0 &&
    myTopicsList.some((kw) => `${x.title} ${x.reasons.join(" ")} ${x.experts.map((e) => e.subsystem || "").join(" ")}`.toLowerCase().includes(kw));
  const myTopicsCount = baseTop.filter(matchesMyTopics).length;

  const filteredTop20 = baseTop.filter((x) => {
    if (state.shortlistKindFilter === "bugfix") return x.kind === "bugfix";
    if (state.shortlistKindFilter === "feature") return x.kind === "feature";
    if (state.shortlistKindFilter === "prod") return x.seen_in_production;
    if (state.shortlistKindFilter === "my_topics") return matchesMyTopics(x);
    return true;
  });
  const filteredTop50 = state.top50Closing.filter(
    (x) => !q || String(x.cf_id).includes(q) || x.title.toLowerCase().includes(q) || x.authors.toLowerCase().includes(q),
  );

  return `
    <div class="kpi-grid">
      <div class="kpi-card" data-jump-verdict="all">
        <div class="kpi-label">Total Entries</div>
        <div class="kpi-value">${s.TOTAL ?? 0}</div>
        <div class="dim" style="font-size:11px;margin-top:2px;">${s.OPEN_TOTAL ?? 0} open · ${s.CLOSED_TOTAL ?? 0} closed</div>
      </div>
      <div class="kpi-card" data-jump-verdict="NO-FUNDAMENTAL-OBJECTION">
        <div class="kpi-label">No Fundamental Objection</div>
        <div class="kpi-value" style="color:var(--ok)">${s["NO-FUNDAMENTAL-OBJECTION"] ?? 0}</div>
      </div>
      <div class="kpi-card" data-jump-verdict="NEEDS-COMMITTER-EYES">
        <div class="kpi-label">Needs Committer Eyes</div>
        <div class="kpi-value" style="color:var(--accent)">${s["NEEDS-COMMITTER-EYES"] ?? 0}</div>
      </div>
      <div class="kpi-card" data-jump-verdict="NEEDS-DESIGN-DISCUSSION">
        <div class="kpi-label">Needs Design Discussion</div>
        <div class="kpi-value" style="color:var(--warn)">${s["NEEDS-DESIGN-DISCUSSION"] ?? 0}</div>
      </div>
      <div class="kpi-card" data-jump-verdict="LIKELY-REJECT">
        <div class="kpi-label">Likely Reject</div>
        <div class="kpi-value" style="color:var(--danger)">${s["LIKELY-REJECT"] ?? 0}</div>
      </div>
      <div class="kpi-card" data-jump-verdict="UNROASTED">
        <div class="kpi-label">Not Roasted</div>
        <div class="kpi-value" style="color:var(--text-muted)">${s.UNROASTED ?? 0}</div>
        <div class="dim" style="font-size:11px;margin-top:2px;">${s.OPEN_UNROASTED ?? 0} open</div>
      </div>
    </div>

    <div class="toolbar">
      <button class="btn ${state.shortlistTab === "top20" ? "btn-primary" : "btn-secondary"}" id="sl-tab-top20">
        ★ Shortlist (${state.shortlist.length})
      </button>
      <button class="btn ${state.shortlistTab === "top50" ? "btn-primary" : "btn-secondary"}" id="sl-tab-top50">
        ✕ Worth Closing / Rethinking (${state.top50Closing.length})
      </button>
      <input type="text" id="sl-search" placeholder="Filter shortlist by CF #, title, or author…" value="${esc(state.shortlistSearch)}" />
      <button class="btn btn-secondary btn-sm" id="sl-publish-brief-btn" title="Publish sanitized interactive &amp; downloadable brief to Public App">Publish Brief…</button>
      <button class="btn btn-secondary btn-sm" id="sl-export-snapshot-btn" title="Generate a frozen static HTML snapshot for public feedback">Export Snapshot (.html)</button>
      <button class="btn btn-ghost btn-sm" id="sl-digest-md-btn">Digest (.md)</button>
    </div>

    ${
      state.shortlistTab === "top20"
        ? `
      <div class="preset-bar">
        <span class="dim" style="font-size:11px;font-weight:600;text-transform:uppercase;">Split by type:</span>
        <button type="button" class="preset-chip ${state.shortlistKindFilter === "all" ? "active" : ""}" data-sl-kind="all">All (${baseTop.length})</button>
        <button type="button" class="preset-chip ${state.shortlistKindFilter === "bugfix" ? "active" : ""}" data-sl-kind="bugfix">Bug fixes (${bugfixCount})</button>
        <button type="button" class="preset-chip ${state.shortlistKindFilter === "feature" ? "active" : ""}" data-sl-kind="feature">Features (${featureCount})</button>
        <button type="button" class="preset-chip ${state.shortlistKindFilter === "prod" ? "active" : ""}" data-sl-kind="prod">Seen in production (${prodCount})</button>
        ${
          myTopicsList.length > 0
            ? `<button type="button" class="preset-chip ${state.shortlistKindFilter === "my_topics" ? "active" : ""}" data-sl-kind="my_topics" title="Topics: ${esc(myTopicsList.join(", "))}">My Topics (${myTopicsCount})</button>`
            : `<button type="button" class="preset-chip" id="sl-config-topics-btn" title="Set your PostgreSQL topics of interest in Settings">+ My Topics</button>`
        }
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>CommitFest</th>
              <th>Proposal</th>
              <th>Verdict &amp; Status</th>
              <th>Score / Signals</th>
              <th>Suggested Reviewers</th>
            </tr>
          </thead>
          <tbody>
            ${
              state.loading.shortlist && filteredTop20.length === 0
                ? `<tr><td colspan="6">${renderLoader(state.loadingMessage || "Loading Shortlist…")}</td></tr>`
                : filteredTop20.length === 0
                  ? `<tr><td colspan="6" class="empty-state">No entries match this filter.</td></tr>`
                  : filteredTop20
                    .map(
                      (item, idx) => `
                  <tr class="clickable" data-open-cf="${item.cf_id}">
                    <td class="mono muted">${idx + 1}</td>
                    <td class="mono">
                      <div><strong>CF ${item.cf_id}</strong></div>
                      <div style="font-size:11px;margin-top:3px;white-space:nowrap;">
                        <a href="https://commitfest.postgresql.org/patch/${item.cf_id}/" target="_blank" rel="noopener" data-ext-link="1">CF page ↗</a>
                        ${item.thread_url ? ` · <a href="${esc(item.thread_url)}" target="_blank" rel="noopener" data-ext-link="1">CF thread ↗</a>` : ""}
                      </div>
                    </td>
                    <td>
                      <div><strong>${esc(item.title)}</strong></div>
                      <div class="chip-row" style="margin-top:4px;">
                        <span class="pill ${item.kind === "bugfix" ? "pill-info" : "pill-purple"}" style="font-size:10.5px;">${item.kind === "bugfix" ? "Bug fix" : "Feature"}</span>
                        ${item.seen_in_production ? `<span class="pill pill-danger" style="font-size:10.5px;" title="${esc(item.production_signal)}">Seen in production</span>` : ""}
                        ${item.workaround ? `<span class="pill pill-warn" style="font-size:10.5px;" title="${esc(item.workaround)}">Workaround exists</span>` : ""}
                        <span class="muted" style="font-size:11.5px;">${esc(item.authors || "Unknown author")}</span>
                      </div>
                      ${item.first_objection ? `<div class="dim" style="font-size:11px;margin-top:2px;">Open point: ${esc(item.first_objection)}</div>` : ""}
                    </td>
                    <td>
                      <div>${verdictPill(item.verdict)}</div>
                      <div class="muted" style="font-size:11px;margin-top:3px;">${esc(item.status || "—")} · ${item.objection_count} obj (${item.new_objection_count} new)</div>
                    </td>
                    <td>
                      <div class="mono"><strong>${item.score}</strong> pts</div>
                      <div class="muted" style="font-size:11px;">${esc(item.reasons.join(" · "))}</div>
                    </td>
                    <td>
                      <div class="chip-row">
                        ${
                          item.experts.length
                            ? item.experts
                                .map(
                                  (e) =>
                                    `<span class="pill ${e.source === "git_log" ? "pill-purple" : "pill-neutral"}" title="${esc(e.subsystem || e.source)}">${esc(e.name)}${e.commits ? ` (${e.commits})` : ""}</span>`,
                                )
                                .join("")
                            : `<span class="dim">—</span>`
                        }
                      </div>
                    </td>
                  </tr>
                `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    `
        : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>CommitFest</th>
              <th>Proposal</th>
              <th>Verdict / Failing Level</th>
              <th>Workaround / Reasons</th>
              <th>Actionable Next Step for Author</th>
            </tr>
          </thead>
          <tbody>
            ${
              filteredTop50.length === 0
                ? `<tr><td colspan="6" class="empty-state">No closing/rethinking candidates yet.</td></tr>`
                : filteredTop50
                    .map(
                      (item, idx) => `
                  <tr class="clickable" data-open-cf="${item.cf_id}">
                    <td class="mono muted">${idx + 1}</td>
                    <td class="mono">
                      <div><strong>CF ${item.cf_id}</strong></div>
                      <div style="font-size:11px;margin-top:3px;white-space:nowrap;">
                        <a href="https://commitfest.postgresql.org/patch/${item.cf_id}/" target="_blank" rel="noopener" data-ext-link="1">CF page ↗</a>
                        ${item.thread_url ? ` · <a href="${esc(item.thread_url)}" target="_blank" rel="noopener" data-ext-link="1">CF thread ↗</a>` : ""}
                      </div>
                    </td>
                    <td>
                      <div><strong>${esc(item.title)}</strong></div>
                      <div class="muted" style="font-size:11.5px;">${esc(item.authors || "—")} · ${esc(item.status || "—")}</div>
                    </td>
                    <td>
                      <div>${verdictPill(item.verdict)}</div>
                      ${item.failing_summary ? `<div style="font-size:11px;color:var(--warn);margin-top:3px;">${esc(item.failing_summary)}</div>` : ""}
                      <div style="margin-top:3px;"><span class="pill pill-neutral">${esc(item.recommended_action)}</span></div>
                    </td>
                    <td style="font-size:11.5px;">
                      ${item.workaround ? `<div style="margin-bottom:4px;"><span class="pill pill-warn">Already exists / workaround</span> ${esc(item.workaround)}</div>` : ""}
                      ${esc(item.reasons.join("; "))}
                    </td>
                    <td class="muted" style="font-size:11.5px;max-width:320px;">${esc(item.next_step_for_author)}</td>
                  </tr>
                `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    `
    }
  `;
}

function renderHbarRows(
  rows: Array<{ label: string; count: number; color?: string; query?: string }>,
  maxVal?: number,
): string {
  const max = maxVal ?? Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return `<div class="muted" style="font-size:12px;">No data yet.</div>`;
  return `
    <div class="hbar-list">
      ${rows
        .map((r) => {
          const pct = Math.max(r.count > 0 ? 3 : 0, Math.round((r.count / max) * 100));
          return `
        <div class="hbar-row ${r.query ? "clickable" : ""}" ${r.query ? `data-stats-query="${esc(r.query)}"` : ""} title="${esc(r.label)}: ${r.count}">
          <span class="hbar-label">${esc(r.label)}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;${r.color ? `background:${r.color};` : ""}"></div></div>
          <span class="mono muted" style="text-align:right;">${r.count}</span>
        </div>
      `;
        })
        .join("")}
    </div>
  `;
}

function renderStatsView(): string {
  const r = state.statsReport;
  if (state.loading.stats && !r) {
    return renderLoader(state.loadingMessage || "Computing CommitFest & Roast statistics…");
  }
  if (!r) {
    return `<div class="empty-state">No statistics available yet. Sync a CommitFest or import roasts first.</div>`;
  }

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
  const roastCovPct = pct(r.totals.roasted, r.totals.total);
  const openRoastPct = pct(r.totals.openRoasted, r.totals.open);
  const novelRate = pct(r.novelty.entriesWithNovel, Math.max(1, r.totals.roasted));

  const segColors: Record<string, string> = {
    "NO-FUNDAMENTAL-OBJECTION": "var(--ok)",
    "NEEDS-COMMITTER-EYES": "var(--accent)",
    "NEEDS-DESIGN-DISCUSSION": "var(--warn)",
    "LIKELY-REJECT": "var(--danger)",
    UNROASTED: "var(--text-dim)",
  };

  return `
    <div class="toolbar" style="justify-content:space-between;">
      <div class="muted" style="font-size:12px;">
        Computed across <strong>${r.totals.total}</strong> entries (${r.totals.open} open, ${r.totals.closed} closed) · ${r.bugs.total} triaged <code>pgsql-bugs</code>
      </div>
      <div class="inline-row">
        <button class="btn btn-secondary btn-sm" id="stats-refresh-btn">Refresh Stats</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card" data-stats-query="status:open">
        <div class="kpi-label">Open / Total Entries</div>
        <div class="kpi-value">${r.totals.open} <span class="dim" style="font-size:15px;font-weight:500;">/ ${r.totals.total}</span></div>
        <div class="dim" style="font-size:11px;margin-top:2px;">${r.totals.closed} closed/committed</div>
      </div>
      <div class="kpi-card" data-stats-query="status:open is:unroasted">
        <div class="kpi-label">Roast Coverage</div>
        <div class="kpi-value" style="color:var(--accent)">${roastCovPct}%</div>
        <div class="dim" style="font-size:11px;margin-top:2px;">${r.totals.openRoasted}/${r.totals.open} open (${openRoastPct}%) · ${r.totals.openUnroasted} unroasted</div>
      </div>
      <div class="kpi-card" data-stats-query="status:open has:novel">
        <div class="kpi-label">Novel Findings Rate</div>
        <div class="kpi-value" style="color:var(--purple)">${novelRate}%</div>
        <div class="dim" style="font-size:11px;margin-top:2px;">${r.novelty.entriesWithNovel} entries · ${r.novelty.newCount} new + ${r.novelty.precedentCount} precedent</div>
      </div>
      <div class="kpi-card" data-stats-query="status:ready no:committer">
        <div class="kpi-label">Ready, No Committer</div>
        <div class="kpi-value" style="color:var(--warn)">${r.rfcNoCommitter.length}</div>
        <div class="dim" style="font-size:11px;margin-top:2px;">Committer review bottleneck</div>
      </div>
      <div class="kpi-card" data-stats-query="is:starred">
        <div class="kpi-label">Your Triage Progress</div>
        <div class="kpi-value" style="color:var(--ok)">★ ${r.triage.starred}</div>
        <div class="dim" style="font-size:11px;margin-top:2px;">${r.triage.visited} visited · ${r.triage.tagged} tagged · ${r.triage.drafts} drafts</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Verdict Distribution (Click any segment to filter Explorer)</h3>
        <span class="muted" style="font-size:11.5px;">${r.totals.roasted} roasted + ${r.totals.unroasted} unroasted = ${r.totals.total}</span>
      </div>
      <div class="stacked-bar">
        ${r.verdicts
          .filter((v) => v.all > 0)
          .map((v) => {
            const w = ((v.all / Math.max(1, r.totals.total)) * 100).toFixed(2);
            return `<div class="stacked-seg" style="width:${w}%;background:${segColors[v.verdict] || "var(--accent)"};" data-jump-verdict="${esc(v.verdict)}" title="${esc(v.verdict)}: ${v.all} total (${v.open} open)"></div>`;
          })
          .join("")}
      </div>
      <div class="chip-row">
        ${r.verdicts
          .map(
            (v) => `
          <span class="preset-chip" data-jump-verdict="${esc(v.verdict)}">
            <span class="dot" style="background:${segColors[v.verdict] || "var(--accent)"};"></span>
            <span>${esc(humanVerdictLabel(v.verdict))}</span>
            <strong class="mono">${v.all}</strong>
            <span class="dim">(${v.open} open)</span>
          </span>
        `,
          )
          .join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>CF Status × Verdict Matrix</h3>
        <span class="muted" style="font-size:11.5px;">Click any number to inspect that exact slice in Explorer</span>
      </div>
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>CommitFest Status</th>
              <th style="text-align:right;">Total</th>
              <th style="text-align:right;color:var(--ok);">No Fund. Obj.</th>
              <th style="text-align:right;color:var(--accent);">Committer Eyes</th>
              <th style="text-align:right;color:var(--warn);">Design Disc.</th>
              <th style="text-align:right;color:var(--danger);">Likely Reject</th>
              <th style="text-align:right;">Unroasted</th>
            </tr>
          </thead>
          <tbody>
            ${r.statusMatrix
              .map((row) => {
                const cols = [
                  "NO-FUNDAMENTAL-OBJECTION",
                  "NEEDS-COMMITTER-EYES",
                  "NEEDS-DESIGN-DISCUSSION",
                  "LIKELY-REJECT",
                  "UNROASTED",
                ];
                return `
              <tr>
                <td>
                  <strong>${esc(row.status)}</strong>
                  ${row.isClosed ? `<span class="pill pill-neutral" style="margin-left:6px;font-size:10px;">closed</span>` : ""}
                </td>
                <td class="matrix-cell clickable" data-matrix-status="${esc(row.status)}" data-matrix-verdict="all"><strong>${row.total}</strong></td>
                ${cols
                  .map((col) => {
                    const n = row.counts[col] ?? 0;
                    return n > 0
                      ? `<td class="matrix-cell clickable" data-matrix-status="${esc(row.status)}" data-matrix-verdict="${esc(col)}">${n}</td>`
                      : `<td class="matrix-cell dim">·</td>`;
                  })
                  .join("")}
              </tr>
            `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="split-pane">
      <div class="card">
        <div class="card-header">
          <h3>Objection Novelty Breakdown</h3>
          <span class="muted" style="font-size:11.5px;">${r.novelty.totalObjections} surviving objections</span>
        </div>
        ${renderHbarRows([
          { label: "NEW (unraised on thread)", count: r.novelty.newCount, color: "var(--accent)", query: "has:novel" },
          { label: "REVISITS PRECEDENT", count: r.novelty.precedentCount, color: "var(--purple)", query: "has:novel" },
          { label: "OPEN IN THREAD", count: r.novelty.openInThreadCount, color: "var(--border-strong)" },
        ])}
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Open Patches CI / CFBot Health</h3>
          <span class="muted" style="font-size:11.5px;">Open entries</span>
        </div>
        ${renderHbarRows([
          { label: "Passing", count: r.cfbot.passing ?? 0, color: "var(--ok)", query: "status:open cfbot:pass" },
          { label: "Needs Rebase", count: r.cfbot.needs_rebase ?? 0, color: "var(--warn)", query: "status:open cfbot:rebase" },
          { label: "Failing", count: r.cfbot.failing ?? 0, color: "var(--danger)", query: "status:open cfbot:fail" },
          { label: "Not synced / unknown", count: r.cfbot.unknown ?? 0, color: "var(--border-strong)" },
        ])}
      </div>
    </div>

    <div class="split-pane">
      <div class="card">
        <div class="card-header">
          <h3>Top Topics / Subsystems (Open)</h3>
          <span class="muted" style="font-size:11.5px;">Click to filter</span>
        </div>
        ${renderHbarRows(
          r.topTopics.map((t) => {
            const kw = t.topic.includes("/") ? (t.topic.split("/")[0] || "").trim().split(/\s+/)[0] || "" : "";
            return {
              label: `${t.topic} (${t.clean} clean)`,
              count: t.open,
              query: t.topic === "Core / Misc" ? "status:open" : kw ? `status:open ${kw}` : `status:open topic:"${t.topic}"`,
            };
          }),
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <h3>pgsql-bugs Triage Breakdown</h3>
          <span class="muted" style="font-size:11.5px;">${r.bugs.total} triaged reports</span>
        </div>
        ${renderHbarRows([
          { label: "🔥 Production Hit", count: r.bugs.byClassification.production_hit ?? 0, color: "var(--danger)" },
          { label: "Unclear", count: r.bugs.byClassification.unclear ?? 0, color: "var(--warn)" },
          { label: "Synthetic / AI Hunt", count: r.bugs.byClassification.synthetic_ai_hunt ?? 0, color: "var(--border-strong)" },
        ])}
        <div class="section-label" style="margin-top:14px;">By Severity</div>
        <div class="chip-row">
          ${Object.entries(r.bugs.bySeverity)
            .sort((a, b) => b[1] - a[1])
            .map(([sev, cnt]) => `<span class="pill ${sev === "data_loss" || sev === "crash" || sev === "wrong_results" ? "pill-danger" : "pill-neutral"}">${esc(sev)}: ${cnt}</span>`)
            .join("") || `<span class="muted">No bugs scanned yet</span>`}
        </div>
      </div>
    </div>

    <div class="stats-grid-3">
      <div class="card">
        <div class="card-header"><h3>Top Open Authors</h3></div>
        ${renderHbarRows(
          r.leaderboards.authors.map((a) => ({ label: a.name, count: a.count, query: `status:open author:"${a.name}"` })),
        )}
      </div>
      <div class="card">
        <div class="card-header"><h3>Top Active Reviewers</h3></div>
        ${renderHbarRows(
          r.leaderboards.reviewers.map((a) => ({ label: a.name, count: a.count, color: "var(--ok)", query: `status:open reviewer:"${a.name}"` })),
        )}
      </div>
      <div class="card">
        <div class="card-header"><h3>Assigned Committers</h3></div>
        ${renderHbarRows(
          r.leaderboards.committers.map((a) => ({ label: a.name, count: a.count, color: "var(--purple)" })),
        )}
      </div>
    </div>

    ${
      r.rfcNoCommitter.length > 0
        ? `
      <div class="card">
        <div class="card-header">
          <h3>Ready for Committer — No Committer Assigned (${r.rfcNoCommitter.length})</h3>
          <button class="btn btn-secondary btn-sm" data-stats-query="status:ready no:committer">View all in Explorer →</button>
        </div>
        <div class="table-wrap" style="border:none;">
          <table>
            <thead>
              <tr><th>CF</th><th>Proposal</th><th>Verdict</th><th>Authors</th><th>Score</th></tr>
            </thead>
            <tbody>
              ${r.rfcNoCommitter
                .slice(0, 10)
                .map(
                  (item) => `
                <tr class="clickable" data-open-cf="${item.cf_id}">
                  <td class="mono"><strong>${item.cf_id}</strong></td>
                  <td><strong>${esc(item.title)}</strong></td>
                  <td>${verdictPill(item.verdict === "UNROASTED" ? "" : item.verdict)}</td>
                  <td class="muted">${esc(item.authors || "—")}</td>
                  <td class="mono">${Math.round(item.score)}</td>
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
  `;
}

function renderExplorerView(): string {
  const presets = state.savedSearchPresets;
  const custom = state.customSavedSearches;
  return `
    <div class="preset-bar">
      <span class="dim" style="font-size:11px;font-weight:600;text-transform:uppercase;">Saved Searches:</span>
      ${presets
        .map(
          (p) => `
        <button type="button" class="preset-chip ${state.explorerSearch.trim() === p.query ? "active" : ""}" data-apply-query="${esc(p.query)}" title="${esc(p.description)}">
          ${esc(p.name)}
        </button>
      `,
        )
        .join("")}
      ${custom
        .map(
          (c) => `
        <span class="preset-chip ${state.explorerSearch.trim() === c.query ? "active" : ""}" data-apply-query="${esc(c.query)}" title="${esc(c.query)}">
          <span>${esc(c.name)}</span>
          <button type="button" class="drawer-tab-close" data-del-saved-search="${c.id}" title="Delete saved search">×</button>
        </span>
      `,
        )
        .join("")}
    </div>

    <div class="toolbar">
      <input type="text" id="exp-search" placeholder="Search or use tokens: status:ready no:committer has:novel verdict:clean is:starred tag:shortlist (press /)" value="${esc(state.explorerSearch)}" />
      <button class="btn btn-ghost btn-sm" id="exp-save-search-btn" title="Save current search query">+ Save</button>
      <select id="exp-verdict">
        <option value="all" ${state.explorerVerdict === "all" ? "selected" : ""}>All verdicts</option>
        <option value="NO-FUNDAMENTAL-OBJECTION" ${state.explorerVerdict === "NO-FUNDAMENTAL-OBJECTION" ? "selected" : ""}>NO-FUNDAMENTAL-OBJECTION</option>
        <option value="NEEDS-COMMITTER-EYES" ${state.explorerVerdict === "NEEDS-COMMITTER-EYES" ? "selected" : ""}>NEEDS-COMMITTER-EYES</option>
        <option value="NEEDS-DESIGN-DISCUSSION" ${state.explorerVerdict === "NEEDS-DESIGN-DISCUSSION" ? "selected" : ""}>NEEDS-DESIGN-DISCUSSION</option>
        <option value="LIKELY-REJECT" ${state.explorerVerdict === "LIKELY-REJECT" ? "selected" : ""}>LIKELY-REJECT</option>
        <option value="UNROASTED" ${state.explorerVerdict === "UNROASTED" ? "selected" : ""}>UNROASTED</option>
      </select>
      <select id="exp-status">
        <option value="all" ${state.explorerStatus === "all" ? "selected" : ""}>All CF statuses</option>
        <option value="OPEN" ${state.explorerStatus === "OPEN" ? "selected" : ""}>Open only</option>
        <option value="CLOSED" ${state.explorerStatus === "CLOSED" ? "selected" : ""}>Closed only</option>
        <option value="Ready for Committer" ${state.explorerStatus === "Ready for Committer" ? "selected" : ""}>Ready for Committer</option>
        <option value="Needs review" ${state.explorerStatus === "Needs review" ? "selected" : ""}>Needs review</option>
        <option value="Waiting on Author" ${state.explorerStatus === "Waiting on Author" ? "selected" : ""}>Waiting on Author</option>
        <option value="Committed" ${state.explorerStatus === "Committed" ? "selected" : ""}>Committed</option>
      </select>
      <select id="exp-sort">
        <option value="score" ${state.explorerSort === "score" ? "selected" : ""}>Sort: Shortlist Score</option>
        <option value="cf_id" ${state.explorerSort === "cf_id" ? "selected" : ""}>Sort: CF ID (Newest)</option>
        <option value="objections" ${state.explorerSort === "objections" ? "selected" : ""}>Sort: New Objections</option>
        <option value="updated" ${state.explorerSort === "updated" ? "selected" : ""}>Sort: Recently Updated</option>
      </select>
      <label class="inline-row" style="cursor:pointer;">
        <input type="checkbox" id="exp-starred" ${state.explorerStarred ? "checked" : ""} />
        <span>★ Starred</span>
      </label>
      <label class="inline-row" style="cursor:pointer;">
        <input type="checkbox" id="exp-mine" ${state.explorerMine ? "checked" : ""} />
        <span>My Queue</span>
      </label>
      <select id="exp-sync-cf">
        <option value="62">PG20-3 (#62 In Progress)</option>
        <option value="63">PG20-4 (#63 Open)</option>
        <option value="60">PG20-Drafts (#60)</option>
      </select>
      <button class="btn btn-secondary btn-sm" id="exp-sync-btn">Live Sync</button>
    </div>

    <div class="inline-row" style="justify-content:space-between;margin-bottom:8px;">
      <div class="muted" style="font-size:11.5px;">Showing ${state.entries.length} of ${state.entriesTotal} entries</div>
      <details style="font-size:11px;color:var(--text-muted);">
        <summary style="cursor:pointer;">Query syntax</summary>
        <div class="mono" style="margin-top:4px;">
          status:ready|review|author|open|closed · verdict:clean|committer|design|reject|unroasted · cfbot:pass|fail|rebase · has:novel · no:committer · no:reviewer · is:starred|unvisited|unroasted|mine · tag:NAME · author:"Name" · topic:"Name"
        </div>
      </details>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:28px;">★</th>
            <th>CF</th>
            <th>Title &amp; Authors</th>
            <th>Verdict</th>
            <th>Novelty</th>
            <th>CF Status</th>
            <th>CFBot CI</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${
            state.loading.explorer
              ? `<tr><td colspan="8">${renderLoader(state.loadingMessage || "Loading CommitFest entries…")}</td></tr>`
              : state.entries.length === 0
                ? `<tr><td colspan="8" class="empty-state">No entries match the current filters. <button class="btn btn-secondary btn-sm" id="exp-clear-filters-btn" style="margin-left:8px;">Reset filters</button></td></tr>`
                : state.entries
                    .map((e) => {
                      let tags: string[] = [];
                      try { tags = JSON.parse(e.tags_json || "[]") as string[]; } catch { tags = []; }
                      return `
                <tr class="clickable" data-open-cf="${e.cf_id}">
                  <td>
                    <button type="button" class="star-btn ${e.starred ? "starred" : ""}" data-toggle-star="${e.cf_id}" data-starred="${e.starred ? "1" : "0"}" title="${e.starred ? "Unstar" : "Star"}">
                      ${e.starred ? "★" : "☆"}
                    </button>
                  </td>
                  <td class="mono">
                    <div>${e.visited_at ? `<span class="visited-dot" title="Visited ${esc(e.visited_at.slice(0, 10))}"></span>` : ""}<strong>${e.cf_id}</strong></div>
                    <div style="font-size:10.5px;margin-top:2px;white-space:nowrap;">
                      <a href="https://commitfest.postgresql.org/patch/${e.cf_id}/" target="_blank" rel="noopener" data-ext-link="1">CF ↗</a>
                      ${e.thread_url ? ` · <a href="${esc(e.thread_url)}" target="_blank" rel="noopener" data-ext-link="1">thread ↗</a>` : ""}
                    </div>
                    ${e.is_mine ? `<div style="margin-top:2px;"><span class="pill pill-purple">${esc(e.mine_role || "mine")}</span></div>` : ""}
                  </td>
                  <td>
                    <div><strong>${esc(e.title)}</strong></div>
                    <div class="muted" style="font-size:11.5px;">
                      ${esc(e.authors || "—")}${e.reviewers ? ` · Rev: ${esc(e.reviewers)}` : ""}
                      ${e.committer ? ` · Com: ${esc(e.committer)}` : ""}
                    </div>
                    ${
                      tags.length > 0 || e.notes
                        ? `<div class="chip-row" style="margin-top:3px;">
                            ${tags.map((t) => `<span class="pill pill-info" style="font-size:10px;">#${esc(t)}</span>`).join("")}
                            ${e.notes ? `<span class="pill pill-neutral" style="font-size:10px;" title="${esc(e.notes)}">📝 note</span>` : ""}
                          </div>`
                        : ""
                    }
                  </td>
                  <td>${verdictPill(e.verdict)}</td>
                  <td>
                    ${
                      e.new_objection_count > 0
                        ? `<span class="pill pill-info">${e.new_objection_count} new</span>`
                        : `<span class="muted">0 new</span>`
                    }
                    <span class="dim" style="font-size:11px;"> / ${e.objection_count} total</span>
                    ${e.prior_attempts_count > 0 ? `<div class="muted" style="font-size:11px;">${e.prior_attempts_count} prior attempt(s)</div>` : ""}
                  </td>
                  <td><span class="pill pill-neutral">${esc(e.status || "—")}</span></td>
                  <td>${cfbotPill(e.cfbot_status)}</td>
                  <td class="mono">${Math.round(e.recommended_score)}</td>
                </tr>
              `;
                    })
                    .join("")
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderObjectionCard(obj: RoastObjection, novelty: "new" | "revisits_precedent" | "open_in_thread"): string {
  const isFatal = obj.severity === "fatal";
  const cls = isFatal
    ? "fatal"
    : novelty === "new"
      ? "novel-new"
      : novelty === "revisits_precedent"
        ? "novel-precedent"
        : "novel-thread";
  const badge =
    novelty === "new"
      ? `<span class="pill pill-info">NEW OBJECTION</span>`
      : novelty === "revisits_precedent"
        ? `<span class="pill pill-purple">PRECEDENT</span>`
        : `<span class="pill pill-neutral">OPEN IN THREAD</span>`;

  return `
    <div class="objection-card ${cls}">
      <div class="objection-title">
        ${badge}
        ${isFatal ? `<span class="pill pill-danger">FATAL</span>` : `<span class="pill pill-warn">${esc(obj.severity || "fixable")}</span>`}
        <span>${esc(obj.title)}</span>
      </div>
      ${obj.failure_scenario ? `<p style="margin:4px 0;"><strong>Scenario:</strong> ${esc(obj.failure_scenario)}</p>` : ""}
      ${obj.argument ? `<p class="muted" style="margin:4px 0;">${esc(obj.argument)}</p>` : ""}
      ${obj.author_must_show ? `<p style="margin:6px 0 0;"><strong>Question:</strong> ${esc(obj.author_must_show)}</p>` : ""}
    </div>
  `;
}

function renderGatePanel(gates: AllGatesResult | null): string {
  if (!gates) {
    return `<div class="gate-panel muted">Click "Check All 4 Gates" to run Confidentiality, cfbot, Plain-Text/Wrap/STE, and Duplicate checks.</div>`;
  }
  const all = [
    gates.gates.confidentiality,
    gates.gates.cfbot_attachments,
    gates.gates.plain_text_etiquette,
    gates.gates.duplicate_freshness,
  ];
  const labels: Record<string, string> = {
    confidentiality: "1. Public-Confidentiality (HARD BLOCK)",
    cfbot_attachments: "2. cfbot Attachment Guard",
    plain_text_etiquette: "3. Plain-Text, 72-Column Wrap & -hackers Etiquette",
    duplicate_freshness: "4. Final Duplicate & Thread Freshness",
  };
  return `
    <div class="gate-panel">
      <div class="inline-row" style="justify-content:space-between;margin-bottom:6px;">
        <strong>Automated Pre-Draft Safety Gates</strong>
        ${
          gates.hardBlocked
            ? `<span class="pill pill-danger">HARD BLOCKED (${gates.blockCount} block, ${gates.warningCount} warn)</span>`
            : gates.warningCount > 0
              ? `<span class="pill pill-warn">PASS WITH WARNINGS (${gates.warningCount})</span>`
              : `<span class="pill pill-ok">ALL 4 GATES CLEAN</span>`
        }
      </div>
      ${all
        .map(
          (g) => `
        <div class="gate-item">
          <span>${g.blocking ? "🛑" : g.passed ? "✅" : "⚠️"}</span>
          <div style="flex:1;">
            <div><strong>${labels[g.gate]}</strong></div>
            ${
              g.issues.length === 0
                ? `<div class="muted">Clean</div>`
                : g.issues
                    .map(
                      (i) =>
                        `<div style="color:${i.severity === "block" ? "var(--danger)" : i.severity === "warn" ? "var(--warn)" : "var(--text-muted)"};margin-top:2px;">• ${esc(i.message)}</div>`,
                    )
                    .join("")
            }
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderWorkbenchView(): string {
  if (state.loading.detail && !state.detail) {
    return renderLoader(state.loadingMessage || "Loading CommitFest entry…");
  }
  if (!state.detail) {
    return `<div class="empty-state">Select a CommitFest entry from Shortlist or Explorer, or enter a CF # in the top-right jump box.</div>`;
  }
  const { entry, roast, experts, workItems } = state.detail;
  const runs = state.detail.runs ?? [];
  const triage = state.detail.triage ?? { cf_id: entry.cf_id, starred: 0, tags: [], notes: "", visited_at: "", updated_at: "" };
  const objections = roast?.objections ?? [];
  const novelObjs: RoastObjection[] = [];
  const threadObjs: RoastObjection[] = [];
  for (const o of objections) {
    const nov = inferObjectionNovelty(o);
    if (nov === "open_in_thread") threadObjs.push(o);
    else novelObjs.push(o);
  }
  const workaroundObj = objections.find(
    (o) =>
      /already[-_ ]?exists|maintenance[-_ ]?fit/i.test(o.category || "") ||
      /\b(already exists|already solves|workaround|covered by|can already be done|external tool|separate service|pg_amcheck|existing extension)\b/i.test(
        `${o.title} ${o.argument || ""} ${o.failure_scenario || ""}`,
      ),
  );
  const failingSummary = (() => {
    if (!roast) return "";
    const lvl = roast.failing_level ? `Fails at level ${roast.failing_level}` : "";
    const cats = Array.from(
      new Set(objections.map((o) => (o.category || "").replace(/[-_]+/g, " ").trim()).filter(Boolean)),
    ).slice(0, 3);
    if (lvl && cats.length) return `${lvl}: ${cats.join(", ")}`;
    return lvl || cats.join(", ");
  })();
  const opinionsList = runs.length > 0
    ? runs.map((r) => ({
        backend: r.backend,
        roastLevel: r.roast_level || "medium",
        roastFlavour: r.roast_flavour || "default",
        models: r.models_json && r.models_json !== "{}" ? r.models_json : "",
        verdict: r.verdict,
        confidence: r.confidence,
        date: r.created_at.slice(0, 10),
        contributorName: r.contributor_name || "",
        contributorHandle: r.contributor_handle || "",
        contributorProvider: r.contributor_provider || "local",
        contributorAvatar: r.contributor_avatar || "",
      }))
    : roast
      ? [{
          backend: roast.backend || "imported",
          roastLevel: roast.roast_level || "medium",
          roastFlavour: roast.roast_flavour || "default",
          models: roast.models ? Object.values(roast.models).filter(Boolean).slice(0, 2).join(" / ") : "",
          verdict: String(roast.verdict || entry.verdict || ""),
          confidence: String(roast.confidence || entry.confidence || ""),
          date: (roast.generated_at || entry.updated_at || "").slice(0, 10),
          contributorName: state.identity?.name || state.settings?.authorName || "",
          contributorHandle: state.identity?.handle || state.settings?.cfUsername || "",
          contributorProvider: state.identity?.provider || "local",
          contributorAvatar: state.identity?.avatarUrl || "",
        }]
      : [];
  const uniqueOpinionVerdicts = Array.from(new Set(opinionsList.map((o) => o.verdict).filter(Boolean)));
  const opinionAgreement =
    opinionsList.length >= 2
      ? uniqueOpinionVerdicts.length === 1
        ? `<span class="pill pill-ok">Models agree (${opinionsList.length} opinions)</span>`
        : `<span class="pill pill-warn">Models disagree (${uniqueOpinionVerdicts.length} verdicts across ${opinionsList.length} runs)</span>`
      : `<span class="pill pill-neutral">${opinionsList.length} opinion recorded</span>`;

  const renderContribCell = (op: (typeof opinionsList)[number]) => {
    const label = op.contributorName || op.contributorHandle || "Local user";
    const handleStr =
      op.contributorHandle && op.contributorHandle !== op.contributorName
        ? op.contributorProvider === "github"
          ? `@${op.contributorHandle}`
          : op.contributorHandle
        : "";
    const provPill =
      op.contributorProvider && op.contributorProvider !== "local"
        ? `<span class="pill pill-neutral" style="font-size:10px;">${esc(op.contributorProvider === "github" ? "GitHub" : "Google")}</span>`
        : "";
    const avatarHtml = op.contributorAvatar
      ? `<span class="contrib-avatar"><img src="${esc(op.contributorAvatar)}" alt="" /></span>`
      : `<span class="contrib-avatar">${esc(label.slice(0, 2).toUpperCase())}</span>`;
    return `<div class="contrib-cell">${avatarHtml}<div><div style="font-weight:600;font-size:11.5px;">${esc(label)}</div>${handleStr || provPill ? `<div class="dim" style="font-size:10.5px;">${esc(handleStr)} ${provPill}</div>` : ""}</div></div>`;
  };

  const activeWi = workItems[0] || null;
  const draft = state.activeDraft;

  const ROAST_LEVEL_CARDS: Array<{
    id: "light" | "medium" | "dark";
    label: string;
    beans: string;
    heat: string;
    desc: string;
    swatch: string;
  }> = [
    {
      id: "light",
      label: "Light Roast",
      beans: "●○○",
      heat: "Idea & Precedents",
      desc: "Thread, patch prose, and 2,547 precedents only. No code read, no compile.",
      swatch: "#d49a4a",
    },
    {
      id: "medium",
      label: "Medium Roast",
      beans: "●●○",
      heat: "Code + Build + Test",
      desc: "Reads C/H/SQL diffs + postgres.git context, runs git apply, meson compile (-Dcassert), and targeted tests.",
      swatch: "#a85c2c",
    },
    {
      id: "dark",
      label: "Dark Roast",
      beans: "●●●",
      heat: "Live PG Stress 🔥",
      desc: "Everything in Medium + boots isolated patched Postgres cluster, runs adversarial SQL stress tests, checks logs + reflection.",
      swatch: "#6e2112",
    },
  ];

  const ROAST_FLAVOUR_CARDS: Array<{
    id: string;
    name: string;
    initials: string;
    lens: string;
    color: string;
  }> = [
    { id: "default", name: "House Blend", initials: "HB", lens: "Balanced committer review", color: "#5e6ad2" },
    { id: "edge-case-hunter", name: "The Edge-Case Hunter", initials: "EC", lens: "Planner, NULLs & semantics", color: "#b85d28" },
    { id: "spec-lawyer", name: "The Spec Lawyer", initials: "SL", lens: "SQL standard, docs & syntax", color: "#2d7d62" },
    { id: "systems-architect", name: "The Systems Architect", initials: "SA", lens: "Concurrency & 10-yr maintenance", color: "#7b5cd6" },
    { id: "perf-hawk", name: "The Perf Hawk", initials: "PH", lens: "Hot path, ABI & benchmarks", color: "#c2444e" },
    { id: "storage-skeptic", name: "The Storage Skeptic", initials: "SS", lens: "WAL, crash recovery & format", color: "#2f78a8" },
    { id: "index-specialist", name: "The Index Specialist", initials: "IS", lens: "GiST/GIN/B-tree & AM APIs", color: "#2b8a82" },
    { id: "production-dba", name: "The Production DBA", initials: "DB", lens: "Upgrades, defaults & ops", color: "#a67721" },
  ];

  const LEGACY_FLAVOUR_MAP: Record<string, string> = {
    "tom-lane": "edge-case-hunter",
    "peter-eisentraut": "spec-lawyer",
    "robert-haas": "systems-architect",
    "andres-freund": "perf-hawk",
    "heikki-linnakangas": "storage-skeptic",
    "bruce-momjian": "production-dba",
    "alexander-korotkov": "index-specialist",
  };
  const normalizeUiFlavour = (raw?: string) => {
    const k = (raw || "default").toLowerCase();
    return LEGACY_FLAVOUR_MAP[k] || k;
  };
  const currentFlavourId = normalizeUiFlavour(state.roastFlavour);

  let rightTabHtml = "";
  if (state.workbenchTab === "roast") {
    const defBackend = state.settings?.defaultBackend || "auto";
    const aiAvail = state.aiSummary?.available || [];
    const dualReady = Boolean(state.aiSummary?.dualReady);
    const activeLevel = ROAST_LEVEL_CARDS.find((l) => l.id === state.roastLevel) || ROAST_LEVEL_CARDS[1]!;
    const activeFlavour = ROAST_FLAVOUR_CARDS.find((f) => f.id === currentFlavourId) || ROAST_FLAVOUR_CARDS[0]!;
    const runBtnHtml =
      activeFlavour.id === "default"
        ? `<span class="roast-cta-main">🔥 Brew ${esc(activeLevel.label)}</span>`
        : `<span class="roast-cta-main">🔥 Brew ${esc(activeLevel.label)}</span><span class="roast-cta-sub">${esc(activeFlavour.name)}</span>`;
    rightTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h3>Roast Studio</h3>
            <div class="muted" style="font-size:12px;">Dial in roast intensity and reviewer archetype — every report &amp; published opinion remembers your choice.</div>
          </div>
          <span class="pill pill-purple">Local CLI · Zero API Key</span>
        </div>

        <div class="roast-section">
          <div class="roast-section-head">
            <span class="roast-section-label">1. Roast Level</span>
            <span class="dim" style="font-size:11.5px;">Active: <strong style="color:var(--text);">${esc(activeLevel.label)}</strong> (${esc(activeLevel.heat)})</span>
          </div>
          <div class="roast-level-grid" role="radiogroup" aria-label="Roast Level">
            ${ROAST_LEVEL_CARDS.map(
              (lvl) => `
              <button type="button" class="roast-level-card roast-level-${lvl.id} ${state.roastLevel === lvl.id ? "active" : ""}" data-pick-roast-level="${lvl.id}" aria-pressed="${state.roastLevel === lvl.id}">
                <div class="roast-level-top">
                  <span class="roast-bean-dot" style="background:${lvl.swatch};"></span>
                  <strong>${esc(lvl.label)}</strong>
                  <span class="roast-heat-tag">${esc(lvl.heat)}</span>
                </div>
                <div class="roast-level-desc">${esc(lvl.desc)}</div>
              </button>
            `,
            ).join("")}
          </div>
        </div>

        <div class="roast-section">
          <div class="roast-section-head">
            <span class="roast-section-label">2. Reviewer Archetype</span>
            <button type="button" class="btn btn-secondary btn-sm" id="roast-surprise-btn" title="Pick a random roast level and reviewer archetype">🎲 Surprise me</button>
          </div>
          <div class="roast-flavour-grid" role="radiogroup" aria-label="Reviewer Archetype">
            ${ROAST_FLAVOUR_CARDS.map(
              (fl) => `
              <button type="button" class="roast-flavour-chip ${currentFlavourId === fl.id ? "active" : ""}" data-pick-roast-flavour="${fl.id}" aria-pressed="${currentFlavourId === fl.id}">
                <span class="roast-flavour-avatar" style="background:${fl.color};">${esc(fl.initials)}</span>
                <span class="roast-flavour-text">
                  <strong>${esc(fl.name)}</strong>
                  <small>${esc(fl.lens)}</small>
                </span>
              </button>
            `,
            ).join("")}
          </div>
          <div class="roast-flavour-disclaimer">
            <strong>AI review archetypes:</strong> these are fictional engineering lenses to stress-test different PostgreSQL risk areas — never a human committer verdict, and AI makes mistakes all the time.
          </div>
        </div>

        <details class="roast-advanced">
          <summary>Backend, models &amp; options <span class="dim">(${esc(defBackend)} · 1 reflection round)</span></summary>
          <div class="form-grid" style="margin-top:10px;">
            <div class="form-field">
              <label>Backend</label>
              <select id="roast-backend">
                <option value="auto" ${defBackend === "auto" ? "selected" : ""}>auto (${aiAvail[0] ? `detected: ${esc(aiAvail[0])}` : "first available AI CLI"})</option>
                <option value="claude" ${defBackend === "claude" ? "selected" : ""}>claude (Claude Code CLI)</option>
                <option value="codex" ${defBackend === "codex" ? "selected" : ""}>codex (OpenAI Codex CLI)</option>
                <option value="agy" ${defBackend === "agy" ? "selected" : ""}>agy (Antigravity CLI)</option>
                <option value="dual" ${defBackend === "dual" ? "selected" : ""}>dual (Claude + agy cross-family${dualReady ? "" : " — needs both"})</option>
              </select>
            </div>
            <div class="form-field">
              <label>Reflection Rounds</label>
              <select id="roast-rounds">
                <option value="0">0 (Standard single pass)</option>
                <option value="1" selected>1 ("What did you forget?")</option>
                <option value="2">2 (+ "Are you happy?")</option>
              </select>
            </div>
            <div class="form-field">
              <label>Claude Critic/Synth Model</label>
              <select id="roast-claude-model">
                <option value="opus" selected>opus (default — works on all Claude accounts)</option>
                <option value="claude-opus-4-6">claude-opus-4-6</option>
              </select>
            </div>
            <div class="form-field">
              <label>Antigravity (agy) Model</label>
              <input type="text" id="roast-agy-model" value="${esc(state.settings?.defaultAgyModel || "")}" placeholder="CLI default (or custom model ID)" />
            </div>
          </div>
          <div class="inline-row" style="margin-top:8px;">
            <label class="inline-row" style="cursor:pointer;">
              <input type="checkbox" id="roast-self" /> <span>--self (author pre-flight mode for your own patch)</span>
            </label>
            <label class="inline-row" style="cursor:pointer;">
              <input type="checkbox" id="roast-dryrun" /> <span>--dry-run (print prompts, no model call)</span>
            </label>
          </div>
        </details>

        <div class="roast-actions-grid">
          <div class="roast-action-box roast-action-primary">
            <button type="button" class="btn btn-primary roast-cta-btn" id="run-roast-btn">${runBtnHtml}</button>
            <div class="roast-action-explain">
              <strong>Adversarial pre-review:</strong> runs 7 parallel review angles + critic against 2,500+ prior Postgres rejections &amp; reverts to surface new design objections.
            </div>
          </div>
          <div class="roast-action-box">
            <button type="button" class="btn btn-secondary" id="run-pushback-btn" style="width:100%;justify-content:center;">🕵️ Run Pushback Analysis</button>
            <div class="roast-action-explain">
              <strong>Thread archaeology (for stuck patches):</strong> reads every <code class="mono">-hackers</code> message to extract who already objected, verbatim quotes, and whether blockers were resolved.
            </div>
          </div>
        </div>

        <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
          <div class="dim" style="font-size:11px;font-weight:600;margin-bottom:4px;">Run the same from CLI (<code>npx pgroast</code>):</div>
          ${renderCmdSnippet(
            `npx pgroast ${state.detail.entry.cf_id}${defBackend && defBackend !== "auto" ? ` --backend ${defBackend}` : ""} --roast-level ${state.roastLevel} --flavour ${currentFlavourId}`,
          )}
          <div style="margin-top:6px;">
            ${renderCmdSnippet(`npx pgroast pushback ${state.detail.entry.cf_id}`)}
          </div>
        </div>
      </div>

      ${
        state.detail.lightRoast
          ? `
        <div class="card">
          <div class="card-header">
            <h3>PG Light Roast (Author Pre-Flight Checklist)</h3>
            <button type="button" class="btn btn-secondary btn-sm" id="wb-copy-light-roast-btn" title="Copy friendly Light Roast checklist into Reply Studio draft">Send to Reply Draft</button>
          </div>
          <p class="muted" style="margin-top:0;font-size:12px;">Friendly submission hygiene check first, followed by gentle experimental design heads-up notes for the patch author.</p>
          ${state.detail.lightRoast.checks
            .map(
              (c) => `
            <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;">
              <span class="pill ${c.status === "ok" ? "pill-ok" : c.status === "warn" ? "pill-warn" : "pill-neutral"}" style="min-width:56px;justify-content:center;">${c.status === "ok" ? "ok" : c.status === "warn" ? "check" : "verify"}</span>
              <div><strong>${esc(c.label)}</strong><div class="muted" style="font-size:11.5px;">${esc(c.detail)}</div></div>
            </div>
          `,
            )
            .join("")}
          ${
            state.detail.lightRoast.experimentalHeadsUp.length > 0
              ? `
            <div class="section-label">Experimental Design Heads-Up (gentle notes for author)</div>
            <ul style="margin:0 0 0 18px;padding:0;font-size:12px;color:var(--text-muted);">
              ${state.detail.lightRoast.experimentalHeadsUp.map((h) => `<li style="margin-bottom:4px;">${esc(h)}</li>`).join("")}
            </ul>
          `
              : ""
          }
        </div>
      `
          : ""
      }

      ${
        entry.pushback_md
          ? `<div class="card"><div class="card-header"><h3>Pushback Analysis</h3></div><pre class="mono" style="white-space:pre-wrap;font-size:11.5px;margin:0;">${esc(entry.pushback_md)}</pre></div>`
          : ""
      }
    `;
  } else if (state.workbenchTab === "diff") {
    const diff = state.diffData;
    const comments = state.diffComments;
    rightTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h3>Experimental Patch Diff &amp; Inline Review</h3>
            <div class="muted" style="font-size:12px;">Click any line to leave an inline review note, then compile all notes into a clean <code>-hackers</code> plain-text draft.</div>
          </div>
          <div class="inline-row">
            <button type="button" class="btn btn-secondary btn-sm" id="diff-load-btn" ${state.diffLoading ? "disabled" : ""}>${state.diffLoading ? "Loading…" : diff ? "Reload Diff" : "Load CFBot Diff"}</button>
            ${
              comments.length > 0
                ? `<button type="button" class="btn btn-primary btn-sm" id="diff-compile-btn">Compile ${comments.length} Note${comments.length === 1 ? "" : "s"} → Reply Studio</button>`
                : ""
            }
          </div>
        </div>
        ${
          state.diffLoading
            ? renderLoader(`Fetching unified diff for CF #${entry.cf_id} from postgresql-cfbot…`)
            : state.diffError
              ? `
              <div class="diff-error-box">
                <div style="font-weight:600;color:var(--danger);margin-bottom:4px;">Could not load CFBot diff for CF #${entry.cf_id}</div>
                <div class="muted" style="font-size:12px;margin-bottom:10px;">${esc(state.diffError)}</div>
                <div class="inline-row" style="gap:8px;flex-wrap:wrap;">
                  <button type="button" class="btn btn-primary btn-sm" id="diff-retry-btn">Retry Load Diff</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="diff-reload-page-btn">Reload Backoffice</button>
                  <a class="btn btn-secondary btn-sm" href="https://github.com/postgresql-cfbot/postgresql/compare/master...cf/${entry.cf_id}" target="_blank" rel="noopener">Open CFBot on GitHub ↗</a>
                </div>
              </div>`
              : !diff
                ? `<div class="muted" style="font-size:12px;">Click <strong>Load CFBot Diff</strong> to pull the latest patch series (<code>cf/${entry.cf_id}</code>) and review line-by-line like a PR/MR.</div>`
                : `
              <div class="inline-row muted" style="font-size:12px;margin-bottom:10px;justify-content:space-between;">
                <span>${diff.files.length} file${diff.files.length === 1 ? "" : "s"} changed · <span style="color:var(--ok);">+${diff.totalAdditions}</span> / <span style="color:var(--danger);">-${diff.totalDeletions}</span>${diff.truncated ? " (truncated)" : ""}</span>
                <a href="${esc(diff.compareUrl)}" target="_blank" rel="noopener">Open CFBot compare ↗</a>
              </div>
              <div style="max-height:62vh;overflow-y:auto;">
                ${diff.files
                  .map(
                    (f) => `
                  <div class="diff-file">
                    <div class="diff-file-head">
                      <span class="mono" style="font-weight:500;">${esc(f.newPath || f.oldPath)}</span>
                      <span class="mono" style="font-size:11px;"><span style="color:var(--ok);">+${f.additions}</span> <span style="color:var(--danger);">-${f.deletions}</span></span>
                    </div>
                    ${f.hunks
                      .map(
                        (h) => `
                      <div class="diff-hunk-head mono">${esc(h.header)}</div>
                      ${h.lines
                        .map((ln) => {
                          const effectiveLine = ln.newLine ?? ln.oldLine ?? 1;
                          const sign = ln.type === "add" ? "+" : ln.type === "del" ? "-" : " ";
                          const lineComments = comments.filter(
                            (c) => c.file_path === (f.newPath || f.oldPath) && c.line_num === effectiveLine,
                          );
                          return `
                            <div class="diff-line ${ln.type}" data-diff-file="${esc(f.newPath || f.oldPath)}" data-diff-line="${effectiveLine}" data-diff-type="${ln.type}" data-diff-code="${esc(ln.content)}">
                              <span class="diff-ln">${ln.oldLine ?? ""}</span>
                              <span class="diff-ln">${ln.newLine ?? ""}</span>
                              <span class="diff-sign">${sign}</span>
                              <span class="diff-code">${esc(ln.content)}</span>
                              <span class="diff-comment-trigger">+ note</span>
                            </div>
                            ${lineComments
                              .map(
                                (c) => `
                              <div class="diff-inline-comment">
                                <div class="inline-row" style="justify-content:space-between;margin-bottom:3px;">
                                  <span class="dim" style="font-size:11px;">Inline review note (line ${c.line_num})</span>
                                  <button type="button" class="btn btn-ghost btn-sm" data-del-diff-comment="${c.id}">Remove</button>
                                </div>
                                <div>${esc(c.comment_text)}</div>
                              </div>
                            `,
                              )
                              .join("")}
                          `;
                        })
                        .join("")}
                    `,
                      )
                      .join("")}
                  </div>
                `,
                  )
                  .join("")}
              </div>
            `
        }
      </div>
    `;
  } else if (state.workbenchTab === "build") {
    rightTabHtml = `
      <div class="card">
        <div class="card-header">
          <h3>Isolated Worktree Build &amp; Test</h3>
          ${
            activeWi
              ? `<button type="button" class="btn btn-secondary btn-sm" data-open-wi="${activeWi.id}" title="Open this Work Item in Jobs & Work Items">Work Item #${activeWi.id} (${esc(activeWi.status)}) →</button>`
              : `<button class="btn btn-secondary btn-sm" id="create-wi-btn">+ Create Work Item</button>`
          }
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label>Target Upstream Branch</label>
            <select id="bt-branch">
              <option value="master">upstream/master (PG20)</option>
              <option value="REL_19_STABLE">upstream/REL_19_STABLE (PG19)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Suites (comma-separated)</label>
            <input type="text" id="bt-suites" value="regress,isolation" />
          </div>
        </div>
        <div class="inline-row" style="margin-top:6px;">
          <button class="btn btn-primary" id="run-build-btn">⚙ Build &amp; Test (Meson + cassert)</button>
          ${
            activeWi?.worktree_path
              ? `<button class="btn btn-ghost btn-sm" id="cleanup-wt-btn">Cleanup Worktree</button>`
              : ""
          }
        </div>
        ${
          activeWi?.worktree_path
            ? `<div class="muted mono" style="margin-top:8px;font-size:11px;">Worktree: ${esc(activeWi.worktree_path)}</div>`
            : ""
        }
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Adversarial AI Review &amp; Cross-Family Blind Verification</h3>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label>Primary Reviewer Family</label>
            <select id="ai-rev-backend">
              <option value="claude">Claude Code (Opus)</option>
              <option value="codex">Codex CLI</option>
              <option value="agy">Antigravity (agy)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Model</label>
            <input type="text" id="ai-rev-model" value="opus" />
          </div>
        </div>
        <div class="form-field">
          <label>Specific Focus / Hypothesis</label>
          <textarea id="ai-rev-focus" rows="2" placeholder="e.g. Check concurrent VACUUM page deletion &amp; lock strength in verify_gist.c…"></textarea>
        </div>
        <div class="inline-row">
          <button class="btn btn-primary" id="run-ai-review-btn">Launch AI Code/Test Review</button>
          <button class="btn btn-ok" id="run-blind-verify-btn">Launch Cross-Family Blind Verify</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Remote Hetzner Runner (Heavy ASan / WAL / TAP Matrix)</h3>
        </div>
        <div class="inline-row">
          <select id="hetzner-profile">
            <option value="asan">ASan + UBSan + cassert</option>
            <option value="wal_consistency">wal_consistency_checking=all (recovery)</option>
            <option value="tap_matrix">Full TAP Matrix</option>
          </select>
          <button class="btn btn-secondary" id="run-hetzner-btn">Run on Hetzner SSH</button>
        </div>
      </div>

      ${
        activeWi
          ? `
        <div class="card">
          <div class="card-header">
            <h3>Private Evidence Record (Work Item #${activeWi.id})</h3>
            <button class="btn btn-secondary btn-sm" id="save-wi-evidence-btn">Save Evidence</button>
          </div>
          <textarea id="wi-evidence-md" rows="6" class="mono" placeholder="Record exact upstream base SHA, patch SHA-256s, reproducer SQL, decisive output…">${esc(activeWi.evidence_md)}</textarea>
        </div>
      `
          : ""
      }
    `;
  } else if (state.workbenchTab === "reply") {
    const gmailLabel = state.settings?.gmailAccount ? `gws · ${state.settings.gmailAccount}` : "gws · configure in Settings";
    const skillsLabel = state.skillsSummary?.mode === "custom" ? "Custom Skills" : "Built-in Basic Skills";
    rightTabHtml = `
      <div class="card">
        <div class="card-header">
          <h3>1. Locate Exact Thread in Gmail (${esc(gmailLabel)})</h3>
        </div>
        <div class="inline-row">
          <input type="text" id="gmail-search-q" style="flex:1;" value="${esc(entry.title.slice(0, 50))}" placeholder="Gmail search query…" />
          <button class="btn btn-secondary btn-sm" id="gmail-search-btn">Search Gmail</button>
        </div>
        ${
          draft.gmailMatches.length > 0
            ? `
          <div style="margin-top:8px;max-height:150px;overflow-y:auto;">
            ${draft.gmailMatches
              .map(
                (m, idx) => `
              <div style="padding:6px;border:1px solid var(--border);border-radius:6px;margin-bottom:5px;display:flex;justify-content:space-between;gap:8px;align-items:center;">
                <div style="min-width:0;">
                  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.subject)}</div>
                  <div class="muted" style="font-size:11px;">${esc(m.from)} · ${esc(m.date)}</div>
                </div>
                <button class="btn btn-secondary btn-sm" data-pick-gmail="${idx}">Use Thread</button>
              </div>
            `,
              )
              .join("")}
          </div>
        `
            : `<div class="muted" style="margin-top:6px;font-size:11.5px;">Missing from Gmail? Use PostgreSQL archive "Resend email" to preserve In-Reply-To / References threading.</div>`
        }
      </div>

      <div class="card">
        <div class="card-header">
          <h3>2. Compose Plain-Text Draft (${esc(skillsLabel)})</h3>
          <div class="inline-row">
            <select id="draft-gen-backend">
              <option value="template">Fast Plain-Text Template</option>
              <option value="claude">Claude CLI</option>
              <option value="agy">Antigravity (agy) CLI</option>
            </select>
            <button class="btn btn-secondary btn-sm" id="draft-generate-btn">Generate Draft</button>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label>To (Reply-All)</label>
            <input type="text" id="draft-to" value="${esc(draft.to)}" />
          </div>
          <div class="form-field">
            <label>Cc</label>
            <input type="text" id="draft-cc" value="${esc(draft.cc)}" />
          </div>
        </div>
        <div class="form-field">
          <label>Subject</label>
          <input type="text" id="draft-subject" value="${esc(draft.subject)}" />
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label>In-Reply-To (Message-ID)</label>
            <input type="text" id="draft-in-reply-to" class="mono" value="${esc(draft.inReplyTo)}" />
          </div>
          <div class="form-field">
            <label>Gmail Thread ID</label>
            <input type="text" id="draft-thread-id" class="mono" value="${esc(draft.threadId)}" />
          </div>
        </div>
        <div class="inline-row" style="margin-bottom:8px;">
          <label class="inline-row"><input type="checkbox" id="draft-is-reply" ${draft.isReply ? "checked" : ""} /> <span>Thread Reply (require '&gt;' quote)</span></label>
          <label class="inline-row"><input type="checkbox" id="draft-other-author" ${draft.isOtherAuthorThread ? "checked" : ""} /> <span>Other author's CF thread (cfbot guard)</span></label>
          <label class="inline-row"><input type="checkbox" id="draft-footnote-att" /> <span>Attach AI notes footnote</span></label>
        </div>
        <div class="form-field">
          <label>Plain-Text Body (72–75 cols, lowercase SQL, numbered [1] links)</label>
          <textarea id="draft-body" rows="12" class="mono">${esc(draft.body)}</textarea>
        </div>

        <div class="inline-row" style="margin-bottom:8px;">
          <input type="text" id="draft-new-att-name" placeholder="Attachment filename (e.g. nocfbot-fix.diff)" style="flex:1;" />
          <button class="btn btn-ghost btn-sm" id="draft-add-att-btn">+ Add Attachment</button>
        </div>
        ${
          draft.attachments.length > 0
            ? `<div class="chip-row" style="margin-bottom:8px;">
                ${draft.attachments
                  .map(
                    (a, idx) => `<span class="pill pill-neutral">${esc(a.filename)} <button data-rm-att="${idx}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 2px;">✕</button></span>`,
                  )
                  .join("")}
              </div>`
            : ""
        }

        ${renderGatePanel(draft.gates)}

        <div class="inline-row" style="justify-content:space-between;margin-top:10px;">
          <div class="inline-row">
            <button class="btn btn-secondary" id="draft-check-gates-btn">Check All 4 Gates &amp; Wrap</button>
            <button class="btn btn-ghost" id="draft-save-local-btn">Save Local</button>
          </div>
          <button class="btn btn-primary" id="draft-save-gmail-btn">Save Threaded Gmail Draft (Never Sends)</button>
        </div>
        ${
          draft.gmailDraftUrl
            ? `<div style="margin-top:8px;"><span class="pill pill-ok">Saved in Gmail Drafts</span> <a href="${esc(draft.gmailDraftUrl)}" target="_blank">Open Gmail Drafts →</a></div>`
            : ""
        }
      </div>
    `;
  } else {
    // CommitFest & Fork Sync tab
    const cfUserLabel = state.cfAuth?.verifiedUser || state.cfAuth?.username || "not signed in";
    const forkLabel = state.settings?.githubFork || "Not configured — set in Settings";
    rightTabHtml = `
      <div class="card">
        <div class="card-header">
          <h3>CommitFest Authenticated Actions (${esc(cfUserLabel)})</h3>
          ${
            state.cfAuth?.hasSessionCookie
              ? `<span class="pill pill-ok">Cookie Ready</span>`
              : `<button type="button" class="pill pill-warn pill-clickable" id="wb-connect-cf-btn" title="Open Settings to connect your CommitFest login cookie">Connect Login in Setup/Settings →</button>`
          }
        </div>
        <p class="muted" style="margin-top:0;">Every mutation requires explicit confirmation in a modal and fetches a fresh Django CSRF token.</p>
        <div class="inline-row" style="margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" data-cf-act="reviewer_become">Become Reviewer</button>
          <button class="btn btn-ghost btn-sm" data-cf-act="reviewer_remove">Remove Self as Reviewer</button>
          <button class="btn btn-secondary btn-sm" data-cf-act="cfbot_requeue">Requeue cfbot</button>
        </div>
        <div class="section-label">Change Patch Status</div>
        <div class="inline-row" style="margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" data-cf-status="review">Needs review</button>
          <button class="btn btn-secondary btn-sm" data-cf-status="author">Waiting on Author</button>
          <button class="btn btn-ok btn-sm" data-cf-status="committer">Ready for Committer</button>
        </div>
        <div class="section-label">Add CommitFest Annotation (≤500 chars)</div>
        <div class="form-grid">
          <div class="form-field">
            <label>Mailthread ID</label>
            <input type="text" id="cf-ann-tid" placeholder="e.g. 12345" />
          </div>
          <div class="form-field">
            <label>Message-ID</label>
            <input type="text" id="cf-ann-msgid" value="${esc(entry.latest_message_id)}" />
          </div>
        </div>
        <div class="form-field">
          <textarea id="cf-ann-text" rows="2" maxlength="500" placeholder="Short annotation (≤500 chars)…"></textarea>
        </div>
        <button class="btn btn-secondary btn-sm" id="cf-ann-btn">Post Annotation…</button>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>GitHub Fork Sync (${esc(forkLabel)})</h3>
        </div>
        ${
          activeWi
            ? `
          <div class="inline-row muted" style="margin-bottom:8px;">
            <button type="button" class="btn btn-ghost btn-sm" data-open-wi="${activeWi.id}">Active Work Item #${activeWi.id} (${esc(activeWi.slug)}) →</button>
            ${activeWi.github_issue_url ? `<a href="${esc(activeWi.github_issue_url)}" target="_blank">Issue #${activeWi.github_issue_number} ↗</a>` : ""}
          </div>
          <div class="inline-row" style="margin-bottom:10px;">
            <button class="btn btn-secondary" id="gh-preview-issue-btn">Preview &amp; Publish Sanitized Issue…</button>
          </div>
          <div class="section-label">Push CI-Only Branch (pg-ci.yml, No PR)</div>
          <div class="inline-row">
            <input type="text" id="gh-ci-branch" class="mono" value="ci/cf-${entry.cf_id}-v1" style="flex:1;" />
            <button class="btn btn-secondary btn-sm" id="gh-ci-push-btn">Push CI Branch…</button>
          </div>
        `
            : `<p class="muted">Create a Work Item in the "Build &amp; Test" tab first to track fork issues and CI branches.</p>`
        }
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="inline-row">
            <button type="button" class="star-btn ${triage.starred ? "starred" : ""}" id="wb-star-btn" title="${triage.starred ? "Remove star" : "Star this entry"}">${triage.starred ? "★" : "☆"}</button>
            <span class="mono" style="font-size:14px;font-weight:700;">CF ${entry.cf_id}</span>
            ${verdictPill(entry.verdict)}
            ${roast?.roast_level || roast?.roast_flavour ? `<span class="pill pill-purple">${esc((roast.roast_level || "medium").toUpperCase())} · ${esc(roast.roast_flavour || "default")}</span>` : ""}
            ${entry.status ? `<span class="pill pill-neutral">${esc(entry.status)}</span>` : ""}
            ${cfbotPill(entry.cfbot_status)}
          </div>
          <h2 style="margin:6px 0 2px;font-size:16px;">${esc(entry.title)}</h2>
          <div class="muted" style="font-size:12px;">
            Authors: ${esc(entry.authors || "—")}
            ${entry.reviewers ? ` · Reviewers: ${esc(entry.reviewers)}` : ""}
            ${entry.committer ? ` · Committer: ${esc(entry.committer)}` : ""}
          </div>
        </div>
        <div class="inline-row">
          <a class="btn btn-secondary btn-sm" href="${esc(getPublicAppUrl(entry.cf_id))}" target="_blank" rel="noopener" title="Open CF #${entry.cf_id} in the Public App">Public App ↗</a>
          <a class="btn btn-secondary btn-sm" href="https://commitfest.postgresql.org/patch/${entry.cf_id}/" target="_blank" rel="noopener">CF page ↗</a>
          ${entry.thread_url ? `<a class="btn btn-secondary btn-sm" href="${esc(entry.thread_url)}" target="_blank" rel="noopener">CF thread ↗</a>` : ""}
          ${entry.cfbot_build_url ? `<a class="btn btn-ghost btn-sm" href="${esc(entry.cfbot_build_url)}" target="_blank" rel="noopener">CFBot CI ↗</a>` : ""}
          <button class="btn btn-ghost btn-sm" id="wb-refresh-cf-btn">Refresh CF</button>
        </div>
      </div>
    </div>

    <div class="split-pane">
      <div>
        <div class="card">
          <div class="card-header">
            <h3>Model Opinions &amp; Agreement</h3>
            <div class="inline-row">
              ${opinionAgreement}
              <button type="button" class="btn btn-secondary btn-sm" id="wb-hub-publish-op-btn" title="Publish sanitized opinion to Public App">Publish…</button>
              <button type="button" class="btn btn-ghost btn-sm" id="wb-hub-pull-op-btn" title="Pull teammates' attributed opinions from Public Companion">Pull Team</button>
              <button type="button" class="btn btn-secondary btn-sm" id="wb-record-opinion-btn" title="Record or import a teammate's model opinion (e.g. Kirk, Andrey)">+ Record / Import</button>
              <button type="button" class="btn btn-ghost btn-sm" id="wb-export-opinions-btn" title="Export opinions as JSON to share with teammates">Export JSON</button>
              <button type="button" class="btn btn-ghost btn-sm" id="wb-second-opinion-btn" title="Jump to Roast tab to run another model opinion">Run New</button>
            </div>
          </div>
          ${
            opinionsList.length === 0
              ? `<div class="muted" style="font-size:12px;">No roast opinions recorded yet. Run pgroast on the right or import a teammate's opinion JSON.</div>`
              : `
            <div class="table-wrap" style="border:none;">
              <table>
                <thead><tr><th>Run By</th><th>Backend &amp; Profile</th><th>Verdict</th><th>Confidence</th><th>Date</th></tr></thead>
                <tbody>
                  ${opinionsList
                    .map(
                      (op) => `
                    <tr>
                      <td>${renderContribCell(op)}</td>
                      <td class="mono" style="font-size:11.5px;">
                        <strong>${esc(op.backend)}</strong>
                        <span class="pill pill-neutral" style="font-size:10px;margin-left:4px;">${esc(op.roastLevel)} · ${esc(op.roastFlavour)}</span>
                        ${op.models ? `<div class="muted" style="font-size:10.5px;">${esc(op.models.slice(0, 60))}</div>` : ""}
                      </td>
                      <td>${verdictPill(op.verdict)}</td>
                      <td class="muted">${esc(op.confidence || "—")}</td>
                      <td class="dim mono" style="font-size:11px;">${esc(op.date || "—")}</td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          }
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Personal Triage (Local Only)</h3>
            <span class="dim" style="font-size:11px;">${triage.visited_at ? `Last visited ${esc(triage.visited_at.slice(0, 16).replace("T", " "))}` : ""}</span>
          </div>
          <div class="chip-row" style="margin-bottom:8px;">
            ${
              triage.tags.length > 0
                ? triage.tags
                    .map(
                      (t) => `<span class="pill pill-info">#${esc(t)} <button type="button" data-rm-tag="${esc(t)}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 2px;">×</button></span>`,
                    )
                    .join("")
                : `<span class="muted" style="font-size:11.5px;">No tags yet — add tags like shortlist, ask-committer, needs-repro…</span>`
            }
          </div>
          <div class="inline-row" style="margin-bottom:8px;">
            <input type="text" id="wb-new-tag" placeholder="Add tag (e.g. shortlist, follow-up)…" style="flex:1;" />
            <button type="button" class="btn btn-secondary btn-sm" id="wb-add-tag-btn">+ Tag</button>
          </div>
          <div class="form-field" style="margin-bottom:6px;">
            <textarea id="wb-private-notes" rows="2" placeholder="Private notes for yourself (never published)…">${esc(triage.notes)}</textarea>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="wb-save-notes-btn">Save Notes</button>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Fast-Scan Analysis</h3>
            <span class="muted" style="font-size:11.5px;">
              ${roast?.generated_at ? `AI first pass · ${esc(roast.generated_at.slice(0, 10))}` : "Not roasted yet"}
              ${roast?.confidence ? ` · confidence: ${esc(roast.confidence)}` : ""}
            </span>
          </div>
          ${
            roast
              ? `
            ${failingSummary ? `<div style="margin-bottom:8px;font-weight:600;color:var(--warn);">${esc(failingSummary)}</div>` : ""}
            ${
              workaroundObj
                ? `
              <div class="objection-card" style="border-color:color-mix(in srgb, var(--warn) 38%, transparent);background:var(--warn-soft);">
                <div class="objection-title">
                  <span class="pill pill-warn">Already exists / workaround</span>
                  <span>${esc(workaroundObj.title)}</span>
                </div>
                ${workaroundObj.argument ? `<p style="margin:4px 0 0;">${esc(workaroundObj.argument)}</p>` : ""}
                ${workaroundObj.failure_scenario ? `<p class="muted" style="margin:4px 0 0;">${esc(workaroundObj.failure_scenario)}</p>` : ""}
              </div>
            `
                : ""
            }
            <ul style="margin:0 0 10px 18px;padding:0;line-height:1.55;">
              ${(roast.verdict_reasoning || "")
                .split(/(?<=[.!?])\s+/)
                .filter((s) => s.trim().length > 0)
                .slice(0, 4)
                .map((s) => `<li style="margin-bottom:4px;">${esc(s)}</li>`)
                .join("")}
            </ul>
            ${
              roast.brief?.problem
                ? `<div class="section-label">Problem &amp; Design</div><p class="muted" style="margin:4px 0 10px;">${esc(roast.brief.problem)}</p>`
                : ""
            }
            ${
              entry.thread_url
                ? `<div style="margin-bottom:10px;"><a class="btn btn-secondary btn-sm" href="${esc(entry.thread_url)}" target="_blank" rel="noopener">Read the full CF thread ↗</a> <a class="btn btn-ghost btn-sm" href="https://commitfest.postgresql.org/patch/${entry.cf_id}/" target="_blank" rel="noopener">Open CF page ↗</a></div>`
                : ""
            }

            <div class="section-label">★ New / Precedent Objections (${novelObjs.length})</div>
            ${
              novelObjs.length > 0
                ? novelObjs.map((o) => renderObjectionCard(o, inferObjectionNovelty(o))).join("")
                : `<p class="muted">No unraised or precedent objections recorded.</p>`
            }

            ${
              threadObjs.length > 0
                ? `
              <div class="section-label">Open in Thread (${threadObjs.length})</div>
              ${threadObjs.map((o) => renderObjectionCard(o, "open_in_thread")).join("")}
            `
                : ""
            }

            ${
              (roast.prior_attempts?.length ?? 0) > 0
                ? `
              <div class="section-label">Prior Attempts (${roast.prior_attempts!.length})</div>
              ${roast.prior_attempts!
                .map(
                  (p) => `
                <div class="objection-card novel-precedent">
                  <div class="objection-title">
                    <span class="pill pill-purple">${esc(p.relation || "prior")}</span>
                    <a href="${esc(p.thread_urls?.[0] || p.url || "#")}" target="_blank">${esc(p.title)}</a>
                    <span class="muted" style="font-weight:400;font-size:11.5px;">${esc(p.status || "")} ${esc(p.date || "")}</span>
                  </div>
                  ${p.quote ? `<blockquote style="margin:5px 0;padding-left:8px;border-left:2px solid var(--border-strong);color:var(--text-muted);">"${esc(p.quote)}" — ${esc(p.who_objected || "")}</blockquote>` : ""}
                  ${p.what_is_different ? `<div class="muted" style="font-size:11.5px;"><strong>Different now:</strong> ${esc(p.what_is_different)}</div>` : ""}
                </div>
              `,
                )
                .join("")}
            `
                : ""
            }

            ${
              (roast.questions?.length ?? 0) > 0
                ? `
              <div class="section-label">Questions for Author</div>
              <ol style="margin:4px 0 8px 18px;padding:0;">
                ${roast.questions!.map((q) => `<li style="margin-bottom:4px;">${esc(q)}</li>`).join("")}
              </ol>
            `
                : ""
            }

            <div class="section-label">Subsystem Expert Routing</div>
            <div class="chip-row">
              ${
                experts.length > 0
                  ? experts
                      .map(
                        (e) =>
                          `<span class="pill ${e.source === "git_log" ? "pill-purple" : "pill-neutral"}">${esc(e.name)}${e.commits ? ` · ${e.commits} commits` : ""}${e.subsystem ? ` (${esc(e.subsystem)})` : ""}</span>`,
                      )
                      .join("")
                  : `<span class="muted">No expert routing hints yet.</span>`
              }
            </div>
          `
              : `<div class="empty-state">No roast data yet. Launch Roast v2 on the right panel.</div>`
          }
        </div>
      </div>

      <div>
        <div class="tabs">
          <button class="tab-btn ${state.workbenchTab === "roast" ? "active" : ""}" data-wb-tab="roast">Roast &amp; Pushback</button>
          <button class="tab-btn ${state.workbenchTab === "diff" ? "active" : ""}" data-wb-tab="diff">Diff &amp; Review (Exp)</button>
          <button class="tab-btn ${state.workbenchTab === "build" ? "active" : ""}" data-wb-tab="build">Build, Test &amp; AI Review</button>
          <button class="tab-btn ${state.workbenchTab === "reply" ? "active" : ""}" data-wb-tab="reply">Reply Studio (gws)</button>
          <button class="tab-btn ${state.workbenchTab === "cf_fork" ? "active" : ""}" data-wb-tab="cf_fork">CommitFest &amp; Fork</button>
        </div>
        ${rightTabHtml}
      </div>
    </div>
  `;
}

function renderBugsView(): string {
  return `
    <div class="toolbar">
      <select id="bug-class-filter">
        <option value="all" ${state.bugClassFilter === "all" ? "selected" : ""}>All classifications</option>
        <option value="production_hit" ${state.bugClassFilter === "production_hit" ? "selected" : ""}>🔥 Seen in production</option>
        <option value="unclear" ${state.bugClassFilter === "unclear" ? "selected" : ""}>Unclear</option>
        <option value="synthetic_ai_hunt" ${state.bugClassFilter === "synthetic_ai_hunt" ? "selected" : ""}>Synthetic / AI Hunt</option>
      </select>
      <select id="bug-sev-filter">
        <option value="all" ${state.bugSeverityFilter === "all" ? "selected" : ""}>All severities</option>
        <option value="data_loss" ${state.bugSeverityFilter === "data_loss" ? "selected" : ""}>Data Loss / Corruption</option>
        <option value="wrong_results" ${state.bugSeverityFilter === "wrong_results" ? "selected" : ""}>Wrong Results / Missing Rows</option>
        <option value="crash" ${state.bugSeverityFilter === "crash" ? "selected" : ""}>Crash / Segfault / PANIC</option>
        <option value="oom" ${state.bugSeverityFilter === "oom" ? "selected" : ""}>OOM / Memory Leak</option>
        <option value="regression" ${state.bugSeverityFilter === "regression" ? "selected" : ""}>Regression</option>
      </select>
      <button class="btn btn-primary" id="bugs-scan-btn">Scan Recent pgsql-bugs (14d)</button>
      <button class="btn btn-secondary" id="bugs-add-manual-btn">+ Classify Pasted Report</button>
    </div>
    <div style="margin-bottom:10px;">
      ${renderCmdSnippet("npx pgroast bugs --days 14 --limit 30")}
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Classification</th>
            <th>Severity</th>
            <th>Subject &amp; Production Signals</th>
            <th>Versions</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${
            state.loading.bugs && state.bugs.length === 0
              ? `<tr><td colspan="6">${renderLoader(state.loadingMessage || "Loading pgsql-bugs…")}</td></tr>`
              : state.bugs.length === 0
                ? `<tr><td colspan="6" class="empty-state">No pgsql-bugs reports triaged yet. Click "Scan Recent pgsql-bugs" or paste a report to classify.</td></tr>`
                : state.bugs
                  .map((b) => {
                    let sigs: string[] = [];
                    try { sigs = JSON.parse(b.production_signals_json || "[]") as string[]; } catch { sigs = []; }
                    const clsPill =
                      b.classification === "production_hit"
                        ? `<span class="pill pill-danger">Seen in production</span>`
                        : b.classification === "synthetic_ai_hunt"
                          ? `<span class="pill pill-neutral">Found by hunting</span>`
                          : `<span class="pill pill-warn">Unclear</span>`;
                    const sevPill =
                      b.severity === "data_loss" || b.severity === "wrong_results" || b.severity === "crash"
                        ? `<span class="pill pill-danger">${esc(b.severity)}</span>`
                        : `<span class="pill pill-warn">${esc(b.severity)}</span>`;
                    return `
                  <tr>
                    <td>${clsPill}<div class="dim" style="font-size:11px;margin-top:2px;">conf ${Math.round(b.confidence * 100)}%</div></td>
                    <td>${sevPill}</td>
                    <td>
                      <div><strong>${b.thread_url ? `<a href="${esc(b.thread_url)}" target="_blank">${esc(b.subject)}</a>` : esc(b.subject)}</strong></div>
                      <div class="muted" style="font-size:11.5px;margin-top:2px;">${esc(b.sender || "")} · ${esc(b.summary.slice(0, 160))}</div>
                      ${sigs.length ? `<div class="chip-row" style="margin-top:4px;">${sigs.map((s) => `<span class="pill pill-neutral" style="font-size:10px;">${esc(s)}</span>`).join("")}</div>` : ""}
                    </td>
                    <td class="mono" style="font-size:11.5px;">${esc(b.affected_versions || "—")}</td>
                    <td><span class="pill pill-info">${esc(b.status)}</span></td>
                    <td>
                      <div class="inline-row">
                        ${
                          b.work_item_id
                            ? `<button class="btn btn-primary btn-sm" data-open-wi="${b.work_item_id}" title="Open this Work Item in Jobs & Work Items">Open WI #${b.work_item_id} →</button>`
                            : `<button class="btn btn-secondary btn-sm" data-bug-repro="${b.id}">Create Work Item</button>`
                        }
                      </div>
                    </td>
                  </tr>
                `;
                  })
                  .join("")
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderWorkItemsView(): string {
  const wiStatuses: Array<WorkItemRecord["status"]> = ["open", "testing", "verified", "draft_ready", "posted", "closed"];
  return `
    <div class="explainer-banner">
      <div>
        <strong>Local Work Items</strong> live strictly on your machine in local PostgreSQL (<code>pgroast_app</code>). They are decoupled from background jobs/logs and never synced publicly unless you explicitly publish a sanitized GitHub fork issue.
      </div>
      <div class="inline-row">
        <button type="button" class="btn btn-secondary btn-sm" id="wi-refresh-btn">Refresh</button>
        <button type="button" class="btn btn-primary btn-sm" id="wi-new-btn">+ New Work Item</button>
      </div>
    </div>
    ${
      state.workItems.length === 0
        ? `<div class="empty-state">No local Work Items yet. Create one from any CommitFest entry (Build &amp; Test tab), any <code>pgsql-bugs</code> row, or click <strong>+ New Work Item</strong> above.</div>`
        : state.workItems
            .map((wi) => {
              const focused = state.focusedWorkItemId === wi.id;
              return `
          <div class="wi-card ${focused ? "focused" : ""}" id="wi-card-${wi.id}">
            <div class="card-header" style="margin-bottom:8px;">
              <div>
                <div class="inline-row">
                  <span class="mono" style="font-weight:700;font-size:13.5px;">WI #${wi.id}</span>
                  <span class="pill pill-neutral">Local only</span>
                  ${
                    wi.cf_id
                      ? `<button type="button" class="btn btn-secondary btn-sm" data-open-cf="${wi.cf_id}">Open CF #${wi.cf_id} →</button>`
                      : `<span class="pill pill-purple">pgsql-bugs / Standalone</span>`
                  }
                  ${
                    wi.github_issue_url
                      ? `<a class="pill pill-ok" href="${esc(wi.github_issue_url)}" target="_blank" rel="noopener">Fork Issue #${wi.github_issue_number} ↗</a>`
                      : ""
                  }
                  <span class="dim mono" style="font-size:11px;">${esc(wi.slug)}</span>
                </div>
                <div style="font-weight:600;font-size:13.5px;margin-top:5px;">${esc(wi.title)}</div>
                <div class="muted" style="font-size:11px;margin-top:2px;">
                  Branch: <code>${esc(wi.target_branch || "master")}</code>
                  ${wi.worktree_path ? ` · Worktree: <code class="mono">${esc(wi.worktree_path)}</code>` : ""}
                  · Updated ${esc(wi.updated_at.slice(0, 16).replace("T", " "))}
                </div>
              </div>
              <div class="inline-row">
                <select class="wi-status-select" data-wi-status="${wi.id}" aria-label="Work Item status">
                  ${wiStatuses.map((st) => `<option value="${st}" ${wi.status === st ? "selected" : ""}>${esc(st.replace(/_/g, " "))}</option>`).join("")}
                </select>
                <button type="button" class="btn btn-secondary btn-sm" data-wi-publish="${wi.id}" title="Preview & publish a sanitized public issue to your configured GitHub fork">
                  ${wi.github_issue_number ? "Comment on Fork Issue…" : "Publish Fork Issue…"}
                </button>
              </div>
            </div>
            <div class="form-field" style="margin-bottom:6px;">
              <label style="font-size:11px;">Private Evidence &amp; Repro Notes (local PostgreSQL only)</label>
              <textarea class="mono" rows="4" id="wi-ev-${wi.id}" placeholder="Paste reproducer SQL, patch SHA, test output, or notes…">${esc(wi.evidence_md)}</textarea>
            </div>
            <div class="inline-row" style="justify-content:flex-end;">
              <button type="button" class="btn btn-secondary btn-sm" data-wi-save-ev="${wi.id}">Save Evidence</button>
            </div>
          </div>
        `;
            })
            .join("")
    }
  `;
}

function buildBulkRoastCliSnippet(): string {
  const b = state.bulkRoast;
  const modelFlag = b.model.trim() ? ` --model ${b.model.trim()}` : "";
  const effortFlag = b.backend === "codex" && b.effort.trim() ? ` --effort ${b.effort.trim()}` : "";
  if (b.mode === "batch") {
    const fl = b.flavour === "auto-by-subsystem" ? "default" : b.flavour;
    const statusArg = b.status.includes(" ") ? `"${b.status}"` : b.status;
    const envPrefix =
      b.backend === "codex" && b.model.trim()
        ? `PGROAST_CODEX_MODEL=${b.model.trim()}${b.effort.trim() ? `:${b.effort.trim()}` : ""} `
        : "";
    return `${envPrefix}npx pgroast batch ${b.cfNumber} --out ./out/cf${b.cfNumber} --status ${statusArg} --limit ${b.count} --concurrency ${b.workers} --backend ${b.backend} --roast-level ${b.level} --flavour ${fl}`;
  }
  const qb = b.backend === "dual" ? "claude" : b.backend;
  const pubFlag = b.publish ? " --publish" : "";
  const singleCmd = `npx pgroast contribute --once --backend ${qb}${modelFlag}${effortFlag} --strategy ${b.strategy} --flavour ${b.flavour} --level ${b.level}${pubFlag}`;
  if (b.workers > 1) {
    return `for w in $(seq 1 ${b.workers}); do (for i in $(seq 1 ${Math.ceil(b.count / b.workers)}); do ${singleCmd} || break; done) & done; wait`;
  }
  return `for i in $(seq 1 ${b.count}); do ${singleCmd} || break; done`;
}

function renderJobsView(): string {
  const b = state.bulkRoast;
  const archetypes: Array<[string, string]> = [
    ["default", "House Blend (default)"],
    ["auto-by-subsystem", "Auto by subsystem"],
    ["edge-case-hunter", "The Edge-Case Hunter"],
    ["spec-lawyer", "The Spec Lawyer"],
    ["systems-architect", "The Systems Architect"],
    ["perf-hawk", "The Perf Hawk"],
    ["storage-skeptic", "The Storage Skeptic"],
    ["index-specialist", "The Index Specialist"],
    ["production-dba", "The Production DBA"],
  ];
  const bulkCli = buildBulkRoastCliSnippet();

  return `
    <div class="card" id="bulk-roast-card" style="margin-bottom:14px;">
      <div class="card-header">
        <div>
          <h3 style="margin:0;">Bulk Roast &amp; Quota Burn</h3>
          <div class="dim" style="font-size:11.5px;margin-top:2px;">
            Roast dozens of CommitFest patches in parallel right from the Backoffice. Uses soft leases in Queue mode (zero duplicates), stops cleanly on usage limits, and streams live logs below.
          </div>
        </div>
        <span class="pill ${b.publish ? "pill-ok" : "pill-neutral"}">${b.publish ? "Auto-publish ON" : "Local-only"}</span>
      </div>

      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
        <div class="form-field">
          <label>Bulk Mode</label>
          <select id="bulk-mode">
            <option value="queue" ${b.mode === "queue" ? "selected" : ""}>Community Queue (soft-leased)</option>
            <option value="batch" ${b.mode === "batch" ? "selected" : ""}>CommitFest Batch (local folder)</option>
          </select>
        </div>
        <div class="form-field">
          <label>Backend</label>
          <select id="bulk-backend">
            <option value="codex" ${b.backend === "codex" ? "selected" : ""}>codex (OpenAI Codex CLI)</option>
            <option value="claude" ${b.backend === "claude" ? "selected" : ""}>claude (Claude Code CLI)</option>
            <option value="agy" ${b.backend === "agy" ? "selected" : ""}>agy (Antigravity CLI)</option>
            ${b.mode === "batch" ? `<option value="dual" ${b.backend === "dual" ? "selected" : ""}>dual (Claude + agy)</option>` : ""}
          </select>
        </div>
        <div class="form-field">
          <label>Model</label>
          <input type="text" id="bulk-model" value="${esc(b.model)}" placeholder="e.g. gpt-6.2-astra, opus" />
        </div>
        <div class="form-field">
          <label>Reasoning Effort</label>
          <select id="bulk-effort">
            ${["", "low", "medium", "high", "xhigh", "max"]
              .map((ef) => `<option value="${ef}" ${b.effort === ef ? "selected" : ""}>${ef || "default"}</option>`)
              .join("")}
          </select>
        </div>
        ${
          b.mode === "queue"
            ? `
          <div class="form-field">
            <label>Queue Strategy</label>
            <select id="bulk-strategy">
              <option value="unroasted-first" ${b.strategy === "unroasted-first" ? "selected" : ""}>Unroasted patches first</option>
              <option value="ready-for-committer" ${b.strategy === "ready-for-committer" ? "selected" : ""}>Ready for Committer queue</option>
              <option value="cross-model-second-opinion" ${b.strategy === "cross-model-second-opinion" ? "selected" : ""}>Cross-model second opinion</option>
            </select>
          </div>
        `
            : `
          <div class="form-field">
            <label>CommitFest #</label>
            <input type="number" id="bulk-cf-num" min="1" max="999" value="${b.cfNumber}" />
          </div>
          <div class="form-field">
            <label>Status filter</label>
            <select id="bulk-cf-status">
              <option value="open" ${b.status === "open" ? "selected" : ""}>All open</option>
              <option value="Ready for Committer" ${b.status === "Ready for Committer" ? "selected" : ""}>Ready for Committer</option>
              <option value="Needs review" ${b.status === "Needs review" ? "selected" : ""}>Needs review</option>
              <option value="Waiting on Author" ${b.status === "Waiting on Author" ? "selected" : ""}>Waiting on Author</option>
            </select>
          </div>
        `
        }
        <div class="form-field">
          <label>Reviewer Archetype</label>
          <select id="bulk-flavour">
            ${archetypes.map(([id, label]) => `<option value="${id}" ${b.flavour === id ? "selected" : ""}>${esc(label)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label>Roast Level</label>
          <select id="bulk-level">
            <option value="light" ${b.level === "light" ? "selected" : ""}>Light (idea + precedents)</option>
            <option value="medium" ${b.level === "medium" ? "selected" : ""}>Medium (code + build + test)</option>
            <option value="dark" ${b.level === "dark" ? "selected" : ""}>Dark (code + build + live PG SQL stress)</option>
          </select>
        </div>
        <div class="form-field">
          <label>Max Patches</label>
          <input type="number" id="bulk-count" min="1" max="300" value="${b.count}" />
        </div>
        <div class="form-field">
          <label>Parallel Workers</label>
          <select id="bulk-workers">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${b.workers === n ? "selected" : ""}>${n} worker${n === 1 ? "" : "s"}</option>`).join("")}
          </select>
        </div>
      </div>

      ${
        b.mode === "queue"
          ? `
        <label class="inline-row" style="cursor:pointer;margin:8px 0 10px;font-size:12px;">
          <input type="checkbox" id="bulk-publish" ${b.publish ? "checked" : ""} />
          <span>Auto-publish sanitized opinions to <code>${esc(state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai")}</code> (uses your saved Backoffice publish token; confidentiality gate enforced)</span>
        </label>
      `
          : `<div class="muted" style="font-size:11.5px;margin:6px 0 10px;">Saves local files under your Roast Data Dir and auto-imports finished entries into this Backoffice database when done.</div>`
      }

      <div class="inline-row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <button type="button" class="btn btn-primary" id="bulk-start-btn">▶ Start Bulk Roast (${b.count} × ${esc(b.backend)})</button>
        <span class="dim" style="font-size:11.5px;">Click <strong>Cancel</strong> on the running job row below anytime to stop all workers cleanly.</span>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:8px;">
        <div class="dim" style="font-size:11px;font-weight:600;margin-bottom:4px;">CLI equivalent (<code>npx pgroast</code>):</div>
        ${renderCmdSnippet(bulkCli)}
      </div>
    </div>

    <div class="toolbar" style="justify-content:space-between;">
      <span class="muted" style="font-size:12px;">Background CLI runs (bulk roasts, single roasts, meson builds, AI reviews, Hetzner). Logs also stream in the bottom console drawer.</span>
      <button class="btn btn-secondary btn-sm" id="jobs-refresh-btn">Refresh</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Kind</th>
            <th>Title</th>
            <th>Backend / Model</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${
            state.jobs.length === 0
              ? `<tr><td colspan="7" class="empty-state">No jobs have been run yet. Launch a Roast, Build &amp; Test, or AI Review from any entry.</td></tr>`
              : state.jobs
                  .map((j) => {
                    const hubBase = (state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai").replace(/\/$/, "");
                    let parsedResult: {
                      cfIds?: number[];
                      items?: Array<{ cfId: number; title?: string; verdict?: string; published?: boolean; publicUrl?: string }>;
                    } = {};
                    try {
                      if (j.result_json) parsedResult = JSON.parse(j.result_json) as typeof parsedResult;
                    } catch {
                      // ignore
                    }
                    const titleCfMatch = j.title.match(/\bCF\s+(\d+)\b/i);
                    const primaryCfId = j.cf_id || parsedResult.items?.[0]?.cfId || parsedResult.cfIds?.[0] || (titleCfMatch ? Number(titleCfMatch[1]) : 0);
                    const multiItems = parsedResult.items && parsedResult.items.length > 0 ? parsedResult.items : [];
                    return `
                <tr>
                  <td class="mono" style="font-size:11.5px;">${esc(j.id)}</td>
                  <td><span class="pill pill-neutral">${esc(j.kind)}</span></td>
                  <td>
                    <strong>${esc(j.title)}</strong>
                    ${
                      multiItems.length > 0
                        ? `<div class="inline-row" style="gap:4px;flex-wrap:wrap;margin-top:4px;">
                            ${multiItems
                              .slice(0, 8)
                              .map(
                                (it) => `
                              <button type="button" class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:11px;" data-open-cf="${it.cfId}">CF ${it.cfId}${it.verdict ? ` · ${esc(it.verdict)}` : ""}</button>
                              ${it.published ? `<a class="pill pill-ok" style="font-size:10px;text-decoration:none;" href="${esc(it.publicUrl || `${hubBase}/patch/${it.cfId}`)}" target="_blank" rel="noopener">Public ↗</a>` : `<span class="pill pill-neutral" style="font-size:10px;">local</span>`}
                            `,
                              )
                              .join("")}
                            ${multiItems.length > 8 ? `<span class="dim" style="font-size:11px;">+${multiItems.length - 8} more</span>` : ""}
                          </div>`
                        : ""
                    }
                    ${j.error ? `<div style="color:var(--danger);font-size:11px;">${esc(j.error)}</div>` : ""}
                  </td>
                  <td class="mono" style="font-size:11.5px;">${esc(j.backend)}${j.model ? ` · ${esc(j.model)}` : ""}</td>
                  <td>${jobStatusPill(j.status)}</td>
                  <td class="muted" style="font-size:11.5px;">${esc(j.created_at.slice(0, 19).replace("T", " "))}</td>
                  <td>
                    <div class="inline-row" style="flex-wrap:wrap;gap:4px;">
                      ${primaryCfId > 0 ? `<button type="button" class="btn btn-primary btn-sm" data-open-cf="${primaryCfId}">Open CF ${primaryCfId}</button>` : ""}
                      ${primaryCfId > 0 ? `<a class="btn btn-ghost btn-sm" href="${esc(`${hubBase}/patch/${primaryCfId}`)}" target="_blank" rel="noopener" title="View on Public App">Public ↗</a>` : ""}
                      <button class="btn btn-secondary btn-sm" data-view-job="${esc(j.id)}">Stream Log</button>
                      ${
                        j.status === "running" || j.status === "queued"
                          ? `<button class="btn btn-danger btn-sm" data-cancel-job="${esc(j.id)}">Cancel</button>`
                          : ""
                      }
                    </div>
                  </td>
                </tr>
              `;
                  })
                  .join("")
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderCmdSnippet(cmd: string): string {
  return `
    <div class="cmd-snippet">
      <code>${esc(cmd)}</code>
      <button type="button" class="btn btn-ghost btn-sm" data-copy-text="${esc(cmd)}" title="Copy command">Copy</button>
    </div>
  `;
}

function renderSettingsView(): string {
  const s = state.settings;
  const auth = state.cfAuth;
  const ai = state.aiSummary;
  const skills = state.skillsSummary;
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h3>Environment Health (Doctor)</h3>
          <div class="muted" style="font-size:11.5px;margin-top:2px;">
            Only <strong>1 AI CLI</strong> + <code>git</code> are required. Everything else is optional and has a click-by-click guide.
          </div>
        </div>
        <div class="inline-row">
          <button class="btn btn-primary btn-sm" id="settings-open-onboarding-btn">Open Setup Wizard</button>
          <button class="btn btn-secondary btn-sm" id="doctor-refresh-btn">Re-run Doctor</button>
        </div>
      </div>
      <div class="doctor-grid">
        ${
          state.loading.settings && state.doctorChecks.length === 0
            ? renderLoader(state.loadingMessage || "Running local environment doctor…")
            : state.doctorChecks
                .map((c) => {
                  const status = c.status || (c.ok ? "ok" : c.required ? "missing" : "optional");
                  const pillClass = status === "ok" ? "pill-ok" : status === "missing" ? "pill-danger" : "pill-neutral";
                  const pillLabel = status === "ok" ? "OK" : status === "missing" ? "REQUIRED" : "OPTIONAL";
                  const guide = c.setupGuide;
                  return `
          <div class="doctor-card">
            <div class="inline-row" style="justify-content:space-between;">
              <strong class="mono">${esc(c.name)}</strong>
              <span class="pill ${pillClass}">${pillLabel}</span>
            </div>
            <div class="muted" style="font-size:11.5px;margin-top:4px;">${esc(c.detail)}</div>
            ${c.version ? `<div class="dim mono" style="font-size:10.5px;margin-top:2px;">${esc(c.version)}</div>` : ""}
            ${
              !c.ok && guide
                ? `
              <details class="setup-guide">
                <summary>How to set up</summary>
                <ol>${guide.steps.map((st) => `<li>${esc(st)}</li>`).join("")}</ol>
                ${guide.command ? renderCmdSnippet(guide.command) : ""}
                ${guide.linkUrl ? `<div style="margin-top:6px;"><a class="btn btn-secondary btn-sm" href="${esc(guide.linkUrl)}" target="_blank" rel="noopener">${esc(guide.linkLabel || "Open guide")} ↗</a></div>` : ""}
              </details>
            `
                : ""
            }
          </div>
        `;
                })
                .join("")
        }
      </div>
    </div>

    <div class="split-pane">
      <div class="card">
        <div class="card-header">
          <h3>Your Profile, AI, Skills &amp; Paths</h3>
          <span class="pill pill-neutral">Stored locally only</span>
        </div>
        ${
          s
            ? `
          <div class="form-grid">
            <div class="form-field"><label>Your Name (optional email sign-off)</label><input type="text" id="set-authorName" value="${esc(s.authorName)}" placeholder="e.g. Jane Doe" /></div>
            <div class="form-field"><label>CommitFest Username (optional)</label><input type="text" id="set-cfUsername" value="${esc(s.cfUsername)}" placeholder="PG community username" /></div>
          </div>
          <div class="form-grid">
            <div class="form-field">
              <label>Default AI Backend</label>
              <select id="set-defaultBackend">
                <option value="auto" ${s.defaultBackend === "auto" ? "selected" : ""}>Auto (use first installed AI CLI${ai?.available[0] ? `: ${esc(ai.available[0])}` : ""})</option>
                <option value="claude" ${s.defaultBackend === "claude" ? "selected" : ""}>claude (single AI)</option>
                <option value="codex" ${s.defaultBackend === "codex" ? "selected" : ""}>codex (single AI)</option>
                <option value="agy" ${s.defaultBackend === "agy" ? "selected" : ""}>agy (single AI)</option>
                <option value="dual" ${s.defaultBackend === "dual" ? "selected" : ""}>dual (Claude + agy cross-family${ai?.dualReady ? "" : " — needs both"})</option>
              </select>
            </div>
            <div class="form-field"><label>Claude Config Dir (optional)</label><input type="text" id="set-claudeConfigDir" value="${esc(s.claudeConfigDir)}" placeholder="~/.claude" /></div>
          </div>
          <div class="form-field">
            <label>My Topics / Subsystems of Interest (optional, comma-separated)</label>
            <input type="text" id="set-interestedTopics" value="${esc(s.interestedTopics || "")}" placeholder="e.g. vacuum, planner, amcheck, wal, logical replication" />
          </div>
          <div class="form-field">
            <label>Custom Skills Folder (optional — leave empty to use Built-in Basic Skills)</label>
            <input type="text" id="set-skillsRepo" value="${esc(s.skillsRepo)}" placeholder="Leave empty for built-in defaults, or enter ~/path/to/your-skills" />
            <div class="muted" style="font-size:11px;margin-top:3px;">
              Active mode: <strong>${skills?.mode === "custom" ? `Custom skills (${skills.count} loaded)` : `Built-in basic skills (${skills?.count ?? 3} default skills)`}</strong>
            </div>
          </div>
          <div class="form-field"><label>pgroast v2 Repo</label><input type="text" id="set-pgroastRepo" value="${esc(s.pgroastRepo)}" placeholder="../pgroast or ~/pgroast" /></div>
          <div class="form-field"><label>Roast Batch Data Dir (optional)</label><input type="text" id="set-roastDataDir" value="${esc(s.roastDataDir)}" placeholder="Optional folder of pre-computed roast.json files" /></div>
          <div class="form-field"><label>PostgreSQL Git Clone (optional — worktrees &amp; expert routing)</label><input type="text" id="set-postgresRepo" value="${esc(s.postgresRepo)}" placeholder="~/postgres" /></div>
          <div class="form-field"><label>Managed Worktrees Root</label><input type="text" id="set-worktreesRoot" value="${esc(s.worktreesRoot)}" /></div>
          <div class="form-grid">
            <div class="form-field"><label>GitHub Fork (optional)</label><input type="text" id="set-githubFork" value="${esc(s.githubFork)}" placeholder="your-handle/postgres" /></div>
            <div class="form-field"><label>Gmail Account for gws (optional)</label><input type="text" id="set-gmailAccount" value="${esc(s.gmailAccount)}" placeholder="you@example.com" /></div>
          </div>
          <div class="form-grid">
            <div class="form-field"><label>Hetzner SSH Host (optional)</label><input type="text" id="set-hetznerSshHost" value="${esc(s.hetznerSshHost)}" placeholder="user@host" /></div>
            <div class="form-field"><label>Hetzner Remote Repo</label><input type="text" id="set-hetznerRemoteRepo" value="${esc(s.hetznerRemoteRepo)}" placeholder="~/postgres" /></div>
          </div>
          <button class="btn btn-primary" id="save-settings-btn">Save Settings</button>
        `
            : ""
        }
      </div>

      <div>
        <div class="card">
          <div class="card-header">
            <h3>Contributor Identity (GitHub / Google)</h3>
            <span class="pill ${state.identity?.signedIn ? "pill-ok" : "pill-neutral"}">
              ${
                state.identity?.signedIn
                  ? `${state.identity.provider === "github" ? "GitHub" : "Google"}: ${esc(state.identity.handle || state.identity.name)}`
                  : "Not signed in"
              }
            </span>
          </div>
          <p class="muted" style="margin-top:0;font-size:12px;">
            Recorded on every model opinion you run (so when teammates like Kirk or Andrey share opinions, everyone sees <strong>who</strong> ran which model) and powers the 1-click <strong>My Work</strong> filter. Uses your local <code>gh</code> or <code>gws</code> CLI session — zero passwords stored.
          </p>
          ${
            state.identity?.signedIn
              ? `
            <div class="ob-card" style="display:flex;align-items:center;gap:10px;">
              <div class="identity-avatar" style="width:34px;height:34px;font-size:13px;">
                ${state.identity.avatarUrl ? `<img src="${esc(state.identity.avatarUrl)}" alt="" />` : esc((state.identity.name || state.identity.handle || "?").slice(0, 2).toUpperCase())}
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;">${esc(state.identity.name)}</div>
                <div class="muted" style="font-size:11.5px;">${state.identity.provider === "github" ? `@${esc(state.identity.handle)} via GitHub` : `${esc(state.identity.handle)} via Google`}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="auth-disconnect-btn">Sign Out</button>
            </div>
          `
              : ""
          }
          <div class="inline-row">
            <button type="button" class="btn btn-primary btn-sm" id="auth-github-btn">Sign in with GitHub (gh)</button>
            <button type="button" class="btn btn-secondary btn-sm" id="auth-google-btn">Sign in with Google (gws)</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Public Companion Hub (Local → Public Sync)</h3>
            <span class="pill ${state.hubStatus?.hasToken ? "pill-ok" : "pill-neutral"}">
              ${state.hubStatus?.hasToken ? "Publish token set" : "Optional"}
            </span>
          </div>
          <p class="muted" style="margin-top:0;font-size:12px;">
            Trust flows strictly <strong>local → public</strong>: push sanitized opinions or interactive CommitFest briefs to your Public App (e.g. <code>https://pgroast.postgres.ai</code>), and pull teammates' opinions. Your local Work Items, cookies, and skills never leave this machine.
          </p>
          <div class="form-field">
            <label>Public Companion URL</label>
            <input type="text" id="hub-url-input" value="${esc(state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai")}" placeholder="https://pgroast.postgres.ai" />
          </div>
          <div class="form-field">
            <label>Publish-Only Token (stored AES-256-GCM encrypted in local PostgreSQL)</label>
            <input type="password" id="hub-token-input" placeholder="pgroast_pub_…" />
          </div>
          <div class="inline-row">
            <button type="button" class="btn btn-primary btn-sm" id="hub-save-btn">Save Companion Config</button>
            ${state.hubStatus?.url ? `<a class="btn btn-secondary btn-sm" href="${esc(state.hubStatus.url)}" target="_blank" rel="noopener">Open Companion ↗</a>` : ""}
            ${state.hubStatus?.hasToken ? `<button type="button" class="btn btn-danger btn-sm" id="hub-clear-btn">Clear Token</button>` : ""}
          </div>
        </div>

        ${(() => {
          const cd = state.contributeData;
          const cfg = cd?.config;
          const cov = cd?.coverage;
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const archetypes: Array<[string, string]> = [
            ["auto-by-subsystem", "Auto by subsystem (recommended)"],
            ["default", "House Blend"],
            ["edge-case-hunter", "The Edge-Case Hunter"],
            ["spec-lawyer", "The Spec Lawyer"],
            ["systems-architect", "The Systems Architect"],
            ["perf-hawk", "The Perf Hawk"],
            ["storage-skeptic", "The Storage Skeptic"],
            ["index-specialist", "The Index Specialist"],
            ["production-dba", "The Production DBA"],
          ];
          const covPct = cov && cov.totalOpen > 0 ? Math.round((cov.openWith1PlusOpinion / cov.totalOpen) * 100) : 0;
          const basePct = cov && cov.totalOpen > 0 ? Math.round((cov.baselineRoastedOpen / cov.totalOpen) * 100) : 0;
          return `
        <div class="card">
          <div class="card-header">
            <h3>Weekly Quota Auto-Contribute</h3>
            <span class="pill ${cfg?.autoPublish ? "pill-ok" : "pill-neutral"}">
              ${cfg?.autoPublish ? "Auto-publish ON" : "Local-only (opt-in)"}
            </span>
          </div>
          <p class="muted" style="margin-top:0;font-size:12px;">
            Automatically spend leftover weekly OAuth quota (<code>claude</code>, <code>codex</code>, <code>agy</code>) right before your weekly reset to pre-review open CommitFest patches. Stops cleanly on usage limits and never posts to <code>-hackers</code>.
          </p>
          ${
            cov
              ? `
            <div class="ob-card" style="margin-bottom:10px;">
              <div class="inline-row" style="justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
                <strong>Community CommitFest Progress</strong>
                <span class="mono">${cov.baselineRoastedOpen}/${cov.totalOpen} baseline (${basePct}%) · ${cov.opinionsTotal} opinions (${covPct}% open) · ${cov.activeLeases?.length || 0} active leases</span>
              </div>
              <div style="height:6px;border-radius:99px;background:var(--border);overflow:hidden;">
                <div style="height:100%;width:${Math.max(basePct, 2)}%;background:var(--accent);"></div>
              </div>
            </div>
          `
              : ""
          }
          ${
            cfg
              ? `
            <div class="form-grid">
              <div class="form-field">
                <label>Queue Strategy</label>
                <select id="contrib-strategy">
                  <option value="unroasted-first" ${cfg.strategy === "unroasted-first" ? "selected" : ""}>Unroasted patches first</option>
                  <option value="cross-model-second-opinion" ${cfg.strategy === "cross-model-second-opinion" ? "selected" : ""}>Cross-model second opinion</option>
                  <option value="ready-for-committer" ${cfg.strategy === "ready-for-committer" ? "selected" : ""}>Ready for Committer queue</option>
                </select>
              </div>
              <div class="form-field">
                <label>Roast Level</label>
                <select id="contrib-level">
                  <option value="light" ${cfg.roastLevel === "light" ? "selected" : ""}>Light</option>
                  <option value="medium" ${cfg.roastLevel === "medium" ? "selected" : ""}>Medium</option>
                  <option value="dark" ${cfg.roastLevel === "dark" ? "selected" : ""}>Dark</option>
                </select>
              </div>
            </div>
            <div class="form-grid">
              <div class="form-field">
                <label>Reviewer Archetype</label>
                <select id="contrib-flavour">
                  ${archetypes.map(([id, label]) => `<option value="${id}" ${cfg.roastFlavour === id ? "selected" : ""}>${esc(label)}</option>`).join("")}
                </select>
              </div>
              <div class="form-field">
                <label>Subsystem Topics (optional, comma-separated)</label>
                <input type="text" id="contrib-topics" value="${esc((cfg.topics || []).join(", "))}" placeholder="e.g. wal, vacuum, planner (blank = all)" />
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
              ${(["claude", "codex", "agy"] as const)
                .map((b) => {
                  const sc = cfg.backends[b];
                  const w = cd?.windows?.[b];
                  return `
                <div class="ob-card" style="margin-bottom:0;padding:8px 10px;">
                  <div class="inline-row" style="justify-content:space-between;margin-bottom:6px;">
                    <label class="inline-row" style="cursor:pointer;gap:6px;">
                      <input type="checkbox" id="contrib-en-${b}" ${sc.enabled ? "checked" : ""} />
                      <strong class="mono">${b}</strong>
                    </label>
                    <span class="pill ${!sc.enabled ? "pill-neutral" : w?.inWindow ? "pill-ok" : "pill-info"}" style="font-size:10.5px;">
                      ${!sc.enabled ? "disabled" : w?.inWindow ? `IN WINDOW · ${w.used}/${w.cap}` : `reset in ${esc(w?.countdownLabel || "?")} · ${w?.used ?? 0}/${w?.cap ?? sc.maxPatchesPerWindow}`}
                    </span>
                  </div>
                  <div class="inline-row" style="gap:6px;flex-wrap:wrap;font-size:11.5px;">
                    <span>Reset:</span>
                    <select id="contrib-day-${b}" style="width:auto;padding:3px 6px;">
                      ${days.map((d) => `<option value="${d}" ${sc.resetDayUtc === d ? "selected" : ""}>${d}</option>`).join("")}
                    </select>
                    <input type="number" id="contrib-hour-${b}" min="0" max="23" value="${sc.resetHourUtc}" style="width:54px;padding:3px 6px;" title="Reset hour (UTC 0-23)" />
                    <span class="dim">UTC · Window</span>
                    <input type="number" id="contrib-win-${b}" min="1" max="168" value="${sc.windowHoursBeforeReset}" style="width:54px;padding:3px 6px;" title="Hours before reset" />
                    <span class="dim">h · Cap</span>
                    <input type="number" id="contrib-cap-${b}" min="1" max="300" value="${sc.maxPatchesPerWindow}" style="width:62px;padding:3px 6px;" title="Max patches per weekly window" />
                  </div>
                </div>
              `;
                })
                .join("")}
            </div>
            <label class="inline-row" style="cursor:pointer;margin-bottom:10px;font-size:12px;">
              <input type="checkbox" id="contrib-autopublish" ${cfg.autoPublish ? "checked" : ""} />
              <span>Auto-publish sanitized opinions to Public App (requires Publish-Only Token above; Public-Confidentiality Hard Gate always enforced)</span>
            </label>
            <div class="inline-row" style="flex-wrap:wrap;gap:6px;">
              <button type="button" class="btn btn-primary btn-sm" id="contrib-save-btn">Save Schedule</button>
              <button type="button" class="btn btn-secondary btn-sm" id="contrib-preview-btn">Preview Next Patch</button>
              <button type="button" class="btn btn-ok btn-sm" id="contrib-run-once-btn">Run 1 Patch Now</button>
              <button type="button" class="btn btn-secondary btn-sm" id="contrib-open-bulk-btn">Bulk Roast Many →</button>
              <button type="button" class="btn btn-ghost btn-sm" id="contrib-copy-cron-btn">Copy Hourly Cron</button>
            </div>
            <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">
              <div class="dim" style="font-size:11px;font-weight:600;margin-bottom:4px;">CLI equivalents (<code>npx pgroast</code>):</div>
              ${renderCmdSnippet(`npx pgroast contribute --status && npx pgroast contribute --once --flavour ${cfg.roastFlavour} --level ${cfg.roastLevel}${cfg.autoPublish ? " --publish" : ""}`)}
            </div>
            ${
              state.contributePreview
                ? `
              <div class="ob-card" style="margin-top:10px;border-color:var(--accent);">
                ${
                  state.contributePreview.preview.patch
                    ? `
                  <div class="inline-row" style="justify-content:space-between;">
                    <strong class="mono">Next (${esc(state.contributePreview.backend)}): CF ${state.contributePreview.preview.patch.cf_id}</strong>
                    <span class="pill pill-info">${esc(state.contributePreview.preview.suggestedFlavour)} · ${esc(state.contributePreview.preview.suggestedLevel)}</span>
                  </div>
                  <div style="font-size:12.5px;font-weight:600;margin-top:3px;">${esc(state.contributePreview.preview.patch.title)}</div>
                  <div class="muted" style="font-size:11.5px;margin-top:2px;">${esc(state.contributePreview.preview.reason)}</div>
                `
                    : `<div class="muted" style="font-size:12px;">${esc(state.contributePreview.preview.reason)}</div>`
                }
              </div>
            `
                : ""
            }
            ${
              cd && cd.history.length > 0
                ? `
              <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">
                <div class="dim" style="font-size:11px;font-weight:600;margin-bottom:4px;">Recent Quota Contributions (${cd.history.length})</div>
                ${cd.history
                  .slice(0, 5)
                  .map(
                    (h) => `
                  <div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:11.5px;display:flex;justify-content:space-between;gap:8px;">
                    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                      <button type="button" class="btn btn-ghost btn-sm" style="padding:1px 5px;font-size:11px;" data-open-cf="${h.cfId}">CF ${h.cfId}</button>
                      <span class="mono dim">${esc(h.backend)}</span> · ${esc(h.verdict)}
                    </span>
                    <span class="pill ${h.published ? "pill-ok" : "pill-neutral"}" style="font-size:10px;">${h.published ? "published" : "local"}</span>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            `
                : ""
            }
          `
              : `<div class="muted" style="font-size:12px;">Loading Auto-Contribute schedule…</div>`
          }
        </div>
          `;
        })()}

        <div class="card">
          <div class="card-header">
            <h3>PostgreSQL Community / CommitFest Login${auth?.verifiedUser || auth?.username ? ` (${esc(auth?.verifiedUser || auth?.username)})` : ""}</h3>
            <span class="pill ${auth?.hasSessionCookie ? "pill-ok" : "pill-neutral"}">
              ${auth?.verifiedUser ? `Verified: ${esc(auth.verifiedUser)}` : auth?.hasSessionCookie ? "Stored (encrypted)" : "Optional"}
            </span>
          </div>
          <p class="muted" style="margin-top:0;font-size:12px;">
            Read-only browsing &amp; sync work with zero login. Add cookies only if you want to claim reviewer or update status from here (stored AES-256-GCM encrypted in local PostgreSQL).
          </p>
          <details class="setup-guide" style="margin-top:0;margin-bottom:10px;border-top:none;padding-top:0;" ${auth?.hasSessionCookie ? "" : "open"}>
            <summary>3-Click Login Guide</summary>
            <ol>
              <li>Click <a href="https://commitfest.postgresql.org/account/login/" target="_blank" rel="noopener">Open CommitFest Login ↗</a> and sign in with your PostgreSQL Community Account.</li>
              <li>Open Browser DevTools (<kbd>⌘⌥I</kbd> on Mac / <kbd>F12</kbd> on Linux/Win) → <strong>Application</strong> (Chrome) or <strong>Storage</strong> (Firefox) → <strong>Cookies</strong> → <code>https://commitfest.postgresql.org</code>.</li>
              <li>Copy the <code>sessionid</code> and <code>csrftoken</code> values below (or paste the full <code>Cookie:</code> header from Network tab), then click <strong>Save</strong> and <strong>Verify Login</strong>.</li>
            </ol>
          </details>
          <div class="form-field">
            <label>Paste Raw Cookie Header (or fill fields below)</label>
            <input type="password" id="cf-cookie-header" placeholder="sessionid=...; csrftoken=..." />
          </div>
          <div class="form-grid">
            <div class="form-field"><label>sessionid</label><input type="password" id="cf-cookie-sid" /></div>
            <div class="form-field"><label>csrftoken</label><input type="password" id="cf-cookie-csrf" /></div>
          </div>
          <div class="inline-row">
            <button class="btn btn-primary btn-sm" id="save-cf-cookies-btn">Save Encrypted Cookies</button>
            <button class="btn btn-ok btn-sm" id="verify-cf-login-btn">Verify Login (/me/)</button>
            <button class="btn btn-danger btn-sm" id="clear-cf-cookies-btn">Clear</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Audit Log (Recent Actions)</h3>
          </div>
          <div style="max-height:240px;overflow-y:auto;">
            ${
              state.auditLogs.length === 0
                ? `<div class="muted">No external actions recorded yet.</div>`
                : state.auditLogs
                    .slice(0, 25)
                    .map(
                      (l) => `
                  <div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:11.5px;">
                    <span class="pill ${l.status === "ok" ? "pill-ok" : l.status === "blocked" ? "pill-warn" : "pill-danger"}">${esc(l.status)}</span>
                    <strong class="mono">${esc(l.action)}</strong>
                    <span class="muted">${esc(l.target)}</span>
                    <span class="dim" style="float:right;">${esc(l.created_at.slice(0, 19).replace("T", " "))}</span>
                  </div>
                `,
                    )
                    .join("")
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------- Render & Bind Events ----------------

function render(): void {
  const root = document.getElementById("main-content");
  if (!root) return;

  if (state.view === "shortlist") root.innerHTML = renderShortlistView();
  else if (state.view === "stats") root.innerHTML = renderStatsView();
  else if (state.view === "explorer") root.innerHTML = renderExplorerView();
  else if (state.view === "workbench") root.innerHTML = renderWorkbenchView();
  else if (state.view === "bugs") root.innerHTML = renderBugsView();
  else if (state.view === "work_items") root.innerHTML = renderWorkItemsView();
  else if (state.view === "jobs") root.innerHTML = renderJobsView();
  else if (state.view === "settings") root.innerHTML = renderSettingsView();

  bindViewEvents();
}

function syncDraftFromDom(): void {
  const toEl = document.getElementById("draft-to") as HTMLInputElement | null;
  const ccEl = document.getElementById("draft-cc") as HTMLInputElement | null;
  const subEl = document.getElementById("draft-subject") as HTMLInputElement | null;
  const irtEl = document.getElementById("draft-in-reply-to") as HTMLInputElement | null;
  const tidEl = document.getElementById("draft-thread-id") as HTMLInputElement | null;
  const bodyEl = document.getElementById("draft-body") as HTMLTextAreaElement | null;
  const isReplyEl = document.getElementById("draft-is-reply") as HTMLInputElement | null;
  const otherEl = document.getElementById("draft-other-author") as HTMLInputElement | null;
  if (toEl) state.activeDraft.to = toEl.value;
  if (ccEl) state.activeDraft.cc = ccEl.value;
  if (subEl) state.activeDraft.subject = subEl.value;
  if (irtEl) state.activeDraft.inReplyTo = irtEl.value;
  if (tidEl) state.activeDraft.threadId = tidEl.value;
  if (bodyEl) state.activeDraft.body = bodyEl.value;
  if (isReplyEl) state.activeDraft.isReply = isReplyEl.checked;
  if (otherEl) state.activeDraft.isOtherAuthorThread = otherEl.checked;
}

function bindViewEvents(): void {
  // Click any entry row to open Workbench (ignore star button & direct external CF/thread links)
  document.querySelectorAll<HTMLElement>("[data-open-cf]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest("[data-toggle-star]") || t.closest("[data-ext-link]")) return;
      const id = Number(el.dataset.openCf);
      if (id > 0) void openEntry(id);
    });
  });

  // Click any Open Work Item button/badge
  document.querySelectorAll<HTMLElement>("[data-open-wi]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = Number(el.dataset.openWi);
      if (id > 0) void openWorkItem(id);
    });
  });

  // Inline star toggles in Explorer
  document.querySelectorAll<HTMLButtonElement>("[data-toggle-star]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const cfId = Number(btn.dataset.toggleStar);
      const nextStar = btn.dataset.starred !== "1";
      try {
        await api(`/api/entries/${cfId}/triage`, {
          method: "PATCH",
          body: JSON.stringify({ starred: nextStar }),
        });
        const row = state.entries.find((e) => e.cf_id === cfId);
        if (row) row.starred = nextStar ? 1 : 0;
        render();
      } catch (err) {
        toastError(err);
      }
    });
  });

  // Shortlist & Stats jump events
  document.querySelectorAll<HTMLElement>("[data-jump-verdict]").forEach((el) => {
    el.addEventListener("click", () => {
      state.explorerVerdict = el.dataset.jumpVerdict || "all";
      state.explorerSearch = "";
      state.explorerStatus = "all";
      state.explorerMine = false;
      state.explorerStarred = false;
      state.entries = [];
      void switchView("explorer");
    });
  });
  document.querySelectorAll<HTMLElement>("[data-stats-query]").forEach((el) => {
    el.addEventListener("click", () => {
      state.explorerSearch = el.dataset.statsQuery || "";
      state.explorerVerdict = "all";
      state.explorerStatus = "all";
      state.explorerMine = false;
      state.explorerStarred = false;
      state.entries = [];
      void switchView("explorer");
    });
  });
  document.querySelectorAll<HTMLElement>("[data-matrix-status]").forEach((el) => {
    el.addEventListener("click", () => {
      const st = el.dataset.matrixStatus || "all";
      const vd = el.dataset.matrixVerdict || "all";
      state.explorerSearch = "";
      state.explorerStatus = st === "Unspecified" ? "all" : st;
      state.explorerVerdict = vd;
      state.explorerMine = false;
      state.explorerStarred = false;
      state.entries = [];
      void switchView("explorer");
    });
  });
  document.getElementById("stats-refresh-btn")?.addEventListener("click", () => void loadStats());
  document.getElementById("sl-tab-top20")?.addEventListener("click", () => {
    state.shortlistTab = "top20";
    render();
  });
  document.getElementById("sl-tab-top50")?.addEventListener("click", () => {
    state.shortlistTab = "top50";
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sl-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.shortlistKindFilter = (btn.dataset.slKind as AppState["shortlistKindFilter"]) || "all";
      render();
    });
  });
  document.getElementById("sl-digest-md-btn")?.addEventListener("click", async () => {
    try {
      const headers: Record<string, string> = LOCAL_SESSION_TOKEN ? { Authorization: `Bearer ${LOCAL_SESSION_TOKEN}` } : {};
      const res = await fetch("/api/shortlist?format=markdown", { headers });
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `commitfest-digest-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError(err, "Digest download failed");
    }
  });
  document.getElementById("sl-publish-brief-btn")?.addEventListener("click", () => {
    const hubUrl = state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai";
    const today = new Date().toISOString().slice(0, 10);
    showConfirmModal({
      title: `Publish Sanitized CommitFest Brief to ${hubUrl}`,
      bodyHtml: `
        <p style="margin-top:0;font-size:12px;">Publishes a sanitized, interactive &amp; downloadable CommitFest brief (Shortlist, Closing, Stats, and Open Entries) to your Public Companion. Private notes, tags, Work Items, cookies, and local paths are NEVER included.</p>
        <div class="form-field"><label>Brief Title</label><input type="text" id="pub-brief-title" value="PostgreSQL CommitFest Triage Brief (${today})" /></div>
        <div class="form-grid">
          <div class="form-field"><label>URL Slug</label><input type="text" id="pub-brief-slug" class="mono" value="pg20-3-${today}" /></div>
          <div class="form-field"><label>CommitFest Label</label><input type="text" id="pub-brief-label" value="PG20-3 (#62)" /></div>
        </div>
      `,
      confirmLabel: "Publish Brief",
      onConfirm: async () => {
        const res = await api<{ brief: { slug: string; htmlDownloadUrl?: string }; hubUrl: string }>("/api/hub/publish-brief", {
          method: "POST",
          body: JSON.stringify({
            title: (document.getElementById("pub-brief-title") as HTMLInputElement).value.trim(),
            slug: (document.getElementById("pub-brief-slug") as HTMLInputElement).value.trim(),
            commitfestLabel: (document.getElementById("pub-brief-label") as HTMLInputElement).value.trim(),
            confirm: true,
          }),
        });
        toast(`Published brief "${res.brief.slug}" to ${res.hubUrl}`, "ok", {
          hint: res.brief.htmlDownloadUrl ? `Downloadable HTML: ${res.brief.htmlDownloadUrl}` : undefined,
        });
      },
    });
  });
  document.getElementById("sl-export-snapshot-btn")?.addEventListener("click", () => {
    showConfirmModal({
      title: "Export Frozen Static HTML Snapshot",
      bodyHtml: `
        <p style="margin-top:0;">Generates a frozen, self-contained static HTML dashboard (Shortlist split into Bug fixes &amp; Features, Worth Closing, and per-entry pages) with clear AI-first-pass disclosure and zero private notes or local paths.</p>
        <div class="form-field">
          <label>Optional Page-View / Link-Click Beacon URL (leave blank to omit)</label>
          <input type="text" id="snap-beacon-url" placeholder="https://your-tracker.example.com/collect" />
        </div>
      `,
      confirmLabel: "Generate Static Snapshot",
      onConfirm: async () => {
        const analyticsBeaconUrl = (document.getElementById("snap-beacon-url") as HTMLInputElement | null)?.value.trim() || "";
        const res = await api<{ outDir: string; entryPagesCount: number }>("/api/export/snapshot", {
          method: "POST",
          body: JSON.stringify({ topN: 40, rejectN: 50, analyticsBeaconUrl }),
        });
        toast(`Frozen snapshot exported (${res.entryPagesCount} entry pages) to ${res.outDir}`, "ok");
      },
    });
  });
  document.getElementById("sl-config-topics-btn")?.addEventListener("click", () => {
    void switchView("settings");
  });
  document.getElementById("wb-copy-light-roast-btn")?.addEventListener("click", () => {
    if (!state.detail?.lightRoast) return;
    state.activeDraft.body = state.detail.lightRoast.markdown;
    state.workbenchTab = "reply";
    toast("Copied PG Light Roast checklist into Reply Studio draft", "ok");
    render();
  });
  document.getElementById("wb-hub-pull-op-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    const cfId = state.detail.entry.cf_id;
    try {
      const res = await api<{ imported: number; totalRemote: number; hubUrl: string }>("/api/hub/pull-opinions", {
        method: "POST",
        body: JSON.stringify({ cfId }),
      });
      toast(`Pulled ${res.imported} new teammate opinion(s) (${res.totalRemote} total on ${res.hubUrl})`, "ok");
      await loadEntryDetail(cfId);
    } catch (err) {
      toastError(err, "Failed to pull opinions from Companion");
    }
  });

  document.getElementById("wb-hub-publish-op-btn")?.addEventListener("click", () => {
    if (!state.detail) return;
    const entry = state.detail.entry;
    const roast = state.detail.roast;
    const latestRun = state.detail.runs?.[0];
    const defaultBackend = latestRun?.backend || roast?.backend || state.aiSummary?.available?.[0] || "claude";
    const defaultLevel = (latestRun?.roast_level || roast?.roast_level || state.roastLevel || "medium").toLowerCase();
    const legacyMap: Record<string, string> = {
      "tom-lane": "edge-case-hunter",
      "peter-eisentraut": "spec-lawyer",
      "robert-haas": "systems-architect",
      "andres-freund": "perf-hawk",
      "heikki-linnakangas": "storage-skeptic",
      "bruce-momjian": "production-dba",
      "alexander-korotkov": "index-specialist",
    };
    const rawFlavour = (latestRun?.roast_flavour || roast?.roast_flavour || state.roastFlavour || "default").toLowerCase();
    const defaultFlavour = legacyMap[rawFlavour] || rawFlavour;
    const hubUrl = state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai";
    showConfirmModal({
      title: `Publish Sanitized Opinion for CF #${entry.cf_id} to ${hubUrl}`,
      bodyHtml: `
        <p class="muted" style="margin-top:0;font-size:12px;">Runs the Public-Confidentiality Hard Gate locally and server-side before posting. No internal model codenames, local paths, or private notes allowed.</p>
        <div class="form-grid">
          <div class="form-field"><label>Backend / Harness Label (public-safe)</label><input type="text" id="hub-op-backend" value="${esc(defaultBackend)}" /></div>
          <div class="form-field">
            <label>Verdict</label>
            <select id="hub-op-verdict">
              <option value="NO-FUNDAMENTAL-OBJECTION" ${entry.verdict === "NO-FUNDAMENTAL-OBJECTION" ? "selected" : ""}>No fundamental objection</option>
              <option value="NEEDS-COMMITTER-EYES" ${entry.verdict === "NEEDS-COMMITTER-EYES" ? "selected" : ""}>Needs committer eyes</option>
              <option value="NEEDS-DESIGN-DISCUSSION" ${entry.verdict === "NEEDS-DESIGN-DISCUSSION" ? "selected" : ""}>Needs design discussion</option>
              <option value="LIKELY-REJECT" ${entry.verdict === "LIKELY-REJECT" ? "selected" : ""}>Likely reject</option>
            </select>
          </div>
          <div class="form-field">
            <label>Roast Level</label>
            <select id="hub-op-level">
              <option value="light" ${defaultLevel === "light" ? "selected" : ""}>Light (constructive)</option>
              <option value="medium" ${defaultLevel === "medium" ? "selected" : ""}>Medium (balanced)</option>
              <option value="dark" ${defaultLevel === "dark" ? "selected" : ""}>Dark (harsh)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Reviewer Archetype (AI persona)</label>
            <select id="hub-op-flavour">
              <option value="default" ${defaultFlavour === "default" ? "selected" : ""}>House Blend (Balanced)</option>
              <option value="edge-case-hunter" ${defaultFlavour === "edge-case-hunter" ? "selected" : ""}>The Edge-Case Hunter</option>
              <option value="spec-lawyer" ${defaultFlavour === "spec-lawyer" ? "selected" : ""}>The Spec Lawyer</option>
              <option value="systems-architect" ${defaultFlavour === "systems-architect" ? "selected" : ""}>The Systems Architect</option>
              <option value="perf-hawk" ${defaultFlavour === "perf-hawk" ? "selected" : ""}>The Perf Hawk</option>
              <option value="storage-skeptic" ${defaultFlavour === "storage-skeptic" ? "selected" : ""}>The Storage Skeptic</option>
              <option value="index-specialist" ${defaultFlavour === "index-specialist" ? "selected" : ""}>The Index Specialist</option>
              <option value="production-dba" ${defaultFlavour === "production-dba" ? "selected" : ""}>The Production DBA</option>
            </select>
          </div>
        </div>
        <div class="form-field"><label>Public Summary (sanitized)</label><textarea id="hub-op-summary" rows="3">${esc((roast?.verdict_reasoning || "").slice(0, 500))}</textarea></div>
      `,
      confirmLabel: "Confirm & Publish Opinion",
      onConfirm: async () => {
        await api("/api/hub/publish-opinion", {
          method: "POST",
          body: JSON.stringify({
            cfId: entry.cf_id,
            backend: (document.getElementById("hub-op-backend") as HTMLInputElement).value.trim() || "claude",
            roastLevel: (document.getElementById("hub-op-level") as HTMLSelectElement).value || "medium",
            roastFlavour: (document.getElementById("hub-op-flavour") as HTMLSelectElement).value || "default",
            verdict: (document.getElementById("hub-op-verdict") as HTMLSelectElement).value,
            confidence: entry.confidence || "medium",
            summary: (document.getElementById("hub-op-summary") as HTMLTextAreaElement).value.trim(),
            confirm: true,
          }),
        });
        toast(`Published sanitized opinion for CF #${entry.cf_id} to ${hubUrl}`, "ok");
      },
    });
  });

  document.getElementById("wb-second-opinion-btn")?.addEventListener("click", () => {
    state.workbenchTab = "roast";
    render();
    document.getElementById("roast-backend")?.focus();
  });

  document.getElementById("wb-export-opinions-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    const cfId = state.detail.entry.cf_id;
    try {
      const data = await api<{ cf_id: number; opinions: RoastRunRecord[] }>(`/api/entries/${cfId}/opinions`);
      const payload = {
        cf_id: cfId,
        title: state.detail.entry.title,
        exported_at: new Date().toISOString(),
        opinions: data.opinions.map((o) => ({
          backend: o.backend,
          models: (() => {
            try { return JSON.parse(o.models_json || "{}"); } catch { return o.models_json; }
          })(),
          verdict: o.verdict,
          confidence: o.confidence,
          summaryTxt: o.summary_txt,
          contributorName: o.contributor_name,
          contributorHandle: o.contributor_handle,
          contributorProvider: o.contributor_provider,
          createdAt: o.created_at,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cf-${cfId}-opinions.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${payload.opinions.length} opinion(s) for CF #${cfId}`, "ok");
    } catch (err) {
      toastError(err, "Failed to export opinions");
    }
  });

  document.getElementById("wb-record-opinion-btn")?.addEventListener("click", () => {
    if (!state.detail) return;
    const cfId = state.detail.entry.cf_id;
    const cur = state.identity;
    showConfirmModal({
      title: `Record or Import Opinion for CF #${cfId}`,
      bodyHtml: `
        <p class="muted" style="margin-top:0;font-size:12px;">Record a model opinion manually or paste an exported <code>cf-${cfId}-opinions.json</code> shared by a teammate (e.g., Kirk or Andrey).</p>
        <div class="form-field">
          <label>Quick Import JSON (optional — paste exported JSON to auto-import all opinions inside)</label>
          <textarea id="op-import-json" rows="3" class="mono" placeholder='{"opinions":[{"contributorName":"Kirk","contributorHandle":"kirk","contributorProvider":"github","backend":"claude","models":{"critic":"opus"},"verdict":"NEEDS-COMMITTER-EYES","confidence":"high"}]}'></textarea>
        </div>
        <div class="section-label">Or enter a single opinion manually</div>
        <div class="form-grid">
          <div class="form-field"><label>Contributor Name</label><input type="text" id="op-contrib-name" value="${esc(cur?.name || "")}" placeholder="e.g. Kirk Wolak" /></div>
          <div class="form-field"><label>Handle / Email</label><input type="text" id="op-contrib-handle" value="${esc(cur?.handle || "")}" placeholder="e.g. kwolak" /></div>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label>Provider</label>
            <select id="op-contrib-prov">
              <option value="github" ${cur?.provider === "github" ? "selected" : ""}>GitHub</option>
              <option value="google" ${cur?.provider === "google" ? "selected" : ""}>Google</option>
              <option value="local" ${!cur?.provider || cur.provider === "local" ? "selected" : ""}>Local</option>
            </select>
          </div>
          <div class="form-field"><label>Backend / Model</label><input type="text" id="op-backend" value="claude" placeholder="e.g. claude / opus, codex, agy" /></div>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label>Verdict</label>
            <select id="op-verdict">
              <option value="NO-FUNDAMENTAL-OBJECTION">No fundamental objection</option>
              <option value="NEEDS-COMMITTER-EYES">Needs committer eyes</option>
              <option value="NEEDS-DESIGN-DISCUSSION" selected>Needs design discussion</option>
              <option value="LIKELY-REJECT">Likely reject</option>
            </select>
          </div>
          <div class="form-field">
            <label>Confidence</label>
            <select id="op-confidence">
              <option value="high">high</option>
              <option value="medium" selected>medium</option>
              <option value="low">low</option>
            </select>
          </div>
        </div>
        <div class="form-field"><label>Short Summary (optional)</label><textarea id="op-summary" rows="2" placeholder="Key takeaway or model note…"></textarea></div>
      `,
      confirmLabel: "Save Opinion(s)",
      onConfirm: async () => {
        const rawJson = (document.getElementById("op-import-json") as HTMLTextAreaElement).value.trim();
        if (rawJson) {
          const parsed = JSON.parse(rawJson) as { opinions?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | Record<string, unknown>;
          const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray((parsed as { opinions?: unknown[] }).opinions)
              ? ((parsed as { opinions: Array<Record<string, unknown>> }).opinions)
              : [parsed as Record<string, unknown>];
          let count = 0;
          for (const item of list) {
            if (!item.verdict) continue;
            await api(`/api/entries/${cfId}/opinions`, {
              method: "POST",
              body: JSON.stringify(item),
            });
            count++;
          }
          toast(`Imported ${count} attributed opinion(s) for CF #${cfId}`, "ok");
        } else {
          await api(`/api/entries/${cfId}/opinions`, {
            method: "POST",
            body: JSON.stringify({
              contributorName: (document.getElementById("op-contrib-name") as HTMLInputElement).value.trim(),
              contributorHandle: (document.getElementById("op-contrib-handle") as HTMLInputElement).value.trim(),
              contributorProvider: (document.getElementById("op-contrib-prov") as HTMLSelectElement).value,
              backend: (document.getElementById("op-backend") as HTMLInputElement).value.trim() || "manual",
              verdict: (document.getElementById("op-verdict") as HTMLSelectElement).value,
              confidence: (document.getElementById("op-confidence") as HTMLSelectElement).value,
              summaryTxt: (document.getElementById("op-summary") as HTMLTextAreaElement).value.trim(),
            }),
          });
          toast(`Recorded opinion for CF #${cfId}`, "ok");
        }
        await loadEntryDetail(cfId);
      },
    });
  });
  document.getElementById("sl-search")?.addEventListener("input", (ev) => {
    state.shortlistSearch = (ev.target as HTMLInputElement).value;
    render();
    const inp = document.getElementById("sl-search") as HTMLInputElement | null;
    inp?.focus();
    inp?.setSelectionRange(inp.value.length, inp.value.length);
  });

  // Explorer events & Saved Searches
  document.querySelectorAll<HTMLElement>("[data-apply-query]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("[data-del-saved-search]")) return;
      state.explorerSearch = el.dataset.applyQuery || "";
      state.explorerVerdict = "all";
      state.explorerStatus = "all";
      state.explorerMine = false;
      state.explorerStarred = false;
      void loadEntries();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-del-saved-search]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.delSavedSearch);
      await api(`/api/saved-searches/${id}`, { method: "DELETE" });
      await loadSavedSearches();
      render();
    });
  });
  document.getElementById("exp-save-search-btn")?.addEventListener("click", () => {
    const q = state.explorerSearch.trim();
    if (!q) {
      toast("Enter a search query first before saving", "warn");
      return;
    }
    showConfirmModal({
      title: "Save Custom Search",
      bodyHtml: `
        <div class="form-field"><label>Name</label><input type="text" id="ss-name" placeholder="e.g. Ready planner patches" /></div>
        <div class="form-field"><label>Query</label><input type="text" id="ss-query" class="mono" value="${esc(q)}" /></div>
      `,
      confirmLabel: "Save Search",
      onConfirm: async () => {
        const name = (document.getElementById("ss-name") as HTMLInputElement).value.trim();
        const query = (document.getElementById("ss-query") as HTMLInputElement).value.trim();
        await api("/api/saved-searches", { method: "POST", body: JSON.stringify({ name, query }) });
        await loadSavedSearches();
        toast(`Saved search "${name}"`, "ok");
        render();
      },
    });
  });
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  document.getElementById("exp-search")?.addEventListener("input", (ev) => {
    state.explorerSearch = (ev.target as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadEntries(), 220);
  });
  document.getElementById("exp-verdict")?.addEventListener("change", (ev) => {
    state.explorerVerdict = (ev.target as HTMLSelectElement).value;
    void loadEntries();
  });
  document.getElementById("exp-status")?.addEventListener("change", (ev) => {
    state.explorerStatus = (ev.target as HTMLSelectElement).value;
    void loadEntries();
  });
  document.getElementById("exp-sort")?.addEventListener("change", (ev) => {
    state.explorerSort = (ev.target as HTMLSelectElement).value;
    void loadEntries();
  });
  document.getElementById("exp-starred")?.addEventListener("change", (ev) => {
    state.explorerStarred = (ev.target as HTMLInputElement).checked;
    void loadEntries();
  });
  document.getElementById("exp-mine")?.addEventListener("change", (ev) => {
    state.explorerMine = (ev.target as HTMLInputElement).checked;
    void loadEntries();
  });
  document.getElementById("exp-clear-filters-btn")?.addEventListener("click", () => {
    state.explorerSearch = "";
    state.explorerVerdict = "all";
    state.explorerStatus = "all";
    state.explorerMine = false;
    state.explorerStarred = false;
    void loadEntries();
  });
  document.getElementById("exp-sync-btn")?.addEventListener("click", async () => {
    const cfNum = Number((document.getElementById("exp-sync-cf") as HTMLSelectElement).value);
    try {
      toast(`Syncing CommitFest #${cfNum}…`, "info");
      const res = await api<{ synced: number }>("/api/cf/sync", {
        method: "POST",
        body: JSON.stringify({ cfNumber: cfNum }),
      });
      toast(`Synced ${res.synced} patches from CF #${cfNum}`, "ok");
      await Promise.all([loadHealth(), loadEntries()]);
    } catch (err) {
      toastError(err);
    }
  });

  // Workbench events
  document.querySelectorAll<HTMLButtonElement>("[data-wb-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncDraftFromDom();
      state.workbenchTab = btn.dataset.wbTab as WorkbenchTab;
      render();
      if (state.workbenchTab === "diff" && state.selectedCfId && !state.diffData && !state.diffLoading) {
        void loadDiffForEntry(state.selectedCfId);
      }
    });
  });

  // Experimental Diff & Inline Review handlers
  document.getElementById("diff-load-btn")?.addEventListener("click", () => {
    if (state.selectedCfId) void loadDiffForEntry(state.selectedCfId);
  });
  document.getElementById("diff-retry-btn")?.addEventListener("click", () => {
    if (state.selectedCfId) void loadDiffForEntry(state.selectedCfId);
  });
  document.getElementById("diff-reload-page-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("pgroast-session-token");
    window.location.reload();
  });
  document.querySelectorAll<HTMLElement>("[data-diff-file]").forEach((row) => {
    row.addEventListener("click", () => {
      if (!state.selectedCfId) return;
      const cfId = state.selectedCfId;
      const filePath = row.dataset.diffFile || "";
      const lineNum = Number(row.dataset.diffLine || 1);
      const lineType = (row.dataset.diffType as "add" | "del" | "ctx") || "add";
      const codeSnippet = row.dataset.diffCode || "";
      showConfirmModal({
        title: `Inline Review Note — ${filePath}:${lineNum}`,
        bodyHtml: `
          <pre class="mono" style="margin:0 0 10px;padding:8px;border:1px solid var(--border);border-radius:6px;white-space:pre-wrap;font-size:11.5px;">${esc(codeSnippet)}</pre>
          <div class="form-field">
            <label>Review Comment (will be compiled into your -hackers plain-text email)</label>
            <textarea id="diff-inline-text" rows="4" placeholder="Explain the edge case, lock concern, or suggestion…"></textarea>
          </div>
        `,
        confirmLabel: "Save Inline Note",
        onConfirm: async () => {
          const text = (document.getElementById("diff-inline-text") as HTMLTextAreaElement).value.trim();
          if (!text) return;
          const res = await api<{ comment: DiffCommentRecord }>(`/api/entries/${cfId}/diff/comments`, {
            method: "POST",
            body: JSON.stringify({
              file_path: filePath,
              line_num: lineNum,
              line_type: lineType,
              code_snippet: codeSnippet,
              comment_text: text,
            }),
          });
          state.diffComments.push(res.comment);
          toast(`Saved inline note on ${filePath}:${lineNum}`, "ok");
          render();
        },
      });
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-del-diff-comment]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!state.selectedCfId) return;
      const cid = Number(btn.dataset.delDiffComment);
      await api(`/api/entries/${state.selectedCfId}/diff/comments/${cid}`, { method: "DELETE" });
      state.diffComments = state.diffComments.filter((c) => c.id !== cid);
      render();
    });
  });
  document.getElementById("diff-compile-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId) return;
    try {
      const compiled = await api<{ subject: string; body: string }>(
        `/api/entries/${state.selectedCfId}/diff/compile-email`,
        { method: "POST" },
      );
      state.activeDraft.subject = state.activeDraft.subject || compiled.subject;
      state.activeDraft.body = compiled.body;
      state.workbenchTab = "reply";
      toast("Compiled inline diff notes into Reply Studio plain-text draft", "ok");
      render();
    } catch (err) {
      toastError(err, "Failed to compile inline review");
    }
  });

  document.getElementById("wb-star-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId || !state.detail) return;
    const nextStar = !(state.detail.triage?.starred === 1);
    const res = await api<{ triage: EntryTriageRecord }>(`/api/entries/${state.selectedCfId}/triage`, {
      method: "PATCH",
      body: JSON.stringify({ starred: nextStar }),
    });
    state.detail.triage = res.triage;
    render();
  });

  document.getElementById("wb-add-tag-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId || !state.detail) return;
    const inp = document.getElementById("wb-new-tag") as HTMLInputElement | null;
    const tag = inp?.value.trim().toLowerCase() || "";
    if (!tag) return;
    const nextTags = [...(state.detail.triage?.tags || []), tag];
    const res = await api<{ triage: EntryTriageRecord }>(`/api/entries/${state.selectedCfId}/triage`, {
      method: "PATCH",
      body: JSON.stringify({ tags: nextTags }),
    });
    state.detail.triage = res.triage;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-rm-tag]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.selectedCfId || !state.detail) return;
      const toRemove = btn.dataset.rmTag;
      const nextTags = (state.detail.triage?.tags || []).filter((t) => t !== toRemove);
      const res = await api<{ triage: EntryTriageRecord }>(`/api/entries/${state.selectedCfId}/triage`, {
        method: "PATCH",
        body: JSON.stringify({ tags: nextTags }),
      });
      state.detail.triage = res.triage;
      render();
    });
  });

  document.getElementById("wb-save-notes-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId || !state.detail) return;
    const notes = (document.getElementById("wb-private-notes") as HTMLTextAreaElement | null)?.value ?? "";
    const res = await api<{ triage: EntryTriageRecord }>(`/api/entries/${state.selectedCfId}/triage`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    });
    state.detail.triage = res.triage;
    toast("Private notes saved locally", "ok");
  });

  document.getElementById("wb-connect-cf-btn")?.addEventListener("click", async () => {
    await switchView("settings");
    setTimeout(() => {
      const target = document.getElementById("cf-cookie-header");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        (target as HTMLInputElement).focus();
      }
    }, 80);
  });

  document.getElementById("wb-refresh-cf-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId) return;
    try {
      await api(`/api/cf/${state.selectedCfId}/refresh`, { method: "POST" });
      toast(`Refreshed CF ${state.selectedCfId} from commitfest.postgresql.org`, "ok");
      await loadEntryDetail(state.selectedCfId);
    } catch (err) {
      toastError(err);
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-pick-roast-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lvl = btn.dataset.pickRoastLevel as "light" | "medium" | "dark";
      if (!lvl) return;
      state.roastLevel = lvl;
      try { localStorage.setItem("pgroast-roast-level", lvl); } catch { /* ignore */ }
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-pick-roast-flavour]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fl = btn.dataset.pickRoastFlavour;
      if (!fl) return;
      state.roastFlavour = fl;
      try { localStorage.setItem("pgroast-roast-flavour", fl); } catch { /* ignore */ }
      render();
    });
  });

  document.getElementById("roast-surprise-btn")?.addEventListener("click", () => {
    const levels: Array<"light" | "medium" | "dark"> = ["light", "medium", "dark"];
    const flavours = [
      "edge-case-hunter",
      "spec-lawyer",
      "systems-architect",
      "perf-hawk",
      "storage-skeptic",
      "index-specialist",
      "production-dba",
    ];
    state.roastLevel = levels[Math.floor(Math.random() * levels.length)]!;
    state.roastFlavour = flavours[Math.floor(Math.random() * flavours.length)]!;
    try {
      localStorage.setItem("pgroast-roast-level", state.roastLevel);
      localStorage.setItem("pgroast-roast-flavour", state.roastFlavour);
    } catch { /* ignore */ }
    render();
  });

  document.getElementById("run-roast-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId) return;
    const backend = (document.getElementById("roast-backend") as HTMLSelectElement)?.value || state.settings?.defaultBackend || "auto";
    const roastLevel = state.roastLevel || "medium";
    const roastFlavour = state.roastFlavour || "default";
    const rounds = Number((document.getElementById("roast-rounds") as HTMLSelectElement)?.value ?? 1);
    const claudeModel = (document.getElementById("roast-claude-model") as HTMLSelectElement)?.value || "opus";
    const agyModel = (document.getElementById("roast-agy-model") as HTMLInputElement)?.value.trim() || undefined;
    const selfMode = Boolean((document.getElementById("roast-self") as HTMLInputElement)?.checked);
    const dryRun = Boolean((document.getElementById("roast-dryrun") as HTMLInputElement)?.checked);
    try {
      const { job } = await api<{ job: JobRecord }>("/api/jobs/roast", {
        method: "POST",
        body: JSON.stringify({ cfId: state.selectedCfId, backend, roastLevel, roastFlavour, rounds, claudeModel, agyModel, selfMode, dryRun }),
      });
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("run-pushback-btn")?.addEventListener("click", async () => {
    if (!state.selectedCfId) return;
    const rawBackend = (document.getElementById("roast-backend") as HTMLSelectElement)?.value || state.settings?.defaultBackend || "auto";
    const firstAvail = state.aiSummary?.available?.[0] || "claude";
    const backend = rawBackend === "dual" || rawBackend === "auto" ? firstAvail : rawBackend;
    try {
      const { job } = await api<{ job: JobRecord }>("/api/jobs/pushback", {
        method: "POST",
        body: JSON.stringify({ cfId: state.selectedCfId, backend }),
      });
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("create-wi-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    try {
      const { workItem } = await api<{ workItem: WorkItemRecord }>("/api/work-items", {
        method: "POST",
        body: JSON.stringify({ cf_id: state.detail.entry.cf_id, title: state.detail.entry.title }),
      });
      toast(`Created Work Item #${workItem.id} (saved locally in Jobs & Work Items)`, "ok", {
        actionLabel: `Open WI #${workItem.id} →`,
        onAction: () => void openWorkItem(workItem.id),
      });
      await Promise.all([loadEntryDetail(state.detail.entry.cf_id), loadWorkItems()]);
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("run-build-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    const targetBranch = (document.getElementById("bt-branch") as HTMLSelectElement).value;
    const suites = (document.getElementById("bt-suites") as HTMLInputElement).value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let wi = state.detail.workItems[0];
    if (!wi) {
      const created = await api<{ workItem: WorkItemRecord }>("/api/work-items", {
        method: "POST",
        body: JSON.stringify({ cf_id: state.detail.entry.cf_id, title: state.detail.entry.title, target_branch: targetBranch }),
      });
      wi = created.workItem;
    }
    try {
      const { job } = await api<{ job: JobRecord }>("/api/jobs/build-test", {
        method: "POST",
        body: JSON.stringify({ cfId: state.detail.entry.cf_id, workItemId: wi.id, targetBranch, suites }),
      });
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("cleanup-wt-btn")?.addEventListener("click", async () => {
    const wt = state.detail?.workItems[0]?.worktree_path;
    if (!wt) return;
    showConfirmModal({
      title: "Cleanup Managed Worktree",
      bodyHtml: `<p>Remove ONLY this managed worktree?</p><pre class="mono" style="font-size:11.5px;">${esc(wt)}</pre>`,
      confirmLabel: "Remove Worktree",
      danger: true,
      onConfirm: async () => {
        await api("/api/worktrees/cleanup", { method: "POST", body: JSON.stringify({ worktreePath: wt }) });
        toast("Worktree removed", "ok");
      },
    });
  });

  document.getElementById("ai-rev-backend")?.addEventListener("change", (ev) => {
    const val = (ev.target as HTMLSelectElement).value;
    const modelInp = document.getElementById("ai-rev-model") as HTMLInputElement | null;
    if (modelInp) {
      modelInp.value = val === "agy" ? state.settings?.defaultAgyModel || "" : val === "codex" ? "codex-default" : "opus";
    }
  });

  document.getElementById("run-ai-review-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    const backend = (document.getElementById("ai-rev-backend") as HTMLSelectElement).value;
    const model = (document.getElementById("ai-rev-model") as HTMLInputElement).value;
    const focusPrompt = (document.getElementById("ai-rev-focus") as HTMLTextAreaElement).value;
    try {
      const { job } = await api<{ job: JobRecord }>("/api/jobs/ai-review", {
        method: "POST",
        body: JSON.stringify({
          cfId: state.detail.entry.cf_id,
          workItemId: state.detail.workItems[0]?.id,
          backend,
          model,
          focusPrompt,
          blindVerify: false,
        }),
      });
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("run-blind-verify-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    const prevBackend = (document.getElementById("ai-rev-backend") as HTMLSelectElement).value;
    const focusPrompt = (document.getElementById("ai-rev-focus") as HTMLTextAreaElement).value;
    const opposite = prevBackend === "claude" ? "agy" : "claude";
    try {
      const { job } = await api<{ job: JobRecord }>("/api/jobs/ai-review", {
        method: "POST",
        body: JSON.stringify({
          cfId: state.detail.entry.cf_id,
          workItemId: state.detail.workItems[0]?.id,
          backend: opposite,
          previousBackend: prevBackend,
          focusPrompt,
          blindVerify: true,
        }),
      });
      toast(`Launched cross-family blind verification (${opposite})`, "ok");
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("run-hetzner-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    const profile = (document.getElementById("hetzner-profile") as HTMLSelectElement).value;
    try {
      const { job } = await api<{ job: JobRecord }>("/api/jobs/hetzner", {
        method: "POST",
        body: JSON.stringify({ cfId: state.detail.entry.cf_id, profile }),
      });
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("save-wi-evidence-btn")?.addEventListener("click", async () => {
    const wi = state.detail?.workItems[0];
    if (!wi) return;
    const md = (document.getElementById("wi-evidence-md") as HTMLTextAreaElement).value;
    await api(`/api/work-items/${wi.id}`, {
      method: "PATCH",
      body: JSON.stringify({ evidence_md: md }),
    });
    toast("Evidence record saved privately", "ok");
  });

  // Reply Studio events
  document.getElementById("gmail-search-btn")?.addEventListener("click", async () => {
    syncDraftFromDom();
    const q = (document.getElementById("gmail-search-q") as HTMLInputElement).value;
    try {
      const { matches } = await api<{ matches: GmailThreadMatch[] }>(`/api/gmail/search?q=${encodeURIComponent(q)}`);
      state.activeDraft.gmailMatches = matches;
      toast(`Found ${matches.length} Gmail thread(s)`, "ok");
      render();
    } catch (err) {
      toastError(err);
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-pick-gmail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncDraftFromDom();
      const m = state.activeDraft.gmailMatches[Number(btn.dataset.pickGmail)];
      if (!m) return;
      state.activeDraft.threadId = m.threadId;
      state.activeDraft.inReplyTo = m.messageIdHeader;
      state.activeDraft.referencesHeader = m.references ? `${m.references} ${m.messageIdHeader}` : m.messageIdHeader;
      state.activeDraft.subject = m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`;
      if (m.to) state.activeDraft.to = m.to;
      if (m.cc) state.activeDraft.cc = m.cc;
      toast(`Linked Gmail thread ${m.threadId}`, "ok");
      render();
    });
  });

  document.getElementById("draft-generate-btn")?.addEventListener("click", async () => {
    if (!state.detail) return;
    syncDraftFromDom();
    const backend = (document.getElementById("draft-gen-backend") as HTMLSelectElement).value;
    const includeFootnoteAttachment = (document.getElementById("draft-footnote-att") as HTMLInputElement).checked;
    try {
      const res = await api<{
        subject: string;
        body: string;
        attachments: DraftAttachment[];
        gates: AllGatesResult;
        generator: string;
      }>("/api/drafts/generate", {
        method: "POST",
        body: JSON.stringify({
          cfId: state.detail.entry.cf_id,
          workItemId: state.detail.workItems[0]?.id,
          isReply: state.activeDraft.isReply,
          isOtherAuthorThread: state.activeDraft.isOtherAuthorThread,
          includeFootnoteAttachment,
          backend,
        }),
      });
      state.activeDraft.subject = state.activeDraft.subject || res.subject;
      state.activeDraft.body = res.body;
      state.activeDraft.attachments = res.attachments;
      state.activeDraft.gates = res.gates;
      toast(`Draft generated (${res.generator})`, "ok");
      render();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("draft-add-att-btn")?.addEventListener("click", () => {
    syncDraftFromDom();
    const inp = document.getElementById("draft-new-att-name") as HTMLInputElement;
    const filename = inp.value.trim();
    if (!filename) return;
    state.activeDraft.attachments.push({ filename, contentText: "" });
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-rm-att]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncDraftFromDom();
      state.activeDraft.attachments.splice(Number(btn.dataset.rmAtt), 1);
      render();
    });
  });

  document.getElementById("draft-check-gates-btn")?.addEventListener("click", async () => {
    syncDraftFromDom();
    const res = await api<{ gates: AllGatesResult; wrappedBody: string }>("/api/drafts/check-gates", {
      method: "POST",
      body: JSON.stringify({
        body: state.activeDraft.body,
        subject: state.activeDraft.subject,
        isReply: state.activeDraft.isReply,
        isOtherAuthorThread: state.activeDraft.isOtherAuthorThread,
        attachments: state.activeDraft.attachments,
        cfId: state.selectedCfId,
        inReplyTo: state.activeDraft.inReplyTo,
        wrap: true,
      }),
    });
    state.activeDraft.body = res.wrappedBody;
    state.activeDraft.gates = res.gates;
    toast(res.gates.hardBlocked ? "HARD BLOCKED by safety gates" : "Gates evaluated & prose wrapped", res.gates.hardBlocked ? "error" : "ok");
    render();
  });

  async function persistLocalDraft(): Promise<number> {
    syncDraftFromDom();
    const payload = {
      cf_id: state.selectedCfId,
      work_item_id: state.detail?.workItems[0]?.id ?? null,
      is_reply: state.activeDraft.isReply ? 1 : 0,
      is_other_author_thread: state.activeDraft.isOtherAuthorThread ? 1 : 0,
      thread_id: state.activeDraft.threadId,
      in_reply_to: state.activeDraft.inReplyTo,
      references_header: state.activeDraft.referencesHeader,
      to_addrs: state.activeDraft.to,
      cc_addrs: state.activeDraft.cc,
      subject: state.activeDraft.subject,
      body: state.activeDraft.body,
      attachments_json: JSON.stringify(state.activeDraft.attachments),
    };
    if (state.activeDraft.id) {
      await api(`/api/drafts/${state.activeDraft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      return state.activeDraft.id;
    }
    const { draft } = await api<{ draft: DraftRecord }>("/api/drafts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.activeDraft.id = draft.id;
    return draft.id;
  }

  document.getElementById("draft-save-local-btn")?.addEventListener("click", async () => {
    try {
      const id = await persistLocalDraft();
      toast(`Saved local draft #${id}`, "ok");
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("draft-save-gmail-btn")?.addEventListener("click", async () => {
    syncDraftFromDom();
    showConfirmModal({
      title: "Save Threaded Gmail Draft (Never Sends)",
      bodyHtml: `
        <p>This will run all 4 safety gates and create an unsent Gmail <strong>Draft</strong> in <code>${esc(state.settings?.gmailAccount || "your configured gws Gmail account")}</code> via <code>gws gmail users drafts create</code>.</p>
        <p class="muted"><strong>Send is strictly human-only.</strong> This app never calls messages.send or drafts.send.</p>
        <div class="mono" style="font-size:11.5px;background:var(--bg-elev);padding:8px;border-radius:6px;">
          To: ${esc(state.activeDraft.to)}<br/>
          Subject: ${esc(state.activeDraft.subject)}<br/>
          ThreadId: ${esc(state.activeDraft.threadId || "(new thread)")}
        </div>
      `,
      confirmLabel: "Save Gmail Draft",
      onConfirm: async () => {
        const id = await persistLocalDraft();
        const res = await api<{ gmailDraftId: string; gmailDraftUrl: string; gates: AllGatesResult }>(
          `/api/drafts/${id}/save-gmail`,
          { method: "POST" },
        );
        state.activeDraft.gates = res.gates;
        state.activeDraft.gmailDraftUrl = res.gmailDraftUrl;
        toast(`Saved Gmail draft (${res.gmailDraftId}). Open Gmail to review & send.`, "ok");
        render();
      },
    });
  });

  // CommitFest Mutating Actions (ALL guarded by confirmation modal + confirm:true)
  document.querySelectorAll<HTMLButtonElement>("[data-cf-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.selectedCfId) return;
      const act = btn.dataset.cfAct!;
      const cfId = state.selectedCfId;
      const endpointMap: Record<string, { url: string; label: string }> = {
        reviewer_become: { url: `/api/cf/${cfId}/reviewer/become`, label: `Become reviewer on CF ${cfId}` },
        reviewer_remove: { url: `/api/cf/${cfId}/reviewer/remove`, label: `Remove yourself as reviewer on CF ${cfId}` },
        cfbot_requeue: { url: `/api/cf/${cfId}/cfbot-requeue`, label: `Re-queue cfbot for CF ${cfId}` },
      };
      const cfg = endpointMap[act];
      if (!cfg) return;
      showConfirmModal({
        title: "Confirm CommitFest Mutation",
        bodyHtml: `<p>Execute public CommitFest action as <strong>${esc(state.cfAuth?.verifiedUser || state.cfAuth?.username || "your CommitFest account")}</strong>?</p><p><strong>${esc(cfg.label)}</strong></p>`,
        confirmLabel: "Confirm & Submit",
        onConfirm: async () => {
          await api(cfg.url, { method: "POST", body: JSON.stringify({ confirm: true }) });
          toast(`Completed: ${cfg.label}`, "ok");
          await loadEntryDetail(cfId);
        },
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-cf-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.selectedCfId) return;
      const status = btn.dataset.cfStatus as "review" | "author" | "committer";
      const cfId = state.selectedCfId;
      showConfirmModal({
        title: "Confirm CommitFest Status Change",
        bodyHtml: `<p>Change CommitFest patch <strong>#${cfId}</strong> status to <strong>${esc(btn.textContent || status)}</strong> as <code>${esc(state.cfAuth?.verifiedUser || state.cfAuth?.username || "your CommitFest account")}</code>?</p>`,
        confirmLabel: "Update Status",
        onConfirm: async () => {
          await api(`/api/cf/${cfId}/status`, { method: "POST", body: JSON.stringify({ status, confirm: true }) });
          toast(`Updated CF ${cfId} status`, "ok");
          await loadEntryDetail(cfId);
        },
      });
    });
  });

  document.getElementById("cf-ann-btn")?.addEventListener("click", () => {
    if (!state.selectedCfId) return;
    const cfId = state.selectedCfId;
    const mailthreadId = (document.getElementById("cf-ann-tid") as HTMLInputElement).value.trim();
    const messageId = (document.getElementById("cf-ann-msgid") as HTMLInputElement).value.trim();
    const text = (document.getElementById("cf-ann-text") as HTMLTextAreaElement).value.trim();
    if (!text) return toast("Annotation text is empty", "warn");
    showConfirmModal({
      title: "Confirm CommitFest Annotation",
      bodyHtml: `<p>Post public annotation (${text.length}/500 chars) on CF ${cfId}?</p><pre class="mono" style="white-space:pre-wrap;">${esc(text)}</pre>`,
      confirmLabel: "Post Annotation",
      onConfirm: async () => {
        await api(`/api/cf/${cfId}/annotate`, {
          method: "POST",
          body: JSON.stringify({ mailthreadId, messageId, text, confirm: true }),
        });
        toast("Annotation posted", "ok");
      },
    });
  });

  // GitHub Fork Issue Preview & Publish
  document.getElementById("gh-preview-issue-btn")?.addEventListener("click", async () => {
    const wi = state.detail?.workItems[0];
    if (!wi) return;
    try {
      const preview = await api<{ title: string; body: string; gate: { blocking: boolean; issues: Array<{ message: string }> } }>(
        "/api/github/issues/preview",
        { method: "POST", body: JSON.stringify({ workItemId: wi.id }) },
      );
      showConfirmModal({
        title: `Publish Sanitized Issue to ${state.settings?.githubFork || "your configured GitHub fork"}`,
        bodyHtml: `
          ${
            preview.gate.blocking
              ? `<div style="color:var(--danger);margin-bottom:8px;"><strong>HARD BLOCK:</strong> ${esc(preview.gate.issues.map((i) => i.message).join("; "))}</div>`
              : `<div style="color:var(--ok);margin-bottom:8px;">✅ Public-Confidentiality check passed. Edit below if needed before publishing:</div>`
          }
          <div class="form-field"><label>Title</label><input type="text" id="gh-pub-title" value="${esc(preview.title)}" /></div>
          <div class="form-field"><label>Public-Safe Body (Markdown)</label><textarea id="gh-pub-body" rows="10" class="mono">${esc(preview.body)}</textarea></div>
        `,
        confirmLabel: wi.github_issue_number ? `Comment on #${wi.github_issue_number}` : "Create Public Issue",
        onConfirm: async () => {
          const title = (document.getElementById("gh-pub-title") as HTMLInputElement).value;
          const body = (document.getElementById("gh-pub-body") as HTMLTextAreaElement).value;
          const res = await api<{ url: string }>("/api/github/issues/publish", {
            method: "POST",
            body: JSON.stringify({
              workItemId: wi.id,
              title,
              body,
              commentOnExisting: Boolean(wi.github_issue_number),
              confirm: true,
            }),
          });
          toast(`Published to GitHub: ${res.url}`, "ok");
          if (state.selectedCfId) await loadEntryDetail(state.selectedCfId);
        },
      });
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("gh-ci-push-btn")?.addEventListener("click", () => {
    const wi = state.detail?.workItems[0];
    if (!wi) return;
    const branchName = (document.getElementById("gh-ci-branch") as HTMLInputElement).value.trim();
    showConfirmModal({
      title: "Push CI Branch to Public Fork (No PR)",
      bodyHtml: `<p>Push isolated worktree HEAD to <code>${esc(state.settings?.githubFork || "your configured GitHub fork")}</code> branch <code>${esc(branchName)}</code> for GitHub Actions CI (<code>pg-ci.yml</code>)?</p><p class="muted">Non-security work only. No PR will be opened.</p>`,
      confirmLabel: "Push CI Branch",
      onConfirm: async () => {
        const res = await api<{ branch: string; actionsUrl: string }>("/api/github/ci-push", {
          method: "POST",
          body: JSON.stringify({ workItemId: wi.id, branchName, confirm: true }),
        });
        toast(`Pushed ${res.branch} for CI`, "ok");
      },
    });
  });

  // Bugs view events
  document.getElementById("bug-class-filter")?.addEventListener("change", (ev) => {
    state.bugClassFilter = (ev.target as HTMLSelectElement).value;
    void loadBugs();
  });
  document.getElementById("bug-sev-filter")?.addEventListener("change", (ev) => {
    state.bugSeverityFilter = (ev.target as HTMLSelectElement).value;
    void loadBugs();
  });
  document.getElementById("bugs-scan-btn")?.addEventListener("click", async () => {
    try {
      const { job } = await api<{ job: JobRecord }>("/api/bugs/scan", {
        method: "POST",
        body: JSON.stringify({ days: 14, limit: 30 }),
      });
      openJobStream(job);
      void refreshJobsList();
    } catch (err) {
      toastError(err);
    }
  });
  document.getElementById("bugs-add-manual-btn")?.addEventListener("click", () => {
    showConfirmModal({
      title: "Classify & Add pgsql-bugs Report",
      bodyHtml: `
        <div class="form-field"><label>Subject</label><input type="text" id="mb-subject" placeholder="BUG #19204: wrong results on partitioned join after PG18.2 upgrade" /></div>
        <div class="form-field"><label>Sender</label><input type="text" id="mb-sender" placeholder="user@company.com" /></div>
        <div class="form-field"><label>Thread URL</label><input type="text" id="mb-url" placeholder="https://www.postgresql.org/message-id/..." /></div>
        <div class="form-field"><label>Message Body</label><textarea id="mb-body" rows="5" placeholder="Paste email body to detect production-hit signals vs synthetic AI hunt…"></textarea></div>
      `,
      confirmLabel: "Classify & Save",
      onConfirm: async () => {
        await api("/api/bugs", {
          method: "POST",
          body: JSON.stringify({
            subject: (document.getElementById("mb-subject") as HTMLInputElement).value,
            sender: (document.getElementById("mb-sender") as HTMLInputElement).value,
            thread_url: (document.getElementById("mb-url") as HTMLInputElement).value,
            body_text: (document.getElementById("mb-body") as HTMLTextAreaElement).value,
          }),
        });
        toast("Bug report classified & saved", "ok");
        await loadBugs();
      },
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-bug-repro]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bugId = Number(btn.dataset.bugRepro);
      const bug = state.bugs.find((b) => b.id === bugId);
      if (!bug) return;
      try {
        const { workItem } = await api<{ workItem: WorkItemRecord }>("/api/work-items", {
          method: "POST",
          body: JSON.stringify({
            title: bug.subject,
            evidence_md: `Source: ${bug.thread_url}\nClassification: ${bug.classification} (${bug.severity})\n\n${bug.summary}`,
          }),
        });
        await api(`/api/bugs/${bugId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "reproducing", work_item_id: workItem.id }),
        });
        toast(`Created Work Item #${workItem.id} in Jobs & Work Items`, "ok", {
          hint: "Stored privately in your local PostgreSQL DB. Click below to view, edit repro notes, or publish a sanitized fork issue.",
          actionLabel: `Open WI #${workItem.id} →`,
          onAction: () => void openWorkItem(workItem.id),
        });
        await Promise.all([loadBugs(), loadWorkItems()]);
      } catch (err) {
        toastError(err, "Failed to create Work Item");
      }
    });
  });

  // Work Items & Jobs view events
  document.getElementById("wi-refresh-btn")?.addEventListener("click", async () => {
    await loadWorkItems();
    render();
  });
  document.getElementById("jobs-refresh-btn")?.addEventListener("click", async () => {
    await refreshJobsList();
    render();
  });

  // Bulk Roast controls (Jobs view)
  const syncBulkAndRender = () => render();
  document.getElementById("bulk-mode")?.addEventListener("change", (ev) => {
    state.bulkRoast.mode = ((ev.target as HTMLSelectElement).value === "batch" ? "batch" : "queue");
    if (state.bulkRoast.mode === "queue" && state.bulkRoast.backend === "dual") state.bulkRoast.backend = "codex";
    syncBulkAndRender();
  });
  document.getElementById("bulk-backend")?.addEventListener("change", (ev) => {
    const nextB = (ev.target as HTMLSelectElement).value as AppState["bulkRoast"]["backend"];
    state.bulkRoast.backend = nextB;
    if (nextB === "codex" && (!state.bulkRoast.model || state.bulkRoast.model === "opus")) {
      state.bulkRoast.model = "gpt-6.2-astra";
      state.bulkRoast.effort = "xhigh";
    } else if (nextB === "claude" && state.bulkRoast.model.startsWith("gpt-")) {
      state.bulkRoast.model = "opus";
      state.bulkRoast.effort = "";
    }
    syncBulkAndRender();
  });
  document.getElementById("bulk-model")?.addEventListener("change", (ev) => {
    state.bulkRoast.model = (ev.target as HTMLInputElement).value.trim();
    syncBulkAndRender();
  });
  document.getElementById("bulk-effort")?.addEventListener("change", (ev) => {
    state.bulkRoast.effort = (ev.target as HTMLSelectElement).value;
    syncBulkAndRender();
  });
  document.getElementById("bulk-strategy")?.addEventListener("change", (ev) => {
    state.bulkRoast.strategy = (ev.target as HTMLSelectElement).value as AppState["bulkRoast"]["strategy"];
    syncBulkAndRender();
  });
  document.getElementById("bulk-cf-num")?.addEventListener("change", (ev) => {
    state.bulkRoast.cfNumber = Math.max(1, Number((ev.target as HTMLInputElement).value || 62));
    syncBulkAndRender();
  });
  document.getElementById("bulk-cf-status")?.addEventListener("change", (ev) => {
    state.bulkRoast.status = (ev.target as HTMLSelectElement).value || "open";
    syncBulkAndRender();
  });
  document.getElementById("bulk-flavour")?.addEventListener("change", (ev) => {
    state.bulkRoast.flavour = (ev.target as HTMLSelectElement).value || "default";
    syncBulkAndRender();
  });
  document.getElementById("bulk-level")?.addEventListener("change", (ev) => {
    state.bulkRoast.level = (ev.target as HTMLSelectElement).value as AppState["bulkRoast"]["level"];
    syncBulkAndRender();
  });
  document.getElementById("bulk-count")?.addEventListener("change", (ev) => {
    state.bulkRoast.count = Math.min(300, Math.max(1, Number((ev.target as HTMLInputElement).value || 20)));
    syncBulkAndRender();
  });
  document.getElementById("bulk-workers")?.addEventListener("change", (ev) => {
    state.bulkRoast.workers = Math.min(4, Math.max(1, Number((ev.target as HTMLSelectElement).value || 2)));
    syncBulkAndRender();
  });
  document.getElementById("bulk-publish")?.addEventListener("change", (ev) => {
    state.bulkRoast.publish = (ev.target as HTMLInputElement).checked;
    syncBulkAndRender();
  });
  document.getElementById("bulk-start-btn")?.addEventListener("click", async () => {
    try {
      const b = state.bulkRoast;
      const res = await api<{ job: JobRecord }>("/api/roast/bulk", {
        method: "POST",
        body: JSON.stringify({
          mode: b.mode,
          backend: b.backend,
          model: b.model,
          effort: b.effort,
          strategy: b.strategy,
          flavour: b.flavour,
          roastLevel: b.level,
          count: b.count,
          workers: b.workers,
          publish: b.publish,
          cfNumber: b.cfNumber,
          status: b.status,
        }),
      });
      toast(`Started Bulk Roast (${b.count} × ${b.backend}, ${b.workers} worker${b.workers === 1 ? "" : "s"})`, "ok");
      openJobStream(res.job);
      await refreshJobsList();
      render();
    } catch (err) {
      toastError(err, "Failed to start Bulk Roast");
    }
  });
  document.getElementById("wi-new-btn")?.addEventListener("click", () => {
    showConfirmModal({
      title: "New Local Work Item",
      bodyHtml: `
        <div class="form-field"><label>Title</label><input type="text" id="new-wi-title" placeholder="e.g. Reproduce PG18 partitioned join bug" /></div>
        <div class="form-grid">
          <div class="form-field"><label>Linked CF # (optional)</label><input type="number" id="new-wi-cf" placeholder="e.g. 5879" /></div>
          <div class="form-field"><label>Target Branch</label><input type="text" id="new-wi-branch" value="master" /></div>
        </div>
        <div class="form-field"><label>Initial Notes / Evidence (private)</label><textarea id="new-wi-ev" rows="4" class="mono" placeholder="Repro SQL, links, hypotheses…"></textarea></div>
      `,
      confirmLabel: "Create Work Item",
      onConfirm: async () => {
        const title = (document.getElementById("new-wi-title") as HTMLInputElement).value.trim();
        const cfRaw = (document.getElementById("new-wi-cf") as HTMLInputElement).value.trim();
        const target_branch = (document.getElementById("new-wi-branch") as HTMLInputElement).value.trim() || "master";
        const evidence_md = (document.getElementById("new-wi-ev") as HTMLTextAreaElement).value;
        const { workItem } = await api<{ workItem: WorkItemRecord }>("/api/work-items", {
          method: "POST",
          body: JSON.stringify({
            title: title || "Untitled work item",
            cf_id: cfRaw ? Number(cfRaw) : null,
            target_branch,
            evidence_md,
          }),
        });
        state.focusedWorkItemId = workItem.id;
        await loadWorkItems();
        toast(`Created Work Item #${workItem.id}`, "ok");
        render();
      },
    });
  });
  document.querySelectorAll<HTMLSelectElement>("[data-wi-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = Number(sel.dataset.wiStatus);
      try {
        await api(`/api/work-items/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: sel.value }),
        });
        toast(`WI #${id} status updated to ${sel.value}`, "ok");
        await loadWorkItems();
      } catch (err) {
        toastError(err);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wi-save-ev]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.wiSaveEv);
      const md = (document.getElementById(`wi-ev-${id}`) as HTMLTextAreaElement | null)?.value ?? "";
      try {
        await api(`/api/work-items/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ evidence_md: md }),
        });
        toast(`Saved private evidence for WI #${id}`, "ok");
        await loadWorkItems();
      } catch (err) {
        toastError(err);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wi-publish]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.wiPublish);
      const wi = state.workItems.find((w) => w.id === id);
      if (!wi) return;
      try {
        const preview = await api<{ title: string; body: string; gate: { blocking: boolean; issues: Array<{ message: string }> } }>(
          "/api/github/issues/preview",
          { method: "POST", body: JSON.stringify({ workItemId: wi.id }) },
        );
        showConfirmModal({
          title: `Publish Sanitized Issue to ${state.settings?.githubFork || "your configured GitHub fork"}`,
          bodyHtml: `
            ${
              preview.gate.blocking
                ? `<div style="color:var(--danger);margin-bottom:8px;"><strong>HARD BLOCK:</strong> ${esc(preview.gate.issues.map((i) => i.message).join("; "))}</div>`
                : `<div style="color:var(--ok);margin-bottom:8px;">✅ Public-Confidentiality check passed. Review before publishing:</div>`
            }
            <div class="form-field"><label>Title</label><input type="text" id="wi-gh-title" value="${esc(preview.title)}" /></div>
            <div class="form-field"><label>Public-Safe Body (Markdown)</label><textarea id="wi-gh-body" rows="10" class="mono">${esc(preview.body)}</textarea></div>
          `,
          confirmLabel: wi.github_issue_number ? `Comment on #${wi.github_issue_number}` : "Create Public Issue",
          onConfirm: async () => {
            const title = (document.getElementById("wi-gh-title") as HTMLInputElement).value;
            const body = (document.getElementById("wi-gh-body") as HTMLTextAreaElement).value;
            const res = await api<{ url: string }>("/api/github/issues/publish", {
              method: "POST",
              body: JSON.stringify({
                workItemId: wi.id,
                title,
                body,
                commentOnExisting: Boolean(wi.github_issue_number),
                confirm: true,
              }),
            });
            toast(`Published WI #${wi.id} to GitHub: ${res.url}`, "ok");
            await loadWorkItems();
            render();
          },
        });
      } catch (err) {
        toastError(err, "Cannot preview fork issue");
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.viewJob);
      if (job) openJobStream(job);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-cancel-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cancelJob!;
      confirmCancelJob(id);
    });
  });

  // Settings view events
  document.getElementById("auth-github-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ identity: ContributorIdentity }>("/api/auth/github/connect", { method: "POST" });
      state.identity = res.identity;
      updateSidebarIdentity();
      toast(`Signed in via GitHub as ${res.identity.name} (@${res.identity.handle})`, "ok");
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err, "GitHub Sign-In failed");
    }
  });
  document.getElementById("auth-google-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ identity: ContributorIdentity }>("/api/auth/google/connect", { method: "POST" });
      state.identity = res.identity;
      updateSidebarIdentity();
      toast(`Signed in via Google as ${res.identity.handle}`, "ok");
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err, "Google Sign-In failed");
    }
  });
  document.getElementById("auth-disconnect-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ identity: ContributorIdentity }>("/api/auth/disconnect", { method: "POST" });
      state.identity = res.identity;
      updateSidebarIdentity();
      toast("Signed out of GitHub / Google identity", "info");
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err);
    }
  });
  document.getElementById("hub-save-btn")?.addEventListener("click", async () => {
    const url = (document.getElementById("hub-url-input") as HTMLInputElement).value.trim();
    const token = (document.getElementById("hub-token-input") as HTMLInputElement).value.trim();
    try {
      const res = await api<{ hubStatus: { url: string; hasToken: boolean } }>("/api/hub/token", {
        method: "POST",
        body: JSON.stringify({ url, token }),
      });
      state.hubStatus = res.hubStatus;
      toast("Public Companion Hub config saved (token encrypted locally)", "ok");
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err, "Failed to save Public Companion config");
    }
  });
  document.getElementById("hub-clear-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ hubStatus: { url: string; hasToken: boolean } }>("/api/hub/token", {
        method: "POST",
        body: JSON.stringify({ clear: true }),
      });
      state.hubStatus = res.hubStatus;
      toast("Cleared Public Companion publish token", "info");
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err);
    }
  });

  // Weekly Quota Auto-Contribute events
  document.getElementById("contrib-save-btn")?.addEventListener("click", async () => {
    try {
      const readBackend = (b: "claude" | "codex" | "agy") => ({
        enabled: Boolean((document.getElementById(`contrib-en-${b}`) as HTMLInputElement | null)?.checked),
        resetDayUtc: (document.getElementById(`contrib-day-${b}`) as HTMLSelectElement | null)?.value || "Mon",
        resetHourUtc: Number((document.getElementById(`contrib-hour-${b}`) as HTMLInputElement | null)?.value || 0),
        windowHoursBeforeReset: Number((document.getElementById(`contrib-win-${b}`) as HTMLInputElement | null)?.value || 18),
        maxPatchesPerWindow: Number((document.getElementById(`contrib-cap-${b}`) as HTMLInputElement | null)?.value || 5),
      });
      const topicsRaw = (document.getElementById("contrib-topics") as HTMLInputElement | null)?.value || "";
      const payload = {
        hubUrl: state.hubStatus?.url || state.settings?.publicHubUrl || "https://pgroast.postgres.ai",
        strategy: (document.getElementById("contrib-strategy") as HTMLSelectElement | null)?.value || "unroasted-first",
        roastLevel: (document.getElementById("contrib-level") as HTMLSelectElement | null)?.value || "medium",
        roastFlavour: (document.getElementById("contrib-flavour") as HTMLSelectElement | null)?.value || "auto-by-subsystem",
        topics: topicsRaw.split(",").map((s) => s.trim()).filter(Boolean),
        autoPublish: Boolean((document.getElementById("contrib-autopublish") as HTMLInputElement | null)?.checked),
        backends: {
          claude: readBackend("claude"),
          codex: readBackend("codex"),
          agy: readBackend("agy"),
        },
      };
      await api("/api/contribute/config", { method: "PUT", body: JSON.stringify(payload) });
      toast("Weekly Quota Auto-Contribute schedule saved (~/.pgroast/contribute.json)", "ok");
      await loadSettingsAndDoctor();
    } catch (err) {
      toastError(err, "Failed to save Auto-Contribute schedule");
    }
  });
  document.getElementById("contrib-preview-btn")?.addEventListener("click", async () => {
    try {
      const cfg = state.contributeData?.config;
      const preferred =
        cfg?.backends.claude.enabled ? "claude" : cfg?.backends.codex.enabled ? "codex" : cfg?.backends.agy.enabled ? "agy" : "claude";
      const res = await api<{ backend: string; preview: NonNullable<AppState["contributePreview"]>["preview"] }>(
        "/api/contribute/preview",
        { method: "POST", body: JSON.stringify({ backend: preferred }) },
      );
      state.contributePreview = res;
      render();
    } catch (err) {
      toastError(err, "Could not preview next queued patch");
    }
  });
  document.getElementById("contrib-run-once-btn")?.addEventListener("click", async () => {
    try {
      const cfg = state.contributeData?.config;
      const enCodex = (document.getElementById("contrib-en-codex") as HTMLInputElement | null)?.checked ?? cfg?.backends.codex.enabled;
      const enClaude = (document.getElementById("contrib-en-claude") as HTMLInputElement | null)?.checked ?? cfg?.backends.claude.enabled;
      const enAgy = (document.getElementById("contrib-en-agy") as HTMLInputElement | null)?.checked ?? cfg?.backends.agy.enabled;
      const liveAutoPublish =
        (document.getElementById("contrib-autopublish") as HTMLInputElement | null)?.checked ?? Boolean(cfg?.autoPublish);
      const preferred = enCodex ? "codex" : enClaude ? "claude" : enAgy ? "agy" : "claude";
      const res = await api<{ job: JobRecord }>("/api/contribute/run", {
        method: "POST",
        body: JSON.stringify({ mode: "once", backend: preferred, publish: liveAutoPublish }),
      });
      toast(`Started Quota Auto-Contribute run (${preferred}${liveAutoPublish ? " · auto-publish" : ""})`, "ok");
      openJobStream(res.job);
      await refreshJobsList();
    } catch (err) {
      toastError(err, "Failed to start Auto-Contribute run");
    }
  });
  document.getElementById("contrib-open-bulk-btn")?.addEventListener("click", () => {
    const cfg = state.contributeData?.config;
    if (cfg) {
      state.bulkRoast.mode = "queue";
      state.bulkRoast.strategy =
        cfg.strategy === "ready-for-committer" || cfg.strategy === "cross-model-second-opinion"
          ? cfg.strategy
          : "unroasted-first";
      state.bulkRoast.flavour = cfg.roastFlavour;
      state.bulkRoast.level =
        cfg.roastLevel === "light" || cfg.roastLevel === "dark" ? cfg.roastLevel : "medium";
      state.bulkRoast.publish = cfg.autoPublish;
      if (cfg.backends.codex.enabled) state.bulkRoast.backend = "codex";
      else if (cfg.backends.claude.enabled) state.bulkRoast.backend = "claude";
      else if (cfg.backends.agy.enabled) state.bulkRoast.backend = "agy";
    }
    state.jobsTab = "jobs";
    void switchView("jobs");
  });
  document.getElementById("contrib-copy-cron-btn")?.addEventListener("click", () => {
    const line = `0 * * * * npx pgroast contribute --auto >> ~/.pgroast/contribute.log 2>&1`;
    void navigator.clipboard?.writeText(line).then(() => toast("Copied hourly cron line to clipboard", "ok"));
  });
  document.getElementById("settings-open-onboarding-btn")?.addEventListener("click", () => void openOnboarding(1));
  document.getElementById("doctor-refresh-btn")?.addEventListener("click", () => void loadSettingsAndDoctor());
  document.getElementById("save-settings-btn")?.addEventListener("click", async () => {
    const patch = {
      authorName: (document.getElementById("set-authorName") as HTMLInputElement).value,
      cfUsername: (document.getElementById("set-cfUsername") as HTMLInputElement).value,
      defaultBackend: (document.getElementById("set-defaultBackend") as HTMLSelectElement).value as AppSettings["defaultBackend"],
      interestedTopics: (document.getElementById("set-interestedTopics") as HTMLInputElement).value,
      pgroastRepo: (document.getElementById("set-pgroastRepo") as HTMLInputElement).value,
      roastDataDir: (document.getElementById("set-roastDataDir") as HTMLInputElement).value,
      postgresRepo: (document.getElementById("set-postgresRepo") as HTMLInputElement).value,
      worktreesRoot: (document.getElementById("set-worktreesRoot") as HTMLInputElement).value,
      skillsRepo: (document.getElementById("set-skillsRepo") as HTMLInputElement).value,
      githubFork: (document.getElementById("set-githubFork") as HTMLInputElement).value,
      gmailAccount: (document.getElementById("set-gmailAccount") as HTMLInputElement).value,
      hetznerSshHost: (document.getElementById("set-hetznerSshHost") as HTMLInputElement).value,
      hetznerRemoteRepo: (document.getElementById("set-hetznerRemoteRepo") as HTMLInputElement).value,
      claudeConfigDir: (document.getElementById("set-claudeConfigDir") as HTMLInputElement).value,
    };
    await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
    toast("Settings saved locally", "ok");
    await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
  });

  document.getElementById("save-cf-cookies-btn")?.addEventListener("click", async () => {
    const cookieHeader = (document.getElementById("cf-cookie-header") as HTMLInputElement).value;
    const sessionid = (document.getElementById("cf-cookie-sid") as HTMLInputElement).value;
    const csrftoken = (document.getElementById("cf-cookie-csrf") as HTMLInputElement).value;
    try {
      await api("/api/cf/auth/cookies", {
        method: "POST",
        body: JSON.stringify({ cookieHeader, sessionid, csrftoken }),
      });
      toast("CommitFest cookies encrypted & stored locally", "ok");
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("verify-cf-login-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ authenticated: boolean; username: string | null; syncedMine: number }>("/api/cf/auth/verify", {
        method: "POST",
      });
      if (res.authenticated) {
        toast(`Verified login as ${res.username} — synced ${res.syncedMine} /me/ patches`, "ok");
      } else {
        toast("Not authenticated — sessionid may be expired", "warn");
      }
      await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("clear-cf-cookies-btn")?.addEventListener("click", async () => {
    await api("/api/cf/auth/cookies", { method: "POST", body: JSON.stringify({ clear: true }) });
    toast("Cleared CommitFest cookies", "info");
    await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
  });
}

// ---------------- Guided Onboarding Wizard ----------------

async function openOnboarding(step = 1): Promise<void> {
  state.onboardingStep = step;
  const backdrop = document.getElementById("onboarding-backdrop");
  if (!backdrop) return;
  backdrop.hidden = false;

  // Ensure fresh settings + doctor checks before rendering
  if (!state.settings || state.doctorChecks.length === 0) {
    try {
      const [sRes, dRes] = await Promise.all([
        api<{ settings: AppSettings; cfAuth: CfAuthStatus; aiSummary?: AppState["aiSummary"]; skillsSummary?: AppState["skillsSummary"] }>("/api/settings"),
        api<{ checks: DoctorCheckItem[]; aiSummary?: AppState["aiSummary"]; skillsSummary?: AppState["skillsSummary"] }>("/api/doctor"),
      ]);
      state.settings = sRes.settings;
      state.cfAuth = sRes.cfAuth;
      state.doctorChecks = dRes.checks;
      if (dRes.aiSummary) state.aiSummary = dRes.aiSummary;
      if (sRes.skillsSummary) state.skillsSummary = sRes.skillsSummary;
    } catch {
      // render with whatever we have
    }
  }
  state.onboardingSkillsMode = state.settings?.skillsRepo?.trim() ? "custom" : "builtin";
  renderOnboarding();
}

function closeOnboarding(): void {
  const backdrop = document.getElementById("onboarding-backdrop");
  if (backdrop) backdrop.hidden = true;
}

async function saveOnboardingStepFields(): Promise<void> {
  const step = state.onboardingStep;
  const patch: Partial<AppSettings> = {};
  if (step === 1) {
    const authorEl = document.getElementById("ob-authorName") as HTMLInputElement | null;
    const cfUserEl = document.getElementById("ob-cfUsername") as HTMLInputElement | null;
    const forkEl = document.getElementById("ob-githubFork") as HTMLInputElement | null;
    const gmailEl = document.getElementById("ob-gmailAccount") as HTMLInputElement | null;
    if (authorEl) patch.authorName = authorEl.value.trim();
    if (cfUserEl) patch.cfUsername = cfUserEl.value.trim();
    if (forkEl) patch.githubFork = forkEl.value.trim();
    if (gmailEl) patch.gmailAccount = gmailEl.value.trim();
  } else if (step === 2) {
    const backendEl = document.getElementById("ob-defaultBackend") as HTMLSelectElement | null;
    const claudeDirEl = document.getElementById("ob-claudeConfigDir") as HTMLInputElement | null;
    if (backendEl) patch.defaultBackend = backendEl.value as AppSettings["defaultBackend"];
    if (claudeDirEl) patch.claudeConfigDir = claudeDirEl.value.trim();
  } else if (step === 3) {
    const pgroastEl = document.getElementById("ob-pgroastRepo") as HTMLInputElement | null;
    const pgEl = document.getElementById("ob-postgresRepo") as HTMLInputElement | null;
    const skillsEl = document.getElementById("ob-skillsRepo") as HTMLInputElement | null;
    if (pgroastEl) patch.pgroastRepo = pgroastEl.value.trim();
    if (pgEl) patch.postgresRepo = pgEl.value.trim();
    patch.skillsRepo = state.onboardingSkillsMode === "custom" ? (skillsEl?.value.trim() || "") : "";
  }

  if (Object.keys(patch).length > 0) {
    const res = await api<{ settings: AppSettings; cfAuth: CfAuthStatus }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    state.settings = res.settings;
    state.cfAuth = res.cfAuth;
  }
}

function renderOnboarding(): void {
  const stepper = document.getElementById("ob-stepper");
  const body = document.getElementById("ob-body");
  const footer = document.getElementById("ob-footer");
  if (!stepper || !body || !footer) return;

  const s = state.settings;
  const ai = state.aiSummary;
  const auth = state.cfAuth;
  const step = state.onboardingStep;

  const steps = [
    { n: 1, label: "1. Your Profile" },
    { n: 2, label: "2. AI CLI (1 needed)" },
    { n: 3, label: "3. Skills & Repos" },
    { n: 4, label: "4. PG Login & Optional Tools" },
  ];

  stepper.innerHTML = steps
    .map(
      (st) => `
      <button type="button" class="ob-step-pill ${st.n === step ? "active" : st.n < step ? "done" : ""}" data-ob-goto="${st.n}">
        ${st.n < step ? "✓" : ""} ${esc(st.label)}
      </button>
    `,
    )
    .join("");

  if (step === 1) {
    body.innerHTML = `
      <p style="margin-top:0;">
        Welcome to <strong>pgroast-app</strong> — your local PostgreSQL CommitFest &amp; <code>-hackers</code> workbench.
        Everything stays on <code>127.0.0.1</code> in your local PostgreSQL DB. All profile fields below are optional.
      </p>
      <div class="ob-card">
        <div class="inline-row" style="justify-content:space-between;">
          <strong>Quick Sign-In (records who ran each model opinion)</strong>
          <span class="pill ${state.identity?.signedIn ? "pill-ok" : "pill-neutral"}">
            ${state.identity?.signedIn ? `${esc(state.identity.name)} (${esc(state.identity.provider)})` : "Optional"}
          </span>
        </div>
        <div class="muted" style="font-size:11.5px;margin:4px 0 8px;">Auto-fills your name &amp; handle from your local <code>gh</code> (GitHub) or <code>gws</code> (Google) CLI login.</div>
        <div class="inline-row">
          <button type="button" class="btn btn-primary btn-sm" id="ob-auth-github-btn">Sign in with GitHub (gh)</button>
          <button type="button" class="btn btn-secondary btn-sm" id="ob-auth-google-btn">Sign in with Google (gws)</button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>Your Name (optional — used for email sign-offs)</label>
          <input type="text" id="ob-authorName" value="${esc(s?.authorName || "")}" placeholder="e.g. Jane Doe" />
        </div>
        <div class="form-field">
          <label>PostgreSQL Community / CommitFest Username (optional)</label>
          <input type="text" id="ob-cfUsername" value="${esc(s?.cfUsername || "")}" placeholder="e.g. jdoe" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>Your GitHub Postgres Fork (optional)</label>
          <input type="text" id="ob-githubFork" value="${esc(s?.githubFork || "")}" placeholder="e.g. your-handle/postgres" />
        </div>
        <div class="form-field">
          <label>Your Gmail Account for Drafts via gws (optional)</label>
          <input type="text" id="ob-gmailAccount" value="${esc(s?.gmailAccount || "")}" placeholder="e.g. you@example.com" />
        </div>
      </div>
      <div class="ob-card muted" style="font-size:12px;">
        <strong>Safe by default:</strong> Read-only CommitFest browsing works with zero accounts.
        Nothing is ever auto-sent to mailing lists or pushed to GitHub without your explicit confirmation.
      </div>
    `;
  } else if (step === 2) {
    const avail = ai?.available || [];
    const hasOne = avail.length >= 1;
    const cliMeta: Array<{ id: "claude" | "codex" | "agy"; title: string; desc: string; cmd: string; url?: string }> = [
      {
        id: "claude",
        title: "Claude Code CLI (claude)",
        desc: "Uses your Claude subscription via `claude /login` (no API key needed).",
        cmd: "npm install -g @anthropic-ai/claude-code && claude",
        url: "https://docs.anthropic.com/en/docs/claude-code/overview",
      },
      {
        id: "codex",
        title: "OpenAI Codex CLI (codex)",
        desc: "Uses your Codex/ChatGPT subscription via `codex login`.",
        cmd: "npm install -g @openai/codex && codex login",
        url: "https://github.com/openai/codex",
      },
      {
        id: "agy",
        title: "Antigravity CLI (agy)",
        desc: "Uses your Antigravity subscription. Pair with Claude for optional cross-family Dual mode.",
        cmd: "agy --version",
      },
    ];

    body.innerHTML = `
      <div class="ob-card" style="border-color:${hasOne ? "var(--ok)" : "var(--warn)"};">
        <div class="inline-row" style="justify-content:space-between;">
          <strong>${hasOne ? `✅ Ready — ${avail.length} AI CLI detected (${esc(avail.join(", "))})` : "Install any 1 AI CLI to run roasts & AI reviews"}</strong>
          <button type="button" class="btn btn-secondary btn-sm" id="ob-recheck-ai-btn">Re-check CLIs</button>
        </div>
        <div class="muted" style="font-size:12px;margin-top:4px;">
          Most users only need <strong>one</strong> AI CLI. Cross-family Dual mode is optional and unlocks automatically if you have both <code>claude</code> and <code>agy</code>.
        </div>
      </div>

      ${cliMeta
        .map((c) => {
          const found = avail.includes(c.id);
          return `
        <div class="ob-card">
          <div class="inline-row" style="justify-content:space-between;">
            <strong>${esc(c.title)}</strong>
            <span class="pill ${found ? "pill-ok" : "pill-neutral"}">${found ? "INSTALLED" : "OPTIONAL"}</span>
          </div>
          <div class="muted" style="font-size:11.5px;margin-top:3px;">${esc(c.desc)}</div>
          ${
            !found
              ? `
            ${renderCmdSnippet(c.cmd)}
            ${c.url ? `<div style="margin-top:6px;"><a href="${esc(c.url)}" target="_blank" rel="noopener">Open setup docs ↗</a></div>` : ""}
          `
              : ""
          }
        </div>
      `;
        })
        .join("")}

      <div class="form-grid">
        <div class="form-field">
          <label>Default AI Backend</label>
          <select id="ob-defaultBackend">
            <option value="auto" ${(s?.defaultBackend || "auto") === "auto" ? "selected" : ""}>Auto (recommended — uses first installed CLI)</option>
            <option value="claude" ${s?.defaultBackend === "claude" ? "selected" : ""}>claude (single AI)</option>
            <option value="codex" ${s?.defaultBackend === "codex" ? "selected" : ""}>codex (single AI)</option>
            <option value="agy" ${s?.defaultBackend === "agy" ? "selected" : ""}>agy (single AI)</option>
            <option value="dual" ${s?.defaultBackend === "dual" ? "selected" : ""}>dual (Claude + agy cross-family${ai?.dualReady ? "" : " — needs both"})</option>
          </select>
        </div>
        <div class="form-field">
          <label>Claude Config Dir (if using Claude)</label>
          <input type="text" id="ob-claudeConfigDir" value="${esc(s?.claudeConfigDir || "~/.claude")}" placeholder="~/.claude" />
        </div>
      </div>
    `;
  } else if (step === 3) {
    const isCustom = state.onboardingSkillsMode === "custom";
    body.innerHTML = `
      <div class="section-label" style="margin-top:0;">Skills (Email Etiquette, Patch Verification &amp; Bug Triage)</div>
      <label class="ob-radio-card ${!isCustom ? "selected" : ""}" data-ob-skills-mode="builtin">
        <input type="radio" name="ob-skills-mode" value="builtin" ${!isCustom ? "checked" : ""} />
        <div>
          <strong>Built-in Basic Skills (Default — Ready out of the box)</strong>
          <div class="muted" style="font-size:11.5px;margin-top:2px;">
            Ships simple, practical defaults: plain-text <code>-hackers</code> etiquette (72-col wrap, bottom-posting, <code>nocfbot-</code> safety), isolated worktree patch verification, and <code>pgsql-bugs</code> triage. Zero config needed.
          </div>
        </div>
      </label>

      <label class="ob-radio-card ${isCustom ? "selected" : ""}" data-ob-skills-mode="custom">
        <input type="radio" name="ob-skills-mode" value="custom" ${isCustom ? "checked" : ""} />
        <div style="flex:1;">
          <strong>Custom Skills Folder (Optional — Bring your own private skills)</strong>
          <div class="muted" style="font-size:11.5px;margin-top:2px;">
            Point to your own local folder containing <code>*.md</code> or <code>&lt;name&gt;/SKILL.md</code> files to override or extend the defaults with your personal voice and workflows.
          </div>
          ${
            isCustom
              ? `<div style="margin-top:8px;"><input type="text" id="ob-skillsRepo" style="width:100%;" value="${esc(s?.skillsRepo || "")}" placeholder="~/my-pg-skills" /></div>`
              : ""
          }
        </div>
      </label>

      <div class="section-label">Local Repositories (Optional)</div>
      <div class="form-field">
        <label>pgroast v2 CLI Folder (needed to launch new roasts)</label>
        <input type="text" id="ob-pgroastRepo" value="${esc(s?.pgroastRepo || "")}" placeholder="../pgroast or ~/pgroast" />
      </div>
      <div class="form-field">
        <label>Local PostgreSQL Git Clone (optional — enables worktree builds &amp; git-log expert routing)</label>
        <input type="text" id="ob-postgresRepo" value="${esc(s?.postgresRepo || "")}" placeholder="~/postgres" />
        ${renderCmdSnippet("git clone https://git.postgresql.org/git/postgresql.git ~/postgres")}
      </div>
    `;
  } else {
    body.innerHTML = `
      <div class="ob-card">
        <div class="inline-row" style="justify-content:space-between;">
          <strong>1. PostgreSQL Community / CommitFest Login (Optional)</strong>
          <span class="pill ${auth?.hasSessionCookie ? "pill-ok" : "pill-neutral"}">
            ${auth?.verifiedUser ? `Verified: ${esc(auth.verifiedUser)}` : auth?.hasSessionCookie ? "Cookie Stored" : "Read-only works without it"}
          </span>
        </div>
        <ol style="margin:6px 0 8px 18px;padding:0;font-size:12px;color:var(--text-muted);">
          <li>Click <a href="https://commitfest.postgresql.org/account/login/" target="_blank" rel="noopener"><strong>Open CommitFest Login ↗</strong></a> and sign in with your PostgreSQL Community Account.</li>
          <li>In that browser tab, open DevTools (<kbd>⌘⌥I</kbd> / <kbd>F12</kbd>) → <strong>Application</strong> → <strong>Cookies</strong> → <code>https://commitfest.postgresql.org</code>.</li>
          <li>Copy <code>sessionid</code> and <code>csrftoken</code> below and click <strong>Save &amp; Verify</strong> (encrypted locally with AES-256-GCM).</li>
        </ol>
        <div class="form-grid">
          <div class="form-field"><label>sessionid</label><input type="password" id="ob-cf-sid" placeholder="Paste sessionid value" /></div>
          <div class="form-field"><label>csrftoken</label><input type="password" id="ob-cf-csrf" placeholder="Paste csrftoken value" /></div>
        </div>
        <div class="inline-row">
          <a class="btn btn-secondary btn-sm" href="https://commitfest.postgresql.org/account/login/" target="_blank" rel="noopener">Open CommitFest Login ↗</a>
          <button type="button" class="btn btn-ok btn-sm" id="ob-cf-save-verify-btn">Save &amp; Verify Login (/me/)</button>
        </div>
      </div>

      <div class="ob-card">
        <strong>2. Gmail Drafts via <code>gws</code> CLI (Optional — Never auto-sends)</strong>
        <div class="muted" style="font-size:11.5px;margin-top:3px;">Lets Reply Studio find exact mailing-list threads and save unsent drafts to your Gmail.</div>
        ${renderCmdSnippet("brew install googleworkspace-cli && gws auth login --scopes gmail.modify")}
      </div>

      <div class="ob-card">
        <strong>3. GitHub Fork Sync via <code>gh</code> CLI (Optional)</strong>
        <div class="muted" style="font-size:11.5px;margin-top:3px;">Sync sanitized issues and CI branches to your own PostgreSQL fork.</div>
        ${renderCmdSnippet("brew install gh && gh auth login")}
        <div style="margin-top:6px;"><a href="https://github.com/postgres/postgres/fork" target="_blank" rel="noopener">Fork postgres/postgres on GitHub ↗</a></div>
      </div>
    `;
  }

  footer.innerHTML = `
    <div style="margin-right:auto;">
      <button type="button" class="btn btn-ghost btn-sm" id="ob-skip-btn">Skip for now</button>
    </div>
    ${step > 1 ? `<button type="button" class="btn btn-secondary" id="ob-prev-btn">← Back</button>` : ""}
    ${
      step < 4
        ? `<button type="button" class="btn btn-primary" id="ob-next-btn">Save &amp; Next →</button>`
        : `<button type="button" class="btn btn-ok" id="ob-finish-btn">Finish Setup</button>`
    }
  `;

  // Bind onboarding events
  document.getElementById("ob-auth-github-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ identity: ContributorIdentity; settings: AppSettings }>("/api/auth/github/connect", { method: "POST" });
      state.identity = res.identity;
      state.settings = res.settings;
      updateSidebarIdentity();
      toast(`Signed in via GitHub as ${res.identity.name} (@${res.identity.handle})`, "ok");
      renderOnboarding();
    } catch (err) {
      toastError(err, "GitHub Sign-In failed");
    }
  });
  document.getElementById("ob-auth-google-btn")?.addEventListener("click", async () => {
    try {
      const res = await api<{ identity: ContributorIdentity; settings: AppSettings }>("/api/auth/google/connect", { method: "POST" });
      state.identity = res.identity;
      state.settings = res.settings;
      updateSidebarIdentity();
      toast(`Signed in via Google as ${res.identity.handle}`, "ok");
      renderOnboarding();
    } catch (err) {
      toastError(err, "Google Sign-In failed");
    }
  });
  stepper.querySelectorAll<HTMLButtonElement>("[data-ob-goto]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await saveOnboardingStepFields();
      state.onboardingStep = Number(btn.dataset.obGoto || 1);
      renderOnboarding();
    });
  });

  body.querySelectorAll<HTMLElement>("[data-ob-skills-mode]").forEach((el) => {
    el.addEventListener("click", () => {
      const m = el.dataset.obSkillsMode as "builtin" | "custom";
      if (m && m !== state.onboardingSkillsMode) {
        state.onboardingSkillsMode = m;
        renderOnboarding();
      }
    });
  });

  document.getElementById("ob-recheck-ai-btn")?.addEventListener("click", async () => {
    const dRes = await api<{ checks: DoctorCheckItem[]; aiSummary?: AppState["aiSummary"] }>("/api/doctor");
    state.doctorChecks = dRes.checks;
    if (dRes.aiSummary) state.aiSummary = dRes.aiSummary;
    toast(`Detected AI CLIs: ${state.aiSummary?.available.join(", ") || "none"}`, "info");
    renderOnboarding();
  });

  document.getElementById("ob-cf-save-verify-btn")?.addEventListener("click", async () => {
    const sessionid = (document.getElementById("ob-cf-sid") as HTMLInputElement | null)?.value.trim() || "";
    const csrftoken = (document.getElementById("ob-cf-csrf") as HTMLInputElement | null)?.value.trim() || "";
    try {
      if (sessionid || csrftoken) {
        await api("/api/cf/auth/cookies", {
          method: "POST",
          body: JSON.stringify({ sessionid, csrftoken }),
        });
      }
      const res = await api<{ authenticated: boolean; username: string | null; syncedMine: number; cfAuth: CfAuthStatus }>(
        "/api/cf/auth/verify",
        { method: "POST" },
      );
      state.cfAuth = res.cfAuth;
      if (res.authenticated) {
        toast(`Verified CommitFest login as ${res.username} (${res.syncedMine} /me/ patches synced)`, "ok");
      } else {
        toast("Not authenticated — double-check sessionid from commitfest.postgresql.org cookies", "warn");
      }
      await loadHealth();
      renderOnboarding();
    } catch (err) {
      toastError(err);
    }
  });

  document.getElementById("ob-prev-btn")?.addEventListener("click", async () => {
    await saveOnboardingStepFields();
    state.onboardingStep = Math.max(1, state.onboardingStep - 1);
    renderOnboarding();
  });

  document.getElementById("ob-next-btn")?.addEventListener("click", async () => {
    await saveOnboardingStepFields();
    state.onboardingStep = Math.min(4, state.onboardingStep + 1);
    renderOnboarding();
  });

  const completeOnboarding = async () => {
    await saveOnboardingStepFields();
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ onboardingCompleted: true }) });
    closeOnboarding();
    await Promise.all([loadHealth(), loadSettingsAndDoctor()]);
    toast("Setup saved — reopen anytime via Setup in the sidebar", "ok");
  };

  document.getElementById("ob-finish-btn")?.addEventListener("click", () => void completeOnboarding());
  document.getElementById("ob-skip-btn")?.addEventListener("click", () => void completeOnboarding());
}

// ---------------- Global Boot & Keyboard Shortcuts ----------------

function confirmCancelJob(jobId: string): void {
  const job = state.consoles[jobId]?.job || state.jobs.find((j) => j.id === jobId);
  const title = job?.title || jobId;
  const started = job?.started_at ? `Started at ${job.started_at.slice(11, 19)} UTC` : "";
  showConfirmModal({
    title: "Confirm Cancel Running Job",
    danger: true,
    bodyHtml: `
      <p style="margin-top:0;">Stop this running background job? Any unsaved progress in this run will be lost.</p>
      <div class="ob-card" style="font-size:12px;">
        <div><strong>${esc(title)}</strong></div>
        <div class="muted mono" style="font-size:11px;margin-top:3px;">${esc(jobId)}${started ? ` · ${esc(started)}` : ""}</div>
      </div>
    `,
    confirmLabel: "Yes, Cancel Job",
    onConfirm: async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      toast(`Cancel signal sent to ${jobId}`, "warn");
      await refreshJobsList();
    },
  });
}

function initGlobalControls(): void {
  document.getElementById("brand-home-btn")?.addEventListener("click", () => {
    void switchView("shortlist");
    const main = document.getElementById("main-content");
    if (main) main.scrollTop = 0;
  });

  // Space Switcher (Personal Backoffice <-> Public App)
  const localSpaceBtn = document.getElementById("local-space-btn");
  const localSpaceMenu = document.getElementById("local-space-menu");
  localSpaceBtn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!localSpaceMenu) return;
    updateLocalSpaceSwitcher();
    const open = localSpaceMenu.hidden;
    localSpaceMenu.hidden = !open;
    localSpaceBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (ev) => {
    if (!localSpaceMenu || localSpaceMenu.hidden) return;
    if (!localSpaceMenu.contains(ev.target as Node) && ev.target !== localSpaceBtn) {
      localSpaceMenu.hidden = true;
      localSpaceBtn?.setAttribute("aria-expanded", "false");
    }
  });
  document.getElementById("open-onboarding-btn")?.addEventListener("click", () => void openOnboarding(1));
  document.getElementById("ob-close-x")?.addEventListener("click", () => closeOnboarding());

  // Global copy-to-clipboard handler for all setup command snippets
  document.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement)?.closest<HTMLButtonElement>("[data-copy-text]");
    if (!btn?.dataset.copyText) return;
    const text = btn.dataset.copyText;
    void navigator.clipboard?.writeText(text).then(
      () => {
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = orig || "Copy";
        }, 1400);
      },
      () => toast("Could not copy to clipboard", "warn"),
    );
  });

  document.querySelectorAll<HTMLButtonElement>(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.view as ViewId;
      if (v) void switchView(v);
    });
  });

  const THEMES: Array<{ id: string; label: string; swatch: string }> = [
    { id: "dark", label: "Midnight", swatch: "#0c0d0f" },
    { id: "light", label: "Daylight", swatch: "#ffffff" },
    { id: "paper", label: "Warm Paper", swatch: "#f7f3ea" },
    { id: "espresso", label: "Espresso", swatch: "#c97842" },
    { id: "nord", label: "Nord", swatch: "#2e3440" },
    { id: "tokyo", label: "Tokyo Night", swatch: "#1a1b26" },
    { id: "postgres", label: "Postgres Classic", swatch: "#336791" },
    { id: "contrast", label: "High Contrast", swatch: "#000000" },
  ];

  const validThemeIds = new Set(THEMES.map((t) => t.id));
  const applyTheme = (themeId: string) => {
    const id = validThemeIds.has(themeId) ? themeId : "dark";
    document.documentElement.setAttribute("data-theme", id);
    localStorage.setItem("pgroast-theme", id);
    const menu = document.getElementById("theme-menu");
    if (menu) {
      menu.innerHTML = THEMES.map(
        (t) => `
          <button type="button" class="theme-opt ${t.id === id ? "active" : ""}" data-pick-theme="${t.id}">
            <span class="theme-swatch" style="background:${t.swatch};"></span>
            <span>${esc(t.label)}</span>
          </button>
        `,
      ).join("");
    }
  };

  applyTheme(localStorage.getItem("pgroast-theme") || "dark");

  document.getElementById("toggle-theme-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const menu = document.getElementById("theme-menu");
    if (menu) menu.hidden = !menu.hidden;
  });

  document.getElementById("theme-menu")?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-pick-theme]");
    if (!btn?.dataset.pickTheme) return;
    applyTheme(btn.dataset.pickTheme);
    const menu = document.getElementById("theme-menu");
    if (menu) menu.hidden = true;
  });

  document.addEventListener("click", (ev) => {
    const menu = document.getElementById("theme-menu");
    if (!menu || menu.hidden) return;
    if (!(ev.target as HTMLElement).closest(".theme-picker-wrap")) {
      menu.hidden = true;
    }
  });

  const savedHeight = Number(localStorage.getItem("pgroast-drawer-height"));
  if (Number.isFinite(savedHeight) && savedHeight >= 120 && savedHeight <= 900) {
    state.drawerHeight = savedHeight;
  }

  document.getElementById("toggle-drawer-btn")?.addEventListener("click", () => {
    const d = document.getElementById("log-drawer")!;
    if (d.hidden) {
      // Hydrate recent jobs as tabs if nothing is open yet
      if (state.openConsoleIds.length === 0 && state.jobs.length > 0) {
        const recent = state.jobs.slice(0, 5).reverse();
        for (const j of recent) ensureJobStream(j);
        state.activeConsoleId = recent[recent.length - 1]?.id ?? null;
      }
      d.hidden = false;
      if (state.drawerMode === "minimized") state.drawerMode = "normal";
      renderDrawer(true);
    } else if (state.drawerMode === "minimized") {
      state.drawerMode = "normal";
      renderDrawer(true);
    } else {
      d.hidden = true;
    }
  });

  document.getElementById("drawer-minimize-btn")?.addEventListener("click", () => {
    state.drawerMode = state.drawerMode === "minimized" ? "normal" : "minimized";
    renderDrawer(false);
  });

  document.getElementById("drawer-maximize-btn")?.addEventListener("click", () => {
    state.drawerMode = state.drawerMode === "maximized" ? "normal" : "maximized";
    renderDrawer(false);
  });

  document.getElementById("drawer-close-btn")?.addEventListener("click", () => {
    document.getElementById("log-drawer")!.hidden = true;
  });

  document.getElementById("drawer-clear-done-btn")?.addEventListener("click", () => {
    closeFinishedConsoleTabs();
  });

  document.getElementById("drawer-cancel-btn")?.addEventListener("click", () => {
    if (!state.activeConsoleId) return;
    confirmCancelJob(state.activeConsoleId);
  });

  // Tab click & close delegation
  document.getElementById("drawer-tabs")?.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const closeBtn = target.closest<HTMLElement>("[data-console-close]");
    if (closeBtn?.dataset.consoleClose) {
      ev.stopPropagation();
      closeConsoleTab(closeBtn.dataset.consoleClose);
      return;
    }
    const tab = target.closest<HTMLElement>("[data-console-tab]");
    if (tab?.dataset.consoleTab) {
      selectConsoleTab(tab.dataset.consoleTab);
    }
  });

  // Drag-to-resize handle on top edge of console drawer
  const resizeHandle = document.getElementById("drawer-resize-handle");
  if (resizeHandle) {
    resizeHandle.addEventListener("dblclick", () => {
      state.drawerMode = "normal";
      state.drawerHeight = 260;
      localStorage.setItem("pgroast-drawer-height", String(state.drawerHeight));
      applyDrawerLayout();
    });

    resizeHandle.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const drawer = document.getElementById("log-drawer");
      if (!drawer) return;
      const startY = ev.clientY;
      const startHeight = drawer.getBoundingClientRect().height;
      state.drawerMode = "normal";
      drawer.classList.add("resizing");

      const onMove = (moveEv: MouseEvent) => {
        const delta = startY - moveEv.clientY;
        const maxH = Math.max(220, Math.floor(window.innerHeight * 0.82));
        const nextH = Math.max(120, Math.min(maxH, Math.round(startHeight + delta)));
        state.drawerHeight = nextH;
        drawer.style.height = `${nextH}px`;
      };

      const onUp = () => {
        drawer.classList.remove("resizing");
        localStorage.setItem("pgroast-drawer-height", String(state.drawerHeight));
        applyDrawerLayout();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  const searchInput = document.getElementById("quick-cf-input") as HTMLInputElement | null;
  const searchMenu = document.getElementById("global-search-menu");
  let gsTimer: ReturnType<typeof setTimeout> | null = null;

  const closeGlobalSearchMenu = () => {
    if (searchMenu) searchMenu.hidden = true;
  };

  const runLiveGlobalSearch = async (rawQ: string) => {
    if (!searchMenu) return;
    const q = rawQ.trim();
    if (q.length < 2) {
      closeGlobalSearchMenu();
      return;
    }
    try {
      const res = await api<{
        entries: Array<{ cf_id: number; title: string; authors: string; reviewers: string; committer: string; status: string; verdict: string }>;
        workItems: Array<{ id: number; cf_id: number | null; title: string; status: string }>;
        bugs: Array<{ id: number; subject: string; sender: string; classification: string; severity: string; work_item_id: number | null }>;
      }>(`/api/search?q=${encodeURIComponent(q)}`);

      const total = res.entries.length + res.workItems.length + res.bugs.length;
      if (total === 0) {
        searchMenu.innerHTML = `
          <div style="padding:10px 8px;" class="muted">No direct matches for "<strong>${esc(q)}</strong>".</div>
          <div class="gs-footer">
            <span class="dim" style="font-size:11px;">Tip: try a name (Andrey, Nikolay), topic (vacuum), or CF #</span>
            <button type="button" class="btn btn-secondary btn-sm" data-gs-explorer="${esc(q)}">Search in Explorer →</button>
          </div>
        `;
      } else {
        const entriesHtml = res.entries.length
          ? `<div class="gs-section-title">CommitFest Entries (${res.entries.length})</div>` +
            res.entries
              .map(
                (e) => `
              <button type="button" class="gs-item" data-gs-cf="${e.cf_id}">
                <div style="min-width:0;flex:1;">
                  <div class="gs-item-title"><span class="mono">CF ${e.cf_id}</span> · ${esc(e.title)}</div>
                  <div class="gs-item-sub">${esc(e.authors || "—")}${e.reviewers ? ` · Rev: ${esc(e.reviewers)}` : ""}${e.committer ? ` · Com: ${esc(e.committer)}` : ""}</div>
                </div>
                ${verdictPill(e.verdict)}
              </button>
            `,
              )
              .join("")
          : "";

        const wiHtml = res.workItems.length
          ? `<div class="gs-section-title">Work Items (${res.workItems.length})</div>` +
            res.workItems
              .map(
                (w) => `
              <button type="button" class="gs-item" data-gs-wi="${w.id}">
                <div style="min-width:0;flex:1;">
                  <div class="gs-item-title"><span class="mono">WI #${w.id}</span>${w.cf_id ? ` (CF ${w.cf_id})` : ""} · ${esc(w.title)}</div>
                </div>
                <span class="pill pill-info">${esc(w.status)}</span>
              </button>
            `,
              )
              .join("")
          : "";

        const bugsHtml = res.bugs.length
          ? `<div class="gs-section-title">pgsql-bugs (${res.bugs.length})</div>` +
            res.bugs
              .map(
                (b) => `
              <button type="button" class="gs-item" data-gs-bug-wi="${b.work_item_id || ""}">
                <div style="min-width:0;flex:1;">
                  <div class="gs-item-title">${esc(b.subject)}</div>
                  <div class="gs-item-sub">${esc(b.sender || "—")} · ${esc(b.severity)}</div>
                </div>
                <span class="pill ${b.classification === "production_hit" ? "pill-danger" : "pill-neutral"}">${b.classification === "production_hit" ? "prod hit" : esc(b.classification)}</span>
              </button>
            `,
              )
              .join("")
          : "";

        searchMenu.innerHTML = `
          ${entriesHtml}
          ${wiHtml}
          ${bugsHtml}
          <div class="gs-footer">
            <span class="dim" style="font-size:11px;">Showing top matches</span>
            <button type="button" class="btn btn-primary btn-sm" data-gs-explorer="${esc(q)}">View all "${esc(q)}" in Explorer →</button>
          </div>
        `;
      }
      searchMenu.hidden = false;
    } catch {
      // ignore transient typing errors
    }
  };

  searchMenu?.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const cfBtn = target.closest<HTMLElement>("[data-gs-cf]");
    if (cfBtn?.dataset.gsCf) {
      closeGlobalSearchMenu();
      if (searchInput) searchInput.value = "";
      void openEntry(Number(cfBtn.dataset.gsCf));
      return;
    }
    const wiBtn = target.closest<HTMLElement>("[data-gs-wi]");
    if (wiBtn?.dataset.gsWi) {
      closeGlobalSearchMenu();
      if (searchInput) searchInput.value = "";
      void openWorkItem(Number(wiBtn.dataset.gsWi));
      return;
    }
    const bugBtn = target.closest<HTMLElement>("[data-gs-bug-wi]");
    if (bugBtn) {
      closeGlobalSearchMenu();
      if (searchInput) searchInput.value = "";
      const wiId = Number(bugBtn.dataset.gsBugWi || 0);
      if (wiId > 0) void openWorkItem(wiId);
      else void switchView("bugs");
      return;
    }
    const expBtn = target.closest<HTMLElement>("[data-gs-explorer]");
    if (expBtn?.dataset.gsExplorer) {
      const q = expBtn.dataset.gsExplorer;
      closeGlobalSearchMenu();
      state.explorerSearch = q;
      state.explorerVerdict = "all";
      state.explorerStatus = "all";
      state.explorerMine = false;
      state.explorerStarred = false;
      void switchView("explorer");
    }
  });

  const submitGlobalSearch = () => {
    if (!searchInput) return;
    const raw = searchInput.value.trim();
    if (!raw) return;
    closeGlobalSearchMenu();
    const pureCf = raw.match(/^(?:cf\s*#?\s*)?(\d+)$/i);
    if (pureCf?.[1]) {
      searchInput.value = "";
      void openEntry(Number(pureCf[1]));
      return;
    }
    state.explorerSearch = raw;
    state.explorerVerdict = "all";
    state.explorerStatus = "all";
    state.explorerMine = false;
    state.explorerStarred = false;
    void switchView("explorer");
  };

  document.getElementById("quick-cf-btn")?.addEventListener("click", submitGlobalSearch);
  searchInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      submitGlobalSearch();
    } else if (ev.key === "Escape") {
      closeGlobalSearchMenu();
    }
  });
  searchInput?.addEventListener("input", () => {
    if (gsTimer) clearTimeout(gsTimer);
    gsTimer = setTimeout(() => void runLiveGlobalSearch(searchInput.value), 180);
  });
  document.addEventListener("click", (ev) => {
    if (!searchMenu || searchMenu.hidden) return;
    if (!(ev.target as HTMLElement).closest("#global-search-wrap")) {
      closeGlobalSearchMenu();
    }
  });

  // 1-click "My Work" button
  document.getElementById("global-my-work-btn")?.addEventListener("click", () => {
    const hasIdentity = Boolean(
      state.identity?.signedIn || state.settings?.authorName || state.settings?.cfUsername || state.cfAuth?.verifiedUser,
    );
    state.explorerSearch = "";
    state.explorerVerdict = "all";
    state.explorerStatus = "all";
    state.explorerStarred = false;
    state.explorerMine = true;
    if (!hasIdentity) {
      toast("Tip: Sign in with GitHub/Google or set Your Name / CF Username in Settings to match all your patches.", "info", {
        actionLabel: "Open Settings",
        onAction: () => void switchView("settings"),
      });
    }
    void switchView("explorer");
  });

  // Sidebar identity card -> open Settings
  document.getElementById("sidebar-identity-card")?.addEventListener("click", () => {
    void switchView("settings");
  });

  // "?" Guide modal explaining all views & features
  const openGuideModal = () => {
    const backdrop = document.getElementById("modal-backdrop")!;
    const titleEl = document.getElementById("modal-title")!;
    const bodyEl = document.getElementById("modal-body")!;
    const footerEl = document.getElementById("modal-footer")!;

    titleEl.textContent = "How pgroast-app Works — Quick Guide";
    bodyEl.innerHTML = `
      <p class="muted" style="margin-top:0;font-size:12px;">
        <strong>pgroast-app</strong> is a local-only (<code>127.0.0.1</code>) PostgreSQL CommitFest &amp; <code>-hackers</code> triage workbench. Nothing is sent to mailing lists or pushed to GitHub without your explicit confirmation.
      </p>
      <div class="guide-grid">
        <div class="guide-card">
          <h4>★ Shortlist &amp; Triage <kbd>1</kbd></h4>
          <p>Ranks open CommitFest entries into <strong>Worth Committer Attention</strong> (split into Bug fixes, Features, Seen in production, and My Topics) and <strong>Worth Closing / Rethinking</strong>. Export a frozen static HTML snapshot to share with reviewers.</p>
        </div>
        <div class="guide-card">
          <h4>◔ Stats &amp; Insights <kbd>2</kbd></h4>
          <p>CommitFest coverage, clickable <strong>CF Status × Roast Verdict</strong> matrix, novelty signals, and reviewer load. Click any bar or matrix cell to filter Explorer.</p>
        </div>
        <div class="guide-card">
          <h4>▤ Explorer, Global Search &amp; My Work <kbd>3</kbd></h4>
          <p>Use the top search bar (<kbd>⌘K</kbd>) to search people (e.g. <code>Andrey</code>, <code>Nikolay</code>), topics, Work Items, or jump directly to a CF #. Click <strong>My Work</strong> for your patches. Supports structured queries like <code>author:andrey verdict:ready has:workarounds</code>.</p>
        </div>
        <div class="guide-card">
          <h4>⚡ Entry Workbench &amp; Light Roast <kbd>4</kbd></h4>
          <p>Inspect fast-scan objections, <strong>PG Light Roast</strong> (friendly author pre-flight checklist), isolated worktree Build &amp; Test, and <strong>Reply Studio</strong> (threaded Gmail drafts with 4 safety gates — never auto-sends).</p>
        </div>
        <div class="guide-card">
          <h4>👥 Model Opinions &amp; GitHub/Google Sign-In</h4>
          <p>Sign in via GitHub (<code>gh</code>) or Google (<code>gws</code>) in Settings so every roast run records <strong>who</strong> ran which model. Use <strong>Record / Import</strong> and <strong>Export JSON</strong> in Model Opinions to compare opinions across teammates (e.g. Nikolay, Kirk, Andrey).</p>
        </div>
        <div class="guide-card">
          <h4>◻ Local Work Items <kbd>6</kbd></h4>
          <p>Private local workspaces in local PostgreSQL (<code>pgroast_app</code>) storing repro notes, worktrees, status, and optional sanitized GitHub fork issues — cleanly decoupled from Jobs &amp; Logs (<kbd>7</kbd>).</p>
        </div>
        <div class="guide-card">
          <h4>⚑ pgsql-bugs Triage <kbd>5</kbd></h4>
          <p>Scans recent <code>pgsql-bugs</code> threads and ranks real <strong>Seen in production</strong> reports above synthetic AI bug-hunt noise. Create a local Work Item from any bug with 1 click.</p>
        </div>
        <div class="guide-card">
          <h4>⚙ Settings, Doctor &amp; Themes <kbd>8</kbd></h4>
          <p>Check CLI health (only <strong>1 AI CLI</strong> required), connect GitHub/Google or CommitFest cookies, configure custom skills or My Topics, and switch between 8 color themes in the sidebar.</p>
        </div>
      </div>
    `;
    footerEl.innerHTML = `<button class="btn btn-primary" id="guide-close-btn">Got it</button>`;
    backdrop.hidden = false;
    const close = () => {
      backdrop.hidden = true;
    };
    document.getElementById("guide-close-btn")?.addEventListener("click", close);
    document.getElementById("modal-close-x")?.addEventListener("click", close);
  };
  document.getElementById("open-guide-btn")?.addEventListener("click", openGuideModal);

  const runGlobalSync = async () => {
    try {
      toast("Syncing CommitFest PG20-3 (#62)…", "info");
      const res = await api<{ synced: number }>("/api/cf/sync", {
        method: "POST",
        body: JSON.stringify({ cfNumber: 62 }),
      });
      toast(`Synced ${res.synced} patches from CF #62`, "ok");
      await loadHealth();
      if (state.view === "explorer") await loadEntries();
      else if (state.view === "shortlist") await loadShortlist();
      else if (state.view === "stats") await loadStats();
    } catch (err) {
      toastError(err, "CommitFest Sync failed", () => void runGlobalSync());
    }
  };
  document.getElementById("global-sync-btn")?.addEventListener("click", () => void runGlobalSync());

  const runGlobalImport = async () => {
    try {
      const res = await api<{ imported: number; errors: string[] }>("/api/import/batch", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast(`Imported ${res.imported} roasts (${res.errors.length} errors)`, res.imported > 0 ? "ok" : "warn");
      await loadHealth();
      if (state.view === "shortlist") await loadShortlist();
      else if (state.view === "explorer") await loadEntries();
      else if (state.view === "stats") await loadStats();
    } catch (err) {
      toastError(err, "Batch Import failed", () => void runGlobalImport());
    }
  };
  document.getElementById("global-import-btn")?.addEventListener("click", () => void runGlobalImport());

  // Keyboard shortcuts (⌘K / Ctrl+K focuses global search, 1-7 switch view, / focuses search, Escape closes modal/drawer)
  document.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      const inp = document.getElementById("quick-cf-input") as HTMLInputElement | null;
      inp?.focus();
      inp?.select();
      return;
    }
    const tag = (ev.target as HTMLElement)?.tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (ev.key === "Escape") {
      closeGlobalSearchMenu();
      const modal = document.getElementById("modal-backdrop");
      if (modal && !modal.hidden) {
        modal.hidden = true;
        return;
      }
      const drawer = document.getElementById("log-drawer");
      if (drawer && !drawer.hidden) {
        drawer.hidden = true;
        return;
      }
    }
    if (isTyping || ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const map: Record<string, ViewId> = {
      "1": "shortlist",
      "2": "stats",
      "3": "explorer",
      "4": "workbench",
      "5": "bugs",
      "6": "work_items",
      "7": "jobs",
      "8": "settings",
    };
    if (map[ev.key]) {
      ev.preventDefault();
      void switchView(map[ev.key]!);
    } else if (ev.key === "?") {
      ev.preventDefault();
      openGuideModal();
    } else if (ev.key === "/") {
      ev.preventDefault();
      const searchEl = document.getElementById("exp-search") || document.getElementById("sl-search") || document.getElementById("quick-cf-input");
      searchEl?.focus();
    }
  });
}

async function boot(): Promise<void> {
  initGlobalControls();
  try {
    await Promise.all([loadHealth(), loadShortlist(), refreshJobsList(), loadWorkItems(), loadSavedSearches()]);
    // Safe read-only GET handoff from public companion: http://127.0.0.1:3432/?cf=5879
    const cfParam = Number(new URL(window.location.href).searchParams.get("cf") || 0);
    if (cfParam > 0) {
      void openEntry(cfParam);
    } else if (state.settings && !state.settings.onboardingCompleted) {
      void openOnboarding(1);
    }
  } catch (err) {
    toastError(err);
  }
}

void boot();
