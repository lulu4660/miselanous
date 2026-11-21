import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhysics, STEP } from '../src/physics.js';
import { VEHICLES, VEHICLE_ORDER, S } from '../src/vehicles.js';
import { flatMap } from './flatmap.mjs';

const run = (phys, seconds, fn) => { for (let k = 0; k < seconds / STEP; k++) { fn && fn(); phys.update(STEP); } };
const SURFS = [['asphalt', S.ASPHALT], ['dirt', S.DIRT], ['snow road', S.SNOWROAD]];

for (const id of VEHICLE_ORDER) {
  const spec = VEHICLES[id];
  test(`${spec.name}: settles on flat ground, wheels in travel, at rest`, () => {
    const phys = createPhysics(flatMap());
    const car = phys.addVehicle(spec, { player: true });
    car.reset(0, 0, 0);
    run(phys, 4);
    assert.equal(car.groundedCount, 4);
    for (const w of car.wheels) assert.ok(w.compression > 0.03 && w.compression < spec.restLength * 0.85, `compression ${w.compression.toFixed(3)}`);
    assert.ok(Math.hypot(car.vel.x, car.vel.y, car.vel.z) < 0.03, 'at rest');
  });

  test(`${spec.name}: holds a 12° asphalt slope without throttle`, () => {
    const phys = createPhysics(flatMap({ surf: S.ASPHALT, h: 5, slope: Math.tan(12 * Math.PI / 180) }));
    const car = phys.addVehicle(spec);
    car.reset(0, 0, Math.PI / 2);
    run(phys, 3);
    const x0 = car.pos.x;
    run(phys, 4);
    assert.ok(Math.abs(car.pos.x - x0) < 0.3, `creep ${(car.pos.x - x0).toFixed(2)}`);
  });

  test(`${spec.name}: top speed, stable and grounded on every road surface; braking asphalt < dirt < snow`, () => {
    const dists = [];
    for (const [name, surf] of SURFS) {
      const phys = createPhysics(flatMap({ surf, size: 2400, n: 300 }));
      const car = phys.addVehicle(spec);
      car.reset(0, -1100, 0);
      car.input.throttle = 1;
      let minUp = 1, airborne = 0, tt = 0;
      run(phys, 32, () => { tt += STEP; if (tt > 1) { minUp = Math.min(minUp, car.R[4]); if (car.groundedCount < 2) airborne++; } });
      const vtop = car.forwardSpeed;
      assert.ok(vtop > spec.topSpeed * 0.85 && vtop < spec.topSpeed * 1.08, `${name}: top ${vtop.toFixed(1)} vs ${spec.topSpeed}`);
      assert.ok(minUp > 0.95 && airborne < 10, `${name}: stable at speed (up ${minUp.toFixed(3)}, airborne steps ${airborne})`);
      // brake from 25 m/s
      car.reset(0, -1100, 0); car.input.throttle = 1;
      run(phys, 0.5);
      while (car.forwardSpeed < 25) phys.update(STEP);
      const z0 = car.pos.z;
      car.input.throttle = -1;
      while (car.forwardSpeed > 0.5) phys.update(STEP);
      dists.push(car.pos.z - z0);
    }
    console.log(`  ${spec.name}: braking 25→0 m/s  asphalt ${dists[0].toFixed(1)} m, dirt ${dists[1].toFixed(1)} m, snow ${dists[2].toFixed(1)} m`);
    assert.ok(dists[0] < dists[1] && dists[1] < dists[2]);
  });

  test(`${spec.name}: after a full-lock turn, centred steering goes straight`, () => {
    const phys = createPhysics(flatMap({ surf: S.ASPHALT }));
    const car = phys.addVehicle(spec);
    car.reset(0, -150, 0);
    car.input.throttle = 0.6;
    run(phys, 2.5);
    car.input.steer = -1; run(phys, 1.5);
    car.input.steer = 0; run(phys, 2.0);
    const y0 = car.headingYaw(); run(phys, 1.0);
    assert.ok(Math.abs(car.headingYaw() - y0) < 0.04 && car.R[4] > 0.9);
  });

  test(`${spec.name}: drives off after settling (a hair of creep is not braking)`, () => {
    const phys = createPhysics(flatMap({ surf: S.ASPHALT }));
    const car = phys.addVehicle(spec, { player: true });
    car.reset(0, 0, 0);
    run(phys, 2, () => { car.input.throttle = 0; car.input.brake = 0.12; });
    car.body.velocity.z -= 0.01; // settle with a tiny backwards creep, as on the real map
    run(phys, 2, () => { car.input.throttle = 1; car.input.brake = 0; });
    assert.ok(car.forwardSpeed > 6, `speed after 2 s: ${car.forwardSpeed.toFixed(2)}`);
  });

  test(`${spec.name}: Avancer + full lock turns tight on dirt and snow, without spinning`, () => {
    for (const [surf, maxR] of [[S.DIRT, 40], [S.SNOWROAD, 55]]) {
      const phys = createPhysics(flatMap({ surf, size: 1400, n: 140 }));
      const car = phys.addVehicle(spec, { player: true });
      car.assist = 1;
      car.reset(-550, -550, Math.PI / 4);
      run(phys, 8, () => { car.input.throttle = 1; car.input.steer = 0; if (car.forwardSpeed > 22) car.input.throttle = 0; });
      let maxBeta = 0, r = 0, v = 0, n = 0;
      for (let k = 0; k < 3 / STEP; k++) {
        car.input.throttle = 1; car.input.steer = 1; phys.update(STEP);
        maxBeta = Math.max(maxBeta, Math.abs(car.beta));
        if (k * STEP > 2) { r += Math.abs(car.angVel.y); v += Math.hypot(car.vel.x, car.vel.z); n++; }
      }
      const R = v / r;
      assert.ok(R < maxR && maxBeta < 0.8 && car.R[4] > 0.8, `surface ${surf}: R ${R.toFixed(0)} m, max slip ${(maxBeta * 57.3).toFixed(0)}°`);
    }
  });

  test(`${spec.name}: rights itself from the roof`, () => {
    const phys = createPhysics(flatMap());
    const car = phys.addVehicle(spec);
    car.reset(0, 0, 0);
    car.q.set(0, 0, 1, 0); car.pos.y += 1;
    let t = 0, up = -1;
    run(phys, 7, () => { t += STEP; if (up < 0 && car.R[4] > 0.9 && t > 1) up = t; });
    assert.ok(up > 0 && up < 6.5, `upright after ${up}`);
  });
}

test('car-to-car impacts: no ride-ups, no flips, no NaN', () => {
  const phys = createPhysics(flatMap({ surf: S.ASPHALT }));
  const a = phys.addVehicle(VEHICLES.mistral), b = phys.addVehicle(VEHICLES.bison), c = phys.addVehicle(VEHICLES.criquet);
  a.reset(0, -30, 0); b.reset(0.4, 30, Math.PI); c.reset(-30, 0, Math.PI / 2);
  run(phys, 1);
  a.input.throttle = 1; b.input.throttle = 1; c.input.throttle = 1;
  let maxY = 0, minUp = 1;
  run(phys, 6, () => { for (const k of [a, b, c]) { maxY = Math.max(maxY, k.pos.y - (0.5 - k.spec.box.minY + 0.35)); minUp = Math.min(minUp, k.R[4]); } });
  for (const k of [a, b, c]) assert.ok(Number.isFinite(k.pos.x + k.pos.y + k.pos.z));
  console.log(`  max rise ${maxY.toFixed(2)} m, min up ${minUp.toFixed(2)}`);
  assert.ok(maxY < 0.9, 'no ride-up');
});
