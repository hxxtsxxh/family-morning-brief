import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBrief, wordCount } from "../src/format.mjs";
import { validateBrief, sentenceCount } from "../src/validate.mjs";
import { resolveBrief, parseModelJson, cleanText } from "../src/compose.mjs";
import { testConfig, sampleBrief, NOW } from "./helpers.mjs";

test("renders a WhatsApp-friendly brief with sections, numbering, sources and bottom links", () => {
  const config = testConfig();
  const { text, links } = renderBrief(sampleBrief(6), config, NOW);
  const lines = text.split("\n");
  assert.equal(lines[0], "☀️ *Morning Chai*");
  assert.equal(lines[1], "Wednesday, September 30");
  assert.match(text, /🌎 \*Top Stories\*\n\*1\. Parliament passes/);
  assert.match(text, /🇮🇳 \*India\*/);
  assert.match(text, /_Source: Reuters, BBC_/);
  assert.match(text, /🔗 \*Links\*\n1\. https:\/\/www\.example\.org\/news\/1/);
  assert.equal(links.length, 6);
  assert.ok(text.trimEnd().endsWith("Have a great day ❤️"));
  // Section headers appear once each, in configured order.
  const order = ["Top Stories", "India", "United States", "Tech & Business", "Sports"].map((l) => text.indexOf(`*${l}*`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("inline link mode puts each link under its story and omits the list", () => {
  const { text } = renderBrief(sampleBrief(3), testConfig({ links: "inline" }), NOW);
  assert.match(text, /_Source: Reuters, BBC_\n🔗 https:\/\/www\.example\.org\/news\/1/);
  assert.doesNotMatch(text, /\*Links\*/);
});

test("a valid brief passes validation", () => {
  const config = testConfig();
  const brief = sampleBrief(6);
  assert.deepEqual(validateBrief(brief, renderBrief(brief, config, NOW), config), []);
});

test("more stories than max_stories is rejected", () => {
  const config = testConfig({ length: { max_stories: 5 } });
  const brief = sampleBrief(6);
  const errors = validateBrief(brief, renderBrief(brief, config, NOW), config);
  assert.ok(errors.some((e) => /6 stories; maximum is 5/.test(e)), errors.join("; "));
});

test("section maximums are enforced", () => {
  const config = testConfig();
  const brief = sampleBrief(4);
  brief.stories.forEach((s) => (s.section = "world")); // world max is 3
  const errors = validateBrief(brief, null, config);
  assert.ok(errors.some((e) => /section world has 4 stories/.test(e)));
});

test("empty briefing fails", () => {
  const config = testConfig();
  const errors = validateBrief({ intro: "", stories: [] }, renderBrief({ intro: "", stories: [] }, config, NOW), config);
  assert.ok(errors.includes("briefing has no stories"));
});

test("missing / invalid / non-https source URLs fail", () => {
  const config = testConfig();
  const brief = sampleBrief(4);
  brief.stories[0].url = "";
  brief.stories[1].url = "http://insecure.example.com/a";
  brief.stories[2].url = "javascript:alert(1)";
  const errors = validateBrief(brief, null, config);
  for (const n of [1, 2, 3]) assert.ok(errors.includes(`story ${n}: missing or invalid source URL`), `story ${n}`);
});

test("stories without a source, or citing unknown candidate ids, fail", () => {
  const config = testConfig();
  const brief = sampleBrief(4);
  brief.stories[0].sources = [];
  brief.stories[1].unknownIds = ["c999"];
  const errors = validateBrief(brief, null, config);
  assert.ok(errors.includes("story 1: has no source"));
  assert.ok(errors.some((e) => /story 2: cites unknown candidate ids c999/.test(e)));
});

test("duplicate events are caught (same candidate twice, or near-identical headlines)", () => {
  const config = testConfig();
  const brief = sampleBrief(5);
  brief.stories[4].candidateIds = ["c1"];
  brief.stories[3].headline = brief.stories[2].headline + " today";
  const errors = validateBrief(brief, null, config);
  assert.ok(errors.some((e) => /both cite c1/.test(e)));
  assert.ok(errors.some((e) => /stories 3 and 4 look like the same event/.test(e)));
});

test("over-long briefings fail on words and characters", () => {
  const config = testConfig({ length: { max_words: 50, max_chars: 500 } });
  const brief = sampleBrief(4);
  const errors = validateBrief(brief, renderBrief(brief, config, NOW), config);
  assert.ok(errors.some((e) => /words; max is 50/.test(e)));
  assert.ok(errors.some((e) => /characters; max is 500/.test(e)));
});

test("summaries longer than two sentences fail; abbreviations don't count", () => {
  assert.equal(sentenceCount("The U.S. economy grew 3.5% last quarter. Officials were pleased."), 2);
  assert.equal(sentenceCount("One. Two. Three."), 3);
  const config = testConfig();
  const brief = sampleBrief(3);
  brief.stories[0].summary = "One thing happened. Then another. And a third.";
  assert.ok(validateBrief(brief, null, config).includes("story 1: summary must be 1–2 sentences"));
});

test("model JSON is parsed from fenced output and resolved against candidates", () => {
  const parsed = parseModelJson('Here you go:\n```json\n{"intro":"Hi","stories":[{"section":"world","candidate_ids":["c1","c9"],"headline":"*Big* news","summary":"It happened. See https://evil.example"}]}\n```');
  const candidates = [
    {
      id: "c1",
      items: [
        { publisher: "Reuters", url: "https://news.google.com/rss/articles/x", weight: 3, googleNews: true, freshMs: 1 },
        { publisher: "BBC", url: "https://www.bbc.com/news/a", weight: 3, googleNews: false, freshMs: 1 },
      ],
    },
  ];
  const brief = resolveBrief(parsed, candidates);
  const s = brief.stories[0];
  assert.equal(s.headline, "Big news");
  assert.equal(s.summary, "It happened. See");
  assert.deepEqual(s.unknownIds, ["c9"]);
  assert.equal(s.url, "https://www.bbc.com/news/a", "direct link preferred over Google News redirect");
  assert.deepEqual(s.sources, ["BBC", "Reuters"], "equal weight → direct-link publisher listed first");
});

test("cleanText strips WhatsApp formatting characters and URLs", () => {
  assert.equal(cleanText("  _Hello_ *world* ~x~ `y` https://a.b/c  "), "Hello world x y");
  assert.equal(wordCount("☀️ *Morning Chai*\n• one two"), 4);
});
