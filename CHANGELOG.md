# Changelog

## v2.0.0-alpha.1 (2026-11-25)

v2 makes cross-family reviews, multi-thread CommitFest ingestion, novelty grouping, CommitFest shortlists, and `pgsql-bugs` triage the default on `main`.

This release addresses the feedback from running v1 across the November 2026 CommitFest: some roasts read an older patch version, some repeated points already open on the thread, and the output needed a clearer split between proposals worth committer time and proposals worth closing or rethinking.

### Highlights

- **Cross-family model backends (`--backend agy` and `--backend dual`)**
  - Added an `agy` CLI driver for Gemini 4 Neon models (`gemini-4-neon-high`, `gemini-4-neon-xhigh`).
  - Added `--backend dual`, which splits the seven roasters between Claude Opus and Gemini 4 Neon, puts the Critic on `agy` (`gemini-4-neon-xhigh`), and runs Synthesis on Claude (`claude-mythos-5-2` or `claude-fable-5-2`). Set `PGROAST_DUAL_CRITIC_BACKEND=claude` to flip Critic and Synthesis.
  - Auto-detects `CLAUDE_CONFIG_DIR=~/.claude` when `~/.claude/.claude.json` exists and strips `GEMINI_API_KEY` and `GOOGLE_API_KEY` so every run stays on CLI subscriptions.
  - Updated `pgroast doctor` to check `claude`, `codex`, `agy`, and `dual` readiness.

- **Latest patch and full multi-thread ingestion**
  - Picks the latest patch set from any sender on the thread instead of only the original thread starter, skipping `nocfbot*` attachments.
  - Infers patch revision tags (such as `v8` or `v20251216`) from attachment filenames and records `latest_patch` metadata in `roast.json` and the report header.
  - Merges all linked mailing list threads for a CommitFest entry chronologically (unless `--blind` is passed) so continuation threads are no longer missed.

- **Novelty tracking, Critic v2, and cleaner prose**
  - Classifies surviving objections by `novelty`: `new` (not raised on the thread), `revisits_precedent` (connects to an earlier rejected attempt or revert), or `open_in_thread` (already under active discussion). Compact `roast.md` groups new and precedent findings ahead of thread-open points.
  - Separates Critic `duplicate` verdicts from `refuted` objections and allows the Critic to upgrade a `major` objection to `fatal` when warranted.
  - Calibrated verdict rules to avoid collapsing sound proposals into `NEEDS-DESIGN-DISCUSSION` when only minor or thread-open concerns remain, and reframed the replication/on-disk prompt to treat `pg_upgrade` as a checklist item unless the patch actually breaks it.
  - Strips internal tags (`[P3]`, angle IDs) from lead summaries in rendered reports.

- **CommitFest shortlist and top-closing digest (`pgroast shortlist`)**
  - Ranks a batch directory into a CommitFest Shortlist (proposals worth committer attention) and a Top-N list of proposals worth closing or rethinking, with actionable next steps for authors.
  - Routes shortlisted entries to active subsystem reviewers using `git log` history and `Reviewed-by` trailers from a local Postgres clone (`--pg-repo`).
  - Works on both v1 and v2 `roast.json` batch directories and writes `shortlist.md`, `top-reject.md`, and `shortlist.json` locally.

- **`pgsql-bugs` production-impact triage (`pgroast bugs`)**
  - Fetches recent `pgsql-bugs` threads, separates real production user hits from synthetic fuzzer or AI bug-hunt reports, ranks by impact (data loss, wrong results, crash/OOM, regression), and writes `bugs-triage.md` and `bugs-triage.json` locally.

- **Built-in basic skills with configurable custom override (`skills/`, `src/skills.ts`)**
  - Ships simple default skills for `-hackers` plain-text review etiquette, isolated patch verification, and `pgsql-bugs` triage so new users get working defaults out of the box.
  - Set `PGROAST_SKILLS_DIR` to point to your own private skills folder to override or extend the defaults.

### Quickstart tips

You only need **one** AI coding CLI signed in on your subscription (`claude`, `codex`, or `agy`), Bun 1.3.5+, and a local Postgres instance for the precedent index. Nothing is posted anywhere; all output stays in local files.

1. **Load the precedent database once and check your CLI login:**

```bash
bun run src/cli.ts init-db
bun run src/cli.ts doctor
```

2. **Run your first roast on any CommitFest entry or `-hackers` thread:**

```bash
# Uses whichever single AI CLI you have installed (claude > codex > agy)
bun run src/cli.ts 5879

# Preview prompts without calling any model
bun run src/cli.ts --dry-run 5879

# Review your own draft before posting
bun run src/cli.ts --self --proposal ./draft.txt --patch ./v1-0001.patch
```

3. **Optional power-user tips:**
   - **Claude login in `~/.claude`:** if `doctor` reports an expired Claude session while your interactive `claude` works, run with `CLAUDE_CONFIG_DIR=~/.claude`.
   - **Claude model fallback:** if your Claude account has Fable 5.2 instead of Mythos 5.2, set `export PGROAST_CRITIC_MODEL=claude-fable-5-2`.
   - **Cross-family Dual mode:** if you have both `claude` and `agy` signed in, pass `--backend dual` to split roasters across both families and run Critic and Synthesis on opposite models.
   - **Batch shortlist + subsystem routing:** run `bun run src/cli.ts shortlist ./out/cf-62 --pg-repo ~/postgres` to generate `shortlist.md` and `top-reject.md`.
   - **Triage `pgsql-bugs`:** run `bun run src/cli.ts bugs --days 14 --limit 30` to surface production user hits above synthetic bug hunts.
   - **Custom skills:** set `export PGROAST_SKILLS_DIR=~/my-skills` to override the built-in defaults in `skills/` with your own voice or review checklist.

### Verification

- `tsc --noEmit`: 0 errors.
- `bun test`: 170 tests passing across 7 files.
