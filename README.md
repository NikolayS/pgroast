# pgroast

PG Roast is an adversarial reviewer for Postgres proposals. It judges the idea and the design, not the code.

Given a pgsql-hackers thread or a CommitFest entry, it argues why the proposal might not be accepted, the way experienced committers do: earlier attempts that were not accepted, the strongest objections with concrete failure scenarios, and the touch points that raise the risk. A critic then tries to refute every objection, and only the survivors are reported.

> Prepared by an AI harness; treat as a devil's advocate, not a verdict.

Status: prototype. Output is local files only. Nothing is posted to mailing lists or to CommitFest, and there is no code that could do so.

## What you get

`roast.md`, `roast.json` and `roast-summary.txt` in a local directory:

- a neutral restatement of the proposal;
- prior attempts from the precedent index, with links, status and who objected;
- the ranked objections that survived the critic, each with a failure scenario and what the author would need to show;
- the 15 touch points, each marked hit or not hit;
- up to 5 questions for the author;
- a verdict with a confidence, and three fields kept apart from it: `committability`, `not_now` ("not now, show demand") and `priority`.

Refuted objections stay in the JSON and are listed at the end of the Markdown with the critic's reason.

### Verdict scale

| Verdict | Meaning |
|---|---|
| `LIKELY-REJECT` | A fatal objection at the idea or design level survived the critic and cannot be overcome without making a different proposal, or the same idea was not accepted before and nothing has changed. |
| `NEEDS-DESIGN-DISCUSSION` | The goal may be fine, but the design or the demand is in question; the list needs to agree on something before code review makes sense. "Not now, show demand" goes here. |
| `NEEDS-COMMITTER-EYES` | No fundamental objection to the idea, but it touches things that only a committer who knows the area can sign off, or the remaining concerns are fixable design points. |
| `NO-FUNDAMENTAL-OBJECTION` | Nothing that survived would stop it at the idea or design level. This says nothing about the code. |

The verdict covers the review pyramid from the base up: 1a understandability, 1b desirability, 2 architecture and design. When a level fails, the levels above it are not argued. Implementation (levels 3 to 5) is out of scope. The rubric is in [prompts/committer-paranoia.md](prompts/committer-paranoia.md); its sources are in [docs/haas-paranoia-notes.md](docs/haas-paranoia-notes.md).

### Touch points

1. on-disk format / pg_upgrade
2. WAL / replication / standby
3. wire protocol
4. catalog changes
5. ABI / extension API
6. SQL-standard conflict or non-standard syntax
7. new GUC
8. planner behaviour change
9. pg_dump / restore round-trip
10. psql UX conventions
11. security / privileges
12. backpatchability
13. maintenance burden ("who maintains this in 10 years")
14. performance on the hot path
15. doesn't fit what Postgres is about (extension / external tool / already solved)

## How it works

1. **Brief**: a neutral restatement and the search queries for precedents.
2. **Retrieval**, in code: full-text search over the precedent index, with a date cutoff. The proposal's own thread and CommitFest entry are excluded.
3. **Enrichment**: precedent threads without a recorded reason are summarised once and cached. A relevance call decides which candidates the roasters see.
4. **Seven roasters** in parallel, one angle each: prior attempts, standards and compatibility, replication and on-disk, security, maintenance and fit, already exists, demand.
5. **Critic**: tries to refute every objection.
6. **Synthesis**: applies the stop rule, picks the verdict, fills the touch points and the questions.
7. **Checks in code**: links, precedent ids, message numbers and quotes are verified; a tone lint runs; then the files are written.

The models have no tools. They never see a URL: they cite ids such as `P3`, and code fills in the links from the database. Quotes are accepted only as verbatim substrings of the author's own text. Free prose is not fact-checked by code.

The precedent index holds 2,547 rows: CommitFest entries that ended Rejected, Returned with feedback or Withdrawn, revert commits from the Postgres git history, and the wiki page "Not Worth Doing". See [docs/corpus.md](docs/corpus.md).

Full design: [docs/design.md](docs/design.md).

## Requirements

