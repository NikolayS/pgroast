/**
 * About page ("/about" and "?tab=about")
 * Explains what "roasting" means on pgroast, why idea scrutiny is the foundation
 * of every roast level, the positive coffee story behind the name, and how one
 * roast runs — written in plain direct English with light theme-aware SVGs.
 */

function renderHeroBeanGraphic(): string {
  return `
    <svg viewBox="0 0 280 176" class="about-hero-svg" role="img" aria-label="Coffee bean roasting from green bean to light, medium, and dark roast alongside a PostgreSQL patch">
      <!-- Subtle warm glow behind the roasted beans -->
      <defs>
        <radialGradient id="ab-glow" cx="50%" cy="52%" r="50%">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect x="6" y="6" width="268" height="164" rx="14" fill="var(--surface)" stroke="var(--border)" />
      <circle cx="140" cy="92" r="72" fill="url(#ab-glow)" />

      <!-- Rising gentle steam arcs -->
      <path d="M 118 46 C 114 35, 124 29, 120 19" fill="none" stroke="var(--accent)" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" />
      <path d="M 140 42 C 136 30, 146 24, 142 14" fill="none" stroke="var(--accent)" stroke-opacity="0.6" stroke-width="2.2" stroke-linecap="round" />
      <path d="M 162 46 C 158 35, 168 29, 164 19" fill="none" stroke="var(--accent)" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" />

      <!-- 4 progression beans: Raw -> Light -> Medium -> Dark -->
      <!-- 1. Raw green bean -->
      <g transform="translate(52 94) rotate(-24)">
        <ellipse cx="0" cy="0" rx="16" ry="22" fill="var(--viz-2)" fill-opacity="0.28" stroke="var(--viz-2)" stroke-width="1.8" />
        <path d="M 0 -19 C -4 -7, 4 7, 0 19" fill="none" stroke="var(--viz-2)" stroke-width="2" stroke-linecap="round" />
      </g>
      <text x="52" y="136" text-anchor="middle" fill="var(--dim)" font-size="9.5" class="mono">Raw patch</text>

      <!-- Arrow 1 -->
      <path d="M 76 94 L 90 94" stroke="var(--border-s)" stroke-width="1.5" stroke-linecap="round" />
      <path d="M 86 90 L 91 94 L 86 98" fill="none" stroke="var(--border-s)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- 2. Light roast bean -->
      <g transform="translate(110 94) rotate(-24)">
        <ellipse cx="0" cy="0" rx="16" ry="22" fill="var(--viz-3)" fill-opacity="0.55" stroke="var(--viz-3)" stroke-width="1.8" />
        <path d="M 0 -19 C -4 -7, 4 7, 0 19" fill="none" stroke="var(--surface)" stroke-width="2.3" stroke-linecap="round" />
      </g>
      <text x="110" y="136" text-anchor="middle" fill="var(--muted)" font-size="9.5" class="mono">Light</text>

      <!-- Arrow 2 -->
      <path d="M 134 94 L 148 94" stroke="var(--border-s)" stroke-width="1.5" stroke-linecap="round" />
      <path d="M 144 90 L 149 94 L 144 98" fill="none" stroke="var(--border-s)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- 3. Medium roast bean -->
      <g transform="translate(168 94) rotate(-24)">
        <ellipse cx="0" cy="0" rx="16" ry="22" fill="#a85c2c" stroke="#c87a46" stroke-width="1.8" />
        <path d="M 0 -19 C -4 -7, 4 7, 0 19" fill="none" stroke="var(--surface)" stroke-width="2.5" stroke-linecap="round" />
      </g>
      <text x="168" y="136" text-anchor="middle" fill="var(--muted)" font-size="9.5" class="mono">Medium</text>

      <!-- Arrow 3 -->
      <path d="M 192 94 L 206 94" stroke="var(--border-s)" stroke-width="1.5" stroke-linecap="round" />
      <path d="M 202 90 L 207 94 L 202 98" fill="none" stroke="var(--border-s)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- 4. Dark roast bean -->
      <g transform="translate(226 94) rotate(-24)">
        <ellipse cx="0" cy="0" rx="16" ry="22" fill="#5e2f16" stroke="var(--accent)" stroke-width="2" />
        <path d="M 0 -19 C -4 -7, 4 7, 0 19" fill="none" stroke="#e2a87a" stroke-width="2.5" stroke-linecap="round" />
      </g>
      <text x="226" y="136" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="650" class="mono">Dark</text>

      <!-- Bottom caption bar -->
      <line x1="26" y1="150" x2="254" y2="150" stroke="var(--border)" stroke-dasharray="2 3" />
      <text x="140" y="163" text-anchor="middle" fill="var(--dim)" font-size="9.5">Careful heat brings out what is good in a patch</text>
    </svg>
  `;
}

