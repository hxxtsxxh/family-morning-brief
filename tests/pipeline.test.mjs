// End-to-end pipeline with fake feeds and a fake editor model (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBrief, BriefFailure } from "../src/pipeline.mjs";
import { testConfig, NOW } from "./helpers.mjs";

const silent = { info() {}, warn() {}, error() {} };
const ago = (h) => new Date(NOW.getTime() - h * 3.6e6).toUTCString();

const HEADLINES = {
  world: ["UN Security Council approves new ceasefire monitoring mission", "Earthquake of magnitude 7.1 strikes off Japan coast", "EU leaders agree on joint energy purchasing plan"],
  india: ["RBI keeps repo rate unchanged, raises growth forecast", "Gujarat approves new metro line for Surat"],
  us: ["Congress passes stopgap bill to avoid government shutdown", "FDA approves first nasal spray flu vaccine for adults"],
  tech_business: ["Nvidia unveils next-generation AI chip at developer event", "Tata Motors reports record quarterly EV sales"],
  sports: ["India beat Australia by six wickets in first ODI"],
  interesting: ["NASA probe captures closest-ever images of Jupiter moon Europa"],
};

function feedFor(cat) {
  const items = HEADLINES[cat].map((t, i) => `<item><title>${t}</title><link>https://www.bbc.com/${cat}/${i}</link><description>${t}. Officials confirmed the details on Tuesday.</description><pubDate>${ago(i + 1)}</pubDate></item>`);
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items.join("")}</channel></rss>`;
}

const isFactCheck = (body) => body.messages[0].content.includes("strict fact-checker");
const ok = (content) => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }));

function setup(modelReplies) {
  const config = testConfig();
  config.sources = Object.keys(HEADLINES).map((cat) => ({ name: "BBC News", category: cat, weight: 3, url: `https://feeds.example/${cat}.xml` }));
  config.llm = { ...config.llm, retry_delays_seconds: [0], unavailable_wait_minutes: 0, providers: [{ name: "fake", base_url: "https://llm.example/v1", api_key_env: "FAKE_KEY", models: ["m1"] }] };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    if (url.startsWith("https://feeds.example/")) return new Response(feedFor(url.match(/\/(\w+)\.xml$/)[1]));
    if (isFactCheck(JSON.parse(opts.body))) return ok({ problems: [] });
    calls.push(JSON.parse(opts.body));
    const reply = modelReplies[Math.min(calls.length - 1, modelReplies.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] }));
  };
  return { config, fetchImpl, calls };
}

/** Builds a model reply choosing the candidates whose headline matches. */
function replyFor(calls, picks) {
  return (candidatesText) => {
    const idOf = (headline) => candidatesText.match(new RegExp(`(c\\d+) \\[[^\\]]+\\] \\([^)]*\\) ${headline}`))[1];
    return { intro: "Good morning!", stories: picks.map(([section, headline]) => ({ section, candidate_ids: [idOf(headline)], headline, summary: "Officials confirmed the details on Tuesday." })) };
  };
}

const PICKS = [
  ["world", HEADLINES.world[0]],
  ["world", HEADLINES.world[1]],
  ["india", HEADLINES.india[0]],
  ["us", HEADLINES.us[0]],
  ["tech_business", HEADLINES.tech_business[0]],
  ["sports", HEADLINES.sports[0]],
];

test("happy path: feeds → candidates → model → validated WhatsApp brief", async () => {
  let build;
  const { config, fetchImpl, calls } = setup([]);
  const wrapped = async (url, opts) => {
    if (!url.startsWith("https://llm.example")) return fetchImpl(url, opts);
    const body = JSON.parse(opts.body);
    if (isFactCheck(body)) return ok({ problems: [] });
    calls.push(body);
    build ??= replyFor(calls, PICKS);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(build(body.messages[1].content)) } }] }));
  };
  const r = await generateBrief(config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: wrapped, env: { FAKE_KEY: "k" } });
  assert.equal(r.brief.stories.length, 6);
  assert.equal(r.meta.attempts, 1);
  assert.equal(r.meta.candidates, 11);
  assert.match(r.rendered.text, /🌎 \*\*Top Stories\*\*\n• \*\*UN Security Council approves/);
  assert.match(r.rendered.text, /🏏 \*\*Sports\*\*\n• \*\*India beat Australia/);
  assert.ok(r.rendered.links.every((u) => u.startsWith("https://www.bbc.com/")));
  // Key never leaks into the prompt; system prompt carries editorial rules.
  assert.doesNotMatch(JSON.stringify(calls[0]), /"k"/);
  assert.match(calls[0].messages[0].content, /never predict election outcomes/);
});