1. **An AI coding CLI, installed and signed in with your subscription.** One of:
   - [Claude Code](https://claude.com/claude-code): install it, run `claude` once and sign in (`/login`). The account needs access to Opus, and to Mythos 5.2 or Fable 5.2.
   - Codex CLI: install it and run `codex login`.

   PG Roast starts that CLI for every model call, so the calls count toward the limits of the account the CLI is signed in to. A roast is 12 to 20 calls. No API key is needed or used: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` and `CODEX_API_KEY` are removed from the CLI's environment, and a call fails if the CLI reports that it is using a key.
2. **[Bun](https://bun.sh) 1.3.5 or later.** There are no npm dependencies.
3. **Postgres 18** with `psql` on the PATH, for the precedent index (database `pgroast`; `PGROAST_DSN` if it is not on the local socket).
4. A clone of the Postgres repository, only if you rebuild the index (`PGROAST_PG_REPO`).

## Quick start

```
git clone https://github.com/NikolayS/pgroast && cd pgroast
createdb pgroast && gunzip -c data/precedents.sql.gz | psql -d pgroast
bun run src/cli.ts doctor            # checks both CLIs and their login
bun run src/cli.ts <cf-id|thread-url>
```

`doctor` makes one small call on each installed CLI and says which backends are usable. If it reports a sign-in problem, run `claude` (then `/login`) or `codex login` and try again.

Models on the claude backend: roasters run on `opus` (`PGROAST_ROASTER_MODEL`), critic and synthesis on `claude-mythos-5-2` (`PGROAST_CRITIC_MODEL`). If your account does not have Mythos 5.2, use Fable 5.2, which is the same underlying model:

```
export PGROAST_CRITIC_MODEL=claude-fable-5-2
```

Only Opus, Mythos and Fable models are accepted on the claude backend. To use Codex instead, pass `--backend codex`.

## Run

```
bun run src/cli.ts <cf-id|cf-url|message-id|thread-url> [options]
bun run src/cli.ts --self --proposal FILE [--patch FILE ...]
bun run src/cli.ts page <roast.json> [--out FILE] [--site DIR [--base-url URL]]
bun run src/cli.ts doctor
```

| Option | Meaning |
|---|---|
| `--blind N` | read only the first N messages of the thread |
| `--before YYYY-MM-DD` | read only messages before the date (UTC); also the precedent cutoff |
| `--hint TEXT` | directed precedent lookup |
| `--out DIR` | output directory; default `out/<slug>` |
| `--backend claude\|codex` | which installed CLI runs the model |
| `--self` | your own proposal before you send it; with `--proposal FILE` for a draft that has no thread yet |
| `--rounds N` | extra reflection rounds after the first pass, default 0 |
| `--no-enrich` | skip the reading of precedent threads and the relevance pass |
| `--dry-run` | build every prompt, call no model |
| `--offline` | use only cached pages |

A roast at `--rounds 0` makes 11 model calls, plus up to 8 for enrichment, and takes a few minutes.

Fetching is polite: a generic User-Agent, at least 1 s between requests per host, read-only, no sign-in, and every page is cached under `data/cache/`.

## Evaluation

`eval/cases.json` holds 18 historical proposals with a known outcome (rejected, accepted, reverted). The roaster reads only the first messages of each thread, and precedents are cut off at that date. The scoring rules were fixed before any result existed: [docs/eval.md](docs/eval.md).

```
bun run src/eval/cli.ts run --run-id ID [--case a,b] [--concurrency 2]
bun run src/eval/cli.ts score ID
```

## Limits

- Models may remember how a well-known old thread ended. Blind mode cannot remove that. Only 2 of the 18 eval cases started after the models' training cutoff.
- Only idea and design are judged. A problem that shows up in the implementation is out of reach.
- The index does not hold list-only threads that never had a CommitFest entry, and search is keyword-based.
- The tone lint is a word list.
- Only the earliest thread of a multi-thread CommitFest entry is read.

## Tests

```
bun test
bunx tsc --noEmit
```

## License

Apache 2.0, see [LICENSE](LICENSE).
