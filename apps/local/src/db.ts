import { SQL } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_DIR,
  decryptSecret,
  DEFAULT_DATABASE_URL,
  encryptSecret,
  expandHome,
  getDefaultSettings,
  SECRET_KEY_PATH,
} from "./config.ts";
import { parseEntryQuery } from "./services/query.ts";
import type {
  AppSettings,
  AuditLogRecord,
  BugReportRecord,
  CfAuthStatus,
  CfEntryListItem,
  CfEntryRecord,
  DiffCommentRecord,
  DraftRecord,
  EntryTriageRecord,
  JobKind,
  JobRecord,
  JobStatus,
  RoastJson,
  RoastRunRecord,
  SavedSearchRecord,
  WorkItemRecord,
} from "./types.ts";

const SECRET_SETTING_KEYS = new Set(["cf_sessionid_enc", "cf_csrftoken_enc", "hub_token_enc"]);

export function nowIso(): string {
  return new Date().toISOString();
}

export function countNewObjections(roast: RoastJson): number {
  const list = roast.objections ?? [];
  if (list.length === 0) return 0;
  let explicit = 0;
  let hasExplicitField = false;
  for (const obj of list) {
    if (obj.novelty) {
      hasExplicitField = true;
      if (obj.novelty === "new" || obj.novelty === "revisits_precedent") {
        explicit++;
      }
    }
  }
  if (hasExplicitField) return explicit;
  let inferred = 0;
  for (const obj of list) {
    const hasPrecedent = (obj.precedent_ids?.length ?? 0) > 0 || (obj.precedents?.length ?? 0) > 0;
    const refs = obj.thread_message_refs?.length ?? 0;
    if (hasPrecedent || refs <= 1) inferred++;
  }
  return inferred;
}

export function computeQuickScore(roast: RoastJson): number {
  let score = 50;
  if (roast.verdict === "NO-FUNDAMENTAL-OBJECTION") score += 35;
  else if (roast.verdict === "NEEDS-COMMITTER-EYES") score += 20;
  else if (roast.verdict === "NEEDS-DESIGN-DISCUSSION") score -= 15;
  else if (roast.verdict === "LIKELY-REJECT") score -= 45;

  if (roast.confidence === "high") score += 8;
  else if (roast.confidence === "low") score -= 5;

  const status = (roast.input?.cf?.status || "").toLowerCase();
  if (status.includes("ready for committer")) score += 15;
  else if (status.includes("waiting on author")) score -= 8;

  const audience = roast.priority?.audience || "";
  if (audience === "most users") score += 12;
  else if (audience === "a sizeable minority") score += 6;
  else if (audience === "niche") score -= 6;

  const action = roast.priority?.recommended_action || "";
  if (action === "proceed" || action === "needs champion") score += 10;
  else if (action === "park" || action === "close: dead or superseded" || action === "withdraw and resubmit") {
    score -= 20;
  }

  const objs = roast.objections ?? [];
  const fatalCount = objs.filter((o) => o.severity === "fatal").length;
  score -= fatalCount * 20;
  score -= Math.min(objs.length, 6) * 3;
  return Math.max(0, Math.min(100, score));
}

