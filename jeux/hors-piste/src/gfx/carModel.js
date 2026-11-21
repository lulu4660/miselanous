// Vehicle model: body from bodies.js (per-vehicle shapes and livery) + knobbly tyres, visible
// coil-over shocks, a springy antenna and brake lights, driven by the physics telemetry.
import * as THREE from 'three';
import { colorize, colorizeFn, place, merge, softBox } from './geo.js';
import { buildBody } from './bodies.js';

function makeTyreGeo() {
  const r = 0.46, w = 0.2;
  const prof = [
    [0.27, -w], [0.4, -w], [r - 0.015, -w + 0.04], [r, -w + 0.09], [r, w - 0.09], [r - 0.015, w - 0.04], [0.4, w], [0.27, w],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const tyre = new THREE.LatheGeometry(prof, 22);
  tyre.rotateZ(Math.PI / 2); // axis -> x
  colorize(tyre, '#4a4252');
  const parts = [tyre];
  // knobs
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const kb = softBox(0.13, 0.05, 0.1, 0.015, 1);
      place(kb, { x: side * 0.09 + (k % 2 ? 0.02 : -0.02) * side, y: Math.cos(a) * (r + 0.012), z: Math.sin(a) * (r + 0.012), rx: -a });
      colorize(kb, '#3b3442');
      parts.push(kb);
    }
  }
  // rim
  const rim = new THREE.CylinderGeometry(0.27, 0.27, 0.3, 20, 1);
  rim.rotateZ(Math.PI / 2);
  colorizeFn(rim, (x, y, z) => (Math.hypot(y, z) > 0.2 ? '#f3e6cf' : '#e9d9bd'));
  parts.push(rim);
  const dish = new THREE.CylinderGeometry(0.2, 0.25, 0.04, 20); dish.rotateZ(Math.PI / 2); place(dish, { x: 0.16 });
  colorize(dish, '#efe1c8'); parts.push(dish);
  const hub = new THREE.CylinderGeometry(0.075, 0.09, 0.08, 10); hub.rotateZ(Math.PI / 2); place(hub, { x: 0.19 });
  colorize(hub, '#3b3442'); parts.push(hub);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const b = new THREE.SphereGeometry(0.022, 6, 4); place(b, { x: 0.185, y: Math.cos(a) * 0.14, z: Math.sin(a) * 0.14 });
    colorize(b, '#b7a68c'); parts.push(b);
  }
  return merge(parts);
}


let TYRE = null;
const shared = {};
function mats() {
  if (shared.body) return shared;
  shared.body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  shared.glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3 });
  shared.lights = new THREE.MeshBasicMaterial({ vertexColors: true });
  shared.tyre = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  shared.shock = new THREE.MeshStandardMaterial({ color: '#ffc94d', roughness: 0.5 });
  shared.damper = new THREE.MeshStandardMaterial({ color: '#3a3540', roughness: 0.6 });
  shared.antenna = new THREE.MeshLambertMaterial({ color: '#2b2730' });
  const pts = [];
  for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2 * 5; pts.push(new THREE.Vector3(Math.cos(a) * 0.065, i / 72, Math.sin(a) * 0.065)); }
  shared.coilGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.014, 4, false);
  shared.damperGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, 0.5, 0);
  return shared;
}

