# pgroast — SPEC v0.1

## Original idea

> Reproduced verbatim as provided. The trailing domain line is corrected below (see **Note on domain**).

```
--- BEGIN EXISTING-CODEBASE CONTEXT ---

IMPORTANT: this repo is NOT greenfield. Your plan must CONTINUE
from what is already shipped — additive, not a re-scaffold.

Tech stack: TS
Package name: pgroast
Top-level entries: .gitignore, LICENSE, README.md, bin, bun.lock, data, docs, eval, invariants, package.json, prompts, sql, src, test, tsconfig.json
Dependencies (sample): @types/bun, typescript
Recent commits:
  - Batch index covers every finished entry in the output directory
  - pgroast batch as a CLI subcommand; version 0.2.0
  - Batch runner: roast every entry of a commitfest into a directory, resumable
  - README: get started with npx pgroast@latest
  - README: emojis in the title

PG Roast is an adversarial reviewer for Postgres proposals. It judges the idea and the design, not the code. Given a pgsql-hackers thread or a CommitFest entry, it argues why the proposal might not be accepted, the way experienced committers do: earlier attempts that were not accepted, the strongest objections with concrete failure scenarios, and the touch points that raise the risk. A critic then tries to refute every objection, and only the survivors are reported. Verdict scale: LIKELY-REJECT, NEEDS-DESIGN-DISCUSSION, NEEDS-COMMITTER-EYES, NO-FUNDAMENTAL-OBJECTION. 15 touch points. Seven roasters in parallel, then a critic, then synthesis, then checks in code. Models have no tools and never see URLs; they cite ids like P3 and code fills the links. Quotes accepted only as verbatim substrings. Precedent index = 2,547 rows (Rejected / Returned with feedback / Withdrawn CommitFest entries, revert commits, wiki "Not Worth Doing"). Output is local files only; nothing is posted to mailing lists or CommitFest. Runs via an AI coding CLI (Claude Code or Codex), Bun 1.3.5+, Postgres 18.

--- END EXISTING-CODEBASE CONTEXT ---

pgprism.dev
```

**Note on domain.** The trailer `pgprism.dev` was a mistake (confirmed in interview); the correct project domain is **pgroast.dev**. All v0.1 docs, README and package metadata use `pgroast.dev`.

## Goal & why it's needed

pgroast already roasts proposals and runs in batch (shipped v0.2.0). **Why this version exists:** proposals die on pgsql-hackers for reasons their authors could have anticipated — an idea tried and rejected before, a design that trips a known touch point, demand nobody showed. The primary user for v0.1 is **a proposal author self-checking before they post**. For that user the single worst failure — and the trust risk this version must guard — is being told "this was rejected before" about an idea that was *later accepted*: it is both factually wrong and discouraging, and it destroys trust in one shot. v0.1's headline advance is to make the precedent layer **outcome-aware** so that guard holds, and to calibrate verdicts against how threads actually resolved.

## User stories

1. **Author self-check (primary).** As a proposal author, I run `pgroast <my-thread-url>` before posting so that I get the committers' strongest surviving objections and prior attempts, and can reframe or drop the proposal privately.
2. **Precedent sanity.** As an author whose idea resembles an old rejected patch that eventually landed, I see that precedent marked **later-accepted**, so pgroast does *not* cite it against me and I trust the rest of the report.
3. **Triage saver (committer).** As a committer, I run pgroast on a CommitFest entry so that I get a ranked, critic-survived objection list in a few minutes and spend review time on the real risks.
4. **Batch calibration.** As the maintainer, I run `pgroast batch <commitfest>` over a closed CommitFest so that I can compare verdicts to real outcomes and measure agreement.

## Scope

**In scope (v0.1):** outcome-aware precedent status; a revival guard (never cite a later-accepted idea as rejected); verdict-vs-outcome calibration on closed CommitFests; `pgroast.dev` rename; English pgsql-hackers threads and CommitFest entries.

**Out of scope (explicit, per interview):** posting anything to mailing lists or CommitFest (no such code exists; none is added); non-Postgres or other-project proposals; non-English threads.

## Architecture

<!-- architecture:begin -->

