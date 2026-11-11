# PG Roast eval: run `pilot-1`

Scored 2026-11-11T22:23:39.455Z. Rules: [docs/eval.md](../../../docs/eval.md) (fixed before any result). 6 of 18 cases in this run.

## Headline

- **(a) verdict match**: 5/6 (83.3%) lenient, 1/6 (16.7%) strict
- **(b) decisive objection found** (listed or other surviving): 2/6 (33.3%); found or partially: 4/6 (66.7%); found but refuted by the critic: 0
- **(c) earlier attempt found** (in prior attempts): 1/1 (100%); retrieved but not listed: 0; not in corpus (corpus gap, excluded): 0
- **(d) false-alarm rate on accepted cases**: 0/1 (0%)

### Split by post_training_cutoff

The models may remember how famous old threads ended; post-cutoff cases cannot be recalled.

| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |
|---|---:|---|---|---|---|---|---|
| all | 6 | 5/6 (83.3%) | 1/6 (16.7%) | 2/6 (33.3%) | 4/6 (66.7%) | 1/1 (100%) | 0/1 (0%) |
| post-cutoff (true) | 2 | 2/2 (100%) | 0/2 (0%) | 1/2 (50%) | 2/2 (100%) | n/a | n/a |
| pre-cutoff (false) | 4 | 3/4 (75%) | 1/4 (25%) | 1/4 (25%) | 2/4 (50%) | 1/1 (100%) | 0/1 (0%) |

### Split by outcome

| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |
|---|---:|---|---|---|---|---|---|
| rejected | 2 | 1/2 (50%) | 0/2 (0%) | 1/2 (50%) | 2/2 (100%) | 1/1 (100%) | n/a |
| accepted | 1 | 1/1 (100%) | 0/1 (0%) | 0/1 (0%) | 0/1 (0%) | n/a | 0/1 (0%) |
| reverted | 3 | 3/3 (100%) | 1/3 (33.3%) | 1/3 (33.3%) | 2/3 (66.7%) | n/a | n/a |

### Split by level of the decisive objection

Level from a separate classify call that saw only the case, never the roast (idea = rubric 1a/1b, design = 2, implementation = 3-5). An implementation-level reason (a bug, a buildfarm failure) is usually invisible to an idea-level review of the first few emails; those cases are shown apart, not averaged in.

| | cases | (a) verdict lenient | (a) strict | (b) decisive found | (b) found or partial | (c) earlier found | (d) false alarms |
|---|---:|---|---|---|---|---|---|
| idea | 2 | 1/2 (50%) | 0/2 (0%) | 1/2 (50%) | 2/2 (100%) | 1/1 (100%) | n/a |
| design | 4 | 4/4 (100%) | 1/4 (25%) | 1/4 (25%) | 2/4 (50%) | n/a | 0/1 (0%) |

## Cases

| case | outcome | post-cutoff | precedent cutoff | decisive level | verdict | (a) lenient | strict | (b) decisive | bucket | (c) earlier | fatal surviving | calls (roast+judge) | cost | wall |
|---|---|---|---|---|---|---|---|---|---|---|---:|---|---:|---:|
| psql-prompt-time-escape | rejected | no | 2023-02-23 | idea | NEEDS-COMMITTER-EYES (low) | no | no | found | listed | n/a | 0 | 21+3 | $2.10 | 176 s |
| pg-dump-filter-data-where | rejected | no | 2025-08-16 | idea | NEEDS-DESIGN-DISCUSSION (low) | yes | no | partially | listed | found | 0 | 20+3 | $2.30 | 286 s |
| pg-stat-io-view | accepted | no | 2020-01-27 | design | NEEDS-COMMITTER-EYES (medium) | yes | no | not_found | – | n/a | 0 | 12+3 | $1.74 | 133 s |
| split-merge-partitions-pg17 | reverted | no | 2022-06-01 (case 2024-04-07; last shown 2022-05-31) | design | NEEDS-DESIGN-DISCUSSION (medium) | yes | yes | not_found | – | n/a | 0 | 14+3 | $2.54 | 191 s |
| subscription-conninfo-owner-change | reverted | yes | 2026-07-23 | design | NEEDS-COMMITTER-EYES (medium) | yes | no | found | listed | n/a | 0 | 13+3 | $1.53 | 120 s |
| reject-concurrent-sequence-refresh | reverted | yes | 2026-07-12 (case 2026-07-15; last shown 2026-07-11) | design | NEEDS-COMMITTER-EYES (medium) | yes | no | partially | refuted | n/a | 0 | 16+3 | $2.03 | 147 s |

⚑ = decisive objection inside the shown window. Precedent cutoff = min(case cutoff_date, last shown message + 1 day); both dates are shown when the window made it earlier.

Totals: 96 roast calls + 18 judge calls; cost $12.24; wall 18 min (sum over cases).

## Misses

### psql-prompt-time-escape: Proposal: %T Prompt parameter for psql for current time (like Oracle has)

- **Verdict**: NEEDS-COMMITTER-EYES, but the outcome was rejected.

