// Rigid-body 4x4 with raycast spring/damper suspension, tyre friction circle,
// chassis contacts, amphibious water forces. Renderer-free.
// Local axes: +z forward, +y up, +x left.
import {
  v3, q4, set, copy, add, sub, scale, addScaled, dot, cross, normalize,
  quatToMat, mulMat, mulMatT, integrateQuat, quatFromAxisAngle, isFiniteV,
} from './vmath.js';
import { SURF } from './terrain.js';

const G = 9.81;

export const CAR = {
  mass: 1150,
  inertia: { x: 1900, y: 2100, z: 900 },   // roll inertia boosted a bit for stability
  wheelRadius: 0.46,
  restLength: 0.5,
  springK: 17500,
  damperC: 1750,
  bumpK: 90000,
  antiRoll: 9000,
  wheels: [
    // x, y, z (anchor = top of suspension travel), front?
    { x: 0.92, y: -0.05, z: 1.33, front: true },
    { x: -0.92, y: -0.05, z: 1.33, front: true },
    { x: 0.92, y: -0.05, z: -1.24, front: false },
    { x: -0.92, y: -0.05, z: -1.24, front: false },
  ],
  maxSteer: 0.6,
  maxSteerHigh: 0.2,
  steerRate: 2.6,
  engineForce: 8200,
  topSpeed: 21,
  reverseSpeed: 7.5,
  brakeForce: 13000,
  mu: [0.95, 0.88, 1.0, 1.0, 0.95], // per SURF
  rollResist: [0.045, 0.025, 0.03, 0.015, 0.012],
  // Chassis box used for collisions with props/obstacles (local, relative to COM)
  box: { minX: -0.98, maxX: 0.98, minY: -0.42, maxY: 1.22, minZ: -2.12, maxZ: 2.2 },
  // Buoyancy: total lift when the whole sample set is submerged, as fraction of weight.
  buoyancy: 3.0,
  hullDepth: 1.0,
};

// Points used for terrain penetration (chassis vs heightfield).
const HULL = [];
{
  const b = CAR.box;
  for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) {
    HULL.push(v3(x, b.minY + 0.08, z));
    HULL.push(v3(x * 0.85, b.maxY, z * 0.75));
  }
  HULL.push(v3(0, b.minY, b.maxZ), v3(0, b.minY, b.minZ));
  HULL.push(v3(b.minX, b.minY, 0), v3(b.maxX, b.minY, 0));
  HULL.push(v3(b.minX, 0.35, b.maxZ), v3(b.maxX, 0.35, b.maxZ), v3(b.minX, 0.35, b.minZ), v3(b.maxX, 0.35, b.minZ));
  HULL.push(v3(0, b.maxY + 0.05, 0));
}
// Points used for water buoyancy/drag.
const FLOAT = [];
{
  for (const x of [-0.8, 0.8]) for (const z of [-1.7, 0, 1.7]) FLOAT.push(v3(x, -0.35, z));
  for (const x of [-0.8, 0.8]) for (const z of [-1.2, 1.2]) FLOAT.push(v3(x, 0.45, z));
}

