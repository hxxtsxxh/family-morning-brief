// Renders the brief as one WhatsApp message (WhatsApp formatting: *bold*, _italic_).
import { prettyDate } from "./time.mjs";

/** Orders stories by configured section order (stable within a section). */
export function orderStories(stories, config) {
  const rank = new Map(config.categories.map((c, i) => [c.id, i]));
  return stories
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (rank.get(a.s.section) ?? 99) - (rank.get(b.s.section) ?? 99) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Returns { text, bodyText, links } — `bodyText` excludes the link list and is what the
 * word limit applies to.
 */
export function renderBrief(brief, config, date = new Date()) {
  const stories = orderStories(brief.stories, config);
  const catById = new Map(config.categories.map((c) => [c.id, c]));
  const out = [config.title, prettyDate(date, config.timezone)];
  if (brief.intro) out.push(`_${brief.intro}_`);

  let n = 0;
  let current = null;
  const links = [];
  for (const s of stories) {
    if (s.section !== current) {
      current = s.section;
      const cat = catById.get(s.section);
      out.push("", `${cat?.emoji ?? "•"} *${cat?.label ?? s.section}*`);
    }
    n++;
    links.push(s.url);
    out.push(`*${n}. ${s.headline}*`);
    out.push(s.summary);
    out.push(`_Source: ${s.sources.join(", ")}_${config.links === "inline" ? `\n🔗 ${s.url}` : ""}`);
  }

  const body = [...out];
  if (config.links === "bottom" && links.length) {
    out.push("", "🔗 *Links*", ...links.map((u, i) => `${i + 1}. ${u}`));
  }
  if (config.sign_off) {
    out.push("", config.sign_off);
    body.push("", config.sign_off);
  }
  return { text: out.join("\n"), bodyText: body.join("\n"), links };
}

export function wordCount(text) {
  return String(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
