import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { loadConfig, validateConfig, isWhatsAppGroupJid, ROOT } from "../src/config.mjs";
import { scheduleDecision, cronLinesFor } from "../src/schedule.mjs";
import { localDateKey, prettyDate } from "../src/time.mjs";
import { recordRun, alreadyDelivered, recentUrls, recentHeadlines, shiftDate } from "../src/history.mjs";

const RAW = YAML.parse(readFileSync(resolve(ROOT, "config/brief.config.yaml"), "utf8"));

test("the shipped config loads and has sane defaults", () => {
  const c = loadConfig(undefined, { FAMILY_WHATSAPP_GROUP_ID: " 120363012345678901@g.us " });
  assert.equal(c.timezone, "America/Los_Angeles");
  assert.equal(c.send_time, "07:30");
  assert.ok(c.length.max_stories <= 8 && c.length.max_words <= 650);
  assert.equal(c.groupId, "120363012345678901@g.us", "group id comes from env, trimmed");
  assert.deepEqual(c.categories.map((x) => x.id), ["world", "india", "us", "tech_business", "sports", "interesting"]);
  assert.ok(c.sources.length >= 20);
  assert.ok(c.historyPath.endsWith("state/history.json"));
});

test("config without the env var has an empty group id (dry runs still work)", () => {
  assert.equal(loadConfig(undefined, {}).groupId, "");
});

test("invalid config is rejected with every problem listed", () => {
  const bad = structuredClone(RAW);
  bad.timezone = "Mars/Olympus";
  bad.send_time = "7:30am";
  bad.length.max_stories = 0;
  bad.links = "sideways";
  bad.sources[0].url = "http://not-https.example.com";
  bad.sources[1].category = "gossip";
  assert.throws(() => validateConfig(bad, {}), (err) => {
    for (const s of ["timezone", "send_time", "max_stories", "links", "invalid https url", 'unknown category "gossip"']) {
      assert.ok(err.message.includes(s), `expected error mentioning ${s}:\n${err.message}`);
    }
    return true;
  });
});

test("WhatsApp group JID detection", () => {
  assert.ok(isWhatsAppGroupJid("120363012345678901@g.us"));
  assert.ok(isWhatsAppGroupJid("15551234567-1612345678@g.us"));
  for (const bad of ["", "+15551234567", "15551234567@s.whatsapp.net", "120363@newsletter", "family", "x@g.us"]) {
    assert.equal(isWhatsAppGroupJid(bad), false, bad);
  }
});

test("dates are computed in America/Los_Angeles, not UTC", () => {
  const lateEvening = new Date("2026-10-01T05:30:00Z"); // 22:30 PDT on Sep 30
  assert.equal(localDateKey(lateEvening, "America/Los_Angeles"), "2026-09-30");
  assert.equal(prettyDate(lateEvening, "America/Los_Angeles"), "Wednesday, September 30");
});

test("schedule gate: runs once in the morning window, in both PDT and PST", () => {
  const config = loadConfig(undefined, {});
  const empty = { runs: [] };
  // PDT (UTC-7): cron 14:15 UTC = 07:15 local → go
  assert.equal(scheduleDecision({ now: new Date("2026-09-30T14:15:00Z"), config, history: empty, enabled: true }).go, true);
  // PST (UTC-8): the 14:15 UTC cron is 06:15 local → too early; the 15:15 UTC cron is 07:15 → go
  assert.equal(scheduleDecision({ now: new Date("2026-12-01T14:15:00Z"), config, history: empty, enabled: true }).go, false);
  assert.equal(scheduleDecision({ now: new Date("2026-12-01T15:15:00Z"), config, history: empty, enabled: true }).go, true);
  // Retries at ~8:15 and ~9:15 local still go if nothing was sent yet…
  assert.equal(scheduleDecision({ now: new Date("2026-09-30T16:15:00Z"), config, history: empty, enabled: true }).go, true);
  assert.equal(scheduleDecision({ now: new Date("2026-12-01T17:15:00Z"), config, history: empty, enabled: true }).go, true);
  // …but the summer 17:15 UTC line (10:15 PDT) is too late, and so is an afternoon run.
  assert.equal(scheduleDecision({ now: new Date("2026-09-30T17:15:00Z"), config, history: empty, enabled: true }).go, false);
  assert.equal(scheduleDecision({ now: new Date("2026-09-30T21:00:00Z"), config, history: empty, enabled: true }).go, false);
});

test("schedule gate: never sends twice a day, and does nothing until enabled", () => {
  const config = loadConfig(undefined, {});
  const now = new Date("2026-09-30T15:15:00Z"); // 08:15 PDT — second cron of the day
  const sent = recordRun({ runs: [] }, { date: "2026-09-30", status: "sent" });
  assert.match(scheduleDecision({ now, config, history: sent, enabled: true }).reason, /already sent/);
  const sendError = recordRun({ runs: [] }, { date: "2026-09-30", status: "send_error" });
  assert.equal(scheduleDecision({ now, config, history: sendError, enabled: true }).go, false, "no auto-retry after a failed send (could double-post)");
  const skipped = recordRun({ runs: [] }, { date: "2026-09-30", status: "skipped" });
  assert.equal(scheduleDecision({ now, config, history: skipped, enabled: true }).go, true, "a skipped (unsent) morning may retry");
  assert.equal(scheduleDecision({ now, config, history: { runs: [] }, enabled: false }).go, false);
});

test("the workflow's cron lines match send_time + timezone (keeps the schedule honest)", () => {
  const config = loadConfig(undefined, {});
  const expected = cronLinesFor(config);
  assert.deepEqual(expected, ["15 14 * * *", "15 15 * * *", "15 16 * * *", "15 17 * * *"]);
  const wf = YAML.parse(readFileSync(resolve(ROOT, ".github/workflows/morning-brief.yml"), "utf8"));
  const actual = wf.on.schedule.map((s) => s.cron).sort();
  assert.deepEqual(actual, expected, "run `npm run schedule:cron` and paste the lines into the workflow");
});

test("history: recent URLs/headlines exclude old and unsent runs", () => {
  const h = { runs: [] };
  recordRun(h, { date: "2026-09-29", status: "sent", stories: [{ headline: "Yesterday story", urls: ["https://a.example/1"] }] });
  recordRun(h, { date: "2026-09-20", status: "sent", stories: [{ headline: "Old story", urls: ["https://a.example/old"] }] });
  recordRun(h, { date: "2026-09-30", status: "skipped" });
  assert.deepEqual([...recentUrls(h, "2026-09-30", 2)], ["https://a.example/1"]);
  assert.deepEqual(recentHeadlines(h, "2026-09-30", 2), [{ date: "2026-09-29", headline: "Yesterday story" }]);
  assert.equal(alreadyDelivered(h, "2026-09-30"), false);
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
});
