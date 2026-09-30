#!/usr/bin/env node
// Lightweight lint: syntax-checks every JS module, validates the config and workflow YAML,
// and makes sure no secrets/session files are tracked by git.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { loadConfig, ROOT } from "../src/config.mjs";

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (["node_modules", ".git", "out", "logs", "state"].includes(f)) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ROOT);
for (const f of files.filter((f) => f.endsWith(".mjs"))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { fail(`${f}: ${e.stderr}`); }
}
for (const f of files.filter((f) => /\.ya?ml$/.test(f))) {
  try { YAML.parse(readFileSync(f, "utf8")); } catch (e) { fail(`${f}: ${e.message}`); }
}
try { loadConfig(undefined, {}); } catch (e) { fail(e.message); }

try {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  const bad = tracked.filter((f) => /(^|\/)\.env$|creds\.json|credentials\/|^state\/|\.enc$|^logs\/|^out\//.test(f));
  if (bad.length) fail(`secret/runtime files are tracked by git: ${bad.join(", ")}`);
} catch { /* not a git checkout */ }

if (failed) process.exit(1);
console.log(`✓ lint ok (${files.filter((f) => f.endsWith(".mjs")).length} modules, config + workflows valid, no secrets tracked)`);
