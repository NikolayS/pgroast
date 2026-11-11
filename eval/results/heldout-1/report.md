# PG Roast eval: run `heldout-1`

Scored 2026-11-11T23:24:13.663Z. Rules: [docs/eval.md](../../../docs/eval.md) (fixed before any result). 12 of 18 cases in this run.

## Headline

- **(a) verdict match**: 9/12 (75%) lenient, 4/12 (33.3%) strict
- **(b) decisive objection found** (listed or other surviving): 5/12 (41.7%); found or partially: 11/12 (91.7%); found but refuted by the critic: 2
- **(c) earlier attempt found** (in prior attempts): n/a; retrieved but not listed: 0; not in corpus (corpus gap, excluded): 5
- **(d) false-alarm rate on accepted cases**: 3/3 (100%)

### Split by post_training_cutoff

The models may remember how famous old threads ended; post-cutoff cases cannot be recalled.

| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |
|---|---:|---|---|---|---|---|---|
| all | 12 | 9/12 (75%) | 4/12 (33.3%) | 5/12 (41.7%) | 11/12 (91.7%) | n/a | 3/3 (100%) |
| post-cutoff (true) | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| pre-cutoff (false) | 12 | 9/12 (75%) | 4/12 (33.3%) | 5/12 (41.7%) | 11/12 (91.7%) | n/a | 3/3 (100%) |

### Split by outcome

| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |
|---|---:|---|---|---|---|---|---|
| rejected | 4 | 4/4 (100%) | 0/4 (0%) | 3/4 (75%) | 4/4 (100%) | n/a | n/a |
| accepted | 3 | 0/3 (0%) | 0/3 (0%) | 1/3 (33.3%) | 3/3 (100%) | n/a | 3/3 (100%) |
| reverted | 5 | 5/5 (100%) | 4/5 (80%) | 1/5 (20%) | 4/5 (80%) | n/a | n/a |

### Split by level of the decisive objection

Level from a separate classify call that saw only the case, never the roast (idea = rubric 1a/1b, design = 2, implementation = 3-5). An implementation-level reason (a bug, a buildfarm failure) is usually invisible to an idea-level review of the first few emails; those cases are shown apart, not averaged in.

| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |
|---|---:|---|---|---|---|---|---|
| idea | 6 | 4/6 (66.7%) | 0/6 (0%) | 4/6 (66.7%) | 6/6 (100%) | n/a | 2/2 (100%) |
| design | 4 | 3/4 (75%) | 2/4 (50%) | 0/4 (0%) | 3/4 (75%) | n/a | 1/1 (100%) |
| implementation | 2 | 2/2 (100%) | 2/2 (100%) | 1/2 (50%) | 2/2 (100%) | n/a | n/a |

> **Decisive objection inside the shown window** (position <= blind_n; the roast could read it): data-checksums-default-on. A "found" here may be reading, not foresight.

## Cases