### pg-dump-filter-data-where: PoC: pg_dump --filter-data <file> (like Oracle Where Clause on RMAN for specific tables)

- **Decisive objection** (idea-level): partially (best match already-exists-2, listed). The reviewer argues existing functionality (exclude-table-data plus snapshot COPY) already covers the need, but never raises partitioning by date and skipping old partitions as the better-fitting alternative.
  - D1 [idea] Tom Lane, 2025-08-15: "Have you considered partitioning these tables by date and then not dumping the older partitions? That would fit into existing functionality a lot better." ([message](https://www.postgresql.org/message-id/615474.1755275838@sss.pgh.pa.us))
  - D2 [design] Greg Sabino Mullane, 2025-08-15: "Rather than invent new flags, I think a better approach would be to convince pg_dump to dump a view, such that table foo has a view fooslice to limit / filter the output." ([message](https://www.postgresql.org/message-id/CAKAnmmLYwUw0Kc4E-aBDeYNU=S+RxRx+CTXgBR6dvERAcUvUYQ@mail.gmail.com))
  - D3 [design] Greg Sabino Mullane, 2025-08-15: "While we could make the view mapping into a separate filtering file as you suggest, that's more complexity and also a little more dangerous in an action-at-a-distance way, so I'd rather have people be very specific in the mapping on the command line." ([message](https://www.postgresql.org/message-id/CAKAnmmLYwUw0Kc4E-aBDeYNU=S+RxRx+CTXgBR6dvERAcUvUYQ@mail.gmail.com))

### pg-stat-io-view: pg_stat_bgwriter.buffers_backend is pretty meaningless (-> pg_stat_io)

- **Decisive objection** (design-level): not_found. No reviewer objection argues that the change adds complexity out of proportion to its benefit; the nearest ones (maintenance-fit-1, standards-compat-2) raise specific column-layout and extensibility concerns, which is only topical overlap.
  - D1 [design] Andres Freund, 2022-10-26: "-1, I think this just blows up the complexity further, without providing much benefit." ([message](https://www.postgresql.org/message-id/20221026185808.4qnxowtn35x43u7u@awork3.anarazel.de))

### split-merge-partitions-pg17: Add SPLIT PARTITION/MERGE PARTITIONS commands

- **Decisive objection** (design-level): not_found. No reviewer objection raises repeated name lookups or the resulting race that lets one partition end up with two parents; the security objections concern unspecified privileges and execution context instead.
  - D1 [design] Noah Misch, 2024-08-08: "This breaks from the CVE-2014-0062 (commit 5f17304) principle of not repeating name lookups. The attached demo uses this defect to make one partition have two parents." ([message](https://www.postgresql.org/message-id/20240808171351.a9.nmisch@google.com))
  - D2 [design] Robert Haas, 2024-08-22: "Unfortunately, I think there are too many problems here to be reasonably fixed before release, and I think all of SPLIT/MERGE PARTITION needs to be reverted." ([message](https://www.postgresql.org/message-id/CA+TgmobHYix=Nn8D4RUHa6fhUVPR88KGAMq1pBfnGfOfEjRixA@mail.gmail.com))
  - D3 [design] Robert Haas, 2024-08-22: "In both cases, we do a reverse lookup on an OID to get a name which the CREATE TABLE code will later turn back into an OID. If we don't get the same value, that's at least a bug and probably a security vulnerability, and there is no way to be certain that we will get the same value." ([message](https://www.postgresql.org/message-id/CA+TgmobHYix=Nn8D4RUHa6fhUVPR88KGAMq1pBfnGfOfEjRixA@mail.gmail.com))

### reject-concurrent-sequence-refresh: sequencesync worker race with REFRESH SEQUENCES (fix: reject REFRESH SEQUENCES while a sequencesync worker runs)

- **Decisive objection** (design-level): partially (best match standards-compat-2, refuted). The reviewer notes that a user has no observable way to know whether the sequencesync worker is still running, which overlaps Tom's point that the user cannot be aware of it. It does not argue that rejecting the command is a failure condition that should not be the user's problem.
  - D1 [design] Tom Lane, 2026-07-16: "Well, that would fix this test, but I wonder if this result isn't telling us that f38afa4ab has created a failure condition that will bite real users. Why would the user issuing REFRESH SEQUENCES be aware of whether there's a sync worker running right then? Why should it be his problem to avoid that" ([message](https://www.postgresql.org/message-id/3621808.1784170708@sss.pgh.pa.us))
  - D2 [design] Tom Lane, 2026-07-17: "I grow even more skeptical that f38afa4ab was a good idea. It seems inevitable that it will cause annoying failures in the field." ([message](https://www.postgresql.org/message-id/3848535.1784266437@sss.pgh.pa.us))
  - D3 [design] Amit Kapila (committer of revert), 2026-07-18: "While discussing how to fix the tests, we concluded that blocking the command while a sequencesync worker is running is inconvenient for users. So we will fix the original race differently in a follow-up commit." (source: commit message of dde9a87d4d0 (local git, verified))

