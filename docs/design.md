# PG Roast: design of the roast pipeline

PG Roast judges an idea, not code. Input: one CommitFest entry, one pgsql-hackers thread, or
(self mode) a draft email on disk. Output: local files, `roast.json`, `roast.md` and
`roast-summary.txt`. It never posts anything anywhere.

This document covers the thread input layer (`src/thread`), the roast pipeline (`src/roast`)
and the CLI (`src/cli.ts`). The precedent corpus is described in `docs/corpus.md`; the review
rubric is `prompts/committer-paranoia.md` (notes: `docs/haas-paranoia-notes.md`).

## Usage

```
bun run src/cli.ts <cf-id|cf-url|message-id|thread-url> [--blind N] [--before DATE] [--hint TEXT] [--out DIR] [--backend claude|codex] [--rounds N] [--self] [--no-enrich] [--dry-run] [--offline]
bun run src/cli.ts --self --proposal FILE [--patch FILE ...]
bun run src/cli.ts page <roast.json> [--out FILE] [--site DIR [--base-url URL]]
bun run src/cli.ts doctor
```

| Option | Meaning |
|---|---|
| `--blind N` | read only the first N messages of the thread |
| `--before YYYY-MM-DD` | read only messages strictly before the date (UTC); also the precedent cutoff |
| `--hint TEXT` | directed precedent lookup ("the 2018 suggestion of doing X") |
| `--out DIR` | output directory; default `out/<slug>` (`cf-7608`, `cf-5253-blind5`, `msg-<id>`) |
| `--backend claude\|codex` | which installed CLI runs the model; default `PGROAST_BACKEND`, else claude if on PATH, else codex |
| `--self` | your own proposal before you send it; see "Self mode" |
| `--proposal FILE`, `--patch FILE` | with `--self`: a draft email on disk and, optionally, patch files (repeatable) |
| `--rounds N` | extra rounds after the first pass, default 0; see "Rounds" |
| `--no-enrich` | skip the reading of precedent threads and the relevance pass |
| `--dry-run` | build and print every prompt, call no model; outputs hold placeholders |
| `--offline` | use only cached pages |

`doctor` reports, for each CLI: whether it is on PATH, its version, and whether a trivial
completion works; when one fails it says to run `claude` (and sign in) or `codex login`.

Environment: `PGROAST_BACKEND`; `PGROAST_ROASTER_MODEL` (default `opus`; also the brief) and
`PGROAST_CRITIC_MODEL` (default `claude-mythos-5-2`; also the synthesis) for the claude backend;
`PGROAST_CODEX_MODEL` for the codex backend (default: the model configured in the Codex CLI);
`PGROAST_CONCURRENCY` (3), `PGROAST_LLM_TIMEOUT_MS` (900000), `PGROAST_CLAUDE_BIN`,
`PGROAST_CODEX_BIN`, `PGROAST_DSN` (corpus DB).

On the claude backend only Opus, Mythos and Fable models are accepted (Fable 5.2 is the same underlying model as Mythos 5.2); anything else is an error before
any call is made. No API key is read, needed or used (see "LLM backend").

Output directory:

```
out/<slug>/roast.json     the result (type Roast, src/roast/schema.ts)
out/<slug>/roast.md       the short report, rendered from roast.json by code
out/<slug>/roast-full.md  everything: proposal restated, all touch points, refuted objections, run details
out/<slug>/roast-summary.txt   at most 10 plain-text lines, built by code; first line
                          "DRAFT — rewrite in your own words before using; AI-generated"
out/<slug>/llm/NN-<stage>.prompt.txt | .response.txt | .meta.json   every prompt and reply
```

## Pipeline

```
input ──> thread loader ──> brief (LLM) ──> retrieval (code) ──> 7 roasters (LLM, parallel)
                                                                        │
                roast.md <── render (code) <── assembly (code) <── synthesis (LLM) <── critic (LLM)
```

10 LLM calls for the core of one roast (11 when the tone lint finds something) (9 when no roaster raises anything: the critic is
skipped), plus at most one repair call per stage when a reply is not valid JSON. Precedent
enrichment adds up to 8 calls the first time a thread is seen (0 from cache) and 1 relevance
call. `--rounds` adds more (see "Rounds").

Roast output of a live proposal stays local: `out/` is ignored by git and is never committed.

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

### b2. Lazy enrichment (`src/roast/enrich.ts`, up to 8 calls, roaster model)

