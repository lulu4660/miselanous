// cannon-es world: heightfield island, static scenery (pier, ramps, trunks, rocks, hut,
// lighthouse), the 4x4 (RaycastVehicle), floating props, and couplings with the
// interactive water (ripples, wakes, splashes). Same interface as before for main.js/tests.
import * as CANNON from 'cannon-es';
import { createWaves, createWaterSurface } from './waves.js';
import { createVehicle, GROUND_GROUP } from './vehicle.js';
import { createProps } from './props.js';

export const STEP = 1 / 60;

export function createPhysics(terrain) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.broadphase.axisIndex = 0;
  world.allowSleep = true;
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.1;

  const M = {
    ground: new CANNON.Material('ground'), car: new CANNON.Material('car'), prop: new CANNON.Material('prop'),
    bouncy: new CANNON.Material('bouncy'), static: new CANNON.Material('static'),
  };
  world.addContactMaterial(new CANNON.ContactMaterial(M.car, M.ground, { friction: 0.35, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.car, M.static, { friction: 0.25, restitution: 0.05 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.bouncy, M.ground, { friction: 0.5, restitution: 0.55 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.bouncy, M.car, { friction: 0.3, restitution: 0.65 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.bouncy, M.static, { friction: 0.3, restitution: 0.6 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.bouncy, M.bouncy, { friction: 0.3, restitution: 0.7 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.prop, M.ground, { friction: 0.6, restitution: 0.15 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.prop, M.car, { friction: 0.0, restitution: 0.2 }));

  // --- Island heightfield (same triangulation as the render mesh: see terrain.heightAt)
  const { N, V, cell, half, heights } = terrain;
  const data = [];
  for (let i = 0; i < V; i++) {
    const col = new Array(V);
    for (let j = 0; j < V; j++) col[j] = heights[(N - j) * V + i];
    data.push(col);
  }
  const hf = new CANNON.Heightfield(data, { elementSize: cell });
  const ground = new CANNON.Body({ mass: 0, material: M.ground });
  ground.addShape(hf);
  ground.position.set(-half, 0, half);
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.userData = { kind: 'ground' };
  ground.collisionFilterGroup = GROUND_GROUP;
  world.addBody(ground);

  // --- Structures from the layout: pier deck slab and solid ramps (wood)
  for (const s of terrain.structures) {
    const b = new CANNON.Body({ mass: 0, material: M.static });
    b.userData = { kind: 'static', wood: true, sound: 'wood' };
    if (s.type === 'ramp') {
      const L = 2 * s.hl, dy = s.y1 - s.y0, len = Math.hypot(L, dy), slope = Math.atan2(dy, L), th = 0.5;
      b.addShape(new CANNON.Box(new CANNON.Vec3(s.hw, th / 2, len / 2)));
      // centre of the slab: middle of the ramp surface, pushed down by half its thickness
      const nx = 0, ny = Math.cos(slope), nz = -Math.sin(slope);
      const cy = (s.y0 + s.y1) / 2 - ny * th / 2, czl = -nz * th / 2;
      b.position.set(s.x + czl * Math.sin(s.angle), cy, s.z + czl * Math.cos(s.angle));
      b.quaternion.setFromEuler(0, s.angle, 0, 'YXZ');
      const tilt = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -slope);
      b.quaternion = b.quaternion.mult(tilt);
      // fill under the high end so it is a solid wedge, not a floating plank
      const support = new CANNON.Box(new CANNON.Vec3(s.hw, Math.max(0.1, dy / 2), 0.25));
      b.addShape(support, new CANNON.Vec3(0, -dy / 2 + th / 2, len / 2 - 0.25));
      void nx;
    } else {
      b.addShape(new CANNON.Box(new CANNON.Vec3(s.hw, 0.15, s.hl)));
      b.position.set(s.x, s.y1 - 0.15, s.z);
      b.quaternion.setFromEuler(0, s.angle, 0);
    }
    world.addBody(b);
  }

  const waves = createWaves(terrain, { n: 128, cell: 0.5 });
  const water = createWaterSurface(waves);
  const car = createVehicle(world, terrain, water, M.car);
  const props = createProps(world, terrain, water, waves, M);
  const obstacles = [];
  const events = [];

  // pre-step: our controls/forces first, then the RaycastVehicle (registered by addToWorld)
  let tick = 0;
  // light props (balls, rings, melons) are not something the car can stand on
  const lightBodies = [];
  world.addEventListener('preStep', () => {
    car.preStep(world.dt);
    props.preStep(world.dt, car);
    for (const p of props.list) { p.body.collisionResponse = false; lightBodies.push(p.body); }
  });
  car.vehicle.addToWorld(world);
  world.addEventListener('preStep', () => {
    for (const b of lightBodies) b.collisionResponse = true;
    lightBodies.length = 0;
  });
  world.addEventListener('postStep', () => {
    tick++;
    car.postStep(world.dt);
    for (const e of car.events) events.push(e);
    car.events.length = 0;
    for (const e of props.events) events.push(e);
    props.events.length = 0;
    water.time = world.stepnumber * STEP;
    // ripples at 60 Hz whatever the physics rate
    const every = Math.max(1, Math.round(1 / 60 / STEP));
    if (tick % every === 0) {
      waves.recenter(car.pos.x, car.pos.z);
      couple();
      waves.step(STEP * every);
    }
  });

  // Car vs props: a light prop must never lift a 1150 kg car. Each prop's bounding sphere
  // is resolved against the chassis box with a mass-weighted push (the prop takes nearly all
  // of it) and an impulse exchange, as in the original hand-written version.
  const B = { minX: -0.98, maxX: 0.98, minY: -0.42, maxY: 1.22, minZ: -2.14, maxZ: 2.18 };
  const lp = new CANNON.Vec3(), wn = new CANNON.Vec3(), cp = new CANNON.Vec3(), vc = new CANNON.Vec3(), imp = new CANNON.Vec3();
  const rr = new CANNON.Vec3(), rxn = new CANNON.Vec3(), t2 = new CANNON.Vec3();
  function carProps() {
    const cb = car.body;
    for (const p of props.list) {
      const b = p.body;
      const dx = b.position.x - cb.position.x, dz = b.position.z - cb.position.z;
      if (dx * dx + dz * dz > 16) continue;
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
      // never push the car up from below: contacts under the chassis push the prop sideways
      if (oy < -0.3) { oy = 0; const l = Math.hypot(ox, oz) || 1; ox = ox / l || 1; oz /= l; }
      cb.vectorToWorldFrame(lp.set(ox, oy, oz), wn);
      cb.pointToWorldFrame(cp.set(cx, cy, cz), cp);
      b.wakeUp();
      const carShare = Math.min(0.3, (p.m / (p.m + 1150)) * 3);
      b.position.x += wn.x * pen * (1 - carShare); b.position.y += wn.y * pen * (1 - carShare); b.position.z += wn.z * pen * (1 - carShare);
      cb.position.x -= wn.x * pen * carShare; cb.position.z -= wn.z * pen * carShare;
      car.velocityAt(vc, cp);
      const rv = (b.velocity.x - vc.x) * wn.x + (b.velocity.y - vc.y) * wn.y + (b.velocity.z - vc.z) * wn.z;
      if (rv >= 0) continue;
      cp.vsub(cb.position, rr);
      rr.cross(wn, rxn); cb.invInertiaWorld.vmult(rxn, t2); t2.cross(rr, rxn);
      const kCar = cb.invMass + rxn.dot(wn);
      const e = p.K.light ? 0.6 : 0.25;
      const jn = (-(1 + e) * rv) / (b.invMass + kCar);
      b.velocity.x += wn.x * jn * b.invMass; b.velocity.y += wn.y * jn * b.invMass + Math.min(4, jn * b.invMass * 0.15); b.velocity.z += wn.z * jn * b.invMass;
      wn.scale(-jn, imp);
      imp.y = Math.min(imp.y, 0) * 0.3; // the car is never lifted by a prop
      cb.applyImpulse(imp, rr);
      b.angularVelocity.x += (vc.z - b.velocity.z) * 1.2 / r; b.angularVelocity.z -= (vc.x - b.velocity.x) * 1.2 / r;
      if (-rv > 0.8 && car.time - p.lastHit > 0.15) {
        p.lastHit = car.time;
        events.push({ type: 'carHit', kind: p.K.sound, prop: p, intensity: Math.min(1, -rv / 9), x: b.position.x, z: b.position.z });
      }
    }
  }
  world.addEventListener('postStep', carProps);

  // car collisions -> sound/camera events
  car.body.addEventListener('collide', (e) => {
    const iv = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const ud = e.body.userData || {};
    if (ud.kind === 'prop') {
      const p = ud.prop;
      if (iv > 0.8 && car.time - p.lastHit > 0.15) {
        p.lastHit = car.time;
        events.push({ type: 'carHit', kind: p.K.sound, prop: p, intensity: Math.min(1, iv / 9), x: p.pos.x, z: p.pos.z });
      }
    } else if (ud.kind === 'static' || ud.kind === 'obstacle') {
      if (iv > 1.2) events.push({ type: 'obstacle', kind: ud.sound || 'rock', intensity: Math.min(1, iv / 10) });
    } else if (ud.kind === 'ground' && iv > 3) {
      events.push({ type: 'scrape', intensity: Math.min(1, iv / 8) });
    }
  });

  const phys = { world, waves, water, car, props, obstacles, events, time: 0, ground };

  // vertical obstacles: trunks, posts, rocks, hut, lighthouse
  phys.addObstacle = (o) => {
    const h = Math.max(0.5, o.y1 - o.y0);
    const b = new CANNON.Body({ mass: 0, material: M.static });
    if (o.shape === 'sphere') b.addShape(new CANNON.Sphere(o.r), new CANNON.Vec3(0, 0, 0));
    else b.addShape(new CANNON.Cylinder(o.r, o.r, h, 10));
    b.position.set(o.x, o.shape === 'sphere' ? o.y1 - o.r * 0.55 : (o.y0 + o.y1) / 2, o.z);
    b.userData = { kind: 'obstacle', sound: o.kind === 'rock' ? 'rock' : 'wood' };
    world.addBody(b);
    o.body = b;
    obstacles.push(o);
    return o;
  };
  // reset onto a free spot: never inside a trunk, rock, hut or structure (they would eject the car)
  phys.resetCar = (x, z, heading) => {
    const blocked = (px, pz) => {
      for (const o of obstacles) if ((o.x - px) ** 2 + (o.z - pz) ** 2 < (o.r + 2.5) ** 2 && o.body.collisionResponse) return true;
      for (const s of terrain.structures) {
        const dx = px - s.x, dz = pz - s.z;
        const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
        if (Math.abs(lx) < s.hw + 2.5 && Math.abs(lz) < s.hl + 2.5) return true;
      }
      return false;
    };
    let bx = x, bz = z;
    if (blocked(x, z)) {
      search: for (let ring = 1; ring <= 12; ring++) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2, d = ring * 1.5;
          const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
          if (!blocked(px, pz) && terrain.heightAt(px, pz) > -1.5) { bx = px; bz = pz; break search; }
        }
      }
    }
    car.reset(bx, bz, heading);
  };
  phys.disableObstaclesNear = (x, z, r) => {
    for (const o of obstacles) if (Math.hypot(o.x - x, o.z - z) < r) o.body.collisionResponse = false;
  };

  // Car pushes water: submerged hull points and wheels in water make ripples & foam
  const wakePts = [
    new CANNON.Vec3(0.75, -0.3, 1.9), new CANNON.Vec3(-0.75, -0.3, 1.9), new CANNON.Vec3(0.95, -0.3, 0.3),
    new CANNON.Vec3(-0.95, -0.3, 0.3), new CANNON.Vec3(0.8, -0.3, -1.8), new CANNON.Vec3(-0.8, -0.3, -1.8),
  ];
  const prevWake = new Float32Array(wakePts.length).fill(NaN);
  const wp = new CANNON.Vec3();
  function couple() {
    let splashV = 0;
    const vx = car.vel.x, vz = car.vel.z, sp = Math.hypot(vx, vz);
    for (let i = 0; i < wakePts.length; i++) {
      car.body.pointToWorldFrame(wakePts[i], wp);
      const depth = water.levelAt(wp.x, wp.z) - wp.y;
      const py = prevWake[i];
      prevWake[i] = depth;
      if (depth <= -0.05) continue;
      const sub = Math.min(1, (depth + 0.05) / 0.5);
      waves.disturb(wp.x, wp.z, -sub * Math.min(sp, 14) * 0.065, 0.9);
      if (i < 2 && sp > 1) waves.disturb(wp.x + vx / sp * 1.1, wp.z + vz / sp * 1.1, sub * Math.min(sp, 14) * 0.035, 0.8);
      if (sp > 1.5 && i >= 2) waves.addFoam(wp.x, wp.z, sub * Math.min(1, sp / 8) * 0.2, 0.6);
      if (!Number.isNaN(py) && py <= 0 && depth > 0) splashV = Math.max(splashV, -car.vel.y, sp * 0.25);
    }
    for (const w of car.wheels) {
      if (!w.grounded) continue;
      const dep = water.levelAt(w.contact.x, w.contact.z) - w.contact.y;
      if (dep < 0.03 || sp < 0.8) continue;
      const k = Math.min(1, dep / 0.35);
      waves.disturb(w.contact.x, w.contact.z, -k * Math.min(sp, 14) * 0.05, 0.6);
      waves.disturb(w.contact.x + vx / sp * 0.9, w.contact.z + vz / sp * 0.9, k * Math.min(sp, 14) * 0.025, 0.6);
      waves.addFoam(w.contact.x - vx / sp * 0.4, w.contact.z - vz / sp * 0.4, k * Math.min(1, sp / 6) * 0.22, 0.55);
    }
    if (splashV > 1.6) {
      const I = Math.min(1, splashV / 9);
      events.push({ type: 'carSplash', intensity: I, x: car.pos.x, z: car.pos.z });
      waves.disturb(car.pos.x, car.pos.z, -I * 1.0, 2.0);
      waves.addFoam(car.pos.x, car.pos.z, I * 0.45, 1.8);
    }
  }

  phys.update = function (frameDt) {
    const before = world.stepnumber;
    world.step(STEP, Math.min(frameDt, 0.1), 12);
    phys.time = world.stepnumber * STEP;
    return world.stepnumber - before;
  };

  return phys;
}
