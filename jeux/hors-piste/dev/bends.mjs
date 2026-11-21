// Bend table: every bend on every road (radius from an 8 m chord), its surface and length.
import { createWorld } from '../src/world.js';
const world = createWorld(11);
const TYPE = ['', 'asphalt', 'dirt', 'snow'];
for (const road of world.roads) {
  const P = road.pts, n = P.length;
  const at = (i) => P[road.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  const R = [];
  for (let i = 0; i < n; i++) {
    const a = at(i - 2), b = at(i + 2);
    const d = Math.atan2(Math.sin(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)), Math.cos(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
    R.push(Math.abs(d) > 1e-4 ? 8 / Math.abs(d) * Math.sign(d) : 1e4);
  }
  const bends = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(R[i]);
    if (r < 90) { if (!cur) cur = { start: i, minR: r, type: P[i].type, sign: Math.sign(R[i]), turn: 0 }; cur.minR = Math.min(cur.minR, r); cur.turn += 2 / R[i]; }
    else if (cur) { cur.end = i; bends.push(cur); cur = null; }
  }
  console.log(`${road.name} (${(road.length / 1000).toFixed(2)} km): ${bends.length} bends`);
  const hist = {};
  for (const b of bends) {
    const k = `${TYPE[b.type]} R${b.minR < 25 ? '<25' : b.minR < 40 ? '25-40' : b.minR < 60 ? '40-60' : '60-90'}`;
    hist[k] = (hist[k] || 0) + 1;
  }
  console.log('  ', JSON.stringify(hist));
  console.log('   first bends after spawn:', bends.filter((b) => !road.closed || b.start > world.spawn.idx).slice(0, 6).map((b) => `${TYPE[b.type]} R${b.minR.toFixed(0)} ${Math.abs(b.turn * 180 / Math.PI).toFixed(0)}° @${b.start * 2}m`).join(', '));
}
