# pgroast-web (`pgroast.dev`)

Public PostgreSQL CommitFest pre-review & triage companion — built on Bun, TypeScript, and **PostgreSQL 19** (`Bun.sql`).

## Security Architecture (Local → Public Only)
- `pgroast-web` **never** sends API calls to your local `127.0.0.1` workbench.
- Individual reviewers run `pgroast-app` locally and push sanitized opinions or briefs to `pgroast-web` using a per-user **publish-only** Bearer token (`pgroast_pub_...`).
- Every published payload passes a server-side **Public-Confidentiality Hard Gate** blocking local paths, cookies, tokens, and internal model codenames.
- Interactive HTML briefs are served under `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; ...`, and downloadable `.html` copies carry an offline `<meta>` CSP blocking all network access.

## Quick Start

```bash
docker compose up -d # optional if local PostgreSQL 19 isn't already running
bun run src/server.ts
```

Opens at `http://127.0.0.1:3433`.
