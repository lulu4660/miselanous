// Vehicle model: body from bodies.js (per-vehicle shapes and livery) + rally wheels (instanced), coil-over
// shocks (instanced), a springy antenna with pennant and brake lights, driven by the physics telemetry.
//
// Draw calls per car: 6 = paint shell, glass, lights(+brake glow), wheels (1 InstancedMesh), shocks (1 InstancedMesh),
// antenna+pennant.
//
// API additions (all optional for the caller):
//   model.setDirt(amount 0..1, color)  -> dirties the lower body (mud/dust, e.g. '#8a6a46') or whitens it (snow,
//                                         e.g. '#f2f6fa'). The noisy "tide line" rises with `amount`. It is a per-car
//                                         uniform on the paint material (object-space height, so it never slides).
//   model.dirt                         -> current amount (read only).
// The paint is a MeshPhysicalMaterial (clearcoat) that relies on scene.environment for its reflections.
import * as THREE from 'three';
import { colorize, colorizeFn, place, merge } from './geo.js';
import { buildBody } from './bodies.js';

// ---------------------------------------------------------------------------------------------
// Wheel: lathe tyre with staggered tread lugs + sidewall ring, 5-spoke dished rim, brake disc behind the spokes.
// Built once per rim colour for a 0.46 m radius, scaled per instance (so one geometry for all radii).
const WHEEL_R = 0.46;
const wheelCache = new Map();
function makeWheelGeo(rimHex, spokes = 5) {
  const key = rimHex + '/' + spokes;
  if (wheelCache.has(key)) return wheelCache.get(key);
  // (radius, axial) profile; axial +x is the outer face
  const prof = [[0.30, -0.19], [0.335, -0.205], [0.37, -0.208], [0.395, -0.205], [0.44, -0.165], [0.46, -0.09], [0.46, 0.09], [0.44, 0.165], [0.395, 0.205], [0.37, 0.208], [0.335, 0.205], [0.30, 0.19]];
  const NP = prof.length, SEG = 20;
  const tyre = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), SEG);
  const p = tyre.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const seg = Math.floor(i / NP), j = i % NP;
    // staggered lugs: groove the crown on alternate segments, opposite phase left/right
    let g = 0;
    if (j === 4 || j === 5 || j === 6 || j === 7) {
      const right = j >= 6;
      const odd = (seg & 1) === (right ? 0 : 1);
      if (odd) g = (j === 5 || j === 6) ? 0.032 : 0.02;
    }
       if (g) { const x = p.getX(i), z = p.getZ(i), f = 1 - g / Math.hypot(x, z); p.setXYZ(i, x * f, p.getY(i), z * f); }
  }
  tyre.computeVertexNormals();
  tyre.rotateZ(-Math.PI / 2); // lathe axis y -> x
  colorizeFn(tyre, (x, y, z, i) => { const j = i % NP; return (j === 2 || j === 9) ? '#8a8591' : '#3c3745'; });
  const parts = [tyre];
  // dark rim well + brake disc
  const well = new THREE.CylinderGeometry(0.285, 0.285, 0.12, 14, 1); well.rotateZ(Math.PI / 2); place(well, { x: 0.07 });
  colorize(well, '#201c25'); parts.push(well);
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14, 1); disc.rotateZ(Math.PI / 2); place(disc, { x: 0.125 });
  colorize(disc, '#8c8794'); parts.push(disc);
  // lip ring
  const lip = new THREE.LatheGeometry([[0.25, 0.19], [0.30, 0.22], [0.325, 0.19]].map(([r, a]) => new THREE.Vector2(r, a)), 16);
  lip.rotateZ(-Math.PI / 2);
  colorize(lip, rimHex); parts.push(lip);
  // spokes + hub
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(0.04, 0.25, 0.085);
    place(sp, { x: 0.195, y: 0.17, rx: 0 });
    sp.rotateX(a);
    colorize(sp, rimHex); parts.push(sp);
  }
  const hub = new THREE.CylinderGeometry(0.075, 0.095, 0.07, 8, 1); hub.rotateZ(-Math.PI / 2); place(hub, { x: 0.2 });
  colorize(hub, shadeHex(rimHex, 0.55)); parts.push(hub);
  const geo = merge(parts);
  wheelCache.set(key, geo);
  return geo;
}
function shadeHex(hex, f) { return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString(); }

