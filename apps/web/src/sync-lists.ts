#!/usr/bin/env bun
// Sync PostgreSQL mailing lists (incremental /since/ + optional authenticated .mbox backfill + continuous --daemon mode).
//
// Usage:
//   bun run web:sync-lists --days 14
//   bun run web:sync-lists --all --days 7
//   bun run web:sync-lists --lists pgsql-hackers,pgsql-bugs --days 30
//   PGROAST_PG_COOKIE="sessionid=..." bun run web:sync-lists --lists pgsql-hackers --mbox 202611,202610
//   bun run web:sync-lists --all --daemon --interval 15

import { loadWebConfig } from "./config.ts";
import { WebDatabase } from "./db.ts";
import { syncMailingListsIncremental } from "./lists.ts";

async function main() {
  const args = process.argv.slice(2);
  let allLists = false;
  let lists: string[] = [];
  let days = 14;
  let daemon = false;
  let intervalMin = 15;
  let mboxMonths: string[] = [];
  let minFreeDiskGb = 5;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--all") allLists = true;
    else if (a === "--lists" && args[i + 1]) lists = args[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--days" && args[i + 1]) days = Number(args[++i]!) || 14;
    else if (a === "--daemon") daemon = true;
    else if (a === "--interval" && args[i + 1]) intervalMin = Math.max(5, Number(args[++i]!) || 15);
    else if (a === "--mbox" && args[i + 1]) mboxMonths = args[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--min-free-gb" && args[i + 1]) minFreeDiskGb = Math.max(1, Number(args[++i]!) || 5);
  }

  const cfg = loadWebConfig();
  const db = await WebDatabase.create({ databaseUrl: cfg.databaseUrl });

  const runOnce = async (runDays: number) => {
    const res = await syncMailingListsIncremental(db, {
      lists: lists.length ? lists : undefined,
      allLists,
      days: runDays,
      mboxMonths: mboxMonths.length ? mboxMonths : undefined,
      minFreeDiskGb,
    });
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), ...res }));
  };

  try {
    await runOnce(days);
    if (daemon) {
      console.log(`[lists-sync] Continuous daemon mode active — polling every ${intervalMin} min.`);
      // Subsequent daemon polls only need 2-day lookback because watermarks persist in PostgreSQL
      for (;;) {
        await new Promise((r) => setTimeout(r, intervalMin * 60_000));
        try {
          await runOnce(2);
        } catch (err) {
          console.error(`[lists-sync] Daemon poll error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } finally {
    if (!daemon) await db.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[lists-sync] Fatal:", err);
    process.exit(1);
  });
}
