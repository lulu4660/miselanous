// Bumpable roadside props as cannon-es rigid bodies (cones on asphalt, hay bales on dirt,
// snowmen in the snow, barrels). Car-vs-prop contacts use a mass-weighted push so a prop
// never lifts or flips a car. Props sleep when no car is near.
import * as CANNON from 'cannon-es';
import { PROP_GROUP } from './vehicle.js';

export const PROP_KINDS = {
  cone:    { r: 0.32, m: 3, half: 0.36, sound: 'ring', bouncy: true },
  hay:     { r: 0.62, m: 45, half: 0.45, sound: 'wood' },
  snowman: { r: 0.55, m: 30, half: 0.85, sound: 'ground' },
  barrel:  { r: 0.48, m: 30, half: 0.48, sound: 'buoy' },
  tyres:   { r: 0.55, m: 40, half: 0.4, sound: 'ball' },
};

function shapesFor(kind) {
  switch (kind) {
    case 'cone': return [[new CANNON.Cylinder(0.06, 0.3, 0.7, 8), [0, 0, 0]], [new CANNON.Box(new CANNON.Vec3(0.3, 0.03, 0.3)), [0, -0.33, 0]]];
    case 'hay': {
      const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2);
      return [[new CANNON.Cylinder(0.55, 0.55, 1.1, 10), [0, 0, 0], q]];
    }
    case 'snowman': return [[new CANNON.Sphere(0.5), [0, -0.35, 0]], [new CANNON.Sphere(0.36), [0, 0.35, 0]], [new CANNON.Sphere(0.24), [0, 0.85, 0]]];
    case 'barrel': return [[new CANNON.Cylinder(0.4, 0.4, 0.95, 10), [0, 0, 0]]];
    case 'tyres': return [[new CANNON.Cylinder(0.55, 0.55, 0.8, 10), [0, 0, 0]]];
    default: return [[new CANNON.Sphere(0.4), [0, 0, 0]]];
  }
}

