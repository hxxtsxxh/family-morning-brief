// News retrieval: free public RSS/Atom feeds, fetched concurrently. One broken
// feed never breaks the run; it is logged and skipped.
import { XMLParser } from "fast-xml-parser";

const USER_AGENT = "Mozilla/5.0 (compatible; FamilyMorningBrief/1.0; +https://github.com/)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

/**
 * Fetches every configured source. Resolves to { items, report } where report has one
 * row per source ({ name, ok, count, error }).
 */
export async function fetchAllSources(sources, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const results = await Promise.allSettled(sources.map((s) => fetchSource(s, { fetchImpl, timeoutMs })));
  const items = [];
  const report = results.map((r, i) => {
    const s = sources[i];
    if (r.status === "fulfilled") {
      items.push(...r.value);
      return { name: s.name, category: s.category, ok: true, count: r.value.length };
    }
    return { name: s.name, category: s.category, ok: false, count: 0, error: String(r.reason?.message ?? r.reason) };
  });
  return { items, report };
}

async function fetchSource(source, { fetchImpl, timeoutMs }) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl(source.url, {
        headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFeed(await res.text(), source);
    } catch (err) {
      lastErr = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

/** Parses RSS 2.0 or Atom XML into raw items tagged with their source. */
export function parseFeed(xml, source) {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? [];
  const atomEntries = doc?.feed?.entry ?? [];
  const out = [];

  for (const it of rssItems) {
    out.push({
      title: text(it.title),
      description: text(it.description ?? it["content:encoded"]),
      link: rssLink(it),
      publisher: text(it.source) || source.name,
      publishedRaw: text(it.pubDate ?? it["dc:date"]),
      updatedRaw: text(it["atom:updated"]),
    });
  }
  for (const e of atomEntries) {
    out.push({
      title: text(e.title),
      description: text(e.summary ?? e.content),
      link: atomLink(e),
      publisher: source.name,
      publishedRaw: text(e.published),
      updatedRaw: text(e.updated),
    });
  }
  return out.map((r) => ({
    ...r,
    sourceName: source.name,
    category: source.category,
    weight: source.weight ?? 1,
    googleNews: !!source.google_news,
  }));
}

function text(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v["#text"] ?? "");
  return "";
}

function rssLink(it) {
  const links = it.link ?? [];
  for (const l of links) {
    const t = text(l) || l?.["@href"];
    if (t && /^https?:\/\//.test(t)) return t.trim();
  }
  const guid = text(it.guid);
  return /^https?:\/\//.test(guid) ? guid : "";
}

function atomLink(e) {
  const links = e.link ?? [];
  const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
  return alt?.["@href"] ?? "";
}
