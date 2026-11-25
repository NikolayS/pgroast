import type { AppDatabase } from "../db.ts";
import type { BugReportRecord } from "../types.ts";

export interface BugClassification {
  classification: BugReportRecord["classification"];
  severity: BugReportRecord["severity"];
  confidence: number;
  signals: string[];
  affectedVersions: string;
}

const PRODUCTION_SIGNALS: Array<{ label: string; regex: RegExp; weight: number }> = [
  { label: "Explicitly hit in production", regex: /\b(in production|production (?:server|cluster|database|db|workload|env|environment|instance)|prod cluster|prod db)\b/i, weight: 3.0 },
  { label: "Occurred after upgrade / minor release", regex: /\b(after upgrading|since upgrading|after upgrade to|upgraded from \d+ to \d+)\b/i, weight: 2.2 },
  { label: "Real operational workload / customer impact", regex: /\b(our (?:application|cluster|replica|standby|service|users|customers|nightly|backup|pg_dump)|incident|outage|downtime)\b/i, weight: 2.0 },
  { label: "Observed in live logs / monitoring", regex: /\b(in our logs|started happening|happens intermittently|on our primary|on our standby|on replica)\b/i, weight: 1.8 },
  { label: "Real table/data size context", regex: /\b(\d+\s*(?:GB|TB|million rows|billion rows)|live table|large table)\b/i, weight: 1.2 },
];

const SYNTHETIC_SIGNALS: Array<{ label: string; regex: RegExp; weight: number }> = [
  { label: "Fuzzer / SQLsmith / automated finder", regex: /\b(sqlsmith|sqlancer|fuzz(?:er|ing)|afl\+\+|libfuzzer|found by fuzz)\b/i, weight: 3.0 },
  { label: "Explicit AI / static-analysis hunt", regex: /\b(while auditing|found (?:with|using) (?:an? )?(?:ai|llm|static analy)|automated scan|code inspection found|reading the source code)\b/i, weight: 2.5 },
  { label: "Assertion / devel build hunt", regex: /\b(TRAP:\s*failedAssertion|--enable-cassert|cassert|(?:19|20)devel)\b/i, weight: 1.8 },
  { label: "Minimal synthetic / crafted query pattern", regex: /\b(minimal reproducer found|crafted query|discovered via testing|tested on master HEAD|git master)\b/i, weight: 1.5 },
];

const KNOWN_COMPANY_RE =
  /\b(?:redhat\.com|amazon\.com|aws\.amazon\.com|google\.com|microsoft\.com|cloudflare\.com|datadoghq\.com|stripe\.com|shopify\.com|enterprisedb\.com|crunchydata\.com|cybertec(?:-postgresql)?\.com|percona\.com|supabase\.io|neon\.tech|timescale\.com|postgres\.ai|yandex(?:-team)?\.ru|ibm\.com|oracle\.com|fujitsu\.com|ntt\.co\.jp|uber\.com|meta\.com|netflix\.com|gitlab\.com|github\.com|salesforce\.com|heroku\.com|sap\.com|bloomberg\.com|paypal\.com|atlassian\.com|twilio\.com|coinbase\.com|doordash\.com|airbnb\.com|spotify\.com|discord\.com)\b/i;

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "proton.me", "protonmail.com", "qq.com", "163.com",
  "126.com", "yandex.ru", "mail.ru", "postgresql.org", "example.com",
]);

