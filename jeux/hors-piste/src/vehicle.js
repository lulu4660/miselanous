// One drivable vehicle on cannon-es, built from a spec in vehicles.js:
// rigid chassis + CANNON.RaycastVehicle (Bullet-style raycast suspension and tyre friction),
// plus speed-sensitive steering, an engine curve routed by drivetrain (AWD/RWD), per-surface
// grip and rolling resistance, overshoot-free braking, parking hold, downforce, deep-snow drag,
// analytic chassis-vs-ground contacts and self-righting. Local axes: +z forward, +y up, +x left.
import * as CANNON from 'cannon-es';
import { S, SURF_GRIP, SURF_ROLL } from './vehicles.js';

const G = 9.81;
export const GROUND_GROUP = 2;
export const PROP_GROUP = 4;
export const CAR_GROUP = 8;

function hullPoints(b) {
  const H = [];
  for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) {
    H.push(new CANNON.Vec3(x, b.minY + 0.06, z));
    H.push(new CANNON.Vec3(x * 0.85, b.maxY, z * 0.75));
  }
  H.push(new CANNON.Vec3(0, b.minY, b.maxZ), new CANNON.Vec3(0, b.minY, b.minZ));
  H.push(new CANNON.Vec3(b.minX, b.minY, 0), new CANNON.Vec3(b.maxX, b.minY, 0));
  const my = (b.minY + b.maxY) / 2;
  H.push(new CANNON.Vec3(b.minX, my, b.maxZ), new CANNON.Vec3(b.maxX, my, b.maxZ), new CANNON.Vec3(b.minX, my, b.minZ), new CANNON.Vec3(b.maxX, my, b.minZ));
  H.push(new CANNON.Vec3(0, b.maxY + 0.05, 0));
  return H;
}

