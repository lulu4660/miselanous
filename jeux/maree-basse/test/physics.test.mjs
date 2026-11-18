import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain, WORLD } from '../src/terrain.js';
import { createPhysics, STEP } from '../src/physics.js';
import { CAR } from '../src/vehicle.js';

const SEED = 5;

function flatTerrain(h = 0.5, slope = 0) {
  // Real terrain object with its heights overwritten (keeps the same sampling code).
  const t = createTerrain(SEED);
  const V = t.V;
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -t.half + i * t.cell;
    t.heights[j * V + i] = h + x * slope;
    t.mesa[j * V + i] = 0; t.grass[j * V + i] = 0;
  }
  return t;
}
const run = (phys, seconds, fn) => { for (let k = 0; k < seconds / STEP; k++) { fn && fn(k * STEP); phys.update(STEP); } };

test('heightAt matches the mesh triangulation at vertices and is continuous', () => {
  const t = createTerrain(SEED);
  for (let k = 0; k < 2000; k++) {
    const i = 1 + Math.floor(Math.random() * (t.N - 2)), j = 1 + Math.floor(Math.random() * (t.N - 2));
    const x = -t.half + i * t.cell, z = -t.half + j * t.cell;
    assert.ok(Math.abs(t.heightAt(x, z) - t.heights[j * t.V + i]) < 1e-4);
    const e = 1e-4;
    assert.ok(Math.abs(t.heightAt(x + e, z + e) - t.heightAt(x - e, z - e)) < 0.01);
  }
});

test('car settles on flat ground with all wheels in suspension range', () => {
  const t = flatTerrain(0.5);
  const phys = createPhysics(t);
  phys.car.reset(0, 0, 0);
  run(phys, 4);
  const c = phys.car;
  assert.equal(c.groundedCount, 4);
  for (const w of c.wheels) {
    assert.ok(w.compression > 0.08 && w.compression < CAR.restLength * 0.8, `compression ${w.compression}`);
  }
  assert.ok(Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.02, 'at rest');
  assert.ok(c.R[4] > 0.999, 'upright');
  console.log('  rest compression', c.wheels.map((w) => w.compression.toFixed(3)).join(' '), 'COM height', (c.pos.y - 0.5).toFixed(3));
});

test('car holds on a 12 degree slope without throttle', () => {
  const t = flatTerrain(2, Math.tan(12 * Math.PI / 180));
  const phys = createPhysics(t);
  phys.car.reset(0, 0, 0); // facing +z, slope along x (sideways) — also try uphill
  run(phys, 3);
  const x0 = phys.car.pos.x, z0 = phys.car.pos.z;
  run(phys, 4);
  const drift = Math.hypot(phys.car.pos.x - x0, phys.car.pos.z - z0);
  assert.ok(drift < 0.3, `sideways drift ${drift}`);
  const phys2 = createPhysics(t);
  phys2.car.reset(0, 0, Math.PI / 2); // facing +x = uphill
  run(phys2, 3);
  const a = { ...phys2.car.pos };
  run(phys2, 4);
  const d2 = Math.hypot(phys2.car.pos.x - a.x, phys2.car.pos.z - a.z);
  assert.ok(d2 < 0.3, `uphill creep ${d2}`);
});

test('accelerates, reaches a sensible top speed, brakes and steers', () => {
  const t = flatTerrain(0.5);
  const phys = createPhysics(t);
  phys.car.reset(0, -120, 0);
  phys.car.input.throttle = 1;
  run(phys, 3);
  const v3s = phys.car.forwardSpeed;
  run(phys, 9);
  const vtop = phys.car.forwardSpeed;
  console.log(`  speed after 3s ${v3s.toFixed(1)} m/s, top ${vtop.toFixed(1)} m/s`);
  assert.ok(v3s > 8, 'accelerates');
  assert.ok(vtop > 16 && vtop < 24, 'top speed');
  phys.car.reset(0, 0, 0);
  phys.car.input.throttle = 0.7; phys.car.input.steer = 1;
  run(phys, 6);
  assert.ok(phys.car.R[4] > 0.8, 'does not roll over in a full-lock turn');
  phys.car.input.throttle = -1; phys.car.input.steer = 0;
  run(phys, 4);
  assert.ok(Math.abs(phys.car.forwardSpeed) < 7.6, 'brakes then reverses at limited speed');
});

test('no NaN after 60 s of random input on the real island', () => {
  const t = createTerrain(SEED);
  const phys = createPhysics(t);
  phys.car.reset(t.spawn.x, t.spawn.z, 0);
  for (let i = 0; i < 30; i++) phys.props.add(['ball', 'ring', 'buoy', 'barrel', 'melon'][i % 5], t.spawn.x + (i % 6) * 2 - 6, t.spawn.z + 6 + Math.floor(i / 6) * 2);
  let seedR = 1;
  const rnd = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
  let nan = false;
  run(phys, 60, (tt) => {
    if (Math.floor(tt * 2) !== Math.floor((tt - STEP) * 2)) {
      phys.car.input.throttle = rnd() * 2 - 0.6;
      phys.car.input.steer = rnd() * 2 - 1;
      phys.car.input.handbrake = rnd() < 0.1;
    }
    if (phys.events.some((e) => e.type === 'nan')) nan = true;
    phys.events.length = 0;
  });
  const c = phys.car;
  assert.ok(!nan && Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.q.w), 'finite car');
  for (const p of phys.props.list) assert.ok(Number.isFinite(p.pos.x + p.pos.y + p.pos.z), 'finite prop');
  for (let k = 0; k < phys.waves.h.length; k++) assert.ok(Number.isFinite(phys.waves.h[k]));
  console.log('  car after 60s at', c.pos.x.toFixed(1), c.pos.y.toFixed(2), c.pos.z.toFixed(1), 'speed', c.speed.toFixed(1));
});

test('props reach buoyant equilibrium in still water', () => {
  const t = flatTerrain(-2.5);
  const phys = createPhysics(t);
  phys.car.reset(100, 100, 0);
  const kinds = ['ball', 'ring', 'buoy', 'barrel', 'melon'];
  const ps = kinds.map((k, i) => phys.props.add(k, i * 3, 0, { yOff: 1.5 }));
  run(phys, 12);
  for (const p of ps) {
    const wl = phys.water.levelAt(p.pos.x, p.pos.z);
    const bottom = p.pos.y - p.r;
    console.log(`  ${p.kind}: submerged ${(p.submerged * 100).toFixed(0)}%  vy ${p.vel.y.toFixed(3)}`);
    assert.ok(bottom < wl && p.pos.y + p.r > wl, `${p.kind} floats at the surface`);
    assert.ok(Math.abs(p.vel.y) < 0.25, `${p.kind} settled`);
  }
});

test('car floats/wades in deep water instead of sinking, and wakes the water', () => {
  const t = flatTerrain(-2.2);
  const phys = createPhysics(t);
  phys.car.reset(0, 0, 0);
  phys.car.pos.y = 0.6;
  phys.car.input.throttle = 1;
  run(phys, 6);
  const c = phys.car;
  let energy = 0;
  for (let k = 0; k < phys.waves.h.length; k++) energy += Math.abs(phys.waves.h[k]);
  console.log(`  deep water: y ${c.pos.y.toFixed(2)} speed ${c.speed.toFixed(2)} submersion ${c.submersion.toFixed(2)} wave energy ${energy.toFixed(1)}`);
  assert.ok(c.pos.y > -1.2, 'does not sink to the floor');
  assert.ok(c.speed > 0.8 && c.speed < 8, 'slow paddling');
  assert.ok(energy > 5, 'creates ripples');
});
