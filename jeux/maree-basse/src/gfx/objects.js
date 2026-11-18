// Prop meshes (instanced per kind/colour), structures (pier, ramps, hut, lighthouse,
// umbrellas) and the golden shell collectibles.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { colorize, colorizeFn, place, merge, softBox } from './geo.js';
import { PROP_KINDS } from '../props.js';

const SCHEMES = [
  ['#ff7b5c', '#fff6e8', '#ffcf5c'],
  ['#4cc9b0', '#fff6e8', '#ff9db5'],
  ['#ffcf5c', '#fff6e8', '#5aa9e6'],
  ['#b69cf0', '#fff6e8', '#ff7b5c'],
];

function ballGeo(s) {
  const g = new THREE.SphereGeometry(PROP_KINDS.ball.r, 20, 14);
  const cols = [s[0], s[1], s[2], s[1], '#4cc9b0', s[1]];
  return colorizeFn(g, (x, y, z) => {
    if (Math.abs(y) > PROP_KINDS.ball.r * 0.9) return '#fff6e8';
    const a = Math.atan2(z, x) + Math.PI;
    return cols[Math.floor((a / (Math.PI * 2)) * 6) % 6];
  });
}
function ringGeo(s) {
  const g = new THREE.TorusGeometry(0.4, 0.165, 12, 28);
  g.rotateX(Math.PI / 2);
  return colorizeFn(g, (x, y, z) => {
    const a = Math.atan2(z, x) + Math.PI;
    return Math.floor((a / (Math.PI * 2)) * 8) % 2 ? s[1] : s[0];
  });
}
function buoyGeo(i) {
  const main = i % 2 ? '#e8503a' : '#3aa36b';
  const parts = [];
  const f = new THREE.CylinderGeometry(0.5, 0.56, 0.62, 16); place(f, { y: -0.02 });
  colorizeFn(f, (x, y) => (Math.abs(y + 0.02) < 0.08 ? '#fff6e8' : main)); parts.push(f);
  const c = new THREE.CylinderGeometry(0.12, 0.42, 0.5, 14); place(c, { y: 0.54 }); colorize(c, main); parts.push(c);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const bar = new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5); place(bar, { x: Math.cos(a) * 0.14, y: 1.05, z: Math.sin(a) * 0.14 }); colorize(bar, '#3a3540'); parts.push(bar);
  }
  const top = new THREE.SphereGeometry(0.11, 10, 8); place(top, { y: 1.38 }); colorize(top, '#ffe08a'); parts.push(top);
  const base = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12); place(base, { y: -0.4 }); colorize(base, '#3a3540'); parts.push(base);
  return merge(parts);
}
function barrelGeo() {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.36 + Math.sin(t * Math.PI) * 0.08, (t - 0.5) * 0.95)); }
  const g = new THREE.LatheGeometry(pts, 16);
  colorizeFn(g, (x, y) => (Math.abs(Math.abs(y) - 0.3) < 0.04 ? '#3d3530' : Math.abs(y) > 0.46 ? '#7b5235' : '#a8703f'));
  const lid = new THREE.CylinderGeometry(0.36, 0.36, 0.02, 16);
  const l1 = place(lid.clone(), { y: 0.475 }); colorize(l1, '#8a5c39');
  const l2 = place(lid.clone(), { y: -0.475 }); colorize(l2, '#8a5c39');
  const m = merge([g, l1, l2]);
  m.rotateZ(Math.PI / 2);
  return m;
}
function melonGeo() {
  const g = new THREE.SphereGeometry(1, 18, 12);
  g.scale(0.36, 0.32, 0.44);
  return colorizeFn(g, (x, y, z) => {
    const a = Math.atan2(y, x);
    const st = Math.sin(a * 8 + Math.sin(z * 9) * 0.6);
    return st > 0.25 ? '#2f6b3a' : '#7fb35a';
  });
}
function crateGeo() {
  const parts = [];
  const b = softBox(0.78, 0.7, 0.78, 0.04, 1); colorize(b, '#c9955e'); parts.push(b);
  for (const y of [-0.22, 0, 0.22]) {
    const slat = softBox(0.8, 0.04, 0.8, 0.01, 1); place(slat, { y }); colorize(slat, '#a8743f'); parts.push(slat);
  }
  // a few melons peeking out of the top
  for (const [x, z] of [[-0.18, -0.15], [0.17, 0.12]]) {
    const m = new THREE.SphereGeometry(0.17, 10, 8); place(m, { x, y: 0.33, z }); colorize(m, '#4f8a43'); parts.push(m);
  }
  return merge(parts);
}

