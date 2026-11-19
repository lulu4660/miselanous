// Procedural chunky expedition 4x4 with roof rack + surfboard, visible coil-over shocks,
// knobbly tyres, a springy antenna with a pennant. Origin = centre of mass.
import * as THREE from 'three';
import { colorize, colorizeFn, place, merge, softBox, profileExtrude } from './geo.js';
import { CAR } from '../vehicle.js';

export const CAR_COLORS = {
  body: '#f2755b', cabin: '#f6ead6', trim: '#3b3442', rim: '#f3e6cf', tyre: '#4a4252',
  board: '#3dbdb7', boardStripe: '#ffcf5c', can: '#6f7e3f', bag: '#e6a83b', shock: '#ffc94d', glass: '#283544',
};

function makeTyreGeo() {
  const r = CAR.wheelRadius, w = 0.2;
  const prof = [
    [0.27, -w], [0.4, -w], [r - 0.015, -w + 0.04], [r, -w + 0.09], [r, w - 0.09], [r - 0.015, w - 0.04], [0.4, w], [0.27, w],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const tyre = new THREE.LatheGeometry(prof, 22);
  tyre.rotateZ(Math.PI / 2); // axis -> x
  colorize(tyre, CAR_COLORS.tyre);
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
  colorizeFn(rim, (x, y, z) => (Math.hypot(y, z) > 0.2 ? CAR_COLORS.rim : '#e9d9bd'));
  parts.push(rim);
  const dish = new THREE.CylinderGeometry(0.2, 0.25, 0.04, 20); dish.rotateZ(Math.PI / 2); place(dish, { x: 0.16 });
  colorize(dish, '#efe1c8'); parts.push(dish);
  const hub = new THREE.CylinderGeometry(0.075, 0.09, 0.08, 10); hub.rotateZ(Math.PI / 2); place(hub, { x: 0.19 });
  colorize(hub, CAR_COLORS.trim); parts.push(hub);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const b = new THREE.SphereGeometry(0.022, 6, 4); place(b, { x: 0.185, y: Math.cos(a) * 0.14, z: Math.sin(a) * 0.14 });
    colorize(b, '#b7a68c'); parts.push(b);
  }
  return merge(parts);
}

function surfboard() {
  const g = new THREE.SphereGeometry(1, 24, 12);
  g.scale(0.3, 0.05, 1.18);
  // flatten the deck a bit and give it a pointy nose
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const taper = z > 0 ? 1 - Math.pow(z / 1.18, 2.4) * 0.55 : 1 - Math.pow(-z / 1.18, 3) * 0.3;
    p.setX(i, p.getX(i) * taper);
  }
  g.computeVertexNormals();
  colorizeFn(g, (x, y, z) => (Math.abs(x) < 0.035 && y > 0 ? CAR_COLORS.boardStripe : Math.abs(z - 0.25) < 0.06 ? '#ffffff' : CAR_COLORS.board));
  return g;
}

