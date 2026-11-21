// AI drivers: pure pursuit along a road polyline with a lane offset, target speed from the
// curvature ahead and the surface grip, stuck recovery. They drive through car.input, i.e.
// exactly the same vehicle physics as the player. Plus a traffic manager that keeps cars
// physical near the player and moves them "on rails" along the road when far away.
import { S, SURF_GRIP, VEHICLES, LIVERIES } from './vehicles.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ROAD_MU = [0, SURF_GRIP[S.ASPHALT], SURF_GRIP[S.DIRT], SURF_GRIP[S.SNOWROAD]];

export function createDriver(car, road, { lane = 2.2, skill = 0.85, startIdx = 0 } = {}) {
  const P = road.pts, n = P.length;
  const at = (i) => P[road.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  const d = { car, road, lane, skill, idx: startIdx, stuck: 0, reverse: 0, offRoad: 0, lapDist: 0, targetSpeed: 0, wantRespawn: false, noProgress: 0, lastLap: 0 };
  car.assist = 1;

  d.nearest = function () {
    let best = d.idx, bd = Infinity;
    for (let k = -12; k <= 40; k++) {
      const p = at(d.idx + k);
      const dd = (p.x - car.pos.x) ** 2 + (p.z - car.pos.z) ** 2;
      if (dd < bd) { bd = dd; best = d.idx + k; }
    }
    const moved = best - d.idx;
    if (moved > 0) d.lapDist += moved * 2;
    d.idx = road.closed ? ((best % n) + n) % n : Math.max(0, Math.min(n - 1, best));
    return Math.sqrt(bd);
  };

  // max safe speed over the next stretch of road from its curvature and grip
  d.speedLimit = function (fromIdx, span = 96) {
    const spec = car.spec;
    let vmax = spec.topSpeed * (0.82 + 0.18 * skill);
    for (let k = 0; k < span; k += 2) {
      const a = at(fromIdx + k), b = at(fromIdx + k + 4);
      const turn = Math.abs(wrap(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz))) / 8; // rad per metre
      if (turn < 1e-4) continue;
      const R = 1 / turn;
      const mu = ROAD_MU[a.type] * spec.grip[[0, S.ASPHALT, S.DIRT, S.SNOWROAD][a.type]] * 0.54 * (spec.aiGrip ?? 1); // aiGrip: tall/light cars corner below their tyre grip
      const v = Math.sqrt(mu * 9.81 * R) * (0.78 + 0.22 * skill);
      const decel = Math.min(spec.brakeDecel, mu * 9.81 * 1.3) * 0.55; // what this surface can really stop
      // crests: keep the wheels on the ground (v² < g·R_vertical)
      const c0 = at(fromIdx + k - 4), c2 = at(fromIdx + k + 4);
      const curvV = (c2.y - 2 * a.y + c0.y) / 64;
      const vCrest = curvV < -1e-4 ? Math.sqrt(9.81 / -curvV) * 1.05 : Infinity;
      // allow braking distance: farther corners matter less
      const dist = k * 2;
      vmax = Math.min(vmax, Math.sqrt(vCrest * vCrest + 2 * decel * dist));
      const vAllowed = Math.sqrt(v * v + 2 * decel * dist);
      vmax = Math.min(vmax, vAllowed);
    }
    return Math.max(5, vmax);
  };

  d.update = function (dt) {
    const dist = d.nearest();
    const sp = car.forwardSpeed;
    const inp = car.input;
    inp.handbrake = false; inp.brake = 0;
    // recovery
    if (d.reverse > 0) {
      d.reverse -= dt;
      d.noProgress += dt;
      if (d.noProgress > 10) { d.wantRespawn = true; d.noProgress = 0; }
      inp.throttle = -1; inp.steer = -d.revSteer;
      return;
    }
    const look = 7 + Math.max(0, sp) * 0.75;
    const j = d.idx + Math.round(look / 2);
    const p = at(j);
    const rx = -p.tz, rz = p.tx; // right-hand side of the direction of travel
    const tx = p.x + rx * d.lane, tz = p.z + rz * d.lane;
    const want = Math.atan2(tx - car.pos.x, tz - car.pos.z);
    const err = wrap(want - car.headingYaw());
    // heading error to the pursuit point + cross-track error to the lane (the vehicle already
    // narrows its steering lock with speed, so the gain stays constant)
    const q = at(d.idx);
    const lx = car.pos.x - (q.x - q.tz * d.lane), lz = car.pos.z - (q.z + q.tx * d.lane);
    const cross = lx * -q.tz + lz * q.tx; // >0: car is to the right of its lane line
    inp.steer = Math.max(-1, Math.min(1, err * 3.2 + cross * 0.08));
    const vT = d.speedLimit(d.idx + 2) * (Math.abs(err) > 0.6 ? 0.5 : 1);
    d.targetSpeed = vT;
    if (sp < vT - 0.8) inp.throttle = Math.min(1, 0.45 + (vT - sp) * 0.25);
    else if (sp > vT + 1.5) inp.throttle = -Math.min(1, (sp - vT) * 0.25) * (1 - 0.65 * Math.min(1, Math.abs(inp.steer))); // trail braking
    else inp.throttle = 0.25;
    // stuck / off road
    if (inp.throttle > 0.4 && Math.abs(sp) < 0.8) d.stuck += dt; else d.stuck = Math.max(0, d.stuck - dt * 2);
    if (d.stuck > 2.2) { d.stuck = 0; d.reverse = 1.3; d.revSteer = inp.steer; }
    d.offRoad = dist > 18 ? d.offRoad + dt : 0;
    if (d.lapDist > d.lastLap + 6) { d.lastLap = d.lapDist; d.noProgress = 0; } else d.noProgress += dt;
    d.wantRespawn = d.offRoad > 6 || car.flippedTime > 5 || d.noProgress > 10;
    if (d.wantRespawn) d.noProgress = 0;
  };
  return d;
}

