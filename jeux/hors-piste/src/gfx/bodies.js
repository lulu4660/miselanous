// Procedural low-poly car bodies (shell / glass / lights / brake overlay) for the four vehicles.
// Body frame: origin = centre of mass, +z forward, +y up, +x = car LEFT. Wheels, tyres, shocks and the
// antenna mesh are added elsewhere; the bodies only leave room for them (arches / open stance).
import * as THREE from 'three';
import { colorize, colorizeFn, place, merge, softBox, profileExtrude } from './geo.js';
import { VEHICLES } from '../vehicles.js';

const TRIM = '#35303b', DARK = '#2a2630', GLASS = '#283544', CHROME = '#b9b4bd';
const HEAD = '#fff1c7', IND = '#ffb347', TAIL = '#ff4a3d';

const shade = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();
const mixc = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// wheel rest centres (suspension compressed ~30% at rest) + radius, +x = left
function wheelsOf(id) {
  const s = VEHICLES[id];
  return s.wheels.map((w) => ({ x: w.x, y: w.y - s.restLength * 0.7, z: w.z, r: w.radius, front: w.front }));
}

// Small collector: add(geo, colour|fn, transform) -> merged geometry
class Part {
  constructor() { this.list = []; this.warp = null; }
  add(g, color, t) {
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (t) place(g, t);
    if (this.warp) g = warpX(g, this.warp);
    if (typeof color === 'function') colorizeFn(g, color); else colorize(g, color);
    this.list.push(g);
    return g;
  }
  box(w, h, d, r, color, t, seg = 1) { return this.add(r > 0 ? softBox(w, h, d, r, seg) : new THREE.BoxGeometry(w, h, d), color, t); }
  cyl(rt, rb, h, seg, axis, color, t) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    return this.add(g, color, t);
  }
  tube(a, b, r, color, seg = 5) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A); const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return this.add(g, color);
  }
  poly(pts, w, bev, color, t) { return this.add(profileExtrude(pts, w, bev), color, t); }
  geo() { if (globalThis.__DBG) console.log(this.list.map((g) => (g.index ? g.index.count : g.attributes.position.count) / 3).join(",")); return merge(this.list); }
}

// polyline tube through several points
function tubePath(P, pts, r, color) { for (let i = 0; i < pts.length - 1; i++) P.tube(pts[i], pts[i + 1], r, color); }

// Body side profile with wheel-arch notches cut out of the bottom edge.
// top: polyline rear-bottom -> over the top -> front-bottom (both at y = yb); arches: [{z,y,r}]
function notchedProfile(top, yb, arches, steps = 8) {
  const pts = top.slice();
  arches.slice().sort((a, b) => b.z - a.z).forEach((a) => {
    const t0 = Math.asin(Math.max(-1, Math.min(1, (yb - a.y) / a.r)));
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (Math.PI - 2 * t0) * (i / steps);
      pts.push([a.z + a.r * Math.cos(t), a.y + a.r * Math.sin(t)]);
    }
  });
  return pts;
}

// half-ring (arch) extruded across x in [x0,x1]
function archRing(zc, yc, x0, x1, rin, rout, bev = 0.012) {
  const soft = bev > 0;
  const s = new THREE.Shape();
  s.absarc(0, 0, rout, 0, Math.PI, false);
  s.absarc(0, 0, rin, Math.PI, 0, true);
  const d = x1 - x0 - 2 * bev;
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: soft, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 6 });
  g.deleteAttribute('uv');
  g.translate(0, 0, -d / 2);
  g.rotateY(Math.PI / 2);
  place(g, { x: (x0 + x1) / 2, y: yc, z: zc });
  return g;
}

// Dark liner (one per axle, full width) + flared lip around each wheel (mirrored for -x wheels).
function addArches(P, W, opt) {
  const seen = new Set();
  for (const w of W) {
    const key = w.z.toFixed(2);
    const { bodyHalf, lipTop = 0.12, liner = 0.07, lipOuter = 0.11, color = TRIM, lipColor = color } = opt;
    if (!seen.has(key)) {
      seen.add(key);
      P.add(archRing(w.z, w.y, -bodyHalf - 0.01, bodyHalf + 0.01, w.r + 0.04, w.r + liner + 0.01, 0), color);
    }
    const ax = Math.abs(w.x), s = Math.sign(w.x);
    const x0 = bodyHalf - 0.09, x1 = ax + lipOuter;
    const g = s > 0 ? archRing(w.z, w.y, x0, x1, w.r + 0.04, w.r + lipTop + 0.02, 0) : archRing(w.z, w.y, -x1, -x0, w.r + 0.04, w.r + lipTop + 0.02, 0);
    P.add(g, lipColor);
  }
}

// thin glass slab hugging an inclined cabin edge p0 -> p1 (profile coords [z,y]); `out` = outward hint
function slab(p0, p1, halfW, off, thick, out, shrink = 0.08) {
  let d = [p1[0] - p0[0], p1[1] - p0[1]]; const len = Math.hypot(d[0], d[1]); d = [d[0] / len, d[1] / len];
  let n = [-d[1], d[0]]; if (n[0] * out[0] + n[1] * out[1] < 0) n = [d[1], -d[0]];
  const a = [p0[0] + d[0] * shrink, p0[1] + d[1] * shrink], b = [p1[0] - d[0] * shrink, p1[1] - d[1] * shrink];
  const q = (p, o) => [p[0] + n[0] * o, p[1] + n[1] * o];
  return profileExtrude([q(a, off), q(b, off), q(b, off + thick), q(a, off + thick)], halfW * 2, 0.008);
}
// side window pane on both flanks
function sidePane(G, pts, halfX) {
  for (const s of [-1, 1]) G.add(profileExtrude(pts, 0.03, 0.008), GLASS, { x: s * (halfX - 0.003) });
}
const mirrorXs = [-1, 1];
// Move vertices in x by a factor f(x,y,z) (plan taper / tumblehome), flat normals recomputed. Non-indexed result.
function warpX(g, f) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setX(i, x * f(x, p.getY(i), p.getZ(i))); }
  g.computeVertexNormals();
  return g;
}
const lin = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));

