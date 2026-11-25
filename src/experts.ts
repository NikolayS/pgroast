// Subsystem expert routing from a local PostgreSQL git repository.
// Runs `git log` on a patch's touched files/directories and ranks committers and reviewers
// weighted by recency. Degrades gracefully when no repo is available.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Roast } from "./roast/schema.ts";

export interface ExpertMatch {
  name: string;
  score: number;
  commits: number;
  reviews: number;
  lastDate: string;
}

const TRAILER_RE = /^(Committed-by|Reviewed-by|Acked-by|Tested-by|Suggested-by):\s*(.+)$/gim;

function cleanPerson(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse `git log --format="%aI|%an|%ae%n%b%n---END---"` output into recency-weighted experts.
 * Authors and Committed-by trailers carry weight 2.0; Reviewed-by/Acked-by carry weight 1.0.
 */
export function parseGitLogExperts(logOutput: string, now: Date = new Date()): ExpertMatch[] {
  const byKey = new Map<string, { name: string; score: number; commits: number; reviews: number; lastDate: string }>();
  const nowMs = now.getTime();

  const bump = (rawName: string, weight: number, kind: "commit" | "review", dateIso: string) => {
    const name = cleanPerson(rawName);
    if (!name || name.length < 2) return;
    const key = name.toLowerCase();
    const cur = byKey.get(key) ?? { name, score: 0, commits: 0, reviews: 0, lastDate: dateIso };
    cur.score += weight;
    if (kind === "commit") cur.commits++;
    else cur.reviews++;
    if (dateIso > cur.lastDate) {
      cur.lastDate = dateIso;
      cur.name = name;
    }
    byKey.set(key, cur);
  };

  for (const block of logOutput.split("---END---")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf("\n");
    const header = nl >= 0 ? trimmed.slice(0, nl) : trimmed;
    const body = nl >= 0 ? trimmed.slice(nl + 1) : "";
    const [dateRaw, authorRaw] = header.split("|");
    if (!dateRaw || !authorRaw) continue;
    const dateMs = Date.parse(dateRaw.trim());
    const ageDays = Number.isFinite(dateMs) ? Math.max(0, (nowMs - dateMs) / 86_400_000) : 365;
    const decay = Math.exp(-ageDays / 365);
    const dateDay = dateRaw.trim().slice(0, 10);

    const author = cleanPerson(authorRaw);
    const seenInCommit = new Set<string>();
    if (author) {
      bump(author, 2.0 * decay, "commit", dateDay);
      seenInCommit.add(author.toLowerCase());
    }

    for (const m of body.matchAll(TRAILER_RE)) {
      const tag = m[1]!.toLowerCase();
      const people = m[2]!.split(/\s*,\s*/);
      for (const p of people) {
        const clean = cleanPerson(p);
        if (!clean) continue;
        const k = clean.toLowerCase();
        if (seenInCommit.has(k)) continue;
        seenInCommit.add(k);
        if (tag === "committed-by") bump(clean, 2.0 * decay, "commit", dateDay);
        else if (tag === "reviewed-by" || tag === "acked-by") bump(clean, 1.0 * decay, "review", dateDay);
      }
    }
  }

  return [...byKey.values()]
    .map((e) => ({ ...e, score: Math.round(e.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || b.commits - a.commits || b.lastDate.localeCompare(a.lastDate));
}

const SUBSYSTEM_HINTS: [RegExp, string][] = [
  [/\bpg_amcheck\b|\bamcheck\b|\bverify_gist\b|\bverify_nbtree\b/i, "contrib/amcheck"],
  [/\bpageinspect\b/i, "contrib/pageinspect"],
  [/\bpg_stat_statements\b/i, "contrib/pg_stat_statements"],
  [/\bpostgres_fdw\b/i, "contrib/postgres_fdw"],
  [/\bpg_upgrade\b/i, "src/bin/pg_upgrade"],
  [/\bpg_dump\b|\bpg_restore\b/i, "src/bin/pg_dump"],
  [/\bpg_basebackup\b|\bpg_combinebackup\b/i, "src/bin/pg_basebackup"],
  [/\bpsql\b/i, "src/bin/psql"],
  [/\blibpq\b/i, "src/interfaces/libpq"],
  [/\bgist\b/i, "src/backend/access/gist"],
  [/\bgin\b/i, "src/backend/access/gin"],
  [/\bnbtree\b|\bb-?tree\b/i, "src/backend/access/nbtree"],
  [/\bbrin\b/i, "src/backend/access/brin"],
  [/\bvacuum\b|\bautovacuum\b/i, "src/backend/access/heap"],
  [/\blogical\s+replication\b|\bpgoutput\b|\bwalsender\b/i, "src/backend/replication/logical"],
  [/\bwal\b|\bxlog\b|\barchive_mode\b|\brecovery\b/i, "src/backend/access/transam"],
  [/\bplanner\b|\boptimizer\b|\bjoin\b|\bcostsize\b/i, "src/backend/optimizer"],
  [/\bexecutor\b|\bnodeHash\b|\bnodeAgg\b/i, "src/backend/executor"],
  [/\bguc\b/i, "src/backend/utils/misc/guc.c"],
  [/\bpartition(?:ing|ed)?\b/i, "src/backend/partitioning"],
];

/**
 * Extract touched Postgres paths from a Roast (uses v2 `input.touched_files` when available,
 * and falls back to path/subsystem inference for v1 roast.json files).
 */
export function inferFilesFromRoast(r: Roast): string[] {
  if (r.input.touched_files && r.input.touched_files.length > 0) {
    return [...new Set(r.input.touched_files)];
  }
  const blob = [
    r.input.cf?.title ?? "",
    r.input.subject ?? "",
    r.brief?.title ?? "",
    r.brief?.proposed_design ?? "",
    ...(r.brief?.user_visible_surface ?? []),
    ...r.touch_points.filter((t) => t.hit).map((t) => t.reason),
    ...r.objections.map((o) => `${o.title} ${o.argument}`),
    r.committability?.owner_note ?? "",
    r.priority?.reason ?? "",
  ].join("\n");

  const found = new Set<string>();
  for (const m of blob.matchAll(/\b((?:src|contrib|doc)\/[A-Za-z0-9_./-]+\.[a-zA-Z0-9]+)\b/g)) {
    found.add(m[1]!);
  }
  for (const m of blob.matchAll(/\b((?:src|contrib)\/[A-Za-z0-9_/-]+\/)/g)) {
    found.add(m[1]!.replace(/\/+$/, ""));
  }
  if (found.size === 0) {
    for (const [re, path] of SUBSYSTEM_HINTS) {
      if (re.test(blob)) found.add(path);
      if (found.size >= 4) break;
    }
  }
  return [...found];
}

function resolveExistingPaths(pgRepo: string, files: string[]): string[] {
  const out = new Set<string>();
  for (const raw of files) {
    const clean = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!clean || clean.includes("..")) continue;
    if (existsSync(join(pgRepo, clean))) {
      out.add(clean);
      continue;
    }
    // New files added by a patch won't exist in upstream yet: walk up to nearest existing parent dir.
    let dir = dirname(clean);
    while (dir && dir !== "." && dir !== "/") {
      if (existsSync(join(pgRepo, dir))) {
        out.add(dir);
        break;
      }
      dir = dirname(dir);
    }
  }
  return [...out];
}

export interface FindExpertsOptions {
  limit?: number;
  since?: string;
  maxCommits?: number;
  now?: Date;
}

/**
 * Query a local Postgres git clone for the top committers/reviewers touching the given paths.
 * Degrades gracefully to [] if the repo is missing, not a git repo, or has no matches.
 */
export function findSubsystemExperts(
  pgRepo: string | null | undefined,
  files: string[],
  opts: FindExpertsOptions = {},
): ExpertMatch[] {
  if (!pgRepo || !existsSync(pgRepo) || files.length === 0) return [];
  const paths = resolveExistingPaths(pgRepo, files);
  if (paths.length === 0) return [];
  const limit = opts.limit ?? 5;
  const maxCommits = opts.maxCommits ?? 200;
  const since = opts.since ?? "3 years ago";
  const r = spawnSync(
    "git",
    ["-C", pgRepo, "log", "-n", String(maxCommits), `--since=${since}`, "--format=%aI|%an|%ae%n%b%n---END---", "--", ...paths.slice(0, 20)],
    { encoding: "utf8", maxBuffer: 1 << 24 },
  );
  if (r.error || r.status !== 0 || !r.stdout.trim()) return [];
  return parseGitLogExperts(r.stdout, opts.now).slice(0, limit);
}
