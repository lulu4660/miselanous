// Vegetation and rock geometries from licensed asset packs (built by dev/build-assets.mjs into
// src/assets/props.gen.js): per kind, a few variants with linear vertex colours and a sway
// weight (0 at the base, 1 at the top) for the wind shader. Decoded once.
import * as THREE from 'three';
import { PROP_ASSETS } from '../assets/props.gen.js';

function decode(b64, Type) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}
const cache = new Map();
// kind: 'pine' | 'tree' | 'bush' | 'rock' | 'mesa' | 'cactus'; names: which variants, in order
// grey: replace the colours by their luminance, rescaled so the model's mean is this value (the
// per-instance colour then tints it, e.g. rocks per biome)
export function propVariants(kind, names, { sway = 1, grey = 0 } = {}) {
  const key = kind + ':' + names.join(',') + ':' + sway + ':' + grey;
  if (cache.has(key)) return cache.get(key);
  const list = PROP_ASSETS[kind].filter((p) => names.includes(p.name)).sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
  const out = list.map((p) => {
    const g = new THREE.BufferGeometry();
    const pos = decode(p.pos, Float32Array);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(decode(p.nrm, Int8Array), 3, true));
    const c8 = decode(p.col, Uint8Array), col = new Float32Array(c8.length);
    for (let i = 0; i < c8.length; i++) { const v = c8[i] / 255; col[i] = v * v; } // sqrt-encoded linear
    if (grey) {
      let sum = 0;
      for (let i = 0; i < col.length; i += 3) sum += col[i] * 0.2126 + col[i + 1] * 0.7152 + col[i + 2] * 0.0722;
      const k = grey / Math.max(1e-4, sum / (col.length / 3));
      for (let i = 0; i < col.length; i += 3) col[i] = col[i + 1] = col[i + 2] = Math.min(1, (col[i] * 0.2126 + col[i + 1] * 0.7152 + col[i + 2] * 0.0722) * k);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sw = new Float32Array(p.n);
    for (let i = 0; i < p.n; i++) sw[i] = sway ? Math.pow(Math.max(0, Math.min(1, pos[i * 3 + 1] / p.h)), 1.5) * sway : 0;
    g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
    g.setIndex(new THREE.BufferAttribute(decode(p.idx, p.i32 ? Uint32Array : Uint16Array), 1));
    g.computeBoundingSphere();
    return { name: p.name, geo: g, h: p.h, w: p.w, tris: p.tris };
  });
  if (out.length !== names.length) throw new Error(`props ${kind}: expected ${names.join(',')}, found ${out.map((o) => o.name).join(',')}`);
  cache.set(key, out);
  return out;
}
