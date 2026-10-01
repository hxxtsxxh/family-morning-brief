import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, fetchAllSources } from "../src/feeds.mjs";
import { normalizeItems, canonicalUrl, cleanTitle, canonicalPublisher } from "../src/normalize.mjs";
import { sendToFamilyGroup, DeliveryError } from "../src/deliver.mjs";
import { testConfig, NOW } from "./helpers.mjs";

const hoursAgo = (h) => new Date(NOW.getTime() - h * 3.6e6).toUTCString();

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title><![CDATA[Parliament approves new rail budget &amp; freight corridor]]></title>
  <link>https://www.thehindu.com/news/national/rail-budget/article1.ece?utm_source=rss</link>
  <description><![CDATA[<p>The budget adds &#8377;2 lakh crore for rail.</p>]]></description>
  <pubDate>${hoursAgo(3)}</pubDate></item>
<item><title>Old story from last week about something</title><link>https://www.thehindu.com/old</link><pubDate>${hoursAgo(200)}</pubDate></item>
<item><title>Opinion: Why the budget matters so much</title><link>https://www.thehindu.com/opinion/x</link><pubDate>${hoursAgo(2)}</pubDate></item>
</channel></rss>`;

const GOOGLE_NEWS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Fed holds rates steady as inflation cools - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link>
  <source url="https://www.reuters.com">Reuters</source><pubDate>${hoursAgo(1)}</pubDate><description>&lt;a href="x"&gt;junk&lt;/a&gt;</description></item>
<item><title>Ten celebrity outfits you must see - Random Site</title><link>https://news.google.com/rss/articles/def</link>
  <source url="https://random.example">Random Site</source><pubDate>${hoursAgo(1)}</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>New chip doubles battery life in laptops</title><link rel="alternate" href="https://www.theverge.com/chip"/>
<published>${new Date(NOW.getTime() - 40 * 3.6e6).toISOString()}</published><updated>${new Date(NOW.getTime() - 2 * 3.6e6).toISOString()}</updated>
<summary>A new chip design.</summary></entry></feed>`;

test("parses RSS (CDATA, entities, HTML descriptions) and Atom feeds", () => {
  const rss = parseFeed(RSS, { name: "The Hindu", category: "india", weight: 2 });
  assert.equal(rss.length, 3);
  // CDATA is literal, so feeds that double-escape keep "&amp;" here; normalize decodes it.
  assert.match(rss[0].title, /^Parliament approves new rail budget &(amp;)? freight corridor$/);
  assert.equal(rss[0].link, "https://www.thehindu.com/news/national/rail-budget/article1.ece?utm_source=rss");
  const atom = parseFeed(ATOM, { name: "The Verge", category: "tech_business", weight: 2 });
  assert.equal(atom[0].link, "https://www.theverge.com/chip");
});

test("normalize: drops stale, opinion and untrusted Google News items; keeps updated older stories", () => {
  const config = testConfig();
  const raw = [
    ...parseFeed(RSS, { name: "The Hindu", category: "india", weight: 2 }),
    ...parseFeed(GOOGLE_NEWS, { name: "Reuters (via Google News)", category: "world", weight: 3, google_news: true }),
    ...parseFeed(ATOM, { name: "The Verge", category: "tech_business", weight: 2 }),
  ];
  const { stories, dropped } = normalizeItems(raw, config, NOW.getTime());
  assert.deepEqual(stories.map((s) => s.title), [
    "Parliament approves new rail budget & freight corridor",
    "Fed holds rates steady as inflation cools",
    "New chip doubles battery life in laptops",
  ]);
  assert.equal(stories[0].url, "https://www.thehindu.com/news/national/rail-budget/article1.ece", "tracking params removed");
  assert.equal(stories[0].summary, "The budget adds ₹2 lakh crore for rail.");
  assert.equal(stories[1].summary, "", "Google News descriptions are junk and dropped");
  assert.equal(stories[1].publisher, "Reuters");
  assert.equal(dropped.stale, 1);
  assert.equal(dropped.excluded, 1);
  assert.equal(dropped.untrustedPublisher, 1);
});

test("one failing feed does not break retrieval", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("broken")) throw new Error("ECONNRESET");
    return new Response(RSS, { status: 200 });
  };
  const { items, report } = await fetchAllSources(
    [
      { name: "Good", url: "https://good.example/rss", category: "india" },
      { name: "Broken", url: "https://broken.example/rss", category: "world" },
    ],
    { fetchImpl: fakeFetch },
  );
  assert.equal(items.length, 3);
  assert.deepEqual(report.map((r) => r.ok), [true, false]);
  assert.match(report[1].error, /ECONNRESET/);
});