Most CommitFest rows record an outcome and no reason. So, at roast time, the top candidates
(the pool is widened to 24) that have a thread and no recorded reason are read: at most 8 per
run, one call per thread, prompt `prompts/enrich.md`. The model returns a summary of the
proposal, why it was not accepted, who objected, one key sentence and the number of the
message it is in. Code then checks the record:

- the key sentence must occur verbatim in the named message's own text (quoted lines are
  excluded; no ellipsis); else it is dropped. The message link is built by code;
- objector names must be senders in that thread; others are dropped.

Long threads: the first 3 messages, the last 8 and the messages of the people who closed the
entry, within 60 000 characters; gaps are marked.

The record is stored once in table `precedent_enrichment` (same database; key: thread URL and
decision date) and reused by every later roast. Cutoff rules: only messages dated on or before
the precedent's decision date are read, so a record holds nothing newer than what the retrieval
cutoff already admits; a precedent decided after the cutoff never reaches this step; undated
rows are not enriched with `--blind` / `--before`; the proposal's own thread is never read.

A reason that comes from enrichment is labelled "AI summary of its thread" in the prompts and
in `roast.md`, and is never accepted as the source of a quote: only the verified key sentence is.

### b3. Relevance pass (1 call, roaster model)

Keyword search returns much noise. One call (`prompts/relevance.md`) gets the brief and the
candidate list and returns the ids of the candidates that are about the same or a similar idea.
Only those (at most 15) are shown to the roasters; the rest stay in `precedents_retrieved`
with `relevant: false`. If the call fails, the roasters get the top candidates unfiltered and
a warning says so.

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
  stand next to a listed fatal objection. A listed objection at level 1a or 1b makes the verdict
  at least `NEEDS-DESIGN-DISCUSSION` (added 2026-11-11 after eval run `pilot-2`). Each change is
  recorded in `warnings`.
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

`priority` (in the synthesis reply) answers "is it worth the reviewers' time now?", apart from
the verdict: `audience` (`most users` | `a sizeable minority` | `niche` | `unclear`),
`maintenance_burden` and `review_cost` (`low` | `medium` | `high`; review cost from the patch
size and the subsystems in the touched-file list), `recommended_action` (`proceed` | `park` |
`bundle` | `needs champion` | `needs design rethink` | `withdraw and resubmit` |
`fix design first` | `close: dead or superseded`) and `reason`. For long-lived entries the
prompt separates "dead or superseded" from "stuck": age alone is never a reason to recommend
closing, and a recommendation to close must name a concrete reason (and what superseded it,
only when that is in the thread or the corpus; else "unknown"). It is
copied to the output as is. No verdict rule reads it.

`roast-summary.txt` is built by `renderSummary()` from the same JSON: the draft header, title,
verdict, the top three objections, the first prior attempt, the first question, the priority
line and "not now" when it applies; never more than 10 lines, no markup, no model call.

## Tone (`src/roast/tone.ts`)

"Roast" is an internal name. Everything a person may forward reads as a design pre-review:
calm, respectful, evidence-first. Three layers:

1. **Prompts.** `roaster-common.md`, `critic.md` and `synth.md` carry the same tone section: the
   rubric's persona is a way of thinking, not a voice; no snark, sarcasm, hyperbole, drama,
   exclamation marks or intensifiers; write about the proposal, never about the author. Each
   objection ends in one question the author can answer (`author_must_show`).
2. **Labels.** The document title is "Design pre-review: <title>"; section 3 is "Objections a
   reviewer is likely to raise"; the critic's part is shown as "Counter-check". The disclosure
   line stays verbatim.
3. **Lint in code**, before any file is written. `TONE_RULES` is a word and phrase list in five
   groups (intensifiers, hyperbole, sarcasm markers, internal vocabulary such as "roast" and
   "beat down", remarks about the author such as "you failed to") plus exclamation marks (not
   `!=`, not inside a code span). It runs over every prose field the models wrote
   (`proseFields()`): objections of every status, questions, verdict reasoning, brief,
   committability, priority, self advice, notes. A listed objection's `author_must_show` must
   also end with a question mark. Verbatim archive quotes are not checked: they are not ours
   to rewrite.

On a hit, one call (`prompts/tone.md`, synthesis model, label `tone-repair`) gets only the
flagged sentences and returns one rewrite per sentence; code replaces exactly those sentences,
after the usual link scrub. The lint runs again; what is still flagged is listed in
`tone_lint.remaining` (path, rule, match, sentence), in the run section of `roast.md`, and in
`warnings`. `pgroast page` runs the same lint on the JSON it is given and shows the count.

