// Instanced, chunked vegetation for the three biomes: snowy pines, round trees and grass in
// the hills, cacti, dry bushes and sandstone outcrops in the canyons, rocks everywhere. Trees,
// bushes, rocks, outcrops and cacti are licensed low-poly models (assets/CREDITS.md). Chunks are frustum- and
// distance-culled; trees, cacti and big rocks are returned as physics obstacles.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { colorize, colorizeFn, place, merge } from './geo.js';
import { mulberry32 } from '../noise.js';
import { propVariants } from './assetProps.js';

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

// reach: draw distance as a share of the fog distance (small things fade out sooner)
function chunkedInstances(geo, mat, items, { chunk = 40, cast = false, receive = true, color, reach = 1 } = {}) {
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
    im.userData.reach = reach;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
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
  // how far the ground falls below (x, z) within radius r (8 samples): flat-based models must not
  // sit on the edge of a drop
  const dropAround = (x, z, r) => { const h0 = world.heightAt(x, z); let d = 0; for (let k = 0; k < 8; k++) { const a = k * 0.785; d = Math.max(d, h0 - world.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return d; };
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
    let s = 0.4 + Math.pow(rnd(), 2.2) * 2.2; // mostly small
    const gy = world.heightAt(x, z);
    // on a crest (higher than the ground around) a big rock stands against the sky: keep it small
    const crest = gy - (world.heightAt(x + 6, z) + world.heightAt(x - 6, z) + world.heightAt(x, z + 6) + world.heightAt(x, z - 6)) / 4;
    if (crest > 0.6) s = Math.min(s, 0.8);
    if (!free(x, z, 7.5 + s * 1.2)) return null; // big rocks keep clear of the carriageway
    world.normalAt(x, z, nrm);
    if (nrm[1] < 0.7 || (s > 1.2 && nrm[1] < 0.85) || dropAround(x, z, s) > 0.25 + s * 0.3) return null; // flat-based: no big rock on a steep slope or an edge
    world.biomeWeights(x, z, bw);
    return { x, z, y: gy, sink: 0.3, s, rot: rnd() * 6.28, biome: bw.indexOf(Math.max(...bw)), slope: Math.sqrt(1 - nrm[1] * nrm[1]) / nrm[1] };
  });
  const bushes = pick(quality.trees * 0.5, 30000, (x, z) => {
    if (!free(x, z, 6)) return null;
    world.biomeWeights(x, z, bw);
    if (bw[0] > 0.5) return null;
    return { x, z, y: world.heightAt(x, z) - 0.15, s: 0.5 + rnd() * 0.7, rot: rnd() * 6.28, hue: rnd(), dry: bw[2] > bw[1] };
  });

  const add = (geo, mat, list, opts) => { const g = chunkedInstances(geo, mat, list, { chunk: 80, ...opts }); group.add(g); return g; };

  // --- licensed models (assets/CREDITS.md), sized like the old procedural ones
  const PINE = propVariants('pine', ['TreeV1', 'TreeV2', 'TreeV3'], { swayRef: 7.5 });
  const TREE = propVariants('tree', ['TreeR1', 'TreeR2'], { swayRef: 6.2 }); // TreeR3's small balls on twigs looked sparse
  const BUSH = propVariants('bush', ['Clump2', 'Clump5', 'Clump6'], { sway: 0.6, swayRef: 0.8, domeNormals: true });
  // the same rosettes, greyed then tinted dusty sage: agaves in the canyons
  const AGAVE = propVariants('bush', ['Clump2', 'Clump5', 'Clump6'], { sway: 0.4, swayRef: 0.8, grey: 0.5, domeNormals: true });
  const ROCK = propVariants('rock', ['RG1', 'RG2', 'RG3'], { sway: 0, grey: 0.8 });
  const MESA = propVariants('mesa', ['MRock1', 'MRock3', 'MRock4'], { sway: 0 });
  const CACT = propVariants('cactus', ['cactus_2', 'cactus_7', 'cactus_9'], { sway: 0 });
  // the formations of the canyons: big sandstone outcrops away from the roads
  const mesas = pick(Math.round(quality.trees * 0.05), 20000, (x, z) => {
    world.biomeWeights(x, z, bw);
    const tw = 4 + rnd() * rnd() * 7;
    if (bw[2] < 0.7 || !free(x, z, 16 + tw) || (world.normalAt(x, z, nrm), nrm[1] < 0.85) || dropAround(x, z, tw * 0.5) > 0.35 + tw * 0.1) return null;
    return { x, z, y: world.heightAt(x, z) - tw * 0.06, tw, rot: rnd() * 6.28, slope: Math.sqrt(Math.max(0, 1 - nrm[1] * nrm[1])) / nrm[1] };
  }, 0.3);
  const VCH = 70; // chunk size: small enough that frustum and shadow-box culling skip most far trees
  // pick a variant and turn the target height (th) or width (tw) into that variant's scale;
  // returns one list per variant. The variant is picked per chunk (one draw call per chunk
  // instead of one per variant per chunk): rotation and size still vary per item.
  const sized = (list, V) => {
    const per = V.map(() => []);
    let salt = V.length; for (const c of V.map((v) => v.name).join()) salt = (salt * 31 + c.charCodeAt(0)) | 0; // per model set
    for (const it of list) {
      const k = (Math.floor(it.x / VCH) * 73856093 ^ Math.floor(it.z / VCH) * 19349663 ^ salt * 83492791) >>> 0;
      const v = V[k % V.length];
      const sc = it.th ? it.th / v.h : it.tw / v.w;
      // thick: wider than tall (thin twigs and cacti turn into flickering lines at a distance)
      const hh = v.h * sc * (it.squash || 1);
      // flat bases on a slope: sink by the rise across the half-width, so the downhill edge touches
      const ww = v.w * sc * (it.thick || 1);
      per[k % V.length].push({ ...it, y: it.y - (it.sink || 0) * hh - (it.slope || 0) * ww * 0.5, s: sc * (it.thick || 1), sy: it.squash || it.thick ? sc * (it.squash || 1) : undefined, hh, ww });
    }
    return per;
  };
  for (const it of pinesSnow) it.th = 7.5 * it.s;
  for (const it of pinesGreen) it.th = 7.0 * it.s;
  for (const it of trees) it.th = 6.2 * it.s;
  for (const it of cacti) { it.th = 3.0 * it.s; it.thick = 1.4; }
  for (const it of bushes) { it.tw = (it.dry ? 1.7 : 2.0) * it.s; it.squash = 0.8; } // rosettes are flat and wide: sized by width
  for (const it of rocks) { it.tw = 2.0 * it.s; it.squash = 0.7 + rnd() * 0.5; it.tilt = 0; }
  // foliage is made of single planes (boughs, fronds): both sides; rocks and cacti are closed
  const lambert = (wind, side = THREE.DoubleSide) => patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side }), wind ? { wind, cutout: 1 } : { cutout: 1 });
  const vegMat = lambert(0.0012);
  // rocks, cacti: more sky fill in the shade (their shaded faces went near-black)
  const rockMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { cutout: 1, extraFrag: (f) => f.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= 1.35;') });
  // firs: the underside of the boughs darker and greyer (it read lime); in the snow, snow settles
  // on the upper side. The bough planes are double-sided: the side facing up decides.
  const firMat = (snow) => {
    const m = lambert(0.0012);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUpN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUpN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUpN;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float upN = gl_FrontFacing ? vUpN : -vUpN;
  float under = smoothstep(0.0, 0.5, -upN);
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, lum * vec3(0.62, 0.8, 0.78), under * 0.55) * (1.0 - under * 0.3);
  ${snow ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), smoothstep(0.5, 0.85, upN) * 0.92);' : ''}
}`);
    };
    m.customProgramCacheKey = () => (snow ? 'fir-snow' : 'fir');
    return m;
  };
  const snowMat = firMat(true), firGreenMat = firMat(false);
  // rosettes (ferns, agaves): soft dome normals baked in, used on both sides as they are (the
  // planes' winding is arbitrary, so the default back-face flip turned half the leaves black)
  const rosetteMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { wind: 0.0012, cutout: 1, extraFrag: (f) => f.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);') });
  // outcrops: faceted like the cliffs
  const mesaMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { cutout: 1, extraFrag: (f) => f.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= 1.35;') });
  const addV = (V, per, mat, opts = {}) => { per.forEach((list, k) => list.length && add(V[k].geo, mat, list, { chunk: VCH, cast: true, ...opts })); return per.flat(); };
  const rockTint = ['#b8c2d6', '#c8c0b0', '#e8a878']; // snow: blue-grey granite, hills: limestone, canyon: red sandstone
  const treeCast = quality.treeShadows !== false; // low tier: the firs' shadow pass is half the triangles
  const pinesSnowS = addV(PINE, sized(pinesSnow, PINE), snowMat, { cast: treeCast });
  const pinesGreenS = addV(PINE, sized(pinesGreen, PINE), firGreenMat, { cast: treeCast });
  // canopies a cooler green than the grass, varied per tree
  const TREE_TINT = ['#bceeff', '#c8f2f0', '#b0e4f4'];
  const h2 = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
  const treesS = addV(TREE, sized(trees, TREE), vegMat, { cast: treeCast, color: (it) => TREE_TINT[Math.floor(h2(it.x, it.z) * 3)] });
  const cactiS = addV(CACT, sized(cacti, CACT), rockMat, { color: () => '#c2faff' }); // back to a blue-green, apart from the ochre ground
  addV(BUSH, sized(bushes.filter((it) => !it.dry), BUSH), rosetteMat, { reach: 0.45 });
  addV(AGAVE, sized(bushes.filter((it) => it.dry), AGAVE), rosetteMat, { reach: 0.45, color: (it) => (it.hue > 0.5 ? '#cbdbb0' : '#d8d4a8') });
  const rocksS = addV(ROCK, sized(rocks, ROCK), rockMat, { color: (it) => rockTint[it.biome], reach: 0.6 });
  const mesasS = addV(MESA, sized(mesas, MESA), mesaMat);

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
  add(greenGeo, grassMat, greens, { chunk: 50, reach: 0.45 });
  add(dryGeo, grassMat, drys, { chunk: 50, reach: 0.45 });

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
  add(flowerGeo, grassMat, flowers, { chunk: 50, color: (it) => it.hue, reach: 0.3 });

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
  add(reflector, postMat, posts[1], { chunk: 80, reach: 0.45 });
  add(fencePost, postMat, posts[2], { chunk: 80, reach: 0.45 });
  add(snowPole, postMat, posts[3], { chunk: 80, reach: 0.45 });

  for (const it of [...pinesSnowS, ...pinesGreenS]) obstacles.push({ x: it.x, z: it.z, r: Math.max(0.25, 0.045 * it.hh), y0: it.y - 1, y1: it.y + it.hh * 0.6, kind: 'wood' });
  for (const it of treesS) obstacles.push({ x: it.x, z: it.z, r: Math.max(0.25, 0.055 * it.hh), y0: it.y - 1, y1: it.y + it.hh * 0.5, kind: 'wood' });
  for (const it of cactiS) obstacles.push({ x: it.x, z: it.z, r: 0.2 * it.ww, y0: it.y - 1, y1: it.y + it.hh, kind: 'wood' }); // r: arms included
  for (const it of rocksS) if (it.ww > 1.6) obstacles.push({ x: it.x, z: it.z, r: it.ww * 0.42, y0: it.y - 2, y1: it.y + it.hh * 0.8, kind: 'rock', shape: 'sphere' });
  // outcrops: an upright cylinder (a sphere that big would leave a gap to drive under)
  for (const it of mesasS) obstacles.push({ x: it.x, z: it.z, r: it.ww * 0.46, y0: it.y - 2, y1: it.y + it.hh * 0.9, kind: 'rock' });

  // distance culling of whole chunks (cheap: one test per chunk)
  const chunks = [];
  group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.computeBoundingSphere(); chunks.push(o); } });
  // one example of each model near a road (dev captures look at them up close)
  const near = (list) => list.reduce((b, it) => (world.roadDistAt(it.x, it.z) < world.roadDistAt(b.x, b.z) ? it : b), list[0]);
  const spots = {};
  for (const [k, list] of Object.entries({ firSnow: pinesSnowS, fir: pinesGreenS, tree: treesS, cactus: cactiS, rock: rocksS.filter((it) => it.biome === 2), rockHills: rocksS.filter((it) => it.biome === 1), rockSnow: rocksS.filter((it) => it.biome === 0), outcrop: mesasS, fern: bushes.filter((it) => !it.dry), agave: bushes.filter((it) => it.dry) })) if (list.length) { const it = near(list); spots[k] = { x: it.x, z: it.z }; }
  return {
    group, obstacles, spots,
    cull(camPos, far) {
      for (const m of chunks) {
        const bs = m.boundingSphere;
        if (!bs) { m.computeBoundingSphere(); continue; }
        const d = Math.hypot(bs.center.x - camPos.x, bs.center.z - camPos.z) - bs.radius;
        m.visible = d < far * m.userData.reach;
      }
    },
  };
}
