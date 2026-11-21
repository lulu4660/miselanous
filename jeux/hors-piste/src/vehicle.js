// One drivable vehicle on cannon-es, built from a spec in vehicles.js:
// rigid chassis + CANNON.RaycastVehicle (Bullet-style raycast suspension and tyre friction),
// plus speed-sensitive steering, an engine curve routed by drivetrain (AWD/RWD), per-surface
// grip and rolling resistance, overshoot-free braking, parking hold, downforce, deep-snow drag,
// analytic chassis-vs-ground contacts and self-righting. Local axes: +z forward, +y up, +x left.
import * as CANNON from 'cannon-es';
import { S, SURF_GRIP, SURF_ROLL } from './vehicles.js';

const G = 9.81;
// how loose each surface is (0 = tarmac grip, 1 = gravel/snow): rear grip deficit, power slides
const LOOSE = [0, 1, 1, 0.8, 1, 1, 0.3, 1];
// arcade cornering: extra sideways grip on loose surfaces (braking/traction keep the real values)
const LAT = [1.0, 1.3, 1.45, 1.2, 1.2, 1.3, 1.05, 1.6];
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
    steer: 0, steerIn: 0, steerHold: 0, throttle: 0, brake: 0,
    input: { steer: 0, throttle: 0, brake: 0, handbrake: false },
    wheels: spec.wheels.map((w) => ({
      ...w, compression: 0, grounded: false, contact: new CANNON.Vec3(), normal: new CANNON.Vec3(0, 1, 0),
      load: 0, surf: S.DIRT, spin: 0, slip: 0, steerAngle: 0, suspLen: spec.restLength, submerged: 0,
    })),
    speed: 0, forwardSpeed: 0, rpm: 0, gear: 1, load: 0, skid: 0, wade: 0, airborne: false, airTime: 0,
    surface: S.DIRT, groundedCount: 0, submersion: 0, beta: 0,
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

  const F = new CANNON.Vec3(), U = new CANNON.Vec3(), L = new CANNON.Vec3();
  const frontZ = spec.wheels.filter((w) => w.front).reduce((a, w) => a + w.z, 0) / 2;
  const TY = spec.tyre || {};
  let prevVelYaw = null, wv = 0;
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
    car.steer = 0; car.steerIn = 0; car.steerHold = 0; car.flippedTime = 0; car.beta = 0; prevVelYaw = null; wv = 0;
    for (const wi of vehicle.wheelInfos) { wi.suspensionLength = spec.restLength; wi.deltaRotation = 0; if (!Number.isFinite(wi.rotation)) wi.rotation = 0; }
    chassis.updateInertiaWorld(true); // a NaN'd body keeps a NaN inertia otherwise and blows up again
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

    // body slip angle (velocity direction vs heading; + = sliding toward the car's left)
    L.set(R[0], R[3], R[6]);
    const vLeft = chassis.velocity.dot(L);
    const beta = hspeed > 3 ? Math.atan2(vLeft, Math.max(0.5, Math.abs(speedF))) : 0;
    car.beta = beta;
    const velYaw = Math.atan2(chassis.velocity.x, chassis.velocity.z);
    const wvRaw = prevVelYaw === null || hspeed < 3 ? 0 : Math.atan2(Math.sin(velYaw - prevVelYaw), Math.cos(velYaw - prevVelYaw)) / dt;
    prevVelYaw = hspeed < 3 ? null : velYaw;
    wv += (wvRaw - wv) * Math.min(1, dt * 25);
    // steering. The input (rate limited) asks for a share of the tyre's best slip angle,
    // measured from where the front axle is actually travelling: full lock at speed always
    // works the front tyres at their peak instead of scrubbing them, and in a slide the
    // wheels follow the travel direction by themselves (natural counter-steer). At walking
    // pace it blends back to plain geometric steering.
    const st = spec.steer;
    const rIn = st.rate * dt * (Math.abs(inp.steer) < Math.abs(car.steerIn) ? 1.6 : 1);
    car.steerIn += Math.max(-rIn, Math.min(rIn, inp.steer - car.steerIn));
    // the drift builds while the arrow is held (quick taps stay tidy on a straight)
    car.steerHold += (car.steerIn - car.steerHold) * Math.min(1, dt * (Math.abs(car.steerIn) < Math.abs(car.steerHold) ? 6 : 2.2));
    const yawRate = chassis.angularVelocity.dot(U);
    const vLeftF = vLeft + yawRate * frontZ;
    const thetaF = speedF > 0.5 ? Math.atan2(vLeftF, speedF) : 0;
    const apF = (TY.peak ?? 0.12) + 0.08 * LOOSE[car.surface];
    const wSlip = Math.min(1, Math.max(0, (speedF - 2) / 3));
    // reversing: less lock as speed builds (a full-lock reverse at speed just spins the tail)
    const geo = car.steerIn * st.max * (speedF < -1 ? Math.max(0.5, 1 - (-speedF - 1) / 12) : 1);
    // the wheels only follow the travel direction while turning or once really sliding; with
    // the arrow released and the car tracking straight they stay straight (a camber or a
    // side slope must not steer the car)
    const follow = Math.max(Math.abs(car.steerIn), Math.min(1, Math.max(0, (Math.abs(beta) - 0.07) / 0.13)));
    const slipSteer = thetaF * follow + car.steerIn * apF * (st.bite ?? 1.15);
    car.steer = Math.max(-st.max, Math.min(st.max, geo + (slipSteer - geo) * wSlip));
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
      // cornering throttle assist: with the arrow held and the front tyres at their limit,
      // the engine eases off instead of pushing the car wide (stronger on tarmac)
      const sat = Math.min(1, Math.max(0, (frontG - 0.8) / 0.18)) * Math.abs(car.steerIn);
      engineF *= 1 - (TY.cornerCut ?? 0.6) * sat * (1 - 0.85 * LOOSE[car.surface]);
    } else if (drive < 0) {
      const k = Math.max(0, 1 - Math.pow(Math.max(0, -speedF) / spec.reverseSpeed, 2));
      engineF = drive * spec.engineForce * 0.55 * k;
    }

    // per-wheel grip and longitudinal force, applied by tyres() inside the vehicle update
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
      if (!cw.front) {
        const loose = LOOSE[cw.surf];
        // tarmac: a touch of understeer (safe); gravel/snow: the rear lets go first, the car rotates
        grip *= (TY.rearTarmac ?? 1.04) - ((TY.rearLoose ?? 0.12) + ((TY.rearTarmac ?? 1.04) - 1)) * loose;
        if (drive > 0 && driven[i]) grip *= 1 - (TY.powerSlide ?? (spec.drive === 'rwd' ? 0.16 : 0.07)) * drive * (0.4 + 0.6 * loose) * Math.min(1, Math.max(0, (speedF - 3) / 9)); // power oversteer, not from rest
        if (inp.handbrake) grip *= 0.42;
      }
      let fx = engineF * torqueSplit[i] - Math.sign(speedF) * resist / 4;
      // braking keeps ~25% of the grip for steering (ABS-like); traction may use more
      if (wi.isInContact) {
        // braking = the force opposes the motion and is not the engine pulling away (a car at
        // rest creeping back by a hair must still be able to drive off)
        const engineDir = engineF * torqueSplit[i];
        const braking = fx * speedF < 0 && !(engineDir !== 0 && Math.sign(engineDir) === Math.sign(fx));
        const cap = grip * Math.max(0, wi.suspensionForce) * (braking ? 0.72 : 1.0) + 50;
        if (braking && fx > cap) fx = cap; else if (braking && fx < -cap) fx = -cap;
        tyreBrake[i] = braking;
      }
      tyreGrip[i] = grip; tyreFx[i] = fx;
      vehicle.applyEngineForce(0, i);
      vehicle.setBrake(0, i);
    }
    // parking hold: idle and slow -> cancel the along-track velocity, and the sideways creep
    // too unless the slope is too steep to stand on
    if (Math.abs(thr) < 0.02 && Math.abs(speedF) < 1.2 && grounded >= 3) {
      F.scale(speedF, tmp);
      chassis.velocity.vsub(tmp, chassis.velocity);
      // (and hold against the slope's pull for the coming step, or gravity re-adds the creep)
      F.scale(spec.mass * G * F.y, tmp); chassis.force.vadd(tmp, chassis.force);
      if (hspeed < 1.2 && U.y > 0.8) {
        L.scale(chassis.velocity.dot(L), tmp); chassis.velocity.vsub(tmp, chassis.velocity);
        L.scale(spec.mass * G * L.y, tmp); chassis.force.vadd(tmp, chassis.force);
      }
    }
    // aero drag + downforce
    chassis.velocity.scale(-0.42 * hspeed, force);
    chassis.force.vadd(force, chassis.force);
    if (spec.downforce && grounded > 0) { U.scale(-spec.downforce * hspeed * hspeed, tmp); chassis.force.vadd(tmp, chassis.force); }
    // deep snow / sand drag on the tyres
    let soft = 0;
    for (const cw of car.wheels) if (cw.grounded && (cw.surf === S.SNOW || cw.surf === S.SAND)) soft++;
    if (soft) { chassis.velocity.scale(-soft * 0.012 * spec.mass * (1 / spec.grip[S.SNOW]) * 0.25, tmp); tmp.y = 0; chassis.force.vadd(tmp, chassis.force); }

    // rally assist: the steering sets a drift angle (slip between heading and travel) that
    // depends on the surface: a hint on tarmac, a proper slide on gravel and snow, more with
    // the power on in a rear-drive car and with the handbrake. A yaw torque steers the slip
    // angle toward it (d(beta)/dt = wv - r), so the car rotates into bends, holds the drift
    // and straightens when the arrow is released, instead of spinning.
    if (grounded >= 2 && speedF > 3) {
      const loose = LOOSE[car.surface];
      const r = chassis.angularVelocity.dot(U);
      let drift = (TY.drift ?? 0.36) * (0.12 + 0.88 * loose) * (car.driftScale ?? 1);
      if (drive > 0) drift *= 1 + 0.1 * drive; else drift *= 0.8;
      drift *= Math.max(0.35, Math.min(1, (hspeed - 4) / 10)); // slow hairpins: a big angle only scrubs the speed away
      drift *= Math.max(0.45, Math.min(1, 1.3 - hspeed / 40)); // fast sweepers: smaller slides
      // handbrake: pivot now (hairpins), from the live steering rather than the held one
      const betaT = inp.handbrake ? -car.steerIn * Math.max(drift * 2, 0.8) : -car.steerHold * drift;
      const rDes = wv + (TY.betaGain ?? 3.2) * (beta - betaT);
      const wIn = Math.min(1, (speedF - 3) / 5) * (car.assist ?? 1);
      const lim = chassis.inertia.y * (TY.yawAuth ?? 7);
      const tau = Math.max(-lim, Math.min(lim, chassis.inertia.y * (TY.yawK ?? 9) * (rDes - r))) * wIn;
      U.scale(tau, tmp); chassis.torque.vadd(tmp, chassis.torque);
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

  // --- tyres: replaces RaycastVehicle.updateFriction (cannon's is all-or-nothing Coulomb friction:
  // a wheel either rails or slides, so a drift can't be held). Lateral force follows the slip
  // angle up to a peak and falls a little beyond it (less on the front, more on the rear on
  // loose surfaces); longitudinal force shares the friction ellipse with it (power oversteer,
  // braking understeer). Each corner never gets more sideways impulse than stops it sliding.
  const rwdRear = spec.wheels.map((w) => spec.drive === 'rwd' && !w.front);
  const tyreGrip = [1, 1, 1, 1], tyreFx = [0, 0, 0, 0], tyreBrake = [false, false, false, false], tyreSlip = [0, 0, 0, 0];
  const fw = new CANNON.Vec3(), lw = new CANNON.Vec3(), vc = new CANNON.Vec3(), rp = new CANNON.Vec3(), Jt = new CANNON.Vec3();
  let latSpeed = 1, frontG = 0;
  function tyres(dt) {
    updateR();
    // arcade: more cornering grip as speed rises, so fast bends stay drivable
    latSpeed = 1 + 0.35 * Math.min(1, Math.max(0, (car.speed - 12) / 23));
    let gF = 0;
    F.set(R[2], R[5], R[8]); L.set(R[0], R[3], R[6]); U.set(R[1], R[4], R[7]);
    for (let i = 0; i < 4; i++) {
      const wi = vehicle.wheelInfos[i], cw = car.wheels[i];
      tyreSlip[i] = 0;
      wi.sliding = false; wi.skidInfo = 1;
      if (!wi.isInContact) continue;
      const n = wi.raycastResult.hitNormalWorld, P = wi.raycastResult.hitPointWorld;
      const c = Math.cos(wi.steering), sn = Math.sin(wi.steering);
      fw.set(F.x * c + L.x * sn, F.y * c + L.y * sn, F.z * c + L.z * sn);
      const fn = fw.dot(n);
      fw.set(fw.x - n.x * fn, fw.y - n.y * fn, fw.z - n.z * fn); fw.normalize();
      n.cross(fw, lw); // wheel's left, in the contact plane
      P.vsub(chassis.position, rp);
      chassis.angularVelocity.cross(rp, vc); vc.vadd(chassis.velocity, vc);
      const vx = vc.dot(fw), vy = vc.dot(lw);
      const Fz = Math.min(Math.max(0, wi.suspensionForce), spec.mass * G * 1.6);
      const cap = tyreGrip[i] * Fz;
      const loose = LOOSE[cw.surf];
      if (cap < 1) continue; // touching but unloaded: nothing to push with
      // lateral from the slip angle
      const ap = (TY.peak ?? 0.12) + 0.08 * loose;
      const a = Math.atan2(Math.abs(vy), Math.max(Math.abs(vx), 1.5));
      const slide = cw.front ? (TY.frontSlide ?? 0.95) : (TY.rearSlide ?? 0.86) - 0.08 * loose;
      const g = a < ap ? Math.sin((a / ap) * Math.PI * 0.5) : 1 - (1 - slide) * Math.min(1, (a - ap) / 0.45);
      const capL = cap * LAT[cw.surf] * (TY.lat ?? 1) * latSpeed;
      // cornering has priority on the friction ellipse: what the tyre spends turning is taken
      // from traction/braking (a thumb holding Avancer through a bend no longer accelerates
      // out of it); wheelspin beyond what is left
      // (loose surfaces keep more drive: a held drift must not bog down)
      const share = Math.sqrt(Math.max(0.09 + (rwdRear[i] ? 0.5 : 0.16) * loose, 1 - g * g));
      const fxCap = cap * (tyreBrake[i] ? Math.max(share, 0.45) : share);
      let fx = tyreFx[i], spin = 0;
      if (Math.abs(fx) > fxCap) { if (!tyreBrake[i]) spin = Math.min(1, (Math.abs(fx) - fxCap) / (fxCap + 1)); fx = Math.sign(fx) * fxCap * (tyreBrake[i] ? 1 : 0.92); }
      if (cw.front) gF += g * 0.5;
      let jy = -Math.sign(vy) * capL * g * dt;
      const ky = car.invMassAt(P, lw);
      const jyStop = (Math.abs(vy) / ky) * 0.5;
      if (Math.abs(jy) > jyStop) jy = Math.sign(jy) * jyStop;
      let jx = fx * dt;
      if (tyreBrake[i]) { const jxStop = (Math.abs(vx) / car.invMassAt(P, fw)) * 0.5; if (Math.abs(jx) > jxStop) jx = Math.sign(jx) * jxStop; }
      // drive/brake below the axle (the body dives and squats, damped like the anti-dive /
      // anti-squat geometry of real suspensions), side force with its height scaled down
      // (Bullet's roll influence: fewer rollovers)
      const h0 = rp.dot(U);
      let up = h0 * (TY.antiPitch ?? 0.55);
      rp.set(rp.x - U.x * up, rp.y - U.y * up, rp.z - U.z * up);
      Jt.set(fw.x * jx, fw.y * jx, fw.z * jx);
      chassis.applyImpulse(Jt, rp);
      up = h0 * (1 - spec.rollInfluence) - up;
      rp.set(rp.x - U.x * up, rp.y - U.y * up, rp.z - U.z * up);
      Jt.set(lw.x * jy, lw.y * jy, lw.z * jy);
      chassis.applyImpulse(Jt, rp);
      tyreSlip[i] = Math.max(spin, a > ap * 0.75 ? Math.min(1, (a - ap * 0.75) / 0.3) : 0, inp_handbrakeRear(cw) ? 0.7 : 0);
    }
    frontG = gF;
  }
  const inp_handbrakeRear = (cw) => car.input.handbrake && !cw.front && Math.abs(car.forwardSpeed) > 2;
  vehicle.updateFriction = tyres;
  car.tyreDebug = { grip: tyreGrip, fx: tyreFx, slip: tyreSlip };

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
      cw.slip = cw.grounded ? tyreSlip[i] : 0;
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
