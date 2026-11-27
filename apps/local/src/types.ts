export type Verdict =
  | "LIKELY-REJECT"
  | "NEEDS-DESIGN-DISCUSSION"
  | "NEEDS-COMMITTER-EYES"
  | "NO-FUNDAMENTAL-OBJECTION";

export type Confidence = "low" | "medium" | "high";

export type ObjectionNovelty = "new" | "open_in_thread" | "revisits_precedent";

export interface AppSettings {
  port: number;
  host: string;
  authorName: string;
  pgroastRepo: string;
  roastDataDir: string;
  postgresRepo: string;
  worktreesRoot: string;
  skillsRepo: string;
  githubFork: string;
  gmailAccount: string;
  cfUsername: string;
  hetznerSshHost: string;
  hetznerRemoteRepo: string;
  claudeConfigDir: string;
  defaultBackend: "auto" | "claude" | "agy" | "codex" | "dual";
  defaultClaudeModel: string;
  defaultAgyModel: string;
  interestedTopics: string;
  publicHubUrl: string;
  authProvider: "" | "github" | "google" | "local";
  authHandle: string;
  authName: string;
  authAvatarUrl: string;
  onboardingCompleted: boolean;
}

export interface ContributorIdentity {
  provider: "github" | "google" | "local";
  handle: string;
  name: string;
  avatarUrl: string;
  signedIn: boolean;
}

export interface CfAuthStatus {
  username: string;
  hasSessionCookie: boolean;
  hasCsrfToken: boolean;
  lastVerifiedAt: string | null;
  verifiedUser: string | null;
}

export interface RoastPrecedentRef {
  id: string;
  title: string;
  url: string;
  thread_urls?: string[];
  date?: string | null;
  status?: string;
}

export interface RoastThreadRef {
  index: number;
  from: string;
  date: string;
  url: string;
}

export interface RoastObjection {
  id?: string;
  title: string;
  level?: string;
  rubric_item?: number | null;
  category?: string;
  touch_points?: string[];
  severity?: "fatal" | "fixable";
  novelty?: ObjectionNovelty;
  status?: "survived" | "refuted" | "withdrawn" | "duplicate";
  duplicate_of?: string | null;
  failure_scenario?: string;
  argument?: string;
  precedent_ids?: string[];
  thread_message_refs?: number[];
  author_must_show?: string;
  precedents?: RoastPrecedentRef[];
  thread_refs?: RoastThreadRef[];
  not_ranked_reason?: string | null;
  critic?: {
    refutation_kind?: string;
    reasoning?: string;
    original_severity?: string | null;
  };
}

export interface RoastPriorAttempt {
  precedent_id?: string;
  source_id?: string;
  title: string;
  kind?: string;
  status?: string;
  url?: string;
  thread_urls?: string[];
  date?: string | null;
  first_date?: string | null;
  who_objected?: string;
  quote?: string | null;
  quote_url?: string | null;
  reason?: string;
  relation?: "same_idea" | "similar_idea" | "related_only" | string;
  what_is_different?: string;
}

export interface RoastJson {
  schema_version?: number;
  tool?: string;
  generated_at?: string;
  input?: {
    arg?: string;
    cf?: {
      id?: number;
      url?: string;
      title?: string;
      status?: string;
      authors?: string;
      reviewers?: string;
      committer?: string;
      redacted?: boolean;
    };
    thread_url?: string;
    thread_urls?: string[];
    subject?: string;
    thread_start?: string;
    messages_read?: number;
    messages_total?: number;
    attachments_read?: string[];
    patch_version?: string;
  };
  mode?: string;
  roast_level?: "light" | "medium" | "dark";
  roast_flavour?: string;
  backend?: string;
  models?: Record<string, string>;
  verdict: Verdict | string;
  confidence?: Confidence | string;
  verdict_reasoning?: string;
  failing_level?: string | null;
  levels?: Array<{ level: string; name: string; status: string }>;
  brief?: {
    title?: string;
    problem?: string;
    proposed_design?: string;
    user_visible_surface?: string[];
    author_claims?: string[];
    thread_state?: string;
    unclear?: string[];
    touched_files?: string[];
  };
  prior_attempts?: RoastPriorAttempt[];
  objections?: RoastObjection[];
  all_objections?: RoastObjection[];
  questions?: string[];
  touch_points?: Array<{ id: string; label?: string; hit: boolean; reason?: string }>;
  committability?: {
    owner?: string;
    owner_note?: string;
    liability?: string;
    author_follow_up?: string;
  };
  not_now?: {
    applies?: boolean;
    evidence_that_would_change_it?: string;
  };
  priority?: {
    audience?: string;
    maintenance_burden?: string;
    review_cost?: string;
    recommended_action?: string;
    reason?: string;
  };
  provisional_note?: string;
}

