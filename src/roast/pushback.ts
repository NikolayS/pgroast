// `pgroast pushback`: for a long-stuck entry, answer "what is the real pushback?".
// Not blind: the whole thread is read (every thread attached to the CommitFest entry).
//
//   map     one call per chunk of messages (roaster model): candidate blocking objections, each
//           with the message that states it and one verbatim sentence; and responses to
//           earlier objections. Code verifies every quote against the message's own
//           (non-quoted) text and takes sender, date and link from the message.
//   reduce  one call (critic model): merge duplicates, decide resolved / partly resolved /
//           unresolved / superseded by a redesign, name the blockers and a bucket. Code checks
//           that resolving messages exist and are later than the objection.
//
// Same rules as a roast: the model has no tools, links come from code only, the tone lint runs
// before files are written, output is local files.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../thread/fetch.ts";
import { loadCfEntry, loadThread, parseInputRef } from "../thread/load.ts";
import type { CfEntry, LoadOptions, ThreadMessage } from "../thread/types.ts";
import { ownText } from "./enrich.ts";
import type { LlmBackend } from "./llm.ts";
import { displayName, trimQuotes } from "./material.ts";
import { loadPrompts, outputContract } from "./pipeline.ts";
import { AllowedUrls, emptyReport, scrubUrls, verifyQuote } from "./sanitize.ts";
import { DISCLOSURE, TONE_REPAIR_SCHEMA, type JsonSchema, type SanitizerReport, type ToneLint } from "./schema.ts";
import { toneCheckFields, type ProseField } from "./tone.ts";

// ------------------------------------------------------------------------------------- input

export interface PushbackMessage extends ThreadMessage {
  /** The thread this message belongs to (an entry can have several). */
  threadUrl: string;
}

export interface PushbackInput {
  arg: string;
  cf: CfEntry | null;
  threads: { url: string; subject: string; messages: number }[];
  /** All messages of all threads, by date, numbered 1..N. */
  messages: PushbackMessage[];
  warnings: string[];
}

/** Merge threads: by date, one copy per message-id, numbered 1..N. */
export function mergeThreads(threads: { threadUrl: string; messages: ThreadMessage[] }[]): PushbackMessage[] {
  const seen = new Set<string>();
  const all: PushbackMessage[] = [];
  for (const t of threads) {
    for (const m of t.messages) {
      const key = m.messageId || m.url;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...m, threadUrl: t.threadUrl });
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all.map((m, i) => ({ ...m, index: i + 1 }));
}

