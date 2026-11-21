// Top-down preview of the world: biomes, relief shading, roads, lake, spawn.
import { createWorld } from '../src/world.js';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const out = process.argv[2] || '/tmp/map.png';
const t0 = Date.now();
const W = createWorld(+(process.argv[3] || 11));
console.log('generated in', Date.now() - t0, 'ms; roads', W.roads.map((r) => `${r.name} ${(r.length / 1000).toFixed(2)} km`).join(', '), 'lake', !!W.lake, 'spawn', W.spawn);
const S = 600, buf = Buffer.alloc(S * S * 3);
const n = [0, 1, 0];
let minH = Infinity, maxH = -Infinity;
for (const h of W.heights) { minH = Math.min(minH, h); maxH = Math.max(maxH, h); }
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const wx = -W.half + (x + 0.5) * W.size / S, wz = -W.half + (y + 0.5) * W.size / S;
  W.normalAt(wx, wz, n);
  const shade = 0.55 + 0.45 * Math.max(0, n[0] * -0.5 + n[1] * 0.7 + n[2] * -0.5);
  const s = W.surfaceAt(wx, wz);
  const C = [[70, 72, 80], [150, 105, 70], [235, 240, 250], [110, 160, 80], [215, 180, 120], [245, 248, 255], [140, 120, 115], [170, 215, 235]][s];
  const k = (y * S + x) * 3;
  for (let c = 0; c < 3; c++) buf[k + c] = Math.min(255, C[c] * shade);
}
const cols = [[255, 60, 60], [255, 220, 0], [0, 200, 255]];
W.roads.forEach((r, ri) => { for (const p of r.pts) { const px = Math.round((p.x + W.half) / W.size * S), py = Math.round((p.z + W.half) / W.size * S); for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) { const k = ((py + dy) * S + px + dx) * 3; if (k >= 0 && k < buf.length - 3) { buf[k] = cols[ri][0]; buf[k + 1] = cols[ri][1]; buf[k + 2] = cols[ri][2]; } } } });
const sp = W.spawn;
for (let a = 0; a < 60; a++) { const px = Math.round((sp.x + W.half) / W.size * S + Math.cos(a) * 4), py = Math.round((sp.z + W.half) / W.size * S + Math.sin(a) * 4); const k = (py * S + px) * 3; buf[k] = 255; buf[k + 1] = 0; buf[k + 2] = 0; }
writeFileSync('/tmp/map.ppm', Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), buf]));
execSync(`ffmpeg -v error -y -i /tmp/map.ppm ${out}`);
console.log('height range', minH.toFixed(1), maxH.toFixed(1));
