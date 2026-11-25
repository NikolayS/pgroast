// Skill loader: ships simple public-safe default skills in `skills/` and allows
// users to point `PGROAST_SKILLS_DIR` (or an explicit custom directory) to their own
// skills folder to override or extend the defaults without modifying this repo.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { REPO_ROOT } from "./thread/fetch.ts";

export interface LoadedSkill {
  name: string;
  source: "builtin" | "custom";
  path: string;
  content: string;
}

export const BUILTIN_SKILLS_DIR = join(REPO_ROOT, "skills");

function discoverSkillsInDir(dir: string, source: "builtin" | "custom"): LoadedSkill[] {
  if (!dir || !existsSync(dir)) return [];
  const out: LoadedSkill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const name of entries.sort()) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && name.endsWith(".md") && name.toLowerCase() !== "readme.md") {
      out.push({
        name: basename(name, ".md"),
        source,
        path: full,
        content: readFileSync(full, "utf8"),
      });
    } else if (st.isDirectory()) {
      // Support both flat `skills/<name>.md` and nested `skills/<name>/SKILL.md` layouts
      const nestedSkill = join(full, "SKILL.md");
      if (existsSync(nestedSkill)) {
        out.push({
          name,
          source,
          path: nestedSkill,
          content: readFileSync(nestedSkill, "utf8"),
        });
      }
      // Also support `skills/skills/<name>/SKILL.md` (common private repo layout)
      if (name === "skills") {
        out.push(...discoverSkillsInDir(full, source));
      }
    }
  }
  return out;
}

/**
 * Load all skills: built-in defaults first, then optional custom directory overrides.
 * Custom skills with the same name override the built-in skill; extra custom skills are added.
 */
export function loadSkills(customDir?: string): LoadedSkill[] {
  const effectiveCustom = (customDir ?? process.env.PGROAST_SKILLS_DIR ?? "").trim();
  const byName = new Map<string, LoadedSkill>();

  for (const s of discoverSkillsInDir(BUILTIN_SKILLS_DIR, "builtin")) {
    byName.set(s.name, s);
  }
  if (effectiveCustom) {
    const resolved = resolve(effectiveCustom);
    for (const s of discoverSkillsInDir(resolved, "custom")) {
      byName.set(s.name, s);
    }
  }
  return [...byName.values()];
}

export function loadSkill(name: string, customDir?: string): LoadedSkill | null {
  return loadSkills(customDir).find((s) => s.name === name) ?? null;
}
