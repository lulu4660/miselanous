// Interactive shallow-water ripple simulation on a window that follows the car.
// Wave speed depends on depth (c^2 = g*d), land cells are reflective walls,
// a sponge layer absorbs waves at the window border. Renderer-free.
import { WORLD } from './terrain.js';

const G = 9.81;

export function createWaves(terrain, { n = 128, cell = 0.5 } = {}) {
  const N = n;
  const h = new Float32Array(N * N);
  const v = new Float32Array(N * N);
  const foam = new Float32Array(N * N);
  const c2 = new Float32Array(N * N);   // wave speed squared (0 = land/wall)
  const sponge = new Float32Array(N * N);
  const tmpA = new Float32Array(N * N);
  const tmpB = new Float32Array(N * N);
  const tmpC = new Float32Array(N * N);
  const size = N * cell;
  const W = {
    n: N, cell, size,
    ox: 0, oz: 0, // world position of cell (0,0) centre
    h, v, foam, c2,
    time: 0,
    pixels: new Uint8Array(N * N * 4),
  };

  const SP = 10;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = Math.min(i, j, N - 1 - i, N - 1 - j);
    sponge[j * N + i] = e >= SP ? 1 : 0.86 + 0.14 * (e / SP);
  }

  function computeC2(i0, i1, j0, j1) {
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const x = W.ox + i * cell, z = W.oz + j * cell;
      const d = WORLD.waterLevel - terrain.heightAt(x, z);
      c2[j * N + i] = d <= 0.02 ? 0 : Math.min(G * Math.max(d, 0.12), 7.5);
    }
  }

  W.recenter = function (x, z, force = false) {
    const nox = Math.floor((x - size / 2) / cell) * cell;
    const noz = Math.floor((z - size / 2) / cell) * cell;
    const di = Math.round((nox - W.ox) / cell);
    const dj = Math.round((noz - W.oz) / cell);
    if (!force && Math.abs(di) < 4 && Math.abs(dj) < 4) return false;
    if (force || Math.abs(di) >= N || Math.abs(dj) >= N) {
      h.fill(0); v.fill(0); foam.fill(0);
      W.ox = nox; W.oz = noz;
      computeC2(0, N, 0, N);
      return true;
    }
    // shift arrays by (di,dj)
    for (const arr of [h, v, foam]) {
      tmpA.set(arr);
      for (let j = 0; j < N; j++) {
        const sj = j + dj;
        for (let i = 0; i < N; i++) {
          const si = i + di;
          arr[j * N + i] = si >= 0 && si < N && sj >= 0 && sj < N ? tmpA[sj * N + si] : 0;
        }
      }
    }
    tmpA.set(c2);
    for (let j = 0; j < N; j++) {
      const sj = j + dj;
      for (let i = 0; i < N; i++) {
        const si = i + di;
        c2[j * N + i] = si >= 0 && si < N && sj >= 0 && sj < N ? tmpA[sj * N + si] : -1;
      }
    }
    W.ox = nox; W.oz = noz;
    // fill new cells
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (c2[j * N + i] < 0) {
        const x = W.ox + i * cell, zz = W.oz + j * cell;
        const d = WORLD.waterLevel - terrain.heightAt(x, zz);
        c2[j * N + i] = d <= 0.02 ? 0 : Math.min(G * Math.max(d, 0.12), 7.5);
      }
    }
    return true;
  };

  W.step = function (dt) {
    W.time += dt;
    const inv = 1 / (cell * cell);
    const damp = Math.pow(0.35, dt); // per-second velocity damping factor
    const hdamp = Math.pow(0.6, dt);
    for (let j = 1; j < N - 1; j++) {
      const row = j * N;
      for (let i = 1; i < N - 1; i++) {
        const k = row + i;
        const c = c2[k];
        if (c === 0) { v[k] = 0; h[k] = 0; continue; }
        // walls reflect: use own height for land neighbours (Neumann)
        const hc = h[k];
        const hl = c2[k - 1] === 0 ? hc : h[k - 1];
        const hr = c2[k + 1] === 0 ? hc : h[k + 1];
        const hu = c2[k - N] === 0 ? hc : h[k - N];
        const hd = c2[k + N] === 0 ? hc : h[k + N];
        v[k] = (v[k] + c * (hl + hr + hu + hd - 4 * hc) * inv * dt) * damp * sponge[k];
      }
    }
    const fdec = Math.pow(0.42, dt);
    for (let k = 0; k < N * N; k++) {
      h[k] = (h[k] + v[k] * dt) * hdamp * sponge[k];
      if (h[k] > 0.6) h[k] = 0.6; else if (h[k] < -0.6) h[k] = -0.6;
      const agit = Math.abs(v[k]);
      const f = foam[k] * fdec + (agit > 0.12 ? (agit - 0.12) * dt * 6 : 0);
      foam[k] = f > 1 ? 1 : f;
    }
  };

  // Push water: adds a gaussian velocity impulse (negative = depression)
  W.disturb = function (x, z, amount, radius = 1) {
    const ci = (x - W.ox) / cell, cj = (z - W.oz) / cell;
    const rr = Math.max(1, radius / cell);
    const r0 = Math.ceil(rr * 1.8);
    const i0 = Math.max(1, Math.floor(ci - r0)), i1 = Math.min(N - 2, Math.ceil(ci + r0));
    const j0 = Math.max(1, Math.floor(cj - r0)), j1 = Math.min(N - 2, Math.ceil(cj + r0));
    const inv = 1 / (rr * rr);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      if (c2[k] === 0) continue;
      const d2 = ((i - ci) * (i - ci) + (j - cj) * (j - cj)) * inv;
      if (d2 > 3.2) continue;
      v[k] += amount * Math.exp(-d2);
    }
  };
  W.addFoam = function (x, z, amount, radius = 1) {
    const ci = (x - W.ox) / cell, cj = (z - W.oz) / cell;
    const rr = Math.max(1, radius / cell);
    const r0 = Math.ceil(rr * 1.5);
    const i0 = Math.max(0, Math.floor(ci - r0)), i1 = Math.min(N - 1, Math.ceil(ci + r0));
    const j0 = Math.max(0, Math.floor(cj - r0)), j1 = Math.min(N - 1, Math.ceil(cj + r0));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      if (c2[k] === 0) continue;
      const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (rr * rr);
      if (d2 > 2.2) continue;
      foam[k] = Math.min(1, foam[k] + amount * Math.exp(-d2));
    }
  };

  // Bilinear sample of the sim height; 0 outside the window.
  W.heightAt = function (x, z) {
    const fx = (x - W.ox) / cell, fz = (z - W.oz) / cell;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return 0;
    const i = fx | 0, j = fz | 0, u = fx - i, w = fz - j;
    const k = j * N + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - w) + (h[k + N] * (1 - u) + h[k + N + 1] * u) * w;
  };
  // gradient (central difference), writes into out[0], out[1]
  W.gradAt = function (x, z, out) {
    const e = cell;
    out[0] = (W.heightAt(x + e, z) - W.heightAt(x - e, z)) / (2 * e);
    out[1] = (W.heightAt(x, z + e) - W.heightAt(x, z - e)) / (2 * e);
    return out;
  };

  // Pack h / gradient / foam into RGBA8 for the water shader.
  W.pack = function () {
    const px = W.pixels;
    const sH = 127 / 0.35, sG = 127 / 0.6;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const hl = i > 0 ? h[k - 1] : h[k], hr = i < N - 1 ? h[k + 1] : h[k];
        const hu = j > 0 ? h[k - N] : h[k], hd = j < N - 1 ? h[k + N] : h[k];
        const gx = (hr - hl) / (2 * cell), gz = (hd - hu) / (2 * cell);
        const o = k * 4;
        px[o] = clampByte(128 + h[k] * sH);
        px[o + 1] = clampByte(128 + gx * sG);
        px[o + 2] = clampByte(128 + gz * sG);
        px[o + 3] = clampByte(foam[k] * 255);
      }
    }
    return px;
  };

  return W;
}

function clampByte(x) { return x < 0 ? 0 : x > 255 ? 255 : x | 0; }

// Global water surface = still level + gentle analytic swell + interactive sim.
export function createWaterSurface(waves) {
  const S = {
    time: 0,
    swellAt(x, z, t = S.time) {
      return Math.sin(x * 0.11 + t * 0.9) * 0.035 + Math.sin(z * 0.087 - t * 0.7 + x * 0.03) * 0.03
        + Math.sin((x + z) * 0.23 + t * 1.7) * 0.012;
    },
    levelAt(x, z) {
      return WORLD.waterLevel + S.swellAt(x, z) + waves.heightAt(x, z);
    },
  };
  return S;
}
