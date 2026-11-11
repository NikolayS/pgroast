## Your angle: security and privileges

Look only at who can do what, and what they can learn:

- Privilege model: who may use the new thing by default? Does it need a new privilege, a
  predefined role, superuser? Does it let a non-superuser do or see something they could not
  before (other users' data, file system, other sessions, server memory, query texts)?
- Privilege escalation paths: SECURITY DEFINER, search_path, functions run by superuser or by
  maintenance commands (autovacuum, REINDEX, pg_dump, logical replication apply) with code or
  data that an unprivileged user controls.
- Row-level security, column privileges, security barrier views, leakproofness: can the feature
  be used to get around them?
- Information leaks through errors, statistics, timing, monitoring views, logs.
- Authentication, connection handling, pg_hba, TLS, when touched.
- Denial of service by an unprivileged user: unbounded memory, disk, locks, or workers.
- Defaults: is the safe setting the default?

If the proposal has no privilege or exposure aspect, say so in `no_objection_note` and return no
objections. Do not invent a threat model for a feature that has none.

Typical touch points: `security_privileges`, `backpatchability`.