export async function loadPushbackInput(arg: string, opts: LoadOptions = {}): Promise<PushbackInput> {
  const ref = parseInputRef(arg);
  const warnings: string[] = [];
  let cf: CfEntry | null = null;
  let ids: string[];
  if (ref.kind === "cf") {
    cf = await loadCfEntry(ref.id, opts);
    if (cf.threads.length === 0) throw new Error(`CommitFest patch ${ref.id} has no mailing-list thread attached`);
    ids = cf.threads.map((t) => t.messageId);
  } else if (ref.kind === "msgid") ids = [ref.messageId];
  else throw new Error("pushback needs a CommitFest id or a thread");

  const loaded: { threadUrl: string; subject: string; messages: ThreadMessage[] }[] = [];
  for (const id of ids) {
    try {
      const t = await loadThread(id, opts);
      if (!loaded.some((x) => x.threadUrl === t.threadUrl)) loaded.push({ threadUrl: t.threadUrl, subject: t.subject, messages: t.messages });
    } catch (e) {
      warnings.push(`a thread of this entry could not be read and is missing from the result (${id}): ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (loaded.length === 0) throw new Error("no thread could be read");
  const messages = mergeThreads(loaded);
  return { arg, cf, threads: loaded.map((t) => ({ url: t.threadUrl, subject: t.subject, messages: t.messages.length })), messages, warnings };
}

// ------------------------------------------------------------------------------------ chunks

export const MAX_MESSAGE_CHARS = 5000;
export const DEFAULT_CHUNK_CHARS = 60_000;

const clipBody = (body: string) => {
  const t = trimQuotes(body).trim();
  return t.length > MAX_MESSAGE_CHARS ? t.slice(0, MAX_MESSAGE_CHARS) + "\n[... message cut here ...]" : t;
};

export function renderMessage(m: PushbackMessage): string {
  return `### Message #${m.index} | ${displayName(m.from)} | ${m.date.slice(0, 10)} | ${m.subject}\n\n${clipBody(m.body)}`;
}

/** Consecutive messages, each chunk at most `maxChars` of rendered text (one message always fits). */
export function chunkMessages(messages: PushbackMessage[], maxChars: number = DEFAULT_CHUNK_CHARS): PushbackMessage[][] {
  const chunks: PushbackMessage[][] = [];
  let cur: PushbackMessage[] = [];
  let size = 0;
  for (const m of messages) {
    const len = renderMessage(m).length + 2;
    if (cur.length && size + len > maxChars) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(m);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// ----------------------------------------------------------------------------------- schemas

const str: JsonSchema = { type: "string" };
const nonEmpty: JsonSchema = { type: "string", minLength: 1 };
const int: JsonSchema = { type: "integer" };

export const RESPONSE_KINDS = ["new version", "rebuttal", "objector satisfied", "objector repeats", "redesign"] as const;
export const STATUSES = ["resolved", "partly resolved", "unresolved", "superseded by a redesign"] as const;
export const BUCKETS = ["dead or superseded", "stuck: needs champion", "stuck: needs design rethink", "active"] as const;

export const MAP_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    objections: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          message_index: int,
          objection: nonEmpty,
          key_quote: { type: "string", nullable: true },
          answered_in_part: { type: "boolean" },
          answered_by_message_index: { type: "integer", nullable: true },
        },
      },
    },
    responses: {
      type: "array",
      maxItems: 8,
      items: { type: "object", properties: { message_index: int, responds_to: nonEmpty, kind: { type: "string", enum: RESPONSE_KINDS }, summary: nonEmpty } },
    },
    state_note: str,
  },
};

export const REDUCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    objections: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          title: nonEmpty,
          statement: nonEmpty,
          candidate_ids: { type: "array", items: nonEmpty, minItems: 1 },
          status: { type: "string", enum: STATUSES },
          resolved_by_message_indexes: { type: "array", items: int },
          status_reasoning: nonEmpty,
          blocking: { type: "boolean" },
        },
      },
    },
    summary: nonEmpty,
    bucket: { type: "string", enum: BUCKETS },
    bucket_reason: nonEmpty,
    superseded_by: { type: "string", nullable: true },
    superseded_evidence_message_indexes: { type: "array", items: int },
  },
};

interface MapReply {
  objections: { message_index: number; objection: string; key_quote: string | null; answered_in_part: boolean; answered_by_message_index: number | null }[];
  responses: { message_index: number; responds_to: string; kind: (typeof RESPONSE_KINDS)[number]; summary: string }[];
  state_note: string;
}

interface ReduceReply {
  objections: {
    title: string;
    statement: string;
    candidate_ids: string[];
    status: (typeof STATUSES)[number];
    resolved_by_message_indexes: number[];
    status_reasoning: string;
    blocking: boolean;
  }[];
  summary: string;
  bucket: (typeof BUCKETS)[number];
  bucket_reason: string;
  superseded_by: string | null;
  superseded_evidence_message_indexes: number[];
}

// ------------------------------------------------------------------------------------ result

export interface MessageRef {
  index: number;
  from: string;
  date: string;
  url: string;
}

export interface Candidate {
  id: string;
  chunk: number;
  message: MessageRef;
  objection: string;
  /** Verbatim from the message's own text, verified by code; null = quote unavailable. */
  quote: string | null;
  answered_in_part: boolean;
  answered_by: MessageRef | null;
}