export function createPropMeshes(props, scene) {
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48 }), { caustics: true });
  const groups = new Map(); // key -> { mesh, items }
  const geoFor = (kind, color) => {
    switch (kind) {
      case 'ball': return ballGeo(SCHEMES[color % 4]);
      case 'ring': return ringGeo(SCHEMES[color % 4]);
      case 'buoy': return buoyGeo(color);
      case 'barrel': return barrelGeo();
      case 'melon': return melonGeo();
      case 'crate': return crateGeo();
      default: return new THREE.SphereGeometry(0.4);
    }
  };
  const variantsOf = (kind) => (kind === 'ball' || kind === 'ring' ? 4 : kind === 'buoy' ? 2 : 1);
  for (const p of props.list) {
    const v = p.color % variantsOf(p.kind);
    const key = p.kind + v;
    if (!groups.has(key)) groups.set(key, { kind: p.kind, v, items: [] });
    groups.get(key).items.push(p);
  }
  const root = new THREE.Group();
  for (const g of groups.values()) {
    const mesh = new THREE.InstancedMesh(geoFor(g.kind, g.v), mat, g.items.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    g.mesh = mesh;
    root.add(mesh);
  }
  scene.add(root);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return {
    root,
    sync() {
      for (const g of groups.values()) {
        g.items.forEach((p, i) => {
          q.set(p.q.x, p.q.y, p.q.z, p.q.w);
          pos.set(p.pos.x, p.pos.y + (p.kind === 'ring' ? -0.33 : 0), p.pos.z);
          m.compose(pos, q, one);
          g.mesh.setMatrixAt(i, m);
        });
        g.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// ---------- Structures ----------
function plankDeck(len, width, y, { postsTo = null, terrain, frame }) {
  const parts = [];
  const n = Math.floor(len / 0.32);
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + (i + 0.5) * (len / n);
    const pl = softBox(width + (i % 3 === 0 ? 0.08 : 0), 0.08, len / n - 0.04, 0.015, 1);
    place(pl, { y: y - 0.04 + (i % 4 === 1 ? 0.01 : 0), z });
    const shade = 0.88 + ((i * 37) % 11) / 60;
    colorize(pl, new THREE.Color('#c79a6a').multiplyScalar(shade));
    parts.push(pl);
  }
  for (const s of [-1, 1]) {
    const beam = softBox(0.14, 0.18, len, 0.02, 1); place(beam, { x: s * (width / 2 - 0.1), y: y - 0.16 }); colorize(beam, '#8e6845'); parts.push(beam);
  }
  return parts;
}

export function createStructures(terrain, layout) {
  const group = new THREE.Group();
  const woodMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { cutout: 1 });
  const W = (geo) => { const m = new THREE.Mesh(geo, woodMat); m.castShadow = true; m.receiveShadow = true; return m; };
  const obstacles = [];

  // Pier
  if (layout.pier) {
    const P = layout.pier;
    const { deck, ramp } = P;
    const parts = plankDeck(deck.hl * 2, deck.hw * 2, deck.y1, {});
    // posts down to the seabed
    for (let z = -deck.hl + 0.4; z <= deck.hl; z += 3) {
      for (const s of [-1, 1]) {
        const lx = s * (deck.hw - 0.05);
        const wx = deck.x + lx * deck.cos + z * deck.sin;
        const wz = deck.z - lx * deck.sin + z * deck.cos;
        const gh = terrain.heightAt(wx, wz);
        const hgt = deck.y1 + 0.35 - gh + 0.3;
        const post = new THREE.CylinderGeometry(0.13, 0.15, hgt, 8);
        place(post, { x: lx, y: gh - 0.3 + hgt / 2, z });
        colorizeFn(post, (x, y) => (y < gh - 0.3 + hgt / 2 - (deck.y1 + 0.35 - gh) / 2 + 0.2 ? '#5e4a3a' : '#8e6845'));
        parts.push(post);
        obstacles.push({ x: wx, z: wz, r: 0.18, y0: gh - 1, y1: deck.y1 - 0.25, kind: 'wood' });
      }
    }
    // lantern posts at the end
    for (const s of [-1, 1]) {
      const lp = new THREE.CylinderGeometry(0.05, 0.06, 1.3, 6); place(lp, { x: s * (deck.hw - 0.12), y: deck.y1 + 0.65, z: deck.hl - 0.3 }); colorize(lp, '#3a3540'); parts.push(lp);
      const lb = softBox(0.22, 0.26, 0.22, 0.04, 1); place(lb, { x: s * (deck.hw - 0.12), y: deck.y1 + 1.4, z: deck.hl - 0.3 }); colorize(lb, '#ffe7a8'); parts.push(lb);
    }
    const dm = W(merge(parts));
    dm.position.set(deck.x, 0, deck.z);
    dm.rotation.y = deck.angle;
    group.add(dm);
    group.add(rampMesh(ramp, W));
  }
  for (const r of layout.ramps) group.add(rampMesh(r, W, true));

  // Hut
  if (layout.hut) {
    const h = layout.hut;
    const parts = [];
    const base = softBox(3.2, 0.25, 2.6, 0.04, 1); place(base, { y: 0.35 }); colorize(base, '#a8784a'); parts.push(base);
    for (const [x, z] of [[-1.45, -1.15], [1.45, -1.15], [-1.45, 1.15], [1.45, 1.15]]) {
      const p = new THREE.CylinderGeometry(0.09, 0.1, 2.6, 6); place(p, { x, y: 1.5, z }); colorize(p, '#7f5b3c'); parts.push(p);
    }
    const back = softBox(3.0, 2.1, 0.12, 0.03, 1); place(back, { y: 1.5, z: -1.15 }); colorizeFn(back, (x) => (Math.floor((x + 3) * 3) % 2 ? '#f3e2c4' : '#7fc8c0')); parts.push(back);
    for (const s of [-1, 1]) { const side = softBox(0.12, 2.1, 2.3, 0.03, 1); place(side, { x: s * 1.5, y: 1.5 }); colorize(side, '#e9d2ad'); parts.push(side); }
    const counter = softBox(3.0, 1.0, 0.5, 0.05, 1); place(counter, { y: 0.95, z: 1.0 }); colorizeFn(counter, (x) => (Math.floor((x + 3) * 2.5) % 2 ? '#ff7b5c' : '#fff1dc')); parts.push(counter);
    const roof = new THREE.ConeGeometry(2.6, 1.5, 9, 1); place(roof, { y: 3.4, ry: 0.2 });
    colorizeFn(roof, (x, y) => (y < -0.5 ? '#c7a052' : '#d9b766')); parts.push(roof);
    // little sign
    const sign = softBox(1.4, 0.4, 0.06, 0.03, 1); place(sign, { y: 2.45, z: 1.26 }); colorize(sign, '#ffcf5c'); parts.push(sign);
    const m = W(merge(parts));
    m.position.set(h.x, h.y, h.z); m.rotation.y = h.rot;
    group.add(m);
    obstacles.push({ x: h.x, z: h.z, r: 1.9, y0: h.y - 1, y1: h.y + 3, kind: 'wood' });
  }

  // Umbrellas + towels
  for (const u of layout.umbrellas) {
    const sc = SCHEMES[u.color % 4];
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6); place(pole, { y: 1.15 }); colorize(pole, '#efe2c8'); parts.push(pole);
    const can = new THREE.ConeGeometry(1.25, 0.55, 12, 1, true); place(can, { y: 2.2 });
    colorizeFn(can, (x, y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 12) % 2 ? sc[0] : sc[1])); parts.push(can);
    const towel = softBox(0.9, 0.03, 1.8, 0.01, 1); place(towel, { x: 0.7, y: 0.03, z: 0.4, ry: 0.4 });
    colorizeFn(towel, (x, y, z) => (Math.floor((z + 2) * 4) % 2 ? sc[2] : '#fff6e8')); parts.push(towel);
    const m = W(merge(parts));
    m.material = woodMat;
    m.position.set(u.x, u.y - 0.05, u.z); m.rotation.set(u.tilt, u.rot, 0);
    group.add(m);
    obstacles.push({ x: u.x, z: u.z, r: 0.08, y0: u.y - 1, y1: u.y + 2.2, kind: 'wood' });
  }

  // Lighthouse
  let lamp = null;
  if (layout.lighthouse) {
    const L = layout.lighthouse;
    const parts = [];
    const tower = new THREE.CylinderGeometry(0.95, 1.4, 9, 18, 9);
    place(tower, { y: 4.5 });
    colorizeFn(tower, (x, y) => (Math.floor(y / 1.5) % 2 ? '#e65a46' : '#fff4e3'));
    parts.push(tower);
    const gal = new THREE.CylinderGeometry(1.35, 1.35, 0.18, 18); place(gal, { y: 9.1 }); colorize(gal, '#3a3540'); parts.push(gal);
    const room = new THREE.CylinderGeometry(0.7, 0.7, 1.1, 12); place(room, { y: 9.75 }); colorize(room, '#3a3540'); parts.push(room);
    const cap = new THREE.ConeGeometry(0.95, 0.9, 12); place(cap, { y: 10.75 }); colorize(cap, '#e65a46'); parts.push(cap);
    const base = new THREE.CylinderGeometry(2.1, 2.3, 0.6, 14); place(base, { y: 0.1 }); colorize(base, '#d8c4a8'); parts.push(base);
    const hut2 = softBox(2.2, 1.6, 2.0, 0.08, 1); place(hut2, { x: 2.2, y: 0.8 }); colorize(hut2, '#fff4e3'); parts.push(hut2);
    const roof2 = softBox(2.4, 0.2, 2.2, 0.06, 1); place(roof2, { x: 2.2, y: 1.7 }); colorize(roof2, '#e65a46'); parts.push(roof2);
    const m = W(merge(parts));
    m.position.set(L.x, L.y - 0.1, L.z);
    group.add(m);
    lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff0b8' }));
    lamp.position.set(L.x, L.y + 9.75, L.z);
    group.add(lamp);
    obstacles.push({ x: L.x, z: L.z, r: 1.5, y0: L.y - 1, y1: L.y + 11, kind: 'rock' });
  }

  return { group, obstacles, lamp };
}

