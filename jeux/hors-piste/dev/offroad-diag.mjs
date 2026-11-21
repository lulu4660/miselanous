// Diagnostic: replay "full throttle, brief left, release" from the spawn and log what flips the car.
import { createWorld } from '../src/world.js';
import { createPhysics, STEP } from '../src/physics.js';
import { VEHICLES } from '../src/vehicles.js';
import { createVegetation } from '../src/gfx/vegetation.js';
const world = createWorld(11);
const veg = createVegetation(world, { trees: 1800, grass: 0 });
const id = process.argv[2] || 'cabri';
const phys = createPhysics(world);
for (const o of veg.obstacles) phys.addObstacle(o);
const car = phys.addVehicle(VEHICLES[id], { player: true });
const sp = world.spawn;
phys.resetCar(car, sp.x + Math.cos(sp.heading) * 2.2, sp.z - Math.sin(sp.heading) * 2.2, sp.heading);
car.assist = 0.55;
let t = 0, lastUp = 1;
for (let i = 0; i < 60 * 12; i++) {
  t = i * STEP;
  car.input.throttle = t > 0.5 && t < 4.5 ? 1 : 0; car.input.brake = t >= 4.5 ? 0.12 : 0;
  car.input.steer = t > 4.5 && t < 5.4 ? 1 : 0; // + = left in the input convention?
  phys.update(STEP);
  for (const e of phys.events) if (e.type !== 'propBump') console.log(t.toFixed(2), e.type, (e.intensity ?? 0).toFixed(2), e.kind || '');
  phys.events.length = 0;
  const up = car.R[4];
  if (i % 15 === 0 || (up < 0.5 && lastUp >= 0.5)) console.log(t.toFixed(2), 'v', car.forwardSpeed.toFixed(1), 'up', up.toFixed(2), 'surf', car.surface, 'grounded', car.groundedCount, 'pos', car.pos.x.toFixed(1), car.pos.y.toFixed(1), car.pos.z.toFixed(1), 'h', world.heightAt(car.pos.x, car.pos.z).toFixed(1), 'roadD', world.roadDistAt(car.pos.x, car.pos.z).toFixed(1), 'steer', car.steer.toFixed(2));
  lastUp = up;
}
