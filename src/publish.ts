// pgroast publish <roast.json|dir> [--hub URL] [--token TOK] [--dry-run]
//
// Publishes a sanitized opinion from a finished local roast.json to a pgroast Public App
// (e.g. https://pgroast.postgres.ai). Runs the Public-Confidentiality Hard Gate locally
// before sending anything over HTTP. Never posts to pgsql-hackers or CommitFest.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeRoastFlavour, normalizeRoastLevel } from "./roast/flavours.ts";
import type { Roast } from "./roast/schema.ts";

export const DEFAULT_HUB_URL = "https://pgroast.postgres.ai";
export const AUTH_FILE_PATH = join(homedir(), ".pgroast", "auth.json");

export interface SavedAuth {
  hubUrl: string;
  token: string;
  savedAt: string;
}

export function loadSavedAuth(): SavedAuth | null {
  try {
    if (!existsSync(AUTH_FILE_PATH)) return null;
    const raw = JSON.parse(readFileSync(AUTH_FILE_PATH, "utf8")) as Partial<SavedAuth>;
    if (!raw.token || typeof raw.token !== "string") return null;
    return {
      hubUrl: typeof raw.hubUrl === "string" && raw.hubUrl.trim() ? raw.hubUrl.trim() : DEFAULT_HUB_URL,
      token: raw.token.trim(),
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function saveAuth(auth: { hubUrl: string; token: string }): void {
  const dir = dirname(AUTH_FILE_PATH);
  mkdirSync(dir, { recursive: true });
  const data: SavedAuth = {
    hubUrl: auth.hubUrl.trim().replace(/\/$/, "") || DEFAULT_HUB_URL,
    token: auth.token.trim(),
    savedAt: new Date().toISOString(),
  };
  writeFileSync(AUTH_FILE_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(AUTH_FILE_PATH, 0o600);
  } catch {
    // ignore on non-POSIX
  }
}

export function resolvePublishToken(explicitToken?: string): { token: string; source: string; hubUrl?: string } {
  if (explicitToken && explicitToken.trim()) return { token: explicitToken.trim(), source: "--token" };
  if (process.env.PGROAST_PUBLISH_TOKEN?.trim()) {
    return { token: process.env.PGROAST_PUBLISH_TOKEN.trim(), source: "PGROAST_PUBLISH_TOKEN" };
  }
  const saved = loadSavedAuth();
  if (saved?.token) return { token: saved.token, source: AUTH_FILE_PATH, hubUrl: saved.hubUrl };
  // Fallback to contribute.json if user already configured it there
  try {
    const contribPath = join(homedir(), ".pgroast", "contribute.json");
    if (existsSync(contribPath)) {
      const cfg = JSON.parse(readFileSync(contribPath, "utf8")) as { publishToken?: string; hubUrl?: string };
      if (cfg.publishToken?.trim()) {
        return { token: cfg.publishToken.trim(), source: contribPath, hubUrl: cfg.hubUrl };
      }
    }
  } catch {
    // ignore
  }
  return { token: "", source: "none" };
}

const SECRET_AND_PATH_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "pgroast publish token", re: /pgroast_pub_[A-Za-z0-9_-]{12,}/ },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "API key", re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/ },
  { name: "session/CSRF cookie", re: /\b(?:sessionid|csrftoken)\s*=\s*[^\s;]{8,}/i },
  { name: "private key header", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "local filesystem path", re: /(?:^|[\s"'`(])\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
];

export function formatCanonicalModelSpec(backend: string, models?: Record<string, string>): string {
  const b = (backend || "claude").toLowerCase().trim();
  const primary = (models?.critic || models?.synth || models?.roaster || "").trim();
  if (!primary || primary === "codex-default") {
    return b === "codex" ? "openai/codex-default" : b === "agy" ? "google/gemini" : b;
  }
  const normalizeSingle = (raw: string, fallbackBackend: string): string => {
    const s = raw.trim();
    if (!s) return fallbackBackend;
    if (s.includes("/")) return s;
    const low = s.toLowerCase();
    // Convert trailing -xhigh/-high/-medium/-low on Gemini/agy slugs into standard :effort suffix
    const normalized = s.replace(/-(xhigh|high|medium|low|max|ultra)$/i, ":$1");
    if (low.startsWith("gpt-") || low.startsWith("o1") || low.startsWith("o3") || low.startsWith("o4") || low.includes("codex") || fallbackBackend === "codex") {
      return `openai/${normalized}`;
    }
    if (low.startsWith("claude") || low === "opus" || low.includes("fable") || low.includes("mythos") || fallbackBackend === "claude") {
      const mName = low === "opus" ? "claude-opus" : normalized;
      return `anthropic/${mName}`;
    }
    if (low.startsWith("gemini") || fallbackBackend === "agy") {
      return `google/${normalized}`;
    }
    return `${fallbackBackend}/${normalized}`;
  };
  if (b === "dual" && models?.roaster?.includes("+")) {
    const parts = models.roaster.split("+").map((p) => p.trim()).filter(Boolean);
    return parts.map((p) => normalizeSingle(p, p.toLowerCase().includes("gemini") ? "agy" : "claude")).join(" + ");
  }
  return normalizeSingle(primary, b);
}

export function checkPublishConfidentiality(text: string): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  for (const r of SECRET_AND_PATH_RULES) {
    if (r.re.test(text)) reasons.push(r.name);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export interface PublishOpinionPayload {
  cf_id: number;
  entry?: {
    cf_id: number;
    title: string;
    status: string;
    authors: string;
    reviewers: string;
    committer: string;
    thread_url: string;
    verdict: string;
    confidence: string;
  };
  backend: string;
  roast_level: string;
  roast_flavour: string;
  models: Record<string, string>;
  models_json: string;
  verdict: string;
  confidence: string;
  summary: string;
}

export function buildRichOpinionMarkdown(roast: Roast): string {
  const parts: string[] = [];

  if (roast.verification?.evidenceBadges?.length) {
    parts.push(`**Verification:** ${roast.verification.evidenceBadges.join(" · ")}`);
  }

  if (roast.verdict_reasoning?.trim()) {
    parts.push(`### Verdict Reasoning\n\n${roast.verdict_reasoning.trim()}`);
  }

  if (roast.verification && (roast.verification.gitApply !== "skipped" || roast.verification.liveReproCases.length > 0)) {
    const v = roast.verification;
    const vLines: string[] = ["### Build, Test & Live Verification"];
    if (v.gitApply !== "skipped") {
      vLines.push(`- **git apply (${v.baseRef || "master"}):** \`${v.gitApply}\` — ${v.applyDetail.replace(/\s+/g, " ").slice(0, 260)}`);
    }
    if (v.mesonCompile !== "skipped") {
      vLines.push(`- **meson compile (-Dcassert=true):** \`${v.mesonCompile}\` (${Math.max(1, Math.round(v.compileDurationMs / 1000))}s) — ${v.compileDetail.replace(/\s+/g, " ").slice(0, 260)}`);
    }
    if (v.testsStatus !== "skipped") {
      vLines.push(`- **meson test (${v.testSuites.join(", ")}):** \`${v.testsStatus}\` (${v.testsPassed}/${v.testsRun} passed${v.testsFailed ? `, ${v.testsFailed} failed` : ""})`);
    }
    if (v.liveReproCases.length > 0) {
      vLines.push(`- **Live patched PostgreSQL SQL stress tests (\`${v.liveReproStatus}\`):**`);
      for (const c of v.liveReproCases) {
        const detail = c.errorExcerpt
          ? ` — Error: \`${c.errorExcerpt.replace(/\s+/g, " ").slice(0, 220)}\``
          : c.outputExcerpt
            ? ` — Output: \`${c.outputExcerpt.replace(/\s+/g, " ").slice(0, 180)}\``
            : "";
        vLines.push(`  - \`[${c.status}]\` **${c.name}** (${c.category}, ${c.durationMs}ms)${detail}`);
      }
    }
    parts.push(vLines.join("\n"));
  }

  const objs = roast.objections || [];
  if (objs.length > 0) {
    const oLines: string[] = [`### Key Objections (${objs.length})`];
    objs.slice(0, 8).forEach((o, idx) => {
      const nov = o.novelty === "open_in_thread" ? "open in thread" : o.novelty === "revisits_precedent" ? "revisits precedent" : "new";
      oLines.push(`**${idx + 1}. ${o.title}** \`[${o.severity} · ${nov}]\``);
      if (o.failure_scenario?.trim()) oLines.push(o.failure_scenario.trim());
      if (o.argument?.trim()) oLines.push(o.argument.trim());
      if (o.author_must_show?.trim()) oLines.push(`*Author must show:* ${o.author_must_show.trim()}`);
      oLines.push("");
    });
    parts.push(oLines.join("\n").trim());
  } else {
    parts.push("### Objections\n\nNo material objection survived the counter-check.");
  }

  const qs = (roast.questions || []).filter((q) => q && q.trim());
  if (qs.length > 0) {
    parts.push(`### Questions for the Author\n\n${qs.slice(0, 5).map((q, i) => `${i + 1}. ${q.trim()}`).join("\n")}`);
  }

  const priors = (roast.prior_attempts || []).slice(0, 4);
  if (priors.length > 0) {
    parts.push(
      `### Prior Attempts\n\n${priors
        .map((p) => `- [${p.title}](${p.url}) (${p.status || "outcome unknown"}${p.date ? `, ${p.date.slice(0, 10)}` : ""}): ${(p.what_is_different || p.reason || "").trim()}`)
        .join("\n")}`,
    );
  }

  if (roast.provisional_note?.trim()) {
    parts.push(`*Not checked:* ${roast.provisional_note.trim()}`);
  }

  return parts.join("\n\n").slice(0, 16_000).trim();
}

export function buildOpinionPayloadFromRoast(
  roast: Roast,
  opts?: { cfIdOverride?: number; summaryTxt?: string; backendOverride?: string },
): PublishOpinionPayload {
  const cfId = opts?.cfIdOverride ?? roast.input?.cf?.id ?? 0;
  if (!Number.isInteger(cfId) || cfId <= 0) {
    throw new Error("Could not determine CommitFest patch ID from roast.json (pass --cf-id <id>).");
  }
  const backend = (opts?.backendOverride || roast.backend || "claude").toLowerCase().trim();
  const level = normalizeRoastLevel(roast.roast_level);
  const flavour = normalizeRoastFlavour(roast.roast_flavour);

  const richMd = buildRichOpinionMarkdown(roast);
  const summary = (richMd || opts?.summaryTxt?.trim() || roast.verdict_reasoning || "").slice(0, 16_000).trim();

  // Build structured models metadata including canonical provider/model:effort spec + verification badges
  const cleanModels: Record<string, string> = {};
  if (roast.models && typeof roast.models === "object") {
    for (const [k, v] of Object.entries(roast.models)) {
      if (typeof v === "string" && v.trim() && checkPublishConfidentiality(v).ok) {
        cleanModels[k] = v.trim();
      }
    }
  }
  const spec = formatCanonicalModelSpec(backend, cleanModels);
  if (spec) cleanModels.spec = spec;
  if (roast.verification?.evidenceBadges?.length) {
    cleanModels.evidence = roast.verification.evidenceBadges.join(" | ");
  }

  const cf = roast.input?.cf as
    | { id: number; title?: string; status?: string | null; authors?: string; reviewers?: string; committer?: string }
    | undefined;
  return {
    cf_id: cfId,
    entry: cf
      ? {
          cf_id: cfId,
          title: cf.title || roast.brief?.title || roast.input?.subject || `CF ${cfId}`,
          status: cf.status || "",
          authors: cf.authors || "",
          reviewers: cf.reviewers || "",
          committer: cf.committer || "",
          thread_url: roast.input?.thread_url || "",
          verdict: roast.verdict || "",
          confidence: roast.confidence || "medium",
        }
      : undefined,
    backend,
    roast_level: level,
    roast_flavour: flavour,
    models: cleanModels,
    models_json: JSON.stringify(cleanModels),
    verdict: roast.verdict,
    confidence: roast.confidence || "medium",
    summary,
  };
}

export async function publishRoastOpinion(opts: {
  roast: Roast;
  summaryTxt?: string;
  cfIdOverride?: number;
  backendOverride?: string;
  hubUrl: string;
  token: string;
  dryRun?: boolean;
  fetchFn?: typeof fetch;
}): Promise<{ ok: true; cfId: number; patchUrl: string; payload: PublishOpinionPayload; dryRun: boolean }> {
  const hubBase = opts.hubUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(hubBase)) {
    throw new Error(`Invalid hub URL "${hubBase}" (must start with http:// or https://).`);
  }
  const payload = buildOpinionPayloadFromRoast(opts.roast, {
    cfIdOverride: opts.cfIdOverride,
    summaryTxt: opts.summaryTxt,
    backendOverride: opts.backendOverride,
  });

  const gate = checkPublishConfidentiality(JSON.stringify(payload));
  if (!gate.ok) {
    throw new Error(`Public-Confidentiality HARD BLOCK: detected ${gate.reasons.join(", ")}. Refusing to publish.`);
  }

  const patchUrl = `${hubBase}/patch/${payload.cf_id}`;
  if (opts.dryRun) {
    return { ok: true, cfId: payload.cf_id, patchUrl, payload, dryRun: true };
  }
  if (!opts.token.trim()) {
    throw new Error(
      `Missing publish token. Mint a publish-only token at ${hubBase}/?tab=connect and save it once with:\n  npx pgroast@next login --token <pgroast_pub_...>`,
    );
  }

  const fn = opts.fetchFn ?? fetch;
  const res = await fn(`${hubBase}/api/v1/publish/opinion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token.trim()}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let parsed: { error?: string } = {};
  try {
    parsed = JSON.parse(text) as { error?: string };
  } catch {
    // non-JSON
  }
  if (!res.ok) {
    throw new Error(parsed.error || `Public App returned HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  return { ok: true, cfId: payload.cf_id, patchUrl, payload, dryRun: false };
}

const PUBLISH_USAGE = `Usage: pgroast publish <roast.json|dir> [options]

  Publishes a sanitized roast from a local roast.json to the pgroast Public App.
  Runs the Public-Confidentiality Hard Gate locally before sending anything.

Options:
  --hub URL      Public App URL (default: PGROAST_PUBLIC_HUB_URL or ${DEFAULT_HUB_URL})
  --token TOK    Publish-only token (default: PGROAST_PUBLISH_TOKEN)
  --cf-id N      Override CommitFest patch ID if not embedded in roast.json
  --dry-run      Validate and print the sanitized payload without sending
  -h, --help     Show this help`;

export async function publishMain(argv: string[]): Promise<number> {
  let target = "";
  const resolved = resolvePublishToken();
  let hubUrl = process.env.PGROAST_PUBLIC_HUB_URL || resolved.hubUrl || DEFAULT_HUB_URL;
  let token = resolved.token;
  let cfIdOverride: number | undefined;
  let dryRun = false;

  const rest = [...argv];
  while (rest.length) {
    const tok = rest.shift()!;
    if (tok === "-h" || tok === "--help") {
      console.log(PUBLISH_USAGE);
      return 0;
    } else if (tok === "--hub") {
      hubUrl = rest.shift() || "";
    } else if (tok === "--token") {
      token = rest.shift() || "";
    } else if (tok === "--cf-id") {
      cfIdOverride = Number(rest.shift() || 0);
    } else if (tok === "--dry-run") {
      dryRun = true;
    } else if (tok.startsWith("-")) {
      console.error(`pgroast publish: unknown option ${tok}`);
      console.error("Run 'pgroast publish --help' for usage.");
      return 2;
    } else if (!target) {
      target = tok;
    } else {
      console.error(`pgroast publish: unexpected argument "${tok}"`);
      return 2;
    }
  }

  if (!target) {
    console.error("pgroast publish: missing path to roast.json or output directory");
    console.error("Run 'pgroast publish --help' for usage.");
    return 2;
  }

  const resolvedTarget = resolve(target);
  const jsonPath = existsSync(resolvedTarget) && statSync(resolvedTarget).isDirectory()
    ? join(resolvedTarget, "roast.json")
    : resolvedTarget;
  if (!existsSync(jsonPath)) {
    console.error(`pgroast publish: file not found: ${jsonPath}`);
    return 1;
  }

  const roast = JSON.parse(readFileSync(jsonPath, "utf8")) as Roast;
  const summaryPath = join(dirname(jsonPath), "roast-summary.txt");
  const summaryTxt = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : undefined;

  const res = await publishRoastOpinion({
    roast,
    summaryTxt,
    cfIdOverride,
    hubUrl,
    token,
    dryRun,
  });

  if (res.dryRun) {
    console.log("DRY RUN (confidentiality gate passed; nothing sent):");
    console.log(JSON.stringify(res.payload, null, 2));
    return 0;
  }
  console.log(`Published roast for CF ${res.cfId} (${res.payload.verdict}, ${res.payload.backend} / ${res.payload.roast_level} / ${res.payload.roast_flavour})`);
  console.log(`View patch page: ${res.patchUrl}`);
  return 0;
}

const LOGIN_USAGE = `Usage: pgroast login --token <pgroast_pub_...> [--hub URL]
       pgroast login --logout
       pgroast whoami

  Saves your publish-only pgroast token locally in ~/.pgroast/auth.json (mode 0600)
  so \`npx pgroast publish\` and \`npx pgroast contribute --publish\` recognize you
  without needing a global install or passing --token every time.

  Note: Local roasting (\`npx pgroast 7388 --level light\`) needs NO login at all —
  it uses your local Claude / Codex / agy CLI login and writes local files only.`;

export async function loginMain(argv: string[], mode: "login" | "whoami" = "login"): Promise<number> {
  if (mode === "whoami") {
    const r = resolvePublishToken();
    if (!r.token) {
      console.log("Not logged in to a pgroast Public App hub.");
      console.log(`Local roasting needs no login. To publish roasts, mint a token at ${DEFAULT_HUB_URL}/?tab=connect and run:`);
      console.log("  npx pgroast@next login --token <pgroast_pub_...>");
      return 0;
    }
    const prefix = r.token.slice(0, 18);
    console.log(`Publish token configured (${prefix}…)`);
    console.log(`Source: ${r.source}`);
    console.log(`Hub:    ${process.env.PGROAST_PUBLIC_HUB_URL || r.hubUrl || DEFAULT_HUB_URL}`);
    return 0;
  }

  let token = "";
  let hubUrl = process.env.PGROAST_PUBLIC_HUB_URL || DEFAULT_HUB_URL;
  let logout = false;
  const rest = [...argv];
  while (rest.length) {
    const tok = rest.shift()!;
    if (tok === "-h" || tok === "--help") {
      console.log(LOGIN_USAGE);
      return 0;
    } else if (tok === "--token") {
      token = rest.shift() || "";
    } else if (tok === "--hub") {
      hubUrl = rest.shift() || DEFAULT_HUB_URL;
    } else if (tok === "--logout") {
      logout = true;
    } else if (!token && tok.startsWith("pgroast_pub_")) {
      token = tok;
    } else {
      console.error(`pgroast login: unknown option ${tok}`);
      console.error("Run 'pgroast login --help' for usage.");
      return 2;
    }
  }

  if (logout) {
    if (existsSync(AUTH_FILE_PATH)) {
      rmSync(AUTH_FILE_PATH, { force: true });
      console.log(`Removed saved publish token (${AUTH_FILE_PATH}).`);
    } else {
      console.log("No saved publish token found.");
    }
    return 0;
  }

  if (!token.trim()) {
    console.log(`How pgroast recognizes you when publishing:`);
    console.log(`  1. Open ${hubUrl.replace(/\/$/, "")}/?tab=connect and mint a publish-only token via GitHub or Google.`);
    console.log(`  2. Save it once locally (mode 0600 in ~/.pgroast/auth.json):`);
    console.log(`     npx pgroast@next login --token <pgroast_pub_...>`);
    console.log(`\nNote: Local roasting (\`npx pgroast@next 7388 --level light\`) needs NO pgroast login.`);
    return 0;
  }

  if (!token.trim().startsWith("pgroast_pub_")) {
    console.error('pgroast login: expected a publish token starting with "pgroast_pub_".');
    return 2;
  }

  saveAuth({ hubUrl, token });
  console.log(`Saved publish token (${token.trim().slice(0, 18)}…) to ${AUTH_FILE_PATH} (mode 0600).`);
  console.log(`Hub: ${hubUrl.replace(/\/$/, "")}`);
  console.log(`Future \`npx pgroast@next publish\` and \`contribute --publish\` runs will recognize you automatically.`);
  return 0;
}
