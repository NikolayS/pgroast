// `pgroast bugs`: pgsql-bugs Production-Impact Triage (Andrey Borodin's Nov 19 idea).
// Fetches recent pgsql-bugs threads, classifies production hits vs. synthetic/AI bug-hunt reports,
// ranks by real-world impact (data loss / wrong results / crash / OOM / regression), and writes
// bugs-triage.json and bugs-triage.md locally.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createBackend, DryRunBackend, modelsFromEnv, pickBackend, type BackendName, type LlmBackend } from "./roast/llm.ts";
import { outputContract } from "./roast/pipeline.ts";
import { verifyQuote } from "./roast/sanitize.ts";
import { DISCLOSURE, type JsonSchema } from "./roast/schema.ts";
import { DEFAULT_OUT_ROOT, fetchText } from "./thread/fetch.ts";
import { loadThread } from "./thread/load.ts";
import { decodeEntities, flatThreadUrl, normTimestamp, stripTags } from "./thread/parse.ts";
import type { Thread } from "./thread/types.ts";

export const BUG_ORIGINS = ["production_hit", "real_user_nonprod", "synthetic_ai_hunt", "unclear"] as const;
export type BugOrigin = (typeof BUG_ORIGINS)[number];

export const BUG_IMPACTS = [
  "data_loss_or_corruption",
  "wrong_results",
  "crash_or_oom",
  "regression",
  "performance",
  "minor",
] as const;
export type BugImpact = (typeof BUG_IMPACTS)[number];

export interface BugThreadSummary {
  messageId: string;
  url: string;
  subject: string;
  author: string;
  date: string;
}

export interface BugClassification {
  origin: BugOrigin;
  impact: BugImpact;
  pg_versions: string[];
  has_reproducer: boolean;
  summary: string;
  evidence_quote: string;
}

export interface BugSignals {
  productionHits: string[];
  syntheticHits: string[];
  impactGuess: BugImpact;
  pgVersions: string[];
  hasReproducer: boolean;
  fallbackQuote: string;
}

export interface TriagedBug extends BugClassification {
  message_id: string;
  thread_url: string;
  subject: string;
  author: string;
  date: string;
  messages_in_thread: number;
  origin_source: "llm" | "heuristic";
  quote_verified: boolean;
  signals: { production: string[]; synthetic: string[] };
  rank_score: number;
}

export interface BugsTriageReport {
  generated_at: string;
  disclosure: string;
  days: number;
  limit: number;
  backend: string;
  total_scanned: number;
  counts_by_origin: Record<BugOrigin, number>;
  counts_by_impact: Record<BugImpact, number>;
  bugs: TriagedBug[];
  warnings: string[];
}

export const BUG_TRIAGE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    origin: { type: "string", enum: BUG_ORIGINS },
    impact: { type: "string", enum: BUG_IMPACTS },
    pg_versions: { type: "array", items: { type: "string", minLength: 1 } },
    has_reproducer: { type: "boolean" },
    summary: { type: "string", minLength: 1 },
    evidence_quote: { type: "string" },
  },
};

const BUG_SYSTEM = [
  "You triage PostgreSQL bug reports from the pgsql-bugs mailing list.",
  "Your primary job is to distinguish bugs that real users hit in production or normal application workloads",
  "from synthetic fuzzing / AI bug-hunt reports (sqlsmith, sqlancer, fuzzers, master/devel assertion hunts).",
  "",
  "Classify:",
  "- `origin`:",
  "  - `production_hit`: author states or clearly describes hitting this on a production database, live cluster, production upgrade, or customer outage.",
  "  - `real_user_nonprod`: a real user hitting an issue during normal development, staging, migration, or application testing (not fuzzing/AI hunting).",
  "  - `synthetic_ai_hunt`: generated query, fuzzer, sqlsmith/sqlancer, automated/AI bug-hunting against HEAD/devel/assert builds, or contrived query nobody runs in production.",
  "  - `unclear`: insufficient context to tell.",
  "- `impact`: `data_loss_or_corruption` | `wrong_results` | `crash_or_oom` | `regression` | `performance` | `minor`.",
  "- `pg_versions`: Postgres versions mentioned (e.g. [\"17.2\", \"16.4\"]).",
  "- `has_reproducer`: true if a concrete SQL/CLI reproducer or test script is included.",
  "- `summary`: 1-2 plain sentences explaining what fails and under what conditions.",
  "- `evidence_quote`: one short verbatim sentence copied character-for-character from the reporter's text supporting the origin/impact classification (or \"\" if none).",
  "",
  outputContract(BUG_TRIAGE_SCHEMA, false),
].join("\n");

