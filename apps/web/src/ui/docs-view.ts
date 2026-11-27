import { renderStripeApiExplorer, type ApiLang } from "./api-docs-view.ts";

export type DocsCategory = "all" | "front-office" | "quota" | "backoffice" | "cli" | "safety";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    summary: "Interactive analytics across 66,000+ PostgreSQL commits: velocity & review timelines, 7×24 UTC hacking rhythm heatmap, subsystem bus-factor quadrant, release-cycle trends, and Committers / Authors / Reviewers / Bug Hunters / Rising Stars leaderboards.",
    status: "live",
    actionLabel: "Open Hackers →",
    actionTab: "hackers",
  },
  {
    id: "hacker-profiles",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "Unified Multi-Email Hacker Profiles (/hacker/<slug>)",
    summary: "Personal contributor pages that merge multiple email addresses, .mailmap aliases, diacritics, and recognized postgresql.org roles into one identity. Includes 52-week heatmap, radial 24h UTC clock, career chart, subsystem DNA, interactive collaboration constellation, commits, reviews, and mailing list activity.",
    status: "live",
    actionLabel: "Explore Profiles →",
    actionTab: "hackers",
  },
  {
    id: "mailing-lists",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "Full PostgreSQL Mailing Lists Archive (Continuous Sync)",
    summary: "All 49 PostgreSQL public mailing lists cataloged and continuously synced with incremental /since/ watermarks + optional authenticated .mbox historical backfill, full-text search, active thread tracking, and direct links to /hacker/<slug> profiles.",
    status: "live",
    actionLabel: "Open Lists →",
    actionTab: "lists",
  },
  {
    id: "cf-stats",
    category: "front-office",
    categoryLabel: "Front Office",
    title: "CommitFest Intelligence & Flow Visualizations",
    summary: "Status → Verdict alluvial flow diagram, subsystem readiness scatter plot, interactive Status × Verdict heatmap, clickable leaderboards, and zero-cookie PostgreSQL page-view traffic analytics.",
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

  // Weekly Quota Auto-Contribute
  {
    id: "quota-queue",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Soft-Lease Community Work Queue (/api/v1/contribute/next)",
    summary: "Assigns the highest-value open CommitFest patch with a 45-minute soft lease per backend so multiple contributors never waste quota roasting the same patch with the same model.",
    status: "live",
    actionLabel: "Open Contribute →",
    actionTab: "contribute",
    cliSnippet: "npx pgroast contribute --dry-run",
  },
  {
    id: "quota-window",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Weekly Reset Window Scheduler (Claude, Codex, Antigravity)",
    summary: "Configure each subscription CLI's weekly reset day/hour (UTC), pre-reset window (e.g. 18 hours before reset), and per-window patch cap. Only spends leftover weekly capacity right before it expires, and stops immediately on any usage or rate limit.",
    status: "live",
    actionLabel: "Open Contribute →",
    actionTab: "contribute",
    cliSnippet: "npx pgroast contribute --init",
  },
  {
    id: "quota-archetype",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Automatic Subsystem-to-Archetype Routing",
    summary: "Automatically picks the right fictional reviewer archetype for each patch: WAL/buffer patches go to Storage Skeptic, B-tree/GIN/GiST to Index Specialist, planner/executor to Perf Hawk, SQL/parser to Spec Lawyer, replication/hooks to Systems Architect, and pg_stat/backup to Production DBA.",
    status: "live",
    actionLabel: "Try Live Preview →",
    actionTab: "contribute",
    cliSnippet: "npx pgroast contribute --once --flavour auto-by-subsystem",
  },
  {
    id: "quota-progress",
    category: "quota",
    categoryLabel: "Auto-Contribute",
    title: "Live Community Coverage & Progress Tracking",
    summary: "Track overall CommitFest roast coverage (unroasted, baseline, 1+ community opinion, 2+ cross-model consensus, active leases, backend breakdown, and top contributors) on the Contribute page or in the terminal.",
    status: "live",
    actionLabel: "Track Progress →",
    actionTab: "contribute",
    cliSnippet: "npx pgroast contribute --status",
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
    title: "Backoffice Bulk Roast, Quota Burn & Live Log Stream",
    summary: "Launch parallel Bulk Roasts (1–4 workers, up to 300 patches) directly from the Backoffice Jobs view in either soft-leased Queue mode or CommitFest Batch mode, configure weekly reset schedules, and inspect live streaming logs.",
    status: "live",
    actionLabel: "Set up Backoffice →",
    actionTab: "connect",
    cliSnippet: "npx pgroast batch 62 --out ./out/cf62 --status open --concurrency 3",
  },

  // CLI
  {
    id: "cli-roast",
    category: "cli",
    categoryLabel: "CLI (npx pgroast)",
    title: "Single-Patch & Self-Roast Pre-Review",
    summary: "Roast any CommitFest ID, URL, or message-id against 2,547 historical rejected attempts and reverts. Authors can run --self --proposal FILE --patch FILE to check their own draft before posting to -hackers.",
    status: "live",
    cliSnippet: "npx pgroast 5879 --level medium --flavour edge-case-hunter",
  },
  {
    id: "cli-batch-shortlist",
    category: "cli",
    categoryLabel: "CLI (npx pgroast)",
    title: "Batch CommitFest Roaster, Shortlist & Bugs Triage",
    summary: "Resumably roast a full CommitFest (`batch`), rank shortlisted and closing candidates with git-log subsystem expert routing (`shortlist`), extract stuck-thread blockers (`pushback`), or triage recent `pgsql-bugs` (`bugs`).",
    status: "live",
    cliSnippet: "npx pgroast batch 62 --out ./out/cf62 --status open --limit 10",
  },
  {
    id: "cli-publish-contribute",
    category: "cli",
    categoryLabel: "CLI (npx pgroast)",
    title: "CLI Publish & Weekly Quota Auto-Contribute",
    summary: "Publish any local `roast.json` directly to the Public App (`npx pgroast publish`) or automate weekly quota remainder roasting (`npx pgroast contribute --init|--status|--dry-run|--once|--auto`).",
    status: "live",
    cliSnippet: "npx pgroast publish ./out/cf-5879/roast.json",
  },
  {
    id: "cli-doctor-db",
    category: "cli",
    categoryLabel: "CLI (npx pgroast)",
    title: "Environment Doctor, Precedent DB Loader & Static HTML Cards",
    summary: "Check installed AI CLIs and subscription logins (`doctor`), load the 2,547-row precedent index into local Postgres (`init-db`), and render standalone HTML cards (`page`).",
    status: "live",
    cliSnippet: "npx pgroast doctor && npx pgroast init-db",
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

export function renderDocsTab(params: {
  origin: string;
  category: DocsCategory;
  search: string;
  apiEndpointId: string;
  apiLang: ApiLang;
  apiParams: Record<string, string>;
  apiLiveStatus: string;
  apiLiveOk: boolean | null;
  apiLiveMeta: string;
  apiLiveBody: string;
  apiLiveLoading: boolean;
}): string {
  const {
    origin,
    category,
    search,
    apiEndpointId,
    apiLang,
    apiParams,
    apiLiveStatus,
    apiLiveOk,
    apiLiveMeta,
    apiLiveBody,
    apiLiveLoading,
  } = params;
  const filteredFeatures = filterDocsFeatures(category, search);

  const categories: Array<{ id: DocsCategory; label: string; count: number }> = [
    { id: "all", label: "All features", count: ALL_FEATURES.length },
    { id: "front-office", label: "Front Office", count: ALL_FEATURES.filter((f) => f.category === "front-office").length },
    { id: "quota", label: "Auto-Contribute", count: ALL_FEATURES.filter((f) => f.category === "quota").length },
    { id: "backoffice", label: "Personal Backoffice", count: ALL_FEATURES.filter((f) => f.category === "backoffice").length },
    { id: "cli", label: "CLI", count: ALL_FEATURES.filter((f) => f.category === "cli").length },
    { id: "safety", label: "Privacy & Safety", count: ALL_FEATURES.filter((f) => f.category === "safety").length },
  ];

  const cliCommands: Array<{ cmd: string; desc: string }> = [
    { cmd: "npx pgroast 5879 --level medium --flavour edge-case-hunter", desc: "Roast one CommitFest entry with a specific level and reviewer archetype" },
    { cmd: "npx pgroast --self --proposal draft.txt --patch 0001.patch", desc: "Pre-check your own draft proposal before posting to pgsql-hackers" },
    { cmd: "npx pgroast pushback 5879", desc: "Read an entire long-stuck thread and extract blocking objections with quotes" },
    { cmd: "npx pgroast batch 62 --out ./out/cf62 --status open --limit 10 --concurrency 3", desc: "Resumably roast open entries of CommitFest #62 in parallel; stops cleanly on quota limit" },
    { cmd: "npx pgroast shortlist ./out/cf62 --pg-repo ~/postgres", desc: "Rank shortlisted and closing candidates with git-log subsystem expert routing" },
    { cmd: "npx pgroast bugs --days 14 --limit 30", desc: "Triage recent pgsql-bugs threads (production hits vs synthetic hunts)" },
    { cmd: "npx pgroast page ./out/cf-5879/roast.json", desc: "Render a self-contained HTML report card locally (no LLM call)" },
    { cmd: "npx pgroast publish ./out/cf-5879/roast.json", desc: "Run the confidentiality gate and publish a sanitized opinion to the Public App" },
    { cmd: "npx pgroast contribute --init", desc: "Create ~/.pgroast/contribute.json with weekly reset schedules for installed CLIs" },
    { cmd: "npx pgroast contribute --status", desc: "Show live CommitFest coverage progress and your weekly reset countdowns" },
    { cmd: "npx pgroast contribute --dry-run", desc: "Preview the next queued patch and auto-selected archetype (zero LLM calls)" },
    { cmd: "npx pgroast contribute --once --backend codex --flavour default --level medium --publish", desc: "Claim, roast, and publish 1 CommitFest patch right now" },
    { cmd: "npx pgroast contribute --auto", desc: "Run from hourly cron: spends leftover weekly quota only inside your pre-reset window" },
    { cmd: "npx pgroast doctor", desc: "Verify installed AI CLIs (claude, codex, agy) and subscription logins" },
    { cmd: "npx pgroast init-db", desc: "Create local pgroast Postgres DB and load the 2,547-row precedent index" },
  ];

  return `
    <div class="page-head">
      <div>
        <div class="viz-kicker">Documentation &amp; Reference</div>
        <h1 class="page-title">pgroast Docs &amp; Complete Feature Catalog</h1>
        <div class="page-sub">
          Every capability across the Front Office, Personal Backoffice, CLI, Weekly Quota Auto-Contribute, and Safety Gates.
        </div>
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap;">
        <a class="btn btn-primary btn-sm" href="#api-reference">API Reference ↓</a>
        <a class="btn btn-secondary btn-sm" href="#cli-playground">CLI Playground ↓</a>
        <button type="button" class="btn btn-ghost btn-sm" data-docs-nav="contribute">Auto-Contribute →</button>
      </div>
    </div>

    <!-- Architecture at a Glance -->
    <section class="card">
      <div class="card-head">
        <h2>How the Three Pieces Fit Together</h2>
        <span class="pill p-ok">Local → Public Trust Model</span>
      </div>
      <div class="intro-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">1</span><strong>CLI (<code class="mono">pgroast</code>)</strong></div>
          <p>Runs locally on your OAuth AI CLIs (Claude, Codex, Antigravity) against 2,547 historical Postgres precedents. Writes local files only unless you run <code class="mono">publish</code> or opt-in <code class="mono">contribute</code>.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">2</span><strong>Personal Backoffice (<code class="mono">apps/local</code>)</strong></div>
          <p>Private PostgreSQL 19 workbench on <code class="mono">127.0.0.1:3432</code>. Compile Postgres, inspect diffs, manage Work Items, run Roast Studio, draft 72-col Gmail replies, and schedule quota runs.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">3</span><strong>Front Office (<code class="mono">apps/web</code>)</strong></div>
          <p>Public collaboration hub: CommitFest Briefs, <code class="mono">/patch/&lt;id&gt;</code> pages, Hacking Observatory, <code class="mono">/hacker/&lt;slug&gt;</code> profiles, Mailing Lists Archive, Stats, and the Quota Contribute queue.</p>
        </div>
      </div>
    </section>

    <!-- Complete Feature Catalog -->
    <section class="card" id="all-features">
      <div class="card-head">
        <div>
          <h2>All Features (${ALL_FEATURES.length})</h2>
          <div class="dim" style="font-size:12px;">Filter by area or search any command, visualization, or safety gate</div>
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

    <!-- Interactive CLI Playground -->
    <section class="card" id="cli-playground">
      <div class="card-head">
        <div>
          <div class="viz-kicker">Interactive CLI Builder</div>
          <h2>CLI Playground (<code class="mono">npx pgroast</code>)</h2>
          <div class="dim" style="font-size:12px;">Pick any command, model, reasoning effort, and reviewer archetype — copy the exact runnable command.</div>
        </div>
        <span class="pill p-ok">OAuth CLI · Zero API keys</span>
      </div>
      <div class="quota-preview-controls" style="margin-bottom:10px;">
        <label>
          <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Command</span>
          <select id="pg-cli-cmd">
            <option value="roast">Roast 1 patch</option>
            <option value="contribute" selected>Quota auto-contribute (--once)</option>
            <option value="batch">Bulk CommitFest batch</option>
            <option value="pushback">Pushback thread archaeology</option>
            <option value="shortlist">Shortlist &amp; closing report</option>
            <option value="bugs">pgsql-bugs production triage</option>
            <option value="publish">Publish local roast.json</option>
          </select>
        </label>
        <label>
          <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Backend</span>
          <select id="pg-cli-backend">
            <option value="codex" selected>codex (OpenAI Codex CLI)</option>
            <option value="claude">claude (Claude Code CLI)</option>
            <option value="agy">agy (Antigravity CLI)</option>
            <option value="dual">dual (Claude + agy)</option>
          </select>
        </label>
        <label>
          <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Model &amp; Effort</span>
          <input type="text" id="pg-cli-model" value="gpt-6.2-astra:xhigh" placeholder="e.g. gpt-6.2-astra:xhigh or opus" />
        </label>
        <label>
          <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Archetype</span>
          <select id="pg-cli-flavour">
            <option value="default" selected>House Blend (default)</option>
            <option value="auto-by-subsystem">Auto by subsystem</option>
            <option value="edge-case-hunter">The Edge-Case Hunter</option>
            <option value="spec-lawyer">The Spec Lawyer</option>
            <option value="systems-architect">The Systems Architect</option>
            <option value="perf-hawk">The Perf Hawk</option>
            <option value="storage-skeptic">The Storage Skeptic</option>
            <option value="index-specialist">The Index Specialist</option>
            <option value="production-dba">The Production DBA</option>
          </select>
        </label>
        <label>
          <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">Roast Level</span>
          <select id="pg-cli-level">
            <option value="light">Light</option>
            <option value="medium" selected>Medium</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          <span class="dim" style="font-size:11px;display:block;margin-bottom:3px;">CF # / Patch ID</span>
          <input type="text" id="pg-cli-target" value="7508" placeholder="Patch ID or CF #" />
        </label>
      </div>
      <div class="cli-bar">
        <span class="cli-bar-label">CMD</span>
        <code class="mono cli-bar-cmd" id="pg-cli-output">PGROAST_PUBLISH_TOKEN=pgroast_pub_… npx pgroast@next contribute --once --backend codex --model gpt-6.2-astra --effort xhigh --flavour default --level medium --publish</code>
        <button type="button" class="btn btn-primary btn-sm" id="pg-cli-copy-btn">Copy</button>
      </div>
      <div class="dim" style="font-size:11.5px;margin-top:6px;">
        Tip: use <code class="mono">npx pgroast@next</code> for the latest prerelease (or <code class="mono">bunx pgroast@next</code>). Identity for <code class="mono">--publish</code> comes from your <code class="mono">PGROAST_PUBLISH_TOKEN</code>.
      </div>
    </section>

    <!-- Complete CLI Reference -->
    <section class="card" id="cli-reference">
      <div class="card-head">
        <div>
          <h2>CLI Command Reference (<code class="mono">npx pgroast</code>)</h2>
          <div class="dim" style="font-size:12px;">Run directly with <code class="mono">npx pgroast …</code> (or <code class="mono">bunx pgroast …</code> / globally installed <code class="mono">pgroast …</code>)</div>
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

    <!-- Stripe-Style 3-Column Interactive API Reference (OpenAPI 3.1) -->
    ${renderStripeApiExplorer({
      origin,
      selectedId: apiEndpointId,
      lang: apiLang,
      paramValues: apiParams,
      liveStatus: apiLiveStatus,
      liveOk: apiLiveOk,
      liveMeta: apiLiveMeta,
      liveBody: apiLiveBody,
      liveLoading: apiLiveLoading,
    })}
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
