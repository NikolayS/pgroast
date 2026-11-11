# PG Roast: design of the roast pipeline

PG Roast judges an idea, not code. Input: one CommitFest entry or one pgsql-hackers thread.
Output: two local files, `roast.json` and `roast.md`. It never posts anything anywhere.

This document covers the thread input layer (`src/thread`), the roast pipeline (`src/roast`)
and the CLI (`src/cli.ts`). The precedent corpus is described in `docs/corpus.md`; the review
rubric is `prompts/committer-paranoia.md` (notes: `docs/haas-paranoia-notes.md`).

## Usage

```
bun run src/cli.ts <cf-id|cf-url|message-id|thread-url> [--blind N] [--before DATE] [--hint TEXT] [--out DIR] [--backend claude|codex] [--dry-run] [--offline]
bun run src/cli.ts doctor
```

| Option | Meaning |
|---|---|
| `--blind N` | read only the first N messages of the thread |
| `--before YYYY-MM-DD` | read only messages strictly before the date (UTC); also the precedent cutoff |
| `--hint TEXT` | directed precedent lookup ("the 2018 suggestion of doing X") |
| `--out DIR` | output directory; default `out/<slug>` (`cf-7608`, `cf-5253-blind5`, `msg-<id>`) |
| `--backend claude\|codex` | which installed CLI runs the model; default `PGROAST_BACKEND`, else claude if on PATH, else codex |
| `--dry-run` | build and print every prompt, call no model; outputs hold placeholders |
| `--offline` | use only cached pages |

`doctor` reports, for each CLI: whether it is on PATH, its version, and whether a trivial
completion works; when one fails it says to run `claude` (and sign in) or `codex login`.

Environment: `PGROAST_BACKEND`; `PGROAST_ROASTER_MODEL` (default `opus`; also the brief) and
`PGROAST_CRITIC_MODEL` (default `claude-mythos-5-2`; also the synthesis) for the claude backend;
`PGROAST_CODEX_MODEL` for the codex backend (default: the model configured in the Codex CLI);
`PGROAST_CONCURRENCY` (3), `PGROAST_LLM_TIMEOUT_MS` (900000), `PGROAST_CLAUDE_BIN`,
`PGROAST_CODEX_BIN`, `PGROAST_DSN` (corpus DB).

On the claude backend only Opus and Mythos models are accepted; anything else is an error before
any call is made. No API key is read, needed or used (see "LLM backend").

Output directory:

```
out/<slug>/roast.json     the result (type Roast, src/roast/schema.ts)
out/<slug>/roast.md       rendered from roast.json by code
out/<slug>/llm/NN-<stage>.prompt.txt | .response.txt | .meta.json   every prompt and reply
```

## Pipeline

```
input ──> thread loader ──> brief (LLM) ──> retrieval (code) ──> 7 roasters (LLM, parallel)
                                                                        │
                roast.md <── render (code) <── assembly (code) <── synthesis (LLM) <── critic (LLM)
```

10 LLM calls for one roast (9 when no roaster raises anything: the critic is skipped), plus at
most one repair call per stage when a reply is not valid JSON.

### 0. Thread loader (`src/thread`)

- `parseInputRef`: a number or a `commitfest.postgresql.org/patch/<id>/` URL is a CommitFest
  entry; a `postgresql.org/message-id/...` or `postgr.es/m/...` URL, or a bare message-id, is a
  thread.
- CommitFest page → title, status per CommitFest, authors, reviewers, committer, tags, thread
  links, history. When the entry has several threads, the one that started first is read and
  the others are listed in a warning.
- `https://www.postgresql.org/message-id/flat/<msgid>` → messages: index, message-id, permalink,
  from, date (ISO, UTC), subject, body text, attachments (name, URL, type, size).
- Attachments: only those of the first visible message that has a patch and of the thread
  starter's latest visible patch set; at most 8 files, 1.5 MiB each; text files only.
  `extractPatchProse` keeps the commit message of each `git format-patch` mail, the list of
  touched paths, and diff hunks for `doc/`, `README*`, `*.md`, `*.sgml`, `*.rst`, `*.txt`.
  Code hunks are dropped in code, before any prompt is built. There is no line-level code review.
