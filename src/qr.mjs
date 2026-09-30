// Turns the text QR that `openclaw channels login` prints (half-block characters, two
// modules per line) back into a module matrix and renders it as a square PNG.
// Needed because the GitHub Actions log viewer's line spacing stretches text QRs so
// phones can't scan them.
import { deflateSync } from "node:zlib";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const QR_LINE = /^[ ▀▄█]+$/;

/** Returns the LAST complete QR in `text` as a boolean matrix (true = dark), or null. */
export function extractLatestQr(text) {
  const lines = String(text).replace(/\r/g, "\n").split("\n");
  const blocks = [];
  let cur = [];
  for (const raw of lines) {
    const l = raw.replace(ANSI, "");
    if (l.length >= 21 && QR_LINE.test(l) && /[▀▄█]/.test(l)) cur.push(l);
    else if (l.trim() === "" && cur.length && l.length >= 21) cur.push(l); // all-light quiet-zone row
    else {
      if (cur.length) blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);

  for (let b = blocks.length - 1; b >= 0; b--) {
    const m = toMatrix(blocks[b]);
    if (m && looksLikeQr(m)) return m;
  }
  return null;
}

function toMatrix(rows) {
  const width = Math.max(...rows.map((r) => [...r].length));
  const height = rows.length * 2;
  if (width < 21 || Math.abs(height - width) > 3) return null; // incomplete (still being printed)
  const m = [];
  for (let r = 0; r < height; r++) {
    const chars = [...rows[r >> 1]];
    const top = r % 2 === 0;
    m.push(Array.from({ length: width }, (_, c) => {
      const ch = chars[c] ?? " ";
      return ch === "█" || (top && ch === "▀") || (!top && ch === "▄");
    }));
  }
  // Trim an all-light bottom row produced by an odd module count.
  while (m.length > 1 && m.at(-1).every((x) => !x) && m.length > width) m.pop();
  return m;
}

/** Checks the top-left finder pattern (7×7 dark ring) exists somewhere near the corner. */
function looksLikeQr(m) {
  for (let o = 0; o <= 4; o++) {
    const ring = [0, 6].every((i) => [0, 1, 2, 3, 4, 5, 6].every((j) => m[o + i]?.[o + j] && m[o + j]?.[o + i]));
    const core = [2, 3, 4].every((i) => [2, 3, 4].every((j) => m[o + i]?.[o + j]));
    const gap = [1, 5].every((i) => [1, 2, 3, 4, 5].every((j) => !m[o + i]?.[o + j]));
    if (ring && core && gap) return true;
  }
  return false;
}

/** Grayscale pixel buffer (0 = black, 255 = white) with a 4-module quiet zone. */
export function matrixToPixels(m, scale = 10, quiet = 4) {
  const size = (m[0].length + quiet * 2) * scale;
  const hSize = (m.length + quiet * 2) * scale;
  const px = Buffer.alloc(size * hSize, 255);
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++) px.fill(0, ((r + quiet) * scale + y) * size + (c + quiet) * scale, ((r + quiet) * scale + y) * size + (c + quiet + 1) * scale);
    }),
  );
  return { px, width: size, height: hSize };
}

export function matrixToPng(m, scale = 10) {
  const { px, width, height } = matrixToPixels(m, scale);
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) px.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width); // filter byte 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit grayscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
