// Digital-pedal probe: Avancer pinned at 1 + full lock (what a thumb does), entered at a
// given speed; and full throttle + full lock from rest. Reports radius, slip, spins.
import { createPhysics, STEP } from '../src/physics.js';
import { VEHICLES, VEHICLE_ORDER, S } from '../src/vehicles.js';
import { flatMap } from '../test/flatmap.mjs';
const B = process.env.BASE; // path to an older src/ to compare
const deg = (r) => Math.round(r * 57.3);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function run(id, surf, v0, T = 3) {
  const phys = createPhysics(flatMap({ surf, size: 1400, n: 140 }));
  const car = phys.addVehicle(VEHICLES[id], { player: true });
  car.assist = 1;
  car.reset(-550, -550, Math.PI / 4);
  let t = 0;
  while (car.forwardSpeed < v0 && t < 40 && v0 > 0) { car.input.throttle = 1; car.input.steer = 0; phys.update(STEP); t += STEP; }
  let maxB = 0, spun = false, h0 = car.headingYaw(), t90 = null, rS = 0, n = 0, vS = 0, minUp = 1;
  for (let k = 0; k < T / STEP; k++) {
    car.input.throttle = 1; car.input.steer = 1; car.input.brake = 0;
    phys.update(STEP);
    const hd = car.headingYaw(), sp = Math.hypot(car.vel.x, car.vel.z);
    const b = sp > 2 ? wrap(Math.atan2(car.vel.x, car.vel.z) - hd) : 0;
    maxB = Math.max(maxB, Math.abs(b)); if (Math.abs(b) > 2.2) spun = true;
    if (t90 === null && Math.abs(wrap(hd - h0)) > Math.PI / 2) t90 = k * STEP;
    minUp = Math.min(minUp, car.R[4]);
    if (k * STEP > T - 1) { rS += Math.abs(car.angVel.y); vS += sp; n++; }
  }
  const v = vS / n, r = rS / n;
  return `R ${String(Math.round(v / Math.max(r, 1e-3))).padStart(3)} m @${v.toFixed(0)} m/s, max slip ${deg(maxB)}°, 90° in ${t90 === null ? '-' : t90.toFixed(2)} s${spun ? ' SPUN' : ''}${minUp < 0.5 ? ' ROLLED' : ''}`;
}
for (const id of VEHICLE_ORDER) for (const [sn, s] of [['asphalt', S.ASPHALT], ['dirt', S.DIRT], ['snowroad', S.SNOWROAD]]) {
  console.log(`${id.padEnd(8)} ${sn.padEnd(9)} from rest: ${run(id, s, 0, 3)} | from 22: ${run(id, s, 22)} | from 34: ${run(id, s, 34)}`);
}
