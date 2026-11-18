// Fixed-timestep orchestration of car, props, ripples and their couplings. Renderer-free.
import { createWaves, createWaterSurface } from './waves.js';
import { createVehicle } from './vehicle.js';
import { createProps } from './props.js';
import { v3, mulMat, add } from './vmath.js';

export const STEP = 1 / 120;

export function createPhysics(terrain) {
  const waves = createWaves(terrain, { n: 128, cell: 0.5 });
  const water = createWaterSurface(waves);
  const car = createVehicle(terrain, water);
  const props = createProps(terrain, water, waves);
  const obstacles = []; // { x, z, r, y0, y1, kind }
  const events = [];
  let acc = 0, tick = 0;
  const lp = v3(), wp = v3();
  const wakePts = [
    v3(0.75, -0.3, 1.9), v3(-0.75, -0.3, 1.9), v3(0.95, -0.3, 0.3), v3(-0.95, -0.3, 0.3),
    v3(0.8, -0.3, -1.8), v3(-0.8, -0.3, -1.8),
  ];
  const prevWakeY = new Float32Array(wakePts.length).fill(NaN);

  const phys = { waves, water, car, props, obstacles, events, time: 0 };

  phys.addObstacle = (o) => { obstacles.push(o); return o; };

  function couple(dt) {
    // Car pushes water: each submerged hull point moving through water depresses it.
    const R = car.R;
    let splashV = 0;
    for (let i = 0; i < wakePts.length; i++) {
      mulMat(wp, R, wakePts[i]); add(wp, wp, car.pos);
      const wl = water.levelAt(wp.x, wp.z);
      const depth = wl - wp.y;
      const py = prevWakeY[i];
      prevWakeY[i] = depth;
      if (depth <= -0.05) continue;
      const vx = car.vel.x, vz = car.vel.z;
      const sp = Math.hypot(vx, vz);
      const sub = Math.min(1, (depth + 0.05) / 0.5);
      // moving displacement -> V wake
      waves.disturb(wp.x, wp.z, -sub * Math.min(sp, 14) * 0.065, 0.9);
      // bow pile-up just ahead of the front points
      if (i < 2 && sp > 1) waves.disturb(wp.x + vx / sp * 1.1, wp.z + vz / sp * 1.1, sub * Math.min(sp, 14) * 0.035, 0.8);
      if (sp > 1.5 && i >= 2) waves.addFoam(wp.x, wp.z, sub * Math.min(1, sp / 8) * 0.2, 0.6);
      // entering water (crossing the surface downward)
      if (!Number.isNaN(py) && py <= 0 && depth > 0) splashV = Math.max(splashV, -car.vel.y, sp * 0.25);
    }
    if (splashV > 1.6) {
      const I = Math.min(1, splashV / 9);
      events.push({ type: 'carSplash', intensity: I, x: car.pos.x, z: car.pos.z });
      waves.disturb(car.pos.x, car.pos.z, -I * 1.0, 2.0);
      waves.addFoam(car.pos.x, car.pos.z, I * 0.45, 1.8);
    }
  }

  phys.update = function (frameDt) {
    acc += Math.min(frameDt, 0.1);
    let n = 0;
    while (acc >= STEP && n < 10) {
      acc -= STEP; n++; tick++;
      phys.time += STEP;
      car.time = phys.time;
      water.time = phys.time;
      car.step(STEP);
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const dx = o.x - car.pos.x, dz = o.z - car.pos.z;
        if (dx * dx + dz * dz > (o.r + 3) * (o.r + 3)) continue;
        const hit = car.collideCylinder(o.x, o.z, o.r, o.y0, o.y1);
        if (hit > 1.2) events.push({ type: 'obstacle', kind: o.kind, intensity: Math.min(1, hit / 10), obstacle: o });
      }
      for (const e of car.events) events.push(e);
      car.events.length = 0;
      if (tick % 2 === 0) {
        props.step(STEP * 2, car, events);
        // props vs static obstacles
        const L = props.list;
        for (let i = 0; i < L.length; i++) {
          const p = L[i];
          for (let k = 0; k < obstacles.length; k++) {
            const o = obstacles[k];
            const dx = p.pos.x - o.x, dz = p.pos.z - o.z;
            const rr = p.r + o.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr || p.pos.y > o.y1 + p.r || p.pos.y < o.y0 - p.r) continue;
            const d = Math.sqrt(d2) || 1e-4;
            const nx = dx / d, nz = dz / d;
            p.pos.x = o.x + nx * rr; p.pos.z = o.z + nz * rr;
            const vn = p.vel.x * nx + p.vel.z * nz;
            if (vn < 0) { p.vel.x -= (1 + p.K.rest) * vn * nx; p.vel.z -= (1 + p.K.rest) * vn * nz; }
          }
        }
        waves.recenter(car.pos.x, car.pos.z);
        couple(STEP * 2);
        waves.step(STEP * 2);
      }
    }
    return n;
  };

  return phys;
}