test("helpers: canonical URLs, titles, publishers", () => {
  assert.equal(canonicalUrl("http://www.bbc.com/news/x/?utm_medium=rss&id=4#top"), "https://www.bbc.com/news/x?id=4");
  assert.equal(canonicalUrl("https://www.aljazeera.com/news/a?traffic_source=rss"), "https://www.aljazeera.com/news/a");
  assert.equal(cleanTitle("Stocks rally - The Economic Times", "The Economic Times"), "Stocks rally");
  const trusted = ["ESPN", "ESPNcricinfo", "ABC News", "CNN", "BBC", "Associated Press"];
  assert.equal(canonicalPublisher("ESPNcricinfo", trusted), "ESPNcricinfo");
  assert.equal(canonicalPublisher("ABC News - Breaking News, Latest News and Videos", trusted), "ABC News");
  assert.equal(canonicalPublisher("cnn.com", trusted), "CNN");
  assert.equal(canonicalPublisher("Associated Press", trusted), "AP");
});

test("delivery refuses anything but the configured WhatsApp group", async () => {
  const neverCalled = () => assert.fail("openclaw must not be invoked");
  for (const bad of ["", "+15551234567", "someone@s.whatsapp.net"]) {
    const config = testConfig({ groupId: bad });
    await assert.rejects(() => sendToFamilyGroup("hi", config, { execFileImpl: neverCalled }), DeliveryError);
  }
  await assert.rejects(() => sendToFamilyGroup("   ", testConfig(), { execFileImpl: neverCalled }), /empty message/);
});

test("delivery calls `openclaw message send` with exactly the configured group", async () => {
  let seen;
  const fakeExec = (bin, args, opts, cb) => {
    seen = { bin, args };
    cb(null, JSON.stringify({ ok: true, messageId: "ABC123" }), "");
  };
  const res = await sendToFamilyGroup("☀️ hello", testConfig(), { execFileImpl: fakeExec });
  assert.equal(res.messageId, "ABC123");
  assert.equal(seen.bin, "openclaw");
  assert.deepEqual(seen.args, ["message", "send", "--channel", "whatsapp", "--target", "120363012345678901@g.us", "--message", "☀️ hello", "--json"]);
});

test("delivery surfaces OpenClaw failures (e.g. WhatsApp disconnected)", async () => {
  const fakeExec = (bin, args, opts, cb) => {
    const err = Object.assign(new Error("exit 1"), { code: 1 });
    cb(err, JSON.stringify({ ok: false, error: { message: "No active WhatsApp listener" } }), "");
  };
  await assert.rejects(() => sendToFamilyGroup("hi", testConfig(), { execFileImpl: fakeExec }), /No active WhatsApp listener/);
});

test("preflight mode passes --dry-run to OpenClaw so nothing is delivered", async () => {
  let seen;
  const fakeExec = (bin, args, opts, cb) => {
    seen = args;
    cb(null, JSON.stringify({ action: "send", dryRun: true, payload: { to: "120363012345678901@g.us" } }), "");
  };
  process.env.OPENCLAW_SEND_DRY_RUN = "true";
  try {
    const res = await sendToFamilyGroup("hi", testConfig(), { execFileImpl: fakeExec });
    assert.equal(res.dryRun, true);
    assert.equal(seen.at(-1), "--dry-run");
  } finally {
    delete process.env.OPENCLAW_SEND_DRY_RUN;
  }
});
