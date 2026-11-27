// `pgroast shortlist <batch-dir>`: Andrey Borodin's CommitFest publishing model.
// Ranks every finished roast.json in a batch directory on two independent axes:
//   1. CommitFest Shortlist (Top N worth committer attention — high impact, sound design)
//   2. Close / Rethink Digest (Top M worth closing or rethinking — with reasons & author next steps)
// Works on both v1 (pgroast-2026-nov) and v2 roast.json outputs. Local files only.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findSubsystemExperts, inferFilesFromRoast, type ExpertMatch } from "./experts.ts";
import { stripInternalIds } from "./roast/render.ts";
import { DISCLOSURE, type FinalObjection, type Roast } from "./roast/schema.ts";

export interface ScoredEntry {
  cfId: number | null;
  slug: string;
  title: string;
  url: string;
  threadUrl: string;
  authors: string;
  cfStatus: string | null;
  verdict: Roast["verdict"];
  confidence: Roast["confidence"];
  recommendedAction: string;
  audience: string;
  maintenanceBurden: string;
  reviewCost: string;
  owner: string;
  ownerNote: string;
  notNow: boolean;
  fatalCount: number;
  survivingCount: number;
  novelCount: number;
  sameIdeaPriorCount: number;
  messagesRead: number;
  attentionScore: number;
  rejectScore: number;
  attentionReasons: string[];
  rejectReasons: string[];
  nextStepForAuthor: string;
  topQuestion: string;
  priorityReason: string;
  verdictReasoning: string;
  touchedFiles: string[];
  experts: ExpertMatch[];
  roastPath: string;
}

export interface ShortlistOptions {
  batchDir: string;
  top?: number;
  reject?: number;
  pgRepo?: string | null;
  outDir?: string;
  log?: (msg: string) => void;
}

export interface ShortlistResult {
  generated_at: string;
  disclosure: string;
  batch_dir: string;
  total_entries: number;
  verdict_counts: Record<string, number>;
  action_counts: Record<string, number>;
  shortlist: ScoredEntry[];
  reject_list: ScoredEntry[];
  all_entries: ScoredEntry[];
}

const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const escCell = (s: string) => oneLine(s).replace(/\|/g, "\\|");
const link = (text: string, url: string) => (url ? `[${text.replace(/([[\]])/g, "\\$1")}](${url.replace(/\)/g, "%29")})` : text);

function countNovel(objections: FinalObjection[]): number {
  return objections.filter((o) => (o.novelty ?? "new") !== "open_in_thread").length;
}

function buildNextStep(r: Roast): string {
  const action = r.priority?.recommended_action ?? "";
  const firstQ = oneLine(r.questions?.[0] ?? r.objections?.[0]?.author_must_show ?? "");
  if (r.not_now?.applies && r.not_now.evidence_that_would_change_it?.trim()) {
    return `Show concrete user demand or production use cases before pushing for commit: ${oneLine(r.not_now.evidence_that_would_change_it)}`;
  }
  if (action === "close: dead or superseded") {
    return `Confirm whether the entry is superseded or obsolete, and close the CommitFest entry (or post a fresh rebased series explaining what remains needed).`;
  }
  if (action === "withdraw and resubmit") {
    const base = firstQ ? ` Address the core objection first: ${firstQ}` : "";
    return `Withdraw the current entry and resubmit with a revised scope or design.${base}`;
  }
  if (action === "needs design rethink" || action === "fix design first") {
    return firstQ
      ? `Resolve the design question on pgsql-hackers before further code churn: ${firstQ}`
      : `Post a concise design summary addressing the open architectural objections before updating the code.`;
  }
  if (action === "park") {
    return firstQ
      ? `Park until stronger demand or a clearer scope emerges; key open question: ${firstQ}`
      : `Park until clear user demand or a simpler scope justifies ongoing maintenance.`;
  }
  if (action === "bundle") {
    return `Consider bundling with related work in the same subsystem so the combined value justifies review and maintenance.`;
  }
  if (action === "needs champion") {
    return firstQ
      ? `Answer the remaining committer question and ask a subsystem committer for a design sign-off: ${firstQ}`
      : `Summarize the current patch status and seek a subsystem committer to champion it.`;
  }
  return firstQ || oneLine(r.priority?.reason) || "Address open review questions and prepare for committer review.";
}

