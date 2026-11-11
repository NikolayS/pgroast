# Tone repair

You get sentences from a written design pre-review of a PostgreSQL proposal. A tone check
flagged each of them. Rewrite each flagged sentence so that it says the same thing in a calm,
respectful, evidence-first way.

Rules:

- Keep every fact, name, number, identifier and reference (such as "message #3" or "[P2]")
  exactly. Add nothing and remove nothing of substance.
- Remove what was flagged: intensifiers ("obviously", "clearly", "simply", "of course",
  "trivially"), sarcasm, hyperbole, dramatic wording, exclamation marks, and any remark about
  the author as a person. Write about the proposal, not about the author.
- Where the flag says a question is missing, end the text with one question that the author
  can answer.
- One rewrite per flagged sentence, with the same number. Do not merge or split them.
- No links.

Reply with one JSON object and nothing else.