// ---------------------------------------------------------------------------------
// Traffic: AI cars spread along the main loop, all driving the same way.
export function createTraffic(phys, world, { count = 5, rnd = Math.random } = {}) {
  const road = world.loop, n = road.pts.length;
  const ids = Object.keys(VEHICLES);
  const T = { cars: [], drivers: [] };
  for (let k = 0; k < count; k++) {
    const spec = VEHICLES[ids[k % ids.length]];
    const car = phys.addVehicle(spec);
    car.livery = LIVERIES[k % LIVERIES.length];
    const idx = Math.floor(world.spawn.idx + ((k + 1) / (count + 1)) * n) % n; // never on the player's spawn
    const drv = createDriver(car, road, { lane: 2.0 + rnd() * 0.6, skill: 0.72 + rnd() * 0.22, startIdx: idx });
    placeOnRoad(car, drv, idx);
    drv.railS = idx * 2; drv.railSpeed = 0;
    T.cars.push(car); T.drivers.push(drv);
  }
  function placeOnRoad(car, drv, idx) {
    const p = road.pts[((idx % n) + n) % n];
    const x = p.x - p.tz * drv.lane, z = p.z + p.tx * drv.lane;
    car.reset(x, z, Math.atan2(p.tx, p.tz));
    drv.idx = ((idx % n) + n) % n;
  }
  T.placeOnRoad = placeOnRoad;

  // near the player: physical; far: advanced along the road kinematically (bodies removed)
  T.update = function (dt, player) {
    for (let k = 0; k < T.cars.length; k++) {
      const car = T.cars[k], drv = T.drivers[k];
      const dx = car.pos.x - player.pos.x, dz = car.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (car.active && dist > T.farDist) {
        phys.deactivate(car);
        drv.railS = drv.idx * 2;
        drv.railSpeed = Math.max(8, Math.min(car.forwardSpeed, drv.speedLimit(drv.idx)));
      } else if (!car.active && dist < T.nearDist) {
        placeOnRoad(car, drv, drv.idx);
        const p = road.pts[drv.idx];
        const v = drv.railSpeed || 10;
        car.body.velocity.set(p.tx * v, 0, p.tz * v);
        phys.activate(car);
      }
      if (car.active) {
        drv.update(dt);
        if (drv.wantRespawn && dist > 35) { placeOnRoad(car, drv, drv.idx + 10); drv.offRoad = 0; drv.wantRespawn = false; }
      } else {
        // on rails: follow the road at the local safe speed
        const vT = drv.speedLimit(drv.idx) * 0.92;
        drv.railSpeed += (vT - drv.railSpeed) * Math.min(1, dt * 0.8);
        drv.railS = (drv.railS + drv.railSpeed * dt) % (n * 2);
        const i0 = Math.floor(drv.railS / 2) % n, f = (drv.railS / 2) - Math.floor(drv.railS / 2);
        const a = road.pts[i0], b = road.pts[(i0 + 1) % n];
        const x = a.x + (b.x - a.x) * f - a.tz * drv.lane, z = a.z + (b.z - a.z) * f + a.tx * drv.lane;
        const y = world.heightAt(x, z) - car.spec.box.minY + car.spec.restLength * 0.6 + 0.1;
        car.pos.set(x, y, z);
        car.rpos.set(x, y, z);
        car.q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.atan2(a.tx, a.tz));
        car.rq.copy(car.q);
        car.vel.set(a.tx * drv.railSpeed, 0, a.tz * drv.railSpeed);
        car.forwardSpeed = drv.railSpeed; car.speed = drv.railSpeed;
        drv.idx = i0;
        for (const w of car.wheels) { w.spin += drv.railSpeed * dt / w.radius; w.suspLen = car.spec.restLength * 0.7; w.steerAngle = 0; }
      }
    }
  };
  T.nearDist = 170; T.farDist = 210;
  return T;
}
