// pgroast contribute: spend leftover weekly OAuth subscription quota (Claude, Codex, Antigravity)
// right before each subscription's weekly reset to roast uncovered PostgreSQL CommitFest patches.
//
// Modes:
//   pgroast contribute --init       create ~/.pgroast/contribute.json for installed CLIs
//   pgroast contribute --status     show live CommitFest coverage + weekly reset countdowns
//   pgroast contribute --dry-run    preview next soft-leased patch & archetype (no LLM calls)
//   pgroast contribute --once       roast 1 patch right now (ignores weekly window)
//   pgroast contribute --auto       run from hourly cron: only roasts inside pre-reset window
//
// Safety:
//   - Never auto-posts to pgsql-hackers or CommitFest.
//   - Publishing to the Public App is strictly opt-in (autoPublish: true or --publish)
//     and always checked by the Public-Confidentiality Hard Gate.
//   - Stops cleanly for a backend on the first usage/rate limit error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isLimitError } from "./batch.ts";
import { checkPublishConfidentiality, DEFAULT_HUB_URL, publishRoastOpinion, resolvePublishToken } from "./publish.ts";
import { checkBackend } from "./roast/doctor.ts";
import {
  isValidRoastFlavour,
  isValidRoastLevel,
  normalizeRoastFlavour,
  normalizeRoastLevel,
  type RoastFlavour,
  type RoastLevel,
} from "./roast/flavours.ts";
import { createBackend, modelsFromEnv, type BackendName } from "./roast/llm.ts";
import { runRoast } from "./roast/pipeline.ts";
import { closePrecedents } from "./roast/precedents.ts";
import { renderCompactMarkdown, renderMarkdown, renderSummary } from "./roast/render.ts";
import type { Roast } from "./roast/schema.ts";
import { loadProposal } from "./thread/load.ts";

export type QuotaBackend = "claude" | "codex" | "agy";
export type UtcDayName = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
export type ContributeStrategy = "unroasted-first" | "cross-model-second-opinion" | "ready-for-committer";

