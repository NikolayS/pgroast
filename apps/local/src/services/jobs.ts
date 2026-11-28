import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildChildEnv, expandHome, LOGS_DIR } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import { nowIso } from "../db.ts";
import type { AppSettings, JobKind, JobRecord, RoastJson } from "../types.ts";
import { scanPgsqlBugs } from "./bugs.ts";
import { detectAvailableAiBackends } from "./health.ts";

function resolveBunBin(): string {
  if (process.execPath && existsSync(process.execPath) && /bun/i.test(process.execPath)) {
    return process.execPath;
  }
  const homeBun = join(homedir(), ".bun", "bin", "bun");
  return existsSync(homeBun) ? homeBun : "bun";
}

function resolveEffectiveBackend(
  requested: string | undefined,
  settings: AppSettings,
): "claude" | "agy" | "codex" | "dual" {
  const raw = (requested || settings.defaultBackend || "auto").toLowerCase();
  if (raw === "claude" || raw === "agy" || raw === "codex" || raw === "dual") return raw;
  const ai = detectAvailableAiBackends(settings);
  if (ai.recommendedDefault !== "none") return ai.recommendedDefault;
  return "claude";
}

type SseListener = (event: string, data: string) => void;

let ephemeralPortCounter = 55432;
function allocateEphemeralPgPort(): number {
  ephemeralPortCounter = ephemeralPortCounter >= 59900 ? 55432 : ephemeralPortCounter + 1;
  return ephemeralPortCounter;
}