export function createVehicle(terrain, water) {
  const car = {
    pos: v3(), q: q4(), vel: v3(), angVel: v3(),
    R: new Float64Array(9),
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    input: { steer: 0, throttle: 0, brake: 0, handbrake: false },
    wheels: CAR.wheels.map((w) => ({
      ...w, local: v3(w.x, w.y, w.z),
      compression: 0, prevCompression: 0, grounded: false, contact: v3(), normal: v3(0, 1, 0),
      load: 0, surf: SURF.SAND, spin: 0, spinVel: 0, slip: 0, steerAngle: 0, suspLen: CAR.restLength,
      submerged: 0,
    })),
    speed: 0, forwardSpeed: 0, rpm: 0, gear: 1, load: 0, skid: 0, wade: 0, airborne: false, airTime: 0,
    surface: SURF.SAND, groundedCount: 0, submersion: 0,
    events: [], // { type: 'land'|'splash'|'hit', intensity, ... } consumed by the game each frame
    flippedTime: 0, uprightAssist: 0,
  };

  // Scratch
  const U = v3(), F = v3(), Lft = v3(), A = v3(), D = v3(), P = v3(), r = v3(), vp = v3(), tmp = v3(), tmp2 = v3();
  const fwd = v3(), side = v3(), n = v3(), force = v3(), torque = v3();
  const g = { h: 0, nx: 0, ny: 1, nz: 0, surf: 0 };
  const invI = { x: 1 / CAR.inertia.x, y: 1 / CAR.inertia.y, z: 1 / CAR.inertia.z };
  const invM = 1 / CAR.mass;

  car.reset = function (x, z, heading) {
    const h = terrain.ground(x, z, g).h;
    set(car.pos, x, Math.max(h, 0) + 1.35, z);
    quatFromAxisAngle(car.q, 0, 1, 0, heading);
    set(car.vel, 0, 0, 0); set(car.angVel, 0, 0, 0);
    car.steer = 0;
    for (const w of car.wheels) { w.compression = w.prevCompression = 0; w.grounded = false; }
    quatToMat(car.R, car.q);
    car.flippedTime = 0;
  };

  // World inverse inertia * vector (in world space)
  function applyInvInertia(o, a) {
    mulMatT(tmp2, car.R, a);
    tmp2.x *= invI.x; tmp2.y *= invI.y; tmp2.z *= invI.z;
    return mulMat(o, car.R, tmp2);
  }

  car.applyImpulseAt = function (imp, point) {
    addScaled(car.vel, imp, invM);
    sub(r, point, car.pos);
    cross(tmp, r, imp);
    applyInvInertia(tmp, tmp);
    add(car.angVel, car.angVel, tmp);
  };
  // effective inverse mass along n at point
  car.invMassAt = function (point, nn) {
    sub(r, point, car.pos);
    cross(tmp, r, nn);
    applyInvInertia(tmp, tmp);
    cross(tmp, tmp, r);
    return invM + dot(tmp, nn);
  };
  car.velocityAt = function (o, point) {
    sub(r, point, car.pos);
    cross(o, car.angVel, r);
    return add(o, o, car.vel);
  };
  car.localToWorld = function (o, l) { mulMat(o, car.R, l); return add(o, o, car.pos); };

  // Raycast along -U from anchor A; returns distance to ground or -1.
  function castWheel(Ax, Ay, Az, Dx, Dy, Dz, maxT) {
    const f = (t) => (Ay + Dy * t) - terrain.ground(Ax + Dx * t, Az + Dz * t, g, Ay + Dy * t).h;
    let f0 = f(0);
    if (f0 <= 0) return 0;
    const steps = 5;
    let t0 = 0;
    for (let s = 1; s <= steps; s++) {
      const t1 = (maxT * s) / steps;
      const f1 = f(t1);
      if (f1 <= 0) {
        let a = t0, b = t1;
        for (let k = 0; k < 7; k++) {
          const m = (a + b) * 0.5;
          if (f(m) > 0) a = m; else b = m;
        }
        return (a + b) * 0.5;
      }
      t0 = t1; f0 = f1;
    }
    return -1;
  }

  const forceAcc = v3(), torqueAcc = v3();
  function addForceAt(f, point) {
    add(forceAcc, forceAcc, f);
    sub(r, point, car.pos);
    cross(tmp, r, f);
    add(torqueAcc, torqueAcc, tmp);
  }

  car.step = function (dt) {
    quatToMat(car.R, car.q);
    const R = car.R;
    set(U, R[1], R[4], R[7]);   // local +y
    set(F, R[2], R[5], R[8]);   // local +z
    set(Lft, R[0], R[3], R[6]); // local +x
    set(forceAcc, 0, -G * CAR.mass, 0);
    set(torqueAcc, 0, 0, 0);

    const inp = car.input;
    const speedF = dot(car.vel, F);
    car.forwardSpeed = speedF;
    const hspeed = Math.hypot(car.vel.x, car.vel.z);
    car.speed = hspeed;

    // --- Steering (speed sensitive, rate limited)
    const sAbs = Math.min(1, Math.abs(speedF) / 18);
    const maxS = CAR.maxSteer + (CAR.maxSteerHigh - CAR.maxSteer) * sAbs;
    const target = inp.steer * maxS;
    const ds = target - car.steer;
    const rate = CAR.steerRate * dt * (Math.abs(target) < Math.abs(car.steer) ? 1.6 : 1);
    car.steer += Math.max(-rate, Math.min(rate, ds));

    // --- Throttle / brake logic (auto reverse)
    let drive = 0, brake = 0;
    const thr = inp.throttle;
    if (thr > 0.02) {
      if (speedF < -0.6) brake = thr; else drive = thr;
    } else if (thr < -0.02) {
      if (speedF > 0.6) brake = -thr; else drive = thr; // negative = reverse
    }
    if (drive === 0 && inp.brake > 0) brake = Math.max(brake, Math.min(1, inp.brake));
    car.throttle = thr;
    car.brake = brake;
    let engineF = 0;
    if (drive > 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, speedF) / CAR.topSpeed, 2.2));
      engineF = drive * CAR.engineForce * (0.35 + 0.65 * k) * (speedF > CAR.topSpeed ? 0 : 1);
    } else if (drive < 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, -speedF) / CAR.reverseSpeed, 2));
      engineF = drive * CAR.engineForce * 0.6 * k;
    }

    // --- Suspension + tyres
    let grounded = 0, slipSum = 0, loadSum = 0;
    const surfCount = [0, 0, 0, 0, 0];
    const maxT = CAR.restLength + CAR.wheelRadius;
    const mEff = CAR.mass / 4;
    const wheels = car.wheels;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      mulMat(A, R, w.local); add(A, A, car.pos);
      scale(D, U, -1);
      const t = castWheel(A.x, A.y, A.z, D.x, D.y, D.z, maxT);
      w.steerAngle = w.front ? car.steer : 0;
      w.prevCompression = w.compression;
      if (t < 0) {
        w.grounded = false;
        w.compression = 0;
        w.suspLen = CAR.restLength;
        w.load = 0;
        // free spinning wheel follows throttle a bit
        w.spinVel += ((drive * 30) - w.spinVel) * Math.min(1, dt * 2);
        continue;
      }
      w.grounded = true;
      grounded++;
      const comp = Math.min(CAR.restLength, CAR.restLength + CAR.wheelRadius - t);
      w.compression = Math.max(0, comp);
      w.suspLen = CAR.restLength - w.compression;
      // contact point & ground normal
      set(P, A.x + D.x * t, A.y + D.y * t, A.z + D.z * t);
      terrain.ground(P.x, P.z, g, P.y + 0.05);
      set(n, g.nx, g.ny, g.nz);
      copy(w.contact, P); copy(w.normal, n);
      w.surf = g.surf;
      surfCount[g.surf]++;

      const cv = (w.compression - w.prevCompression) / dt;
      let fs = CAR.springK * w.compression + CAR.damperC * cv;
      if (w.compression > CAR.restLength * 0.82) fs += CAR.bumpK * (w.compression - CAR.restLength * 0.82);
      if (fs < 0) fs = 0;
      w.springForce = fs;
      // Suspension pushes along body up at the anchor
      scale(force, U, fs);
      addForceAt(force, A);
      const N = fs * Math.max(0, dot(U, n));
      w.load = N;
      loadSum += N;

      // Tyre frame on the contact plane
      if (w.front) {
        const cs = Math.cos(w.steerAngle), sn = Math.sin(w.steerAngle);
        set(fwd, F.x * cs + Lft.x * sn, F.y * cs + Lft.y * sn, F.z * cs + Lft.z * sn);
      } else copy(fwd, F);
      addScaled(fwd, n, -dot(fwd, n)); normalize(fwd);
      cross(side, n, fwd); // points to the left (n=up, fwd=+z -> +x)

      car.velocityAt(vp, P);
      const vLong = dot(vp, fwd);
      const vLat = dot(vp, side);

      // water under this wheel reduces grip
      const wdepth = water.levelAt(P.x, P.z) - P.y;
      w.submerged = wdepth > 0 ? Math.min(1, wdepth / 0.6) : 0;
      let mu = CAR.mu[g.surf] * (1 - 0.18 * w.submerged);

      let fx = engineF / 4;
      // rolling resistance (sand is draggy)
      fx -= Math.sign(vLong) * Math.min(Math.abs(vLong) * mEff / dt, CAR.rollResist[g.surf] * N * (1 + w.submerged * 2));
      if (brake > 0) {
        const fb = (brake * CAR.brakeForce) / 4;
        fx -= Math.sign(vLong) * Math.min(fb, Math.abs(vLong) * mEff / dt);
      }
      let latK = 1;
      if (inp.handbrake && !w.front) {
        fx = -Math.sign(vLong) * Math.min(Math.abs(vLong) * mEff / dt, mu * N * 0.7);
        latK = 0.32;
      }
      // Hold still when idle at low speed (parking friction)
      if (Math.abs(thr) < 0.02 && Math.abs(vLong) < 1.2) {
        fx = -vLong * mEff / dt * 0.5;
      }
      // Lateral: stiffness model capped by the slip-cancelling force
      const cy = Math.min(mu * N * 3.2 * latK, mEff / dt * 0.9);
      let fy = -vLat * cy;
      // friction circle
      const maxF = mu * N;
      const tot = Math.hypot(fx, fy);
      let slip = 0;
      if (tot > maxF && tot > 0) {
        const s = maxF / tot;
        slip = 1 - s;
        fx *= s; fy *= s;
      }
      slipSum += Math.min(1, slip + Math.max(0, Math.abs(vLat) - 1.5) * 0.15);
      w.slip = slip;
      // Apply tyre forces slightly above the contact point (reduces roll-over tendency)
      set(force, fwd.x * fx + side.x * fy, fwd.y * fx + side.y * fy, fwd.z * fx + side.z * fy);
      set(tmp2, P.x + U.x * 0.42, P.y + U.y * 0.42, P.z + U.z * 0.42);
      addForceAt(force, tmp2);

      // visual wheel spin
      const targetSpin = vLong / CAR.wheelRadius + (slip > 0.2 && drive !== 0 ? drive * 12 * slip : 0);
      w.spinVel += (targetSpin - w.spinVel) * Math.min(1, dt * 25);
    }

    // Anti-roll bars
    for (let axle = 0; axle < 2; axle++) {
      const a = wheels[axle * 2], b = wheels[axle * 2 + 1];
      if (!a.grounded && !b.grounded) continue;
      const diff = (a.compression - b.compression) * CAR.antiRoll;
      mulMat(A, R, a.local); add(A, A, car.pos);
      scale(force, U, diff); addForceAt(force, A);
      mulMat(A, R, b.local); add(A, A, car.pos);
      scale(force, U, -diff); addForceAt(force, A);
    }

    // --- Water: buoyancy, drag, amphibious propulsion
    let subm = 0;
    const perLift = (CAR.buoyancy * CAR.mass * G) / FLOAT.length;
    for (let i = 0; i < FLOAT.length; i++) {
      mulMat(P, R, FLOAT[i]); add(P, P, car.pos);
      const wl = water.levelAt(P.x, P.z);
      const d = wl - P.y;
      if (d <= 0) continue;
      const s = Math.min(1, d / CAR.hullDepth);
      subm += s;
      set(force, 0, perLift * s, 0);
      car.velocityAt(vp, P);
      // anisotropic drag: forward slips through, sideways resists (keel)
      const vf = dot(vp, F), vl = dot(vp, Lft), vu = dot(vp, U);
      const k = 140 * s;
      addScaled(force, F, -vf * k * 0.7 - vf * Math.abs(vf) * 18 * s);
      addScaled(force, Lft, -vl * k * 3.2);
      addScaled(force, U, -vu * k * 2.2);
      addForceAt(force, P);
    }
    subm /= FLOAT.length;
    const sub2 = subm;
    car.submersion = subm;
    if (subm > 0.05) {
      // paddling: wheels act as crude paddles when floating
      const paddle = (grounded < 2 ? 1 : 0.3) * subm;
      scale(force, F, engineF * 0.6 * paddle);
      addForceAt(force, car.pos);
      // rudder-ish yaw from steering when moving in water
      const yaw = car.steer * speedF * 900 * subm;
      addScaled(torqueAcc, U, yaw);
      // angular damping in water
      addScaled(torqueAcc, car.angVel, -2600 * subm);
    }

    // aero drag + small angular damping
    addScaled(forceAcc, car.vel, -0.45 * hspeed);
    addScaled(torqueAcc, car.angVel, -60);

    // Upright assist when flipped/stuck on the side
    const upDot = U.y;
    if (upDot < 0.35 && hspeed < 3) car.flippedTime += dt; else car.flippedTime = Math.max(0, car.flippedTime - dt * 2);
    if (car.flippedTime > 1.2) {
      // torque that rotates U toward world up; when fully inverted the cross product
      // vanishes, so roll around the forward axis instead
      cross(tmp, U, set(tmp2, 0, 1, 0));
      if (Math.hypot(tmp.x, tmp.y, tmp.z) < 0.3) { copy(tmp, F); }
      normalize(tmp);
      const s = Math.min(1, (car.flippedTime - 1.2) * 1.5);
      addScaled(torqueAcc, tmp, 11000 * s);
      addScaled(torqueAcc, car.angVel, -1500 * s);
      if (upDot < 0.3) forceAcc.y += CAR.mass * G * 0.85 * s;
    }

    // --- Integrate velocities
    addScaled(car.vel, forceAcc, invM * dt);
    applyInvInertia(tmp, torqueAcc);
    addScaled(car.angVel, tmp, dt);

    // --- Chassis contacts with the ground (impulses)
    resolveHullContacts(dt);

    // --- Integrate positions
    addScaled(car.pos, car.vel, dt);
    integrateQuat(car.q, car.angVel, dt);
    quatToMat(car.R, car.q);

    // wheel visual spin integration
    for (const w of wheels) w.spin += w.spinVel * dt;

    // Telemetry
    const wasAir = car.airborne;
    car.groundedCount = grounded;
    car.airborne = grounded === 0 && sub2 < 0.02;
    if (car.airborne) car.airTime += dt; else {
      if (wasAir && car.airTime > 0.25) car.events.push({ type: 'land', intensity: Math.min(1, car.airTime * 0.8) });
      car.airTime = 0;
    }
    let best = 0;
    for (let s = 1; s < 5; s++) if (surfCount[s] > surfCount[best]) best = s;
    car.surface = best;
    car.skid = grounded ? slipSum / grounded : 0;
    car.load = Math.min(1, Math.abs(drive) * (grounded ? 1 : 0.4));
    car.wade = sub2;
    // fake gearbox for audio
    const sp = Math.abs(speedF);
    const gearTops = [0, 5.5, 10.5, 16, 30];
    let gear = 1;
    while (gear < 4 && sp > gearTops[gear]) gear++;
    const lo = gearTops[gear - 1], hi = gearTops[gear];
    const rpmT = 0.18 + 0.82 * Math.min(1, (sp - lo) / (hi - lo)) * (gear === 1 ? 1 : 0.85) + (gear > 1 ? 0.12 : 0);
    const free = grounded === 0 || car.skid > 0.4 ? Math.abs(drive) * 0.6 : 0;
    car.rpm += (Math.min(1, Math.max(rpmT, free + 0.18) * (Math.abs(drive) > 0 ? 1 : 0.85)) - car.rpm) * Math.min(1, dt * 8);
    car.gear = gear;

    if (!isFiniteV(car.pos) || !isFiniteV(car.vel) || !isFiniteV(car.angVel) || !Number.isFinite(car.q.w)) {
      car.events.push({ type: 'nan' });
    }
  };

  const hp = v3(), hn = v3(), hv = v3(), ht = v3(), timp = v3();
  const wall = { nx: 0, nz: 0 };
  function contact(dt, depth, rest = 0.25) {
    car.velocityAt(hv, hp);
    const vn = dot(hv, hn);
    const k = car.invMassAt(hp, hn);
    const bias = Math.min(4, Math.max(0, depth - 0.01) * 0.25 / dt);
    let jn = (-(vn) * (vn < -2 ? 1 + rest : 1) + bias) / k;
    if (jn <= 0) return;
    if (vn < -3) car.events.push({ type: 'scrape', intensity: Math.min(1, -vn / 8) });
    scale(timp, hn, jn);
    car.applyImpulseAt(timp, hp);
    car.velocityAt(hv, hp);
    const vnn = dot(hv, hn);
    set(ht, hv.x - hn.x * vnn, hv.y - hn.y * vnn, hv.z - hn.z * vnn);
    const vt = Math.hypot(ht.x, ht.y, ht.z);
    if (vt > 1e-4) {
      scale(ht, ht, 1 / vt);
      const kt = car.invMassAt(hp, ht);
      const jt = Math.min(vt / kt, 0.55 * jn);
      scale(timp, ht, -jt);
      car.applyImpulseAt(timp, hp);
    }
  }
  function resolveHullContacts(dt) {
    const R = car.R;
    for (let i = 0; i < HULL.length; i++) {
      mulMat(hp, R, HULL[i]); add(hp, hp, car.pos);
      // ground (structures only count if the point is at most 0.25 m below their top)
      terrain.ground(hp.x, hp.z, g, hp.y, 0.25);
      const pen = g.h - hp.y;
      if (pen > 0) { set(hn, g.nx, g.ny, g.nz); contact(dt, pen * hn.y); }
      // pier / ramp sides act as walls: push out horizontally, never launch upward
      const wd = terrain.structureWall(hp.x, hp.y, hp.z, wall);
      if (wd > 0) { set(hn, wall.nx, 0, wall.nz); contact(dt, Math.min(wd, 0.5), 0.05); }
    }
  }

  // Static vertical-cylinder obstacles (trunks, posts, rocks): circle vs car OBB in the car's frame.
  const lp = v3(), cp = v3(), wn = v3(), wcp = v3();
  car.collideCylinder = function (ox, oz, rad, yBot, yTop) {
    const b = CAR.box;
    sub(lp, set(tmp, ox, car.pos.y, oz), car.pos);
    mulMatT(lp, car.R, lp);
    const cx = Math.max(b.minX, Math.min(b.maxX, lp.x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, lp.z));
    const dx = lp.x - cx, dz = lp.z - cz;
    let dist = Math.hypot(dx, dz);
    let nx, nz, pen;
    if (dist > 1e-5) {
      if (dist >= rad) return 0;
      nx = dx / dist; nz = dz / dist; pen = rad - dist;
    } else {
      // centre inside the box footprint: push along the shallowest axis
      const px = Math.min(lp.x - b.minX, b.maxX - lp.x), pz = Math.min(lp.z - b.minZ, b.maxZ - lp.z);
      if (px < pz) { nx = lp.x - b.minX < b.maxX - lp.x ? -1 : 1; nz = 0; pen = px + rad; }
      else { nz = lp.z - b.minZ < b.maxZ - lp.z ? -1 : 1; nx = 0; pen = pz + rad; }
    }
    // height overlap check (world)
    set(cp, cx, 0.2, cz);
    mulMat(wcp, car.R, cp); add(wcp, wcp, car.pos);
    if (wcp.y < yBot - 0.3 || wcp.y > yTop + 0.2) return 0;
    // normal pointing from obstacle into car (world)
    set(cp, -nx, 0, -nz);
    mulMat(wn, car.R, cp);
    wn.y = 0; normalize(wn);
    car.velocityAt(hv, wcp);
    const vn = dot(hv, wn);
    // position fix
    addScaled(car.pos, wn, pen * 0.8);
    if (vn < 0) {
      const k = car.invMassAt(wcp, wn);
      const j = (-(1.25) * vn) / k;
      scale(timp, wn, j);
      car.applyImpulseAt(timp, wcp);
      return -vn;
    }
    return 0.0001;
  };

  return car;
}