export function createCarModel() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // follows the chassis rigid body
  root.add(body);

  // --- Body shell (vertex coloured, one draw call)
  const parts = [];
  const lower = profileExtrude([
    [-2.02, -0.2], [2.0, -0.2], [2.12, 0.02], [2.1, 0.33], [1.92, 0.45], [0.95, 0.5], [-1.9, 0.48], [-2.06, 0.36], [-2.1, 0.02],
  ], 1.56, 0.09);
  colorizeFn(lower, (x, y) => (y < -0.05 ? '#d9614b' : CAR_COLORS.body));
  parts.push(lower);
  // cabin: window band inset handled by glass mesh
  const cabin = profileExtrude([
    [0.95, 0.44], [0.45, 1.14], [-1.82, 1.16], [-1.96, 1.0], [-1.98, 0.44],
  ], 1.46, 0.08);
  colorize(cabin, CAR_COLORS.cabin);
  parts.push(cabin);
  // coral roof cap stripe
  const roofCap = softBox(1.38, 0.05, 2.18, 0.02, 1); place(roofCap, { y: 1.19, z: -0.72 }); colorize(roofCap, CAR_COLORS.body); parts.push(roofCap);
  // fender flares (arches)
  for (const w of CAR.wheels) {
    const arch = new THREE.Shape();
    arch.absarc(0, 0, 0.66, 0, Math.PI, false);
    arch.absarc(0, 0, 0.53, Math.PI, 0, true);
    const ag = new THREE.ExtrudeGeometry(arch, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 14 });
    ag.deleteAttribute('uv');
    ag.translate(0, 0, -0.18);
    ag.rotateY(Math.PI / 2);
    place(ag, { x: w.x > 0 ? 0.86 : -0.86, y: -0.33, z: w.z });
    colorize(ag, CAR_COLORS.trim);
    parts.push(ag);
  }
  // under-body, sliders, bumpers
  const under = softBox(1.24, 0.22, 3.7, 0.05, 1); place(under, { y: -0.3 }); colorize(under, '#2a2630'); parts.push(under);
  for (const s of [-1, 1]) { const sl = softBox(0.12, 0.12, 1.5, 0.04, 1); place(sl, { x: s * 0.82, y: -0.24, z: 0.05 }); colorize(sl, CAR_COLORS.trim); parts.push(sl); }
  const fb = softBox(1.86, 0.26, 0.3, 0.07, 2); place(fb, { y: -0.08, z: 2.17 }); colorize(fb, CAR_COLORS.trim); parts.push(fb);
  const rb = softBox(1.8, 0.24, 0.26, 0.07, 2); place(rb, { y: -0.06, z: -2.15 }); colorize(rb, CAR_COLORS.trim); parts.push(rb);
  // winch + tow hooks
  const winch = new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12); winch.rotateZ(Math.PI / 2); place(winch, { y: -0.02, z: 2.33 }); colorize(winch, '#4a4450'); parts.push(winch);
  for (const s of [-1, 1]) { const hk = new THREE.TorusGeometry(0.06, 0.02, 6, 10); place(hk, { x: s * 0.6, y: -0.12, z: 2.34, ry: Math.PI / 2 }); colorize(hk, '#e85b43'); parts.push(hk); }
  // grille
  const grille = softBox(0.82, 0.24, 0.05, 0.02, 1); place(grille, { y: 0.22, z: 2.1 }); colorize(grille, '#3d3843'); parts.push(grille);
  for (let k = -2; k <= 2; k++) { const sl = softBox(0.05, 0.2, 0.04, 0.01, 1); place(sl, { x: k * 0.15, y: 0.22, z: 2.13 }); colorize(sl, '#f3e6cf'); parts.push(sl); }
  // headlight housings
  for (const s of [-1, 1]) {
    const hh = new THREE.CylinderGeometry(0.16, 0.17, 0.08, 16); hh.rotateX(Math.PI / 2); place(hh, { x: s * 0.6, y: 0.24, z: 2.09 }); colorize(hh, CAR_COLORS.trim); parts.push(hh);
  }
  // mirrors
  for (const s of [-1, 1]) {
    const arm = softBox(0.18, 0.04, 0.04, 0.01, 1); place(arm, { x: s * 0.8, y: 0.62, z: 0.82 }); colorize(arm, CAR_COLORS.trim); parts.push(arm);
    const mi = softBox(0.06, 0.16, 0.22, 0.03, 1); place(mi, { x: s * 0.9, y: 0.68, z: 0.8 }); colorize(mi, CAR_COLORS.trim); parts.push(mi);
  }
  // snorkel (right side = -x)
  const sn = new THREE.CylinderGeometry(0.055, 0.06, 0.95, 10); place(sn, { x: -0.8, y: 0.78, z: 0.98 }); colorize(sn, CAR_COLORS.trim); parts.push(sn);
  const snc = softBox(0.16, 0.12, 0.2, 0.04, 1); place(snc, { x: -0.8, y: 1.28, z: 0.98 }); colorize(snc, CAR_COLORS.trim); parts.push(snc);
  // roof rack
  for (const s of [-1, 1]) { const rail = softBox(0.06, 0.06, 2.3, 0.02, 1); place(rail, { x: s * 0.62, y: 1.32, z: -0.7 }); colorize(rail, CAR_COLORS.trim); parts.push(rail); }
  for (const z of [-1.7, -1.0, -0.3, 0.35]) { const cb = softBox(1.3, 0.05, 0.06, 0.02, 1); place(cb, { y: 1.3, z }); colorize(cb, CAR_COLORS.trim); parts.push(cb); }
  for (const s of [-1, 1]) for (const z of [-1.7, 0.35]) { const ft = softBox(0.06, 0.14, 0.06, 0.02, 1); place(ft, { x: s * 0.62, y: 1.23, z }); colorize(ft, CAR_COLORS.trim); parts.push(ft); }
  const board = surfboard(); place(board, { x: 0.22, y: 1.4, z: -0.55, rz: 0.06 }); parts.push(board);
  const can = softBox(0.26, 0.36, 0.44, 0.05, 2); place(can, { x: -0.42, y: 1.52, z: -1.35 }); colorize(can, CAR_COLORS.can); parts.push(can);
  const capc = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8); place(capc, { x: -0.42, y: 1.73, z: -1.2 }); colorize(capc, '#e8c55a'); parts.push(capc);
  const bag = new THREE.CylinderGeometry(0.15, 0.15, 0.62, 12); bag.rotateZ(Math.PI / 2); place(bag, { x: -0.36, y: 1.47, z: -0.25 }); colorize(bag, CAR_COLORS.bag); parts.push(bag);
  for (const dx of [-0.2, 0.2]) { const strap = new THREE.TorusGeometry(0.155, 0.015, 4, 14); strap.rotateY(Math.PI / 2); place(strap, { x: -0.36 + dx, y: 1.47, z: -0.25 }); colorize(strap, '#6b4a2f'); parts.push(strap); }
  // rear ladder + spare wheel bracket
  const br = softBox(0.5, 0.5, 0.08, 0.03, 1); place(br, { y: 0.45, z: -2.12 }); colorize(br, CAR_COLORS.trim); parts.push(br);
  // door seams + handles
  for (const s of [-1, 1]) {
    const seam = softBox(0.012, 0.62, 0.02, 0.004, 1); place(seam, { x: s * 0.785, y: 0.18, z: -0.55 }); colorize(seam, '#c55a46'); parts.push(seam);
    const hd = softBox(0.03, 0.04, 0.16, 0.01, 1); place(hd, { x: s * 0.79, y: 0.36, z: -0.3 }); colorize(hd, CAR_COLORS.trim); parts.push(hd);
  }

  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
  const shell = new THREE.Mesh(merge(parts), bodyMat);
  shell.castShadow = true; shell.receiveShadow = true;
  body.add(shell);

  // --- Glass (slightly glossy)
  const glassParts = [];
  for (const s of [-1, 1]) {
    const fw = profileExtrude([[0.78, 0.56], [0.44, 1.04], [-0.42, 1.04], [-0.42, 0.56]], 0.05, 0.015);
    place(fw, { x: s * 0.715 });
    glassParts.push(fw);
    const rw = profileExtrude([[-0.58, 0.56], [-0.58, 1.04], [-1.72, 1.04], [-1.8, 0.92], [-1.8, 0.56]], 0.05, 0.015);
    place(rw, { x: s * 0.715 });
    glassParts.push(rw);
  }
  const ws = profileExtrude([[0.9, 0.54], [0.5, 1.08], [0.46, 1.08], [0.86, 0.54]], 1.24, 0.02);
  place(ws, { y: 0.0, z: 0.03 });
  glassParts.push(ws);
  const rearG = softBox(1.1, 0.42, 0.04, 0.02, 1); place(rearG, { y: 0.8, z: -1.99 }); glassParts.push(rearG);
  glassParts.forEach((g) => colorize(g, CAR_COLORS.glass));
  const glass = new THREE.Mesh(merge(glassParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3, color: '#ffffff' }));
  body.add(glass);

  // --- Lights (emissive, unlit)
  const lightParts = [];
  for (const s of [-1, 1]) {
    const hl = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16); hl.rotateX(Math.PI / 2); place(hl, { x: s * 0.6, y: 0.24, z: 2.14 }); colorize(hl, '#fff1c7'); lightParts.push(hl);
    const ind = softBox(0.12, 0.06, 0.03, 0.01, 1); place(ind, { x: s * 0.6, y: 0.05, z: 2.17 }); colorize(ind, '#ffb347'); lightParts.push(ind);
    const tl = softBox(0.14, 0.24, 0.03, 0.02, 1); place(tl, { x: s * 0.7, y: 0.26, z: -2.12 }); colorize(tl, '#ff4a3d'); lightParts.push(tl);
  }
  const roofLights = softBox(0.9, 0.08, 0.1, 0.03, 1); place(roofLights, { y: 1.38, z: 0.42 }); colorize(roofLights, CAR_COLORS.trim);
  const lamps = [];
  for (let k = 0; k < 4; k++) { const l = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10); l.rotateX(Math.PI / 2); place(l, { x: -0.33 + k * 0.22, y: 1.38, z: 0.48 }); colorize(l, '#fff5d6'); lamps.push(l); }
  lightParts.push(...lamps);
  const lights = new THREE.Mesh(merge(lightParts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  body.add(lights);
  const rl = new THREE.Mesh(merge([roofLights]), bodyMat);
  body.add(rl);
  const brakeMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0 });
  const brakeGlow = new THREE.Mesh(merge([place(softBox(0.18, 0.28, 0.02, 0.02, 1), { x: 0.7, y: 0.26, z: -2.14 }), place(softBox(0.18, 0.28, 0.02, 0.02, 1), { x: -0.7, y: 0.26, z: -2.14 })]), brakeMat);
  body.add(brakeGlow);

  // --- Spare wheel on the back
  const tyreGeo = makeTyreGeo();
  const tyreMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const spare = new THREE.Mesh(tyreGeo, tyreMat);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 0.48, -2.38);
  spare.scale.setScalar(0.92);
  spare.castShadow = true;
  body.add(spare);

  // --- Antenna (springy) with pennant
  const antPivot = new THREE.Group();
  antPivot.position.set(0.62, 1.12, -1.8);
  body.add(antPivot);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 1.5, 5).translate(0, 0.75, 0), new THREE.MeshLambertMaterial({ color: '#2b2730' }));
  antPivot.add(antenna);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.16, 0, 0, -0.08, -0.34], 3));
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: '#ffcf5c', side: THREE.DoubleSide }));
  flag.position.y = 1.5;
  antPivot.add(flag);

  // --- Wheels + shocks
  const wheels = [];
  const shockMat = new THREE.MeshStandardMaterial({ color: CAR_COLORS.shock, roughness: 0.5 });
  const shockBodyMat = new THREE.MeshStandardMaterial({ color: '#3a3540', roughness: 0.6 });
  const coilGeo = (() => {
    // helix tube
    const pts = [];
    for (let i = 0; i <= 90; i++) { const a = (i / 90) * Math.PI * 2 * 6; pts.push(new THREE.Vector3(Math.cos(a) * 0.075, i / 90, Math.sin(a) * 0.075)); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.016, 5, false);
  })();
  const damperGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0);
  for (let i = 0; i < 4; i++) {
    const w = CAR.wheels[i];
    const pivot = new THREE.Group(); // steering + suspension travel (in body space)
    body.add(pivot);
    const spin = new THREE.Mesh(tyreGeo, tyreMat);
    spin.castShadow = true;
    const holder = new THREE.Group();
    if (w.x < 0) holder.rotation.y = Math.PI; // mirror so the rim faces outwards
    holder.add(spin);
    pivot.add(holder);
    // shock: from body anchor down to hub (in body space, not steered)
    const shock = new THREE.Group();
    shock.position.set(w.x * 0.82, w.y + 0.1, w.z + (w.front ? -0.12 : 0.12));
    const coil = new THREE.Mesh(coilGeo, shockMat);
    const damper = new THREE.Mesh(damperGeo, shockBodyMat);
    shock.add(coil, damper);
    body.add(shock);
    wheels.push({ pivot, holder, spin, shock, coil, damper, cfg: w });
  }

  // --- State for secondary motion
  const ant = { ax: 0, az: 0, vx: 0, vz: 0 };
  const prevVel = new THREE.Vector3();
  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  let flagT = 0;

  return {
    root, body, wheels, brakeMat,
    sync(car, dt) {
      const rp = car.rpos || car.pos, rq = car.rq || car.q;
      body.position.set(rp.x, rp.y, rp.z);
      body.quaternion.set(rq.x, rq.y, rq.z, rq.w);
      for (let i = 0; i < 4; i++) {
        const W = wheels[i], cw = car.wheels[i];
        const len = cw.suspLen; // anchor -> wheel centre distance along body -y
        W.pivot.position.set(cw.x, cw.y - len, cw.z);
        W.pivot.rotation.y = cw.steerAngle;
        W.spin.rotation.x = cw.spin;
        // shock from anchor (top) to the hub
        const top = W.shock.position.y;
        const hubY = cw.y - len + 0.02;
        const L = Math.max(0.1, top - hubY);
        W.shock.scale.set(1, 1, 1);
        W.coil.position.y = -L; W.coil.scale.set(1, L, 1);
        W.damper.position.y = -L; W.damper.scale.set(1, L, 1);
      }
      // brake lights
      const braking = ((car.throttle < -0.05 || car.brake > 0.1) && car.forwardSpeed > 0.5) || car.input.handbrake;
      brakeMat.opacity += ((braking ? 0.9 : 0) - brakeMat.opacity) * Math.min(1, dt * 12);
      // antenna: driven by acceleration in body space
      if (dt > 0) {
        tmpV.set(car.vel.x - prevVel.x, car.vel.y - prevVel.y, car.vel.z - prevVel.z).divideScalar(dt);
        prevVel.set(car.vel.x, car.vel.y, car.vel.z);
        tmpQ.set(car.q.x, car.q.y, car.q.z, car.q.w).invert();
        tmpV.applyQuaternion(tmpQ);
        const k = 70, c = 4.5;
        ant.vx += (-k * ant.ax - c * ant.vx + tmpV.z * 0.09) * dt;
        ant.vz += (-k * ant.az - c * ant.vz - tmpV.x * 0.09) * dt;
        ant.ax += ant.vx * dt; ant.az += ant.vz * dt;
        ant.ax = Math.max(-0.7, Math.min(0.7, ant.ax)); ant.az = Math.max(-0.7, Math.min(0.7, ant.az));
        antPivot.rotation.set(-0.12 - ant.ax - Math.min(0.35, car.forwardSpeed * 0.018), 0, ant.az);
        flagT += dt * (4 + car.speed * 0.6);
        flag.rotation.y = Math.sin(flagT) * 0.35 + Math.PI * 0.0;
      }
    },
  };
}
