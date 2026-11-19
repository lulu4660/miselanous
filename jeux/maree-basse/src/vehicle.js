// The 4x4 on cannon-es: a rigid chassis (two boxes) + CANNON.RaycastVehicle (Bullet-style
// raycast suspension and tyre friction). On top: speed-dependent steering, 4WD engine curve,
// surface grip, brake/parking, amphibious buoyancy + drag + paddling, self-righting.
// Local axes: +z forward, +y up, +x left.
import * as CANNON from 'cannon-es';
import { SURF } from './terrain.js';

const G = 9.81;

export const CAR = {
  mass: 1150,
  wheelRadius: 0.46,
  restLength: 0.5,
  wheels: [
    { x: 0.92, y: -0.05, z: 1.33, front: true },
    { x: -0.92, y: -0.05, z: 1.33, front: true },
    { x: 0.92, y: -0.05, z: -1.24, front: false },
    { x: -0.92, y: -0.05, z: -1.24, front: false },
  ],
  maxSteer: 0.6,
  maxSteerHigh: 0.2,
  steerRate: 2.6,
  engineForce: 8600,
  topSpeed: 21,
  reverseSpeed: 7.5,
  brakeDecel: 11.5,       // m/s² at full brake
  grip: [1.25, 1.12, 1.35, 1.35, 1.25], // RaycastVehicle frictionSlip per SURF
  rollResist: [0.05, 0.028, 0.032, 0.015, 0.012],
  box: { minX: -0.98, maxX: 0.98, minY: -0.42, maxY: 1.22, minZ: -2.12, maxZ: 2.2 },
  buoyancy: 3.0,
  hullDepth: 1.0,
};

// Chassis vs island: cannon's convex-vs-heightfield test is the most expensive contact in
// the scene, so the body is filtered out of it and these hull points are resolved against
// the analytic heightfield instead (cannon still handles the chassis vs props/scenery).
const HULL = [];
{
  const b = CAR.box;
  for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) {
    HULL.push(new CANNON.Vec3(x, b.minY + 0.08, z));
    HULL.push(new CANNON.Vec3(x * 0.85, b.maxY, z * 0.75));
  }
  HULL.push(new CANNON.Vec3(0, b.minY, b.maxZ), new CANNON.Vec3(0, b.minY, b.minZ));
  HULL.push(new CANNON.Vec3(b.minX, b.minY, 0), new CANNON.Vec3(b.maxX, b.minY, 0));
  HULL.push(new CANNON.Vec3(b.minX, 0.35, b.maxZ), new CANNON.Vec3(b.maxX, 0.35, b.maxZ), new CANNON.Vec3(b.minX, 0.35, b.minZ), new CANNON.Vec3(b.maxX, 0.35, b.minZ));
  HULL.push(new CANNON.Vec3(0, b.maxY + 0.05, 0));
}
export const GROUND_GROUP = 2;
export const PROP_GROUP = 4;

// Water sample points (buoyancy + drag), body frame
const FLOAT = [];
for (const x of [-0.8, 0.8]) for (const z of [-1.7, 0, 1.7]) FLOAT.push(new CANNON.Vec3(x, -0.35, z));
for (const x of [-0.8, 0.8]) for (const z of [-1.2, 1.2]) FLOAT.push(new CANNON.Vec3(x, 0.45, z));

