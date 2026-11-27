#!/usr/bin/env bun
/**
 * Sync active / open PostgreSQL CommitFests from commitfest.postgresql.org into
 * public_entries (preserving all existing AI verdicts, scores, and opinions).
 *
 * Usage:
 *   bun run web:sync-cf            # auto-syncs all Open / In Progress CommitFests (e.g. PG20-3 & PG20-4)
 *   bun run web:sync-cf 62 63      # sync specific CommitFest IDs
 */

import { CF_BASE, parseArchive, parseList } from "../../../src/corpus/cf.ts";
import { loadWebConfig } from "./config.ts";
import { WebDatabase } from "./db.ts";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "pgroast-web/0.3 (+https://pgroast.postgres.ai)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function main(): Promise<void> {
  const cfg = loadWebConfig();
  const db = await WebDatabase.create({ databaseUrl: cfg.databaseUrl });
  try {
    const cliIds = process.argv
      .slice(2)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);

    let cfIds = cliIds;
    if (cfIds.length === 0) {
      const archHtml = await fetchHtml(`${CF_BASE}/archive/`);
      const allCfs = parseArchive(archHtml);
      const active = allCfs.filter((c) => /open|in progress/i.test(c.state || ""));
      // Always include the latest 2 CommitFests (current + next open)
      const latestTwo = allCfs.slice(-2);
      cfIds = Array.from(new Set([...active.map((c) => c.id), ...latestTwo.map((c) => c.id)])).sort((a, b) => a - b);
    }

    let totalUpserted = 0;
    for (const id of cfIds) {
      const html = await fetchHtml(`${CF_BASE}/${id}/`);
      const rows = parseList(html);
      console.log(`CommitFest #${id}: parsed ${rows.length} patches`);
      for (const r of rows) {
        const isBug =
          r.tags.some((t) => /bug/i.test(t)) ||
          /\b(bug\s*#\d+|fix\b|crash|segfault|panic|leak|deadlock|race)\b/i.test(r.title);
        await db.upsertPublicEntry({
          cf_id: r.id,
          title: r.title,
          status: r.status || "Needs review",
          authors: r.authors,
          reviewers: r.reviewers,
          committer: r.committer,
          kind: isBug ? "bugfix" : "feature",
        });
        totalUpserted++;
      }
    }
    console.log(`Synced ${totalUpserted} CommitFest rows across CFs [${cfIds.join(", ")}] into public_entries.`);
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("sync-cf failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
