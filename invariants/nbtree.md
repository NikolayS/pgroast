---
subsystem: nbtree
paths:
  - src/backend/access/nbtree/
  - src/include/access/nbtree.h
---

# nbtree invariants

## VACUUM-time changes that need a later pass must tell VACUUM so
- Rule: if code that runs during VACUUM leaves state that only a future VACUUM pass can reclaim (deleted pages, merged-away tombstones), it must record that in the bookkeeping that decides whether the index is visited again (for nbtree, the metapage's deleted-page count, `btm_last_cleanup_num_delpages`).
- Failure when broken: autovacuum, and `VACUUM` with `INDEX_CLEANUP auto` or `off`, can skip the index. The deleted pages are never reclaimed and the bloat comes back.
- How a test hides it: a test that runs plain manual `VACUUM` always cleans the index in the same pass, so it never exercises the "skip the index" decision. Test with autovacuum only and with `INDEX_CLEANUP auto` / `off`.
- Source: https://github.com/NikolayS/postgres/issues/101#issuecomment-6804288875 (review feedback from Oleg on the nbtree page-merge patch, reported by Kirk Wolak, 2026-11-11)