The list is a filter for the common cases, not a judgment of tone: a rude sentence made of
polite words passes, and a harmless use of a listed word ("the simply-named option") is
rewritten or reported.

## Page and site layout (`pgroast page`, `src/roast/page.ts`)

`pgroast page <roast.json> [--out FILE]` renders the opt-in "full version": one self-contained
HTML file (inline CSS, no scripts, no external requests, light and dark by
`prefers-color-scheme`, readable on a phone) with every objection, including those that held
up but are not listed, those refuted in the counter-check (with the reasoning) and those
withdrawn, the evidence and archive links, touch points, questions, committability, priority,
loaded invariants and the run section. The disclosure line is at the top and at the bottom.

`--site DIR` writes the stable layout that a CommitFest app could include from:

```
DIR/cf/<cf-id>.html        embeddable fragment: a card, no <html>/<head>, classes with a
                           pgroast- prefix, inline styles only, no scripts: verdict, top three
                           questions, priority, disclosure, link to the full page
DIR/cf/<cf-id>.json        the roast.json
DIR/cf/<cf-id>/full.html   the full page
DIR/msg/<message-id>.*     the same for a thread without a CommitFest entry (characters
                           outside [A-Za-z0-9._-] become "_")
```

The card's link is `{{PGROAST_BASE_URL}}/cf/<cf-id>/full.html` until `--base-url URL` fills it
in. No index is written: an entry without a review is absent, which is a 404 on any static
host. The command makes no model call and no network request, and there is no upload, hosting
or publishing code: where the files go is a person's decision.

Everything in roast.json is untrusted in an HTML context (model output, archive text, titles,
links). Every value passes `esc()` (`& < > " ' \``), and a link is emitted only when
`safeUrl()` accepts it as a plain http(s) URL; any other value is shown as text. A test feeds a
roast in which every text and URL field is hostile and checks that the output contains only
tags from a fixed list and no href other than https.

## Rounds (`--rounds N`, default 0)

"Go deeper" passes after the first pass. Every extra round is followed by one critic call on
what the round added or changed, and is recorded in `rounds[]` (calls, new objections, how many
of them survived, revisions, withdrawals), so the gain of each round can be measured.

| Round | What happens |
|---|---|
| 1 | each roaster gets its own earlier answer and exactly the question "What did you forget?". It can only add objections. |
| 2 | each roaster gets its answers so far with the critic's verdicts and exactly "Are you happy with the results?". It can add, restate (`revised_in_round`) or withdraw its own objections. A withdrawn objection is kept in `withdrawn[]` with the round and the reason; it is not shown to the synthesis. |
| 3 and later | a supervisor call (`prompts/supervisor.md`, critic model) reads the brief, all objections and the roasters' notes and names up to 3 areas nobody examined, each with the roaster to send back. Those roasters run again on that area only. An empty list ends the rounds. |

Both questions are constants (`FORGOT_PROMPT`, `HAPPY_PROMPT`). An objection carries the `round`
in which it was raised; ids of later rounds look like `demand-r1-1`. A roaster can revise or
withdraw only its own objections. Later rounds run under the same rules as the first: no tools,
same sanitizer, same evidence rules, and "nothing to add" is a valid answer. Cost: rounds 1 and
2 are 8 calls each (7 roasters and the critic); a supervisor round is 2 to 5.

## Subsystem invariants (`src/roast/invariants.ts`)

`invariants/<subsystem>.md` files hold rules harvested from senior reviewers, each with a
source link. A file is selected when one of its `paths:` prefixes (YAML front matter) matches a
file in the patch's touched-file list; without a patch nothing is selected. Selected files are
included verbatim, under the heading "Subsystem invariants to check explicitly", in the system
prompts of the `replication-ondisk` and `maintenance-fit` roasters and of the critic. The Source
links are read from the file by code and added to the allowed-URL set, so a roaster can cite
them; any other link is still removed. `invariants_loaded` lists the files in `roast.json`, and
`roast.md` names them in its header.

## Self mode (`--self`)

The author's own check before sending. The pipeline, the evidence rules and the verdict rules
are the same; only the framing changes:

- the synthesis prompt gets `prompts/synth-self.md`: it addresses the author, and returns
  `self_advice[]`: for every surviving objection `fix` (change the proposal) or `rebut` (answer
  it in the cover letter) and how. Advice for an id that is not a surviving objection is dropped;