| case | outcome | post-cutoff | precedent cutoff | decisive level | verdict | (a) lenient | strict | (b) decisive | bucket | (c) earlier | fatal surviving | calls (roast+judge) | cost | wall |
|---|---|---|---|---|---|---|---|---|---|---|---:|---|---:|---:|
| unsigned-integer-types | rejected | no | 2024-12-07 | idea | NEEDS-DESIGN-DISCUSSION (low) | yes | no | found | other_surviving | not in corpus | 0 | 19+3 | $1.86 | 143 s |
| hidden-invisible-columns | rejected | no | 2021-10-15 | idea | NEEDS-DESIGN-DISCUSSION (medium) | yes | no | found | listed | n/a | 0 | 18+3 | $3.21 | 199 s |
| delete-order-by-limit | rejected | no | 2021-12-18 | idea | NEEDS-DESIGN-DISCUSSION (low) | yes | no | found | refuted | not in corpus | 0 | 18+3 | $1.96 | 157 s |
| global-unique-index | rejected | no | 2022-11-18 | idea | NEEDS-DESIGN-DISCUSSION (medium) | yes | no | found | listed | not in corpus | 0 | 19+3 | $3.34 | 205 s |
| btree-include-covering-indexes | accepted | no | 2015-12-05 (case 2016-01-04; last shown 2015-12-04) | design | NEEDS-DESIGN-DISCUSSION (medium) | no | no | partially | listed | n/a | 0 | 19+3 | $2.72 | 182 s |
| incremental-backup | accepted | no | 2023-06-16 (case 2023-06-19; last shown 2023-06-15) | idea | NEEDS-DESIGN-DISCUSSION (medium) | no | no | partially | refuted | not in corpus | 0 | 20+3 | $3.49 | 197 s |
| data-checksums-default-on ⚑ | accepted | no | 2024-08-08 | idea | NEEDS-DESIGN-DISCUSSION (medium) | no | no | found | listed | not in corpus | 0 | 20+3 | $2.73 | 199 s |
| temporal-pk-fk-pg17 | reverted | no | 2021-09-07 (case 2024-01-24; last shown 2021-09-06) | design | NEEDS-DESIGN-DISCUSSION (medium) | yes | yes | partially | listed | n/a | 0 | 18+3 | $7.70 | 260 s |
| sqljson-pg15 | reverted | no | 2018-03-14 (case 2022-03-03; last shown 2018-03-13) | design | NEEDS-DESIGN-DISCUSSION (medium) | yes | yes | not_found | – | n/a | 0 | 19+3 | $2.48 | 198 s |
| group-by-all-pg19 | reverted | no | 2024-07-24 (case 2025-09-29; last shown 2024-07-23) | implementation | NEEDS-DESIGN-DISCUSSION (low) | yes | yes | partially | refuted | n/a | 0 | 18+3 | $2.61 | 189 s |
| pg-dumpall-non-text-formats | reverted | no | 2024-06-11 (case 2025-04-04; last shown 2024-06-10) | implementation | NEEDS-DESIGN-DISCUSSION (low) | yes | yes | found | listed | n/a | 0 | 17+3 | $1.78 | 152 s |
| fast-default-domain-constraints | reverted | no | 2025-03-06 (case 2026-03-12; last shown 2025-03-05) | design | NEEDS-COMMITTER-EYES (low) | yes | no | found | refuted | n/a | 0 | 18+3 | $1.69 | 139 s |

⚑ = decisive objection inside the shown window. Precedent cutoff = min(case cutoff_date, last shown message + 1 day); both dates are shown when the window made it earlier.

Totals: 223 roast calls + 36 judge calls; cost $35.58; wall 37 min (sum over cases).

## Misses

### delete-order-by-limit: Allow DELETE to use ORDER BY and LIMIT/OFFSET

