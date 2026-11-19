// Floating / bumpable props: spheres with orientation, buoyancy, wave drift,
// terrain contact, prop-prop and prop-car collisions. Renderer-free.
import { v3, q4, set, sub, dot, cross, mulMatT, mulMat, integrateQuat, normalize, addScaled, scale } from './vmath.js';
import { CAR } from './vehicle.js';

const G = 9.81;

export const PROP_KINDS = {
  ball:   { r: 0.42, m: 0.45, density: 0.08, rest: 0.72, upright: 0, drag: 1.2, sound: 'ball', floatOffset: 0 },
  ring:   { r: 0.55, m: 1.6, density: 0.12, rest: 0.45, upright: 1, drag: 2.0, sound: 'ring', floatOffset: -0.38 },
  buoy:   { r: 0.6, m: 38, density: 0.45, rest: 0.25, upright: 1, drag: 1.6, sound: 'buoy', floatOffset: 0 },
  barrel: { r: 0.48, m: 30, density: 0.55, rest: 0.2, upright: 0, drag: 1.4, sound: 'wood', floatOffset: 0 },
  melon:  { r: 0.36, m: 5, density: 0.9, rest: 0.3, upright: 0, drag: 1.8, sound: 'ball', floatOffset: 0 },
  crate:  { r: 0.5, m: 22, density: 0.5, rest: 0.18, upright: 1, drag: 1.6, sound: 'wood', floatOffset: 0 },
};