const UTC_DAYS: UtcDayName[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ContributeBackendSchedule {
  enabled: boolean;
  resetDayUtc: UtcDayName;
  resetHourUtc: number;
  windowHoursBeforeReset: number;
  maxPatchesPerWindow: number;
}

export interface ContributeConfig {
  hubUrl: string;
  publishTokenEnv: string;
  outDir: string;
  autoPublish: boolean;
  strategy: ContributeStrategy;
  roastLevel: RoastLevel;
  roastFlavour: "auto-by-subsystem" | RoastFlavour;
  topics: string[];
  backends: Record<QuotaBackend, ContributeBackendSchedule>;
}

export interface ContributeHistoryItem {
  at: string;
  cfId: number;
  title: string;
  backend: QuotaBackend;
  flavour: string;
  level: string;
  verdict: string;
  published: boolean;
  error?: string;
}

export interface ContributeState {
  windows: Record<string, Record<string, number>>;
  history: ContributeHistoryItem[];
}

export interface ResetWindowStatus {
  nextResetAt: string;
  hoursUntilReset: number;
  inWindow: boolean;
  windowKey: string;
  countdownLabel: string;
}

export interface NextPatchResponse {
  patch: {
    cf_id: number;
    title: string;
    status: string;
    topic: string;
    authors: string;
    verdict: string;
  } | null;
  suggestedFlavour: string;
  suggestedLevel: string;
  reason: string;
  leaseExpiresAt: string | null;
  coverage?: {
    totalOpen: number;
    baselineRoastedOpen: number;
    opinionsTotal: number;
    openWith1PlusOpinion: number;
    openWith2PlusOpinions: number;
    unroastedOpen: number;
    activeLeases?: Array<{ cf_id: number; backend: string }>;
  };
}

export function getDefaultConfigPath(): string {
  return resolve(process.env.PGROAST_CONTRIBUTE_CONFIG || join(homedir(), ".pgroast", "contribute.json"));
}

export function getDefaultStatePath(): string {
  return resolve(process.env.PGROAST_CONTRIBUTE_STATE || join(homedir(), ".pgroast", "contribute-state.json"));
}

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function defaultContributeConfig(hubUrl = process.env.PGROAST_PUBLIC_HUB_URL || DEFAULT_HUB_URL): ContributeConfig {
  return {
    hubUrl: hubUrl.trim().replace(/\/$/, "") || DEFAULT_HUB_URL,
    publishTokenEnv: "PGROAST_PUBLISH_TOKEN",
    outDir: join(homedir(), ".pgroast", "contribute-out"),
    autoPublish: false,
    strategy: "unroasted-first",
    roastLevel: "medium",
    roastFlavour: "auto-by-subsystem",
    topics: [],
    backends: {
      claude: { enabled: true, resetDayUtc: "Mon", resetHourUtc: 0, windowHoursBeforeReset: 18, maxPatchesPerWindow: 5 },
      codex: { enabled: false, resetDayUtc: "Mon", resetHourUtc: 0, windowHoursBeforeReset: 18, maxPatchesPerWindow: 5 },
      agy: { enabled: false, resetDayUtc: "Mon", resetHourUtc: 0, windowHoursBeforeReset: 18, maxPatchesPerWindow: 5 },
    },
  };
}

export function normalizeDayName(raw: string | undefined): UtcDayName {
  const s = (raw || "Mon").slice(0, 3).toLowerCase();
  const match = UTC_DAYS.find((d) => d.toLowerCase() === s);
  return match || "Mon";
}

export function computeResetWindowStatus(
  schedule: ContributeBackendSchedule,
  now: Date = new Date(),
): ResetWindowStatus {
  const targetDow = UTC_DAYS.indexOf(normalizeDayName(schedule.resetDayUtc));
  const targetHour = Math.max(0, Math.min(23, Math.trunc(schedule.resetHourUtc || 0)));
  const windowHours = Math.max(1, Math.min(168, Number(schedule.windowHoursBeforeReset || 18)));

  // Build candidate reset timestamp in current UTC week
  const curDow = now.getUTCDay();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), targetHour, 0, 0, 0));
  let dayDelta = (targetDow - curDow + 7) % 7;
  reset.setUTCDate(reset.getUTCDate() + dayDelta);
  if (reset.getTime() <= now.getTime()) {
    reset.setUTCDate(reset.getUTCDate() + 7);
  }

  const diffMs = reset.getTime() - now.getTime();
  const hoursUntilReset = Math.round((diffMs / 3_600_000) * 10) / 10;
  const inWindow = diffMs <= windowHours * 3_600_000;
  const windowKey = reset.toISOString().slice(0, 13) + "Z";

  const totalMins = Math.max(0, Math.round(diffMs / 60_000));
  const days = Math.floor(totalMins / (24 * 60));
  const hours = Math.floor((totalMins % (24 * 60)) / 60);
  const mins = totalMins % 60;
  const countdownLabel = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return {
    nextResetAt: reset.toISOString(),
    hoursUntilReset,
    inWindow,
    windowKey,
    countdownLabel,
  };
}

export function loadContributeConfig(configPath = getDefaultConfigPath()): ContributeConfig {
  const defaults = defaultContributeConfig();
  if (!existsSync(configPath)) return defaults;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ContributeConfig>;
    const merged: ContributeConfig = {
      ...defaults,
      ...raw,
      hubUrl: (raw.hubUrl || defaults.hubUrl).trim().replace(/\/$/, ""),
      roastLevel: normalizeRoastLevel(raw.roastLevel),
      roastFlavour:
        raw.roastFlavour === "auto-by-subsystem"
          ? "auto-by-subsystem"
          : normalizeRoastFlavour(raw.roastFlavour),
      topics: Array.isArray(raw.topics) ? raw.topics.map(String).filter(Boolean) : [],
      backends: {
        claude: { ...defaults.backends.claude, ...(raw.backends?.claude || {}) },
        codex: { ...defaults.backends.codex, ...(raw.backends?.codex || {}) },
        agy: { ...defaults.backends.agy, ...(raw.backends?.agy || {}) },
      },
    };
    return merged;
  } catch {
    return defaults;
  }
}

export function saveContributeConfig(cfg: ContributeConfig, configPath = getDefaultConfigPath()): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export function loadContributeState(statePath = getDefaultStatePath()): ContributeState {
  if (!existsSync(statePath)) return { windows: {}, history: [] };
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as Partial<ContributeState>;
    return {
      windows: raw.windows && typeof raw.windows === "object" ? raw.windows : {},
      history: Array.isArray(raw.history) ? raw.history : [],
    };
  } catch {
    return { windows: {}, history: [] };
  }
}

