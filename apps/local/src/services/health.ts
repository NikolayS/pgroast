import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { buildChildEnv, expandHome } from "../config.ts";
import type { AppDatabase } from "../db.ts";
import type { AppSettings, DoctorCheckItem, SetupGuide } from "../types.ts";
import { getActiveSkills } from "./skills.ts";

function checkBinary(
  name: string,
  category: DoctorCheckItem["category"],
  versionArgs: string[],
  env: Record<string, string>,
  opts?: { required?: boolean; setupGuide?: SetupGuide },
): DoctorCheckItem {
  const whichRes = spawnSync("which", [name], { encoding: "utf8", env, timeout: 3000 });
  const binPath = whichRes.status === 0 ? whichRes.stdout.trim() : "";
  if (!binPath) {
    const required = opts?.required ?? false;
    return {
      name,
      category,
      ok: false,
      required,
      status: required ? "missing" : "optional",
      detail: required ? `${name} not found in PATH` : `${name} not installed (optional)`,
      setupGuide: opts?.setupGuide,
    };
  }
  const verRes = spawnSync(binPath, versionArgs, { encoding: "utf8", env, timeout: 5000 });
  const out = (verRes.stdout || verRes.stderr || "").trim().split(/\r?\n/)[0] || "";
  const ok = verRes.status === 0 || Boolean(out);
  return {
    name,
    category,
    ok,
    required: opts?.required ?? false,
    status: ok ? "ok" : (opts?.required ? "missing" : "optional"),
    path: binPath,
    version: out.slice(0, 80),
    detail: verRes.status === 0 ? "Ready" : `Exit ${verRes.status}: ${out.slice(0, 80)}`,
    setupGuide: opts?.setupGuide,
  };
}

export interface AiBackendSummary {
  available: Array<"claude" | "codex" | "agy">;
  dualReady: boolean;
  recommendedDefault: "claude" | "codex" | "agy" | "dual" | "none";
}

export function detectAvailableAiBackends(settings: AppSettings): AiBackendSummary {
  const env = buildChildEnv(settings);
  const available: Array<"claude" | "codex" | "agy"> = [];
  for (const bin of ["claude", "codex", "agy"] as const) {
    const whichRes = spawnSync("which", [bin], { encoding: "utf8", env, timeout: 2500 });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      available.push(bin);
    }
  }
  const dualReady = available.includes("claude") && available.includes("agy");
  const recommendedDefault: AiBackendSummary["recommendedDefault"] =
    available[0] ?? "none";
  return { available, dualReady, recommendedDefault };
}

