// Converts the licensed car models (Sketchfab, CC-BY, see assets/CREDITS.md) into a compact module
// the game bundles: src/assets/cars.gen.js. Nothing is fetched or parsed as glTF at runtime.
//
//   node dev/build-assets.mjs            (downloads the GLBs once into .cache/, needs the Sketchfab API)
//
// Per car: every mesh is baked into a car frame (+z forward, +y up, +x left, origin between the
// four wheel centres at hub height, scaled so the wheelbase matches the physics spec), grouped by
// material, KHR_texture_transform baked into the UVs, textures resized and re-encoded (JPEG, or
// PNG when they carry alpha) as data URIs shared between cars. The four wheels are kept apart,
// centred on their hubs, so the game can steer, spin and move them with the suspension.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLES } from '../src/vehicles.js';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = resolve(ROOT, '.cache/models');
mkdirSync(CACHE, { recursive: true });

// which licensed model dresses which car
export const CARS = [
  { id: 'cabri', uid: 'd78bdfc34e024ac7926853f9ae863190' },   // Placeholder MV6 '83
  { id: 'mistral', uid: 'b2261c471645417a8b7e5882d541c248' }, // Sanremo '70
  { id: 'bison', uid: '22015d1863d6455aa31cfd738b972c50' },   // Bokaroo '67
  { id: 'criquet', uid: '1269720ec7b84c899eac77c1d325141e' }, // Lasley '67
];
const SKIP_MAT = /badge/i;          // manufacturer-style badges: left out
const SKIP_NODE = /Caliper/i;       // brake calipers would need their own steering: left out
const WHEEL = /Wheel\w*?_(FL|FR|RL|RR)$/;
const PAINT_MAT = /Bodymat/i;
const BRAKE_NODE = /Brakelights?(?!_Glass)/i;

