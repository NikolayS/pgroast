import type { AppDatabase } from "../db.ts";
import type { AppSettings, RoastJson, RoastRunRecord } from "../types.ts";
import { publicConfidentialityCheck } from "./gates.ts";
import { buildShortlistAndTop50, classifyEntryKind, detectProductionSignal, extractWorkaroundFinding } from "./shortlist.ts";
import { buildStatsReport } from "./stats.ts";

function resolveHubBase(settings: AppSettings, overrideUrl?: string): string {
  const raw = (overrideUrl || settings.publicHubUrl || "").trim().replace(/\/$/, "");
  if (!raw) {
    throw new Error("Public Companion URL is not configured. Set it in Settings -> Public Companion Hub (e.g. http://127.0.0.1:3433 or https://pgroast.dev).");
  }
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`Public Companion URL must start with http:// or https:// (got "${raw}").`);
  }
  return raw;
}

export async function publishOpinionToHub(
  db: AppDatabase,
  settings: AppSettings,
  input: {
    cfId: number;
    backend?: string;
    roastLevel?: string;
    roastFlavour?: string;
    verdict: string;
    confidence?: string;
    summary?: string;
    confirm: boolean;
  },
): Promise<{ ok: true; opinion: unknown; hubUrl: string }> {
  if (!input.confirm) {
    await db.logAudit("hub_publish_opinion", `cf:${input.cfId}`, { reason: "confirm=true required" }, "blocked");
    throw new Error("Explicit confirmation (confirm: true) is required before publishing to the public companion.");
  }
  const hubBase = resolveHubBase(settings);
  const token = await db.getHubTokenDecrypted();
  if (!token) {
    throw new Error("No publish-only token configured. Mint one on the public companion and paste it in Settings -> Public Companion Hub.");
  }

  const entry = await db.getEntry(input.cfId);
  const payload = {
    cf_id: input.cfId,
    entry: entry
      ? {
          cf_id: entry.cf_id,
          title: entry.title,
          status: entry.status,
          topic: entry.topic,
          authors: entry.authors,
          reviewers: entry.reviewers,
          committer: entry.committer,
          thread_url: entry.thread_url,
          verdict: input.verdict,
          confidence: input.confidence || entry.confidence,
          recommended_score: entry.recommended_score,
        }
      : undefined,
    backend: (input.backend || "ai-harness").trim(),
    roast_level: (input.roastLevel || "medium").trim(),
    roast_flavour: (input.roastFlavour || "default").trim(),
    verdict: input.verdict.trim(),
    confidence: input.confidence || "medium",
    summary: (input.summary || "").trim(),
  };

  const gate = publicConfidentialityCheck(JSON.stringify(payload));
  if (gate.blocking) {
    const msgs = gate.issues.map((i) => i.message).join(" | ");
    await db.logAudit("hub_publish_opinion", `cf:${input.cfId}`, { blocked: true, msgs }, "blocked");
    throw new Error(`Public-Confidentiality HARD BLOCK: ${msgs}`);
  }

  const res = await fetch(`${hubBase}/api/v1/publish/opinion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { opinion?: unknown; error?: string };
  if (!res.ok) {
    await db.logAudit("hub_publish_opinion", `cf:${input.cfId}`, { error: data.error || res.status }, "error");
    throw new Error(data.error || `Public companion returned HTTP ${res.status}`);
  }

  await db.logAudit("hub_publish_opinion", `cf:${input.cfId}`, { hubBase, verdict: input.verdict });
  return { ok: true, opinion: data.opinion, hubUrl: hubBase };
}

export async function pullOpinionsFromHub(
  db: AppDatabase,
  settings: AppSettings,
  cfId: number,
): Promise<{ imported: number; totalRemote: number; hubUrl: string }> {
  const hubBase = resolveHubBase(settings);
  const res = await fetch(`${hubBase}/api/v1/entries/${cfId}/opinions`, {
    headers: { Accept: "application/json" },
  });
  const data = (await res.json()) as {
    opinions?: Array<{
      contributor_name: string;
      contributor_handle: string;
      contributor_provider: "github" | "google" | "local";
      contributor_avatar?: string;
      backend: string;
      models_json?: string;
      verdict: string;
      confidence?: string;
      summary?: string;
      created_at?: string;
    }>;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Public companion returned HTTP ${res.status}`);
  }

  const remote = data.opinions ?? [];
  const existing = await db.listRoastRuns(cfId);
  const sig = (r: Pick<RoastRunRecord, "contributor_handle" | "verdict" | "backend" | "created_at">) =>
    `${r.contributor_handle}|${r.verdict}|${r.backend}|${(r.created_at || "").slice(0, 16)}`;
  const existingSet = new Set(existing.map(sig));

  let imported = 0;
  for (const r of remote) {
    const key = `${r.contributor_handle}|${r.verdict}|${r.backend}|${(r.created_at || "").slice(0, 16)}`;
    if (existingSet.has(key)) continue;
    await db.addExternalOpinion({
      cfId,
      backend: r.backend || "external",
      models: r.models_json || "{}",
      verdict: r.verdict,
      confidence: r.confidence || "medium",
      summaryTxt: r.summary || "",
      contributorName: r.contributor_name || r.contributor_handle,
      contributorHandle: r.contributor_handle,
      contributorProvider: r.contributor_provider === "google" ? "google" : r.contributor_provider === "github" ? "github" : "local",
      contributorAvatar: r.contributor_avatar || "",
      createdAt: r.created_at,
    });
    existingSet.add(key);
    imported++;
  }

  await db.logAudit("hub_pull_opinions", `cf:${cfId}`, { hubBase, imported, totalRemote: remote.length });
  return { imported, totalRemote: remote.length, hubUrl: hubBase };
}