- `roast.md` leads with "Objections to address before you send", shows the advice and the
  precedent threads to cite with each objection, and moves the verdict down ("How a reviewer
  would likely classify it"). The verdict stays in `roast.json`;
- `--self --proposal FILE [--patch FILE ...]` (`src/thread/local.ts`) roasts a draft that has
  no thread yet: the file is the single message; from a patch file only the commit message,
  file list and doc hunks are read, as for attachments; a file without a diff is not read.

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
| `mode` | `review` \| `self` |
| `backend`, `models` | which CLI and which models ran |
| `input` | argument, CommitFest entry (redacted in eval modes), thread URL, messages read / total, `blind`, `before`, `hint`, attachments read |
| `brief` | the neutral restatement and the search queries |
| `prior_attempts[]` | `url`, `thread_urls`, `date`, `first_date`, `status`, `who_objected`, `reason`, `enriched`, `quote` (or null = unavailable), `quote_url`, `relation`, `what_is_different`; empty = no precedent found |
| `objections[]` | the ranked steelman: `id`, `angle`, `round`, `revised_in_round`, `title`, `level`, `rubric_item`, `category`, `touch_points`, `severity`, `failure_scenario`, `argument`, `author_must_show`, `precedents[]` (links from the DB), `thread_refs[]`, `critic` |
| `other_surviving[]` | survived the critic, not listed (`not_ranked_reason`) |
| `refuted[]` | with `critic.refutation_kind` and `critic.reasoning` |
| `withdrawn[]` | taken back by their own roaster in round 2: `withdrawal {round, reason}` |
| `priority` | `audience`, `maintenance_burden`, `review_cost`, `recommended_action`, `reason` |
| `self_advice[]` | self mode: `objection_id`, `action` (`fix` \| `rebut`), `how` |
| `rounds_requested`, `rounds[]` | per round: `kind`, `llm_calls`, `new_objections`, `new_survived`, `revised`, `withdrawn`, `follow_ups` |
| `tone_lint` | `fields_checked`, `hits_found`, `sentences_rewritten`, `repair_call`, `remaining[]` |
| `invariants_loaded[]` | invariant files given to the roasters |
| `enrichment` | counts: candidates, from cache, new calls, failed, quotes verified / dropped, relevance pass |
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
   retrieved precedents, links in the rubric, Source links of the loaded invariant files. Otherwise it is replaced by
   `[link removed: not in the retrieved set]` and recorded (`sanitizer.urls_removed`; this audit
   list is the only place where a removed URL still appears).
4. **Thread references are by message number**; code turns a number into the permalink.
   Numbers outside the visible thread are dropped.
5. **Quotes are verified.** A prior attempt's quote is kept only if it occurs verbatim
   (whitespace, quote style and case folded; `...` allowed between parts) in the corpus row or
   in the visible thread, or is the key sentence that enrichment verified against a message of
   the precedent's thread (then it links to that message). An AI summary is never a quote
   source. Otherwise the output says "quote unavailable".
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
  titles, summaries and recorded reasons. Many CommitFest rows have no recorded objection text;
  enrichment reads only the top 8 such threads per run, and of a long thread only the start, the
  end and the closers' messages, so the real reason can sit in a part that was not read. The
  summary is a model's reading of the thread: the link and the verified sentence are facts, the
  summary is not. Ideas that died on the list without a CommitFest entry are not in the corpus.
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
- **One critic.** The critic and the synthesis run on the same model family as the roasters and
  share its blind spots. There is no vote; results vary between runs. `--rounds` adds passes,
  and a reflection question also invites a model to produce something: whether rounds add
  surviving objections or noise is what `rounds[]` is there to measure.
- **Invariants are only as good as the files.** A subsystem without a file gets no such check,
  and selection needs a patch: a proposal sent without one loads nothing.
- **`--before` uses UTC dates** from the archive; a message sent late in the evening in a
  western time zone is dated the next day.
- **Cost.** 10 calls (up to 19 with enrichment on a cold cache), each with the rubric and the full material in the prompt. A short thread
  takes a few minutes; a 100-message thread is roughly 40 000 input tokens per call.

## Tests

`bun test test/thread.test.ts test/roast.test.ts`. Thread tests use two saved pages
(`test/thread-fixtures/`: a flat thread and a CommitFest patch page) and a small synthetic
patch. Roast tests run the whole pipeline with a fake model that returns fabricated links,
unknown precedent ids, a bad quote and a broken ranking, and check that code removes them; the
real CLI backends are tested through their stream parsers, their argument lists and an injected
runner. No test calls a model or the network.