function rampMesh(r, W, kicker = false) {
  const parts = [];
  const len = r.hl * 2, n = Math.floor(len / 0.34);
  const slope = Math.atan2(r.y1 - r.y0, len);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const z = -r.hl + t * len;
    const y = r.y0 + (r.y1 - r.y0) * t;
    const pl = softBox(r.hw * 2, 0.08, len / n / Math.cos(slope) - 0.03, 0.015, 1);
    place(pl, { y: y - 0.04, z, rx: -slope });
    colorize(pl, new THREE.Color(kicker ? '#d9a25f' : '#c79a6a').multiplyScalar(0.9 + ((i * 31) % 7) / 40));
    parts.push(pl);
  }
  // side supports
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-r.hl, r.y0 - 0.6); shape.lineTo(r.hl, r.y0 - 0.6); shape.lineTo(r.hl, r.y1 - 0.08); shape.lineTo(-r.hl, r.y0 - 0.08);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    g.deleteAttribute('uv');
    g.rotateY(-Math.PI / 2);
    place(g, { x: s * (r.hw - 0.06) + 0.06 });
    colorize(g, '#8e6845');
    parts.push(g);
  }
  if (kicker) {
    // painted chevrons
    for (let i = 0; i < 3; i++) {
      const t = 0.35 + i * 0.2;
      const ch = softBox(r.hw * 1.2, 0.02, 0.18, 0.01, 1);
      place(ch, { y: r.y0 + (r.y1 - r.y0) * t + 0.005, z: -r.hl + t * len, rx: -slope });
      colorize(ch, '#fff1dc');
      parts.push(ch);
    }
  }
  const m = W(merge(parts));
  m.position.set(r.x, 0, r.z);
  m.rotation.y = r.angle;
  return m;
}

