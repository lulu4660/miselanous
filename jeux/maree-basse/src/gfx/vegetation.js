// Instanced vegetation & rocks: golden grass tufts and reeds that bend away from the car,
// swaying palms, soft bushes, stratified boulders.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { colorize, colorizeFn, place, merge, hash01 } from './geo.js';
import { mulberry32 } from '../noise.js';

const up = new THREE.Vector3(0, 1, 0);

function bladeTuft(rnd, { blades = 15, hMin = 0.35, hMax = 0.8, base = '#8a7a36', tip = '#f6dc86', spread = 0.42, width = 0.075, reed = false }) {
  const pos = [], col = [], nor = [], sway = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip), c = new THREE.Color();
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r0 = rnd() * spread * 0.5;
    const ox = Math.cos(a) * r0, oz = Math.sin(a) * r0;
    const h = hMin + rnd() * (hMax - hMin);
    const lean = (0.15 + rnd() * 0.35) * (reed ? 0.3 : 1);
    const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
    const px = -Math.sin(a), pz = Math.cos(a); // perpendicular for width
    const segs = 3;
    const pts = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = width * (1 - t * 0.85);
      const x = ox + dx * t * t * h, y = h * t, z = oz + dz * t * t * h;
      pts.push([x - px * w, y, z - pz * w, t], [x + px * w, y, z + pz * w, t]);
    }
    for (let s = 0; s < segs; s++) {
      const q = [pts[s * 2], pts[s * 2 + 1], pts[s * 2 + 2], pts[s * 2 + 3]];
      for (const k of [0, 2, 1, 1, 2, 3]) {
        const p = q[k];
        pos.push(p[0], p[1], p[2]);
        c.copy(cb).lerp(ct, Math.pow(p[3], 0.8));
        col.push(c.r, c.g, c.b);
        nor.push(0, 1, 0);
        sway.push(1);
      }
    }
    if (reed && rnd() < 0.7) {
      // cattail head
      const hx = ox + dx * h, hz = oz + dz * h;
      const cap = new THREE.CylinderGeometry(0.035, 0.035, 0.2, 5).toNonIndexed();
      cap.translate(hx, h * 0.92, hz);
      const cp = cap.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        pos.push(cp.getX(i), cp.getY(i), cp.getZ(i));
        col.push(0.42, 0.27, 0.17);
        nor.push(0, 1, 0); sway.push(1);
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

function frondTexture() {
  const W = 512, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const mid = H / 2;
  // leaflets
  for (let x = 14; x < W - 6; x += 6) {
    const t = x / W;
    const L = (H * 0.5 - 4) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55) * (0.85 + Math.random() * 0.15);
    for (const sd of [-1, 1]) {
      const ang = (0.95 + Math.random() * 0.25) * sd;
      const ex = x + Math.cos(ang) * L * 0.55, ey = mid + Math.sin(ang) * L;
      const light = 38 + t * 22 + Math.random() * 8;
      const grad = g.createLinearGradient(x, mid, ex, ey);
      grad.addColorStop(0, `hsl(${92 - t * 22}, ${42 + t * 10}%, ${light - 12}%)`);
      grad.addColorStop(1, `hsl(${78 - t * 20}, ${48 + t * 10}%, ${light + 6}%)`);
      g.fillStyle = grad;
      g.beginPath();
      const px = -Math.sin(ang) * 3.2, py = Math.cos(ang) * 0.9;
      g.moveTo(x - 2, mid);
      g.quadraticCurveTo(x + (ex - x) * 0.5 + px, mid + (ey - mid) * 0.5 + py, ex, ey);
      g.quadraticCurveTo(x + (ex - x) * 0.5 - px, mid + (ey - mid) * 0.5 - py, x + 3, mid);
      g.closePath();
      g.fill();
    }
  }
  // rachis
  g.strokeStyle = '#8a8a3c';
  g.lineWidth = 3.2;
  g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function palmGeometry(rnd, lean, height) {
  const parts = [];
  // curved trunk
  const top = new THREE.Vector3(lean * height, height, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(lean * height * 0.15, height * 0.55, 0), top);
  const trunk = new THREE.TubeGeometry(curve, 16, 0.2, 7, false);
  const tp = trunk.attributes.position;
  const uv = trunk.attributes.uv;
  const ca = new THREE.Color('#86664c'), cb = new THREE.Color('#b08e69'), cc = new THREE.Color();
  const cols = [];
  for (let i = 0; i < tp.count; i++) {
    const t = uv.getX(i);
    const center = curve.getPoint(t);
    const k = 1.25 - t * 0.5;
    tp.setXYZ(i, center.x + (tp.getX(i) - center.x) * k, center.y + (tp.getY(i) - center.y) * k, center.z + (tp.getZ(i) - center.z) * k);
    const band = Math.sin(t * height * 7.5) > 0.2 ? 1 : 0;
    cc.copy(ca).lerp(cb, band * 0.8 + t * 0.2);
    cols.push(cc.r, cc.g, cc.b);
  }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  trunk.deleteAttribute('uv');
  trunk.computeVertexNormals();
  parts.push(trunk);
  const bulb = new THREE.SphereGeometry(0.32, 8, 6); place(bulb, { x: top.x, y: top.y, z: top.z }); colorize(bulb, '#6f5a3d'); parts.push(bulb);
  for (let k = 0; k < 4; k++) {
    const a = rnd() * 6.28;
    const cn = new THREE.SphereGeometry(0.16, 8, 6); place(cn, { x: top.x + Math.cos(a) * 0.26, y: top.y - 0.25, z: top.z + Math.sin(a) * 0.26 });
    colorize(cn, k % 2 ? '#7a5a32' : '#8d7a3a'); parts.push(cn);
  }
  for (const g of parts) g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  const trunkGeo = merge(parts);
  const sw = [];
  for (const g of parts) { const gg = g.index ? g.toNonIndexed() : g; for (let i = 0; i < gg.attributes.position.count; i++) sw.push(1); }
  trunkGeo.setAttribute('aSway', new THREE.Float32BufferAttribute(sw, 1));

  // crown: textured fronds (V-folded strips)
  const pos = [], uvs = [], col = [], sway = [], nor = [];
  const nF = 11;
  for (let f = 0; f < nF; f++) {
    const a = (f / nF) * Math.PI * 2 + rnd() * 0.45;
    const len = 2.8 + rnd() * 1.5;
    const droop = 0.7 + rnd() * 0.9;
    const rise = 0.4 + rnd() * 0.6;
    const half = 0.95 + rnd() * 0.25;
    const segs = 10;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const rows = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const p = top.clone().addScaledVector(dir, len * t);
      p.y += rise * Math.sin(t * Math.PI * 0.6) * 1.2 - droop * t * t * 2.2;
      const w = half * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)));
      const fold = w * 0.42;
      const L = p.clone().addScaledVector(side, -w); L.y -= fold;
      const R = p.clone().addScaledVector(side, w); R.y -= fold;
      rows.push([L, p, R, t]);
    }
    for (let s = 0; s < segs; s++) {
      const r0 = rows[s], r1 = rows[s + 1];
      const quads = [[0, 1], [1, 2]];
      for (const [i0, i1] of quads) {
        const v = [[r0[i0], r0[3], i0 / 2], [r0[i1], r0[3], i1 / 2], [r1[i0], r1[3], i0 / 2], [r1[i1], r1[3], i1 / 2]];
        for (const k of [0, 2, 1, 1, 2, 3]) {
          const [p, t, vv] = v[k];
          pos.push(p.x, p.y, p.z);
          uvs.push(t, vv);
          const shade = 0.72 + 0.28 * Math.min(1, t * 2.2);
          col.push(shade, shade, shade * 0.95);
          sway.push(1 + t * 0.9);
          nor.push(0, 1, 0);
        }
      }
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  crown.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  crown.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  crown.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  crown.computeVertexNormals();
  const nn = crown.attributes.normal;
  for (let i = 0; i < nn.count; i++) {
    const v = new THREE.Vector3(nn.getX(i), nn.getY(i), nn.getZ(i));
    if (v.y < 0) v.negate();
    v.lerp(up, 0.5).normalize();
    nn.setXYZ(i, v.x, v.y, v.z);
  }
  crown.computeBoundingSphere();
  return { trunk: trunkGeo, crown };
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

export function createVegetation(terrain, layout, quality) {
  const group = new THREE.Group();
  const rnd = mulberry32(4242);

  // --- Grass tufts (golden), sea oats on dunes, reeds in shallows
  const grassMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { wind: 0.14, push: 2.4, caustics: false, underwater: true });
  const tuftGeos = [0, 1, 2].map(() => bladeTuft(rnd, {}));
  const oatGeo = bladeTuft(rnd, { blades: 12, hMin: 0.55, hMax: 1.15, base: '#9a8a52', tip: '#f8e6ae', width: 0.05, spread: 0.35 });
  const reedGeo = bladeTuft(rnd, { blades: 11, hMin: 0.9, hMax: 1.6, base: '#56653a', tip: '#c2b76a', width: 0.045, reed: true, spread: 0.35 });
  const tufts = [[], [], []], oats = [], reeds = [];
  const budget = quality.grass;
  const half = terrain.half - 2;
  const reserved = layout.reserved;
  const nearReserved = (x, z) => reserved.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < (q.r * 0.8) ** 2);
  let placed = 0;
  for (let k = 0; k < budget * 6 && placed < budget; k++) {
    const cx = (rnd() * 2 - 1) * half, cz = (rnd() * 2 - 1) * half;
    const ch = terrain.heightAt(cx, cz);
    if (ch < 0.2) continue;
    const g = terrain.grassAt(cx, cz);
    const m = terrain.mesaAt(cx, cz);
    let p = g * 1.1 + (ch < 1.6 && m < 0.1 ? 0.06 : 0);
    if (m > 0.5 && ch > 3) p = 0.35; // mesa tops
    if (rnd() > p) continue;
    const n = 3 + Math.floor(rnd() * (4 + g * 9));
    const rad = 0.8 + rnd() * (1.2 + g * 2.2);
    const hue = rnd();
    for (let q = 0; q < n && placed < budget; q++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * rad;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const h = terrain.heightAt(x, z);
      if (h < 0.12 || nearReserved(x, z)) continue;
      tufts[placed % 3].push({ x, z, y: h - 0.03, s: (0.7 + rnd() * 0.6) * (1 - d / rad * 0.35), rot: rnd() * 6.28, hue: hue + (rnd() - 0.5) * 0.3 });
      placed++;
    }
  }
  for (let k = 0; k < budget * 6 && oats.length < budget * 0.18; k++) {
    const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
    const h = terrain.heightAt(x, z);
    if (h < 0.5 || h > 2.2 || terrain.mesaAt(x, z) > 0.1 || rnd() > 0.35 || nearReserved(x, z)) continue;
    oats.push({ x, z, y: h - 0.02, s: 0.8 + rnd() * 0.5, rot: rnd() * 6.28 });
  }
  for (let k = 0; k < budget * 10 && reeds.length < budget * 0.07; k++) {
    const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
    const h = terrain.heightAt(x, z);
    if (h > 0.25 || h < -0.3 || nearReserved(x, z)) continue;
    const nx = Math.sin(x * 0.09) * Math.cos(z * 0.07) + Math.sin((x + z) * 0.03);
    if (nx < 0.6 || rnd() > 0.6) continue;
    reeds.push({ x, z, y: h - 0.05, s: 0.8 + rnd() * 0.5, rot: rnd() * 6.28 });
  }
  const tint = (it) => new THREE.Color().setHSL(0.11 + (it.hue - 0.5) * 0.04, 0.35 + it.hue * 0.2, 0.92 + it.hue * 0.12);
  tufts.forEach((list, i) => group.add(chunkedInstances(tuftGeos[i], grassMat, list, { color: tint })));
  group.add(chunkedInstances(oatGeo, grassMat, oats));
  group.add(chunkedInstances(reedGeo, grassMat, reeds));

  // --- Palms (3 variants by lean)
  const trunkMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { wind: 0.0016, caustics: false, cutout: 1 });
  const frondMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide }), { wind: 0.0016, caustics: false, cutout: 1 });
  const variants = [0.08, 0.2, 0.34].map((lean) => palmGeometry(rnd, lean, 7));
  const byVar = [[], [], []];
  for (const p of layout.palms) {
    const v = p.lean < 0.2 ? 0 : p.lean < 0.32 ? 1 : 2;
    byVar[v].push({ x: p.x, z: p.z, y: p.y, s: p.height / 7, rot: p.leanDir });
  }
  byVar.forEach((list, i) => {
    group.add(chunkedInstances(variants[i].trunk, trunkMat, list, { cast: true, chunk: 80 }));
    group.add(chunkedInstances(variants[i].crown, frondMat, list, { cast: true, chunk: 80 }));
  });

  // --- Bushes
  const bushParts = [];
  for (let k = 0; k < 3; k++) {
    const b = blob(rnd, 0.55 + rnd() * 0.25, 2);
    { const p = b.attributes.position, nn = b.attributes.normal; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), p.getY(i) + 0.15, p.getZ(i)).normalize(); nn.setXYZ(i, v.x, v.y, v.z); } }
    place(b, { x: (rnd() - 0.5) * 0.8, y: 0.3 + rnd() * 0.15, z: (rnd() - 0.5) * 0.8 });
    colorizeFn(b, (x, y) => (y > 0.55 ? '#b9b866' : y > 0.25 ? '#97a050' : '#6f8243'));
    bushParts.push(b);
  }
  const bushGeo = merge(bushParts);
  const bushMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { caustics: false, cutout: 1, detail: 1 });
  group.add(chunkedInstances(bushGeo, bushMat, layout.bushes.map((b) => ({ ...b, y: b.y - 0.1 })), {
    cast: true, color: (it) => new THREE.Color().setHSL(0.17 + (it.hue - 0.5) * 0.08, 0.45, 0.85 + it.hue * 0.2),
  }));

  // --- Rocks
  const rockMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { detail: 1, cutout: 1 });
  const rockGeos = [0, 1, 2, 3].map((v) => {
    const g = new THREE.DodecahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + Math.sin(x * 3.1 + v * 1.7) * 0.12 + Math.cos(z * 2.7 + y * 1.9 + v) * 0.12;
      p.setXYZ(i, x * n * (1 + v * 0.1), y * n * 0.72, z * n);
    }
    g.computeVertexNormals();
    return colorizeFn(g, (x, y) => (y > 0.45 ? '#e2c2a2' : y > 0 ? '#cf9f86' : '#b48979'));
  });
  const rocksBy = [[], [], [], []];
  for (const r of layout.rocks) rocksBy[r.variant].push({ x: r.x, z: r.z, y: r.y - r.s * 0.25, s: r.s, rot: r.rot, tilt: r.tilt, sy: r.s * (0.8 + hash01(r.x) * 0.5) });
  rocksBy.forEach((list, i) => group.add(chunkedInstances(rockGeos[i], rockMat, list, { cast: true, chunk: 80 })));

  return { group };
}
