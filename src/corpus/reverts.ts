// Git source: commits whose message has a line starting with "Revert"
// (git log --grep='^Revert' -i) in the local Postgres clone. Read-only.

import { resolve as pathResolve } from "node:path";
import { extractMsgids, flatUrl, touchPoints, type PrecedentRecord } from "./util.ts";

export const PG_REPO = process.env.PGROAST_PG_REPO ?? pathResolve(import.meta.dir, "..", "..", "..", "postgres");
export const GITWEB = "https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=";

export async function git(...args: string[]): Promise<{ out: string; code: number }> {
  const p = Bun.spawn(["git", "-C", PG_REPO, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  return { out, code };
}

async function gitOk(...args: string[]): Promise<string> {
  const r = await git(...args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed (${r.code})`);
  return r.out;
}

const utc = (iso: string) => new Date(iso).toISOString().slice(0, 19);

interface Commit { hash: string; author: string; date: string; subject: string; body: string }

const commitCache = new Map<string, Commit>();
async function commit(h: string): Promise<Commit> {
  const hit = commitCache.get(h);
  if (hit) return hit;
  const out = await gitOk("log", "-1", "--format=%H%x00%an%x00%cI%x00%s%x00%B", h);
  const [hash, author, cd, subject, ...rest] = out.split("\x00");
  const c = { hash: hash!, author: author!, date: utc(cd!), subject: subject!, body: rest.join("\x00").trim() };
  commitCache.set(h, c);
  return c;
}

async function resolve(short: string): Promise<string | null> {
  const r = await git("rev-parse", "-q", "--verify", short + "^{commit}");
  return r.code === 0 ? r.out.trim() : null;
}

let subjects: Map<string, [string, string][]> | null = null;
async function subjectIndex() {
  if (!subjects) {
    subjects = new Map();
    for (const ln of (await gitOk("log", "--format=%H%x00%cI%x00%s")).split("\n")) {
      if (!ln) continue;
      const [H, d, s] = ln.split("\x00");
      const k = s!.trim();
      if (!subjects.has(k)) subjects.set(k, []);
      subjects.get(k)!.push([H!, utc(d!)]);
    }
  }
  return subjects;
}

/**
 * CVS-era commits often have the whole message on the subject line. Use its
 * first sentence (max 160 chars) as the title; the full subject stays in summary.
 */
export function shortTitle(subject: string): string {
  if (subject.length <= 160) return subject;
  const m = /^(.{20,160}?[.;:])\s/.exec(subject);
  return m ? m[1]! : subject.slice(0, 157).replace(/\s+\S*$/, "") + "...";
}

const TRAILER = /^(Discussion|Backpatch-through|Back-patch-through|Reported-by|Author|Reviewed-by|Tested-by|Security|Co-authored-by|Bug|Suggested-by|Diagnosed-by|Backpatch|Analyzed-by)\s*:/i;

/** Revert message minus subject line and trailers (verbatim otherwise). */
export function revertReason(body: string, subject: string): string {
  let lines = body.split("\n");
  if (lines[0]?.trim() === subject.trim()) lines = lines.slice(1);
  return lines.filter((l) => !TRAILER.test(l.trim())).join("\n").trim();
}

export async function collectReverts(opts: { limit?: number }) {
  const hashes = (await gitOk("log", "--grep=^Revert", "-i", "--format=%H")).split(/\s+/).filter(Boolean);
  const cov = {
    git_grep_matches: hashes.length, kept_subject_revert: 0, kept_partial_revert: 0,
    skipped_no_revert_target: 0, reverted_commit_resolved: 0, reverted_by_subject_match: 0,
  };
  const recs: PrecedentRecord[] = [];
  for (const h of opts.limit ? hashes.slice(0, opts.limit) : hashes) {
    const c = await commit(h);
    const subjRev = c.subject.toLowerCase().startsWith("revert");
    const targets: string[] = [];
    for (const m of c.body.matchAll(/\b([0-9a-f]{7,40})\b/g)) {
      const ctx = c.body.slice(Math.max(0, m.index! - 120), m.index!).toLowerCase();
      if (!subjRev && !ctx.includes("revert")) continue;
      const full = await resolve(m[1]!);
      if (full && full !== c.hash && !targets.includes(full)) targets.push(full);
    }
    let how: string | null = targets.length ? "hash named in message" : null;
    if (subjRev && !targets.length) {
      const sm = /^Revert\s+"(.+)"\s*\.?$/i.exec(c.subject);
      if (sm) {
        const cands = ((await subjectIndex()).get(sm[1]!.trim()) ?? []).filter(([H, d]) => d < c.date && H !== c.hash);
        if (cands.length) {
          targets.push(cands.reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
          how = "exact subject match, latest earlier commit";
          cov.reverted_by_subject_match++;
        }
      }
    }
    if (!subjRev && !targets.length) { cov.skipped_no_revert_target++; continue; }
    if (subjRev) cov.kept_subject_revert++; else cov.kept_partial_revert++;
    const tinfo = await Promise.all(targets.slice(0, 5).map(commit));
    if (tinfo.length) cov.reverted_commit_resolved++;
    const msgids = extractMsgids(c.body);
    for (const t of tinfo) for (const mid of extractMsgids(t.body)) if (!msgids.includes(mid)) msgids.push(mid);
    const firstDate = [c.date, ...tinfo.map((t) => t.date)].sort()[0]!;
    const revSubjects = tinfo.map((t) => t.subject);
    recs.push({
      id: `revert:${c.hash}`, kind: "revert", rawRef: c.hash,
      title: shortTitle(c.subject), status: subjRev ? "Reverted" : "Partially reverted",
      date: c.date, firstDate, url: GITWEB + c.hash,
      threadUrls: [...new Set(msgids.map(flatUrl))],
      authors: [...new Set(tinfo.map((t) => t.author))], reviewers: [], objectors: [],
      tags: "",
      summary: c.subject + (revSubjects.length ? "\nReverted commit(s): " + revSubjects.join("; ") : ""),
      objection: revertReason(c.body, c.subject),
      touchPoints: touchPoints([c.subject, ...revSubjects, c.body].join(" ")),
      otherLinks: tinfo.map((t) => GITWEB + t.hash),
      provenance: {
        source: "git log of postgresql.git (local clone)", commit: c.hash, reverted_by: c.author, reverted_commit_match: how,
        decided_at: c.date, first_at: firstDate,
        reverted_commits: tinfo.map((t) => ({ hash: t.hash, subject: t.subject, date: t.date, author: t.author })),
      },
    });
  }
  return { recs, cov, complete: !opts.limit };
}
