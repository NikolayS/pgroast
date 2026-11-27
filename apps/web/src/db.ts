import { createHash } from "node:crypto";
import { SQL } from "bun";
import { generatePublishToken, hashToken, safeHttpUrl } from "./security.ts";

export interface ContributorRecord {
  id: number;
  provider: "github" | "google";
  provider_user_id: string;
  handle: string;
  name: string;
  avatar_url: string;
  created_at: string;
}

export interface PublicEntryRecord {
  cf_id: number;
  title: string;
  status: string;
  topic: string;
  authors: string;
  reviewers: string;
  committer: string;
  thread_url: string;
  verdict: string;
  confidence: string;
  kind: string;
  seen_in_production: boolean;
  workaround: string;
  failing_summary: string;
  recommended_score: number;
  updated_at: string;
}

export interface PublicOpinionRecord {
  id: number;
  cf_id: number;
  contributor_id: number | null;
  contributor_name: string;
  contributor_handle: string;
  contributor_provider: string;
  contributor_avatar: string;
  backend: string;
  roast_level: string;
  roast_flavour: string;
  models_json: string;
  verdict: string;
  confidence: string;
  summary: string;
  created_at: string;
}

export interface PublishedBriefRecord {
  id: number;
  slug: string;
  title: string;
  commitfest_label: string;
  published_by_provider: string;
  published_by_handle: string;
  published_by_name: string;
  stats_json: string;
  shortlist_json: string;
  closing_json: string;
  entries_json: string;
  created_at: string;
}

export interface SharedCoordinationRecord {
  id: number;
  cf_id: number | null;
  bug_ref: string;
  title: string;
  status: "open" | "in_progress" | "done";
  assignee_handle: string;
  assignee_name: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function validateIdent(s: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`Invalid SQL identifier: "${s}"`);
  return s;
}

async function ensureLocalDb(databaseUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return;
  const dbName = u.pathname.replace(/^\//, "");
  if (!dbName || dbName === "postgres" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) return;

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
    // Let main connection report any error
  } finally {
    if (admin) {
      try { await admin.close(); } catch { /* ignore */ }
    }
  }
}

export class WebDatabase {
  public readonly sql: SQL;
  public readonly schema: string;

  private constructor(sql: SQL, schema: string) {
    this.sql = sql;
    this.schema = schema;
  }

  static async create(opts: { databaseUrl: string; schema?: string }): Promise<WebDatabase> {
    const schema = validateIdent(opts.schema || "public");
    await ensureLocalDb(opts.databaseUrl);
    const sql = new SQL(opts.databaseUrl);
    const db = new WebDatabase(sql, schema);
    await db.initSchema();
    return db;
  }

