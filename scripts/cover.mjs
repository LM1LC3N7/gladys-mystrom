// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark-to-teal gradient, a
// power symbol, and the four device shapes of the integration (plug, bulb,
// button, sensor) as simple discs. Plain Node (zlib), no dependency.
// Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [16, 32, 44];
const TEAL = [0, 150, 160];
const WHITE = [255, 255, 255];
const ACCENT = [255, 196, 64];

/** The colour of one pixel. */
function pixel(x, y) {
  let color = mix(DARK, TEAL, (x / WIDTH) * 0.6 + (y / HEIGHT) * 0.4);
  // Power symbol: a ring open at the top, and a bar.
  const cx = 400;
  const cy = 230;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dx, -dy);
  const ring = smooth(14, Math.abs(r - 110)) * (Math.abs(angle) > 0.6 ? 1 : 0);
  const bar = smooth(14, Math.abs(dx)) * (dy > -140 && dy < -10 ? 1 : 0);
  color = mix(color, WHITE, Math.max(ring, bar));
  // Four discs: switch, bulb, button, motion sensor.
  [190, 330, 470, 610].forEach((px, i) => {
    const d = Math.hypot(x - px, y - 440);
    const disc = smooth(34, d);
    const inner = smooth(14, d);
    color = mix(color, i === 1 ? ACCENT : WHITE, disc * 0.9);
    color = mix(color, TEAL, inner * (i === 1 ? 0 : 0.8));
  });
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
