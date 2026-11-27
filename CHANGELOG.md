# Changelog

## v0.3.0-alpha.30 (2026-11-27)

This release makes the copy-ready **AI Agent Backoffice Install Prompt** the #1 default path at every Backoffice entry point and right at the top of `README.md`.

### Changes

- **Single Canonical AI Agent Install Prompt (`apps/web/src/ui/backoffice-prompt.ts`, `app.ts`, `docs-view.ts`, `README.md`):**
  - Moved the **AI Agent Install Prompt** card to the very top of `/?tab=connect` (Setup Backoffice) above the space overview cards.
  - Added a dedicated **"Ask Your AI Coding Agent to Install Backoffice"** section (`#backoffice-install`) to `/docs` with a header jump button.
  - Made **`Copy AI Agent Install Prompt`** the primary button inside both the topbar **Space Switcher** sheet and the **Patch Detail** right-sidebar Backoffice card.
  - Promoted the exact same copy-ready AI Agent Install Prompt to the top of `README.md` right below the opening intro.

## v0.3.0-alpha.29 (2026-11-27)

This release rewrites all remaining outbound `postgresql.org/message-id/flat/...` links across patch pages, hacker profiles, and downloadable briefs to canonical `/message-id/...` permalinks so no user-facing link hits `postgresql.org`'s broken `/flat/` endpoint.

### Changes

- **Site-Wide Non-Flat `postgresql.org` Archive Links (`apps/web/src/security.ts`, `mr.ts`, `ui/app.ts`, `ui/hackers-view.ts`):**
  - Normalized every outbound `postgresql.org/message-id/flat/<id>` URL to `https://www.postgresql.org/message-id/<id>` across Patch `Thread ↗` links, Discussion headers, Hacker Profile commit/review discussions, and Brief HTML/Markdown downloads (covering all 736 stored entries and 1,421 commit discussion links automatically).

## v0.3.0-alpha.28 (2026-11-27)

This release switches outbound Postgres mailing list links from `/message-id/flat/<id>` to canonical `/message-id/<id>` permalinks so links keep working while `postgresql.org`'s `/flat/` view returns HTTP 500.

### Changes

- **Canonical Mailing List Permalinks (`apps/web/src/lists-queries.ts`, `ui/lists-view.ts`, `ui/viz-charts.ts`):**
  - Updated Mailing Lists Archive rows, active thread links, and thread scatter chart links to use `https://www.postgresql.org/message-id/<id>` (HTTP 200) instead of `/message-id/flat/<id>` (currently returning HTTP 500 on `postgresql.org`).

## v0.3.0-alpha.27 (2026-11-27)

This release fixes mobile viewport clipping on the `/docs` step-by-step tutorial Copy buttons and hardens narrow-screen (`375px`) CSS grids and patch MR tabs across the site.

### Changes

- **Mobile Grid & Copy Button Containment (`apps/web/src/ui/styles.css`):**
  - Replaced single-column `grid-template-columns: 1fr` rules with `minmax(0, 1fr)` and added `min-width: 0; max-width: 100%` on `.qs-step`, `.qs-cmd`, `.about-level-box`, `.about-subbox`, `.intro-step`, `.docs-cli-row`, and `.cli-bar` so long inline CLI commands scroll horizontally inside their code box while keeping the `Copy` button 100% inside the mobile viewport.
  - Tightened `.mr-tab` padding on narrow screens (`<= 640px`) so `Overview & Consensus`, `Discussion`, and `Changes` all fit cleanly on `375px` phones without clipping.

## v0.3.0-alpha.26 (2026-11-27)

This release makes authors, reviewers, and committers on every patch page clickable links to their `/hacker/<slug>` contributor profiles, adds live on-demand fetching from `commitfest.postgresql.org` for any unindexed CommitFest patch, and adds `bun run web:sync-cf` to keep active CommitFests (including PG20-4 `#63`) synced.

### Changes

- **Clickable Contributor Profiles on Patch Pages (`apps/web/src/hackers-queries.ts`, `server.ts`, `ui/app.ts`):**
  - Added `resolvePeopleLinksForEntry()` in `GET /api/v1/entries/:cfId` to map CommitFest authors, reviewers, and committers to their unified `/hacker/<slug>` profiles.
  - Rendered clickable profile links in both the Patch Hero and Patch Details sidebar (for example, clicking `SeongJun Shin` on `/patch/6819` opens `/hacker/seongjun-shin` with all his patches and mailing list posts).
- **Live On-Demand CommitFest Fallback & PG20-4 Sync (`apps/web/src/mr.ts`, `server.ts`, `sync-cf.ts`, `db.ts`, `ui/app.ts`):**
  - Added `fetchLiveCommitfestPatch()` fallback in `GET /api/v1/entries/:cfId` and SSR `/patch/:cfId` so visiting any valid CommitFest patch ID not yet cached locally (such as `/patch/7726` in PG20-4) fetches, caches, and serves it immediately.
  - Added `bun run web:sync-cf` to sync active CommitFests (`PG20-3 #62` and `PG20-4 #63`) into `public_entries` while preserving existing AI verdicts, scores, and production flags, and loaded the full live entry list in `Entries`.

## v0.3.0-alpha.25 (2026-11-27)

This release updates Home to open with **"Let's roast Postgres patches!"**, adds full iOS Safari and Android Home Screen standalone app support, hides the footer while skeletons are preloading, and tightens copy across Home, About, Docs, and Stats in `nik-voice` with **Postgres** preferred over PostgreSQL.

### Changes

- **Home Hero & Tighter `nik-voice` Copy (`apps/web/src/ui/app.ts`, `about-view.ts`, `docs-view.ts`, `stats-view.ts`):**
  - Updated Home to open directly with **"Let's roast Postgres patches!"** and the subtitle **"Humans and their AIs reviewing patches together."**
  - Trimmed copy across Home, About, and Docs for faster scanning and switched headings and prose to prefer **Postgres** over PostgreSQL.
- **Hide Footer During Preloading (`apps/web/src/ui/index.html`, `styles.css`, `app.ts`):**
  - Added `body.is-booting` and `body:has(#web-main > .skel-page)` CSS rules so the footer never floats underneath animated grayscale skeleton preloaders.
