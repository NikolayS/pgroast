import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../src/db.ts";
import { getActiveSkills, getDraftingSkillGuidance } from "../src/services/skills.ts";
import type { RoastJson } from "../src/types.ts";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeTestSchema(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

describe("AppDatabase (PostgreSQL schema, CRUD, secrets & batch import)", () => {
  test("initializes schema, persists settings, and encrypts CommitFest cookies", async () => {
    const dir = makeTempDir("pgroast-db-");
    const db = await AppDatabase.create({
      schema: makeTestSchema("test_db"),
      secretKeyPath: join(dir, ".secret.key"),
    });
    try {
      const defaults = await db.getSettings();
      expect(defaults.host).toBe("127.0.0.1");
      // Fresh installs must have zero personal defaults baked in
      expect(defaults.cfUsername).toBe("");
      expect(defaults.gmailAccount).toBe("");
      expect(defaults.githubFork).toBe("");
      expect(defaults.authorName).toBe("");
      expect(defaults.skillsRepo).toBe("");
      expect(defaults.defaultBackend).toBe("auto");
      expect(defaults.onboardingCompleted).toBe(false);

      // Built-in basic skills work cleanly when skillsRepo is empty
      const builtinSkills = getActiveSkills(defaults);
      expect(builtinSkills.mode).toBe("builtin");
      expect(builtinSkills.skills.map((s) => s.name)).toContain("hackers-review");
      expect(getDraftingSkillGuidance(defaults).mode).toBe("builtin");

      // Custom skills folder overrides built-in defaults when configured
      const customSkillsDir = join(dir, "my-skills");
      mkdirSync(join(customSkillsDir, "custom-voice"), { recursive: true });
      writeFileSync(join(customSkillsDir, "custom-voice", "SKILL.md"), "# My custom writing voice\nKeep it direct.\n");

      const updated = await db.updateSettings({
        authorName: "Jane",
        cfUsername: "jdoe",
        gmailAccount: "jane@example.com",
        hetznerSshHost: "root@hetzner-pg",
        githubFork: "jdoe/postgres",
        skillsRepo: customSkillsDir,
        onboardingCompleted: true,
      });
      expect(updated.hetznerSshHost).toBe("root@hetzner-pg");
      expect(updated.authorName).toBe("Jane");
      expect(updated.onboardingCompleted).toBe(true);

      const customSkills = getActiveSkills(updated);
      expect(customSkills.mode).toBe("custom");
      expect(customSkills.skills.some((s) => s.name === "custom-voice" && s.source === "custom")).toBe(true);
      expect(getDraftingSkillGuidance(updated).mode).toBe("custom");

      // Encrypted cookie storage
      await db.setCfCookies("super-secret-session-123", "csrf-token-xyz");
      const rawEnc = (await db.getRawSetting("cf_sessionid_enc")) || "";
      expect(rawEnc.startsWith("v1:")).toBe(true);
      expect(rawEnc).not.toContain("super-secret-session-123");

      const dec = await db.getCfCookiesDecrypted();
      expect(dec.sessionid).toBe("super-secret-session-123");
      expect(dec.csrftoken).toBe("csrf-token-xyz");

      const status = await db.getCfAuthStatus();
      expect(status.hasSessionCookie).toBe(true);
      expect(status.hasCsrfToken).toBe(true);
      expect(JSON.stringify(status)).not.toContain("super-secret-session-123");

      await db.clearCfCookies();
      expect((await db.getCfAuthStatus()).hasSessionCookie).toBe(false);
    } finally {
      await db.dropSchemaAndClose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("imports v1 and v2 roast batch directories and computes novelty & verdict stats", async () => {
    const dir = makeTempDir("pgroast-batch-");
    const db = await AppDatabase.create({
      schema: makeTestSchema("test_batch"),
      secretKeyPath: join(dir, ".secret.key"),
    });
    try {
      const cf5879 = join(dir, "cf", "5879");
      const cf6207 = join(dir, "cf", "6207");
      const cf5845 = join(dir, "cf", "5845");
      mkdirSync(cf5879, { recursive: true });
      mkdirSync(cf6207, { recursive: true });
      mkdirSync(cf5845, { recursive: true });

      const r5879: RoastJson = {
        schema_version: 2,
        input: {
          cf: { id: 5879, title: "amcheck: support for GiST", status: "Ready for Committer", authors: "Andrey Borodin (x4m)" },
          thread_url: "https://www.postgresql.org/message-id/flat/5FC1B5B6%40yandex-team.ru",
        },
        verdict: "NEEDS-COMMITTER-EYES",
        confidence: "medium",
        verdict_reasoning: "Fits amcheck well; lock strength question from 2019 remains.",
        prior_attempts: [{ title: "amcheck verification for GiST", relation: "same_idea", status: "Returned with feedback" }],
        objections: [
          { title: "Lock strength under concurrent page deletion", severity: "fixable", novelty: "revisits_precedent" },
          { title: "Already discussed style point", severity: "fixable", novelty: "open_in_thread" },
        ],
        priority: { audience: "a sizeable minority", maintenance_burden: "medium", review_cost: "medium", recommended_action: "needs champion", reason: "Useful check" },
      };

      const r6207: RoastJson = {
        schema_version: 1,
        input: {
          cf: { id: 6207, title: "Fix socket and shared memory handle inheritance on Windows", status: "Ready for Committer", authors: "Bryan Green" },
        },
        verdict: "NO-FUNDAMENTAL-OBJECTION",
        confidence: "high",
        objections: [],
        priority: { audience: "a sizeable minority", maintenance_burden: "low", review_cost: "low", recommended_action: "proceed", reason: "Clean bugfix" },
      };

      const r5845: RoastJson = {
        schema_version: 1,
        input: {
          cf: { id: 5845, title: "Carefully exposing information without authentication", status: "Needs review", authors: "Contributor" },
        },
        verdict: "LIKELY-REJECT",
        confidence: "high",
        objections: [{ title: "A small separate service already answers this", severity: "fatal", thread_message_refs: [1] }],
        priority: { audience: "niche", maintenance_burden: "high", review_cost: "high", recommended_action: "park", reason: "Does not belong in core" },
      };

      writeFileSync(join(cf5879, "roast.json"), JSON.stringify(r5879));
      writeFileSync(join(cf5879, "roast.md"), "# Design pre-review: amcheck GiST");
      writeFileSync(join(cf6207, "roast.json"), JSON.stringify(r6207));
      writeFileSync(join(cf5845, "roast.json"), JSON.stringify(r5845));

      const res = await db.importRoastBatch(dir);
      expect(res.imported).toBe(3);
      expect(res.errors.length).toBe(0);

      const e5879 = await db.getEntry(5879);
      expect(e5879).not.toBeNull();
      expect(e5879?.verdict).toBe("NEEDS-COMMITTER-EYES");
      expect(e5879?.objection_count).toBe(2);
      expect(e5879?.new_objection_count).toBe(1);
      expect(e5879?.prior_attempts_count).toBe(1);

      const stats = await db.getVerdictStats();
      expect(stats.TOTAL).toBe(3);
      expect(stats["NO-FUNDAMENTAL-OBJECTION"]).toBe(1);
      expect(stats["NEEDS-COMMITTER-EYES"]).toBe(1);
      expect(stats["LIKELY-REJECT"]).toBe(1);

      // Work items, drafts, audit logs CRUD
      const wi = await db.createWorkItem({ cf_id: 5879, slug: "amcheck-gist", title: "amcheck: support for GiST" });
      expect(wi.id).toBeGreaterThan(0);
      const updatedWi = await db.updateWorkItem(wi.id, { status: "verified", upstream_base_sha: "0123456789abcdef0123456789abcdef01234567" });
      expect(updatedWi?.status).toBe("verified");

      const draft = await db.createDraft({ cf_id: 5879, subject: "Re: amcheck: support for GiST", body: "Hello" });
      expect((await db.listDrafts(5879)).length).toBe(1);
      expect(draft.cf_id).toBe(5879);

      await db.logAudit("test_action", "cf:5879", { ok: true });
      expect((await db.listAuditLogs(10)).length).toBe(1);

      // Contributor-attributed opinions, global search, and My Work identity matching
      await db.updateSettings({
        authProvider: "github",
        authHandle: "kirk-wolak",
        authName: "Kirk Wolak",
        authorName: "Andrey Borodin",
      });
      const op = await db.addExternalOpinion({
        cfId: 5879,
        backend: "claude",
        models: { critic: "opus" },
        verdict: "NEEDS-COMMITTER-EYES",
        confidence: "high",
        summaryTxt: "Confirmed lock behavior",
        contributorName: "Kirk Wolak",
        contributorHandle: "kirk-wolak",
        contributorProvider: "github",
      });
      expect(op.contributor_name).toBe("Kirk Wolak");
      expect(op.contributor_handle).toBe("kirk-wolak");
      expect(op.contributor_provider).toBe("github");
      expect((await db.listRoastRuns(5879)).some((r) => r.contributor_handle === "kirk-wolak")).toBe(true);

      const gs = await db.searchGlobal("GiST");
      expect(gs.entries.some((e) => e.cf_id === 5879)).toBe(true);
      expect(gs.workItems.some((w) => w.id === wi.id)).toBe(true);

      await db.upsertEntryMetadata({
        cf_id: 5879,
        title: "amcheck: support for GiST",
        authors: "Andrey Borodin",
        status: "Needs review",
      });
      const mine = await db.listEntries({ mineOnly: true });
      expect(mine.items.some((e) => e.cf_id === 5879)).toBe(true);
    } finally {
      await db.dropSchemaAndClose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
