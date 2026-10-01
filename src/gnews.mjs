// Resolves Google News redirect links (news.google.com/rss/articles/…) to the publisher's
// real article URL, so the "Read more" list shows short, direct links.
//
// Uses the same two requests the Google News web page makes (article page → batchexecute).
// It is undocumented, so every failure falls back to the original (working) redirect link.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export function isGoogleNewsUrl(url) {
  return /^https:\/\/news\.google\.com\/(rss\/)?articles\//.test(String(url));
}

export async function resolveGoogleNewsUrl(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!isGoogleNewsUrl(url)) return url;
  const id = new URL(url).pathname.split("/").pop();
  const html = await (await fetchImpl(`https://news.google.com/rss/articles/${id}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) })).text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) throw new Error("article page has no decoding parameters");
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const res = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const decoded = (await res.text()).match(/\\"garturlres\\",\\"(https:[^\\"]+)\\"/)?.[1];
  if (!decoded || isGoogleNewsUrl(decoded)) throw new Error("no publisher URL in response");
  return decoded;
}

/**
 * Replaces Google News links on the final stories with direct publisher links (in place).
 * Keeps the original link on any failure. Returns { tried, resolved }.
 */
export async function resolveStoryLinks(stories, { fetchImpl = fetch, log = () => {} } = {}) {
  const targets = stories.filter((s) => isGoogleNewsUrl(s.url));
  let resolved = 0;
  await Promise.all(
    targets.map(async (s) => {
      try {
        const direct = await resolveGoogleNewsUrl(s.url, { fetchImpl });
        s.allUrls = [...new Set([...(s.allUrls ?? []), s.url, direct])];
        s.url = direct;
        resolved++;
      } catch (err) {
        log(`gnews: kept redirect link for "${s.headline}" (${err.message})`);
      }
    }),
  );
  return { tried: targets.length, resolved };
}
