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

function renderCoverageGaugeSvg(cov: CommunityCoverageData): string {
  const total = Math.max(1, cov.totalOpen);
  const seg2 = cov.openWith2PlusOpinions;
  const seg1 = Math.max(0, cov.openWith1PlusOpinion - seg2);
  const segBase = Math.max(0, cov.baselineRoastedOpen - cov.openWith1PlusOpinion);
  const segUn = Math.max(0, total - seg2 - seg1 - segBase);

  const items = [
    { label: "2+ models (consensus)", count: seg2, color: "var(--viz-2, #10b981)" },
    { label: "1 community opinion", count: seg1, color: "var(--viz-1, #5e6ad2)" },
    { label: "Baseline brief roast", count: segBase, color: "var(--viz-4, #38bdf8)" },
    { label: "Unroasted open", count: segUn, color: "var(--viz-muted, rgba(128,128,128,0.28))" },
  ];

  const w = 720;
  const h = 44;
  let x = 0;
  const rects = items
    .filter((it) => it.count > 0)
    .map((it) => {
      const rw = Math.max(4, (it.count / total) * w);
      const out = `<rect x="${x.toFixed(1)}" y="8" width="${rw.toFixed(1)}" height="20" rx="3" fill="${it.color}" class="viz-hoverable" data-tip-title="${esc(it.label)}" data-tip-body="${fmtNum(it.count)} of ${fmtNum(cov.totalOpen)} open patches (${pct(it.count, cov.totalOpen)}%)"/>`;
      x += rw + 2;
      return out;
    })
    .join("");

  return `
    <div class="viz-gauge-wrap">
      <svg viewBox="0 0 ${w} ${h}" class="viz-svg-full" role="img" aria-label="CommitFest community roast coverage stages">
        ${rects}
      </svg>
      <div class="viz-legend-row">
        ${items
          .map(
            (it) => `
          <span class="viz-legend-chip">
            <span class="dot" style="background:${it.color};"></span>
            <span>${esc(it.label)}</span>
            <strong class="mono">${fmtNum(it.count)}</strong>
            <span class="dim mono">(${pct(it.count, cov.totalOpen)}%)</span>
          </span>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

export function renderContributeTab(params: {
  origin: string;
  coverage: CommunityCoverageData | null;
  coverageLoading: boolean;
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
    previewBackend,
    previewStrategy,
    previewFlavour,
    previewLevel,
    previewLoading,
    previewError,
    previewResult,
  } = params;

  const cov = coverage;
  const openTot = cov?.totalOpen ?? 0;
  const basePct = cov ? pct(cov.baselineRoastedOpen, openTot) : 0;
  const rfcPct = cov ? pct(cov.readyForCommitterWithOpinion, cov.readyForCommitterOpen) : 0;
  const agentPrompt = buildQuotaAgentPrompt(origin);

  return `
    <div class="page-head">
      <div>
        <div class="viz-kicker">Weekly OAuth Quota Pool</div>
        <h1 class="page-title">Auto-Contribute Unused Weekly AI Quota</h1>
        <div class="page-sub">
          Turn expiring weekly subscription capacity (Claude, Codex, Antigravity) into deep pre-reviews for open PostgreSQL CommitFest patches — right before reset, zero extra spend.
        </div>
      </div>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-primary btn-sm" id="contrib-jump-setup-btn">60-Second Setup ↓</button>
        <button type="button" class="btn btn-secondary btn-sm" id="contrib-refresh-btn">Refresh progress</button>
      </div>
    </div>

    <!-- 1. LIVE COMMUNITY COVERAGE GOAL & PROGRESS -->
    <section class="card viz-card" id="quota-progress">
      <div class="card-head">
        <div>
          <h2>CommitFest Multi-Model Coverage Goal</h2>
          <div class="dim" style="font-size:12px;">Live pipeline from unroasted patches → baseline brief → 1 community opinion → 2+ cross-model consensus.</div>
        </div>
        <span class="pill p-ok">Live Queue</span>
      </div>

      ${
        coverageLoading && !cov
          ? `<div class="loading-state" style="padding:28px 0;"><div class="spinner"></div><div class="muted">Loading live CommitFest coverage…</div></div>`
          : cov
            ? `
        <div class="kpis" style="margin-bottom:14px;">
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l">Open CommitFest patches</div>
            <div class="kpi-v mono">${fmtNum(cov.totalOpen)}</div>
            <div class="kpi-sub">${fmtNum(cov.totalAll)} total indexed</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l"><span class="dot" style="background:var(--viz-4, #38bdf8)"></span>Baseline roasted</div>
            <div class="kpi-v mono">${basePct}%</div>
            <div class="kpi-sub">${fmtNum(cov.baselineRoastedOpen)} of ${fmtNum(cov.totalOpen)} open</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l"><span class="dot" style="background:var(--viz-2, #10b981)"></span>Community opinions</div>
            <div class="kpi-v mono" style="color:var(--ok)">${fmtNum(cov.opinionsTotal)}</div>
            <div class="kpi-sub">${fmtNum(cov.openWith1PlusOpinion)} open 1+ · ${fmtNum(cov.openWith2PlusOpinions)} cross-model 2+</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l"><span class="dot" style="background:var(--warn)"></span>Unroasted queue</div>
            <div class="kpi-v mono" style="color:var(--warn)">${fmtNum(cov.unroastedOpen)}</div>
            <div class="kpi-sub">Waiting for first roast</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l">Ready for Committer</div>
            <div class="kpi-v mono">${rfcPct}%</div>
            <div class="kpi-sub">${fmtNum(cov.readyForCommitterWithOpinion)} of ${fmtNum(cov.readyForCommitterOpen)} have opinion</div>
          </div>
          <div class="kpi" style="cursor:default;">
            <div class="kpi-l">Active soft leases</div>
            <div class="kpi-v mono">${fmtNum(cov.activeLeases.length)}</div>
            <div class="kpi-sub">45m anti-duplication lock</div>
          </div>
        </div>

        ${renderCoverageGaugeSvg(cov)}

        <div class="grid2" style="margin-top:16px;">
          <div>
            <div class="sheet-section-label" style="margin-bottom:8px;">Opinions by AI Backend &amp; Top Contributors</div>
            <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px;">
              ${
                cov.byBackend.length === 0
                  ? `<span class="dim" style="font-size:12px;">No community opinions published yet.</span>`
                  : cov.byBackend.map((b) => `<span class="pill p-info mono">${esc(b.backend)}: ${b.count}</span>`).join("")
              }
            </div>
            ${
              cov.topContributors.length > 0
                ? `<div class="lb-list">
                    ${cov.topContributors
                      .slice(0, 6)
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
            <div class="sheet-section-label" style="margin-bottom:8px;">Active Leases &amp; Latest Community Roasts</div>
            ${
              cov.activeLeases.length > 0
                ? `<div style="margin-bottom:8px;display:flex;flex-direction:column;gap:4px;">
                    ${cov.activeLeases
                      .slice(0, 4)
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
                ? `<div class="muted" style="font-size:12.5px;">No published opinions yet. Run <code class="mono">pgroast contribute --once --publish</code> to add the first one.</div>`
                : `<div class="lb-list">
                    ${cov.recentContributions
                      .slice(0, 6)
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

    <!-- 2. HOW IT WORKS + LIVE INTERACTIVE QUEUE PREVIEWER -->
    <section class="card" id="quota-preview">
      <div class="card-head">
        <div>
          <h2>How Weekly Quota Auto-Contribute Works</h2>
          <div class="dim" style="font-size:12px;">Safe by construction: uses your local OAuth CLI, stops on the first usage limit, and never posts to pgsql-hackers or CommitFest.</div>
        </div>
        <span class="pill p-ok">Opt-in · Zero API keys</span>
      </div>

      <div class="intro-grid" style="margin-bottom:16px;">
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">1</span><strong>Set weekly reset windows</strong></div>
          <p>Define each CLI's reset day/hour (UTC), pre-reset window (e.g. 18h before reset), and a hard cap on patches per window.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">2</span><strong>Claim a soft-leased patch</strong></div>
          <p>The worker asks <code class="mono">/api/v1/contribute/next</code> for an uncovered patch and reserves it for 45 min per backend so contributors never duplicate work.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">3</span><strong>Roast locally &amp; stop on limit</strong></div>
          <p>Runs locally on Claude, Codex, or Antigravity via subscription login (API keys stripped). Stops cleanly on the first usage or rate limit.</p>
        </div>
        <div class="intro-step">
          <div class="intro-step-head"><span class="intro-num">4</span><strong>Publish sanitized opinion</strong></div>
          <p>If you opt in (<code class="mono">autoPublish: true</code>), the Public-Confidentiality Hard Gate validates the summary and publishes it here for human reviewers.</p>
        </div>
      </div>

      <div class="quota-preview-box">
        <div class="card-head" style="margin-bottom:10px;">
          <div>
            <h3>Interactive Queue Preview</h3>
            <div class="dim" style="font-size:12px;">Runs a read-only <code class="mono">dry_run=1</code> query against the live CommitFest queue (claims nothing).</div>
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

        <div class="cli-bar" style="margin-top:10px;">
          <span class="cli-bar-label">CLI</span>
          <code class="mono cli-bar-cmd">npx pgroast contribute --once --backend ${esc(previewBackend)} --strategy ${esc(previewStrategy)} --flavour ${esc(previewFlavour)} --level ${esc(previewLevel)} --publish</code>
          <button type="button" class="btn btn-ghost btn-sm" data-copy-cli="npx pgroast contribute --once --backend ${esc(previewBackend)} --strategy ${esc(previewStrategy)} --flavour ${esc(previewFlavour)} --level ${esc(previewLevel)} --publish">Copy</button>
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
    </section>

    <!-- 3. 60-SECOND SETUP: AI AGENT PROMPT + CLI + BACKOFFICE UI -->
    <section class="card" id="quota-setup">
      <div class="card-head">
        <div>
          <h2>Set Up in 60 Seconds</h2>
          <div class="dim" style="font-size:12px;">Configure via your AI coding agent, CLI commands, or the Personal Backoffice Settings card.</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="contrib-goto-backoffice-btn">Personal Backoffice Setup →</button>
      </div>
      <div class="grid2">
        <div>
          <div class="row" style="justify-content:space-between;margin-bottom:6px;">
            <strong style="font-size:13px;">Option A: Paste into your AI coding agent</strong>
            <button type="button" class="btn btn-primary btn-sm" id="contrib-copy-prompt-btn">Copy agent prompt</button>
          </div>
          <pre class="agent-prompt-pre mono" style="max-height:220px;">${esc(agentPrompt)}</pre>
        </div>
        <div>
          <div class="row" style="justify-content:space-between;margin-bottom:6px;">
            <strong style="font-size:13px;">Option B: 3-command CLI setup (<code class="mono">npx pgroast</code>)</strong>
            <button type="button" class="btn btn-ghost btn-sm" id="contrib-goto-docs-btn">Full CLI docs →</button>
          </div>
          <pre class="agent-prompt-pre mono"># 1. Generate ~/.pgroast/contribute.json for installed CLIs
npx pgroast contribute --init --hub ${esc(origin)}

# 2. Check live CommitFest progress + reset countdown
npx pgroast contribute --status
npx pgroast contribute --dry-run

# 3. Run 1 patch now, or burn leftover quota in bulk (3 parallel workers)
npx pgroast contribute --once --backend ${esc(previewBackend)} --flavour ${esc(previewFlavour)} --level ${esc(previewLevel)} --publish
for w in 1 2 3; do (while npx pgroast contribute --once --backend ${esc(previewBackend)} --flavour ${esc(previewFlavour)} --level ${esc(previewLevel)} --publish; do sleep 2; done) & done

# Optional hourly cron (only runs inside your pre-reset window):
0 * * * * npx pgroast contribute --auto</pre>
        </div>
      </div>
    </section>
  `;
}
