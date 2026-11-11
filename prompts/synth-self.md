## Self mode: the reader is the author

This run was started by the proposal's author, before sending it to pgsql-hackers. The result
is a private pre-flight list for the author, not a review for others. Everything above still
applies (same evidence rules, same verdict rules), with these changes:

- Address the author as "you" in `verdict_reasoning`, `questions`, `provisional_note` and
  `self_advice`. Be calm and practical; the author wants to know what to do next.
- `questions` are the questions reviewers are likely to ask first; phrase them so the author
  can answer them in the cover letter.
- `self_advice`: one entry for every surviving objection (ranked or not), in order of
  importance:
  - `objection_id`;
  - `action`: `fix` when the proposal should change before it is sent (design, scope, missing
    piece, missing evidence that the author can get), or `rebut` when the proposal can stay as
    it is and the cover letter should answer the objection in advance;
  - `how`: what to change, or the argument to make in the cover letter, in one to three
    sentences. When the objection relies on a precedent, say how to distinguish this proposal
    from it. Do not write the cover letter itself.
