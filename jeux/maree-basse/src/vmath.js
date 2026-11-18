// Minimal allocation-free 3D math for the physics (plain objects {x,y,z} / {x,y,z,w}).

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const q4 = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

export function set(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; }
export function copy(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }
export function add(o, a, b) { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; }
export function sub(o, a, b) { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; }
export function scale(o, a, s) { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; }
export function addScaled(o, a, s) { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o; }
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export function cross(o, a, b) {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  o.x = x; o.y = y; o.z = z; return o;
}
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export function normalize(o, a = o) {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o;
}

// Rotation matrix (row-major 3x3 in a Float64Array(9)) from quaternion.
export function quatToMat(m, q) {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = 1 - (yy + zz); m[1] = xy - wz; m[2] = xz + wy;
  m[3] = xy + wz; m[4] = 1 - (xx + zz); m[5] = yz - wx;
  m[6] = xz - wy; m[7] = yz + wx; m[8] = 1 - (xx + yy);
  return m;
}
// o = M * a
export function mulMat(o, m, a) {
  const x = m[0] * a.x + m[1] * a.y + m[2] * a.z;
  const y = m[3] * a.x + m[4] * a.y + m[5] * a.z;
  const z = m[6] * a.x + m[7] * a.y + m[8] * a.z;
  o.x = x; o.y = y; o.z = z; return o;
}
// o = M^T * a
export function mulMatT(o, m, a) {
  const x = m[0] * a.x + m[3] * a.y + m[6] * a.z;
  const y = m[1] * a.x + m[4] * a.y + m[7] * a.z;
  const z = m[2] * a.x + m[5] * a.y + m[8] * a.z;
  o.x = x; o.y = y; o.z = z; return o;
}
// q += 0.5 * (w,0) * q * dt ; normalize
export function integrateQuat(q, w, dt) {
  const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
  const { x, y, z } = q, qw = q.w;
  q.x += hx * qw + hy * z - hz * y;
  q.y += hy * qw + hz * x - hx * z;
  q.z += hz * qw + hx * y - hy * x;
  q.w += -hx * x - hy * y - hz * z;
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= l; q.y /= l; q.z /= l; q.w /= l;
  return q;
}
export function quatFromAxisAngle(q, ax, ay, az, ang) {
  const s = Math.sin(ang / 2);
  q.x = ax * s; q.y = ay * s; q.z = az * s; q.w = Math.cos(ang / 2); return q;
}
export const isFiniteV = (a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
