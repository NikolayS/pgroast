// `pgroast page`: the opt-in "full version" as one self-contained static HTML file, and the
// site layout a CommitFest app could include from. Rendered by code from roast.json: inline
// CSS, no scripts, no external requests. It only writes local files; where a page goes is a
// person's decision, and there is no uploading or publishing code here.
//
// Everything in roast.json is untrusted in an HTML context (model output, archive text,
// titles, links): every value goes through esc(), and a link is emitted only for http(s).

import { messageIdOfUrl } from "./precedents.ts";
import { LEVEL_NAMES, TOUCH_POINTS, type FinalObjection, type Roast, type ToneHit } from "./schema.ts";
import { lintRoast } from "./tone.ts";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/** An href only for plain http(s) URLs; anything else (javascript:, data:, ...) is not a link. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!/^https?:\/\/[^\s"'<>`]+$/i.test(u)) return null;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

const a = (text: string, url: string | null | undefined): string => {
  const href = safeUrl(url);
  return href ? `<a href="${esc(href)}" rel="noopener noreferrer nofollow">${esc(text)}</a>` : esc(text);
};
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "date unknown");
const p = (s: string) => (s.trim() ? `<p>${esc(s.trim())}</p>` : "");
const touchLabel = (id: string) => TOUCH_POINTS.find((t) => t.id === id)?.label ?? id.replace(/_/g, " ");
const titleOf = (r: Roast) => r.input.cf?.title ?? r.brief.title ?? r.input.subject;

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1e21;--muted:#5f6670;--line:#d9dde3;--card:#f6f7f9;--link:#0b57d0;--warn:#8a4b00;--bad:#a1260d;--ok:#1a6b34}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e4e6ea;--muted:#9aa3ad;--line:#343a42;--card:#1e2126;--link:#8ab4f8;--warn:#f0b35a;--bad:#ff8f7a;--ok:#7bd69a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:52rem;margin:0 auto;padding:1.25rem 1rem 3rem}
h1{font-size:1.5rem;line-height:1.25;margin:.5rem 0 1rem}
h2{font-size:1.2rem;margin:2rem 0 .75rem;padding-top:.75rem;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:0 0 .5rem}
a{color:var(--link);overflow-wrap:anywhere}
p{margin:.5rem 0}
ul{padding-left:1.25rem}
.note{border:1px solid var(--line);border-left:4px solid var(--warn);background:var(--card);padding:.6rem .8rem;border-radius:4px;margin:1rem 0}
.card{border:1px solid var(--line);background:var(--card);border-radius:6px;padding:.9rem 1rem;margin:1rem 0;overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:.9rem}
.tag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 .55rem;font-size:.8rem;margin-right:.3rem;white-space:nowrap}
.fatal{color:var(--bad);border-color:var(--bad)}
.verdict{font-size:1.15rem;font-weight:600}
dt{font-weight:600;margin-top:.6rem}
dd{margin:.15rem 0 0}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.95rem}
th,td{border-bottom:1px solid var(--line);text-align:left;padding:.35rem .5rem;vertical-align:top}
.yes{color:var(--warn);font-weight:600}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
footer{margin-top:2rem}
`;

function objectionCard(r: Roast, o: FinalObjection, heading: string): string {
  const advice = r.mode === "self" ? r.self_advice.find((x) => x.objection_id === o.id) : undefined;
  const status =
    o.status === "survived"
      ? "Held up in the counter-check."
      : o.status === "refuted"
        ? `Refuted in the counter-check (${o.critic.refutation_kind.replace(/_/g, " ")}).`
        : `Withdrawn in round ${o.withdrawal?.round ?? "?"}.`;
  const parts: string[] = [];
  parts.push(`<section class="card" id="${esc(o.id)}">`);
  parts.push(`<h3>${esc(heading)}${esc(o.title)}</h3>`);
  parts.push(
    `<p class="meta"><span class="tag${o.severity === "fatal" ? " fatal" : ""}">${esc(o.severity)}</span><span class="tag">${esc(LEVEL_NAMES[o.level] ?? o.level)}</span><span class="tag">${esc(touchLabel(o.category))}</span><span class="tag">angle: ${esc(o.angle)}</span>${o.round > 0 ? `<span class="tag">round ${esc(o.round)}</span>` : ""} <code>${esc(o.id)}</code></p>`,
  );
  if (advice) parts.push(`<p><strong>Before you send: ${advice.action === "fix" ? "fix it" : "answer it in the cover letter"}.</strong> ${esc(advice.how)}</p>`);
  parts.push("<dl>");
  parts.push(`<dt>What can go wrong</dt><dd>${esc(o.failure_scenario)}</dd>`);
  parts.push(`<dt>Why it applies here</dt><dd>${esc(o.argument)}</dd>`);
  if (o.precedents.length) {
    parts.push(
      `<dt>Earlier discussions</dt><dd><ul>${o.precedents
        .map((x) => `<li>${a(x.title, x.url)} (${esc(x.status || "outcome unknown")}, ${esc(day(x.date))})${x.thread_urls.map((u, i) => ` ${a(x.thread_urls.length > 1 ? `thread ${i + 1}` : "thread", u)}`).join("")}</li>`)
        .join("")}</ul></dd>`,
    );
  }
  if (o.thread_refs.length) {
    parts.push(`<dt>Thread messages</dt><dd>${o.thread_refs.map((t) => a(`#${t.index} (${t.from}, ${day(t.date)})`, t.url)).join(", ")}</dd>`);
  }
  parts.push(`<dt>Question for the author</dt><dd>${esc(o.author_must_show)}</dd>`);
  parts.push(`<dt>Counter-check</dt><dd>${esc(status)} ${esc(o.withdrawal ? o.withdrawal.reason : o.critic.reasoning)}</dd>`);
  if (o.status === "survived" && o.not_ranked_reason) parts.push(`<dt>Why it is not in the main list</dt><dd>${esc(o.not_ranked_reason)}</dd>`);
  parts.push("</dl></section>");
  return parts.join("\n");
}

/** The full page: every objection, including the unlisted and the refuted ones. */
export function renderPage(r: Roast): string {
  const self = r.mode === "self";
  const title = `Design pre-review${self ? " (self check)" : ""}: ${titleOf(r)}`;
  const tone: ToneHit[] = lintRoast(r).hits;
  const out: string[] = [];
  out.push("<!DOCTYPE html>");
  out.push('<html lang="en"><head><meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<meta name="robots" content="noindex">');
  out.push(`<title>${esc(title)}</title>`);
  out.push(`<style>${CSS}</style></head><body><main>`);
  out.push(`<p class="note">${esc(r.disclosure)}</p>`);
  out.push(`<h1>${esc(title)}</h1>`);
  out.push(
    "<p>This page lists every objection the check produced, including those that did not hold up, with the evidence for each. It looks at the idea and the design only; no code was read. It is one-sided on purpose: it looks only for objections.</p>",
  );

  out.push('<ul class="meta">');
  if (r.input.cf) out.push(`<li>CommitFest: ${a(`patch ${r.input.cf.id}`, r.input.cf.url)}${r.input.cf.status ? ` (${esc(r.input.cf.status)})` : ""}; authors: ${esc(r.input.cf.authors || "not given")}</li>`);
  if (r.input.thread_url) out.push(`<li>Thread: ${a(r.input.subject, r.input.thread_url)}, started ${esc(day(r.input.thread_start))}; messages read: ${esc(r.input.messages_read)} of ${esc(r.input.messages_total)}</li>`);
  else out.push(`<li>Draft, not sent: ${esc(r.input.arg)}</li>`);
  out.push(`<li>Patch prose read: ${esc(r.input.attachments_read.length ? r.input.attachments_read.join(", ") : "none")} (commit message, file list and documentation hunks only)</li>`);
  if (r.invariants_loaded.length) out.push(`<li>Subsystem invariants checked: ${esc(r.invariants_loaded.join(", "))}</li>`);
  out.push("</ul>");

  out.push("<h2>Pre-review verdict</h2>");
  out.push(`<p class="verdict">${esc(r.verdict)} <span class="meta">(confidence: ${esc(r.confidence)})</span></p>`);
  out.push(p(r.verdict_reasoning));
  out.push(`<ul>${r.levels.map((l) => `<li>${esc(l.name)}: ${esc(l.status === "not_evaluated" ? "not evaluated" : l.status)}</li>`).join("")}<li>Levels 3-5 (implementation): out of scope</li></ul>`);
  if (r.provisional_note.trim()) out.push(`<p class="meta">Provisional: ${esc(r.provisional_note.trim())}</p>`);

  out.push("<h2>The proposal, restated</h2>");
  out.push(`<dl><dt>Problem</dt><dd>${esc(r.brief.problem)}</dd><dt>Proposed design</dt><dd>${esc(r.brief.proposed_design)}</dd></dl>`);

  out.push("<h2>Questions for the author</h2>");
  out.push(r.questions.length ? `<ol>${r.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : "<p>None.</p>");

  out.push("<h2>Earlier attempts</h2>");
  if (r.precedent_backend === "none") out.push("<p>The precedent corpus was not available, so earlier attempts were not searched. This is not a finding of \"no precedent\".</p>");
  else if (r.prior_attempts.length === 0) out.push(`<p>No precedent found (corpus searched for items before ${esc(r.precedent_cutoff)}).</p>`);
  for (const x of r.prior_attempts) {
    const rel = x.relation === "same_idea" ? "same idea" : x.relation === "similar_idea" ? "similar idea" : "related";
    out.push(`<section class="card"><h3>${a(x.title, x.url)} <span class="meta">(${esc(rel)})</span></h3><dl>`);
    out.push(`<dt>Outcome</dt><dd>${esc(x.status || "unknown")}, ${esc(x.date ? `decided ${day(x.date)}` : "decision date unknown")}</dd>`);
    if (x.thread_urls.length) out.push(`<dt>Thread</dt><dd>${x.thread_urls.map((u) => a(u, u)).join(", ")}</dd>`);
    out.push(`<dt>Who objected</dt><dd>${esc(x.who_objected.trim() || "not recorded in the corpus")}</dd>`);
    if (x.reason.trim()) out.push(`<dt>Why it was not accepted${x.enriched ? " (AI summary of the linked thread; check it there)" : ""}</dt><dd>${esc(x.reason)}</dd>`);
    out.push(`<dt>Quote</dt><dd>${x.quote ? `&ldquo;${esc(x.quote)}&rdquo;${safeUrl(x.quote_url) ? ` (${a("message", x.quote_url)})` : ""}` : "quote unavailable"}</dd>`);
    out.push(`<dt>What is different this time</dt><dd>${esc(x.what_is_different)}</dd></dl></section>`);
  }

  out.push(`<h2>${self ? "Objections to address before you send" : "Objections a reviewer is likely to raise"}</h2>`);
  if (r.objections.length === 0) out.push("<p>No objection held up strongly enough to list here.</p>");
  r.objections.forEach((o, i) => out.push(objectionCard(r, o, `${i + 1}. `)));

  out.push("<h2>Objections that held up but are not in the main list</h2>");
  if (r.other_surviving.length === 0) out.push("<p>None.</p>");
  for (const o of r.other_surviving) out.push(objectionCard(r, o, ""));

  out.push("<h2>Objections refuted in the counter-check</h2>");
  out.push("<p>These were raised and then refuted. They are shown so that you can see what was considered and why it was dropped.</p>");
  if (r.refuted.length === 0) out.push("<p>None.</p>");
  for (const o of r.refuted) out.push(objectionCard(r, o, ""));

  if (r.withdrawn.length) {
    out.push("<h2>Objections withdrawn in a later round</h2>");
    for (const o of r.withdrawn) out.push(objectionCard(r, o, ""));
  }

  out.push("<h2>Touch points</h2>");
  out.push(`<div class="scroll"><table><thead><tr><th>Touch point</th><th>Touched</th><th>Why</th></tr></thead><tbody>${r.touch_points
    .map((t) => `<tr><td>${esc(t.label)}</td><td${t.hit ? ' class="yes"' : ""}>${t.hit ? "yes" : "no"}</td><td>${t.hit ? esc(t.reason) : ""}</td></tr>`)
    .join("")}</tbody></table></div>`);

  out.push("<h2>Committability</h2>");
  out.push("<p>&ldquo;Will not get committed&rdquo; is not the same as &ldquo;should be rejected&rdquo;. The verdict is about the merits only; this section is about who would sign for the change, and it never changes the verdict.</p>");
  out.push(`<dl><dt>Owner</dt><dd>${esc(r.committability.owner)}${r.committability.owner_note.trim() ? `. ${esc(r.committability.owner_note)}` : ""}</dd><dt>Liability</dt><dd>${esc(r.committability.liability)}</dd><dt>Author follow-up</dt><dd>${esc(r.committability.author_follow_up)}</dd>`);
  out.push(`<dt>Not now / show demand</dt><dd>${r.not_now.applies ? `Yes. This is an outcome, not a rejection. Evidence that would change it: ${esc(r.not_now.evidence_that_would_change_it || "(not stated)")}` : "Does not apply."}</dd></dl>`);

  out.push("<h2>Priority</h2>");
  out.push(`<dl><dt>Recommended action</dt><dd>${esc(r.priority.recommended_action)}</dd><dt>Audience</dt><dd>${esc(r.priority.audience)}</dd><dt>Maintenance burden</dt><dd>${esc(r.priority.maintenance_burden)}</dd><dt>Review cost</dt><dd>${esc(r.priority.review_cost)}</dd><dt>Why</dt><dd>${esc(r.priority.reason)}</dd></dl>`);

  out.push("<h2>How this was produced</h2>");
  const s = r.sanitizer;
  out.push('<ul class="meta">');
  out.push(`<li>Generated ${esc(r.generated_at)} by ${esc(r.tool)}; ${esc(r.backend)} CLI; models: ${esc(r.models.roaster)}, ${esc(r.models.critic)}, ${esc(r.models.synth)}; the models had no tools</li>`);
  out.push(`<li>Model calls: ${esc(r.stats.llm_calls)}; wall time: ${esc(Math.round(r.stats.wall_ms / 1000))} s${r.stats.dry_run ? "; DRY RUN (no model was called; content is placeholder)" : ""}</li>`);
  out.push(`<li>Review angles: ${r.roaster_notes.map((n) => `${esc(n.angle)} (${esc(n.objections)})`).join(", ")}</li>`);
  if (r.rounds_requested > 0) out.push(`<li>Extra rounds: ${r.rounds.slice(1).map((x) => `round ${esc(x.round)}: ${esc(x.new_objections)} new, ${esc(x.new_survived)} held up, ${esc(x.revised)} restated, ${esc(x.withdrawn)} withdrawn`).join("; ") || "none run"}</li>`);
  out.push(`<li>Subsystem invariants: ${esc(r.invariants_loaded.length ? r.invariants_loaded.join(", ") : "none loaded")}</li>`);
  out.push(`<li>Earlier discussions retrieved: ${esc(r.precedents_retrieved.length)} (search cutoff ${esc(r.precedent_cutoff)}; corpus: ${esc(r.precedent_backend === "none" ? "not available" : "searched")})</li>`);
  out.push(`<li>Link and quote checks: ${esc(s.urls_removed.length)} link(s) removed, ${esc(s.precedent_ids_dropped.length)} unknown reference(s) dropped, ${esc(s.quotes_dropped.length)} unverifiable quote(s) dropped</li>`);
  out.push(`<li>Tone check: ${esc(tone.length)} finding(s)${tone.length ? `: ${tone.map((h) => `<code>${esc(h.path)}</code> (${esc(h.rule)})`).join(", ")}` : ""}</li>`);
  for (const w of r.warnings) out.push(`<li>Warning: ${esc(w)}</li>`);
  out.push("</ul>");

  out.push(`<footer><p class="note">${esc(r.disclosure)}</p></footer>`);
  out.push("</main></body></html>");
  return out.join("\n") + "\n";
}

/** Where the full-page link of a fragment points until a person fills in the real base URL. */
export const BASE_URL_PLACEHOLDER = "{{PGROAST_BASE_URL}}";

/**
 * The embeddable card: no <html>/<head>, class names with a `pgroast-` prefix, inline styles
 * only, no scripts. Colours are inherited from the host page.
 */
export function renderFragment(r: Roast, fullHref: string): string {
  const box = "border:1px solid rgba(128,128,128,.45);border-radius:6px;padding:12px 14px;margin:8px 0;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:46em;overflow-wrap:anywhere";
  const small = "margin:6px 0 0;font-size:12px;opacity:.8";
  const qs = r.questions.slice(0, 3);
  // The placeholder is kept as is; any other value must be a plain http(s) URL or a relative path.
  const href = fullHref.startsWith(BASE_URL_PLACEHOLDER) || safeUrl(fullHref) || /^[A-Za-z0-9._~\/-]+$/.test(fullHref) ? fullHref : "";
  return [
    `<div class="pgroast-card" style="${box}">`,
    `<p class="pgroast-disclosure" style="${small};margin-top:0">${esc(r.disclosure)}</p>`,
    `<p class="pgroast-title" style="margin:6px 0;font-weight:600">Design pre-review: ${esc(titleOf(r))}</p>`,
    `<p class="pgroast-verdict" style="margin:6px 0">Pre-review verdict: <strong>${esc(r.verdict)}</strong> (confidence: ${esc(r.confidence)})</p>`,
    qs.length ? `<p class="pgroast-questions-label" style="margin:8px 0 2px">Questions for the author:</p>\n<ol class="pgroast-questions" style="margin:0;padding-left:20px">${qs.map((q) => `<li class="pgroast-question">${esc(q)}</li>`).join("")}</ol>` : "",
    `<p class="pgroast-priority" style="margin:8px 0 0">Priority: ${esc(r.priority.recommended_action)}; audience: ${esc(r.priority.audience)}; maintenance burden: ${esc(r.priority.maintenance_burden)}; review cost: ${esc(r.priority.review_cost)}</p>`,
    href ? `<p class="pgroast-full" style="margin:8px 0 0"><a class="pgroast-full-link" href="${esc(href)}" rel="noopener noreferrer nofollow">Full version, with every objection and its evidence</a></p>` : "",
    `<p class="pgroast-generated" style="${small}">Idea and design only; no code was read. Generated ${esc(day(r.generated_at))}.</p>`,
    "</div>",
  ]
    .filter(Boolean)
    .join("\n") + "\n";
}

export interface SiteFile {
  /** Path relative to the site directory. */
  path: string;
  content: string;
}

/** URL-safe name for a message-id: anything outside [A-Za-z0-9._-] becomes "_". */
export const safeMessageId = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 180);

/**
 * The stable layout: cf/<id>.html (fragment), cf/<id>.json, cf/<id>/full.html; a roast of a
 * thread without a CommitFest entry goes under msg/<message-id>. No index is written: an
 * entry without a review is simply absent (a 404 on any static host).
 */
export function siteFiles(r: Roast, baseUrl: string = BASE_URL_PLACEHOLDER): SiteFile[] {
  let stem: string;
  if (r.input.cf && Number.isInteger(r.input.cf.id) && r.input.cf.id > 0) stem = `cf/${r.input.cf.id}`;
  else {
    const mid = r.input.thread_url ? messageIdOfUrl(r.input.thread_url) : null;
    if (!mid) throw new Error("this roast has neither a CommitFest id nor a thread: nothing to place in a site layout");
    stem = `msg/${safeMessageId(mid)}`;
  }
  const base = baseUrl.replace(/\/+$/, "");
  return [
    { path: `${stem}.html`, content: renderFragment(r, `${base}/${stem}/full.html`) },
    { path: `${stem}.json`, content: JSON.stringify(r, null, 2) + "\n" },
    { path: `${stem}/full.html`, content: renderPage(r) },
  ];
}
