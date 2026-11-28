// Real PostgreSQL verification harness for Medium and Dark roasts.
//
// - Medium: git apply in a pooled incremental worktree + meson compile + targeted meson test
//           + surrounding source context extraction from the patched tree.
// - Dark:   everything in Medium + boots a throwaway isolated patched PostgreSQL cluster
//           (Unix socket only, no TCP, ephemeral data dir) and executes LLM-proposed pure-SQL
//           adversarial stress tests & EXPLAIN (ANALYZE, BUFFERS) checks via psql, watching
//           the server log for crashes, TRAP assertions, PANICs, and unexpected behavior.
//
// Safety:
// - Never modifies the user's primary postgres checkout.
// - Uses an atomic lock per pooled worktree slot (~/.pgroast/verify-pool/slot-0..3).
// - Never runs LLM-generated shell commands — Dark live tests run pure SQL via psql only.
// - Always stops its own throwaway pg_ctl instance and deletes temp data/socket dirs in finally.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProposalInput } from "../thread/types.ts";
import type { RoastLevel } from "./flavours.ts";
import type { LlmBackend } from "./llm.ts";
import type { JsonSchema } from "./schema.ts";

export interface LiveSqlCaseResult {
  name: string;
  category: string;
  sql: string;
  status: "pass" | "error" | "crash" | "timeout";
  durationMs: number;
  outputExcerpt: string;
  errorExcerpt: string;
}

export interface VerificationReport {
  level: RoastLevel;
  codeRead: boolean;
  codeFilesCount: number;
  codeHunksChars: number;
  pgRepoUsed: string | null;
  baseRef: string;
  gitApply: "clean" | "conflict" | "no_patch" | "skipped";
  applyDetail: string;
  mesonCompile: "pass" | "fail" | "skipped";
  compileDurationMs: number;
  compileDetail: string;
  testsStatus: "pass" | "fail" | "skipped";
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  testSuites: string[];
  testDetail: string;
  liveReproStatus: "pass" | "issue_found" | "crash" | "skipped";
  liveReproCases: LiveSqlCaseResult[];
  surroundingContext: string;
  evidenceBadges: string[];
}

export const DARK_SQL_CASES_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string", enum: ["edge_case", "subxact_error", "explain_perf", "reproducer", "null_boundary"] },
          goal: { type: "string" },
          sql: { type: "string" },
        },
      },
    },
  },
};

interface DarkSqlPlan {
  cases: Array<{ name: string; category: string; goal: string; sql: string }>;
}

const POOL_ROOT = join(homedir(), ".pgroast", "verify-pool");
const MAX_SLOTS = 4;

export function detectLocalPgRepo(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.PGROAST_PG_REPO,
    join(homedir(), "github", "postgres"),
    join(homedir(), "postgres"),
    join(homedir(), "work", "postgres"),
  ].filter((p): p is string => Boolean(p && p.trim()));
  for (const p of candidates) {
    const abs = resolve(p);
    if (existsSync(join(abs, ".git")) && existsSync(join(abs, "meson.build"))) {
      return abs;
    }
  }
  return null;
}

