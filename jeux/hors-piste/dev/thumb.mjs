// "Thumb driver" on the real map: what a player with arrows does. Throttle held, steering
// only -1 / 0 / +1 toward a point ahead on the left lane, lifts when the heading error is
// big, brakes when it is huge. Reports time and distance spent off the carriageway, flips.
// node dev/thumb.mjs [vehicleId|all] [metres=1600] [road=0]
import { createWorld } from '../src/world.js';
import { createPhysics, STEP } from '../src/physics.js';
import { VEHICLES, VEHICLE_ORDER } from '../src/vehicles.js';
const world = createWorld(11);
const ids = !process.argv[2] || process.argv[2] === 'all' ? VEHICLE_ORDER : process.argv[2].split(',');
const metres = +(process.argv[3] || 1600);
const road = world.roads[+(process.argv[4] || 0)];
const P = road.pts, n = P.length;
const MU = [0, 1.55, 1.2, 0.85], DEC = [0, 9, 6.5, 4.5];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
for (const id of ids) {
  const phys = createPhysics(world);
  const car = phys.addVehicle(VEHICLES[id], { player: true });
  car.assist = 1;
  let idx = road === world.loop ? world.spawn.idx : 5;
  const p0 = P[idx];
  phys.resetCar(car, p0.x + p0.tz * 2.2, p0.z - p0.tx * 2.2, Math.atan2(p0.tx, p0.tz));
  let t = 0, dist = 0, offT = 0, maxOff = 0, flips = 0, wasUp = true, worst = [], vmax = 0, vSum = 0, nS = 0;
  while (dist < metres && t < 300) {
    // nearest road point ahead
    let best = idx, bd = Infinity;
    for (let k = -5; k <= 30; k++) { const q = P[(idx + k + n) % n]; const d = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (d < bd) { bd = d; best = idx + k; } }
    if (best > idx) dist += (best - idx) * 2;
    idx = (best + n) % n;
    const v = car.forwardSpeed;
    const look = Math.round((10 + Math.max(0, v) * 0.55) / 2);
    const q = P[(idx + look) % n];
    if (!q) { console.log("bad", { idx, look, v, pos: car.pos.toString(), t }); process.exit(1); }
    const tx = q.x + q.tz * 2.0, tz = q.z - q.tx * 2.0; // left lane
    const err = wrap(Math.atan2(tx - car.pos.x, tz - car.pos.z) - car.headingYaw());
    car.input.steer = err > 0.06 ? 1 : err < -0.06 ? -1 : 0;
    // a player who knows the road: brakes (full pedal) before bends that are too fast
    let vReq = Infinity;
    for (let k = 2; k < 50; k += 2) {
      const a = P[(idx + k - 2 + n) % n], b = P[(idx + k + 2) % n];
      const d = Math.abs(wrap(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
      if (d < 1e-4) continue;
      const R = 8 / d, mu = MU[a.type];
      const vc = Math.sqrt(mu * 9.81 * R);
      vReq = Math.min(vReq, Math.sqrt(vc * vc + 2 * DEC[a.type] * Math.max(0, k * 2 - 6)));
    }
    car.input.throttle = v < 4 ? 1 : v > vReq + 1 || Math.abs(err) > 0.9 ? -1 : v > vReq - 1 || Math.abs(err) > 0.5 ? 0 : 1;
    if (process.env.DUMP && t > +process.env.DUMP && t < +process.env.DUMP + STEP * 1.5) { console.log(JSON.stringify({ t, v, pos: [car.pos.x, car.pos.y, car.pos.z].map((a) => +a.toFixed(2)), up: car.R[4], fwdY: car.R[5], fx: car.tyreDebug.fx, grip: car.tyreDebug.grip, slip: car.tyreDebug.slip, Fz: car.vehicle.wheelInfos.map((w) => Math.round(w.suspensionForce)), contact: car.vehicle.wheelInfos.map((w) => w.isInContact), drive: car.load, rpm: car.rpm })); }
    if (process.env.TRACE && dist > +process.env.TRACE - 120 && dist < +process.env.TRACE + 30 && Math.round(t / STEP) % 6 === 0) console.log(`  d=${dist} v=${v.toFixed(1)} vReq=${vReq.toFixed(1)} thr=${car.input.throttle} err=${err.toFixed(2)} steer=${car.input.steer} beta=${(car.beta * 57.3).toFixed(0)} off=${(Math.sqrt(bd) - 4.2).toFixed(1)} surf=${car.surface} g=${car.groundedCount} slipF=${car.wheels[0].slip.toFixed(2)} slipR=${car.wheels[2].slip.toFixed(2)}`);
    car.input.brake = car.input.throttle === 0 ? 0.12 : 0;
    phys.update(STEP); t += STEP;
    const off = Math.sqrt(bd) - 4.2;
    if (off > 1) { offT += STEP; if (off > maxOff) { maxOff = off; } }
    const up = car.R[4] > 0.3; if (!up && wasUp) flips++; wasUp = up;
    vmax = Math.max(vmax, v); vSum += v; nS++;
    if (off > 6 && !worst.some((w) => Math.abs(w - dist) < 60)) worst.push(Math.round(dist));
  }
  console.log(`${id.padEnd(8)} ${road.name}: ${Math.round(dist)} m in ${t.toFixed(0)} s (avg ${(vSum / nS * 3.6).toFixed(0)} km/h, max ${(vmax * 3.6).toFixed(0)}), off-road ${offT.toFixed(1)} s, worst ${maxOff.toFixed(1)} m beyond the edge, flips ${flips}${worst.length ? ', big offs at ' + worst.join(', ') + ' m' : ''}`);
}