// 7-segment race number on a vertical side plane (readable from outside) or on a front/back plane.
const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
// side = +-1 (x plane at `x`), or plane 'z' with sgn (+1 front facing +z, -1 rear). (x,y,z) = centre, h = height.
function digit(P, ch, plane, sgn, x, y, z, h, color) {
  const w = h * 0.52, t = h * 0.15, th = 0.012;
  const seg = { a: [0, h / 2 - t / 2, w, t], d: [0, -h / 2 + t / 2, w, t], g: [0, 0, w, t],
    b: [w / 2 - t / 2, h / 4, t, h / 2], c: [w / 2 - t / 2, -h / 4, t, h / 2], f: [-w / 2 + t / 2, h / 4, t, h / 2], e: [-w / 2 + t / 2, -h / 4, t, h / 2] };
  for (const k of SEG7[ch]) {
    const [u, v, sw, sh] = seg[k];
    if (plane === 'x') P.add(new THREE.BoxGeometry(th, sh, sw), color, { x, y: y + v, z: z - sgn * u });
    else P.add(new THREE.BoxGeometry(sw, sh, th), color, { x: x + sgn * u, y: y + v, z });
  }
}
// round race roundel + number on both doors
function roundel(P, ch, x, y, z, r, ring, face, ink) {
  // the number must read on any livery: a dark face gets a cream digit, a light one a dark digit
  const lum = (h) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  if (Math.abs(lum(face) - lum(ink)) < 0.3) ink = lum(face) < 0.4 ? '#f0dcc4' : '#2a2630';
  for (const s of mirrorXs) {
    P.cyl(r, r, 0.016, 12, 'x', ring, { x: s * x, y, z });
    P.cyl(r * 0.8, r * 0.8, 0.016, 12, 'x', face, { x: s * (x + 0.008), y, z });
    digit(P, ch, 'x', s, s * (x + 0.02), y, z, r * 1.0, ink);
  }
}
// round lamp: dark housing + bright lens (lens goes to the unlit light mesh)
function lamp(S, Li, x, y, z, r, rx = 0, sx = 1, lens = HEAD, dir = 1) {
  S.cyl(r * 1.25, r * 1.25, 0.05, 10, 'z', TRIM, { x, y, z, rx, sx });
  Li.cyl(r, r, 0.03, 10, 'z', lens, { x, y, z: z + dir * 0.025, rx, sx });
}