  t(table: string): string {
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

  async getServerInfo(): Promise<{ version: string; database: string }> {
    const rows = await this.sql.unsafe("SELECT version() AS ver, current_database() AS db");
    return { version: String(rows[0]?.ver || ""), database: String(rows[0]?.db || "") };
  }

  private async initSchema(): Promise<void> {
    if (this.schema !== "public") {
      await this.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
    }
    const stmts = [
      `CREATE TABLE IF NOT EXISTS ${this.t("contributors")} (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL DEFAULT '',
        handle TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (provider, handle)
      )`,
      `ALTER TABLE ${this.t("contributors")} ADD COLUMN IF NOT EXISTS provider_user_id TEXT NOT NULL DEFAULT ''`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.schema}_contributors_provider_uid ON ${this.t("contributors")}(provider, provider_user_id) WHERE provider_user_id != ''`,
      `CREATE TABLE IF NOT EXISTS ${this.t("publish_tokens")} (
        id SERIAL PRIMARY KEY,
        contributor_id INTEGER NOT NULL REFERENCES ${this.t("contributors")}(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        token_prefix TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT 'local-workbench',
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS ${this.t("public_entries")} (
        cf_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        topic TEXT NOT NULL DEFAULT '',
        authors TEXT NOT NULL DEFAULT '',
        reviewers TEXT NOT NULL DEFAULT '',
        committer TEXT NOT NULL DEFAULT '',
        thread_url TEXT NOT NULL DEFAULT '',
        verdict TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'feature',
        seen_in_production BOOLEAN NOT NULL DEFAULT FALSE,
        workaround TEXT NOT NULL DEFAULT '',
        failing_summary TEXT NOT NULL DEFAULT '',
        recommended_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pub_entries_fts ON ${this.t("public_entries")} USING GIN (to_tsvector('english', title || ' ' || authors || ' ' || reviewers || ' ' || committer || ' ' || topic))`,
      `CREATE TABLE IF NOT EXISTS ${this.t("public_opinions")} (
        id SERIAL PRIMARY KEY,
        cf_id INTEGER NOT NULL,
        contributor_id INTEGER REFERENCES ${this.t("contributors")}(id) ON DELETE SET NULL,
        contributor_name TEXT NOT NULL,
        contributor_handle TEXT NOT NULL,
        contributor_provider TEXT NOT NULL DEFAULT 'github',
        contributor_avatar TEXT NOT NULL DEFAULT '',
        backend TEXT NOT NULL,
        roast_level TEXT NOT NULL DEFAULT 'medium',
        roast_flavour TEXT NOT NULL DEFAULT 'default',
        models_json TEXT NOT NULL DEFAULT '{}',
        verdict TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pub_opinions_cf ON ${this.t("public_opinions")}(cf_id, created_at DESC)`,
      `ALTER TABLE ${this.t("public_opinions")} ADD COLUMN IF NOT EXISTS roast_level TEXT NOT NULL DEFAULT 'medium'`,
      `ALTER TABLE ${this.t("public_opinions")} ADD COLUMN IF NOT EXISTS roast_flavour TEXT NOT NULL DEFAULT 'default'`,
      `CREATE TABLE IF NOT EXISTS ${this.t("published_briefs")} (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        commitfest_label TEXT NOT NULL DEFAULT 'CommitFest',
        published_by_provider TEXT NOT NULL DEFAULT 'github',
        published_by_handle TEXT NOT NULL DEFAULT '',
        published_by_name TEXT NOT NULL DEFAULT '',
        stats_json TEXT NOT NULL DEFAULT '{}',
        shortlist_json TEXT NOT NULL DEFAULT '[]',
        closing_json TEXT NOT NULL DEFAULT '[]',
        entries_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      )`,
      `ALTER TABLE ${this.t("published_briefs")} ADD COLUMN IF NOT EXISTS published_by_provider TEXT NOT NULL DEFAULT 'github'`,
      `CREATE TABLE IF NOT EXISTS ${this.t("shared_coordination")} (
        id SERIAL PRIMARY KEY,
        cf_id INTEGER,
        bug_ref TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        assignee_handle TEXT NOT NULL DEFAULT '',
        assignee_name TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ${this.t("page_views")} (
        id SERIAL PRIMARY KEY,
        path TEXT NOT NULL,
        cf_id INTEGER,
        ref_host TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_page_views_created ON ${this.t("page_views")}(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_page_views_cf ON ${this.t("page_views")}(cf_id) WHERE cf_id IS NOT NULL`,
      // ---- Hacking Observatory: Unified People, Multi-Email Identities, Git Commits & Credits ----
      `CREATE TABLE IF NOT EXISTS ${this.t("people")} (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        canonical_name TEXT NOT NULL,
        pg_role TEXT NOT NULL DEFAULT 'Contributor',
        affiliations_json TEXT NOT NULL DEFAULT '[]',
        email_domains_json TEXT NOT NULL DEFAULT '[]',
        email_count INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT NOT NULL DEFAULT '',
        commits_authored INTEGER NOT NULL DEFAULT 0,
        commits_committed INTEGER NOT NULL DEFAULT 0,
        commits_committed_for_others INTEGER NOT NULL DEFAULT 0,
        reviews_given INTEGER NOT NULL DEFAULT 0,
        bugs_reported INTEGER NOT NULL DEFAULT 0,
        suggestions_given INTEGER NOT NULL DEFAULT 0,
        tests_given INTEGER NOT NULL DEFAULT 0,
        cf_authored INTEGER NOT NULL DEFAULT 0,
        cf_reviewed INTEGER NOT NULL DEFAULT 0,
        cf_committed INTEGER NOT NULL DEFAULT 0,
        subsystems_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_people_name ON ${this.t("people")}(LOWER(canonical_name))`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_people_commits ON ${this.t("people")}(commits_authored DESC, reviews_given DESC)`,
      `CREATE TABLE IF NOT EXISTS ${this.t("person_identities")} (
        id SERIAL PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES ${this.t("people")}(id) ON DELETE CASCADE,
        email_lower TEXT NOT NULL DEFAULT '',
        email_domain TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        normalized_name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'git',
        UNIQUE (person_id, email_lower, display_name)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pid_person ON ${this.t("person_identities")}(person_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pid_email ON ${this.t("person_identities")}(email_lower) WHERE email_lower != ''`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pid_norm ON ${this.t("person_identities")}(normalized_name) WHERE normalized_name != ''`,
      `CREATE TABLE IF NOT EXISTS ${this.t("pg_commits")} (
        sha TEXT PRIMARY KEY,
        committed_at TEXT NOT NULL,
        authored_at TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        author_person_id INTEGER REFERENCES ${this.t("people")}(id) ON DELETE SET NULL,
        committer_person_id INTEGER REFERENCES ${this.t("people")}(id) ON DELETE SET NULL,
        is_revert BOOLEAN NOT NULL DEFAULT FALSE,
        is_backpatch BOOLEAN NOT NULL DEFAULT FALSE,
        primary_subsystem TEXT NOT NULL DEFAULT 'Postmaster & Core',
        subsystems_json TEXT NOT NULL DEFAULT '[]',
        discussion_urls_json TEXT NOT NULL DEFAULT '[]',
        files_changed INTEGER NOT NULL DEFAULT 0,
        insertions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        pg_major TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pg_commits_date ON ${this.t("pg_commits")}(committed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pg_commits_major ON ${this.t("pg_commits")}(pg_major, committed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pg_commits_subsys ON ${this.t("pg_commits")}(primary_subsystem, committed_at DESC)`,
      `CREATE TABLE IF NOT EXISTS ${this.t("commit_credits")} (
        id BIGSERIAL PRIMARY KEY,
        commit_sha TEXT NOT NULL REFERENCES ${this.t("pg_commits")}(sha) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES ${this.t("people")}(id) ON DELETE CASCADE,
        credit_kind TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        pg_major TEXT NOT NULL DEFAULT '',
        primary_subsystem TEXT NOT NULL DEFAULT '',
        UNIQUE (commit_sha, person_id, credit_kind)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cc_person_date ON ${this.t("commit_credits")}(person_id, committed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cc_kind_date ON ${this.t("commit_credits")}(credit_kind, committed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cc_date_kind ON ${this.t("commit_credits")}(committed_at DESC, credit_kind)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cc_major_kind ON ${this.t("commit_credits")}(pg_major, credit_kind)`,
      `CREATE TABLE IF NOT EXISTS ${this.t("hacker_sync_state")} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ];
    for (const s of stmts) {
      await this.sql.unsafe(s);
    }
  }

  async upsertContributor(input: {
    provider: "github" | "google";
    providerUserId?: string;
    handle: string;
    name: string;
    avatarUrl?: string;
  }): Promise<ContributorRecord> {
    const now = new Date().toISOString();
    const cleanHandle = input.handle.trim();
    const cleanName = input.name.trim() || cleanHandle;
    const cleanAvatar = safeHttpUrl(input.avatarUrl || "");
    const cleanUid = (input.providerUserId || "").trim();

    if (cleanUid) {
      const existingByUid = (await this.sql.unsafe(
        `SELECT * FROM ${this.t("contributors")} WHERE provider = $1 AND provider_user_id = $2`,
        [input.provider, cleanUid],
      )) as ContributorRecord[];
      if (existingByUid[0]) {
        const updated = (await this.sql.unsafe(
          `UPDATE ${this.t("contributors")}
           SET name = $1,
               avatar_url = CASE WHEN $2 != '' THEN $2 ELSE avatar_url END
           WHERE id = $3
           RETURNING *`,
          [cleanName, cleanAvatar, existingByUid[0].id],
        )) as ContributorRecord[];
        return updated[0]!;
      }

      // Check if handle is already taken by another identity under the same provider
      let finalHandle = cleanHandle;
      const handleOwner = (await this.sql.unsafe(
        `SELECT id, provider_user_id FROM ${this.t("contributors")} WHERE provider = $1 AND handle = $2`,
        [input.provider, cleanHandle],
      )) as Array<{ id: number; provider_user_id: string }>;
      if (handleOwner[0]) {
        if (input.provider === "github" && !handleOwner[0].provider_user_id) {
          // Bind legacy GitHub row (unique login) to its immutable numeric ID
          const bound = (await this.sql.unsafe(
            `UPDATE ${this.t("contributors")}
             SET provider_user_id = $1,
                 name = $2,
                 avatar_url = CASE WHEN $3 != '' THEN $3 ELSE avatar_url END
             WHERE id = $4
             RETURNING *`,
            [cleanUid, cleanName, cleanAvatar, handleOwner[0].id],
          )) as ContributorRecord[];
          return bound[0]!;
        }
        const suffix = createHash("sha256").update(cleanUid, "utf8").digest("hex").slice(0, 6);
        finalHandle = `${cleanHandle}-${suffix}`;
      }

      const inserted = (await this.sql.unsafe(
        `INSERT INTO ${this.t("contributors")} (provider, provider_user_id, handle, name, avatar_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.provider, cleanUid, finalHandle, cleanName, cleanAvatar, now],
      )) as ContributorRecord[];
      return inserted[0]!;
    }

    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("contributors")} (provider, provider_user_id, handle, name, avatar_url, created_at)
       VALUES ($1, '', $2, $3, $4, $5)
       ON CONFLICT (provider, handle) DO UPDATE SET
         name = EXCLUDED.name,
         avatar_url = CASE WHEN EXCLUDED.avatar_url != '' THEN EXCLUDED.avatar_url ELSE ${this.t("contributors")}.avatar_url END
       RETURNING *`,
      [input.provider, cleanHandle, cleanName, cleanAvatar, now],
    )) as ContributorRecord[];
    return rows[0]!;
  }

  async mintPublishToken(contributorId: number, label = "local-workbench"): Promise<{ token: string; prefix: string }> {
    const { plaintext, hash, prefix } = generatePublishToken();
    await this.sql.unsafe(
      `INSERT INTO ${this.t("publish_tokens")} (contributor_id, token_hash, token_prefix, label, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [contributorId, hash, prefix, label, new Date().toISOString()],
    );
    return { token: plaintext, prefix };
  }

  async verifyPublishToken(rawToken: string): Promise<ContributorRecord | null> {
    const clean = rawToken.replace(/^Bearer\s+/i, "").trim();
    if (!clean) return null;
    const h = hashToken(clean);
    const rows = (await this.sql.unsafe(
      `SELECT c.*, t.id AS token_id
       FROM ${this.t("publish_tokens")} t
       JOIN ${this.t("contributors")} c ON c.id = t.contributor_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [h],
    )) as Array<ContributorRecord & { token_id: number }>;
    const row = rows[0];
    if (!row) return null;
    await this.sql.unsafe(
      `UPDATE ${this.t("publish_tokens")} SET last_used_at = $1 WHERE id = $2`,
      [new Date().toISOString(), row.token_id],
    );
    return {
      id: row.id,
      provider: row.provider,
      provider_user_id: row.provider_user_id || "",
      handle: row.handle,
      name: row.name,
      avatar_url: row.avatar_url,
      created_at: row.created_at,
    };
  }

  async ensurePublicEntryIfMissing(entry: Partial<PublicEntryRecord> & { cf_id: number }): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.unsafe(
      `INSERT INTO ${this.t("public_entries")} (
        cf_id, title, status, topic, authors, reviewers, committer, thread_url,
        verdict, confidence, kind, seen_in_production, workaround, failing_summary,
        recommended_score, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (cf_id) DO NOTHING`,
      [
        entry.cf_id,
        entry.title || `CF ${entry.cf_id}`,
        entry.status || "",
        entry.topic || "",
        entry.authors || "",
        entry.reviewers || "",
        entry.committer || "",
        safeHttpUrl(entry.thread_url || ""),
        entry.verdict || "",
        entry.confidence || "",
        entry.kind || "feature",
        Boolean(entry.seen_in_production),
        entry.workaround || "",
        entry.failing_summary || "",
        Number(entry.recommended_score || 0),
        now,
      ],
    );
  }

  async upsertPublicEntry(entry: Partial<PublicEntryRecord> & { cf_id: number }): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.unsafe(
      `INSERT INTO ${this.t("public_entries")} (
        cf_id, title, status, topic, authors, reviewers, committer, thread_url,
        verdict, confidence, kind, seen_in_production, workaround, failing_summary,
        recommended_score, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (cf_id) DO UPDATE SET
        title = CASE WHEN EXCLUDED.title != '' THEN EXCLUDED.title ELSE ${this.t("public_entries")}.title END,
        status = CASE WHEN EXCLUDED.status != '' THEN EXCLUDED.status ELSE ${this.t("public_entries")}.status END,
        topic = CASE WHEN EXCLUDED.topic != '' THEN EXCLUDED.topic ELSE ${this.t("public_entries")}.topic END,
        authors = CASE WHEN EXCLUDED.authors != '' THEN EXCLUDED.authors ELSE ${this.t("public_entries")}.authors END,
        reviewers = CASE WHEN EXCLUDED.reviewers != '' THEN EXCLUDED.reviewers ELSE ${this.t("public_entries")}.reviewers END,
        committer = CASE WHEN EXCLUDED.committer != '' THEN EXCLUDED.committer ELSE ${this.t("public_entries")}.committer END,
        thread_url = CASE WHEN EXCLUDED.thread_url != '' THEN EXCLUDED.thread_url ELSE ${this.t("public_entries")}.thread_url END,
        verdict = CASE WHEN EXCLUDED.verdict != '' THEN EXCLUDED.verdict ELSE ${this.t("public_entries")}.verdict END,
        confidence = CASE WHEN EXCLUDED.confidence != '' THEN EXCLUDED.confidence ELSE ${this.t("public_entries")}.confidence END,
        kind = EXCLUDED.kind,
        seen_in_production = EXCLUDED.seen_in_production,
        workaround = EXCLUDED.workaround,
        failing_summary = EXCLUDED.failing_summary,
        recommended_score = EXCLUDED.recommended_score,
        updated_at = EXCLUDED.updated_at`,
      [
        entry.cf_id,
        entry.title || `CF ${entry.cf_id}`,
        entry.status || "",
        entry.topic || "",
        entry.authors || "",
        entry.reviewers || "",
        entry.committer || "",
        safeHttpUrl(entry.thread_url || ""),
        entry.verdict || "",
        entry.confidence || "",
        entry.kind || "feature",
        Boolean(entry.seen_in_production),
        entry.workaround || "",
        entry.failing_summary || "",
        Number(entry.recommended_score || 0),
        now,
      ],
    );
  }

  async publishOpinion(input: {
    cf_id: number;
    entry?: Partial<PublicEntryRecord>;
    contributor: ContributorRecord;
    backend: string;
    roast_level?: string;
    roast_flavour?: string;
    models?: Record<string, string> | string;
    verdict: string;
    confidence?: string;
    summary?: string;
  }): Promise<PublicOpinionRecord> {
    if (input.entry) {
      await this.ensurePublicEntryIfMissing({ ...input.entry, cf_id: input.cf_id, verdict: input.verdict });
    }
    const modelsJson = typeof input.models === "string" ? input.models : JSON.stringify(input.models ?? {});
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("public_opinions")} (
        cf_id, contributor_id, contributor_name, contributor_handle, contributor_provider,
        contributor_avatar, backend, roast_level, roast_flavour, models_json, verdict, confidence, summary, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        input.cf_id,
        input.contributor.id,
        input.contributor.name,
        input.contributor.handle,
        input.contributor.provider,
        input.contributor.avatar_url,
        input.backend,
        (input.roast_level || "medium").slice(0, 20),
        (input.roast_flavour || "default").slice(0, 40),
        modelsJson,
        input.verdict,
        input.confidence || "medium",
        (input.summary || "").slice(0, 1200),
        new Date().toISOString(),
      ],
    )) as PublicOpinionRecord[];
    return rows[0]!;
  }

  async listOpinions(cfId?: number, limit = 100): Promise<PublicOpinionRecord[]> {
    if (cfId != null) {
      return (await this.sql.unsafe(
        `SELECT * FROM ${this.t("public_opinions")} WHERE cf_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [cfId, limit],
      )) as PublicOpinionRecord[];
    }
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("public_opinions")} ORDER BY created_at DESC LIMIT $1`,
      [limit],
    )) as PublicOpinionRecord[];
  }

  async getEntry(cfId: number): Promise<PublicEntryRecord | null> {
    const rows = (await this.sql.unsafe(
      `SELECT * FROM ${this.t("public_entries")} WHERE cf_id = $1`,
      [cfId],
    )) as PublicEntryRecord[];
    return rows[0] ?? null;
  }

  async listEntries(opts?: { search?: string; verdict?: string; limit?: number }): Promise<PublicEntryRecord[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts?.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      const p = `$${params.length}`;
      where.push(`(CAST(cf_id AS TEXT) ILIKE ${p} OR title ILIKE ${p} OR authors ILIKE ${p} OR reviewers ILIKE ${p} OR committer ILIKE ${p} OR topic ILIKE ${p})`);
    }
    if (opts?.verdict && opts.verdict !== "all") {
      params.push(opts.verdict);
      where.push(`verdict = $${params.length}`);
    }
    params.push(Math.min(opts?.limit ?? 300, 1000));
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("public_entries")} ${whereSql} ORDER BY recommended_score DESC, cf_id DESC LIMIT $${params.length}`,
      params,
    )) as PublicEntryRecord[];
  }

  async savePublishedBrief(input: {
    slug: string;
    title: string;
    commitfestLabel: string;
    contributor: ContributorRecord;
    stats: unknown;
    shortlist: unknown[];
    closing: unknown[];
    entries: Array<Partial<PublicEntryRecord> & { cf_id: number }>;
  }): Promise<PublishedBriefRecord> {
    const now = new Date().toISOString();
    const safeSlug = input.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || `brief-${Date.now()}`;
    // Also populate public_entries table so search/explorer reflect the brief!
    for (const e of input.entries.slice(0, 1000)) {
      if (e.cf_id > 0) await this.upsertPublicEntry(e);
    }
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("published_briefs")} (
        slug, title, commitfest_label, published_by_provider, published_by_handle, published_by_name,
        stats_json, shortlist_json, closing_json, entries_json, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        commitfest_label = EXCLUDED.commitfest_label,
        published_by_provider = EXCLUDED.published_by_provider,
        published_by_handle = EXCLUDED.published_by_handle,
        published_by_name = EXCLUDED.published_by_name,
        stats_json = EXCLUDED.stats_json,
        shortlist_json = EXCLUDED.shortlist_json,
        closing_json = EXCLUDED.closing_json,
        entries_json = EXCLUDED.entries_json,
        created_at = EXCLUDED.created_at
      RETURNING *`,
      [
        safeSlug,
        input.title,
        input.commitfestLabel || "CommitFest",
        input.contributor.provider,
        input.contributor.handle,
        input.contributor.name,
        JSON.stringify(input.stats ?? {}),
        JSON.stringify(input.shortlist ?? []),
        JSON.stringify(input.closing ?? []),
        JSON.stringify(input.entries ?? []),
        now,
      ],
    )) as PublishedBriefRecord[];
    return rows[0]!;
  }

  async listBriefs(): Promise<Array<Pick<PublishedBriefRecord, "id" | "slug" | "title" | "commitfest_label" | "published_by_handle" | "published_by_name" | "created_at">>> {
    return (await this.sql.unsafe(
      `SELECT id, slug, title, commitfest_label, published_by_handle, published_by_name, created_at
       FROM ${this.t("published_briefs")} ORDER BY created_at DESC LIMIT 30`,
    )) as Array<Pick<PublishedBriefRecord, "id" | "slug" | "title" | "commitfest_label" | "published_by_handle" | "published_by_name" | "created_at">>;
  }

  async getBrief(slug?: string): Promise<PublishedBriefRecord | null> {
    if (slug && slug !== "latest") {
      const rows = (await this.sql.unsafe(
        `SELECT * FROM ${this.t("published_briefs")} WHERE slug = $1`,
        [slug],
      )) as PublishedBriefRecord[];
      return rows[0] ?? null;
    }
    const rows = (await this.sql.unsafe(
      `SELECT * FROM ${this.t("published_briefs")} ORDER BY created_at DESC LIMIT 1`,
    )) as PublishedBriefRecord[];
    return rows[0] ?? null;
  }

  async listCoordination(cfId?: number): Promise<SharedCoordinationRecord[]> {
    if (cfId != null) {
      return (await this.sql.unsafe(
        `SELECT * FROM ${this.t("shared_coordination")} WHERE cf_id = $1 ORDER BY updated_at DESC LIMIT 50`,
        [cfId],
      )) as SharedCoordinationRecord[];
    }
    return (await this.sql.unsafe(
      `SELECT * FROM ${this.t("shared_coordination")} ORDER BY updated_at DESC LIMIT 100`,
    )) as SharedCoordinationRecord[];
  }

  async upsertCoordination(input: {
    cf_id?: number | null;
    bug_ref?: string;
    title: string;
    status?: "open" | "in_progress" | "done";
    contributor: ContributorRecord;
    note?: string;
  }): Promise<SharedCoordinationRecord> {
    const now = new Date().toISOString();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("shared_coordination")} (
        cf_id, bug_ref, title, status, assignee_handle, assignee_name, note, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        input.cf_id ?? null,
        input.bug_ref || "",
        input.title.trim(),
        input.status || "in_progress",
        input.contributor.handle,
        input.contributor.name,
        (input.note || "").slice(0, 600),
        now,
        now,
      ],
    )) as SharedCoordinationRecord[];
    return rows[0]!;
  }

  async recordPageView(input: { path: string; cfId?: number | null; refHost?: string }): Promise<void> {
    try {
      await this.sql.unsafe(
        `INSERT INTO ${this.t("page_views")} (path, cf_id, ref_host, created_at) VALUES ($1, $2, $3, $4)`,
        [
          input.path.slice(0, 160),
          input.cfId && input.cfId > 0 ? input.cfId : null,
          (input.refHost || "").slice(0, 120),
          new Date().toISOString(),
        ],
      );
    } catch {
      // Never break page serving on analytics write issues
    }
  }

  async getCounts(): Promise<{ briefs: number; entries: number; opinions: number }> {
    const rows = (await this.sql.unsafe(
      `SELECT
         (SELECT COUNT(*)::int FROM ${this.t("published_briefs")}) AS briefs,
         (SELECT COUNT(*)::int FROM ${this.t("public_entries")}) AS entries,
         (SELECT COUNT(*)::int FROM ${this.t("public_opinions")}) AS opinions`,
    )) as Array<{ briefs: number; entries: number; opinions: number }>;
    const r = rows[0] ?? { briefs: 0, entries: 0, opinions: 0 };
    return {
      briefs: Number(r.briefs || 0),
      entries: Number(r.entries || 0),
      opinions: Number(r.opinions || 0),
    };
  }

  async getPageViewTotals(): Promise<{ total: number; last24h: number; last7d: number }> {
    const now = Date.now();
    const cut24h = new Date(now - 86_400_000).toISOString();
    const cut7d = new Date(now - 7 * 86_400_000).toISOString();
    const rows = (await this.sql.unsafe(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE created_at >= $1)::int AS last24h,
         COUNT(*) FILTER (WHERE created_at >= $2)::int AS last7d
       FROM ${this.t("page_views")}`,
      [cut24h, cut7d],
    )) as Array<{ total: number; last24h: number; last7d: number }>;
    const t = rows[0] ?? { total: 0, last24h: 0, last7d: 0 };
    return {
      total: Number(t.total || 0),
      last24h: Number(t.last24h || 0),
      last7d: Number(t.last7d || 0),
    };
  }

  async getBriefOwners(): Promise<{ slugOwners: Map<string, string>; allPublishers: Set<string> }> {
    const rows = (await this.sql.unsafe(
      `SELECT slug, published_by_provider, published_by_handle FROM ${this.t("published_briefs")}`,
    )) as Array<{ slug: string; published_by_provider: string; published_by_handle: string }>;
    const slugOwners = new Map<string, string>();
    const allPublishers = new Set<string>();
    for (const r of rows) {
      const h = (r.published_by_handle || "").trim().toLowerCase();
      const p = (r.published_by_provider || "github").trim().toLowerCase();
      const principal = h ? `${p}:${h}` : "";
      slugOwners.set(r.slug, principal);
      if (principal) allPublishers.add(principal);
    }
    return { slugOwners, allPublishers };
  }

  async getPageViewSummary(): Promise<{
    total: number;
    last24h: number;
    last7d: number;
    topPatches: Array<{ cf_id: number; hits: number }>;
    topReferrers: Array<{ ref_host: string; hits: number }>;
  }> {
    const now = Date.now();
    const cut24h = new Date(now - 86_400_000).toISOString();
    const cut7d = new Date(now - 7 * 86_400_000).toISOString();
    const [totalsRows, topPatchRows, topRefRows] = await Promise.all([
      this.sql.unsafe(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE created_at >= $1)::int AS last24h,
           COUNT(*) FILTER (WHERE created_at >= $2)::int AS last7d
         FROM ${this.t("page_views")}`,
        [cut24h, cut7d],
      ) as Promise<Array<{ total: number; last24h: number; last7d: number }>>,
      this.sql.unsafe(
        `SELECT cf_id, COUNT(*)::int AS hits
         FROM ${this.t("page_views")}
         WHERE cf_id IS NOT NULL
         GROUP BY cf_id
         ORDER BY hits DESC
         LIMIT 20`,
      ) as Promise<Array<{ cf_id: number; hits: number }>>,
      this.sql.unsafe(
        `SELECT ref_host, COUNT(*)::int AS hits
         FROM ${this.t("page_views")}
         WHERE ref_host != ''
         GROUP BY ref_host
         ORDER BY hits DESC
         LIMIT 15`,
      ) as Promise<Array<{ ref_host: string; hits: number }>>,
    ]);
    const t = totalsRows[0] ?? { total: 0, last24h: 0, last7d: 0 };
    return {
      total: Number(t.total || 0),
      last24h: Number(t.last24h || 0),
      last7d: Number(t.last7d || 0),
      topPatches: topPatchRows.map((r) => ({ cf_id: Number(r.cf_id), hits: Number(r.hits) })),
      topReferrers: topRefRows.map((r) => ({ ref_host: String(r.ref_host), hits: Number(r.hits) })),
    };
  }
}
