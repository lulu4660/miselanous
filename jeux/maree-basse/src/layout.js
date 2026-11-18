// Deterministic placement of everything on the island. Renderer-free.
import { mulberry32, createNoise2D, clamp } from './noise.js';

export function createLayout(terrain) {
  const rnd = mulberry32(terrain.seed * 977 + 13);
  const noise = createNoise2D(terrain.seed + 404);
  const half = terrain.half - 6;
  const nrm = [0, 1, 0];
  const H = (x, z) => terrain.heightAt(x, z);
  const slope = (x, z) => { terrain.normalAt(x, z, nrm); return nrm[1]; };
  const L = {
    palms: [], rocks: [], bushes: [], props: [], shells: [], ramps: [], pier: null, hut: null,
    lighthouse: null, umbrellas: [], reserved: [], spawn: { ...terrain.spawn, heading: 0 },
  };
  const reserve = (x, z, r) => L.reserved.push({ x, z, r });
  const free = (x, z, r) => L.reserved.every((q) => (q.x - x) ** 2 + (q.z - z) ** 2 > (q.r + r) ** 2);

  // --- Spawn heading: face the nearest water
  {
    const s = terrain.spawn;
    let best = 0, bestD = 1e9;
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      for (let d = 3; d < 40; d += 1) {
        if (H(s.x + Math.sin(ang) * d, s.z + Math.cos(ang) * d) < -0.15) { if (d < bestD) { bestD = d; best = ang; } break; }
      }
    }
    L.spawn.heading = best;
    reserve(s.x, s.z, 7);
  }

  // --- Pier: from a shoreline near spawn, out into the lagoon
  {
    const s = terrain.spawn;
    let best = null;
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const dx = Math.sin(ang), dz = Math.cos(ang);
      for (let d = 10; d < 45; d += 1) {
        const x = s.x + dx * d, z = s.z + dz * d;
        const h = H(x, z);
        if (h < 0.35 && h > 0.0 && H(x - dx * 4, z - dz * 4) > 0.3) {
          // check the run out into the water
          let ok = true, deepish = 0;
          for (let k = 2; k < 26; k += 2) {
            const hh = H(x + dx * k, z + dz * k);
            if (hh > 0.05) { ok = false; break; }
            if (hh < -0.5) deepish++;
          }
          const sideClear = H(x + dz * 6, z - dx * 6) < 2 && H(x - dz * 6, z + dx * 6) < 2;
          if (ok && sideClear) {
            const score = deepish * 2 - d * 0.15 - Math.abs(Math.atan2(Math.sin(ang - L.spawn.heading), Math.cos(ang - L.spawn.heading))) * 1.5;
            if (!best || score > best.score) best = { x, z, ang, dx, dz, score };
          }
          break;
        }
      }
    }
    if (best) {
      const len = 24, deckY = 0.95;
      const startH = Math.max(0.05, H(best.x - best.dx * 3, best.z - best.dz * 3));
      const rampLen = 5;
      const rcx = best.x - best.dx * (rampLen / 2 + 0.5), rcz = best.z - best.dz * (rampLen / 2 + 0.5);
      const ramp = terrain.addStructure({ type: 'ramp', x: rcx, z: rcz, angle: best.ang, hw: 1.6, hl: rampLen / 2, y0: Math.min(startH, deckY - 0.2), y1: deckY });
      const dcx = best.x + best.dx * (len / 2), dcz = best.z + best.dz * (len / 2);
      const deck = terrain.addStructure({ type: 'deck', x: dcx, z: dcz, angle: best.ang, hw: 1.7, hl: len / 2 + 0.01, y1: deckY });
      L.pier = { ramp, deck, ang: best.ang, len, deckY, x0: best.x, z0: best.z, dx: best.dx, dz: best.dz };
      for (let k = -3; k <= len + 1; k += 3) reserve(best.x + best.dx * k, best.z + best.dz * k, 3);
    }
  }

  // --- Kicker ramps on beaches facing water
  {
    const cands = [];
    for (let k = 0; k < 4000 && cands.length < 400; k++) {
      const x = (rnd() * 2 - 1) * half * 0.85, z = (rnd() * 2 - 1) * half * 0.85;
      const h = H(x, z);
      if (h < 0.25 || h > 1.2 || terrain.mesaAt(x, z) > 0.05 || slope(x, z) < 0.97) continue;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
        let ok = true;
        for (let d = -12; d <= 4; d += 1.5) { const hh = H(x + dx * d, z + dz * d); if (hh < 0.15 || hh > 1.6) { ok = false; break; } }
        if (!ok) continue;
        let water = 0;
        for (let d = 8; d <= 22; d += 2) if (H(x + dx * d, z + dz * d) < -0.3) water++;
        if (water >= 5) cands.push({ x, z, ang, dx, dz });
      }
    }
    for (const c of cands) {
      if (L.ramps.length >= 3) break;
      if (!free(c.x, c.z, 14)) continue;
      if (Math.hypot(c.x - terrain.spawn.x, c.z - terrain.spawn.z) < 15) continue;
      const g = H(c.x, c.z);
      const s = terrain.addStructure({ type: 'ramp', x: c.x, z: c.z, angle: c.ang, hw: 1.9, hl: 3.2, y0: g - 0.05, y1: g + 1.25 });
      L.ramps.push(s);
      reserve(c.x, c.z, 6);
      reserve(c.x - c.dx * 8, c.z - c.dz * 8, 4);
    }
  }

  // --- Beach hut + umbrellas near spawn
  {
    const s = terrain.spawn;
    for (let t = 0; t < 200; t++) {
      const a = rnd() * Math.PI * 2, d = 9 + rnd() * 10;
      const x = s.x + Math.sin(a) * d, z = s.z + Math.cos(a) * d;
      const h = H(x, z);
      if (h > 0.45 && h < 2 && slope(x, z) > 0.96 && free(x, z, 3.5)) {
        L.hut = { x, z, y: h, rot: Math.atan2(s.x - x, s.z - z) };
        reserve(x, z, 3.5);
        break;
      }
    }
    for (let t = 0; t < 300 && L.umbrellas.length < 4; t++) {
      const a = rnd() * Math.PI * 2, d = 6 + rnd() * 14;
      const x = s.x + Math.sin(a) * d, z = s.z + Math.cos(a) * d;
      const h = H(x, z);
      if (h > 0.35 && h < 1.6 && free(x, z, 2.2)) {
        L.umbrellas.push({ x, z, y: h, tilt: (rnd() - 0.5) * 0.25, rot: rnd() * 6.28, color: L.umbrellas.length });
        reserve(x, z, 2.2);
      }
    }
  }

  // --- Lighthouse on the highest mesa top
  {
    let best = null;
    for (let k = 0; k < 6000; k++) {
      const x = (rnd() * 2 - 1) * half * 0.8, z = (rnd() * 2 - 1) * half * 0.8;
      if (terrain.mesaAt(x, z) < 0.9) continue;
      const h = H(x, z);
      let flat = true;
      for (let a = 0; a < 8; a++) if (Math.abs(H(x + Math.sin(a) * 3, z + Math.cos(a) * 3) - h) > 0.3) { flat = false; break; }
      if (flat && (!best || h > best.y)) best = { x, z, y: h };
    }
    if (best) { L.lighthouse = best; reserve(best.x, best.z, 3); }
  }

  // --- Shells (collectibles): farthest-point sampling over valid spots
  {
    const cands = [];
    for (let k = 0; k < 9000 && cands.length < 1500; k++) {
      const x = (rnd() * 2 - 1) * half * 0.86, z = (rnd() * 2 - 1) * half * 0.86;
      const h = H(x, z);
      if (h < -0.45 || h > 2.4 || terrain.mesaAt(x, z) > 0.08 || slope(x, z) < 0.9) continue;
      if (!free(x, z, 2)) continue;
      cands.push({ x, z, y: h });
    }
    const pts = [{ x: terrain.spawn.x, z: terrain.spawn.z }];
    for (let n = 0; n < 12 && cands.length; n++) {
      let best = null, bestD = -1;
      for (const c of cands) {
        let dmin = Infinity;
        for (const p of pts) dmin = Math.min(dmin, (p.x - c.x) ** 2 + (p.z - c.z) ** 2);
        // gentle bias toward the waterline (more scenic)
        const w = dmin * (c.y < 0.6 ? 1.25 : 1);
        if (w > bestD) { bestD = w; best = c; }
      }
      pts.push(best);
      L.shells.push({ x: best.x, z: best.z, y: best.y, taken: false, id: n });
      reserve(best.x, best.z, 2.5);
    }
  }

  // --- Palms (clustered groves near water)
  for (let k = 0; k < 30000 && L.palms.length < 110; k++) {
    const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
    const h = H(x, z);
    if (h < 0.3 || h > 3.2 || terrain.mesaAt(x, z) > 0.2 || slope(x, z) < 0.9) continue;
    const grove = noise(x * 0.025, z * 0.025);
    const p = clamp(grove * 1.6 + (h < 1.2 ? 0.35 : 0), 0, 1);
    if (rnd() > p * 0.6) continue;
    if (!free(x, z, 2.2)) continue;
    if (L.palms.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 9)) continue;
    const lean = 0.12 + rnd() * 0.32;
    L.palms.push({ x, z, y: h, height: 5.5 + rnd() * 3.5, lean, leanDir: rnd() * Math.PI * 2, rot: rnd() * 6.28, variant: Math.floor(rnd() * 3) });
  }
  // a lonely palm on small islets is lovely: force a few on isolated sand
  // --- Rocks: at mesa feet and as islets in shallow water
  for (let k = 0; k < 40000 && L.rocks.length < 150; k++) {
    const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
    const h = H(x, z), m = terrain.mesaAt(x, z);
    let ok = false, s = 0;
    if (m > 0.02 && m < 0.6 && h < 5 && h > -0.8) { ok = rnd() < 0.5; s = 0.7 + rnd() * 1.6; }
    else if (h > -0.9 && h < -0.2 && rnd() < 0.03) { ok = true; s = 0.6 + rnd() * 1.4; }
    else if (h > 0.3 && h < 2 && rnd() < 0.004) { ok = true; s = 0.4 + rnd() * 0.7; }
    if (!ok || !free(x, z, s)) continue;
    L.rocks.push({ x, z, y: h, s, rot: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.5, variant: Math.floor(rnd() * 4) });
  }
  // --- Bushes
  for (let k = 0; k < 40000 && L.bushes.length < 260; k++) {
    const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
    const h = H(x, z);
    if (h < 0.5 || terrain.mesaAt(x, z) > 0.4 || slope(x, z) < 0.85) continue;
    const g = terrain.grassAt(x, z);
    if (rnd() > g * 0.5 + 0.05) continue;
    if (!free(x, z, 1.2)) continue;
    L.bushes.push({ x, z, y: h, s: 0.6 + rnd() * 0.9, rot: rnd() * 6.28, hue: rnd() });
  }

  // --- Props: lots around spawn, more scattered in lagoons
  {
    const s = terrain.spawn;
    const placeNear = (kind, cx, cz, rmin, rmax, cond, count, opts = {}) => {
      let placed = 0;
      for (let t = 0; t < 600 && placed < count; t++) {
        const a = rnd() * Math.PI * 2, d = rmin + rnd() * (rmax - rmin);
        const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
        if (Math.abs(x) > half || Math.abs(z) > half) continue;
        const h = H(x, z);
        if (!cond(h, x, z) || !free(x, z, 1)) continue;
        if (L.props.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.2)) continue;
        L.props.push({ kind, x, z, color: Math.floor(rnd() * 4), ...opts });
        placed++;
      }
    };
    const water = (lo, hi) => (h) => h < hi && h > lo;
    const ahead = { x: s.x + Math.sin(L.spawn.heading) * 16, z: s.z + Math.cos(L.spawn.heading) * 16 };
    placeNear('ball', ahead.x, ahead.z, 0, 14, water(-1.2, 0.6), 5);
    placeNear('ring', ahead.x, ahead.z, 0, 16, water(-1.4, -0.05), 6);
    placeNear('melon', s.x, s.z, 3, 12, water(0.3, 2), 4);
    placeNear('crate', s.x, s.z, 5, 14, water(0.3, 2), 3);
    placeNear('barrel', s.x, s.z, 6, 16, water(0.2, 2), 3);
    // scattered around the island
    for (let n = 0; n < 9; n++) {
      const a = rnd() * Math.PI * 2, d = 30 + rnd() * 100;
      const cx = Math.sin(a) * d, cz = Math.cos(a) * d;
      placeNear('ball', cx, cz, 0, 16, water(-1.0, 1.2), 2);
      placeNear('ring', cx, cz, 0, 16, water(-1.4, -0.1), 2);
      placeNear('barrel', cx, cz, 0, 20, water(-0.6, 1.5), 1);
    }
    // channel buoys in deeper water
    for (let n = 0; n < 9; n++) {
      const a = rnd() * Math.PI * 2, d = 20 + rnd() * 110;
      placeNear('buoy', Math.sin(a) * d, Math.cos(a) * d, 0, 30, water(-2.6, -0.8), 1, { tether: 1.6 });
    }
  }

  return L;
}