function makeJobId(kind: JobKind): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${kind}-${ts}-${rand}`;
}

const SAFETY_BRIEF_LINES = `
HARD SAFETY RULES (MANDATORY):
- NEVER kill tmux sessions you did not create (no tmux kill-server, killall tmux, pkill tmux).
- NEVER kill processes you did not start (no pkill postgres, killall postgres); stop ONLY servers started from your own worktree with pg_ctl stop -D <own datadir>.
- NEVER rm -rf outside your own isolated worktree directory.
- Use ONLY your assigned worktree and ephemeral PGPORT.
- Never publish, send email, or push to GitHub. Produce local artifacts only.
`.trim();

export class JobRunner {
  private readonly db: AppDatabase;
  private readonly listeners = new Map<string, Set<SseListener>>();
  private readonly activeProcs = new Map<string, { pid: number; pgid: number }>();

  constructor(db: AppDatabase) {
    this.db = db;
    mkdirSync(LOGS_DIR, { recursive: true });
  }

  subscribe(jobId: string, listener: SseListener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);

    // Replay existing log file immediately so late subscribers see full output
    void this.db.getJob(jobId).then((job) => {
      if (job?.log_path && existsSync(job.log_path)) {
        try {
          const content = readFileSync(job.log_path, "utf8");
          if (content) {
            listener("log", content);
          }
        } catch {
          // Ignore read error
        }
      }
      if (job && (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")) {
        listener("done", JSON.stringify({ status: job.status, exit_code: job.exit_code, error: job.error }));
      }
    });

    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(jobId);
      }
    };
  }

  private emit(jobId: string, event: string, data: string): void {
    const set = this.listeners.get(jobId);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(event, data);
      } catch {
        // Ignore listener error
      }
    }
  }

  private appendLog(jobId: string, logPath: string, chunk: string): void {
    try {
      appendFileSync(logPath, chunk, "utf8");
    } catch {
      // Ignore file error
    }
    this.emit(jobId, "log", chunk);
  }

  async readLog(jobId: string): Promise<string> {
    const job = await this.db.getJob(jobId);
    if (!job?.log_path || !existsSync(job.log_path)) return "";
    return readFileSync(job.log_path, "utf8");
  }

  async cancelJob(jobId: string): Promise<{ cancelled: boolean; message: string }> {
    const job = await this.db.getJob(jobId);
    if (!job) return { cancelled: false, message: "Job not found" };

    const active = this.activeProcs.get(jobId);
    if (active) {
      // Kill ONLY this job's own process group (never pkill or killall!)
      try {
        process.kill(-active.pgid, "SIGTERM");
      } catch {
        try {
          process.kill(active.pid, "SIGTERM");
        } catch {
          // Process may have already exited
        }
      }
      const targetPgid = active.pgid;
      const targetPid = active.pid;
      setTimeout(() => {
        try {
          process.kill(-targetPgid, 0);
          process.kill(-targetPgid, "SIGKILL");
        } catch {
          try {
            process.kill(targetPid, 0);
            process.kill(targetPid, "SIGKILL");
          } catch {
            // Already exited
          }
        }
      }, 2500);

      this.appendLog(jobId, job.log_path, `\n[pgroast-app] Sent SIGTERM to job process group -${active.pgid}\n`);
      await this.db.updateJob(jobId, {
        status: "cancelled",
        finished_at: nowIso(),
        error: "Cancelled by user",
      });
      this.emit(jobId, "done", JSON.stringify({ status: "cancelled", exit_code: null, error: "Cancelled by user" }));
      this.activeProcs.delete(jobId);
      return { cancelled: true, message: `Cancelled job ${jobId} (PGID ${active.pgid})` };
    }

    if (job.status === "queued" || job.status === "running") {
      await this.db.updateJob(jobId, { status: "cancelled", finished_at: nowIso(), error: "Cancelled by user" });
      this.emit(jobId, "done", JSON.stringify({ status: "cancelled", exit_code: null }));
      return { cancelled: true, message: `Marked job ${jobId} cancelled` };
    }
    return { cancelled: false, message: `Job ${jobId} is already ${job.status}` };
  }

  async cleanupWorktree(worktreePath: string): Promise<{ removed: boolean; message: string }> {
    const settings = await this.db.getSettings();
    const managedRoot = resolve(expandHome(settings.worktreesRoot));
    const target = resolve(expandHome(worktreePath));

    if (!target.startsWith(managedRoot + "/") || target === managedRoot) {
      throw new Error(`Refusing to remove "${target}": not inside managed worktreesRoot (${managedRoot}).`);
    }
    if (!existsSync(target)) {
      return { removed: false, message: "Worktree path does not exist." };
    }

    const pgRepo = expandHome(settings.postgresRepo);
    if (existsSync(join(pgRepo, ".git"))) {
      spawnSync("git", ["-C", pgRepo, "worktree", "remove", "--force", target], {
        encoding: "utf8",
        env: buildChildEnv(settings),
        timeout: 30_000,
      });
    }
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    await this.db.logAudit("worktree_cleanup", target, { managedRoot });
    return { removed: true, message: `Removed managed worktree ${target}` };
  }

  private spawnShellJob(
    job: JobRecord,
    cmd: string,
    args: string[],
    opts: {
      cwd: string;
      env: Record<string, string>;
      onSuccess?: () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
    },
  ): void {
    const displayCmd = `${cmd} ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`;
    void this.db.updateJob(job.id, {
      status: "running",
      command: displayCmd,
      started_at: nowIso(),
    });
    this.appendLog(job.id, job.log_path, `[pgroast-app] Starting job ${job.id} (${job.kind})\n[pgroast-app] cwd: ${opts.cwd}\n[pgroast-app] cmd: ${displayCmd}\n\n`);

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pid = child.pid ?? 0;
    if (pid > 0) {
      this.activeProcs.set(job.id, { pid, pgid: pid });
      void this.db.updateJob(job.id, { pid, pgid: pid });
    }

    child.stdout?.on("data", (buf: Buffer) => {
      this.appendLog(job.id, job.log_path, buf.toString("utf8"));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      this.appendLog(job.id, job.log_path, buf.toString("utf8"));
    });

    child.on("error", (err) => {
      this.activeProcs.delete(job.id);
      const msg = err instanceof Error ? err.message : String(err);
      this.appendLog(job.id, job.log_path, `\n[pgroast-app] Spawn error: ${msg}\n`);
      void this.db.updateJob(job.id, {
        status: "failed",
        exit_code: -1,
        error: msg,
        finished_at: nowIso(),
      });
      this.emit(job.id, "done", JSON.stringify({ status: "failed", exit_code: -1, error: msg }));
    });

    child.on("close", async (code) => {
      this.activeProcs.delete(job.id);
      const latest = await this.db.getJob(job.id);
      if (latest?.status === "cancelled") {
        return;
      }

      if (code === 0) {
        let resultPayload: Record<string, unknown> = {};
        if (opts.onSuccess) {
          try {
            const extra = await opts.onSuccess();
            if (extra) resultPayload = extra;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.appendLog(job.id, job.log_path, `\n[pgroast-app] Post-hook warning: ${msg}\n`);
            resultPayload.postHookWarning = msg;
          }
        }
        this.appendLog(job.id, job.log_path, `\n[pgroast-app] Completed with exit code 0.\n`);
        await this.db.updateJob(job.id, {
          status: "succeeded",
          exit_code: 0,
          result_json: JSON.stringify(resultPayload),
          finished_at: nowIso(),
        });
        this.emit(job.id, "done", JSON.stringify({ status: "succeeded", exit_code: 0, result: resultPayload }));
      } else {
        const errMsg = `Exited with code ${code ?? "null"}`;
        this.appendLog(job.id, job.log_path, `\n[pgroast-app] Failed: ${errMsg}\n`);
        await this.db.updateJob(job.id, {
          status: "failed",
          exit_code: code ?? 1,
          error: errMsg,
          finished_at: nowIso(),
        });
        this.emit(job.id, "done", JSON.stringify({ status: "failed", exit_code: code ?? 1, error: errMsg }));
      }
    });
  }

  // ---------------- Job Launchers ----------------

  async startRoastJob(params: {
    cfId?: number;
    target?: string;
    backend?: "auto" | "claude" | "agy" | "codex" | "dual";
    roastLevel?: "light" | "medium" | "dark";
    roastFlavour?: string;
    focusPrompt?: string;
    claudeModel?: string;
    effort?: string;
    agyModel?: string;
    codexModel?: string;
    publish?: boolean;
    rounds?: number;
    selfMode?: boolean;
    dryRun?: boolean;
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const pgroastRepo = expandHome(settings.pgroastRepo);
    const target = params.target || (params.cfId ? String(params.cfId) : "");
    if (!target) throw new Error("Either cfId or target (URL / Message-ID) is required.");

    const backend = resolveEffectiveBackend(params.backend, settings);
    const roastLevel = params.roastLevel || "medium";
    const roastFlavour = (params.roastFlavour || "default").trim() || "default";
    const rounds = Math.min(Math.max(params.rounds ?? 0, 0), 3);
    const id = makeJobId("roast");
    const outDir = join(LOGS_DIR, `out-${id}`);
    mkdirSync(outDir, { recursive: true });
    const logPath = join(LOGS_DIR, `${id}.log`);

    const modelLabel =
      backend === "agy"
        ? params.agyModel || settings.defaultAgyModel
        : backend === "dual"
          ? `${params.claudeModel || settings.defaultClaudeModel} + ${params.agyModel || settings.defaultAgyModel}`
          : params.claudeModel || settings.defaultClaudeModel;

    const profileTag = roastLevel !== "medium" || roastFlavour !== "default" ? ` · ${roastLevel}/${roastFlavour}` : "";
    const job = await this.db.createJob({
      id,
      kind: "roast",
      cf_id: params.cfId ?? null,
      title: `Roast ${params.cfId ? `CF ${params.cfId}` : target} (${backend}${profileTag})`,
      model: modelLabel,
      backend,
      log_path: logPath,
    });

    const shouldPublish = params.publish !== false && !params.selfMode && !params.dryRun;
    const cliArgs = ["run", "src/cli.ts", target, "--out", outDir, "--backend", backend, "--roast-level", roastLevel, "--flavour", roastFlavour];
    const focusPrompt = (params.focusPrompt || "").trim();
    if (focusPrompt) cliArgs.push("--focus", focusPrompt);
    if (rounds > 0) cliArgs.push("--rounds", String(rounds));
    if (params.selfMode) cliArgs.push("--self");
    if (params.dryRun) cliArgs.push("--dry-run");
    if (shouldPublish) {
      cliArgs.push("--publish");
      if (settings.publicHubUrl) cliArgs.push("--hub", settings.publicHubUrl);
    }

    const extraEnv: Record<string, string> = {};
    if (shouldPublish) {
      const hubTok = await this.db.getHubTokenDecrypted();
      if (hubTok) extraEnv.PGROAST_PUBLISH_TOKEN = hubTok;
      if (settings.publicHubUrl) extraEnv.PGROAST_PUBLIC_HUB_URL = settings.publicHubUrl;
    }
    if (params.claudeModel) {
      extraEnv.PGROAST_ROASTER_MODEL = params.claudeModel;
      extraEnv.PGROAST_CRITIC_MODEL = params.claudeModel;
    }
    if (params.effort) {
      extraEnv.PGROAST_CLAUDE_EFFORT = params.effort.trim().toLowerCase();
      extraEnv.PGROAST_CODEX_EFFORT = params.effort.trim().toLowerCase();
    }
    if (params.agyModel) {
      extraEnv.PGROAST_AGY_MODEL = params.agyModel;
    }
    if (params.codexModel) {
      extraEnv.PGROAST_CODEX_MODEL = params.codexModel;
    }

    const env = buildChildEnv(settings, { stripApiKeys: true, extra: extraEnv });
    const bunBin = resolveBunBin();

    this.spawnShellJob(job, bunBin, cliArgs, {
      cwd: existsSync(pgroastRepo) ? pgroastRepo : process.cwd(),
      env,
      onSuccess: async () => {
        const jsonPath = join(outDir, "roast.json");
        if (existsSync(jsonPath)) {
          const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as RoastJson;
          const md = existsSync(join(outDir, "roast.md")) ? readFileSync(join(outDir, "roast.md"), "utf8") : "";
          const summary = existsSync(join(outDir, "roast-summary.txt"))
            ? readFileSync(join(outDir, "roast-summary.txt"), "utf8")
            : "";
          const resolvedCfId = params.cfId || parsed.input?.cf?.id;
          // Never overwrite real roast results with dry-run placeholder verdicts.
          if (resolvedCfId && !params.dryRun && parsed.backend !== "dry-run") {
            await this.db.ingestRoastResult(resolvedCfId, parsed, md, summary, { recordRun: true, rounds });
          }
          return { outDir, verdict: parsed.verdict, cfId: resolvedCfId ?? null };
        }
        return { outDir };
      },
    });

    return job;
  }

  async startPushbackJob(params: {
    cfId: number;
    backend?: "claude" | "agy" | "codex";
    dryRun?: boolean;
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const pgroastRepo = expandHome(settings.pgroastRepo);
    const backend = params.backend || "claude";
    const id = makeJobId("pushback");
    const outDir = join(LOGS_DIR, `out-${id}`);
    mkdirSync(outDir, { recursive: true });
    const logPath = join(LOGS_DIR, `${id}.log`);

    const job = await this.db.createJob({
      id,
      kind: "pushback",
      cf_id: params.cfId,
      title: `Pushback analysis CF ${params.cfId} (${backend})`,
      backend,
      log_path: logPath,
    });

    const args = ["run", "src/cli.ts", "pushback", String(params.cfId), "--out", outDir, "--backend", backend];
    if (params.dryRun) args.push("--dry-run");
    const bunBin = resolveBunBin();

    this.spawnShellJob(job, bunBin, args, {
      cwd: existsSync(pgroastRepo) ? pgroastRepo : process.cwd(),
      env: buildChildEnv(settings, { stripApiKeys: true }),
      onSuccess: async () => {
        const pbJsonPath = join(outDir, "pushback.json");
        const pbMdPath = join(outDir, "pushback.md");
        const pbJson = existsSync(pbJsonPath) ? readFileSync(pbJsonPath, "utf8") : "";
        const pbMd = existsSync(pbMdPath) ? readFileSync(pbMdPath, "utf8") : "";
        if (pbJson || pbMd) {
          await this.db.savePushbackResult(params.cfId, pbJson, pbMd);
        }
        return { outDir, saved: Boolean(pbJson || pbMd) };
      },
    });

    return job;
  }

  async startBuildTestJob(params: {
    cfId: number;
    workItemId?: number;
    targetBranch?: string;
    suites?: string[];
    patchSource?: "cfbot" | "none";
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const pgRepo = expandHome(settings.postgresRepo);
    const wtRoot = expandHome(settings.worktreesRoot);
    mkdirSync(wtRoot, { recursive: true });

    const id = makeJobId("build_test");
    const ts = Date.now().toString(36);
    const worktreePath = join(wtRoot, `cf-${params.cfId}-${ts}`);
    const logPath = join(LOGS_DIR, `${id}.log`);
    const rawBranch = (params.targetBranch || "master").trim();
    if (!/^[A-Za-z0-9._/-]+$/.test(rawBranch) || rawBranch.startsWith("-") || rawBranch.includes("..")) {
      throw new Error(`Invalid targetBranch "${rawBranch}": only alphanumeric, '.', '_', '/', '-' allowed.`);
    }
    const branch = rawBranch;
    const suites = params.suites?.length ? params.suites : ["regress"];
    const pgPort = allocateEphemeralPgPort();

    const job = await this.db.createJob({
      id,
      kind: "build_test",
      cf_id: params.cfId,
      title: `Build & Test CF ${params.cfId} (${suites.join(", ")})`,
      backend: "meson",
      worktree_path: worktreePath,
      log_path: logPath,
    });

    const scriptPath = join(LOGS_DIR, `${id}.sh`);
    const suiteCommands = suites
      .map((s) => {
        const safe = s.replace(/[^a-zA-Z0-9_:/.-]/g, "");
        return `echo "=== Running suite: ${safe} ==="\nPGPORT=${pgPort} meson test -C "${worktreePath}/build" --print-errorlogs ${safe}`;
      })
      .join("\n");

    const applyPatchBlock =
      params.patchSource === "none"
        ? `echo "Skipping patch apply (baseline build)"`
        : `
