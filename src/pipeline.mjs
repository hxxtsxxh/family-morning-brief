// fetch → normalize → dedupe → rank → edit (LLM) → render → validate + fact-check (retry once)
import { fetchAllSources } from "./feeds.mjs";
import { normalizeItems } from "./normalize.mjs";
import { clusterStories } from "./dedupe.mjs";
import { selectCandidates } from "./rank.mjs";
import { buildMessages, parseModelJson, resolveBrief, heuristicBrief } from "./compose.mjs";
import { chatComplete } from "./llm.mjs";
import { renderBrief, orderStories } from "./format.mjs";
import { validateBrief } from "./validate.mjs";
import { factCheck } from "./factcheck.mjs";
import { recentHeadlines, recentUrls } from "./history.mjs";

export class BriefFailure extends Error {
  constructor(message, stage) {
    super(message);
    this.stage = stage;
  }
}

export async function generateBrief(config, { log, history, todayKey, now = new Date(), noLlm = false, fetchImpl = fetch, env = process.env }) {
  const nowMs = now.getTime();
  const meta = { date: todayKey };

  // 1. Retrieve
  const { items, report } = await fetchAllSources(config.sources, { fetchImpl });
  const failed = report.filter((r) => !r.ok);
  meta.sources = { total: report.length, ok: report.length - failed.length, failed: failed.map((f) => `${f.name} [${f.category}]: ${f.error}`) };
  log.info(`retrieval: ${meta.sources.ok}/${report.length} feeds ok, ${items.length} raw items`);
  for (const f of meta.sources.failed) log.warn(`feed failed: ${f}`);
  if (meta.sources.ok < Math.ceil(report.length / 3)) {
    throw new BriefFailure(`only ${meta.sources.ok}/${report.length} feeds reachable — network problem? Not sending.`, "retrieval");
  }

  // 2. Normalize + 3. Dedupe + 4. Rank
  const { stories, dropped } = normalizeItems(items, config, nowMs);
  log.info(`normalize: ${stories.length} fresh stories (dropped ${JSON.stringify(dropped)})`);
  const clusters = clusterStories(stories);
  log.info(`dedupe: ${stories.length} stories → ${clusters.length} event clusters`);
  const recentU = recentUrls(history, todayKey, config.history.avoid_repeat_days);
  const { candidates, alreadySent } = selectCandidates(clusters, config, { recentUrls: recentU, nowMs });
  log.info(`rank: ${candidates.length} candidates for the editor (${alreadySent} clusters skipped as already sent)`);
  Object.assign(meta, { rawItems: items.length, freshStories: stories.length, clusters: clusters.length, candidates: candidates.length });
  if (candidates.length < config.length.min_stories) {
    throw new BriefFailure(`only ${candidates.length} candidate stories — not enough for a briefing`, "retrieval");
  }

  // 5. Edit
  if (noLlm) {
    const brief = heuristicBrief(candidates, config);
    brief.stories = orderStories(brief.stories, config);
    const rendered = renderBrief(brief, config, now);
    meta.editor = "heuristic-preview";
    return { brief, rendered, errors: validateBrief(brief, rendered, config), meta, candidates };
  }

  const recent = recentHeadlines(history, todayKey, config.history.avoid_repeat_days);
  const messages = buildMessages(candidates, config, { recent, nowMs });
  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let content;
    try {
      const res = await chatComplete(messages, config, { env, fetchImpl, log: log.info });
      content = res.content;
      meta.editor = `${res.provider}/${res.model}`;
    } catch (err) {
      throw new BriefFailure(err.message, "llm");
    }

    let brief;
    try {
      brief = resolveBrief(parseModelJson(content), candidates);
    } catch (err) {
      lastErrors = [`output was not valid JSON (${err.message})`];
    }
    if (brief) {
      brief.stories = orderStories(brief.stories, config);
      let rendered = renderBrief(brief, config, now);
      lastErrors = validateBrief(brief, rendered, config);
      if (!lastErrors.length) {
        log.info(`editor: attempt ${attempt} passed validation (${brief.stories.length} stories)`);
        const problems = await runFactCheck(brief, candidates, config, { env, fetchImpl, log });
        if (!problems.length) {
          meta.attempts = attempt;
          return { brief, rendered, errors: [], meta, candidates };
        }
        if (attempt === 2) {
          // Last chance: drop whatever the checker still flags, keep the rest if it's still a real briefing.
          const flagged = new Set(problems.map((p) => p.story - 1));
          brief.stories = brief.stories.filter((_, i) => !flagged.has(i));
          rendered = renderBrief(brief, config, now);
          const errors = validateBrief(brief, rendered, config);
          log.warn(`fact-check: dropped ${flagged.size} still-unsupported stories: ${problems.map((p) => `#${p.story} ${p.problem}`).join(" | ")}`);
          if (!errors.length) {
            meta.attempts = attempt;
            meta.droppedByFactCheck = flagged.size;
            return { brief, rendered, errors: [], meta, candidates };
          }
          lastErrors = [...problems.map((p) => `story ${p.story}: ${p.problem}`), ...errors];
          break;
        }
        lastErrors = problems.map((p) => `story ${p.story}: ${p.problem} — rewrite it using only facts in its candidates, or drop it`);
      }
    }
    log.warn(`editor: attempt ${attempt} failed validation:\n  - ${lastErrors.join("\n  - ")}`);
    messages.push(
      { role: "assistant", content: String(content ?? "") },
      { role: "user", content: `Your JSON has these problems:\n- ${lastErrors.join("\n- ")}\n\nFix all of them and return the complete corrected JSON object only. Keep using only the candidate ids from the list.` },
    );
  }
  throw new BriefFailure(`briefing failed validation/fact-check twice:\n  - ${lastErrors.join("\n  - ")}`, "validation");
}

/** Fact-check problems, or [] if all supported. If no model is reachable for the check, the
 *  structurally-valid brief is accepted with a warning (the editor already only saw real sources). */
async function runFactCheck(brief, candidates, config, { env, fetchImpl, log }) {
  try {
    const problems = await factCheck(brief, candidates, config, { env, fetchImpl, log: log.info });
    if (problems.length) log.warn(`fact-check: ${problems.length} problem(s):\n  - ${problems.map((p) => `story ${p.story}: ${p.problem}`).join("\n  - ")}`);
    else log.info("fact-check: all stories supported by their sources");
    return problems;
  } catch (err) {
    log.warn(`fact-check unavailable, accepting validated brief: ${String(err.message).split("\n")[0]}`);
    return [];
  }
}