export interface ResponseNote {
  id: string;
  chunk: number;
  message: MessageRef;
  responds_to: string;
  kind: (typeof RESPONSE_KINDS)[number];
  summary: string;
}

export interface PushbackObjection {
  title: string;
  statement: string;
  status: (typeof STATUSES)[number];
  status_reasoning: string;
  blocking: boolean;
  /** From the merged candidates, by code. */
  raised_by: string[];
  first_raised: string;
  last_raised: string;
  candidates: Candidate[];
  /** Messages that resolved or addressed it; each exists and is later than the first statement. */
  resolved_by: MessageRef[];
}

export interface Pushback {
  schema_version: 1;
  tool: string;
  generated_at: string;
  input: {
    arg: string;
    cf: { id: number; url: string; title: string; status: string | null; authors: string } | null;
    threads: { url: string; subject: string; messages: number }[];
    messages: number;
    first_message: string;
    /** When the thread last moved. */
    last_message: string;
    last_message_from: string;
    messages_per_year: Record<string, number>;
  };
  backend: string;
  models: { map: string; reduce: string };
  summary: string;
  bucket: (typeof BUCKETS)[number];
  bucket_reason: string;
  /** Only with the "dead or superseded" bucket; "unknown" when no message in the thread shows it. */
  superseded_by: string | null;
  superseded_evidence: MessageRef[];
  objections: PushbackObjection[];
  candidates: Candidate[];
  responses: ResponseNote[];
  chunk_notes: { chunk: number; first_message: number; last_message: number; from_cache: boolean; note: string }[];
  disclosure: string;
  warnings: string[];
  tone_lint: ToneLint;
  sanitizer: SanitizerReport;
  checks: { quotes_verified: number; quotes_dropped: number; candidates_dropped: number; resolving_refs_dropped: number };
  stats: { chunks: number; llm_calls: number; map_from_cache: number; wall_ms: number; cost_usd: number | null; dry_run: boolean };
}

// ------------------------------------------------------------------------------------- cache

export interface MapCache {
  get(key: string): unknown | null;
  put(key: string, value: unknown): void;
}

/** Map replies on disk (data/cache/pushback/), keyed by the model and the exact prompt. */
export function diskMapCache(dir: string = join(REPO_ROOT, "data", "cache", "pushback")): MapCache {
  return {
    get(key) {
      const f = join(dir, `${key}.json`);
      if (!existsSync(f)) return null;
      try {
        return JSON.parse(readFileSync(f, "utf8"));
      } catch {
        return null;
      }
    },
    put(key, value) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(value));
    },
  };
}

// -------------------------------------------------------------------------------------- run

export interface PushbackOptions {
  backend: LlmBackend;
  models: { map: string; reduce: string };
  backendName?: string;
  chunkChars?: number;
  /** null = no cache. Default: on disk. */
  cache?: MapCache | null;
  promptsDir?: string;
  log?: (m: string) => void;
  now?: () => Date;
}

const refOf = (m: PushbackMessage): MessageRef => ({ index: m.index, from: displayName(m.from), date: m.date, url: m.url });

/** Check one chunk's reply against the messages. Pure code. */
export function checkMapReply(
  reply: MapReply,
  chunk: PushbackMessage[],
  chunkNo: number,
  firstId: { c: number; r: number },
  checks: Pushback["checks"],
): { candidates: Candidate[]; responses: ResponseNote[] } {
  const byIndex = new Map(chunk.map((m) => [m.index, m]));
  const candidates: Candidate[] = [];
  const responses: ResponseNote[] = [];
  for (const o of reply.objections) {
    const m = byIndex.get(o.message_index);
    if (!m) {
      checks.candidates_dropped++; // names a message outside this part: no source, no entry
      continue;
    }
    let quote: string | null = null;
    if (o.key_quote?.trim()) {
      const ok = verifyQuote(o.key_quote.replace(/\.\.\.|\[\.\.\.\]|…/g, " \u0000 "), [ownText(m.body)]);
      if (ok) {
        quote = o.key_quote.trim().replace(/^["“]+|["”]+$/g, "");
        checks.quotes_verified++;
      } else checks.quotes_dropped++;
    }
    const ans = o.answered_by_message_index != null ? byIndex.get(o.answered_by_message_index) : undefined;
    const answered = ans && ans.index > m.index ? ans : null;
    if (o.answered_by_message_index != null && !answered) checks.resolving_refs_dropped++;
    candidates.push({ id: `C${firstId.c++}`, chunk: chunkNo, message: refOf(m), objection: o.objection, quote, answered_in_part: o.answered_in_part && answered != null, answered_by: answered ? refOf(answered) : null });
  }
  for (const r of reply.responses) {
    const m = byIndex.get(r.message_index);
    if (!m) continue;
    responses.push({ id: `R${firstId.r++}`, chunk: chunkNo, message: refOf(m), responds_to: r.responds_to, kind: r.kind, summary: r.summary });
  }
  return { candidates, responses };
}

