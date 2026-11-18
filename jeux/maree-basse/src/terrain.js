// Heightfield world: single source of truth for the terrain mesh, physics contacts,
// water depth and prop collisions. Renderer-free.
import { createNoise2D, fbm, clamp, smoothstep, lerp, mulberry32 } from './noise.js';

export const WORLD = {
  size: 320,           // metres, square, centred on the origin
  n: 256,              // cells per side
  get cell() { return this.size / this.n; },
  get half() { return this.size / 2; },
  waterLevel: 0,
};

export const SURF = { SAND: 0, WETSAND: 1, GRASS: 2, ROCK: 3, WOOD: 4 };
export const SURF_NAME = ['sand', 'wetsand', 'grass', 'rock', 'wood'];

export function createTerrain(seed = 7) {
  const N = WORLD.n;
  const V = N + 1;
  const cell = WORLD.cell;
  const half = WORLD.half;
  const nA = createNoise2D(seed);
  const nB = createNoise2D(seed * 31 + 5);
  const nC = createNoise2D(seed * 131 + 11);

  const heights = new Float32Array(V * V);
  const grass = new Float32Array(V * V);   // 0..1 vegetation density (render + surface)
  const mesa = new Float32Array(V * V);    // 0..1 how much this vertex is a rocky mesa

  function rawHeight(x, z) {
    const r = Math.hypot(x, z) / half; // 0 centre .. ~1.41 corners
    // Continental shape: land in the middle, ring of deep water at the edge.
    let c = fbm(nA, x * 0.0105, z * 0.0105, 4) * 1.05
      + fbm(nB, x * 0.031, z * 0.031, 3) * 0.32
      + 0.02;
    c -= smoothstep(0.74, 1.08, r + fbm(nC, x * 0.02, z * 0.02, 2) * 0.12) * 3.4;

    let h;
    if (c > 0.0) {
      // land: gentle dunes
      h = c * 2.3 + Math.max(0, fbm(nC, x * 0.06, z * 0.06, 2)) * 0.35 * smoothstep(0, 0.5, c);
    } else if (c > -1.25) {
      // wide shallow lagoon, compressed depth range, sandbar ripples
      const t = c / -1.25; // 0 at shore -> 1 at lagoon floor edge
      h = -(Math.pow(t, 0.75) * 0.95) + fbm(nB, x * 0.08, z * 0.08, 2) * 0.08 * t;
    } else {
      // drop-off to deep water
      h = -0.95 + (c + 1.25) * 4.5;
    }
    h = Math.max(h, -7.5);

    // Rocky mesas with stratified terraces.
    const m0 = fbm(nB, x * 0.0072 + 40, z * 0.0072 - 13, 4)
      + fbm(nA, x * 0.05, z * 0.05, 2) * 0.06;
    const inner = 1 - smoothstep(0.7, 0.9, r);
    const mm = smoothstep(0.284, 0.296, m0) * inner;
    let mh = 0;
    if (mm > 0) {
      // flat-topped mesa with an occasional upper tier; the cliff is the mask ramp
      let top = 5.4 + fbm(nC, x * 0.012, z * 0.012, 2) * 1.8;
      const tier = smoothstep(0.372, 0.384, m0 + fbm(nA, x * 0.045, z * 0.045, 2) * 0.025);
      top += tier * 3.6;
      // a ledge halfway up the cliff gives the faces a stratified profile
      const r0 = mm * top;
      const ledge = smoothstep(0.42, 0.58, mm) * 0.9;
      mh = Math.max(r0, Math.min(top, r0 + ledge));
    }
    return { h: Math.max(h, h + mh) + (mm > 0 ? 0 : 0), mesa: mm };
  }

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = -half + i * cell;
      const z = -half + j * cell;
      const { h, mesa: m } = rawHeight(x, z);
      const k = j * V + i;
      heights[k] = h;
      mesa[k] = m;
    }
  }

  // Spawn: a flat beach spot close to the centre, near shallow water.
  const spawn = findSpawn(heights, V, cell, half);
  // Flatten a little pad around the spawn.
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = -half + i * cell, z = -half + j * cell;
      const d = Math.hypot(x - spawn.x, z - spawn.z);
      if (d < 9) {
        const k = j * V + i;
        const w = 1 - smoothstep(4, 9, d);
        heights[k] = lerp(heights[k], 0.55, w);
        mesa[k] *= 1 - w;
      }
    }
  }

  // Vegetation density.
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const x = -half + i * cell, z = -half + j * cell;
      const h = heights[k];
      const g = fbm(nC, x * 0.045 + 7, z * 0.045 - 3, 3);
      let v = smoothstep(-0.05, 0.25, g) * smoothstep(0.55, 1.1, h);
      v *= 1 - smoothstep(0.3, 0.6, mesa[k]) * (h < 5 ? 1 : 0.2);
      grass[k] = clamp(v, 0, 1);
    }
  }

  const terrain = {
    heights, grass, mesa, V, N, cell, half, spawn,
    structures: [],
    seed,
    rnd: mulberry32(seed * 7 + 3),
  };

  // --- Sampling (matches the mesh triangulation exactly) ---
  // Cells are split along the (i,j)->(i+1,j+1) diagonal.
  terrain.heightAt = function (x, z) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    if (fx < 0) fx = 0; else if (fx > N - 1e-4) fx = N - 1e-4;
    if (fz < 0) fz = 0; else if (fz > N - 1e-4) fz = N - 1e-4;
    const i = fx | 0, j = fz | 0;
    const u = fx - i, w = fz - j;
    const k = j * V + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + V], h11 = heights[k + V + 1];
    if (u > w) return h00 + (h10 - h00) * u + (h11 - h10) * w;
    return h00 + (h11 - h01) * u + (h01 - h00) * w;
  };

  // Writes the unit normal into out (array-like [x,y,z]); returns height.
  terrain.normalAt = function (x, z, out) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    if (fx < 0) fx = 0; else if (fx > N - 1e-4) fx = N - 1e-4;
    if (fz < 0) fz = 0; else if (fz > N - 1e-4) fz = N - 1e-4;
    const i = fx | 0, j = fz | 0;
    const u = fx - i, w = fz - j;
    const k = j * V + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + V], h11 = heights[k + V + 1];
    let dhdx, dhdz, h;
    if (u > w) { dhdx = (h10 - h00) / cell; dhdz = (h11 - h10) / cell; h = h00 + (h10 - h00) * u + (h11 - h10) * w; }
    else { dhdx = (h11 - h01) / cell; dhdz = (h01 - h00) / cell; h = h00 + (h11 - h01) * u + (h01 - h00) * w; }
    const l = Math.hypot(dhdx, 1, dhdz);
    out[0] = -dhdx / l; out[1] = 1 / l; out[2] = -dhdz / l;
    return h;
  };

  terrain.mesaAt = function (x, z) {
    const i = clamp(Math.round((x + half) / cell), 0, N), j = clamp(Math.round((z + half) / cell), 0, N);
    return mesa[j * V + i];
  };
  terrain.grassAt = function (x, z) {
    const i = clamp(Math.round((x + half) / cell), 0, N), j = clamp(Math.round((z + half) / cell), 0, N);
    return grass[j * V + i];
  };

  // Structures (pier decks, ramps) are part of the drivable ground but not the terrain mesh.
  terrain.addStructure = function (s) {
    s.cos = Math.cos(s.angle); s.sin = Math.sin(s.angle);
    terrain.structures.push(s);
    return s;
  };

  const tmpN = [0, 1, 0];
  // ground(): height, normal and surface of the drivable ground (terrain + structures).
  // out = { h, nx, ny, nz, surf }
  terrain.ground = function (x, z, out, yHint = Infinity) {
    let h = terrain.normalAt(x, z, tmpN);
    out.nx = tmpN[0]; out.ny = tmpN[1]; out.nz = tmpN[2];
    out.surf = surfaceFor(h, tmpN[1], terrain.mesaAt(x, z), terrain.grassAt(x, z));
    const S = terrain.structures;
    for (let q = 0; q < S.length; q++) {
      const s = S[q];
      const dx = x - s.x, dz = z - s.z;
      const lx = dx * s.cos - dz * s.sin;
      const lz = dx * s.sin + dz * s.cos;
      if (Math.abs(lx) > s.hw || Math.abs(lz) > s.hl) continue;
      let top, nlx = 0, nly = 1, nlz = 0;
      if (s.type === 'ramp') {
        const t = (lz + s.hl) / (2 * s.hl);
        top = s.y0 + (s.y1 - s.y0) * t;
        const slope = (s.y1 - s.y0) / (2 * s.hl);
        const l = Math.hypot(slope, 1);
        nly = 1 / l; nlz = -slope / l;
      } else {
        top = s.y1;
      }
      // Only count it if we are above (or near) the top: lets cars drive under nothing,
      // but also lets wheels that are below a deck still use the terrain.
      if (top > h && yHint > top - 0.6) {
        h = top;
        // rotate local normal back to world
        out.nx = nlx * s.cos + nlz * s.sin;
        out.nz = -nlx * s.sin + nlz * s.cos;
        out.ny = nly;
        out.surf = SURF.WOOD;
      }
    }
    out.h = h;
    return out;
  };

  terrain.waterDepthAt = function (x, z) {
    return WORLD.waterLevel - terrain.heightAt(x, z);
  };

  return terrain;
}