export function createVehicleModel(spec, livery) {
  const M = mats();
  if (!TYRE) TYRE = makeTyreGeo();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const B = buildBody(spec.id, livery || spec.livery);
  const shell = new THREE.Mesh(B.shell, M.body); shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const glass = new THREE.Mesh(B.glass, M.glass); body.add(glass);
  const lights = new THREE.Mesh(B.lights, M.lights); body.add(lights);
  const brakeMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0 });
  const brake = new THREE.Mesh(B.brake, brakeMat); body.add(brake);

  // antenna with a pennant
  let antPivot = null, flag = null;
  if (B.antenna) {
    antPivot = new THREE.Group();
    antPivot.position.set(B.antenna.x, B.antenna.y, B.antenna.z);
    body.add(antPivot);
    antPivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 1.3, 5).translate(0, 0.65, 0), M.antenna));
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.15, 0, 0, -0.075, -0.3], 3));
    fg.computeVertexNormals();
    flag = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: (livery || spec.livery).accent, side: THREE.DoubleSide }));
    flag.position.y = 1.3;
    antPivot.add(flag);
  }

  const wheels = spec.wheels.map((w) => {
    const pivot = new THREE.Group();
    body.add(pivot);
    const k = w.radius / 0.46;
    const spin = new THREE.Mesh(TYRE, M.tyre);
    spin.scale.set(spec.id === 'bison' ? 1 : 0.82 * Math.max(0.9, k), k, k);
    spin.castShadow = true;
    const holder = new THREE.Group();
    if (w.x < 0) holder.rotation.y = Math.PI;
    holder.add(spin);
    pivot.add(holder);
    const shock = new THREE.Group();
    shock.position.set(w.x * 0.8, w.y + 0.08, w.z + (w.front ? -0.1 : 0.1));
    const coil = new THREE.Mesh(M.coilGeo, M.shock), damper = new THREE.Mesh(M.damperGeo, M.damper);
    shock.add(coil, damper);
    body.add(shock);
    return { pivot, spin, shock, coil, damper, cfg: w };
  });

  const ant = { ax: 0, az: 0, vx: 0, vz: 0 };
  const prevVel = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  let flagT = 0;
  return {
    root, body,
    dispose() { root.traverse((o) => { if (o.geometry && o.geometry !== TYRE && o.geometry !== M.coilGeo && o.geometry !== M.damperGeo) o.geometry.dispose(); }); brakeMat.dispose(); },
    sync(car, dt) {
      const rp = car.rpos || car.pos, rq = car.rq || car.q;
      body.position.set(rp.x, rp.y, rp.z);
      body.quaternion.set(rq.x, rq.y, rq.z, rq.w);
      for (let i = 0; i < wheels.length; i++) {
        const W = wheels[i], cw = car.wheels[i];
        W.pivot.position.set(cw.x, cw.y - cw.suspLen, cw.z);
        W.pivot.rotation.y = cw.steerAngle;
        W.spin.rotation.x = cw.spin;
        const top = W.shock.position.y, hubY = cw.y - cw.suspLen + 0.02, L = Math.max(0.08, top - hubY);
        W.coil.position.y = -L; W.coil.scale.set(1, L, 1);
        W.damper.position.y = -L; W.damper.scale.set(1, L, 1);
      }
      const braking = ((car.throttle < -0.05 || car.brake > 0.1) && car.forwardSpeed > 0.5) || car.input.handbrake;
      brakeMat.opacity += ((braking ? 0.9 : 0) - brakeMat.opacity) * Math.min(1, dt * 12);
      if (antPivot && dt > 0) {
        tmpV.set(car.vel.x - prevVel.x, car.vel.y - prevVel.y, car.vel.z - prevVel.z).divideScalar(dt);
        prevVel.set(car.vel.x, car.vel.y, car.vel.z);
        tmpQ.set(rq.x, rq.y, rq.z, rq.w).invert();
        tmpV.applyQuaternion(tmpQ);
        const ks = 70, c = 4.5;
        ant.vx += (-ks * ant.ax - c * ant.vx + Math.max(-60, Math.min(60, tmpV.z)) * 0.09) * dt;
        ant.vz += (-ks * ant.az - c * ant.vz - Math.max(-60, Math.min(60, tmpV.x)) * 0.09) * dt;
        ant.ax = Math.max(-0.7, Math.min(0.7, ant.ax + ant.vx * dt)); ant.az = Math.max(-0.7, Math.min(0.7, ant.az + ant.vz * dt));
        antPivot.rotation.set(-0.12 - ant.ax - Math.min(0.35, car.forwardSpeed * 0.01), 0, ant.az);
        flagT += dt * (4 + car.speed * 0.5);
        flag.rotation.y = Math.sin(flagT) * 0.35;
      }
    },
  };
}
