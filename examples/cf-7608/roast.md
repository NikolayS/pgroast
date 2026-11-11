# PG Roast: Add pg_stat_progress overview view

> Prepared by an AI harness; treat as a devil's advocate, not a verdict.

- CommitFest: [patch 7608](https://commitfest.postgresql.org/patch/7608/) (Needs review); authors: Josef Šimánek (retro)
- Thread: [\[PATCH v1\] Add pg_stat_progress overview view](https://www.postgresql.org/message-id/flat/CAFp7QwqYGVqF7LO6fDTthpaskRYNPaVXSPXKRQOrYT%3DXMe8kpw%40mail.gmail.com), started 2026-11-07
- Messages read: 1 of 1
- Patch prose read: v1-0001-Add-pg_stat_progress-overview-view.patch (commit message, file list and doc hunks only; no code review)

## 1. Verdict

**NEEDS-DESIGN-DISCUSSION** (confidence: low)

The proposal fails at level 1b on already-exists-1 and demand-1. Message #1 does not say what a three-column, SQL-only view gives over a user-written UNION ALL or a documentation example, and it shows no demand beyond the author, who himself asks whether the view is useful. Neither objection is fatal and the cost is small, so this is "not now, justify and show demand", not a rejection. Confidence is low because the thread is one message with no replies and the verdict rests on absence of evidence.

First failing level, from the base up: **Level 1b: desirability**. The review stops there; higher levels are not evaluated.

- Level 1a: understandability: passed
- Level 1b: desirability: failed
- Level 2: architecture and design: not evaluated
- Levels 3-5 (implementation): out of scope

Provisional: The level 2 objections that survived (standards-compat-1 on the command column name, maintenance-fit-1 on the hand-maintained mapping) were not evaluated because the proposal stops at level 1b. Without the code it could not be checked that the view definition leaks nothing beyond what the existing progress views show, whether the TAP test covers every progress command type, or what the REPACK/DATACHECKSUMS dependency and the rebase conflict are.

## The proposal, restated

**Problem.** Today, to find which operations are reporting progress, a user has to query each pg_stat_progress_* view one by one. The author wants a single place to discover active progress-reporting operations across the cluster. The audience is implied rather than stated: DBAs and monitoring tools. The longer-term aim is to make cluster operations easier to discover and monitor.

**Proposed design.** Add a new system view, pg_stat_progress, defined in system_views.sql. It has one row per backend that is reporting command progress, across all databases. It has three columns: pid, command (the command family), and progress_view (a regclass naming the detailed progress view to consult). The view reuses pg_stat_get_progress_info() and the existing progress reporting permissions, with no backend C changes. datid/datname were considered and left out because some tracked operations (for example base backups) cover the whole cluster. The pg_stat_progress_cluster compatibility view does not add extra rows. Commands that do not support progress reporting do not appear. Catversion is bumped, regression output in rules.out is updated, and a new TAP test is added in test_misc.

**User-visible surface.**
- New system view pg_stat_progress
- Column pg_stat_progress.pid (integer)
- Column pg_stat_progress.command (text), with values ANALYZE, VACUUM, CREATE INDEX (includes REINDEX), BASEBACKUP, COPY, REPACK (includes CLUSTER and VACUUM FULL), DATACHECKSUMS
- Column pg_stat_progress.progress_view (regclass) naming the detailed per-command progress view
- Overview columns visible to all users; detail access follows the existing per-view permission rules
- New documentation section 'Active Command Progress' in monitoring.sgml

**What the author claims.**
- Finding active progress reports currently requires querying each pg_stat_progress_* view separately
- pid, command and progress_view are the minimal common fields
- Implementation reuses existing infrastructure with no backend changes
- datid/datname are omitted because some operations, such as base backups, cover the whole cluster
- Documentation and tests are included; build, regression, isolation and new TAP tests passed locally
- Longer-term aim: easier discovery and monitoring of cluster operations, and extending progress reporting to more commands

**Thread state.** Only the first message is visible; no one has replied yet. The author asks for feedback on usefulness and on the column choice. CFbot reports that the patch needs a rebase.

## 2. Prior attempts

No precedent found (corpus searched for items before 2026-11-07; 15 candidates retrieved, none is the same or a similar idea).

## 3. The steelman of the rejection

### 1. A three-column view that any user can already write as a UNION over the existing pg_stat_progress_* views

- **Severity:** fixable
- **Level:** Level 1b: desirability (rubric item 2)
- **Category:** doesn't fit what Postgres is about (extension / external tool / already solved); touch points: doesn't fit what Postgres is about (extension / external tool / already solved), maintenance burden ("who maintains this in 10 years")
- **Raised by:** already-exists roaster (`already-exists-1`)

**What can go wrong.** A DBA or monitoring tool queries pg_stat_progress, sees pid 12345 with command COPY, and still has to query pg_stat_progress_copy to learn anything useful: which relation, which phase, how far along. The tool therefore keeps its existing per-view queries, and the new view saves it nothing. The project meanwhile carries a permanent catalog view and a frozen three-column API. When a later release wants the overview to carry phase or relid, it has to change a published view shape instead of having designed it once. The same three columns are already one query away today: SELECT pid, 'VACUUM', 'pg_stat_progress_vacuum'::regclass FROM pg_stat_progress_vacuum UNION ALL ... over the seven existing views, or one call to pg_stat_get_progress_info() per command type.

**Why it applies here.** The patch adds no backend changes, and the commit message says so: it only reuses pg_stat_get_progress_info() and the existing views. So the whole feature is a SQL definition in system_views.sql that a user, a monitoring tool or a documented example query could hold just as well. The existing progress views already expose pid. The tool that wants the detail must already know every progress view, so knowing the list of views is no extra burden. Message #1 justifies the view only by "finding active progress reports currently requires querying each pg_stat_progress_* view separately". It does not weigh this against the UNION a user can write, and it does not say what a consumer does with pid/command/progress_view alone that it could not do before. A committer would likely ask: what does core placement give here that a documentation example or a monitoring tool's query lacks? The only candidate visible in the material is that core updates the list automatically when new progress commands appear. But that list is kept by hand in system_views.sql, much as a user would keep it. The narrowest columns were chosen on purpose, which is exactly what makes the view a near-duplicate of the existing UNION idiom rather than an extension of it.

**Precedents.** None cited.

**Thread messages.** [#1 (Josef Šimánek, 2026-11-07)](https://www.postgresql.org/message-id/CAFp7QwqYGVqF7LO6fDTthpaskRYNPaVXSPXKRQOrYT%3DXMe8kpw%40mail.gmail.com)

**What the author must show.** Show what the overview gives that a UNION ALL over the existing progress views (or a documented example query) cannot. This could be common fields that are awkward to assemble today, such as phase, relid/datid where they apply, or a normalized fraction-complete. It could also be a concrete monitoring workflow, or field reports of users or tools that need command discovery without detail. Alternatively, reduce the patch to a documentation example of the UNION query.

**Critic.** Survived. The patch is SQL only and the author does not weigh it against a user-written UNION ALL or a documentation example, so the question of what core placement adds is unanswered in the material. Two parts should be softened. A core view does give something a user's UNION lacks: it tracks the set of progress views per major version, whereas a hand-written UNION breaks when a view such as the REPACK or DATACHECKSUMS one is absent or added. And the 'frozen three-column API' is overstated, because columns can be added later. The core ask remains valid: show a workflow, or richer common columns. This is a 'not now / justify' objection, not a rejection.

### 2. No evidence that anyone besides the author wants this; the only stated need is the author's own

- **Severity:** fixable
- **Level:** Level 1b: desirability (rubric item 3)
- **Category:** demand; touch points: doesn't fit what Postgres is about (extension / external tool / already solved), maintenance burden ("who maintains this in 10 years")
- **Raised by:** demand roaster (`demand-1`)

**What can go wrong.** The view is committed for v20 with no user asking for it. Monitoring tools such as dashboards and exporters already query each pg_stat_progress_* view, because they need the counters and not only the existence of an operation. They keep doing so. The view then sits in system_views.sql and rules.out, and its command list has to be updated by whoever adds progress reporting for the next command. Years later a committer finds no user of it and still has to defend it, while no one can remove it without breaking whoever did start using it.

**Why it applies here.** The material contains no field report, no -general or -bugs thread, no second person asking for it, and no comparison with another system. Message #1 gives the whole motivation in one line: 'finding active progress reports currently requires querying each pg_stat_progress_* view separately'. It then asks the list for 'feedback on the usefulness', so the author has not established usefulness either. No one has replied yet. The audience (DBAs, monitoring tools) is implied, not stated, and the stated longer-term aim of extending progress reporting to more commands is a separate proposal that this view does not deliver. Under rubric item 3 this is 'it would be nice' plus 'I needed it', not demand. The honest result is 'not now, show demand', not a rejection.

**Precedents.** None cited.

**Thread messages.** [#1 (Josef Šimánek, 2026-11-07)](https://www.postgresql.org/message-id/CAFp7QwqYGVqF7LO6fDTthpaskRYNPaVXSPXKRQOrYT%3DXMe8kpw%40mail.gmail.com)

**What the author must show.** Concrete demand from people other than the author. Examples: a monitoring tool such as an exporter, pgwatch-style collector or cloud console that would replace its per-view queries with this view; -general or -bugs threads where users could not find a running operation; or a reviewer or committer in the thread saying they would use it. A stated user workflow in which the overview alone, without the follow-up query, answers the user's question would also help.

**Critic.** Survived. The material shows no demand beyond the author's one-line motivation, and the author himself asks whether the view is useful. The thread is four days old with no replies, so nothing in it lowers this concern. The objection frames the outcome correctly as 'not now / show demand' rather than rejection, and it must not by itself raise the verdict.

## 4. Touch points

| Touch point | Hit | Why |
|---|---|---|
| on-disk format / pg_upgrade | no |  |
| WAL / replication / standby | no |  |
| wire protocol | no |  |
| catalog changes | **yes** | Adds the system view pg_stat_progress in system_views.sql, with a catversion bump and a rules.out change. |
| ABI / extension API | no |  |
| SQL-standard conflict or non-standard syntax | no |  |
| new GUC | no |  |
| planner behaviour change | no |  |
| pg_dump / restore round-trip | no |  |
| psql UX conventions | no |  |
| security / privileges | **yes** | The docs say pid and command are visible to all users, across all databases; detail access relies on the existing per-view permission rules. |
| backpatchability | no |  |
| maintenance burden ("who maintains this in 10 years") | **yes** | The command-family list and the command-to-view mapping are kept by hand in system_views.sql and monitoring.sgml, and must be updated for each new progress command. |
| performance on the hot path | no |  |
| doesn't fit what Postgres is about (extension / external tool / already solved) | **yes** | The view is SQL only over pg_stat_get_progress_info(), so a user, a monitoring tool or a documentation example can already produce the same three columns with a UNION ALL. |

## 5. Questions the author must answer before anyone reviews code

1. What does a core pg_stat_progress view give that a UNION ALL over the existing pg_stat_progress_* views, or a documented example query, does not? Name a workflow in which pid, command and progress_view alone answer the user's question without the second query.
2. Who besides you wants this: which monitoring tool, -general or -bugs report, or user would replace per-view queries with this view?
3. Why does the overview carry no further common fields, for example datid (NULL for cluster-wide operations), relid or phase, so that the common case needs no second query?
4. When a new progress command type is added, what makes a missing branch in pg_stat_progress fail loudly: a backend-derived mapping, or a test that compares the view against the set of progress command types?
5. Why is the column named command when the existing command columns in the create_index, copy and cluster progress views carry the finer-grained actual command (REINDEX, COPY FROM, VACUUM FULL)? Would a different name such as progress_type or command_type be acceptable?

## Committability

"Will not get committed" is not the same as "should be rejected". The verdict above is about the merits (levels 1-2) only; this section is about who would sign for it, and it never changes the verdict.

- **Owner:** silent. It needs a committer who knows the command progress reporting infrastructure and the monitoring system views. Nobody has replied in the visible thread.
- **Liability:** The owner signs for the view's name, its column set and the command-family strings as a user-facing contract for monitoring tools, for as long as the view exists. The owner also signs for keeping the hand-maintained command-to-view mapping complete every time a progress command is added.
- **Author follow-up:** Weak positive sign: in message #1 the author asks for feedback and states a longer-term aim to extend progress reporting to more commands. There is no later message, and the rebase CFbot requested on 2026-11-10 has not been posted yet.

**Not now / show demand: yes.** This is an outcome, not a rejection. Evidence that would change it: Any of the following would change the answer. (1) A monitoring tool maintainer or several independent users stating in the thread that they would use the overview. (2) -general or -bugs reports where users could not find a running operation. (3) A concrete workflow in which the overview alone, without the follow-up query, is the answer. (4) A revised column set, such as nullable datid, relid or phase, that a user-written UNION ALL cannot easily assemble. A stated reason why a core view beats a documentation example would also help, for instance that it tracks the set of progress views per major version.

## Appendix

### Survived the critic, not listed above

- `standards-compat-1` (fixable, level 2) The column name 'command' already means something else in every pg_stat_progress_* view that has it. Not listed: level 2 is above the failing level 1b: not evaluated (base-up stop rule).
- `maintenance-fit-1` (fixable, level 2) Hand-maintained command-to-view mapping in system_views.sql will silently go stale when new progress commands are added. Not listed: level 2 is above the failing level 1b: not evaluated (base-up stop rule).

### Refuted by the critic

- `maintenance-fit-2` A permanent system view for a three-column UNION, with no demand shown. Refuted (not specific): Duplicate of demand-1 for the item 3 no-demand point, and of already-exists-1 for the UNION and column-set point. Its claim that the view 'can no longer drop or rename columns' is also overstated for the stated worry, since adding datid, relid or phase to a system view in a later major release is routine.
- `demand-2` Three columns that any DBA can already get with a short UNION ALL, and the user still has to run a second query. Refuted (not specific): Duplicate of already-exists-1: the same item 2 argument that the three columns are obtainable by a UNION ALL and a second query is still needed. already-exists-1 states it more completely.

### Roasters

- prior-attempts: 0 objection(s). No precedent found. None of the 15 retrieved rows proposes a unified or overview progress view, and none records a reason that would still apply here. [P5] (VACUUM Progress Checker, Returned with feedback, 2016) is in the same area, but it was an earlier per-command progress mechanism, not an overview over existing ones, and it records no objection or reason. So it cannot carry an objection and is not listed as a related prior attempt. [P11] touches monitoring docs linkends and records no reason. [P2], [P3], [P6] and [P8] concern pg_stat_statements. The rest ([P1], [P4], [P7], [P9], [P10], [P12], [P13], [P14], [P15]) share only keywords such as 'view' or 'stats'. Message #1, the only message, points to no earlier discussion of the same idea, and no replier has spoken yet. From the prior-attempts angle there is nothing to raise. Other angles will cover the open questions: value over a user-written UNION, manual upkeep of the command-to-view mapping as new progress commands are added, disclosure of pid/command to all users, and the dependency on REPACK/DATACHECKSUMS from other patches.
- standards-compat: 1 objection(s). Only one objection from the standards and compatibility angle, and it is fixable. Checked and found no problem: - No new SQL syntax, keywords or GUC. - No change to existing views or behaviour, so existing queries are unaffected. - pg_dump is not involved, since this is a system view. - The name pg_stat_progress fits the existing naming scheme. Tools that match names with LIKE 'pg_stat_progress_%' will not pick it up by accident. - Disclosure of pid and command family seems to match what the existing progress views already expose to unprivileged users, but this cannot be confirmed without the code. Left to other angles: - Desirability against a user-written UNION. - Manual upkeep of the command-to-view mapping when progress types are added. - The dependency on REPACK and DATACHECKSUMS being present in the base version.
- replication-ondisk: 0 objection(s). From the replication and on-disk angle this proposal has no persistent or cross-node state to object to. It adds one SQL view in system_views.sql over the existing in-memory pg_stat_get_progress_info() shared-memory data, with a catversion bump. - **On-disk format / pg_upgrade:** no heap, index, SLRU, control-file or relation-file change. The view lives in the system catalogs that initdb creates, so pg_upgrade does nothing special and old data is unaffected. - **WAL / replication:** no WAL record, no change to replay, and nothing a standby or subscriber has to agree on. Progress views are per-node, in-memory and not replicated, so a mixed-version rolling upgrade is not affected. - **Wire protocol:** unchanged. - **ABI / extension API:** the brief says there are no backend C changes, so no struct, hook or signature changes. The catversion bump only rules out back-patching, which is normal for a new system view. - **Pairings (item 14):** no state is created that would need cleanup on error, DROP, crash or promotion. Rows disappear when the backend stops reporting progress. - **Not checked without the code:** - whether the hard-coded command-to-view mapping fails loudly when a new progress command type is added. This is a maintenance concern for another angle. - whether the view behaves sensibly on a hot standby, for example for a base backup taken from a standby. - the cause of the CFbot rebase failure.
- security: 0 objection(s). From the security and privileges angle I found nothing that justifies an objection. 1. The view discloses nothing new. According to the patch prose, it is built only on pg_stat_get_progress_info() and the existing progress-reporting permissions, with no backend C changes. As I understand current behaviour, each pg_stat_progress_* view already shows a row per reporting backend to every user. The pid and database stay visible, and relid and the counters are nulled when the caller lacks pg_read_all_stats or the same role. So any user can already learn "backend X is running a VACUUM/COPY/CREATE INDEX" by querying the individual views or by running the UNION themselves. The new view puts in one place what is already readable; it adds no new class of information. pg_stat_activity also already exposes pid and backend_type to all users. The documented choice "These columns are visible to all users" copies existing practice. By the rubric's own lowering signal, it is not this patch's fault. 2. The patch drops fields rather than adding them. It omits datid/datname, relid and phase, so it exposes less than the detailed views do. Detail access stays governed by those views. 3. No escalation path. It is a plain system view with no SECURITY DEFINER, no user-supplied code, no search_path exposure, and no involvement in maintenance commands, pg_dump or replication apply. RLS, column privileges and leakproofness do not apply. 4. No unprivileged DoS. It is a bounded scan over the backend status array, the same cost as the existing views. Limits of this check, without the code: - I could not confirm that the view's definition does not call the progress function in a way that exposes relid or params unfiltered, for example by deriving progress_view from a privileged column. The commit message says it reuses the existing permissions, so I take that at face value. - I could not check how the DATACHECKSUMS and BASEBACKUP rows are filtered, since they depend on patches not shown. Those are code-level questions, not design objections. Desirability concerns, such as value beyond a user-written UNION and the mapping that must be maintained by hand, belong to other angles.
- maintenance-fit: 2 objection(s). No hot-path concern: the view is pure SQL over pg_stat_get_progress_info() and adds no per-backend or per-tuple cost for non-users. Its cost scales with the number of command families times backend slots, and only when it is queried. Exposing pid and command to all users mirrors what the existing per-command progress views already expose, so I raise no security-fit objection. No new external dependency is involved. The precedents retrieved (pg_stat_statements, the VACUUM progress checker, the pg_hba view and others) have no recorded reasons that apply, so none are cited. Could not check without the code: whether the TAP test already enumerates all ProgressCommandType values, and what the CFbot rebase conflict is (likely its dependency on the REPACK and DATACHECKSUMS work).
- already-exists: 1 objection(s). Only one objection from this angle. I know of no extension or external tool that provides exactly this view, so I name none. The existing alternative is the plain SQL UNION over the pg_stat_progress_* views, or pg_stat_get_progress_info() called per command type. Whether the hand-kept command-to-view mapping drifts as new progress commands are added is a maintenance question for another angle. So is whether showing pid/command to all users is an acceptable disclosure.
- demand: 2 objection(s). The cost side looks small: SQL only, no backend C changes, existing permissions reused, so the costs fall almost entirely on maintainers and not on non-users' hot paths. The objections are therefore 'not now, show demand', not 'reject'. Out of scope for this angle and left to others: whether the command-to-view mapping is something future progress patches will forget to update, and whether exposing pid and command to all users is an acceptable disclosure.

### Precedents retrieved

- P1: [Allow VIEW/RULE recompilation when the underlying tables change](https://wiki.postgresql.org/wiki/Not_Worth_Doing#Views_and_Rules) (do_not_want, Not worth doing, date unknown)
- P2: [Cancel problems of query to pg_stat_statements](https://commitfest.postgresql.org/patch/5825/) (cf, Rejected, 2026-03-25)
- P3: [pg_stat_statements: improve loading and saving routines for the dump file.](https://commitfest.postgresql.org/patch/5512/) (cf, Rejected, 2025-04-04)
- P4: [Additional LWLOCK_STATS statistics](https://commitfest.postgresql.org/patch/373/) (cf, Rejected, 2015-12-22)
- P5: [VACUUM Progress Checker](https://commitfest.postgresql.org/patch/349/) (cf, Returned with feedback, 2016-02-08)
- P6: [Revert "pg_stat_statements: Add coverage for entry_dealloc()"](https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=1141e29b61e9bf82b045540d41b27581fc3207ec) (revert, Reverted, 2023-12-31)
- P7: [EXPLAIN/EXPLAIN ANALYZE REFRESH MATERIALIZED VIEW](https://commitfest.postgresql.org/patch/2928/) (cf, Rejected, 2021-07-10)
- P8: [Fix pg_stat_statements query jumbling to use relation name instead of relation oid](https://commitfest.postgresql.org/patch/365/) (cf, Rejected, 2015-11-15)
- P9: [Allow providing restore_command as a command line option to pg_rewind](https://commitfest.postgresql.org/patch/3213/) (cf, Rejected, 2022-04-07)
- P10: [catalog view to pg_hba.conf file](https://commitfest.postgresql.org/patch/125/) (cf, Returned with feedback, 2015-07-07)
- P11: [PGDOCS - inconsistent linkends to "monitoring" views](https://commitfest.postgresql.org/patch/4602/) (cf, Rejected, 2023-11-30)
- P12: [Revert updatable views](https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=5fe3da927b2857761f9206d9fc597cf5321d9638) (revert, Reverted, 2009-01-27)
- P13: [Add psql command to list constraints](https://commitfest.postgresql.org/patch/3468/) (cf, Rejected, 2022-03-28)
- P14: [SQL function to report log message](https://commitfest.postgresql.org/patch/314/) (cf, Returned with feedback, 2015-12-22)
- P15: [Revert function to get memory context stats for processes](https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=fb844b9f06568aa29303122ac0bb7b4c3cce2542) (revert, Reverted, 2025-05-23)

### Run

- Backend: claude CLI on the subscription login (no API key); models: roasters opus, critic claude-mythos-5-2, synthesis claude-mythos-5-2; no tools given to any of them
- LLM calls: 10; wall time: 118 s; cost reported by the CLI: $1.42
- Sanitizer: 0 link(s) removed, 0 unknown precedent id(s) dropped, 0 bad message reference(s) dropped, 0 unverifiable quote(s) dropped
- Generated: 2026-11-11T18:42:39.329Z by pgroast/0.1

---

Prepared by an AI harness; treat as a devil's advocate, not a verdict.
