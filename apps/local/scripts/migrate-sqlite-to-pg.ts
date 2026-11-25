import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { DEFAULT_DATABASE_URL, LEGACY_SQLITE_PATH } from "../src/config.ts";
import { AppDatabase } from "../src/db.ts";

async function migrate(): Promise<void> {
  const sqlitePath = process.argv[2] || LEGACY_SQLITE_PATH;
  if (!existsSync(sqlitePath)) {
    console.log(`No legacy SQLite database found at ${sqlitePath}; nothing to migrate.`);
    return;
  }

  console.log(`Migrating ${sqlitePath} -> ${DEFAULT_DATABASE_URL} ...`);
  const src = new Database(sqlitePath, { readonly: true });
  const dst = await AppDatabase.create({ databaseUrl: DEFAULT_DATABASE_URL });

  const copyTable = async (
    table: string,
    cols: string[],
    conflictCol: string,
    seqCol?: string,
  ): Promise<number> => {
    const exists = src.query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table);
    if (!exists) return 0;

    const srcCols = new Set(
      src.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name),
    );
    const activeCols = cols.filter((c) => srcCols.has(c));
    if (activeCols.length === 0) return 0;

    const rows = src.query<Record<string, unknown>, []>(`SELECT ${activeCols.join(", ")} FROM ${table}`).all();
    const placeholders = activeCols.map((_, idx) => `$${idx + 1}`).join(", ");
    const updates = activeCols
      .filter((c) => c !== conflictCol)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");
    const sql = `INSERT INTO ${dst.t(table)} (${activeCols.join(", ")}) VALUES (${placeholders}) ON CONFLICT (${conflictCol}) DO UPDATE SET ${updates}`;

    for (const row of rows) {
      const vals = activeCols.map((c) => (row[c] === undefined ? null : row[c]));
      await dst.sql.unsafe(sql, vals);
    }

    if (seqCol && rows.length > 0) {
      await dst.sql.unsafe(
        `SELECT setval(pg_get_serial_sequence('${dst.t(table)}', '${seqCol}'), COALESCE((SELECT MAX(${seqCol}) FROM ${dst.t(table)}), 1), true)`,
      );
    }
    return rows.length;
  };

  const counts: Record<string, number> = {};
  counts.settings = await copyTable("settings", ["key", "value", "updated_at"], "key");
  counts.cf_entries = await copyTable(
    "cf_entries",
    [
      "cf_id", "cf_number", "title", "status", "topic", "authors", "reviewers", "committer",
      "target_version", "thread_url", "latest_message_id", "latest_message_time",
      "cfbot_status", "cfbot_branch", "cfbot_build_url", "cfbot_apply_url",
      "cfbot_stats_json", "attachments_json", "verdict", "confidence",
      "objection_count", "new_objection_count", "prior_attempts_count",
      "priority_action", "recommended_score", "roast_json", "roast_md",
      "pushback_json", "pushback_md", "is_mine", "mine_role", "updated_at", "synced_at",
    ],
    "cf_id",
  );
  counts.roast_runs = await copyTable(
    "roast_runs",
    [
      "id", "cf_id", "mode", "backend", "models_json", "rounds", "verdict", "confidence",
      "roast_json", "roast_md", "summary_txt",
      "contributor_name", "contributor_handle", "contributor_provider", "contributor_avatar",
      "created_at",
    ],
    "id",
    "id",
  );
  counts.jobs = await copyTable(
    "jobs",
    [
      "id", "kind", "cf_id", "title", "status", "model", "backend", "command",
      "worktree_path", "pid", "pgid", "log_path", "exit_code", "result_json",
      "error", "created_at", "started_at", "finished_at",
    ],
    "id",
  );
  counts.work_items = await copyTable(
    "work_items",
    [
      "id", "cf_id", "slug", "title", "status", "upstream_base_sha", "target_branch",
      "patch_hashes_json", "suites_run_json", "worktree_path", "evidence_md",
      "github_issue_number", "github_issue_url", "ci_branch", "is_security",
      "created_at", "updated_at",
    ],
    "id",
    "id",
  );
  counts.drafts = await copyTable(
    "drafts",
    [
      "id", "cf_id", "work_item_id", "kind", "is_reply", "is_other_author_thread",
      "thread_id", "in_reply_to", "references_header", "to_addrs", "cc_addrs",
      "subject", "body", "attachments_json", "gate_results_json",
      "gmail_draft_id", "gmail_draft_url", "created_at", "updated_at",
    ],
    "id",
    "id",
  );
  counts.bug_reports = await copyTable(
    "bug_reports",
    [
      "id", "message_id", "subject", "sender", "thread_url", "reported_at",
      "classification", "severity", "confidence", "production_signals_json",
      "summary", "affected_versions", "status", "work_item_id", "created_at", "updated_at",
    ],
    "message_id",
    "id",
  );
  counts.audit_log = await copyTable(
    "audit_log",
    ["id", "action", "target", "details_json", "status", "created_at"],
    "id",
    "id",
  );
  counts.entry_triage = await copyTable(
    "entry_triage",
    ["cf_id", "starred", "tags_json", "notes", "visited_at", "updated_at"],
    "cf_id",
  );
  counts.saved_searches = await copyTable(
    "saved_searches",
    ["id", "name", "query", "created_at"],
    "name",
    "id",
  );

  src.close();
  await dst.close();
  console.log("Migration complete:", JSON.stringify(counts, null, 2));
}

await migrate();
