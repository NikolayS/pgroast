# Changelog

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
