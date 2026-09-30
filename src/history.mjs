// Tiny JSON history: which days were sent (prevents duplicate sends) and which
// headlines/links went out recently (avoids repeating yesterday's stories).
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export function loadHistory(path) {
  if (!existsSync(path)) return { version: 1, runs: [] };
  try {
    const h = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(h?.runs) ? h : { version: 1, runs: [] };
  } catch {
    return { version: 1, runs: [] };
  }
}

export function saveHistory(path, history, { keepDays = 21, todayKey } = {}) {
  const cutoff = todayKey ? shiftDate(todayKey, -keepDays) : "";
  const runs = history.runs.filter((r) => !cutoff || r.date >= cutoff);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, runs }, null, 2)}\n`);
  renameSync(tmp, path);
}

export function recordRun(history, entry) {
  history.runs.push({ at: new Date().toISOString(), ...entry });
  return history;
}

/** True if a real send was attempted for `dateKey` (sent, or failed mid-send — never auto-retry those). */
export function alreadyDelivered(history, dateKey) {
  return history.runs.some((r) => r.date === dateKey && (r.status === "sent" || r.status === "send_error"));
}

function recentRuns(history, todayKey, days) {
  const from = shiftDate(todayKey, -days);
  return history.runs.filter((r) => r.status === "sent" && r.date >= from && r.date <= todayKey);
}

export function recentHeadlines(history, todayKey, days) {
  return recentRuns(history, todayKey, days).flatMap((r) => (r.stories ?? []).map((s) => ({ date: r.date, headline: s.headline })));
}

export function recentUrls(history, todayKey, days) {
  return new Set(recentRuns(history, todayKey, days).flatMap((r) => (r.stories ?? []).flatMap((s) => s.urls ?? [])));
}

/** "2026-09-30" ± n days. */
export function shiftDate(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
