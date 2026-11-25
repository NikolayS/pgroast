# Basic Patch Verification Skill (Default)

Use this checklist when building and testing a PostgreSQL patch locally.

## Isolated worktree

1. Create a clean git worktree from `origin/master` (never work directly in a dirty main checkout).
2. Apply the latest patch set with `git apply --check` before `git apply`.
3. Record the base commit SHA and the patch filenames you applied.

## Build and test

1. Configure with meson (`meson setup build --buildtype=debug -Dcassert=true`).
2. Compile with `ninja -C build`.
3. Run the targeted regression or TAP suite for the subsystem touched by the patch (`meson test -C build <suite>`).
4. Review `git diff --stat` and check compiler warnings in the touched files.

## Reporting results

- Report the exact base commit, patch version, commands run, and observed result.
- Separate facts observed from open design questions.