export async function publishBriefToHub(
  db: AppDatabase,
  settings: AppSettings,
  input: {
    slug?: string;
    title?: string;
    commitfestLabel?: string;
    topN?: number;
    rejectN?: number;
    confirm: boolean;
  },
): Promise<{ ok: true; brief: Record<string, unknown>; hubUrl: string }> {
  if (!input.confirm) {
    await db.logAudit("hub_publish_brief", input.slug || "brief", { reason: "confirm=true required" }, "blocked");
    throw new Error("Explicit confirmation (confirm: true) is required before publishing a CommitFest brief.");
  }
  const hubBase = resolveHubBase(settings);
  const token = await db.getHubTokenDecrypted();
  if (!token) {
    throw new Error("No publish-only token configured. Set it in Settings -> Public Companion Hub.");
  }

  const [sl, stats, allEntries] = await Promise.all([
    buildShortlistAndTop50(db, { topN: input.topN ?? 40, rejectN: input.rejectN ?? 50, includeExperts: true }),
    buildStatsReport(db),
    db.getAllEntriesForStats(),
  ]);

  // Sanitize entries strictly — NEVER include private notes, tags, or raw local fields!
  const cleanEntries = allEntries.map((e) => {
    let roast: RoastJson | null = null;
    if (e.roast_json) {
      try { roast = JSON.parse(e.roast_json) as RoastJson; } catch { roast = null; }
    }
    const kind = classifyEntryKind(e.title, roast);
    const prod = detectProductionSignal(e.title, roast);
    const wa = extractWorkaroundFinding(roast);
    return {
      cf_id: e.cf_id,
      title: e.title,
      status: e.status,
      topic: e.topic,
      authors: e.authors,
      reviewers: e.reviewers,
      committer: e.committer,
      thread_url: e.thread_url,
      verdict: e.verdict || "UNROASTED",
      confidence: e.confidence,
      kind,
      seen_in_production: prod.seen,
      workaround: wa,
      recommended_score: e.recommended_score,
    };
  });

  // Strip local-only triage counts from published stats
  const publicStats = {
    generatedAt: stats.generatedAt,
    totals: stats.totals,
    verdicts: stats.verdicts,
    statusMatrix: stats.statusMatrix,
    novelty: stats.novelty,
    cfbot: stats.cfbot,
    topTopics: stats.topTopics,
    leaderboards: stats.leaderboards,
    rfcNoCommitter: stats.rfcNoCommitter,
  };

  const payload = {
    slug: input.slug?.trim() || `commitfest-${new Date().toISOString().slice(0, 10)}`,
    title: input.title?.trim() || `PostgreSQL CommitFest Triage Brief (${new Date().toISOString().slice(0, 10)})`,
    commitfestLabel: input.commitfestLabel?.trim() || "PG20-3 (#62)",
    stats: publicStats,
    shortlist: sl.shortlist,
    closing: sl.top50Closing,
    entries: cleanEntries,
  };

  const gate = publicConfidentialityCheck(JSON.stringify({ title: payload.title, shortlist: payload.shortlist.slice(0, 20) }));
  if (gate.blocking) {
    const msgs = gate.issues.map((i) => i.message).join(" | ");
    await db.logAudit("hub_publish_brief", payload.slug, { blocked: true, msgs }, "blocked");
    throw new Error(`Public-Confidentiality HARD BLOCK: ${msgs}`);
  }

  const res = await fetch(`${hubBase}/api/v1/publish/brief`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { brief?: Record<string, unknown>; error?: string };
  if (!res.ok) {
    await db.logAudit("hub_publish_brief", payload.slug, { error: data.error || res.status }, "error");
    throw new Error(data.error || `Public companion returned HTTP ${res.status}`);
  }

  await db.logAudit("hub_publish_brief", payload.slug, { hubBase, entriesCount: cleanEntries.length });
  return { ok: true, brief: data.brief ?? {}, hubUrl: hubBase };
}