```text
(architecture not yet specified)
```

<!-- architecture:end -->

| Component | Role | Boundary |
|---|---|---|
| CLI (`src/cli.ts`) | subcommands: `init-db`, `doctor`, `<cf-id\|url>`, `batch` | parses input; writes local files only |
| Precedent index (PG 18) | 2,547 rows + **new `outcome` status** | loaded via `init-db`; rebuild via `PGROAST_PG_REPO` |
| Retrieval (code) | FTS with date cutoff; excludes the proposal's own thread/CF | deterministic, no model |
| Enrichment | one-time summary + relevance call | cached |
| 7 roasters → critic → synthesis | adversarial pipeline | models have no tools; cite ids only |
| Checks (code) | verify links, ids, message numbers, verbatim quotes; tone lint | gate before files written |
| Report writer | `roast.md`, `roast-full.md`, `roast.json`, `roast-summary.txt` | local dir only |

**Key abstraction (new):** every precedent carries `outcome ∈ {rejected, returned, withdrawn, superseded, later-accepted, unknown}`. Only `rejected/returned/withdrawn/unknown` may ground a "prior attempt failed" objection; `superseded/later-accepted` are cited only as *supporting* context, never against the author.

## Implementation details

- **Outcome field.** Add `outcome` to the precedent schema (`sql/`). Populate from CommitFest end-status plus a git pass linking a reverted/returned patch to any later commit implementing the same feature (heuristic: matching thread lineage / message-id chains). Unresolvable → `unknown`.
- **Revival guard (trust-critical).** In synthesis/critic, any "tried before and rejected" objection is dropped if its grounding precedent has `outcome ∈ {superseded, later-accepted}`. Dropped objections are retained in `roast.json` with reason `precedent-later-accepted`, matching the existing refuted-objection handling, and listed at the end of `roast-full.md`.
- **Calibration.** `batch` gains a post-pass that joins each entry's verdict to its real CommitFest outcome and emits an agreement table (`calibration.json` / `.md`) in the output dir. No network outcome fetching beyond the loaded index.
- **Data flow otherwise unchanged:** brief → retrieval → enrichment → roasters → critic → synthesis → code checks → write.

## Tests plan

**Build test-first (red/green TDD):**
- `outcome` classifier mapping (CF status + git lineage → outcome) — failing table-driven tests first.
- Revival guard: fixture precedent marked `later-accepted` must never appear as a surviving "rejected before" objection — red test before guard code.
- Calibration join: verdict × outcome → agreement counts.

**CI tests:** existing 6 suites kept green; schema migration smoke test (`init-db` loads with new column); checks-layer still rejects non-verbatim quotes and bad ids; CLI arg parsing for `batch` calibration flag; `pgroast.dev` reference lint (no stray `pgprism`).

## Team

- Veteran Postgres database engineer (1) — precedent outcome classification, corpus.
- Veteran TS/Bun CLI systems engineer (1) — CLI, pipeline wiring, report writer.
- Veteran data/eval engineer (1) — calibration harness, agreement metrics.
- Veteran prompt/LLM-eval engineer (1) — critic/synthesis guard integration, tone lint.

## Implementation plan

**Sprint 1 — foundation (parallel).**
- DB engineer: design `outcome` schema + migration; author classifier spec and test fixtures (TDD red).
- CLI engineer: `pgroast.dev` rename across README/package/docs; `batch` calibration flag scaffold.

**Sprint 2 — guard + classifier (ordered after S1 schema lands).**
- DB engineer: implement classifier to green; backfill `outcome` in `init-db`.
- LLM engineer: implement revival guard in critic/synthesis against fixtures (TDD green); retain dropped objections in JSON.

**Sprint 3 — calibration + hardening (parallel).**
- Data engineer: calibration post-pass over a closed CommitFest; agreement table.
- CLI engineer: wire outputs, update reports; full CI green, docs refreshed.

## Changelog

- v0.1 — Added `outcome` to precedent index; revival guard (never cite a later-accepted idea as rejected); verdict-vs-outcome calibration in `batch`; corrected project domain to `pgroast.dev`. Continues shipped v0.2.0 (batch runner, resumable index).
