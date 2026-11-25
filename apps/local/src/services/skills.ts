import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { expandHome } from "../config.ts";
import type { AppSettings } from "../types.ts";

export interface ActiveSkill {
  name: string;
  source: "builtin" | "custom";
  path: string;
  summary: string;
  content: string;
}

const FALLBACK_BUILTIN_SKILLS: Record<string, { summary: string; content: string }> = {
  "hackers-review": {
    summary: "Basic plain-text pgsql-hackers review etiquette, bottom-posting, 72-col wrap, cfbot safety",
    content: [
      "# Basic pgsql-hackers Review Skill (Built-in Default)",
      "- Send plain text only: no Markdown fences, inline backticks, HTML, headings, or emojis.",
      "- Bottom-post or interleave replies below quoted text (> ) starting with 'On <date>, <Author> wrote:'.",
      "- Wrap prose lines at 72 characters; leave SQL, logs, URLs, and > quotes unwrapped.",
      "- Number URLs as [1], [2] in prose and place full URLs at the bottom before your sign-off.",
      "- On another author's CommitFest thread, prefix attachments with nocfbot- or use .txt so cfbot does not pick them up.",
      "- State clearly what AI helped with and what you verified yourself. Never auto-send.",
    ].join("\n"),
  },
  "patch-verify": {
    summary: "Isolated git worktree apply, meson debug+cassert build, and targeted test checklist",
    content: [
      "# Basic Patch Verification Skill (Built-in Default)",
      "- Use an isolated git worktree from origin/master; never dirty the main checkout.",
      "- Verify patch application with git apply --check before git apply.",
      "- Build with meson (--buildtype=debug -Dcassert=true) and run targeted regression or TAP tests.",
      "- Report exact base commit, patch filenames, commands run, and observed pass/fail output.",
    ].join("\n"),
  },
  "bug-triage": {
    summary: "Prioritize real production user hits over synthetic fuzzer / AI bug hunts",
    content: [
      "# Basic pgsql-bugs Triage Skill (Built-in Default)",
      "- Separate real production hits from synthetic fuzzers (sqlsmith/sqlancer) and devel assertion hunts.",
      "- Rank impact: data loss/corruption > wrong results > crash/OOM > regression > performance > minor.",
    ].join("\n"),
  },
};

function firstDescriptionLine(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  return (lines[0] || "Skill instructions").slice(0, 120);
}

function scanSkillsDirectory(dir: string, source: "builtin" | "custom"): ActiveSkill[] {
  if (!dir || !existsSync(dir)) return [];
  const out: ActiveSkill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries.sort()) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && entry.endsWith(".md") && entry.toLowerCase() !== "readme.md") {
      const content = readFileSync(full, "utf8");
      out.push({
        name: basename(entry, ".md"),
        source,
        path: full,
        summary: firstDescriptionLine(content),
        content,
      });
    } else if (st.isDirectory()) {
      const nestedSkill = join(full, "SKILL.md");
      if (existsSync(nestedSkill)) {
        const content = readFileSync(nestedSkill, "utf8");
        out.push({
          name: entry,
          source,
          path: nestedSkill,
          summary: firstDescriptionLine(content),
          content,
        });
      }
      if (entry === "skills") {
        out.push(...scanSkillsDirectory(full, source));
      }
    }
  }
  return out;
}

export function getActiveSkills(settings: AppSettings): {
  mode: "builtin" | "custom";
  customDirConfigured: string;
  customDirValid: boolean;
  skills: ActiveSkill[];
} {
  const byName = new Map<string, ActiveSkill>();

  // 1. Seed with embedded fallback defaults so standalone installs always work
  for (const [name, def] of Object.entries(FALLBACK_BUILTIN_SKILLS)) {
    byName.set(name, {
      name,
      source: "builtin",
      path: "(embedded)",
      summary: def.summary,
      content: def.content,
    });
  }

  // 2. Load built-in skills shipped in pgroast/skills/ if present
  const pgroastSkillsDir = settings.pgroastRepo ? join(expandHome(settings.pgroastRepo), "skills") : "";
  if (pgroastSkillsDir && existsSync(pgroastSkillsDir)) {
    for (const s of scanSkillsDirectory(pgroastSkillsDir, "builtin")) {
      byName.set(s.name, s);
    }
  }

  // 3. Overlay optional user-configured custom skills folder
  const customRaw = (settings.skillsRepo || "").trim();
  const customExpanded = customRaw ? expandHome(customRaw) : "";
  const customDirValid = Boolean(customExpanded) && existsSync(customExpanded);
  let customCount = 0;

  if (customDirValid) {
    for (const s of scanSkillsDirectory(customExpanded, "custom")) {
      byName.set(s.name, s);
      customCount++;
    }
  }

  return {
    mode: customCount > 0 ? "custom" : "builtin",
    customDirConfigured: customRaw,
    customDirValid,
    skills: [...byName.values()],
  };
}

/**
 * Returns concise prompt guidance from active skills for email drafting:
 * prefers custom review/voice skills if the user configured a private skills folder,
 * otherwise uses the clean built-in default `hackers-review` skill.
 */
export function getDraftingSkillGuidance(settings: AppSettings): {
  mode: "builtin" | "custom";
  skillNames: string[];
  guidanceText: string;
} {
  const active = getActiveSkills(settings);
  const customPreferred = active.skills.filter(
    (s) =>
      s.source === "custom" &&
      /(hackers|review|voice|writing|email|mail)/i.test(s.name),
  );

  if (customPreferred.length > 0) {
    const picked = customPreferred.slice(0, 2);
    return {
      mode: "custom",
      skillNames: picked.map((s) => s.name),
      guidanceText: picked
        .map((s) => `[Custom skill: ${s.name}]\n${s.content.slice(0, 1800)}`)
        .join("\n\n"),
    };
  }

  const builtin = active.skills.find((s) => s.name === "hackers-review") ?? active.skills[0];
  return {
    mode: "builtin",
    skillNames: builtin ? [builtin.name] : [],
    guidanceText: builtin ? builtin.content : FALLBACK_BUILTIN_SKILLS["hackers-review"]!.content,
  };
}