// ---------- Golden shells ----------
function scallopGeo() {
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  const R = 0.5, segA = 28, segR = 8;
  for (let i = 0; i <= segR; i++) {
    const r = (i / segR) * R;
    for (let j = 0; j <= segA; j++) {
      const a = (j / segA) * Math.PI * 1.05 - Math.PI * 0.025;
      const rib = Math.abs(Math.sin(j / segA * Math.PI * 12)) * 0.035 * (r / R);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = (r / R) * (1 - Math.pow(Math.abs(Math.cos(a)), 3) * 0.4) * 0.16 + rib;
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < segR; i++) for (let j = 0; j < segA; j++) {
    const a = i * (segA + 1) + j, b = a + 1, c = a + segA + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.translate(0, 0, -0.22);
  const ears = new THREE.ConeGeometry(0.12, 0.2, 4); ears.rotateX(Math.PI / 2); ears.translate(0, 0.02, -0.3);
  const top = g.toNonIndexed();
  const bottom = top.clone(); bottom.scale(1, -0.6, 1);
  return merge([top, bottom, ears]);
}

export function createShells(layout, terrain) {
  const group = new THREE.Group();
  const geo = scallopGeo();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffc94a', emissive: '#ff9d2e', emissiveIntensity: 0.55, metalness: 0.35, roughness: 0.32, side: THREE.DoubleSide });
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffd27a') } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float edge = pow(sin(vUv.x * 3.14159), 2.0);
        float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        float flick = 0.85 + 0.15 * sin(uTime * 3.0 + vUv.y * 12.0);
        gl_FragColor = vec4(uColor, edge * fade * 0.42 * flick);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const beamGeo = new THREE.CylinderGeometry(0.55, 0.9, 26, 16, 1, true).translate(0, 13, 0);
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const haloGeo = new THREE.RingGeometry(0.6, 1.25, 32).rotateX(-Math.PI / 2);
  const items = layout.shells.map((s) => {
    const g = new THREE.Group();
    const y = Math.max(s.y, 0) + 0.55;
    g.position.set(s.x, y, s.z);
    const shell = new THREE.Mesh(geo, mat);
    shell.scale.setScalar(1.25);
    shell.castShadow = true;
    g.add(shell);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = -0.6;
    g.add(beam);
    const halo = new THREE.Mesh(haloGeo, haloMat.clone());
    halo.position.y = Math.max(s.y, 0) - y + 0.06;
    g.add(halo);
    group.add(g);
    return { ...s, group: g, shell, beam, halo, baseY: y, collectT: -1 };
  });
  return {
    group, items, beamMat,
    update(t, dt) {
      beamMat.uniforms.uTime.value = t;
      for (const it of items) {
        if (it.taken && it.collectT < 0) continue;
        if (it.collectT >= 0) {
          it.collectT += dt;
          const k = it.collectT / 0.9;
          it.group.position.y = it.baseY + k * 3.5;
          it.shell.scale.setScalar(1.25 * (1 + k * 0.6) * Math.max(0, 1 - k * k));
          it.shell.rotation.y += dt * 12;
          it.beam.scale.set(1 - k, 1, 1 - k);
          it.halo.material.opacity = 0.35 * (1 - k);
          if (k >= 1) { it.group.visible = false; it.collectT = -1; }
          continue;
        }
        it.shell.rotation.y = t * 1.3 + it.id;
        it.shell.position.y = Math.sin(t * 2 + it.id) * 0.15;
        it.shell.rotation.z = Math.sin(t * 1.4 + it.id) * 0.2;
        const pulse = 1 + Math.sin(t * 3 + it.id) * 0.12;
        it.halo.scale.setScalar(pulse);
      }
    },
  };
}