/** Score one finished Roast on both Committer Attention (worth effort) and Close/Rethink Priority. */
export function scoreEntry(r: Roast, roastPath: string, slug: string, experts: ExpertMatch[] = []): ScoredEntry {
  const objections = r.objections ?? [];
  const fatalCount = objections.filter((o) => o.severity === "fatal").length;
  const survivingCount = objections.length + (r.other_surviving?.length ?? 0);
  const novelCount = countNovel(objections);
  const sameIdeaPriorCount = (r.prior_attempts ?? []).filter((p) => p.relation === "same_idea").length;
  const p = r.priority ?? { audience: "unclear", maintenance_burden: "medium", review_cost: "medium", recommended_action: "park", reason: "" };
  const cfStatus = r.input?.cf?.status ?? null;
  const owner = r.committability?.owner ?? "none obvious";
  const notNow = Boolean(r.not_now?.applies);

  // Axis 1: Committer Attention Score ("worth effort", not merely trivial).
  let att = 0;
  const attReasons: string[] = [];
  if (r.verdict === "NO-FUNDAMENTAL-OBJECTION") {
    att += 35;
    attReasons.push("no fundamental objection");
  } else if (r.verdict === "NEEDS-COMMITTER-EYES") {
    att += 28;
    attReasons.push("needs committer eyes");
  } else if (r.verdict === "NEEDS-DESIGN-DISCUSSION") {
    att += 5;
  } else if (r.verdict === "LIKELY-REJECT") {
    att -= 40;
  }

  if (p.audience === "most users") {
    att += 22;
    attReasons.push("benefits most users");
  } else if (p.audience === "a sizeable minority") {
    att += 15;
    attReasons.push("sizeable user audience");
  } else if (p.audience === "niche") {
    att += 4;
  } else {
    att -= 5;
  }

  const actionAtt: Record<string, number> = {
    proceed: 20,
    "needs champion": 14,
    "fix design first": 4,
    bundle: 0,
    park: -15,
    "needs design rethink": -18,
    "withdraw and resubmit": -30,
    "close: dead or superseded": -45,
  };
  att += actionAtt[p.recommended_action] ?? 0;
  if (p.recommended_action === "proceed" || p.recommended_action === "needs champion") {
    attReasons.push(p.recommended_action);
  }

  // Value patches worth the effort: low/medium review cost is easy to land,
  // while high review cost + broad audience gets a "high-impact scary patch" bonus.
  if (p.review_cost === "low") att += 8;
  else if (p.review_cost === "medium") att += 6;
  else if (p.review_cost === "high" && (p.audience === "most users" || p.audience === "a sizeable minority")) {
    att += 6;
    attReasons.push("high-impact change worth review effort");
  } else {
    att -= 2;
  }

  if (p.maintenance_burden === "low") att += 6;
  else if (p.maintenance_burden === "medium") att += 2;
  else if (p.maintenance_burden === "high") att -= 4;

  if (fatalCount > 0) att -= 30 * fatalCount;
  if (notNow) att -= 15;
  if (sameIdeaPriorCount > 0) att -= 12 * sameIdeaPriorCount;

  if (cfStatus && /ready for committer/i.test(cfStatus)) {
    att += 10;
    attReasons.push("Ready for Committer");
  } else if (cfStatus && /needs review/i.test(cfStatus)) {
    att += 3;
  } else if (cfStatus && /waiting on author/i.test(cfStatus)) {
    att -= 4;
  }

  if (owner === "qualified committer engaged") att += 4;
  else if (owner === "silent" && cfStatus && /ready for committer/i.test(cfStatus)) att += 3;

  if (r.confidence === "high") att += 4;
  else if (r.confidence === "medium") att += 2;

  // Axis 2: Close / Rethink Priority Score.
  let rej = 0;
  const rejReasons: string[] = [];
  if (r.verdict === "LIKELY-REJECT") {
    rej += 45;
    rejReasons.push("verdict LIKELY-REJECT");
  } else if (r.verdict === "NEEDS-DESIGN-DISCUSSION") {
    rej += 15;
    rejReasons.push("unresolved design/demand discussion");
  } else if (r.verdict === "NEEDS-COMMITTER-EYES") {
    rej -= 15;
  } else if (r.verdict === "NO-FUNDAMENTAL-OBJECTION") {
    rej -= 35;
  }

  const actionRej: Record<string, number> = {
    "close: dead or superseded": 40,
    "withdraw and resubmit": 32,
    "needs design rethink": 24,
    park: 18,
    "fix design first": 10,
    bundle: 8,
    "needs champion": -5,
    proceed: -30,
  };
  rej += actionRej[p.recommended_action] ?? 0;
  if ((actionRej[p.recommended_action] ?? 0) >= 18) {
    rejReasons.push(`action: ${p.recommended_action}`);
  }

  if (notNow) {
    rej += 18;
    rejReasons.push("demand not yet shown (not now)");
  }
  if (fatalCount > 0) {
    rej += 22 * fatalCount;
    rejReasons.push(`${fatalCount} fatal objection${fatalCount > 1 ? "s" : ""}`);
  }
  if (novelCount > 0) {
    rej += Math.min(20, 5 * novelCount);
  }
  if (sameIdeaPriorCount > 0) {
    rej += 20;
    rejReasons.push("repeats previously rejected idea");
  }
  if (p.audience === "niche" || p.audience === "unclear") rej += 6;
  if (p.maintenance_burden === "high") rej += 6;
  if (r.confidence === "high" && rej > 20) rej += 5;

  const title = oneLine(r.input?.cf?.title ?? r.brief?.title ?? r.input?.subject ?? slug);
  const topObj = objections[0];
  if (topObj && rejReasons.length < 3) rejReasons.push(oneLine(topObj.title));

  return {
    cfId: r.input?.cf?.id ?? null,
    slug,
    title,
    url: r.input?.cf?.url ?? r.input?.thread_url ?? "",
    threadUrl: r.input?.thread_url ?? "",
    authors: oneLine(r.input?.cf?.authors ?? ""),
    cfStatus,
    verdict: r.verdict,
    confidence: r.confidence,
    recommendedAction: p.recommended_action,
    audience: p.audience,
    maintenanceBurden: p.maintenance_burden,
    reviewCost: p.review_cost,
    owner,
    ownerNote: oneLine(r.committability?.owner_note ?? ""),
    notNow,
    fatalCount,
    survivingCount,
    novelCount,
    sameIdeaPriorCount,
    messagesRead: r.input?.messages_read ?? 0,
    attentionScore: Math.round(att),
    rejectScore: Math.round(rej),
    attentionReasons: attReasons,
    rejectReasons: rejReasons,
    nextStepForAuthor: stripInternalIds(buildNextStep(r)),
    topQuestion: stripInternalIds(oneLine(r.questions?.[0] ?? topObj?.author_must_show ?? "")),
    priorityReason: stripInternalIds(oneLine(p.reason)),
    verdictReasoning: stripInternalIds(oneLine(r.verdict_reasoning)),
    touchedFiles: inferFilesFromRoast(r),
    experts,
    roastPath,
  };
}

