// The open map: three biomes (snow north, asphalt hills east, dirt canyons south-west),
// a road network carved into the heightfield, and a baked surface/road grid that every
// system reads (grip, AI paths, minimap, vegetation exclusion, respawn, particles).
// Renderer-free. Coordinates: x east, z south (north is -z), y up.
import { createNoise2D, fbm, smoothstep, lerp, clamp, mulberry32 } from './noise.js';
import { S } from './vehicles.js';

export const MAP = { size: 1000, n: 400 };
export const BIOME = { SNOW: 0, ASPHALT: 1, DIRT: 2 };
export const ROAD_TYPE = { ASPHALT: 1, DIRT: 2, SNOW: 3 };
const ROAD_SURF = [0, S.ASPHALT, S.DIRT, S.SNOWROAD];
const ROAD_HALF = [0, 4.6, 4.2, 4.2];

export function createWorld(seed = 11) {
  const N = MAP.n, V = N + 1, size = MAP.size, half = size / 2, cell = size / N;
  const nA = createNoise2D(seed), nB = createNoise2D(seed * 7 + 3), nC = createNoise2D(seed * 13 + 5), nD = createNoise2D(seed * 29 + 1);
  const rnd = mulberry32(seed * 101 + 7);

  // ---------- biomes (smooth weights)
  function biomeWeights(x, z, out) {
    const wob = fbm(nD, x * 0.004, z * 0.004, 3) * 70;
    const snow = smoothstep(-60, -200, z + wob);
    const east = smoothstep(-70, 70, x + fbm(nC, x * 0.005 + 9, z * 0.005, 2) * 60 - z * 0.25);
    out[0] = snow; out[1] = (1 - snow) * east; out[2] = (1 - snow) * (1 - east);
    return out;
  }
  const bw = [0, 0, 0];

  // ---------- base relief per biome, blended
  function baseHeight(x, z) {
    biomeWeights(x, z, bw);
    const r = Math.max(Math.abs(x), Math.abs(z)) / half;
    // snow: ridged mountains
    const ridge = 1 - Math.abs(fbm(nA, x * 0.0045, z * 0.0045, 4));
    const hSnow = 12 + ridge * ridge * 30 + fbm(nA, x * 0.0025 + 4, z * 0.0025, 2) * 14 + fbm(nB, x * 0.02, z * 0.02, 2) * 1.5;
    // asphalt: rolling green hills
    const hAsph = 6 + fbm(nB, x * 0.0055, z * 0.0055, 4) * 16 + fbm(nC, x * 0.018, z * 0.018, 2) * 2.5;
    // dirt: terraced mesas over a flat basin
    const m = fbm(nC, x * 0.006 + 31, z * 0.006 - 17, 4);
    let mesa = smoothstep(0.2, 0.24, m) * (10 + fbm(nA, x * 0.01, z * 0.01, 2) * 4);
    const step = 3.2, t = mesa / step;
    mesa = (Math.floor(t) + smoothstep(0.35, 0.65, t - Math.floor(t))) * step;
    const hDirt = 3 + fbm(nA, x * 0.008 - 5, z * 0.008, 3) * 5 + mesa;
    let h = hSnow * bw[0] + hAsph * bw[1] + hDirt * bw[2];
    // enclosing ridge at the map edge
    h += smoothstep(0.82, 0.99, r) * 55 * (0.7 + 0.3 * fbm(nD, x * 0.01, z * 0.01, 2));
    return h;
  }

  const heights = new Float32Array(V * V);
  const base = new Float32Array(V * V);
  const biome = new Uint8Array(V * V);
  const bsnow = new Float32Array(V * V), basph = new Float32Array(V * V), bdirt = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -half + i * cell, z = -half + j * cell, k = j * V + i;
    base[k] = baseHeight(x, z);
    biomeWeights(x, z, bw);
    bsnow[k] = bw[0]; basph[k] = bw[1]; bdirt[k] = bw[2];
    biome[k] = bw[0] >= bw[1] && bw[0] >= bw[2] ? BIOME.SNOW : bw[1] >= bw[2] ? BIOME.ASPHALT : BIOME.DIRT;
  }
  const H0 = (x, z) => sampleTri(base, x, z);

  // ---------- road network: a main loop through the three biomes + two cross roads
  const roads = [];
  function catmull(pts, closed, stepLen = 2) {
    const out = [];
    const n = pts.length;
    const P = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
    const segs = closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const m = Math.max(2, Math.ceil(L / stepLen));
      for (let k = 0; k < m; k++) {
        const t = k / m, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (!closed) out.push(pts[n - 1].slice());
    return out;
  }
  function makeRoad(ctrl, closed, name) {
    const pts = catmull(ctrl, closed);
    // resample to uniform 2 m spacing
    const res = [pts[0]];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let a = res[res.length - 1], b = pts[i];
      let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + d >= 2) {
        const t = (2 - acc) / d;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        res.push(p); a = p; d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0;
      }
      acc += d;
    }
    const n = res.length;
    // per-point type from the biome, smoothed so a road changes surface only once per border
    const type = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      biomeWeights(res[i][0], res[i][1], bw);
      type[i] = bw[0] > 0.5 ? ROAD_TYPE.SNOW : bw[1] >= bw[2] ? ROAD_TYPE.ASPHALT : ROAD_TYPE.DIRT;
    }
    // height profile: follow the land, smoothed, with a grade limit (cuts & embankments)
    let hs = res.map((p) => H0(p[0], p[1]));
    const smooth = (arr, w) => arr.map((_, i) => {
      let s = 0, c = 0;
      for (let k = -w; k <= w; k++) { const j = closed ? (i + k + n) % n : clamp(i + k, 0, n - 1); s += arr[j]; c++; }
      return s / c;
    });
    hs = smooth(hs, 18);
    const maxGrade = 0.11 * 2; // per 2 m sample
    const gradeLimit = () => {
      for (let i = 1; i < n; i++) hs[i] = clamp(hs[i], hs[i - 1] - maxGrade, hs[i - 1] + maxGrade);
      for (let i = n - 2; i >= 0; i--) hs[i] = clamp(hs[i], hs[i + 1] - maxGrade, hs[i + 1] + maxGrade);
    };
    for (let pass = 0; pass < 3; pass++) { gradeLimit(); hs = smooth(hs, 6); }
    // long smoothing keeps crests gentle (vertical radius ≳ 150 m: no take-offs at rally speed)
    for (let pass = 0; pass < 3; pass++) { hs = smooth(hs, 22); gradeLimit(); }
    const road = { name, closed, pts: res.map((p, i) => ({ x: p[0], z: p[1], y: hs[i], type: type[i] })), length: n * 2 };
    // tangents / cumulative distance
    for (let i = 0; i < n; i++) {
      const a = road.pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = road.pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      road.pts[i].tx = (b.x - a.x) / l; road.pts[i].tz = (b.z - a.z) / l; road.pts[i].s = i * 2;
    }
    roads.push(road);
    return road;
  }

  // main loop: wobbly ring through all biomes (clockwise seen from above)
  const loopCtrl = [];
  const K = 18;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    const rr = 300 + fbm(nB, Math.cos(a) * 3, Math.sin(a) * 3, 2) * 120 + (k % 2 ? 25 : -25);
    loopCtrl.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const loop = makeRoad(loopCtrl, true, 'Grande boucle');
  // cross roads (north-south through the centre, and a west-east link), attached to the loop
  const nearestOn = (road, x, z) => { let bi = 0, bd = Infinity; road.pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return road.pts[bi]; };
  const pN = nearestOn(loop, 10, -500), pS = nearestOn(loop, -30, 500), pW = nearestOn(loop, -500, 40), pE = nearestOn(loop, 500, -20);
  const cross1 = makeRoad([[pN.x, pN.z], [pN.x * 0.6 + 30, pN.z * 0.6], [40, -60], [-20, 60], [pS.x * 0.6 - 25, pS.z * 0.6], [pS.x, pS.z]], false, 'Traversée nord-sud');
  const cross2 = makeRoad([[pW.x, pW.z], [pW.x * 0.6, pW.z * 0.6 - 30], [-60, -20], [60, 30], [pE.x * 0.55, pE.z * 0.55 + 25], [pE.x, pE.z]], false, 'Route des crêtes');
  // pin cross-road ends to the loop heights so junctions are seamless
  for (const [road, a, b] of [[cross1, pN, pS], [cross2, pW, pE]]) {
    const n = road.pts.length;
    for (let i = 0; i < n; i++) {
      const wa = 1 - smoothstep(0, 40, i * 2), wb = 1 - smoothstep(0, 40, (n - 1 - i) * 2);
      road.pts[i].y = lerp(lerp(road.pts[i].y, a.y, wa), b.y, wb);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) road.pts[i].y = clamp(road.pts[i].y, road.pts[i - 1].y - 0.22, road.pts[i - 1].y + 0.22);
      for (let i = n - 2; i >= 0; i--) road.pts[i].y = clamp(road.pts[i].y, road.pts[i + 1].y - 0.22, road.pts[i + 1].y + 0.22);
    }
  }

  // level crossings: where a road meets an earlier one, it takes that road's height there
  // (blended over ±60 m and re-graded), otherwise the carve would leave a step between them
  for (let r = 1; r < roads.length; r++) {
    const R = roads[r], n = R.pts.length;
    const pins = [];
    for (let q = 0; q < r; q++) {
      const Q = roads[q];
      for (let i = 0; i < n; i++) {
        const p = R.pts[i];
        let bd = Infinity, by = 0;
        for (let j = 0; j < Q.pts.length; j++) {
          const d = (Q.pts[j].x - p.x) ** 2 + (Q.pts[j].z - p.z) ** 2;
          if (d < bd) { bd = d; by = Q.pts[j].y; }
        }
        if (bd < 14 * 14) pins.push({ i, y: by, d: Math.sqrt(bd) });
      }
    }
    if (!pins.length) continue;
    const target = R.pts.map((p) => p.y), weight = new Float32Array(n);
    for (const pin of pins) {
      for (let k = -30; k <= 30; k++) {
        const i = pin.i + k;
        if (i < 0 || i >= n) continue;
        const w = (1 - smoothstep(0, 30, Math.abs(k))) * (1 - smoothstep(4, 14, pin.d));
        if (w > weight[i]) { weight[i] = w; target[i] = pin.y; }
      }
    }
    for (let i = 0; i < n; i++) R.pts[i].y = lerp(R.pts[i].y, target[i], weight[i]);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) if (weight[i] < 0.99) R.pts[i].y = clamp(R.pts[i].y, R.pts[i - 1].y - 0.24, R.pts[i - 1].y + 0.24);
      for (let i = n - 2; i >= 0; i--) if (weight[i] < 0.99) R.pts[i].y = clamp(R.pts[i].y, R.pts[i + 1].y - 0.24, R.pts[i + 1].y + 0.24);
    }
  }

  // ---------- frozen lake in the snow biome (flat basin of ice)
  let lake = null;
  {
    let best = null;
    for (let t = 0; t < 400; t++) {
      const x = (rnd() - 0.5) * 600, z = -200 - rnd() * 220;
      biomeWeights(x, z, bw);
      if (bw[0] < 0.9) continue;
      let dmin = Infinity;
      for (const r of roads) for (let i = 0; i < r.pts.length; i += 3) dmin = Math.min(dmin, Math.hypot(r.pts[i].x - x, r.pts[i].z - z));
      if (dmin < 85 || dmin > 150) continue;
      if (!best || dmin < best.d) best = { x, z, d: dmin };
    }
    if (best) lake = { x: best.x, z: best.z, r: 38, y: H0(best.x, best.z) - 1.5 };
  }

  // ---------- carve roads + bake the road/surface grid
  const roadDist = new Float32Array(V * V).fill(99);
  const roadType = new Uint8Array(V * V);
  const roadIdx = new Int32Array(V * V).fill(-1); // index into roads[r].pts packed as r*1e5+i
  const roadH = new Float32Array(V * V);
  const SHOULDER = 11, REACH = 34;
  for (let r = 0; r < roads.length; r++) {
    const R = roads[r], P = R.pts, n = P.length;
    const segs = R.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const a = P[s], b = P[(s + 1) % n];
      const hw = ROAD_HALF[a.type];
      const reach = hw + REACH;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + half) / cell)), i1 = Math.min(N, Math.ceil((Math.max(a.x, b.x) + reach + half) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + half) / cell)), j1 = Math.min(N, Math.ceil((Math.max(a.z, b.z) + reach + half) / cell));
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -half + i * cell, z = -half + j * cell, k = j * V + i;
        const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
        const px = a.x + ex * t, pz = a.z + ez * t;
        const d = Math.hypot(x - px, z - pz) / (hw / 4.2); // normalised to a 4.2 m half width
        if (d < roadDist[k]) {
          roadDist[k] = d; roadType[k] = a.type; roadIdx[k] = r * 100000 + s; roadH[k] = a.y + (b.y - a.y) * t;
        }
      }
    }
  }
  for (let k = 0; k < V * V; k++) {
    let h = base[k];
    const d = roadDist[k];
    if (d < 4.2 + REACH) {
      const crown = -0.012 * Math.min(d, 4.2) ** 2;
      const target = roadH[k] + crown;
      // shoulders: cut/fill slopes no steeper than ~1:2.5, so a car that slides off can drive back
      const sh = Math.min(REACH, Math.max(SHOULDER, Math.abs(base[k] - target) * 2.5));
      const w = 1 - smoothstep(4.2 + 0.8, 4.2 + sh, d);
      h = lerp(h, target, w);
    }
    if (lake) {
      const i = k % V, j = (k / V) | 0, x = -half + i * cell, z = -half + j * cell;
      const dl = Math.hypot(x - lake.x, z - lake.z);
      if (dl < lake.r + 18) h = lerp(h, lake.y, (1 - smoothstep(lake.r - 2, lake.r + 18, dl)) * smoothstep(10, 26, roadDist[k]));
    }
    heights[k] = h;
  }

  // ground surface per vertex (when off-road)
  const ground = new Uint8Array(V * V);
  const slope = (i, j) => {
    const hx = heights[j * V + Math.min(N, i + 1)] - heights[j * V + Math.max(0, i - 1)];
    const hz = heights[Math.min(N, j + 1) * V + i] - heights[Math.max(0, j - 1) * V + i];
    return Math.hypot(hx, hz) / (2 * cell);
  };
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i;
    const x = -half + i * cell, z = -half + j * cell;
    let s = biome[k] === BIOME.SNOW ? S.SNOW : biome[k] === BIOME.ASPHALT ? S.GRASS : (fbm(nB, x * 0.03, z * 0.03, 2) > 0.05 ? S.SAND : S.DIRT);
    if (slope(i, j) > 0.95) s = S.ROCK;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r) s = S.ICE;
    ground[k] = s;
  }

  const W = {
    N, V, cell, half, size, heights, biome, bsnow, basph, bdirt, roadDist, roadType, roadIdx, ground, roads, loop, lake, seed,
  };

  // ---------- sampling (same triangulation as the render mesh: diagonal (i,j)->(i+1,j+1))
  function sampleTri(arr, x, z) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    if (fx < 0) fx = 0; else if (fx > N - 1e-4) fx = N - 1e-4;
    if (fz < 0) fz = 0; else if (fz > N - 1e-4) fz = N - 1e-4;
    const i = fx | 0, j = fz | 0, u = fx - i, w = fz - j, k = j * V + i;
    const h00 = arr[k], h10 = arr[k + 1], h01 = arr[k + V], h11 = arr[k + V + 1];
    if (u > w) return h00 + (h10 - h00) * u + (h11 - h10) * w;
    return h00 + (h11 - h01) * u + (h01 - h00) * w;
  }
  W.heightAt = (x, z) => sampleTri(heights, x, z);
  W.normalAt = function (x, z, out) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    if (fx < 0) fx = 0; else if (fx > N - 1e-4) fx = N - 1e-4;
    if (fz < 0) fz = 0; else if (fz > N - 1e-4) fz = N - 1e-4;
    const i = fx | 0, j = fz | 0, u = fx - i, w = fz - j, k = j * V + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + V], h11 = heights[k + V + 1];
    let dhdx, dhdz, h;
    if (u > w) { dhdx = (h10 - h00) / cell; dhdz = (h11 - h10) / cell; h = h00 + (h10 - h00) * u + (h11 - h10) * w; }
    else { dhdx = (h11 - h01) / cell; dhdz = (h01 - h00) / cell; h = h00 + (h11 - h01) * u + (h01 - h00) * w; }
    const l = Math.hypot(dhdx, 1, dhdz);
    out[0] = -dhdx / l; out[1] = 1 / l; out[2] = -dhdz / l;
    return h;
  };
  // bilinear road distance (distance fields interpolate cleanly)
  W.roadDistAt = function (x, z) {
    let fx = (x + half) / cell, fz = (z + half) / cell;
    fx = clamp(fx, 0, N - 1e-4); fz = clamp(fz, 0, N - 1e-4);
    const i = fx | 0, j = fz | 0, u = fx - i, w = fz - j, k = j * V + i;
    return (roadDist[k] * (1 - u) + roadDist[k + 1] * u) * (1 - w) + (roadDist[k + V] * (1 - u) + roadDist[k + V + 1] * u) * w;
  };
  const nearestK = (x, z) => clamp(Math.round((z + half) / cell), 0, N) * V + clamp(Math.round((x + half) / cell), 0, N);
  W.surfaceAt = function (x, z) {
    const k = nearestK(x, z);
    if (W.roadDistAt(x, z) < 4.2 && roadType[k]) return ROAD_SURF[roadType[k]];
    return ground[k];
  };
  W.biomeAt = (x, z) => biome[nearestK(x, z)];
  W.biomeWeights = (x, z, out = [0, 0, 0]) => biomeWeights(x, z, out);
  W.isOnRoad = (x, z, margin = 0) => W.roadDistAt(x, z) < 4.2 + margin;

  // spawn: on the loop, in the dirt/asphalt band, facing along the road
  {
    let best = 0, score = -Infinity;
    loop.pts.forEach((p, i) => {
      biomeWeights(p.x, p.z, bw);
      const sc = -Math.abs(bw[1] - 0.5) - bw[0] * 2 - Math.abs(p.z - 260) * 0.002;
      if (sc > score) { score = sc; best = i; }
    });
    const p = loop.pts[best];
    W.spawn = { x: p.x, z: p.z, heading: Math.atan2(p.tx, p.tz), idx: best };
  }
  return W;
}
