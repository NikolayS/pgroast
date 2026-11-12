// pgroast batch: roast every entry of one commitfest into a directory, one folder per entry.
//
//   bun run src/batch.ts <commitfest-number> --out DIR [--status open|all|"Needs review,..."]
//       [--blind N] [--limit K] [--only id,id] [--concurrency N] [--backend claude|codex]
//       [--transcripts DIR] [--dry-run] [--offline]
//
// Resumable: an entry whose roast.json exists is skipped. The run stops at the first usage-limit
// error instead of failing every remaining entry; start it again later with the same command.
// Output is local files only. Whether DIR is a git repository, and who can read it, is the
// caller's business: nothing here commits or pushes.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName } from "./roast/llm.ts";
import { closePrecedents } from "./roast/precedents.ts";
import { runRoast } from "./roast/pipeline.ts";
import { renderCompactMarkdown, renderMarkdown, renderSummary } from "./roast/render.ts";
import type { Roast } from "./roast/schema.ts";
import { CACHE_ROOT, fetchText } from "./thread/fetch.ts";
import { loadProposal } from "./thread/load.ts";

export interface BatchEntry {
  id: number;
  title: string;
  status: string;
  authors: string;
}

export const OPEN_STATUSES = ["Needs review", "Waiting on Author", "Ready for Committer"];

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The entries listed on a commitfest page (https://commitfest.postgresql.org/<n>/). */
export function parseCommitfestList(html: string): BatchEntry[] {
  const out: BatchEntry[] = [];
  const seen = new Set<number>();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
    const link = cells[0]?.match(/<a href="\/patch\/(\d+)\/">([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const id = Number(link[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const status = cells.map((c) => c.match(/<span class="badge bg-[^"]*">([^<]+)<\/span>/i)?.[1]?.trim()).find(Boolean) ?? "unknown";
    // Columns: Patch, ID, Status, Tags, Ver, CI status, Stats, Author, ...
    out.push({ id, title: text(link[2]!), status, authors: text(cells[7] ?? "") });
  }
  return out;
}

export function selectEntries(all: BatchEntry[], o: { status?: string; only?: number[]; limit?: number }): BatchEntry[] {
  const want = !o.status || o.status === "open" ? OPEN_STATUSES : o.status === "all" ? null : o.status.split(",").map((s) => s.trim());
  let list = all.filter((e) => !want || want.some((w) => w.toLowerCase() === e.status.toLowerCase()));
  if (o.only?.length) list = list.filter((e) => o.only!.includes(e.id));
  list.sort((a, b) => a.id - b.id);
  return o.limit != null ? list.slice(0, o.limit) : list;
}

/** A subscription or rate limit: stop the batch, do not mark the entry as failed. */
export const isLimitError = (msg: string) => /usage limit|hit your .*limit|rate limit|quota|too many requests|\b429\b|overloaded/i.test(msg);

export interface BatchOptions {
  cf: number;
  outDir: string;
  status?: string;
  blind?: number;
  limit?: number;
  only?: number[];
  concurrency?: number;
  backend?: BackendName;
  transcriptsDir?: string;
  dryRun?: boolean;
  offline?: boolean;
  log?: (m: string) => void;
  /** injected for tests */
  listFn?: (cf: number) => Promise<BatchEntry[]>;
  roastOne?: (e: BatchEntry, dir: string) => Promise<Roast>;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

/** README.md of the output directory: one row per finished entry, built from the roast.json files. */
export function renderIndex(cf: number, outDir: string, entries: BatchEntry[]): string {
  const rows: string[] = [];
  const counts = new Map<string, number>();
  let done = 0;
  for (const e of entries) {
    const f = join(outDir, "cf", String(e.id), "roast.json");
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, "utf8")) as Roast;
    done++;
    counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    const top = r.objections[0];
    rows.push(`| [${e.id}](cf/${e.id}/roast.md) | ${oneLine(e.title)} | ${e.status} | ${r.verdict} | ${r.objections.length} | ${top ? oneLine(top.title) : ""} | ${r.prior_attempts.length} |`);
  }
  const failed = entries.filter((e) => existsSync(join(outDir, "cf", String(e.id), "error.json"))).length;
  return [
    `# Design pre-reviews: commitfest ${cf}`,
    "",
    "> Prepared by an AI harness; treat as a devil's advocate, not a verdict.",
    "",
    "Each entry was read from its mailing-list thread and its patch prose. No code was read. Every report lists objections a reviewer may raise, with links to the thread; none of them is a decision about the patch.",
    "",
    `Entries selected: ${entries.length}; done: ${done}; failed: ${failed}; not yet run: ${entries.length - done - failed}.`,
    "",
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `- ${v}: ${n}`),
    "",
    "| Entry | Title | CommitFest status | Verdict | Objections | First objection | Prior attempts |",
    "|---|---|---|---|---:|---|---:|",
    ...rows,
    "",
  ].join("\n");
}

export async function runBatch(o: BatchOptions): Promise<{ done: number; skipped: number; failed: number; stopped: string | null; selected: number }> {
  const log = o.log ?? ((m: string) => console.error(m));
  const outDir = resolve(o.outDir);
  const backendName: BackendName = o.dryRun ? (o.backend ?? "claude") : pickBackend(o.backend);
  const models = modelsFromEnv(process.env, backendName);
  const transcripts = resolve(o.transcriptsDir ?? join(CACHE_ROOT, "batch-llm", String(o.cf)));

  const list =
    o.listFn ??
    (async (cf: number) => {
      // The listing changes during a commitfest: cache it per day, not forever.
      const html = await fetchText(`https://commitfest.postgresql.org/${cf}/`, { cacheDir: join(CACHE_ROOT, "batch-list", new Date().toISOString().slice(0, 10)), offline: o.offline });
      if (!html) throw new Error(`commitfest ${cf}: the listing page could not be read`);
      return parseCommitfestList(html);
    });
  const all = await list(o.cf);
  const entries = selectEntries(all, o);
  log(`commitfest ${o.cf}: ${all.length} entries listed, ${entries.length} selected (${o.status ?? "open"}${o.limit != null ? `, limit ${o.limit}` : ""})`);
  mkdirSync(join(outDir, "cf"), { recursive: true });

  const roastOne =
    o.roastOne ??
    (async (e: BatchEntry, dir: string) => {
      const transcriptDir = join(transcripts, String(e.id));
      const backend = o.dryRun ? new DryRunBackend({ transcriptDir, print: () => undefined }) : new CliBackend({ backend: backendName, transcriptDir, log: (m) => log(`[${e.id}] ${m}`) });
      const proposal = await loadProposal(String(e.id), { blind: o.blind, offline: o.offline });
      return runRoast(proposal, { backend, models, backendName: o.dryRun ? "dry-run" : backendName, hint: null, enrich: true, mode: "review", rounds: 0, log: (m) => log(`[${e.id}] ${m}`) });
    });

  const res = { done: 0, skipped: 0, failed: 0, stopped: null as string | null, selected: entries.length };
  const queue = [...entries];
  const one = async (e: BatchEntry) => {
    const dir = join(outDir, "cf", String(e.id));
    if (existsSync(join(dir, "roast.json"))) {
      res.skipped++;
      return;
    }
    mkdirSync(dir, { recursive: true });
    rmSync(join(dir, "error.json"), { force: true });
    const t0 = Date.now();
    try {
      const r = await roastOne(e, dir);
      r.stats.wall_ms = Date.now() - t0;
      writeFileSync(join(dir, "roast.md"), renderCompactMarkdown(r));
      writeFileSync(join(dir, "roast-full.md"), renderMarkdown(r));
      writeFileSync(join(dir, "roast-summary.txt"), renderSummary(r));
      writeFileSync(join(dir, "roast.json"), JSON.stringify(r, null, 2) + "\n"); // last: marks the entry done
      res.done++;
      log(`[${e.id}] ${r.verdict} (${r.confidence}); ${r.objections.length} objection(s); ${r.stats.llm_calls} calls; ${Math.round(r.stats.wall_ms / 1000)} s  [${res.done + res.skipped}/${entries.length}]`);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (isLimitError(msg)) {
        res.stopped ??= msg.split("\n")[0]!;
        queue.length = 0; // let the other workers finish their entry, start nothing new
        if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
        log(`[${e.id}] stopped by a usage limit; this entry will run again next time`);
        return;
      }
      writeFileSync(join(dir, "error.json"), JSON.stringify({ id: e.id, title: e.title, error: msg.split("\n")[0] }, null, 2) + "\n");
      res.failed++;
      log(`[${e.id}] FAILED: ${msg.split("\n")[0]}`);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, entries.length || 1)) }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) await one(e);
  });
  await Promise.all(workers);
  await closePrecedents();
  writeFileSync(join(outDir, "README.md"), renderIndex(o.cf, outDir, entries));
  return res;
}

