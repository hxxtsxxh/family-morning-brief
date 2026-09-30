// Builds the editor prompt, parses the model's JSON, and attaches real sources/links
// (from the candidates the model cited — the model never supplies URLs).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.mjs";
import { ageLabel } from "./time.mjs";

const PROMPT_PATH = resolve(ROOT, "prompts/editor.md");

export function buildMessages(candidates, config, { recent = [], nowMs = Date.now() } = {}) {
  const fill = {
    audience: config.audience ?? "",
    interests: config.interests.map((i) => `- ${i}`).join("\n"),
    min_stories: config.length.min_stories,
    max_stories: config.length.max_stories,
    max_headline_chars: config.length.max_headline_chars,
    max_summary_words: config.length.max_summary_words,
    categories: config.categories.map((c) => `- ${c.id}: ${c.label} (max ${c.max})`).join("\n"),
    category_ids: config.categories.map((c) => c.id).join(", "),
    recent: recent.length ? recent.map((r) => `- ${r.date}: ${r.headline}`).join("\n") : "(none)",
  };
  const system = readFileSync(PROMPT_PATH, "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => String(fill[k] ?? ""));
  const lines = candidates.map((c) => candidateLine(c, nowMs));
  const user = `CANDIDATES (${candidates.length}), format: id [suggested section] (publishers · outlets · age) headline — snippet\n\n${lines.join("\n")}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function candidateLine(c, nowMs) {
  const pubs = c.publishers.slice(0, 4).join(", ");
  const snippets = [...new Set(c.items.map((i) => i.summary).filter((s) => s && s.length > 20))].slice(0, 2);
  const snip = snippets.length ? ` — ${snippets.map((s) => s.slice(0, 280)).join(" / ")}` : "";
  return `${c.id} [${c.categories[0]}] (${pubs} · ${c.coverage} outlet${c.coverage > 1 ? "s" : ""} · ${ageLabel(c.freshMs, nowMs)}) ${c.lead.title}${snip}`;
}

/** Parses the model output. Tolerates ```json fences and leading/trailing prose. */
export function parseModelJson(content) {
  let s = String(content ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model output contains no JSON object");
  return JSON.parse(s.slice(start, end + 1));
}

/**
 * Resolves the model's stories against the candidate list. Unknown ids are kept in
 * `unknownIds` so validation can reject them (a sign of hallucination).
 */
export function resolveBrief(parsed, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const stories = (Array.isArray(parsed?.stories) ? parsed.stories : []).map((s) => {
    const ids = [...new Set((Array.isArray(s?.candidate_ids) ? s.candidate_ids : []).map(String))];
    const clusters = ids.map((id) => byId.get(id)).filter(Boolean);
    const items = clusters.flatMap((c) => c.items);
    items.sort((a, b) => b.weight - a.weight || Number(a.googleNews) - Number(b.googleNews) || b.freshMs - a.freshMs);
    return {
      section: String(s?.section ?? ""),
      headline: cleanText(s?.headline),
      summary: cleanText(s?.summary),
      candidateIds: ids,
      unknownIds: ids.filter((id) => !byId.has(id)),
      sources: [...new Set(items.map((i) => i.publisher))].slice(0, 2),
      url: preferredUrl(items),
    };
  });
  return { intro: cleanText(parsed?.intro).slice(0, 120), stories };
}

/** Direct publisher links beat long Google News redirect links; otherwise most authoritative first. */
export function preferredUrl(items) {
  return (items.find((i) => !i.googleNews) ?? items[0])?.url ?? "";
}

/** Removes WhatsApp control characters and stray URLs from model-written text. */
export function cleanText(s) {
  return String(s ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * No-model preview: top clusters per section with the publisher's own snippet as the
 * summary. Used by `npm run brief:preview` to test retrieval/dedup/formatting offline.
 * Never used for real sends.
 */
export function heuristicBrief(candidates, config) {
  const stories = [];
  for (const cat of config.categories) {
    const picks = candidates.filter((c) => c.categories[0] === cat.id).slice(0, Math.min(cat.max, 2));
    for (const c of picks) {
      if (stories.length >= config.length.max_stories) break;
      const summary = firstSentences(c.items.map((i) => i.summary).find((s) => s && s.length > 30) ?? "", config.length.max_summary_words);
      stories.push({
        section: cat.id,
        headline: cleanText(c.lead.title).slice(0, config.length.max_headline_chars),
        summary: summary || "(no summary in feed)",
        candidateIds: [c.id],
        unknownIds: [],
        sources: c.publishers.slice(0, 2),
        url: preferredUrl(c.items),
      });
    }
  }
  return { intro: "", stories };
}

function firstSentences(text, maxWords) {
  const sentences = cleanText(text).match(/[^.!?]+[.!?]+(\s|$)/g) ?? [cleanText(text)];
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    if ((out + s).split(/\s+/).length > maxWords) break;
    out += s;
  }
  return out.trim();
}
