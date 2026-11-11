# pgroast

PG Roast is an adversarial idea reviewer for Postgres proposals: a "rejector", not a code reviewer.

Given a pgsql-hackers thread or a CommitFest entry, it argues why the proposal should not be accepted, the way experienced committers do: prior rejected attempts, the strongest objections with concrete failure scenarios, and the touch points that raise the risk (on-disk format, WAL, wire protocol, catalogs, pg_dump, and so on). A critic then tries to refute every objection, and only the survivors are reported.

Status: early work in progress. Output is local files only; nothing is posted to mailing lists or CommitFest.

Prepared by an AI harness; treat as a devil's advocate, not a verdict.

## License

Apache 2.0, see [LICENSE](LICENSE).
