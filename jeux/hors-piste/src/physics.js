// cannon-es world for the open map: heightfield, streamed static scenery, any number of
// vehicles (player + traffic), bumpable props. Fixed 60 Hz step with interpolation.
import * as CANNON from 'cannon-es';
import { createVehicle, GROUND_GROUP } from './vehicle.js';
import { createProps } from './props.js';

export const STEP = 1 / 60;

export function createPhysics(map) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.broadphase.axisIndex = 0;
  world.allowSleep = true;
  world.solver.iterations = 10;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.1;

  const M = {
    ground: new CANNON.Material('ground'), car: new CANNON.Material('car'), prop: new CANNON.Material('prop'),
    bouncy: new CANNON.Material('bouncy'), static: new CANNON.Material('static'),
  };
  world.addContactMaterial(new CANNON.ContactMaterial(M.car, M.car, { friction: 0.25, restitution: 0.15 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.car, M.static, { friction: 0.25, restitution: 0.08 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.bouncy, M.ground, { friction: 0.5, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.bouncy, M.static, { friction: 0.3, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(M.prop, M.ground, { friction: 0.6, restitution: 0.12 }));

  // --- heightfield (same triangulation as the render mesh)
  const { N, V, cell, half, heights } = map;
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

  const cars = [];        // all vehicles (physical or on rails)
  const events = [];
  const props = createProps(world, map, M);

  const phys = { world, map, cars, props, events, time: 0, ground, M, steps: 0 };

  // --- vehicles
  phys.addVehicle = function (spec, opts = {}) {
    const car = createVehicle(world, map, spec, M.car);
    car.id = cars.length; car.isPlayer = !!opts.player; car.active = false;
    car.body.addEventListener('collide', (e) => {
      const iv = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const ud = e.body.userData || {};
      if (ud.kind === 'car' && iv > 1.5) events.push({ type: 'carCar', car, other: ud.car, intensity: Math.min(1, iv / 12) });
      else if ((ud.kind === 'static' || ud.kind === 'obstacle') && iv > 1.2) events.push({ type: 'obstacle', car, kind: ud.sound || 'rock', intensity: Math.min(1, iv / 10) });
    });
    car.body.userData.car = car;
    cars.push(car);
    phys.activate(car);
    return car;
  };
  phys.removeVehicle = function (car) {
    phys.deactivate(car);
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
  };
  phys.activate = function (car) {
    if (car.active) return;
    world.addBody(car.body);
    car.vehicle.world = world;
    car.active = true;
  };
  phys.deactivate = function (car) {
    if (!car.active) return;
    world.removeBody(car.body);
    car.active = false;
  };

  // --- static scenery streamed around physical cars (one body per tree would swamp SAP)
  const statics = [];               // { x, z, r, y0, y1, shape, kind, body }
  const GRID = 40, gridMap = new Map();
  const gkey = (gx, gz) => gx * 10007 + gz;
  phys.addObstacle = (o) => {
    statics.push(o);
    const key = gkey(Math.floor(o.x / GRID), Math.floor(o.z / GRID));
    if (!gridMap.has(key)) gridMap.set(key, []);
    gridMap.get(key).push(o);
    return o;
  };
  // boxes for structures (bridges, ramps, barriers): { x, y, z, hx, hy, hz, yaw, pitch, kind }
  phys.addStaticBox = (b) => {
    const body = new CANNON.Body({ mass: 0, material: M.static });
    body.addShape(new CANNON.Box(new CANNON.Vec3(b.hx, b.hy, b.hz)));
    body.position.set(b.x, b.y, b.z);
    body.quaternion.setFromEuler(b.pitch || 0, b.yaw || 0, 0, 'YXZ');
    body.userData = { kind: 'static', sound: b.sound || 'wood' };
    world.addBody(body);
    return body;
  };
  function makeStaticBody(o) {
    const b = new CANNON.Body({ mass: 0, material: M.static });
    const h = Math.max(0.5, o.y1 - o.y0);
    if (o.shape === 'sphere') b.addShape(new CANNON.Sphere(o.r));
    else b.addShape(new CANNON.Cylinder(o.r, o.r, h, 8));
    b.position.set(o.x, o.shape === 'sphere' ? o.y1 - o.r * 0.55 : (o.y0 + o.y1) / 2, o.z);
    b.userData = { kind: 'obstacle', sound: o.kind === 'rock' ? 'rock' : 'wood' };
    return b;
  }
  let streamT = 0;
  // never called from inside world.step (removing bodies mid-step breaks cannon's sleep pass)
  function streamStatics(force = false, dt = STEP) {
    streamT -= dt;
    if (streamT > 0 && !force) return;
    streamT = 0.25;
    const near = new Set();
    for (const car of cars) {
      if (!car.active) continue;
      const gx = Math.floor(car.pos.x / GRID), gz = Math.floor(car.pos.z / GRID);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const list = gridMap.get(gkey(gx + dx, gz + dz));
        if (list) for (const o of list) near.add(o);
      }
    }
    for (const o of statics) {
      if (near.has(o)) { if (!o.body) { o.body = makeStaticBody(o); world.addBody(o.body); } }
      else if (o.body) { world.removeBody(o.body); o.body = null; }
    }
  }
  phys.streamNow = () => streamStatics(true);

  // --- one pre-step for everyone: controls/forces, then the raycast vehicles. Wheel rays
  // skip every chassis and prop (cars must not climb each other or the props).
  const toggled = [];
  world.addEventListener('preStep', () => {
    const dt = world.dt;
    for (const car of cars) if (car.active) car.preStep(dt);
    props.preStep(dt, cars);
    for (const car of cars) if (car.active) { car.body.collisionResponse = false; toggled.push(car.body); }
    for (const p of props.list) if (p.body.world) { p.body.collisionResponse = false; toggled.push(p.body); }
    for (const car of cars) if (car.active) car.vehicle.updateVehicle(dt);
    for (const b of toggled) b.collisionResponse = true;
    toggled.length = 0;
  });
  world.addEventListener('postStep', () => {
    phys.steps++;
    for (const car of cars) {
      if (!car.active) continue;
      car.postStep(world.dt);
      for (const e of car.events) { e.car = car; events.push(e); }
      car.events.length = 0;
      props.carContact(car, events);
    }
    for (const e of props.events) events.push(e);
    props.events.length = 0;
  });

  phys.update = function (frameDt) {
    const before = world.stepnumber;
    props.stream(cars);
    world.step(STEP, Math.min(frameDt, 0.1), 6);
    streamStatics(false, Math.min(frameDt, 0.1));
    phys.time = world.stepnumber * STEP;
    return world.stepnumber - before;
  };

  // reset onto a free spot (never inside a trunk, rock or structure)
  phys.resetCar = (car, x, z, heading) => {
    const blocked = (px, pz) => statics.some((o) => (o.x - px) ** 2 + (o.z - pz) ** 2 < (o.r + 2.6) ** 2);
    let bx = x, bz = z;
    if (blocked(x, z)) {
      search: for (let ring = 1; ring <= 12; ring++) for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, d = ring * 1.5;
        if (!blocked(x + Math.sin(a) * d, z + Math.cos(a) * d)) { bx = x + Math.sin(a) * d; bz = z + Math.cos(a) * d; break search; }
      }
    }
    car.reset(bx, bz, heading);
    streamStatics(true);
  };

  return phys;
}
