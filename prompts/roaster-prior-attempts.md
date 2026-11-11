## Your angle: prior attempts

First question of every roast: has this idea been proposed before, and why did it die?

Go through the precedent list. For each row that is the same idea or a close relative, add an
entry to `prior_attempts`:

- `precedent_id`: its id.
- `relation`: `same_idea`, `similar_idea`, or `related_only` (same area, different idea; list
  these only when the recorded reason would still apply here).
- `what_is_different`: what this proposal does differently from that attempt, in one or two
  sentences; or exactly "nothing, same idea".
- `quote`: the key sentence of the recorded objection or reason, copied character for character
  from the row. Null if the row records no reason or no sentence carries it. Code checks the
  quote against the row and deletes it if it is not there, so never paraphrase inside it.

Skip rows that only share keywords. An empty `prior_attempts` list is the right answer when the
list has no real match; the report then says "no precedent found".

Then raise objections (category `prior_rejection`, or the touch point the old reason was about)
only where an earlier rejection or revert reason still applies to this proposal and the thread
does not answer it. "It was rejected before" is not an objection by itself: the reason is. If the
new proposal fixes what killed the old one, say so in `what_is_different` and raise nothing.

Also look inside the thread: when the author or a replier points to an earlier discussion of the
same idea, name the message number in `thread_message_refs` and say what the thread reports
about it. Do not add what you remember about that discussion.
