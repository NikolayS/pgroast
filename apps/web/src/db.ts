import { SQL } from "bun";
import { generatePublishToken, hashToken } from "./security.ts";

export interface ContributorRecord {
  id: number;
  provider: "github" | "google";
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
        handle TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (provider, handle)
      )`,
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
        published_by_handle TEXT NOT NULL DEFAULT '',
        published_by_name TEXT NOT NULL DEFAULT '',
        stats_json TEXT NOT NULL DEFAULT '{}',
        shortlist_json TEXT NOT NULL DEFAULT '[]',
        closing_json TEXT NOT NULL DEFAULT '[]',
        entries_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      )`,
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
    ];
    for (const s of stmts) {
      await this.sql.unsafe(s);
    }
  }

  async upsertContributor(input: {
    provider: "github" | "google";
    handle: string;
    name: string;
    avatarUrl?: string;
  }): Promise<ContributorRecord> {
    const now = new Date().toISOString();
    const rows = (await this.sql.unsafe(
      `INSERT INTO ${this.t("contributors")} (provider, handle, name, avatar_url, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, handle) DO UPDATE SET
         name = EXCLUDED.name,
         avatar_url = CASE WHEN EXCLUDED.avatar_url != '' THEN EXCLUDED.avatar_url ELSE ${this.t("contributors")}.avatar_url END
       RETURNING *`,
      [input.provider, input.handle.trim(), input.name.trim() || input.handle.trim(), input.avatarUrl || "", now],
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
      handle: row.handle,
      name: row.name,
      avatar_url: row.avatar_url,
      created_at: row.created_at,
    };
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
        entry.thread_url || "",
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
      await this.upsertPublicEntry({ ...input.entry, cf_id: input.cf_id, verdict: input.verdict });
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
        slug, title, commitfest_label, published_by_handle, published_by_name,
        stats_json, shortlist_json, closing_json, entries_json, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        commitfest_label = EXCLUDED.commitfest_label,
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