// ---------------------------------------------------------------------------------------------
// Cabri: compact rally hatch. Body-colour flared arches, tapered nose, tumblehome cabin, light pod, race roundels.
function buildCabri(L) {
  const S = new Part(), G = new Part(), Li = new Part(), Br = new Part();
  const W = wheelsOf('cabri');
  const bev = 0.07, yb = -0.24, half = 0.81;
  const arches = W.map((w) => ({ z: w.z, y: w.y, r: w.r + 0.07 + bev }));
  const nose = (x, y, z) => 1 - 0.12 * lin(1.55, 1.97, z) - 0.08 * lin(-1.5, -1.94, z);
  const tumble = (x, y) => 1 - 0.1 * lin(0.46, 0.86, y);
  const top = [[-1.84, yb], [-1.91, 0.0], [-1.91, 0.36], [-1.75, 0.48], [0.98, 0.48], [1.8, 0.44], [1.92, 0.34], [1.95, 0.1], [1.88, yb]];
  S.warp = nose;
  S.poly(notchedProfile(top, yb, arches), half * 2, bev, L.primary);
  S.warp = null;
  addArches(S, W, { bodyHalf: half, lipTop: 0.14, liner: 0.07, lipColor: shade(L.primary, 0.92) });
  // cabin + secondary roof (tumblehome)
  const cb = 0.06;
  S.warp = tumble; G.warp = tumble;
  S.poly([[1.08, 0.46], [0.56, 0.85], [-1.15, 0.85], [-1.64, 0.5], [-1.64, 0.46]], 1.5, cb, L.primary);
  S.poly([[0.55, 0.852], [-1.17, 0.852], [-1.25, 0.76], [0.6, 0.76]], 1.5, cb, L.secondary);
  // roof vent + rear spoiler with end plates
  S.poly([[0.3, 0.86], [0.3, 0.92], [0.2, 0.94], [-0.2, 0.9], [-0.2, 0.86]], 0.46, 0.02, TRIM);
  S.box(1.3, 0.035, 0.22, 0, L.secondary, { z: -1.27, y: 0.88, rx: 0.12 });
  for (const s of mirrorXs) S.box(0.025, 0.1, 0.24, 0, L.secondary, { x: s * 0.66, y: 0.88, z: -1.27 });
  S.warp = null;
  // undertray, sills, bumpers
  S.box(1.36, 0.1, 3.5, 0.04, DARK, { y: -0.26 }, 1);
  for (const s of mirrorXs) S.box(0.05, 0.1, 1.35, 0.02, TRIM, { x: s * 0.815, y: -0.15, z: 0.02 }, 1);
  S.box(1.6, 0.2, 0.2, 0.07, TRIM, { y: -0.08, z: 1.88 }, 1);
  S.box(1.4, 0.04, 0.24, 0, DARK, { y: -0.19, z: 1.93 });          // splitter
  S.box(1.58, 0.2, 0.18, 0.06, TRIM, { y: -0.1, z: -1.87 }, 1);
  S.box(0.8, 0.1, 0.04, 0.02, DARK, { y: 0.22, z: 1.99 });           // grille
  for (const y of [0.19, 0.22, 0.25]) S.box(0.74, 0.012, 0.02, 0, shade(L.primary, 0.9), { y, z: 2.012 });
  S.cyl(0.035, 0.035, 0.16, 8, 'z', CHROME, { x: -0.5, y: -0.2, z: -1.95 });
  // tow hooks (red loops)
  for (const s of mirrorXs) { S.box(0.07, 0.035, 0.1, 0, '#e8452c', { x: s * 0.62, y: -0.1, z: 2.0 }); S.box(0.07, 0.035, 0.1, 0, '#e8452c', { x: s * 0.62, y: -0.14, z: -1.99 }); }
  // livery: double stripe + roundels with race number
  for (const s of mirrorXs) {
    S.box(0.03, 0.07, 3.1, 0, L.accent, { x: s * 0.818, y: 0.345, z: 0.0 });
    S.box(0.03, 0.025, 3.1, 0, L.secondary, { x: s * 0.818, y: 0.275, z: 0.0 });
    S.box(0.012, 0.5, 0.02, 0, shade(L.primary, 0.7), { x: s * 0.812, y: 0.12, z: 0.66 });
    S.box(0.012, 0.5, 0.02, 0, shade(L.primary, 0.7), { x: s * 0.812, y: 0.12, z: -0.5 });
    S.box(0.05, 0.03, 0.16, 0.01, TRIM, { x: s * 0.83, y: 0.28, z: -0.38 });
    // mud flaps behind each wheel
    for (const w of W) if (Math.sign(w.x) === s) S.box(0.26, 0.3, 0.03, 0, TRIM, { x: s * 0.8, y: -0.3, z: w.z - w.r - (w.front ? 0.12 : 0.1) });
    // mirrors
    S.box(0.14, 0.03, 0.03, 0.01, TRIM, { x: s * 0.76, y: 0.58, z: 0.94 });
    S.box(0.05, 0.1, 0.15, 0.025, L.accent, { x: s * 0.85, y: 0.62, z: 0.94 });
  }
  roundel(S, '4', 0.818, 0.12, 0.04, 0.17, L.accent, L.secondary, DARK);
  // bonnet: accent stripes, vents, pins
  const bt = (z) => 0.55 - Math.max(0, z - 0.98) * 0.049; // bonnet top height
  for (const s of mirrorXs) S.box(0.12, 0.012, 0.7, 0, L.accent, { x: s * 0.13, y: 0.534, z: 1.26, rx: 0.05 });
  for (const s of mirrorXs) for (const z of [1.18, 1.3, 1.42]) S.box(0.3, 0.012, 0.03, 0, DARK, { x: s * 0.42, y: bt(z) + 0.004, z });
  for (const s of mirrorXs) for (const z of [1.1, 1.6]) S.cyl(0.018, 0.018, 0.035, 6, 'y', CHROME, { x: s * 0.62, y: bt(z) + 0.006, z });
  // front light pod: bar across the bonnet front + 4 round lamps
  S.box(1.4, 0.11, 0.14, 0.04, TRIM, { y: 0.575, z: 1.62 }, 1);
  for (const x of [-0.5, -0.2, 0.2, 0.5]) lamp(S, Li, x, 0.575, 1.7, 0.075);
  // nose headlights, indicators, tail lights
  for (const s of mirrorXs) {
    lamp(S, Li, s * 0.6, 0.3, 1.97, 0.085);
    Li.box(0.12, 0.05, 0.03, 0, IND, { x: s * 0.7, y: 0.0, z: 1.985 });
    S.box(0.26, 0.36, 0.05, 0.02, TRIM, { x: s * 0.62, y: 0.2, z: -1.985 });
    Li.box(0.2, 0.22, 0.03, 0, TAIL, { x: s * 0.62, y: 0.26, z: -2.01 });
    Li.box(0.2, 0.07, 0.03, 0, IND, { x: s * 0.62, y: 0.08, z: -2.01 });
    Br.box(0.22, 0.24, 0.02, 0, '#ff3b30', { x: s * 0.62, y: 0.26, z: -2.03 });
  }
  Li.box(0.1, 0.05, 0.03, 0, '#fff5d6', { x: 0.0, y: -0.03, z: -2.01 });
  // glass
  const gOff = cb - 0.012;
  G.add(slab([1.08, 0.46], [0.56, 0.85], 0.62, gOff, 0.022, [1, 1]), GLASS);
  G.add(slab([-1.15, 0.85], [-1.64, 0.5], 0.56, gOff, 0.022, [-1, 1], 0.1), GLASS);
  sidePane(G, [[0.8, 0.58], [0.6, 0.75], [-0.25, 0.77], [-0.25, 0.58]], 0.75);
  sidePane(G, [[-0.4, 0.58], [-0.4, 0.77], [-1.1, 0.77], [-1.42, 0.58]], 0.75);
  return { shell: S.geo(), glass: G.geo(), lights: Li.geo(), brake: Br.geo(), antenna: { x: 0.55, y: 0.95, z: -0.6 } };
}