async function fetchModel(uid) {
  const dir = resolve(CACHE, uid);
  mkdirSync(dir, { recursive: true });
  const glb = resolve(dir, 'model.glb'), meta = resolve(dir, 'meta.json');
  if (!existsSync(meta)) writeFileSync(meta, await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).text());
  if (!existsSync(glb)) {
    const dl = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`)).json();
    writeFileSync(glb, Buffer.from(await (await fetch(dl.glb.url)).arrayBuffer()));
  }
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  const lic = m.license?.label || m.license;
  if (!/^CC Attribution$|^CC0/.test(lic)) throw new Error(`${uid}: licence "${lic}" not allowed`);
  return { glb, meta: { name: m.name, author: m.user.displayName || m.user.username, username: m.user.username, url: m.viewerUrl, license: lic } };
}

// ---- small linear algebra on column-major 4x4 (glTF)
const mulPt = (M, x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
const mulDir = (M, x, y, z) => [M[0] * x + M[4] * y + M[8] * z, M[1] * x + M[5] * y + M[9] * z, M[2] * x + M[6] * y + M[10] * z];
function normalMatrix(M) {
  // inverse transpose of the upper 3x3
  const a = M[0], b = M[4], c = M[8], d = M[1], e = M[5], f = M[9], g = M[2], h = M[6], i = M[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  // inv is the row-major inverse; normals transform by its transpose
  return { n: inv, det };
}
// n' = inverse(M3)^T * n  (inv is row-major, so the transpose reads it by columns)
const mulN = (N, x, y, z) => { const r = [N[0] * x + N[3] * y + N[6] * z, N[1] * x + N[4] * y + N[7] * z, N[2] * x + N[5] * y + N[8] * z]; const l = Math.hypot(...r) || 1; return r.map((v) => v / l); };

// ---- textures: decode, resize (box filter), re-encode; shared by content hash
const texStore = new Map(); // hash -> { id, uri }
const texList = [];
function decodeImage(img, mime) {
  if (mime === 'image/jpeg') { const d = jpeg.decode(Buffer.from(img), { useTArray: true, formatAsRGBA: true }); return { w: d.width, h: d.height, data: d.data }; }
  const p = PNG.sync.read(Buffer.from(img)); return { w: p.width, h: p.height, data: p.data };
}
function resize(src, size) {
  if (src.w <= size && src.h <= size) return src;
  const k = Math.max(src.w, src.h) / size, w = Math.round(src.w / k), h = Math.round(src.h / k);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * k), y0 = Math.floor(y * k), x1 = Math.min(src.w, Math.floor((x + 1) * k)), y1 = Math.min(src.h, Math.floor((y + 1) * k));
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * src.w + xx) * 4; for (let c = 0; c < 4; c++) acc[c] += src.data[o + c]; n++; }
    const o = (y * w + x) * 4; for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / n);
  }
  return { w, h, data: out };
}
function storeTexture(tex, size, withAlpha) {
  const img = resize(decodeImage(tex.getImage(), tex.getMimeType()), size);
  let hasAlpha = false;
  if (withAlpha) for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) { hasAlpha = true; break; }
  let uri;
  if (hasAlpha) { const p = new PNG({ width: img.w, height: img.h }); p.data = Buffer.from(img.data); uri = 'data:image/png;base64,' + PNG.sync.write(p).toString('base64'); }
  else uri = 'data:image/jpeg;base64,' + jpeg.encode({ data: img.data, width: img.w, height: img.h }, 84).data.toString('base64');
  const hash = createHash('sha1').update(uri).digest('hex');
  if (!texStore.has(hash)) { texStore.set(hash, { id: texList.length, uri }); texList.push(uri); }
  return { id: texStore.get(hash).id, hasAlpha };
}

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

async function convert({ id, uid }) {
  const { glb, meta } = await fetchModel(uid);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glb);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  // collect mesh instances with world matrices
  const inst = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    // the wheel slot comes from the node or any ancestor named like *Wheel*_FL
    let slot = null, brake = false, skip = false;
    for (let n = node; n; n = n.getParentNode()) { const nm = n.getName(); const m = nm.match(WHEEL); if (m && !slot) slot = m[1]; if (BRAKE_NODE.test(nm)) brake = true; if (SKIP_NODE.test(nm)) skip = true; }
    if (!skip) inst.push({ node, mesh, M: node.getWorldMatrix(), slot, brake });
  });
  // wheel centres (world) from their geometry bounds
  const wheelC = {};
  for (const it of inst) if (it.slot) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const prim of it.mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      for (let i = 0; i < P.getCount(); i++) { const p = mulPt(it.M, ...P.getElement(i, [])); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } }
    }
    const w = wheelC[it.slot] || (wheelC[it.slot] = { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] });
    for (let k = 0; k < 3; k++) { w.mn[k] = Math.min(w.mn[k], mn[k]); w.mx[k] = Math.max(w.mx[k], mx[k]); }
  }
  for (const s of ['FL', 'FR', 'RL', 'RR']) if (!wheelC[s]) throw new Error(`${id}: wheel ${s} not found`);
  const ctr = (s) => wheelC[s].mn.map((v, k) => (v + wheelC[s].mx[k]) / 2);
  const C = Object.fromEntries(['FL', 'FR', 'RL', 'RR'].map((s) => [s, ctr(s)]));
  const mid = (a, b) => a.map((v, k) => (v + b[k]) / 2);
  const front = mid(C.FL, C.FR), rear = mid(C.RL, C.RR), origin = mid(front, rear);
  let fwd = [front[0] - rear[0], 0, front[2] - rear[2]]; const wbModel = Math.hypot(fwd[0], fwd[2]); fwd = fwd.map((v) => v / wbModel);
  const left = [fwd[2], 0, -fwd[0]]; // up x fwd with up = +y
  if ((C.FL[0] - origin[0]) * left[0] + (C.FL[2] - origin[2]) * left[2] < 0) throw new Error(`${id}: FL wheel is not on the left`);
  const spec = VEHICLES[id];
  const wbSpec = Math.abs(spec.wheels[0].z - spec.wheels[2].z);
  const s = wbSpec / wbModel;
  // world -> car frame
  const toCar = (p) => { const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]; return [(d[0] * left[0] + d[2] * left[2]) * s, d[1] * s, (d[0] * fwd[0] + d[2] * fwd[2]) * s]; };
  const dirCar = (d) => [d[0] * left[0] + d[2] * left[2], d[1], d[0] * fwd[0] + d[2] * fwd[2]];
  // (left, up, fwd) with left = up x fwd is a right-handed basis: a pure rotation, winding is kept
  const FLIP = false;

  const groups = new Map(); // key -> { mat, pos:[], nrm:[], uv:[], idx:[] }
  const matInfo = new Map(); // material -> serialised material
  const mats = [];
  function matIndex(mat, brake) {
    const key = (mat ? mat.getName() : '(none)') + (brake ? '#brake' : '');
    if (matInfo.has(key)) return matInfo.get(key);
    const name = mat ? mat.getName() : 'none';
    if (mat?.getExtension('KHR_materials_pbrSpecularGlossiness')) throw new Error(`car material ${name}: spec-gloss is not supported for cars`);
    const bt = mat?.getBaseColorTexture();
    const blend = mat?.getAlphaMode() === 'BLEND';
    const small = /interior|bottom/i.test(name);
    const tex = bt ? storeTexture(bt, small ? 256 : 512, blend || mat.getAlphaMode() === 'MASK') : null;
    const cc = mat?.getExtension('KHR_materials_clearcoat');
    const info = {
      name, role: PAINT_MAT.test(name) ? 'paint' : brake ? 'brake' : /glass|transp/i.test(name) && blend ? 'glass' : 'other',
      color: mat ? mat.getBaseColorFactor().slice(0, 3).map((v) => +v.toFixed(4)) : [0.5, 0.5, 0.5],
      opacity: mat ? +mat.getBaseColorFactor()[3].toFixed(3) : 1,
      tex: tex ? tex.id : -1, texAlpha: tex ? tex.hasAlpha : false,
      metal: mat ? +mat.getMetallicFactor().toFixed(3) : 0, rough: mat ? +mat.getRoughnessFactor().toFixed(3) : 1,
      alpha: mat ? mat.getAlphaMode() : 'OPAQUE', cutoff: mat ? mat.getAlphaCutoff() : 0.5,
      clearcoat: cc ? +cc.getClearcoatFactor().toFixed(3) : 0,
      emissive: mat ? mat.getEmissiveFactor().map((v) => +v.toFixed(3)) : [0, 0, 0],
    };
    // textures that hold the colour: metal factor 1 on painted atlases reads black without an env; keep it honest
    if (info.tex >= 0 && info.metal > 0.5 && info.role !== 'paint') info.metal = 0.3;
    mats.push(info);
    matInfo.set(key, mats.length - 1);
    return mats.length - 1;
  }
  for (const it of inst) {
    const { n: N, det } = normalMatrix(it.M);
    for (const prim of it.mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat && SKIP_MAT.test(mat.getName())) continue;
      if (prim.getMode() !== 4) continue; // triangles only
      const mi = matIndex(mat, it.brake);
      const key = (it.slot || 'body') + '|' + mi;
      const g = groups.get(key) || groups.set(key, { slot: it.slot, mat: mi, pos: [], nrm: [], uv: [], idx: [] }).get(key);
      const P = prim.getAttribute('POSITION'), Nn = prim.getAttribute('NORMAL'), T = prim.getAttribute('TEXCOORD_0');
      // texture transform on the base colour slot
      const ti = mat?.getBaseColorTextureInfo();
      const tt = ti?.getExtension?.('KHR_texture_transform');
      const off = tt ? tt.getOffset() : [0, 0], rot = tt ? tt.getRotation() : 0, sc = tt ? tt.getScale() : [1, 1];
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const base = g.pos.length / 3;
      for (let i = 0; i < P.getCount(); i++) {
        g.pos.push(...toCar(mulPt(it.M, ...P.getElement(i, []))));
        const nn = Nn ? mulN(N, ...Nn.getElement(i, [])) : [0, 1, 0];
        g.nrm.push(...dirCar(nn));
        if (T) { const [u, v] = T.getElement(i, []); const us = u * sc[0], vs = v * sc[1]; g.uv.push(cr * us + sr * vs + off[0], -sr * us + cr * vs + off[1]); } else g.uv.push(0, 0);
      }
      const I = prim.getIndices();
      const idx = I ? Array.from({ length: I.getCount() }, (_, k) => I.getScalar(k)) : Array.from({ length: P.getCount() }, (_, k) => k);
      const flip = (det < 0) !== FLIP;
      for (let k = 0; k < idx.length; k += 3) {
        if (flip) g.idx.push(base + idx[k], base + idx[k + 2], base + idx[k + 1]);
        else g.idx.push(base + idx[k], base + idx[k + 1], base + idx[k + 2]);
      }
    }
  }
  // self-check: the stored vertex normals must point the same way as the triangles they belong to
  let agree = 0, total = 0;
  for (const g of groups.values()) for (let k = 0; k < g.idx.length; k += 3) {
    const [a, b, c] = [g.idx[k], g.idx[k + 1], g.idx[k + 2]];
    const P = (i) => [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]];
    const pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const fn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...fn) < 1e-10) continue;
    const vn = [0, 1, 2].map((q) => g.nrm[a * 3 + q] + g.nrm[b * 3 + q] + g.nrm[c * 3 + q]);
    total++; if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] > 0) agree++;
  }
  console.log(`  ${id}: normals agree with winding on ${(agree / total * 100).toFixed(1)}% of triangles`);
  if (agree / total < 0.9) throw new Error(`${id}: normals/winding mismatch`);

  // wheels: recentre each on its hub (car frame) and record hub positions and radius
  const wheels = {};
  for (const slot of ['FL', 'FR', 'RL', 'RR']) {
    const c = toCar(C[slot]);
    const r = ((wheelC[slot].mx[1] - wheelC[slot].mn[1]) / 2) * s;
    wheels[slot] = { x: +c[0].toFixed(4), y: +c[1].toFixed(4), z: +c[2].toFixed(4), r: +r.toFixed(4) };
    for (const g of groups.values()) if (g.slot === slot) for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] -= c[0]; g.pos[i + 1] -= c[1]; g.pos[i + 2] -= c[2]; }
  }
  // serialise: positions/uvs Float32, normals Int8 (normalised), indices Uint16/32
  const parts = [];
  let tris = 0, minY = 1e9, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const g of groups.values()) {
    const nv = g.pos.length / 3;
    const pos = new Float32Array(g.pos), uv = new Float32Array(g.uv);
    const nrm = new Int8Array(g.nrm.map((v) => Math.round(Math.max(-1, Math.min(1, v)) * 127)));
    const idx = nv > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
    tris += g.idx.length / 3;
    if (!g.slot) for (let i = 0; i < pos.length; i += 3) { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); } minY = Math.min(minY, pos[i + 1]); }
    parts.push({ slot: g.slot || null, mat: g.mat, n: nv, i32: nv > 65535, pos: b64(pos), nrm: b64(nrm), uv: b64(uv), idx: b64(idx) });
  }
  console.log(`${id}: ${meta.name} by ${meta.author} — ${tris} tris, ${parts.length} parts, ${mats.length} materials, scale ${s.toFixed(3)}, wheels`, JSON.stringify(wheels));
  return { id, meta, mats, parts, wheels, bounds: { min: mn.map((v) => +v.toFixed(3)), max: mx.map((v) => +v.toFixed(3)) }, tris };
}

const out = { cars: {}, credits: [] };
for (const c of CARS) {
  const r = await convert(c);
  out.cars[c.id] = { mats: r.mats, parts: r.parts, wheels: r.wheels, bounds: r.bounds, tris: r.tris };
  out.credits.push({ for: c.id, ...r.meta, modified: 'converted, rescaled, badges and brake calipers removed, textures resized' });
}
const js = `// GENERATED by dev/build-assets.mjs — do not edit. Models: see assets/CREDITS.md (CC-BY).
export const TEXTURES = ${JSON.stringify(texList)};
export const CAR_ASSETS = ${JSON.stringify(out.cars)};
export const CREDITS = ${JSON.stringify(out.credits)};
`;
mkdirSync(resolve(ROOT, 'src/assets'), { recursive: true });
writeFileSync(resolve(ROOT, 'src/assets/cars.gen.js'), js);
const md = ['# Crédits des modèles 3D', '', 'Modèles sous licence Creative Commons Attribution 4.0 (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Modifiés pour le jeu : convertis, remis à l\'échelle, logos et étriers de frein retirés, textures réduites.', '',
  ...out.credits.map((c) => `- **${c.name}** par ${c.author} (${c.url}) — ${c.license} — utilisé pour la voiture « ${VEHICLES[c.for].name} »`)].join('\n');
mkdirSync(resolve(ROOT, 'assets'), { recursive: true });
writeFileSync(resolve(ROOT, 'assets/CREDITS.md'), md + '\n');
console.log(`textures ${texList.length}, module ${(js.length / 1024 / 1024).toFixed(2)} MB`);

// ---------------------------------------------------------------------------------------------
// Vegetation and rocks: every selected mesh baked into a standalone prop (base at y = 0, centred,
// metres, +y up), colours sampled from its texture at each vertex (these packs use gradient /
// palette atlases) into linear vertex colours, ready for the instanced vegetation.
const PROPS = [ // unit: the pack's length unit in metres (the nature pack is in centimetres)
  { kind: 'pine', uid: '9c773e846c6e4448b26b2cdecb2b91bf', nodes: /^TreeV[123]$/, unit: 0.01 },
  { kind: 'tree', uid: '9c773e846c6e4448b26b2cdecb2b91bf', nodes: /^TreeR[123]$/, unit: 0.01 },
  { kind: 'bush', uid: '9c773e846c6e4448b26b2cdecb2b91bf', nodes: /^Clump[256]$/, unit: 0.01 },
  { kind: 'shrub', uid: '9c773e846c6e4448b26b2cdecb2b91bf', nodes: /^TreeO[12]$/, unit: 0.01 },
  { kind: 'rock', uid: '9c773e846c6e4448b26b2cdecb2b91bf', nodes: /^RG[123]$/, unit: 0.01 },
  { kind: 'mesa', uid: '726e8563eb634c529410f4e00857bbb3', nodes: /^MRock[15]$/, unit: 0.01 },
  { kind: 'cactus', uid: '588596f1601d48e6ad4cb24b31c3f33c', nodes: /^cactus_[279]$/, unit: 1 },
];
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const decodedCache = new Map();
function sampleTex(tex, u, v) {
  let img = decodedCache.get(tex);
  if (!img) { img = decodeImage(tex.getImage(), tex.getMimeType()); decodedCache.set(tex, img); }
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(img.w - 1, Math.max(0, Math.round(u * (img.w - 1)))), y = Math.min(img.h - 1, Math.max(0, Math.round(v * (img.h - 1))));
  const o = (y * img.w + x) * 4;
  return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
}
async function bakeProps() {
  const out = {}, credits = [];
  for (const P of PROPS) {
    const { glb, meta } = await fetchModel(P.uid);
    if (!credits.some((c) => c.url === meta.url)) credits.push({ for: P.kind, ...meta, modified: 'converted, colours baked to vertices' });
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glb);
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    const picks = [];
    scene.traverse((node) => { if (P.nodes.test(node.getName())) picks.push(node); });
    if (!picks.length) throw new Error(`${P.kind}: no node matches ${P.nodes}`);
    out[P.kind] = [];
    for (const top of picks) {
      const pos = [], nrm = [], col = [], idx = [];
      top.traverse((node) => {
        const mesh = node.getMesh(); if (!mesh) return;
        const M = node.getWorldMatrix(); const { n: N, det } = normalMatrix(M);
        for (const prim of mesh.listPrimitives()) {
          if (prim.getMode() !== 4) continue;
          // older exports keep their colour in KHR_materials_pbrSpecularGlossiness (diffuse)
          const mat = prim.getMaterial(), sg = mat?.getExtension('KHR_materials_pbrSpecularGlossiness');
          const fac = sg ? sg.getDiffuseFactor() : mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
          const tex = sg ? sg.getDiffuseTexture() : mat?.getBaseColorTexture();
          const ti = sg ? sg.getDiffuseTextureInfo() : mat?.getBaseColorTextureInfo(); const tt = ti?.getExtension?.('KHR_texture_transform');
          const uvSet = ti ? ti.getTexCoord() : 0;
          const off = tt ? tt.getOffset() : [0, 0], sc = tt ? tt.getScale() : [1, 1];
          const Pa = prim.getAttribute('POSITION'), Na = prim.getAttribute('NORMAL'), Ta = prim.getAttribute('TEXCOORD_' + uvSet), Ca = prim.getAttribute('COLOR_0');
          const base = pos.length / 3;
          for (let i = 0; i < Pa.getCount(); i++) {
            pos.push(...mulPt(M, ...Pa.getElement(i, [])).map((v) => v * P.unit));
            nrm.push(...(Na ? mulN(N, ...Na.getElement(i, [])) : [0, 1, 0]));
            let c = [fac[0], fac[1], fac[2]];
            if (tex && Ta) { const [u, v] = Ta.getElement(i, []); const s = sampleTex(tex, u * sc[0] + off[0], v * sc[1] + off[1]); c = [srgbToLin(s[0]) * fac[0], srgbToLin(s[1]) * fac[1], srgbToLin(s[2]) * fac[2]]; }
            if (Ca) { const vc = Ca.getElement(i, []); c = [c[0] * vc[0], c[1] * vc[1], c[2] * vc[2]]; }
            col.push(...c);
          }
          const I = prim.getIndices(); const ii = I ? Array.from({ length: I.getCount() }, (_, k) => I.getScalar(k)) : Array.from({ length: Pa.getCount() }, (_, k) => k);
          for (let k = 0; k < ii.length; k += 3) { if (det < 0) idx.push(base + ii[k], base + ii[k + 2], base + ii[k + 1]); else idx.push(base + ii[k], base + ii[k + 1], base + ii[k + 2]); }
        }
      });
      if (col.every((v) => v === 1)) throw new Error(`${P.kind} ${top.getName()}: colours all white (texture not found)`);
      // base at y = 0, centred on its footprint
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
      const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
      for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= mn[1]; pos[i + 2] -= cz; }
      const h = mx[1] - mn[1], w = Math.max(mx[0] - mn[0], mx[2] - mn[2]);
      const nv = pos.length / 3;
      out[P.kind].push({
        name: top.getName(), h: +h.toFixed(3), w: +w.toFixed(3), n: nv, tris: idx.length / 3,
        pos: b64(new Float32Array(pos)), nrm: b64(new Int8Array(nrm.map((v) => Math.round(Math.max(-1, Math.min(1, v)) * 127)))),
        col: b64(new Uint8Array(col.map((v) => Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 255)))), // sqrt-encoded linear (more precision in the darks)
        idx: b64(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)), i32: nv > 65535,
      });
    }
    console.log(`${P.kind}: ${out[P.kind].map((p) => `${p.name} ${p.tris}t h${p.h} w${p.w}`).join(', ')}`);
  }
  return { out, credits };
}
const props = await bakeProps();
writeFileSync(resolve(ROOT, 'src/assets/props.gen.js'), `// GENERATED by dev/build-assets.mjs — do not edit. Models: see assets/CREDITS.md (CC-BY).
export const PROP_ASSETS = ${JSON.stringify(props.out)};
export const PROP_CREDITS = ${JSON.stringify(props.credits)};
`);
const md2 = ['', '## Végétation et rochers', '', ...props.credits.map((c) => `- **${c.name}** par ${c.author} (${c.url}) — ${c.license} — couleurs reportées sur les sommets`)].join('\n');
writeFileSync(resolve(ROOT, 'assets/CREDITS.md'), readFileSync(resolve(ROOT, 'assets/CREDITS.md'), 'utf8') + md2 + '\n');
console.log('props module written');
