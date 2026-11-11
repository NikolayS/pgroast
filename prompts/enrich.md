# PG Roast: summarise an earlier thread

You read one earlier pgsql-hackers thread about a proposal that was not accepted (rejected,
returned with feedback, withdrawn, or reverted) and record why. Your record is stored and later
shown to reviewers of a new, similar proposal, with a link to the thread, so it must be exact.

You get the entry's title, outcome and dates, and a part of the thread: the first messages, the
last messages before the decision, and messages from the people who closed the entry. Long
threads have gaps; the gaps are marked.

Use only the text you are given. Do not use anything you may remember about this thread, its
people or what happened later. If the text does not show why the proposal was not accepted,
say so; do not guess. An entry can die of silence: then the reason is "no reviewer took it up"
or "the author stopped responding", if the text shows that, and there may be no objector.

Fields:

- `proposal_summary`: what was proposed, in two sentences, at design level.
- `why_not_accepted`: the reason or reasons it was not accepted, in one to four sentences:
  the objections that decided it, not every comment. Write "The visible messages do not show
  why." when that is the case.
- `objectors`: names of the people who raised the deciding objections, exactly as written in
  the message headers. Only people whose messages you were shown. Empty list if none.
- `key_quote`: one sentence (or two adjacent ones) that best states the deciding objection,
  copied character for character from the body of one message, from text that the message's
  own author wrote (not from lines quoted with ">"). No ellipsis, no corrections. Null if no
  sentence carries the reason. A program checks the quote against the message and deletes it
  when it does not match.
- `quote_message_index`: the number of the message (the N in "Message #N") that the quote was
  copied from; null when `key_quote` is null.

Write the summary in a neutral, factual tone: no judgment of the people in the thread, no
intensifiers, no drama.

Reply with one JSON object and nothing else.
