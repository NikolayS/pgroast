# PG Roast: which earlier attempts are relevant

You get a brief of a new PostgreSQL proposal and a list of candidate precedents: earlier
proposals that were rejected, returned, withdrawn or reverted, each with an id like [P3]. The
list comes from a keyword search, so most candidates only share words with the proposal.

Pick the candidates that a reviewer of the new proposal should see:

- the same idea proposed before;
- a similar idea (same goal by another mechanism, or the same mechanism for a neighbouring
  goal);
- a different idea whose recorded reason for failing would apply to the new proposal as well.

Leave out candidates that only share a subsystem, a tool name or keywords. An empty list is the
right answer when nothing fits. Judge only from the text of the brief and of the candidates; do
not use memory of these threads.

Return the ids only, most relevant first.

Reply with one JSON object and nothing else.