export function saveContributeState(st: ContributeState, statePath = getDefaultStatePath()): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const trimmed: ContributeState = {
    windows: st.windows,
    history: st.history.slice(0, 100),
  };
  writeFileSync(statePath, JSON.stringify(trimmed, null, 2) + "\n");
}

export function formatCoverageProgressBar(pctVal: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pctVal)));
  const filled = Math.round((clamped / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}] ${clamped}%`;
}

export async function fetchNextPatchFromHub(opts: {
  hubUrl: string;
  backend: QuotaBackend;
  strategy: ContributeStrategy;
  flavour: string;
  level: RoastLevel;
  topics?: string[];
  excludeCfIds?: number[];
  dryRun?: boolean;
  token?: string;
  fetchFn?: typeof fetch;
}): Promise<NextPatchResponse> {
  const qs = new URLSearchParams({
    backend: opts.backend,
    strategy: opts.strategy,
    flavour: opts.flavour,
    level: opts.level,
  });
  if (opts.topics?.length) qs.set("topics", opts.topics.join(","));
  if (opts.excludeCfIds?.length) qs.set("exclude", opts.excludeCfIds.join(","));
  if (opts.dryRun) qs.set("dry_run", "1");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token?.trim()) headers.Authorization = `Bearer ${opts.token.trim()}`;

  const fn = opts.fetchFn ?? fetch;
  const res = await fn(`${opts.hubUrl.replace(/\/$/, "")}/api/v1/contribute/next?${qs.toString()}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Public App /api/v1/contribute/next returned HTTP ${res.status}`);
  }
  return (await res.json()) as NextPatchResponse;
}

export async function runContributeCycle(opts: {
  config: ContributeConfig;
  state: ContributeState;
  mode: "dry-run" | "once" | "auto";
  onlyBackend?: QuotaBackend;
  forceWindow?: boolean;
  publishOverride?: boolean;
  token?: string;
  now?: Date;
  log?: (msg: string) => void;
  fetchFn?: typeof fetch;
  roastFn?: (params: {
    cfId: number;
    backend: QuotaBackend;
    level: RoastLevel;
    flavour: RoastFlavour;
    outDir: string;
  }) => Promise<{ roast: Roast; summaryTxt: string }>;
}): Promise<{
  processed: number;
  published: number;
  skippedWindow: number;
  stoppedByLimit: string[];
  previews: Array<{ backend: QuotaBackend; next: NextPatchResponse; window: ResetWindowStatus }>;
}> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const now = opts.now ?? new Date();
  const cfg = opts.config;
  const st = opts.state;
  const shouldPublish = opts.publishOverride ?? cfg.autoPublish;
  const token =
    opts.token ??
    (cfg.publishTokenEnv && process.env[cfg.publishTokenEnv]?.trim()
      ? process.env[cfg.publishTokenEnv]!.trim()
      : resolvePublishToken().token);

  const targetBackends: QuotaBackend[] = opts.onlyBackend
    ? [opts.onlyBackend]
    : (["claude", "codex", "agy"] as QuotaBackend[]).filter((b) => cfg.backends[b]?.enabled);

  const summary = {
    processed: 0,
    published: 0,
    skippedWindow: 0,
    stoppedByLimit: [] as string[],
    previews: [] as Array<{ backend: QuotaBackend; next: NextPatchResponse; window: ResetWindowStatus }>,
  };

  if (targetBackends.length === 0) {
    log("No AI backends are enabled in contribute.json. Enable claude, codex, or agy first.");
    return summary;
  }

  for (const backend of targetBackends) {
    const sched = cfg.backends[backend];
    const win = computeResetWindowStatus(sched, now);
    const doneInWindow = st.windows[backend]?.[win.windowKey] ?? 0;
    const remainingCap = Math.max(0, (sched.maxPatchesPerWindow || 5) - doneInWindow);

    if (opts.mode === "dry-run") {
      const next = await fetchNextPatchFromHub({
        hubUrl: cfg.hubUrl,
        backend,
        strategy: cfg.strategy,
        flavour: cfg.roastFlavour,
        level: cfg.roastLevel,
        topics: cfg.topics,
        dryRun: true,
        token,
        fetchFn: opts.fetchFn,
      });
      summary.previews.push({ backend, next, window: win });
      log(
        `[${backend}] reset in ${win.countdownLabel} (${win.inWindow ? "IN PRE-RESET WINDOW" : "outside window"}) · ${doneInWindow}/${sched.maxPatchesPerWindow} used this window`,
      );
      if (next.patch) {
        log(
          `  -> Next: CF ${next.patch.cf_id} "${next.patch.title}" (${next.patch.status}) · level=${next.suggestedLevel} · archetype=${next.suggestedFlavour}`,
        );
        log(`     Reason: ${next.reason}`);
      } else {
        log(`  -> ${next.reason}`);
      }
      continue;
    }

    if (opts.mode === "auto" && !opts.forceWindow && !win.inWindow) {
      summary.skippedWindow++;
      log(
        `[${backend}] outside pre-reset window (reset in ${win.countdownLabel}, window opens ${sched.windowHoursBeforeReset}h before reset) — skipping.`,
      );
      continue;
    }

    const maxRunsNow = opts.mode === "once" ? 1 : remainingCap;
    if (maxRunsNow <= 0) {
      log(`[${backend}] reached per-window cap (${doneInWindow}/${sched.maxPatchesPerWindow}) for ${win.windowKey} — skipping.`);
      continue;
    }

    const triedCfIds: number[] = [];
    for (let i = 0; i < maxRunsNow; i++) {
      const next = await fetchNextPatchFromHub({
        hubUrl: cfg.hubUrl,
        backend,
        strategy: cfg.strategy,
        flavour: cfg.roastFlavour,
        level: cfg.roastLevel,
        topics: cfg.topics,
        excludeCfIds: triedCfIds,
        dryRun: false,
        token,
        fetchFn: opts.fetchFn,
      });
      if (!next.patch) {
        log(`[${backend}] queue empty: ${next.reason}`);
        break;
      }

      const cfId = next.patch.cf_id;
      triedCfIds.push(cfId);
      const flavour = normalizeRoastFlavour(next.suggestedFlavour);
      const level = normalizeRoastLevel(next.suggestedLevel);
      const patchOutDir = join(expandTilde(cfg.outDir), backend, `cf-${cfId}`);
      mkdirSync(patchOutDir, { recursive: true });

      log(
        `[${backend}] claimed CF ${cfId} "${next.patch.title}" (level=${level}, archetype=${flavour}, lease until ${next.leaseExpiresAt?.slice(11, 16) || "45m"} UTC)`,
      );

      try {
        const result = opts.roastFn
          ? await opts.roastFn({ cfId, backend, level, flavour, outDir: patchOutDir })
          : await (async () => {
              const proposal = await loadProposal(String(cfId), {
                includeCode: level !== "light",
                maxCodeChars: level === "dark" ? 85_000 : 55_000,
              });
              const transcriptDir = join(patchOutDir, "llm");
              const llm = createBackend(backend as BackendName, { transcriptDir, log: (m) => log(`  [${cfId}] ${m}`) });
              const models = modelsFromEnv(process.env, backend as BackendName);
              const t0 = Date.now();
              const roast = await runRoast(proposal, {
                backend: llm,
                models,
                backendName: backend,
                hint: null,
                enrich: true,
                mode: "review",
                roastLevel: level,
                roastFlavour: flavour,
                rounds: 0,
                log: (m) => log(`  [${cfId}] ${m}`),
              });
              roast.stats.wall_ms = Date.now() - t0;
              await closePrecedents();
              const summaryTxt = renderSummary(roast);
              writeFileSync(join(patchOutDir, "roast.md"), renderCompactMarkdown(roast));
              writeFileSync(join(patchOutDir, "roast-full.md"), renderMarkdown(roast));
              writeFileSync(join(patchOutDir, "roast-summary.txt"), summaryTxt);
              writeFileSync(join(patchOutDir, "roast.json"), JSON.stringify(roast, null, 2) + "\n");
              return { roast, summaryTxt };
            })();

        let published = false;
        if (shouldPublish) {
          if (!token.trim()) {
            log(`  [${cfId}] autoPublish enabled, but no publish token set (${cfg.publishTokenEnv}); saved locally only.`);
          } else {
            const pub = await publishRoastOpinion({
              roast: result.roast,
              summaryTxt: result.summaryTxt,
              cfIdOverride: cfId,
              backendOverride: backend,
              hubUrl: cfg.hubUrl,
              token,
              fetchFn: opts.fetchFn,
            });
            published = true;
            summary.published++;
            log(`  [${cfId}] published sanitized roast -> ${pub.patchUrl}`);
          }
        } else {
          log(`  [${cfId}] saved locally to ${patchOutDir} (pass --publish or set autoPublish: true to share)`);
        }

        summary.processed++;
        st.windows[backend] = st.windows[backend] || {};
        st.windows[backend]![win.windowKey] = (st.windows[backend]![win.windowKey] ?? 0) + 1;
        st.history.unshift({
          at: new Date().toISOString(),
          cfId,
          title: next.patch.title,
          backend,
          flavour,
          level,
          verdict: result.roast.verdict,
          published,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isLimitError(msg)) {
          summary.stoppedByLimit.push(backend);
          log(`[${backend}] hit subscription usage/rate limit — stopping cleanly for this window.`);
          break;
        }
        st.history.unshift({
          at: new Date().toISOString(),
          cfId,
          title: next.patch.title,
          backend,
          flavour,
          level,
          verdict: "ERROR",
          published: false,
          error: msg.slice(0, 200),
        });
        log(`[${backend}] CF ${cfId} failed: ${msg.split("\n")[0]}`);
      }
    }
    if (opts.mode === "once" && summary.processed >= 1) break;
  }

  return summary;
}

const CONTRIBUTE_USAGE = `Usage: pgroast contribute [--init | --status | --dry-run | --once | --auto] [options]

  Spend leftover weekly OAuth quota (Claude, Codex, Antigravity) right before your weekly
  reset to pre-review uncovered PostgreSQL CommitFest patches. Never posts to pgsql-hackers.