export async function runDoctor(db: AppDatabase, settings: AppSettings): Promise<{
  checkedAt: string;
  checks: DoctorCheckItem[];
  aiSummary: AiBackendSummary;
  skillsSummary: { mode: "builtin" | "custom"; count: number; customDir: string; customDirValid: boolean };
  summary: { ok: number; total: number; requiredOk: number; requiredTotal: number };
}> {
  const env = buildChildEnv(settings);
  let pgCheck: DoctorCheckItem;
  try {
    const pgInfo = await db.getServerInfo();
    const shortVer = pgInfo.version.split(" on ")[0] || pgInfo.version;
    pgCheck = {
      name: "postgresql",
      category: "tool",
      ok: true,
      required: true,
      status: "ok",
      version: shortVer.slice(0, 80),
      detail: `Connected to PostgreSQL database "${pgInfo.database}" (schema: ${pgInfo.schema})`,
    };
  } catch (err) {
    pgCheck = {
      name: "postgresql",
      category: "tool",
      ok: false,
      required: true,
      status: "missing",
      detail: `PostgreSQL connection failed: ${err instanceof Error ? err.message : String(err)}`,
      setupGuide: {
        title: "Start local PostgreSQL 19 (Homebrew or Docker)",
        steps: [
          "Install & start PostgreSQL 19 via Homebrew, OR run `docker compose up -d` in the pgroast-app folder.",
          "Or set DATABASE_URL / PGROAST_DATABASE_URL to any PostgreSQL connection string.",
        ],
        command: "brew install postgresql@19 && brew services start postgresql@19",
        linkUrl: "https://www.postgresql.org/download/",
        linkLabel: "PostgreSQL Downloads",
      },
    };
  }

  const claudeCheck = checkBinary("claude", "llm", ["--version"], env, {
    required: false,
    setupGuide: {
      title: "Install & sign in to Claude Code",
      steps: [
        "Install Claude Code CLI from Anthropic.",
        "Run `claude` once and complete `/login` with your subscription.",
        "If you use a custom config directory, set Claude Config Dir in Settings.",
      ],
      command: "npm install -g @anthropic-ai/claude-code && claude",
      linkUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
      linkLabel: "Claude Code docs",
    },
  });

  const codexCheck = checkBinary("codex", "llm", ["--version"], env, {
    required: false,
    setupGuide: {
      title: "Install & sign in to OpenAI Codex CLI",
      steps: [
        "Install Codex CLI globally.",
        "Sign in with your ChatGPT/Codex subscription.",
      ],
      command: "npm install -g @openai/codex && codex login",
      linkUrl: "https://github.com/openai/codex",
      linkLabel: "Codex CLI on GitHub",
    },
  });

  const agyCheck = checkBinary("agy", "llm", ["--version"], env, {
    required: false,
    setupGuide: {
      title: "Install & sign in to Antigravity CLI (agy)",
      steps: [
        "Install Antigravity CLI (`agy`) and complete sign-in.",
        "Once both `claude` and `agy` are installed, cross-family Dual mode unlocks automatically.",
      ],
      command: "agy --version",
    },
  });

  const availableAi: Array<"claude" | "codex" | "agy"> = [];
  if (claudeCheck.ok) availableAi.push("claude");
  if (codexCheck.ok) availableAi.push("codex");
  if (agyCheck.ok) availableAi.push("agy");

  const dualReady = availableAi.includes("claude") && availableAi.includes("agy");
  const recommendedDefault: AiBackendSummary["recommendedDefault"] = availableAi[0] ?? "none";

  // Single-AI-first readiness check: only ONE AI CLI is required to be ready!
  const aiReadyCheck: DoctorCheckItem = {
    name: "ai-backend",
    category: "llm",
    ok: availableAi.length >= 1,
    required: true,
    status: availableAi.length >= 1 ? "ok" : "missing",
    detail:
      availableAi.length >= 1
        ? dualReady
          ? `Ready (${availableAi.join(", ")}) — single AI and cross-family Dual mode available`
          : `Ready (${availableAi.join(", ")}) — single AI mode works out of the box`
        : "Install at least ONE AI CLI (Claude Code, Codex, or Antigravity agy) to run roasts & AI reviews",
    setupGuide: {
      title: "Configure any 1 AI CLI (only one needed)",
      steps: [
        "Pick the AI CLI you already subscribe to: Claude Code, Codex CLI, or Antigravity (agy).",
        "Install it and sign in once via terminal.",
        "Click Re-run Doctor — pgroast-app will auto-select it.",
      ],
      command: "claude --version || codex --version || agy --version",
      linkUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
      linkLabel: "Claude Code setup",
    },
  };

  const checks: DoctorCheckItem[] = [
    pgCheck,
    aiReadyCheck,
    claudeCheck,
    codexCheck,
    agyCheck,
    checkBinary("git", "tool", ["--version"], env, {
      required: true,
      setupGuide: {
        title: "Install Git",
        steps: ["Install Git (macOS: `xcode-select --install` or `brew install git`)."],
        command: "xcode-select --install",
      },
    }),
    checkBinary("gws", "tool", ["--version"], env, {
      required: false,
      setupGuide: {
        title: "Optional: Gmail Drafts via Google Workspace CLI (gws)",
        steps: [
          "Install `gws` so Reply Studio can find exact mailing-list threads and save unsent Gmail drafts.",
          "Authorize with `gmail.modify` scope (pgroast-app never auto-sends emails).",
        ],
        command: "brew install googleworkspace-cli && gws auth login --scopes gmail.modify",
        linkUrl: "https://github.com/googleworkspace/cli",
        linkLabel: "gws CLI on GitHub",
      },
    }),
    checkBinary("gh", "tool", ["--version"], env, {
      required: false,
      setupGuide: {
        title: "Optional: GitHub CLI (gh) for Fork Issues & CI",
        steps: [
          "Install `gh` and sign in to sync sanitized work items and CI branches to your PostgreSQL fork.",
        ],
        command: "brew install gh && gh auth login",
        linkUrl: "https://cli.github.com/",
        linkLabel: "GitHub CLI docs",
      },
    }),
    checkBinary("meson", "tool", ["--version"], env, {
      required: false,
      setupGuide: {
        title: "Optional: Meson + Ninja for Local Patch Build & Test",
        steps: ["Install meson and ninja to compile and run PostgreSQL tests in isolated worktrees."],
        command: "brew install meson ninja",
        linkUrl: "https://www.postgresql.org/docs/current/installation-platform-notes.html",
        linkLabel: "PostgreSQL build docs",
      },
    }),
    checkBinary("ninja", "tool", ["--version"], env, {
      required: false,
      setupGuide: {
        title: "Optional: Ninja build tool",
        steps: ["Install ninja alongside meson for fast incremental PostgreSQL builds."],
        command: "brew install ninja",
      },
    }),
  ];

  // pgroast CLI repo
  const pgroastPath = expandHome(settings.pgroastRepo);
  const hasPgroast = Boolean(pgroastPath) && existsSync(pgroastPath);
  checks.push({
    name: "pgroastRepo",
    category: "repo",
    ok: hasPgroast,
    required: false,
    status: hasPgroast ? "ok" : "optional",
    path: pgroastPath,
    detail: hasPgroast
      ? "pgroast v2 CLI present"
      : `Optional for running new roasts — clone pgroast or set path in Settings (${pgroastPath || "not set"})`,
    setupGuide: {
      title: "Clone pgroast v2 CLI",
      steps: [
        "Clone the pgroast repository next to pgroast-app (or any folder) and set the path in Settings.",
      ],
      command: "git clone https://github.com/NikolayS/pgroast.git ~/pgroast",
      linkUrl: "https://github.com/NikolayS/pgroast",
      linkLabel: "pgroast on GitHub",
    },
  });

  // Local PostgreSQL git clone
  const pgRepoPath = expandHome(settings.postgresRepo);
  const hasPgRepo = Boolean(pgRepoPath) && existsSync(pgRepoPath);
  checks.push({
    name: "postgresRepo",
    category: "repo",
    ok: hasPgRepo,
    required: false,
    status: hasPgRepo ? "ok" : "optional",
    path: pgRepoPath,
    detail: hasPgRepo
      ? "Local PostgreSQL git clone present (worktrees & git-log expert routing enabled)"
      : "Optional — add a local postgres git clone for worktree builds & git-log reviewer routing",
    setupGuide: {
      title: "Clone PostgreSQL for local patch builds & expert routing",
      steps: [
        "Clone upstream PostgreSQL (or your fork) locally.",
        "Paste the folder path into Settings -> PostgreSQL Git Clone.",
      ],
      command: "git clone https://git.postgresql.org/git/postgresql.git ~/postgres",
      linkUrl: "https://github.com/postgres/postgres",
      linkLabel: "PostgreSQL on GitHub",
    },
  });

  // Skills (built-in defaults always ready; optional custom folder overrides)
  const skillsInfo = getActiveSkills(settings);
  const customMissing = Boolean(skillsInfo.customDirConfigured) && !skillsInfo.customDirValid;
  checks.push({
    name: "skills",
    category: "repo",
    ok: !customMissing,
    required: false,
    status: customMissing ? "optional" : "ok",
    path: skillsInfo.customDirValid ? expandHome(skillsInfo.customDirConfigured) : "(built-in defaults)",
    detail: customMissing
      ? `Custom skills folder not found (${skillsInfo.customDirConfigured}) — falling back to ${skillsInfo.skills.length} built-in basic skills`
      : skillsInfo.mode === "custom"
        ? `Custom skills folder active (${skillsInfo.skills.length} skills loaded, overriding built-in defaults)`
        : `Built-in basic skills active (${skillsInfo.skills.length} default skills ready; optionally point to your own folder)`,
    setupGuide: {
      title: "Skills: Built-in defaults vs. your own custom folder",
      steps: [
        "Out of the box, pgroast-app uses simple built-in skills for plain-text -hackers replies, patch verification, and bug triage.",
        "To customize writing voice or review workflows, point Settings -> Custom Skills Folder to your own local folder of .md or <name>/SKILL.md files.",
      ],
    },
  });

  // Optional CommitFest login
  const cfAuth = await db.getCfAuthStatus();
  const cfLabel = cfAuth.username ? `commitfest:${cfAuth.username}` : "commitfest:login";
  checks.push({
    name: cfLabel,
    category: "auth",
    ok: cfAuth.hasSessionCookie,
    required: false,
    status: cfAuth.hasSessionCookie ? "ok" : "optional",
    detail: cfAuth.hasSessionCookie
      ? cfAuth.verifiedUser
        ? `Signed in & verified as ${cfAuth.verifiedUser}`
        : "Cookie stored (click Verify Login /me/)"
      : "Optional — CommitFest read-only browsing & sync work without login; add cookies only for status/reviewer writes",
    setupGuide: {
      title: "Connect PostgreSQL Community / CommitFest Login (3 clicks)",
      steps: [
        "1. Click the link below and sign in with your PostgreSQL Community Account.",
        "2. Open Browser DevTools (Cmd+Opt+I on Mac, F12 on Linux/Win) -> Application -> Cookies -> commitfest.postgresql.org.",
        "3. Copy the `sessionid` and `csrftoken` values into Settings (or Onboarding Step 4) and click Verify Login.",
      ],
      linkUrl: "https://commitfest.postgresql.org/account/login/",
      linkLabel: "Open CommitFest Login",
    },
  });

  const ok = checks.filter((c) => c.ok).length;
  const requiredChecks = checks.filter((c) => c.required);
  const requiredOk = requiredChecks.filter((c) => c.ok).length;

  return {
    checkedAt: new Date().toISOString(),
    checks,
    aiSummary: { available: availableAi, dualReady, recommendedDefault },
    skillsSummary: {
      mode: skillsInfo.mode,
      count: skillsInfo.skills.length,
      customDir: skillsInfo.customDirConfigured,
      customDirValid: skillsInfo.customDirValid,
    },
    summary: {
      ok,
      total: checks.length,
      requiredOk,
      requiredTotal: requiredChecks.length,
    },
  };
}
