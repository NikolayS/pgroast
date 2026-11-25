// "PG Light Roast" (Kirk Wolak's Nov 25 idea):
// Friendly, constructive author pre-flight checklist for incoming patches:
// - Top: clear, concrete submission hygiene checks (common mistakes before committer review)
// - Bottom: gentle "Experimental design heads-up" noting questions committers may ask.

import type { CfEntryRecord, RoastJson } from "../types.ts";
import { extractWorkaroundFinding } from "./shortlist.ts";

export interface LightRoastCheckItem {
  id: string;
  label: string;
  status: "ok" | "check" | "warn";
  detail: string;
}

export interface LightRoastReport {
  cf_id: number;
  title: string;
  checks: LightRoastCheckItem[];
  experimentalHeadsUp: string[];
  workaround: string;
  markdown: string;
}

export function buildLightRoast(entry: CfEntryRecord, roast: RoastJson | null): LightRoastReport {
  const checks: LightRoastCheckItem[] = [];
  let attachments: string[] = [];
  try {
    attachments = JSON.parse(entry.attachments_json || "[]") as string[];
  } catch {
    attachments = [];
  }

  // 1. Patch attachment & naming
  const hasPatchFile = attachments.some((a) => /\.(patch|diff)(\.(gz|bz2))?$/i.test(a));
  const hasVersionPrefix = attachments.some((a) => /^v\d+/i.test(a));
  checks.push({
    id: "patch_naming",
    label: "Versioned patch attachments (vN-0001-*.patch)",
    status: hasPatchFile ? (hasVersionPrefix ? "ok" : "check") : "check",
    detail: hasPatchFile
      ? hasVersionPrefix
        ? `Found versioned patch files (${attachments.slice(0, 3).join(", ")}).`
        : "Patch attached; consider prefixing revisions with v1-, v2-, etc. so cfbot tracks updates clearly."
      : "No patch attachment detected in local metadata; verify the latest patch set is attached to the thread.",
  });

  // 2. CFBot / rebase check
  const cb = (entry.cfbot_status || "").toLowerCase();
  checks.push({
    id: "cfbot_clean",
    label: "Applies cleanly to master and passes CFBot",
    status: cb === "passing" ? "ok" : cb === "failing" || cb === "needs_rebase" ? "warn" : "check",
    detail:
      cb === "passing"
        ? "CFBot reports passing builds on current master."
        : cb === "needs_rebase"
          ? "Patch needs a rebase onto current master before review."
          : cb === "failing"
            ? "CFBot reports a build or test failure; check the CI logs and post a fixed revision."
            : "Verify `git apply --check` on current master and check CFBot status.",
  });

  // 3. Formatting & pgindent
  checks.push({
    id: "pgindent",
    label: "PostgreSQL coding style and pgindent",
    status: "check",
    detail: "Run `src/tools/pgindent/pgindent` on touched C files and check for trailing whitespace or mixed tabs/spaces.",
  });

  // 4. Tests
  const touched = roast?.brief?.touched_files ?? [];
  const touchesTests = touched.some((f) => /\/(test|regress|t\/|expected|sql)\//i.test(f));
  checks.push({
    id: "tests",
    label: "Regression or TAP tests included",
    status: touchesTests ? "ok" : "check",
    detail: touchesTests
      ? "Patch touches test files; verify edge cases and error paths are covered."
      : "Confirm regression (`src/test/regress`) or TAP tests cover the new behavior or bug fix.",
  });

  // 5. Documentation
  const hasUserSurface = (roast?.brief?.user_visible_surface?.length ?? 0) > 0;
  const touchesDocs = touched.some((f) => /^doc\//i.test(f));
  checks.push({
    id: "docs",
    label: "Documentation updated for user-visible changes",
    status: !hasUserSurface || touchesDocs ? "ok" : "warn",
    detail: touchesDocs
      ? "Documentation changes detected in `doc/`."
      : hasUserSurface
        ? `User-visible surface detected (${roast!.brief!.user_visible_surface!.slice(0, 3).join(", ")}); make sure SGML docs and release notes are updated.`
        : "Verify whether any SGML documentation or comments need updating.",
  });

  // 6. Commit message & motivation
  const hasProblem = Boolean(roast?.brief?.problem && roast.brief.problem.length > 20);
  checks.push({
    id: "commit_msg",
    label: "Commit message explains why, not just what",
    status: hasProblem ? "ok" : "check",
    detail: hasProblem
      ? "Problem statement is clear; ensure the commit message summarizes the motivation, trade-offs, and test plan."
      : "Include a clear motivation (real use case or reproducer) in the cover letter and commit message.",
  });

  // 7. Catalog / pg_upgrade / WAL touch points
  const hitTouch = (roast?.touch_points ?? []).filter((t) => t.hit).map((t) => t.label || t.id);
  const touchesSensitive = hitTouch.some((t) => /on-disk|pg_upgrade|wal|catalog|wire|abi/i.test(t));
  checks.push({
    id: "compat_touchpoints",
    label: "Compatibility check (pg_upgrade, WAL, catalog, ABI)",
    status: touchesSensitive ? "warn" : "ok",
    detail: touchesSensitive
      ? `Touches sensitive areas (${hitTouch.slice(0, 4).join(", ")}); address upgrade, replication, and backward-compatibility impact explicitly.`
      : "No sensitive on-disk, WAL, or catalog compatibility touch points flagged.",
  });

  // 8. Prior attempts awareness
  const priors = roast?.prior_attempts ?? [];
  checks.push({
    id: "prior_attempts",
    label: "Prior pgsql-hackers discussions addressed",
    status: priors.length > 0 ? "warn" : "ok",
    detail:
      priors.length > 0
        ? `Related prior thread(s) found (${priors.slice(0, 2).map((p) => p.title).join("; ")}); note in your cover letter what is different this time.`
        : "No blocking prior rejected attempts matched in the precedent index.",
  });

  // Experimental design heads-up (gentle author-facing notes)
  const workaround = extractWorkaroundFinding(roast);
  const experimentalHeadsUp: string[] = [];
  if (workaround) {
    experimentalHeadsUp.push(`Existing alternative to address: ${workaround}`);
  }
  for (const o of (roast?.objections ?? []).slice(0, 3)) {
    const q = o.author_must_show ? ` (${o.author_must_show})` : "";
    experimentalHeadsUp.push(`${o.title}${q}`);
  }
  if (roast?.not_now?.applies && roast.not_now.evidence_that_would_change_it) {
    experimentalHeadsUp.push(`Real-world motivation to highlight: ${roast.not_now.evidence_that_would_change_it}`);
  }

  const mdLines: string[] = [
    `PG Light Roast (Author Pre-Flight Checklist) for CF ${entry.cf_id}: ${entry.title}`,
    "",
    "Note: Prepared by an AI harness as an early, friendly pre-flight check before committer review.",
    "",
    "1. Submission checklist:",
    ...checks.map((c) => `- [${c.status === "ok" ? "ok" : c.status === "warn" ? "attention" : "check"}] ${c.label}: ${c.detail}`),
  ];

  if (experimentalHeadsUp.length > 0) {
    mdLines.push(
      "",
      "2. Experimental design heads-up (questions a committer may ask you to defend):",
      ...experimentalHeadsUp.map((h) => `- ${h}`),
    );
  }

  return {
    cf_id: entry.cf_id,
    title: entry.title,
    checks,
    experimentalHeadsUp,
    workaround,
    markdown: mdLines.join("\n"),
  };
}
