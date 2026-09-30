#!/usr/bin/env node
// Watches the `openclaw channels login` output and publishes each new QR as a square PNG
// to the temporary `qr` branch of this (private) repo, so it can be scanned from
// https://github.com/<repo>/blob/qr/qr.png. Exits when WhatsApp is linked, the login
// process ends, or the timeout passes; the branch is deleted afterwards.
//
//   node scripts/ci/qr-publish.mjs <login-log> <login-pid> [timeoutSeconds]
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { extractLatestQr, matrixToPng } from "../../src/qr.mjs";

const [logFile, pidArg, timeoutArg = "240"] = process.argv.slice(2);
const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
if (!logFile || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.error("usage: qr-publish.mjs <login-log> <login-pid> [timeoutSeconds]  (needs GITHUB_TOKEN, GITHUB_REPOSITORY)");
  process.exit(2);
}
const remote = `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`;
const url = `https://github.com/${GITHUB_REPOSITORY}/blob/qr/qr.png`;
const dir = mkdtempSync(join(tmpdir(), "qr-"));
const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
git("init", "-q", "-b", "qr");
git("config", "user.name", "morning-brief-bot");
git("config", "user.email", "actions@users.noreply.github.com");

const linked = () => {
  const base = join(homedir(), ".openclaw/credentials/whatsapp");
  return existsSync(base) && readdirSync(base).some((a) => existsSync(join(base, a, "creds.json")));
};
const alive = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};
const time = () => new Date().toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour12: false });

console.log(`\n📱 Open this link on your laptop (signed in to GitHub):\n\n    ${url}\n`);
console.log("Then on your phone: WhatsApp → Settings → Linked devices → Link a device, and scan it.");
console.log("The QR changes every ~20 s — when a new one is announced below, refresh the page.\n");

let last = "";
let n = 0;
let diagnosed = false;
const started = Date.now();
const deadline = Date.now() + Number(timeoutArg) * 1000;
try {
  while (Date.now() < deadline) {
    if (linked()) {
      console.log(`✅ ${time()} WhatsApp linked.`);
      break;
    }
    if (pidArg && !alive(pidArg)) {
      console.log(`${time()} login process ended.`);
      break;
    }
    const text = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    const m = extractLatestQr(text);
    const key = m ? m.map((r) => r.map((x) => (x ? 1 : 0)).join("")).join("") : "";
    if (m && key !== last) {
      last = key;
      n++;
      writeFileSync(join(dir, "qr.png"), matrixToPng(m, 10));
      writeFileSync(join(dir, "README.md"), `Temporary WhatsApp login QR #${n} (${time()} PT). Deleted automatically after login.\n\n![QR](qr.png)\n`);
      git("add", "-A");
      git("commit", "-q", ...(n > 1 ? ["--amend"] : []), "-m", `QR #${n}`); // keep a single commit
      git("push", "-q", "--force", remote, "qr:qr");
      console.log(`🆕 ${time()} QR #${n} is ready — refresh ${url}`);
    }
    if (!n && !diagnosed && Date.now() - started > 45000) {
      diagnosed = true; // help debugging if the CLI's output format ever changes
      const lines = text.split(/\n/);
      const qrish = lines.filter((l) => /[▀▄█]/.test(l)).slice(0, 3).map((l) => JSON.stringify(l.slice(0, 60)));
      console.log(`⚠️ no QR recognised after 45 s. log bytes=${text.length}, lines=${lines.length}, block-char lines=${lines.filter((l) => /[▀▄█]/.test(l)).length}`);
      console.log(`   non-QR tail: ${JSON.stringify(lines.filter((l) => !/[▀▄█]/.test(l)).slice(-8).join(" | ").slice(0, 600))}`);
      if (qrish.length) console.log(`   first QR-like lines: ${qrish.join("  ")}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
} finally {
  try {
    git("push", "-q", remote, "--delete", "qr");
    console.log("(temporary qr branch deleted)");
  } catch {
    /* branch was never created */
  }
}
process.exit(linked() ? 0 : 1);
