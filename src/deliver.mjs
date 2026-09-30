// WhatsApp delivery through OpenClaw's supported channel:
//   openclaw message send --channel whatsapp --target <group JID> --message <text> --json
// The only possible destination is the configured family group.
import { execFile } from "node:child_process";
import { isWhatsAppGroupJid } from "./config.mjs";

export class DeliveryError extends Error {}

export function assertSendableTarget(groupId) {
  if (!groupId) throw new DeliveryError("FAMILY_WHATSAPP_GROUP_ID is not set — refusing to send");
  if (!isWhatsAppGroupJid(groupId)) throw new DeliveryError(`FAMILY_WHATSAPP_GROUP_ID "${groupId}" is not a WhatsApp group JID (…@g.us) — refusing to send`);
}

export async function sendToFamilyGroup(text, config, { execFileImpl = execFile, bin = process.env.OPENCLAW_BIN || "openclaw", timeoutMs = 180000 } = {}) {
  assertSendableTarget(config.groupId);
  if (!text?.trim()) throw new DeliveryError("refusing to send an empty message");
  const args = ["message", "send", "--channel", "whatsapp", "--target", config.groupId, "--message", text, "--json"];
  if (isPreflight()) args.push("--dry-run"); // OpenClaw validates + prints the payload, delivers nothing
  return new Promise((resolve, reject) => {
    execFileImpl(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout ?? "").trim();
      let json = null;
      try {
        json = out ? JSON.parse(out.slice(out.indexOf("{"))) : null;
      } catch {
        /* non-JSON output; fall through */
      }
      if (err || json?.ok === false) {
        const detail = json?.error?.message ?? json?.error ?? String(stderr || err?.message || out).slice(0, 500);
        return reject(new DeliveryError(`openclaw message send failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`));
      }
      resolve(json ?? { raw: out });
    });
  });
}

/** OPENCLAW_SEND_DRY_RUN=true → exercise the full send path but let OpenClaw skip delivery. */
export function isPreflight(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.OPENCLAW_SEND_DRY_RUN ?? "").trim());
}
