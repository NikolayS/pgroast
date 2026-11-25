# pgroast-app

Local-first web workbench for PostgreSQL CommitFest, `pgsql-hackers`, and `pgsql-bugs` review workflows — driven by **any single AI coding CLI** (`claude`, `codex`, or `agy`) or optional cross-family **Dual mode** (`claude` + `agy`), under strict human supervision.

> Localhost only (`127.0.0.1:3432`). Never auto-sends email. Every external write (CommitFest mutations, fork issues, CI pushes, Gmail drafts) requires explicit human confirmation.

## Quick Start

Requires local PostgreSQL 19 (Homebrew `brew services start postgresql@19`, `docker compose up -d`, or any `DATABASE_URL`):

```bash
# Optional: start PostgreSQL 19 via Docker if not already installed locally
docker compose up -d

bun run src/server.ts
```

Open `http://127.0.0.1:3432` in your browser. On first launch, the **4-step Setup Guide** walks you through:

1. **Profile (optional):** your name (for email sign-offs), CommitFest username, GitHub fork, and email — stored strictly in local PostgreSQL (`pgroast_app`).
2. **AI CLI (only 1 needed):** auto-detects `claude`, `codex`, or `agy` on your PATH. Dual cross-family mode unlocks automatically if you have both `claude` and `agy`.
3. **Skills & Local Repos:** uses **Built-in Basic Skills** out of the box (plain-text `-hackers` etiquette, isolated patch verification, `pgsql-bugs` triage). Optionally point to your own private skills folder to override or extend them.
4. **Optional Integrations:** click-by-click guides for PostgreSQL Community / CommitFest cookies, Gmail drafts (`gws`), and GitHub fork sync (`gh`).

## Features

1. **Shortlist & Triage (`1`):**
   - **Top 20 CommitFest Shortlist** ranked by value, review cost, and novelty, with `git log` subsystem reviewer suggestions.
   - **Top 50 Worth Closing / Rethinking** with concrete reasons and actionable next steps for authors.
   - One-click Markdown digest export (`/api/shortlist?format=markdown`).
2. **CommitFest Explorer (`2`):**
   - Live CommitFest sync via `commitfest.postgresql.org/api/v1/` (read-only works with zero login).
   - Optional encrypted PostgreSQL Community cookie login (`sessionid` + `csrftoken`, AES-256-GCM in local PostgreSQL) for `/me/` queue sync and confirmed mutations.
3. **Entry Deep-Dive & Workbench (`3`):**
   - **Roast & Pushback:** novelty-grouped objections (`NEW`, `REVISITS PRECEDENT`, `OPEN IN THREAD`) and `pgroast v2` launcher.
   - **Build, Test & AI Review:** isolated `git worktree` + ephemeral `PGPORT` + `meson`/`ninja` debug/cassert builds, single-AI or blind cross-family review, and optional Hetzner SSH runner.
   - **Reply Studio (`gws`):** Gmail thread search, built-in or custom-skill plain-text draft generator, and 4 deterministic safety gates (Public Confidentiality, `cfbot` attachment guard, Plain-Text Etiquette, Duplicate/Freshness) before saving an unsent Gmail Draft.
   - **CommitFest & Fork Sync:** guarded CommitFest actions and sanitized issue/CI branch sync to your configured PostgreSQL fork.
4. **`pgsql-bugs` Production Triage (`4`):**
   - Scans recent `pgsql-bugs` threads and separates production hits from synthetic fuzzer/AI bug hunts.
5. **Multi-Tab Resizable Job Console & Jobs View (`5`):**
   - Concurrent SSE streaming tabs (never loses previous consoles), drag-to-resize handle, minimize/maximize controls, and full job history.
6. **Settings, Doctor & Setup Guide (`6`):**
   - Single-AI-first environment health checks with inline copy-paste setup snippets and direct links.

## Environment Overrides (Optional)

All settings can be configured in the web UI (Setup Guide or Settings & Health) and are stored locally in PostgreSQL (`pgroast_app`). Optional env defaults:

| Env Var | Default | Purpose |
|---|---|---|
| `PGROAST_DATABASE_URL` | `postgres://localhost:5432/pgroast_app` | PostgreSQL connection string (also honors `DATABASE_URL`) |
| `PGROAST_APP_PORT` | `3432` | Localhost port |
| `PGROAST_REPO` | `../pgroast` | Path to `pgroast` v2 CLI repo |
| `PGROAST_POSTGRES_REPO` | auto-detected | Local PostgreSQL git clone (for worktrees & expert routing) |
| `PGROAST_SKILLS_REPO` | *(empty = built-in)* | Optional custom skills folder overriding built-in defaults |
| `PGROAST_AUTHOR_NAME` | *(empty)* | Your name for draft email sign-offs |
| `PGROAST_CF_USERNAME` | *(empty)* | Your PostgreSQL community username |
| `PGROAST_GITHUB_FORK` | *(empty)* | Your fork (`you/postgres`) for sanitized issues & CI branches |
| `PGROAST_GMAIL_ACCOUNT` | *(empty)* | Gmail account used by `gws` |

## Tests

```bash
bun test
./node_modules/.bin/tsc --noEmit
```
