// Chunked terrain mesh (same triangulation as terrain.heightAt) + heightmap texture for water.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { createNoise2D } from '../noise.js';

const C = (h) => new THREE.Color(h);
const COLORS = {
  sandDry: C('#f2dcae'), sandAlt: C('#e9c994'), sandPink: C('#efcfa2'),
  wet: C('#cfae86'), under: C('#dcc59c'),
  grassA: C('#bea457'), grassB: C('#a9a253'), grassC: C('#c9a95e'),
  mesaTop: C('#b7a15e'),
};

export function createTerrainMesh(terrain, { chunks = 8 } = {}) {
  const { V, N, cell, half, heights, grass, mesa } = terrain;
  const noise = createNoise2D(99);
  const group = new THREE.Group();
  group.name = 'terrain';

  // Per-vertex attributes for the whole grid
  const normals = new Float32Array(V * V * 3);
  const colors = new Float32Array(V * V * 3);
  const rock = new Float32Array(V * V);
  const H = (i, j) => heights[Math.min(V - 1, Math.max(0, j)) * V + Math.min(V - 1, Math.max(0, i))];
  const tmp = new THREE.Color();
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
      const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
      const l = Math.hypot(dx, 1, dz);
      const nx = -dx / l, ny = 1 / l, nz = -dz / l;
      normals[k * 3] = nx; normals[k * 3 + 1] = ny; normals[k * 3 + 2] = nz;
      const x = -half + i * cell, z = -half + j * cell;
      const h = heights[k];
      const n1 = noise(x * 0.05, z * 0.05) * 0.5 + 0.5;
      const n2 = noise(x * 0.17 + 9, z * 0.17) * 0.5 + 0.5;
      // base sand
      tmp.copy(COLORS.sandDry).lerp(COLORS.sandAlt, n1 * 0.8).lerp(COLORS.sandPink, n2 * 0.35);
      // wet / underwater
      if (h < 0.4) tmp.lerp(COLORS.wet, 1 - Math.max(0, Math.min(1, (h - 0.05) / 0.35)));
      if (h < 0) tmp.lerp(COLORS.under, Math.min(1, -h * 2));
      // grass ground
      const gr = grass[k];
      if (gr > 0) {
        const gc = COLORS.grassA.clone().lerp(COLORS.grassB, n2).lerp(COLORS.grassC, n1 * 0.5);
        tmp.lerp(gc, Math.min(1, gr * 1.3));
      }
      // rock: steep or mesa
      const steep = Math.max(0, Math.min(1, (0.86 - ny) / 0.18));
      const m = mesa[k];
      const rk = 1 - Math.max(0, Math.min(1, (ny - 0.8) / 0.12));
      let r = Math.max(steep, m > 0.25 ? rk : 0);
      if (m > 0.5 && ny > 0.86 && h > 1.5) tmp.copy(COLORS.mesaTop).lerp(COLORS.grassC, n1 * 0.5).lerp(COLORS.sandAlt, n2 * 0.35);
      rock[k] = r;
      colors[k * 3] = tmp.r; colors[k * 3 + 1] = tmp.g; colors[k * 3 + 2] = tmp.b;
    }
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchMaterial(mat, {
    wetline: true, detail: 1, cutout: 2,
    extraVert: (s) => s
      .replace('#include <common>', '#include <common>\nattribute float aRock;\nvarying float vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = aRock;'),
    extraFrag: (s) => s
      .replace('#include <common>', '#include <common>\nvarying float vRock;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      if (vRock > 0.35) {
        vec3 fN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        normal = normalize(mix(normal, fN, smoothstep(0.35, 0.8, vRock) * 0.85));
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (vRock > 0.02) {
        float nn = texture2D(uNoise, vMbWorld.xz * 0.018).r;
        float band = vMbWorld.y * 1.45 + nn * 1.6 + texture2D(uNoise, vMbWorld.xz * 0.11).b * 0.35;
        float id = floor(band);
        float f = fract(band);
        float m4 = mod(id, 4.0);
        vec3 c = m4 < 1.0 ? vec3(0.84, 0.58, 0.44) : m4 < 2.0 ? vec3(0.72, 0.47, 0.40) : m4 < 3.0 ? vec3(0.90, 0.70, 0.52) : vec3(0.64, 0.43, 0.42);
        float streak = texture2D(uNoise, vec2(dot(vMbWorld.xz, vec2(0.7, 0.7)) * 0.35, vMbWorld.y * 0.02)).g;
        c *= 0.86 + 0.22 * streak;
        c *= 0.93 + 0.12 * texture2D(uNoise, vMbWorld.xz * 0.6 + vMbWorld.y * 0.3).a;
        c *= mix(0.8, 1.0, smoothstep(0.0, 0.07, f));      // dark seam between strata
        c = mix(c, c * vec3(1.05, 0.98, 0.9), smoothstep(0.75, 1.0, f));
        diffuseColor.rgb = mix(diffuseColor.rgb, c, smoothstep(0.0, 0.6, vRock));
      }`),
  });

  const per = N / chunks;
  for (let cj = 0; cj < chunks; cj++) {
    for (let ci = 0; ci < chunks; ci++) {
      const vi = per + 1;
      const pos = new Float32Array(vi * vi * 3), nor = new Float32Array(vi * vi * 3), col = new Float32Array(vi * vi * 3), rk = new Float32Array(vi * vi);
      for (let j = 0; j < vi; j++) for (let i = 0; i < vi; i++) {
        const gi = ci * per + i, gj = cj * per + j;
        const k = gj * V + gi, o = j * vi + i;
        pos[o * 3] = -half + gi * cell; pos[o * 3 + 1] = heights[k]; pos[o * 3 + 2] = -half + gj * cell;
        nor.set(normals.subarray(k * 3, k * 3 + 3), o * 3);
        col.set(colors.subarray(k * 3, k * 3 + 3), o * 3);
        rk[o] = rock[k];
      }
      const idx = [];
      for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
        const a = j * vi + i, b = a + 1, c = a + vi, d = c + 1; // 00,10,01,11
        idx.push(a, d, b, a, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aRock', new THREE.BufferAttribute(rk, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  // Heightmap texture (half float, linear filtered) for water depth.
  const hdata = new Uint16Array(V * V);
  for (let k = 0; k < V * V; k++) hdata[k] = THREE.DataUtils.toHalfFloat(heights[k]);
  const heightTex = new THREE.DataTexture(hdata, V, V, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  // Seabed skirt beyond the map so the deep ocean has a floor to tint.
  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(half * 0.94, 2600, 64, 1).rotateX(-Math.PI / 2).translate(0, -7.6, 0),
    new THREE.MeshBasicMaterial({ color: '#2a3f6e' }),
  );
  group.add(skirt);

  return { group, heightTex, material: mat };
}