- **Decisive objection** (idea-level): found (best match standards-compat-2, refuted). Reviewer explicitly contrasts SELECT (unordered LIMIT only changes returned rows) with DELETE (changes which data survives), matching the tolerate-in-SELECT-but-not-in-DML argument.
  - D1 [idea] Tom Lane, 2021-12-17: "Indeed, this is technically possible, but we've rejected the idea before and I'm not aware of any reason to change our minds." ([message](https://www.postgresql.org/message-id/1272732.1639711078@sss.pgh.pa.us))
  - D2 [idea] Tom Lane, 2021-12-17: "The problem is that a partial DELETE is not very deterministic about which rows are deleted, and that does not seem like a great property for a data-updating command. (The same applies to UPDATE, which is why we don't allow these options in that command either.)" ([message](https://www.postgresql.org/message-id/1272732.1639711078@sss.pgh.pa.us))
  - D3 [idea] Tom Lane, 2021-12-17: "We live with this amount of indeterminism in SELECT, but that doesn't make it a brilliant idea to allow it in UPDATE/DELETE." ([message](https://www.postgresql.org/message-id/1272732.1639711078@sss.pgh.pa.us))

### btree-include-covering-indexes: WIP: Covering + unique indexes (CREATE INDEX ... INCLUDE)

- **Verdict**: NEEDS-DESIGN-DISCUSSION, but the outcome was accepted. False alarm (0 surviving fatal).
- **Decisive objection** (design-level): partially (best match maintenance-fit-2, listed). The reviewer notes only in passing that nobody with nbtree expertise has reviewed the internals; it does not object to the commit timing while review is still under way.
  - D1 [implementation] Peter Geoghegan, 2016-04-04: "I object to committing the patch in that time frame. I'm looking at it again." ([message](https://www.postgresql.org/message-id/CAM3SWZSHjDog0CH4H7iupoe0U=weRJT0JYmMSKpHZVwHqzM0gg@mail.gmail.com))
  - D2 [implementation] Tom Lane, 2016-04-04: "Since it's a rather complex patch, pushing it in advance of the reviewers signing off on it doesn't seem like a great idea ..." ([message](https://www.postgresql.org/message-id/28756.1459798626@sss.pgh.pa.us))
  - D3 [design] Peter Geoghegan, 2016-04-04: "I see what you mean, but I think we need to decide what to do about the key space when leaf high keys are truncated." ([message](https://www.postgresql.org/message-id/CAM3SWZTfBosvae8Gh6AESRVKT3Fad7XcDkhZSbEqazZPE81rwQ@mail.gmail.com))

### incremental-backup: trying again to get incremental backup

- **Verdict**: NEEDS-DESIGN-DISCUSSION, but the outcome was accepted. False alarm (0 surviving fatal).
- **Decisive objection** (idea-level): partially (best match already-exists-1, refuted). The reviewer questions what in-core incremental backup adds over external tools that already have retention and restore workflows, which is the same area, but it never states that the feature lacks built-in management of full-vs-incremental backups and so leaves users to build that themselves.
  - D1 [idea] Stephen Frost, 2019-04-17: "In addition, saying that PG has incremental backup but no built-in management of those full-vs-incremental backups and telling users that they basically have to build that themselves really feels a lot like we're trying to address a check-box requirement rather than making something that our users a" ([message](https://www.postgresql.org/message-id/20190417224309.GH6197@tamriel.snowman.net))

### data-checksums-default-on: Enable data checksums by default

- **Verdict**: NEEDS-DESIGN-DISCUSSION, but the outcome was accepted. False alarm (0 surviving fatal).

### temporal-pk-fk-pg17: SQL:2011 application time (temporal PRIMARY KEY / UNIQUE / FOREIGN KEY WITHOUT OVERLAPS)

- **Decisive objection** (design-level): partially (best match standards-compat-1, listed). The reviewer raises an unresolved fundamental design question (a temporal PK is not a true unique key), but not the specific missed questions or the point that it was too late to fix them for the release.
  - D1 [design] Peter Eisentraut, 2024-05-13: "It looks like we missed some of these fundamental design questions early on, and it might be too late now to fix them for PG17." ([message](https://www.postgresql.org/message-id/64c2b2ab-7ce9-475e-ac59-3bfec528bada@eisentraut.org))
  - D2 [design] Peter Eisentraut, 2024-05-13: "I'm also concerned that if ranges have this fundamental incompatibility with periods, then the plan to eventually evolve this patch set to support standard periods will also have as-yet-unknown problems." ([message](https://www.postgresql.org/message-id/64c2b2ab-7ce9-475e-ac59-3bfec528bada@eisentraut.org))
  - D3 [design] Peter Eisentraut, 2024-05-13: "I'm afraid that these issues cannot be resolved in good time for this release, so we should revert this patch set for now." ([message](https://www.postgresql.org/message-id/64c2b2ab-7ce9-475e-ac59-3bfec528bada@eisentraut.org))

### sqljson-pg15: SQL/JSON: functions (JSON_QUERY/JSON_VALUE/JSON_EXISTS, constructors, IS JSON, JSON_TABLE) for PG15

- **Decisive objection** (design-level): not_found. No reviewer objection mentions subtransactions per coercion or any executor hot-path performance cost of error handling.
  - D1 [design] Andres Freund, 2022-08-15: "I don't think it's sane from a performance view to start a subtransaction for every coercion, particularly because most coercion paths will never trigger an error, leaving things like out-of-memory or interrupts aside." ([message](https://www.postgresql.org/message-id/20220815223853.itrlpqgpqheg6r6a@awork3.anarazel.de))
  - D2 [implementation] Tom Lane, 2022-08-23: "The problem here is that this was going to be a headline new feature for v15. Shipping what apparently is only an alpha-quality implementation seems pretty problematic unless we advertise it as such, and that's not something we've done very much in the past." ([message](https://www.postgresql.org/message-id/692364.1661267311@sss.pgh.pa.us))
  - D3 [implementation] Andres Freund, 2022-08-31: "It feels blatantly obvious that this code isn't even remotely close to being releasable." ([message](https://www.postgresql.org/message-id/20220831154916.pgspuz3bp4427int@awork3.anarazel.de))

### group-by-all-pg19: [PATCH] GROUP BY ALL

- **Decisive objection** (implementation-level): partially (best match maintenance-fit-2, refuted). The reviewer flags unspecified handling of ORDER BY-related (resjunk) entries, but not the missed ORDER BY/GROUP BY matching logic that gives wrong results under non-default equality semantics.
  - D1 [implementation] Tom Lane (committer of revert), 2026-07-17: "A postcommit review discovered that GROUP BY ALL missed our special handling of entries that also appear in an ORDER BY in the query. This caused the query to return wrong results when ORDER BY specifies non-default equality semantics. While this should be fixable with some refactoring, doing it cle" (source: commit message of a32733d8f10 (local git, verified))
  - D2 [implementation] Tom Lane, 2026-07-14: "I don't have a lot of faith that there aren't other comparable bugs lurking." ([message](https://www.postgresql.org/message-id/3278800.1783989856@sss.pgh.pa.us))
  - D3 [implementation] Tom Lane, 2026-07-14: "That is a large change to take on post-beta2, though. Maybe the path of prudence is to revert GROUP BY ALL for v19 and try again for v20." ([message](https://www.postgresql.org/message-id/3278800.1783989856@sss.pgh.pa.us))

### fast-default-domain-constraints: support fast default for domain with constraints

- **Decisive objection** (design-level): found (best match standards-compat-1, refuted). The reviewer raises the same backwards-compatibility regression: evaluating the default in Phase 2 makes ADD COLUMN fail on an empty table where it succeeds today, though it illustrates this with hard errors inside the CHECK rather than a plain constraint failure.
  - D1 [design] Tom Lane, 2025-03-05: "This patch appears to summarily throw away a couple of backwards-compatibility concerns that the previous round took care to preserve: * not throwing an error if the default would fail the domain constraints, but the table is empty so there is no need to instantiate the default." ([message](https://www.postgresql.org/message-id/229413.1741144420@sss.pgh.pa.us))
  - D2 [design] Tom Lane, 2026-06-06: "The fundamental problem with this whole mess is that it treats certain kinds of default-expression evaluation error (i.e., domain CHECK failures) differently from others. There is no way that that leads to a consistent user experience." ([message](https://www.postgresql.org/message-id/36611.1780777185@sss.pgh.pa.us))
  - D3 [design] Andrew Dunstan (committer of revert), 2026-06-08: "The change failed with an empty table and an invalid default, and the best way to deal with that will involve an addition to the TAM API, so it's not ready for relese 19 now." (source: commit message of a0354e29c41 (local git, verified))

