// Instanced meshes for the bumpable roadside props, and their placement along the roads.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { colorize, colorizeFn, place, merge, softBox } from './geo.js';
import { mulberry32 } from '../noise.js';
import { ROAD_TYPE } from '../world.js';

function coneGeo() {
  const c = new THREE.ConeGeometry(0.3, 0.7, 12, 3, true);
  colorizeFn(c, (x, y) => (Math.abs(y) < 0.1 ? '#f4f2ee' : '#ff6a2a'));
  const base = softBox(0.6, 0.06, 0.6, 0.02, 1); place(base, { y: -0.33 }); colorize(base, '#2b2730');
  return merge([c, base]);
}
function hayGeo() {
  const g = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 14, 3);
  g.rotateZ(Math.PI / 2);
  colorizeFn(g, (x, y, z) => (Math.abs(Math.abs(x) - 0.25) < 0.05 ? '#9a7b3a' : Math.abs(x) > 0.53 ? '#c9a45a' : '#e2c272'));
  return g;
}
function snowmanGeo() {
  const parts = [];
  const s1 = new THREE.SphereGeometry(0.5, 12, 8); place(s1, { y: -0.35 }); colorize(s1, '#f6f8fc'); parts.push(s1);
  const s2 = new THREE.SphereGeometry(0.36, 12, 8); place(s2, { y: 0.35 }); colorize(s2, '#f6f8fc'); parts.push(s2);
  const s3 = new THREE.SphereGeometry(0.25, 10, 8); place(s3, { y: 0.85 }); colorize(s3, '#f6f8fc'); parts.push(s3);
  const nose = new THREE.ConeGeometry(0.05, 0.25, 6); place(nose, { y: 0.85, z: 0.32, rx: Math.PI / 2 }); colorize(nose, '#ff7a2a'); parts.push(nose);
  const hat = new THREE.CylinderGeometry(0.17, 0.17, 0.22, 10); place(hat, { y: 1.12 }); colorize(hat, '#2b2730'); parts.push(hat);
  const brim = new THREE.CylinderGeometry(0.26, 0.26, 0.03, 12); place(brim, { y: 1.02 }); colorize(brim, '#2b2730'); parts.push(brim);
  const scarf = new THREE.TorusGeometry(0.3, 0.06, 6, 14); place(scarf, { y: 0.62, rx: Math.PI / 2 }); colorize(scarf, '#d8352f'); parts.push(scarf);
  for (const sx of [-0.09, 0.09]) { const e = new THREE.SphereGeometry(0.035, 6, 4); place(e, { x: sx, y: 0.92, z: 0.22 }); colorize(e, '#2b2730'); parts.push(e); }
  return merge(parts);
}
function barrelGeo() {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.36 + Math.sin(t * Math.PI) * 0.05, (t - 0.5) * 0.95)); }
  const g = new THREE.LatheGeometry(pts, 14);
  return colorizeFn(g, (x, y) => (Math.abs(Math.abs(y) - 0.25) < 0.04 ? '#f4f2ee' : '#2f6fb8'));
}
function tyresGeo() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const t = new THREE.TorusGeometry(0.4, 0.15, 8, 16); place(t, { y: -0.27 + k * 0.27, rx: Math.PI / 2 });
    colorize(t, k === 1 ? '#f2f0ea' : '#2e2a33'); parts.push(t);
  }
  return merge(parts);
}

export function createPropMeshes(props) {
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {});
  const geos = { cone: coneGeo(), hay: hayGeo(), snowman: snowmanGeo(), barrel: barrelGeo(), tyres: tyresGeo() };
  const groups = {};
  for (const p of props.list) (groups[p.kind] ||= []).push(p);
  const root = new THREE.Group();
  const meshes = [];
  for (const [kind, items] of Object.entries(groups)) {
    const m = new THREE.InstancedMesh(geos[kind], mat, items.length);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    root.add(m); meshes.push({ m, items });
  }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
  return {
    root,
    sync(camPos, far) {
      for (const { m, items } of meshes) {
        items.forEach((p, i) => {
          const rp = p.rpos, rq = p.rq;
          const visible = (rp.x - camPos.x) ** 2 + (rp.z - camPos.z) ** 2 < far * far;
          q.set(rq.x, rq.y, rq.z, rq.w); pos.set(rp.x, rp.y, rp.z);
          M.compose(pos, q, visible ? one : zero);
          m.setMatrixAt(i, M);
        });
        m.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// Props along the roads: cones lining asphalt corners, hay bales on dirt bends, snowmen
// on snow roads, tyre stacks and barrels at junction-like spots.
export function placeRoadProps(world, props) {
  const rnd = mulberry32(5150);
  for (const road of world.roads) {
    const P = road.pts, n = P.length;
    for (let i = 20; i < n - 20; i += 2) {
      const a = P[i - 8], b = P[i + 8];
      const turn = Math.atan2(Math.sin(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)), Math.cos(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
      const p = P[i];
      // outside of bends gets markers
      if (Math.abs(turn) > 0.35 && i % 6 === 0) {
        const side = turn > 0 ? 1 : -1; // turning left -> outside is the right
        const off = 7.0 + rnd() * 0.9; // clear of a car running a little wide
        const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
        if (world.roadDistAt(x, z) < 6.2) continue;
        const kind = p.type === ROAD_TYPE.ASPHALT ? 'cone' : p.type === ROAD_TYPE.DIRT ? (rnd() < 0.7 ? 'hay' : 'tyres') : (rnd() < 0.5 ? 'snowman' : 'barrel');
        props.add(kind, x, z, { yaw: Math.atan2(p.tx, p.tz) });
      }
    }
  }
}