// map: { heightAt(x,z), normalAt(x,z,out3) -> h, surfaceAt(x,z) -> S id }
export function createVehicle(world, map, spec, material) {
  const chassis = new CANNON.Body({ mass: spec.mass, material, allowSleep: false, angularDamping: 0.04, linearDamping: 0.004 });
  for (const c of spec.chassis) chassis.addShape(new CANNON.Box(new CANNON.Vec3(...c.half)), new CANNON.Vec3(...c.offset));
  chassis.userData = { kind: 'car' };
  chassis.collisionFilterGroup = CAR_GROUP;
  chassis.collisionFilterMask = ~(GROUND_GROUP | PROP_GROUP); // island & props: own contact code
  chassis.updateMassProperties();
  const im = spec.inertiaMul || [1, 1, 1];
  chassis.inertia.x *= im[0]; chassis.inertia.y *= im[1]; chassis.inertia.z *= im[2];
  chassis.invInertia.set(1 / chassis.inertia.x, 1 / chassis.inertia.y, 1 / chassis.inertia.z);
  chassis.updateInertiaWorld(true);

  const vehicle = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
  for (const w of spec.wheels) {
    vehicle.addWheel({
      radius: w.radius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(w.x, w.y, w.z),
      suspensionRestLength: spec.restLength,
      suspensionStiffness: spec.stiffness,
      dampingCompression: spec.dampingCompression,
      dampingRelaxation: spec.dampingRelaxation,
      frictionSlip: 1.2,
      rollInfluence: spec.rollInfluence,
      maxSuspensionTravel: spec.maxTravel,
      maxSuspensionForce: spec.mass * 120,
      useCustomSlidingRotationalSpeed: true,
      customSlidingRotationalSpeed: -25,
    });
  }
  const driven = spec.wheels.map((w) => (spec.drive === 'awd' ? 1 : spec.drive === 'rwd' ? (w.front ? 0 : 1) : (w.front ? 1 : 0)));
  const drivenCount = driven.reduce((a, b) => a + b, 0);
  const torqueSplit = spec.wheels.map((w, i) => (spec.drive === 'awd' ? (w.front ? 0.42 : 0.58) / 2 : driven[i] / drivenCount));
  const HULL = hullPoints(spec.box);

  const R = new Float64Array(9);
  const car = {
    spec, body: chassis, vehicle,
    pos: chassis.position, q: chassis.quaternion, vel: chassis.velocity, angVel: chassis.angularVelocity,
    rpos: chassis.interpolatedPosition, rq: chassis.interpolatedQuaternion,
    R,
    steer: 0, throttle: 0, brake: 0,
    input: { steer: 0, throttle: 0, brake: 0, handbrake: false },
    wheels: spec.wheels.map((w) => ({
      ...w, compression: 0, grounded: false, contact: new CANNON.Vec3(), normal: new CANNON.Vec3(0, 1, 0),
      load: 0, surf: S.DIRT, spin: 0, slip: 0, steerAngle: 0, suspLen: spec.restLength, submerged: 0,
    })),
    speed: 0, forwardSpeed: 0, rpm: 0, gear: 1, load: 0, skid: 0, wade: 0, airborne: false, airTime: 0,
    surface: S.DIRT, groundedCount: 0, submersion: 0,
    events: [], flippedTime: 0, time: 0,
  };

  const updateR = () => {
    const { x, y, z, w } = chassis.quaternion;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    R[0] = 1 - (yy + zz); R[1] = xy - wz; R[2] = xz + wy;
    R[3] = xy + wz; R[4] = 1 - (xx + zz); R[5] = yz - wx;
    R[6] = xz - wy; R[7] = yz + wx; R[8] = 1 - (xx + yy);
  };
  updateR();

  const F = new CANNON.Vec3(), U = new CANNON.Vec3();
  const rel = new CANNON.Vec3(), force = new CANNON.Vec3(), tmp = new CANNON.Vec3();
  let drive = 0;

  car.reset = function (x, z, heading, y) {
    const h = y ?? map.heightAt(x, z);
    chassis.position.set(x, h - spec.box.minY + spec.restLength * 0.6 + 0.35, z);
    chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), heading);
    chassis.velocity.set(0, 0, 0); chassis.angularVelocity.set(0, 0, 0);
    chassis.force.set(0, 0, 0); chassis.torque.set(0, 0, 0);
    chassis.previousPosition.copy(chassis.position); chassis.interpolatedPosition.copy(chassis.position);
    chassis.previousQuaternion.copy(chassis.quaternion); chassis.interpolatedQuaternion.copy(chassis.quaternion);
    car.steer = 0; car.flippedTime = 0;
    for (const wi of vehicle.wheelInfos) { wi.suspensionLength = spec.restLength; wi.deltaRotation = 0; }
    updateR();
  };
  car.velocityAt = function (o, p) {
    p.vsub(chassis.position, rel);
    chassis.angularVelocity.cross(rel, o);
    return o.vadd(chassis.velocity, o);
  };
  car.headingYaw = () => Math.atan2(R[2], R[8]);

  // --- chassis vs ground (analytic heightfield), impulses + Baumgarte bias
  const hp = new CANNON.Vec3(), hn = new CANNON.Vec3(), hv = new CANNON.Vec3(), ht = new CANNON.Vec3(), r = new CANNON.Vec3();
  const rxn = new CANNON.Vec3(), tmp2 = new CANNON.Vec3(), imp = new CANNON.Vec3();
  const nrm = [0, 1, 0];
  const invMassAt = (n) => { r.cross(n, rxn); chassis.invInertiaWorld.vmult(rxn, tmp2); tmp2.cross(r, rxn); return chassis.invMass + rxn.dot(n); };
  car.invMassAt = (p, n) => { p.vsub(chassis.position, r); return invMassAt(n); };
  function hullContact(dt, depth) {
    car.velocityAt(hv, hp);
    const vn = hv.dot(hn);
    hp.vsub(chassis.position, r);
    const k = invMassAt(hn);
    const bias = Math.min(4, Math.max(0, depth - 0.01) * 0.25 / dt);
    const jn = (-vn * (vn < -2 ? 1.2 : 1) + bias) / k;
    if (jn <= 0) return;
    if (vn < -3) car.events.push({ type: 'scrape', intensity: Math.min(1, -vn / 8) });
    hn.scale(jn, imp); chassis.applyImpulse(imp, r);
    car.velocityAt(hv, hp);
    const vnn = hv.dot(hn);
    ht.set(hv.x - hn.x * vnn, hv.y - hn.y * vnn, hv.z - hn.z * vnn);
    const vt = ht.length();
    if (vt > 1e-4) {
      ht.scale(1 / vt, ht);
      const kt = invMassAt(ht);
      const jt = Math.min(vt / kt, 0.5 * jn);
      ht.scale(-jt, imp); chassis.applyImpulse(imp, r);
    }
  }
  function hullContacts(dt) {
    for (let i = 0; i < HULL.length; i++) {
      chassis.pointToWorldFrame(HULL[i], hp);
      const h = map.normalAt(hp.x, hp.z, nrm);
      const pen = h - hp.y;
      if (pen > 0) { hn.set(nrm[0], nrm[1], nrm[2]); hullContact(dt, pen * hn.y); }
    }
  }

  // --- controls & forces, inside world 'preStep' before the RaycastVehicle update
  car.preStep = function (dt) {
    updateR();
    hullContacts(dt);
    F.set(R[2], R[5], R[8]); U.set(R[1], R[4], R[7]);
    const inp = car.input;
    const speedF = chassis.velocity.dot(F);
    car.forwardSpeed = speedF;
    const hspeed = Math.hypot(chassis.velocity.x, chassis.velocity.z);
    car.speed = hspeed;

    // steering: speed sensitive, rate limited
    const st = spec.steer;
    const sAbs = Math.min(1, Math.abs(speedF) / (spec.topSpeed * 0.7));
    const maxS = st.max + (st.maxHigh - st.max) * Math.sqrt(sAbs);
    const target = inp.steer * maxS;
    const rate = st.rate * dt * (Math.abs(target) < Math.abs(car.steer) ? 1.7 : 1);
    car.steer += Math.max(-rate, Math.min(rate, target - car.steer));
    for (let i = 0; i < 4; i++) if (spec.wheels[i].front) vehicle.setSteeringValue(car.steer, i);

    // throttle / brake / reverse
    const thr = inp.throttle;
    let brake = 0; drive = 0;
    if (thr > 0.02) { if (speedF < -0.6) brake = thr; else drive = thr; }
    else if (thr < -0.02) { if (speedF > 0.6) brake = -thr; else drive = thr; }
    if (drive === 0 && inp.brake > 0) brake = Math.max(brake, Math.min(1, inp.brake));
    car.throttle = thr; car.brake = brake;
    let engineF = 0;
    if (drive > 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, speedF) / spec.topSpeed, 2.2));
      engineF = speedF > spec.topSpeed ? 0 : drive * spec.engineForce * (0.32 + 0.68 * k);
    } else if (drive < 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, -speedF) / spec.reverseSpeed, 2));
      engineF = drive * spec.engineForce * 0.55 * k;
    }

    // per-wheel grip; longitudinal force through the wheel engine force only (cannon's own
    // brake impulses overshoot per wheel and make a parked car creep)
    let grounded = 0, rrSum = 0;
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      if (!wi.isInContact) continue;
      grounded++;
      rrSum += SURF_ROLL[cw.surf] * Math.max(0, wi.suspensionForce);
    }
    const stopCap = (spec.mass * Math.abs(speedF)) / dt;
    const brakeF = (brake + (inp.handbrake ? 0.7 : 0)) * spec.mass * spec.brakeDecel * (grounded / 4);
    const resist = Math.min(brakeF + (drive === 0 ? rrSum : rrSum * 0.5), stopCap);
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      let grip = SURF_GRIP[cw.surf] * spec.grip[cw.surf];
      if (inp.handbrake && !cw.front) grip *= 0.42;
      wi.frictionSlip = grip;
      let fx = engineF * torqueSplit[i] - Math.sign(speedF) * resist / 4;
      // traction / braking limited by what the surface can take (cannon's own friction
      // circle halves the longitudinal impulse, which would make snow brake like asphalt)
      if (wi.isInContact) {
        // braking keeps ~25% of the grip for steering (ABS-like); traction may use more
        const braking = fx * speedF < 0;
        const cap = grip * Math.max(0, wi.suspensionForce) * (braking ? 0.72 : 0.9) + 50;
        if (fx > cap) fx = cap; else if (fx < -cap) fx = -cap;
      }
      vehicle.applyEngineForce(-fx, i); // cannon: negative = forward along +z
      vehicle.setBrake(0, i);
    }
    // parking hold: idle and slow -> cancel the along-track velocity
    if (Math.abs(thr) < 0.02 && Math.abs(speedF) < 1.2 && grounded >= 3) {
      F.scale(speedF, tmp);
      chassis.velocity.vsub(tmp, chassis.velocity);
    }
    // aero drag + downforce
    chassis.velocity.scale(-0.42 * hspeed, force);
    chassis.force.vadd(force, chassis.force);
    if (spec.downforce && grounded > 0) { U.scale(-spec.downforce * hspeed * hspeed, tmp); chassis.force.vadd(tmp, chassis.force); }
    // deep snow / sand drag on the tyres
    let soft = 0;
    for (const cw of car.wheels) if (cw.grounded && (cw.surf === S.SNOW || cw.surf === S.SAND)) soft++;
    if (soft) { chassis.velocity.scale(-soft * 0.012 * spec.mass * (1 / spec.grip[S.SNOW]) * 0.25, tmp); tmp.y = 0; chassis.force.vadd(tmp, chassis.force); }

    // stability assist: trims yaw rate beyond what the steering asks for (spins)
    if (grounded >= 2 && hspeed > 4) {
      const wb = spec.wheels[0].z - spec.wheels[2].z;
      const rExp = (speedF * Math.tan(car.steer)) / wb;
      const r = chassis.angularVelocity.dot(U);
      const lim = Math.abs(rExp) + 0.35;
      const excess = r > lim ? r - lim : r < -lim ? r + lim : 0;
      if (excess) { U.scale(-excess * chassis.inertia.y * 4 * (car.assist ?? 0.6), tmp); chassis.torque.vadd(tmp, chassis.torque); }
    }

    // self-righting when stuck on the side or the roof
    const upDot = U.y;
    if (upDot < 0.35 && hspeed < 3) car.flippedTime += dt; else car.flippedTime = Math.max(0, car.flippedTime - dt * 2);
    if (car.flippedTime > 1.2) {
      tmp.set(-U.z, 0, U.x);
      if (Math.hypot(tmp.x, tmp.z) < 0.3) tmp.copy(F);
      tmp.normalize();
      const s = Math.min(1, (car.flippedTime - 1.2) * 1.5);
      tmp.scale(9.5 * spec.mass * s, tmp); chassis.torque.vadd(tmp, chassis.torque);
      chassis.angularVelocity.scale(-1.3 * spec.mass * s, tmp); chassis.torque.vadd(tmp, chassis.torque);
      if (upDot < 0.3) chassis.force.y += spec.mass * G * 0.85 * s;
    }
  };

  // --- after the step: wheel telemetry for visuals, audio, AI
  const surfCount = new Array(8).fill(0);
  const tops = [0, 0.2, 0.38, 0.58, 0.8, 1.3].map((f) => f * spec.topSpeed);
  car.postStep = function (dt) {
    updateR();
    car.time += dt;
    let grounded = 0, slipSum = 0;
    surfCount.fill(0);
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      cw.grounded = wi.isInContact;
      cw.suspLen = Math.min(spec.restLength, Math.max(0, wi.suspensionLength));
      cw.compression = spec.restLength - cw.suspLen;
      cw.steerAngle = wi.steering;
      cw.spin = -wi.rotation;
      cw.load = Math.max(0, wi.suspensionForce || 0);
      cw.slip = cw.grounded ? 1 - wi.skidInfo : 0;
      if (cw.grounded) {
        grounded++;
        cw.contact.copy(wi.raycastResult.hitPointWorld);
        cw.normal.copy(wi.raycastResult.hitNormalWorld);
        cw.surf = map.surfaceAt(cw.contact.x, cw.contact.z);
        surfCount[cw.surf]++;
        slipSum += Math.min(1, cw.slip * 1.5);
      }
    }
    const wasAir = car.airborne;
    car.groundedCount = grounded;
    car.airborne = grounded === 0;
    if (car.airborne) car.airTime += dt; else {
      if (wasAir && car.airTime > 0.25) car.events.push({ type: 'land', intensity: Math.min(1, car.airTime * 0.8) });
      car.airTime = 0;
    }
    let best = 0;
    for (let s = 1; s < 8; s++) if (surfCount[s] > surfCount[best]) best = s;
    if (grounded) car.surface = best;
    car.skid = grounded ? slipSum / grounded : 0;
    car.load = Math.min(1, Math.abs(drive) * (grounded ? 1 : 0.4));
    const sp = Math.abs(car.forwardSpeed);
    let gear = 1;
    while (gear < 5 && sp > tops[gear]) gear++;
    const lo = tops[gear - 1], hi = tops[gear];
    const rpmT = 0.2 + 0.8 * Math.min(1, (sp - lo) / (hi - lo)) * (gear === 1 ? 1 : 0.8) + (gear > 1 ? 0.15 : 0);
    const free = grounded === 0 || car.skid > 0.4 ? Math.abs(drive) * 0.6 : 0;
    car.rpm += (Math.min(1, Math.max(rpmT, free + 0.18) * (Math.abs(drive) > 0 ? 1 : 0.85)) - car.rpm) * Math.min(1, dt * 8);
    car.gear = gear;
    const p = chassis.position, v = chassis.velocity;
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + chassis.quaternion.w)) car.events.push({ type: 'nan' });
  };

  return car;
}