// ---------------------------------------------------------------------------------------------
// Mistral: long low RWD coupe. Tapered nose with hood bulge + louvres, fastback, ducktail, full-width tail lights.
function buildMistral(L) {
  const S = new Part(), G = new Part(), Li = new Part(), Br = new Part();
  const W = wheelsOf('mistral');
  const bev = 0.06, yb = -0.16, half = 0.93;
  const arches = W.map((w) => ({ z: w.z, y: w.y, r: w.r + 0.06 + bev }));
  const ht = (z) => 0.46 - Math.max(0, z - 0.5) * 0.06; // hood top height
  const nose = (x, y, z) => 1 - 0.14 * lin(1.75, 2.22, z) - 0.07 * lin(-1.7, -2.14, z);
  const tumble = (x, y) => 1 - 0.1 * lin(0.42, 0.78, y);
  const top = [[-2.1, yb], [-2.16, 0.0], [-2.15, 0.3], [-2.0, 0.4], [0.5, 0.4], [2.0, 0.31], [2.17, 0.22], [2.22, 0.08], [2.16, -0.06], [2.1, yb]];
  S.warp = nose;
  S.poly(notchedProfile(top, yb, arches), half * 2, bev, L.primary);
  S.warp = null;
  addArches(S, W, { bodyHalf: half, lipTop: 0.12, liner: 0.06, lipOuter: 0.11, lipColor: shade(L.primary, 0.92) });
  // fastback cabin + roof
  const cb = 0.06;
  S.warp = tumble; G.warp = tumble;
  S.poly([[0.5, 0.42], [-0.02, 0.77], [-0.85, 0.77], [-1.6, 0.58], [-2.02, 0.42]], 1.52, cb, L.primary);
  S.poly([[-0.0, 0.772], [-0.88, 0.772], [-0.95, 0.7], [-0.0, 0.7]], 1.54, cb, L.secondary);
  S.warp = null;
  // wide rear haunches + fuel cap
  for (const s of mirrorXs) S.box(0.1, 0.16, 1.15, 0.05, L.primary, { x: s * 0.89, y: 0.33, z: -1.34 }, 1);
  S.cyl(0.07, 0.07, 0.02, 10, 'x', CHROME, { x: 0.945, y: 0.33, z: -1.55 });
  // ducktail spoiler with end plates
  S.box(1.6, 0.035, 0.26, 0, L.primary, { y: 0.47, z: -2.08, rx: 0.2 });
  for (const s of mirrorXs) { S.box(0.04, 0.1, 0.28, 0, TRIM, { x: s * 0.8, y: 0.5, z: -2.08 }); S.box(0.05, 0.08, 0.08, 0, TRIM, { x: s * 0.6, y: 0.41, z: -2.02 }); }
  // undertray, splitter, bumpers, grille, exhaust, diffuser
  S.box(1.4, 0.08, 4.2, 0.03, DARK, { y: -0.2 }, 1);
  S.box(1.84, 0.04, 0.36, 0.02, TRIM, { y: -0.2, z: 2.1 }, 1);
  S.box(1.84, 0.16, 0.12, 0.05, TRIM, { y: -0.08, z: -2.15 }, 1);
  S.box(0.9, 0.12, 0.05, 0.03, DARK, { y: 0.04, z: 2.275 });
  for (const x of [-0.14, 0, 0.14]) S.box(0.025, 0.1, 0.03, 0, L.accent, { x, y: 0.04, z: 2.305 });
  S.box(0.5, 0.07, 0.04, 0, DARK, { y: -0.08, z: 2.26 });                               // lower intake
  for (const x of [-0.42, 0, 0.42]) S.box(0.05, 0.1, 0.1, 0, DARK, { x, y: -0.13, z: -2.22 }); // diffuser fins
  S.box(0.3, 0.1, 0.02, 0, '#f4efe6', { y: 0.12, z: -2.235 });                          // plate
  for (const s of mirrorXs) {
    S.cyl(0.045, 0.045, 0.14, 8, 'z', CHROME, { x: s * 0.35, y: -0.1, z: -2.19 });
    // side vents behind the front wheel
    S.box(0.02, 0.13, 0.32, 0, DARK, { x: s * 0.935, y: 0.12, z: 0.76 });
    for (const dz of [-0.09, 0, 0.09]) S.box(0.03, 0.11, 0.025, 0, shade(L.primary, 0.85), { x: s * 0.94, y: 0.12, z: 0.76 + dz });
    // sill + pin lines
    S.box(0.04, 0.05, 1.7, 0, TRIM, { x: s * 0.94, y: -0.1, z: 0.05 });
    S.box(0.012, 0.03, 3.1, 0, L.accent, { x: s * 0.936, y: 0.34, z: -0.2 });
    // mirrors
    S.box(0.16, 0.03, 0.03, 0.01, TRIM, { x: s * 0.8, y: 0.55, z: 0.28 });
    S.box(0.05, 0.08, 0.15, 0.025, L.primary, { x: s * 0.88, y: 0.56, z: 0.27 });
    // headlights (round, raked) + fog lamps + indicators
    lamp(S, Li, s * 0.62, 0.15, 2.25, 0.095, -0.2, 1.4);
    lamp(S, Li, s * 0.3, -0.02, 2.26, 0.045, 0, 1, '#fff5d6');
    Li.box(0.12, 0.05, 0.03, 0, IND, { x: s * 0.86, y: 0.1, z: 2.17, ry: s * 0.5 });
    // tail: housing + two round lamps + indicator strip
    S.box(0.5, 0.15, 0.05, 0.02, TRIM, { x: s * 0.56, y: 0.2, z: -2.22 });
    for (const x of [0.4, 0.68]) { Li.cyl(0.055, 0.055, 0.03, 10, 'z', TAIL, { x: s * x, y: 0.2, z: -2.245 }); Br.cyl(0.07, 0.07, 0.02, 10, 'z', '#ff3b30', { x: s * x, y: 0.2, z: -2.265 }); }
    Li.box(0.2, 0.03, 0.03, 0, IND, { x: s * 0.54, y: 0.2, z: -2.245 });
    // front louvres on the hood sides
    for (let k = 0; k < 4; k++) { const z = 1.02 + k * 0.1; S.box(0.22, 0.012, 0.03, 0, DARK, { x: s * 0.42, y: ht(z) + 0.004, z }); }
    // hood pins
    for (const z of [0.85, 1.8]) S.cyl(0.018, 0.018, 0.035, 6, 'y', CHROME, { x: s * 0.62, y: ht(z) + 0.008, z });
  }
  Li.box(0.2, 0.03, 0.03, 0, '#fff5d6', { y: 0.12, z: -2.25 });
  roundel(S, '7', 0.936, 0.08, 0.3, 0.17, L.accent, L.accent, L.primary);
  // hood power-bulge, double stripes
  S.poly([[0.55, 0.455], [0.75, 0.445], [1.75, 0.385], [1.85, 0.375], [0.55, 0.33]], 0.5, 0.025, L.primary);
  for (const s of mirrorXs) S.box(0.11, 0.012, 1.1, 0, L.secondary, { x: s * 0.2, y: 0.45, z: 1.2, rx: 0.058 });
  // glass
  const gOff = cb - 0.012;
  G.add(slab([0.5, 0.42], [-0.02, 0.77], 0.64, gOff, 0.022, [1, 1]), GLASS);
  G.add(slab([-0.85, 0.77], [-1.6, 0.58], 0.58, gOff, 0.022, [-0.3, 1], 0.12), GLASS);
  sidePane(G, [[0.2, 0.53], [-0.04, 0.69], [-0.8, 0.7], [-1.35, 0.575], [-1.5, 0.53]], 0.76);
  return { shell: S.geo(), glass: G.geo(), lights: Li.geo(), brake: Br.geo(), antenna: { x: 0.35, y: 0.7, z: -1.2 } };
}
// ---------------------------------------------------------------------------------------------
// Bison: boxy expedition 4x4: bull bar, snorkel, roof rack with surfboard / jerry can, spare wheel, body-side stripe.
function bisonSurfboard(accent) {
  const g = new THREE.SphereGeometry(1, 12, 6);
  g.scale(0.3, 0.05, 1.18);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const taper = z > 0 ? 1 - Math.pow(z / 1.18, 2.4) * 0.55 : 1 - Math.pow(-z / 1.18, 3) * 0.3;
    p.setX(i, p.getX(i) * taper);
  }
  g.computeVertexNormals();
  colorizeFn(g, (x, y, z) => (Math.abs(x) < 0.035 && y > 0 ? '#ffcf5c' : Math.abs(z - 0.25) < 0.06 ? '#ffffff' : accent));
  return g;
}

