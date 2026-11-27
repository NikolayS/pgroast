export type DocsCategory = "all" | "front-office" | "quota" | "backoffice" | "cli" | "safety";

export interface CommunityCoverageData {
  totalAll: number;
  totalOpen: number;
  baselineRoastedOpen: number;
  unroastedOpen: number;
  opinionsTotal: number;
  openWith1PlusOpinion: number;
  openWith2PlusOpinions: number;
  readyForCommitterOpen: number;
  readyForCommitterWithOpinion: number;
  activeLeases: Array<{
    cf_id: number;
    title: string;
    backend: string;
    contributor_handle: string;
    roast_flavour: string;
    roast_level: string;
    expires_at: string;
  }>;
  byBackend: Array<{ backend: string; count: number }>;
  topContributors: Array<{ handle: string; name: string; count: number; backends: string[] }>;
  recentContributions: Array<{
    cf_id: number;
    title: string;
    contributor_handle: string;
    contributor_name: string;
    backend: string;
    roast_level: string;
    roast_flavour: string;
    verdict: string;
    created_at: string;
  }>;
}

export interface QuotaPreviewResult {
  patch: {
    cf_id: number;
    title: string;
    status: string;
    topic: string;
    authors: string;
    verdict: string;
  } | null;
  suggestedFlavour: string;
  suggestedLevel: string;
  reason: string;
  leaseExpiresAt: string | null;
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

function pct(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

const ARCHETYPE_LABELS: Record<string, string> = {
  "auto-by-subsystem": "Auto by subsystem",
  default: "House Blend",
  "edge-case-hunter": "The Edge-Case Hunter",
  "spec-lawyer": "The Spec Lawyer",
  "systems-architect": "The Systems Architect",
  "perf-hawk": "The Perf Hawk",
  "storage-skeptic": "The Storage Skeptic",
  "index-specialist": "The Index Specialist",
  "production-dba": "The Production DBA",
};

interface FeatureDocItem {
  id: string;
  category: Exclude<DocsCategory, "all">;
  categoryLabel: string;
  title: string;
  summary: string;
  status: "live" | "next";
  actionLabel?: string;
  actionTab?: string;
  actionPath?: string;
  cliSnippet?: string;
}

const ALL_FEATURES: FeatureDocItem[] = [
  // Front Office
  {
    id: "brief",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "CommitFest Brief, Shortlist & Closing Candidates",
    summary: "Daily triage view of the active CommitFest. Filter shortlisted patches by bug fix, feature, or production signal, and inspect patches worth closing or rethinking. Export any brief as offline HTML, Markdown, or JSON.",
    status: "live",
    actionLabel: "Open Brief →",
    actionTab: "brief",
  },
  {
    id: "patch-mr",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "Per-Patch Collaboration Page (/patch/<cf-id>)",
    summary: "Shareable review hub for every CommitFest entry: multi-model verdict consensus bar, readable pgsql-hackers thread timeline with TL;DR and v1→vN revision chips, and live CFBot unified diff with inline matched -hackers comments and Viewed checkboxes.",
    status: "live",
    actionLabel: "Browse Entries →",
    actionTab: "entries",
  },
  {
    id: "observatory",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "PostgreSQL Hacking Observatory",
    summary: "Live analytics across 66,000+ PostgreSQL commits: velocity and review charts, 7×24 UTC hacking rhythm heatmap, subsystem bus-factor indicators, and Committers / Authors / Reviewers / Bug Hunters / Rising Stars leaderboards across selectable time windows (30d, 90d, 1y, PG20, PG19, PG18, 5y, All-time).",
    status: "live",
    actionLabel: "Open Hackers →",
    actionTab: "hackers",
  },
  {
    id: "hacker-profiles",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "Unified Multi-Email Hacker Profiles (/hacker/<slug>)",
    summary: "Personal contributor pages that merge multiple email addresses, .mailmap aliases, diacritics, and recognized postgresql.org roles into one identity. Shows 52-week heatmap, career trajectory, subsystem DNA, UTC rhythm, longest streak, collaboration network, and recent commits/reviews without ever exposing raw email addresses.",
    status: "live",
    actionLabel: "Explore Profiles →",
    actionTab: "hackers",
  },
  {
    id: "cf-stats",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "CommitFest Stats, Status × Verdict Heatmap & Traffic",
    summary: "Click any verdict slice, subsystem bar, status × verdict cell, or contributor row to drill straight into matching patches. Includes a zero-cookie, bot-filtered PostgreSQL page-view counter and top referrers.",
    status: "live",
    actionLabel: "Open Stats →",
    actionTab: "stats",
  },
  {
    id: "opinions-team",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "Multi-Model Opinions & Team Coordination",
    summary: "Compare attributed AI opinions across Claude, Codex, and Antigravity runs (with roast level and reviewer archetype recorded on every opinion). Post opt-in team claims so reviewers do not duplicate effort.",
    status: "live",
    actionLabel: "Open Opinions →",
    actionTab: "opinions",
  },
  {
    id: "themes-seo",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "8 UI Themes, Mobile Bottom Nav & AI/SEO Endpoints",
    summary: "Midnight, Daylight, Warm Paper, Espresso, Nord, Tokyo Night, Postgres Classic, and High Contrast themes shared across both apps, plus SSR OpenGraph/JSON-LD, /sitemap.xml, /llms.txt, and /llms-full.txt.",
    status: "live",
    actionLabel: "Read /llms.txt ↗",
    actionPath: "/llms.txt",
  },
  {
    id: "mailing-lists",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "Full PostgreSQL Mailing Lists Archive (Continuous Sync)",
    summary: "Continuous sync of PostgreSQL public mailing lists linked to unified contributor profiles, thread search, and mailing-list activity charts.",
    status: "next",
  },

  // Weekly Quota Auto-Contribute
  {
    id: "quota-queue",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Soft-Lease Community Work Queue (/api/v1/contribute/next)",
    summary: "Assigns the highest-value open CommitFest patch with a 45-minute soft lease per backend so multiple contributors never waste quota roasting the same patch with the same model.",
    status: "live",
    cliSnippet: "pgroast contribute --dry-run",
  },
  {
    id: "quota-window",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Weekly Reset Window Scheduler (Claude, Codex, Antigravity)",
    summary: "Configure each subscription CLI's weekly reset day/hour (UTC), pre-reset window (e.g. 18 hours before reset), and per-window patch cap. Only spends leftover weekly capacity right before it expires, and stops immediately on any usage or rate limit.",
    status: "live",
    cliSnippet: "pgroast contribute --init",
  },
  {
    id: "quota-archetype",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Automatic Subsystem-to-Archetype Routing",
    summary: "Automatically picks the right reviewer archetype for each patch: WAL/buffer patches go to Storage Skeptic, B-tree/GIN/GiST to Index Specialist, planner/executor to Perf Hawk, SQL/parser to Spec Lawyer, replication/hooks to Systems Architect, and pg_stat/backup to Production DBA.",
    status: "live",
    cliSnippet: "pgroast contribute --once --flavour auto-by-subsystem",
  },
  {
    id: "quota-progress",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Live Community Coverage & Progress Tracking",
    summary: "Track overall CommitFest roast coverage (baseline, 1+ community opinion, 2+ cross-model consensus, active leases, backend breakdown, and top contributors) right on this page or from the terminal.",
    status: "live",
    cliSnippet: "pgroast contribute --status",
  },

  // Personal Backoffice
  {
    id: "bo-workbench",
    category: "backoffice",
    categoryLabel: "Personal Backoffice",
    title: "Local PostgreSQL 19 CommitFest Workbench (127.0.0.1:3432)",
    summary: "Private local web app backed by PostgreSQL 19. Search entries with structured tokens (status:ready, no:committer, has:novel, cfbot:pass, is:starred), save custom searches, add private notes and tags, and keep local Work Items.",
    status: "live",
    actionLabel: "Set up Backoffice →",
    actionTab: "connect",
  },
  {
    id: "bo-studio",
    category: "backoffice",
    categoryLabel: "Personal Backoffice",
    title: "Roast Studio: 3 Levels × 8 Fictional Reviewer Archetypes",
    summary: "Run Light, Medium, or Dark roasts locally with House Blend or any of 7 specialized fictional reviewer archetypes, using Claude, Codex, Antigravity (agy), or Cross-Family Dual mode. Records full prompts and transcripts locally.",
    status: "live",
    actionLabel: "Set up Backoffice →",
    actionTab: "connect",
  },
  {
    id: "bo-build-diff",
    category: "backoffice",
    categoryLabel: "Personal Backoffice",
    title: "Git Patch Apply, Build/Test & Inline Diff Comment Compiler",
    summary: "Create isolated PostgreSQL git worktrees, apply CFBot patches, run meson/make builds and tests locally (or on a remote SSH host), inspect unified diffs with inline comments, and compile comments into plain-text 72-column -hackers replies.",
    status: "live",
    actionLabel: "Set up Backoffice →",
    actionTab: "connect",
  },
  {
    id: "bo-drafts-bugs",
    category: "backoffice",
    categoryLabel: "Personal Backoffice",
    title: "4-Gate Email Drafts, Pushback Analysis & pgsql-bugs Triage",
    summary: "Checks every draft against Confidentiality, cfbot attachment rules, 72-column plain-text etiquette, and thread freshness before saving to Gmail drafts (never auto-sends). Also runs long-thread Pushback extraction and production-hit pgsql-bugs triage.",
    status: "live",
    actionLabel: "Set up Backoffice →",
    actionTab: "connect",
  },
  {
    id: "bo-quota-ui",
    category: "backoffice",
    categoryLabel: "Personal Backoffice",
    title: "Backoffice Auto-Contribute Card & Live Log Stream",
    summary: "Configure weekly reset schedules, preview the next queued patch, trigger a single quota run with live streaming logs in the bottom console drawer, and inspect your local auto-contribute history.",
    status: "live",
    actionLabel: "Set up Backoffice →",
    actionTab: "connect",
  },

  // CLI
  {
    id: "cli-roast",
    category: "cli",
    categoryLabel: "CLI (pgroast)",
    title: "Single-Patch & Self-Roast Pre-Review",
    summary: "Roast any CommitFest ID, URL, or message-id against 2,547 historical rejected attempts and reverts. Authors can run --self --proposal FILE --patch FILE to check their own draft before posting to -hackers.",
    status: "live",
    cliSnippet: "pgroast 5879 --level medium --flavour edge-case-hunter",
  },
  {
    id: "cli-batch-shortlist",
    category: "cli",
    categoryLabel: "CLI (pgroast)",
    title: "Batch CommitFest Roaster, Shortlist & Bugs Triage",
    summary: "Resumably roast a full CommitFest (`batch`), rank shortlisted and closing candidates with git-log subsystem expert routing (`shortlist`), extract stuck-thread blockers (`pushback`), or triage recent `pgsql-bugs` (`bugs`).",
    status: "live",
    cliSnippet: "pgroast batch 62 --out ./out/cf62 --status open --limit 10",
  },
  {
    id: "cli-publish-contribute",
    category: "cli",
    categoryLabel: "CLI (pgroast)",
    title: "CLI Publish & Weekly Quota Auto-Contribute",
    summary: "Publish any local `roast.json` directly to the Public App (`pgroast publish`) or automate weekly quota remainder roasting (`pgroast contribute --init|--status|--dry-run|--once|--auto`).",
    status: "live",
    cliSnippet: "pgroast publish ./out/cf-5879/roast.json",
  },
  {
    id: "cli-doctor-db",
    category: "cli",
    categoryLabel: "CLI (pgroast)",
    title: "Environment Doctor, Precedent DB Loader & Static HTML Cards",
    summary: "Check installed AI CLIs and subscription logins (`doctor`), load the 2,547-row precedent index into local Postgres (`init-db`), and render standalone HTML cards (`page`).",
    status: "live",
    cliSnippet: "pgroast doctor && pgroast init-db",
  },

  // Privacy & Safety
  {
    id: "safe-gate",
    category: "safety",
    categoryLabel: "Privacy & Safety",
    title: "Public-Confidentiality Hard Gate (Client + Server)",
    summary: "Blocks local filesystem paths, tokens, cookies, API keys, and internal codenames on both the local CLI/Backoffice and the Public App server (HTTP 422) before any opinion or brief can be published.",
    status: "live",
  },
  {
    id: "safe-human",
    category: "safety",
    categoryLabel: "Privacy & Safety",
    title: "Zero Auto-Posting & Zero Living Committer Impersonation",
    summary: "Nothing ever posts to pgsql-hackers or CommitFest automatically; humans review and take ownership. AI personas use fictional engineering archetypes only — never living people's names.",
    status: "live",
  },
  {
    id: "safe-privacy",
    category: "safety",
    categoryLabel: "Privacy & Safety",
    title: "Zero Raw Emails, Zero Localhost Control & Encrypted Local Secrets",
    summary: "Hacker profiles show unified email counts and domains only (never raw harvestable emails). Public App never controls your localhost; Backoffice binds 127.0.0.1 with per-boot Bearer auth and AES-256-GCM encrypted cookies/tokens.",
    status: "live",
  },
];

export function buildQuotaAgentPrompt(origin: string): string {
  return [
    "Set up pgroast Weekly Quota Auto-Contribute on this machine so unused weekly OAuth quota (Claude, Codex, or Antigravity) roasts open PostgreSQL CommitFest patches right before reset:",
    "",
    "1. Make sure pgroast is cloned and dependencies are installed (`bun install`), and run `bun run src/cli.ts doctor` to see which AI CLIs are signed in.",
    `2. Initialize the auto-contribute config pointing at ${origin}:`,
    `   bun run src/cli.ts contribute --init --hub ${origin}`,
    "3. Ask me for:",
    "   - Which AI CLIs to enable (claude, codex, agy) and each subscription's weekly reset day/hour (UTC)",
    "   - How many hours before reset to start (default: 18) and max patches per window (default: 5)",
    "   - Whether to auto-publish sanitized opinions to the Public App (requires a publish-only token from the Backoffice tab; default is local-only)",
    "4. Run `bun run src/cli.ts contribute --status` and `bun run src/cli.ts contribute --dry-run` so I can verify the next queued patch and reviewer archetype.",
    "5. Show me how to either run it via hourly cron (`0 * * * * bun run src/cli.ts contribute --auto`) or trigger it from the Personal Backoffice Settings card.",
  ].join("\n");
}

export function renderDocsTab(params: {
  origin: string;
  coverage: CommunityCoverageData | null;
  coverageLoading: boolean;
  category: DocsCategory;
  search: string;
  previewBackend: string;
  previewStrategy: string;
  previewFlavour: string;
  previewLevel: string;
  previewLoading: boolean;
  previewError: string;
  previewResult: QuotaPreviewResult | null;
}): string {
  const {
    origin,
    coverage,
    coverageLoading,
    category,
    search,
    previewBackend,
    previewStrategy,
    previewFlavour,
    previewLevel,
    previewLoading,
    previewError,
    previewResult,
  } = params;

  const q = search.trim().toLowerCase();
  const filteredFeatures = ALL_FEATURES.filter((f) => {
    const okCat = category === "all" || f.category === category;
    const okQ = !q || `${f.title} ${f.summary} ${f.categoryLabel} ${f.cliSnippet || ""}`.toLowerCase().includes(q);
    return okCat && okQ;
  });

  const cov = coverage;
  const openTot = cov?.totalOpen ?? 0;
  const basePct = cov ? pct(cov.baselineRoastedOpen, openTot) : 0;
  const op1Pct = cov ? pct(cov.openWith1PlusOpinion, openTot) : 0;
  const op2Pct = cov ? pct(cov.openWith2PlusOpinions, openTot) : 0;
  const rfcPct = cov ? pct(cov.readyForCommitterWithOpinion, cov.readyForCommitterOpen) : 0;

  const categories: Array<{ id: DocsCategory; label: string; count: number }> = [
    { id: "all", label: "All features", count: ALL_FEATURES.length },
    { id: "front-office", label: "Front Office", count: ALL_FEATURES.filter((f) => f.category === "front-office").length },
    { id: "quota", label: "Auto-Contribute", count: ALL_FEATURES.filter((f) => f.category === "quota").length },
    { id: "backoffice", label: "Personal Backoffice", count: ALL_FEATURES.filter((f) => f.category === "backoffice").length },
    { id: "cli", label: "CLI", count: ALL_FEATURES.filter((f) => f.category === "cli").length },
    { id: "safety", label: "Privacy & Safety", count: ALL_FEATURES.filter((f) => f.category === "safety").length },
  ];

  const agentPrompt = buildQuotaAgentPrompt(origin);

  const cliCommands: Array<{ cmd: string; desc: string }> = [
    { cmd: "pgroast 5879 --level medium --flavour edge-case-hunter", desc: "Roast one CommitFest entry with a specific level and reviewer archetype" },
    { cmd: "pgroast --self --proposal draft.txt --patch 0001.patch", desc: "Pre-check your own draft proposal before posting to pgsql-hackers" },
    { cmd: "pgroast pushback 5879", desc: "Read an entire long-stuck thread and extract blocking objections with quotes" },
    { cmd: "pgroast batch 62 --out ./out/cf62 --status open --limit 10", desc: "Resumably roast open entries of CommitFest #62; stops cleanly on quota limit" },
    { cmd: "pgroast shortlist ./out/cf62 --pg-repo ~/postgres", desc: "Rank shortlisted and closing candidates with git-log subsystem expert routing" },
    { cmd: "pgroast bugs --days 14 --limit 30", desc: "Triage recent pgsql-bugs threads (production hits vs synthetic hunts)" },
    { cmd: "pgroast page ./out/cf-5879/roast.json", desc: "Render a self-contained HTML report card locally (no LLM call)" },
    { cmd: "pgroast publish ./out/cf-5879/roast.json", desc: "Run the confidentiality gate and publish a sanitized opinion to the Public App" },
    { cmd: "pgroast contribute --init", desc: "Create ~/.pgroast/contribute.json with weekly reset schedules for installed CLIs" },
    { cmd: "pgroast contribute --status", desc: "Show live CommitFest coverage progress and your weekly reset countdowns" },
    { cmd: "pgroast contribute --dry-run", desc: "Preview the next queued patch and auto-selected archetype (zero LLM calls)" },
    { cmd: "pgroast contribute --once --publish", desc: "Claim, roast, and publish 1 CommitFest patch right now" },
    { cmd: "pgroast contribute --auto", desc: "Run from hourly cron: spends leftover weekly quota only inside your pre-reset window" },
    { cmd: "pgroast doctor", desc: "Verify installed AI CLIs (claude, codex, agy) and subscription logins" },
    { cmd: "pgroast init-db", desc: "Create local pgroast Postgres DB and load the 2,547-row precedent index" },
  ];

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">Docs, All Features &amp; Weekly Quota Auto-Contribute</h1>
        <div class="page-sub">
          Everything pgroast does across the Front Office, Personal Backoffice, CLI, and community weekly-quota roasting — with live coverage progress.
        </div>
      </div>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-primary btn-sm" id="docs-jump-quota-btn">Set up Auto-Contribute ↓</button>
        <button type="button" class="btn btn-secondary btn-sm" id="docs-jump-catalog-btn">All ${ALL_FEATURES.length} features ↓</button>
      </div>
    </div>

    <!-- 1. LIVE COMMUNITY COVERAGE PROGRESS TRACKER -->
    <section class="card docs-quota-hero" id="quota-progress">
      <div class="card-head">
        <div>
          <h2>Community CommitFest Goal: Multi-Model Coverage Progress</h2>
          <div class="dim" style="font-size:12px;">
            Many contributors donate leftover weekly OAuth quota (Claude, Codex, Antigravity) right before reset so every open CommitFest patch gets deep AI pre-review.
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="docs-refresh-coverage-btn">Refresh</button>
      </div>

      ${
        coverageLoading && !cov
          ? `<div class="loading-state" style="padding:24px 0;"><div class="spinner"></div><div class="muted">Loading live CommitFest coverage…</div></div>`
          : cov
            ? `
        <div class="kpis" style="margin-bottom:14px;">
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l">Open CommitFest patches</div>
            <div class="kpi-v">${fmtNum(cov.totalOpen)}</div>
            <div class="kpi-sub">${fmtNum(cov.totalAll)} total indexed</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l"><span class="dot" style="background:var(--accent)"></span>Baseline roasted</div>
            <div class="kpi-v">${basePct}%</div>
            <div class="kpi-sub">${fmtNum(cov.baselineRoastedOpen)} of ${fmtNum(cov.totalOpen)} open</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l"><span class="dot" style="background:var(--ok)"></span>Community opinions</div>
            <div class="kpi-v" style="color:var(--ok)">${fmtNum(cov.opinionsTotal)}</div>
            <div class="kpi-sub">${fmtNum(cov.openWith1PlusOpinion)} open with 1+ · ${fmtNum(cov.openWith2PlusOpinions)} with 2+</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l"><span class="dot" style="background:var(--warn)"></span>Unroasted open</div>
            <div class="kpi-v" style="color:var(--warn)">${fmtNum(cov.unroastedOpen)}</div>
            <div class="kpi-sub">Waiting in queue</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l">Ready for Committer</div>
            <div class="kpi-v">${rfcPct}%</div>
            <div class="kpi-sub">${fmtNum(cov.readyForCommitterWithOpinion)} of ${fmtNum(cov.readyForCommitterOpen)} have opinion</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l">Active quota leases</div>
            <div class="kpi-v">${fmtNum(cov.activeLeases.length)}</div>
            <div class="kpi-sub">45m soft locks</div>
          </div>
        </div>

        <div class="quota-bars">
          <div class="quota-bar-item">
            <div class="row" style="justify-content:space-between;font-size:12px;margin-bottom:5px;">
              <span><strong>Baseline CommitFest coverage</strong> (open entries with at least a brief pass)</span>
              <span class="mono"><strong>${basePct}%</strong> (${fmtNum(cov.baselineRoastedOpen)} / ${fmtNum(cov.totalOpen)})</span>
            </div>
            <div class="quota-track"><div class="quota-fill" style="width:${basePct}%;background:var(--accent);"></div></div>
          </div>
          <div class="quota-bar-item">
            <div class="row" style="justify-content:space-between;font-size:12px;margin-bottom:5px;">
              <span><strong>Community multi-model opinions</strong> (open entries with 1+ published reviewer/quota opinion)</span>
              <span class="mono"><strong>${op1Pct}%</strong> (${fmtNum(cov.openWith1PlusOpinion)} / ${fmtNum(cov.totalOpen)}) · 2+ models: ${op2Pct}%</span>
            </div>
            <div class="quota-track">
              <div class="quota-fill" style="width:${Math.max(op1Pct, cov.openWith1PlusOpinion > 0 ? 2 : 0)}%;background:var(--ok);"></div>
            </div>
          </div>
        </div>

        <div class="grid2" style="margin-top:14px;">
          <div>
            <div class="sheet-section-label" style="margin-bottom:6px;">Opinions by AI Backend &amp; Top Contributors</div>
            <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px;">
              ${
                cov.byBackend.length === 0
                  ? `<span class="dim" style="font-size:12px;">No community opinions yet — be the first!</span>`
                  : cov.byBackend.map((b) => `<span class="pill p-info mono">${esc(b.backend)}: ${b.count}</span>`).join("")
              }
            </div>
            ${
              cov.topContributors.length > 0
                ? `<div class="lb-list">
                    ${cov.topContributors
                      .slice(0, 5)
                      .map(
                        (c, i) => `
                      <div class="lb-row" style="cursor:default;">
                        <span class="lb-rank mono">${i + 1}</span>
                        <span class="lb-name"><strong>${esc(c.name)}</strong> <span class="dim mono">@${esc(c.handle)}</span></span>
                        <span class="lb-count mono">${c.count}</span>
                      </div>
                    `,
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>
          <div>
            <div class="sheet-section-label" style="margin-bottom:6px;">Recent Community Roasts &amp; Active Leases</div>
            ${
              cov.activeLeases.length > 0
                ? `<div style="margin-bottom:8px;display:flex;flex-direction:column;gap:4px;">
                    ${cov.activeLeases
                      .slice(0, 3)
                      .map(
                        (l) => `
                      <div class="tag-micro" style="justify-content:space-between;width:100%;">
                        <span>⏳ Roasting <strong class="mono">CF ${l.cf_id}</strong> (${esc(l.backend)} · ${esc(l.roast_flavour)})</span>
                        <span class="dim mono">${l.contributor_handle ? `@${esc(l.contributor_handle)}` : "active"}</span>
                      </div>
                    `,
                      )
                      .join("")}
                  </div>`
                : ""
            }
            ${
              cov.recentContributions.length === 0
                ? `<div class="muted" style="font-size:12.5px;">No published opinions yet. Run <code class="mono">pgroast contribute --once --publish</code> to contribute the first one.</div>`
                : `<div class="lb-list">
                    ${cov.recentContributions
                      .slice(0, 5)
                      .map(
                        (r) => `
                      <button type="button" class="lb-row" data-open-patch="${r.cf_id}">
                        <span class="mono" style="color:var(--accent-t);font-size:11.5px;min-width:54px;">CF ${r.cf_id}</span>
                        <span class="lb-name">${esc(r.title)}</span>
                        <span class="tag-micro mono">${esc(r.backend)}</span>
                      </button>
                    `,
                      )
                      .join("")}
                  </div>`
            }
          </div>
        </div>
      `
            : `<div class="muted">Coverage stats unavailable right now.</div>`
      }
    </section>

    <!-- 2. WEEKLY QUOTA AUTO-CONTRIBUTE: EXPLORE, PREVIEW & SET UP -->
    <section class="card" id="quota-setup">
      <div class="card-head">
        <div>
          <h2>Donate Leftover Weekly Quota (Claude · Codex · Antigravity)</h2>
          <div class="dim" style="font-size:12px;">Use expiring weekly OAuth subscription capacity to pre-review open CommitFest patches — zero extra spend, zero auto-posting to -hackers.</div>
        </div>
        <span class="pill p-ok">Opt-in · Stops on limit</span>
      </div>

      <div class="intro-grid" style="margin-bottom:16px;">
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">1</span><strong>Define your weekly reset</strong></div>
          <p>Set each CLI's reset day/hour (UTC) and pre-reset window (e.g. 18h before reset) plus a max patch cap per window.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">2</span><strong>Claim a soft-leased patch</strong></div>
          <p>The CLI asks <code class="mono">/api/v1/contribute/next</code> for an uncovered patch and reserves it for 45 min so contributors never duplicate work.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">3</span><strong>Roast locally &amp; stop on limit</strong></div>
          <p>Runs locally on your OAuth CLI (no API keys). Stops cleanly at the first rate/usage limit without failing or wasting retries.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">4</span><strong>Publish sanitized opinion</strong></div>
          <p>When you opt in (<code class="mono">autoPublish: true</code>), the Public-Confidentiality Hard Gate checks the summary and posts it here — never to <code class="mono">-hackers</code>.</p>
        </div>
      </div>

      <!-- Interactive Live Queue Previewer -->
      <div class="quota-preview-box">
        <div class="card-head" style="margin-bottom:10px;">
          <div>
            <h3>Try It Live: Preview Your Next Queued Patch</h3>
            <div class="dim" style="font-size:12px;">Runs a read-only <code class="mono">dry_run=1</code> query against the live CommitFest work queue (claims nothing).</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="quota-preview-btn" ${previewLoading ? "disabled" : ""}>
            ${previewLoading ? "Checking queue…" : "Preview next patch →"}
          </button>
        </div>
        <div class="quota-preview-controls">
          <label>
            <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">AI Backend</span>
            <select id="qp-backend">
              <option value="claude" ${previewBackend === "claude" ? "selected" : ""}>claude</option>
              <option value="codex" ${previewBackend === "codex" ? "selected" : ""}>codex</option>
              <option value="agy" ${previewBackend === "agy" ? "selected" : ""}>agy (Antigravity)</option>
            </select>
          </label>
          <label>
            <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Queue Strategy</span>
            <select id="qp-strategy">
              <option value="unroasted-first" ${previewStrategy === "unroasted-first" ? "selected" : ""}>Unroasted patches first</option>
              <option value="cross-model-second-opinion" ${previewStrategy === "cross-model-second-opinion" ? "selected" : ""}>Cross-model second opinion</option>
              <option value="ready-for-committer" ${previewStrategy === "ready-for-committer" ? "selected" : ""}>Ready for Committer queue</option>
            </select>
          </label>
          <label>
            <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Reviewer Archetype</span>
            <select id="qp-flavour">
              ${Object.entries(ARCHETYPE_LABELS)
                .map(([id, label]) => `<option value="${id}" ${previewFlavour === id ? "selected" : ""}>${esc(label)}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Roast Level</span>
            <select id="qp-level">
              <option value="light" ${previewLevel === "light" ? "selected" : ""}>Light</option>
              <option value="medium" ${previewLevel === "medium" ? "selected" : ""}>Medium</option>
              <option value="dark" ${previewLevel === "dark" ? "selected" : ""}>Dark</option>
            </select>
          </label>
        </div>

        ${
          previewError
            ? `<div class="sheet-callout sheet-callout-warn" style="margin-top:10px;">${esc(previewError)}</div>`
            : previewResult
              ? previewResult.patch
                ? `
            <div class="quota-preview-result">
              <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <div class="row" style="gap:6px;flex-wrap:wrap;">
                  <span class="mono" style="font-weight:700;color:var(--accent-t);">CF ${previewResult.patch.cf_id}</span>
                  <span class="tag-micro">${esc(previewResult.patch.status || "Open")}</span>
                  ${previewResult.patch.topic ? `<span class="tag-micro">${esc(previewResult.patch.topic)}</span>` : ""}
                  <span class="pill p-ok">Archetype: ${esc(ARCHETYPE_LABELS[previewResult.suggestedFlavour] || previewResult.suggestedFlavour)}</span>
                  <span class="pill p-info">Level: ${esc(previewResult.suggestedLevel)}</span>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" data-open-patch="${previewResult.patch.cf_id}">Open patch page →</button>
              </div>
              <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${esc(previewResult.patch.title)}</div>
              <div class="muted" style="font-size:12px;">${esc(previewResult.reason)}${previewResult.patch.authors ? ` · Authors: ${esc(previewResult.patch.authors)}` : ""}</div>
            </div>
          `
                : `<div class="sheet-callout" style="margin-top:10px;">${esc(previewResult.reason)}</div>`
              : ""
        }
      </div>

      <!-- Setup Options: AI Agent Prompt + 3-Step CLI -->
      <div class="grid2" style="margin-top:14px;">
        <div>
          <div class="row" style="justify-content:space-between;margin-bottom:6px;">
            <strong style="font-size:13px;">Option A: Ask your AI agent to set it up</strong>
            <button type="button" class="btn btn-primary btn-sm" id="docs-copy-quota-prompt-btn">Copy agent prompt</button>
          </div>
          <pre class="agent-prompt-pre mono" style="max-height:210px;">${esc(agentPrompt)}</pre>
        </div>
        <div>
          <div class="row" style="justify-content:space-between;margin-bottom:6px;">
            <strong style="font-size:13px;">Option B: 3-command CLI setup (or Backoffice UI)</strong>
            <button type="button" class="btn btn-secondary btn-sm" id="docs-goto-backoffice-btn">Backoffice Setup →</button>
          </div>
          <pre class="agent-prompt-pre mono"># 1. Generate ~/.pgroast/contribute.json for installed CLIs
bun run src/cli.ts contribute --init --hub ${esc(origin)}

# 2. Check live CommitFest progress + reset countdown
bun run src/cli.ts contribute --status
bun run src/cli.ts contribute --dry-run

# 3. Run 1 patch now or add hourly cron for pre-reset window
bun run src/cli.ts contribute --once --publish
# crontab -e:
0 * * * * cd ~/pgroast && bun run src/cli.ts contribute --auto</pre>
        </div>
      </div>
    </section>

    <!-- 3. COMPLETE CATALOG OF ALL FEATURES -->
    <section class="card" id="all-features">
      <div class="card-head">
        <div>
          <h2>Complete Feature Directory (${ALL_FEATURES.length} features)</h2>
          <div class="dim" style="font-size:12px;">Every capability across Front Office, Weekly Quota Auto-Contribute, Personal Backoffice, CLI, and Privacy/Safety</div>
        </div>
      </div>

      <div class="obs-dir-controls" style="margin-bottom:10px;">
        <div class="search-box" style="flex:1;margin-bottom:0;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="docs-feature-search" type="search" autocomplete="off" value="${esc(search)}" placeholder="Search any feature, command, or topic (e.g. diff, heatmap, quota, gmail, pushback)…" />
        </div>
      </div>

      <div class="chips" role="tablist" aria-label="Feature categories" style="margin-bottom:12px;">
        ${categories
          .map(
            (c) => `
          <button type="button" class="chip ${category === c.id ? "active" : ""}" data-docs-cat="${c.id}">
            ${esc(c.label)} <span class="dim">(${c.count})</span>
          </button>
        `,
          )
          .join("")}
      </div>

      <div class="docs-feature-grid" id="docs-feature-mount">
        ${renderDocsFeatureCards(filteredFeatures)}
      </div>
    </section>

    <!-- 4. COMPLETE CLI COMMAND REFERENCE -->
    <section class="card">
      <div class="card-head">
        <div>
          <h2>CLI Command Reference (<code class="mono">pgroast</code>)</h2>
          <div class="dim" style="font-size:12px;">Works with <code class="mono">bun run src/cli.ts …</code> or globally installed <code class="mono">pgroast …</code> (Bun / npm)</div>
        </div>
      </div>
      <div class="docs-cli-list">
        ${cliCommands
          .map(
            (c) => `
          <div class="docs-cli-row">
            <div style="min-width:0;flex:1;">
              <code class="mono docs-cli-cmd">${esc(c.cmd)}</code>
              <div class="muted" style="font-size:12px;margin-top:3px;">${esc(c.desc)}</div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-copy-snippet="${esc(c.cmd)}">Copy</button>
          </div>
        `,
          )
          .join("")}
      </div>
    </section>
  `;
}

export function renderDocsFeatureCards(items: FeatureDocItem[]): string {
  if (items.length === 0) {
    return `<div class="empty-state" style="grid-column:1 / -1;">No features match your filter.</div>`;
  }
  return items
    .map(
      (f) => `
    <article class="docs-feature-card">
      <div class="row" style="justify-content:space-between;gap:6px;margin-bottom:6px;">
        <span class="tag-micro">${esc(f.categoryLabel)}</span>
        <span class="pill ${f.status === "live" ? "p-ok" : "p-warn"}">${f.status === "live" ? "Live" : "Next"}</span>
      </div>
      <h3 class="docs-feature-title">${esc(f.title)}</h3>
      <p class="docs-feature-desc">${esc(f.summary)}</p>
      <div class="docs-feature-foot">
        ${
          f.actionTab
            ? `<button type="button" class="btn btn-secondary btn-sm" data-docs-nav="${esc(f.actionTab)}">${esc(f.actionLabel || "Open →")}</button>`
            : f.actionPath
              ? `<a class="btn btn-secondary btn-sm" href="${esc(f.actionPath)}" target="_blank" rel="noopener">${esc(f.actionLabel || "Open ↗")}</a>`
              : ""
        }
        ${
          f.cliSnippet
            ? `<button type="button" class="btn btn-ghost btn-sm mono" style="font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;" data-copy-snippet="${esc(f.cliSnippet)}" title="Copy CLI command">${esc(f.cliSnippet)}</button>`
            : ""
        }
      </div>
    </article>
  `,
    )
    .join("");
}

export function filterDocsFeatures(category: DocsCategory, search: string): FeatureDocItem[] {
  const q = search.trim().toLowerCase();
  return ALL_FEATURES.filter((f) => {
    const okCat = category === "all" || f.category === category;
    const okQ = !q || `${f.title} ${f.summary} ${f.categoryLabel} ${f.cliSnippet || ""}`.toLowerCase().includes(q);
    return okCat && okQ;
  });
}