- `--blind N` and `--before DATE` filter the messages (both may apply). Attachments are taken
  from visible messages only. The CommitFest entry is redacted in these modes: status,
  reviewers, committer, target version and links are removed, and the history is removed
  (`--blind`) or cut at the date (`--before`).
- Fetching (`fetch.ts`): GET only, no credentials, hosts limited to `www.postgresql.org`,
  `postgr.es`, `commitfest.postgresql.org`; User-Agent `pgroast/0.1`; requests to one host are
  serialised with at least 1.1 s between them; 429 / 5xx / network errors are retried with
  exponential backoff (5 s, 10 s, ... up to 5 min; `Retry-After` is honoured); every page is
  cached under `data/cache/threads/<host>/` and a cached page is never fetched again (404s are
  cached too). To refresh a live thread, delete its cache file.

### a. Brief (1 call, roaster model)

Neutral restatement: problem, proposed design, user-visible surface, author's claims, thread
state, what is unclear, and 5 to 8 keyword queries for the precedent search. Prompt: `prompts/brief.md`.

### b. Retrieval (code, `src/roast/precedents.ts`)

The queries go to the corpus through a thin adapter:

1. `src/corpus/search.ts` → `searchPrecedents({query, before, limit, includeUndated})` (Postgres
   database `pgroast`, `PGROAST_DSN`);
2. when the module or the database is not there: no precedents, and the roast says "the corpus
   was NOT searched", which is not "no precedent found".

Per query the top 8 rows are taken (16 for the hint). Rows are merged by reciprocal rank
(`1/(10+rank)`, summed over queries) times a recency factor (1.5 for a decision at the cutoff,
falling to 1.0 at 15 years: "don't dig too deep into history" by default). `--hint` is run as an
extra query; its rows get weight 3, doubled again when their year is a year named in the hint.
The top 15 become `P1..P15`.

Cutoff: `before` = the `--before` date, or else the date of the thread's first message. It is
passed to the backend and checked again in the adapter: a row with any date on or after the
cutoff is dropped. Undated rows (wiki "not wanted" items) are used only in a normal run, never
with `--blind` / `--before`. The proposal's own CommitFest entry and thread are removed.

### c. Roasters (7 calls, roaster model, in parallel, concurrency 3)

One angle each: `prior-attempts`, `standards-compat`, `replication-ondisk`, `security`,
`maintenance-fit`, `already-exists`, `demand`. System prompt = `prompts/roaster-common.md` +
the rubric file read from disk, verbatim + `prompts/roaster-<angle>.md` + the output contract.
The user prompt is the same for all seven: review date, brief, material, precedent list.

Each returns at most 4 objections (zero is valid and said so): title, pyramid level (`1a`, `1b`,
`2`), rubric item, category, touch points, severity (`fatal` | `fixable`), failure scenario,
argument, precedent ids, thread message numbers, what the author must show. The prior-attempts
roaster also returns candidate prior attempts. A roaster that fails is reported in `warnings`
and `roaster_notes`; the run goes on unless all seven fail.

### d. Critic (1 call, critic model)

Sees the same material plus all objections, and tries to refute each: wrong facts, precedent
mismatch, outdated reason, already handled, not specific, no failure scenario. One verdict per
objection: `survived` | `refuted`, with reasoning; it may change the severity of a survivor. An
objection the critic forgot stays `survived` and is flagged as unchecked.

### e. Synthesis (1 call, synthesis model) and assembly (code)

The model picks the failing level, ranks surviving objections, picks the verdict and confidence,
marks the 15 touch points, writes at most 5 questions, the final prior-attempt list, the
committability object and the "not now" flag. Then `assemble()` enforces, in code:

- Only surviving objections can be ranked; at most 5.
- Base-up stop rule (the rubric's operating rule): with a failing level L, objections above L
  are moved out of the list to `other_surviving` with the reason "not evaluated", and `levels`
  reports each level as `passed`, `failed` or `not_evaluated`. A ranked fatal objection forces a
  failing level if the model named none.
- Verdict guards: `LIKELY-REJECT` needs a surviving fatal objection in the list or a `same_idea`
  prior attempt, else it becomes `NEEDS-DESIGN-DISCUSSION`; `NO-FUNDAMENTAL-OBJECTION` cannot
  stand next to a listed fatal objection. Each change is recorded in `warnings`.
- Touch points: all 15, once each, in the issue's order; a missing one is "not hit" plus a
  warning; a listed objection about a touch point forces `hit`.
- Prior attempts: link, thread links, dates, status and "who objected" are copied from the
  corpus row. The model supplies only the row id, the relation, "what is different" and a quote.
- The disclosure line is a constant in `schema.ts`, written by code.

Verdict, committability and "not now" are three separate things (rubric, last section):

- `verdict` is one of the issue's four values and covers the merits of the idea and design only
  (levels 1a, 1b, 2).
- `committability` = `{owner, owner_note, liability, author_follow_up}`, with `owner` one of
  `qualified committer engaged` | `silent` | `none obvious`. It is filled for every verdict. No
  code path lets it change the verdict, and the verdict guard above means a weak
  committability cannot produce `LIKELY-REJECT`: that needs a surviving fatal objection or a
  same-idea prior attempt.
- `not_now` = `{applies, evidence_that_would_change_it}`: "not now, show demand", used when only
  the demand / accumulation items fail. It is not a fifth verdict value.

`roast.md` is rendered from `roast.json` by `render.ts`. There is no second model call, so the
two files cannot disagree. Refuted objections stay in the JSON (`refuted`) and are listed at
the end of the Markdown with the critic's reason.

## LLM backend (`src/roast/llm.ts`)

One function: `backend.complete({system, prompt, model, schema, label}) → parsed JSON`.

PG Roast runs on an installed Claude Code or Codex CLI, on the user's subscription login. It
never uses API tokens: no API key variable is read anywhere, and `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` and `CODEX_API_KEY` are removed from the environment of
every spawned CLI (`childEnv`). `CliBackend` runs the CLI once per call, in an empty temporary
directory, with the prompt on stdin.

### claude backend

```
claude -p --model <m> --system-prompt <system> --tools "" --strict-mcp-config --safe-mode \
       --disable-slash-commands --no-session-persistence --output-format stream-json --verbose
```

- `--tools ""` removes all built-in tools; `--strict-mcp-config` with no config removes all MCP
  servers; `--safe-mode` removes CLAUDE.md, skills, plugins, hooks and custom agents.
- This is verified on every call, not assumed: the `init` event of the stream lists the
  session's tools and MCP servers, and the call fails if either list is not empty, if any
  assistant message holds a tool call, if the session reports an API key as its credential
  source, or if the answering model is not Opus or Mythos.

### codex backend

```
codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules \
      -s read-only -C <empty dir> -c web_search="disabled" \
      --disable shell_tool --disable unified_exec --disable apps --disable plugins \
      --disable browser_use --disable computer_use --disable in_app_browser \
      --disable image_generation --disable tool_suggest --disable skill_search --disable memories \
      [-m <PGROAST_CODEX_MODEL>] -
```

- `codex exec` has no single "no tools" switch and no system-prompt flag. The system text is
  put in front of the prompt. Tools are removed in layers: the feature flags above, no user
  config (so no user MCP servers), a read-only sandbox (no network, no writes) and an empty
  working directory.
- The check that counts is on the output: the JSONL event stream is read, and the call fails if
  it holds any item other than a message or reasoning (a command, a web search, an MCP call, a
  file change). So a reply is used only when the model looked nothing up.
- The model is `PGROAST_CODEX_MODEL` or, when unset, whatever the Codex CLI is configured to
  use; PG Roast does not guess model names. The Opus/Mythos rule applies to the claude backend
  only. The codex CLI reports no cost, so `stats.cost_usd` is null.
- Status: the codex backend passed `pgroast doctor` (one trivial completion). A full roast has
  been run on the claude backend only; the prompts were written for and tried on Claude models.

### Both backends

- The reply is parsed (`extractJson`: first complete JSON object, fences and prose tolerated) and
  validated against the stage schema with the validator in `schema.ts`. On failure there is
  exactly one repair call (the same prompt plus the validator's errors and the bad reply); a
  second failure is an error.
- A semaphore limits concurrent calls (default 3); each call has a timeout (default 15 min).
- Every prompt, reply and metadata record (backend, model, wall time, cost, usage, validation
  errors) is written to `out/<run>/llm/`.
- When a call fails and the output looks like a login problem, the error says which command to
  run (`claude`, then sign in; or `codex login`).

`DryRunBackend` prints each prompt and returns a stub that fits the schema; in a dry run the
precedent search uses the thread subject as the query so the later prompts are realistic.

## Schemas (`src/roast/schema.ts`)

The eval runner should import from this file: `Roast`, `FinalObjection`, `PriorAttempt`,
`Verdict`, `VERDICTS`, `TOUCH_POINTS`, `LEVELS`, `DISCLOSURE`, `validate`.

`Roast` (roast.json), main fields:

| Field | Content |
|---|---|
| `verdict` | `LIKELY-REJECT` \| `NEEDS-DESIGN-DISCUSSION` \| `NEEDS-COMMITTER-EYES` \| `NO-FUNDAMENTAL-OBJECTION` |
| `confidence` | `low` \| `medium` \| `high` |
| `verdict_reasoning`, `failing_level`, `levels` | why; first failing pyramid level or null; per level `passed` \| `failed` \| `not_evaluated` |
| `backend`, `models` | which CLI and which models ran |
| `input` | argument, CommitFest entry (redacted in eval modes), thread URL, messages read / total, `blind`, `before`, `hint`, attachments read |
| `brief` | the neutral restatement and the search queries |
| `prior_attempts[]` | `url`, `thread_urls`, `date`, `first_date`, `status`, `who_objected`, `quote` (or null = unavailable), `relation`, `what_is_different`; empty = no precedent found |
| `objections[]` | the ranked steelman: `id`, `angle`, `title`, `level`, `rubric_item`, `category`, `touch_points`, `severity`, `failure_scenario`, `argument`, `author_must_show`, `precedents[]` (links from the DB), `thread_refs[]`, `critic` |
| `other_surviving[]` | survived the critic, not listed (`not_ranked_reason`) |
| `refuted[]` | with `critic.refutation_kind` and `critic.reasoning` |
| `touch_points[15]` | `id`, `label`, `hit`, `reason` |
| `questions[≤5]` | questions the author must answer before anyone reviews code |
| `committability` | `owner` (`qualified committer engaged` \| `silent` \| `none obvious`), `owner_note`, `liability`, `author_follow_up` |
| `not_now` | `applies`, `evidence_that_would_change_it` |
| `disclosure` | the issue's line, verbatim |
| `precedents_retrieved[]`, `precedent_cutoff`, `precedent_backend` | audit of the retrieval |
| `roaster_notes[]`, `warnings[]`, `sanitizer`, `stats` | audit of the run (calls, wall time, cost) |

Stage schemas (`BRIEF_SCHEMA`, `ROASTER_SCHEMA`, `CRITIC_SCHEMA`, `SYNTH_SCHEMA`) are a small
JSON Schema subset (object, array, string with enum, integer, boolean, nullable, min/max items)
with a 60-line validator. They are also rendered into each prompt as the output contract, so the
contract in the prompt and the check in code are the same object.

For the eval runner: "found the objection that killed it" should be matched against
`objections` first, then `other_surviving`, then `refuted` (an objection the critic wrongly
refuted is a critic error, not a roaster miss).

## Anti-hallucination guarantees

What is guaranteed by code, whatever the model writes:

1. **The model has no tools.** It cannot search, fetch or read files; checked on every call
   (see above; on the codex backend the check is "no tool was used", read from the event
   stream). All retrieval is done by our code.
2. **Precedent links come only from the corpus.** The model never sees precedent URLs: the
   prompt shows `[P3]`, title, outcome, dates and recorded reason. The model cites `P3`; code
   resolves it to the row and copies `url` and `thread_urls` from it. An id that is not in the
   retrieved list is dropped and recorded (`sanitizer.precedent_ids_dropped`).
3. **Any other URL is removed.** Every string of every model reply is scanned for URLs (with a
   scheme, and scheme-less forms of postgresql.org archives, postgr.es, commitfest, git, wiki,
   github, youtube). A URL stays only if it is in the allowed set: the thread, its messages,
   links written inside the visible thread text and patch prose, the CommitFest entry, the
   retrieved precedents, links in the rubric. Otherwise it is replaced by
   `[link removed: not in the retrieved set]` and recorded (`sanitizer.urls_removed`; this audit
   list is the only place where a removed URL still appears).
4. **Thread references are by message number**; code turns a number into the permalink.
   Numbers outside the visible thread are dropped.
5. **Quotes are verified.** A prior attempt's quote is kept only if it occurs verbatim
   (whitespace, quote style and case folded; `...` allowed between parts) in the corpus row or
   in the visible thread. Otherwise the output says "quote unavailable".
6. **"Who objected" and dates of a prior attempt are copied from the corpus row.** When the row
   has none, the output says "not recorded in the corpus".
7. **"No precedent found" is distinct from "not searched".** When the corpus is unavailable the
   roast says so in section 2 and in `warnings`.
8. **Nothing from the future.** Precedents dated on or after the cutoff are dropped twice
   (backend and adapter); the proposal's own entry is dropped; in eval modes the CommitFest
   status and history are redacted and the review date given to the model is the date of the
   last visible message.

What is not guaranteed:

- Prose. A model can still write "this was discussed many times" or name a person's opinion
  without a link. The prompts forbid evidence from memory, the critic is told to refute
  unsupported claims, and precedent-backed objections are visibly different from bare ones
  ("Precedents. None cited."), but free text is not fact-checked by code.
- Bare message-ids, commit hashes and CommitFest numbers written as plain text (not URLs) are
  not removed.
- The match between a precedent and the proposal is a model judgment (roaster, then critic,
  then synthesis). The link is real; whether it is relevant can be wrong.
- Facts about PostgreSQL internals in a failure scenario come from the model. The critic checks
  them, with the same kind of model.

## Known weaknesses

- **Training-data memory of famous threads.** The models have read pgsql-hackers. For a
  well-known historical proposal the model may remember who objected and how it ended, whatever
  we show it. Blind mode helps with part of this and not with the rest:
  - It does help against anchoring on the visible discussion: the objections, the tone of
    senior people and the outcome are not in the prompt; the CommitFest status and history are
    redacted; precedents are cut off at the thread start; the model has no tools to look
    anything up; the prompts say not to use memory of the thread.
  - It does not make the model forget. An instruction is not a guarantee, and a match on a
    famous case may be recall, not judgment. So eval results on famous historical threads are
    an upper bound. Treat them with care, and prefer cases that are (a) after the model's
    training cutoff, where recall is impossible, or (b) obscure. Reporting accuracy separately
    for pre-cutoff and post-cutoff cases shows the size of the effect. The reverse leak also
    exists: a proposal that was rejected in 2015 and committed in 2022 may be judged by what the
    model knows of today's PostgreSQL.
- **Corpus coverage decides the "prior attempts" section.** Retrieval is keyword search over
  titles, summaries and recorded reasons. Many CommitFest rows have no recorded objection text,
  so a real prior attempt can be found and still show "quote unavailable" and "who objected:
  not recorded". Ideas that died on the list without a CommitFest entry are not in the corpus.
  Prior discussions that the thread itself links to are visible to the roasters (and their links
  are allowed), but they are not listed as structured prior attempts.
- **Only one thread per CommitFest entry** is read (the earliest). Long-lived entries with
  several threads lose the later ones.
- **Long threads are cut.** The first message is kept up to 30 000 characters, other messages up
  to 6 000 with long quoted runs collapsed; above 150 000 characters in total the middle of the
  thread is left out (first ten and the newest are kept) and a warning says so.
- **The cache never expires.** A live thread that got new mail is stale until its cache file is
  deleted.
- **Levels 1-2 without the code are provisional** (the rubric says so). The synthesis has a
  `provisional_note` for it; a design flaw that only shows in the code will be missed.
- **One critic, one pass.** The critic and the synthesis run on the same model family as the
  roasters and share its blind spots. There is no vote and no second run; results vary between
  runs.
- **`--before` uses UTC dates** from the archive; a message sent late in the evening in a
  western time zone is dated the next day.
- **Cost.** 10 calls, each with the rubric and the full material in the prompt. A short thread
  takes a few minutes; a 100-message thread is roughly 40 000 input tokens per call.

## Tests

`bun test test/thread.test.ts test/roast.test.ts`. Thread tests use two saved pages
(`test/thread-fixtures/`: a flat thread and a CommitFest patch page) and a small synthetic
patch. Roast tests run the whole pipeline with a fake model that returns fabricated links,
unknown precedent ids, a bad quote and a broken ranking, and check that code removes them; the
real CLI backends are tested through their stream parsers, their argument lists and an injected
runner. No test calls a model or the network.
