// Floating / bumpable props as cannon-es rigid bodies with their real shapes, plus
// buoyancy, water drag, wave drift, upright restoring torque and buoy tethers.
import * as CANNON from 'cannon-es';
import { PROP_GROUP } from './vehicle.js';

const G = 9.81;

// r: bounding radius (gameplay), half: half height for submersion, density vs water
export const PROP_KINDS = {
  ball:   { r: 0.42, m: 0.45, density: 0.08, half: 0.42, upright: 0, drag: 1.2, sound: 'ball', light: true },
  ring:   { r: 0.56, m: 1.6, density: 0.16, half: 0.16, upright: 1, drag: 2.0, sound: 'ring', light: true },
  buoy:   { r: 0.6, m: 38, density: 0.45, half: 0.5, upright: 1, drag: 1.6, sound: 'buoy' },
  barrel: { r: 0.48, m: 30, density: 0.55, half: 0.42, upright: 0, drag: 1.4, sound: 'wood' },
  melon:  { r: 0.36, m: 5, density: 0.9, half: 0.33, upright: 0, drag: 1.8, sound: 'ball', light: true },
  crate:  { r: 0.5, m: 22, density: 0.5, half: 0.35, upright: 1, drag: 1.6, sound: 'wood' },
};

function shapeFor(kind) {
  switch (kind) {
    case 'ball': return [new CANNON.Sphere(0.42)];
    case 'melon': return [new CANNON.Sphere(0.35)];
    case 'ring': return [new CANNON.Cylinder(0.56, 0.56, 0.3, 12)];
    case 'buoy': return [new CANNON.Cylinder(0.53, 0.56, 0.62, 12), new CANNON.Cylinder(0.12, 0.42, 0.5, 10), new CANNON.Vec3(0, 0.54, 0)];
    case 'barrel': {
      const c = new CANNON.Cylinder(0.42, 0.42, 0.95, 12);
      return [c, null, null, new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2)];
    }
    case 'crate': return [new CANNON.Box(new CANNON.Vec3(0.39, 0.35, 0.39))];
    default: return [new CANNON.Sphere(0.4)];
  }
}