export function surfaceFor(h, ny, mesa, grass) {
  if (ny < 0.72 || mesa > 0.55) return SURF.ROCK;
  if (h < 0.35) return SURF.WETSAND;
  if (grass > 0.45) return SURF.GRASS;
  return SURF.SAND;
}

function findSpawn(heights, V, cell, half) {
  let best = null, bestScore = -Infinity;
  const at = (i, j) => heights[clamp(j, 0, V - 1) * V + clamp(i, 0, V - 1)];
  for (let j = 8; j < V - 8; j += 2) {
    for (let i = 8; i < V - 8; i += 2) {
      const h = at(i, j);
      if (h < 0.35 || h > 1.6) continue;
      const x = -half + i * cell, z = -half + j * cell;
      const dc = Math.hypot(x, z);
      if (dc > 70) continue;
      // flatness
      let maxd = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) maxd = Math.max(maxd, Math.abs(at(i + di, j + dj) - h));
      if (maxd > 0.6) continue;
      // water nearby (in +z direction preferred: car faces it)
      let water = 0;
      for (let r = 4; r < 18; r++) if (at(i, j + r) < -0.1) { water = 1 / r; break; }
      const score = water * 40 - dc * 0.05 - maxd * 4;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  return best || { x: 0, z: 0 };
}