export interface CfBotStats {
  version?: string;
  patchCount?: number;
  firstAdditions?: number;
  firstDeletions?: number;
  allAdditions?: number;
  allDeletions?: number;
  needsRebase?: boolean;
  failing?: boolean;
  summaryText?: string;
  jobs?: Array<{ name: string; status: string; url: string }>;
}

export interface CfEntryRecord {
  cf_id: number;
  cf_number: number | null;
  title: string;
  status: string;
  topic: string;
  authors: string;
  reviewers: string;
  committer: string;
  target_version: string;
  thread_url: string;
  latest_message_id: string;
  latest_message_time: string;
  cfbot_status: string;
  cfbot_branch: string;
  cfbot_build_url: string;
  cfbot_apply_url: string;
  cfbot_stats_json: string;
  attachments_json: string;
  verdict: string;
  confidence: string;
  objection_count: number;
  new_objection_count: number;
  prior_attempts_count: number;
  priority_action: string;
  recommended_score: number;
  roast_json: string;
  roast_md: string;
  pushback_json: string;
  pushback_md: string;
  is_mine: number;
  mine_role: string;
  updated_at: string;
  synced_at: string;
}

export interface RoastRunRecord {
  id: number;
  cf_id: number;
  mode: string;
  roast_level?: string;
  roast_flavour?: string;
  backend: string;
  models_json: string;
  rounds: number;
  verdict: string;
  confidence: string;
  roast_json: string;
  roast_md: string;
  summary_txt: string;
  contributor_name: string;
  contributor_handle: string;
  contributor_provider: string;
  contributor_avatar: string;
  created_at: string;
}

export type JobKind =
  | "roast"
  | "bulk_roast"
  | "pushback"
  | "build_test"
  | "ai_review"
  | "blind_verify"
  | "bugs_triage"
  | "hetzner_run"
  | "contribute";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  kind: JobKind;
  cf_id: number | null;
  title: string;
  status: JobStatus;
  model: string;
  backend: string;
  command: string;
  worktree_path: string;
  pid: number | null;
  pgid: number | null;
  log_path: string;
  exit_code: number | null;
  result_json: string;
  error: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface WorkItemRecord {
  id: number;
  cf_id: number | null;
  slug: string;
  title: string;
  status: "open" | "testing" | "verified" | "draft_ready" | "posted" | "closed";
  upstream_base_sha: string;
  target_branch: string;
  patch_hashes_json: string;
  suites_run_json: string;
  worktree_path: string;
  evidence_md: string;
  github_issue_number: number | null;
  github_issue_url: string;
  ci_branch: string;
  is_security: number;
  created_at: string;
  updated_at: string;
}

export interface DraftAttachment {
  filename: string;
  path?: string;
  contentBase64?: string;
  contentText?: string;
  mimeType?: string;
  sha256?: string;
}

export interface DraftRecord {
  id: number;
  cf_id: number | null;
  work_item_id: number | null;
  kind: "review" | "own_patch" | "bug_report" | "shortlist" | "pushback" | "custom";
  is_reply: number;
  is_other_author_thread: number;
  thread_id: string;
  in_reply_to: string;
  references_header: string;
  to_addrs: string;
  cc_addrs: string;
  subject: string;
  body: string;
  attachments_json: string;
  gate_results_json: string;
  gmail_draft_id: string;
  gmail_draft_url: string;
  created_at: string;
  updated_at: string;
}

export interface GateIssue {
  code: string;
  severity: "block" | "warn" | "info";
  message: string;
  match?: string;
  line?: number;
}

export interface GateCheckResult {
  gate: "confidentiality" | "cfbot_attachments" | "plain_text_etiquette" | "duplicate_freshness";
  passed: boolean;
  blocking: boolean;
  issues: GateIssue[];
}

export interface AllGatesResult {
  canSaveDraft: boolean;
  hardBlocked: boolean;
  warningCount: number;
  blockCount: number;
  gates: {
    confidentiality: GateCheckResult;
    cfbot_attachments: GateCheckResult;
    plain_text_etiquette: GateCheckResult;
    duplicate_freshness: GateCheckResult;
  };
}

