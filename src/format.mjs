// Renders the brief as one WhatsApp message.
//
// OpenClaw parses outbound WhatsApp text as Markdown and converts it to WhatsApp
// formatting (verified in extensions/whatsapp/src/targets-runtime.ts, 2026.9.7):
//   **bold** → *bold*,  _italic_ → _italic_,  single newlines kept,  blank lines kept.
// So this file writes Markdown, NOT WhatsApp markers (a WhatsApp-style *x* would arrive
// as italics). Bullets use a literal "•" so they're plain text, not Markdown lists.
import { prettyDate } from "./time.mjs";

/** Orders stories by configured section order (stable within a section). */
export function orderStories(stories, config) {
  const rank = new Map(config.categories.map((c, i) => [c.id, i]));
  return stories
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (rank.get(a.s.section) ?? 99) - (rank.get(b.s.section) ?? 99) || a.i - b.i)
    .map(({ s }) => s);
}

/** Escapes characters Markdown would treat as formatting inside a URL. */
export function escapeUrl(url) {
  return String(url).replace(/([_*~`\\])/g, "\\$1");
}

/**
 * Returns { text, bodyText, links } — `bodyText` excludes the link list and is what the
 * word limit applies to.
 *
 *   ☀️ **Morning Chai**
 *   _Wednesday, September 30_
 *
 *   🌎 **Top Stories**
 *   • **Headline**
 *   One-sentence gist. _BBC_
 *
 *   • **Headline**
 *   …
 */
export function renderBrief(brief, config, date = new Date()) {
  const stories = orderStories(brief.stories, config);
  const catById = new Map(config.categories.map((c) => [c.id, c]));
  const blocks = [`${config.title}\n_${prettyDate(date, config.timezone)}_`];

  let current = null;
  const links = [];
  for (const s of stories) {
    const lines = [];
    if (s.section !== current) {
      current = s.section;
      const cat = catById.get(s.section);
      lines.push(`${cat?.emoji ?? "•"} **${cat?.label ?? s.section}**`);
    }
    links.push({ url: s.url, source: s.linkSource || s.sources[0] || "Source" });
    lines.push(`• **${s.headline}**`);
    lines.push(`${s.summary} _${s.sources.join(", ")}_`);
    if (config.links === "inline") lines.push(`🔗 ${escapeUrl(s.url)}`);
    blocks.push(lines.join("\n"));
  }

  const body = [...blocks];
  if (config.links === "bottom" && links.length) {
    blocks.push(["🔗 **Read more**", ...links.map((l) => `• ${l.source}: ${escapeUrl(l.url)}`)].join("\n"));
  }
  if (config.sign_off) {
    blocks.push(config.sign_off);
    body.push(config.sign_off);
  }
  return { text: blocks.join("\n\n"), bodyText: body.join("\n\n"), links: links.map((l) => l.url) };
}

export function wordCount(text) {
  return String(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
