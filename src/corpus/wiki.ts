// Wiki source: https://wiki.postgresql.org/wiki/Not_Worth_Doing
// "Features We Do Not Want" is an <h2> on that page (not on wiki/Todo; the
// Todo page says retired items move to Not_Worth_Doing). Items under that
// heading get status "Not wanted"; the other retired items "Not worth doing".

import { fetchPage } from "./fetch.ts";
import {
  extractMsgids, flatUrl, isMsgidUrl, stripTags, touchPoints, unescapeHtml,
  type PrecedentRecord,
} from "./util.ts";

export const WIKI_PAGE = "https://wiki.postgresql.org/wiki/Not_Worth_Doing";
export const DNW_HEADING = "Features We Do Not Want";

export interface WikiItem {
  anchor: string; section: string; index: number; title: string;
  description: string; links: string[]; linkTexts: string[]; wikiLinks: string[]; doNotWant: boolean;
}

export function parseWiki(h: string): WikiItem[] {
  let body = h.slice(Math.max(0, h.indexOf('id="mw-content-text"')));
  const cat = body.indexOf('id="catlinks"');
  if (cat >= 0) body = body.slice(0, cat);
  // headings with "/" carry a URL-safe legacy anchor span first; prefer it
  const re = /<h([23])>(?:<span id="([^"]+)"><\/span>)?<span class="mw-headline" id="([^"]+)">([\s\S]*?)<\/span><\/h[23]>/g;
  const heads = [...body.matchAll(re)];
  const items: WikiItem[] = [];
  let h2: string | null = null;
  heads.forEach((m, i) => {
    const level = m[1], anchor = m[2] ?? m[3]!, label = stripTags(m[4]!);
    if (level === "2") h2 = label;
    const start = m.index! + m[0].length;
    const end = heads[i + 1]?.index ?? body.length;
    const content = body.slice(start, end);
    const section = label === h2 ? label : `${h2} / ${label}`;
    let n = 0;
    for (const dm of content.matchAll(/<dl>\s*<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>\s*<\/dl>/g)) {
      n++;
      const dt = dm[1]!, dd = dm[2]!;
      const both = dt + dd;
      items.push({
        anchor, section, index: n,
        title: stripTags(dt.split("<ul>")[0]!),
        description: stripTags(dd.replace(/<ul>[\s\S]*?<\/ul>/g, "")),
        links: [...both.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((x) => unescapeHtml(x[1]!)),
        linkTexts: [...both.matchAll(/<a [^>]*href="https?:\/\/[^"]+"[^>]*>([\s\S]*?)<\/a>/g)].map((x) => stripTags(x[1]!)),
        wikiLinks: [...dd.matchAll(/href="(\/wiki\/(?!File:)[^"#]+)"/g)].map((x) => "https://wiki.postgresql.org" + unescapeHtml(x[1]!)),
        doNotWant: h2 === DNW_HEADING,
      });
    }
  });
  return items;
}

export async function collectWiki(opts: { offline?: boolean }) {
  const h = await fetchPage(WIKI_PAGE, opts);
  if (!h) throw new Error("cannot fetch " + WIKI_PAGE);
  const items = parseWiki(h);
  const recs: PrecedentRecord[] = items.map((it) => {
    const note = it.linkTexts.filter((t) => t && !t.startsWith("http")).join("; ");
    return {
      id: `wiki:${it.anchor}:${it.index}`, kind: "do_not_want", rawRef: `Not_Worth_Doing#${it.anchor}:${it.index}`,
      title: it.title, status: it.doNotWant ? "Not wanted" : "Not worth doing",
      date: null, firstDate: null, url: `${WIKI_PAGE}#${it.anchor}`,
      threadUrls: [...new Set(extractMsgids(it.links.join(" ")).map(flatUrl))],
      authors: [], reviewers: [], objectors: [],
      tags: it.section,
      summary: `${it.title}\nSection: ${it.section}` + (note ? `\nLinked: ${note}` : ""),
      objection: it.description,
      touchPoints: touchPoints([it.title, it.section, it.description].join(" ")),
      otherLinks: [...it.links.filter((u) => !isMsgidUrl(u)), ...it.wikiLinks],
      provenance: { source: "wiki page " + WIKI_PAGE, section: it.section, item_index: it.index },
    };
  });
  return {
    recs,
    cov: { items: items.length, do_not_want_items: items.filter((i) => i.doNotWant).length },
    complete: true,
  };
}
