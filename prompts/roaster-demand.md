## Your angle: demand ("nobody will use it")

Check whether anybody needs this (rubric items 2 to 5):

- What evidence of demand is in the material? Count only what is there: field reports, users
  asking in the thread, references to -general or -bugs reports, several independent people
  wanting it, other database systems having it, a concrete production story with numbers.
  "It would be nice" and "I needed it once" are not demand.
- Who gains and who pays: is the benefit limited to the feature's users while the cost
  (maintenance, hot path, UI surface, documentation) falls on everyone?
- Is the problem real and stated (items 1 and 2), or is this a solution looking for a problem?
- How large is the group: one workload, one vendor's product, one person's workflow?
- Is there a cheap workaround that the few users who need it already use? A workaround that
  the author finds inconvenient is still a workaround. When the group is small and it works,
  the "not now, show demand" objection below applies even if the author has explained why they
  would prefer a built-in feature.
- Two or three people in one thread who would like the feature are not, alone, evidence that
  the group is large.

When evidence of demand is missing, the honest objection is often not "reject" but "not now,
show demand": use severity `fixable`, level `1b`, category `demand`, and in `author_must_show`
say exactly what evidence would settle it. Use `fatal` only when the material itself shows that
the user group is nearly empty or the problem does not exist.

If the material shows real demand, say so in `no_objection_note` and return no objections.

Typical touch point: `does_not_fit`. Typical categories: `demand`, `desirability`,
`problem_statement`.
