import { loadConfig } from "../src/config.mjs";

export const NOW = new Date("2026-09-30T14:30:00Z"); // 07:30 PDT

export function testConfig(overrides = {}, env = { FAMILY_WHATSAPP_GROUP_ID: "120363012345678901@g.us" }) {
  const c = loadConfig(undefined, env);
  return { ...c, ...overrides, length: { ...c.length, ...(overrides.length ?? {}) } };
}

let n = 0;
export function story(title, extra = {}) {
  n++;
  return {
    title,
    summary: extra.summary ?? "",
    url: extra.url ?? `https://example.com/story-${n}`,
    publisher: extra.publisher ?? "Reuters",
    category: extra.category ?? "world",
    weight: extra.weight ?? 3,
    googleNews: extra.googleNews ?? false,
    freshMs: extra.freshMs ?? NOW.getTime() - 3.6e6,
    updatedAfterPublish: false,
  };
}

/** A resolved brief with `count` valid, distinct stories spread over sections. */
export function sampleBrief(count = 6) {
  const sections = ["world", "world", "india", "us", "tech_business", "sports", "interesting", "india", "us"];
  const topics = [
    "Parliament passes national budget with new rail spending",
    "Cyclone makes landfall on eastern coast forcing evacuations",
    "Gujarat opens new semiconductor plant near Ahmedabad",
    "Federal Reserve holds interest rates steady",
    "Chipmaker reports record quarterly revenue",
    "India beat Australia in first Test at Perth",
    "Astronomers spot water vapour on distant exoplanet",
    "Monsoon rainfall ends season above average",
    "Senate confirms new transportation secretary",
  ];
  return {
    intro: "Good morning, happy Wednesday",
    stories: Array.from({ length: count }, (_, i) => ({
      section: sections[i % sections.length],
      headline: topics[i % topics.length],
      summary: "Officials announced the decision on Tuesday, affecting millions of people.",
      candidateIds: [`c${i + 1}`],
      unknownIds: [],
      sources: ["Reuters", "BBC"],
      url: `https://www.example.org/news/${i + 1}`,
    })),
  };
}
