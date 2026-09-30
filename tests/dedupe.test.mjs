import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterStories, isSameEvent, tokens } from "../src/dedupe.mjs";
import { story } from "./helpers.mjs";

test("same event from different publishers is merged into one cluster", () => {
  const clusters = clusterStories([
    story("India and US agree to cut tariffs on farm goods in new trade deal", { publisher: "Reuters" }),
    story("India, US agree trade deal cutting tariffs on farm goods", { publisher: "The Hindu", weight: 2 }),
    story("US and India strike trade deal to cut farm tariffs", { publisher: "AP" }),
    story("Heavy rain floods streets in Mumbai, schools shut", { publisher: "BBC" }),
  ]);
  assert.equal(clusters.length, 2);
  const trade = clusters.find((c) => c.items.length === 3);
  assert.ok(trade, "trade stories should be one cluster");
  assert.equal(trade.coverage, 3);
  assert.deepEqual(new Set(trade.publishers), new Set(["Reuters", "The Hindu", "AP"]));
});

test("different events that share a common word are NOT merged", () => {
  assert.equal(isSameEvent("Trump announces tariffs on Chinese steel", "Trump meets Modi at White House"), false);
  assert.equal(isSameEvent("Earthquake strikes Japan's Hokkaido island", "Japan wins Rugby World Cup quarter-final"), false);
  const clusters = clusterStories([
    story("Apple unveils new iPhone with satellite messaging"),
    story("Apple shares fall after EU antitrust fine"),
  ]);
  assert.equal(clusters.length, 2);
});

test("cluster lead prefers the most authoritative source, then direct links over Google News", () => {
  const [c] = clusterStories([
    story("Wildfire forces thousands to evacuate in Northern California", { publisher: "Local Blog", weight: 1 }),
    story("Wildfire forces thousands to evacuate in Northern California", { publisher: "Reuters", weight: 3, googleNews: true }),
    story("Wildfire forces thousands to evacuate in Northern California", { publisher: "NPR", weight: 3 }),
  ]);
  assert.equal(c.lead.publisher, "NPR");
});

test("tokens drop stopwords, possessives and punctuation", () => {
  assert.deepEqual(tokens("India's PM says the economy is growing!"), ["india", "pm", "economy", "growing"]);
});