/** Discover all roast.json files under `<batchDir>/cf/<id>/roast.json` (or `<batchDir>/<slug>/roast.json`). */
export function discoverRoastFiles(batchDir: string): { slug: string; path: string }[] {
  const cfDir = join(batchDir, "cf");
  const root = existsSync(cfDir) ? cfDir : batchDir;
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ slug: d.name, path: join(root, d.name, "roast.json") }))
    .filter((x) => existsSync(x.path));
  entries.sort((a, b) => {
    const an = Number(a.slug);
    const bn = Number(b.slug);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.slug.localeCompare(b.slug);
  });
  return entries;
}

export function buildShortlist(
  roasts: { slug: string; path: string; roast: Roast }[],
  opts: { top?: number; reject?: number; pgRepo?: string | null; batchDir?: string; now?: Date } = {},
): ShortlistResult {
  const topN = opts.top ?? 20;
  const rejectM = opts.reject ?? 50;
  const pgRepo = opts.pgRepo ?? null;
  const expertCache = new Map<string, ExpertMatch[]>();

  const getExperts = (r: Roast): ExpertMatch[] => {
    if (!pgRepo) return [];
    const files = inferFilesFromRoast(r);
    if (files.length === 0) return [];
    const key = [...files].sort().join("|");
    let cached = expertCache.get(key);
    if (!cached) {
      cached = findSubsystemExperts(pgRepo, files, { limit: 4, now: opts.now });
      expertCache.set(key, cached);
    }
    return cached;
  };

  const verdictCounts: Record<string, number> = {};
  const actionCounts: Record<string, number> = {};
  const all = roasts.map(({ slug, path, roast }) => {
    verdictCounts[roast.verdict] = (verdictCounts[roast.verdict] ?? 0) + 1;
    const act = roast.priority?.recommended_action ?? "unknown";
    actionCounts[act] = (actionCounts[act] ?? 0) + 1;
    return scoreEntry(roast, path, slug, getExperts(roast));
  });

  // Shortlist: exclude LIKELY-REJECT, fatal objections, and explicit close/withdraw recommendations.
  const shortlistCandidates = all.filter(
    (e) =>
      e.verdict !== "LIKELY-REJECT" &&
      e.fatalCount === 0 &&
      e.recommendedAction !== "close: dead or superseded" &&
      e.recommendedAction !== "withdraw and resubmit",
  );
  shortlistCandidates.sort(
    (a, b) =>
      b.attentionScore - a.attentionScore ||
      a.fatalCount - b.fatalCount ||
      (a.cfId ?? 0) - (b.cfId ?? 0),
  );
  const shortlist = shortlistCandidates.slice(0, topN);
  const shortlistSlugs = new Set(shortlist.map((e) => e.slug));

  // Reject/Triage list: exclude clean NO-FUNDAMENTAL-OBJECTION + proceed entries and entries already in shortlist.
  const rejectCandidates = all.filter(
    (e) =>
      !shortlistSlugs.has(e.slug) &&
      !(e.verdict === "NO-FUNDAMENTAL-OBJECTION" && e.recommendedAction === "proceed") &&
      e.rejectScore > 0,
  );
  rejectCandidates.sort(
    (a, b) =>
      b.rejectScore - a.rejectScore ||
      b.fatalCount - a.fatalCount ||
      (a.cfId ?? 0) - (b.cfId ?? 0),
  );
  const rejectList = rejectCandidates.slice(0, rejectM);

  return {
    generated_at: (opts.now ?? new Date()).toISOString(),
    disclosure: DISCLOSURE,
    batch_dir: opts.batchDir ?? "",
    total_entries: all.length,
    verdict_counts: verdictCounts,
    action_counts: actionCounts,
    shortlist,
    reject_list: rejectList,
    all_entries: all,
  };
}

