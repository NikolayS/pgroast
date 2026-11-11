// Lazy enrichment of precedents at roast time.
//
// Many corpus rows (CommitFest entries above all) carry a title and an outcome but no text that
// says why the proposal failed. For the top candidates of a roast, this module loads the
// precedent's own thread (cached, polite), asks the model once per thread for a short record
// (what was proposed, why it was not accepted, who objected, one verbatim key sentence), checks
// that record against the thread in code, and stores it in the table `precedent_enrichment` so
// every thread is summarised once.
//
// Evidence rules:
//  - the quote must be a substring of the body of the message the model names (quoted lines
//    excluded); otherwise it is dropped. The link to that message is built here, by code.
//  - objector names must be senders of messages in the thread; others are dropped.
//  - only messages dated up to the precedent's decision date are read, so a record never holds
//    anything later than a date the retrieval cutoff has already allowed.
//  - the proposal's own thread is never read here.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../thread/fetch.ts";
import { loadCfEntry, loadThread } from "../thread/load.ts";
import type { Thread, ThreadMessage } from "../thread/types.ts";
import type { LlmBackend } from "./llm.ts";
import { displayName, trimQuotes } from "./material.ts";
import { messageIdOfUrl } from "./precedents.ts";
import { verifyQuote } from "./sanitize.ts";
import type { JsonSchema, Precedent } from "./schema.ts";

export interface Enrichment {
  thread_url: string;
  /** Corpus id of the precedent, e.g. "cf:349". */
  raw_ref: string;
  kind: string;
  /** Messages after this day (YYYY-MM-DD) were not read; "" = whole thread. */
  as_of: string;
  summary: string;
  objection: string;
  objectors: string[];
  key_quote: string | null;
  quote_message_url: string | null;
  model: string;
  created_at: string;
}

