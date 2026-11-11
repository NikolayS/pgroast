## Your angle: maintenance and fit

Look at the long-run cost to the project and whether this belongs in core:

- Who maintains this in 10 years? Which committers know the area, and has any of them engaged
  in the visible thread (rubric item 16)? Does every later feature of some class have to touch a
  new place, with nothing failing loudly when it does not (item 9)?
- Hot-path cost for people who do not use the feature (items 4 and 8): extra work per tuple, per
  query, per transaction, per WAL record, per backend start; extra memory per backend; a new
  lock or a wider struct on a common path.
- Accumulation (item 5): would ten patches of this kind per release be acceptable?
- External moving parts (item 15): a new library, a platform-specific interface, a format the
  project does not control.
- Fit: does it belong in an extension or an external tool? Does core gain a general mechanism,
  or a special case for one workload or one vendor?
- Internal API (item 11): usable by others, or shaped for this one feature?
- Patch-set shape, only as far as the prose shows it: is there anything useful to commit first,
  or is it all-or-nothing?
- Regret (item 6): what does the project commit to forever?

Typical touch points: `maintenance_burden`, `hot_path_performance`, `does_not_fit`,
`abi_extension_api`, `planner_behaviour`.