Modes:
  --init             Create ~/.pgroast/contribute.json with installed AI CLIs
  --status           Show live CommitFest coverage progress and weekly reset countdowns
  --dry-run          Preview the next soft-leased patch & archetype (zero model calls)
  --once             Claim and roast 1 patch right now (ignores weekly window)
  --auto             For hourly cron: only roasts backends currently inside pre-reset window

Options:
  --backend NAME     claude, codex, or agy (default: all enabled backends in config)
  --strategy S       unroasted-first | cross-model-second-opinion | ready-for-committer
  --level L          light | medium | dark
  --flavour NAME     auto-by-subsystem (default) or any reviewer archetype
  --topics a,b       Comma-separated subsystem keywords to focus on
  --hub URL          Public App URL (default: ${DEFAULT_HUB_URL})
  --token TOK        Publish-only token (default: $PGROAST_PUBLISH_TOKEN)
  --publish          Publish sanitized roast after roasting (overrides autoPublish)
  --no-publish       Keep results local only
  --force            Ignore pre-reset window check during --auto
  --config PATH      Custom config file path (default: ~/.pgroast/contribute.json)
  -h, --help         Show this help`;

export async function contributeMain(argv: string[]): Promise<number> {
  let mode: "init" | "status" | "dry-run" | "once" | "auto" = "status";
  let configPath = getDefaultConfigPath();
  let onlyBackend: QuotaBackend | undefined;
  let strategyOverride: ContributeStrategy | undefined;
  let levelOverride: RoastLevel | undefined;
  let flavourOverride: "auto-by-subsystem" | RoastFlavour | undefined;
  let topicsOverride: string[] | undefined;
  let hubOverride: string | undefined;
  let tokenOverride: string | undefined;
  let publishOverride: boolean | undefined;
  let modelOverride: string | undefined;
  let effortOverride: string | undefined;
  let forceWindow = false;

  const rest = [...argv];
  while (rest.length) {
    const tok = rest.shift()!;
    if (tok === "-h" || tok === "--help") {
      console.log(CONTRIBUTE_USAGE);
      return 0;
    } else if (tok === "--init") mode = "init";
    else if (tok === "--status") mode = "status";
    else if (tok === "--dry-run") mode = "dry-run";
    else if (tok === "--once") mode = "once";
    else if (tok === "--auto") mode = "auto";
    else if (tok === "--force") forceWindow = true;
    else if (tok === "--publish") publishOverride = true;
    else if (tok === "--no-publish") publishOverride = false;
    else if (tok === "--config") configPath = resolve(rest.shift() || configPath);
    else if (tok === "--hub") hubOverride = rest.shift() || "";
    else if (tok === "--token") tokenOverride = rest.shift() || "";
    else if (tok === "--model") modelOverride = (rest.shift() || "").trim();
    else if (tok === "--effort") effortOverride = (rest.shift() || "").trim().toLowerCase();
    else if (tok === "--backend") {
      const b = (rest.shift() || "").toLowerCase();
      if (b !== "claude" && b !== "codex" && b !== "agy") {
        console.error(`pgroast contribute: --backend must be claude, codex, or agy`);
        return 2;
      }
      onlyBackend = b;
    } else if (tok === "--strategy") {
      const s = (rest.shift() || "").toLowerCase();
      if (s !== "unroasted-first" && s !== "cross-model-second-opinion" && s !== "ready-for-committer") {
        console.error(`pgroast contribute: invalid --strategy "${s}"`);
        return 2;
      }
      strategyOverride = s;
    } else if (tok === "--level" || tok === "--roast-level") {
      const lv = (rest.shift() || "").toLowerCase();
      if (!isValidRoastLevel(lv)) {
        console.error(`pgroast contribute: invalid --level "${lv}"`);
        return 2;
      }
      levelOverride = normalizeRoastLevel(lv);
    } else if (tok === "--flavour" || tok === "--flavor") {
      const fl = (rest.shift() || "").toLowerCase();
      if (fl === "auto-by-subsystem") flavourOverride = "auto-by-subsystem";
      else if (isValidRoastFlavour(fl)) flavourOverride = normalizeRoastFlavour(fl);
      else {
        console.error(`pgroast contribute: invalid --flavour "${fl}"`);
        return 2;
      }
    } else if (tok === "--topics") {
      topicsOverride = (rest.shift() || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    } else {
      console.error(`pgroast contribute: unknown argument "${tok}"\n\n${CONTRIBUTE_USAGE}`);
      return 2;
    }
  }

  if (mode === "init") {
    const cfg = loadContributeConfig(configPath);
    if (hubOverride) cfg.hubUrl = hubOverride.trim().replace(/\/$/, "");
    if (strategyOverride) cfg.strategy = strategyOverride;
    if (levelOverride) cfg.roastLevel = levelOverride;
    if (flavourOverride) cfg.roastFlavour = flavourOverride;
    if (topicsOverride) cfg.topics = topicsOverride;
    if (publishOverride !== undefined) cfg.autoPublish = publishOverride;

    const [cRes, xRes, aRes] = await Promise.all([
      checkBackend("claude", { skipCompletion: true }),
      checkBackend("codex", { skipCompletion: true }),
      checkBackend("agy", { skipCompletion: true }),
    ]);
    cfg.backends.claude.enabled = cRes.found;
    cfg.backends.codex.enabled = xRes.found;
    cfg.backends.agy.enabled = aRes.found;
    if (!cfg.backends.claude.enabled && !cfg.backends.codex.enabled && !cfg.backends.agy.enabled) {
      cfg.backends.claude.enabled = true;
    }
    saveContributeConfig(cfg, configPath);
    console.log(`Wrote ${configPath}`);
    console.log(`Hub: ${cfg.hubUrl}`);
    console.log(
      `Enabled backends: ${(["claude", "codex", "agy"] as QuotaBackend[]).filter((b) => cfg.backends[b].enabled).join(", ") || "none"}`,
    );
    console.log("");
    console.log("Next steps:");
    console.log("  1. Edit weekly resetDayUtc / resetHourUtc in " + configPath + " (or use Backoffice -> Settings)");
    console.log("  2. Preview next patch:  pgroast contribute --dry-run");
    console.log("  3. Check live progress: pgroast contribute --status");
    console.log("  4. Optional hourly cron: 0 * * * * pgroast contribute --auto");
    return 0;
  }

  const cfg = loadContributeConfig(configPath);
  if (hubOverride) cfg.hubUrl = hubOverride.trim().replace(/\/$/, "");
  if (strategyOverride) cfg.strategy = strategyOverride;
  if (levelOverride) cfg.roastLevel = levelOverride;
  if (flavourOverride) cfg.roastFlavour = flavourOverride;
  if (topicsOverride) cfg.topics = topicsOverride;
  const st = loadContributeState();

  if (mode === "status") {
    console.log(`pgroast Weekly Quota Auto-Contribute Status (${cfg.hubUrl})`);
    console.log(`Config: ${configPath}${existsSync(configPath) ? "" : " (not initialized yet — run --init)"}`);
    console.log(`Strategy: ${cfg.strategy} · Level: ${cfg.roastLevel} · Archetype: ${cfg.roastFlavour} · autoPublish: ${cfg.autoPublish}`);
    console.log("");

    try {
      const res = await fetch(`${cfg.hubUrl}/api/v1/contribute/status`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const cov = (await res.json()) as {
          totalOpen: number;
          baselineRoastedOpen: number;
          opinionsTotal: number;
          openWith1PlusOpinion: number;
          openWith2PlusOpinions: number;
          unroastedOpen: number;
          activeLeases: Array<{ cf_id: number; backend: string }>;
        };
        const basePct = cov.totalOpen > 0 ? Math.round((cov.baselineRoastedOpen / cov.totalOpen) * 100) : 0;
        const opPct = cov.totalOpen > 0 ? Math.round((cov.openWith1PlusOpinion / cov.totalOpen) * 100) : 0;
        console.log("Community CommitFest Coverage:");
        console.log(`  Baseline roasted:   ${formatCoverageProgressBar(basePct)}  (${cov.baselineRoastedOpen}/${cov.totalOpen} open)`);
        console.log(`  Community roasts: ${formatCoverageProgressBar(opPct)}  (${cov.openWith1PlusOpinion}/${cov.totalOpen} open · ${cov.opinionsTotal} total · ${cov.openWith2PlusOpinions} with 2+ models)`);
        console.log(`  Unroasted open:     ${cov.unroastedOpen}  · Active soft leases: ${cov.activeLeases.length}`);
        console.log("");
      }
    } catch (err) {
      console.log(`(Could not reach ${cfg.hubUrl}/api/v1/contribute/status: ${err instanceof Error ? err.message : String(err)})`);
      console.log("");
    }

    console.log("Local Weekly Reset Schedules:");
    for (const b of ["claude", "codex", "agy"] as QuotaBackend[]) {
      const sched = cfg.backends[b];
      const win = computeResetWindowStatus(sched);
      const used = st.windows[b]?.[win.windowKey] ?? 0;
      const statusTag = !sched.enabled ? "disabled" : win.inWindow ? "IN WINDOW NOW" : `opens in ${Math.max(0, Math.round((win.hoursUntilReset - sched.windowHoursBeforeReset) * 10) / 10)}h`;
      console.log(
        `  ${b.padEnd(7)} ${statusTag.padEnd(18)} reset ${sched.resetDayUtc} ${String(sched.resetHourUtc).padStart(2, "0")}:00 UTC (in ${win.countdownLabel}) · ${used}/${sched.maxPatchesPerWindow} patches`,
      );
    }

    if (st.history.length > 0) {
      console.log("");
      console.log("Recent local contributions:");
      for (const h of st.history.slice(0, 5)) {
        console.log(`  ${h.at.slice(0, 16).replace("T", " ")}  CF ${h.cfId}  [${h.backend}/${h.flavour}]  ${h.verdict}  ${h.published ? "(published)" : "(local)"}`);
      }
    }
    return 0;
  }

  // Apply optional --model / --effort overrides to process.env for the chosen backend
  if (modelOverride) {
    const b = onlyBackend || "codex";
    if (b === "codex") process.env.PGROAST_CODEX_MODEL = modelOverride;
    else if (b === "agy") {
      process.env.PGROAST_AGY_MODEL = modelOverride;
      process.env.PGROAST_AGY_CRITIC_MODEL = modelOverride;
    } else {
      process.env.PGROAST_ROASTER_MODEL = modelOverride;
      process.env.PGROAST_CRITIC_MODEL = modelOverride;
    }
  }
  if (effortOverride) {
    process.env.PGROAST_CODEX_EFFORT = effortOverride;
  }

  // Run dry-run, once, or auto
  const token = tokenOverride ?? (cfg.publishTokenEnv ? process.env[cfg.publishTokenEnv] || "" : "");
  const sanity = checkPublishConfidentiality(cfg.hubUrl);
  if (!sanity.ok) {
    console.error(`pgroast contribute: invalid hubUrl (${sanity.reasons.join(", ")})`);
    return 1;
  }

  await runContributeCycle({
    config: cfg,
    state: st,
    mode,
    onlyBackend,
    forceWindow,
    publishOverride,
    token,
  });

  if (mode !== "dry-run") {
    saveContributeState(st);
  }
  return 0;
}
