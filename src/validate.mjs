// Last line of defence before anything reaches the family group.
// Returns a list of human-readable problems; empty list = OK to send.
import { isHttpsUrl } from "./config.mjs";
import { tokens, jaccard } from "./dedupe.mjs";
import { wordCount } from "./format.mjs";

export function validateBrief(brief, rendered, config) {
  const errors = [];
  const L = config.length;
  const stories = brief?.stories ?? [];
  const sectionIds = new Set(config.categories.map((c) => c.id));

  if (!stories.length) errors.push("briefing has no stories");
  if (stories.length && stories.length < L.min_stories) errors.push(`only ${stories.length} stories; minimum is ${L.min_stories}`);
  if (stories.length > L.max_stories) errors.push(`${stories.length} stories; maximum is ${L.max_stories} — drop the least important`);

  const perSection = {};
  const usedIds = new Map();
  stories.forEach((s, i) => {
    const n = i + 1;
    if (!sectionIds.has(s.section)) errors.push(`story ${n}: unknown section "${s.section}"`);
    perSection[s.section] = (perSection[s.section] ?? 0) + 1;
    if (!s.headline) errors.push(`story ${n}: empty headline`);
    if (s.headline.length > L.max_headline_chars) errors.push(`story ${n}: headline longer than ${L.max_headline_chars} characters`);
    if (!s.summary) errors.push(`story ${n}: empty summary`);
    if (wordCount(s.summary) > L.max_summary_words) errors.push(`story ${n}: summary has ${wordCount(s.summary)} words; max is ${L.max_summary_words}`);
    if (sentenceCount(s.summary) > 2) errors.push(`story ${n}: summary must be 1–2 sentences`);
    if (!s.candidateIds.length) errors.push(`story ${n}: cites no candidate ids`);
    if (s.unknownIds.length) errors.push(`story ${n}: cites unknown candidate ids ${s.unknownIds.join(", ")} — only use ids from the list`);
    if (!s.sources.length) errors.push(`story ${n}: has no source`);
    if (!isHttpsUrl(s.url)) errors.push(`story ${n}: missing or invalid source URL`);
    for (const id of s.candidateIds) {
      if (usedIds.has(id)) errors.push(`stories ${usedIds.get(id)} and ${n} both cite ${id} — same event must appear once`);
      else usedIds.set(id, n);
    }
  });

  for (const cat of config.categories) {
    if ((perSection[cat.id] ?? 0) > cat.max) errors.push(`section ${cat.id} has ${perSection[cat.id]} stories; max is ${cat.max}`);
  }

  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      if (jaccard(tokens(stories[i].headline), tokens(stories[j].headline)) >= 0.6) {
        errors.push(`stories ${i + 1} and ${j + 1} look like the same event — merge them`);
      }
      if (stories[i].url && stories[i].url === stories[j].url) errors.push(`stories ${i + 1} and ${j + 1} share the same link`);
    }
  }

  if (rendered) {
    const words = wordCount(rendered.bodyText);
    if (words > config.length.max_words) errors.push(`briefing is ${words} words; max is ${config.length.max_words} — shorten summaries or drop stories`);
    if (rendered.text.length > config.length.max_chars) errors.push(`briefing is ${rendered.text.length} characters; max is ${config.length.max_chars}`);
    if (!rendered.text.trim()) errors.push("rendered briefing is blank");
  }
  return errors;
}

/** Counts sentences, ignoring common abbreviations and decimals (U.S., Dr., 3.5). */
export function sentenceCount(text) {
  const cleaned = String(text)
    .replace(/\b(?:[A-Z]\.){2,}/g, "X")
    .replace(/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|No|Gov|Sen|Rep|Gen|Lt|Col|Inc|Ltd|Co|approx|etc)\./g, "X")
    .replace(/\d\.\d/g, "0");
  return (cleaned.match(/[.!?]+(?=\s|$)/g) ?? []).length || (cleaned.trim() ? 1 : 0);
}
