#!/usr/bin/env node
// Prints `openclaw directory groups list --json` output as a readable table so you can
// copy your family group's JID into the FAMILY_WHATSAPP_GROUP_ID repository variable.
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const list = Array.isArray(raw) ? raw : raw.groups ?? raw.entries ?? raw.results ?? raw.items ?? [];
const rows = list
  .map((g) => ({ name: g.name ?? g.subject ?? g.title ?? g.label ?? "(no name)", id: g.id ?? g.jid ?? g.target ?? "" }))
  .filter((g) => String(g.id).endsWith("@g.us"))
  .sort((a, b) => a.name.localeCompare(b.name));

if (!rows.length) {
  console.log("No groups found. Raw output:\n" + JSON.stringify(raw, null, 2).slice(0, 3000));
  process.exit(0);
}
console.log(`### WhatsApp groups (${rows.length})\n`);
console.log("| Group name | FAMILY_WHATSAPP_GROUP_ID |\n|---|---|");
for (const r of rows) console.log(`| ${r.name.replace(/\|/g, "/")} | \`${r.id}\` |`);