export function createProps(terrain, water, waves) {
  const list = [];
  const P = { list };
  const nrm = [0, 1, 0];
  const grad = [0, 0];
  const g = { h: 0, nx: 0, ny: 1, nz: 0, surf: 0 };

  P.add = function (kind, x, z, opts = {}) {
    const K = PROP_KINDS[kind];
    const gh = terrain.heightAt(x, z);
    const y = Math.max(gh + K.r, water.levelAt(x, z) + K.r * 0.2) + (opts.yOff || 0);
    const p = {
      kind, K, r: K.r * (opts.scale || 1), m: K.m, invM: 1 / K.m,
      pos: v3(x, y, z), vel: v3(), q: q4(), w: v3(),
      tether: opts.tether ? { x, y: gh, z, len: opts.tether } : null,
      submerged: 0, inWater: false, lastHit: 0, sleep: 0, id: list.length,
      color: opts.color || 0,
      spawn: { x, z },
    };
    // random yaw
    const a = (opts.yaw ?? Math.random() * 6.28) / 2;
    p.q.y = Math.sin(a); p.q.w = Math.cos(a);
    list.push(p);
    return p;
  };

  const rel = v3(), n = v3(), tmp = v3(), up = v3(), lp = v3(), cp = v3(), wn = v3(), vc = v3(), imp = v3(), axis = v3();

  P.step = function (dt, car, events) {
    const t = water.time;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const K = p.K;
      const { pos, vel } = p;
      // far away & resting props sleep (cheap)
      const dcx = pos.x - car.pos.x, dcz = pos.z - car.pos.z;
      const farFromCar = dcx * dcx + dcz * dcz > 75 * 75;
      if (farFromCar && p.sleep > 2) {
        // still bob gently on the swell if floating
        if (p.inWater) pos.y = water.levelAt(pos.x, pos.z) + K.floatOffset * 0 + p.r * (1 - 2 * K.density) * 0.9;
        continue;
      }

      vel.y -= G * dt;

      // Water
      const wl = water.levelAt(pos.x, pos.z);
      const bottom = pos.y - p.r;
      const depth = wl - bottom;
      const sf = depth <= 0 ? 0 : Math.min(1, depth / (2 * p.r));
      p.submerged = sf;
      p.inWater = sf > 0.01;
      if (sf > 0) {
        // buoyancy (smoothstep on fraction looks closer to a sphere's volume curve)
        const vol = sf * sf * (3 - 2 * sf);
        vel.y += (G * vol / K.density) * dt;
        // waves push floaties downhill on the surface
        waves.gradAt(pos.x, pos.z, grad);
        const push = 9 * Math.min(1, sf * 2);
        vel.x -= grad[0] * push * dt * 2.2;
        vel.z -= grad[1] * push * dt * 2.2;
        // gentle ambient drift
        vel.x += Math.sin(t * 0.13 + p.id) * 0.02 * dt;
        vel.z += Math.cos(t * 0.11 + p.id * 1.7) * 0.02 * dt;
        // drag
        const dk = Math.exp(-K.drag * sf * dt * 1.4);
        vel.x *= dk; vel.z *= dk;
        vel.y *= Math.exp(-3.2 * sf * dt);
        p.w.x *= Math.exp(-2.5 * sf * dt); p.w.y *= Math.exp(-1.2 * sf * dt); p.w.z *= Math.exp(-2.5 * sf * dt);
        // entering water fast -> splash event
        if (vel.y < -2.5 && sf < 0.5 && p.lastSplash !== true) {
          events.push({ type: 'propSplash', x: pos.x, z: pos.z, intensity: Math.min(1, -vel.y / 8 * Math.sqrt(p.m / 5)), r: p.r });
          p.lastSplash = true;
        }
        if (sf > 0.6) p.lastSplash = false;
        // moving floaties leave little ripples
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > 0.6 && Math.random() < 0.5) waves.disturb(pos.x, pos.z, -sp * 0.04 * p.r, p.r);
      } else p.lastSplash = false;

      // Upright restoring torque for floaties when in water or on ground
      set(up, 0, 1, 0);
      if (K.upright) {
        const qx = p.q.x, qy = p.q.y, qz = p.q.z, qw = p.q.w;
        // body up axis
        up.x = 2 * (qx * qy - qw * qz); up.y = 1 - 2 * (qx * qx + qz * qz); up.z = 2 * (qy * qz + qw * qx);
        const target = v3(-grad[0] * 0.6, 1, -grad[1] * 0.6);
        normalize(target);
        cross(axis, up, target);
        const k = sf > 0 ? 14 : 3;
        p.w.x += axis.x * k * dt; p.w.z += axis.z * k * dt; p.w.y += axis.y * k * dt;
        p.w.x *= Math.exp(-2 * dt); p.w.z *= Math.exp(-2 * dt);
      }

      // Tether (buoys anchored to the seabed)
      if (p.tether) {
        const tx = pos.x - p.tether.x, tz = pos.z - p.tether.z;
        const d = Math.hypot(tx, tz);
        if (d > p.tether.len) {
          const f = (d - p.tether.len) * 6;
          vel.x -= (tx / d) * f * dt; vel.z -= (tz / d) * f * dt;
          vel.x *= Math.exp(-1.5 * dt); vel.z *= Math.exp(-1.5 * dt);
        }
      }

      // integrate
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      integrateQuat(p.q, p.w, dt);

      // terrain contact
      const gh = terrain.ground(pos.x, pos.z, g, pos.y - p.r + 0.05, 0.12).h;
      const dist = (pos.y - gh) * g.ny;
      if (dist < p.r) {
        set(n, g.nx, g.ny, g.nz);
        const pen = p.r - dist;
        pos.x += n.x * pen; pos.y += n.y * pen; pos.z += n.z * pen;
        const vn = dot(vel, n);
        if (vn < 0) {
          const e = vn < -1.5 ? K.rest : 0;
          addScaled(vel, n, -(1 + e) * vn);
          if (vn < -3) events.push({ type: 'propBump', kind: K.sound, intensity: Math.min(1, -vn / 10), x: pos.x, z: pos.z });
        }
        // rolling friction: tangential velocity -> spin
        const fr = Math.exp(-(K.upright ? 3.5 : 0.9) * dt);
        const vnn = dot(vel, n);
        const tx = vel.x - n.x * vnn, ty = vel.y - n.y * vnn, tz = vel.z - n.z * vnn;
        vel.x = n.x * vnn + tx * fr; vel.y = n.y * vnn + ty * fr; vel.z = n.z * vnn + tz * fr;
        if (!K.upright) {
          // roll: w = n x v / r
          set(tmp, tx, ty, tz);
          cross(p.w, n, tmp);
          scale(p.w, p.w, 1 / p.r);
        } else {
          p.w.y *= Math.exp(-3 * dt);
        }
      }

      // world bounds
      const R = 158;
      if (pos.x < -R) { pos.x = -R; vel.x = Math.abs(vel.x) * 0.3; }
      if (pos.x > R) { pos.x = R; vel.x = -Math.abs(vel.x) * 0.3; }
      if (pos.z < -R) { pos.z = -R; vel.z = Math.abs(vel.z) * 0.3; }
      if (pos.z > R) { pos.z = R; vel.z = -Math.abs(vel.z) * 0.3; }

      const e2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
      p.sleep = e2 < 0.05 ? p.sleep + dt : 0;
    }

    // prop-prop collisions
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const pen = rr - d;
        const wa = a.invM / (a.invM + b.invM), wb = 1 - wa;
        a.pos.x -= nx * pen * wa; a.pos.y -= ny * pen * wa; a.pos.z -= nz * pen * wa;
        b.pos.x += nx * pen * wb; b.pos.y += ny * pen * wb; b.pos.z += nz * pen * wb;
        const rv = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny + (b.vel.z - a.vel.z) * nz;
        if (rv < 0) {
          const e = Math.min(a.K.rest, b.K.rest);
          const jn = (-(1 + e) * rv) / (a.invM + b.invM);
          a.vel.x -= nx * jn * a.invM; a.vel.y -= ny * jn * a.invM; a.vel.z -= nz * jn * a.invM;
          b.vel.x += nx * jn * b.invM; b.vel.y += ny * jn * b.invM; b.vel.z += nz * jn * b.invM;
          a.sleep = b.sleep = 0;
          if (rv < -1.5) events.push({ type: 'propBump', kind: a.K.sound, intensity: Math.min(1, -rv / 8), x: a.pos.x, z: a.pos.z });
        }
      }
    }

    // prop-car collisions (sphere vs oriented box)
    const b = CAR.box;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      if (dx * dx + dz * dz > 16) continue;
      sub(rel, p.pos, car.pos);
      mulMatT(lp, car.R, rel);
      const cx = Math.max(b.minX, Math.min(b.maxX, lp.x));
      const cy = Math.max(b.minY, Math.min(b.maxY, lp.y));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, lp.z));
      let ox = lp.x - cx, oy = lp.y - cy, oz = lp.z - cz;
      let d = Math.hypot(ox, oy, oz);
      let pen;
      if (d > 1e-5) {
        if (d >= p.r) continue;
        ox /= d; oy /= d; oz /= d; pen = p.r - d;
      } else {
        // inside: push out along the nearest face
        const fx = Math.min(lp.x - b.minX, b.maxX - lp.x);
        const fy = Math.min(lp.y - b.minY, b.maxY - lp.y);
        const fz = Math.min(lp.z - b.minZ, b.maxZ - lp.z);
        ox = oy = oz = 0;
        if (fx <= fy && fx <= fz) { ox = lp.x - b.minX < b.maxX - lp.x ? -1 : 1; pen = fx + p.r; }
        else if (fy <= fz) { oy = lp.y - b.minY < b.maxY - lp.y ? -1 : 1; pen = fy + p.r; }
        else { oz = lp.z - b.minZ < b.maxZ - lp.z ? -1 : 1; pen = fz + p.r; }
      }
      set(tmp, ox, oy, oz);
      mulMat(wn, car.R, tmp);           // world normal, car -> prop
      set(tmp, cx, cy, cz);
      mulMat(cp, car.R, tmp); cp.x += car.pos.x; cp.y += car.pos.y; cp.z += car.pos.z; // contact point
      // separate (prop takes nearly all of it)
      const carShare = Math.min(0.5, p.m / (p.m + CAR.mass) * 3);
      addScaled(p.pos, wn, pen * (1 - carShare));
      addScaled(car.pos, wn, -pen * carShare);
      car.velocityAt(vc, cp);
      const rv = (p.vel.x - vc.x) * wn.x + (p.vel.y - vc.y) * wn.y + (p.vel.z - vc.z) * wn.z;
      if (rv < 0) {
        const e = p.K.rest;
        const kCar = car.invMassAt(cp, wn);
        const jn = (-(1 + e) * rv) / (p.invM + kCar);
        addScaled(p.vel, wn, jn * p.invM);
        // a little upward kick makes bumps read better
        p.vel.y += Math.min(4, jn * p.invM * 0.18);
        scale(imp, wn, -jn);
        car.applyImpulseAt(imp, cp);
        // spin from tangential velocity
        const tx = vc.x - p.vel.x, tz = vc.z - p.vel.z;
        p.w.x += tz * 1.2 / p.r; p.w.z -= tx * 1.2 / p.r; p.w.y += (Math.random() - 0.5) * 6;
        p.sleep = 0;
        if (-rv > 0.8 && (car.time || 0) - p.lastHit > 0.15) {
          p.lastHit = car.time || 0;
          events.push({ type: 'carHit', kind: p.K.sound, prop: p, intensity: Math.min(1, -rv / 9), x: p.pos.x, z: p.pos.z });
        }
      }
    }
  };

  return P;
}
