export type ApiLang = "curl" | "ts" | "python" | "cli";

export interface ApiParamDef {
  name: string;
  in: "path" | "query";
  type: string;
  required?: boolean;
  defaultValue: string;
  options?: string[];
  description: string;
}

export interface ApiFieldDef {
  name: string;
  type: string;
  description: string;
}

export interface ApiEndpointDef {
  id: string;
  group: string;
  method: "GET" | "POST";
  pathTemplate: string;
  title: string;
  auth: "public" | "bearer";
  summary: string;
  params: ApiParamDef[];
  cliExample?: string;
  responseFields: ApiFieldDef[];
  samplePostBody?: Record<string, unknown>;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const API_ENDPOINTS: ApiEndpointDef[] = [
  {
    id: "health",
    group: "Core",
    method: "GET",
    pathTemplate: "/api/v1/health",
    title: "Service health & version",
    auth: "public",
    summary: "Returns the live pgroast version, PostgreSQL server version, indexed entry/opinion/brief counts, and privacy-friendly view totals.",
    params: [],
    cliExample: "npx pgroast@next doctor",
    responseFields: [
      { name: "ok", type: "boolean", description: "Always true when PostgreSQL is reachable." },
      { name: "version", type: "string", description: "Running package version (e.g. 0.3.0-alpha.15)." },
      { name: "database.version", type: "string", description: "PostgreSQL server version string." },
      { name: "counts", type: "object", description: "Total entries, published opinions, briefs, and active claims." },
    ],
  },
  {
    id: "stats-overview",
    group: "CommitFest & Patches",
    method: "GET",
    pathTemplate: "/api/v1/stats/overview",
    title: "Live CommitFest intelligence & build pipeline",
    auth: "public",
    summary: "Returns live PostgreSQL aggregation across all CommitFest entries and opinions: Dark/Medium verification pipeline funnel (git apply, meson compile, meson test, live PG SQL stress), live merged Status × Verdict matrix, subsystem readiness, model mix, unified author profiles, and hourly traffic.",
    params: [],
    responseFields: [
      { name: "totals", type: "object", description: "Live open/closed counts, roast coverage, Dark-verified patches, bug fixes, and production hits." },
      { name: "verification", type: "object", description: "git apply, meson compile (-Dcassert), meson test, live SQL stress stats, by-model breakdown, and radar lists." },
      { name: "statusMatrix", type: "StatusRow[]", description: "Live CommitFest status × effective AI verdict matrix." },
      { name: "contributors", type: "object", description: "Top CommitFest authors linked to /hacker/<slug> profiles, AI quota roasters, and PG role split." },
    ],
  },
  {
    id: "entries-list",
    group: "CommitFest & Patches",
    method: "GET",
    pathTemplate: "/api/v1/entries",
    title: "List CommitFest entries",
    auth: "public",
    summary: "Returns indexed CommitFest patches with status, topic, authors, reviewers, committer, and baseline AI roast verdict.",
    params: [
      { name: "limit", in: "query", type: "integer", defaultValue: "20", description: "Maximum number of entries to return (1–1000)." },
      { name: "verdict", in: "query", type: "string", defaultValue: "", options: ["", "NO-FUNDAMENTAL-OBJECTION", "NEEDS-COMMITTER-EYES", "NEEDS-DESIGN-DISCUSSION", "LIKELY-REJECT", "UNROASTED"], description: "Optional verdict filter." },
      { name: "search", in: "query", type: "string", defaultValue: "", description: "Optional substring filter on title, authors, or CF ID." },
    ],
    cliExample: "npx pgroast@next batch 62 --out ./out/cf62 --status open --dry-run",
    responseFields: [
      { name: "entries", type: "Entry[]", description: "Array of CommitFest entry objects." },
      { name: "entries[].cf_id", type: "integer", description: "Official CommitFest patch ID." },
      { name: "entries[].verdict", type: "string", description: "Baseline AI roast verdict or UNROASTED." },
    ],
  },
  {
    id: "entry-detail",
    group: "CommitFest & Patches",
    method: "GET",
    pathTemplate: "/api/v1/entries/{cf_id}",
    title: "Get patch consensus & opinions",
    auth: "public",
    summary: "Returns full CommitFest entry metadata, multi-model consensus status, attributed community AI opinions (with provider/model:effort), and active team claims.",
    params: [
      { name: "cf_id", in: "path", type: "integer", required: true, defaultValue: "7508", description: "CommitFest patch ID." },
    ],
    cliExample: "npx pgroast@next 7508 --roast-level medium --flavour default",
    responseFields: [
      { name: "entry", type: "Entry", description: "Patch title, status, topic, authors, and thread URL." },
      { name: "consensus", type: "object", description: "Agreement status (unanimous, majority, split, single_opinion)." },
      { name: "opinions", type: "Opinion[]", description: "Published community opinions with models_json (spec), roast_level, and roast_flavour." },
    ],
  },
  {
    id: "entry-thread",
    group: "CommitFest & Patches",
    method: "GET",
    pathTemplate: "/api/v1/entries/{cf_id}/thread",
    title: "Parsed -hackers discussion timeline",
    auth: "public",
    summary: "Fetches and caches the linked pgsql-hackers thread with TL;DR pitch, participants, patch revisions (v1→vN), and quote-separated message blocks.",
    params: [
      { name: "cf_id", in: "path", type: "integer", required: true, defaultValue: "5879", description: "CommitFest patch ID." },
    ],
    cliExample: "npx pgroast@next pushback 5879",
    responseFields: [
      { name: "messageCount", type: "integer", description: "Total messages parsed from the mailing list thread." },
      { name: "tldr", type: "object", description: "Initial pitch, latest summary, and idle days." },
      { name: "revisions", type: "Revision[]", description: "Detected patch revisions with attachment filenames." },
    ],
  },
  {
    id: "entry-diff",
    group: "CommitFest & Patches",
    method: "GET",
    pathTemplate: "/api/v1/entries/{cf_id}/diff",
    title: "Live CFBot unified diff with inline comments",
    auth: "public",
    summary: "Returns the parsed unified diff from CFBot with inline pgsql-hackers review comments matched to exact file lines.",
    params: [
      { name: "cf_id", in: "path", type: "integer", required: true, defaultValue: "5879", description: "CommitFest patch ID." },
    ],
    responseFields: [
      { name: "files", type: "DiffFile[]", description: "Changed files with additions, deletions, hunks, and matched comments." },
      { name: "matchedLineComments", type: "integer", description: "Number of -hackers quotes matched onto diff lines." },
    ],
  },
  {
    id: "opinions-list",
    group: "Opinions & Publish",
    method: "GET",
    pathTemplate: "/api/v1/opinions",
    title: "Recent community AI opinions",
    auth: "public",
    summary: "Lists recent attributed opinions published from reviewers' local CLIs and Backoffice workbenches, including exact provider/model:effort specs.",
    params: [
      { name: "limit", in: "query", type: "integer", defaultValue: "15", description: "Max opinions to return (default 100)." },
      { name: "cf_id", in: "query", type: "integer", defaultValue: "", description: "Optional filter for a single CommitFest patch ID." },
    ],
    responseFields: [
      { name: "opinions[].backend", type: "string", description: "CLI backend (codex, claude, agy, dual)." },
      { name: "opinions[].models_json", type: "string", description: "JSON object containing canonical spec (e.g. openai/gpt-6.2-astra:xhigh)." },
      { name: "opinions[].roast_level", type: "string", description: "light, medium, or dark." },
      { name: "opinions[].roast_flavour", type: "string", description: "Fictional reviewer archetype slug (default = House Blend)." },
    ],
  },
  {
    id: "publish-opinion",
    group: "Opinions & Publish",
    method: "POST",
    pathTemplate: "/api/v1/publish/opinion",
    title: "Publish a sanitized opinion",
    auth: "bearer",
    summary: "Publishes a sanitized roast opinion from your local CLI or Personal Backoffice. Protected by a Bearer publish-only token and the server-side Public-Confidentiality Hard Gate (blocks secrets, cookies, and local paths with HTTP 422).",
    params: [],
    cliExample: "PGROAST_PUBLISH_TOKEN=pgroast_pub_YOUR_TOKEN npx pgroast@next publish ./out/cf-7508/roast.json",
    samplePostBody: {
      cf_id: 7508,
      backend: "codex",
      roast_level: "medium",
      roast_flavour: "default",
      models: { spec: "openai/gpt-6.2-astra:xhigh", roaster: "gpt-6.2-astra:xhigh", critic: "gpt-6.2-astra:xhigh" },
      verdict: "NEEDS-COMMITTER-EYES",
      confidence: "high",
      summary: "Concise sanitized summary of the roast findings.",
    },
    responseFields: [
      { name: "opinion", type: "Opinion", description: "Saved opinion row attributed to the token's GitHub/Google identity." },
    ],
  },
  {
    id: "hackers-overview",
    group: "Hacking Observatory",
    method: "GET",
    pathTemplate: "/api/v1/hackers/overview",
    title: "Hacking Observatory analytics",
    auth: "public",
    summary: "Returns full PostgreSQL git analytics: PG17–PG20 weekly release cycle race, annual committer concentration & 50% bus factor, subsystem effective committers (1/HHI), 7×24 UTC rhythm heatmap, and 5 leaderboards.",
    params: [
      { name: "window", in: "query", type: "string", defaultValue: "1y", options: ["30d", "90d", "1y", "PG20", "PG19", "PG18", "PG17", "5y", "all"], description: "Time window or PostgreSQL major release cycle." },
    ],
    responseFields: [
      { name: "totals", type: "object", description: "Commits, active hackers, reviews credited, bugs reported, % committed for others." },
      { name: "releaseCycles", type: "CycleSeries[]", description: "Weekly cumulative commit race across PG17–PG20." },
      { name: "concentrationByYear", type: "ConcYear[]", description: "Annual #1, #2–5, #6–10, rest share + 50% bus factor." },
      { name: "subsystems", type: "Subsystem[]", description: "Per-subsystem commits, busFactor, and effectiveCommitters (1/HHI)." },
    ],
  },
  {
    id: "hackers-search",
    group: "Hacking Observatory",
    method: "GET",
    pathTemplate: "/api/v1/hackers",
    title: "Search unified PostgreSQL contributors",
    auth: "public",
    summary: "Searches 2,100+ unified multi-email PostgreSQL contributors by name, alias, affiliation, email domain, or recognized postgresql.org role. Never exposes raw email addresses.",
    params: [
      { name: "search", in: "query", type: "string", defaultValue: "borodin", description: "Name, handle, company, or domain substring." },
      { name: "role", in: "query", type: "string", defaultValue: "all", options: ["all", "Core Team", "Committer", "Major Contributor", "Significant Contributor", "Contributor"], description: "PostgreSQL community role filter." },
      { name: "limit", in: "query", type: "integer", defaultValue: "20", description: "Max contributors returned." },
    ],
    responseFields: [
      { name: "hackers[].slug", type: "string", description: "Canonical URL slug for /hacker/<slug>." },
      { name: "hackers[].emailCount", type: "integer", description: "Count of unified email addresses (raw addresses never exposed)." },
      { name: "hackers[].emailDomains", type: "string[]", description: "Distinct email domains associated with this person." },
    ],
  },
  {
    id: "hacker-profile",
    group: "Hacking Observatory",
    method: "GET",
    pathTemplate: "/api/v1/hackers/{slug}",
    title: "Unified contributor profile",
    auth: "public",
    summary: "Returns a person's full PostgreSQL profile: 52-week contribution heatmap, career trajectory by role, subsystem DNA with over-index vs. project average, 24h UTC clock, 3-way collaboration constellation, and linked mailing list activity.",
    params: [
      { name: "slug", in: "path", type: "string", required: true, defaultValue: "andrey-borodin", description: "Canonical contributor slug." },
      { name: "year", in: "query", type: "integer", defaultValue: "2026", description: "Heatmap year (defaults to latest active year)." },
    ],
    responseFields: [
      { name: "person", type: "Person", description: "Name, role, unified emailCount, domains, and lifetime counters." },
      { name: "careerByYear", type: "YearRow[]", description: "Annual authored, committed, reviewed, and reported credits." },
      { name: "subsystems", type: "SubsysDna[]", description: "Per-subsystem share and overIndex multiplier vs. Postgres baseline." },
      { name: "collaborators", type: "object", description: "Top committers, reviewers, and helped authors." },
    ],
  },
  {
    id: "lists-overview",
    group: "Mailing Lists Archive",
    method: "GET",
    pathTemplate: "/api/v1/lists/overview",
    title: "Mailing lists overview & sparklines",
    auth: "public",
    summary: "Returns all 49 continuously synced PostgreSQL public mailing lists with 14-day sparklines, git-linked contributor share, 30-day daily velocity, hot threads, and top posters.",
    params: [],
    responseFields: [
      { name: "lists", type: "ListSummary[]", description: "49 public lists with messageCount, linkedPct, and sparkline array." },
      { name: "daily", type: "DailyPoint[]", description: "Daily message volume with git-linked count." },
      { name: "hotThreads", type: "Thread[]", description: "Most active recent threads by messages × participants." },
    ],
  },
  {
    id: "lists-messages",
    group: "Mailing Lists Archive",
    method: "GET",
    pathTemplate: "/api/v1/lists/messages",
    title: "Search archived mailing list messages",
    auth: "public",
    summary: "Full-text search across archived PostgreSQL mailing list messages, filterable by list name and patch attachments, with sender links to /hacker/<slug>.",
    params: [
      { name: "list", in: "query", type: "string", defaultValue: "pgsql-hackers", description: "Mailing list slug (blank = all 49 lists)." },
      { name: "search", in: "query", type: "string", defaultValue: "", description: "Full-text search query on subject, sender, or excerpt." },
      { name: "attachments", in: "query", type: "string", defaultValue: "", options: ["", "1"], description: "Set to 1 to return only messages with patch/file attachments." },
      { name: "limit", in: "query", type: "integer", defaultValue: "15", description: "Max messages returned (1–200)." },
    ],
    responseFields: [
      { name: "messages[].personSlug", type: "string", description: "Unified /hacker/<slug> link when sender matches git history." },
      { name: "messages[].archiveUrl", type: "string", description: "Canonical postgresql.org/message-id/ URL." },
    ],
  },
  {
    id: "contribute-status",
    group: "Weekly Quota Queue",
    method: "GET",
    pathTemplate: "/api/v1/contribute/status",
    title: "Live CommitFest roast coverage & leases",
    auth: "public",
    summary: "Returns real-time community coverage progress (unroasted, baseline, 1+ opinion, 2+ cross-model consensus), active 45-minute soft leases, backend breakdown, and top contributors.",
    params: [],
    cliExample: "npx pgroast@next contribute --status",
    responseFields: [
      { name: "totalOpen", type: "integer", description: "Total open CommitFest patches." },
      { name: "unroastedOpen", type: "integer", description: "Open patches still waiting for a first roast." },
      { name: "activeLeases", type: "Lease[]", description: "Active 45-minute soft leases preventing duplicate work." },
    ],
  },
  {
    id: "contribute-next",
    group: "Weekly Quota Queue",
    method: "GET",
    pathTemplate: "/api/v1/contribute/next",
    title: "Claim or preview next queued patch",
    auth: "public",
    summary: "Selects the highest-priority uncovered CommitFest patch for a backend and automatically suggests the best fictional reviewer archetype. Pass dry_run=1 to preview without acquiring a 45-minute soft lease.",
    params: [
      { name: "backend", in: "query", type: "string", defaultValue: "codex", options: ["codex", "claude", "agy"], description: "Target AI backend CLI." },
      { name: "strategy", in: "query", type: "string", defaultValue: "unroasted-first", options: ["unroasted-first", "ready-for-committer", "cross-model-second-opinion"], description: "Patch prioritization strategy." },
      { name: "flavour", in: "query", type: "string", defaultValue: "default", options: ["default", "auto-by-subsystem", "edge-case-hunter", "spec-lawyer", "systems-architect", "perf-hawk", "storage-skeptic", "index-specialist", "production-dba"], description: "Archetype or auto-by-subsystem." },
      { name: "level", in: "query", type: "string", defaultValue: "medium", options: ["light", "medium", "dark"], description: "Roast intensity." },
      { name: "dry_run", in: "query", type: "string", defaultValue: "1", options: ["1", "0"], description: "1 = read-only preview (default in Playground); 0 = acquire 45m lease." },
    ],
    cliExample: "npx pgroast@next contribute --dry-run --backend codex",
    responseFields: [
      { name: "patch", type: "Entry | null", description: "Selected CommitFest patch (or null if queue is exhausted)." },
      { name: "suggestedFlavour", type: "string", description: "Resolved reviewer archetype slug." },
      { name: "reason", type: "string", description: "Human-readable explanation of why this patch was prioritized." },
    ],
  },
  {
    id: "openapi-spec",
    group: "Machine & AI",
    method: "GET",
    pathTemplate: "/openapi.json",
    title: "OpenAPI 3.1.0 specification",
    auth: "public",
    summary: "Machine-readable OpenAPI 3.1.0 JSON schema for importing into Postman, Scalar, Swagger UI, or AI agent toolchains. Also see /llms.txt and /llms-full.txt.",
    params: [],
    responseFields: [
      { name: "openapi", type: "string", description: "OpenAPI spec version (3.1.0)." },
      { name: "paths", type: "object", description: "Complete map of public read-only endpoints and parameters." },
    ],
  },
];

export function buildEndpointPath(ep: ApiEndpointDef, values: Record<string, string>): string {
  let path = ep.pathTemplate;
  const qs = new URLSearchParams();
  for (const p of ep.params) {
    const val = (values[p.name] ?? p.defaultValue ?? "").trim();
    if (p.in === "path") {
      path = path.replace(`{${p.name}}`, encodeURIComponent(val || p.defaultValue));
    } else if (val) {
      qs.set(p.name, val);
    }
  }
  const qStr = qs.toString();
  return qStr ? `${path}?${qStr}` : path;
}

export function buildApiCodeSnippet(
  ep: ApiEndpointDef,
  lang: ApiLang,
  origin: string,
  values: Record<string, string>,
): string {
  const relPath = buildEndpointPath(ep, values);
  const fullUrl = `${origin.replace(/\/$/, "")}${relPath}`;

  if (lang === "cli") {
    return ep.cliExample || `curl -sS "${fullUrl}" | jq .`;
  }

  if (ep.method === "POST") {
    const bodyJson = JSON.stringify(ep.samplePostBody || {}, null, 2);
    if (lang === "curl") {
      return `curl -sS -X POST "${fullUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $PGROAST_PUBLISH_TOKEN" \\\n  -d '${bodyJson}'`;
    }
    if (lang === "ts") {
      return `const res = await fetch("${fullUrl}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    Authorization: \`Bearer \${process.env.PGROAST_PUBLISH_TOKEN}\`,\n  },\n  body: JSON.stringify(${bodyJson}),\n});\nconst data = await res.json();\nconsole.log(data);`;
    }
    return `import os, requests\n\nres = requests.post(\n    "${fullUrl}",\n    headers={"Authorization": f"Bearer {os.environ['PGROAST_PUBLISH_TOKEN']}"},\n    json=${bodyJson},\n)\nprint(res.json())`;
  }

  if (lang === "curl") {
    return `curl -sS "${fullUrl}" | jq .`;
  }
  if (lang === "ts") {
    return `const res = await fetch("${fullUrl}");\nif (!res.ok) throw new Error(\`HTTP \${res.status}\`);\nconst data = await res.json();\nconsole.log(data);`;
  }
  return `import requests\n\nres = requests.get("${fullUrl}", timeout=15)\nres.raise_for_status()\nprint(res.json())`;
}

export function renderStripeApiExplorer(params: {
  origin: string;
  selectedId: string;
  lang: ApiLang;
  paramValues: Record<string, string>;
  liveStatus: string;
  liveOk: boolean | null;
  liveMeta: string;
  liveBody: string;
  liveLoading: boolean;
}): string {
  const { origin, selectedId, lang, paramValues, liveStatus, liveOk, liveMeta, liveBody, liveLoading } = params;
  const ep = API_ENDPOINTS.find((e) => e.id === selectedId) || API_ENDPOINTS[0]!;
  const groups = Array.from(new Set(API_ENDPOINTS.map((e) => e.group)));
  const resolvedPath = buildEndpointPath(ep, paramValues);
  const codeSnippet = buildApiCodeSnippet(ep, lang, origin, paramValues);

  return `
    <section class="stripe-docs-shell" id="api-reference">
      <div class="stripe-docs-topbar">
        <div>
          <div class="viz-kicker">Interactive API Reference</div>
          <h2 style="margin:0;font-size:18px;letter-spacing:-0.02em;">pgroast Public REST API</h2>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;">
          <span class="pill p-ok mono" style="font-size:11px;">Base: ${esc(origin)}</span>
          <a class="btn btn-secondary btn-sm" href="/openapi.json" target="_blank" rel="noopener">OpenAPI 3.1 JSON ↗</a>
          <a class="btn btn-ghost btn-sm" href="/llms.txt" target="_blank" rel="noopener">/llms.txt ↗</a>
        </div>
      </div>

      <div class="stripe-grid">
        <!-- LEFT RAIL: Categorized Endpoint Sidebar -->
        <nav class="stripe-nav" aria-label="API endpoints">
          ${groups
            .map(
              (grp) => `
            <div class="stripe-nav-group">
              <div class="stripe-nav-title">${esc(grp)}</div>
              ${API_ENDPOINTS.filter((e) => e.group === grp)
                .map(
                  (e) => `
                <button type="button" class="stripe-nav-item ${e.id === ep.id ? "active" : ""}" data-api-select="${esc(e.id)}">
                  <span class="http-badge ${e.method === "POST" ? "is-post" : "is-get"}">${e.method}</span>
                  <span class="stripe-nav-label">${esc(e.title)}</span>
                </button>
              `,
                )
                .join("")}
            </div>
          `,
            )
            .join("")}
        </nav>

        <!-- CENTER PANE: Documentation, Live Parameters & Response Schema -->
        <div class="stripe-center">
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="http-badge ${ep.method === "POST" ? "is-post" : "is-get"}" style="font-size:11px;padding:3px 8px;">${ep.method}</span>
            <code class="mono" style="font-size:13px;font-weight:600;word-break:break-all;">${esc(ep.pathTemplate)}</code>
            <span class="pill ${ep.auth === "bearer" ? "p-warn" : "p-ok"}" style="font-size:10.5px;">
              ${ep.auth === "bearer" ? "Bearer pgroast_pub_…" : "Public · No auth"}
            </span>
          </div>
          <h3 style="margin:0 0 6px;font-size:18px;letter-spacing:-0.015em;">${esc(ep.title)}</h3>
          <p class="muted" style="margin:0 0 16px;font-size:13.5px;line-height:1.55;">${esc(ep.summary)}</p>

          ${
            ep.params.length > 0
              ? `
            <div class="stripe-subhead">Parameters <span class="dim" style="font-weight:400;text-transform:none;">(edit to update code &amp; live request)</span></div>
            <div class="stripe-param-list">
              ${ep.params
                .map((p) => {
                  const curVal = paramValues[p.name] ?? p.defaultValue;
                  const inputHtml = p.options
                    ? `<select class="stripe-param-input mono" data-api-param="${esc(p.name)}">
                        ${p.options.map((opt) => `<option value="${esc(opt)}" ${curVal === opt ? "selected" : ""}>${esc(opt || "(any)")}</option>`).join("")}
                      </select>`
                    : `<input type="text" class="stripe-param-input mono" data-api-param="${esc(p.name)}" value="${esc(curVal)}" placeholder="${esc(p.defaultValue || p.type)}" />`;
                  return `
                <div class="stripe-param-row">
                  <div class="stripe-param-meta">
                    <div class="row" style="gap:6px;flex-wrap:wrap;">
                      <code class="mono" style="font-weight:700;font-size:12.5px;">${esc(p.name)}</code>
                      <span class="tag-micro mono" style="font-size:10px;">${esc(p.type)}</span>
                      <span class="dim" style="font-size:11px;">${esc(p.in)}${p.required ? " · required" : ""}</span>
                    </div>
                    <div class="muted" style="font-size:12px;margin-top:3px;">${esc(p.description)}</div>
                  </div>
                  <div class="stripe-param-ctrl">${inputHtml}</div>
                </div>
              `;
                })
                .join("")}
            </div>
          `
              : `<div class="dim" style="font-size:12px;margin-bottom:14px;">No path or query parameters required.</div>`
          }

          <div class="stripe-subhead" style="margin-top:16px;">Returns</div>
          <div class="stripe-schema-list">
            ${ep.responseFields
              .map(
                (f) => `
              <div class="stripe-schema-row">
                <div class="row" style="gap:6px;">
                  <code class="mono" style="font-weight:600;font-size:12px;">${esc(f.name)}</code>
                  <span class="dim mono" style="font-size:11px;">${esc(f.type)}</span>
                </div>
                <div class="muted" style="font-size:12px;margin-top:2px;">${esc(f.description)}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>

        <!-- RIGHT STICKY RAIL: Stripe Dark Code + Live Response Console -->
        <aside class="stripe-rail">
          <div class="stripe-code-box">
            <div class="stripe-code-head">
              <div class="stripe-lang-tabs" role="tablist">
                ${(
                  [
                    ["curl", "cURL"],
                    ["ts", "TypeScript"],
                    ["python", "Python"],
                    ["cli", "CLI"],
                  ] as Array<[ApiLang, string]>
                )
                  .map(
                    ([id, lbl]) =>
                      `<button type="button" class="stripe-lang-btn ${lang === id ? "active" : ""}" data-api-lang="${id}">${lbl}</button>`,
                  )
                  .join("")}
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="stripe-copy-code-btn" style="color:#cbd5e1;">Copy</button>
            </div>
            <pre class="stripe-code-pre mono" id="stripe-code-pre">${esc(codeSnippet)}</pre>
            <div class="stripe-code-foot">
              <code class="mono stripe-url-preview" id="stripe-url-preview">${ep.method} ${esc(resolvedPath)}</code>
              ${
                ep.method === "GET"
                  ? `<button type="button" class="btn btn-primary btn-sm" id="stripe-try-btn" ${liveLoading ? "disabled" : ""}>${liveLoading ? "Running…" : "Try It Live ▶"}</button>`
                  : `<span class="dim" style="font-size:11px;">Requires Bearer token</span>`
              }
            </div>
          </div>

          <div class="stripe-resp-box">
            <div class="stripe-resp-head">
              <span style="font-size:11.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;">Live Response</span>
              <div class="row" style="gap:6px;">
                ${
                  liveStatus
                    ? `<span class="pill mono ${liveOk ? "p-ok" : "p-err"}" style="font-size:10.5px;">${esc(liveStatus)}</span>`
                    : `<span class="dim" style="font-size:11px;">Click Try It Live ▶</span>`
                }
                ${liveMeta ? `<span class="mono" style="font-size:10.5px;color:#94a3b8;">${esc(liveMeta)}</span>` : ""}
              </div>
            </div>
            <pre class="stripe-resp-pre mono" id="stripe-resp-pre">${esc(liveBody || (ep.method === "POST" ? JSON.stringify(ep.samplePostBody, null, 2) : 'Click "Try It Live ▶" to execute this request against live PostgreSQL data.'))}</pre>
          </div>
        </aside>
      </div>
    </section>
  `;
}
