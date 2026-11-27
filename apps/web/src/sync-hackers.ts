#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadWebConfig } from "./config.ts";
import { WebDatabase } from "./db.ts";
import { syncHackersToDb } from "./hackers.ts";

function parseCliArgs(argv: string[]) {
  let repo = process.env.PGROAST_POSTGRES_REPO || "";
  let ref = "HEAD";
  let doFetch = false;
  let fetchContributors = true;
  let since = "";
  let maxCount = 0;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--repo" && argv[i + 1]) repo = argv[++i]!;
    else if (a === "--ref" && argv[i + 1]) ref = argv[++i]!;
    else if (a === "--fetch") doFetch = true;
    else if (a === "--no-contributors") fetchContributors = false;
    else if (a === "--since" && argv[i + 1]) since = argv[++i]!;
    else if (a === "--max" && argv[i + 1]) maxCount = Number(argv[++i]!) || 0;
  }

  if (!repo) {
    const candidates = [
      join(homedir(), "github", "postgres"),
      join(homedir(), "postgres"),
      join(homedir(), "work", "postgres"),
    ];
    repo = candidates.find((p) => existsSync(join(p, ".git"))) || "";
  }
  return { repo, ref, doFetch, fetchContributors, since, maxCount };
}

const args = parseCliArgs(process.argv.slice(2));
if (!args.repo || !existsSync(join(args.repo, ".git"))) {
  console.error("Error: PostgreSQL git repo not found. Pass --repo /path/to/postgres or set PGROAST_POSTGRES_REPO.");
  process.exit(1);
}

if (args.doFetch) {
  console.log(`[hackers-sync] Fetching upstream master in ${args.repo}…`);
  const f = spawnSync("git", ["-C", args.repo, "fetch", "upstream", "master"], { stdio: "inherit" });
  if (f.status === 0) {
    args.ref = "upstream/master";
  } else {
    const f2 = spawnSync("git", ["-C", args.repo, "fetch", "origin", "master"], { stdio: "inherit" });
    if (f2.status === 0) args.ref = "origin/master";
  }
}

const cfg = loadWebConfig();
const db = await WebDatabase.create({ databaseUrl: cfg.databaseUrl });
try {
  const result = await syncHackersToDb(db, {
    repoPath: args.repo,
    ref: args.ref,
    since: args.since || undefined,
    maxCount: args.maxCount || undefined,
    fetchContributors: args.fetchContributors,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await db.close();
}
