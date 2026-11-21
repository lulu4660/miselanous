// Handling probe on flat ground: steady-state cornering (full lock at a held speed), turn-in
// response, handbrake turn and a lift-off/Scandinavian-flick check, per vehicle and surface.
// node dev/handling.mjs [vehicleId|all] [surface]
import { createPhysics, STEP } from '../src/physics.js';
import { VEHICLES, VEHICLE_ORDER, S } from '../src/vehicles.js';
import { flatMap } from '../test/flatmap.mjs';
const ids = !process.argv[2] || process.argv[2] === 'all' ? VEHICLE_ORDER : [process.argv[2]];
const surfs = process.argv[3] ? [[process.argv[3], S[process.argv[3].toUpperCase()]]] : [['asphalt', S.ASPHALT], ['dirt', S.DIRT], ['snowroad', S.SNOWROAD]];
const deg = (r) => (r * 180 / Math.PI).toFixed(0);
// after the turn: centre the steering, keep the throttle; time until the slip is < 5° and yaw rate < 0.1
function release(phys, car) {
  for (let k = 0; k < 4 / STEP; k++) {
    car.input.steer = 0; car.input.handbrake = false; car.input.throttle = 0.6;
    phys.update(STEP);
    const hd = car.headingYaw(), b = Math.atan2(Math.sin(Math.atan2(car.vel.x, car.vel.z) - hd), Math.cos(Math.atan2(car.vel.x, car.vel.z) - hd));
    if (Math.abs(b) < 0.087 && Math.abs(car.angVel.y) < 0.1) return (k * STEP).toFixed(2);
  }
  return '>4';
}
function probe(id, surf, v0, steer, opts = {}) {
  const phys = createPhysics(flatMap({ surf, size: 1200, n: 120 }));
  const car = phys.addVehicle(VEHICLES[id], { player: true });
  car.reset(-450, -450, Math.PI / 4);
  // get up to speed straight
  let t = 0;
  while (car.forwardSpeed < v0 && t < 30) { car.input.throttle = 1; car.input.steer = 0; phys.update(STEP); t += STEP; }
  // hold speed with a P throttle, apply the steer
  let yawRate = 0, beta = 0, maxBeta = 0, rSum = 0, n = 0, t90 = null, h0 = car.headingYaw(), spun = false, minUp = 1;
  const T = opts.T || 4;
  for (let k = 0; k < T / STEP; k++) {
    const tt = k * STEP;
    const v = car.forwardSpeed;
    car.input.steer = opts.flick && tt < 0.35 ? -steer * 0.7 : steer;
    car.input.handbrake = !!(opts.hb && tt < opts.hb);
    car.input.throttle = opts.lift ? 0 : Math.max(-1, Math.min(1, (v0 - v) * 0.6 + 0.3));
    phys.update(STEP);
    const vx = car.vel.x, vz = car.vel.z, sp = Math.hypot(vx, vz);
    const hd = car.headingYaw();
    const b = sp > 2 ? Math.atan2(Math.sin(Math.atan2(vx, vz) - hd), Math.cos(Math.atan2(vx, vz) - hd)) : 0;
    maxBeta = Math.max(maxBeta, Math.abs(b));
    const turned = Math.abs(Math.atan2(Math.sin(hd - h0), Math.cos(hd - h0)));
    if (t90 === null && turned > Math.PI / 2) t90 = tt;
    if (Math.abs(b) > 2.2) spun = true;
    minUp = Math.min(minUp, car.R[4]);
    if (tt > T - 1.5) { rSum += Math.abs(car.angVel.y); n++; beta += Math.abs(b) ; }
  }
  yawRate = rSum / n; beta /= n;
  const sp = Math.hypot(car.vel.x, car.vel.z);
  return { v: sp.toFixed(1), R: (sp / Math.max(1e-3, yawRate)).toFixed(0), latG: (sp * yawRate / 9.81).toFixed(2), beta: deg(beta), maxBeta: deg(maxBeta), t90: t90 === null ? '-' : t90.toFixed(2), spun, up: minUp.toFixed(2), straight: release(phys, car) };
}
for (const id of ids) for (const [sn, s] of surfs) {
  for (const v0 of [12, 22]) {
    const r = probe(id, s, v0, 1);
    console.log(`${id.padEnd(8)} ${sn.padEnd(9)} ${String(v0).padStart(2)} m/s full lock: R ${r.R.padStart(3)} m, ${r.latG} g, slip ${r.beta}° (max ${r.maxBeta}°), 90° in ${r.t90} s${r.spun ? ' SPUN' : ''} minUp ${r.up}, straight in ${r.straight} s`);
  }
  const hb = probe(id, s, 14, 1, { hb: 0.6, T: 2.5 });
  const lift = probe(id, s, 22, 1, { lift: true, T: 2.5 });
  const flick = probe(id, s, 20, 1, { flick: true, T: 2.5 });
  console.log(`${id.padEnd(8)} ${sn.padEnd(9)} handbrake @14: 90° in ${hb.t90} s, max slip ${hb.maxBeta}°${hb.spun ? ' SPUN' : ''} · lift @22: max slip ${lift.maxBeta}°, 90° in ${lift.t90}${lift.spun ? ' SPUN' : ''} · flick @20: max slip ${flick.maxBeta}°${flick.spun ? ' SPUN' : ''}, straight ${flick.straight}`);
}
