// Instanced, chunked vegetation for the three biomes: snowy pines, round trees and grass in
// the hills, cacti and dry bushes in the canyons, rocks everywhere. Chunks are frustum- and
// distance-culled; trees, cacti and big rocks are returned as physics obstacles.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { colorize, colorizeFn, place, merge, hash01 } from './geo.js';
import { mulberry32 } from '../noise.js';

const up = new THREE.Vector3(0, 1, 0);

// Low-poly tuft: each blade is a single tapered triangle (cheap, reads well from above).
function bladeTuft(rnd, { blades = 6, hMin = 0.4, hMax = 0.85, base = '#9a8a4a', tip = '#ecc96a', spread = 0.4, width = 0.11, reed = false }) {
  const pos = [], col = [], nor = [], sway = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.8;
    const r0 = rnd() * spread * 0.5;
    const ox = Math.cos(a) * r0, oz = Math.sin(a) * r0;
    const h = hMin + rnd() * (hMax - hMin);
    const lean = (0.12 + rnd() * 0.3) * (reed ? 0.25 : 1) * h;
    const px = -Math.sin(a) * width, pz = Math.cos(a) * width;
    const tx = ox + Math.cos(a) * lean, tz = oz + Math.sin(a) * lean;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    col.push(cb.r, cb.g, cb.b, cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    sway.push(1, 1, 1);
    if (reed && rnd() < 0.6) {
      // little cattail head as a thin diamond
      const hy = h * 0.88, w = 0.05;
      const quads = [[tx - w, hy, tz], [tx + w, hy, tz], [tx, hy + 0.22, tz], [tx, hy - 0.06, tz]];
      for (const [i0, i1, i2] of [[0, 1, 2], [1, 0, 3]]) {
        for (const q of [quads[i0], quads[i1], quads[i2]]) { pos.push(q[0], q[1], q[2]); col.push(0.46, 0.3, 0.19); nor.push(0, 1, 0); sway.push(1); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.computeBoundingSphere();
  return g;
}

function chunkedInstances(geo, mat, items, { chunk = 40, cast = false, receive = true, color } = {}) {
  const group = new THREE.Group();
  const buckets = new Map();
  for (const it of items) {
    const key = Math.floor(it.x / chunk) + ',' + Math.floor(it.z / chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const c = new THREE.Color();
  for (const list of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      e.set(it.tilt || 0, it.rot || 0, it.tilt2 || 0);
      q.setFromEuler(e);
      s.set(it.s, it.sy ?? it.s, it.s);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      if (color) im.setColorAt(i, c.set(color(it)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = cast; im.receiveShadow = receive;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

function blob(rnd, r, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash01(Math.round(x * 50) * 7 + Math.round(y * 50) * 13 + Math.round(z * 50) * 29) - 0.5) * 0.25;
    p.setXYZ(i, x * k, Math.max(y * k, -r * 0.35), z * k);
  }
  g.computeVertexNormals();
  return g;
}


function pineGeo(rnd, snowy) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6); place(trunk, { y: 1.1 }); colorize(trunk, '#6b4a3a'); parts.push(trunk);
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const r = 2.1 - t * 0.42, h = 2.0 - t * 0.15, y = 1.6 + t * 1.25;
    const cone = new THREE.ConeGeometry(r, h, 7, 1); place(cone, { y: y + h / 2, ry: rnd() * 6 });
    colorizeFn(cone, (x, yy) => (snowy && yy > y + h * 0.15 ? (yy > y + h * 0.45 ? '#f4f7fd' : '#cfdbe8') : t % 2 ? '#3e6b4a' : '#355f43'));
    parts.push(cone);
  }
  const g = merge(parts);
  const sw = new Float32Array(g.attributes.position.count).fill(1);
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  return g;
}
function roundTreeGeo(rnd) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6); place(trunk, { y: 1.3 }); colorize(trunk, '#7a5a40'); parts.push(trunk);
  for (let k = 0; k < 3; k++) {
    const b = blob(rnd, 1.4 + rnd() * 0.5, 1);
    place(b, { x: (rnd() - 0.5) * 1.4, y: 3.3 + rnd() * 0.9, z: (rnd() - 0.5) * 1.4 });
    colorizeFn(b, (x, y) => (y > 3.9 ? '#9cc35c' : y > 3.3 ? '#78a84f' : '#5c8a44'));
    parts.push(b);
  }
  const g = merge(parts);
  g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return g;
}
function cactusGeo(rnd) {
  const parts = [];
  const main = new THREE.CapsuleGeometry(0.28, 2.6, 3, 8); place(main, { y: 1.55 }); parts.push(main);
  for (const s of [-1, 1]) {
    if (rnd() < 0.25) continue;
    const h = 0.8 + rnd() * 0.7, y = 1.0 + rnd() * 0.8;
    const arm = new THREE.CapsuleGeometry(0.19, 0.45, 3, 6); arm.rotateZ(Math.PI / 2); place(arm, { x: s * 0.45, y }); parts.push(arm);
    const up = new THREE.CapsuleGeometry(0.19, h, 3, 6); place(up, { x: s * 0.72, y: y + h / 2 + 0.1 }); parts.push(up);
  }
  parts.forEach((p) => colorizeFn(p, (x, y, z) => (Math.abs(Math.atan2(z, x) * 4 % 1) < 0.25 ? '#4f7a46' : '#6a9655')));
  const g = merge(parts);
  g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(0), 1));
  return g;
}

export function createVegetation(world, quality) {
  const group = new THREE.Group();
  const rnd = mulberry32(911);
  const obstacles = [];
  const half = world.half - 8;
  const free = (x, z, m = 8) => world.roadDistAt(x, z) > m;
  const nrm = [0, 1, 0];
  // most of what you see is within ~60 m of a road: bias part of the samples there
  const roadPts = world.roads.flatMap((r) => r.pts);
  const sample = (nearShare, maxOff = 60) => {
    if (rnd() < nearShare) {
      const p = roadPts[Math.floor(rnd() * roadPts.length)];
      const off = (5 + rnd() * rnd() * maxOff) * (rnd() < 0.5 ? -1 : 1), along = (rnd() - 0.5) * 4;
      return [Math.max(-half, Math.min(half, p.x - p.tz * off + p.tx * along)), Math.max(-half, Math.min(half, p.z + p.tx * off + p.tz * along))];
    }
    return [(rnd() * 2 - 1) * half, (rnd() * 2 - 1) * half];
  };
  const pick = (count, tries, accept, nearShare = 0.45) => {
    const out = [];
    for (let k = 0; k < tries && out.length < count; k++) {
      const [x, z] = sample(nearShare);
      const it = accept(x, z);
      if (it) out.push(it);
    }
    return out;
  };
  const bw = [0, 0, 0];
  const lush = (x, z) => Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2) * 0.5 + 0.5;

  // --- pines: snow biome and the upper hills
  const pinesSnow = pick(quality.trees * 0.45, 40000, (x, z) => {
    world.biomeWeights(x, z, bw);
    if (bw[0] < 0.5 || !free(x, z, 9) || world.normalAt(x, z, nrm) < -999 || nrm[1] < 0.82) return null;
    if (rnd() > 0.35 + lush(x, z) * 0.5) return null;
    return { x, z, y: world.heightAt(x, z) - 0.2, s: 0.8 + rnd() * 0.7, rot: rnd() * 6.28 };
  });
  const pinesGreen = pick(quality.trees * 0.2, 30000, (x, z) => {
    world.biomeWeights(x, z, bw);
    if (bw[1] < 0.5 || !free(x, z, 9) || (world.normalAt(x, z, nrm), nrm[1] < 0.85)) return null;
    if (lush(x, z) < 0.55 || rnd() > 0.5) return null;
    return { x, z, y: world.heightAt(x, z) - 0.2, s: 0.8 + rnd() * 0.6, rot: rnd() * 6.28 };
  });
  const trees = pick(quality.trees * 0.35, 30000, (x, z) => {
    world.biomeWeights(x, z, bw);
    if (bw[1] < 0.55 || !free(x, z, 8) || (world.normalAt(x, z, nrm), nrm[1] < 0.88)) return null;
    if (rnd() > 0.25 + lush(x, z) * 0.6) return null;
    return { x, z, y: world.heightAt(x, z) - 0.15, s: 0.75 + rnd() * 0.6, rot: rnd() * 6.28 };
  });
  const cacti = pick(quality.trees * 0.25, 30000, (x, z) => {
    world.biomeWeights(x, z, bw);
    if (bw[2] < 0.6 || !free(x, z, 7) || (world.normalAt(x, z, nrm), nrm[1] < 0.9) || rnd() > 0.5) return null;
    return { x, z, y: world.heightAt(x, z) - 0.1, s: 0.8 + rnd() * 0.6, rot: rnd() * 6.28 };
  });
  const rocks = pick(quality.trees * 0.4, 40000, (x, z) => {
    const s = 0.5 + rnd() * rnd() * 2.4;
    if (!free(x, z, 7.5 + s * 1.2)) return null; // big rocks keep clear of the carriageway
    world.biomeWeights(x, z, bw);
    return { x, z, y: world.heightAt(x, z) - s * 0.3, s, rot: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.5, sy: s * (0.6 + rnd() * 0.5), biome: bw.indexOf(Math.max(...bw)) };
  });
  const bushes = pick(quality.trees * 0.5, 30000, (x, z) => {
    if (!free(x, z, 6)) return null;
    world.biomeWeights(x, z, bw);
    if (bw[0] > 0.5) return null;
    return { x, z, y: world.heightAt(x, z) - 0.15, s: 0.5 + rnd() * 0.7, rot: rnd() * 6.28, hue: rnd(), dry: bw[2] > bw[1] };
  });

  const veg = (o) => patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, ...o }), { wind: 0.0012, cutout: 1 });
  const add = (geo, mat, list, opts) => { const g = chunkedInstances(geo, mat, list, { chunk: 80, ...opts }); group.add(g); return g; };
  const pineMat = veg({ flatShading: true });
  add(pineGeo(rnd, true), pineMat, pinesSnow, { cast: true });
  add(pineGeo(rnd, false), pineMat, pinesGreen, { cast: true });
  add(roundTreeGeo(rnd), veg({ flatShading: true }), trees, { cast: true });
  add(cactusGeo(rnd), veg({}), cacti, { cast: true });
  const bushGeo = (() => { const parts = []; for (let k = 0; k < 3; k++) { const b = blob(rnd, 0.55 + rnd() * 0.25, 1); place(b, { x: (rnd() - 0.5) * 0.8, y: 0.3 + rnd() * 0.15, z: (rnd() - 0.5) * 0.8 }); colorizeFn(b, (x, y) => (y > 0.5 ? '#ffffff' : y > 0.2 ? '#dedede' : '#b8b8b8')); parts.push(b); } const g = merge(parts); g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(0.5), 1)); return g; })();
  add(bushGeo, veg({ flatShading: true }), bushes, { cast: true, color: (it) => (it.dry ? new THREE.Color().setHSL(0.11 + it.hue * 0.04, 0.35, 0.5) : new THREE.Color().setHSL(0.24 + it.hue * 0.06, 0.4, 0.42)) });
  const rockMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { cutout: 1 });
  const rockGeo = (() => { const g = new THREE.DodecahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + Math.sin(x * 3.1) * 0.12 + Math.cos(z * 2.7 + y * 1.9) * 0.12; p.setXYZ(i, x * n, y * n * 0.75, z * n); } g.computeVertexNormals(); return colorizeFn(g, (x, y) => (y > 0.4 ? '#ffffff' : '#d9d9d9')); })();
  const rockTint = ['#9a9cad', '#a7a493', '#c98a62'];
  add(rockGeo, rockMat, rocks, { cast: true, color: (it) => new THREE.Color(rockTint[it.biome]) });

  // --- grass tufts (green hills, dry canyons), clustered
  const grassMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { wind: 0.14, push: 2.4 });
  const greenGeo = bladeTuft(rnd, { base: '#4f7f3a', tip: '#a9cc6a' }), dryGeo = bladeTuft(rnd, { base: '#8a7a3c', tip: '#e6c771' });
  const greens = [], drys = [];
  for (let k = 0; k < quality.grass * 4 && greens.length + drys.length < quality.grass; k++) {
    const [cx, cz] = sample(0.8, 30);
    world.biomeWeights(cx, cz, bw);
    if (bw[0] > 0.4 || !free(cx, cz, 5.5)) continue;
    const list = bw[1] > bw[2] ? greens : drys;
    const n = 3 + Math.floor(rnd() * 8);
    for (let q = 0; q < n; q++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 2.5;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!free(x, z, 5)) continue;
      list.push({ x, z, y: world.heightAt(x, z) - 0.03, s: 0.8 + rnd() * 0.6, rot: rnd() * 6.28 });
    }
  }
  add(greenGeo, grassMat, greens, { chunk: 50 });
  add(dryGeo, grassMat, drys, { chunk: 50 });

  // --- wild flowers in the green hills, in drifts along the verges (instance colour = petal tint)
  const flowerGeo = (() => {
    const parts = [];
    for (let k = 0; k < 5; k++) {
      const a = rnd() * 6.28, r = rnd() * 0.22, h = 0.28 + rnd() * 0.3;
      const stem = new THREE.CylinderGeometry(0.012, 0.016, h, 3); place(stem, { x: Math.cos(a) * r, y: h / 2, z: Math.sin(a) * r });
      colorize(stem, '#4f8a3c'); parts.push(stem);
      const head = new THREE.IcosahedronGeometry(0.055 + rnd() * 0.03, 0); place(head, { x: Math.cos(a) * r, y: h + 0.02, z: Math.sin(a) * r });
      colorize(head, '#ffffff'); parts.push(head);
    }
    const g = merge(parts);
    g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
    return g;
  })();
  const flowers = [];
  const PETALS = ['#f6f1e6', '#ffd44a', '#c98bdc', '#ff8a6a', '#8fb8ff'];
  for (let k = 0; k < quality.grass && flowers.length < quality.grass * 0.35; k++) {
    const [cx, cz] = sample(0.85, 22);
    world.biomeWeights(cx, cz, bw);
    if (bw[1] < 0.6 || !free(cx, cz, 5.2)) continue;
    const hue = PETALS[Math.floor(rnd() * PETALS.length)];
    const n = 10 + Math.floor(rnd() * 10);
    for (let q = 0; q < n; q++) {
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 2.6;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!free(x, z, 5)) continue;
      flowers.push({ x, z, y: world.heightAt(x, z) - 0.02, s: 0.8 + rnd() * 0.5, rot: rnd() * 6.28, hue });
    }
  }
  add(flowerGeo, grassMat, flowers, { chunk: 50, color: (it) => it.hue });

  // --- roadside markers: reflector posts on asphalt, striped snow poles, wooden fence posts on dirt
  const postMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { cutout: 1 });
  const reflector = (() => {
    const b = new THREE.BoxGeometry(0.13, 0.95, 0.13, 1, 4, 1); b.translate(0, 0.47, 0);
    return colorizeFn(b, (x, y) => (y > 0.82 ? '#26232b' : y > 0.66 && y < 0.8 ? '#ff8a2a' : '#f4f1ea'));
  })();
  const snowPole = (() => {
    const c = new THREE.CylinderGeometry(0.045, 0.05, 2.0, 6, 8); c.translate(0, 1.0, 0);
    return colorizeFn(c, (x, y) => (Math.floor(y / 0.25) % 2 ? '#f4f1ea' : '#e2402f'));
  })();
  const fencePost = (() => {
    const b = new THREE.BoxGeometry(0.14, 0.85, 0.14); b.translate(0, 0.42, 0);
    const top = new THREE.BoxGeometry(0.16, 0.06, 0.16); top.translate(0, 0.86, 0);
    return merge([colorize(b, '#8a5a36'), colorize(top, '#6e4428')]);
  })();
  const posts = { 1: [], 2: [], 3: [] };
  const spacing = { 1: 9, 2: 8, 3: 6 };
  for (const road of world.roads) {
    const P = road.pts;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], step = spacing[p.type] || 8;
      if (i % step) continue;
      if (p.type === 2 && rnd() < 0.35) continue;
      for (const side of [-1, 1]) {
        const off = (p.type === 3 ? 5.0 : 5.4) * side;
        const x = p.x - p.tz * off, z = p.z + p.tx * off;
        if (world.roadDistAt(x, z) < 4.9) continue; // junctions
        posts[p.type].push({ x, z, y: world.heightAt(x, z) - 0.05, s: 1, rot: Math.atan2(p.tx, p.tz), tilt: p.type === 2 ? (rnd() - 0.5) * 0.12 : 0 });
      }
    }
  }
  add(reflector, postMat, posts[1], { chunk: 80 });
  add(fencePost, postMat, posts[2], { chunk: 80 });
  add(snowPole, postMat, posts[3], { chunk: 80 });

  for (const it of [...pinesSnow, ...pinesGreen]) obstacles.push({ x: it.x, z: it.z, r: 0.3 * it.s + 0.1, y0: it.y - 1, y1: it.y + 6, kind: 'wood' });
  for (const it of trees) obstacles.push({ x: it.x, z: it.z, r: 0.32 * it.s + 0.1, y0: it.y - 1, y1: it.y + 4, kind: 'wood' });
  for (const it of cacti) obstacles.push({ x: it.x, z: it.z, r: 0.3 * it.s, y0: it.y - 1, y1: it.y + 3, kind: 'wood' });
  for (const it of rocks) if (it.s > 1) obstacles.push({ x: it.x, z: it.z, r: it.s * 0.8, y0: it.y - 2, y1: it.y + it.sy * 0.6, kind: 'rock', shape: 'sphere' });

  // distance culling of whole chunks (cheap: one test per chunk)
  const chunks = [];
  group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.computeBoundingSphere(); chunks.push(o); } });
  return {
    group, obstacles,
    cull(camPos, far) {
      for (const m of chunks) {
        const bs = m.boundingSphere;
        if (!bs) { m.computeBoundingSphere(); continue; }
        const d = Math.hypot(bs.center.x - camPos.x, bs.center.z - camPos.z) - bs.radius;
        m.visible = d < far * (m.geometry.attributes.position.count < 200 ? 0.45 : 1);
      }
    },
  };
}
