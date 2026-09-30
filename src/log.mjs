// One-line, timestamped logs to stdout (visible in GitHub Actions) and logs/<date>.log locally.
// Never pass secrets here: API keys are redacted in llm.mjs and WhatsApp auth is never read.
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.mjs";

export function createLogger({ toFile = true } = {}) {
  const dir = resolve(ROOT, "logs");
  const file = resolve(dir, `${new Date().toISOString().slice(0, 10)}.log`);
  if (toFile) mkdirSync(dir, { recursive: true });
  const write = (level, msg) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}`;
    (level === "ERROR" ? console.error : console.log)(line);
    if (toFile) appendFileSync(file, `${line}\n`);
  };
  return {
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
  };
}