function extractReporterCompanySignal(sender: string, body: string): { known: boolean; corporate: boolean; domain: string } {
  const emailText = `${sender}\n${body.slice(0, 600)}`.replace(/\(at\)/gi, "@").replace(/\(dot\)/gi, ".");
  const match = emailText.match(/[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const domain = (match?.[1] || "").toLowerCase();
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) {
    return { known: false, corporate: false, domain };
  }
  return { known: KNOWN_COMPANY_RE.test(domain), corporate: true, domain };
}

export function classifyBugText(subject: string, body: string, sender = ""): BugClassification {
  const combined = `${subject}\n${body}`;
  const signals: string[] = [];
  let prodScore = 0;
  let synthScore = 0;

  for (const s of PRODUCTION_SIGNALS) {
    if (s.regex.test(combined)) {
      prodScore += s.weight;
      signals.push(`+prod: ${s.label}`);
    }
  }
  const company = extractReporterCompanySignal(sender, body);
  if (company.known) {
    prodScore += 1.6;
    signals.push(`+prod: Known company (${company.domain})`);
  } else if (company.corporate && prodScore > 0) {
    prodScore += 0.6;
    signals.push(`+prod: Organization email (${company.domain})`);
  }
  for (const s of SYNTHETIC_SIGNALS) {
    if (s.regex.test(combined)) {
      synthScore += s.weight;
      signals.push(`+synth: ${s.label}`);
    }
  }

  let classification: BugReportRecord["classification"] = "unclear";
  let confidence = 0.5;
  if (prodScore >= 2.0 && prodScore > synthScore) {
    classification = "production_hit";
    confidence = Math.min(0.95, 0.55 + prodScore * 0.1);
  } else if (synthScore >= 2.0 && synthScore > prodScore) {
    classification = "synthetic_ai_hunt";
    confidence = Math.min(0.95, 0.55 + synthScore * 0.1);
  } else if (prodScore > 0 && synthScore === 0) {
    classification = "production_hit";
    confidence = 0.62;
  }

  // Severity classification (Andrey & Kirk Nov 19 priority: data loss / wrong results / crash / OOM / regression)
  let severity: BugReportRecord["severity"] = "unknown";
  if (/\b(data loss|corrupt(?:ion|ed)|lost rows|lost updates|missing wal|index corruption)\b/i.test(combined)) {
    severity = "data_loss";
  } else if (/\b(wrong result|missing rows|incorrect result|returns? wrong|duplicate rows|unexpected rows)\b/i.test(combined)) {
    severity = "wrong_results";
  } else if (/\b(segfault|segmentation fault|sigsegv|sigabrt|assertion fail(?:ed|ure)|trap:|panic:|server process .* was terminated|crash(?:ed|es|ing)?)\b/i.test(combined)) {
    severity = "crash";
  } else if (/\b(out of memory|oom|memory leak|unbounded memory|kills? postmaster)\b/i.test(combined)) {
    severity = "oom";
  } else if (/\b(regression|worked in \d+|broke in \d+|since (?:pg|postgres(?:ql)?)\s*\d+)\b/i.test(combined)) {
    severity = "regression";
  } else if (/\b(doc|typo|warning|error message|cosmetic)\b/i.test(combined)) {
    severity = "minor";
  }

  const versionSet = new Set<string>();
  const formVer = combined.match(/PostgreSQL version:\s*([0-9]{1,2}(?:\.[0-9]+|beta\d+|rc\d+|devel)?)/i)?.[1];
  if (formVer) versionSet.add(formVer.trim());
  for (const v of combined.match(/\b(?:PostgreSQL|PG)\s*1[3-9](?:\.\d+|beta\d+|rc\d+|devel)?|\b1[4-9]\.\d+\b|\b(?:19|20)devel\b/gi) ?? []) {
    versionSet.add(v.trim());
  }
  const versionMatches = Array.from(versionSet);

  return {
    classification,
    severity,
    confidence: Number(confidence.toFixed(2)),
    signals,
    affectedVersions: versionMatches.slice(0, 4).join(", "),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export interface BugIndexCandidate {
  messageId: string;
  subject: string;
  url: string;
  isReply: boolean;
}

/**
 * postgresql.org list archives require a 12-digit YYYYMMDDHHMM timestamp after `/since/`.
 * An 8-digit `/since/YYYYMMDD/` returns HTTP 404.
 */
export function buildPgsqlBugsSinceUrl(sinceDate: Date): string {
  const yyyymmdd = sinceDate.toISOString().slice(0, 10).replace(/-/g, "");
  return `https://www.postgresql.org/list/pgsql-bugs/since/${yyyymmdd}0000/`;
}

export function parsePgsqlBugsIndexHtml(html: string): {
  entries: BugIndexCandidate[];
  nextUrl: string | null;
} {
  const linkRegex = /<a[^>]*href=["']\/message-id\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const entries: BugIndexCandidate[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const rawId = m[1] ?? "";
    if (!rawId || rawId.startsWith("flat/") || rawId.startsWith("raw/") || rawId.startsWith("mbox/") || seen.has(rawId)) {
      continue;
    }
    const subject = stripHtml(m[2] ?? "").replace(/\s*📎\s*$/, "").trim();
    if (!subject || subject.length < 4) continue;
    seen.add(rawId);
    let messageId = rawId;
    try {
      messageId = decodeURIComponent(rawId);
    } catch {
      // keep raw
    }
    entries.push({
      messageId,
      subject,
      url: `https://www.postgresql.org/message-id/flat/${encodeURIComponent(messageId)}`,
      isReply: /^(?:re|fwd?):/i.test(subject),
    });
  }

  const nextMatch = html.match(/<a[^>]*href=["'](\/list\/pgsql-bugs\/since\/\d{12}\/?)["'][^>]*>\s*Next\s*<\/a>/i);
  const nextUrl = nextMatch?.[1]
    ? `https://www.postgresql.org${nextMatch[1].endsWith("/") ? nextMatch[1] : `${nextMatch[1]}/`}`
    : null;

  return { entries, nextUrl };
}

function threadDedupeKey(subject: string): string {
  const bugNum = subject.match(/BUG\s*#(\d+)/i)?.[1];
  if (bugNum) return `bug-${bugNum}`;
  return subject.replace(/^(?:\s*(?:re|fwd?):\s*)+/i, "").trim().toLowerCase().slice(0, 90);
}

function cleanBugSummary(bodyText: string, fallbackSubject: string): string {
  if (!bodyText) return fallbackSubject;
  const descIdx = bodyText.search(/\bDescription:\s*/i);
  const useful = descIdx >= 0 ? bodyText.slice(descIdx).replace(/^Description:\s*/i, "").trim() : bodyText.trim();
  const text = useful || bodyText.trim() || fallbackSubject;
  return text.slice(0, 280).trim() + (text.length > 280 ? "..." : "");
}

export async function scanPgsqlBugs(
  db: AppDatabase,
  opts?: { days?: number; limit?: number; onProgress?: (msg: string) => void },
): Promise<{ scanned: number; productionHits: number; syntheticAi: number; unclear: number }> {
  const days = opts?.days ?? 14;
  const limit = opts?.limit ?? 30;
  const sinceDate = new Date(Date.now() - days * 86400_000);
  const startUrl = buildPgsqlBugsSinceUrl(sinceDate);

  // Paginate forward via "Next" (each page covers ~5-8 days) so we capture up to today.
  const allEntries: BugIndexCandidate[] = [];
  const visitedUrls = new Set<string>();
  let nextUrl: string | null = startUrl;
  const maxPages = 6;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    if (visitedUrls.has(nextUrl)) break;
    visitedUrls.add(nextUrl);

    opts?.onProgress?.(`Fetching ${nextUrl}`);
    const res = await fetch(nextUrl, { headers: { "User-Agent": "pgroast-app/0.1" } });
    if (!res.ok) {
      if (page === 0) {
        throw new Error(`pgsql-bugs archive returned HTTP ${res.status} for ${nextUrl}`);
      }
      opts?.onProgress?.(`Stopped pagination at page ${page + 1} (HTTP ${res.status}).`);
      break;
    }
    const indexHtml = await res.text();
    const parsed = parsePgsqlBugsIndexHtml(indexHtml);
    allEntries.push(...parsed.entries);
    nextUrl = parsed.nextUrl;
  }

  // Deduplicate by BUG # / normalized thread subject, preferring original bug reports over "Re:" replies.
  const byThread = new Map<string, { candidate: BugIndexCandidate; order: number }>();
  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i]!;
    const key = threadDedupeKey(entry.subject);
    const existing = byThread.get(key);
    if (!existing) {
      byThread.set(key, { candidate: entry, order: i });
    } else if (existing.candidate.isReply && !entry.isReply) {
      // Upgrade a reply to the root bug report while keeping recent order
      byThread.set(key, { candidate: entry, order: i });
    } else {
      // Refresh recency timestamp order so actively discussed threads stay recent
      existing.order = i;
    }
  }

  // Prefer original bug reports first, then newest activity, taking up to `limit`.
  const candidates = [...byThread.values()]
    .sort((a, b) => Number(a.candidate.isReply) - Number(b.candidate.isReply) || b.order - a.order)
    .slice(0, limit)
    .map((x) => x.candidate);

  opts?.onProgress?.(
    `Found ${allEntries.length} messages (${byThread.size} unique threads) across ${visitedUrls.size} page(s). Inspecting newest ${candidates.length}...`,
  );
  let productionHits = 0;
  let syntheticAi = 0;
  let unclear = 0;

  for (const cand of candidates) {
    let bodyText = "";
    let sender = "";
    let reportedAt = new Date().toISOString();
    try {
      const msgRes = await fetch(`https://www.postgresql.org/message-id/${encodeURIComponent(cand.messageId)}`, {
        headers: { "User-Agent": "pgroast-app/0.1" },
      });
      if (msgRes.ok) {
        const msgHtml = await msgRes.text();
        const fromMatch = msgHtml.match(/<th[^>]*>From:<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
        if (fromMatch?.[1]) sender = stripHtml(fromMatch[1]);
        const dateMatch = msgHtml.match(/<th[^>]*>Date:<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
        if (dateMatch?.[1]) reportedAt = stripHtml(dateMatch[1]);
        const bodyMatch = msgHtml.match(/<div[^>]*class=["'][^"']*message-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        bodyText = stripHtml(bodyMatch?.[1] || msgHtml).slice(0, 4000);
        if (/PG Bug reporting form/i.test(sender)) {
          const loggedBy = bodyText.match(/Logged by:\s*([^\n]+?)\s+Email address:/i)?.[1]?.trim();
          if (loggedBy) sender = `${loggedBy} (PG Bug form)`;
        }
      }
    } catch {
      bodyText = "";
    }

    const cls = classifyBugText(cand.subject, bodyText, sender);
    if (cls.classification === "production_hit") productionHits++;
    else if (cls.classification === "synthetic_ai_hunt") syntheticAi++;
    else unclear++;

    const summary = cleanBugSummary(bodyText, cand.subject);

    await db.upsertBugReport({
      message_id: cand.messageId,
      subject: cand.subject,
      sender,
      thread_url: cand.url,
      reported_at: reportedAt,
      classification: cls.classification,
      severity: cls.severity,
      confidence: cls.confidence,
      production_signals_json: JSON.stringify(cls.signals),
      summary,
      affected_versions: cls.affectedVersions,
      status: "new",
      work_item_id: null,
    });

    opts?.onProgress?.(`  [${cls.classification}/${cls.severity}] ${cand.subject.slice(0, 80)}`);
  }

  await db.logAudit("bugs_triage_scan", `pgsql-bugs:${days}d`, {
    scanned: candidates.length,
    productionHits,
    syntheticAi,
    unclear,
  });

  return { scanned: candidates.length, productionHits, syntheticAi, unclear };
}
