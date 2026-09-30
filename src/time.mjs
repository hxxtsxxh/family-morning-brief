// Timezone helpers. Every "today"/"morning" decision goes through these so the
// brief follows America/Los_Angeles (or whatever config.timezone says), DST included.

/** Local calendar/clock parts of `date` in `timeZone`. */
export function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

/** "2026-09-30" for `date` in `timeZone`. */
export function localDateKey(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "Wednesday, September 30" for `date` in `timeZone`. */
export function prettyDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(date);
}

/** Minutes east of UTC for `timeZone` at `date` (e.g. -420 for PDT). */
export function utcOffsetMinutes(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** Minutes since local midnight. */
export function localMinutes(date, timeZone) {
  const p = localParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function parseHHMM(s) {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + m;
}

/** "5h ago" style age, used in the candidate list shown to the model. */
export function ageLabel(fromMs, nowMs) {
  const h = Math.max(0, (nowMs - fromMs) / 3.6e6);
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : `${Math.round(h)}h ago`;
}