export function parseBatchArgs(argv: string[]): BatchOptions {
  const rest = [...argv];
  const o: Partial<BatchOptions> = {};
  const value = (flag: string) => {
    const v = rest.shift();
    if (v == null || v === "") throw new Error(`${flag} needs a value`);
    return v;
  };
  const int = (flag: string, min: number) => {
    const n = Number(value(flag));
    if (!Number.isInteger(n) || n < min) throw new Error(`${flag} needs a whole number of at least ${min}`);
    return n;
  };
  for (let tok = rest.shift(); tok != null; tok = rest.shift()) {
    if (tok === "--out") o.outDir = value(tok);
    else if (tok === "--status") o.status = value(tok);
    else if (tok === "--blind") o.blind = int(tok, 1);
    else if (tok === "--limit") o.limit = int(tok, 1);
    else if (tok === "--concurrency") o.concurrency = int(tok, 1);
    else if (tok === "--only") o.only = value(tok).split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    else if (tok === "--backend") {
      const b = value(tok);
      if (b !== "claude" && b !== "codex") throw new Error("--backend is claude or codex");
      o.backend = b;
    } else if (tok === "--transcripts") o.transcriptsDir = value(tok);
    else if (tok === "--dry-run") o.dryRun = true;
    else if (tok === "--offline") o.offline = true;
    else if (/^\d+$/.test(tok) && o.cf == null) o.cf = Number(tok);
    else throw new Error(`unexpected argument "${tok}"`);
  }
  if (o.cf == null) throw new Error("give the commitfest number, for example 62");
  if (!o.outDir) throw new Error("--out DIR is required");
  return o as BatchOptions;
}

if (import.meta.main) {
  try {
    const o = parseBatchArgs(process.argv.slice(2));
    const r = await runBatch(o);
    console.error(`batch: ${r.done} done, ${r.skipped} already done, ${r.failed} failed, ${r.selected - r.done - r.skipped - r.failed} left${r.stopped ? `; stopped: ${r.stopped}` : ""}`);
    process.exit(r.stopped ? 3 : 0);
  } catch (e) {
    console.error(`pgroast batch: ${(e as Error).message}`);
    process.exit(2);
  }
}
