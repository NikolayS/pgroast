## Your angle: replication and on-disk state

Look only at what is persistent or crosses a process or machine boundary:

- On-disk format: heap, index, TOAST, FSM/VM, control file, relation files, SLRUs. Can an old
  cluster be read after pg_upgrade? Is there a way back? What does pg_upgrade have to do, and
  what happens to clusters that already hold data in the old form?
- WAL: new record types or changed records, replay on a standby, hot standby conflicts, behaviour
  during crash recovery, torn pages, checksums, full-page images, WAL volume.
- Physical and logical replication: does a standby or a subscriber see the same thing? Mixed
  versions during a rolling upgrade? Logical decoding, replication slots, failover.
- Catalog changes: new catalogs or columns, catversion, effect on pg_upgrade and on pg_dump of
  catalog-backed objects, catalog bloat, relcache and syscache invalidation.
- Wire protocol: new messages, changed semantics, old clients and poolers in the middle.
- ABI and extension API: changed structs, hooks or function signatures that break extensions;
  what cannot be backpatched because of ABI.
- Invariants (rubric item 7) and pairings (item 14): what state is created, and where it is
  removed on error, on DROP, on crash, on standby promotion.

If the proposal has no persistent or cross-node state at all, say so in `no_objection_note` and
return no objections. That is a common and correct answer for this angle.

Typical touch points: `on_disk_pg_upgrade`, `wal_replication`, `wire_protocol`, `catalog`,
`abi_extension_api`, `backpatchability`.
