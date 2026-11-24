// Car models from licensed assets (built by dev/build-assets.mjs into src/assets/cars.gen.js).
// Same API as the procedural createVehicleModel: { root, body, dirt, setDirt, dispose, sync }.
// Geometry is decoded once per car and shared by every instance (player + AI traffic); the paint
// (livery colour, dirt) and the brake lights get a material per instance.
import * as THREE from 'three';
import { TEXTURES, CAR_ASSETS } from '../assets/cars.gen.js';

export const hasAssetCar = (id) => !!CAR_ASSETS[id];

const G = 9.81;
const texCache = [];
const pending = [];
// resolves once every texture requested so far has decoded (the loading screen waits on it,
// so no car shows up untextured)
export const whenCarTexturesReady = () => Promise.all(pending);
function texture(id) {
  if (!texCache[id]) {
    let done;
    pending.push(new Promise((r) => { done = r; }));
    const t = new THREE.TextureLoader().load(TEXTURES[id], () => done(), undefined, () => done()); // data: URI, decoded by the browser
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // glTF UV convention
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache[id] = t;
  }
  return texCache[id];
}
function decode(b64, Type) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}

// The models' number plates use a real-world plate atlas (state names, glyphs placed as separate
// quads). Swap it for plain cream plates: the atlas is alpha-blended, so leaving everything but the
// two plate backgrounds (bottom quarter) transparent hides the glyphs and stickers.
let plateTex = null;
function plainPlates() {
  if (plateTex) return plateTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  for (const x0 of [0, 128]) {
    g.fillStyle = '#3a3440'; g.fillRect(x0 + 1, 191, 126, 64);
    g.fillStyle = '#cfc3ad'; g.fillRect(x0 + 5, 196, 118, 55); // warm grey: not the brightest patch of the car
  }
  plateTex = new THREE.CanvasTexture(cv);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.flipY = false; // glTF UV convention
  return plateTex;
}

// decoded geometry and shared materials, per car id
const built = new Map();
function build(id) {
  if (built.has(id)) return built.get(id);
  const A = CAR_ASSETS[id];
  const parts = A.parts.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(decode(p.pos, Float32Array), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(decode(p.nrm, Int8Array), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(decode(p.uv, Float32Array), 2));
    g.setIndex(new THREE.BufferAttribute(decode(p.idx, p.i32 ? Uint32Array : Uint16Array), 1));
    g.computeBoundingSphere();
    return { slot: p.slot, mat: p.mat, geo: g };
  });
  const mats = A.mats.map((m) => {
    if (m.role === 'paint' || m.role === 'brake') return null; // per instance
    const opts = {
      color: new THREE.Color().setRGB(...m.color, THREE.SRGBColorSpace),
      map: /Numberplates/i.test(m.name) ? plainPlates() : m.tex >= 0 ? texture(m.tex) : null,
      metalness: m.metal, roughness: Math.max(0.05, m.rough), side: THREE.DoubleSide,
    };
    if (m.role === 'glass') Object.assign(opts, { transparent: true, opacity: Math.max(0.35, m.opacity), roughness: 0.05, metalness: 0.25, envMapIntensity: 1.3, depthWrite: false });
    else if (m.alpha === 'BLEND') Object.assign(opts, { transparent: true, opacity: m.opacity, depthWrite: false });
    else if (m.alpha === 'MASK') opts.alphaTest = m.cutoff;
    return new THREE.MeshStandardMaterial(opts);
  });
  const b = { parts, mats, A };
  built.set(id, b);
  return b;
}

// paint: livery colour with twin rally stripes in the secondary colour (bonnet, roof, boot),
// clearcoat, object-space dirt line (same look as the procedural cars)
function makePaint(colorHex, stripeHex, floorY) {
  const U = { uDirt: { value: 0 }, uDirtColor: { value: new THREE.Color('#8a6a46') }, uFloor: { value: floorY }, uStripe: { value: new THREE.Color(stripeHex || colorHex) }, uStripeOn: { value: stripeHex ? 1 : 0 } };
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(colorHex), roughness: 0.34, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 1.0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLp; uniform float uDirt; uniform vec3 uDirtColor; uniform float uFloor; uniform vec3 uStripe; uniform float uStripeOn;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float ax = abs(vLp.x), e = fwidth(ax) * 0.75 + 1e-4;
  float st = smoothstep(0.07 - e, 0.07 + e, ax) * (1.0 - smoothstep(0.21 - e, 0.21 + e, ax));
  diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, st * uStripeOn);
}
float dirtM = 0.0;
if (uDirt > 0.001) {
  float n = vn(vLp.xz * 6.0 + vLp.y * 3.0) * 0.6 + vn(vLp.xz * 17.0 + vLp.y * 9.0) * 0.4;
  float h = vLp.y - uFloor;
  float thr = 0.1 + uDirt * 0.7;
  dirtM = smoothstep(thr + (n - 0.5) * 0.3, thr - 0.16 + (n - 0.5) * 0.3, h);
  dirtM *= smoothstep(0.0, 0.06, uDirt);
  diffuseColor.rgb = mix(diffuseColor.rgb, uDirtColor * (0.75 + 0.5 * n), dirtM * 0.92);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, dirtM);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat *= (1.0 - dirtM);');
  };
  return { mat, U };
}

