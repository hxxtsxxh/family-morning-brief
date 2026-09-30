// Scheduled-run gate + cron helper.
//
// GitHub Actions cron is UTC-only and can start late. The workflow therefore fires
// twice (once per DST offset) shortly before send_time; this gate lets exactly one
// run through per local day, inside a sensible morning window.
import { localDateKey, localMinutes, parseHHMM, utcOffsetMinutes } from "./time.mjs";
import { alreadyDelivered } from "./history.mjs";

export const WINDOW_BEFORE_MIN = 45; // allow a run this early (cron fires ~15 min before send_time)
export const WINDOW_AFTER_MIN = 180; // GitHub can delay schedules; don't send after mid-morning
export const CRON_LEAD_MIN = 15;

export function scheduleDecision({ now = new Date(), config, history, enabled }) {
  const today = localDateKey(now, config.timezone);
  if (!enabled) return { go: false, today, reason: "schedule is not enabled (set repo variable MORNING_BRIEF_ENABLED=true)" };
  const nowMin = localMinutes(now, config.timezone);
  const target = parseHHMM(config.send_time);
  if (nowMin < target - WINDOW_BEFORE_MIN || nowMin > target + WINDOW_AFTER_MIN) {
    return { go: false, today, reason: `outside the send window for ${config.send_time} ${config.timezone} (local time ${fmt(nowMin)})` };
  }
  if (alreadyDelivered(history, today)) return { go: false, today, reason: `already sent for ${today}` };
  return { go: true, today, reason: `in window (local ${fmt(nowMin)}), not yet sent for ${today}` };
}

/**
 * The UTC cron lines that start a run CRON_LEAD_MIN minutes before send_time under
 * both the standard and daylight-saving offsets of the configured time zone.
 */
export function cronLinesFor(config, year = new Date().getUTCFullYear()) {
  const offsets = new Set([
    utcOffsetMinutes(new Date(Date.UTC(year, 0, 15, 12)), config.timezone),
    utcOffsetMinutes(new Date(Date.UTC(year, 6, 15, 12)), config.timezone),
  ]);
  const startLocal = parseHHMM(config.send_time) - CRON_LEAD_MIN;
  return [...offsets]
    .map((off) => {
      const utc = (((startLocal - off) % 1440) + 1440) % 1440;
      return `${utc % 60} ${Math.floor(utc / 60)} * * *`;
    })
    .sort();
}

function fmt(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
