// roast.md is rendered from roast.json by code: same content, never a second LLM call.

import { LEVEL_NAMES, TOUCH_POINTS, type FinalObjection, type Roast, type SelfAdvice } from "./schema.ts";

/** First line of roast-summary.txt, verbatim from the issue. */
export const SUMMARY_HEADER = "DRAFT — rewrite in your own words before using; AI-generated";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "date unknown");
const link = (text: string, url: string) => `[${text.replace(/([[\]])/g, "\\$1")}](${url.replace(/\)/g, "%29")})`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const touchLabel = (id: string) => TOUCH_POINTS.find((t) => t.id === id)?.label ?? id.replace(/_/g, " ");

const ref = (text: string, url: string) => (url ? link(text, url) : text);
const roundNote = (o: FinalObjection) =>
  `${o.round > 0 ? `, added in round ${o.round}` : ""}${o.revised_in_round != null ? `, restated in round ${o.revised_in_round}` : ""}`;

function objectionBlock(o: FinalObjection, n: number, advice?: SelfAdvice): string {
  const lines: string[] = [];
  lines.push(`### ${n}. ${oneLine(o.title)}`);
  if (advice) {
    lines.push("");
    lines.push(`**Before you send: ${advice.action === "fix" ? "fix it" : "rebut it in the cover letter"}.** ${advice.how.trim()}`);
    const cite = o.precedents.flatMap((p) => (p.thread_urls.length ? p.thread_urls : [p.url]).map((u) => link(oneLine(p.title), u)));
    if (cite.length) lines.push("", `Threads to cite or to distinguish yourself from: ${cite.join(", ")}`);
  }
  lines.push("");
  const sev = o.critic.original_severity ? `${o.severity} (first rated ${o.critic.original_severity}; changed in the counter-check)` : o.severity;
  const touch = [...new Set([o.category, ...o.touch_points])].map(touchLabel).join(", ");
  lines.push(`${sev} · level ${o.level}${o.rubric_item ? `, rubric item ${o.rubric_item}` : ""} · ${touch} · \`${o.id}\`${roundNote(o)}`);
  lines.push("");
  lines.push(o.failure_scenario.trim());
  lines.push("");
  lines.push(o.argument.trim());
  lines.push("");
  if (o.precedents.length) {
    lines.push("**Precedents.**");
    for (const p of o.precedents) {
      const threads = p.thread_urls.length ? `; thread: ${p.thread_urls.map((u, i) => link(p.thread_urls.length > 1 ? `#${i + 1}` : "link", u)).join(", ")}` : "";
      lines.push(`- ${link(oneLine(p.title), p.url)} (${p.status || "outcome unknown"}, ${day(p.date)})${threads}`);
    }
    lines.push("");
  }
  if (o.thread_refs.length) {
    lines.push(`Thread: ${o.thread_refs.map((r) => ref(`#${r.index} (${r.from}, ${day(r.date)})`, r.url)).join(", ")}`);
    lines.push("");
  }
  lines.push(`**Question:** ${o.author_must_show.trim()}`);
  lines.push("");
  lines.push(`Counter-check: held. ${o.critic.reasoning.trim()}`);
  return lines.join("\n");
}

function verdictSection(r: Roast, heading: string): string[] {
  const out: string[] = [];
  out.push(heading);
  out.push("");
  out.push(`**${r.verdict}** (confidence: ${r.confidence})`);
  out.push("");
  out.push(r.verdict_reasoning.trim());
  out.push("");
  out.push(
    r.failing_level
      ? `First failing level, from the base up: **${LEVEL_NAMES[r.failing_level]}**. The review stops there; higher levels are not evaluated.`
      : "No level of the review pyramid fails.",
  );
  out.push("");
  for (const l of r.levels) out.push(`- ${l.name}: ${l.status === "not_evaluated" ? "not evaluated" : l.status}`);
  out.push("- Levels 3-5 (implementation): out of scope");
  if (r.provisional_note.trim()) out.push("", `Provisional: ${r.provisional_note.trim()}`);
  out.push("");
  return out;
}

function prioritySection(r: Roast): string[] {
  const p = r.priority;
  return [
    "## Priority",
    "",
    "Whether it is worth the reviewers' time now. This is apart from the verdict and never changes it.",
    "",
    `- **Recommended action:** ${p.recommended_action}`,
    `- **Audience:** ${p.audience}`,
    `- **Maintenance burden:** ${p.maintenance_burden}`,
    `- **Review cost:** ${p.review_cost}`,
    `- **Why:** ${oneLine(p.reason)}`,
    "",
  ];
}

export function renderMarkdown(r: Roast): string {
  const out: string[] = [];
  const self = r.mode === "self";
  const title = r.input.cf?.title ?? r.brief.title ?? r.input.subject;
  out.push(`# Design pre-review${self ? " (self check)" : ""}: ${oneLine(title)}`);
  out.push("");
  out.push(`> ${r.disclosure}`);
  out.push("");
  if (self) {
    out.push("This is a private check of your own proposal before you send it. It lists the objections you are most likely to meet, and for each one whether to fix the proposal or to answer the objection in the cover letter. The check is one-sided on purpose: it looks only for objections.", "");
  }

  // Input
  const src: string[] = [];
  if (r.input.cf) {
    src.push(`- CommitFest: ${link(`patch ${r.input.cf.id}`, r.input.cf.url)}${r.input.cf.status ? ` (${r.input.cf.status})` : r.input.cf.redacted ? " (status withheld)" : ""}; authors: ${r.input.cf.authors || "not given"}`);
  }
  if (r.input.thread_url) src.push(`- Thread: ${link(oneLine(r.input.subject), r.input.thread_url)}, started ${day(r.input.thread_start)}`);
  else src.push(`- Draft, not sent: ${r.input.arg} ("${oneLine(r.input.subject)}")`);
  const mode = [r.input.blind != null ? `blind mode, first ${r.input.blind}` : "", r.input.before ? `before ${r.input.before}` : ""].filter(Boolean).join("; ");
  if (r.input.thread_url) src.push(`- Messages read: ${r.input.messages_read} of ${r.input.messages_total}${mode ? ` (${mode})` : ""}`);
  src.push(`- Patch prose read: ${r.input.attachments_read.length ? r.input.attachments_read.join(", ") : "none"} (commit message, file list and doc hunks only; no code review)`);
  if (r.input.hint) src.push(`- Directed precedent lookup: "${oneLine(r.input.hint)}"`);
  if (r.invariants_loaded.length) src.push(`- Subsystem invariants checked: ${r.invariants_loaded.join(", ")}`);
  out.push(...src, "");

  // 1. Verdict (in self mode it moves down: the author needs the to-do list first)
  if (!self) out.push(...verdictSection(r, "## 1. Verdict"));

  // The proposal
  out.push("## The proposal, restated");
  out.push("");
  out.push(`**Problem.** ${r.brief.problem.trim()}`);
  out.push("");
  out.push(`**Proposed design.** ${r.brief.proposed_design.trim()}`);
  out.push("");
  if (r.brief.user_visible_surface.length) {
    out.push("**User-visible surface.**");
    out.push(...r.brief.user_visible_surface.map((s) => `- ${oneLine(s)}`), "");
  }
  if (r.brief.author_claims.length) {
    out.push("**What the author claims.**");
    out.push(...r.brief.author_claims.map((s) => `- ${oneLine(s)}`), "");
  }
  if (r.brief.thread_state.trim()) out.push(`**Thread state.** ${r.brief.thread_state.trim()}`, "");

  // 2. Prior attempts
  out.push("## 2. Prior attempts");
  out.push("");
  if (r.precedent_backend === "none") {
    out.push("The precedent corpus was not available in this run, so earlier attempts were NOT searched. This is not a finding of \"no precedent\".");
  } else if (r.prior_attempts.length === 0) {
    out.push(`No precedent found (corpus searched for items before ${r.precedent_cutoff}; ${r.precedents_retrieved.length} candidates retrieved, none is the same or a similar idea).`);
  } else {
    for (const p of r.prior_attempts) {
      const rel = p.relation === "same_idea" ? "same idea" : p.relation === "similar_idea" ? "similar idea" : "related";
      out.push(`### ${oneLine(p.title)} (${rel})`);
      out.push("");
      out.push(`- **Link:** ${link(p.url, p.url)}`);
      if (p.thread_urls.length) out.push(`- **Thread:** ${p.thread_urls.map((u) => link(u, u)).join(", ")}`);
      out.push(`- **Date:** ${p.date ? `decided ${day(p.date)}` : "decision date unknown"}${p.first_date ? `; started ${day(p.first_date)}` : ""}`);
      out.push(`- **Outcome:** ${p.status || "unknown"} (${p.kind || "?"})`);
      out.push(`- **Who objected:** ${p.who_objected.trim() || "not recorded in the corpus"}${p.who_objected.trim() && p.enriched ? " (senders of the linked thread, picked by the AI summary)" : ""}`);
      if (p.reason.trim()) out.push(`- **Why it was not accepted${p.enriched ? " (AI summary of the linked thread; check it there)" : " (as recorded in the corpus)"}:** ${oneLine(p.reason)}`);
      out.push(`- **Reason (quote):** ${p.quote ? `"${oneLine(p.quote)}"${p.quote_url ? ` (${link("message", p.quote_url)})` : ""}` : "quote unavailable"}`);
      out.push(`- **What is different this time:** ${oneLine(p.what_is_different)}`);
      out.push("");
    }
  }
  out.push("");

  // 3. Steelman
  const adviceFor = (o: FinalObjection) => r.self_advice.find((a) => a.objection_id === o.id);
  out.push(self ? "## 3. Objections to address before you send" : "## 3. Objections a reviewer is likely to raise");
  out.push("");
  if (r.objections.length === 0) {
    out.push("No objection held up strongly enough in the counter-check to list here.");
    out.push("");
  } else {
    r.objections.forEach((o, i) => out.push(objectionBlock(o, i + 1, self ? adviceFor(o) : undefined), ""));
  }

  // 4. Touch points
  out.push("## 4. Touch points");
  out.push("");
  out.push("| Touch point | Hit | Why |");
  out.push("|---|---|---|");
  for (const t of r.touch_points) out.push(`| ${t.label} | ${t.hit ? "**yes**" : "no"} | ${t.hit ? oneLine(t.reason).replace(/\|/g, "\\|") : ""} |`);
  out.push("");

  // 5. Questions
  out.push(self ? "## 5. Questions to answer in your cover letter" : "## 5. Questions the author must answer before anyone reviews code");
  out.push("");
  if (r.questions.length === 0) out.push("None.");
  else r.questions.forEach((q, i) => out.push(`${i + 1}. ${oneLine(q)}`));
  out.push("");

  // Committability
  out.push("## Committability");
  out.push("");
  out.push('"Will not get committed" is not the same as "should be rejected". The verdict above is about the merits (levels 1-2) only; this section is about who would sign for it, and it never changes the verdict.');
  out.push("");
  out.push(`- **Owner:** ${r.committability.owner}${r.committability.owner_note.trim() ? `. ${oneLine(r.committability.owner_note)}` : ""}`);
  out.push(`- **Liability:** ${oneLine(r.committability.liability)}`);
  out.push(`- **Author follow-up:** ${oneLine(r.committability.author_follow_up)}`);
  out.push("");
  out.push(
    r.not_now.applies
      ? `**Not now / show demand: yes.** This is an outcome, not a rejection. Evidence that would change it: ${oneLine(r.not_now.evidence_that_would_change_it) || "(not stated)"}`
      : "**Not now / show demand:** does not apply.",
  );
  out.push("");

  out.push(...prioritySection(r));
  if (self) out.push(...verdictSection(r, "## How a reviewer would likely classify it"));

  // Appendix
  out.push("## Appendix");
  out.push("");
  if (r.other_surviving.length) {
    out.push("### Held up in the counter-check, not listed above");
    out.push("");
    for (const o of r.other_surviving) {
      out.push(`- \`${o.id}\` (${o.severity}, level ${o.level}${roundNote(o)}) ${oneLine(o.title)}. Not listed: ${o.not_ranked_reason ?? "not ranked"}.`);
      const a = self ? adviceFor(o) : undefined;
      if (a) out.push(`  - Before you send: ${a.action === "fix" ? "fix it" : "rebut it in the cover letter"}. ${oneLine(a.how)}`);
    }
    out.push("");
  }
  out.push("### Refuted in the counter-check");
  out.push("");
  if (r.refuted.length === 0) out.push("None.");
  for (const o of r.refuted) {
    out.push(`- \`${o.id}\` ${oneLine(o.title)}. Refuted (${o.critic.refutation_kind.replace(/_/g, " ")}): ${oneLine(o.critic.reasoning)}`);
  }
  out.push("");
  if (r.withdrawn.length) {
    out.push("### Withdrawn in a later round");
    out.push("");
    for (const o of r.withdrawn) out.push(`- \`${o.id}\` ${oneLine(o.title)}. Withdrawn in round ${o.withdrawal?.round ?? "?"}: ${oneLine(o.withdrawal?.reason ?? "")}`);
    out.push("");
  }
  if (r.rounds_requested > 0) {
    out.push("### Rounds");
    out.push("");
    out.push("| Round | Kind | LLM calls | New objections | Of them survived | Revised | Withdrawn |");
    out.push("|---|---|---|---|---|---|---|");
    const kind = { initial: "first pass", what_did_you_forget: `"${"What did you forget?"}"`, are_you_happy: `"${"Are you happy with the results?"}"`, supervisor: "supervisor follow-ups" } as const;
    for (const x of r.rounds) out.push(`| ${x.round} | ${kind[x.kind]} | ${x.llm_calls} | ${x.new_objections} | ${x.new_survived} | ${x.revised} | ${x.withdrawn} |`);
    out.push("");
    for (const x of r.rounds) for (const f of x.follow_ups) out.push(`- Round ${x.round} follow-up for ${f.angle}: ${oneLine(f.uncovered_area)}`);
    if (r.rounds.length - 1 < r.rounds_requested) out.push(`- ${r.rounds_requested} extra round(s) requested, ${r.rounds.length - 1} run.`);
    out.push("");
  }
  out.push("### Review angles");
  out.push("");
  for (const n of r.roaster_notes) out.push(`- ${n.angle}: ${n.objections} objection(s)${n.note.trim() ? `. ${oneLine(n.note)}` : ""}`);
  out.push("");
  out.push("### Precedents retrieved");
  out.push("");
  if (r.precedents_retrieved.length === 0) out.push(r.precedent_backend === "none" ? "Search not done." : "None.");
  for (const p of r.precedents_retrieved) {
    const flags = [p.relevant === true ? "used in the review" : p.relevant === false ? "judged not relevant" : "", p.enriched ? "reason summarised from its thread" : ""].filter(Boolean).join("; ");
    out.push(`- ${p.id}: ${link(oneLine(p.title), p.url)} (${p.kind}, ${p.status || "?"}, ${day(p.date ?? p.first_date)})${flags ? ` - ${flags}` : ""}`);
  }
  out.push("");
  if (r.warnings.length) {
    out.push("### Warnings");
    out.push("");
    out.push(...r.warnings.map((w) => `- ${oneLine(w)}`), "");
  }
  const s = r.sanitizer;
  out.push("### Run");
  out.push("");
  out.push(`- Backend: ${r.backend} CLI on the subscription login (no API key); models: review angles ${r.models.roaster}, counter-check ${r.models.critic}, synthesis ${r.models.synth}; no tools given to any of them`);
  out.push(`- LLM calls: ${r.stats.llm_calls}; wall time: ${Math.round(r.stats.wall_ms / 1000)} s${r.stats.cost_usd != null && !r.stats.dry_run ? `; cost reported by the CLI: $${r.stats.cost_usd.toFixed(2)}` : ""}${r.stats.dry_run ? "; DRY RUN (no model was called; content is placeholder)" : ""}`);
  if (r.enrichment) {
    const e = r.enrichment;
    out.push(`- Precedent enrichment: ${e.candidates} thread(s) lacked a recorded reason: ${e.from_cache} from cache, ${e.new_calls} summarised now, ${e.failed} failed; quotes: ${e.quotes_verified} verified, ${e.quotes_dropped} dropped; relevance pass: ${e.relevance_pass}, ${e.relevant} of ${r.precedents_retrieved.length} kept`);
  }
  const t = r.tone_lint;
  out.push(`- Tone check: ${t.fields_checked} text field(s) checked, ${t.hits_found} finding(s), ${t.sentences_rewritten} sentence(s) rewritten (repair call: ${t.repair_call}), ${t.remaining.length} left`);
  for (const h of t.remaining) out.push(`  - \`${h.path}\`: ${h.rule}${h.match ? ` ("${h.match}")` : ""}`);
  out.push(`- Sanitizer: ${s.urls_removed.length} link(s) removed, ${s.precedent_ids_dropped.length} unknown precedent id(s) dropped, ${s.thread_refs_dropped.length} bad message reference(s) dropped, ${s.quotes_dropped.length} unverifiable quote(s) dropped`);
  out.push(`- Generated: ${r.generated_at} by ${r.tool}`);
  out.push("");
  out.push("---");
  out.push("");
  out.push(r.disclosure);
  out.push("");
  return out.join("\n");
}

/**
 * roast.md: the short report. Verdict, prior attempts, the listed objections, the questions and
 * the touch points that are hit. Everything else is in roast-full.md (renderMarkdown).
 */
export function renderCompactMarkdown(r: Roast, fullName = "roast-full.md"): string {
  const out: string[] = [];
  const self = r.mode === "self";
  const title = r.input.cf?.title ?? r.brief.title ?? r.input.subject;
  out.push(`# Design pre-review${self ? " (self check)" : ""}: ${oneLine(title)}`, "", `> ${r.disclosure}`, "");

  const mode = [r.input.blind != null ? `first ${r.input.blind} only` : "", r.input.before ? `before ${r.input.before}` : ""].filter(Boolean).join(", ");
  const src: string[] = [];
  if (r.input.cf) src.push(link(`CommitFest ${r.input.cf.id}`, r.input.cf.url));
  if (r.input.thread_url) src.push(`${link("thread", r.input.thread_url)}, ${r.input.messages_read} of ${r.input.messages_total} messages read${mode ? ` (${mode})` : ""}`);
  else src.push(`draft ${r.input.arg}`);
  src.push("no code read");
  out.push(`${src.join("; ")}.`, "");

  const verdict = [
    `**${r.verdict}** (confidence: ${r.confidence}). ${r.verdict_reasoning.trim()}`,
    ...(r.provisional_note.trim() ? ["", `Not checked: ${r.provisional_note.trim()}`] : []),
    "",
  ];
  if (!self) out.push("## Verdict", "", ...verdict);

  out.push("## Prior attempts", "");
  if (r.precedent_backend === "none") out.push("Not searched: the precedent index was not available in this run.");
  else if (r.prior_attempts.length === 0) out.push(`None found before ${r.precedent_cutoff}.`);
  for (const p of r.prior_attempts) {
    const rel = p.relation === "same_idea" ? "same idea" : p.relation === "similar_idea" ? "similar idea" : "related";
    const why = p.quote ? `"${oneLine(p.quote)}"${p.quote_url ? ` (${link("message", p.quote_url)})` : ""}` : p.reason.trim() ? `${oneLine(p.reason)}${p.enriched ? " (AI summary of the thread)" : ""}` : "reason not recorded";
    out.push(`- ${link(oneLine(p.title), p.thread_urls[0] ?? p.url)} (${rel}; ${p.status || "outcome unknown"}, ${day(p.date ?? p.first_date)}). ${why} Different now: ${oneLine(p.what_is_different)}`);
  }
  out.push("");

  const adviceFor = (o: FinalObjection) => r.self_advice.find((a) => a.objection_id === o.id);
  out.push(self ? "## Objections to address before you send" : "## Objections a reviewer is likely to raise", "");
  if (r.objections.length === 0) out.push("No objection held up in the counter-check.", "");
  r.objections.forEach((o, i) => {
    const a = self ? adviceFor(o) : undefined;
    out.push(`### ${i + 1}. ${oneLine(o.title)}`, "");
    if (a) out.push(`**Before you send: ${a.action === "fix" ? "fix it" : "rebut it in the cover letter"}.** ${a.how.trim()}`, "");
    out.push(o.failure_scenario.trim(), "", o.argument.trim(), "");
    for (const p of o.precedents) out.push(`Precedent: ${link(oneLine(p.title), p.thread_urls[0] ?? p.url)} (${p.status || "outcome unknown"}, ${day(p.date)})`, "");
    out.push(`**Question:** ${o.author_must_show.trim()}`, "");
    const refs = o.thread_refs.map((t) => ref(`#${t.index}`, t.url)).join(", ");
    out.push(`<sub>${o.severity}, level ${o.level}, ${touchLabel(o.category)}${refs ? `; messages ${refs}` : ""}; \`${o.id}\`</sub>`, "");
  });

  out.push(self ? "## Questions to answer in your cover letter" : "## Questions for the author", "");
  if (r.questions.length === 0) out.push("None.");
  else r.questions.forEach((q, i) => out.push(`${i + 1}. ${oneLine(q)}`));
  out.push("");

  const hit = r.touch_points.filter((t) => t.hit);
  out.push("## Touch points", "");
  if (hit.length === 0) out.push("None of the 15 is hit.");
  for (const t of hit) out.push(`- **${t.label}:** ${oneLine(t.reason)}`);
  out.push("");

  out.push("## Who would commit it, and when", "");
  out.push(`- Owner: ${r.committability.owner}${r.committability.owner_note.trim() ? `. ${oneLine(r.committability.owner_note)}` : ""}`);
  if (r.not_now.applies) out.push(`- Not now, show demand first: ${oneLine(r.not_now.evidence_that_would_change_it) || "(evidence not stated)"}`);
  out.push(`- Priority: ${r.priority.recommended_action}; audience ${r.priority.audience}; review cost ${r.priority.review_cost}. ${oneLine(r.priority.reason)}`, "");
  if (self) out.push("## How a reviewer would likely classify it", "", ...verdict);

  const more = [`${r.other_surviving.length} more objection(s) that held`, `${r.refuted.length} refuted`, "the proposal restated", "all 15 touch points", "run details"];
  out.push("---", "", `${link(fullName, fullName)} has ${more.join(", ")}.${r.warnings.length ? ` Warnings in this run: ${r.warnings.length}.` : ""}${r.stats.dry_run ? " DRY RUN: no model was called; content is placeholder." : ""}`, "", r.disclosure, "");
  return out.join("\n");
}

const clip = (s: string, n: number) => {
  const t = oneLine(s);
  return t.length <= n ? t : t.slice(0, n - 3).replace(/\s+\S*$/, "") + "...";
};

/**
 * roast-summary.txt: at most 10 plain-text lines, built by code from the roast (no model call).
 * A starting point for a person's own words, never something to paste: hence the first line.
 */
export function renderSummary(r: Roast): string {
  const lines: string[] = [SUMMARY_HEADER];
  const self = r.mode === "self";
  const stop = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);
  lines.push(`${clip(r.input.cf?.title ?? r.brief.title ?? r.input.subject, 120)}${self ? " (self check)" : ""}: ${r.verdict}, confidence ${r.confidence}. Idea and design only; no code was read.`);
  const top = r.objections.slice(0, 3);
  if (top.length === 0) lines.push("No objection held up in the counter-check.");
  top.forEach((o, i) => {
    const a = self ? r.self_advice.find((x) => x.objection_id === o.id) : undefined;
    lines.push(`${i + 1}. ${stop(clip(o.title, 140))}${o.severity === "fatal" ? " This one would stop the proposal as it is." : ""}${a ? ` (${a.action === "fix" ? "fix before sending" : "rebut in the cover letter"})` : ""}`);
  });
  const pa = r.prior_attempts[0];
  lines.push(
    r.precedent_backend === "none"
      ? "Earlier attempts: not searched."
      : pa
        ? `Earlier attempt: ${clip(pa.title, 90)} (${pa.status || "outcome unknown"}, ${day(pa.date ?? pa.first_date)}): ${pa.url}`
        : "Earlier attempts: none found.",
  );
  if (r.questions[0]) lines.push(`First question: ${clip(r.questions[0], 220)}`);
  if (r.not_now.applies) lines.push(`Not now, show demand first: ${clip(r.not_now.evidence_that_would_change_it, 170)}`);
  lines.push(`Suggested next step: ${r.priority.recommended_action}.`);
  return lines.slice(0, 10).join("\n") + "\n";
}