export function renderShortlistMarkdown(res: ShortlistResult): string {
  const out: string[] = [];
  out.push(`# CommitFest Shortlist — Top ${res.shortlist.length} Patches Worth Committer Attention`);
  out.push("");
  out.push(`> ${res.disclosure}`);
  out.push("");
  out.push(
    `Ranked from **${res.total_entries}** analyzed CommitFest entries (generated ${res.generated_at.slice(0, 10)}). ` +
      `Favors sound designs with no fatal objections, meaningful user impact, and clear committer leverage — patches worth the effort, not merely trivial ones.`,
  );
  out.push("");
  const vSummary = Object.entries(res.verdict_counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join(" · ");
  if (vSummary) out.push(`**Batch distribution:** ${vSummary}`, "");

  out.push("| # | Entry | Title | Verdict | Action | Audience | Review cost | Score |");
  out.push("|---:|---|---|---|---|---|---|---:|");
  res.shortlist.forEach((e, i) => {
    const idLabel = e.cfId != null ? `CF ${e.cfId}` : e.slug;
    out.push(
      `| ${i + 1} | ${link(idLabel, e.url)} | ${escCell(e.title)} | ${e.verdict} | ${e.recommendedAction} | ${e.audience} | ${e.reviewCost} | ${e.attentionScore} |`,
    );
  });
  out.push("");

  out.push("## Details");
  out.push("");
  res.shortlist.forEach((e, i) => {
    const idLabel = e.cfId != null ? `CF ${e.cfId}` : e.slug;
    out.push(`### ${i + 1}. ${link(`${idLabel}: ${e.title}`, e.url)}`);
    out.push("");
    const meta = [
      `**${e.verdict}** (${e.confidence})`,
      e.cfStatus ? `CF status: ${e.cfStatus}` : null,
      `action: ${e.recommendedAction}`,
      `audience: ${e.audience}`,
      `review cost: ${e.reviewCost}`,
      `score: ${e.attentionScore}`,
    ].filter(Boolean);
    out.push(meta.join(" · "));
    if (e.authors) out.push("", `**Authors:** ${e.authors}`);
    if (e.priorityReason) out.push("", `**Why it is worth effort:** ${e.priorityReason}`);
    if (e.topQuestion) out.push("", `**Key question to settle:** ${e.topQuestion}`);
    if (e.experts.length > 0) {
      const expStr = e.experts.map((x) => `${x.name} (${x.commits}c/${x.reviews}r)`).join(", ");
      out.push("", `**Suggested subsystem experts (git log):** ${expStr}`);
    } else if (e.ownerNote) {
      out.push("", `**Subsystem expertise needed:** ${e.ownerNote}`);
    }
    out.push("");
  });

  out.push("---", "", res.disclosure, "");
  return out.join("\n");
}

export function renderRejectMarkdown(res: ShortlistResult): string {
  const out: string[] = [];
  out.push(`# CommitFest Triage — Top ${res.reject_list.length} Patches Worth Closing or Rethinking`);
  out.push("");
  out.push(`> ${res.disclosure}`);
  out.push("");
  out.push(
    `Selected from **${res.total_entries}** analyzed CommitFest entries (generated ${res.generated_at.slice(0, 10)}). ` +
      `This is a triage digest for CommitFest managers and reviewers — never send automated rejections to the list. Every item lists the concrete concern and an actionable next step for the author.`,
  );
  out.push("");

  out.push("| # | Entry | Title | Verdict | Action | Fatal | Prior | Score |");
  out.push("|---:|---|---|---|---|---:|---:|---:|");
  res.reject_list.forEach((e, i) => {
    const idLabel = e.cfId != null ? `CF ${e.cfId}` : e.slug;
    out.push(
      `| ${i + 1} | ${link(idLabel, e.url)} | ${escCell(e.title)} | ${e.verdict} | ${e.recommendedAction} | ${e.fatalCount} | ${e.sameIdeaPriorCount} | ${e.rejectScore} |`,
    );
  });
  out.push("");

  out.push("## Reasons and Next Steps");
  out.push("");
  res.reject_list.forEach((e, i) => {
    const idLabel = e.cfId != null ? `CF ${e.cfId}` : e.slug;
    out.push(`### ${i + 1}. ${link(`${idLabel}: ${e.title}`, e.url)}`);
    out.push("");
    out.push(
      `**${e.verdict}** (${e.confidence}) · action: **${e.recommendedAction}**${e.cfStatus ? ` · CF status: ${e.cfStatus}` : ""} · score: ${e.rejectScore}`,
    );
    const reasonText = e.priorityReason || e.verdictReasoning || e.rejectReasons.join("; ");
    out.push("", `**Why:** ${reasonText}`);
    if (e.rejectReasons.length) out.push("", `**Signals:** ${e.rejectReasons.join("; ")}`);
    out.push("", `**Next step for author:** ${e.nextStepForAuthor}`);
    if (e.experts.length > 0) {
      out.push("", `**Relevant subsystem experts:** ${e.experts.map((x) => x.name).join(", ")}`);
    }
    out.push("");
  });

  out.push("---", "", res.disclosure, "");
  return out.join("\n");
}

export function runShortlist(opts: ShortlistOptions): { result: ShortlistResult; outDir: string; files: string[] } {
  const log = opts.log ?? ((m: string) => console.log(m));
  const batchDir = resolve(opts.batchDir);
  if (!existsSync(batchDir)) throw new Error(`batch directory not found: ${batchDir}`);
  const discovered = discoverRoastFiles(batchDir);
  if (discovered.length === 0) throw new Error(`no roast.json files found under ${batchDir}`);

  const roasts: { slug: string; path: string; roast: Roast }[] = [];
  for (const d of discovered) {
    try {
      const roast = JSON.parse(readFileSync(d.path, "utf8")) as Roast;
      if (!roast || typeof roast.verdict !== "string") continue;
      roasts.push({ slug: d.slug, path: d.path, roast });
    } catch (e) {
      log(`skipping invalid ${d.path}: ${(e as Error).message}`);
    }
  }
  const pgRepo = opts.pgRepo ?? process.env.PGROAST_PG_REPO ?? null;
  const result = buildShortlist(roasts, { top: opts.top, reject: opts.reject, pgRepo, batchDir });

  const outDir = resolve(opts.outDir ?? join(batchDir, "shortlist"));
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "shortlist.json");
  const shortlistPath = join(outDir, "shortlist.md");
  const rejectPath = join(outDir, "top-reject.md");

  writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(shortlistPath, renderShortlistMarkdown(result));
  writeFileSync(rejectPath, renderRejectMarkdown(result));

  log(`shortlist: read ${result.total_entries} roast(s); top ${result.shortlist.length} shortlist, top ${result.reject_list.length} close/rethink`);
  log(`wrote ${shortlistPath}`);
  log(`wrote ${rejectPath}`);
  log(`wrote ${jsonPath}`);
  return { result, outDir, files: [shortlistPath, rejectPath, jsonPath] };
}