function validateIdentifier(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid PostgreSQL identifier: "${ident}"`);
  }
  return ident;
}

async function ensureLocalDatabaseExists(databaseUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return;
  }
  const host = (parsed.hostname || "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    return;
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName || dbName === "postgres" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    return;
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  let admin: SQL | null = null;
  try {
    admin = new SQL(adminUrl.toString());
    const rows = await admin.unsafe("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } catch {
    // If maintenance DB is unreachable or user lacks CREATEDB, let main connect surface the real error
  } finally {
    if (admin) {
      try {
        await admin.close();
      } catch {
        // ignore
      }
    }
  }
}

export interface AppDatabaseOptions {
  databaseUrl?: string;
  schema?: string;
  secretKeyPath?: string;
}

export class AppDatabase {
  public readonly sql: SQL;
  public readonly databaseUrl: string;
  public readonly schema: string;
  public readonly secretKeyPath: string;
  private pgVersionCache = "";

  private constructor(sql: SQL, databaseUrl: string, schema: string, secretKeyPath: string) {
    this.sql = sql;
    this.databaseUrl = databaseUrl;
    this.schema = schema;
    this.secretKeyPath = secretKeyPath;
  }

  static async create(opts?: AppDatabaseOptions): Promise<AppDatabase> {
    const databaseUrl = opts?.databaseUrl || DEFAULT_DATABASE_URL;
    const schema = validateIdentifier(opts?.schema || "public");
    const secretKeyPath = opts?.secretKeyPath || SECRET_KEY_PATH;
    mkdirSync(DATA_DIR, { recursive: true });

    await ensureLocalDatabaseExists(databaseUrl);
    const sql = new SQL(databaseUrl);
    const instance = new AppDatabase(sql, databaseUrl, schema, secretKeyPath);
    await instance.initSchema();
    return instance;
  }

  public t(table: string): string {
    return this.schema === "public" ? table : `"${this.schema}".${table}`;
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  async dropSchemaAndClose(): Promise<void> {
    if (this.schema !== "public") {
      await this.sql.unsafe(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`);
    }
    await this.sql.close();
  }

  async getServerInfo(): Promise<{ version: string; database: string; schema: string }> {
    const rows = await this.sql.unsafe("SELECT version() AS ver, current_database() AS db");
    const ver = String(rows[0]?.ver || "");
    this.pgVersionCache = ver;
    return {
      version: ver,
      database: String(rows[0]?.db || ""),
      schema: this.schema,
    };
  }

  getCachedPgVersion(): string {
    return this.pgVersionCache;
  }

  private async initSchema(): Promise<void> {
    if (this.schema !== "public") {
      await this.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
    }

    const statements = [
      `CREATE TABLE IF NOT EXISTS ${this.t("settings")} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ${this.t("cf_entries")} (
        cf_id INTEGER PRIMARY KEY,
        cf_number INTEGER,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        topic TEXT NOT NULL DEFAULT '',
        authors TEXT NOT NULL DEFAULT '',
        reviewers TEXT NOT NULL DEFAULT '',
        committer TEXT NOT NULL DEFAULT '',
        target_version TEXT NOT NULL DEFAULT '',
        thread_url TEXT NOT NULL DEFAULT '',
        latest_message_id TEXT NOT NULL DEFAULT '',
        latest_message_time TEXT NOT NULL DEFAULT '',
        cfbot_status TEXT NOT NULL DEFAULT '',
        cfbot_branch TEXT NOT NULL DEFAULT '',
        cfbot_build_url TEXT NOT NULL DEFAULT '',
        cfbot_apply_url TEXT NOT NULL DEFAULT '',
        cfbot_stats_json TEXT NOT NULL DEFAULT '{}',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        verdict TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT '',
        objection_count INTEGER NOT NULL DEFAULT 0,
        new_objection_count INTEGER NOT NULL DEFAULT 0,
        prior_attempts_count INTEGER NOT NULL DEFAULT 0,
        priority_action TEXT NOT NULL DEFAULT '',
        recommended_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        roast_json TEXT NOT NULL DEFAULT '',
        roast_md TEXT NOT NULL DEFAULT '',
        pushback_json TEXT NOT NULL DEFAULT '',
        pushback_md TEXT NOT NULL DEFAULT '',
        is_mine INTEGER NOT NULL DEFAULT 0,
        mine_role TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        synced_at TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cf_entries_verdict ON ${this.t("cf_entries")}(verdict)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cf_entries_status ON ${this.t("cf_entries")}(status)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cf_entries_score ON ${this.t("cf_entries")}(recommended_score DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cf_entries_mine ON ${this.t("cf_entries")}(is_mine)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cf_entries_fts ON ${this.t("cf_entries")} USING GIN (to_tsvector('english', title || ' ' || authors || ' ' || reviewers || ' ' || committer || ' ' || topic))`,

      `CREATE TABLE IF NOT EXISTS ${this.t("roast_runs")} (
        id SERIAL PRIMARY KEY,
        cf_id INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'review',
        roast_level TEXT NOT NULL DEFAULT 'medium',
        roast_flavour TEXT NOT NULL DEFAULT 'default',
        backend TEXT NOT NULL DEFAULT 'claude',
        models_json TEXT NOT NULL DEFAULT '{}',
        rounds INTEGER NOT NULL DEFAULT 0,
        verdict TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT '',
        roast_json TEXT NOT NULL DEFAULT '',
        roast_md TEXT NOT NULL DEFAULT '',
        summary_txt TEXT NOT NULL DEFAULT '',
        contributor_name TEXT NOT NULL DEFAULT '',
        contributor_handle TEXT NOT NULL DEFAULT '',
        contributor_provider TEXT NOT NULL DEFAULT 'local',
        contributor_avatar TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `ALTER TABLE ${this.t("roast_runs")} ADD COLUMN IF NOT EXISTS contributor_name TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE ${this.t("roast_runs")} ADD COLUMN IF NOT EXISTS contributor_handle TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE ${this.t("roast_runs")} ADD COLUMN IF NOT EXISTS contributor_provider TEXT NOT NULL DEFAULT 'local'`,
      `ALTER TABLE ${this.t("roast_runs")} ADD COLUMN IF NOT EXISTS contributor_avatar TEXT NOT NULL DEFAULT ''`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_roast_runs_cf_id ON ${this.t("roast_runs")}(cf_id, created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("jobs")} (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        cf_id INTEGER,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        backend TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL DEFAULT '',
        worktree_path TEXT NOT NULL DEFAULT '',
        pid INTEGER,
        pgid INTEGER,
        log_path TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        result_json TEXT NOT NULL DEFAULT '{}',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_jobs_created ON ${this.t("jobs")}(created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("work_items")} (
        id SERIAL PRIMARY KEY,
        cf_id INTEGER,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        upstream_base_sha TEXT NOT NULL DEFAULT '',
        target_branch TEXT NOT NULL DEFAULT 'master',
        patch_hashes_json TEXT NOT NULL DEFAULT '[]',
        suites_run_json TEXT NOT NULL DEFAULT '[]',
        worktree_path TEXT NOT NULL DEFAULT '',
        evidence_md TEXT NOT NULL DEFAULT '',
        github_issue_number INTEGER,
        github_issue_url TEXT NOT NULL DEFAULT '',
        ci_branch TEXT NOT NULL DEFAULT '',
        is_security INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_work_items_cf_id ON ${this.t("work_items")}(cf_id)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("drafts")} (
        id SERIAL PRIMARY KEY,
        cf_id INTEGER,
        work_item_id INTEGER,
        kind TEXT NOT NULL DEFAULT 'review',
        is_reply INTEGER NOT NULL DEFAULT 1,
        is_other_author_thread INTEGER NOT NULL DEFAULT 1,
        thread_id TEXT NOT NULL DEFAULT '',
        in_reply_to TEXT NOT NULL DEFAULT '',
        references_header TEXT NOT NULL DEFAULT '',
        to_addrs TEXT NOT NULL DEFAULT '',
        cc_addrs TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        gate_results_json TEXT NOT NULL DEFAULT '{}',
        gmail_draft_id TEXT NOT NULL DEFAULT '',
        gmail_draft_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_drafts_cf_id ON ${this.t("drafts")}(cf_id, updated_at DESC)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("bug_reports")} (
        id SERIAL PRIMARY KEY,
        message_id TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL,
        sender TEXT NOT NULL DEFAULT '',
        thread_url TEXT NOT NULL DEFAULT '',
        reported_at TEXT NOT NULL DEFAULT '',
        classification TEXT NOT NULL DEFAULT 'unclear',
        severity TEXT NOT NULL DEFAULT 'unknown',
        confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
        production_signals_json TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        affected_versions TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        work_item_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_bug_reports_class ON ${this.t("bug_reports")}(classification, severity)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("audit_log")} (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ok',
        created_at TEXT NOT NULL
      )`,
      `ALTER TABLE ${this.t("roast_runs")} ADD COLUMN IF NOT EXISTS roast_level TEXT NOT NULL DEFAULT 'medium'`,
      `ALTER TABLE ${this.t("roast_runs")} ADD COLUMN IF NOT EXISTS roast_flavour TEXT NOT NULL DEFAULT 'default'`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_audit_log_created ON ${this.t("audit_log")}(created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("entry_triage")} (
        cf_id INTEGER PRIMARY KEY,
        starred INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        visited_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_entry_triage_starred ON ${this.t("entry_triage")}(starred)`,

      `CREATE TABLE IF NOT EXISTS ${this.t("saved_searches")} (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        query TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ${this.t("diff_comments")} (
        id SERIAL PRIMARY KEY,
        cf_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        line_num INTEGER NOT NULL,
        line_type TEXT NOT NULL DEFAULT 'add',
        code_snippet TEXT NOT NULL DEFAULT '',
        comment_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_diff_comments_cf ON ${this.t("diff_comments")}(cf_id, file_path, line_num)`,
    ];

    for (const stmt of statements) {
      await this.sql.unsafe(stmt);
    }

    const verRows = await this.sql.unsafe("SELECT version() AS ver");
    this.pgVersionCache = String(verRows[0]?.ver || "");
  }

  // ---------------- Settings ----------------

  async getRawSetting(key: string): Promise<string | null> {
    const rows = await this.sql.unsafe(`SELECT value FROM ${this.t("settings")} WHERE key = $1`, [key]);
    return rows[0] ? String(rows[0].value) : null;
  }

  async setRawSetting(key: string, value: string): Promise<void> {
    await this.sql.unsafe(
      `INSERT INTO ${this.t("settings")} (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [key, value, nowIso()],
    );
  }

  async getSettings(): Promise<AppSettings> {
    const defaults = getDefaultSettings();
    const rows = (await this.sql.unsafe(`SELECT key, value FROM ${this.t("settings")}`)) as Array<{ key: string; value: string }>;
    const merged: Record<string, unknown> = { ...defaults };
    for (const row of rows) {
      if (SECRET_SETTING_KEYS.has(row.key) || row.key.startsWith("cf_auth_")) continue;
      if (row.key in defaults) {
        if (row.key === "port") {
          const n = Number(row.value);
          if (Number.isFinite(n) && n > 0) merged.port = n;
        } else if (row.key === "onboardingCompleted") {
          merged.onboardingCompleted = row.value === "true" || row.value === "1";
        } else {
          merged[row.key] = row.value;
        }
      }
    }
    return merged as unknown as AppSettings;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const defaults = getDefaultSettings();
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      if (k === "host") continue; // Always bind 127.0.0.1 for local security
      if (k in defaults) {
        await this.setRawSetting(k, String(v));
      }
    }
    return this.getSettings();
  }

  async setCfCookies(sessionId: string, csrfToken: string): Promise<void> {
    if (sessionId.trim()) {
      await this.setRawSetting("cf_sessionid_enc", encryptSecret(sessionId.trim(), this.secretKeyPath));
    }
    if (csrfToken.trim()) {
      await this.setRawSetting("cf_csrftoken_enc", encryptSecret(csrfToken.trim(), this.secretKeyPath));
    }
  }

  async clearCfCookies(): Promise<void> {
    await this.sql.unsafe(
      `DELETE FROM ${this.t("settings")} WHERE key IN ('cf_sessionid_enc', 'cf_csrftoken_enc', 'cf_auth_verified_at', 'cf_auth_verified_user')`,
    );
  }

  async getCfCookiesDecrypted(): Promise<{ sessionid: string; csrftoken: string }> {
    const sidEnc = (await this.getRawSetting("cf_sessionid_enc")) || "";
    const csrfEnc = (await this.getRawSetting("cf_csrftoken_enc")) || "";
    return {
      sessionid: decryptSecret(sidEnc, this.secretKeyPath),
      csrftoken: decryptSecret(csrfEnc, this.secretKeyPath),
    };
  }

  async setCfVerified(username: string): Promise<void> {
    await this.setRawSetting("cf_auth_verified_at", nowIso());
    await this.setRawSetting("cf_auth_verified_user", username);
  }

  async getCfAuthStatus(): Promise<CfAuthStatus> {
    const [settings, cookies, lastVerifiedAt, verifiedUser] = await Promise.all([
      this.getSettings(),
      this.getCfCookiesDecrypted(),
      this.getRawSetting("cf_auth_verified_at"),
      this.getRawSetting("cf_auth_verified_user"),
    ]);
    return {
      username: settings.cfUsername,
      hasSessionCookie: Boolean(cookies.sessionid),
      hasCsrfToken: Boolean(cookies.csrftoken),
      lastVerifiedAt,
      verifiedUser,
    };
  }

  // Encrypted Public Companion publish-only token (never returned in plaintext)
  async setHubToken(token: string): Promise<void> {
    if (token.trim()) {
      await this.setRawSetting("hub_token_enc", encryptSecret(token.trim(), this.secretKeyPath));
    }
  }

  async clearHubToken(): Promise<void> {
    await this.sql.unsafe(`DELETE FROM ${this.t("settings")} WHERE key = 'hub_token_enc'`);
  }

  async getHubTokenDecrypted(): Promise<string> {
    const enc = (await this.getRawSetting("hub_token_enc")) || "";
    return decryptSecret(enc, this.secretKeyPath);
  }

  async getHubStatus(): Promise<{ url: string; hasToken: boolean }> {
    const [settings, tok] = await Promise.all([this.getSettings(), this.getHubTokenDecrypted()]);
    return { url: settings.publicHubUrl || "", hasToken: Boolean(tok) };
  }

  // ---------------- CommitFest Entries ----------------

  async countEntries(): Promise<number> {
    const rows = await this.sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${this.t("cf_entries")}`);
    return Number(rows[0]?.c ?? 0);
  }

  async getEntry(cfId: number): Promise<CfEntryRecord | null> {
    const rows = (await this.sql.unsafe(`SELECT * FROM ${this.t("cf_entries")} WHERE cf_id = $1`, [cfId])) as CfEntryRecord[];
    return rows[0] ?? null;
  }

  async listEntries(opts?: {
    search?: string;
    verdict?: string;
    status?: string;
    mineOnly?: boolean;
    starredOnly?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: "score" | "cf_id" | "updated" | "objections";
  }): Promise<{ total: number; items: CfEntryListItem[] }> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const addParam = (val: string | number): string => {
      params.push(val);
      return `$${params.length}`;
    };

    const parsed = parseEntryQuery(opts?.search || "");

    for (const term of parsed.freeText) {
      const p = addParam(`%${term}%`);
      where.push(
        `(CAST(e.cf_id AS TEXT) ILIKE ${p} OR e.title ILIKE ${p} OR e.authors ILIKE ${p} OR e.reviewers ILIKE ${p} OR e.committer ILIKE ${p} OR e.topic ILIKE ${p})`,
      );
    }

    const effectiveVerdict = parsed.unroastedOnly
      ? "UNROASTED"
      : (parsed.verdict || (opts?.verdict && opts.verdict !== "all" ? opts.verdict : undefined));
    if (effectiveVerdict === "UNROASTED") {
      where.push("(e.verdict = '' OR e.verdict IS NULL)");
    } else if (effectiveVerdict) {
      where.push(`e.verdict = ${addParam(effectiveVerdict)}`);
    }

    const effectiveStatus = parsed.status || (opts?.status && opts.status !== "all" ? opts.status : undefined);
    if (parsed.openOnly || effectiveStatus === "OPEN") {
      where.push("LOWER(TRIM(e.status)) NOT IN ('committed', 'rejected', 'withdrawn', 'returned with feedback', 'moved to next cf')");
    } else if (parsed.closedOnly || effectiveStatus === "CLOSED") {
      where.push("LOWER(TRIM(e.status)) IN ('committed', 'rejected', 'withdrawn', 'returned with feedback', 'moved to next cf')");
    } else if (effectiveStatus) {
      where.push(`e.status ILIKE ${addParam(`%${effectiveStatus}%`)}`);
    }

    if (parsed.cfbot === "passing") {
      where.push("LOWER(e.cfbot_status) = 'passing'");
    } else if (parsed.cfbot === "needs_rebase") {
      where.push("LOWER(e.cfbot_status) = 'needs_rebase'");
    } else if (parsed.cfbot === "failing_or_rebase") {
      where.push("LOWER(e.cfbot_status) IN ('failing', 'needs_rebase')");
    }

    if (parsed.hasNovel) where.push("e.new_objection_count > 0");
    if (parsed.noCommitter) where.push("TRIM(e.committer) = ''");
    if (parsed.noReviewer) where.push("TRIM(e.reviewers) = ''");
    if (parsed.starredOnly || opts?.starredOnly) where.push("COALESCE(t.starred, 0) = 1");
    if (parsed.unvisitedOnly) where.push("COALESCE(t.visited_at, '') = ''");
    if (parsed.tag) where.push(`COALESCE(t.tags_json, '[]') ILIKE ${addParam(`%"${parsed.tag}"%`)}`);
    if (parsed.author) where.push(`e.authors ILIKE ${addParam(`%${parsed.author}%`)}`);
    if (parsed.reviewer) where.push(`e.reviewers ILIKE ${addParam(`%${parsed.reviewer}%`)}`);
    if (parsed.topic) where.push(`e.topic ILIKE ${addParam(`%${parsed.topic}%`)}`);

    if (opts?.mineOnly || parsed.mineOnly) {
      const settings = await this.getSettings();
      const identityTokens = Array.from(
        new Set(
          [settings.cfUsername, settings.authorName, settings.authName, settings.authHandle]
            .map((s) => (s || "").trim().toLowerCase())
            .filter((s) => s.length >= 3),
        ),
      );
      if (identityTokens.length > 0) {
        const sub: string[] = ["e.is_mine = 1"];
        for (const tok of identityTokens) {
          const p = addParam(`%${tok}%`);
          sub.push(`(e.authors ILIKE ${p} OR e.reviewers ILIKE ${p} OR e.committer ILIKE ${p})`);
        }
        where.push(`(${sub.join(" OR ")})`);
      } else {
        where.push("e.is_mine = 1");
      }
    }

    const fromJoin = `
      FROM ${this.t("cf_entries")} e
      LEFT JOIN ${this.t("entry_triage")} t ON t.cf_id = e.cf_id
    `;
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const totalRows = await this.sql.unsafe(`SELECT COUNT(*)::int AS c ${fromJoin} ${whereSql}`, params);

    let orderBy = "e.recommended_score DESC, e.cf_id DESC";
    if (opts?.sortBy === "cf_id") orderBy = "e.cf_id DESC";
    else if (opts?.sortBy === "updated") orderBy = "e.updated_at DESC, e.cf_id DESC";
    else if (opts?.sortBy === "objections") orderBy = "e.new_objection_count DESC, e.objection_count DESC, e.cf_id DESC";

    const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 2000);
    const offset = Math.max(opts?.offset ?? 0, 0);
    const limitParam = addParam(limit);
    const offsetParam = addParam(offset);

    const items = (await this.sql.unsafe(
      `SELECT e.cf_id, e.cf_number, e.title, e.status, e.topic, e.authors, e.reviewers, e.committer,
              e.target_version, e.thread_url, e.latest_message_id, e.latest_message_time,
              e.cfbot_status, e.cfbot_branch, e.cfbot_build_url, e.cfbot_apply_url,
              e.cfbot_stats_json, e.attachments_json, e.verdict, e.confidence,
              e.objection_count, e.new_objection_count, e.prior_attempts_count,
              e.priority_action, e.recommended_score, e.is_mine, e.mine_role, e.updated_at, e.synced_at,
              COALESCE(t.starred, 0)::int AS starred,
              COALESCE(t.tags_json, '[]') AS tags_json,
              COALESCE(t.notes, '') AS notes,
              COALESCE(t.visited_at, '') AS visited_at
       ${fromJoin}
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    )) as CfEntryListItem[];

    return { total: Number(totalRows[0]?.c ?? 0), items };
  }

  async getAllEntriesWithRoasts(): Promise<CfEntryRecord[]> {
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("cf_entries")} WHERE roast_json != '' ORDER BY recommended_score DESC, cf_id DESC`,
    )) as CfEntryRecord[];
  }

  async getAllEntriesForStats(): Promise<CfEntryRecord[]> {
    return (await this.sql.unsafe(`SELECT * FROM ${this.t("cf_entries")} ORDER BY cf_id DESC`)) as CfEntryRecord[];
  }

  async getVerdictStats(): Promise<Record<string, number>> {
    const [rows, openRows, starRows] = await Promise.all([
      this.sql.unsafe(
        `SELECT COALESCE(NULLIF(verdict, ''), 'UNROASTED') AS verdict, COUNT(*)::int AS c
         FROM ${this.t("cf_entries")} GROUP BY COALESCE(NULLIF(verdict, ''), 'UNROASTED')`,
      ) as Promise<Array<{ verdict: string; c: number }>>,
      this.sql.unsafe(
        `SELECT
          COALESCE(SUM(CASE WHEN LOWER(TRIM(status)) NOT IN ('committed', 'rejected', 'withdrawn', 'returned with feedback', 'moved to next cf') THEN 1 ELSE 0 END), 0)::int AS open_total,
          COALESCE(SUM(CASE WHEN LOWER(TRIM(status)) NOT IN ('committed', 'rejected', 'withdrawn', 'returned with feedback', 'moved to next cf') AND (verdict = '' OR verdict IS NULL) THEN 1 ELSE 0 END), 0)::int AS open_unroasted,
          COALESCE(SUM(CASE WHEN LOWER(TRIM(status)) IN ('committed', 'rejected', 'withdrawn', 'returned with feedback', 'moved to next cf') THEN 1 ELSE 0 END), 0)::int AS closed_total
         FROM ${this.t("cf_entries")}`,
      ) as Promise<Array<{ open_total: number; open_unroasted: number; closed_total: number }>>,
      this.sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${this.t("entry_triage")} WHERE starred = 1`) as Promise<Array<{ c: number }>>,
    ]);

    const stats: Record<string, number> = {
      TOTAL: 0,
      "NO-FUNDAMENTAL-OBJECTION": 0,
      "NEEDS-COMMITTER-EYES": 0,
      "NEEDS-DESIGN-DISCUSSION": 0,
      "LIKELY-REJECT": 0,
      UNROASTED: 0,
      OPEN_TOTAL: 0,
      OPEN_UNROASTED: 0,
      CLOSED_TOTAL: 0,
      STARRED: 0,
    };
    for (const r of rows) {
      const cnt = Number(r.c);
      stats[r.verdict] = cnt;
      stats.TOTAL = (stats.TOTAL ?? 0) + cnt;
    }
    stats.OPEN_TOTAL = Number(openRows[0]?.open_total ?? 0);
    stats.OPEN_UNROASTED = Number(openRows[0]?.open_unroasted ?? 0);
    stats.CLOSED_TOTAL = Number(openRows[0]?.closed_total ?? 0);
    stats.STARRED = Number(starRows[0]?.c ?? 0);
    return stats;
  }

  async upsertEntryMetadata(entry: Partial<CfEntryRecord> & { cf_id: number }): Promise<void> {
    const existing = await this.getEntry(entry.cf_id);
    const now = nowIso();
    if (!existing) {
      await this.sql.unsafe(
        `INSERT INTO ${this.t("cf_entries")} (
          cf_id, cf_number, title, status, topic, authors, reviewers, committer,
          target_version, thread_url, latest_message_id, latest_message_time,
          cfbot_status, cfbot_branch, cfbot_build_url, cfbot_apply_url,
          cfbot_stats_json, attachments_json, verdict, confidence,
          objection_count, new_objection_count, prior_attempts_count,
          priority_action, recommended_score, roast_json, roast_md,
          pushback_json, pushback_md, is_mine, mine_role, updated_at, synced_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23,
          $24, $25, $26, $27,
          $28, $29, $30, $31, $32, $33
        )`,
        [
          entry.cf_id,
          entry.cf_number ?? null,
          entry.title ?? `CF ${entry.cf_id}`,
          entry.status ?? "",
          entry.topic ?? "",
          entry.authors ?? "",
          entry.reviewers ?? "",
          entry.committer ?? "",
          entry.target_version ?? "",
          entry.thread_url ?? "",
          entry.latest_message_id ?? "",
          entry.latest_message_time ?? "",
          entry.cfbot_status ?? "",
          entry.cfbot_branch ?? `cf/${entry.cf_id}`,
          entry.cfbot_build_url ?? "",
          entry.cfbot_apply_url ?? "",
          entry.cfbot_stats_json ?? "{}",
          entry.attachments_json ?? "[]",
          entry.verdict ?? "",
          entry.confidence ?? "",
          entry.objection_count ?? 0,
          entry.new_objection_count ?? 0,
          entry.prior_attempts_count ?? 0,
          entry.priority_action ?? "",
          entry.recommended_score ?? 0,
          entry.roast_json ?? "",
          entry.roast_md ?? "",
          entry.pushback_json ?? "",
          entry.pushback_md ?? "",
          entry.is_mine ?? 0,
          entry.mine_role ?? "",
          now,
          entry.synced_at ?? now,
        ],
      );
      return;
    }

    await this.sql.unsafe(
      `UPDATE ${this.t("cf_entries")} SET
        cf_number = COALESCE($1, cf_number),
        title = CASE WHEN $2 != '' THEN $2 ELSE title END,
        status = CASE WHEN $3 != '' THEN $3 ELSE status END,
        topic = CASE WHEN $4 != '' THEN $4 ELSE topic END,
        authors = CASE WHEN $5 != '' THEN $5 ELSE authors END,
        reviewers = CASE WHEN $6 != '' THEN $6 ELSE reviewers END,
        committer = CASE WHEN $7 != '' THEN $7 ELSE committer END,
        target_version = CASE WHEN $8 != '' THEN $8 ELSE target_version END,
        thread_url = CASE WHEN $9 != '' THEN $9 ELSE thread_url END,
        latest_message_id = CASE WHEN $10 != '' THEN $10 ELSE latest_message_id END,
        latest_message_time = CASE WHEN $11 != '' THEN $11 ELSE latest_message_time END,
        cfbot_status = CASE WHEN $12 != '' THEN $12 ELSE cfbot_status END,
        cfbot_branch = CASE WHEN $13 != '' THEN $13 ELSE cfbot_branch END,
        cfbot_build_url = CASE WHEN $14 != '' THEN $14 ELSE cfbot_build_url END,
        cfbot_apply_url = CASE WHEN $15 != '' THEN $15 ELSE cfbot_apply_url END,
        cfbot_stats_json = CASE WHEN $16 != '' AND $16 != '{}' THEN $16 ELSE cfbot_stats_json END,
        attachments_json = CASE WHEN $17 != '' AND $17 != '[]' THEN $17 ELSE attachments_json END,
        is_mine = COALESCE($18, is_mine),
        mine_role = CASE WHEN $19 != '' THEN $19 ELSE mine_role END,
        updated_at = $20,
        synced_at = CASE WHEN $21 != '' THEN $21 ELSE synced_at END
      WHERE cf_id = $22`,
      [
        entry.cf_number ?? null,
        entry.title ?? "",
        entry.status ?? "",
        entry.topic ?? "",
        entry.authors ?? "",
        entry.reviewers ?? "",
        entry.committer ?? "",
        entry.target_version ?? "",
        entry.thread_url ?? "",
        entry.latest_message_id ?? "",
        entry.latest_message_time ?? "",
        entry.cfbot_status ?? "",
        entry.cfbot_branch ?? "",
        entry.cfbot_build_url ?? "",
        entry.cfbot_apply_url ?? "",
        entry.cfbot_stats_json ?? "",
        entry.attachments_json ?? "",
        entry.is_mine ?? null,
        entry.mine_role ?? "",
        now,
        entry.synced_at ?? "",
        entry.cf_id,
      ],
    );
  }

  async ingestRoastResult(
    cfId: number,
    roast: RoastJson,
    roastMd: string,
    summaryTxt = "",
    opts?: { recordRun?: boolean; rounds?: number },
  ): Promise<void> {
    const now = nowIso();
    const objections = roast.objections ?? [];
    const newCount = countNewObjections(roast);
    const priorCount = roast.prior_attempts?.length ?? 0;
    const score = computeQuickScore(roast);
    const title = roast.input?.cf?.title || roast.input?.subject || roast.brief?.title || `CF ${cfId}`;
    const status = roast.input?.cf?.status || "";
    const authors = roast.input?.cf?.authors || "";
    const reviewers = roast.input?.cf?.reviewers || "";
    const committer = roast.input?.cf?.committer || "";
    const threadUrl = roast.input?.thread_url || roast.input?.thread_urls?.[0] || "";
    const attachments = JSON.stringify(roast.input?.attachments_read ?? []);
    const roastJsonStr = JSON.stringify(roast);
    const priorityAction = roast.priority?.recommended_action || "";

    const existing = await this.getEntry(cfId);
    if (!existing) {
      await this.sql.unsafe(
        `INSERT INTO ${this.t("cf_entries")} (
          cf_id, title, status, authors, reviewers, committer, thread_url,
          cfbot_branch, attachments_json, verdict, confidence,
          objection_count, new_objection_count, prior_attempts_count,
          priority_action, recommended_score, roast_json, roast_md, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          cfId,
          title,
          status,
          authors,
          reviewers,
          committer,
          threadUrl,
          `cf/${cfId}`,
          attachments,
          roast.verdict || "",
          roast.confidence || "",
          objections.length,
          newCount,
          priorCount,
          priorityAction,
          score,
          roastJsonStr,
          roastMd,
          now,
        ],
      );
    } else {
      await this.sql.unsafe(
        `UPDATE ${this.t("cf_entries")} SET
          title = CASE WHEN $1 != '' THEN $1 ELSE title END,
          status = CASE WHEN $2 != '' THEN $2 ELSE status END,
          authors = CASE WHEN $3 != '' THEN $3 ELSE authors END,
          reviewers = CASE WHEN $4 != '' THEN $4 ELSE reviewers END,
          committer = CASE WHEN $5 != '' THEN $5 ELSE committer END,
          thread_url = CASE WHEN $6 != '' THEN $6 ELSE thread_url END,
          attachments_json = CASE WHEN $7 != '[]' THEN $7 ELSE attachments_json END,
          verdict = $8,
          confidence = $9,
          objection_count = $10,
          new_objection_count = $11,
          prior_attempts_count = $12,
          priority_action = $13,
          recommended_score = $14,
          roast_json = $15,
          roast_md = $16,
          updated_at = $17
        WHERE cf_id = $18`,
        [
          title,
          status,
          authors,
          reviewers,
          committer,
          threadUrl,
          attachments,
          roast.verdict || "",
          roast.confidence || "",
          objections.length,
          newCount,
          priorCount,
          priorityAction,
          score,
          roastJsonStr,
          roastMd,
          now,
          cfId,
        ],
      );
    }

    if (opts?.recordRun !== false) {
      const settings = await this.getSettings();
      const contributorName = (settings.authName || settings.authorName || settings.cfUsername || "Local reviewer").trim();
      const contributorHandle = (settings.authHandle || settings.cfUsername || settings.gmailAccount || "").trim();
      const contributorProvider = settings.authProvider || "local";
      const contributorAvatar = settings.authAvatarUrl || "";
      await this.sql.unsafe(
        `INSERT INTO ${this.t("roast_runs")} (
          cf_id, mode, roast_level, roast_flavour, backend, models_json, rounds, verdict, confidence,
          roast_json, roast_md, summary_txt,
          contributor_name, contributor_handle, contributor_provider, contributor_avatar,
          created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          cfId,
          roast.mode || "review",
          roast.roast_level || "medium",
          roast.roast_flavour || "default",
          roast.backend || "claude",
          JSON.stringify(roast.models ?? {}),
          opts?.rounds ?? 0,
          roast.verdict || "",
          roast.confidence || "",
          roastJsonStr,
          roastMd,
          summaryTxt,
          contributorName,
          contributorHandle,
          contributorProvider,
          contributorAvatar,
          roast.generated_at || now,
        ],
      );
    }
  }

  async addExternalOpinion(input: {
    cfId: number;
    backend: string;
    models?: Record<string, string> | string;
    verdict: string;
    confidence?: string;
    summaryTxt?: string;
    roastJson?: string;
    contributorName: string;
    contributorHandle?: string;
    contributorProvider?: "github" | "google" | "local";
    contributorAvatar?: string;
    createdAt?: string;
  }): Promise<RoastRunRecord> {
    const now = input.createdAt || nowIso();
    const modelsJson = typeof input.models === "string" ? input.models : JSON.stringify(input.models ?? {});
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("roast_runs")} (
        cf_id, mode, backend, models_json, rounds, verdict, confidence,
        roast_json, roast_md, summary_txt,
        contributor_name, contributor_handle, contributor_provider, contributor_avatar,
        created_at
      ) VALUES ($1, 'opinion', $2, $3, 0, $4, $5, $6, '', $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        input.cfId,
        input.backend || "external",
        modelsJson,
        input.verdict,
        input.confidence || "",
        input.roastJson || "",
        input.summaryTxt || "",
        input.contributorName.trim(),
        (input.contributorHandle || "").trim(),
        input.contributorProvider || "local",
        input.contributorAvatar || "",
        now,
      ],
    )) as RoastRunRecord[];
    return rows[0]!;
  }

  async searchGlobal(query: string): Promise<{
    entries: CfEntryListItem[];
    workItems: WorkItemRecord[];
    bugs: BugReportRecord[];
  }> {
    const q = query.trim();
    if (!q) return { entries: [], workItems: [], bugs: [] };
    const like = `%${q}%`;
    const [entryRes, workItems, bugs] = await Promise.all([
      this.listEntries({ search: q, limit: 25 }),
      this.sql.unsafe(
        `SELECT * FROM ${this.t("work_items")}
         WHERE title ILIKE $1 OR slug ILIKE $1 OR evidence_md ILIKE $1 OR CAST(COALESCE(cf_id, 0) AS TEXT) ILIKE $1
         ORDER BY updated_at DESC LIMIT 15`,
        [like],
      ) as Promise<WorkItemRecord[]>,
      this.sql.unsafe(
        `SELECT * FROM ${this.t("bug_reports")}
         WHERE subject ILIKE $1 OR sender ILIKE $1 OR summary ILIKE $1
         ORDER BY reported_at DESC LIMIT 15`,
        [like],
      ) as Promise<BugReportRecord[]>,
    ]);
    return { entries: entryRes.items, workItems, bugs };
  }

  async savePushbackResult(cfId: number, pushbackJson: string, pushbackMd: string): Promise<void> {
    const existing = await this.getEntry(cfId);
    if (!existing) {
      await this.upsertEntryMetadata({ cf_id: cfId, title: `CF ${cfId}` });
    }
    await this.sql.unsafe(
      `UPDATE ${this.t("cf_entries")} SET pushback_json = $1, pushback_md = $2, updated_at = $3 WHERE cf_id = $4`,
      [pushbackJson, pushbackMd, nowIso(), cfId],
    );
  }

  async listRoastRuns(cfId: number): Promise<RoastRunRecord[]> {
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("roast_runs")} WHERE cf_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [cfId],
    )) as RoastRunRecord[];
  }

  async importRoastBatch(batchDir: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const resolvedDir = expandHome(batchDir);
    const cfRoot = existsSync(join(resolvedDir, "cf")) ? join(resolvedDir, "cf") : resolvedDir;
    const errors: string[] = [];
    if (!existsSync(cfRoot)) {
      return { imported: 0, skipped: 0, errors: [`Directory not found: ${cfRoot}`] };
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(cfRoot);
    } catch (err) {
      return {
        imported: 0,
        skipped: 0,
        errors: [`Cannot read ${cfRoot}: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    let imported = 0;
    let skipped = 0;

    for (const name of entries) {
      const cfId = Number(name);
      if (!Number.isInteger(cfId) || cfId <= 0) continue;
      const dir = join(cfRoot, name);
      const jsonPath = join(dir, "roast.json");
      if (!existsSync(jsonPath)) {
        skipped++;
        continue;
      }
      try {
        const rawJson = readFileSync(jsonPath, "utf8");
        const parsed = JSON.parse(rawJson) as RoastJson;
        const mdPath = join(dir, "roast.md");
        const sumPath = join(dir, "roast-summary.txt");
        const roastMd = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
        const summaryTxt = existsSync(sumPath) ? readFileSync(sumPath, "utf8") : "";
        await this.ingestRoastResult(cfId, parsed, roastMd, summaryTxt, { recordRun: false });

        const pbJsonPath = join(dir, "pushback.json");
        const pbMdPath = join(dir, "pushback.md");
        if (existsSync(pbJsonPath) || existsSync(pbMdPath)) {
          await this.savePushbackResult(
            cfId,
            existsSync(pbJsonPath) ? readFileSync(pbJsonPath, "utf8") : "",
            existsSync(pbMdPath) ? readFileSync(pbMdPath, "utf8") : "",
          );
        }
        imported++;
      } catch (err) {
        errors.push(`CF ${cfId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { imported, skipped, errors };
  }

  // ---------------- Jobs ----------------

  async createJob(job: {
    id: string;
    kind: JobKind;
    cf_id?: number | null;
    title: string;
    model?: string;
    backend?: string;
    command?: string;
    worktree_path?: string;
    log_path: string;
  }): Promise<JobRecord> {
    const now = nowIso();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("jobs")} (
        id, kind, cf_id, title, status, model, backend, command, worktree_path, log_path, created_at
      ) VALUES ($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        job.id,
        job.kind,
        job.cf_id ?? null,
        job.title,
        job.model ?? "",
        job.backend ?? "",
        job.command ?? "",
        job.worktree_path ?? "",
        job.log_path,
        now,
      ],
    )) as JobRecord[];
    return rows[0]!;
  }

  async updateJob(
    id: string,
    patch: Partial<{
      status: JobStatus;
      pid: number | null;
      pgid: number | null;
      command: string;
      worktree_path: string;
      exit_code: number | null;
      result_json: string;
      error: string;
      started_at: string | null;
      finished_at: string | null;
    }>,
  ): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        values.push(v);
        fields.push(`${k} = $${values.length}`);
      }
    }
    if (fields.length === 0) return;
    values.push(id);
    await this.sql.unsafe(`UPDATE ${this.t("jobs")} SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const rows = (await this.sql.unsafe(`SELECT * FROM ${this.t("jobs")} WHERE id = $1`, [id])) as JobRecord[];
    return rows[0] ?? null;
  }

  async listJobs(limit = 100, cfId?: number): Promise<JobRecord[]> {
    if (cfId != null) {
      return (await this.sql.unsafe(
        `SELECT * FROM ${this.t("jobs")} WHERE cf_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [cfId, limit],
      )) as JobRecord[];
    }
    return (await this.sql.unsafe(`SELECT * FROM ${this.t("jobs")} ORDER BY created_at DESC LIMIT $1`, [limit])) as JobRecord[];
  }

  // ---------------- Work Items ----------------

  async createWorkItem(input: {
    cf_id?: number | null;
    slug: string;
    title: string;
    target_branch?: string;
    upstream_base_sha?: string;
    worktree_path?: string;
    evidence_md?: string;
    is_security?: boolean;
  }): Promise<WorkItemRecord> {
    const now = nowIso();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("work_items")} (
        cf_id, slug, title, status, upstream_base_sha, target_branch,
        worktree_path, evidence_md, is_security, created_at, updated_at
      ) VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        input.cf_id ?? null,
        input.slug,
        input.title,
        input.upstream_base_sha ?? "",
        input.target_branch ?? "master",
        input.worktree_path ?? "",
        input.evidence_md ?? "",
        input.is_security ? 1 : 0,
        now,
        now,
      ],
    )) as WorkItemRecord[];
    return rows[0]!;
  }

  async getWorkItem(id: number): Promise<WorkItemRecord | null> {
    const rows = (await this.sql.unsafe(`SELECT * FROM ${this.t("work_items")} WHERE id = $1`, [id])) as WorkItemRecord[];
    return rows[0] ?? null;
  }

  async listWorkItems(cfId?: number): Promise<WorkItemRecord[]> {
    if (cfId != null) {
      return (await this.sql.unsafe(
        `SELECT * FROM ${this.t("work_items")} WHERE cf_id = $1 ORDER BY updated_at DESC`,
        [cfId],
      )) as WorkItemRecord[];
    }
    return (await this.sql.unsafe(`SELECT * FROM ${this.t("work_items")} ORDER BY updated_at DESC LIMIT 200`)) as WorkItemRecord[];
  }

  async updateWorkItem(id: number, patch: Partial<Omit<WorkItemRecord, "id" | "created_at">>): Promise<WorkItemRecord | null> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    const allowed = new Set([
      "slug", "title", "status", "upstream_base_sha", "target_branch",
      "patch_hashes_json", "suites_run_json", "worktree_path", "evidence_md",
      "github_issue_number", "github_issue_url", "ci_branch", "is_security",
    ]);
    for (const [k, v] of Object.entries(patch)) {
      if (allowed.has(k) && v !== undefined) {
        values.push(v as string | number | null);
        fields.push(`${k} = $${values.length}`);
      }
    }
    if (fields.length > 0) {
      values.push(nowIso());
      fields.push(`updated_at = $${values.length}`);
      values.push(id);
      const rows = (await this.sql.unsafe(
        `UPDATE ${this.t("work_items")} SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
        values,
      )) as WorkItemRecord[];
      return rows[0] ?? null;
    }
    return this.getWorkItem(id);
  }

  // ---------------- Drafts ----------------

  async createDraft(input: Partial<Omit<DraftRecord, "id" | "created_at" | "updated_at">>): Promise<DraftRecord> {
    const now = nowIso();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("drafts")} (
        cf_id, work_item_id, kind, is_reply, is_other_author_thread,
        thread_id, in_reply_to, references_header, to_addrs, cc_addrs,
        subject, body, attachments_json, gate_results_json,
        gmail_draft_id, gmail_draft_url, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        input.cf_id ?? null,
        input.work_item_id ?? null,
        input.kind ?? "review",
        input.is_reply ?? 1,
        input.is_other_author_thread ?? 1,
        input.thread_id ?? "",
        input.in_reply_to ?? "",
        input.references_header ?? "",
        input.to_addrs ?? "pgsql-hackers@lists.postgresql.org",
        input.cc_addrs ?? "",
        input.subject ?? "",
        input.body ?? "",
        input.attachments_json ?? "[]",
        input.gate_results_json ?? "{}",
        input.gmail_draft_id ?? "",
        input.gmail_draft_url ?? "",
        now,
        now,
      ],
    )) as DraftRecord[];
    return rows[0]!;
  }

  async getDraft(id: number): Promise<DraftRecord | null> {
    const rows = (await this.sql.unsafe(`SELECT * FROM ${this.t("drafts")} WHERE id = $1`, [id])) as DraftRecord[];
    return rows[0] ?? null;
  }

  async listDrafts(cfId?: number): Promise<DraftRecord[]> {
    if (cfId != null) {
      return (await this.sql.unsafe(
        `SELECT * FROM ${this.t("drafts")} WHERE cf_id = $1 ORDER BY updated_at DESC`,
        [cfId],
      )) as DraftRecord[];
    }
    return (await this.sql.unsafe(`SELECT * FROM ${this.t("drafts")} ORDER BY updated_at DESC LIMIT 100`)) as DraftRecord[];
  }

  async updateDraft(id: number, patch: Partial<Omit<DraftRecord, "id" | "created_at">>): Promise<DraftRecord | null> {
    const allowed = new Set([
      "cf_id", "work_item_id", "kind", "is_reply", "is_other_author_thread",
      "thread_id", "in_reply_to", "references_header", "to_addrs", "cc_addrs",
      "subject", "body", "attachments_json", "gate_results_json",
      "gmail_draft_id", "gmail_draft_url",
    ]);
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (allowed.has(k) && v !== undefined) {
        values.push(v as string | number | null);
        fields.push(`${k} = $${values.length}`);
      }
    }
    if (fields.length > 0) {
      values.push(nowIso());
      fields.push(`updated_at = $${values.length}`);
      values.push(id);
      const rows = (await this.sql.unsafe(
        `UPDATE ${this.t("drafts")} SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
        values,
      )) as DraftRecord[];
      return rows[0] ?? null;
    }
    return this.getDraft(id);
  }

  // ---------------- Bug Reports ----------------

  async upsertBugReport(bug: Omit<BugReportRecord, "id" | "created_at" | "updated_at">): Promise<BugReportRecord> {
    const now = nowIso();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("bug_reports")} (
        message_id, subject, sender, thread_url, reported_at,
        classification, severity, confidence, production_signals_json,
        summary, affected_versions, status, work_item_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (message_id) DO UPDATE SET
        subject = EXCLUDED.subject,
        sender = EXCLUDED.sender,
        thread_url = EXCLUDED.thread_url,
        reported_at = EXCLUDED.reported_at,
        classification = EXCLUDED.classification,
        severity = EXCLUDED.severity,
        confidence = EXCLUDED.confidence,
        production_signals_json = EXCLUDED.production_signals_json,
        summary = EXCLUDED.summary,
        affected_versions = EXCLUDED.affected_versions,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        bug.message_id,
        bug.subject,
        bug.sender,
        bug.thread_url,
        bug.reported_at,
        bug.classification,
        bug.severity,
        bug.confidence,
        bug.production_signals_json,
        bug.summary,
        bug.affected_versions,
        bug.status,
        bug.work_item_id,
        now,
        now,
      ],
    )) as BugReportRecord[];
    return rows[0]!;
  }

  async listBugReports(filter?: { classification?: string; severity?: string; status?: string }): Promise<BugReportRecord[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter?.classification && filter.classification !== "all") {
      params.push(filter.classification);
      where.push(`classification = $${params.length}`);
    }
    if (filter?.severity && filter.severity !== "all") {
      params.push(filter.severity);
      where.push(`severity = $${params.length}`);
    }
    if (filter?.status && filter.status !== "all") {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("bug_reports")} ${whereSql}
       ORDER BY
         CASE classification WHEN 'production_hit' THEN 0 WHEN 'unclear' THEN 1 ELSE 2 END,
         CASE severity WHEN 'data_loss' THEN 0 WHEN 'wrong_results' THEN 1 WHEN 'crash' THEN 2 WHEN 'oom' THEN 3 WHEN 'regression' THEN 4 ELSE 5 END,
         reported_at DESC
       LIMIT 200`,
      params,
    )) as BugReportRecord[];
  }

  async updateBugReportStatus(
    id: number,
    status: BugReportRecord["status"],
    workItemId?: number | null,
  ): Promise<BugReportRecord | null> {
    if (workItemId !== undefined) {
      const rows = (await this.sql.unsafe(
        `UPDATE ${this.t("bug_reports")} SET status = $1, work_item_id = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
        [status, workItemId, nowIso(), id],
      )) as BugReportRecord[];
      return rows[0] ?? null;
    }
    const rows = (await this.sql.unsafe(
      `UPDATE ${this.t("bug_reports")} SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
      [status, nowIso(), id],
    )) as BugReportRecord[];
    return rows[0] ?? null;
  }

  // ---------------- Audit Log ----------------

  async logAudit(
    action: string,
    target: string,
    details: Record<string, unknown>,
    status: "ok" | "blocked" | "error" = "ok",
  ): Promise<void> {
    await this.sql.unsafe(
      `INSERT INTO ${this.t("audit_log")} (action, target, details_json, status, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [action, target, JSON.stringify(details), status, nowIso()],
    );
  }

  async listAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("audit_log")} ORDER BY id DESC LIMIT $1`,
      [limit],
    )) as AuditLogRecord[];
  }

  // ---------------- Personal Triage (Stars, Tags, Private Notes, Visited) ----------------

  async getEntryTriage(cfId: number): Promise<EntryTriageRecord> {
    const rows = (await this.sql.unsafe(
      `SELECT * FROM ${this.t("entry_triage")} WHERE cf_id = $1`,
      [cfId],
    )) as Array<{ cf_id: number; starred: number; tags_json: string; notes: string; visited_at: string; updated_at: string }>;
    const row = rows[0];
    if (!row) {
      return { cf_id: cfId, starred: 0, tags: [], notes: "", visited_at: "", updated_at: "" };
    }
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags_json || "[]") as string[];
    } catch {
      tags = [];
    }
    return {
      cf_id: row.cf_id,
      starred: Number(row.starred),
      tags,
      notes: row.notes,
      visited_at: row.visited_at,
      updated_at: row.updated_at,
    };
  }

  async upsertEntryTriage(
    cfId: number,
    patch: { starred?: boolean; tags?: string[]; notes?: string; markVisited?: boolean },
  ): Promise<EntryTriageRecord> {
    const cur = await this.getEntryTriage(cfId);
    const starred = patch.starred !== undefined ? (patch.starred ? 1 : 0) : cur.starred;
    const cleanTags =
      patch.tags !== undefined
        ? Array.from(new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 12)
        : cur.tags;
    const notes = patch.notes !== undefined ? patch.notes : cur.notes;
    const visitedAt = patch.markVisited ? nowIso() : cur.visited_at;
    const now = nowIso();
    await this.sql.unsafe(
      `INSERT INTO ${this.t("entry_triage")} (cf_id, starred, tags_json, notes, visited_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (cf_id) DO UPDATE SET
         starred = EXCLUDED.starred,
         tags_json = EXCLUDED.tags_json,
         notes = EXCLUDED.notes,
         visited_at = EXCLUDED.visited_at,
         updated_at = EXCLUDED.updated_at`,
      [cfId, starred, JSON.stringify(cleanTags), notes, visitedAt, now],
    );
    return { cf_id: cfId, starred, tags: cleanTags, notes, visited_at: visitedAt, updated_at: now };
  }

  async getTriageSummaryCounts(): Promise<{
    starred: number;
    visited: number;
    tagged: number;
    noted: number;
    workItems: number;
    drafts: number;
  }> {
    const [tRows, wiRows, drRows] = await Promise.all([
      this.sql.unsafe(
        `SELECT
          COALESCE(SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END), 0)::int AS starred,
          COALESCE(SUM(CASE WHEN visited_at != '' THEN 1 ELSE 0 END), 0)::int AS visited,
          COALESCE(SUM(CASE WHEN tags_json != '[]' AND tags_json != '' THEN 1 ELSE 0 END), 0)::int AS tagged,
          COALESCE(SUM(CASE WHEN TRIM(notes) != '' THEN 1 ELSE 0 END), 0)::int AS noted
         FROM ${this.t("entry_triage")}`,
      ) as Promise<Array<{ starred: number; visited: number; tagged: number; noted: number }>>,
      this.sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${this.t("work_items")}`) as Promise<Array<{ c: number }>>,
      this.sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${this.t("drafts")}`) as Promise<Array<{ c: number }>>,
    ]);
    return {
      starred: Number(tRows[0]?.starred ?? 0),
      visited: Number(tRows[0]?.visited ?? 0),
      tagged: Number(tRows[0]?.tagged ?? 0),
      noted: Number(tRows[0]?.noted ?? 0),
      workItems: Number(wiRows[0]?.c ?? 0),
      drafts: Number(drRows[0]?.c ?? 0),
    };
  }

  // ---------------- Saved Searches ----------------

  async listSavedSearches(): Promise<SavedSearchRecord[]> {
    return (await this.sql.unsafe(`SELECT * FROM ${this.t("saved_searches")} ORDER BY id DESC`)) as SavedSearchRecord[];
  }

  async saveSearch(name: string, query: string): Promise<SavedSearchRecord> {
    const cleanName = name.trim();
    const cleanQuery = query.trim();
    if (!cleanName || !cleanQuery) throw new Error("Saved search name and query are required");
    const now = nowIso();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("saved_searches")} (name, query, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET query = EXCLUDED.query
       RETURNING *`,
      [cleanName, cleanQuery, now],
    )) as SavedSearchRecord[];
    return rows[0]!;
  }

  async deleteSavedSearch(id: number): Promise<void> {
    await this.sql.unsafe(`DELETE FROM ${this.t("saved_searches")} WHERE id = $1`, [id]);
  }

  // ---------------- Inline Diff Comments (Experimental PR Review) ----------------

  async listDiffComments(cfId: number): Promise<DiffCommentRecord[]> {
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("diff_comments")} WHERE cf_id = $1 ORDER BY file_path ASC, line_num ASC, id ASC`,
      [cfId],
    )) as DiffCommentRecord[];
  }

  async addDiffComment(input: {
    cf_id: number;
    file_path: string;
    line_num: number;
    line_type?: "add" | "del" | "ctx";
    code_snippet?: string;
    comment_text: string;
  }): Promise<DiffCommentRecord> {
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("diff_comments")} (cf_id, file_path, line_num, line_type, code_snippet, comment_text, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.cf_id,
        input.file_path.trim(),
        input.line_num,
        input.line_type || "add",
        input.code_snippet || "",
        input.comment_text.trim(),
        nowIso(),
      ],
    )) as DiffCommentRecord[];
    return rows[0]!;
  }

  async deleteDiffComment(id: number): Promise<void> {
    await this.sql.unsafe(`DELETE FROM ${this.t("diff_comments")} WHERE id = $1`, [id]);
  }
}