let blobTex = null, blobGeo = null;
function blobShadow() {
  if (!blobTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g2 = cv.getContext('2d'), gr = g2.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(cv);
    blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
  return new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
}

export function createAssetCar(spec, livery) {
  const L = livery || spec.livery;
  const { parts, mats, A } = build(spec.id);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // place the model so its hubs sit on the physics hubs at static rest, and its tyres on the
  // ground although the physics wheel radius differs a little from the model's
  const restComp = G / (4 * spec.stiffness);
  const hubRestY = spec.wheels[0].y - (spec.restLength - restComp);
  const rPhys = spec.wheels[0].radius, rVis = A.wheels.FL.r;
  const oy = hubRestY - (rPhys - rVis) - A.wheels.FL.y;
  const oz = (spec.wheels[0].z + spec.wheels[2].z) / 2;
  const model = new THREE.Group();
  model.position.set(0, oy, oz);
  body.add(model);
  const paint = makePaint(L.primary, L.secondary, A.bounds.min[1]);
  const brakeU = { v: 0 };
  const brakeMats = [];
  const wheelNodes = {};
  for (const s of ['FL', 'FR', 'RL', 'RR']) { const w = A.wheels[s]; const n = new THREE.Group(); n.position.set(w.x, w.y, w.z); n.rotation.order = 'YXZ'; model.add(n); wheelNodes[s] = n; }
  // per wheel: lift or drop the model's wheel so its tyre meets the ground where the physics tyre
  // does (front and rear radii can differ between the model and the physics, e.g. the buggy)
  const wheelFix = ['FL', 'FR', 'RL', 'RR'].map((s, i) => (spec.wheels[i].y - (spec.restLength - restComp) - spec.wheels[i].radius) - (oy + A.wheels[s].y - A.wheels[s].r));
  for (const p of parts) {
    const m = A.mats[p.mat];
    let mat = mats[p.mat];
    if (m.role === 'paint') mat = paint.mat;
    else if (m.role === 'brake') {
      // the glow is not masked by the light atlas: on some models the lens area of the atlas is
      // nearly black, so a masked glow never showed
      mat = new THREE.MeshStandardMaterial({ map: m.tex >= 0 ? texture(m.tex) : null, color: new THREE.Color().setRGB(...m.color, THREE.SRGBColorSpace), emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 0.05, roughness: 0.3, side: THREE.DoubleSide });
      brakeMats.push(mat);
    }
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.castShadow = !mat.transparent; mesh.receiveShadow = !mat.transparent;
    if (mat.transparent) mesh.renderOrder = 2;
    (p.slot ? wheelNodes[p.slot] : model).add(mesh);
  }
  const blob = blobShadow();
  const bx = A.bounds;
  blob.scale.set((bx.max[0] - bx.min[0]) * 1.35, 1, (bx.max[2] - bx.min[2]) * 1.1);
  blob.position.set(0, oy - rVis + 0.04, oz + (bx.max[2] + bx.min[2]) / 2);
  blob.renderOrder = 1;
  body.add(blob);

  const SLOTS = ['FL', 'FR', 'RL', 'RR'];
  const out = {
    root, body, dirt: 0, isAsset: true,
    noseZ: bx.max[2] + oz, // for the bumper camera
    setDirt(amount, color) {
      out.dirt = Math.max(0, Math.min(1, amount || 0));
      paint.U.uDirt.value = out.dirt;
      if (color !== undefined) paint.U.uDirtColor.value.set(color);
    },
    dispose() {
      // geometry and shared materials stay cached (other cars use them)
      paint.mat.dispose(); for (const m of brakeMats) m.dispose(); blob.material.dispose();
    },
    sync(car, dt) {
      const rp = car.rpos || car.pos, rq = car.rq || car.q;
      body.position.set(rp.x, rp.y, rp.z);
      body.quaternion.set(rq.x, rq.y, rq.z, rq.w);
      for (let i = 0; i < 4; i++) {
        const cw = car.wheels[i], n = wheelNodes[SLOTS[i]], w = A.wheels[SLOTS[i]];
        // suspension travel relative to the static rest, steer about y, roll about the axle (x)
        n.position.y = w.y + wheelFix[i] + (spec.restLength - restComp - cw.suspLen);
        n.rotation.set(cw.spin, cw.steerAngle, 0);
      }
      const braking = ((car.throttle < -0.05 || car.brake > 0.1) && car.forwardSpeed > 0.5) || car.input.handbrake;
      brakeU.v += ((braking ? 1 : 0) - brakeU.v) * Math.min(1, dt * 12);
      for (const m of brakeMats) m.emissiveIntensity = 0.05 + 2.3 * brakeU.v;
    },
  };
  // rest pose
  out.sync({ rpos: { x: 0, y: 0, z: 0 }, rq: { x: 0, y: 0, z: 0, w: 1 }, wheels: spec.wheels.map(() => ({ suspLen: spec.restLength - restComp, spin: 0, steerAngle: 0 })), throttle: 0, brake: 0, forwardSpeed: 0, input: {} }, 0);
  return out;
}