export function parseShortlistArgs(argv: string[]): ShortlistOptions | "help" {
  const rest = [...argv];
  const o: Partial<ShortlistOptions> = {};
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
    else if (flag === "--top") o.top = int(flag, inline);
    else if (flag === "--reject") o.reject = int(flag, inline);
    else if (flag === "--pg-repo") o.pgRepo = val(flag, inline);
    else if (flag === "--out") o.outDir = val(flag, inline);
    else if (flag.startsWith("--")) throw new Error(`unknown option ${flag} for shortlist`);
    else if (o.batchDir) throw new Error(`unexpected argument "${tok}"`);
    else o.batchDir = tok;
  }
  if (!o.batchDir) throw new Error("shortlist needs <batch-dir>");
  return o as ShortlistOptions;
}

const SHORTLIST_USAGE = `Usage: pgroast shortlist <batch-dir> [--top 20] [--reject 50] [--pg-repo PATH] [--out DIR]

Ranks finished CommitFest roast.json files into:
  - shortlist.md   Top N patches worth committer attention
  - top-reject.md  Top M patches worth closing or rethinking (with reasons & author next steps)
  - shortlist.json Full structured scores`;

export async function shortlistMain(argv: string[]): Promise<number> {
  try {
    const parsed = parseShortlistArgs(argv);
    if (parsed === "help") {
      console.log(SHORTLIST_USAGE);
      return 0;
    }
    runShortlist(parsed);
    return 0;
  } catch (e) {
    console.error(`pgroast shortlist: ${(e as Error).message}`);
    return 2;
  }
}
