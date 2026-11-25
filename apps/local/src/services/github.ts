import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildChildEnv, expandHome } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import type { AppSettings, CfEntryRecord, GateCheckResult, WorkItemRecord } from "../types.ts";
import { publicConfidentialityCheck } from "./gates.ts";

export interface ForkIssueSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  updatedAt: string;
  labels?: Array<{ name: string }>;
}

export interface ForkPrSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  updatedAt: string;
}

function runGh(settings: AppSettings, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync("gh", args, {
    encoding: "utf8",
    env: buildChildEnv(settings),
    timeout: 30_000,
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

export function listForkIssues(settings: AppSettings, limit = 30): ForkIssueSummary[] {
  const res = runGh(settings, [
    "issue",
    "list",
    "-R",
    settings.githubFork,
    "--state",
    "all",
    "--limit",
    String(limit),
    "--json",
    "number,title,state,url,updatedAt,labels",
  ]);
  if (!res.ok) {
    throw new Error(`gh issue list failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout || "[]") as ForkIssueSummary[];
}

export function listForkPrs(settings: AppSettings, limit = 20): ForkPrSummary[] {
  const res = runGh(settings, [
    "pr",
    "list",
    "-R",
    settings.githubFork,
    "--state",
    "all",
    "--limit",
    String(limit),
    "--json",
    "number,title,state,url,headRefName,updatedAt",
  ]);
  if (!res.ok) {
    throw new Error(`gh pr list failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout || "[]") as ForkPrSummary[];
}

export function buildSanitizedIssuePreview(
  workItem: WorkItemRecord,
  entry: CfEntryRecord | null,
): { title: string; body: string; gate: GateCheckResult } {
  const title = workItem.cf_id
    ? `CF ${workItem.cf_id}: ${workItem.title}`
    : workItem.title;

  let patchHashes: Array<{ file: string; sha256: string }> = [];
  let suites: string[] = [];
  try {
    patchHashes = JSON.parse(workItem.patch_hashes_json || "[]") as Array<{ file: string; sha256: string }>;
  } catch {
    patchHashes = [];
  }
  try {
    suites = JSON.parse(workItem.suites_run_json || "[]") as string[];
  } catch {
    suites = [];
  }

  const lines: string[] = [];
  lines.push("## Target");
  if (workItem.cf_id) {
    lines.push(`- CommitFest: https://commitfest.postgresql.org/patch/${workItem.cf_id}/`);
  }
  if (entry?.thread_url) {
    lines.push(`- Thread: ${entry.thread_url}`);
  }
  lines.push(`- Target branch: \`${workItem.target_branch || "master"}\``);
  if (workItem.upstream_base_sha) {
    lines.push(`- Upstream base commit: \`${workItem.upstream_base_sha.slice(0, 12)}\``);
  }
  lines.push("");

  if (patchHashes.length > 0) {
    lines.push("## Patch Artifacts (SHA-256)");
    for (const h of patchHashes) {
      lines.push(`- \`${h.file}\`: \`${h.sha256}\``);
    }
    lines.push("");
  }

  if (suites.length > 0) {
    lines.push("## Suites Run");
    for (const s of suites) {
      lines.push(`- ${s}`);
    }
    lines.push("");
  }

  lines.push("## Findings & Reproducer");
  lines.push(workItem.evidence_md.trim() || "_No public evidence recorded yet._");
  lines.push("");

  const body = lines.join("\n");
  const gate = publicConfidentialityCheck(`${title}\n${body}`);

  return { title, body, gate };
}

export async function publishSanitizedIssue(
  db: AppDatabase,
  settings: AppSettings,
  workItemId: number,
  input: {
    title: string;
    body: string;
    commentOnExisting?: boolean;
    confirm: boolean;
  },
): Promise<{ url: string; issueNumber: number | null; mode: "created" | "commented" }> {
  const workItem = await db.getWorkItem(workItemId);
  if (!workItem) throw new Error(`Work item #${workItemId} not found.`);

  if (!input.confirm) {
    await db.logAudit("github_issue_publish", `work_item:${workItemId}`, { reason: "confirm=true required" }, "blocked");
    throw new Error("Explicit confirmation (confirm: true) is required before publishing to GitHub.");
  }

  if (workItem.is_security === 1) {
    await db.logAudit("github_issue_publish", `work_item:${workItemId}`, { reason: "security item" }, "blocked");
    throw new Error("HARD BLOCK: Security work items must NEVER be published to the public fork.");
  }

  const gate = publicConfidentialityCheck(`${input.title}\n${input.body}`);
  if (gate.blocking) {
    const msgs = gate.issues.map((i) => i.message).join(" | ");
    await db.logAudit("github_issue_publish", `work_item:${workItemId}`, { blocked: true, msgs }, "blocked");
    throw new Error(`Public-confidentiality HARD BLOCK: ${msgs}`);
  }

  if (input.commentOnExisting && workItem.github_issue_number) {
    const res = runGh(settings, [
      "issue",
      "comment",
      String(workItem.github_issue_number),
      "-R",
      settings.githubFork,
      "--body",
      input.body,
    ]);
    if (!res.ok) {
      await db.logAudit("github_issue_comment", `issue:${workItem.github_issue_number}`, { error: res.stderr }, "error");
      throw new Error(`gh issue comment failed: ${res.stderr || res.stdout}`);
    }
    const url = res.stdout.trim() || workItem.github_issue_url;
    await db.logAudit("github_issue_comment", `issue:${workItem.github_issue_number}`, { url });
    return { url, issueNumber: workItem.github_issue_number, mode: "commented" };
  }

  const res = runGh(settings, [
    "issue",
    "create",
    "-R",
    settings.githubFork,
    "--title",
    input.title,
    "--body",
    input.body,
  ]);
  if (!res.ok) {
    await db.logAudit("github_issue_create", `work_item:${workItemId}`, { error: res.stderr }, "error");
    throw new Error(`gh issue create failed: ${res.stderr || res.stdout}`);
  }
  const url = res.stdout.trim();
  const numMatch = url.match(/\/issues\/(\d+)/);
  const issueNumber = numMatch?.[1] ? Number(numMatch[1]) : null;
  await db.updateWorkItem(workItemId, {
    github_issue_number: issueNumber,
    github_issue_url: url,
  });
  await db.logAudit("github_issue_create", `work_item:${workItemId}`, { url, issueNumber });
  return { url, issueNumber, mode: "created" };
}

export async function pushCiBranch(
  db: AppDatabase,
  settings: AppSettings,
  workItemId: number,
  input: { branchName: string; confirm: boolean },
): Promise<{ branch: string; output: string; actionsUrl: string }> {
  const workItem = await db.getWorkItem(workItemId);
  if (!workItem) throw new Error(`Work item #${workItemId} not found.`);

  if (!input.confirm) {
    await db.logAudit("github_ci_push", `work_item:${workItemId}`, { reason: "confirm=true required" }, "blocked");
    throw new Error("Explicit confirmation (confirm: true) is required before pushing a CI branch.");
  }

  if (workItem.is_security === 1) {
    await db.logAudit("github_ci_push", `work_item:${workItemId}`, { reason: "security item" }, "blocked");
    throw new Error("HARD BLOCK: Security work items must NEVER be pushed to the public fork.");
  }

  const branch = input.branchName.trim();
  if (!/^ci\/[a-z0-9._-]+$/i.test(branch)) {
    throw new Error('CI branch name must match "ci/<slug>-vN" (alphanumeric, dots, dashes, underscores).');
  }

  const worktree = expandHome(workItem.worktree_path);
  const root = resolve(expandHome(settings.worktreesRoot));
  if (!worktree || !existsSync(worktree) || !resolve(worktree).startsWith(root)) {
    throw new Error(`Worktree "${worktree}" does not exist inside managed worktreesRoot (${root}).`);
  }

  const pushRes = spawnSync(
    "git",
    ["-C", worktree, "push", "origin", `HEAD:refs/heads/${branch}`],
    {
      encoding: "utf8",
      env: buildChildEnv(settings),
      timeout: 60_000,
    },
  );

  if (pushRes.status !== 0) {
    await db.logAudit("github_ci_push", branch, { error: pushRes.stderr || pushRes.stdout }, "error");
    throw new Error(`git push failed: ${pushRes.stderr || pushRes.stdout}`);
  }

  await db.updateWorkItem(workItemId, { ci_branch: branch });
  const actionsUrl = `https://github.com/${settings.githubFork}/actions/workflows/pg-ci.yml`;
  await db.logAudit("github_ci_push", branch, { worktree, actionsUrl });
  return {
    branch,
    output: (pushRes.stdout + "\n" + pushRes.stderr).trim(),
    actionsUrl,
  };
}
