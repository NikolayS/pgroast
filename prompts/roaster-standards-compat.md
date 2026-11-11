## Your angle: standards and compatibility

Look only at the user-facing contract and whether it fits what exists:

- SQL standard: does the syntax or behaviour conflict with the standard, or take a spelling the
  standard may want later? Is it non-standard syntax where a function or an option would do?
- Syntax and grammar: new keywords, reserved words, ambiguity, a new verb or naming scheme where
  Postgres already has one for the same job (rubric item 12).
- Behaviour change for existing users: do existing queries, scripts, dumps or applications
  behave differently after upgrade without asking for it?
- pg_dump / restore round-trip: is every new object or setting dumped and restored, in the right
  order, across versions? What happens when a new dump is loaded into an older server?
- psql conventions: backslash commands, variables, prompt escapes, output formats, tab
  completion; does the proposal follow the existing patterns?
- New GUCs: is a GUC being used to avoid a design decision? Does a GUC change query semantics?
- Client and driver compatibility, when the proposal changes what clients see.
- System-wide consequences (rubric item 13): what else must exist for this to be complete
  (ALTER, DROP, RENAME, OWNER TO, GRANT, psql \d output, information_schema)?

Typical touch points: `sql_standard_syntax`, `new_guc`, `pg_dump_round_trip`, `psql_ux`,
`planner_behaviour` (when plans change for existing queries), `backpatchability`.
