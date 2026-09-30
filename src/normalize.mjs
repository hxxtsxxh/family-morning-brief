// Turns raw feed items into clean, comparable stories and drops the ones we never want.
import { isHttpsUrl } from "./config.mjs";

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  return decodeEntities(String(s ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes tracking params/fragments so the same article from two feeds compares equal. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|at_|cmp|ito|ocid|fbclid|gclid|mc_|ref$|src$|CMP$)/i.test(k)) u.searchParams.delete(k);
    }
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return "";
  }
}

/** Google News titles end in " - Publisher"; BBC-style ones sometimes in " | BBC News". */
export function cleanTitle(title, publisher) {
  let t = stripHtml(title);
  if (publisher) {
    const esc = publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s+[-–—|]\\s+${esc}\\s*$`, "i"), "");
  }
  return t.replace(/\s+[|]\s+[^|]{2,40}$/, "").trim();
}

function parseDate(raw) {
  if (!raw) return NaN;
  const ms = Date.parse(String(raw).trim());
  return Number.isFinite(ms) ? ms : NaN;
}

function matchesPublisher(publisher, trusted) {
  const p = publisher.toLowerCase();
  return trusted.some((t) => {
    const tt = t.toLowerCase();
    return p === tt || p.startsWith(`${tt} `) || p.includes(tt);
  });
}

/**
 * Cleans, filters and tags items. Returns { stories, dropped } where dropped counts
 * each reason (useful in logs when a day looks thin).
 */
export function normalizeItems(rawItems, config, nowMs = Date.now()) {
  const windowMs = config.freshness.window_hours * 3.6e6;
  const exclude = config.exclude_patterns.map((p) => p.toLowerCase());
  const dropped = { noLink: 0, stale: 0, noDate: 0, excluded: 0, untrustedPublisher: 0, duplicateUrl: 0 };
  const seenUrls = new Set();
  const stories = [];

  for (const r of rawItems) {
    const publisher = canonicalPublisher(stripHtml(r.publisher) || r.sourceName, config.trusted_publishers);
    const url = canonicalUrl(r.link);
    if (!url || !isHttpsUrl(url)) { dropped.noLink++; continue; }

    const title = cleanTitle(r.title, publisher);
    if (title.length < 12) { dropped.noLink++; continue; }

    if (r.googleNews && !matchesPublisher(publisher, config.trusted_publishers)) { dropped.untrustedPublisher++; continue; }

    const published = parseDate(r.publishedRaw);
    const updated = parseDate(r.updatedRaw);
    const freshMs = Math.max(Number.isFinite(published) ? published : -Infinity, Number.isFinite(updated) ? updated : -Infinity);
    if (!Number.isFinite(freshMs)) { dropped.noDate++; continue; }
    if (nowMs - freshMs > windowMs || freshMs - nowMs > 3.6e6) { dropped.stale++; continue; }

    const summary = r.googleNews ? "" : stripHtml(r.description).slice(0, 400);
    const haystack = `${title} ${summary}`.toLowerCase();
    if (exclude.some((p) => haystack.includes(p)) || /\/(opinion|commentisfree|podcasts?|video|live)\//i.test(url)) { dropped.excluded++; continue; }

    if (seenUrls.has(url)) { dropped.duplicateUrl++; continue; }
    seenUrls.add(url);

    stories.push({
      title,
      summary,
      url,
      publisher,
      category: r.category,
      weight: r.weight,
      googleNews: r.googleNews,
      freshMs,
      updatedAfterPublish: Number.isFinite(updated) && Number.isFinite(published) && updated - published > 3 * 3.6e6,
    });
  }
  return { stories, dropped };
}

/**
 * Short, consistent publisher names: "ABC News - Breaking News, Latest…" → "ABC News",
 * "cnn.com" → "CNN", "BBC News" → "BBC", "Associated Press" → "AP". Uses the longest
 * matching trusted publisher name so "ESPNcricinfo" doesn't collapse to "ESPN".
 */
export function canonicalPublisher(p, trusted = []) {
  let name = String(p).replace(/\s*\(via Google News\)\s*/i, "").replace(/\s+[-–|]\s+.*$/, "").trim();
  const lower = name.toLowerCase();
  const match = trusted
    .filter((t) => lower === t.toLowerCase() || lower.includes(t.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (match) name = match;
  if (/^(the )?associated press$|^ap news$/i.test(name)) return "AP";
  return name;
}
