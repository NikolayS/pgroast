# Thread reading: what is the real pushback?

A long pgsql-hackers thread about a PostgreSQL proposal was read in parts. From each part you
get candidate objections (ids like C7, each with the message number, date, sender, one-sentence
statement and, when code could verify it, a verbatim sentence), responses to objections (ids
like R3), and a note on the state of the discussion. You also get facts computed by code: the
number of messages, the dates of the first and the last message, messages per year, the
CommitFest status history when there is one, and the text of the last messages.

Your job: say what actually blocks this proposal, and whether each blocker was ever resolved.

Use only what you are given. Do not use anything you may remember about this thread, its
people, or what happened to the feature. No links. Refer to messages as "message #N".

## 1. Merge

The same objection is often raised many times, by several people, over years. Merge candidates
that are the same objection into one entry. Keep objections apart when they would need
different answers. Leave out candidates that are not blocking (small points that were fixed and
never came back): they need no entry.

## 2. One entry per distinct objection (`objections`, most important first, at most 10)

- `title`: a short plain name for the objection.
- `statement`: the objection in one or two neutral sentences.
- `candidate_ids`: the candidates merged into it (C ids). Code takes the people who raised it,
  the dates, the quotes and the links from these, so list every candidate that belongs.
- `status`:
  - `resolved`: answered, and the objectors accepted the answer or did not come back to it
    while they stayed active in the thread;
  - `partly resolved`: a later version or reply addresses a part of it, or the author says it
    is addressed and the objector has not confirmed;
  - `unresolved`: still stands at the end of the thread, or was repeated after the last answer;
  - `superseded by a redesign`: the proposal changed so much that the objection no longer
    applies as stated.
- `resolved_by_message_indexes`: the numbers of the messages that resolved or addressed it
  (from the responses and from `answered_by_message_index`). Empty for `unresolved`. Code checks
  that each message exists and is later than the objection; an index that fails is removed.
- `status_reasoning`: one or two sentences: what in the material shows this status.
- `blocking`: true when this objection is, by the material, a reason why the proposal is not
  committed today. A resolved objection is not blocking.

## 3. The answer (`summary`)

One paragraph, four to seven sentences, for a person who has not read the thread: what the
actual blocking objection or objections are, in plain words; who raised them is added by code,
so do not list names; whether they were ever resolved; and what would have to happen for the
proposal to move. Refer to messages as "message #N". If nothing blocks it, say so.

## 4. Bucket (`bucket`, `bucket_reason`)

- `dead or superseded`: the thread itself shows that the proposal was withdrawn, replaced by
  other work, or made unnecessary. Give `superseded_by` (what replaced it, in a few words) and
  `superseded_evidence_message_indexes` (the messages that say so). Without such a message this
  bucket is not allowed: age and silence alone are never a reason to call a proposal dead.
- `stuck: needs champion`: the open objections are answerable or answered, the design is
  broadly accepted or contested by few, and what is missing is a committer or reviewer who
  takes it on.
- `stuck: needs design rethink`: an unresolved objection is about the basic design or
  semantics, and versions keep coming without settling it.
- `active`: the discussion is moving and the open points are being worked on.

For the three other buckets `superseded_by` is null and the evidence list is empty.
`bucket_reason`: one or two sentences that tie the bucket to the entries above.

## Tone

People may forward what you write. Calm, respectful, evidence-first: no snark, no sarcasm, no
hyperbole, no "obviously", "clearly", "simply" or "of course", no exclamation marks, nothing
about any participant as a person. Describe positions, not people.

Reply with one JSON object and nothing else.