export interface BugReportRecord {
  id: number;
  message_id: string;
  subject: string;
  sender: string;
  thread_url: string;
  reported_at: string;
  classification: "production_hit" | "synthetic_ai_hunt" | "unclear";
  severity: "data_loss" | "wrong_results" | "crash" | "oom" | "regression" | "minor" | "unknown";
  confidence: number;
  production_signals_json: string;
  summary: string;
  affected_versions: string;
  status: "new" | "triaged" | "reproducing" | "reproduced" | "replied" | "dismissed";
  work_item_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRecord {
  id: number;
  action: string;
  target: string;
  details_json: string;
  status: "ok" | "blocked" | "error";
  created_at: string;
}

export interface ExpertSuggestion {
  name: string;
  commits: number;
  source: "git_log" | "subsystem_heuristic";
  subsystem?: string;
}

export interface ShortlistEntry {
  cf_id: number;
  title: string;
  status: string;
  authors: string;
  verdict: string;
  confidence: string;
  kind: "bugfix" | "feature";
  seen_in_production: boolean;
  production_signal: string;
  workaround: string;
  score: number;
  reasons: string[];
  audience: string;
  review_cost: string;
  objection_count: number;
  new_objection_count: number;
  prior_attempts_count: number;
  priority_action: string;
  first_objection: string;
  thread_url: string;
  experts: ExpertSuggestion[];
}

export interface Top50RejectEntry {
  cf_id: number;
  title: string;
  status: string;
  authors: string;
  verdict: string;
  confidence: string;
  kind: "bugfix" | "feature";
  workaround: string;
  failing_summary: string;
  score: number;
  recommended_action: string;
  reasons: string[];
  next_step_for_author: string;
  objection_count: number;
  prior_attempts_count: number;
  thread_url: string;
}

export interface SetupGuide {
  title: string;
  steps: string[];
  command?: string;
  linkUrl?: string;
  linkLabel?: string;
}

export interface DoctorCheckItem {
  name: string;
  category: "llm" | "tool" | "repo" | "auth";
  ok: boolean;
  required?: boolean;
  status?: "ok" | "optional" | "missing";
  version?: string;
  path?: string;
  detail: string;
  setupGuide?: SetupGuide;
}

export interface EntryTriageRecord {
  cf_id: number;
  starred: number;
  tags: string[];
  notes: string;
  visited_at: string;
  updated_at: string;
}

export interface SavedSearchRecord {
  id: number;
  name: string;
  query: string;
  created_at: string;
}

export interface DiffCommentRecord {
  id: number;
  cf_id: number;
  file_path: string;
  line_num: number;
  line_type: "add" | "del" | "ctx";
  code_snippet: string;
  comment_text: string;
  created_at: string;
}

export interface CfEntryListItem extends Omit<CfEntryRecord, "roast_json" | "roast_md" | "pushback_json" | "pushback_md"> {
  starred?: number;
  tags_json?: string;
  notes?: string;
  visited_at?: string;
}

export interface StatsReport {
  generatedAt: string;
  totals: {
    total: number;
    open: number;
    closed: number;
    roasted: number;
    unroasted: number;
    openRoasted: number;
    openUnroasted: number;
  };
  verdicts: Array<{ verdict: string; all: number; open: number }>;
  statusMatrix: Array<{
    status: string;
    isClosed: boolean;
    total: number;
    counts: Record<string, number>;
  }>;
  novelty: {
    totalObjections: number;
    newCount: number;
    precedentCount: number;
    openInThreadCount: number;
    entriesWithNovel: number;
  };
  cfbot: Record<string, number>;
  topTopics: Array<{
    topic: string;
    total: number;
    open: number;
    roasted: number;
    clean: number;
    ready: number;
  }>;
  leaderboards: {
    authors: Array<{ name: string; count: number }>;
    reviewers: Array<{ name: string; count: number }>;
    committers: Array<{ name: string; count: number }>;
  };
  rfcNoCommitter: Array<{
    cf_id: number;
    title: string;
    verdict: string;
    authors: string;
    score: number;
  }>;
  bugs: {
    total: number;
    byClassification: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  triage: {
    starred: number;
    visited: number;
    tagged: number;
    noted: number;
    workItems: number;
    drafts: number;
  };
}

export interface GmailThreadMatch {
  messageIdHeader: string;
  gmailMessageId: string;
  threadId: string;
  references: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  snippet: string;
}