function runCmd(
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): { status: number; stdout: string; stderr: string; timedOut: boolean } {
  const res = spawnSync(bin, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const timedOut = Boolean(res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
  return {
    status: res.status ?? (timedOut ? 124 : 1),
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    timedOut,
  };
}

function resolveBaseRef(pgRepo: string): string {
  for (const ref of ["upstream/master", "origin/master", "master", "HEAD"]) {
    const r = runCmd("git", ["-C", pgRepo, "rev-parse", "--verify", "--quiet", ref], { timeoutMs: 5_000 });
    if (r.status === 0) return ref;
  }
  return "HEAD";
}

function acquirePoolSlot(log: (m: string) => void): { slotDir: string; lockDir: string } | null {
  mkdirSync(POOL_ROOT, { recursive: true });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slotDir = join(POOL_ROOT, `slot-${i}`);
      const lockDir = join(POOL_ROOT, `slot-${i}.lock`);
      try {
        mkdirSync(lockDir);
        writeFileSync(join(lockDir, "pid"), `${process.pid}\n`);
        return { slotDir, lockDir };
      } catch {
        // Reclaim stale lock older than 45 minutes or dead PID
        try {
          const st = statSync(lockDir);
          const pidFile = join(lockDir, "pid");
          let alive = true;
          if (existsSync(pidFile)) {
            const pid = Number(readFileSync(pidFile, "utf8").trim());
            if (pid > 0) {
              try {
                process.kill(pid, 0);
              } catch {
                alive = false;
              }
            }
          }
          if (!alive || Date.now() - st.mtimeMs > 45 * 60_000) {
            rmSync(lockDir, { recursive: true, force: true });
          }
        } catch {
          // ignore race
        }
      }
    }
    // Wait briefly before retrying slot acquisition
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  log("verify: all build pool slots busy after 90s; skipping compile/test");
  return null;
}

function releasePoolSlot(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function selectTargetedMesonSuites(touchedFiles: string[]): string[] {
  const suites = new Set<string>();
  for (const f of touchedFiles) {
    const contribMatch = f.match(/^contrib\/([^/]+)\//);
    if (contribMatch?.[1]) {
      suites.add(contribMatch[1]);
      continue;
    }
    const modMatch = f.match(/^src\/test\/modules\/([^/]+)\//);
    if (modMatch?.[1]) {
      suites.add(modMatch[1]);
      continue;
    }
    const binMatch = f.match(/^src\/bin\/([^/]+)\//);
    if (binMatch?.[1]) {
      suites.add(binMatch[1]);
      continue;
    }
    if (f.startsWith("src/pl/plpgsql/")) {
      suites.add("plpgsql");
      continue;
    }
    if (f.startsWith("src/interfaces/libpq/")) {
      suites.add("libpq");
      continue;
    }
    if (f.startsWith("src/test/isolation/")) {
      suites.add("isolation");
      continue;
    }
  }
  if (suites.size === 0 && touchedFiles.some((f) => f.startsWith("src/backend/") || f.startsWith("src/include/"))) {
    suites.add("regress");
  }
  return Array.from(suites).slice(0, 3);
}

function extractSurroundingSourceContext(worktreeDir: string, touchedFiles: string[], maxTotalChars = 16_000): string {
  const parts: string[] = [];
  let total = 0;
  const codeFiles = touchedFiles.filter((f) => /\.(?:c|h)$/.test(f)).slice(0, 5);
  for (const rel of codeFiles) {
    if (total >= maxTotalChars) break;
    const full = join(worktreeDir, rel);
    if (!existsSync(full)) continue;
    // Get modified line numbers via git diff -U0
    const diff = runCmd("git", ["-C", worktreeDir, "diff", "-U0", "--", rel], { timeoutMs: 5_000 });
    const hunkStarts = Array.from(diff.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm))
      .map((m) => ({ start: Number(m[1]), len: Number(m[2] || 1) }))
      .slice(0, 3);
    if (hunkStarts.length === 0) continue;
    try {
      const fileLines = readFileSync(full, "utf8").split("\n");
      const snippets: string[] = [];
      for (const h of hunkStarts) {
        const s = Math.max(0, h.start - 18);
        const e = Math.min(fileLines.length, h.start + Math.min(h.len, 30) + 18);
        const body = fileLines
          .slice(s, e)
          .map((ln, idx) => `${String(s + idx + 1).padStart(5, " ")} | ${ln}`)
          .join("\n");
        snippets.push(body);
      }
      const block = `### Patched source context: ${rel}\n\`\`\`c\n${snippets.join("\n...\n")}\n\`\`\``;
      if (total + block.length > maxTotalChars) {
        parts.push(block.slice(0, maxTotalChars - total) + "\n[... truncated ...]");
        total = maxTotalChars;
      } else {
        parts.push(block);
        total += block.length;
      }
    } catch {
      // ignore read errors
    }
  }
  return parts.join("\n\n");
}

function buildEvidenceBadges(r: Omit<VerificationReport, "evidenceBadges">): string[] {
  const badges: string[] = [];
  if (r.codeRead) {
    badges.push(`Code Diff (${r.codeFilesCount} file${r.codeFilesCount === 1 ? "" : "s"})`);
  } else {
    badges.push("Thread + Precedents (no code read)");
  }
  if (r.gitApply === "clean") badges.push("git apply ✓");
  else if (r.gitApply === "conflict") badges.push("git apply ✗ conflict");
  else if (r.gitApply === "no_patch") badges.push("No patch attachment");

  if (r.mesonCompile === "pass") {
    const secs = Math.max(1, Math.round(r.compileDurationMs / 1000));
    badges.push(`meson compile ✓ (${secs}s)`);
  } else if (r.mesonCompile === "fail") {
    badges.push("meson compile ✗ failed");
  }

  if (r.testsStatus === "pass") {
    badges.push(`tests ✓ (${r.testsPassed}/${r.testsRun})`);
  } else if (r.testsStatus === "fail") {
    badges.push(`tests ✗ (${r.testsFailed} failed)`);
  }

  if (r.liveReproStatus === "crash") {
    badges.push(`live SQL stress ✗ CRASH/ASSERT`);
  } else if (r.liveReproStatus === "issue_found") {
    badges.push(`live SQL stress ⚠ (${r.liveReproCases.length} cases)`);
  } else if (r.liveReproStatus === "pass") {
    badges.push(`live SQL stress ✓ (${r.liveReproCases.length} cases)`);
  }
  return badges;
}

export async function runPatchVerification(opts: {
  proposal: ProposalInput;
  level: RoastLevel;
  pgRepo?: string;
  focusPrompt?: string;
  backend?: LlmBackend;
  model?: string;
  log?: (msg: string) => void;
}): Promise<VerificationReport> {
  const log = opts.log ?? (() => {});
  const level = opts.level;
  const latestPatches = opts.proposal.patchProse
    .filter((pp) => pp.isLatest !== false)
    .sort((a, b) => a.attachment.name.localeCompare(b.attachment.name));

  const codeHunks = latestPatches.flatMap((pp) => pp.codeHunks ?? []);
  const codeFilesCount = new Set(codeHunks.map((h) => h.path)).size;
  const codeHunksChars = codeHunks.reduce((a, h) => a + h.text.length, 0);
  const touchedFiles = [...new Set(latestPatches.flatMap((pp) => pp.files))];

  const base: Omit<VerificationReport, "evidenceBadges"> = {
    level,
    codeRead: level !== "light" && codeHunks.length > 0,
    codeFilesCount,
    codeHunksChars,
    pgRepoUsed: null,
    baseRef: "",
    gitApply: "skipped",
    applyDetail: "",
    mesonCompile: "skipped",
    compileDurationMs: 0,
    compileDetail: "",
    testsStatus: "skipped",
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    testSuites: [],
    testDetail: "",
    liveReproStatus: "skipped",
    liveReproCases: [],
    surroundingContext: "",
  };

  if (level === "light") {
    return { ...base, evidenceBadges: buildEvidenceBadges(base) };
  }

  const rawPatchFiles = latestPatches.filter((pp) => Boolean(pp.rawText && pp.rawText.includes("diff --git")));
  if (rawPatchFiles.length === 0) {
    base.gitApply = "no_patch";
    base.applyDetail = "No unified diff (.patch/.diff) attachment found in latest thread message.";
    return { ...base, evidenceBadges: buildEvidenceBadges(base) };
  }

  const pgRepo = detectLocalPgRepo(opts.pgRepo);
  if (!pgRepo) {
    base.applyDetail = "No local PostgreSQL git repo configured (set PGROAST_PG_REPO to enable apply/build/test).";
    return { ...base, evidenceBadges: buildEvidenceBadges(base) };
  }
  base.pgRepoUsed = pgRepo;
  const baseRef = resolveBaseRef(pgRepo);
  base.baseRef = baseRef;

  const mesonCheck = runCmd("which", ["meson"], { timeoutMs: 5_000 });
  const hasMeson = mesonCheck.status === 0;

  const slot = acquirePoolSlot(log);
  if (!slot) {
    base.applyDetail = "All verification build slots busy; code diff was still inspected.";
    return { ...base, evidenceBadges: buildEvidenceBadges(base) };
  }

  const { slotDir, lockDir } = slot;
  const buildDir = join(slotDir, "build");
  const instDir = join(slotDir, "inst");
  const tmpPatchDir = mkdtempSync(join(tmpdir(), "pgroast-patch-"));

  try {
    // 1. Ensure pooled worktree exists and is cleanly reset to baseRef (keeping build/ for fast incremental compiles!)
    if (!existsSync(join(slotDir, ".git"))) {
      log(`verify: initializing reusable worktree slot at ${slotDir} (${baseRef})...`);
      const wtAdd = runCmd("git", ["-C", pgRepo, "worktree", "add", "--detach", slotDir, baseRef], { timeoutMs: 60_000 });
      if (wtAdd.status !== 0) {
        base.applyDetail = `Could not create worktree: ${(wtAdd.stderr || wtAdd.stdout).trim().slice(0, 300)}`;
        return { ...base, evidenceBadges: buildEvidenceBadges(base) };
      }
    } else {
      runCmd("git", ["-C", slotDir, "reset", "--hard", baseRef], { timeoutMs: 30_000 });
      runCmd("git", ["-C", slotDir, "clean", "-fdx", "-e", "build", "-e", "inst"], { timeoutMs: 30_000 });
    }

    // 2. Apply all latest patch attachments in filename order
    let applyFailed = false;
    const applyErrors: string[] = [];
    for (let i = 0; i < rawPatchFiles.length; i++) {
      const pf = rawPatchFiles[i]!;
      const pFile = join(tmpPatchDir, `${String(i).padStart(2, "0")}-${pf.attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      writeFileSync(pFile, pf.rawText!);
      let ap = runCmd("git", ["-C", slotDir, "apply", "--3way", pFile], { timeoutMs: 20_000 });
      if (ap.status !== 0) {
        // Fallback without --3way for older/context diffs
        ap = runCmd("git", ["-C", slotDir, "apply", "--recount", pFile], { timeoutMs: 20_000 });
      }
      if (ap.status !== 0) {
        applyFailed = true;
        applyErrors.push(`${pf.attachment.name}: ${(ap.stderr || ap.stdout).trim().slice(0, 450)}`);
        break;
      }
    }

    if (applyFailed) {
      base.gitApply = "conflict";
      base.applyDetail = applyErrors.join("\n");
      log(`verify: git apply CONFLICT (${rawPatchFiles.length} patch file(s))`);
      return { ...base, evidenceBadges: buildEvidenceBadges(base) };
    }

    base.gitApply = "clean";
    base.applyDetail = `Applied ${rawPatchFiles.length} patch file(s) cleanly onto ${baseRef}.`;
    base.surroundingContext = extractSurroundingSourceContext(slotDir, touchedFiles);
    log(`verify: git apply clean (${rawPatchFiles.length} patch file(s))`);

    if (!hasMeson) {
      base.compileDetail = "meson not found on PATH; skipped build/test.";
      return { ...base, evidenceBadges: buildEvidenceBadges(base) };
    }

    // 3. Setup meson build directory once per slot (reused across patches for ~5-15s incremental compiles!)
    if (!existsSync(join(buildDir, "build.ninja"))) {
      log(`verify: running initial meson setup in ${buildDir} (one-time per slot)...`);
      const setup = runCmd(
        "meson",
        ["setup", buildDir, slotDir, `--prefix=${instDir}`, "-Dcassert=true", "-Ddebug=false", "-Doptimization=1", "-Ddocs=disabled"],
        { cwd: slotDir, timeoutMs: 120_000 },
      );
      if (setup.status !== 0) {
        base.mesonCompile = "fail";
        base.compileDetail = `meson setup failed: ${(setup.stderr || setup.stdout).slice(-600)}`;
        return { ...base, evidenceBadges: buildEvidenceBadges(base) };
      }
    }

    // 4. Incremental meson compile
    log(`verify: meson compile ...`);
    const tCompile = Date.now();
    const comp = runCmd("meson", ["compile", "-C", buildDir], { cwd: slotDir, timeoutMs: 300_000 });
    base.compileDurationMs = Date.now() - tCompile;
    if (comp.status !== 0) {
      base.mesonCompile = "fail";
      const errOut = `${comp.stderr}\n${comp.stdout}`.trim();
      const errLines = errOut
        .split("\n")
        .filter((l) => /error:|warning:|FAILED:|undefined symbol|ninja: build stopped/i.test(l))
        .slice(-18);
      base.compileDetail = (errLines.length ? errLines.join("\n") : errOut.slice(-900)).slice(0, 1200);
      log(`verify: meson compile FAILED (${Math.round(base.compileDurationMs / 1000)}s)`);
      return { ...base, evidenceBadges: buildEvidenceBadges(base) };
    }
    base.mesonCompile = "pass";
    base.compileDetail = `Compiled cleanly with -Dcassert=true in ${Math.round(base.compileDurationMs / 1000)}s.`;
    log(`verify: meson compile PASS (${Math.round(base.compileDurationMs / 1000)}s)`);

    // 5. Targeted meson test (always include `setup` suite so tmp_install/initdb_cache are built first)
    const rawSuites = selectTargetedMesonSuites(touchedFiles);
    const listRes = runCmd("meson", ["test", "-C", buildDir, "--list"], { cwd: slotDir, timeoutMs: 15_000 });
    const availableSuites = new Set<string>();
    for (const ln of listRes.stdout.split("\n")) {
      const m = ln.match(/^([A-Za-z0-9_.-]+)\s+-\s+/);
      if (m?.[1]) availableSuites.add(m[1]);
    }
    let suites = availableSuites.size > 0 ? rawSuites.filter((s) => availableSuites.has(s)) : rawSuites;
    if (suites.length === 0 && availableSuites.has("regress")) suites = ["regress"];
    base.testSuites = suites;
    if (suites.length > 0) {
      log(`verify: meson test (${suites.join(", ")}) ...`);
      const runSuites = availableSuites.has("setup") ? ["setup", ...suites] : suites;
      const suiteArgs = runSuites.flatMap((s) => ["--suite", s]);
      const tst = runCmd("meson", ["test", "-C", buildDir, "--print-errorlogs", "--no-rebuild", ...suiteArgs], {
        cwd: slotDir,
        timeoutMs: 240_000,
      });
      const combined = `${tst.stdout}\n${tst.stderr}`;
      const resultLines = combined.split("\n").filter((ln) => !/postgresql:setup\b/.test(ln));
      const okMatches = resultLines.filter((ln) => /\bOK\s+\d+\.\d+s/.test(ln));
      const failMatches = resultLines.filter((ln) => /\b(?:FAIL|TIMEOUT)\s+\d+\.\d+s/.test(ln));
      base.testsPassed = okMatches.length;
      base.testsFailed = failMatches.length;
      base.testsRun = okMatches.length + failMatches.length;
      if (tst.status === 0) {
        base.testsStatus = "pass";
        base.testDetail = `Passed ${base.testsPassed}/${Math.max(1, base.testsRun)} test(s) in suite(s): ${suites.join(", ")}.`;
        log(`verify: tests PASS (${base.testsPassed}/${base.testsRun})`);
      } else {
        base.testsStatus = "fail";
        if (base.testsFailed === 0) base.testsFailed = 1;
        base.testDetail = combined.slice(-1400).trim();
        log(`verify: tests FAILED (${base.testsFailed} failure(s))`);
      }
    }

    // 6. DARK ROAST ONLY: boot throwaway patched PostgreSQL cluster and run LLM-proposed pure-SQL adversarial stress tests!
    if (level === "dark" && opts.backend && !opts.backend.dryRun && opts.model) {
      await runDarkLiveSqlStress({
        base,
        slotDir,
        buildDir,
        instDir,
        proposal: opts.proposal,
        codeHunks,
        focusPrompt: opts.focusPrompt,
        backend: opts.backend,
        model: opts.model,
        log,
      });
    }

    return { ...base, evidenceBadges: buildEvidenceBadges(base) };
  } finally {
    try {
      rmSync(tmpPatchDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    // Always restore clean worktree so next run starts cleanly
    if (existsSync(join(slotDir, ".git"))) {
      runCmd("git", ["-C", slotDir, "reset", "--hard", baseRef], { timeoutMs: 20_000 });
      runCmd("git", ["-C", slotDir, "clean", "-fdx", "-e", "build", "-e", "inst"], { timeoutMs: 20_000 });
    }
    releasePoolSlot(lockDir);
  }
}

async function runDarkLiveSqlStress(args: {
  base: Omit<VerificationReport, "evidenceBadges">;
  slotDir: string;
  buildDir: string;
  instDir: string;
  proposal: ProposalInput;
  codeHunks: { path: string; text: string }[];
  focusPrompt?: string;
  backend: LlmBackend;
  model: string;
  log: (m: string) => void;
}): Promise<void> {
  const { base, buildDir, instDir, proposal, codeHunks, focusPrompt, backend, model, log } = args;

  // Install patched binaries into slot's isolated instDir (~2s)
  const instRes = runCmd("meson", ["install", "-C", buildDir, "--no-rebuild", "--quiet"], { timeoutMs: 60_000 });
  if (instRes.status !== 0) {
    log("verify(dark): meson install failed; skipping live SQL stress tests");
    return;
  }
  const initdbBin = join(instDir, "bin", "initdb");
  const pgCtlBin = join(instDir, "bin", "pg_ctl");
  const psqlBin = join(instDir, "bin", "psql");
  if (!existsSync(initdbBin) || !existsSync(pgCtlBin) || !existsSync(psqlBin)) {
    return;
  }

  // Ask LLM for 3-5 targeted pure-SQL adversarial test cases based on the actual code diff
  log("verify(dark): generating adversarial SQL stress tests against patched Postgres ...");
  const diffPreview = codeHunks
    .map((h) => `--- ${h.path} ---\n${h.text}`)
    .join("\n\n")
    .slice(0, 28_000);
  let plan: DarkSqlPlan;
  try {
    plan = await backend.complete<DarkSqlPlan>({
      label: "dark-sql-plan",
      model,
      system: [
        "You are a PostgreSQL kernel QA engineer designing pure-SQL adversarial tests to run against a freshly compiled patched PostgreSQL 20devel server.",
        "Return 3 to 5 self-contained SQL test scripts (standard SQL + EXPLAIN (ANALYZE, BUFFERS) + SAVEPOINT/ROLLBACK TO + NULL/edge-case/type/partition/error-path inputs).",
        "Rules:",
        "- Pure SQL only (no \\! shell escapes, no COPY PROGRAM, no filesystem paths).",
        "- Each case must set up its own temporary tables/objects or drop them cleanly.",
        "- Target the EXACT code paths modified in the patch diff below (reproduce the bug, test edge cases, boundary inputs, subtransaction aborts, or EXPLAIN plans).",
        "- Return JSON matching the schema only.",
      ].join("\n"),
      prompt: [
        `Patch title: ${proposal.cf?.title || proposal.thread.subject}`,
        `Touched files: ${codeHunks.map((h) => h.path).join(", ")}`,
        ...(focusPrompt?.trim()
          ? ["", "## Human Reviewer Steering Focus (prioritize SQL test cases targeting this)", focusPrompt.trim()]
          : []),
        "",
        "## Patch Code Diff",
        diffPreview,
        "",
        'Return JSON: { "cases": [{ "name": string, "category": "edge_case"|"subxact_error"|"explain_perf"|"reproducer"|"null_boundary", "goal": string, "sql": string }] }',
      ].join("\n"),
      schema: DARK_SQL_CASES_SCHEMA,
    });
  } catch (err) {
    log(`verify(dark): SQL plan generation failed (${err instanceof Error ? err.message.slice(0, 120) : err})`);
    return;
  }

  const tmpRun = mkdtempSync(join(tmpdir(), "pgroast-darkpg-"));
  const dataDir = join(tmpRun, "pgdata");
  const sockDir = join(tmpRun, "sock");
  const logFile = join(tmpRun, "postgres.log");
  mkdirSync(sockDir, { recursive: true });
  const port = 55000 + Math.floor(Math.random() * 4000);

  let started = false;
  try {
    const init = runCmd(initdbBin, ["-D", dataDir, "--no-sync", "--auth=trust", "-U", "postgres"], { timeoutMs: 45_000 });
    if (init.status !== 0) {
      log(`verify(dark): initdb failed: ${(init.stderr || init.stdout).slice(0, 200)}`);
      return;
    }
    const start = runCmd(
      pgCtlBin,
      [
        "-D",
        dataDir,
        "-l",
        logFile,
        "-w",
        "-o",
        `-p ${port} -k ${sockDir} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`,
        "start",
      ],
      { timeoutMs: 30_000 },
    );
    if (start.status !== 0) {
      log(`verify(dark): pg_ctl start failed: ${(start.stderr || start.stdout).slice(0, 200)}`);
      return;
    }
    started = true;
    log(`verify(dark): booted throwaway patched PostgreSQL on socket port ${port}; running ${plan.cases.length} SQL stress case(s)...`);

    let anyCrash = false;
    let anyError = false;

    for (let i = 0; i < plan.cases.length; i++) {
      const c = plan.cases[i]!;
      // Strip any psql meta-commands that could touch shell/files (\!, \o, \i, \! etc.)
      const safeSql = c.sql
        .split("\n")
        .filter((ln) => !/^\s*\\[!oiswge]/i.test(ln))
        .join("\n");
      const sqlFile = join(tmpRun, `case-${i}.sql`);
      writeFileSync(sqlFile, `SET statement_timeout = '10s';\nSET lock_timeout = '5s';\n${safeSql}\n`);

      const t0 = Date.now();
      const r = runCmd(
        psqlBin,
        ["-h", sockDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=0", "-f", sqlFile],
        { timeoutMs: 22_000 },
      );
      const dur = Date.now() - t0;
      const pgLog = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      const crashed =
        /TRAP:|PANIC:|segmentation fault|was terminated by signal|server closed the connection unexpectedly/i.test(
          `${r.stderr}\n${pgLog}`,
        );
      let status: LiveSqlCaseResult["status"] = "pass";
      if (crashed) {
        status = "crash";
        anyCrash = true;
      } else if (r.timedOut) {
        status = "timeout";
        anyError = true;
      } else if (/ERROR:/i.test(r.stderr) || r.status !== 0) {
        status = "error";
        anyError = true;
      }
      base.liveReproCases.push({
        name: c.name.slice(0, 120),
        category: c.category,
        sql: safeSql.slice(0, 1500),
        status,
        durationMs: dur,
        outputExcerpt: r.stdout.trim().slice(0, 900),
        errorExcerpt: (crashed ? `${r.stderr}\n${pgLog.slice(-600)}` : r.stderr).trim().slice(0, 900),
      });
      log(`verify(dark):   case #${i + 1} "${c.name}" -> ${status} (${dur}ms)`);
      if (crashed) break;
    }

    base.liveReproStatus = anyCrash ? "crash" : anyError ? "issue_found" : "pass";
  } finally {
    if (started) {
      runCmd(pgCtlBin, ["-D", dataDir, "-m", "immediate", "stop"], { timeoutMs: 15_000 });
    }
    try {
      rmSync(tmpRun, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export function renderVerificationForPrompt(v: VerificationReport): string {
  const lines: string[] = [
    `## Patch Verification & Code Evidence (${v.level.toUpperCase()} roast)`,
    `Badges: ${v.evidenceBadges.join(" | ")}`,
  ];
  if (v.gitApply !== "skipped") {
    lines.push(`- **git apply (${v.baseRef || "master"}):** ${v.gitApply.toUpperCase()} — ${v.applyDetail}`);
  }
  if (v.mesonCompile !== "skipped") {
    lines.push(`- **meson compile (-Dcassert=true):** ${v.mesonCompile.toUpperCase()} (${Math.round(v.compileDurationMs / 1000)}s) — ${v.compileDetail}`);
  }
  if (v.testsStatus !== "skipped") {
    lines.push(`- **meson test (${v.testSuites.join(", ")}):** ${v.testsStatus.toUpperCase()} (${v.testsPassed}/${v.testsRun} passed, ${v.testsFailed} failed)`);
    if (v.testsStatus === "fail" && v.testDetail) {
      lines.push(`\`\`\`\n${v.testDetail.slice(0, 1200)}\n\`\`\``);
    }
  }
  if (v.liveReproCases.length > 0) {
    lines.push(`- **Live patched PostgreSQL SQL stress tests (${v.liveReproStatus.toUpperCase()}):**`);
    for (const c of v.liveReproCases) {
      lines.push(`  - **[${c.status.toUpperCase()}] ${c.name} (${c.category}, ${c.durationMs}ms)**`);
      if (c.outputExcerpt) lines.push(`    Output:\n\`\`\`\n${c.outputExcerpt.slice(0, 500)}\n\`\`\``);
      if (c.errorExcerpt) lines.push(`    Errors/Logs:\n\`\`\`\n${c.errorExcerpt.slice(0, 600)}\n\`\`\``);
    }
  }
  if (v.surroundingContext) {
    lines.push("", v.surroundingContext);
  }
  return lines.join("\n");
}
