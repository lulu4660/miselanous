// Cross-slope probe: steering centred, speed held, 3 s: sideways drift and heading change.
// Also parked across the slope (creep) and reversing with full lock.
import { createPhysics, STEP } from '../src/physics.js';
import { VEHICLES, VEHICLE_ORDER, S } from '../src/vehicles.js';
import { flatMap } from '../test/flatmap.mjs';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
for (const id of VEHICLE_ORDER) {
  const out = [];
  for (const deg of [1, 6, 10]) {
    const phys = createPhysics(flatMap({ surf: S.ASPHALT, h: 200, slope: Math.tan(deg * Math.PI / 180), size: 1400, n: 140 }));
    const car = phys.addVehicle(VEHICLES[id], { player: true }); car.assist = 1;
    car.reset(0, -500, 0); // heading +z, slope falls toward -x
    for (let k = 0; k < 6 / STEP; k++) { car.input.steer = 0; car.input.throttle = car.forwardSpeed < 15 ? 1 : 0.2; phys.update(STEP); }
    const x0 = car.pos.x, h0 = car.headingYaw();
    for (let k = 0; k < 3 / STEP; k++) { car.input.steer = 0; car.input.throttle = car.forwardSpeed < 15 ? 1 : 0.2; phys.update(STEP); }
    out.push(`${deg}°: ${(car.pos.x - x0).toFixed(1)} m, heading ${(wrap(car.headingYaw() - h0) * 57.3).toFixed(0)}°`);
  }
  // parked across a 15° slope
  const phys = createPhysics(flatMap({ surf: S.ASPHALT, h: 200, slope: Math.tan(15 * Math.PI / 180), size: 600, n: 120 }));
  const car = phys.addVehicle(VEHICLES[id], { player: true });
  car.reset(0, 0, 0);
  for (let k = 0; k < 3 / STEP; k++) { car.input.throttle = 0; car.input.brake = 0.12; phys.update(STEP); }
  const px = car.pos.x;
  for (let k = 0; k < 3 / STEP; k++) { car.input.throttle = 0; car.input.brake = 0.12; phys.update(STEP); }
  out.push(`parked 15°: ${((car.pos.x - px) / 3 * 100).toFixed(1)} cm/s`);
  // reversing with full lock
  const ph2 = createPhysics(flatMap({ surf: S.DIRT, size: 600, n: 120 }));
  const c2 = ph2.addVehicle(VEHICLES[id], { player: true });
  c2.reset(0, 0, 0);
  for (let k = 0; k < 4 / STEP; k++) { c2.input.throttle = -1; c2.input.steer = 0; ph2.update(STEP); }
  let mb = 0, r = 0, v = 0, n = 0;
  for (let k = 0; k < 3 / STEP; k++) { c2.input.throttle = -1; c2.input.steer = 1; ph2.update(STEP); const sp = Math.hypot(c2.vel.x, c2.vel.z); const b = Math.abs(wrap(Math.atan2(-c2.vel.x, -c2.vel.z) - c2.headingYaw())); mb = Math.max(mb, b); if (k * STEP > 2) { r += Math.abs(c2.angVel.y); v += sp; n++; } }
  out.push(`reverse lock: R ${(v / r).toFixed(1)} m @${(v / n).toFixed(1)}, slip ${(mb * 57.3).toFixed(0)}°`);
  console.log(id.padEnd(8), out.join(' | '));
}