export function createProps(world, terrain, water, waves, materials) {
  const list = [];
  const P = { list };
  const grad = [0, 0];
  const f = new CANNON.Vec3(), t = new CANNON.Vec3(), up = new CANNON.Vec3(), q = new CANNON.Vec3();

  P.add = function (kind, x, z, opts = {}) {
    const K = PROP_KINDS[kind];
    const gh = terrain.heightAt(x, z);
    const y = Math.max(gh + K.half + 0.05, water.levelAt(x, z) + K.half * 0.3) + (opts.yOff || 0);
    const body = new CANNON.Body({
      mass: K.m, material: K.light || kind === 'ball' ? materials.bouncy : materials.prop,
      position: new CANNON.Vec3(x, y, z), allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 1.2,
      linearDamping: 0.02, angularDamping: 0.08,
    });
    const [s1, s2, off2, rot1] = shapeFor(kind);
    body.addShape(s1, new CANNON.Vec3(0, 0, 0), rot1 || undefined);
    if (s2) body.addShape(s2, off2);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), opts.yaw ?? Math.random() * 6.28);
    body.userData = { kind: 'prop', prop: null };
    body.collisionFilterGroup = PROP_GROUP;
    world.addBody(body);
    const p = {
      kind, K, r: K.r, m: K.m, body,
      pos: body.position, q: body.quaternion, vel: body.velocity, w: body.angularVelocity,
      rpos: body.interpolatedPosition, rq: body.interpolatedQuaternion,
      tether: opts.tether ? { x, z, len: opts.tether } : null,
      submerged: 0, inWater: false, lastHit: -1, lastBump: -1, lastSplash: false, id: list.length,
      color: opts.color || 0, spawn: { x, z }, visualOffsetY: 0,
    };
    body.userData.prop = p;
    body.addEventListener('collide', (e) => {
      const iv = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const other = e.body;
      if (other.userData && other.userData.kind === 'car') return; // reported by the car
      if (iv > 2.5 && P.time - p.lastBump > 0.12) {
        p.lastBump = P.time;
        P.events.push({ type: 'propBump', kind: K.sound, intensity: Math.min(1, iv / 9), x: body.position.x, z: body.position.z });
      }
    });
    list.push(p);
    return p;
  };

  P.time = 0;
  P.events = [];

  // forces, called from world 'preStep' (before integration)
  P.preStep = function (dt, car) {
    P.time += dt;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const b = p.body, K = p.K;
      const dx = b.position.x - car.pos.x, dz = b.position.z - car.pos.z;
      const far = dx * dx + dz * dz > 45 * 45;
      if (b.sleepState === CANNON.Body.SLEEPING) {
        if (!far && p.inWater) b.wakeUp(); else continue;
      }
      const wl = water.levelAt(b.position.x, b.position.z);
      const depth = wl - (b.position.y - K.half);
      const sf = depth <= 0 ? 0 : Math.min(1, depth / (2 * K.half));
      p.submerged = sf;
      const wasIn = p.inWater;
      p.inWater = sf > 0.01;
      if (far && p.inWater && b.velocity.lengthSquared() < 0.05) { b.sleep(); continue; }
      if (sf > 0) {
        const vol = sf * sf * (3 - 2 * sf);
        f.set(0, (K.m * G * vol) / K.density, 0);
        // waves push floaties downhill on the surface; slow ambient drift
        waves.gradAt(b.position.x, b.position.z, grad);
        const push = K.m * 20 * Math.min(1, sf * 2);
        f.x += -grad[0] * push + Math.sin(P.time * 0.13 + p.id) * 0.02 * K.m;
        f.z += -grad[1] * push + Math.cos(P.time * 0.11 + p.id * 1.7) * 0.02 * K.m;
        // water drag (stronger vertically: damps bobbing)
        const dk = K.drag * sf * K.m * 1.4;
        f.x -= b.velocity.x * dk; f.z -= b.velocity.z * dk; f.y -= b.velocity.y * K.m * 20 * sf;
        b.force.vadd(f, b.force);
        b.angularVelocity.scale(Math.exp(-2.2 * sf * dt), b.angularVelocity);
        if (!wasIn && b.velocity.y < -2.5 && !p.lastSplash) {
          P.events.push({ type: 'propSplash', x: b.position.x, z: b.position.z, intensity: Math.min(1, -b.velocity.y / 8 * Math.sqrt(K.m / 5)), r: K.r });
          p.lastSplash = true;
        }
        const sp = Math.hypot(b.velocity.x, b.velocity.z);
        if (sp > 0.6 && Math.random() < 0.5) waves.disturb(b.position.x, b.position.z, -sp * 0.04 * K.r, K.r);
      }
      if (sf > 0.6 || sf === 0) p.lastSplash = false;
      // upright floaties: restoring torque toward the (wave-tilted) vertical
      if (K.upright && sf > 0) {
        b.quaternion.vmult(q.set(0, 1, 0), up);
        // axis = up x target, target ≈ water normal (−0.6 gx, 1, −0.6 gz)
        t.set(up.y * (-grad[1] * 0.6) - up.z * 1, up.z * (-grad[0] * 0.6) - up.x * (-grad[1] * 0.6), up.x * 1 - up.y * (-grad[0] * 0.6));
        t.scale(K.m * 6 * sf, t);
        b.torque.vadd(t, b.torque);
      }
      if (p.tether) {
        const ex = b.position.x - p.tether.x, ez = b.position.z - p.tether.z;
        const d = Math.hypot(ex, ez);
        if (d > p.tether.len) {
          const k = (d - p.tether.len) * 6 * K.m;
          b.force.x -= (ex / d) * k + b.velocity.x * K.m * 1.5;
          b.force.z -= (ez / d) * k + b.velocity.z * K.m * 1.5;
        }
      }
      // world bounds
      const Rb = 158;
      if (Math.abs(b.position.x) > Rb) { b.position.x = Math.sign(b.position.x) * Rb; b.velocity.x *= -0.3; }
      if (Math.abs(b.position.z) > Rb) { b.position.z = Math.sign(b.position.z) * Rb; b.velocity.z *= -0.3; }
    }
  };

  return P;
}
