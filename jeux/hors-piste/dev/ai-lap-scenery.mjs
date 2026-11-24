// AI laps of the main loop WITH the vegetation obstacles and roadside props (the unit
// test runs without them): counts obstacle hits, flips and respawns per vehicle.
import { createWorld } from '../src/world.js';
import { createPhysics, STEP } from '../src/physics.js';
import { createDriver } from '../src/ai.js';
import { VEHICLES, VEHICLE_ORDER } from '../src/vehicles.js';
import { createVegetation } from '../src/gfx/vegetation.js';
import { placeRoadProps } from '../src/gfx/objects.js';
const world = createWorld(11);
const veg = createVegetation(world, { trees: +(process.argv[2] || 1800), grass: 0 });
for (const id of (process.env.ONLY ? process.env.ONLY.split(',') : VEHICLE_ORDER)) {
  const phys = createPhysics(world);
  for (const o of veg.obstacles) phys.addObstacle({ ...o }); // a copy per world: streaming keeps the body on the object
  placeRoadProps(world, phys.props);
  const car = phys.addVehicle(VEHICLES[id]);
  const road = world.loop;
  const drv = createDriver(car, road, { lane: 2.2, skill: 0.85, startIdx: world.spawn.idx });
  const p = road.pts[world.spawn.idx];
  phys.resetCar(car, p.x - p.tz * 2.2, p.z + p.tx * 2.2, Math.atan2(p.tx, p.tz));
  let t = 0, flips = 0, wasUp = true, respawns = 0, hits = 0, props = 0;
  while (drv.lapDist < road.length && t < 420) {
    drv.update(STEP); phys.update(STEP); t += STEP;
    for (const e of phys.events) { if (e.type === 'obstacle' && e.intensity > 0.3) { hits++; if (process.env.V) console.log(`   hit ${e.kind} t=${t.toFixed(1)} v=${car.forwardSpeed.toFixed(1)} roadD=${world.roadDistAt(car.pos.x, car.pos.z).toFixed(1)} offRoad=${drv.offRoad.toFixed(1)}`); } if (e.type === 'propBump') props++; }
    phys.events.length = 0;
    const up = car.R[4] > 0.3; if (!up && wasUp) { flips++; if (process.env.V) console.log(`   FLIP t=${t.toFixed(1)} v=${car.forwardSpeed.toFixed(1)} roadD=${world.roadDistAt(car.pos.x, car.pos.z).toFixed(1)} surf=${car.surface}`); } wasUp = up;
    if (drv.wantRespawn) { respawns++; drv.wantRespawn = false; drv.offRoad = 0; const q = road.pts[(drv.idx + 10) % road.pts.length]; phys.resetCar(car, q.x, q.z, Math.atan2(q.tx, q.tz)); }
  }
  console.log(`${VEHICLES[id].name}: lap ${drv.lapDist >= road.length ? 'done' : 'NOT done'} in ${t.toFixed(0)} s, obstacle hits ${hits}, prop bumps ${props}, flips ${flips}, respawns ${respawns}`);
}
