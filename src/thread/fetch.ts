// Polite, read-only HTTP GET with an on-disk cache.
//
// Rules (see docs/design.md):
//  - GET only. No cookies, no credentials, no POST: this module cannot post anything anywhere.
//  - User-Agent "pgroast/0.1".
//  - At least MIN_INTERVAL_MS between requests to one host.
//  - A cached URL is never fetched again (404s are cached as well).
//  - 429 / 5xx / network errors: retry with exponential backoff, honouring Retry-After.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const USER_AGENT = "pgroast/0.1";
export const MIN_INTERVAL_MS = 1100;
export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const DEFAULT_CACHE_DIR = join(REPO_ROOT, "data", "cache", "threads");

/** Hosts this tool is allowed to read. Anything else is refused. */
export const ALLOWED_HOSTS = new Set(["www.postgresql.org", "postgr.es", "commitfest.postgresql.org"]);

export interface FetchOptions {
  cacheDir?: string;
  /** Never touch the network; a cache miss returns null. */
  offline?: boolean;
  maxTries?: number;
  /** Refuse bodies larger than this (bytes). The body is not cached when refused. */
  maxBytes?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface FetchStats {
  fetched: number;
  cached: number;
  notFound: number;
  failed: number;
}

export const stats: FetchStats = { fetched: 0, cached: 0, notFound: 0, failed: 0 };

const lastRequestAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Map a URL to a stable file path under <cacheDir>/<host>/. */
export function cachePath(url: string, cacheDir: string = DEFAULT_CACHE_DIR): string {
  const u = new URL(url);
  let name = (u.pathname.replace(/^\/+|\/+$/g, "") || "_root").replace(/[^A-Za-z0-9._-]+/g, "_");
  if (u.search) name += "__" + u.search.slice(1).replace(/[^A-Za-z0-9._=-]+/g, "_");
  if (name.length > 150) {
    name = name.slice(0, 100) + "_" + createHash("sha1").update(name).digest("hex").slice(0, 16);
  }
  return join(cacheDir, u.host, name);
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - Date.now());
}

/**
 * GET a URL as text. Returns null for 404, for an offline cache miss, for an oversized body,
 * and after all retries failed.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.host)) {
    throw new Error(`refusing to fetch ${url}: host not in the read-only allow list`);
  }
  const p = cachePath(url, opts.cacheDir);
  if (existsSync(p)) {
    stats.cached++;
    return readFileSync(p, "utf8");
  }
  if (existsSync(p + ".404")) {
    stats.notFound++;
    return null;
  }
  if (opts.offline) return null;

  // Serialise requests per host so the minimum interval holds under concurrency.
  const prev = hostQueue.get(u.host) ?? Promise.resolve();
  const run = prev.then(() => fetchUncached(url, p, opts));
  hostQueue.set(
    u.host,
    run.catch(() => undefined),
  );
  return run;
}

async function fetchUncached(url: string, p: string, opts: FetchOptions): Promise<string | null> {
  const host = new URL(url).host;
  const doFetch = opts.fetchImpl ?? fetch;
  const doSleep = opts.sleepImpl ?? sleep;
  const log = opts.log ?? ((m: string) => console.error(m));
  const maxTries = opts.maxTries ?? 5;
  let delay = 5000;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const wait = (lastRequestAt.get(host) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await doSleep(wait);
    lastRequestAt.set(host, Date.now());
    try {
      const res = await doFetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,*/*" },
        redirect: "follow",
        credentials: "omit",
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404 || res.status === 410) {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p + ".404", "");
        stats.notFound++;
        return null;
      }
      if (res.status === 429 || res.status >= 500) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        const pause = Math.min(ra ?? delay, 300_000);
        log(`  HTTP ${res.status} on ${url}; backing off ${Math.round(pause / 1000)}s`);
        await doSleep(pause);
        delay = Math.min(delay * 2, 300_000);
        continue;
      }
      if (!res.ok) {
        log(`  HTTP ${res.status} on ${url}; giving up`);
        break;
      }
      const len = Number(res.headers.get("content-length") ?? "0");
      if (opts.maxBytes && len > opts.maxBytes) {
        log(`  ${url}: ${len} bytes, over the ${opts.maxBytes} limit; skipped`);
        return null;
      }
      const body = await res.text();
      if (opts.maxBytes && body.length > opts.maxBytes) {
        log(`  ${url}: ${body.length} bytes, over the ${opts.maxBytes} limit; skipped`);
        return null;
      }
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p + ".tmp", body);
      renameSync(p + ".tmp", p);
      stats.fetched++;
      return body;
    } catch (e) {
      log(`  network error on ${url}: ${(e as Error).message}; backing off ${Math.round(delay / 1000)}s`);
      await doSleep(delay);
      delay = Math.min(delay * 2, 300_000);
    }
  }
  stats.failed++;
  return null;
}
