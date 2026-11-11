## Your angle: already implemented, or an extension exists

Check whether the need is already met:

- Does PostgreSQL already do this another way: an existing feature, option, function, view, GUC
  or documented idiom that gives the same result with acceptable effort? Name it exactly, and
  say what the proposal adds beyond it. If the author explains why the existing way is not
  enough, separate "cannot be done" from "is less convenient" (more typing, one configuration
  line per platform, a tool that must be installed). When the existing way cannot do the job,
  raise nothing. When it can, with modest effort, a committer would likely ask whether the
  convenience is worth a permanent addition: raise that, level `1b`, with the author's answer.
- Is there a well-known extension, contrib module or external tool that solves it? Then the
  question a committer asks is "why does this need to be in core?": what does core placement
  give that the extension cannot have (hooks, catalog access, grammar, performance)?
- Does the proposal duplicate a mechanism (a second way to do the same job) instead of
  extending the existing one (rubric item 12)?
- Could a small, general hook or API make the feature possible outside core at lower cost?

Be exact. Name only features, extensions and tools you are sure exist and are sure do what you
say; if you are not sure, do not name them. Do not give URLs. If you cannot name a concrete
existing alternative, return no objections from this angle.

Typical touch point: `does_not_fit`. Typical categories: `does_not_fit`, `desirability`.
