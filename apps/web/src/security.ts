import { createHash, randomBytes } from "node:crypto";

export interface PublicSafetyResult {
  safe: boolean;
  reasons: string[];
}

const BLOCKED_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "Local machine path (/Users/ or /home/ or C:\\Users\\)", regex: /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\)/i },
  { label: "Session cookie or secret leak", regex: /\b(?:sessionid|csrftoken)\s*=\s*[A-Za-z0-9._-]{8,}/i },
  { label: "Internal harness/gate terminology", regex: /\b(?:pg-correctness-harness|pg-hackers-lead|anti-slop gate|blind verification gate|draft-gate|subagent)\b/i },
  { label: "Internal model codename", regex: /\b(?:claude-(?:fable|mythos)|gemini-4-neon)\b/i },
  { label: "Private key or API token", regex: /\b(?:sk-ant-|sk-proj-|ghp_[A-Za-z0-9]{20,}|pgroast_pub_[A-Za-z0-9]{20,})\b/ },
];

/**
 * Server-side Public-Confidentiality Hard Gate.
 * Prevents private paths, cookies, tokens, or internal harness names from ever landing on pgroast.dev.
 */
export function checkPublicPayloadSafe(payload: unknown): PublicSafetyResult {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  const reasons: string[] = [];
  for (const rule of BLOCKED_PATTERNS) {
    if (rule.regex.test(serialized)) {
      reasons.push(rule.label);
    }
  }
  return { safe: reasons.length === 0, reasons };
}

export function generatePublishToken(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString("base64url");
  const plaintext = `pgroast_pub_${raw}`;
  const hash = hashToken(plaintext);
  return { plaintext, hash, prefix: plaintext.slice(0, 18) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function securityHeaders(kind: "app" | "sandbox_brief" | "json"): Record<string, string> {
  if (kind === "sandbox_brief") {
    return {
      "Content-Security-Policy":
        "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
  }
  if (kind === "json") {
    return {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    };
  }
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com https://lh3.googleusercontent.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}
