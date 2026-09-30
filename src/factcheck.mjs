// Second-opinion check: an independent model call compares each written summary with
// the source excerpts it cites and flags unsupported or mixed-up claims.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.mjs";
import { chatComplete } from "./llm.mjs";
import { parseModelJson } from "./compose.mjs";

const PROMPT = () => readFileSync(resolve(ROOT, "prompts/fact-check.md"), "utf8");

export function buildFactCheckMessages(brief, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const blocks = brief.stories.map((s, i) => {
    const items = s.candidateIds.flatMap((id) => byId.get(id)?.items ?? []).slice(0, 5);
    const excerpts = items.map((it) => `  - [${it.publisher}] ${it.title}${it.summary ? ` — ${it.summary.slice(0, 300)}` : ""}`).join("\n");
    return `STORY ${i + 1}\nHeadline: ${s.headline}\nSummary: ${s.summary}\nSOURCE EXCERPTS:\n${excerpts || "  (none)"}`;
  });
  return [
    { role: "system", content: PROMPT() },
    { role: "user", content: blocks.join("\n\n") },
  ];
}

/** Returns [{ story: <1-based index>, problem }]. Throws LlmUnavailableError if no model answers. */
export async function factCheck(brief, candidates, config, opts = {}) {
  const res = await chatComplete(buildFactCheckMessages(brief, candidates), config, opts);
  const parsed = parseModelJson(res.content);
  const n = brief.stories.length;
  return (Array.isArray(parsed?.problems) ? parsed.problems : [])
    .map((p) => ({ story: Number(p?.story), problem: String(p?.problem ?? "").trim() }))
    .filter((p) => Number.isInteger(p.story) && p.story >= 1 && p.story <= n && p.problem);
}
