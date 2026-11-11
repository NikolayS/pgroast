// Polite, cached HTTP fetcher for the precedent corpus.
//
//  * User-Agent "pgroast-research/0.1", GET only, no cookies, no sign-in
//  * >= 1.05 s between requests to the same host
//  * every 200 response is cached under data/cache/<host>/ and never refetched;
//    a 404 leaves a "<file>.404" marker
//  * 429 / 5xx: honour Retry-After, else exponential back-off 5 s .. 300 s, 6 tries
//
// The cache file naming is byte-compatible with the earlier Python builder so
// pages crawled by it are reused.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const USER_AGENT = "pgroast-research/0.1";
const MIN_INTERVAL_MS = 1050;
export const ROOT = resolve(import.meta.dir, "..", "..");
export const CACHE_DIR = process.env.PGROAST_CACHE_DIR ?? join(ROOT, "data", "cache");

export const fetchStats = { fetched: 0, cached: 0, failed: 0, notFound: 0 };
const lastRequest = new Map<string, number>();

export function cachePath(url: string): string {
  const u = new URL(url);
  let name = u.pathname.replace(/^\/+|\/+$/g, "") || "_root";
  name = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  const query = u.search.replace(/^\?/, "");
  if (query) name += "__" + query.replace(/[^A-Za-z0-9._=-]+/g, "_");
  if (name.length > 150) {
    name = name.slice(0, 100) + "_" + createHash("sha1").update(name).digest("hex").slice(0, 16);
  }
  return join(CACHE_DIR, u.host, name + ".html");
}

export function isCached(url: string): boolean {
  const p = cachePath(url);
  return existsSync(p) || existsSync(p + ".404");
}

export function readCached(url: string): string | null {
  const p = cachePath(url);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Page text, or null for 404 / failure / offline cache miss. */
export async function fetchPage(url: string, opts: { offline?: boolean } = {}): Promise<string | null> {
  const p = cachePath(url);
  if (existsSync(p)) {
    fetchStats.cached++;
    return readFileSync(p, "utf8");
  }
  if (existsSync(p + ".404")) {
    fetchStats.notFound++;
    return null;
  }
  if (opts.offline) return null;
  const host = new URL(url).host;
  let delay = 5000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = (lastRequest.get(host) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest.set(host, Date.now());
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      if (r.ok) {
        const body = await r.text();
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p + ".tmp", body);
        renameSync(p + ".tmp", p);
        fetchStats.fetched++;
        return body;
      }
      if (r.status === 404) {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p + ".404", "");
        fetchStats.notFound++;
        return null;
      }
      if (r.status === 429 || r.status >= 500) {
        const ra = r.headers.get("retry-after");
        const ms = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : delay;
        console.error(`  HTTP ${r.status} on ${url}; backing off ${ms / 1000}s`);
        await sleep(ms);
        delay = Math.min(delay * 2, 300_000);
        continue;
      }
      console.error(`  HTTP ${r.status} on ${url}; giving up`);
      break;
    } catch (e) {
      console.error(`  network error on ${url}: ${e}; backing off ${delay / 1000}s`);
      await sleep(delay);
      delay = Math.min(delay * 2, 300_000);
    }
  }
  fetchStats.failed++;
  return null;
}
