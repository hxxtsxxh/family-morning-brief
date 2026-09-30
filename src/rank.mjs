// Heuristic pre-ranking. The editor model makes the final call on importance; this
// just decides which clusters it gets to see (fits the prompt budget, keeps every
// section represented, removes things already sent).

export function scoreCluster(cluster, config, nowMs = Date.now()) {
  const lead = cluster.lead;
  const text = `${lead.title} ${lead.summary}`.toLowerCase();
  const maxWeight = Math.max(...cluster.items.map((i) => i.weight));
  const ageH = (nowMs - cluster.freshMs) / 3.6e6;

  let score = 0;
  score += Math.min(cluster.coverage, 5) * 3; // independent publishers = importance + corroboration
  score += maxWeight * 2;
  score += Math.max(0, 6 - ageH / 4); // up to +6 for very fresh
  const boosts = config.boost_keywords.filter((k) => new RegExp(`\\b${escapeRe(k.toLowerCase())}\\b`).test(text)).length;
  score += Math.min(boosts, 3) * 1.5;
  if (lead.updatedAfterPublish) score += 1;
  if (!lead.summary && lead.googleNews && cluster.coverage === 1) score -= 1; // headline-only single source
  return Math.round(score * 10) / 10;
}

/**
 * Drops clusters already sent recently (exact URL match), scores the rest and picks up to
 * `max_candidates`, reserving a fair share for each section so niche sections (sports,
 * interesting) aren't crowded out by world news.
 */
export function selectCandidates(clusters, config, { recentUrls = new Set(), nowMs = Date.now() } = {}) {
  const fresh = clusters.filter((c) => !c.items.some((i) => recentUrls.has(i.url)));
  const alreadySent = clusters.length - fresh.length;
  for (const c of fresh) c.score = scoreCluster(c, config, nowMs);
  fresh.sort((a, b) => b.score - a.score);

  const max = config.llm.max_candidates;
  const perCat = Math.max(4, Math.floor(max / config.categories.length / 1.5));
  const chosen = new Set();
  for (const cat of config.categories) {
    fresh.filter((c) => c.categories[0] === cat.id).slice(0, perCat).forEach((c) => chosen.add(c));
  }
  for (const c of fresh) {
    if (chosen.size >= max) break;
    chosen.add(c);
  }
  const candidates = [...chosen].sort((a, b) => b.score - a.score).slice(0, max);
  candidates.forEach((c, i) => (c.id = `c${i + 1}`)); // stable, compact ids for the prompt
  return { candidates, alreadySent };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