export interface EnrichmentStore {
  get(threadUrl: string, asOf: string): Promise<Enrichment | null>;
  put(e: Enrichment): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryEnrichmentStore implements EnrichmentStore {
  readonly rows = new Map<string, Enrichment>();
  async get(threadUrl: string, asOf: string) {
    return this.rows.get(`${threadUrl}|${asOf}`) ?? null;
  }
  async put(e: Enrichment) {
    this.rows.set(`${e.thread_url}|${e.as_of}`, e);
  }
}

export const ENRICHMENT_DDL = `
create table if not exists precedent_enrichment (
  thread_url        text not null,
  as_of             text not null default '',
  kind              text not null,
  raw_ref           text not null,
  summary           text not null,
  objection         text not null,
  objectors         text[] not null default '{}',
  key_quote         text,
  quote_message_url text,
  model             text not null,
  created_at        timestamptz not null default now(),
  primary key (thread_url, as_of)
)`;

/** The store in the corpus database (`pgroast`, PGROAST_DSN). Null when it cannot be reached. */
export async function openPgEnrichmentStore(root: string = REPO_ROOT): Promise<EnrichmentStore | null> {
  const dbPath = join(root, "src", "corpus", "db.ts");
  if (!existsSync(dbPath)) return null;
  try {
    const mod = (await import(dbPath)) as { connect: () => import("bun").SQL };
    const sql = mod.connect();
    await Promise.race([
      sql.unsafe(ENRICHMENT_DDL),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    return {
      async get(threadUrl, asOf) {
        const rows = await sql`
          select thread_url, as_of, kind, raw_ref, summary, objection, array_to_json(objectors)::text as objectors,
                 key_quote, quote_message_url, model, created_at::text as created_at
          from precedent_enrichment where thread_url = ${threadUrl} and as_of = ${asOf}`;
        const r = rows[0];
        return r ? ({ ...r, objectors: JSON.parse(r.objectors as string) } as Enrichment) : null;
      },
      async put(e) {
        await sql`
          insert into precedent_enrichment (thread_url, as_of, kind, raw_ref, summary, objection, objectors, key_quote, quote_message_url, model)
          values (${e.thread_url}, ${e.as_of}, ${e.kind}, ${e.raw_ref}, ${e.summary}, ${e.objection},
                  array(select jsonb_array_elements_text((${JSON.stringify(e.objectors)}::text)::jsonb)),
                  ${e.key_quote}, ${e.quote_message_url}, ${e.model})
          on conflict (thread_url, as_of) do update set
            kind = excluded.kind, raw_ref = excluded.raw_ref, summary = excluded.summary, objection = excluded.objection,
            objectors = excluded.objectors, key_quote = excluded.key_quote, quote_message_url = excluded.quote_message_url,
            model = excluded.model, created_at = now()`;
      },
      async close() {
        await sql.close();
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------

export const ENRICH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    proposal_summary: { type: "string", minLength: 1 },
    why_not_accepted: { type: "string", minLength: 1 },
    objectors: { type: "array", items: { type: "string" } },
    key_quote: { type: "string", nullable: true },
    quote_message_index: { type: "integer", minimum: 1, nullable: true },
  },
};

export interface EnrichReply {
  proposal_summary: string;
  why_not_accepted: string;
  objectors: string[];
  key_quote: string | null;
  quote_message_index: number | null;
}

export const RELEVANCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: { relevant_ids: { type: "array", items: { type: "string" } } },
};

const HEAD = 3;
const TAIL = 8;
const MAX_CHARS = 60_000;

const normName = (s: string) =>
  displayName(s)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** First 3 messages, last 8, and every message from the closers; within a size cap. */
export function selectMessages(messages: ThreadMessage[], closers: string[]): ThreadMessage[] {
  const want = new Set(closers.map(normName).filter(Boolean));
  const pick = new Set<number>();
  messages.forEach((m, i) => {
    if (i < HEAD || i >= messages.length - TAIL || want.has(normName(m.from))) pick.add(i);
  });
  // Over the cap: drop closers' middle messages first (oldest first), then shrink the tail.
  const size = (i: number) => Math.min(messages[i]!.body.length, i === 0 ? 10_000 : 5_000);
  const total = () => [...pick].reduce((n, i) => n + size(i), 0);
  const middle = [...pick].filter((i) => i >= HEAD && i < messages.length - TAIL).sort((a, b) => a - b);
  while (total() > MAX_CHARS && middle.length) pick.delete(middle.shift()!);
  const tail = [...pick].filter((i) => i >= HEAD).sort((a, b) => a - b);
  while (total() > MAX_CHARS && tail.length > 2) pick.delete(tail.shift()!);
  return [...pick].sort((a, b) => a - b).map((i) => messages[i]!);
}

export function renderThreadForEnrichment(p: Precedent, shown: ThreadMessage[], totalVisible: number): string {
  const out: string[] = [
    `Entry: ${p.title}`,
    `Kind: ${p.kind}; outcome: ${p.status || "?"}; decided: ${p.date?.slice(0, 10) ?? "unknown"}; thread started: ${p.first_date?.slice(0, 10) ?? "unknown"}`,
    `Messages shown: ${shown.length} of ${totalVisible}.`,
    "",
  ];
  let prev = 0;
  for (const m of shown) {
    if (m.index > prev + 1) out.push(`[... ${m.index - prev - 1} message(s) not shown ...]`, "");
    prev = m.index;
    const body = m.index === 1 ? m.body.slice(0, 10_000) : trimQuotes(m.body).slice(0, 5_000);
    out.push(`### Message #${m.index} | ${displayName(m.from)} | ${m.date.slice(0, 10)} | ${m.subject}`, "", body, "");
  }
  return out.join("\n");
}

/** The body without quoted lines: a quote must be the message author's own words. */
export function ownText(body: string): string {
  return body
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n");
}

/** Check the model's record against the thread. Pure code. */
export function checkEnrichment(reply: EnrichReply, messages: ThreadMessage[]): { objectors: string[]; key_quote: string | null; quote_message_url: string | null; dropped: string[] } {
  const dropped: string[] = [];
  const senders = new Map(messages.map((m) => [normName(m.from), displayName(m.from)]));
  const objectors: string[] = [];
  for (const o of reply.objectors) {
    const real = senders.get(normName(o));
    if (real) {
      if (!objectors.includes(real)) objectors.push(real);
    } else dropped.push(`objector "${o}" is not a sender in the thread`);
  }
  let key_quote: string | null = null;
  let quote_message_url: string | null = null;
  if (reply.key_quote) {
    const msg = messages.find((m) => m.index === reply.quote_message_index);
    const ok = msg ? verifyQuote(reply.key_quote.replace(/\.\.\.|\[\.\.\.\]|…/g, " \u0000 "), [ownText(msg.body)]) : null;
    if (msg && ok) {
      key_quote = reply.key_quote.trim().replace(/^["“]+|["”]+$/g, "");
      quote_message_url = msg.url;
    } else dropped.push(msg ? "quote not found verbatim in the named message" : "quote names a message that was not shown");
  }
  return { objectors, key_quote, quote_message_url, dropped };
}

export interface EnrichOptions {
  backend: LlmBackend;
  model: string;
  system: string;
  store: EnrichmentStore | null;
  /** At most this many precedents are enriched per run. */
  max?: number;
  /** Evaluation mode: only dated precedents are enriched. */
  evalMode: boolean;
  /** Message-ids of the proposal's own thread(s): never read here. */
  selfMessageIds: string[];
  offline?: boolean;
  /** Injected for tests. */
  loadThreadFn?: (messageId: string) => Promise<Thread>;
  closersFn?: (p: Precedent) => Promise<string[]>;
  log?: (m: string) => void;
}

export interface EnrichStats {
  candidates: number;
  from_cache: number;
  new_calls: number;
  failed: number;
  quotes_verified: number;
  quotes_dropped: number;
  objectors_dropped: number;
}

async function closersOf(p: Precedent, offline?: boolean): Promise<string[]> {
  const m = p.source_id.match(/^cf:(\d+)$/);
  if (!m) return [];
  try {
    const cf = await loadCfEntry(Number(m[1]), { offline });
    const who = cf.history.filter((h) => /^Closed in commitfest/i.test(h.what)).map((h) => h.who);
    return [...who, ...cf.committer.split(","), ...cf.reviewers.split(",")].map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function apply(p: Precedent, e: Enrichment): void {
  p.enriched = true;
  if (!p.summary.trim() || p.summary.trim().startsWith(p.title)) p.summary = e.summary;
  p.objection = e.objection;
  if (!p.objectors.trim()) p.objectors = e.objectors.join(", ");
  p.key_quote = e.key_quote;
  p.quote_message_url = e.quote_message_url;
}

/** Enrich, in place, the first `max` precedents that have a thread and no recorded reason. */
export async function enrichPrecedents(precedents: Precedent[], o: EnrichOptions): Promise<{ stats: EnrichStats; warnings: string[] }> {
  const log = o.log ?? (() => undefined);
  const warnings: string[] = [];
  const self = new Set(o.selfMessageIds);
  const todo = precedents
    .filter((p) => !p.objection.trim() && p.thread_urls.length > 0)
    .filter((p) => !(o.evalMode && !p.date))
    .filter((p) => !p.thread_urls.some((u) => self.has(messageIdOfUrl(u))))
    .slice(0, o.max ?? 8);
  const stats: EnrichStats = { candidates: todo.length, from_cache: 0, new_calls: 0, failed: 0, quotes_verified: 0, quotes_dropped: 0, objectors_dropped: 0 };

  await Promise.all(
    todo.map(async (p) => {
      const threadUrl = p.thread_urls[0]!;
      const asOf = p.date?.slice(0, 10) ?? "";
      try {
        const cached = await o.store?.get(threadUrl, asOf);
        if (cached) {
          stats.from_cache++;
          apply(p, cached);
          return;
        }
        const thread = await (o.loadThreadFn ?? ((id: string) => loadThread(id, { offline: o.offline })))(messageIdOfUrl(threadUrl));
        const visible = asOf ? thread.messages.filter((m) => m.date !== "" && m.date.slice(0, 10) <= asOf) : thread.messages;
        if (visible.length === 0) throw new Error("no message dated on or before the decision date");
        const closers = await (o.closersFn ?? ((x: Precedent) => closersOf(x, o.offline)))(p);
        const shown = selectMessages(visible, closers);
        stats.new_calls++;
        const reply = await o.backend.complete<EnrichReply>({
          label: `enrich-${p.id}`,
          model: o.model,
          system: o.system,
          prompt: `${renderThreadForEnrichment(p, shown, visible.length)}\n\n# Task\n\nRecord why this proposal was not accepted. JSON only.`,
          schema: ENRICH_SCHEMA,
        });
        const chk = checkEnrichment(reply, shown);
        if (reply.key_quote) chk.key_quote ? stats.quotes_verified++ : stats.quotes_dropped++;
        stats.objectors_dropped += reply.objectors.length - chk.objectors.length;
        const e: Enrichment = {
          thread_url: threadUrl,
          raw_ref: p.source_id,
          kind: p.kind,
          as_of: asOf,
          summary: reply.proposal_summary.trim(),
          objection: reply.why_not_accepted.trim(),
          objectors: chk.objectors,
          key_quote: chk.key_quote,
          quote_message_url: chk.quote_message_url,
          model: o.model,
          created_at: new Date().toISOString(),
        };
        try {
          await o.store?.put(e);
        } catch (err) {
          warnings.push(`could not store the enrichment of ${p.source_id}: ${(err as Error).message.split("\n")[0]}`);
        }
        apply(p, e);
        log(`  enriched ${p.id} (${p.source_id}): ${visible.length} messages, quote ${chk.key_quote ? "verified" : "none"}`);
      } catch (err) {
        stats.failed++;
        warnings.push(`precedent ${p.id} (${p.source_id}) could not be enriched: ${(err as Error).message.split("\n")[0]}`);
      }
    }),
  );
  return { stats, warnings };
}