function renderRoastLevelsDiagram(): string {
  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 780 280" class="obs-chart-svg" style="min-width:640px;" role="img" aria-label="Roast levels diagram showing Core Idea and Design Scrutiny as the shared foundation across Light, Medium, and Dark roasts">
        <!-- Column titles -->
        <text x="136" y="20" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700">Light Roast</text>
        <text x="136" y="35" text-anchor="middle" fill="var(--dim)" font-size="10" class="mono">Fast triage · ~1 min</text>

        <text x="390" y="20" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700">Medium Roast</text>
        <text x="390" y="35" text-anchor="middle" fill="var(--dim)" font-size="10" class="mono">Code + build + tests</text>

        <text x="644" y="20" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700">Dark Roast</text>
        <text x="644" y="35" text-anchor="middle" fill="var(--dim)" font-size="10" class="mono">Full adversarial stress-test</text>

        <!-- Layer 3 (Dark only): Live PG SQL + Reflection -->
        <rect x="526" y="48" width="234" height="58" rx="9" fill="var(--viz-5)" fill-opacity="0.14" stroke="var(--viz-5)" stroke-opacity="0.55" stroke-width="1.3" />
        <text x="540" y="68" fill="var(--text)" font-size="11" font-weight="650">+ Live Patched PG SQL &amp; Reflect</text>
        <text x="540" y="84" fill="var(--muted)" font-size="10">Boots isolated PG 20devel (-Dcassert)</text>
        <text x="540" y="98" fill="var(--muted)" font-size="10">SQL stress tests, EXPLAIN &amp; 2nd pass</text>

        <!-- Layer 2 (Medium + Dark): Code + Compile + Tests -->
        <rect x="272" y="114" width="488" height="56" rx="9" fill="var(--viz-1)" fill-opacity="0.13" stroke="var(--viz-1)" stroke-opacity="0.52" stroke-width="1.3" />
        <text x="286" y="134" fill="var(--text)" font-size="11" font-weight="650">+ Real C / SQL Code Inspection, Build &amp; Targeted Tests</text>
        <text x="286" y="150" fill="var(--muted)" font-size="10">Reads C/H/SQL diffs &amp; source · git apply on master · meson compile · meson test</text>
        <text x="286" y="163" fill="var(--dim)" font-size="9.5" class="mono">Catches bitrot, build errors, lock/WAL/null bugs, and failing suites</text>

        <!-- Layer 1 (ALL THREE LEVELS — THE FOUNDATION): Idea & Design Scrutiny -->
        <rect x="20" y="178" width="740" height="88" rx="10" fill="var(--viz-3)" fill-opacity="0.16" stroke="var(--viz-3)" stroke-opacity="0.7" stroke-width="1.6" />
        <text x="36" y="200" fill="var(--text)" font-size="12" font-weight="700">FOUNDATION IN EVERY ROAST LEVEL: Idea, Desirability &amp; Design Scrutiny</text>
        <text x="36" y="218" fill="var(--muted)" font-size="10.5">1. Review Pyramid — Level 1a (problem clear?), Level 1b (should PG do this?), Level 2 (design &amp; 15 touch points)</text>
        <text x="36" y="236" fill="var(--muted)" font-size="10.5">2. Checked against 2,547 historical pgsql-hackers precedents, past reverts, and Wiki "Features We Do Not Want"</text>
        <text x="36" y="254" fill="var(--muted)" font-size="10.5">3. 7 independent review angles + adversarial Critic counter-check that throws out weak or wrong objections</text>

        <!-- Subtle vertical column guide lines in top empty zones -->
        <rect x="20" y="48" width="232" height="122" rx="9" fill="none" stroke="var(--border)" stroke-dasharray="3 4" />
        <text x="136" y="106" text-anchor="middle" fill="var(--dim)" font-size="10.5">No code compile or SQL run</text>
        <text x="136" y="122" text-anchor="middle" fill="var(--dim)" font-size="9.5">Explicitly marked as idea-only triage</text>
      </svg>
    </div>
  `;
}

function renderPipelineFlowDiagram(): string {
  const steps = [
    {
      num: "1",
      title: "Thread & Patch",
      line1: "Loads CommitFest entry,",
      line2: "full -hackers thread,",
      line3: "and patch diff hunks.",
      color: "var(--viz-1)",
    },
    {
      num: "2",
      title: "7 Parallel Angles",
      line1: "Checks prior attempts,",
      line2: "WAL/on-disk, standards,",
      line3: "security, demand & fit.",
      color: "var(--viz-3)",
    },
    {
      num: "3",
      title: "Critic Filter",
      line1: "Actively tries to refute",
      line2: "wrong facts & stale",
      line3: "objections before output.",
      color: "var(--viz-5)",
    },
    {
      num: "4",
      title: "Verdict & Proof",
      line1: "Keeps surviving findings,",
      line2: "attaches build/SQL logs,",
      line3: "for humans to verify.",
      color: "var(--viz-2)",
    },
  ];

  const boxW = 158;
  const gap = 28;
  const padX = 12;
  const totalW = padX * 2 + steps.length * boxW + (steps.length - 1) * gap;
  const totalH = 114;

  const nodes = steps
    .map((s, i) => {
      const x = padX + i * (boxW + gap);
      const arrow =
        i < steps.length - 1
          ? `<line x1="${x + boxW + 5}" y1="57" x2="${x + boxW + gap - 6}" y2="57" stroke="var(--border-s)" stroke-width="1.6" />
             <path d="M ${x + boxW + gap - 11} 52 L ${x + boxW + gap - 5} 57 L ${x + boxW + gap - 11} 62" fill="none" stroke="var(--border-s)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />`
          : "";
      return `
        <g>
          <rect x="${x}" y="10" width="${boxW}" height="94" rx="10" fill="var(--surface)" stroke="var(--border)" />
          <circle cx="${x + 20}" cy="30" r="10" fill="${s.color}" fill-opacity="0.2" stroke="${s.color}" stroke-width="1.3" />
          <text x="${x + 20}" y="34" text-anchor="middle" fill="var(--text)" font-size="10.5" font-weight="700" class="mono">${s.num}</text>
          <text x="${x + 36}" y="34" fill="var(--text)" font-size="11.5" font-weight="650">${s.title}</text>
          <text x="${x + 12}" y="56" fill="var(--muted)" font-size="10">${s.line1}</text>
          <text x="${x + 12}" y="71" fill="var(--muted)" font-size="10">${s.line2}</text>
          <text x="${x + 12}" y="86" fill="var(--muted)" font-size="10">${s.line3}</text>
        </g>
        ${arrow}
      `;
    })
    .join("");

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 ${totalW} ${totalH}" class="obs-chart-svg" style="min-width:620px;" role="img" aria-label="Four-stage roast pipeline: Thread and Patch, 7 Parallel Angles, Critic Filter, and Verdict and Proof">
        ${nodes}
      </svg>
    </div>
  `;
}

export function renderAboutTab(): string {
  return `
    <div class="page-head">
      <div class="page-head-main">
        <div class="viz-kicker">About pgroast</div>
        <h1 class="page-title">Let's roast Postgres patches!</h1>
        <div class="page-sub">
          Humans and their AIs reviewing CommitFest patches together, starting with the idea itself.
        </div>
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" data-about-nav="brief">Open CommitFest Brief</button>
        <button type="button" class="btn btn-secondary btn-sm" data-about-nav="docs">5-Min CLI Tutorial</button>
      </div>
    </div>

    <!-- 1. STORY & POSITIVE MEANING -->
    <section class="card about-hero-card">
      <div class="about-hero-grid">
        <div class="about-story">
          <h2 style="margin-top:0;">Why coffee? Why roast patches?</h2>
          <p>
            On this site, to <strong>roast</strong> a Postgres patch means to review and scrutinize it carefully with AI. We mean roasting coffee beans, not mocking people.
          </p>
          <p>
            Raw green beans do not make good coffee on their own. Careful roasting brings out what is strong in a bean and exposes defects early, before you brew a pot.
          </p>
          <p>
            Postgres patches work the same way. Every CommitFest has hundreds of open patches while committer time stays scarce. Early scrutiny helps authors catch design blockers and past <code class="mono">pgsql-hackers</code> history before spending months on code, and helps committers spot clean patches ready for human review.
          </p>
          <p style="margin-bottom:0;">
            Every AI roast is a devil's advocate prep sheet, never an automated vote. Humans check the findings and write real reviews on <code class="mono">pgsql-hackers</code>.
          </p>
        </div>
        <div class="about-hero-art">
          ${renderHeroBeanGraphic()}
        </div>
      </div>
    </section>

    <!-- 2. IDEA SCRUTINY FIRST + ROAST LEVELS -->
    <section class="card viz-card" id="roast-levels">
      <div class="card-head">
        <div>
          <div class="viz-kicker">The Core Principle</div>
          <h2 class="viz-headline">Scrutinizing the idea comes first in every roast level</h2>
          <div class="dim" style="font-size:12.5px;margin-top:4px;max-width:760px;line-height:1.5;">
            Clean C code that solves the wrong problem still gets rejected after months of review. We check the idea, desirability, and architecture fit first in Light, Medium, and Dark alike. Medium and Dark keep that base and layer real code review, compilation, tests, and live Postgres SQL checks on top.
          </div>
        </div>
      </div>

      ${renderRoastLevelsDiagram()}

      <div class="about-levels-grid">
        <div class="about-level-box">
          <div class="row" style="gap:8px;align-items:center;margin-bottom:6px;">
            <span class="pill p-warn">Light</span>
            <strong style="font-size:13.5px;">Idea, Thread &amp; Precedents</strong>
          </div>
          <p class="muted" style="font-size:12.5px;margin:0;line-height:1.5;">
            Checks the idea, thread, and doc hunks against 2,547 past <code class="mono">pgsql-hackers</code> rejections and reverts. Fast triage with no Postgres checkout needed.
          </p>
        </div>

        <div class="about-level-box">
          <div class="row" style="gap:8px;align-items:center;margin-bottom:6px;">
            <span class="pill p-info">Medium</span>
            <strong style="font-size:13.5px;">Idea + Code, Build &amp; Tests</strong>
          </div>
          <p class="muted" style="font-size:12.5px;margin:0;line-height:1.5;">
            Runs the full Light check, reads C/H/SQL diffs, applies the patch to Postgres <code class="mono">master</code>, builds with <code class="mono">meson</code>, and runs targeted regression suites.
          </p>
        </div>

        <div class="about-level-box">
          <div class="row" style="gap:8px;align-items:center;margin-bottom:6px;">
            <span class="pill p-danger">Dark</span>
            <strong style="font-size:13.5px;">Idea + Build + Live Patched Postgres</strong>
          </div>
          <p class="muted" style="font-size:12.5px;margin:0;line-height:1.5;">
            Builds with <code class="mono">-Dcassert=true</code>, starts an isolated patched Postgres cluster, runs SQL stress tests and <code class="mono">explain</code> checks, and adds a second reflection pass.
          </p>
        </div>
      </div>
    </section>

    <!-- 3. HOW ONE ROAST RUNS -->
    <section class="card viz-card" id="how-a-roast-runs">
      <div class="card-head">
        <div>
          <div class="viz-kicker">Inside the Pipeline</div>
          <h2 class="viz-headline">Seven review angles plus a Critic that drops weak objections</h2>
          <div class="dim" style="font-size:12.5px;margin-top:4px;max-width:760px;line-height:1.5;">
            One prompt often invents nitpicks or misses history. We split review into seven angles, then run a Critic pass whose job is to disprove weak or wrong objections.
          </div>
        </div>
      </div>

      ${renderPipelineFlowDiagram()}

      <div class="grid2" style="margin-top:14px;">
        <div class="about-subbox">
          <h3 style="margin:0 0 8px;font-size:14px;">Four Verdicts</h3>
          <ul class="about-list">
            <li><span class="pill p-ok">No objection</span> No fatal design objection survived. Good candidate for human review.</li>
            <li><span class="pill p-info">Committer eyes</span> Sound direction with specific trade-offs for a committer to weigh.</li>
            <li><span class="pill p-warn">Design disc.</span> Open architecture, syntax, or scope questions to settle on <code class="mono">pgsql-hackers</code>.</li>
            <li><span class="pill p-danger">Likely reject</span> Strong precedent conflict or fundamental architectural clash.</li>
          </ul>
        </div>

        <div class="about-subbox">
          <h3 style="margin:0 0 8px;font-size:14px;">Review Flavours</h3>
          <p class="muted" style="font-size:12.5px;margin:0 0 8px;line-height:1.5;">
            Pick an engineering lens: <code class="mono">House Blend</code>, <code class="mono">The Storage Skeptic</code>, <code class="mono">The Edge-Case Hunter</code>, <code class="mono">The Index Specialist</code>, <code class="mono">The Perf Hawk</code>, <code class="mono">The Spec Lawyer</code>, <code class="mono">The Systems Architect</code>, or <code class="mono">The Production DBA</code>.
          </p>
          <p class="dim" style="font-size:12px;margin:0;line-height:1.45;">
            Multiple reviewers can publish runs from different models and flavours on the same patch so we can compare notes.
          </p>
        </div>
      </div>
    </section>

    <!-- 4. THREE WAYS TO USE PGROAST -->
    <section class="card viz-card">
      <div class="card-head">
        <div>
          <div class="viz-kicker">Put It to Work</div>
          <h2>How Postgres contributors use pgroast</h2>
        </div>
      </div>
      <div class="about-levels-grid">
        <div class="about-level-box">
          <strong style="font-size:13.5px;display:block;margin-bottom:6px;">Patch authors</strong>
          <p class="muted" style="font-size:12.5px;margin:0 0 10px;line-height:1.5;">
            Run <code class="mono">pgroast --self</code> on your draft before posting to <code class="mono">pgsql-hackers</code>. Catch prior rejections and bitrot privately first.
          </p>
          <button type="button" class="btn btn-secondary btn-sm" data-about-nav="docs">Open CLI &amp; Tutorial →</button>
        </div>

        <div class="about-level-box">
          <strong style="font-size:13.5px;display:block;margin-bottom:6px;">Reviewers &amp; committers</strong>
          <p class="muted" style="font-size:12.5px;margin:0 0 10px;line-height:1.5;">
            Scan the CommitFest queue, check Dark build and SQL logs, and jump straight to RFC warnings or clean pickups.
          </p>
          <button type="button" class="btn btn-secondary btn-sm" data-about-nav="stats">Open CommitFest Stats →</button>
        </div>

        <div class="about-level-box">
          <strong style="font-size:13.5px;display:block;margin-bottom:6px;">Community contributors</strong>
          <p class="muted" style="font-size:12.5px;margin:0 0 10px;line-height:1.5;">
            Spend leftover weekly AI quota before your reset to roast unroasted CommitFest patches and share findings here.
          </p>
          <button type="button" class="btn btn-secondary btn-sm" data-about-nav="contribute">Auto-Contribute Quota →</button>
        </div>
      </div>
    </section>
  `;
}
