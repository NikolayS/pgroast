# PG Roast evaluation

This page explains how the evaluation from issue #189 ("Evaluation") is run
and scored. The scoring rules below were fixed **before any eval result
existed** and must not be tuned after looking at results. If a rule changes,
the change is recorded here with its date and reason, and every run is
rescored.

```
bun run src/eval/cli.ts run   [--run-id ID] [--case ID ...] [--rounds N] [--concurrency 2] [--dry-run] [--backend claude|codex]
bun run src/eval/cli.ts score <run-id> [--no-judge]
bun run src/eval/cli.ts list                     # cases and existing runs
```

## Inputs

`eval/cases.json` (owned by the evalset agent) lists historical proposals
with a known outcome (`rejected`, `accepted` or `reverted`). For each case
the runner uses:

- `thread_url`;
- `blind_n`, the number of thread messages the roaster may read;
- `cutoff_date`, which limits both the messages and the precedents;
- the gold data: `decisive_objections[]` (who, date, message_url, quote,
  category), `earlier_attempts[]` (thread_url, …) and
  `post_training_cutoff`.

The gold data is never shown to the roast pipeline. It is read only by
`score`.

## Run

For each selected case and each round `r` (`--rounds N`, default 1), the
runner calls the roast pipeline in-process (`src/roast/pipeline.ts`
`runRoast`). It uses the same options as
`bun run src/cli.ts <thread_url> --blind <blind_n> --before <cutoff_date>`
(precedent enrichment on, default models from the environment, Opus or Mythos
only). Output goes to
`eval/results/<run-id>/<case-id>[/r<round>]/roast.json`, `roast.md` and
`llm/`, plus `case-meta.json` (wall time, calls, cost, errors).

- **Resumable.** A case or round whose `roast.json` already exists in that
  run is skipped. A failed case writes `error.json` and is retried on the
  next `run` with the same `--run-id`.
- **Concurrency.** `--concurrency` sets how many cases run at once
  (default 2). Each case also uses the pipeline's own LLM semaphore
  (`PGROAST_CONCURRENCY`).
- `--dry-run` uses the pipeline's `DryRunBackend`, so no model is called.
  The output then has placeholder verdicts and is useful only to check the
  wiring.
- Everything under `eval/results/` is git-ignored except
  `eval/results/*/report.md` and `report.json`.

## Scoring (fixed before any result)

### (a) Verdict match

| outcome | lenient match | strict match |
|---|---|---|
| rejected | `LIKELY-REJECT` or `NEEDS-DESIGN-DISCUSSION` | `LIKELY-REJECT` |
| accepted | `NO-FUNDAMENTAL-OBJECTION` or `NEEDS-COMMITTER-EYES` | `NO-FUNDAMENTAL-OBJECTION` |
| reverted | anything except `NO-FUNDAMENTAL-OBJECTION` | `LIKELY-REJECT` or `NEEDS-DESIGN-DISCUSSION` |

The lenient column is the headline number. Strict match is reported next
to it.

### (b) Decisive objection found

Each case gets one judge call, made through the roast LLM backend with the
critic model and no tools. The judge sees:

- the case's `decisive_objections` (who, date, quote, category);
- every objection the roast produced, labelled with its id and its bucket:
  `listed` (`objections`, the ranked steelman), `other_surviving`, or
  `refuted`.

It answers `found`, `partially` or `not_found`, with the matching objection
id and a one-line reason. Code then looks up the bucket of that id, so the
bucket is not the model's claim. The rules the judge is given:

- **found**: the roast states the same core reason (same mechanism or
  concern), even in different words.
- **partially**: same area but a weaker or more generic version, or one of
  several decisive reasons.
- **not_found**: anything else.

Headline: `found` in the `listed` or `other_surviving` bucket. Also
reported: `partially`, and `found` but `refuted`. The latter is a critic
error, not a roaster miss (docs/design.md).

For `accepted` cases with no decisive objection, (b) is "n/a".

`--no-judge` skips the judge call (b becomes `not_scored`). `score` caches
the judge reply in `<run>/<case>/judge.json` and does not call again.

### (c) Earlier attempt found (deterministic)

- If the case has no `earlier_attempts`: **n/a**.
- Otherwise, every message-id is normalised: take the part after
  `/message-id/` (dropping `flat/`, `raw/` and so on) or after
  `postgr.es/m/`, percent-decode it, strip `<>`, and compare
  case-sensitively. The same canonical form is used as in the corpus
  (`canonMsgid`).
- **found**: an earlier-attempt thread is among the roast's
  `prior_attempts[].thread_urls`. **retrieved_only**: it is only in
  `precedents_retrieved[].thread_urls`, meaning retrieval found it but the
  roaster did not list it.
- **not in corpus**: none of the case's earlier-attempt threads exists in
  the `precedent` table at all (any `thread_urls` element). This is a corpus
  gap, not a roaster miss. It is excluded from the denominator and counted
  separately.
- **not_found**: otherwise.
- It is also reported whether the earlier attempt was retrievable under the
  case's cutoff: its corpus row is dated before `cutoff_date` (the
  `--before` rule in docs/corpus.md).

Headline: found / (cases with earlier attempts that are in the corpus).

### (d) False alarms on accepted cases

For each `accepted` case, the report shows the verdict and the number of
**surviving fatal objections**: `objections` plus `other_surviving` with
`severity = "fatal"`. A false alarm is a verdict of `LIKELY-REJECT` or
`NEEDS-DESIGN-DISCUSSION`. Headline: false-alarm rate = false alarms /
accepted cases.

## Report

`score` writes `eval/results/<run-id>/report.md` and `report.json`:

- a summary table, one row per case: outcome, verdict, lenient and strict
  match, decisive objection result and bucket, earlier attempt result,
  surviving fatal objections, LLM calls, cost, and wall time;
- four headline numbers: (a) lenient verdict accuracy (strict next to it),
  (b) decisive objection found rate, (c) earlier attempt found rate, and
  (d) false-alarm rate;
- the same four numbers split by `post_training_cutoff` true and false. The
  models may remember how famous old threads ended, and this split shows how
  much that matters (docs/design.md, "Known weaknesses");
- the misses: for each case that failed (a), (b) or (c), what was missed,
  with the gold quote and link;
- with `--rounds N > 1`, each round is scored on its own, and per-case
  agreement across rounds is shown.

`docs/eval-report.md` is updated only on request.
