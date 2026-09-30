import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CONFIG_PATH = resolve(ROOT, "config/brief.config.yaml");

/** Loads `.env` from the project root (if present) without overriding real env vars. */
export function loadDotEnv(path = resolve(ROOT, ".env")) {
  if (existsSync(path)) process.loadEnvFile(path);
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Reads and validates the brief config. Throws a single error listing every problem,
 * so a bad edit fails loudly in `npm test` / CI instead of at 7:30 AM.
 */
export function loadConfig(path = DEFAULT_CONFIG_PATH, env = process.env) {
  const raw = YAML.parse(readFileSync(path, "utf8"));
  return validateConfig(raw, env);
}

export function validateConfig(raw, env = process.env) {
  const errors = [];
  const need = (cond, msg) => cond || errors.push(msg);
  const c = structuredClone(raw ?? {});

  need(typeof c.title === "string" && c.title.trim(), "title is required");
  need(isValidTimeZone(c.timezone), `timezone "${c.timezone}" is not a valid IANA time zone`);
  need(TIME_RE.test(String(c.send_time ?? "")), `send_time must be "HH:MM" (got "${c.send_time}")`);

  c.length = { min_stories: 3, max_stories: 8, max_words: 600, max_chars: 6000, max_summary_words: 45, max_headline_chars: 90, ...c.length };
  for (const [k, v] of Object.entries(c.length)) need(Number.isInteger(v) && v > 0, `length.${k} must be a positive integer`);
  need(c.length.min_stories <= c.length.max_stories, "length.min_stories must be <= length.max_stories");
  // OpenClaw's WhatsApp textChunkLimit is set to 8000 (scripts/ci/openclaw-setup.sh), so this stays one message.
  need(c.length.max_chars <= 7500, "length.max_chars must be <= 7500 so the brief is a single WhatsApp message");

  c.links ??= "bottom";
  need(["bottom", "inline"].includes(c.links), 'links must be "bottom" or "inline"');
  c.freshness = { window_hours: 26, ...c.freshness };

  need(Array.isArray(c.categories) && c.categories.length > 0, "categories must be a non-empty list");
  const ids = new Set();
  for (const cat of c.categories ?? []) {
    need(/^[a-z_]+$/.test(cat?.id ?? ""), `category id "${cat?.id}" must be lowercase letters/underscores`);
    need(!ids.has(cat?.id), `duplicate category id "${cat?.id}"`);
    ids.add(cat?.id);
    need(cat?.label && cat?.emoji, `category "${cat?.id}" needs a label and emoji`);
    cat.max ??= 2;
  }

  need(Array.isArray(c.sources) && c.sources.length > 0, "sources must be a non-empty list");
  for (const s of c.sources ?? []) {
    need(isHttpsUrl(s?.url), `source "${s?.name}" has an invalid https url`);
    need(ids.has(s?.category), `source "${s?.name}" has unknown category "${s?.category}"`);
    s.weight ??= 1;
  }
  c.trusted_publishers ??= [];
  c.boost_keywords ??= [];
  c.exclude_patterns ??= [];
  c.interests ??= [];

  need(Array.isArray(c.llm?.providers) && c.llm.providers.length > 0, "llm.providers must be a non-empty list");
  for (const p of c.llm?.providers ?? []) {
    need(isHttpsUrl(p?.base_url) && p?.api_key_env && p?.models?.length, `llm provider "${p?.name}" needs base_url, api_key_env and models`);
  }
  c.llm = { temperature: 0.2, timeout_seconds: 120, max_candidates: 90, ...c.llm };

  c.history = { file: "state/history.json", avoid_repeat_days: 2, keep_days: 21, ...c.history };
  c.whatsapp = { group_id_env: "FAMILY_WHATSAPP_GROUP_ID", ...c.whatsapp };

  if (errors.length) throw new Error(`Invalid config:\n  - ${errors.join("\n  - ")}`);

  // Resolved, env-dependent values (not validated here: dry runs don't need a group).
  c.groupId = (env[c.whatsapp.group_id_env] ?? "").trim();
  c.historyPath = resolve(ROOT, c.history.file);
  return c;
}

/** WhatsApp group JIDs look like `120363012345678901@g.us` or `15551234567-1612345678@g.us`. */
export function isWhatsAppGroupJid(v) {
  return /^\d{5,}(-\d+)?@g\.us$/.test(String(v ?? ""));
}

export function isHttpsUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !!u.hostname.includes(".");
  } catch {
    return false;
  }
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return typeof tz === "string" && tz.length > 0;
  } catch {
    return false;
  }
}