- **iOS Safari & Android Home Screen App Mode (`apps/web/src/ui/index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `server.ts`, `styles.css`):**
  - Added `apple-mobile-web-app-title`, `mobile-web-app-capable`, full-bleed `180×180`, `192×192`, and `512×512` PNG app icons, a network-first `/sw.js` service worker, and `display-mode: standalone` safe-area CSS so adding `pgroast.postgres.ai` to an iOS or Android Home Screen opens like a standalone app.

## v0.3.0-alpha.24 (2026-11-27)

This release applies Fable's newcomer UX audit across Home, Docs, Patch Detail, and CLI onboarding, and replaces every tiny spinner and missing preloader with layout-matched animated grayscale shimmer rectangles.

### Changes

- **De-Cluttered Home & Unified Idea-First Definition (`apps/web/src/ui/app.ts`, `prompts/roaster-common.md`):**
  - Replaced the 4-box 2-column Home intro (which had stale tone-only roast copy) with a compact single-column welcome bar stating clearly that **every roast level starts with idea & design scrutiny** (`Light`: idea + 2,547 precedents · `Medium`: + C/SQL diff, compile & tests · `Dark`: + live patched PG SQL).
  - Removed the dangerous `batch 62` CLI bar from Home and collapsed the brief snapshot charts by default so real CommitFest patches appear in the first viewport.
  - Updated `prompts/roaster-common.md` so idea and design scrutiny explicitly comes first across all three levels while Medium/Dark cleanly incorporate code, compile/test, and live SQL evidence.
- **Step-by-Step 5-Minute Docs Tutorial & `npx pgroast@next login` (`apps/web/src/ui/docs-view.ts`, `src/publish.ts`, `src/cli.ts`, `src/contribute.ts`):**
  - Put a 4-step beginner tutorial (`#quickstart`) at the top of `/docs`: prerequisites (`Bun >= 1.3.5` + `claude`/`codex`/`agy`), `npx pgroast@next doctor`, first local Light roast (`npx pgroast@next 7388 --level light` — no account or Backoffice needed), HTML report, and optional publishing identity.
  - Added `npx pgroast@next login --token <pgroast_pub_...>` and `npx pgroast@next whoami` saving the publish-only token in `~/.pgroast/auth.json` (`0600`) so zero-install `npx pgroast@next` runs recognize you automatically for `publish` and `contribute --publish`.
  - Refreshed stale Docs cards (new 6-chart Stats, System Day/Night themes, About page) and switched the CLI Playground and Patch Detail sidebar defaults to a safe, untruncated Light roast.
- **Animated Grayscale Skeleton Preloaders Everywhere (`apps/web/src/ui/skeletons.ts`, `index.html`, `styles.css`, `app.ts`, `stats-view.ts`, `hackers-view.ts`, `lists-view.ts`, `contribute-view.ts`):**
  - Replaced tiny spinners and missing preloaders (including the initial boot screen and **Setup Backoffice**) with layout-matched animated grayscale shimmer rectangles (`@keyframes skel-shimmer`, respecting `prefers-reduced-motion`) across Brief, Setup Backoffice, Stats, Hackers, Hacker Profile, Lists, Entries, Opinions, Contribute, and Patch Overview/Discussion/Diff.

## v0.3.0-alpha.23 (2026-11-27)

This release adds a dedicated **About** page (`/about`) that explains what "roasting" means on pgroast, tells the coffee story behind the name, and shows with custom theme-aware SVG diagrams why scrutinizing the patch idea comes first across all roast levels (`Light`, `Medium`, `Dark`).

### Changes

- **About Page & Custom Light SVG Diagrams (`apps/web/src/ui/about-view.ts`, `styles.css`, `server.ts`):**
  - Added `/about` (`?tab=about`) with dedicated SSR metadata, sitemap entry, and `llms.txt` listing.
  - Added three theme-aware SVG graphics: the coffee bean progression (`Raw patch → Light → Medium → Dark`), the **Roast Levels** stack showing **Core Idea, Desirability & Design Scrutiny** as the shared foundation across all three levels, and the 4-stage pipeline (`Thread & Patch → 7 Parallel Angles → Critic Filter → Verdict & Proof`).
- **Contextual Links & Prompt Alignment (`apps/web/src/ui/app.ts`, `stats-view.ts`, `index.html`, `src/roast/flavours.ts`):**
  - Linked `/about` ("About", "What is a roast?", "What do Light / Medium / Dark mean?") from the top nav, mobile `More` sheet, footer, Brief intro guide, Stats header, Opinions header, and Patch Detail opinions header.
  - Updated `ROAST_LEVEL_META` in `src/roast/flavours.ts` so Medium and Dark prompts explicitly state that they build on the full Light idea, desirability, and architecture scrutiny foundation.

## v0.3.0-alpha.22 (2026-11-27)

This release redesigns the Public App **Stats** page from the ground up into six non-repetitive, decision-focused CommitFest visualizations with reconciled counts, zero misleading small-n percentages, and every mark linking straight to its patch.

### Changes

- **The Queue — 736-Square Clickable Hero Unit Chart (`apps/web/src/ui/viz-charts.ts`, `stats-view.ts`):**
  - Renders all 736 CommitFest patches as individual clickable squares grouped into four status columns (`Needs review`, `Waiting on Author`, `Ready for Committer`, `Closed`), sorted by priority score, using one unified verdict color scale with heavy-bordered dots for Dark-verified patches and instant highlight filters (`All`, `Dark-verified`, `RFC warnings`, `Clean pickups`).
- **Status vs. Evidence Triage Tables & Dark Evidence Matrix (`apps/web/src/stats-queries.ts`, `stats-view.ts`):**
  - Replaced duplicate status/verdict donuts and 12-card radar walls with two side-by-side ranked lists (**Committer Warnings** on Ready-for-Committer patches vs. **Cheapest Clean Pickups** in Needs review) plus a compact **Dark Evidence Matrix** (1 row per unique Dark-verified patch sorted by where it breaks: `Apply` → `Compile` → `Tests` → `Live PG SQL` → `Verdict`).
- **Review Load vs. Committer Capacity & Author Track Record Beeswarm (`apps/web/src/stats-queries.ts`, `viz-charts.ts`):**
  - Mapped both CommitFest open patches and the last 12 months of `pg_commits` to the same 14 canonical PostgreSQL subsystems to surface structural review bottlenecks (`open patches ÷ active 12m committers`).
  - Added a log-scale **Author Track Record Beeswarm** plotting all 585 open patches by the author's prior credited PostgreSQL commits (`0 [First-time]` through `1000+`) across status swimlanes so clean first-time patches stand out immediately.
- **Exact Small-n Tables & Honest Calibration (`apps/web/src/ui/stats-view.ts`):**
  - Replaced the misleading `"Seen in Production — 100%"` stacked bar with a direct 10-row **Production-Hit Patches** table, added a counts-only **Outcome Calibration** table (`AI Verdict × Final CommitFest Outcome`, no percentages below `n=30`), and removed redundant 1-model, 1-person, and empty-referrer charts.

## v0.3.0-alpha.21 (2026-11-27)

This release adds a configurable **System (Auto Day / Night)** theme mode across both the Public App and Personal Backoffice, defaulting new sessions to **Warm Paper** during the day and **Espresso** at night.

### Changes

- **System (Auto Day / Night) Theme Selector (`apps/web`, `apps/local`):**
  - Added a **System** option at the top of the theme menu with dedicated **☀ Day** and **☾ Night** theme pickers (defaulting to **Warm Paper** for Day and **Espresso** for Night, customizable to any of the 8 themes).
  - Made `system` (`Warm Paper` / `Espresso`) the default appearance for new visitors, tracking OS `prefers-color-scheme` changes live via `matchMedia` while preserving manual single-theme overrides.

## v0.3.0-alpha.20 (2026-11-27)

This release fixes two mobile layout and navigation bugs caught on live testing: full-width stacking of `.page-head` titles/subtitles on narrow viewports and preventing the mobile bottom-nav `More` button from navigating to `Brief` when opened.

### Changes

- **Full-Width Mobile Page Headers (`apps/web/src/ui/styles.css`, `stats-view.ts`, `app.ts`):**
  - Replaced inline `flex: 1` on `.page-head` title blocks with responsive `flex: 1 1 280px` on desktop and `flex-direction: column; width: 100%` below `720px` so titles and subtitles span the full viewport width on mobile instead of squeezing beside action buttons.
- **Mobile Bottom-Nav `More` Button Fix (`apps/web/src/ui/app.ts`):**
  - Scoped the bottom-nav tab click handler to `.btab[data-tab]` so tapping `More` opens the **All Sections** sheet in place without triggering a spurious navigation to `Brief`.

## v0.3.0-alpha.19 (2026-11-27)

This release fixes five UI/UX bugs across the Public App: adds full mobile navigation via a `More` sheet, adds search/filters/sorting/pagination to Opinions, links every entry in standalone/embed briefs to its public `/patch/<id>` page, distinguishes `Patch Author` from `Thread Starter` in discussions, and fixes baseline opinion counts on patch pages.

### Changes

- **Complete Mobile Navigation (`apps/web/src/ui/index.html`, `app.ts`, `styles.css`):**
  - Replaced the fixed mobile bottom-nav `Backoffice` slot with a **`More`** button opening a bottom sheet containing every remaining section (`Mailing Lists`, `Auto-Contribute`, `Docs & API Explorer`, `Team Coordination`, `Setup Personal Backoffice`), highlighting `More` whenever one of those tabs is active.
- **Bounded, Searchable & Paginated Opinions Feed (`apps/web/src/db.ts`, `server.ts`, `app.ts`):**
  - Joined `public_entries` onto `listOpinions()` (raising the API default cap from 150 to 500, up to 1,000) so every opinion row shows its actual **Patch Title** and CF status and no opinions are silently truncated.
  - Added live search, verification depth chips (`Dark`, `Medium`, `Light`), verdict chips, `provider/model:effort` model filter, sorting (`Newest`, `Deepest`, `Most critical`, `CF #`), and pagination (`25 / 50 / 100` per page) to `/?tab=opinions`.
  - Synced live community verdicts (`Dark > Medium > Light`) onto `Entries` on load so `Entries` never disagrees with live published opinions.
- **Public Patch Links in Standalone & Embedded Briefs (`apps/web/src/brief.ts`, `server.ts`):**
  - Passed the public site origin into `renderInteractiveBriefHtml()` and `renderBriefMarkdown()` so every CF ID and patch title in `/briefs/<slug>/embed`, `download.html`, and `download.md` links directly to `/patch/<cf_id>` (`Details ↗`) alongside `CF ↗` and `Thread ↗`.
- **Accurate Discussion Author vs. Thread Starter & Opinion Counts (`apps/web/src/mr.ts`, `server.ts`, `app.ts`):**
  - Matched mailing-list message senders against CommitFest `Authors` in `fetchMrDiscussionForCf()`: actual CommitFest patch authors get the **`Patch Author`** badge, while a bug reporter who opened the thread (e.g. CF 7206) gets **`Thread Starter`** instead of being mislabeled as the patch author.
  - Counted the displayed Baseline CommitFest Brief card accurately in both the `Overview & Consensus` tab badge and the `Reviewer & AI Opinions (N)` heading (with explicit `"1 baseline brief pass · 0 individual reviewer runs yet"` breakdown) and upgraded consensus chips to show full `provider/model:effort` specs.

## v0.3.0-alpha.18 (2026-11-27)

This release upgrades the Public App **Stats** tab into a live **CommitFest Intelligence & Verification Observatory** matching the Hacking Observatory, backed by a new live `GET /api/v1/stats/overview` PostgreSQL endpoint.

### Changes

- **Live Stats Observatory API (`apps/web/src/stats-queries.ts`, `apps/web/src/server.ts`, `api-docs-view.ts`):**
  - Added `GET /api/v1/stats/overview` (also documented in `/openapi.json` and the Stripe-style API Reference) computing live merged verdicts (preferring Dark > Medium > Light opinions over static brief snapshots), verification pipeline metrics, subsystem classification, patch kind breakdown, opinion throughput, unified CommitFest authors linked to `people`, and hourly page-view timelines.
- **PostgreSQL Verification Pipeline, Model Calibration & Unified Authors UI (`apps/web/src/ui/stats-view.ts`, `viz-charts.ts`, `app.ts`, `styles.css`):**
  - Added a 5-stage **Real PostgreSQL Verification Pipeline** funnel (`Code Diff` → `git apply` → `meson compile -Dcassert` → `meson test` → `Live Patched PG SQL`) with interactive **Verification Radar** tabs (**Dark-Verified RFC**, **Bitrot / Apply Conflicts**, **Build / Test Failures**, **Live PG SQL Edge-Cases**).
  - Added **Model × Verdict & Depth Mix** (`provider/model:effort`), **Published Opinions Over Time by Depth**, **Bug Fixes vs Features vs Production-Reported** progression, and an interactive **Site Traffic** timeline sparkline.
  - Replaced the empty Reviewers/Committers cards with **Active CommitFest Authors, Quota Contributors & PG Role Split**, cross-linking CommitFest authors directly to `/hacker/<slug>` profiles with PostgreSQL role badges and per-author status bars.

## v0.3.0-alpha.17 (2026-11-26)

This release hardens parallel Dark/Medium bulk roasting after live multi-worker verification: serializes soft-lease claims on `/api/v1/contribute/next`, staggers parallel worker startups, fixes atomic cache writes, and ensures `meson test` always runs PostgreSQL's `setup` suite before targeted regression/TAP suites.

### Changes

- **Atomic Multi-Worker Queue Claiming (`apps/web/src/db.ts`, `apps/local/src/services/jobs.ts`, `src/thread/fetch.ts`):**
  - Serialized `claimNextContributePatch()` writes in `WebDatabase` so simultaneous parallel workers never claim the same `cf_id`.
  - Staggered parallel Bulk Roast worker startups (`2s` per worker) and added unique PID/random suffixes to thread-cache `.tmp` files so concurrent fetches never collide on rename.
- **PostgreSQL Meson Test Setup Suite (`src/roast/verify.ts`):**
  - Discovered available suites via `meson test --list`, validated targeted suites against them (falling back to `regress`), and always prepended `--suite setup` (`tmp_install`, `install_test_files`, `initdb_cache`) so regression and contrib tests run against the freshly compiled patched binaries.

## v0.3.0-alpha.16 (2026-11-26)

This release defines Light, Medium, and Dark roasts by actual verification depth rather than prompt tone. Medium and Dark roasts now read C/H/SQL diffs, apply patches against a local `postgres.git` worktree pool, compile PostgreSQL with `-Dcassert=true`, run targeted `meson test` suites, and—on Dark—boot an isolated patched PostgreSQL cluster to run adversarial SQL stress tests. Published opinions now include the full structured findings and a verification evidence strip.

### Changes

- **Verification Depth for Light, Medium, and Dark Roasts (`src/roast/verify.ts`, `src/roast/flavours.ts`, `src/roast/pipeline.ts`):**
  - **Light:** Reads the thread, patch prose, and 2,547 historical precedents. Reads no code and runs no build.
  - **Medium:** Extracts C/H/SQL patch hunks (`src/thread/patchprose.ts`) plus surrounding source context from `postgres.git`, runs `git apply` inside a pooled detached worktree (`~/.pgroast/verify-pool/`), builds incrementally with `meson compile` (`-Dcassert=true`), and runs targeted `meson test` suites mapped to touched subsystems.
  - **Dark:** Runs everything in Medium, then installs into a temporary directory, initializes and starts a throwaway Unix-socket PostgreSQL cluster (`listen_addresses=''`), runs LLM-proposed pure-SQL stress tests via `psql` with `statement_timeout = 10s`, checks `postgres.log` for `TRAP:`, `PANIC:`, or crashes, cleans up the cluster in `finally`, and runs a reflection pass (`rounds >= 1`).
- **Rich Published Opinions & Verification Evidence Strip (`src/publish.ts`, `apps/web`):**
  - Replaced the 5-line stub summary with `buildRichOpinionMarkdown()` (up to 16,000 chars) containing verification evidence, verdict reasoning, build/test/live-SQL results, numbered objections with severity and failure scenarios, questions, prior attempts, and unchecked items. Raised `public_opinions.summary` storage limit in `apps/web/src/db.ts` from 1,200 to 20,000 chars.
  - Added safe Markdown rendering (`renderOpinionMarkdown()`) and color-coded **Verification Evidence Strip** pills to `/patch/<cf-id>` opinion cards and **Opinions** list rows on `pgroast.postgres.ai`.
  - Updated `claimNextContributePatch()` so `medium` and `dark` runs advance naturally from unroasted open patches to patches that only have `light` (idea-only) opinions.
- **Updated Roast Level Labels Across UI & Docs (`apps/local`, `apps/web`):**
  - Updated Roast Studio cards, Bulk Roast defaults (`dark`, 2 parallel build workers), `/contribute`, `/docs`, and `/llms.txt` to reflect the Light / Medium / Dark verification tiers.

## v0.3.0-alpha.15 (2026-11-26)

This release adds interactive **CLI & API Playgrounds** (plus OpenAPI 3.1 spec at `/openapi.json`) to `/docs`, upgrades every remaining chart with hover/tap concrete-number tooltips, updates PostgreSQL git analytics through today (`upstream/master`), and fixes all Desktop + Mobile layout and SVG clipping issues found by a 36-view headless Chrome audit across both Front Office and Personal Backoffice.

### Changes

- **Stripe-Style 3-Column API Reference & CLI Playground (`/docs`, `/openapi.json`):**
  - Added a 3-column interactive **Stripe-style API Reference** to `/docs`: sticky categorized endpoint sidebar (15 endpoints across 6 groups), center documentation with inline editable parameters and `Returns` schema tables, and a sticky dark code + live response rail (`cURL` | `TypeScript` | `Python` | `CLI`) with one-click **Try It Live ▶** execution against live PostgreSQL data, backed by `GET /openapi.json` (OpenAPI 3.1.0).
  - Added an **Interactive CLI Playground** to `/docs` to compose live `npx pgroast@next ...` commands with backend, model, reasoning effort, archetype, level, and target selection, plus identity notes (`PGROAST_PUBLISH_TOKEN`).
- **Concrete-Number Hover/Tap Tooltips on All Charts (`apps/web/src/ui/hackers-view.ts`, `viz-charts.ts`):**
  - Upgraded the profile **Career Trajectory** stacked bar chart to full interactive floating hover/tap tooltips (exact authored, committed, reviewed, and reported counts per year) and fixed overlapping final-year x-axis labels (`2025`/`2026`).
- **Desktop & Mobile Layout + SVG Clipping Fixes (`apps/web`, `apps/local`):**
  - Fixed vertical `viewBox` clipping on the Stats **Status × AI Verdict Marimekko** chart (`Moved to different CF`), right-edge SVG label clipping on **Commit Sponsorship** and **30-Day Mail Velocity**, and right-edge wrapping of the **Contribution Activity** year chips on `/hacker/<slug>`.
  - Fixed mobile card & header overflow across Personal Backoffice **Stats**, **Jobs**, and **Settings** views (`390px` viewport) via strict `min-width: 0` grid guards and responsive single-column collapse.
  - Synced `postgres.git` `upstream/master` through `2026-11-26` (66,150 commits, 2,121 unified people, 154,141 credits) so Sep–Nov 2026 activity appears on every profile.

## v0.3.0-alpha.14 (2026-11-26)

This release adds explicit model version & reasoning-effort tracking in standard `provider/model:effort` format (such as `openai/gpt-6.2-astra:xhigh` and `anthropic/claude-opus-5-5`) across the CLI, Personal Backoffice, and Public App, fixes `models` persistence on opinion publish, and makes every Backoffice Jobs row clickable to both the local Workbench entry and its public opinion page.

### Changes

- **Explicit Model Version & Reasoning Effort (`src/roast/llm.ts`, `src/contribute.ts`, `src/publish.ts`):**
  - Added `model:effort` parsing (`PGROAST_CODEX_MODEL=gpt-6.2-astra:xhigh` or `--model <model> --effort <effort>`) and wired `-m <model>` + `-c model_reasoning_effort="<effort>"` into `codexArgs()` so reasoning effort is explicitly passed even with `--ignore-user-config`.
  - Standardized published model labels to `provider/model:effort` (e.g. `openai/gpt-6.2-astra:xhigh`, `anthropic/claude-opus-5-5`, `google/gemini-4-neon:xhigh`) and fixed the `models` vs `models_json` payload mismatch between `src/publish.ts` and `apps/web/src/server.ts`.
- **Public App Model Spec Display (`apps/web`):**
  - Displayed the full `provider/model:effort` spec on every `/patch/<id>` opinion card, every row of the **Opinions** tab, and **Recent Contributions** on the **Contribute** page.
- **Clickable Backoffice Jobs & Live Auto-Publish Checkbox (`apps/local`):**
  - Automatically parsed finished `contribute` and `bulk_roast` logs to populate `cf_id`, patch title, verdict, model spec, and public link, and auto-imported finished roasts into the local Backoffice database.
  - Added **Open CF #** and **Public ↗** action buttons plus verdict/published pills to every Jobs table row, added **Model** and **Reasoning Effort** pickers to the Bulk Roast card, and fixed **Run 1 Patch Now** to honor the live Auto-Publish checkbox immediately.

## v0.3.0-alpha.13 (2026-11-26)

This release adds a **Bulk Roast & Quota Burn** launcher directly inside the Personal Backoffice UI and adds copyable `npx pgroast ...` CLI equivalent bars across both the Backoffice and the Front Office.

### Changes

- **Personal Backoffice Bulk Roast UI (`apps/local`):**
  - Added `POST /api/roast/bulk` and `JobRunner.startBulkRoastJob` supporting two modes: **Community Queue** (1–4 parallel soft-leased workers calling `contribute --once`, up to 300 patches, using your saved encrypted publish token and stopping cleanly on quota limits or Cancel) and **CommitFest Batch** (parallel local CommitFest sweep with automatic DB import on finish).
  - Added a **Bulk Roast & Quota Burn** card at the top of the Backoffice **Jobs** view plus a **Bulk Roast Many →** shortcut in the **Settings → Weekly Quota Auto-Contribute** card (and raised the per-window cap input to 300).
- **Copyable `npx pgroast` CLI Equivalents Across Both Apps (`apps/local`, `apps/web`):**
  - Added live-updating, one-click copyable `npx pgroast ...` CLI bars in Backoffice **Bulk Roast**, **Roast Studio** (single roast + pushback), **Bugs Triage**, and **Settings → Auto-Contribute**.
  - Added copyable `npx pgroast ...` CLI bars in Front Office **Patch pages** (`/patch/<id>` — roast, pushback, publish), **Contribute** (`/contribute` — live Queue Previewer command + parallel bulk-burn setup), **Brief**, **Entries**, and **Docs** (`/docs` — all 15 CLI commands updated to `npx pgroast`).

## v0.3.0-alpha.12 (2026-11-26)

This release separates the Front Office into dedicated **Contribute**, **Docs**, and **Stats / Hackers / Lists** sections, replaces the basic SVG charts with editorial-grade interactive visualizations across every stats view, upgrades contributor identity resolution to merge obfuscated emails, transliteration variants, and handles, and fixes mobile leaderboard overflow.

### Changes

- **Separate Front Office Segments (`apps/web`):**
  - Split **Weekly Quota Auto-Contribute** into its own top-level **`Contribute`** tab and `/contribute` SSR route with a multi-tier coverage gauge, live queue previewer (`dry_run=1`), active leases, and 60-second AI agent setup.
  - Made **`Docs`** (`/docs`) a pure documentation hub covering the 3-piece architecture, searchable 24-feature directory, 15-command CLI reference, and Public Read-Only API reference.
- **Interactive Data Visualizations (`apps/web/src/ui/viz-charts.ts`, `viz-engine.ts`, `hackers-queries.ts`, `lists-queries.ts`):**
  - Added a shared, CSP-safe floating tooltip engine (`textContent` only) with keyboard focus and mobile tap support, plus theme-proof OKLCH chart tokens across all 8 UI themes.
  - Upgraded the **Hackers** observatory with a **PG17–PG20 Release Cycle Cumulative Race** chart (with Feature Freeze band), **Subsystem Bus-Factor Quadrant** (`1/HHI` effective committers vs. commits), **Annual Committer Concentration** 100% stacked chart with overlaid 50% bus-factor line, and **Commit Sponsorship** timeline (`own` vs. `for others` + reviews/commit ratio).
  - Upgraded `/hacker/<slug>` profiles with a **24-hour UTC Polar Clock + 7-day DOW Ring**, **3-sector Collaboration Constellation** (clickable to profiles), and **Subsystem Over-Index** ratios (`3.4×` vs. project baseline).
  - Upgraded **Stats** with a clickable **Status × AI Verdict Marimekko Mosaic** (hatched unroasted share + disagreement callouts) and **Subsystem Readiness Scatter**, and upgraded **Lists** with a **30-day Stacked Velocity + 7-day Moving Average**, per-list **14-day sparklines**, and a **Thread Heat Scatter** (messages × participants).
- **Identity Resolution v2, Contributors Parser & Mobile Leaderboard Fix (`apps/web/src/hackers.ts`, `styles.css`):**
  - Parsed obfuscated emails (`(x4mmm at yandex-team.ru)`), merged safe first-name transliterations (`Andrey Borodin` / `Andrew Borodin`), shared email local-parts across domains, middle-initial variants, and unambiguous single-word handles (`wolakk` → `Kirk Wolak`) into single unified people.
  - Fixed `parseContributorsHtml` for the real `postgresql.org/community/contributors/` layouts: parses both 2-column `<br/>` bio tables (`Core Team`, `Major Contributors`, `Past Major Contributors`) and multi-column contributor grids (`Significant Contributors`), extracting companies and emails accurately without dropping column-2 contributors (such as `Nikolay Samokhvalov`) or polluting neighbor rows' affiliations.
  - Made `syncHackersToDb` preserve `mailing_list_messages` instead of cascading truncates and automatically re-link archived messages to the rebuilt `people` table.
  - Fixed horizontal right-edge clipping in the Hackers **Leaderboards** section on narrow mobile screens via strict grid/card `min-width: 0` and `overflow-x: clip` guards.

## v0.3.0-alpha.11 (2026-11-26)

This release adds the continuously synced PostgreSQL Mailing Lists Archive (`Lists` tab & `/lists`), linking archived mailing list threads directly to unified `/hacker/<slug>` contributor profiles.

### Changes

- **Mailing Lists Archive Schema & Continuous Sync (`apps/web/src/lists.ts`, `sync-lists.ts`, `db.ts`):**
  - Added `mailing_lists` and `mailing_list_messages` tables in PostgreSQL with full-text search (GIN), list/date/thread indexes, and `person_id` foreign keys linking senders to unified `people`.
  - Built `bun run web:sync-lists` supporting automatic discovery of all 51 public PostgreSQL mailing lists, resumable incremental `/since/<YYYYMMDDHHMM>/` sync, continuous `--daemon --interval 15` polling, optional authenticated `.mbox` historical backfill (`PGROAST_PG_COOKIE` + `--mbox YYYYMM`), and a 5 GB free-disk safety guard.
- **Front Office Mailing Lists Tab & Hacker Profile Integration (`apps/web`):**
  - Added `/api/v1/lists/overview`, `/api/v1/lists/messages`, and `/lists` SSR route plus a new **`Lists`** tab showing 51 cataloged lists, 24h/7d/30d volume chart, top active threads, top posters (clickable to `/hacker/<slug>`), and searchable message browser with attachment filter.
  - Added a **Mailing Lists** activity tab to every `/hacker/<slug>` profile page showing per-list counts and recent threads.
  - Updated the Front Office `/docs` catalog to list the Mailing Lists Archive as live.

## v0.3.0-alpha.10 (2026-11-26)

This release brings the `pgroast` CLI up to date with `publish` and `contribute` (weekly OAuth quota auto-roasting for Claude, Codex, and Antigravity), adds a searchable Front Office **Docs & All Features** hub (`/docs`) with live CommitFest multi-model coverage tracking and interactive queue preview, and adds a **Weekly Quota Auto-Contribute** configuration card to the Personal Backoffice.

### Changes

- **Front Office Docs & All Features Hub (`apps/web` — `Docs` tab & `/docs`):**
  - Added a searchable, category-filterable directory of every feature across the Front Office, Weekly Quota Auto-Contribute, Personal Backoffice, CLI, and Privacy/Safety, with direct jump buttons and copyable CLI commands.
  - Added a live **Community CommitFest Coverage Progress** tracker showing baseline coverage, 1+ and 2+ multi-model opinions, unroasted open patches, Ready-for-Committer coverage, active 45-minute soft leases, backend breakdown, and top contributors.
  - Added an interactive **Preview Next Queued Patch** widget (`dry_run=1`) and a one-click AI agent setup prompt for weekly quota auto-contributing.
- **Public App Quota Work Queue (`apps/web/src/db.ts`, `server.ts`):**
  - Added `contribute_leases` table and `GET /api/v1/contribute/status` + `GET /api/v1/contribute/next` endpoints with 45-minute per-backend soft leases, strategies (`unroasted-first`, `cross-model-second-opinion`, `ready-for-committer`), topic filters, and automatic subsystem-to-archetype routing (`auto-by-subsystem`).
  - Cleaned up non-organization parentheticals (e.g. `(earlier versions)`) and stray angle brackets in `hackers.ts` identity parsing.
- **CLI Parity & Weekly Quota Auto-Roaster (`src/publish.ts`, `src/contribute.ts`, `src/cli.ts`):**
  - Added `pgroast publish <roast.json|dir>` with client-side Public-Confidentiality Hard Gate and `--dry-run` preview.
  - Added `pgroast contribute` (`--init`, `--status`, `--dry-run`, `--once`, `--auto`) with per-backend (`claude`, `codex`, `agy`) weekly UTC reset window calculations, per-window patch caps, clean usage-limit stopping, and strictly opt-in `autoPublish`.
- **Personal Backoffice Auto-Contribute Card (`apps/local`):**
  - Added `/api/contribute/state`, `PUT /api/contribute/config`, `POST /api/contribute/preview`, and `POST /api/contribute/run` endpoints plus a Settings card to manage weekly reset schedules, preview queued patches, launch streaming 1-patch runs, and inspect local contribution history.

## v0.3.0-alpha.9 (2026-11-26)

This release adds the PostgreSQL Hacking Observatory and individual `/hacker/<slug>` contributor profiles to the Public App (`apps/web`), backed by a multi-email identity resolution engine across the full `postgres.git` commit history and recognized PostgreSQL contributors.

### Changes

- **Multi-email identity resolution & git sync (`apps/web/src/hackers.ts`, `sync-hackers.ts`, `db.ts`):**
  - Added `people`, `person_identities`, `pg_commits`, `commit_credits`, and `hacker_sync_state` tables in PostgreSQL.
  - Built a Union-Find `IdentityResolver` that merges multiple email addresses, `.mailmap` aliases, diacritics (`Álvaro` / `Alvaro`), `"Last, First"` variants, known `@postgresql.org` handles, and parenthetical `(Company)` affiliations into one canonical person per contributor.
  - Added `bun run web:sync-hackers --fetch` to ingest `postgres.git` first-parent history, `Author:`, `Co-authored-by:`, `Reviewed-by:`, `Reported-by:`, `Suggested-by:`, `Tested-by:`, `Analyzed-by:`, `Discussion:`, and backpatch/revert markers, plus `postgresql.org/community/contributors/` roles.
  - Public APIs and pages never expose raw harvestable email addresses; they display only unified address counts and email domains.
- **PostgreSQL Hacking Observatory (`apps/web` — `Hackers` tab):**
  - Added interactive SVG velocity and review timelines, a 7x24 UTC hacking rhythm heatmap, subsystem activity with thin-bench ("bus factor") indicators, switchable time windows (`30d`, `90d`, `1y`, `PG20`, `PG19`, `PG18`, `5y`, `all`), and leaderboards for Committers (showing `% committed for others`), Authors, Reviewers, Bug Hunters, and Rising Stars.
  - Added a searchable contributor directory filterable by name, alias, company, domain, and PostgreSQL role.
- **Personal hacker profile pages (`/hacker/<slug>`):**
  - Added shareable `/hacker/<slug>` pages with SSR `<title>`, OpenGraph tags, `Person` JSON-LD, sitemap entries, a 52-week contribution heatmap with year switcher, career trajectory chart, subsystem DNA, UTC hour and day-of-week rhythm, longest streak, 3-way collaboration network ("Works Most With"), and recent commits, reviews, CommitFest entries, and pgroast opinions.
  - Clicking any contributor name on the `Stats` tab now resolves directly to their `/hacker/<slug>` profile (falling back to Entries search if not in git history).

## v0.3.0-alpha.8 (2026-11-26)

This release replaces living PostgreSQL committer names in the flavour picker with fictional reviewer archetypes, closes the cross-provider brief authorization edge case for Google OAuth, and scrubs the remaining internal model codename strings from CLI help and Backoffice defaults.

### Changes

- **Fictional reviewer archetypes (`src/roast/flavours.ts`, `apps/local`, `apps/web`, `README.md`):**
  - Replaced real-person flavour names with 8 fictional engineering personas: `default` (**House Blend**), `edge-case-hunter` (**The Edge-Case Hunter**), `spec-lawyer` (**The Spec Lawyer**), `systems-architect` (**The Systems Architect**), `perf-hawk` (**The Perf Hawk**), `storage-skeptic` (**The Storage Skeptic**), `index-specialist` (**The Index Specialist**), and `production-dba` (**The Production DBA**).
  - Kept silent normalization for previously stored JSON or database rows so legacy opinions render under their archetype name and never display living people's names.
- **Cross-provider brief authorization & hardening (`apps/web`):**
  - Keyed `PGROAST_WEB_BRIEF_MAINTAINERS` and `published_briefs` ownership by `provider:handle` (`published_by_provider` column) so a Google account with the same local-part cannot match a GitHub maintainer handle.
  - Added 10-second `AbortSignal.timeout` to GitHub and Google OAuth token/profile fetches and enforced `https://` for non-loopback allowed hosts in `resolveRequestOrigin`.
- **Clean defaults & CLI help (`src/cli.ts`, `apps/local`):**
  - Removed internal model codenames from `src/cli.ts` `--help` output and Backoffice `agy` model defaults, and replaced stale `pgroast.dev` / `127.0.0.1:3433` tooltip and placeholder strings with `https://pgroast.postgres.ai`.

## v0.3.0-alpha.7 (2026-11-26)

This release hardens security and authorization across `apps/web` and `apps/local`, fixes the 2-minute local install and default Claude model setup for external accounts, and improves first-time `-hackers` visitor UX on the Public App.

### Changes

- **Public App security and backend hardening (`apps/web`):**
  - Defaulted dev token minting to off unless `PGROAST_WEB_DEV_AUTH=1` is set on a loopback `PGROAST_WEB_ORIGIN`.
  - Eliminated stored XSS and `javascript:` link injection in interactive briefs (`brief.ts`) by coercing numeric fields, allowlisting `http:`/`https:` URLs, replacing `script-src 'unsafe-inline'` with a SHA-256 script hash, and adding `form-action 'self'` to the SPA CSP.
  - Restricted `POST /api/v1/publish/brief` to configured `PGROAST_WEB_BRIEF_MAINTAINERS` or the existing brief publisher so other accounts cannot overwrite briefs or bulk-modify entries.
  - Fixed `publishOpinion` to use `ON CONFLICT (cf_id) DO NOTHING` so opinion submissions never wipe `kind`, `seen_in_production`, or `workaround` on canonical entries.
  - Keyed Google and GitHub OAuth accounts by immutable `provider_user_id` (`sub` / numeric GitHub ID), required `email_verified: true` for Google, and suffixed colliding handles cleanly.
  - Allowlisted `X-Forwarded-Host` against `PGROAST_WEB_ALLOWED_HOSTS` (with `Vary: Host`) to prevent CDN cache poisoning on `/robots.txt`, `/sitemap.xml`, `/llms.txt`, and `/llms-full.txt`.
  - Added rate limits, 10-second timeouts, 4 MB streaming byte caps, in-flight deduplication, 60-second negative caching, and CPU budgets to `mr.ts` thread/diff fetches and matching.
  - Validated signed 32-bit `cf_id` bounds, fixed base64url `pgroast_pub_` token leak detection, switched `/api/v1/health` to `COUNT(*)`, fixed `$` replacement edge cases in SSR titles, separated `single_opinion` from `unanimous`, and tracked SPA patch clicks via `X-PgRoast-View: 1`.
- **Public App UX and `-hackers` visitor flow (`apps/web`):**
  - Routed first-time visitor `Setup Backoffice` CTAs to the setup guide instead of dead `127.0.0.1:3432` links while keeping clearly labeled local links for reviewers already running `bun run app:local`.
  - Replaced living committer names on the landing-page hero card with PostgreSQL subsystem lenses while keeping optional reviewer-inspired flavours (with explicit AI-guess disclaimers) in the local Backoffice.
  - Parallelized direct `/patch/<cf-id>` loads, persisted `?view=discussion|changes` in the URL, added Discussion/Changes jump buttons on baseline-only patch views, fixed `#footer-views-link` scrolling to `#site-traffic`, fixed `diff-file-nav` when filtering commented files, preserved manually opened diff files when toggling `Viewed`, disabled unconfigured OAuth buttons, added removable chips for closed statuses in Entries, and added mobile access to Team claims.
- **2-minute onboarding, default models, and Backoffice fixes (`src/`, `apps/local`, `README.md`, `.env.example`):**
  - Passed `PGPASSWORD` in `pgroast init-db`, aligned `.env.example` with `apps/local/docker-compose.yml`, and removed internal model codenames from `README.md` and Backoffice defaults (defaulting Claude critic/synth to `opus` so any Claude Code account works out of the box).
  - Updated `README.md` to describe the split between the local-only CLI and the optional Personal Backoffice accurately.
  - Added Roast Level and Hacker Flavour selectors (plus pre-filled backend) to the Backoffice Publish Opinion modal and displayed level/flavour in Model Opinions.
  - Validated `targetBranch` and shell-quoted `hetznerRemoteRepo` in `jobs.ts`, unsubscribed finished SSE streams, added `Cache-Control: no-store` to Backoffice HTML, sanitized attachment MIME headers, added fetch timeouts and full-brief confidentiality scanning in `hub.ts`, fixed Pushback backend selection, added Codex support to AI Code Review, and preserved `exp-search` focus during Explorer search refreshes.
- **Regression tests:**
  - Added P0 security and behavior tests in `apps/web/test/web.test.ts` and `apps/local/test/api.test.ts` (`201` passing tests across the monorepo).

## v0.3.0-alpha.6 (2026-11-26)

This release upgrades the Public App (`apps/web`) and Personal Backoffice (`apps/local`) with 8 UI themes, a first-visitor explainer, SEO/GEO endpoints, GitHub/GitLab-style diff-to-thread matching, a redesigned Roast Studio, Alexander Korotkov flavour with clear AI disclaimers, privacy-friendly page-view tracking, and version links in both footers.

### Changes

- **8 UI themes across both apps (`apps/web`, `apps/local`):**
  - Added a palette theme picker to the Public App (`Midnight`, `Daylight`, `Warm Paper`, `Espresso`, `Nord`, `Tokyo Night`, `Postgres Classic`, `High Contrast`) with split color swatches and dynamic iOS `<meta name="theme-color">` updates.
  - Added the new roasted-coffee **Espresso** theme to `apps/local` so both apps share the same 8 themes.
- **First-visitor onboarding & "roasted" metrics (`apps/web`):**
  - Added a collapsible **How pgroast works** guide on the landing page covering humans + AIs collaborating on CommitFest patches (and self-roasting your own drafts), roast levels, hacker flavours, and human ownership before anything goes to `pgsql-hackers`.
  - Unified Brief and Stats KPIs around the main verb **roasted** (`Roasted / Total`, `Roast coverage`, `Roasted clean`, `Community roasts`, `Not roasted`).
  - Added a tiny version link (`v0.3.0-alpha.6`) in both the Public App footer and the Backoffice sidebar footer pointing directly to the GitHub release notes.
- **GitLab/GitHub MR upgrades on `/patch/<cf-id>` (`apps/web`):**
  - Kept short inline quotes (≤ 6 lines) expanded as clean blockquotes so interleaved `-hackers` replies read naturally; collapsed only long quotes (> 6 lines) with a 1-line preview snippet.
  - Added a **Thread TL;DR & Patch History** card (start/last-active dates, opening pitch, latest reply, `v1 → v2 → v3` revision strip, and clickable participant filter chips).
  - Added best-effort **`-hackers` → diff inline comment matching** (shows quoted-line replies inline under the matched diff line, plus file-level mention drawers), a file jump strip, a `💬 Commented` filter, and per-file `Viewed` checkboxes with a review progress bar.
- **SEO, GEO & privacy-friendly hit counter (`apps/web`):**
  - Upgraded `/robots.txt` and added `/sitemap.xml` (all 736 `/patch/<cf-id>` pages + tabs), `/llms.txt`, `/llms-full.txt`, canonical links, and Schema.org JSON-LD.
  - Added a cookie-free, PII-free PostgreSQL `page_views` counter (`GET /api/v1/views` + total count in `/api/v1/health`) skipping bot user agents.
  - Added zero-downtime UI asset hot-reload on file modification and matched favicons + `apple-touch-icon.png` 1:1 to the header coffee-bean logo.
- **Roast Studio, Alexander Korotkov flavour & explicit AI disclaimers (`src/`, `apps/local`, `apps/web`):**
  - Replaced dropdowns in `apps/local` Workbench → Roast with visual Roast Level cards, Hacker Flavour tasting cards, a `🎲 Surprise me` button, a clean wrapping 2-line CTA button, and side-by-side **Brew Roast** vs. **Pushback Analysis** explanations.
  - Added **Alexander Korotkov (`alexander-korotkov`)** flavour across CLI, Backoffice, Public App, and `/llms.txt`.
  - Added explicit disclaimers everywhere (CLI reports, Backoffice, Public App, `/llms.txt`, `README.md`) making clear that hacker flavours are only AI guesses, not connected to or endorsed by the real people, and that AI makes mistakes.
  - Made `Connect Login in Setup/Settings →` clickable in Backoffice and added inline error recovery + toast feedback on `Load CFBot Diff`.

## v0.3.0-alpha.5 (2026-11-26)

This release finishes remote publishing auth for the Public App (`apps/web`), hardens the publish API, adds the roasted coffee-bean logo and iPhone Home Screen icons, and makes local PostgreSQL 19 setup work via `.env`.

### Changes

- **GitHub and Google OAuth callbacks plus team token minting (`apps/web`):**
  - Added `/auth/github/callback` and `/auth/google/callback` with CSRF `state` cookies, OAuth token exchange, contributor upsert, and a strict-CSP handoff page that shows the publish-only token once.
  - Added `POST /api/v1/admin/tokens` (gated by `PGROAST_WEB_ADMIN_SECRET`) and the CLI helper `bun run web:mint-token --handle <handle> --name "<Name>"` so a hub admin can issue team publish tokens before setting up OAuth apps.
- **Publish API hardening (`apps/web`):**
  - Added a sliding-window rate limiter (`429 Too Many Requests` with `Retry-After`) and payload size limits (`413 Payload Too Large`: 256 KB for opinions, 64 KB for coordination claims, 4 MB default for briefs).
- **Roasted coffee-bean branding and iOS Home Screen support (`apps/web`, `apps/local`):**
  - Replaced the placeholder monogram icon with a roasted coffee-bean SVG logo and distinct favicons (emerald dot for Public App, amber dot for Personal Backoffice).
  - Added `/apple-touch-icon.png` (180×180 PNG) and `/manifest.webmanifest` for iPhone Home Screen installs.
- **Local PostgreSQL 19 config and hub sync fixes (`apps/local`, root):**
  - Added `.env.example` so `bun run app:local`, `bun run app:web`, and `bun run test:all` read `PGROAST_DATABASE_URL`, `PGROAST_WEB_DATABASE_URL`, and `PGROAST_PUBLIC_HUB_URL` from `.env` automatically.
  - Fixed `publishOpinionToHub` so standard public backend tags (`claude`, `codex`, `gemini`, `grok`, `dual`, `agy`) can be published to the Public App while internal codenames, secrets, and local paths remain hard-blocked.
  - Fixed `pullOpinionsFromHub` and `addExternalOpinion` to preserve `roast_level` and `roast_flavour` when syncing opinions back to `apps/local`.
  - Read `/api/health` version dynamically from root `package.json`.
- **Tests:**
  - Added tests for GitHub and Google OAuth callbacks, CSRF state rejection, admin invite tokens, roast level/flavour publish round-trips, payload size caps, rate limiting, and PWA icon routes (`200` passing tests across the monorepo).

## v0.3.0-alpha.4 (2026-11-26)

This release adds selectable **Roast Levels (`light` / `medium` / `dark`)** and **Hacker Flavour styles (`default`, `tom-lane`, `peter-eisentraut`, `robert-haas`, `andres-freund`, `heikki-linnakangas`, `bruce-momjian`)** across the CLI, reports, Local Backoffice, and Public App opinions.

### Changes

- **Roast levels and hacker flavours (`src/roast/flavours.ts`):**
  - Added `--roast-level light|medium|dark` (alias `--level`) and `--flavour <name>` (alias `--flavor`) to both `pgroast` CLI and `pgroast batch`.
  - **Light** gives constructive, author-friendly pre-flight feedback; **Medium** keeps the balanced committer default; **Dark** runs a harsh, uncompromising adversarial stress-test on maintenance burden, demand, extensions vs. core fit, and WAL/crash/locking edge cases.
  - **Flavours** tune technical focus and voice style (`default`, `tom-lane`, `peter-eisentraut`, `robert-haas`, `andres-freund`, `heikki-linnakangas`, `bruce-momjian`) while explicitly remaining AI-simulated technical styles.
  - Every `roast.json`, `roast.md`, `roast-full.md`, and `roast-summary.txt` now records and displays `roast_level` and `roast_flavour`.
- **Personal Backoffice (`apps/local`) & Public App (`apps/web`) persistence and UI:**
  - Added **Roast Level** and **Flavour / Voice Style** pickers to `apps/local` Workbench → Roast tab and persisted both columns in PostgreSQL (`roast_runs` and `public_opinions`).
  - Displayed roast level and flavour badges on entry headers (`apps/local`) and on published community opinion cards (`/patch/<cf-id>` and `Opinions` in `apps/web`).

## v0.3.0-alpha.3 (2026-11-26)

This release adds GitLab MR-style `Discussion` and `Changes` tabs to every public patch page (`/patch/<cf-id>`) and promotes CommitFest analytics and leaderboards to a dedicated top-level **Stats** tab in the Public App (`apps/web`).

### Changes

- **GitLab MR-style `-hackers` Discussion & CFBot Diff tabs on `/patch/<cf-id>` (`apps/web/src/mr.ts`):**
  - Added `GET /api/v1/entries/:id/thread` (reusing `src/thread/parse.ts` with a 15-minute TTL cache) to render `pgsql-hackers` threads as a clean chronological MR timeline.
  - Collapsed `> quoted` email replies into expandable `<details>` folds, added inline system events when new patch revisions are uploaded (`v1`, `v2`, `v2026-09`), marked the original author with an `Author` badge, and listed downloadable patch attachment chips with quick revision-jump pills.
  - Added `GET /api/v1/entries/:id/diff` (15-minute TTL cache) to pull and render the latest unified diff from `postgresql-cfbot` (`master...cf/<id>.diff`) with file summary (`+additions / -deletions`), collapsible file cards, and syntax-tinted hunks.
  - Both tabs stay strictly read-only on the public site and link directly to your local Personal Backoffice (`http://127.0.0.1:3432/?cf=<id>`) to draft replies or comment inline.
- **First-class Public `Stats` tab (`apps/web`):**
  - Added a dedicated **Stats** tab in both desktop navigation and the iPhone bottom tab bar.
  - Includes CommitFest throughput and AI review coverage KPIs, verdict distribution donut, heat-shaded Status × Verdict matrix, PostgreSQL subsystem health bars (open, clean, and Ready for Committer signal), and clickable **Top Authors / Top Reviewers / Top Committers** leaderboards (3-column on desktop, segmented switcher on iPhone).
- **Tests:**
  - Added unit tests for `/api/v1/entries/:id` consensus, dynamic `/patch/:id` OpenGraph tags, quoted `-hackers` block splitting, and unified diff parsing (`198` total passing tests across the monorepo).

## v0.3.0-alpha.2 (2026-11-26)

This update makes the Public App (`apps/web`) work smoothly on iPhone, turns every CommitFest entry into a full patch collaboration page (`/patch/<cf-id>`), adds a clear Space Switcher between the Public App and your Personal Backoffice (`apps/local`), and fixes cross-site handoff into `http://127.0.0.1:3432`.

### Changes

- **Full public patch collaboration pages (`/patch/<cf-id>` and `/?cf=<cf-id>`):**
  - Replaced the narrow right-side drawer with a dedicated patch page that shows Common Ground & Consensus (unanimous, majority, split, or baseline pass), a visual verdict agreement bar, all contributed reviewer and AI opinions, team coordination claims, and active subsystem reviewers.
  - Added `GET /api/v1/entries/:id` with live consensus calculation and gzip compression for large JSON responses.
  - Added browser history support (`pushState` / `popstate`) so Back and iPhone swipe-back return cleanly to the previous tab.
  - Injected per-patch `<title>` and OpenGraph tags on `/patch/<cf-id>` for link previews in Slack, Telegram, and iMessage.
- **Mobile-first Linear UI for iPhone (`apps/web`):**
  - Replaced the nested iframe on the Brief tab with native SPA rendering (eliminating iOS double-scroll traps while keeping offline `.html`, `.md`, `.json`, and standalone `/embed` downloads).
  - Added a frosted-glass top header, a 5-tab iOS bottom navigation bar with `safe-area-inset-bottom` padding, 16px mobile search inputs (preventing Safari auto-zoom), DOM-only search filtering so the iOS keyboard stays open, and CF Status filter chips.
  - Added content-hashed cache-busting (`/styles.css?v=...`, `/app.js?v=...`), `favicon.svg` / `favicon.ico`, `/robots.txt`, and removed duplicate 736-entry downloads on initial load.
  - Replaced `<circle stroke-dasharray>` + negative `stroke-dashoffset` in the verdict donut with SVG `<path>` arcs to fix the 12-o'clock notch glitch on Safari/WebKit.
  - Scrubbed local host/compiler build details from public `/api/v1/health` and footer output.
- **Clear Public App ↔ Personal Backoffice navigation (`apps/web` + `apps/local`):**
  - Added a Space Switcher pill in both headers (`● Public ▾` on `apps/web`, `● Backoffice · Private ▾` on `apps/local`) with bidirectional `/patch/<cf-id>` ↔ `/?cf=<cf-id>` links and 1-tap link copying for iPhone-to-laptop handoff.
  - Fixed `apps/local` session-token injection on top-level cross-site browser navigations (`Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document`) so clicking `Work on CF … in Backoffice ↗` from a public host works on the first click while still blocking cross-site `fetch`/CORS/iframe requests. Added clean auto-reload if the local server restarts while a tab is open.
  - Fixed `PGROAST_WEB_DEV_AUTH=0` precedence in `apps/web/src/config.ts` so public tunnels run strictly read-only.
- **Documentation (`README.md`):**
  - Added a 2-minute install and update section for teammates setting up their own local Personal Backoffice.

## v0.3.0-alpha.1 (2026-11-25)

v0.3 brings the new pre-review engine (`agy` + `dual` cross-family backends, multi-thread and latest-patch ingestion, novelty grouping, CommitFest shortlists, `pgsql-bugs` triage), the local PostgreSQL-backed web workbench (`apps/local`), and the public CommitFest companion (`apps/web`) into one monorepo on `main`.

This release addresses what showed up while running v0.2 across the November 2026 CommitFest: some roasts read an older patch version, some repeated points already open on the thread, and committers needed a faster split between proposals worth attention and proposals worth closing or rethinking.

### Highlights

#### CLI engine (`src/`)

- **Cross-family model backends (`--backend agy` and `--backend dual`)**
  - Added an `agy` CLI driver for Gemini 4 Neon models (`gemini-4-neon-high`, `gemini-4-neon-xhigh`).
  - Added `--backend dual`, which splits the seven roasters between Claude Opus and Gemini 4 Neon, puts the Critic on `agy` (`gemini-4-neon-xhigh`), and runs Synthesis on Claude (`claude-mythos-5-2` or `claude-fable-5-2`). Set `PGROAST_DUAL_CRITIC_BACKEND=claude` to flip Critic and Synthesis.
  - Auto-detects `CLAUDE_CONFIG_DIR=~/.claude` when `~/.claude/.claude.json` exists and strips `GEMINI_API_KEY` and `GOOGLE_API_KEY` so every run stays on CLI subscriptions.
  - Updated `pgroast doctor` to check `claude`, `codex`, `agy`, and `dual` readiness.
- **Latest patch and full multi-thread ingestion**
  - Picks the latest patch set from any sender on the thread instead of only the original thread starter, skipping `nocfbot*` attachments.
  - Infers patch revision tags (such as `v8` or `v20251216`) from attachment filenames and records `latest_patch` metadata in `roast.json` and the report header.
  - Merges all linked mailing list threads for a CommitFest entry chronologically (unless `--blind` is passed) so continuation threads are no longer missed.
- **Novelty tracking, Critic v2, and cleaner prose**
  - Classifies surviving objections by `novelty`: `new` (not raised on the thread), `revisits_precedent` (connects to an earlier rejected attempt or revert), or `open_in_thread` (already under active discussion). Compact `roast.md` groups new and precedent findings ahead of thread-open points.
  - Separates Critic `duplicate` verdicts from `refuted` objections and allows the Critic to upgrade a `major` objection to `fatal` when warranted.
  - Strips internal tags (`[P3]`, angle IDs) from lead summaries in rendered reports.
- **CommitFest shortlist and `pgsql-bugs` triage (`pgroast shortlist`, `pgroast bugs`)**
  - Ranks a batch directory into a CommitFest Shortlist and a Top-N Closing/Rethinking list, routing shortlisted entries to active subsystem reviewers via `git log` history (`--pg-repo`).
  - Scans recent `pgsql-bugs` threads and ranks real production hits above synthetic fuzzer or AI bug-hunt reports.
- **Built-in basic skills with configurable override (`skills/`, `src/skills.ts`)**
  - Ships simple defaults for `-hackers` plain-text etiquette, isolated patch verification, and `pgsql-bugs` triage. Set `PGROAST_SKILLS_DIR` to override them with your own private skills folder.

#### Local web workbench (`apps/local`, `127.0.0.1:3432`)

- **PostgreSQL 19 / 18 native backend** via `Bun.sql` (no SQLite in runtime code; includes `apps/local/docker-compose.yml` for `postgres:19` and a one-shot SQLite migration script).
- **Linear-style lightweight UI** with 7 themes, clickable brand logo, `?` Quick Guide modal, Global Search (`⌘K`), 1-click **My Work**, saved searches, personal stars/tags/notes, and a multi-tab resizable bottom console drawer.
- **CommitFest Shortlist, Stats & Insights, and Entry Workbench** with plain-language verdicts, `CF page ↗` / `CF thread ↗` links, Bug fixes vs. Features split, Already-exists / workaround callouts, **PG Light Roast** author pre-flight checklist, and **Model Opinions & Agreement** with GitHub (`gh`) / Google (`gws`) contributor attribution.
- **Experimental `Diff & Review` tab**: pulls unified diffs from `postgresql-cfbot` (`master...cf/<id>.diff`), stores click-a-line inline review notes in PostgreSQL, and compiles them into a quoted, 72-column plain-text `-hackers` draft in Reply Studio (with 4 pre-draft safety gates; never auto-sends).
- **Decoupled Local Work Items**: private local workspaces (repro SQL, worktrees, status, optional sanitized GitHub fork issues) separated from background Jobs & Logs.
- **Localhost security hardening**: exact `Host` allowlist (DNS rebinding protection), zero CORS headers, foreign and `null` `Origin` rejection, per-boot Bearer token (`sessionStorage` + `Authorization` header), strict CSP, and offline `default-src 'none'` CSP on exported HTML snapshots.

#### Public companion site (`apps/web`, `127.0.0.1:3433`)

- **Strict `local → public` trust model**: `apps/web` never calls `127.0.0.1`. Contributors push sanitized briefs and attributed model opinions from `apps/local` using publish-only Bearer tokens, checked again by a server-side public-confidentiality gate.
- **Interactive and downloadable CommitFest briefs**: SVG verdict donut, clickable CF Status × Verdict matrix, top subsystems chart, Shortlist and Closing tables, and 1-click offline-safe `.html`, `.md`, and `.json` downloads served inside a `sandbox allow-scripts` iframe.

### Quickstart tips

You need **one** AI coding CLI signed in on your subscription (`claude`, `codex`, or `agy`), Bun 1.3.5+, and a local Postgres instance (PostgreSQL 19 or 18; `docker compose up -d` works out of the box). Nothing is posted anywhere without your explicit confirmation.

1. **CLI setup and first roast:**

```bash
bun run src/cli.ts init-db
bun run src/cli.ts doctor

# Uses whichever single AI CLI you have installed (claude > codex > agy)
bun run src/cli.ts 5879

# Preview prompts without calling any model
bun run src/cli.ts --dry-run 5879
```

2. **Start the local workbench (`http://127.0.0.1:3432`) and optional public companion (`http://127.0.0.1:3433`):**

```bash
# Optional: start PostgreSQL 19 via Docker if Postgres is not already running locally
docker compose -f apps/local/docker-compose.yml up -d

bun run app:local
bun run app:web
```

3. **Optional power-user tips:**
   - **Claude login in `~/.claude`:** if `doctor` reports an expired session while interactive `claude` works, run with `CLAUDE_CONFIG_DIR=~/.claude`.
   - **Claude model fallback:** if your account has Fable 5.2 instead of Mythos 5.2, set `export PGROAST_CRITIC_MODEL=claude-fable-5-2`.
   - **Cross-family Dual mode:** with both `claude` and `agy` signed in, pass `--backend dual`.
   - **Custom skills:** set `export PGROAST_SKILLS_DIR=~/my-skills` (or set it in `apps/local` Settings) to override the built-in defaults.

### Verification

- `bun run typecheck:all`: 0 errors across CLI, `apps/local`, and `apps/web`.
- `bun run test:all`: 197 tests passing (170 CLI + 26 `apps/local` + 1 `apps/web`).