export function pushbackSlug(input: PushbackInput): string {
  if (input.cf) return `pushback-cf-${input.cf.id}`;
  const id = input.messages[0]?.messageId ?? "thread";
  return "pushback-msg-" + id.replace(/@.*$/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function runPushback(input: PushbackInput, opts: PushbackOptions): Promise<Pushback> {
  const t0 = Date.now();
  const log = opts.log ?? ((m: string) => console.error(m));
  const { backend, models } = opts;
  const prompts = loadPrompts(opts.promptsDir);
  const read = (name: string) => readFileSync(join(opts.promptsDir ?? join(REPO_ROOT, "prompts"), name), "utf8").trim();
  const mapSystem = `${read("pushback-map.md")}\n\n${outputContract(MAP_SCHEMA, false)}`;
  const reduceSystem = `${read("pushback-reduce.md")}\n\n${outputContract(REDUCE_SCHEMA, false)}`;
  const cache = opts.cache === undefined ? diskMapCache() : opts.cache;
  const warnings = [...input.warnings];
  const report = emptyReport();
  const checks: Pushback["checks"] = { quotes_verified: 0, quotes_dropped: 0, candidates_dropped: 0, resolving_refs_dropped: 0 };
  const msgs = input.messages;
  if (msgs.length === 0) throw new Error("the thread has no messages");
  const byIndex = new Map(msgs.map((m) => [m.index, m]));
  const title = input.cf?.title ?? msgs[0]!.subject;

  // Links the output may contain: the threads, their messages, links written in the messages.
  const allowed = new AllowedUrls();
  for (const t of input.threads) allowed.add(t.url);
  if (input.cf) allowed.add(input.cf.url);
  for (const m of msgs) {
    allowed.add(m.url);
    allowed.addFromText(m.body);
  }

  // Map: one call per chunk, in parallel (the backend limits concurrency).
  const chunks = chunkMessages(msgs, opts.chunkChars ?? DEFAULT_CHUNK_CHARS);
  log(`pushback: ${msgs.length} messages in ${input.threads.length} thread(s), ${chunks.length} chunk(s); at most ${chunks.length + 2} model calls (map ${chunks.length}, reduce 1, tone repair 0-1)`);
  let fromCache = 0;
  const replies = await Promise.all(
    chunks.map(async (chunk, i) => {
      const prompt = [
        `Entry: ${title}`,
        `Part ${i + 1} of ${chunks.length}: messages #${chunk[0]!.index} to #${chunk[chunk.length - 1]!.index} of ${msgs.length} (${chunk[0]!.date.slice(0, 10)} to ${chunk[chunk.length - 1]!.date.slice(0, 10)}).`,
        `# Messages\n\n${chunk.map(renderMessage).join("\n\n")}`,
        "# Task\n\nList the blocking objections and the responses in this part. JSON only.",
      ].join("\n\n");
      const key = createHash("sha256").update(`${models.map}\n${mapSystem}\n${prompt}`).digest("hex").slice(0, 40);
      const hit = backend.dryRun ? null : (cache?.get(key) as MapReply | null | undefined);
      if (hit) {
        fromCache++;
        return { reply: hit, cached: true };
      }
      try {
        const reply = scrubUrls(await backend.complete<MapReply>({ label: `pushback-map-${i + 1}`, model: models.map, system: mapSystem, prompt, schema: MAP_SCHEMA }), allowed, `pushback-map-${i + 1}`, report);
        if (!backend.dryRun) cache?.put(key, reply);
        return { reply, cached: false };
      } catch (e) {
        warnings.push(`part ${i + 1} (messages #${chunk[0]!.index} to #${chunk[chunk.length - 1]!.index}) could not be read and is missing from the result: ${(e as Error).message.split("\n")[0]}`);
        return { reply: null, cached: false };
      }
    }),
  );
  if (replies.every((r) => !r.reply)) throw new Error("no part of the thread could be read by the model");

  const ids = { c: 1, r: 1 };
  const candidates: Candidate[] = [];
  const responses: ResponseNote[] = [];
  const chunkNotes: Pushback["chunk_notes"] = [];
  replies.forEach((r, i) => {
    const chunk = chunks[i]!;
    if (!r.reply) return;
    const checked = checkMapReply(r.reply, chunk, i + 1, ids, checks);
    candidates.push(...checked.candidates);
    responses.push(...checked.responses);
    chunkNotes.push({ chunk: i + 1, first_message: chunk[0]!.index, last_message: chunk[chunk.length - 1]!.index, from_cache: r.cached, note: r.reply.state_note });
  });
  log(`map: ${candidates.length} candidate objection(s), ${responses.length} response(s); quotes: ${checks.quotes_verified} verified, ${checks.quotes_dropped} dropped; ${fromCache} part(s) from cache`);

  // Facts by code.
  const first = msgs[0]!;
  const last = msgs[msgs.length - 1]!;
  const perYear: Record<string, number> = {};
  for (const m of msgs) perYear[m.date.slice(0, 4)] = (perYear[m.date.slice(0, 4)] ?? 0) + 1;
  const tailMsgs = msgs.slice(-3);

  // Reduce.
  log("reduce ...");
  const reduce = scrubUrls(
    await backend.complete<ReduceReply>({
      label: "pushback-reduce",
      model: models.reduce,
      system: reduceSystem,
      prompt: [
        `Entry: ${title}`,
        `# Facts (computed by code)\n\n- Messages: ${msgs.length}, in ${input.threads.length} thread(s)\n- First message: ${first.date.slice(0, 10)} (${displayName(first.from)})\n- Last message: #${last.index}, ${last.date.slice(0, 10)} (${displayName(last.from)})\n- Messages per year: ${Object.entries(perYear).map(([y, n]) => `${y}: ${n}`).join(", ")}` +
          (input.cf ? `\n- CommitFest status: ${input.cf.status ?? "unknown"}; authors: ${input.cf.authors || "not given"}; reviewers: ${input.cf.reviewers || "none listed"}; committer: ${input.cf.committer || "none"}\n- CommitFest status by commitfest: ${input.cf.statuses.map((s) => `${s.cfName}: ${s.status}`).join("; ") || "not available"}` : ""),
        `# Candidate objections\n\n${JSON.stringify(
          candidates.map((c) => ({ id: c.id, message: c.message.index, date: c.message.date.slice(0, 10), from: c.message.from, objection: c.objection, verbatim: c.quote ?? "(quote unavailable)", answered_in_its_part: c.answered_in_part, answered_by_message: c.answered_by?.index ?? null })),
          null,
          1,
        )}`,
        `# Responses to objections\n\n${JSON.stringify(responses.map((r) => ({ id: r.id, message: r.message.index, date: r.message.date.slice(0, 10), from: r.message.from, responds_to: r.responds_to, kind: r.kind, summary: r.summary })), null, 1)}`,
        `# State of the discussion, part by part\n\n${chunkNotes.map((n) => `- Part ${n.chunk} (messages #${n.first_message} to #${n.last_message}): ${n.note}`).join("\n")}`,
        `# The last messages\n\n${tailMsgs.map(renderMessage).join("\n\n")}`,
        "# Task\n\nMerge, decide the status of each distinct objection, write the answer and pick the bucket. JSON only.",
      ].join("\n\n"),
      schema: REDUCE_SCHEMA,
    }),
    allowed,
    "pushback-reduce",
    report,
  );

  // Assemble: people, dates, quotes and links come from the candidates, not from the model.
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const objections: PushbackObjection[] = [];
  for (const o of reduce.objections) {
    const cands = [...new Set(o.candidate_ids.map((x) => x.trim().toUpperCase()))].map((id) => byId.get(id)).filter((c): c is Candidate => c != null);
    const unknown = o.candidate_ids.length - cands.length;
    if (unknown > 0) report.precedent_ids_dropped.push(...o.candidate_ids.filter((x) => !byId.has(x.trim().toUpperCase())).map((id) => ({ stage: "pushback-reduce", id })));
    if (cands.length === 0) {
      warnings.push(`the entry "${o.title}" names no known candidate and has no source in the thread; dropped`);
      continue;
    }
    cands.sort((a, b) => a.message.index - b.message.index);
    const firstIdx = cands[0]!.message.index;
    const resolved: MessageRef[] = [];
    for (const n of [...new Set(o.resolved_by_message_indexes)].sort((a, b) => a - b)) {
      const m = byIndex.get(n);
      if (m && n > firstIdx) resolved.push(refOf(m));
      else checks.resolving_refs_dropped++;
    }
    let status = o.status;
    if ((status === "resolved" || status === "superseded by a redesign") && resolved.length === 0) {
      warnings.push(`"${o.title}" was marked "${status}" with no later message that shows it; changed to "partly resolved"`);
      status = "partly resolved";
    }
    objections.push({
      title: o.title,
      statement: o.statement,
      status,
      status_reasoning: o.status_reasoning,
      blocking: o.blocking && status !== "resolved",
      raised_by: [...new Set(cands.map((c) => c.message.from))],
      first_raised: cands[0]!.message.date,
      last_raised: cands[cands.length - 1]!.message.date,
      candidates: cands,
      resolved_by: resolved,
    });
  }

  // Bucket guard: "dead or superseded" needs a message in the thread that shows it.
  let bucket = reduce.bucket;
  let supersededBy: string | null = null;
  const evidence = [...new Set(reduce.superseded_evidence_message_indexes)].map((n) => byIndex.get(n)).filter((m): m is PushbackMessage => m != null).map(refOf);
  if (bucket === "dead or superseded") {
    if (evidence.length === 0) {
      bucket = objections.some((o) => o.blocking && o.status === "unresolved") ? "stuck: needs design rethink" : "stuck: needs champion";
      warnings.push(`the model said "dead or superseded" without a message in the thread that shows it; age and silence are not evidence, so the bucket is "${bucket}"`);
    } else supersededBy = reduce.superseded_by?.trim() || "unknown";
  }

  const result: Pushback = {
    schema_version: 1,
    tool: "pgroast/0.1",
    generated_at: (opts.now ?? (() => new Date()))().toISOString(),
    input: {
      arg: input.arg,
      cf: input.cf ? { id: input.cf.id, url: input.cf.url, title: input.cf.title, status: input.cf.status, authors: input.cf.authors } : null,
      threads: input.threads,
      messages: msgs.length,
      first_message: first.date,
      last_message: last.date,
      last_message_from: displayName(last.from),
      messages_per_year: perYear,
    },
    backend: opts.backendName ?? (backend.dryRun ? "dry-run" : "claude"),
    models,
    summary: reduce.summary,
    bucket,
    bucket_reason: reduce.bucket_reason,
    superseded_by: supersededBy,
    superseded_evidence: bucket === "dead or superseded" ? evidence : [],
    objections,
    candidates,
    responses,
    chunk_notes: chunkNotes,
    disclosure: DISCLOSURE,
    warnings,
    tone_lint: { fields_checked: 0, hits_found: 0, sentences_rewritten: 0, repair_call: "not needed", remaining: [] },
    sanitizer: report,
    checks,
    stats: { chunks: chunks.length, llm_calls: 0, map_from_cache: fromCache, wall_ms: 0, cost_usd: null, dry_run: backend.dryRun },
  };

  result.tone_lint = await toneCheckFields(() => pushbackProse(result), {
    backend,
    model: models.reduce,
    system: `${prompts.tone}\n\n${outputContract(TONE_REPAIR_SCHEMA, false)}`,
    allowed,
    report,
    log,
  });
  if (result.tone_lint.remaining.length && !backend.dryRun) warnings.push(`tone lint: ${result.tone_lint.remaining.length} finding(s) remain after the repair call; see tone_lint in pushback.json before forwarding this text`);

  const st = backend.stats();
  result.stats = { ...result.stats, llm_calls: st.calls, wall_ms: Date.now() - t0, cost_usd: st.costUsd };
  return result;
}

/** The model-written prose of a pushback report. Verbatim quotes are not ours and are left out. */
export function pushbackProse(r: Pushback): ProseField[] {
  const out: ProseField[] = [];
  const add = <T extends object>(obj: T, key: keyof T, path: string) => {
    if (typeof obj[key] === "string") out.push({ path, get: () => obj[key] as string, set: (v) => void ((obj[key] as string) = v) });
  };
  add(r, "summary", "summary");
  add(r, "bucket_reason", "bucket_reason");
  if (r.superseded_by != null) add(r, "superseded_by", "superseded_by");
  r.objections.forEach((o, i) => {
    add(o, "title", `objections[${i}].title`);
    add(o, "statement", `objections[${i}].statement`);
    add(o, "status_reasoning", `objections[${i}].status_reasoning`);
  });
  return out;
}

// ----------------------------------------------------------------------------------- render

const day = (iso: string) => iso.slice(0, 10);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const link = (text: string, url: string) => (url ? `[${text.replace(/([[\]])/g, "\\$1")}](${url.replace(/\)/g, "%29")})` : text);
const msgLink = (m: MessageRef) => link(`#${m.index} (${m.from}, ${day(m.date)})`, m.url);

/** "message #12" in model prose becomes a link built by code; unknown numbers stay plain text. */
export function linkMessages(text: string, byIndex: Map<number, string>): string {
  return text.replace(/\b(messages?) #(\d+)/gi, (all, word: string, n: string) => {
    const url = byIndex.get(Number(n));
    return url ? `${word} ${link(`#${n}`, url)}` : all;
  });
}

export function renderPushbackMarkdown(r: Pushback): string {
  const out: string[] = [];
  const urls = new Map<number, string>();
  for (const c of r.candidates) {
    urls.set(c.message.index, c.message.url);
    if (c.answered_by) urls.set(c.answered_by.index, c.answered_by.url);
  }
  for (const x of r.responses) urls.set(x.message.index, x.message.url);
  for (const o of r.objections) for (const m of o.resolved_by) urls.set(m.index, m.url);
  for (const m of r.superseded_evidence) urls.set(m.index, m.url);
  const prose = (s: string) => linkMessages(oneLine(s), urls);

  out.push(`# Open objections: ${oneLine(r.input.cf?.title ?? r.input.threads[0]?.subject ?? r.input.arg)}`, "");
  out.push(`> ${r.disclosure}`, "");
  if (r.input.cf) out.push(`- CommitFest: ${link(`patch ${r.input.cf.id}`, r.input.cf.url)}${r.input.cf.status ? ` (${r.input.cf.status})` : ""}; authors: ${r.input.cf.authors || "not given"}`);
  for (const t of r.input.threads) out.push(`- Thread: ${link(oneLine(t.subject), t.url)} (${t.messages} messages)`);
  out.push(`- Read: all ${r.input.messages} messages, ${day(r.input.first_message)} to ${day(r.input.last_message)}; the text of the messages only, no patches and no code`);
  out.push(`- Last moved: ${day(r.input.last_message)} (${r.input.last_message_from})`, "");

  out.push("## What blocks it", "");
  out.push(prose(r.summary), "");
  const blockers = r.objections.filter((o) => o.blocking);
  if (blockers.length === 0) out.push("No objection is marked as blocking.", "");
  out.push(`**Recommended bucket: ${r.bucket}.** ${prose(r.bucket_reason)}`);
  if (r.bucket === "dead or superseded") out.push("", `Superseded by: ${oneLine(r.superseded_by ?? "unknown")}; shown in ${r.superseded_evidence.map(msgLink).join(", ")}`);
  out.push("");

  const block = (o: PushbackObjection, n: number) => {
    out.push(`### ${n}. ${oneLine(o.title)}`, "");
    out.push(`- **Status:** ${o.status}${o.blocking ? "; blocking" : ""}`);
    out.push(`- **Raised by:** ${o.raised_by.join(", ")}; first ${day(o.first_raised)}${o.last_raised !== o.first_raised ? `, last ${day(o.last_raised)}` : ""}`);
    out.push(`- **Resolved or addressed in:** ${o.resolved_by.length ? o.resolved_by.map(msgLink).join(", ") : "no message"}`, "");
    out.push(prose(o.statement), "");
    for (const c of o.candidates) out.push(`- ${msgLink(c.message)}: ${c.quote ? `"${oneLine(c.quote)}"` : `quote unavailable. In short: ${oneLine(c.objection)}`}`);
    out.push("", `**Why this status.** ${prose(o.status_reasoning)}`, "");
  };
  out.push("## Blocking objections", "");
  if (blockers.length === 0) out.push("None.", "");
  blockers.forEach((o, i) => block(o, i + 1));
  const rest = r.objections.filter((o) => !o.blocking);
  out.push("## Other objections raised in the thread", "");
  if (rest.length === 0) out.push("None.", "");
  rest.forEach((o, i) => block(o, blockers.length + i + 1));

  out.push("## How this was produced", "");
  out.push(`- ${r.backend} CLI on the subscription login (no API key); models: reading ${r.models.map}, merging ${r.models.reduce}; the models had no tools`);
  out.push(`- The thread was read in ${r.stats.chunks} part(s) (${r.stats.map_from_cache} from cache); model calls: ${r.stats.llm_calls}; wall time: ${Math.round(r.stats.wall_ms / 1000)} s${r.stats.cost_usd != null && !r.stats.dry_run ? `; cost reported by the CLI: $${r.stats.cost_usd.toFixed(2)}` : ""}${r.stats.dry_run ? "; DRY RUN (no model was called; content is placeholder)" : ""}`);
  out.push(`- Candidate objections found: ${r.candidates.length}; responses found: ${r.responses.length}; merged into ${r.objections.length}`);
  out.push(`- Checks by code: ${r.checks.quotes_verified} quote(s) verified against the message's own text, ${r.checks.quotes_dropped} dropped; ${r.checks.candidates_dropped} candidate(s) without a source message dropped; ${r.checks.resolving_refs_dropped} resolving reference(s) dropped (missing or not later)`);
  const t = r.tone_lint;
  out.push(`- Tone check: ${t.fields_checked} text field(s) checked, ${t.hits_found} finding(s), ${t.sentences_rewritten} sentence(s) rewritten (repair call: ${t.repair_call}), ${t.remaining.length} left`);
  for (const h of t.remaining) out.push(`  - \`${h.path}\`: ${h.rule}${h.match ? ` ("${h.match}")` : ""}`);
  out.push(`- Links: ${r.sanitizer.urls_removed.length} removed (not in the thread)`);
  for (const w of r.warnings) out.push(`- Warning: ${oneLine(w)}`);
  out.push(`- Generated: ${r.generated_at} by ${r.tool}`, "", "---", "", r.disclosure, "");
  return out.join("\n");
}