// Rim colour per car (from the livery): gold/yellow for the hatch, cream on the coupé, steel for the 4x4, orange buggy.
function rimOf(id, L) {
  if (id === 'bison') return '#d9d2c2';
  return L.accent;
}

// Coil-over: unit-length (y 0..1) helix + damper, scaled in y per instance.
let SHOCK = null;
function makeShockGeo() {
  if (SHOCK) return SHOCK;
  const pts = [];
  for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2 * 2.5; pts.push(new THREE.Vector3(Math.cos(a) * 0.065, i / 20, Math.sin(a) * 0.065)); }
  const coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.017, 3, false);
  colorize(coil, '#ffc94d');
  const damper = new THREE.CylinderGeometry(0.03, 0.03, 1, 5, 1, true).translate(0, 0.5, 0);
  colorize(damper, '#3a3540');
  SHOCK = merge([coil, damper]);
  return SHOCK;
}

const shared = {};
function sharedMats() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.45, envMapIntensity: 1.3 });
  shared.tyre = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 });
  shared.shock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  shared.antenna = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return shared;
}

// Per-car paint: clearcoat + object-space dirt line (uDirt 0..1, uDirtColor).
function makePaint() {
  const U = { uDirt: { value: 0 }, uDirtColor: { value: new THREE.Color('#8a6a46') } };
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = U.uDirt; sh.uniforms.uDirtColor = U.uDirtColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLp; uniform float uDirt; uniform vec3 uDirtColor;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float dirtM = 0.0;
if (uDirt > 0.001) {
  float n = vn(vLp.xz * 6.0 + vLp.y * 3.0) * 0.6 + vn(vLp.xz * 17.0 + vLp.y * 9.0) * 0.4;
  float h = vLp.y + 0.34;
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

// Lights: unlit vertex colours; vertices flagged aBrk=1 are the brake-glow overlay (hidden unless braking).
function makeLights() {
  const U = { uBrake: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBrake = U.uBrake;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBrk; varying float vBrk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrk = aBrk;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBrk; uniform float uBrake;')
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vBrk > 0.5) { if (uBrake < 0.03) discard; diffuseColor.rgb = vec3(1.0, 0.1, 0.06) * (0.3 + 0.7 * uBrake); }`);
  };
  return { mat, U };
}

export function createVehicleModel(spec, livery) {
  const M = sharedMats();
  const L = livery || spec.livery;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const B = buildBody(spec.id, L);
  const paint = makePaint(), lit = makeLights();
  const shell = new THREE.Mesh(B.shell, paint.mat); shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const glass = new THREE.Mesh(B.glass, M.glass); body.add(glass);
  const lights = new THREE.Mesh(B.lights, lit.mat); body.add(lights);

  // antenna + pennant (one mesh, vertex coloured)
  let antMesh = null, antGeo = null;
  if (B.antenna) {
    const pole = new THREE.CylinderGeometry(0.008, 0.014, 1.3, 4, 1).translate(0, 0.65, 0); colorize(pole, '#2b2730');
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.3, 0, 0, 1.15, 0, 0, 1.225, -0.3], 3));
    fg.computeVertexNormals(); colorize(fg, L.accent);
    antGeo = merge([pole, fg]);
    antMesh = new THREE.Mesh(antGeo, M.antenna);
    antMesh.position.set(B.antenna.x, B.antenna.y, B.antenna.z);
    body.add(antMesh);
  }

  // wheels: one InstancedMesh, shared geometry
  const rim = rimOf(spec.id, L);
  const nW = spec.wheels.length;
  const wheelMesh = new THREE.InstancedMesh(makeWheelGeo(rim), M.tyre, nW);
  wheelMesh.castShadow = true; wheelMesh.frustumCulled = false;
  body.add(wheelMesh);
  const wInfo = spec.wheels.map((w) => {
    const k = w.radius / WHEEL_R;
    return { cfg: w, scale: new THREE.Vector3(spec.id === 'bison' ? 1.05 : 0.9 * Math.max(0.95, k), k, k), flip: w.x < 0 ? Math.PI : 0, top: w.y + 0.08, sx: w.x * 0.8, sz: w.z + (w.front ? -0.1 : 0.1) };
  });
  const shockMesh = new THREE.InstancedMesh(makeShockGeo(), M.shock, nW);
  shockMesh.frustumCulled = false;
  body.add(shockMesh);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function poseWheel(i, cw) {
    const W = wInfo[i];
    _e.set(cw.spin, cw.steerAngle + W.flip, 0);
    _q.setFromEuler(_e);
    _p.set(cw.x, cw.y - cw.suspLen, cw.z);
    _m.compose(_p, _q, W.scale);
    wheelMesh.setMatrixAt(i, _m);
    const hubY = cw.y - cw.suspLen + 0.02, L2 = Math.max(0.08, W.top - hubY);
    _p.set(W.sx, W.top - L2, W.sz); _s.set(1, L2, 1);
    _m.compose(_p, _qi, _s);
    shockMesh.setMatrixAt(i, _m);
  }
  // rest pose so the first frame is already right
  for (let i = 0; i < nW; i++) poseWheel(i, { x: wInfo[i].cfg.x, y: wInfo[i].cfg.y, z: wInfo[i].cfg.z, suspLen: spec.restLength * 0.7, spin: 0, steerAngle: 0 });

  const ant = { ax: 0, az: 0, vx: 0, vz: 0 };
  const prevVel = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const out = {
    root, body, dirt: 0,
    setDirt(amount, color) {
      out.dirt = Math.max(0, Math.min(1, amount || 0));
      paint.U.uDirt.value = out.dirt;
      if (color !== undefined) paint.U.uDirtColor.value.set(color);
    },
    dispose() {
      shell.geometry.dispose(); glass.geometry.dispose(); lights.geometry.dispose();
      if (antGeo) antGeo.dispose();
      paint.mat.dispose(); lit.mat.dispose();
      wheelMesh.dispose(); shockMesh.dispose(); // instance buffers only; shared geometries stay cached
    },
    sync(car, dt) {
      const rp = car.rpos || car.pos, rq = car.rq || car.q;
      body.position.set(rp.x, rp.y, rp.z);
      body.quaternion.set(rq.x, rq.y, rq.z, rq.w);
      for (let i = 0; i < nW; i++) poseWheel(i, car.wheels[i]);
      wheelMesh.instanceMatrix.needsUpdate = true; shockMesh.instanceMatrix.needsUpdate = true;
      const braking = ((car.throttle < -0.05 || car.brake > 0.1) && car.forwardSpeed > 0.5) || car.input.handbrake;
      const u = lit.U.uBrake;
      u.value += ((braking ? 1 : 0) - u.value) * Math.min(1, dt * 12);
      if (antMesh && dt > 0) {
        tmpV.set(car.vel.x - prevVel.x, car.vel.y - prevVel.y, car.vel.z - prevVel.z).divideScalar(dt);
        prevVel.set(car.vel.x, car.vel.y, car.vel.z);
        tmpQ.set(rq.x, rq.y, rq.z, rq.w).invert();
        tmpV.applyQuaternion(tmpQ);
        const ks = 70, c = 4.5;
        ant.vx += (-ks * ant.ax - c * ant.vx + Math.max(-60, Math.min(60, tmpV.z)) * 0.09) * dt;
        ant.vz += (-ks * ant.az - c * ant.vz - Math.max(-60, Math.min(60, tmpV.x)) * 0.09) * dt;
        ant.ax = Math.max(-0.7, Math.min(0.7, ant.ax + ant.vx * dt)); ant.az = Math.max(-0.7, Math.min(0.7, ant.az + ant.vz * dt));
        antMesh.rotation.set(-0.12 - ant.ax - Math.min(0.35, car.forwardSpeed * 0.01), 0, ant.az);
      }
    },
  };
  return out;
}
