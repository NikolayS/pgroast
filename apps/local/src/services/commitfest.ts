import type { AppDatabase } from "../db.ts";
import { nowIso } from "../db.ts";
import type { CfBotStats, CfEntryRecord } from "../types.ts";

export const CF_BASE = "https://commitfest.postgresql.org";

export interface CommitFestSummary {
  id: number;
  name: string;
  status: string;
  startdate?: string;
  enddate?: string;
  draft?: boolean;
}

export interface ApiPatchThread {
  messageid: string;
  subject: string;
  latest_message_id?: string;
  latest_message_time?: string;
  has_attachment?: boolean;
  mailthread_id?: number;
}

export interface ApiPatchItem {
  id: number;
  name?: string;
  title?: string;
  status?: string;
  topic?: string;
  authors?: string | string[];
  reviewers?: string | string[];
  committer?: string;
  target_version?: string;
  threads?: ApiPatchThread[];
  cfbot_results?: Record<string, unknown>;
}

export interface ParsedPatchHtml {
  cfId: number;
  title: string;
  status: string;
  topic: string;
  authors: string;
  reviewers: string;
  committer: string;
  targetVersion: string;
  csrfToken: string;
  threadUrl: string;
  latestMessageId: string;
  mailthreadId: string;
  cfbotStatus: string;
  cfbotBuildUrl: string;
  cfbotApplyUrl: string;
  cfbotStats: CfBotStats;
  attachments: string[];
}

export interface ParsedMeEntry {
  cfId: number;
  title: string;
  status: string;
  role: "author" | "reviewer" | "committer" | "subscribed";
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTableValue(html: string, labelPattern: RegExp): string {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1] ?? "";
    const thMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    const tdMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!thMatch || !tdMatch) continue;
    const label = stripTags(thMatch[1] ?? "");
    if (labelPattern.test(label)) {
      return stripTags(tdMatch[1] ?? "");
    }
  }
  return "";
}

function extractTableCellHtml(html: string, labelPattern: RegExp): string {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1] ?? "";
    const thMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    const tdMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!thMatch || !tdMatch) continue;
    const label = stripTags(thMatch[1] ?? "");
    if (labelPattern.test(label)) {
      return tdMatch[1] ?? "";
    }
  }
  return "";
}