echo "=== Fetching cfbot patch branch cf/${params.cfId} ==="
if git -C "${worktreePath}" fetch https://github.com/postgresql-cfbot/postgresql.git "refs/heads/cf/${params.cfId}:refs/remotes/cfbot/cf-${params.cfId}"; then
  BASE_SHA=$(git -C "${worktreePath}" rev-parse HEAD)
  echo "UPSTREAM_BASE_SHA=\${BASE_SHA}"
  git -C "${worktreePath}" format-patch -o "${worktreePath}/patches" "\${BASE_SHA}..refs/remotes/cfbot/cf-${params.cfId}" || true
  if ls "${worktreePath}/patches"/*.patch >/dev/null 2>&1; then
    shasum -a 256 "${worktreePath}/patches"/*.patch
    git -C "${worktreePath}" am "${worktreePath}/patches"/*.patch || (git -C "${worktreePath}" am --abort; git -C "${worktreePath}" checkout "refs/remotes/cfbot/cf-${params.cfId}")
  else
    git -C "${worktreePath}" checkout "refs/remotes/cfbot/cf-${params.cfId}"
  fi
else
  echo "Warning: cfbot branch cf/${params.cfId} unavailable; testing base branch."
fi
`;

    const script = `#!/usr/bin/env bash
set -euo pipefail
echo "=== Creating isolated worktree at ${worktreePath} ==="
if [ ! -d "${pgRepo}/.git" ]; then
  echo "ERROR: PostgreSQL repo not found at ${pgRepo}" >&2
  exit 1
fi
git -C "${pgRepo}" fetch upstream "${branch}" || git -C "${pgRepo}" fetch origin "${branch}" || true
BASE_REF="upstream/${branch}"
if ! git -C "${pgRepo}" rev-parse --verify "\${BASE_REF}" >/dev/null 2>&1; then
  BASE_REF="HEAD"
fi
git -C "${pgRepo}" worktree add --detach "${worktreePath}" "\${BASE_REF}"
BASE_SHA=$(git -C "${worktreePath}" rev-parse HEAD)
echo "BASE_COMMIT=\${BASE_SHA}"
${applyPatchBlock}
echo "=== Checking whitespace (git diff --check) ==="
git -C "${worktreePath}" diff --check || true
echo "=== Configuring meson assertion build ==="
meson setup "${worktreePath}/build" "${worktreePath}" \\
  --prefix="${worktreePath}/inst" \\
  --buildtype=debug \\
  -Dcassert=true \\
  -Dtap_tests=enabled \\
  -Dinjection_points=true
echo "=== Compiling with ninja ==="
ninja -C "${worktreePath}/build"
ninja -C "${worktreePath}/build" install
${suiteCommands}
echo "=== Build & test complete (PGPORT=${pgPort}) ==="
`;

    writeFileSync(scriptPath, script, { mode: 0o700 });

    if (params.workItemId) {
      await this.db.updateWorkItem(params.workItemId, {
        status: "testing",
        worktree_path: worktreePath,
        suites_run_json: JSON.stringify(suites),
      });
    }

    this.spawnShellJob(job, "bash", [scriptPath], {
      cwd: wtRoot,
      env: buildChildEnv(settings, { extra: { PGPORT: String(pgPort) } }),
      onSuccess: async () => {
        const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
        const shaMatch = logText.match(/BASE_COMMIT=([0-9a-f]{40})/);
        if (params.workItemId) {
          await this.db.updateWorkItem(params.workItemId, {
            status: "verified",
            upstream_base_sha: shaMatch?.[1] || "",
            worktree_path: worktreePath,
            suites_run_json: JSON.stringify(suites),
          });
        }
        return { worktreePath, baseSha: shaMatch?.[1] || "", suites, pgPort };
      },
    });

    return job;
  }

  async startAiReviewJob(params: {
    cfId?: number;
    workItemId?: number;
    worktreePath?: string;
    backend: "claude" | "agy" | "codex";
    model?: string;
    focusPrompt?: string;
    blindVerify?: boolean;
    previousBackend?: "claude" | "agy" | "codex";
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const isBlind = Boolean(params.blindVerify);
    const kind: JobKind = isBlind ? "blind_verify" : "ai_review";

    // Cross-family default for blind verification gate!
    let backend = params.backend;
    if (isBlind && params.previousBackend) {
      backend = params.previousBackend === "claude" ? "codex" : "claude";
    }

    const model =
      params.model ||
      (backend === "agy"
        ? settings.defaultAgyModel || ""
        : backend === "codex"
          ? "codex-default"
          : settings.defaultClaudeModel || "opus");

    const id = makeJobId(kind);
    const logPath = join(LOGS_DIR, `${id}.log`);
    const workItem = params.workItemId ? await this.db.getWorkItem(params.workItemId) : null;
    const entry = params.cfId ? await this.db.getEntry(params.cfId) : null;

    let cwd = expandHome(params.worktreePath || workItem?.worktree_path || settings.postgresRepo);
    if (!existsSync(cwd)) {
      cwd = expandHome(settings.pgroastRepo);
    }
    if (!existsSync(cwd)) {
      cwd = process.cwd();
    }

    const evidenceOutPath = join(LOGS_DIR, `${id}-evidence.md`);
    const brief = isBlind
      ? [
          `You are an independent veteran PostgreSQL committer executing a BLIND VERIFICATION PASS for ${entry ? `CF ${entry.cf_id}: ${entry.title}` : `Work Item #${params.workItemId ?? ""}`}.`,
          "Follow the Full Review Gate:",
          "- Independently verify every runnable SQL/isolation/TAP reproducer from a clean state.",
          "- Verify baseline behavior vs patched behavior on the exact claimed upstream base.",
          "- Audit surrounding PostgreSQL C code for concurrency, locking, subtransaction/error cleanup, privilege, and backbranch issues.",
          "- Check any draft message for plain-text 72-column etiquette and public-confidentiality rules.",
          `- Write your structured Evidence Record to ${evidenceOutPath} and summarize your verdict.`,
          params.focusPrompt ? `Additional focus:\n${params.focusPrompt}` : "",
          SAFETY_BRIEF_LINES,
        ]
          .filter(Boolean)
          .join("\n\n")
      : [
          `You are running an adversarial PostgreSQL correctness investigation for ${entry ? `CF ${entry.cf_id}: ${entry.title}` : `Work Item #${params.workItemId ?? ""}`}.`,
          "- Read whole affected functions, callers, locks, memory contexts, and error paths.",
          "- Design falsifiable SQL, isolation, or TAP tests targeting real edge cases (savepoints, concurrent DDL, crash/recovery, standby, NULLs, permissions).",
          "- Run tests against the isolated assertion build in this worktree and record exact commands, commits, and decisive output.",
          `- Write a candidate Evidence Record to ${evidenceOutPath}.`,
          params.focusPrompt ? `Specific focus:\n${params.focusPrompt}` : "",
          SAFETY_BRIEF_LINES,
        ]
          .filter(Boolean)
          .join("\n\n");

    const job = await this.db.createJob({
      id,
      kind,
      cf_id: params.cfId ?? workItem?.cf_id ?? null,
      title: `${isBlind ? "Blind Verify" : "AI Review"} ${params.cfId ? `CF ${params.cfId}` : ""} (${backend}: ${model})`.trim(),
      model,
      backend,
      worktree_path: cwd,
      log_path: logPath,
    });

    const env = buildChildEnv(settings, { stripApiKeys: true });
    let cmd: string;
    let args: string[];

    if (backend === "agy") {
      cmd = "agy";
      args = [...(model ? ["--model", model] : []), "--output-format", "json", "-p", brief];
    } else if (backend === "codex") {
      cmd = "codex";
      args = ["exec", "--full-auto", brief];
    } else {
      cmd = "claude";
      args = ["--dangerously-skip-permissions", "--model", model, "-p", brief];
    }

    this.spawnShellJob(job, cmd, args, {
      cwd,
      env,
      onSuccess: async () => {
        if (existsSync(evidenceOutPath) && params.workItemId) {
          const ev = readFileSync(evidenceOutPath, "utf8");
          const current = await this.db.getWorkItem(params.workItemId);
          const merged = current?.evidence_md
            ? `${current.evidence_md}\n\n---\n\n${ev}`
            : ev;
          await this.db.updateWorkItem(params.workItemId, {
            evidence_md: merged,
            status: isBlind ? "verified" : "testing",
          });
        }
        return { evidenceOutPath, backend, model, isBlind };
      },
    });

    return job;
  }

  async startHetznerJob(params: {
    cfId?: number;
    workItemId?: number;
    profile: "asan" | "wal_consistency" | "tap_matrix" | "custom";
    customCommand?: string;
    branchOrRef?: string;
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const host = settings.hetznerSshHost.trim();
    if (!host) {
      throw new Error("Hetzner SSH host is not configured. Set hetznerSshHost in Settings first.");
    }
    if (!/^[a-zA-Z0-9._@-]+$/.test(host)) {
      throw new Error(`Invalid Hetzner SSH host format: "${host}"`);
    }

    const remoteRepo = settings.hetznerRemoteRepo.trim() || "~/postgres";
    if (!/^[~A-Za-z0-9._/-]+$/.test(remoteRepo) || remoteRepo.includes("..")) {
      throw new Error(`Invalid Hetzner remote repo path: "${remoteRepo}"`);
    }
    const quotedRemoteRepo = remoteRepo.startsWith("~/")
      ? `"$HOME/${remoteRepo.slice(2)}"`
      : `'${remoteRepo}'`;
    const id = makeJobId("hetzner_run");
    const logPath = join(LOGS_DIR, `${id}.log`);

    const remoteCmd =
      params.profile === "custom" && params.customCommand?.trim()
        ? params.customCommand.trim()
        : params.profile === "asan"
          ? `cd ${quotedRemoteRepo} && meson setup build-asan --buildtype=debug -Dcassert=true -Db_sanitize=address,undefined -Dtap_tests=enabled --wipe || true && ninja -C build-asan && meson test -C build-asan --suite regress --print-errorlogs`
          : params.profile === "wal_consistency"
            ? `cd ${quotedRemoteRepo} && PGOPTIONS="-c wal_consistency_checking=all" meson test -C build --suite recovery --print-errorlogs`
            : `cd ${quotedRemoteRepo} && meson test -C build --suite tap --print-errorlogs`;

    const job = await this.db.createJob({
      id,
      kind: "hetzner_run",
      cf_id: params.cfId ?? null,
      title: `Hetzner ${params.profile} (${host})${params.cfId ? ` CF ${params.cfId}` : ""}`,
      backend: "ssh",
      model: params.profile,
      log_path: logPath,
    });

    this.spawnShellJob(
      job,
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, remoteCmd],
      {
        cwd: process.cwd(),
        env: buildChildEnv(settings),
      },
    );

    return job;
  }

  async startBugsTriageJob(params: { days?: number; limit?: number }): Promise<JobRecord> {
    const id = makeJobId("bugs_triage");
    const logPath = join(LOGS_DIR, `${id}.log`);
    const days = Math.min(Math.max(params.days ?? 14, 1), 60);
    const limit = Math.min(Math.max(params.limit ?? 30, 5), 100);

    const job = await this.db.createJob({
      id,
      kind: "bugs_triage",
      title: `Scan pgsql-bugs (last ${days}d, limit ${limit})`,
      backend: "builtin",
      log_path: logPath,
    });

    await this.db.updateJob(job.id, { status: "running", started_at: nowIso() });
    this.appendLog(job.id, logPath, `[pgroast-app] Scanning pgsql-bugs archive (last ${days} days, limit ${limit})...\n`);

    // Run async inside process without blocking HTTP response
    void (async () => {
      try {
        const result = await scanPgsqlBugs(this.db, {
          days,
          limit,
          onProgress: (line) => this.appendLog(job.id, logPath, `${line}\n`),
        });
        this.appendLog(
          job.id,
          logPath,
          `\n[pgroast-app] Done: scanned ${result.scanned}, production_hit=${result.productionHits}, synthetic_ai_hunt=${result.syntheticAi}, unclear=${result.unclear}\n`,
        );
        await this.db.updateJob(job.id, {
          status: "succeeded",
          exit_code: 0,
          result_json: JSON.stringify(result),
          finished_at: nowIso(),
        });
        this.emit(job.id, "done", JSON.stringify({ status: "succeeded", exit_code: 0, result }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.appendLog(job.id, logPath, `\n[pgroast-app] Error: ${msg}\n`);
        await this.db.updateJob(job.id, {
          status: "failed",
          exit_code: 1,
          error: msg,
          finished_at: nowIso(),
        });
        this.emit(job.id, "done", JSON.stringify({ status: "failed", exit_code: 1, error: msg }));
      }
    })();

    return job;
  }

  private async finalizeContributeMetadata(jobId: string, logPath: string, backend: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (!existsSync(logPath)) return out;
    const text = readFileSync(logPath, "utf8");
    const cfMatches = Array.from(text.matchAll(/claimed CF (\d+)\s+"([^"]+)"/g));
    const pubMatches = Array.from(text.matchAll(/\[(\d+)\] published sanitized (?:roast|opinion) -> (https?:\/\/\S+)/g));
    const pubMap = new Map<number, string>(pubMatches.map((m) => [Number(m[1]), m[2]!]));

    const cfIds: number[] = [];
    const items: Array<{ cfId: number; title: string; verdict: string; published: boolean; publicUrl?: string; modelSpec?: string }> = [];
    const outRoot = join(homedir(), ".pgroast", "contribute-out", backend);

    for (const m of cfMatches) {
      const cfId = Number(m[1]);
      if (!cfId || cfIds.includes(cfId)) continue;
      cfIds.push(cfId);
      let verdict = "";
      let modelSpec = "";
      const jsonPath = join(outRoot, `cf-${cfId}`, "roast.json");
      if (existsSync(jsonPath)) {
        try {
          const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as RoastJson;
          verdict = parsed.verdict || "";
          const ms = parsed.models as Record<string, string> | undefined;
          modelSpec = ms?.critic || ms?.synth || ms?.roaster || "";
        } catch {
          // ignore
        }
      }
      items.push({
        cfId,
        title: m[2] || `CF ${cfId}`,
        verdict,
        published: pubMap.has(cfId),
        publicUrl: pubMap.get(cfId),
        modelSpec,
      });
    }

    if (existsSync(outRoot)) {
      try {
        await this.db.importRoastBatch(outRoot);
      } catch {
        // best-effort local import
      }
    }

    if (items.length === 1) {
      const it = items[0]!;
      const suffix = it.published ? "published" : "local only";
      await this.db.updateJob(jobId, {
        cf_id: it.cfId,
        title: `CF ${it.cfId}: ${it.title.slice(0, 72)}${it.verdict ? ` · ${it.verdict}` : ""} (${suffix})`,
        model: it.modelSpec || undefined,
      });
    } else if (items.length > 1) {
      const pubCnt = items.filter((i) => i.published).length;
      await this.db.updateJob(jobId, {
        cf_id: items[0]!.cfId,
        title: `Bulk Roast (${items.length} done · ${pubCnt} published · ${backend})`,
      });
    }
    return { cfIds, items, publishedCount: items.filter((i) => i.published).length };
  }

  async startContributeJob(params: {
    mode: "once" | "auto" | "dry-run";
    backend?: "claude" | "codex" | "agy";
    model?: string;
    effort?: string;
    publish?: boolean;
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const repoDir = expandHome(settings.pgroastRepo);
    const cliPath = join(repoDir, "src", "cli.ts");
    if (!existsSync(cliPath)) {
      throw new Error(`pgroast CLI not found at ${cliPath}`);
    }
    const modeFlag = params.mode === "dry-run" ? "--dry-run" : params.mode === "auto" ? "--auto" : "--once";
    const args = ["run", cliPath, "contribute", modeFlag];
    if (params.backend) args.push("--backend", params.backend);
    if (params.model) args.push("--model", params.model);
    if (params.effort) args.push("--effort", params.effort);
    if (params.publish === true) args.push("--publish");
    else if (params.publish === false) args.push("--no-publish");
    if (settings.publicHubUrl) args.push("--hub", settings.publicHubUrl);

    const token = await this.db.getHubTokenDecrypted();
    const id = makeJobId("contribute");
    const logPath = join(LOGS_DIR, `${id}.log`);
    const modelLabel = params.model ? `${params.model}${params.effort ? `:${params.effort}` : ""}` : params.mode;
    const job = await this.db.createJob({
      id,
      kind: "contribute",
      title: `Quota Auto-Contribute (${params.mode}${params.backend ? ` · ${params.backend}` : ""}${params.publish ? " · publish" : ""})`,
      backend: params.backend || "auto",
      model: modelLabel,
      log_path: logPath,
    });

    const extraEnv: Record<string, string> = {};
    if (token) extraEnv.PGROAST_PUBLISH_TOKEN = token;
    if (settings.publicHubUrl) extraEnv.PGROAST_PUBLIC_HUB_URL = settings.publicHubUrl;
    if (params.backend === "codex" && params.model) extraEnv.PGROAST_CODEX_MODEL = params.model;
    if (params.effort) extraEnv.PGROAST_CODEX_EFFORT = params.effort;

    this.spawnShellJob(job, resolveBunBin(), args, {
      cwd: repoDir,
      env: buildChildEnv(settings, { stripApiKeys: true, extra: extraEnv }),
      onSuccess: () => this.finalizeContributeMetadata(job.id, logPath, params.backend || "claude"),
    });
    return job;
  }

  async startBulkRoastJob(params: {
    mode: "queue" | "batch";
    backend?: "claude" | "codex" | "agy" | "dual";
    model?: string;
    effort?: string;
    strategy?: "unroasted-first" | "ready-for-committer" | "cross-model-second-opinion";
    flavour?: string;
    roastLevel?: "light" | "medium" | "dark";
    count?: number;
    workers?: number;
    publish?: boolean;
    cfNumber?: number;
    status?: string;
    topics?: string[];
  }): Promise<JobRecord> {
    const settings = await this.db.getSettings();
    const repoDir = expandHome(settings.pgroastRepo);
    const cliPath = join(repoDir, "src", "cli.ts");
    if (!existsSync(cliPath)) {
      throw new Error(`pgroast CLI not found at ${cliPath}`);
    }

    const mode = params.mode === "batch" ? "batch" : "queue";
    const backend = resolveEffectiveBackend(params.backend, settings);
    const level = params.roastLevel === "light" || params.roastLevel === "dark" ? params.roastLevel : "medium";
    const flavour = (params.flavour || "default").trim() || "default";
    const model = (params.model || "").trim();
    const effort = (params.effort || "").trim().toLowerCase();
    const count = Math.min(Math.max(Math.trunc(params.count ?? 20), 1), 300);
    const workers = Math.min(Math.max(Math.trunc(params.workers ?? 2), 1), 4);
    const bunBin = resolveBunBin();
    const token = await this.db.getHubTokenDecrypted();

    const extraEnv: Record<string, string> = {
      PGROAST_CONCURRENCY: "4",
    };
    if (token) extraEnv.PGROAST_PUBLISH_TOKEN = token;
    if (settings.publicHubUrl) extraEnv.PGROAST_PUBLIC_HUB_URL = settings.publicHubUrl;
    if (backend === "codex" && model) extraEnv.PGROAST_CODEX_MODEL = model;
    if (backend === "codex" && effort) extraEnv.PGROAST_CODEX_EFFORT = effort;
    if (backend === "claude" && model) {
      extraEnv.PGROAST_ROASTER_MODEL = model;
      extraEnv.PGROAST_CRITIC_MODEL = model;
    }
    if ((backend === "claude" || backend === "dual") && effort) {
      extraEnv.PGROAST_CLAUDE_EFFORT = effort;
    }
    if (backend === "agy" && model) {
      extraEnv.PGROAST_AGY_MODEL = model;
      extraEnv.PGROAST_AGY_CRITIC_MODEL = model;
    }

    const modelSpecLabel = model ? `${backend === "codex" ? "openai" : backend === "claude" ? "anthropic" : backend === "agy" ? "google" : backend}/${model}${effort ? `:${effort}` : ""}` : `${flavour}/${level}`;

    const id = makeJobId("bulk_roast");
    const logPath = join(LOGS_DIR, `${id}.log`);

    if (mode === "batch") {
      const cfNum = Math.max(1, Math.trunc(params.cfNumber ?? 62));
      const status = (params.status || "open").trim() || "open";
      const outDir = resolve(expandHome(settings.roastDataDir || join(repoDir, "out")), `cf${cfNum}-${backend}-${level}`);
      const batchFlavour = flavour === "auto-by-subsystem" ? "default" : flavour;
      const args = [
        "run",
        cliPath,
        "batch",
        String(cfNum),
        "--out",
        outDir,
        "--status",
        status,
        "--limit",
        String(count),
        "--concurrency",
        String(workers),
        "--backend",
        backend,
        "--roast-level",
        level,
        "--flavour",
        batchFlavour,
      ];
      const job = await this.db.createJob({
        id,
        kind: "bulk_roast",
        title: `Bulk Batch CF #${cfNum} (${count} × ${modelSpecLabel} · ${batchFlavour}/${level}, ${workers}w)`,
        backend,
        model: modelSpecLabel,
        log_path: logPath,
      });
      this.spawnShellJob(job, bunBin, args, {
        cwd: repoDir,
        env: buildChildEnv(settings, { stripApiKeys: true, extra: extraEnv }),
        onSuccess: async () => {
          const imported = await this.db.importRoastBatch(outDir);
          return { outDir, imported };
        },
      });
      return job;
    }

    // Queue mode: parallel soft-leased workers calling `contribute --once`
    const queueBackend = backend === "dual" ? "claude" : backend;
    const strategy =
      params.strategy === "ready-for-committer" || params.strategy === "cross-model-second-opinion"
        ? params.strategy
        : "unroasted-first";
    const pubFlag = params.publish ? "--publish" : "--no-publish";
    const hubUrl = (settings.publicHubUrl || "https://pgroast.postgres.ai").trim();
    const topicsArg =
      params.topics && params.topics.length > 0 ? params.topics.map((t) => t.replace(/[^a-zA-Z0-9._,-]/g, "")).filter(Boolean).join(",") : "";

    const workerScript = `
import { spawn } from "node:child_process";
const workers = Number(process.env.BULK_WORKERS || 2);
const totalTarget = Number(process.env.BULK_COUNT || 20);
const bunBin = process.env.BULK_BUN_BIN || "bun";
const cliPath = process.env.BULK_CLI_PATH;
const baseArgs = JSON.parse(process.env.BULK_ARGS_JSON || "[]");
let claimed = 0;
let done = 0;
let stop = false;
process.on("SIGTERM", () => { stop = true; });
process.on("SIGINT", () => { stop = true; });

async function runWorker(wid) {
  if (wid > 1) await new Promise((r) => setTimeout(r, (wid - 1) * 2000));
  while (!stop) {
    if (claimed >= totalTarget) break;
    const seq = ++claimed;
    console.log(\`[bulk w\${wid}] Starting patch #\${seq}/\${totalTarget}...\`);
    const code = await new Promise((res) => {
      const p = spawn(bunBin, ["run", cliPath, ...baseArgs], { stdio: "inherit", env: process.env });
      p.on("close", (c) => res(c ?? 1));
      p.on("error", () => res(1));
    });
    if (code !== 0) {
      console.log(\`[bulk w\${wid}] Worker stopped (exit \${code} — queue empty or usage limit).\`);
      stop = true;
      break;
    }
    done++;
    console.log(\`[bulk w\${wid}] Completed \${done}/\${totalTarget} patches.\`);
  }
}

await Promise.all(Array.from({ length: workers }, (_, i) => runWorker(i + 1)));
console.log(\`[bulk] Finished: \${done} patch(es) processed across \${workers} worker(s).\`);
`;

    const baseArgs = [
      "contribute",
      "--once",
      "--backend",
      queueBackend,
      "--strategy",
      strategy,
      "--flavour",
      flavour,
      "--level",
      level,
      pubFlag,
      "--hub",
      hubUrl,
    ];
    if (model) baseArgs.push("--model", model);
    if (effort) baseArgs.push("--effort", effort);
    if (topicsArg) baseArgs.push("--topics", topicsArg);

    const job = await this.db.createJob({
      id,
      kind: "bulk_roast",
      title: `Bulk Queue Roast (${count} × ${modelSpecLabel} · ${flavour}/${level}, ${workers}w${params.publish ? ", auto-publish" : ""})`,
      backend: queueBackend,
      model: modelSpecLabel,
      log_path: logPath,
    });

    extraEnv.BULK_WORKERS = String(workers);
    extraEnv.BULK_COUNT = String(count);
    extraEnv.BULK_BUN_BIN = bunBin;
    extraEnv.BULK_CLI_PATH = cliPath;
    extraEnv.BULK_ARGS_JSON = JSON.stringify(baseArgs);

    this.spawnShellJob(job, bunBin, ["-e", workerScript], {
      cwd: repoDir,
      env: buildChildEnv(settings, { stripApiKeys: true, extra: extraEnv }),
      onSuccess: () => this.finalizeContributeMetadata(job.id, logPath, queueBackend),
    });
    return job;
  }
}
