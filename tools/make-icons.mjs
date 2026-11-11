// Draws the app icons (a tick on a rounded tile) as PNGs with plain Node: `npm run icons`.

import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const TILE = [0, 177, 231];
const TICK = [255, 255, 255];

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const cover = (d, edge, soft) => Math.max(0, Math.min(1, (edge - d) / soft));

// scale: how much of the canvas the artwork uses (maskable icons keep to the middle).
function icon(size, { maskable }) {
  const soft = 1.5 / size;
  const scale = maskable ? 0.72 : 1;
  return png(size, (u, v) => {
    const x = (u - 0.5) / scale + 0.5, y = (v - 0.5) / scale + 0.5;
    // rounded tile
    const r = 0.22, half = 0.5;
    const qx = Math.max(Math.abs(x - 0.5) - (half - r), 0), qy = Math.max(Math.abs(y - 0.5) - (half - r), 0);
    const inTile = cover(Math.hypot(qx, qy), r, soft / scale);
    // the tick: two strokes
    const d = Math.min(distToSegment(x, y, 0.27, 0.53, 0.43, 0.69), distToSegment(x, y, 0.43, 0.69, 0.74, 0.34));
    const inTick = cover(d, 0.062, soft / scale);
    const tile = mix(TILE, TICK, inTick);
    // Maskable icons are full-bleed: the launcher cuts its own shape out of them.
    if (maskable) return [...tile, 255];
    return [...tile, Math.round(255 * inTile)];
  });
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const out = (name, buf) => writeFileSync(new URL(`../icons/${name}`, import.meta.url), buf);
out('icon-192.png', icon(192, { maskable: false }));
out('icon-512.png', icon(512, { maskable: false }));
out('icon-maskable-512.png', icon(512, { maskable: true }));
out('../icon.png', icon(256, { maskable: false }));
console.log('icons written');