/**
 * Parse a postgresql.org monthly list archive page (e.g. https://www.postgresql.org/list/pgsql-bugs/2026-11/).
 * Extracts root/listed bug report threads with message-id, subject, author, and ISO timestamp.
 */
export function parseBugsArchiveMonth(html: string, fallbackYearMonth = ""): BugThreadSummary[] {
  const out: BugThreadSummary[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const row of html.matchAll(rowRe)) {
    const inner = row[1]!;
    const linkM = inner.match(/<a[^>]+href="(?:https:\/\/www\.postgresql\.org)?\/message-id\/(?:flat\/)?([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkM) continue;
    let messageId = decodeEntities(linkM[1]!).replace(/\/+$/, "");
    try {
      messageId = decodeURIComponent(messageId);
    } catch {
      // keep raw
    }
    if (!messageId || seen.has(messageId)) continue;
    const subject = stripTags(linkM[2]!);
    if (!subject) continue;

    // Extract cells for author and date.
    const cells = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]!));
    let date = "";
    for (const c of cells) {
      const ts = normTimestamp(c);
      if (ts) {
        date = ts;
        break;
      }
      const dOnly = c.match(/(\d{4}-\d{2}-\d{2})/);
      if (dOnly) {
        date = `${dOnly[1]}T00:00:00Z`;
        break;
      }
    }
    if (!date && /^\d{4}-\d{2}$/.test(fallbackYearMonth)) {
      date = `${fallbackYearMonth}-01T00:00:00Z`;
    }
    // Author is usually a non-date cell distinct from the subject.
    const author =
      cells.find((c) => c && c !== subject && !/^\d{4}-\d{2}-\d{2}/.test(c) && !/^\d+$/.test(c)) ?? "";

    seen.add(messageId);
    out.push({
      messageId,
      url: flatThreadUrl(messageId),
      subject,
      author,
      date,
    });
  }
  // Deduplicate replies to the same BUG #NNNN or Re: subject, keeping the earliest root message.
  const byThreadKey = new Map<string, BugThreadSummary>();
  for (const item of out) {
    const bugNum = item.subject.match(/BUG\s*#(\d+)/i)?.[1];
    const normSubj = bugNum
      ? `bug-${bugNum}`
      : item.subject.replace(/^(?:\s*(?:re|fwd?):\s*)+/i, "").trim().toLowerCase();
    const existing = byThreadKey.get(normSubj);
    if (!existing || (item.date && existing.date && item.date < existing.date)) {
      byThreadKey.set(normSubj, item);
    }
  }
  return [...byThreadKey.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const PROD_PATTERNS: [RegExp, string][] = [
  [/\bin production\b|\bprod(?:uction)?\s+(?:cluster|db|database|server|env|environment|instance|workload|system)\b/i, "mentions production environment"],
  [/\blive\s+(?:traffic|database|cluster|system)\b|\bcustomer(?:s)?\s+(?:impact|outage|downtime)\b|\boutage\b/i, "live traffic / customer impact"],
  [/\bafter\s+(?:an?\s+)?upgrad(?:e|ing)\b|\bduring\s+pg_upgrade\b|\bupgraded\s+from\b/i, "hit during/after upgrade"],
  [/\b(?:our|my)\s+(?:cluster|replica|standby|primary|production|database)\b/i, "real cluster deployment"],
  [/\b(?:killed\s+by\s+oom|oom[- ]killer|out of memory)\b/i, "OOM event"],
];

const SYNTH_PATTERNS: [RegExp, string][] = [
  [/\bsqlsmith\b|\bsqlancer\b|\bfuzz(?:er|ing|ed)?\b|\bamerican fuzzy lop\b|\blibfuzzer\b/i, "fuzzer / sqlsmith / sqlancer"],
  [/\bTRAP:\s*failedAssertion\b|\b--enable-cassert\b|\bcassert\b|\bassert(?:ion)?\s+fail/i, "assertion build / cassert"],
  [/\b(?:built|compiled)\s+from\s+(?:master|head|git)\b|\b(?:19|20)devel\b|\bgit\s+(?:master|head)\b/i, "HEAD / devel build"],
  [/\bfound\s+(?:while|by)\s+(?:fuzz|test|hunting|scanning|experimenting)\b|\bminimal\s+reproducer\b|\bsynthetic\b/i, "bug-hunting / synthetic reproducer"],
];

const IMPACT_RULES: [BugImpact, RegExp][] = [
  ["data_loss_or_corruption", /\b(?:data\s+loss|corrupt(?:ion|ed)?|invalid\s+page|could\s+not\s+read\s+block|missing\s+chunk|lost\s+data|silently\s+dropped|WAL\s+corrupt|index\s+corrupt)\b/i],
  ["wrong_results", /\b(?:wrong\s+result|incorrect\s+result|missing\s+rows?|duplicate\s+rows?|unexpected\s+rows?|returns?\s+wrong|stale\s+data|visibility\s+bug)\b/i],
  ["crash_or_oom", /\b(?:segfault|segmentation\s+fault|SIGSEGV|SIGABRT|PANIC:|server\s+crash|backend\s+crash|oom|out\s+of\s+memory|memory\s+leak|core\s+dump)\b/i],
  ["regression", /\b(?:regression|worked\s+in\s+(?:pg|postgres(?:ql)?)\s*\d+|broke\s+after\s+upgrad|since\s+upgrading)\b/i],
  ["performance", /\b(?:slow\s+query|performance\s+degrad|10x\s+slower|hangs?|deadlock|cpu\s+spike|latency\s+spike)\b/i],
];

const VERSION_RE = /\b(?:PostgreSQL|Postgres|PG)\s*(\d{2}(?:\.\d+|beta\d+|rc\d+|devel)?)\b|\bVersion:\s*(\d{2}(?:\.\d+|beta\d+|rc\d+|devel)?)\b/gi;
const REPRO_RE = /\b(?:CREATE\s+TABLE|SELECT\s+[\s\S]{1,80}\s+FROM|INSERT\s+INTO|ALTER\s+TABLE|EXPLAIN\s+|pg_restore|pg_dump)\b/i;

/** Deterministic fast signal extraction & fallback classification from a bug thread. */
export function analyzeBugSignals(thread: Thread): BugSignals {
  const first = thread.messages[0];
  const sampleText = thread.messages
    .slice(0, 5)
    .map((m) => `${m.subject}\n${m.body}`)
    .join("\n\n");

  const productionHits: string[] = [];
  for (const [re, label] of PROD_PATTERNS) {
    if (re.test(sampleText)) productionHits.push(label);
  }
  const syntheticHits: string[] = [];
  for (const [re, label] of SYNTH_PATTERNS) {
    if (re.test(sampleText)) syntheticHits.push(label);
  }

  let impactGuess: BugImpact = "minor";
  for (const [imp, re] of IMPACT_RULES) {
    if (re.test(sampleText)) {
      impactGuess = imp;
      break;
    }
  }

  const versions = new Set<string>();
  for (const m of sampleText.matchAll(VERSION_RE)) {
    const v = (m[1] ?? m[2] ?? "").trim();
    if (v) versions.add(v);
  }

  const hasReproducer =
    REPRO_RE.test(sampleText) ||
    thread.messages.some((m) => m.attachments.some((a) => /\.(sql|sh|py|c)$/i.test(a.name)));

  // Pick a concise verbatim sentence from the first message supporting the signal.
  const firstBody = first?.body ?? "";
  const sentences = firstBody
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 240 && !s.startsWith(">") && !/^PostgreSQL version:/i.test(s));
  const hitSentence =
    sentences.find((s) => PROD_PATTERNS.some(([re]) => re.test(s)) || IMPACT_RULES.some(([, re]) => re.test(s))) ??
    sentences.find((s) => SYNTH_PATTERNS.some(([re]) => re.test(s))) ??
    sentences[0] ??
    "";

  return {
    productionHits,
    syntheticHits,
    impactGuess,
    pgVersions: [...versions].slice(0, 5),
    hasReproducer,
    fallbackQuote: hitSentence,
  };
}

export function heuristicClassification(thread: Thread, sig: BugSignals): BugClassification {
  let origin: BugOrigin = "unclear";
  if (sig.productionHits.length > 0 && sig.syntheticHits.length === 0) {
    origin = "production_hit";
  } else if (sig.syntheticHits.length > 0 && sig.productionHits.length === 0) {
    origin = "synthetic_ai_hunt";
  } else if (sig.productionHits.length > sig.syntheticHits.length) {
    origin = "production_hit";
  } else if (sig.syntheticHits.length > sig.productionHits.length) {
    origin = "synthetic_ai_hunt";
  } else if (sig.pgVersions.some((v) => !/devel/i.test(v)) && sig.impactGuess !== "minor") {
    origin = "real_user_nonprod";
  }

  const summary =
    sig.fallbackQuote ||
    thread.subject.replace(/^BUG\s*#\d+:\s*/i, "").trim() ||
    "PostgreSQL bug report.";

  return {
    origin,
    impact: sig.impactGuess,
    pg_versions: sig.pgVersions,
    has_reproducer: sig.hasReproducer,
    summary,
    evidence_quote: sig.fallbackQuote,
  };
}

const ORIGIN_WEIGHT: Record<BugOrigin, number> = {
  production_hit: 1000,
  real_user_nonprod: 600,
  unclear: 300,
  synthetic_ai_hunt: 100,
};

const IMPACT_WEIGHT: Record<BugImpact, number> = {
  data_loss_or_corruption: 500,
  wrong_results: 400,
  crash_or_oom: 300,
  regression: 200,
  performance: 100,
  minor: 20,
};

export function bugRankScore(b: Pick<TriagedBug, "origin" | "impact" | "has_reproducer">): number {
  return ORIGIN_WEIGHT[b.origin] + IMPACT_WEIGHT[b.impact] + (b.has_reproducer ? 25 : 0);
}

/** Rank bugs with Production Hits (high impact first) at the top. */
export function rankBugReports(bugs: TriagedBug[]): TriagedBug[] {
  return [...bugs].sort(
    (a, b) =>
      b.rank_score - a.rank_score ||
      b.date.localeCompare(a.date) ||
      a.subject.localeCompare(b.subject),
  );
}

export function renderBugsMarkdown(report: BugsTriageReport): string {
  const out: string[] = [];
  out.push(`# pgsql-bugs Production-Impact Triage (last ${report.days} days)`);
  out.push("");
  out.push(`> ${report.disclosure}`);
  out.push("");
  out.push(
    `Scanned **${report.total_scanned}** bug threads (generated ${report.generated_at.slice(0, 10)}; backend: ${report.backend}). ` +
      `Elevated real production user hits above synthetic/fuzzer/AI bug hunts.`,
  );
  out.push("");
  out.push(
    `- **Production hits:** ${report.counts_by_origin.production_hit}`,
    `- **Real user (non-production):** ${report.counts_by_origin.real_user_nonprod}`,
    `- **Unclear:** ${report.counts_by_origin.unclear}`,
    `- **Synthetic / AI / fuzzer hunts:** ${report.counts_by_origin.synthetic_ai_hunt}`,
    "",
  );

  const sections: [BugOrigin, string][] = [
    ["production_hit", "Production Hits (Highest Priority)"],
    ["real_user_nonprod", "Real User Reports (Non-Production)"],
    ["unclear", "Needs Human Check (Origin Unclear)"],
    ["synthetic_ai_hunt", "Synthetic / Fuzzer / AI Bug Hunts"],
  ];

  const esc = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

  for (const [origin, heading] of sections) {
    const group = report.bugs.filter((b) => b.origin === origin);
    if (group.length === 0) continue;
    out.push(`## ${heading} (${group.length})`, "");
    out.push("| Impact | Date | Versions | Repro | Subject | Summary |");
    out.push("|---|---|---|---|---|---|");
    for (const b of group) {
      const vers = b.pg_versions.length ? b.pg_versions.join(", ") : "–";
      out.push(
        `| **${b.impact.replace(/_/g, " ")}** | ${b.date.slice(0, 10) || "?"} | ${esc(vers)} | ${b.has_reproducer ? "yes" : "no"} | [${esc(b.subject)}](${b.thread_url}) | ${esc(b.summary)} |`,
      );
    }
    out.push("");
    for (const b of group) {
      if (b.evidence_quote) {
        out.push(`- **${b.subject}** (${b.author || "reporter"}): "${b.evidence_quote.replace(/\s+/g, " ").trim()}"`);
      }
    }
    out.push("");
  }

  if (report.warnings.length) {
    out.push("## Warnings", "", ...report.warnings.map((w) => `- ${w}`), "");
  }
  out.push("---", "", report.disclosure, "");
  return out.join("\n");
}

function monthsCoveringDays(days: number, now: Date): string[] {
  const out = new Set<string>();
  const cur = new Date(now.getTime());
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  while (cur >= cutoff) {
    out.add(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCDate(1);
    cur.setUTCDate(0); // last day of previous month
  }
  out.add(`${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`);
  return [...out].sort().reverse();
}

export interface BugsTriageOptions {
  days?: number;
  limit?: number;
  backend?: BackendName;
  outDir?: string;
  offline?: boolean;
  dryRun?: boolean;
  cacheDir?: string;
  now?: Date;
  log?: (msg: string) => void;
  /** Injected for tests. */
  fetchArchive?: (yearMonth: string) => Promise<string | null>;
  loadThreadFn?: (messageId: string) => Promise<Thread>;
  llmBackend?: LlmBackend;
}

export async function runBugsTriage(opts: BugsTriageOptions = {}): Promise<{ report: BugsTriageReport; outDir: string }> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const now = opts.now ?? new Date();
  const days = opts.days ?? 14;
  const limit = opts.limit ?? 30;
  const cutoffIso = new Date(now.getTime() - days * 86_400_000).toISOString();
  const warnings: string[] = [];

  const months = monthsCoveringDays(days, now);
  const summaries: BugThreadSummary[] = [];
  const seen = new Set<string>();

  for (const ym of months) {
    const url = `https://www.postgresql.org/list/pgsql-bugs/${ym}/`;
    log(`fetching pgsql-bugs archive ${ym} ...`);
    const html = opts.fetchArchive
      ? await opts.fetchArchive(ym)
      : await fetchText(url, { offline: opts.offline, cacheDir: opts.cacheDir });
    if (!html) {
      warnings.push(`pgsql-bugs archive for ${ym} could not be fetched`);
      continue;
    }
    for (const item of parseBugsArchiveMonth(html, ym)) {
      if (item.date && item.date < cutoffIso) continue;
      if (seen.has(item.messageId)) continue;
      seen.add(item.messageId);
      summaries.push(item);
    }
  }
  summaries.sort((a, b) => b.date.localeCompare(a.date));
  const selected = summaries.slice(0, limit);
  log(`pgsql-bugs: ${summaries.length} recent thread(s) within ${days}d; triaging ${selected.length}`);

  const outDir = resolve(opts.outDir ?? join(DEFAULT_OUT_ROOT, "bugs-triage"));
  mkdirSync(outDir, { recursive: true });

  let llm: LlmBackend | null = opts.llmBackend ?? null;
  let backendLabel = "heuristic";
  let model = "";
  if (!llm && !opts.dryRun) {
    const bn = pickBackend(opts.backend);
    backendLabel = bn;
    model = modelsFromEnv(process.env, bn).roaster;
    llm = createBackend(bn, { transcriptDir: join(outDir, "llm"), log });
  } else if (opts.dryRun) {
    backendLabel = "dry-run";
    llm = new DryRunBackend({ transcriptDir: join(outDir, "llm"), print: () => undefined });
  } else if (llm) {
    backendLabel = opts.backend ?? "custom";
    model = "test";
  }

  const bugs: TriagedBug[] = [];
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i]!;
    let thread: Thread;
    try {
      thread = opts.loadThreadFn
        ? await opts.loadThreadFn(s.messageId)
        : await loadThread(s.messageId, { offline: opts.offline, cacheDir: opts.cacheDir });
    } catch (e) {
      warnings.push(`could not load bug thread ${s.messageId}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }

    const sig = analyzeBugSignals(thread);
    const heur = heuristicClassification(thread, sig);
    let cls: BugClassification = heur;
    let originSource: "llm" | "heuristic" = "heuristic";
    let quoteVerified = Boolean(heur.evidence_quote);

    if (llm && !llm.dryRun) {
      const excerpt = thread.messages
        .slice(0, 5)
        .map((m) => `### Message #${m.index} | ${m.from} | ${m.date.slice(0, 10)}\n\n${m.body.slice(0, 4000)}`)
        .join("\n\n");
      const prompt = [
        `Subject: ${thread.subject}`,
        `Deterministic pre-signals: production=[${sig.productionHits.join("; ")}], synthetic=[${sig.syntheticHits.join("; ")}], versions=[${sig.pgVersions.join(", ")}]`,
        "",
        excerpt,
        "",
        "Classify this bug report. JSON only.",
      ].join("\n");
      try {
        const out = await llm.complete<BugClassification>({
          label: `bug-${i + 1}`,
          model: model || "opus",
          system: BUG_SYSTEM,
          prompt,
          schema: BUG_TRIAGE_SCHEMA,
        });
        const sources = thread.messages.slice(0, 5).map((m) => m.body);
        const verified = verifyQuote(out.evidence_quote, sources);
        if (out.evidence_quote && !verified) {
          warnings.push(`bug ${s.messageId}: unverified evidence_quote dropped`);
        }
        cls = {
          ...out,
          pg_versions: out.pg_versions.length ? out.pg_versions : sig.pgVersions,
          evidence_quote: verified ?? sig.fallbackQuote,
        };
        originSource = "llm";
        quoteVerified = Boolean(verified);
      } catch (e) {
        warnings.push(`LLM classification failed for ${s.messageId}; fell back to heuristics: ${(e as Error).message.split("\n")[0]}`);
      }
    }

    const entry: TriagedBug = {
      ...cls,
      message_id: s.messageId,
      thread_url: thread.threadUrl || s.url,
      subject: thread.subject || s.subject,
      author: thread.messages[0]?.from.replace(/\s*<[^>]*>\s*$/, "").trim() || s.author,
      date: thread.messages[0]?.date || s.date,
      messages_in_thread: thread.messages.length,
      origin_source: originSource,
      quote_verified: quoteVerified,
      signals: { production: sig.productionHits, synthetic: sig.syntheticHits },
      rank_score: bugRankScore(cls),
    };
    bugs.push(entry);
  }

  const ranked = rankBugReports(bugs);
  const countsByOrigin: Record<BugOrigin, number> = {
    production_hit: 0,
    real_user_nonprod: 0,
    synthetic_ai_hunt: 0,
    unclear: 0,
  };
  const countsByImpact: Record<BugImpact, number> = {
    data_loss_or_corruption: 0,
    wrong_results: 0,
    crash_or_oom: 0,
    regression: 0,
    performance: 0,
    minor: 0,
  };
  for (const b of ranked) {
    countsByOrigin[b.origin]++;
    countsByImpact[b.impact]++;
  }

  const report: BugsTriageReport = {
    generated_at: now.toISOString(),
    disclosure: DISCLOSURE,
    days,
    limit,
    backend: backendLabel,
    total_scanned: ranked.length,
    counts_by_origin: countsByOrigin,
    counts_by_impact: countsByImpact,
    bugs: ranked,
    warnings,
  };

  const jsonPath = join(outDir, "bugs-triage.json");
  const mdPath = join(outDir, "bugs-triage.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, renderBugsMarkdown(report));
  log(`wrote ${mdPath}`);
  log(`wrote ${jsonPath}`);
  return { report, outDir };
}

export function parseBugsArgs(argv: string[]): BugsTriageOptions | "help" {
  const rest = [...argv];
  const o: BugsTriageOptions = {};
  const val = (flag: string, inline?: string) => {
    const v = inline ?? rest.shift();
    if (v == null || v === "") throw new Error(`${flag} needs a value`);
    return v;
  };
  const int = (flag: string, inline?: string) => {
    const n = Number(val(flag, inline));
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer`);
    return n;
  };
  while (rest.length) {
    const tok = rest.shift()!;
    const eq = tok.startsWith("--") && tok.includes("=") ? tok.indexOf("=") : -1;
    const flag = eq > 0 ? tok.slice(0, eq) : tok;
    const inline = eq > 0 ? tok.slice(eq + 1) : undefined;
    if (flag === "-h" || flag === "--help") return "help";
    else if (flag === "--days") o.days = int(flag, inline);
    else if (flag === "--limit") o.limit = int(flag, inline);
    else if (flag === "--out") o.outDir = val(flag, inline);
    else if (flag === "--offline") o.offline = true;
    else if (flag === "--dry-run") o.dryRun = true;
    else if (flag === "--backend") {
      const b = val(flag, inline).toLowerCase();
      if (b !== "claude" && b !== "codex" && b !== "agy" && b !== "dual") {
        throw new Error("--backend must be claude, codex, agy, or dual");
      }
      o.backend = b;
    } else throw new Error(`unknown option ${flag} for bugs`);
  }
  return o;
}

const BUGS_USAGE = `Usage: pgroast bugs [--days 14] [--limit 30] [--backend claude|codex|agy|dual] [--out DIR] [--offline] [--dry-run]

Fetches recent pgsql-bugs threads and ranks real production user hits above synthetic/AI bug-hunt reports.
Writes bugs-triage.md and bugs-triage.json locally.`;

export async function bugsMain(argv: string[]): Promise<number> {
  try {
    const parsed = parseBugsArgs(argv);
    if (parsed === "help") {
      console.log(BUGS_USAGE);
      return 0;
    }
    await runBugsTriage(parsed);
    return 0;
  } catch (e) {
    console.error(`pgroast bugs: ${(e as Error).message}`);
    return 2;
  }
}
