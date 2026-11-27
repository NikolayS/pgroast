// pgroast publish <roast.json|dir> [--hub URL] [--token TOK] [--dry-run]
//
// Publishes a sanitized opinion from a finished local roast.json to a pgroast Public App
// (e.g. https://pgroast.postgres.ai). Runs the Public-Confidentiality Hard Gate locally
// before sending anything over HTTP. Never posts to pgsql-hackers or CommitFest.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { normalizeRoastFlavour, normalizeRoastLevel } from "./roast/flavours.ts";
import type { Roast } from "./roast/schema.ts";

export const DEFAULT_HUB_URL = "https://pgroast.postgres.ai";

const SECRET_AND_PATH_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "pgroast publish token", re: /pgroast_pub_[A-Za-z0-9_-]{12,}/ },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "API key", re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/ },
  { name: "session/CSRF cookie", re: /\b(?:sessionid|csrftoken)\s*=\s*[^\s;]{8,}/i },
  { name: "private key header", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "local filesystem path", re: /(?:^|[\s"'`(])\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
  { name: "internal model codename", re: /\b(?:mythos|fable|neon|astra|daybreak)\b/i },
];

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
  models_json: string;
  verdict: string;
  confidence: string;
  summary: string;
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

  const summaryParts: string[] = [];
  if (opts?.summaryTxt && opts.summaryTxt.trim()) {
    summaryParts.push(opts.summaryTxt.trim());
  } else {
    if (roast.verdict_reasoning) summaryParts.push(roast.verdict_reasoning.trim());
    const topObjs = (roast.objections || []).slice(0, 3);
    if (topObjs.length > 0) {
      summaryParts.push(
        "Key objections: " +
          topObjs
            .map((o) => `${o.title}${o.severity === "fatal" ? " [fatal]" : ""}`)
            .join("; "),
      );
    }
  }
  const summary = summaryParts.join("\n\n").slice(0, 3500).trim();

  // Sanitize models object: keep only non-internal model identifiers
  const cleanModels: Record<string, string> = {};
  if (roast.models && typeof roast.models === "object") {
    for (const [k, v] of Object.entries(roast.models)) {
      if (typeof v === "string" && v.trim() && checkPublishConfidentiality(v).ok) {
        cleanModels[k] = v.trim();
      }
    }
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
      `Missing publish token. Mint a publish-only token at ${hubBase}/?tab=connect and set PGROAST_PUBLISH_TOKEN or pass --token.`,
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

  Publishes a sanitized opinion from a local roast.json to the pgroast Public App.
  Runs the Public-Confidentiality Hard Gate locally before sending anything.

Options:
  --hub URL      Public App URL (default: PGROAST_PUBLIC_HUB_URL or ${DEFAULT_HUB_URL})
  --token TOK    Publish-only token (default: PGROAST_PUBLISH_TOKEN)
  --cf-id N      Override CommitFest patch ID if not embedded in roast.json
  --dry-run      Validate and print the sanitized payload without sending
  -h, --help     Show this help`;

export async function publishMain(argv: string[]): Promise<number> {
  let target = "";
  let hubUrl = process.env.PGROAST_PUBLIC_HUB_URL || DEFAULT_HUB_URL;
  let token = process.env.PGROAST_PUBLISH_TOKEN || "";
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
    } else if (tok.startsWith("--")) {
      console.error(`pgroast publish: unknown option ${tok}\n\n${PUBLISH_USAGE}`);
      return 2;
    } else if (!target) {
      target = tok;
    } else {
      console.error(`pgroast publish: unexpected argument "${tok}"`);
      return 2;
    }
  }

  if (!target) {
    console.error(`pgroast publish: missing path to roast.json or output directory\n\n${PUBLISH_USAGE}`);
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
  console.log(`Published opinion for CF ${res.cfId} (${res.payload.verdict}, ${res.payload.backend} / ${res.payload.roast_level} / ${res.payload.roast_flavour})`);
  console.log(`View patch page: ${res.patchUrl}`);
  return 0;
}
