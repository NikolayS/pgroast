# Precedent corpus (milestone 1)

The precedent corpus is a Postgres-backed index of proposals that did not
land, or that landed and were then reverted. The PG Roast roaster searches it
to find earlier attempts at an idea. Every row comes from a fetched public
page or from `git` output. The builder never makes up a link (see
[Provenance](#provenance-no-fabricated-links)).

```
bun run src/corpus/cli.ts build [--source cf|reverts|wiki|all] [--limit N] [--offline]
bun run src/corpus/cli.ts search "<query>" [--before YYYY-MM-DD] [--kind cf,revert,do_not_want] [-n 10] [--json] [--include-undated]
bun run src/corpus/cli.ts stats
bun run src/corpus/cli.ts selftest
bun test                         # parser unit tests (fixtures in test/fixtures/)
bunx tsc --noEmit                # typecheck (strict)
```

The same commands are available as package scripts: `bun run corpus:build`,
`corpus:search`, `corpus:selftest` and `corpus:stats`.

## Layout

| path | what |
|---|---|
| `src/corpus/fetch.ts` | polite cached HTTP client |
| `src/corpus/cf.ts` | CommitFest archive, list and patch page parsers, crawl |
| `src/corpus/reverts.ts` | git revert extractor (reads `$PGROAST_PG_REPO`, default `../postgres` next to this repo) |
| `src/corpus/wiki.ts` | wiki `Not_Worth_Doing` parser |
| `src/corpus/util.ts` | HTML text, message-id canonicalisation, touch-point rules, record type |
| `src/corpus/db.ts` | DSN parsing, schema apply, idempotent upsert |
| `src/corpus/search.ts` | `searchPrecedents()` and the `Precedent` type (imported by the roaster) |
| `src/corpus/cli.ts` | CLI and selftest |
| `sql/schema.sql` | DDL, applied by `build` |
| `data/cache/<host>/…html` | raw fetched pages (git-ignored) |

Runtime: Bun 1.3.5 built-ins only (`Bun.sql`, global `fetch`, `Bun.spawn`).
The only packages are dev dependencies used for the typecheck
(`typescript`, `@types/bun`). The builder never calls an LLM.

## Database

- Postgres database `pgroast`. The connection comes from `PGROAST_DSN`;
  default `dbname=pgroast host=/tmp`.
- Both libpq keyword strings and URLs are accepted, for example
  `postgres://localhost/pgroast?host=/tmp`.
- Bun 1.3.5 forwards an unknown URL parameter such as `?host=` to the server
  as a startup GUC, and the connection fails. For this reason `db.ts` parses
  the DSN itself and turns a socket directory into Bun's `path` option
  (`/tmp/.s.PGSQL.5432`). A non-`/` host uses TCP.
- `build` creates the schema if it is missing, then upserts on
  `(kind, raw_ref)`, so rebuilds are idempotent. A full (non-`--limit`) build
  of a source also deletes rows of that kind that the source no longer
  produces.
- `pg_trgm`: `build` runs `create extension if not exists pg_trgm` and, if
  that works, creates a trigram GIN index on `title`. If the extension cannot
  be created, search runs without the similarity signal. On this host
  (2026-11-11) it cannot be created: the running server binary is 18.3, but
  Homebrew already installed 18.6 contrib libraries, and loading fails with
  `Symbol not found: _palloc0_mul`. A server restart onto 18.6 fixes this.
  After that, re-run `build` (or create the extension) to enable it.

Export and ship the corpus as one file, then restore it elsewhere:

```
pg_dump -h /tmp -d pgroast -Fc --no-owner --no-privileges -t precedent -t build_log -f data/precedents.dump
createdb pgroast && pg_restore -d pgroast --no-owner data/precedents.dump
```

`tsv` is a stored generated column, so `pg_restore` recomputes it.

## Sources

### 1. CommitFest: `kind = 'cf'`

- `https://commitfest.postgresql.org/archive/` lists every CommitFest. On
  2026-11-11 the IDs were 3..63 (61 CFs, 2014-12 to PG20-4). IDs 1 and 2 do
  not exist.
- For each CF, the builder fetches `/<cf>/?status=6` (Rejected), `?status=7`
  (Returned with feedback) and `?status=8` (Withdrawn). That is 183 list
  pages, crawled in this order: Rejected for all CFs, then RwF, then
  Withdrawn. Rows whose badge does not match the requested status are
  dropped (none did).
- List pages have the title, ID, tags, authors, reviewers and latest-mail
  time. They have no thread links, no thread start and no close date. That
  is not enough, so every patch page `/patch/<id>/` is fetched once (deduped
  by patch ID). From the patch page:
  - **Final status**: the per-CF status lines are listed newest first; the
    final one is the line with the highest CF ID. A patch whose final status
    is not Rejected, RwF or Withdrawn (later Committed, or still open) is
    dropped and counted in the coverage report.
  - `Emails` gives each thread's `https://www.postgresql.org/message-id/flat/<msgid>`
    (copied from the page), its subject, and "First at <ts> by".
  - `History` gives `date`: the newest line
    "Closed in commitfest X with status: <final>".
  - It also gives authors, reviewers, committer, target version, tags, and
    `Links` (stored in `other_links`).
- `first_date` = the earliest "First at" across threads. If no thread is
  attached, it is the record's `Created` time.
- `summary` = title + tags + thread subjects. `objection` and `objectors`
  stay empty at this milestone.
- If a patch page cannot be fetched, the row is stored from the list page
  only (no threads, no dates; `provenance.source` says so).

### 2. Reverts: `kind = 'revert'`

- `git -C $PGROAST_PG_REPO log --grep='^Revert' -i` gives 586 commits on the
  local master. The repo is read only.
- If the subject starts with "Revert", `status = 'Reverted'` (508 rows).
- Otherwise the commit is kept only if a commit hash within 120 characters
  after a "revert" word resolves in the repo: `status = 'Partially reverted'`
  (39 rows). The other 39 matches are skipped. In those, "revert…" only
  starts a line in passing.
- Reverted commits:
  - any 7..40-hex token that `git rev-parse --verify <x>^{commit}` resolves
    (for partial reverts, only tokens near "revert");
  - otherwise, for `Revert "<subject>"`, the latest earlier commit on
    master with exactly that subject.

  `provenance.reverted_commit_match` says which rule matched. 381 of 547 rows
  resolved a target.
- `title` = the subject. Many CVS-era commits put the whole message on the
  subject line; when the subject is over 160 characters, `title` is its
  first sentence, and the full subject is still in `summary`.
- `url` = `https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=<sha>`.
  `other_links` holds the same link for each reverted commit.
- `thread_urls`: all `postgr.es/m/<id>` and `postgresql.org/message-id/<id>`
  links in the revert message and in the reverted commits' messages,
  converted to `/message-id/flat/<id>`.
- `objection` = the revert message, word for word, minus the subject and the
  trailers (Discussion:, Backpatch-through:, Reported-by: and so on).
- `date` = the revert commit date (UTC). `first_date` = the earliest
  reverted commit's date, or the revert date if no target resolved.
- `authors` = the git authors of the reverted commits. The person who
  reverted is `provenance.reverted_by`. `objectors` stays empty, because the
  person who reverts is often not the person who objected.

### 3. Wiki: `kind = 'do_not_want'`

- "Features We Do Not Want" is not on `wiki/Todo`. The Todo page says
  retired items move to `https://wiki.postgresql.org/wiki/Not_Worth_Doing`,
  and the section is `<h2 id="Features_We_Do_Not_Want">` there.
- One row per item (`<dl><dt>title</dt><dd>text</dd></dl>`):
  - the 6 items under that heading get `status = 'Not wanted'`;
  - the other 65 retired items on the page get `status = 'Not worth doing'`.
- `url` = `Not_Worth_Doing#<section anchor>`. Headings that contain "/"
  use the URL-safe legacy anchor, for example `Optimizer_.2F_Executor`.
- `objection` = the item's description. Message-id links go to
  `thread_urls`. Old `archives.postgresql.org/...msgNNNNN.php` links and wiki
  links go to `other_links`.
- No dates (see `--before`).

## Schema (`sql/schema.sql`)

| column | type | meaning |
|---|---|---|
| `id` | text PK | `cf:<patch id>`, `revert:<sha>`, `wiki:<anchor>:<n>` |
| `kind` | text | `cf`, `revert`, `do_not_want` |
| `raw_ref` | text | stable source key: `patch/<id>`, `<sha>`, `Not_Worth_Doing#<anchor>:<n>`; `unique (kind, raw_ref)` |
| `title`, `status` | text | status ∈ Rejected, Returned with feedback, Withdrawn, Reverted, Partially reverted, Not wanted, Not worth doing |
| `date` | date | decision: CF close (history line), revert commit (UTC) |
| `first_date` | date | thread start (CF), earliest reverted commit (revert) |
| `url` | text | CF patch page, gitweb commit, wiki anchor |
| `thread_urls` | text[] | `https://www.postgresql.org/message-id/flat/<msgid>` |
| `authors`, `reviewers`, `objectors` | text[] | `objectors` empty at this milestone |
| `tags` | text | CF tags; wiki section |
| `summary`, `objection` | text | see the sources above |
| `touch_points` | text[] | keyword rules (below) |
| `other_links` | text[] | other real URLs found in the source |
| `provenance` | jsonb | source, cache URL, exact timestamps (`decided_at`, `first_at`), CF history, reverted commits |
| `tsv` | tsvector, stored generated | `title` weight A, `summary \|\| tags` weight B, `objection` weight C (`english`); GIN index |

`build_log(kind, built_at, coverage jsonb)` stores the coverage report of
the last build of each source.

**Touch points** come from fixed regexes over the title, tags and subjects
(plus the commit body for reverts and the description for wiki rows). The
buckets are pg_dump/restore, psql, GUC, WAL/replication, planner,
protocol/libpq, catalog, on-disk/pg_upgrade, security, SQL syntax,
ABI/extension, and hot-path performance. They are rough hints: for example,
"plan" and "join" trigger planner, and "slot" triggers replication.

## Search

`searchPrecedents({query, before?, kinds?, limit?, includeUndated?})` in
`src/corpus/search.ts` returns `Precedent[]` (snake_case fields; dates as
`YYYY-MM-DD`; `match` ∈ `and | or | trgm`).

1. **AND path**: `websearch_to_tsquery('english', q)`, ranked by
   `ts_rank_cd(tsv, q, 1)`.
2. **OR fallback**, if the AND path returns fewer than `limit` rows:
   - take the query's `english` lexemes;
   - drop a few weak words (add, support, allow, new, option, use, make,
     patch, feature);
   - prefix-match each lexeme and OR them, with
     `to_tsquery('simple', 'lex1':* | 'lex2':* …)`. The `simple` config keeps
     the lexemes from being stemmed twice. Only lexemes that match
     `^[[:alnum:]_.-]+$` are used, so user text never reaches the tsquery
     syntax.
   - Each lexeme is expanded with a small curated synonym map
     (`SYNONYMS` in `search.ts`): planner↔optim(izer);
     pooler/pool↔pgbouncer, pgpool; posit(ion)↔order, reorder, attnum;
     timestamp→time, date. `pg` (from `pg_dump`, `pg_ctl`…) is treated as a
     weak word.
   - Rows are ranked by the number of distinct query terms they cover (a
     term counts if it or a synonym matches; a title match, weight A,
     counts twice), then by `ts_rank_cd`.
   - Rows from this path come after all AND rows.
3. **pg_trgm** (when installed): `0.5 * similarity(title, q)` is added to
   the score. Titles with similarity > 0.3 fill any remaining slots.

The user query is always a bind parameter. Results are stored rows only, so
every URL printed was read from a source. If nothing matches, the CLI prints
"no precedent found".

### The `--before` rule (leak-free evaluation)

With `--before D`, a row is kept only if **every date it has is strictly
before D**:

```
coalesce(first_date, date) < D  and  coalesce(date, first_date) < D
```

- A CF entry whose thread started before D but was closed on or after D is
  excluded, because the rejection had not happened yet.
- A commit made before D but reverted on or after D is excluded.
- The proposal under evaluation is itself excluded, because its first date
  is not before its own cutoff.
- Rows with **no date** (all wiki rows, and any CF row built from the list
  page only) are excluded unless `--include-undated` / `includeUndated: true`
  is given. The wiki does not say when an item was added.
- Dates are calendar dates. CF times are as shown on the site, which is
  probably UTC. Git times are converted to UTC. The exact timestamps are in
  `provenance.decided_at` / `first_at`.

## Provenance: no fabricated links

Links are only ever built from an identifier read from a source:

- CF `url` = fixed prefix + a patch ID from an `href="/patch/<id>/"` on a
  fetched list page;
- revert `url` = fixed prefix + a SHA printed by `git log`;
- wiki `url` = page URL + an `id="..."` anchor from the fetched HTML;
- `thread_urls` = `…/message-id/flat/` + a message-id copied from a link on
  the fetched page or in the commit message. It is normalised by
  percent-decoding and then re-quoting with one fixed safe set.

`selftest` checks the following:

1. The DB is reachable. The schema is present: table, stored generated
   `tsv`, GIN index, `unique (kind, raw_ref)`. There are rows of all three
   kinds and no empty tsvectors.
2. Search returns rows for "optimizer hints". A hostile query does not raise
   an error. `--before 2010-01-01` returns only rows dated before the cutoff
   and no undated rows.
3. In SQL, `url` matches the per-kind regex and is consistent with
   `raw_ref`. Every thread URL matches
   `^https://www.postgresql.org/message-id/flat/<x>@<y>$`. Every
   `other_links` value is an http(s) URL.
4. Provenance, per row:
   - CF: the patch ID appears in the cached page, and each thread
     message-id appears as a `message-id/flat/` link on the cached patch
     page;
   - revert: `git show` of the commit and its reverted commits succeeds, and
     each message-id appears in those messages;
   - wiki: the anchor exists on the cached page, and each message-id appears
     on it.

Negative test: on a scratch copy of the DB, a made-up thread URL, a wrong CF
patch URL and a non-wiki URL were injected. `selftest` reported all of them
and exited with status 1.

## Crawl etiquette

- User-Agent `pgroast-research/0.1`, GET only, no sign-in, no cookies.
- At least 1.05 s between requests to the same host.
- Every 200 response is cached under `data/cache/<host>/` and is never
  fetched again. A 404 leaves a `.404` marker.
- On 429 or 5xx: honour `Retry-After`, otherwise exponential back-off from
  5 s to 300 s, at most 6 tries.
- `--offline` builds from the cache only.
- The cache file names are the same as the earlier Python prototype's, so
  pages it crawled were reused, not fetched again.

## Known gaps

- **No pgsql-hackers crawl yet.** Only threads linked from CF entries,
  commits and the wiki are indexed, and thread text is not fetched.
  `objection` and `objectors` are empty for CF rows.
- **CF coverage starts at 2014-12** (CF ID 3). Older ideas appear only
  through reverts or the wiki.
- **Final-status filter:** a patch that was returned with feedback and later
  committed or reopened is dropped, so the earlier feedback is lost.
- **Stale cache for open CFs:** list pages for open or in-progress CFs (60,
  62, 63) were cached on 2026-11-11. Delete those cache files to pick up later
  closes.
- **Sparse CF tags:** old patches have none, because the CF app replaced
  "Topic" with tags. `summary` is mostly the title + thread subjects.
- **Unresolved reverts:** 166 revert rows name no resolvable reverted
  commit, mostly from before about 2014. One example is "This reverts commits
  24c35ec and 57169ad", where neither hash is on master. These rows keep
  only the revert's own message and links.
- **Wiki rows are undated**, so `--before` hides them unless
  `--include-undated` is given.
- **Touch points** are keyword hints. They both over-match and
  under-match.
- **pg_trgm is unavailable on this host** until the server is restarted
  (see [Database](#database)).
- **Lexical search only**, with no synonyms. "connection pooler" does not
  find "pgbouncer" unless that word is in the text.