function buildBison(L) {
  const S = new Part(), G = new Part(), Li = new Part(), Br = new Part();
  const W = wheelsOf('bison');
  const nose = (x, y, z) => 1 - 0.06 * lin(1.7, 2.2, z) - 0.04 * lin(-1.7, -2.18, z);
  const tumble = (x, y) => 1 - 0.07 * lin(0.5, 1.2, y);
  S.warp = nose;
  S.poly([[-2.02, -0.2], [2.0, -0.2], [2.12, 0.02], [2.1, 0.33], [1.92, 0.45], [0.95, 0.5], [-1.9, 0.48], [-2.06, 0.36], [-2.1, 0.02]], 1.56, 0.09, L.primary);
  S.warp = tumble; G.warp = tumble;
  S.poly([[0.95, 0.44], [0.45, 1.14], [-1.82, 1.16], [-1.96, 1.0], [-1.98, 0.44]], 1.46, 0.08, L.secondary);
  S.warp = null;
  // fender flares, centred on each wheel (body-colour-dark, chunky)
  for (const w of W) S.add(archRing(w.z, w.y + 0.07, w.x > 0 ? 0.68 : -1.04, w.x > 0 ? 1.04 : -0.68, 0.53, 0.66, 0), TRIM);
  S.box(1.24, 0.22, 3.7, 0.05, DARK, { y: -0.3 }, 1);
  for (const s of mirrorXs) S.box(0.12, 0.08, 1.2, 0, TRIM, { x: s * 0.84, y: -0.2, z: 0.05 });   // side steps
  // bumpers + bull bar + winch
  S.box(1.86, 0.26, 0.3, 0.07, TRIM, { y: -0.08, z: 2.17 }, 1);
  S.box(1.8, 0.24, 0.26, 0.07, TRIM, { y: -0.06, z: -2.15 }, 1);
  S.box(0.4, 0.14, 0.14, 0, '#4a4450', { y: -0.02, z: 2.36 });
  S.cyl(0.04, 0.04, 0.1, 8, 'z', '#e8c55a', { y: -0.02, z: 2.45 });
  for (const s of mirrorXs) {
    S.tube([s * 0.55, -0.1, 2.3], [s * 0.55, 0.42, 2.26], 0.03, CHROME);
    S.tube([s * 0.55, 0.42, 2.26], [s * 0.1, 0.46, 2.26], 0.028, CHROME);
    const hk = new THREE.TorusGeometry(0.06, 0.02, 5, 8); S.add(hk, '#e8452c', { x: s * 0.72, y: -0.14, z: 2.34, ry: Math.PI / 2 });
  }
  S.tube([-0.55, 0.0, 2.3], [0.55, 0.0, 2.3], 0.03, CHROME);
  // grille with bars, round lamps, hood scoop + stripes
  S.box(0.82, 0.24, 0.05, 0, '#3d3843', { y: 0.2, z: 2.21 });
  for (let k = -2; k <= 2; k++) S.box(0.05, 0.2, 0.04, 0, L.secondary, { x: k * 0.15, y: 0.2, z: 2.24 });
  for (const s of mirrorXs) lamp(S, Li, s * 0.62, 0.22, 2.2, 0.12);
  for (const s of mirrorXs) {
    Li.box(0.14, 0.05, 0.03, 0, IND, { x: s * 0.62, y: -0.0, z: 2.22 });
    S.box(0.1, 0.012, 1.0, 0, L.accent, { x: s * 0.25, y: 0.568, z: 1.45, rx: 0.052 });
  }
  S.box(0.5, 0.05, 0.4, 0.02, DARK, { y: 0.58, z: 1.25 });
  for (const z of [1.15, 1.25, 1.35]) S.box(0.42, 0.012, 0.03, 0, shade(L.primary, 0.8), { y: 0.61, z });
  // mirrors, snorkel
  for (const s of mirrorXs) {
    S.box(0.18, 0.04, 0.04, 0, TRIM, { x: s * 0.76, y: 0.64, z: 0.82 });
    S.box(0.06, 0.16, 0.22, 0, TRIM, { x: s * 0.9, y: 0.68, z: 0.8 });
  }
  S.cyl(0.05, 0.055, 0.95, 8, 'y', TRIM, { x: -0.8, y: 0.78, z: 0.98 });
  S.box(0.16, 0.12, 0.2, 0, TRIM, { x: -0.8, y: 1.28, z: 0.98 });
  // roof rack with surfboard, jerry can, roll bag
  for (const s of mirrorXs) S.box(0.06, 0.06, 2.3, 0, TRIM, { x: s * 0.62, y: 1.32, z: -0.7 });
  for (const z of [-1.7, -1.0, -0.3, 0.35]) S.box(1.3, 0.05, 0.06, 0, TRIM, { y: 1.3, z });
  for (const s of mirrorXs) for (const z of [-1.7, 0.35]) S.box(0.06, 0.14, 0.06, 0, TRIM, { x: s * 0.62, y: 1.25, z });
  S.list.push(place(bisonSurfboard(L.accent), { x: 0.22, y: 1.4, z: -0.55, rz: 0.06 }));
  S.box(0.26, 0.36, 0.44, 0.03, '#6f7e3f', { x: -0.42, y: 1.52, z: -1.35 }, 1);
  S.cyl(0.04, 0.04, 0.06, 6, 'y', '#e8c55a', { x: -0.42, y: 1.73, z: -1.2 });
  S.cyl(0.15, 0.15, 0.62, 10, 'x', '#e6a83b', { x: -0.36, y: 1.47, z: -0.25 });
  for (const dx of [-0.2, 0.2]) { const strap = new THREE.TorusGeometry(0.155, 0.015, 4, 10); strap.rotateY(Math.PI / 2); S.add(strap, '#6b4a2f', { x: -0.36 + dx, y: 1.47, z: -0.25 }); }
  // roof lamp bar
  S.box(0.9, 0.08, 0.1, 0, TRIM, { y: 1.3, z: 0.62 });
  for (let k = 0; k < 4; k++) Li.cyl(0.06, 0.06, 0.04, 8, 'z', '#fff5d6', { x: -0.33 + k * 0.22, y: 1.3, z: 0.69 });
  // livery: side stripe, door roundel with number, mud flaps, door seams
  for (const s of mirrorXs) {
    S.box(0.012, 0.045, 3.8, 0, L.accent, { x: s * 0.783, y: 0.37 });
    S.box(0.012, 0.62, 0.02, 0, shade(L.primary, 0.8), { x: s * 0.785, y: 0.12, z: -0.5 });
    S.box(0.012, 0.62, 0.02, 0, shade(L.primary, 0.8), { x: s * 0.785, y: 0.12, z: 0.55 });
    S.box(0.03, 0.04, 0.16, 0, TRIM, { x: s * 0.79, y: 0.3, z: -0.3 });
    for (const w of W) if (Math.sign(w.x) === s) S.box(0.3, 0.34, 0.03, 0, TRIM, { x: s * 0.95, y: -0.32, z: w.z - w.r - 0.12 });
  }
  roundel(S, '3', 0.785, 0.08, 0.03, 0.2, L.accent, L.secondary, DARK);
  // spare wheel on the tailgate
  const sp = new THREE.LatheGeometry([[0.2, -0.1], [0.34, -0.115], [0.42, -0.07], [0.43, 0.07], [0.34, 0.115], [0.2, 0.1]].map(([r, a]) => new THREE.Vector2(r, a)), 12);
  sp.rotateX(Math.PI / 2);
  S.add(sp, '#4a4252', { y: 0.46, z: -2.3 });
  S.cyl(0.25, 0.25, 0.1, 12, 'z', L.accent, { y: 0.46, z: -2.38 });
  S.cyl(0.1, 0.11, 0.12, 8, 'z', TRIM, { y: 0.46, z: -2.43 });
  // tail lamps
  for (const s of mirrorXs) {
    S.box(0.2, 0.34, 0.05, 0.015, TRIM, { x: s * 0.7, y: 0.26, z: -2.19 }, 1);
    Li.box(0.14, 0.24, 0.03, 0, TAIL, { x: s * 0.7, y: 0.28, z: -2.22 });
    Li.box(0.14, 0.05, 0.03, 0, IND, { x: s * 0.7, y: 0.08, z: -2.22 });
    Br.box(0.17, 0.27, 0.02, 0, '#ff3b30', { x: s * 0.7, y: 0.28, z: -2.24 });
  }
  // glass
  for (const s of mirrorXs) {
    const fw = profileExtrude([[0.78, 0.56], [0.44, 1.04], [-0.42, 1.04], [-0.42, 0.56]], 0.05, 0.015); place(fw, { x: s * 0.715 }); G.add(fw, GLASS);
    const rw = profileExtrude([[-0.58, 0.56], [-0.58, 1.04], [-1.72, 1.04], [-1.8, 0.92], [-1.8, 0.56]], 0.05, 0.015); place(rw, { x: s * 0.715 }); G.add(rw, GLASS);
  }
  G.add(profileExtrude([[0.9, 0.54], [0.5, 1.08], [0.46, 1.08], [0.86, 0.54]], 1.24, 0.02), GLASS, { y: 0.0, z: 0.03 });
  G.box(1.1, 0.42, 0.04, 0, GLASS, { y: 0.8, z: -2.07 });
  return { shell: S.geo(), glass: G.geo(), lights: Li.geo(), brake: Br.geo(), antenna: { x: 0.62, y: 1.12, z: -1.8 } };
}

