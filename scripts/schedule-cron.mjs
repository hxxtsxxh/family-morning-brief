#!/usr/bin/env node
// Prints the GitHub Actions cron lines for send_time/timezone in config/brief.config.yaml.
import { loadConfig } from "../src/config.mjs";
import { cronLinesFor, CRON_LEAD_MIN } from "../src/schedule.mjs";

const config = loadConfig(undefined, {});
console.log(`send_time ${config.send_time} ${config.timezone} → paste into .github/workflows/morning-brief.yml:\n`);
console.log("  schedule:");
for (const line of cronLinesFor(config)) console.log(`    - cron: "${line}"`);
console.log(`\n(one line per DST offset, firing ${CRON_LEAD_MIN} min early; the in-code gate sends once per day)`);