export function createProps(world, map, M) {
  const list = [];
  const P = { list, events: [], time: 0 };

  P.add = function (kind, x, z, opts = {}) {
    const K = PROP_KINDS[kind];
    const y = map.heightAt(x, z) + K.half + 0.05;
    const body = new CANNON.Body({
      mass: K.m, material: K.bouncy ? M.bouncy : M.prop, position: new CANNON.Vec3(x, y, z),
      allowSleep: true, sleepSpeedLimit: 0.2, sleepTimeLimit: 0.8, linearDamping: 0.03, angularDamping: 0.1,
    });
    for (const [sh, off, q] of shapesFor(kind)) body.addShape(sh, new CANNON.Vec3(...off), q);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), opts.yaw ?? Math.random() * 6.28);
    body.collisionFilterGroup = PROP_GROUP;
    body.userData = { kind: 'prop', prop: null };
    const p = {
      kind, K, r: K.r, m: K.m, body, pos: body.position, q: body.quaternion, vel: body.velocity,
      rpos: body.interpolatedPosition, rq: body.interpolatedQuaternion, color: opts.color || 0, lastHit: -1, lastBump: -1, id: list.length,
      home: { x, z }, inWorld: false,
    };
    body.userData.prop = p;
    body.addEventListener('collide', (e) => {
      const iv = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (iv > 2.5 && P.time - p.lastBump > 0.12) {
        p.lastBump = P.time;
        P.events.push({ type: 'propBump', kind: K.sound, intensity: Math.min(1, iv / 9), x: body.position.x, z: body.position.z });
      }
    });
    list.push(p);
    return p;
  };

  // props only live in the cannon world near an active car
  P.preStep = function (dt, cars) {
    P.time += dt;
    for (const p of list) {
      let near = false;
      for (const c of cars) if (c.active && (c.pos.x - p.pos.x) ** 2 + (c.pos.z - p.pos.z) ** 2 < 70 * 70) { near = true; break; }
      if (near && !p.inWorld) { world.addBody(p.body); p.inWorld = true; p.body.wakeUp(); }
      else if (!near && p.inWorld && p.body.sleepState === CANNON.Body.SLEEPING) { world.removeBody(p.body); p.inWorld = false; }
      if (p.inWorld && p.pos.y < map.heightAt(p.pos.x, p.pos.z) - 2) { // fell through: put it back on top
        p.pos.y = map.heightAt(p.pos.x, p.pos.z) + p.K.half + 0.1; p.vel.set(0, 0, 0);
      }
    }
  };

  // car vs props: bounding sphere vs the car's box, prop takes almost all the push
  const lp = new CANNON.Vec3(), wn = new CANNON.Vec3(), cp = new CANNON.Vec3(), vc = new CANNON.Vec3(), imp = new CANNON.Vec3(), rr = new CANNON.Vec3();
  P.carContact = function (car, events) {
    const B = car.spec.box, cb = car.body;
    for (const p of list) {
      if (!p.inWorld) continue;
      const b = p.body;
      const dx = b.position.x - cb.position.x, dz = b.position.z - cb.position.z;
      if (dx * dx + dz * dz > 20) continue;
      cb.pointToLocalFrame(b.position, lp);
      const cx = Math.max(B.minX, Math.min(B.maxX, lp.x)), cy = Math.max(B.minY, Math.min(B.maxY, lp.y)), cz = Math.max(B.minZ, Math.min(B.maxZ, lp.z));
      let ox = lp.x - cx, oy = lp.y - cy, oz = lp.z - cz;
      const d = Math.hypot(ox, oy, oz);
      let pen;
      const r = p.K.r;
      if (d > 1e-5) {
        if (d >= r) continue;
        ox /= d; oy /= d; oz /= d; pen = r - d;
      } else {
        const fx = Math.min(lp.x - B.minX, B.maxX - lp.x), fy = Math.min(lp.y - B.minY, B.maxY - lp.y), fz = Math.min(lp.z - B.minZ, B.maxZ - lp.z);
        ox = oy = oz = 0;
        if (fx <= fy && fx <= fz) { ox = lp.x - B.minX < B.maxX - lp.x ? -1 : 1; pen = fx + r; }
        else if (fy <= fz) { oy = lp.y - B.minY < B.maxY - lp.y ? -1 : 1; pen = fy + r; }
        else { oz = lp.z - B.minZ < B.maxZ - lp.z ? -1 : 1; pen = fz + r; }
      }
      if (oy < -0.3) { oy = 0; const l = Math.hypot(ox, oz) || 1; ox = ox / l || 1; oz /= l; }
      cb.vectorToWorldFrame(lp.set(ox, oy, oz), wn);
      cb.pointToWorldFrame(cp.set(cx, cy, cz), cp);
      b.wakeUp();
      const share = Math.min(0.3, (p.m / (p.m + car.spec.mass)) * 3);
      b.position.x += wn.x * pen * (1 - share); b.position.y += wn.y * pen * (1 - share); b.position.z += wn.z * pen * (1 - share);
      cb.position.x -= wn.x * pen * share; cb.position.z -= wn.z * pen * share;
      car.velocityAt(vc, cp);
      const rv = (b.velocity.x - vc.x) * wn.x + (b.velocity.y - vc.y) * wn.y + (b.velocity.z - vc.z) * wn.z;
      if (rv >= 0) continue;
      const kCar = car.invMassAt(cp, wn);
      const e = p.K.bouncy ? 0.5 : 0.2;
      const jn = (-(1 + e) * rv) / (b.invMass + kCar);
      b.velocity.x += wn.x * jn * b.invMass; b.velocity.y += wn.y * jn * b.invMass + Math.min(4, jn * b.invMass * 0.15); b.velocity.z += wn.z * jn * b.invMass;
      wn.scale(-jn, imp);
      imp.y = Math.min(imp.y, 0) * 0.3;
      cp.vsub(cb.position, rr);
      cb.applyImpulse(imp, rr);
      b.angularVelocity.x += (vc.z - b.velocity.z) * 1.2 / r; b.angularVelocity.z -= (vc.x - b.velocity.x) * 1.2 / r;
      if (-rv > 0.8 && P.time - p.lastHit > 0.15) {
        p.lastHit = P.time;
        events.push({ type: 'carHit', car, kind: p.K.sound, prop: p, intensity: Math.min(1, -rv / 9), x: b.position.x, z: b.position.z });
      }
    }
  };
  return P;
}