// ---------------------------------------------------------------------------------------------
// Criquet: light buggy with a tube roll cage, body-colour fenders, race-number plates, seat + harness.
function buildCriquet(L) {
  const S = new Part(), G = new Part(), Li = new Part(), Br = new Part();
  const W = wheelsOf('criquet');
  const cage = L.secondary, tubeR = 0.026;
  const tubeP = (a, b, r, c) => S.tube(a, b, r, c, 6);
  // floor pan + rails
  S.box(0.84, 0.08, 2.5, 0.03, DARK, { y: -0.14, z: 0.05 }, 1);
  for (const s of mirrorXs) tubePath(S, [[s * 0.36, -0.06, -1.45], [s * 0.36, -0.06, 1.5]], 0.03, cage);
  S.box(0.7, 0.04, 0.5, 0, '#6d6a75', { y: -0.2, z: 1.3 });                                    // skid plate
  // nose panel, side pods, rear cowl
  S.poly([[0.5, -0.05], [1.72, -0.1], [1.78, 0.05], [1.7, 0.26], [1.2, 0.4], [0.55, 0.5], [0.5, 0.4]], 0.86, 0.06, L.primary);
  for (const s of mirrorXs) S.poly([[0.45, -0.08], [0.5, 0.22], [-0.1, 0.3], [-0.7, 0.24], [-0.75, -0.08]], 0.16, 0.05, L.primary, { x: s * 0.52 });
  S.poly([[-0.95, -0.08], [-1.68, -0.08], [-1.68, 0.5], [-1.55, 0.58], [-1.35, 0.53], [-1.35, 0.06], [-0.95, 0.06]], 0.8, 0.05, L.primary);
  // fenders (half rings over the wheels, body colour) and mud flaps
  for (const w of W) {
    const ax = Math.abs(w.x), s = Math.sign(w.x);
    const x0 = ax - 0.2, x1 = ax + 0.18;
    S.add(s > 0 ? archRing(w.z, w.y + 0.03, x0, x1, w.r + 0.07, w.r + 0.12, 0) : archRing(w.z, w.y + 0.03, -x1, -x0, w.r + 0.07, w.r + 0.12, 0), shade(L.primary, 0.95));
    S.box(0.3, 0.26, 0.03, 0, TRIM, { x: w.x, y: w.y - 0.18, z: w.z - w.r - 0.1 });
  }
  // bumper tube + bull bar, tow loops
  tubePath(S, [[-0.4, 0.06, 1.55], [-0.4, -0.08, 1.8], [0.4, -0.08, 1.8], [0.4, 0.06, 1.55]], 0.03, cage);
  tubePath(S, [[-0.4, -0.08, 1.8], [-0.4, 0.3, 1.82]], 0.026, cage);
  tubePath(S, [[0.4, -0.08, 1.8], [0.4, 0.3, 1.82]], 0.026, cage);
  tubePath(S, [[-0.4, 0.3, 1.82], [0.4, 0.3, 1.82]], 0.026, cage);
  // roll cage
  for (const s of mirrorXs) {
    tubeP([s * 0.4, 0.1, -0.5], [s * 0.37, 1.02, -0.46], tubeR, cage);
    tubePath(S, [[s * 0.42, 0.3, 0.55], [s * 0.35, 1.02, 0.05], [s * 0.37, 1.02, -0.46], [s * 0.3, 0.42, -1.5]], tubeR, cage);
    tubeP([s * 0.42, 0.62, 0.45], [s * 0.4, 0.62, -0.5], tubeR, cage);
    tubeP([s * 0.4, 0.1, -0.5], [s * 0.3, 0.1, -1.55], tubeR, cage);
    tubeP([s * 0.3, 0.42, -1.5], [s * 0.3, 0.05, -1.52], tubeR, cage);
  }
  tubeP([-0.37, 1.02, -0.46], [0.37, 1.02, -0.46], tubeR, cage);
  tubeP([-0.35, 1.02, 0.05], [0.35, 1.02, 0.05], tubeR, cage);
  tubeP([-0.4, 0.2, -0.5], [0.37, 0.95, -0.46], tubeR * 0.8, cage);
  tubeP([-0.3, 0.42, -1.5], [0.3, 0.42, -1.5], tubeR, cage);
  // roof lamp bar on the front hoop
  S.box(0.6, 0.07, 0.08, 0.02, TRIM, { y: 1.08, z: 0.08 });
  for (const x of [-0.2, -0.067, 0.067, 0.2]) Li.cyl(0.05, 0.05, 0.03, 8, 'z', '#fff5d6', { x, y: 1.08, z: 0.13 });
  // seat, harness, steering
  S.box(0.42, 0.1, 0.44, 0.03, TRIM, { y: 0.1, z: -0.15 }, 1);
  S.box(0.42, 0.52, 0.1, 0.03, TRIM, { y: 0.4, z: -0.36, rx: -0.15 }, 1);
  S.box(0.14, 0.34, 0.02, 0, L.accent, { y: 0.4, z: -0.305, rx: -0.15 });
  for (const x of [-0.14, 0.14]) S.box(0.05, 0.5, 0.02, 0, L.accent, { x, y: 0.52, z: -0.29, rx: -0.15 });  // belts
  S.box(0.3, 0.14, 0.08, 0.03, TRIM, { y: 0.74, z: -0.4, rx: -0.15 }, 1);
  tubePath(S, [[0, 0.48, 0.5], [0, 0.66, 0.22]], 0.02, DARK);
  { const sw = new THREE.TorusGeometry(0.14, 0.02, 5, 12); S.add(sw, L.accent, { y: 0.68, z: 0.2, rx: -1.0 }); }
  // engine block, heads, fins, exhausts
  S.box(0.5, 0.34, 0.5, 0.03, '#6d6a75', { y: 0.24, z: -1.1 }, 1);
  for (const s of mirrorXs) {
    S.cyl(0.1, 0.1, 0.26, 8, 'x', '#55525d', { x: s * 0.36, y: 0.24, z: -1.1 });
    for (const dx of [0.07, 0.12, 0.17]) S.cyl(0.125, 0.125, 0.018, 8, 'x', '#7b7885', { x: s * (0.36 + dx), y: 0.24, z: -1.1 });
    tubePath(S, [[s * 0.4, 0.1, -1.0], [s * 0.42, -0.02, -1.3], [s * 0.2, 0.0, -1.7]], 0.032, CHROME);
    S.cyl(0.045, 0.045, 0.16, 8, 'z', CHROME, { x: s * 0.2, y: 0.0, z: -1.74 });
  }
  S.cyl(0.1, 0.1, 0.12, 8, 'y', L.accent, { y: 0.49, z: -1.05 });
  // small rear wing on the cowl
  S.box(0.9, 0.03, 0.22, 0, L.accent, { y: 0.74, z: -1.7, rx: 0.15 });
  for (const s of mirrorXs) S.box(0.03, 0.16, 0.12, 0, TRIM, { x: s * 0.3, y: 0.64, z: -1.66 });
  // race numbers: nose plate (front) + side-pod roundels
  S.box(0.36, 0.28, 0.02, 0, L.secondary === '#2b2730' ? '#f4efe6' : '#f4efe6', { y: 0.1, z: 1.85 });
  digit(S, '1', 'z', 1, 0, 0.1, 1.862, 0.22, DARK);
  roundel(S, '1', 0.6, 0.1, -0.22, 0.12, L.accent, '#f4efe6', DARK);
  // rear light bar housing
  S.box(0.96, 0.09, 0.06, 0.02, TRIM, { y: 0.24, z: -1.715 });
  // wishbones
  for (const w of W) {
    const s = Math.sign(w.x), ax = Math.abs(w.x);
    tubePath(S, [[s * 0.36, -0.08, w.z - 0.28], [s * (ax - 0.17), w.y - 0.02, w.z]], 0.022, TRIM);
    tubePath(S, [[s * 0.36, -0.08, w.z + 0.28], [s * (ax - 0.17), w.y - 0.02, w.z]], 0.022, TRIM);
    tubePath(S, [[s * 0.4, 0.14, w.z], [s * (ax - 0.17), w.y + 0.12, w.z]], 0.022, TRIM);
  }
  // lights
  for (const s of mirrorXs) {
    lamp(S, Li, s * 0.27, 0.22, 1.76, 0.1, 0.25);
    Li.box(0.1, 0.05, 0.03, 0, IND, { x: s * 0.39, y: 0.04, z: 1.8 });
    Li.box(0.32, 0.055, 0.03, 0, TAIL, { x: s * 0.26, y: 0.24, z: -1.755 });
    Br.box(0.36, 0.07, 0.02, 0, '#ff3b30', { x: s * 0.26, y: 0.24, z: -1.775 });
  }
  // tiny wind deflector (glass)
  G.add(profileExtrude([[0.55, 0.5], [0.45, 0.72], [0.43, 0.72], [0.53, 0.5]], 0.6, 0.01), GLASS);
  return { shell: S.geo(), glass: G.geo(), lights: Li.geo(), brake: Br.geo(), antenna: { x: -0.37, y: 1.05, z: -0.46 } };
}

const BUILDERS = { cabri: buildCabri, mistral: buildMistral, bison: buildBison, criquet: buildCriquet };

export function buildBody(id, livery) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error('buildBody: unknown vehicle ' + id);
  const L = livery || VEHICLES[id].livery;
  return finish(fn(L));
}

// Post-process: bake a soft vertical gradient into the paint (cheap ambient occlusion: darker sills, lighter roof) and
// fold the brake-glow overlay into the lights geometry (attribute aBrk = 1 on the overlay; carModel's lights material
// hides it unless braking). Returns { shell, glass, lights, antenna } (no separate `brake` any more).
function finish(r) {
  const g = r.shell, p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const ao = 0.74 + 0.26 * smooth(-0.3, 0.38, p.getY(i));
    const up = 0.9 + 0.1 * (n.getY(i) * 0.5 + 0.5);
    const k = ao * up;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  const nl = r.lights.attributes.position.count, nb = r.brake.attributes.position.count;
  const lights = merge([r.lights, r.brake]);
  const flag = new Float32Array(nl + nb); flag.fill(1, nl);
  lights.setAttribute('aBrk', new THREE.BufferAttribute(flag, 1));
  return { shell: g, glass: r.glass, lights, antenna: r.antenna };
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
