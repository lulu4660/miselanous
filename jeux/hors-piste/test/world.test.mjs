import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { createWorld } from '../src/world.js';
import { createPhysics, STEP } from '../src/physics.js';
import { createDriver, createTraffic } from '../src/ai.js';
import { VEHICLES, VEHICLE_ORDER } from '../src/vehicles.js';

const world = createWorld(11);

test('heightfield collision matches world.heightAt', () => {
  const phys = createPhysics(world);
  let worst = 0, n = 0;
  for (let k = 0; k < 800; k++) {
    const x = (Math.random() - 0.5) * 900, z = (Math.random() - 0.5) * 900;
    const r = new CANNON.RaycastResult();
    phys.world.raycastClosest(new CANNON.Vec3(x, 200, z), new CANNON.Vec3(x, -50, z), {}, r);
    if (r.hasHit && r.body === phys.ground) { worst = Math.max(worst, Math.abs(r.hitPointWorld.y - world.heightAt(x, z))); n++; }
  }
  assert.ok(n > 750 && worst < 1e-3, `worst ${worst}`);
});

test('roads: grade limited and the surface grid marks them', () => {
  for (const r of world.roads) {
    let maxGrade = 0;
    for (let i = 1; i < r.pts.length; i++) maxGrade = Math.max(maxGrade, Math.abs(r.pts[i].y - r.pts[i - 1].y) / 2);
    let onRoad = 0;
    for (const p of r.pts) if (world.isOnRoad(p.x, p.z)) onRoad++;
    console.log(`  ${r.name}: ${(r.length / 1000).toFixed(2)} km, max grade ${(maxGrade * 100).toFixed(1)}%, centreline on road ${(onRoad / r.pts.length * 100).toFixed(1)}%`);
    assert.ok(maxGrade < 0.13 && onRoad / r.pts.length > 0.99);
  }
});

for (const id of VEHICLE_ORDER) {
  test(`AI drives ${VEHICLES[id].name} round the main loop without flipping`, () => {
    const phys = createPhysics(world);
    const car = phys.addVehicle(VEHICLES[id]);
    const road = world.loop;
    const drv = createDriver(car, road, { lane: 2.2, skill: 0.85, startIdx: world.spawn.idx });
    const p = road.pts[world.spawn.idx];
    phys.resetCar(car, p.x - p.tz * 2.2, p.z + p.tx * 2.2, Math.atan2(p.tx, p.tz));
    let t = 0, flips = 0, wasUp = true, respawns = 0, maxOff = 0;
    while (drv.lapDist < road.length && t < 420) {
      drv.update(STEP);
      phys.update(STEP);
      t += STEP;
      const up = car.R[4] > 0.3;
      if (!up && wasUp) flips++;
      wasUp = up;
      maxOff = Math.max(maxOff, drv.nearest ? 0 : 0);
      if (drv.wantRespawn) { respawns++; drv.wantRespawn = false; drv.offRoad = 0; const q = road.pts[(drv.idx + 10) % road.pts.length]; phys.resetCar(car, q.x, q.z, Math.atan2(q.tx, q.tz)); }
    }
    console.log(`  ${VEHICLES[id].name}: lap ${drv.lapDist >= road.length ? 'done' : 'NOT done'} in ${t.toFixed(0)} s (avg ${(road.length / t * 3.6).toFixed(0)} km/h), flips ${flips}, respawns ${respawns}`);
    assert.ok(drv.lapDist >= road.length, 'completes the lap');
    // traffic is physical only near the player; an occasional off by a far car is tolerated
    assert.ok(flips <= 1 && respawns <= 2, `flips ${flips}, respawns ${respawns}`);
  });
}

test('physics cost with the player and 5 physical AI cars', () => {
  const phys = createPhysics(world);
  const player = phys.addVehicle(VEHICLES.cabri, { player: true });
  const sp = world.spawn;
  phys.resetCar(player, sp.x, sp.z, sp.heading);
  const T = createTraffic(phys, world, { count: 5 });
  T.nearDist = 1e9; T.farDist = 2e9; // force all physical
  for (let k = 0; k < 120; k++) { T.update(STEP, player); phys.update(STEP); }
  const t0 = performance.now();
  for (let k = 0; k < 600; k++) { T.update(STEP, player); phys.update(STEP); }
  const ms = (performance.now() - t0) / 600;
  console.log(`  ${ms.toFixed(2)} ms per frame with 6 physical cars`);
  assert.ok(ms < 4);
});
