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
  world.addContactMaterial(new CANNON.ContactMaterial(M.prop, M.car, { friction: 0.4, restitution: 0.25 }));

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
    for (const p of props.list) if (p.K.light) { p.body.collisionResponse = false; lightBodies.push(p.body); }
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
    water.time = world.time;
    // ripples at 60 Hz whatever the physics rate
    const every = Math.max(1, Math.round(1 / 60 / STEP));
    if (tick % every === 0) {
      waves.recenter(car.pos.x, car.pos.z);
      couple();
      waves.step(STEP * every);
    }
  });

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
    if (o.kind === 'rock') b.addShape(new CANNON.Sphere(o.r), new CANNON.Vec3(0, 0, 0));
    else b.addShape(new CANNON.Cylinder(o.r, o.r, h, 10));
    b.position.set(o.x, o.kind === 'rock' ? o.y1 - o.r * 0.55 : (o.y0 + o.y1) / 2, o.z);
    b.userData = { kind: 'obstacle', sound: o.kind === 'rock' ? 'rock' : 'wood' };
    world.addBody(b);
    o.body = b;
    obstacles.push(o);
    return o;
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
    phys.time = world.time;
    return world.stepnumber - before;
  };

  return phys;
}