test("invalid first answer triggers exactly one correction retry", async () => {
  const { config, fetchImpl, calls } = setup([]);
  let n = 0;
  const wrapped = async (url, opts) => {
    if (!url.startsWith("https://llm.example")) return fetchImpl(url, opts);
    const body = JSON.parse(opts.body);
    if (isFactCheck(body)) return ok({ problems: [] });
    calls.push(body);
    n++;
    const good = replyFor(calls, PICKS)(body.messages[1].content);
    const reply = n === 1 ? { ...good, stories: [...good.stories, { ...good.stories[0] }] } : good; // first: duplicate story
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
  };
  const r = await generateBrief(config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: wrapped, env: { FAKE_KEY: "k" } });
  assert.equal(r.meta.attempts, 2);
  assert.equal(calls.length, 2);
  const correction = calls[1].messages.at(-1).content;
  assert.match(correction, /same event must appear once/);
});

/** Editor always returns PICKS; fact-checker answers from `factReplies` in order. */
function withFactChecker(factReplies, { failFirstEditorCalls = 0 } = {}) {
  const { config, fetchImpl } = setup([]);
  const editorCalls = [], factCalls = [];
  const wrapped = async (url, opts) => {
    if (!url.startsWith("https://llm.example")) return fetchImpl(url, opts);
    const body = JSON.parse(opts.body);
    if (isFactCheck(body)) {
      factCalls.push(body);
      return ok(factReplies[Math.min(factCalls.length - 1, factReplies.length - 1)]);
    }
    editorCalls.push(body);
    if (editorCalls.length <= failFirstEditorCalls) return new Response('{"error":{"message":"This model is currently experiencing high demand."}}', { status: 503 });
    return ok(replyFor([], PICKS)(body.messages[1].content));
  };
  return { config, fetchImpl: wrapped, editorCalls, factCalls };
}

test("fact-check problems are sent back to the editor as a correction", async () => {
  const t = withFactChecker([{ problems: [{ story: 1, problem: "mixes up who was wounded" }] }, { problems: [] }]);
  const r = await generateBrief(t.config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: t.fetchImpl, env: { FAKE_KEY: "k" } });
  assert.equal(r.meta.attempts, 2);
  assert.equal(t.factCalls.length, 2);
  assert.match(t.editorCalls[1].messages.at(-1).content, /story 1: mixes up who was wounded/);
  assert.match(t.factCalls[0].messages[1].content, /STORY 1\nHeadline: UN Security Council[\s\S]*SOURCE EXCERPTS:\n  - \[BBC\]/);
  assert.equal(r.brief.stories.length, 6);
});

test("stories still flagged after the retry are dropped, the rest is sent", async () => {
  const t = withFactChecker([{ problems: [{ story: 2, problem: "number not in source" }] }]);
  const r = await generateBrief(t.config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: t.fetchImpl, env: { FAKE_KEY: "k" } });
  assert.equal(r.meta.droppedByFactCheck, 1);
  assert.equal(r.brief.stories.length, 5);
  assert.ok(!r.rendered.text.includes(HEADLINES.world[1]));
});

test("if too much is flagged, nothing is sent", async () => {
  const all = { problems: [1, 2, 3, 4, 5, 6].map((n) => ({ story: n, problem: "unsupported" })) };
  const t = withFactChecker([all]);
  await assert.rejects(
    () => generateBrief(t.config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: t.fetchImpl, env: { FAKE_KEY: "k" } }),
    (err) => err instanceof BriefFailure && err.stage === "validation",
  );
});

test("a 'high demand' 503 is retried on the same model before giving up", async () => {
  const t = withFactChecker([{ problems: [] }], { failFirstEditorCalls: 1 });
  const r = await generateBrief(t.config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: t.fetchImpl, env: { FAKE_KEY: "k" } });
  assert.equal(t.editorCalls.length, 2);
  assert.equal(r.meta.editor, "fake/m1");
});

