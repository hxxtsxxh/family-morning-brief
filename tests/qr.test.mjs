import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { extractLatestQr, matrixToPixels, matrixToPng } from "../src/qr.mjs";

// Same renderer/format as `openclaw channels login` (white bg, black half-blocks).
const terminalQr = (text) => QRCode.toString(text, { type: "terminal", small: true });
const PAYLOAD = "2@AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/=,MTIzNDU2Nzg5MGFiY2RlZg==,cXdlcnR5dWlvcGFzZGZnaGprbA==,ZXhhbXBsZQ==";

function decode(matrix) {
  const { px, width, height } = matrixToPixels(matrix, 4);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < px.length; i++) rgba.set([px[i], px[i], px[i], 255], i * 4);
  return jsQR(rgba, width, height)?.data;
}

test("a text QR from the login output decodes back to the exact payload", async () => {
  const m = extractLatestQr(await terminalQr(PAYLOAD));
  assert.ok(m, "QR found");
  assert.equal(m.length, m[0].length, "square matrix");
  assert.equal(decode(m), PAYLOAD);
});

test("picks the newest QR from a noisy log and ignores a half-printed one", async () => {
  const older = await terminalQr("2@old,payload");
  const newer = await terminalQr(PAYLOAD);
  const partial = (await terminalQr("2@incomplete")).split("\n").slice(0, 6).join("\n");
  const log = `Waiting for WhatsApp connection...\nOpen the WhatsApp app, go to Linked Devices, then scan this QR:\n${older}\nQR refreshed\n${newer}\n${partial}`;
  assert.equal(decode(extractLatestQr(log)), PAYLOAD);
});

test("no QR in the log → null", () => {
  assert.equal(extractLatestQr("gateway starting...\nWaiting for WhatsApp connection...\n"), null);
});

test("PNG output is a valid, square grayscale image", async () => {
  const m = extractLatestQr(await terminalQr(PAYLOAD));
  const png = matrixToPng(m, 10);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  assert.equal(w, h);
  assert.equal(w, (m[0].length + 8) * 10);
  const idatLen = png.readUInt32BE(33);
  assert.equal(inflateSync(png.subarray(41, 41 + idatLen)).length, (w + 1) * h);
});