export function createVehicle(world, terrain, water, material) {
  const chassis = new CANNON.Body({ mass: CAR.mass, material, allowSleep: false, angularDamping: 0.04, linearDamping: 0.005 });
  chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.96, 0.4, 2.14)), new CANNON.Vec3(0, -0.02, 0.02));
  chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.72, 0.38, 1.42)), new CANNON.Vec3(0, 0.8, -0.45));
  chassis.userData = { kind: 'car' };
  // the island and the props are resolved by our own contact code (cheaper and steadier)
  chassis.collisionFilterMask = ~(GROUND_GROUP | PROP_GROUP);
  // a slightly larger roll/pitch inertia than the boxes alone keeps it planted but lively
  chassis.updateMassProperties();
  chassis.inertia.x *= 1.25; chassis.inertia.z *= 1.6;
  chassis.invInertia.set(1 / chassis.inertia.x, 1 / chassis.inertia.y, 1 / chassis.inertia.z);
  chassis.updateInertiaWorld(true);

  const vehicle = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
  for (const w of CAR.wheels) {
    vehicle.addWheel({
      radius: CAR.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(w.x, w.y, w.z),
      suspensionRestLength: CAR.restLength,
      suspensionStiffness: 15.5,
      dampingCompression: 2.4,
      dampingRelaxation: 2.0,
      frictionSlip: 1.25,
      rollInfluence: 0.08,
      maxSuspensionTravel: 0.44,
      maxSuspensionForce: 140000,
      useCustomSlidingRotationalSpeed: true,
      customSlidingRotationalSpeed: -25,
    });
  }

  const R = new Float64Array(9);
  const car = {
    body: chassis, vehicle,
    pos: chassis.position, q: chassis.quaternion, vel: chassis.velocity, angVel: chassis.angularVelocity,
    rpos: chassis.interpolatedPosition, rq: chassis.interpolatedQuaternion,
    R,
    steer: 0, throttle: 0, brake: 0,
    input: { steer: 0, throttle: 0, brake: 0, handbrake: false },
    wheels: CAR.wheels.map((w) => ({
      ...w, compression: 0, grounded: false, contact: new CANNON.Vec3(), normal: new CANNON.Vec3(0, 1, 0),
      load: 0, surf: SURF.SAND, spin: 0, slip: 0, steerAngle: 0, suspLen: CAR.restLength, submerged: 0,
    })),
    speed: 0, forwardSpeed: 0, rpm: 0, gear: 1, load: 0, skid: 0, wade: 0, airborne: false, airTime: 0,
    surface: SURF.SAND, groundedCount: 0, submersion: 0,
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

  const g = { h: 0, nx: 0, ny: 1, nz: 0, surf: 0 };
  const F = new CANNON.Vec3(), U = new CANNON.Vec3(), L = new CANNON.Vec3();
  const P = new CANNON.Vec3(), rel = new CANNON.Vec3(), vp = new CANNON.Vec3(), force = new CANNON.Vec3(), tmp = new CANNON.Vec3();
  let drive = 0;

  car.reset = function (x, z, heading) {
    const h = terrain.ground(x, z, g).h;
    chassis.position.set(x, Math.max(h, 0) + 1.35, z);
    chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), heading);
    chassis.velocity.set(0, 0, 0); chassis.angularVelocity.set(0, 0, 0);
    chassis.force.set(0, 0, 0); chassis.torque.set(0, 0, 0);
    chassis.previousPosition.copy(chassis.position); chassis.interpolatedPosition.copy(chassis.position);
    chassis.previousQuaternion.copy(chassis.quaternion); chassis.interpolatedQuaternion.copy(chassis.quaternion);
    car.steer = 0; car.flippedTime = 0;
    for (const wi of vehicle.wheelInfos) { wi.suspensionLength = CAR.restLength; wi.deltaRotation = 0; }
    updateR();
  };
  car.velocityAt = function (o, p) { // world point -> world velocity
    p.vsub(chassis.position, rel);
    chassis.angularVelocity.cross(rel, o);
    return o.vadd(chassis.velocity, o);
  };
  car.applyImpulseAt = function (imp, p) { p.vsub(chassis.position, rel); chassis.applyImpulse(imp, rel); };
  car.localToWorld = function (o, l) { chassis.pointToWorldFrame(l, o); return o; };

  // Runs inside world 'preStep' BEFORE the RaycastVehicle update (controls + extra forces).
  car.preStep = function (dt) {
    updateR();
    car.hullContacts(dt);
    F.set(R[2], R[5], R[8]); U.set(R[1], R[4], R[7]); L.set(R[0], R[3], R[6]);
    const inp = car.input;
    const speedF = chassis.velocity.dot(F);
    car.forwardSpeed = speedF;
    const hspeed = Math.hypot(chassis.velocity.x, chassis.velocity.z);
    car.speed = hspeed;

    // steering, speed sensitive and rate limited
    const sAbs = Math.min(1, Math.abs(speedF) / 18);
    const maxS = CAR.maxSteer + (CAR.maxSteerHigh - CAR.maxSteer) * sAbs;
    const target = inp.steer * maxS;
    const rate = CAR.steerRate * dt * (Math.abs(target) < Math.abs(car.steer) ? 1.6 : 1);
    car.steer += Math.max(-rate, Math.min(rate, target - car.steer));
    vehicle.setSteeringValue(car.steer, 0);
    vehicle.setSteeringValue(car.steer, 1);

    // throttle / brake / reverse
    const thr = inp.throttle;
    let brake = 0; drive = 0;
    if (thr > 0.02) { if (speedF < -0.6) brake = thr; else drive = thr; }
    else if (thr < -0.02) { if (speedF > 0.6) brake = -thr; else drive = thr; }
    if (drive === 0 && inp.brake > 0) brake = Math.max(brake, Math.min(1, inp.brake));
    car.throttle = thr; car.brake = brake;
    let engineF = 0;
    if (drive > 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, speedF) / CAR.topSpeed, 2.2));
      engineF = speedF > CAR.topSpeed ? 0 : drive * CAR.engineForce * (0.35 + 0.65 * k);
    } else if (drive < 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, -speedF) / CAR.reverseSpeed, 2));
      engineF = drive * CAR.engineForce * 0.6 * k;
    }

    // Longitudinal force: engine, brakes and rolling resistance, all through the wheel engine
    // force (cannon's own brake impulses overshoot per wheel and make a parked car creep).
    let loadSum = 0, rrSum = 0, grounded = 0;
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      if (!wi.isInContact) continue;
      grounded++;
      const n = Math.max(0, wi.suspensionForce);
      loadSum += n;
      rrSum += CAR.rollResist[cw.surf] * (1 + cw.submerged * 2) * n;
    }
    const stopCap = (CAR.mass * Math.abs(speedF)) / dt; // never push past zero speed in one step
    let fx = engineF;
    const brakeF = (brake + (inp.handbrake ? 0.8 : 0)) * CAR.mass * CAR.brakeDecel * (grounded / 4);
    fx -= Math.sign(speedF) * Math.min(brakeF + (drive === 0 ? rrSum : rrSum * 0.5), stopCap);
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      let grip = CAR.grip[cw.surf] * (1 - 0.22 * cw.submerged);
      if (inp.handbrake && !cw.front) grip *= 0.45;
      wi.frictionSlip = grip;
      vehicle.applyEngineForce(-fx / 4, i); // cannon: negative = forward along +z
      vehicle.setBrake(0, i);
    }
    // parking brake: idle and slow -> cancel the along-track velocity (no creep on slopes)
    if (Math.abs(thr) < 0.02 && Math.abs(speedF) < 1.2 && grounded >= 3) {
      F.scale(speedF, tmp);
      chassis.velocity.vsub(tmp, chassis.velocity);
    }
    void loadSum;

    // water: buoyancy, anisotropic drag, paddling, rudder
    let subm = 0;
    const perLift = (CAR.buoyancy * CAR.mass * G) / FLOAT.length;
    for (let i = 0; i < FLOAT.length; i++) {
      chassis.pointToWorldFrame(FLOAT[i], P);
      const d = water.levelAt(P.x, P.z) - P.y;
      if (d <= 0) continue;
      const s = Math.min(1, d / CAR.hullDepth);
      subm += s;
      car.velocityAt(vp, P);
      const vf = vp.dot(F), vl = vp.dot(L), vu = vp.dot(U);
      const k = 140 * s;
      force.set(0, perLift * s, 0);
      F.scale(-vf * k * 0.7 - vf * Math.abs(vf) * 18 * s, tmp); force.vadd(tmp, force);
      L.scale(-vl * k * 3.2, tmp); force.vadd(tmp, force);
      U.scale(-vu * k * 2.2, tmp); force.vadd(tmp, force);
      P.vsub(chassis.position, rel);
      chassis.applyForce(force, rel);
    }
    subm /= FLOAT.length;
    car.submersion = subm;
    if (subm > 0.05) {
      const grounded = car.groundedCount;
      const paddle = (grounded < 2 ? 1 : 0.3) * subm * (U.y > 0.3 ? 1 : 0);
      F.scale(engineF * 0.6 * paddle, force);
      chassis.applyForce(force, rel.set(0, 0, 0));
      U.scale(car.steer * speedF * 900 * subm, tmp); chassis.torque.vadd(tmp, chassis.torque);
      chassis.angularVelocity.scale(-2600 * subm, tmp); chassis.torque.vadd(tmp, chassis.torque);
    }
    // aero drag
    chassis.velocity.scale(-0.45 * hspeed, force);
    chassis.force.vadd(force, chassis.force);

    // self-righting when stuck on the side or the roof
    const upDot = U.y;
    if (upDot < 0.35 && hspeed < 3) car.flippedTime += dt; else car.flippedTime = Math.max(0, car.flippedTime - dt * 2);
    if (car.flippedTime > 1.2) {
      // axis = U x worldUp
      tmp.set(-U.z, 0, U.x);
      if (Math.hypot(tmp.x, tmp.z) < 0.3) tmp.copy(F);
      tmp.normalize();
      const s = Math.min(1, (car.flippedTime - 1.2) * 1.5);
      tmp.scale(11000 * s, tmp); chassis.torque.vadd(tmp, chassis.torque);
      chassis.angularVelocity.scale(-1500 * s, tmp); chassis.torque.vadd(tmp, chassis.torque);
      if (upDot < 0.3) chassis.force.y += CAR.mass * G * 0.85 * s;
    }
  };

  // hull points vs the analytic heightfield (impulses + Baumgarte bias), called in preStep
  const hp = new CANNON.Vec3(), hn = new CANNON.Vec3(), hv = new CANNON.Vec3(), ht = new CANNON.Vec3(), r = new CANNON.Vec3();
  const rxn = new CANNON.Vec3(), tmp2 = new CANNON.Vec3(), imp = new CANNON.Vec3();
  const nrm = [0, 1, 0];
  const invMassAt = (n) => { // uses r (contact - COM)
    r.cross(n, rxn);
    chassis.invInertiaWorld.vmult(rxn, tmp2);
    tmp2.cross(r, rxn);
    return chassis.invMass + rxn.dot(n);
  };
  function hullContact(dt, depth) {
    car.velocityAt(hv, hp);
    const vn = hv.dot(hn);
    hp.vsub(chassis.position, r);
    const k = invMassAt(hn);
    const bias = Math.min(4, Math.max(0, depth - 0.01) * 0.25 / dt);
    const jn = (-vn * (vn < -2 ? 1.25 : 1) + bias) / k;
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
      const jt = Math.min(vt / kt, 0.55 * jn);
      ht.scale(-jt, imp); chassis.applyImpulse(imp, r);
    }
  }
  car.hullContacts = function (dt) {
    for (let i = 0; i < HULL.length; i++) {
      chassis.pointToWorldFrame(HULL[i], hp);
      const h = terrain.normalAt(hp.x, hp.z, nrm);
      const pen = h - hp.y;
      if (pen > 0) { hn.set(nrm[0], nrm[1], nrm[2]); hullContact(dt, pen * hn.y); }
    }
  };

  // After the step: telemetry for audio/visuals
  const surfCount = [0, 0, 0, 0, 0];
  car.postStep = function (dt) {
    updateR();
    car.time += dt;
    let grounded = 0, slipSum = 0;
    surfCount.fill(0);
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      cw.grounded = wi.isInContact;
      cw.suspLen = Math.min(CAR.restLength, Math.max(0, wi.suspensionLength));
      cw.compression = CAR.restLength - cw.suspLen;
      cw.steerAngle = wi.steering;
      cw.spin = -wi.rotation;
      cw.load = Math.max(0, wi.suspensionForce || 0);
      cw.slip = cw.grounded ? 1 - wi.skidInfo : 0;
      if (cw.grounded) {
        grounded++;
        cw.contact.copy(wi.raycastResult.hitPointWorld);
        cw.normal.copy(wi.raycastResult.hitNormalWorld);
        const hitBody = wi.raycastResult.body;
        if (hitBody && hitBody.userData && hitBody.userData.wood) cw.surf = SURF.WOOD;
        else cw.surf = terrain.ground(cw.contact.x, cw.contact.z, g, cw.contact.y + 0.05).surf;
        const wd = water.levelAt(cw.contact.x, cw.contact.z) - cw.contact.y;
        cw.submerged = wd > 0 ? Math.min(1, wd / 0.6) : 0;
        surfCount[cw.surf]++;
        slipSum += Math.min(1, cw.slip * 1.5);
      } else cw.submerged = 0;
    }
    const wasAir = car.airborne;
    car.groundedCount = grounded;
    car.airborne = grounded === 0 && car.submersion < 0.02;
    if (car.airborne) car.airTime += dt; else {
      if (wasAir && car.airTime > 0.25) car.events.push({ type: 'land', intensity: Math.min(1, car.airTime * 0.8) });
      car.airTime = 0;
    }
    let best = 0;
    for (let s = 1; s < 5; s++) if (surfCount[s] > surfCount[best]) best = s;
    car.surface = best;
    car.skid = grounded ? slipSum / grounded : 0;
    car.load = Math.min(1, Math.abs(drive) * (grounded ? 1 : 0.4));
    car.wade = car.submersion;
    // fake gearbox for the engine sound
    const sp = Math.abs(car.forwardSpeed);
    const tops = [0, 5.5, 10.5, 16, 30];
    let gear = 1;
    while (gear < 4 && sp > tops[gear]) gear++;
    const lo = tops[gear - 1], hi = tops[gear];
    const rpmT = 0.18 + 0.82 * Math.min(1, (sp - lo) / (hi - lo)) * (gear === 1 ? 1 : 0.85) + (gear > 1 ? 0.12 : 0);
    const free = grounded === 0 || car.skid > 0.4 ? Math.abs(drive) * 0.6 : 0;
    car.rpm += (Math.min(1, Math.max(rpmT, free + 0.18) * (Math.abs(drive) > 0 ? 1 : 0.85)) - car.rpm) * Math.min(1, dt * 8);
    car.gear = gear;
    const p = chassis.position, v = chassis.velocity;
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + chassis.quaternion.w)) car.events.push({ type: 'nan' });
  };

  return car;
}