test("if every model is busy, waits once and retries before giving up", async () => {
  const t = withFactChecker([{ problems: [] }], { failFirstEditorCalls: 2 }); // both same-model tries fail
  t.config.llm.unavailable_wait_minutes = 5;
  const waits = [];
  const r = await generateBrief(t.config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: t.fetchImpl, env: { FAKE_KEY: "k" }, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [300000]);
  assert.equal(r.brief.stories.length, 6);
});

test("Google News links on the final stories are swapped for direct publisher links", async () => {
  const { config, fetchImpl } = setup([]);
  config.sources = config.sources.map((s, i) => (i === 0 ? { ...s, google_news: true, name: "Reuters (via Google News)" } : s));
  const gnFeed = feedFor("world").replace(/<link>https:\/\/www\.bbc\.com\/world\/(\d)<\/link>/g, "<link>https://news.google.com/rss/articles/ART$1?oc=5</link><source url=\"https://www.reuters.com\">Reuters</source>");
  const wrapped = async (url, opts) => {
    if (url === "https://feeds.example/world.xml") return new Response(gnFeed);
    if (url.startsWith("https://news.google.com/rss/articles/")) return new Response('<c-wiz data-n-a-sg="SIG" data-n-a-ts="1790000000"></c-wiz>');
    if (url.startsWith("https://news.google.com/_/DotsSplashUi")) {
      const id = decodeURIComponent(opts.body).match(/ART\d/)[0];
      return new Response(`)]}'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.reuters.com/world/${id}\\",1]"]]`);
    }
    if (url.startsWith("https://llm.example")) {
      const body = JSON.parse(opts.body);
      if (isFactCheck(body)) return ok({ problems: [] });
      return ok(replyFor([], PICKS)(body.messages[1].content));
    }
    return fetchImpl(url, opts);
  };
  const r = await generateBrief(config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl: wrapped, env: { FAKE_KEY: "k" } });
  const world = r.brief.stories.filter((s) => s.section === "world");
  assert.ok(world.every((s) => s.url.startsWith("https://www.reuters.com/world/ART")), world.map((s) => s.url).join(", "));
  assert.ok(world.every((s) => s.allUrls.some((u) => u.startsWith("https://news.google.com/"))), "history keeps both forms");
  assert.doesNotMatch(r.rendered.text, /news\.google\.com/);
});

test("two invalid answers → BriefFailure (nothing to send)", async () => {
  const { config, fetchImpl } = setup(["not json at all", '{"intro":"","stories":[]}']);
  await assert.rejects(
    () => generateBrief(config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl, env: { FAKE_KEY: "k" } }),
    (err) => err instanceof BriefFailure && err.stage === "validation" && /no stories/.test(err.message),
  );
});

test("no API key configured → clear llm failure, no crash", async () => {
  const { config, fetchImpl } = setup([]);
  await assert.rejects(
    () => generateBrief(config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl, env: {} }),
    (err) => err instanceof BriefFailure && err.stage === "llm" && /FAKE_KEY not set/.test(err.message),
  );
});

test("internet down (most feeds failing) → retrieval failure, no model call", async () => {
  const { config } = setup([]);
  let modelCalled = false;
  const fetchImpl = async (url) => {
    if (url.startsWith("https://llm.example")) modelCalled = true;
    throw new Error("getaddrinfo ENOTFOUND");
  };
  await assert.rejects(
    () => generateBrief(config, { log: silent, history: { runs: [] }, todayKey: "2026-09-30", now: NOW, fetchImpl, env: { FAKE_KEY: "k" } }),
    (err) => err instanceof BriefFailure && err.stage === "retrieval",
  );
  assert.equal(modelCalled, false);
});

test("stories already sent yesterday are not offered again", async () => {
  const { config, fetchImpl } = setup([]);
  const history = { runs: [{ date: "2026-09-29", status: "sent", stories: [{ headline: "x", urls: ["https://www.bbc.com/world/0"] }] }] };
  const r = await generateBrief(config, { log: silent, history, todayKey: "2026-09-30", now: NOW, fetchImpl, noLlm: true, env: {} });
  assert.equal(r.meta.candidates, 10);
  assert.ok(!r.rendered.links.includes("https://www.bbc.com/world/0"));
});
