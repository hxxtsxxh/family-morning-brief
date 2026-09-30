// Lightweight duplicate detection: many publishers → one event.
//
// Stage 1 (here, deterministic): headline token similarity + shared proper nouns,
// merged with union-find. Deliberately conservative — a missed merge is cheap
// because stage 2 (the editor model) may group several candidate ids into one
// story, and validation rejects near-identical headlines in the final output.

const STOPWORDS = new Set(
  ("a an the and or but of in on at to for from by with as is are was were be been being it its this that these those " +
    "after before over under into about amid against than then there their they them he she his her we our you your " +
    "says said say new news latest update updates report reports amid will would could can may might has have had not no " +
    "up out off more most just what who why how when where which while live today").split(" "),
);

/** Normalized content tokens of a headline (lowercased, light stemming, no stopwords). */
export function tokens(title) {
  return String(title)
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Capitalized words / numbers from the original headline — cheap "entities". */
export function entities(title) {
  const words = String(title).replace(/['’]s\b/g, "").match(/\b[\p{Lu}][\p{L}\p{N}.-]+|\b\d[\d,.]*\b/gu) ?? [];
  return words.map((w) => w.toLowerCase().replace(/[.,]$/, "")).filter((w) => !STOPWORDS.has(w));
}

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function overlap(a, b) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return { inter, coef: inter / Math.max(1, Math.min(A.size, B.size)) };
}

/** True when two headlines very likely describe the same event. */
export function isSameEvent(titleA, titleB) {
  const ta = tokens(titleA), tb = tokens(titleB);
  if (jaccard(ta, tb) >= 0.5) return true;
  const t = overlap(ta, tb);
  const e = overlap(entities(titleA), entities(titleB));
  // Share most content words AND at least two named things (e.g. "Modi", "Trump", "tariffs").
  return t.inter >= 3 && t.coef >= 0.6 && e.inter >= 2;
}

/**
 * Groups stories into event clusters. Each cluster: { id, items, lead, publishers, categories,
 * coverage, freshMs }. `lead` is the most authoritative (then freshest) item.
 */
export function clusterStories(stories) {
  const parent = stories.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const toks = stories.map((s) => tokens(s.title));

  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      if (find(i) === find(j)) continue;
      // Quick reject: need at least 2 shared tokens before the fuller check.
      if (overlap(toks[i], toks[j]).inter < 2) continue;
      if (isSameEvent(stories[i].title, stories[j].title)) parent[find(j)] = find(i);
    }
  }

  const groups = new Map();
  stories.forEach((s, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  });

  return [...groups.values()].map((items, idx) => {
    items.sort((a, b) => b.weight - a.weight || Number(a.googleNews) - Number(b.googleNews) || b.freshMs - a.freshMs);
    const publishers = [...new Set(items.map((i) => i.publisher))];
    const catCounts = {};
    for (const it of items) catCounts[it.category] = (catCounts[it.category] ?? 0) + 1;
    return {
      id: `c${idx + 1}`,
      items,
      lead: items[0],
      publishers,
      categories: Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]),
      coverage: publishers.length,
      freshMs: Math.max(...items.map((i) => i.freshMs)),
    };
  });
}