export function parsePatchHtml(cfId: number, html: string): ParsedPatchHtml {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = h1Match ? stripTags(h1Match[1] ?? "") : stripTags(titleTagMatch?.[1] ?? "");
  const title = rawTitle.replace(/\s*-\s*PostgreSQL Commitfest.*$/i, "").trim();

  const csrfMatch = html.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i)
    || html.match(/value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i);
  const csrfToken = csrfMatch?.[1] ?? "";

  const status = extractTableValue(html, /^status$/i);
  const topic = extractTableValue(html, /^topic$/i);
  const authors = extractTableValue(html, /^authors?$/i);
  const reviewers = extractTableValue(html, /^reviewers?$/i);
  const committer = extractTableValue(html, /^committer$/i);
  const targetVersion = extractTableValue(html, /^target version$/i);

  // Thread links
  const threadMatch = html.match(/https:\/\/www\.postgresql\.org\/message-id\/(?:flat\/)?([^\s"'<>]+)/i);
  const threadUrl = threadMatch ? threadMatch[0] : "";
  const latestMessageId = threadMatch?.[1] ? decodeURIComponent(threadMatch[1]) : "";

  const mailthreadMatch = html.match(/annotateMessage\(\s*(\d+)\s*,/i)
    || html.match(/data-mailthread-id=["'](\d+)["']/i);
  const mailthreadId = mailthreadMatch?.[1] ?? "";

  // CI (CFBot) section
  const cfbotHtml = extractTableCellHtml(html, /ci\s*\(cfbot\)|cfbot/i) || html;
  const cfbotText = stripTags(cfbotHtml);
  let cfbotStatus = "";
  if (/needs rebase/i.test(cfbotText)) cfbotStatus = "needs_rebase";
  else if (/failing since|failed/i.test(cfbotText)) cfbotStatus = "failing";
  else if (/passed|success|does not need rebase/i.test(cfbotText)) cfbotStatus = "passing";
  else if (/waiting/i.test(cfbotText)) cfbotStatus = "waiting";

  const buildUrlMatch = cfbotHtml.match(/https:\/\/github\.com\/postgres\/postgres-cfbot\/actions\/runs\/\d+(?:\/attempts\/\d+)?/i);
  const applyUrlMatch = cfbotHtml.match(/href=["']([^"']*(?:apply|patch|cfbot)[^"']*)["'][^>]*>[^<]*(?:Needs rebase|Failing|apply)/i);

  const cfbotStats: CfBotStats = {
    summaryText: cfbotText.slice(0, 300),
    needsRebase: cfbotStatus === "needs_rebase",
    failing: cfbotStatus === "failing",
  };

  const verMatch = html.match(/Patch version:\s*([^\s,<]+)/i);
  if (verMatch?.[1]) cfbotStats.version = verMatch[1];
  const cntMatch = html.match(/Patch count:\s*(\d+)/i);
  if (cntMatch?.[1]) cfbotStats.patchCount = Number(cntMatch[1]);
  const firstDiff = html.match(/First patch:\s*\+(\d+)[−-](\d+)/i);
  if (firstDiff?.[1] && firstDiff?.[2]) {
    cfbotStats.firstAdditions = Number(firstDiff[1]);
    cfbotStats.firstDeletions = Number(firstDiff[2]);
  }
  const allDiff = html.match(/All patches:\s*\+(\d+)[−-](\d+)/i);
  if (allDiff?.[1] && allDiff?.[2]) {
    cfbotStats.allAdditions = Number(allDiff[1]);
    cfbotStats.allDeletions = Number(allDiff[2]);
  }

  // Extract CFBot job links
  const jobs: Array<{ name: string; status: string; url: string }> = [];
  const jobRegex = /<a[^>]*href=["'](https:\/\/github\.com\/postgres\/postgres-cfbot\/actions\/runs\/\d+\/job\/\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jobRegex.exec(cfbotHtml)) !== null) {
    const url = jm[1] ?? "";
    const label = stripTags(jm[2] ?? "");
    const statusGuess = /fail|error/i.test(label) ? "fail" : /pass|ok|success/i.test(label) ? "pass" : "info";
    jobs.push({ name: label || "CI job", status: statusGuess, url });
  }
  if (jobs.length > 0) cfbotStats.jobs = jobs;

  // Attachments mentioned on patch page
  const attachmentSet = new Set<string>();
  const attRegex = /([A-Za-z0-9._-]+\.(?:patch|diff)(?:\.(?:gz|bz2|txt))?)/g;
  let am: RegExpExecArray | null;
  while ((am = attRegex.exec(html)) !== null) {
    if (am[1]) attachmentSet.add(am[1]);
  }

  return {
    cfId,
    title,
    status,
    topic,
    authors,
    reviewers,
    committer,
    targetVersion,
    csrfToken,
    threadUrl,
    latestMessageId,
    mailthreadId,
    cfbotStatus,
    cfbotBuildUrl: buildUrlMatch?.[0] ?? "",
    cfbotApplyUrl: applyUrlMatch?.[1] ?? "",
    cfbotStats,
    attachments: Array.from(attachmentSet),
  };
}

export function parseMeHtml(html: string, expectedUsername: string): {
  authenticated: boolean;
  username: string | null;
  entries: ParsedMeEntry[];
} {
  if (
    /postgresql\.org\/account\/auth/i.test(html) ||
    /The website you are trying to log in to/i.test(html) ||
    />Log in<\/a>/i.test(html) && !/Log out/i.test(html)
  ) {
    return { authenticated: false, username: null, entries: [] };
  }

  const userMatch = html.match(/Logged in as\s*<[^>]*>([^<]+)</i)
    || html.match(/\/me\/"[^>]*>([^<]+)</i);
  const detectedUser = userMatch?.[1]?.trim() || expectedUsername || null;

  const entries: ParsedMeEntry[] = [];
  const seen = new Set<string>();

  // Split by headings to detect role sections (Author, Reviewer, Committer)
  const sections = html.split(/<h[23][^>]*>/i);
  let currentRole: ParsedMeEntry["role"] = "reviewer";
  for (const sec of sections) {
    const headingEnd = sec.indexOf("</h");
    if (headingEnd !== -1) {
      const heading = stripTags(sec.slice(0, headingEnd)).toLowerCase();
      if (heading.includes("author")) currentRole = "author";
      else if (heading.includes("committer")) currentRole = "committer";
      else if (heading.includes("review")) currentRole = "reviewer";
      else if (heading.includes("subscrib")) currentRole = "subscribed";
    }

    const linkRegex = /<a[^>]*href=["']\/patch\/(\d+)\/["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(sec)) !== null) {
      const cfId = Number(m[1]);
      if (!Number.isInteger(cfId) || cfId <= 0) continue;
      const title = stripTags(m[2] ?? "");
      const key = `${cfId}:${currentRole}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ cfId, title, status: "", role: currentRole });
    }
  }

  return {
    authenticated: true,
    username: detectedUser,
    entries,
  };
}

function normalizeNameList(val: string | string[] | undefined): string {
  if (!val) return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

export async function fetchCommitFests(): Promise<CommitFestSummary[]> {
  const res = await fetch(`${CF_BASE}/api/v1/commitfests`, {
    headers: { Accept: "application/json", "User-Agent": "pgroast-app/0.1" },
  });
  if (!res.ok) {
    throw new Error(`CommitFest API /commitfests returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as CommitFestSummary[] | { commitfests?: CommitFestSummary[] };
  return Array.isArray(data) ? data : data.commitfests ?? [];
}

export async function fetchPatchThreads(cfId: number): Promise<ApiPatchThread[]> {
  const res = await fetch(`${CF_BASE}/api/v1/patches/${cfId}/threads`, {
    headers: { Accept: "application/json", "User-Agent": "pgroast-app/0.1" },
  });
  if (!res.ok) {
    throw new Error(`CommitFest API /patches/${cfId}/threads returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as ApiPatchThread[] | { threads?: ApiPatchThread[] };
  return Array.isArray(data) ? data : data.threads ?? [];
}

export async function syncCommitFest(
  db: AppDatabase,
  cfNumber: number,
): Promise<{ cfNumber: number; synced: number }> {
  const url = `${CF_BASE}/api/v1/commitfests/${cfNumber}/patches?include=threads`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "pgroast-app/0.1" },
  });
  if (!res.ok) {
    throw new Error(`CommitFest API /commitfests/${cfNumber}/patches returned HTTP ${res.status}`);
  }
  const payload = (await res.json()) as ApiPatchItem[] | { patches?: ApiPatchItem[] };
  const patches = Array.isArray(payload) ? payload : payload.patches ?? [];
  const syncTime = nowIso();

  for (const p of patches) {
    if (!p.id) continue;
    const latestThread = p.threads && p.threads.length > 0 ? p.threads[p.threads.length - 1] : undefined;
    const threadUrl = latestThread?.messageid
      ? `https://www.postgresql.org/message-id/flat/${encodeURIComponent(latestThread.messageid)}`
      : "";
    await db.upsertEntryMetadata({
      cf_id: Number(p.id),
      cf_number: cfNumber,
      title: p.name || p.title || `CF ${p.id}`,
      status: p.status || "",
      topic: p.topic || "",
      authors: normalizeNameList(p.authors),
      reviewers: normalizeNameList(p.reviewers),
      committer: p.committer || "",
      target_version: p.target_version || "",
      thread_url: threadUrl,
      latest_message_id: latestThread?.latest_message_id || latestThread?.messageid || "",
      latest_message_time: latestThread?.latest_message_time || "",
      cfbot_branch: `cf/${p.id}`,
      synced_at: syncTime,
    });
  }

  await db.logAudit("cf_sync", `cf:${cfNumber}`, { synced: patches.length });
  return { cfNumber, synced: patches.length };
}

export async function refreshSinglePatch(
  db: AppDatabase,
  cfId: number,
): Promise<{ entry: CfEntryRecord | null; parsed: ParsedPatchHtml; threads: ApiPatchThread[] }> {
  const [pageRes, threads] = await Promise.all([
    fetch(`${CF_BASE}/patch/${cfId}/`, {
      headers: { "User-Agent": "pgroast-app/0.1" },
    }),
    fetchPatchThreads(cfId).catch(() => [] as ApiPatchThread[]),
  ]);

  if (!pageRes.ok) {
    throw new Error(`CommitFest /patch/${cfId}/ returned HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();
  const parsed = parsePatchHtml(cfId, html);
  const latestThread = threads[threads.length - 1];

  await db.upsertEntryMetadata({
    cf_id: cfId,
    title: parsed.title,
    status: parsed.status,
    topic: parsed.topic,
    authors: parsed.authors,
    reviewers: parsed.reviewers,
    committer: parsed.committer,
    target_version: parsed.targetVersion,
    thread_url:
      parsed.threadUrl ||
      (latestThread?.messageid
        ? `https://www.postgresql.org/message-id/flat/${encodeURIComponent(latestThread.messageid)}`
        : ""),
    latest_message_id: latestThread?.latest_message_id || parsed.latestMessageId,
    latest_message_time: latestThread?.latest_message_time || "",
    cfbot_status: parsed.cfbotStatus,
    cfbot_branch: `cf/${cfId}`,
    cfbot_build_url: parsed.cfbotBuildUrl,
    cfbot_apply_url: parsed.cfbotApplyUrl,
    cfbot_stats_json: JSON.stringify(parsed.cfbotStats),
    attachments_json: parsed.attachments.length ? JSON.stringify(parsed.attachments) : "[]",
    synced_at: nowIso(),
  });

  return { entry: await db.getEntry(cfId), parsed, threads };
}

function buildCookieHeader(sessionid: string, csrftoken: string): string {
  const parts: string[] = [];
  if (sessionid) parts.push(`sessionid=${sessionid}`);
  if (csrftoken) parts.push(`csrftoken=${csrftoken}`);
  return parts.join("; ");
}

export async function verifyCfLogin(db: AppDatabase): Promise<{
  authenticated: boolean;
  username: string | null;
  syncedMine: number;
  entries: ParsedMeEntry[];
}> {
  const { sessionid, csrftoken } = await db.getCfCookiesDecrypted();
  if (!sessionid) {
    throw new Error("No CommitFest sessionid cookie configured. Paste cookies in Settings first.");
  }
  const settings = await db.getSettings();
  const res = await fetch(`${CF_BASE}/me/`, {
    headers: {
      Cookie: buildCookieHeader(sessionid, csrftoken),
      "User-Agent": "pgroast-app/0.1",
    },
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") || "";
    if (loc.includes("account/auth") || loc.includes("login")) {
      await db.logAudit("cf_verify_login", "me", { authenticated: false, redirect: loc }, "error");
      return { authenticated: false, username: null, syncedMine: 0, entries: [] };
    }
  }

  const html = await res.text();
  const parsed = parseMeHtml(html, settings.cfUsername);
  if (!parsed.authenticated) {
    await db.logAudit("cf_verify_login", "me", { authenticated: false }, "error");
    return { authenticated: false, username: null, syncedMine: 0, entries: [] };
  }

  const verifiedUser = parsed.username || settings.cfUsername;
  await db.setCfVerified(verifiedUser);

  for (const item of parsed.entries) {
    await db.upsertEntryMetadata({
      cf_id: item.cfId,
      title: item.title,
      is_mine: 1,
      mine_role: item.role,
      synced_at: nowIso(),
    });
  }

  await db.logAudit("cf_verify_login", "me", { authenticated: true, username: verifiedUser, count: parsed.entries.length });
  return {
    authenticated: true,
    username: verifiedUser,
    syncedMine: parsed.entries.length,
    entries: parsed.entries,
  };
}

async function authenticatedCfPost(
  db: AppDatabase,
  cfId: number,
  endpointPath: string,
  extraFormFields?: Record<string, string>,
  isAjax = false,
): Promise<{ status: number; location: string; ok: boolean; snippet: string }> {
  const { sessionid, csrftoken } = await db.getCfCookiesDecrypted();
  if (!sessionid) {
    throw new Error("CommitFest sessionid cookie is not configured. Import cookies in Settings first.");
  }

  const referer = `${CF_BASE}/patch/${cfId}/`;
  let effectiveCsrf = csrftoken;

  // Fetch fresh CSRF token from patch page
  const getRes = await fetch(referer, {
    headers: {
      Cookie: buildCookieHeader(sessionid, csrftoken),
      "User-Agent": "pgroast-app/0.1",
    },
    redirect: "manual",
  });
  if (getRes.status >= 300 && (getRes.headers.get("location") || "").includes("login")) {
    throw new Error("CommitFest session expired (redirected to login). Re-import cookies in Settings.");
  }
  const pageHtml = await getRes.text();
  const parsed = parsePatchHtml(cfId, pageHtml);
  if (parsed.csrfToken) {
    effectiveCsrf = parsed.csrfToken;
  }

  // Update csrftoken if server sent a Set-Cookie
  const setCookie = getRes.headers.get("set-cookie") || "";
  const cookieCsrfMatch = setCookie.match(/csrftoken=([^;]+)/);
  const cookieCsrf = cookieCsrfMatch?.[1] || csrftoken || effectiveCsrf;

  const form = new URLSearchParams();
  if (!isAjax && effectiveCsrf) {
    form.set("csrfmiddlewaretoken", effectiveCsrf);
  }
  if (extraFormFields) {
    for (const [k, v] of Object.entries(extraFormFields)) {
      form.set(k, v);
    }
  }

  const postRes = await fetch(`${CF_BASE}${endpointPath}`, {
    method: "POST",
    headers: {
      Cookie: buildCookieHeader(sessionid, cookieCsrf),
      Referer: referer,
      Origin: CF_BASE,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(effectiveCsrf ? { "X-CSRFToken": effectiveCsrf } : {}),
      "User-Agent": "pgroast-app/0.1",
    },
    body: form.toString(),
    redirect: "manual",
  });

  const location = postRes.headers.get("location") || "";
  const bodyText = await postRes.text();
  const ok = postRes.status >= 200 && postRes.status < 400 && !location.includes("login");
  return {
    status: postRes.status,
    location,
    ok,
    snippet: stripTags(bodyText).slice(0, 240),
  };
}

export async function performCfMutatingAction(
  db: AppDatabase,
  cfId: number,
  action:
    | { type: "reviewer_become" }
    | { type: "reviewer_remove" }
    | { type: "status"; status: "review" | "author" | "committer" }
    | { type: "annotate"; mailthreadId: string; messageId: string; text: string }
    | { type: "cfbot_requeue" },
  confirm: boolean,
): Promise<{ ok: boolean; status: number; location: string; snippet: string }> {
  if (!confirm) {
    await db.logAudit(`cf_${action.type}`, `patch/${cfId}`, { reason: "confirm=true required" }, "blocked");
    throw new Error("Explicit confirmation (confirm: true) is required for all CommitFest mutations.");
  }

  let endpoint = "";
  let extraFields: Record<string, string> | undefined;
  let isAjax = false;

  switch (action.type) {
    case "reviewer_become":
      endpoint = `/patch/${cfId}/reviewer/become/`;
      break;
    case "reviewer_remove":
      endpoint = `/patch/${cfId}/reviewer/remove/`;
      break;
    case "status":
      if (!["review", "author", "committer"].includes(action.status)) {
        throw new Error(`Invalid CommitFest status action: ${action.status}`);
      }
      endpoint = `/patch/${cfId}/status/${action.status}/`;
      break;
    case "annotate":
      if (!action.text.trim()) throw new Error("Annotation text cannot be empty.");
      if (action.text.length > 500) {
        throw new Error(`Annotation exceeds 500-character CommitFest limit (${action.text.length} chars).`);
      }
      endpoint = `/ajax/annotateMessage/`;
      isAjax = true;
      extraFields = {
        t: action.mailthreadId,
        msgid: action.messageId,
        msg: action.text.trim(),
      };
      break;
    case "cfbot_requeue":
      endpoint = `/patch/${cfId}/cfbot_requeue/`;
      break;
  }

  const res = await authenticatedCfPost(db, cfId, endpoint, extraFields, isAjax);
  await db.logAudit(
    `cf_${action.type}`,
    `patch/${cfId}`,
    { endpoint, httpStatus: res.status, location: res.location },
    res.ok ? "ok" : "error",
  );
  return res;
}
