// Renders a top-down colour preview of the heightfield to a PNG (via ffmpeg from PPM).
import { createTerrain } from '../src/terrain.js';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const seed = +(process.argv[2] || 7);
const out = process.argv[3] || '/tmp/map.png';
const t = createTerrain(seed);
const { createLayout } = await import("../src/layout.js");
const L = createLayout(t);
console.log("palms", L.palms.length, "rocks", L.rocks.length, "bushes", L.bushes.length, "props", L.props.length, "shells", L.shells.length, "ramps", L.ramps.length, "pier", !!L.pier, "hut", !!L.hut, "lighthouse", !!L.lighthouse, "heading", L.spawn.heading.toFixed(2));
const V = t.V, S = 512;
const buf = Buffer.alloc(S * S * 3);
let land = 0, shallow = 0, deep = 0, mesaC = 0;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const wx = -160 + (x + 0.5) * 320 / S, wz = -160 + (y + 0.5) * 320 / S;
  const h = t.heightAt(wx, wz);
  const m = t.mesaAt(wx, wz), g = t.grassAt(wx, wz);
  let c;
  if (h < -1.2) { c = [30, 60, 120]; deep++; }
  else if (h < 0) { const k = -h / 1.2; c = [90 - 50 * k, 200 - 90 * k, 200 - 40 * k]; shallow++; }
  else if (m > 0.5) { const b = Math.floor(h / 1.9) % 2; c = b ? [180, 120, 110] : [150, 100, 105]; mesaC++; land++; }
  else if (g > 0.45) { c = [170, 160, 70]; land++; }
  else { c = [235, 210, 165]; land++; }
  if (Math.hypot(wx - t.spawn.x, wz - t.spawn.z) < 3) c = [255, 0, 0];
  for (const p of L.palms) if (Math.hypot(wx - p.x, wz - p.z) < 1.2) c = [30, 110, 40];
  for (const p of L.shells) if (Math.hypot(wx - p.x, wz - p.z) < 2.5) c = [255, 200, 0];
  for (const p of L.props) if (Math.hypot(wx - p.x, wz - p.z) < 0.8) c = [255, 80, 160];
  for (const p of L.rocks) if (Math.hypot(wx - p.x, wz - p.z) < p.s) c = [90, 70, 80];
  for (const s of t.structures) { const dx = wx - s.x, dz = wz - s.z; const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos; if (Math.abs(lx) < s.hw && Math.abs(lz) < s.hl) c = s.type === 'ramp' ? [255, 120, 0] : [120, 70, 30]; }
  if (L.lighthouse && Math.hypot(wx - L.lighthouse.x, wz - L.lighthouse.z) < 3) c = [255, 255, 255];
  const k = (y * S + x) * 3; buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2];
}
const tot = S * S;
console.log(`seed ${seed} land ${(land / tot * 100).toFixed(1)}% shallow ${(shallow / tot * 100).toFixed(1)}% deep ${(deep / tot * 100).toFixed(1)}% mesa ${(mesaC / tot * 100).toFixed(1)}% spawn`, t.spawn);
writeFileSync('/tmp/map.ppm', Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), buf]));
execSync(`ffmpeg -v error -y -i /tmp/map.ppm ${out}`);
