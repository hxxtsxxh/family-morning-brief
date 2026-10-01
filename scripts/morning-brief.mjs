#!/usr/bin/env node
// ☀️ Morning Chai — generate (and optionally send) today's family briefing.
//
//   node scripts/morning-brief.mjs --dry-run           generate + print + save, never sends (default)
//   node scripts/morning-brief.mjs --dry-run --no-llm  offline preview without the editor model
//   node scripts/morning-brief.mjs --send              generate + send ONE brief to the family group
//   node scripts/morning-brief.mjs --scheduled         what the 7:30 automation runs (gated, sends)
//   node scripts/morning-brief.mjs --check-schedule    only decide whether a scheduled run should proceed
//
// Safety: MORNING_BRIEF_DRY_RUN=true forces dry-run whatever the flags say. A manual --send
// refuses if today's brief already went out, unless --force is given.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv, ROOT } from "../src/config.mjs";
import { createLogger } from "../src/log.mjs";
import { localDateKey } from "../src/time.mjs";
import { loadHistory, saveHistory, recordRun, alreadyDelivered } from "../src/history.mjs";
import { scheduleDecision } from "../src/schedule.mjs";
import { generateBrief, BriefFailure } from "../src/pipeline.mjs";
import { sendToFamilyGroup, assertSendableTarget, isPreflight } from "../src/deliver.mjs";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    send: { type: "boolean", default: false },
    scheduled: { type: "boolean", default: false },
    "check-schedule": { type: "boolean", default: false },
    "no-llm": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

loadDotEnv();
const log = createLogger({ toFile: !process.env.GITHUB_ACTIONS });
const config = loadConfig();
const now = new Date();
const today = localDateKey(now, config.timezone);
const history = loadHistory(config.historyPath);
const envTrue = (v) => /^(1|true|yes|on)$/i.test(String(v ?? "").trim());

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}
function persist(entry) {
  recordRun(history, { date: today, ...entry });
  saveHistory(config.historyPath, history, { keepDays: config.history.keep_days, todayKey: today });
}

async function main() {
  const forcedDry = envTrue(process.env.MORNING_BRIEF_DRY_RUN);
  const wantsSend = (args.send || args.scheduled) && !args["dry-run"];
  const willSend = wantsSend && !forcedDry && !args["no-llm"];
  const mode = args["check-schedule"] ? "check-schedule" : args.scheduled ? "scheduled" : willSend ? "send" : "dry-run";
  log.info(`run start: mode=${mode} local_date=${today} tz=${config.timezone}${forcedDry && wantsSend ? " (MORNING_BRIEF_DRY_RUN=true → not sending)" : ""}`);

  // Gate for the automation (also used by the workflow's cheap first step).
  if (args.scheduled || args["check-schedule"]) {
    const d = scheduleDecision({ now, config, history, enabled: envTrue(process.env.MORNING_BRIEF_ENABLED) });
    log.info(`schedule gate: ${d.go ? "GO" : "SKIP"} — ${d.reason}`);
    setOutput("go", String(d.go));
    if (!d.go || args["check-schedule"]) return 0;
  }

  if (willSend) {
    assertSendableTarget(config.groupId); // fail before spending time/quota
    if (!args.scheduled && alreadyDelivered(history, today) && !args.force) {
      log.error(`today's brief (${today}) was already sent — not sending again. Use --force to override.`);
      return 1;
    }
  }

  let result;
  try {
    result = await generateBrief(config, { log, history, todayKey: today, now, noLlm: args["no-llm"] });
  } catch (err) {
    const stage = err instanceof BriefFailure ? err.stage : "unexpected";
    log.error(`brief generation failed at ${stage}: ${err.message}`);
    summary(`### ❌ Morning brief not sent\n\nStage: \`${stage}\`\n\n\`\`\`\n${err.message}\n\`\`\``);
    if (willSend && !isPreflight()) persist({ status: "skipped", mode, reason: `${stage}: ${err.message.slice(0, 300)}` });
    return 1;
  }

  const { brief, rendered, errors, meta } = result;
  const outDir = resolve(ROOT, "out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `brief-${today}.txt`), `${rendered.text}\n`);
  writeFileSync(resolve(outDir, `brief-${today}.json`), `${JSON.stringify({ meta, brief }, null, 2)}\n`);

  const words = rendered.bodyText.split(/\s+/).filter(Boolean).length;
  log.info(`brief ready: ${brief.stories.length} stories, ~${words} words, ${rendered.text.length} chars, editor=${meta.editor}`);
  console.log(`\n${"─".repeat(60)}\n${rendered.text}\n${"─".repeat(60)}\n`);
  summary(`### ☀️ Morning brief (${mode})\n\n${brief.stories.length} stories · ~${words} words · ${rendered.text.length} chars · editor \`${meta.editor}\` · feeds ${meta.sources.ok}/${meta.sources.total} · ${meta.freshStories} stories → ${meta.clusters} clusters → ${meta.candidates} candidates\n\n\`\`\`\n${rendered.text}\n\`\`\``);

  if (errors.length) log.warn(`preview has validation warnings:\n  - ${errors.join("\n  - ")}`);
  if (!willSend) {
    log.info(`dry run: nothing sent. Saved to out/brief-${today}.txt`);
    return 0;
  }

  if (isPreflight()) {
    const res = await sendToFamilyGroup(rendered.text, config).catch((err) => {
      log.error(`preflight FAILED: ${err.message}`);
      return null;
    });
    if (!res) return 1;
    log.info(`preflight OK: OpenClaw accepted the WhatsApp payload for ${res?.payload?.to ?? config.groupId} (dryRun=${res?.dryRun}). Nothing was delivered or recorded.`);
    summary("\n🧪 Preflight OK — OpenClaw accepted the payload; nothing was delivered.");
    return 0;
  }

  try {
    const res = await sendToFamilyGroup(rendered.text, config);
    const id = res?.messageId ?? res?.result?.messageId ?? res?.id ?? "";
    log.info(`whatsapp delivery: OK${id ? ` (message id ${id})` : ""}`);
    persist({ status: "sent", mode, stories: brief.stories.map((s) => ({ headline: s.headline, urls: [...new Set([s.url, ...(s.allUrls ?? [])])] })) });
    summary("\n✅ Delivered to the family WhatsApp group.");
    return 0;
  } catch (err) {
    log.error(`whatsapp delivery FAILED: ${err.message}`);
    // Recorded as send_error: the automatic second attempt will NOT retry, to avoid a double post.
    persist({ status: "send_error", mode, reason: err.message.slice(0, 300) });
    summary(`\n❌ WhatsApp delivery failed: ${err.message}`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log.error(`fatal: ${err?.stack ?? err}`);
    process.exit(1);
  },
);
