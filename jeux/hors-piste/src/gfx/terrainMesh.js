// Chunked terrain for the open map: biome colours (snow / green hills / ochre canyons),
// strata on steep rock, and the roads painted from the baked road-distance field
// (asphalt with edge lines, dirt with ruts, packed snow), plus the frozen lake.
import * as THREE from 'three';
import { patchMaterial, U } from './shaders.js';
import { createNoise2D } from '../noise.js';
import { S } from '../vehicles.js';

const C = (h) => new THREE.Color(h);
const COL = {
  snow: C('#eef3fb'), snowShade: C('#d6e0f2'), snowRock: C('#8e8fa3'),
  grass: C('#86b45c'), grassDry: C('#a8b65e'), grassDeep: C('#5f9a4e'), hillRock: C('#9b9886'), grassSun: C('#b4c45a'), grassShade: C('#4f8c6e'),
  sand: C('#e0a86a'), sandRed: C('#cf8152'), dirtGround: C('#b98055'), canyon: C('#c4704a'),
  ice: C('#bfe3f2'),
};

export function createTerrainMesh(world, { chunk = 20 } = {}) {
  const { V, N, cell, half, heights, bsnow, basph, bdirt, roadDist, roadType, roadIdx, ground } = world;
  const noise = createNoise2D(77);
  const sunD = U.uSunDir.value;
  const group = new THREE.Group();

  const normals = new Float32Array(V * V * 3), colors = new Float32Array(V * V * 3);
  const rock = new Float32Array(V * V), road = new Float32Array(V * V * 2), roadS = new Float32Array(V * V * 2);
  const H = (i, j) => heights[Math.min(V - 1, Math.max(0, j)) * V + Math.min(V - 1, Math.max(0, i))];
  const c = new THREE.Color(), t1 = new THREE.Color(), t2 = new THREE.Color(), t3 = new THREE.Color();
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i;
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
    const l = Math.hypot(dx, 1, dz);
    const ny = 1 / l;
    normals[k * 3] = -dx / l; normals[k * 3 + 1] = ny; normals[k * 3 + 2] = -dz / l;
    const x = -half + i * cell, z = -half + j * cell;
    const n1 = noise(x * 0.02, z * 0.02) * 0.5 + 0.5, n2 = noise(x * 0.09 + 5, z * 0.09) * 0.5 + 0.5;
    t1.copy(COL.snow).lerp(COL.snowShade, n2 * 0.6);
    t2.copy(COL.grass).lerp(COL.grassDry, n1).lerp(COL.grassDeep, n2 * 0.4);
    // slopes facing the low sun go yellow-green, the shaded ones cool blue-green
    const ndl = (-dx * sunD.x + sunD.y - dz * sunD.z) / l;
    t2.lerp(ndl > 0.55 ? COL.grassSun : COL.grassShade, Math.min(1, Math.abs(ndl - 0.55) * 1.6) * 0.5);
    t3.copy(ground[k] === S.SAND ? COL.sand : COL.dirtGround).lerp(COL.sandRed, n1 * 0.6);
    c.setRGB(t1.r * bsnow[k] + t2.r * basph[k] + t3.r * bdirt[k], t1.g * bsnow[k] + t2.g * basph[k] + t3.g * bdirt[k], t1.b * bsnow[k] + t2.b * basph[k] + t3.b * bdirt[k]);
    if (ground[k] === S.ICE) c.copy(COL.ice);
    const steep = Math.max(0, Math.min(1, (0.82 - ny) / 0.2));
    rock[k] = steep * (roadDist[k] > 6 ? 1 : 0);
    colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    road[k * 2] = Math.min(roadDist[k], 40);
    road[k * 2 + 1] = roadType[k];
    // distance along the road (for the dashed centre line on tarmac)
    if (roadIdx[k] >= 0 && roadDist[k] < 8) {
      const R = world.roads[Math.floor(roadIdx[k] / 100000)], si = roadIdx[k] % 100000, P = R.pts;
      const a = P[si], b = P[(si + 1) % P.length];
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
      roadS[k * 2] = a.s + t * Math.sqrt(L2);
      // signed distance: interpolates linearly through the centre line (the unsigned one
      // has a V-shaped minimum the 2.5 m mesh cannot resolve)
      // (kept apart from the unsigned distance: the sign flips wherever the nearest segment changes)
      roadS[k * 2 + 1] = ex * (z - a.z) - ez * (x - a.x) < 0 ? -road[k * 2] : road[k * 2];
    }
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchMaterial(mat, {
    detail: 1, cutout: 2,
    extraVert: (s) => s
      .replace('#include <common>', '#include <common>\nattribute float aRock;\nattribute vec2 aRoad;\nattribute vec3 aBiome;\nattribute vec2 aRoadS;\nvarying float vRock;\nvarying vec2 vRoad;\nvarying vec3 vBiome;\nvarying vec2 vRoadS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = aRock; vRoad = aRoad; vBiome = aBiome; vRoadS = aRoadS;'),
    extraFrag: (s) => s
      .replace('#include <common>', '#include <common>\nvarying float vRock;\nvarying vec2 vRoad;\nvarying vec3 vBiome;\nvarying vec2 vRoadS;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n      totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * mbSpark;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      if (vRock > 0.35) {
        vec3 fN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        normal = normalize(mix(normal, fN, smoothstep(0.35, 0.8, vRock) * 0.5));
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float mbSpark = 0.0;
      {
        // ground detail (no textures): grass tone patches, gravel specks on dirt, snow glitter
        float nA = texture2D(uNoise, vMbWorld.xz * 0.045).g;
        float nB = texture2D(uNoise, vMbWorld.xz * 0.6).b;
        float nC = texture2D(uNoise, vMbWorld.xz * 2.3 + 0.37).a;
        diffuseColor.rgb *= 1.0 + vBiome.y * ((nA - 0.5) * 0.22 + (nB - 0.5) * 0.08);
        diffuseColor.rgb *= 1.0 + vBiome.z * ((smoothstep(0.62, 0.74, nC) - smoothstep(0.2, 0.32, nC)) * 0.12 + (nA - 0.5) * 0.1);
        // glitter: view-dependent specks on snow (they twinkle as the camera moves)
        float gl = texture2D(uNoise, vMbWorld.xz * 3.7 + cameraPosition.xz * 0.06).a * texture2D(uNoise, vMbWorld.zx * 2.9 - cameraPosition.zx * 0.05).r;
        mbSpark = smoothstep(0.5, 0.62, gl) * vBiome.x * (1.0 - vRock) * 0.9;
      }
      {
        // rock faces: grey granite in the snow, sandstone strata in the canyons, mossy stone in the hills
        if (vRock > 0.02) {
          float nn = texture2D(uNoise, vMbWorld.xz * 0.015).r;
          float yy = vMbWorld.y * 0.42 + nn * 1.1;
          float id = floor(yy + 0.35 * sin(yy * 2.7 + nn * 4.0));
          float m5 = mod(id, 4.0);
          vec3 sand = m5 < 1.0 ? vec3(0.78, 0.41, 0.25) : m5 < 2.0 ? vec3(0.89, 0.62, 0.42) : m5 < 3.0 ? vec3(0.66, 0.31, 0.23) : vec3(0.93, 0.78, 0.6);
          vec3 granite = vec3(0.56, 0.57, 0.64) * (0.85 + 0.25 * nn);
          vec3 moss = vec3(0.58, 0.6, 0.5) * (0.85 + 0.25 * nn);
          vec3 rc = granite * vBiome.x + moss * vBiome.y + sand * vBiome.z;
          diffuseColor.rgb = mix(diffuseColor.rgb, rc, smoothstep(0.15, 0.7, vRock));
        }
        // roads from the distance field (normalised: carriageway edge at 4.2)
        float d = vRoad.x, ds = vRoadS.y;
        float type = vRoad.y;
        if (d < 5.6) {
          float aa = fwidth(d) * 1.2 + 0.03;
          float onRoad = 1.0 - smoothstep(4.2 - aa, 4.2 + aa, d);
          float shoulder = (1.0 - smoothstep(4.2, 5.6, d)) * (1.0 - onRoad);
          float grain = texture2D(uNoise, vMbWorld.xz * 0.9).a;
          vec3 rc;
          if (type < 1.5) {
            // asphalt with white edge lines
            rc = vec3(0.34, 0.32, 0.33) * (0.9 + 0.16 * grain);
            float edge = smoothstep(3.55 - aa, 3.55, d) * (1.0 - smoothstep(3.8, 3.8 + aa, d));
            rc = mix(rc, vec3(0.93, 0.92, 0.88), edge);
            // dashed centre line, worn tyre lanes, a few darker repair patches
            float aw = fwidth(ds) * 1.2 + 0.02;
            float dash = (1.0 - smoothstep(0.11, 0.11 + aw, abs(ds))) * step(fract(vRoadS.x / 9.0), 0.42) * (1.0 - step(0.9, d));
            rc = mix(rc, vec3(0.95, 0.9, 0.72), dash * 0.9);
            float lane = max(1.0 - smoothstep(0.3, 0.7, abs(d - 1.3)), 1.0 - smoothstep(0.3, 0.7, abs(d - 2.9)));
            rc *= 1.0 - 0.07 * lane;
            float patchN = texture2D(uNoise, vMbWorld.xz * 0.07).b;
            rc *= 1.0 - 0.06 * smoothstep(0.66, 0.7, patchN);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.52, 0.47), shoulder * 0.7);
          } else if (type < 2.5) {
            // dirt track with two darker ruts per lane
            rc = vec3(0.62, 0.42, 0.28) * (0.9 + 0.2 * grain);
            float rut = max(1.0 - smoothstep(0.25, 0.6, abs(d - 1.0)), 1.0 - smoothstep(0.25, 0.6, abs(d - 3.0)));
            rc *= 1.0 - 0.18 * rut;
            diffuseColor.rgb = mix(diffuseColor.rgb, rc * 1.08, shoulder * 0.6);
          } else {
            // packed snow with icy wheel tracks
            rc = vec3(0.8, 0.84, 0.92) * (0.95 + 0.08 * grain);
            float rut = max(1.0 - smoothstep(0.2, 0.55, abs(d - 1.0)), 1.0 - smoothstep(0.2, 0.55, abs(d - 3.0)));
            rc = mix(rc, vec3(0.62, 0.69, 0.82), rut * 0.7);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.98, 1.0), shoulder * 0.8); // ploughed banks
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, rc, onRoad);
        }
      }`),
  });

  const per = chunk;
  const nChunks = N / per;
  for (let cj = 0; cj < nChunks; cj++) for (let ci = 0; ci < nChunks; ci++) {
    const vi = per + 1, cnt = vi * vi;
    const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3);
    const rk = new Float32Array(cnt), rd = new Float32Array(cnt * 2), bio = new Float32Array(cnt * 3), rs = new Float32Array(cnt * 2);
    for (let j = 0; j < vi; j++) for (let i = 0; i < vi; i++) {
      const gi = ci * per + i, gj = cj * per + j, k = gj * V + gi, o = j * vi + i;
      pos[o * 3] = -half + gi * cell; pos[o * 3 + 1] = heights[k]; pos[o * 3 + 2] = -half + gj * cell;
      nor.set(normals.subarray(k * 3, k * 3 + 3), o * 3);
      col.set(colors.subarray(k * 3, k * 3 + 3), o * 3);
      rk[o] = rock[k]; rd[o * 2] = road[k * 2]; rd[o * 2 + 1] = road[k * 2 + 1]; rs[o * 2] = roadS[k * 2]; rs[o * 2 + 1] = roadS[k * 2 + 1];
      bio[o * 3] = bsnow[k]; bio[o * 3 + 1] = basph[k]; bio[o * 3 + 2] = bdirt[k];
    }
    const idx = [];
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const a = j * vi + i, b = a + 1, cc = a + vi, d = cc + 1;
      idx.push(a, d, b, a, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRock', new THREE.BufferAttribute(rk, 1));
    g.setAttribute('aRoad', new THREE.BufferAttribute(rd, 2));
    g.setAttribute('aBiome', new THREE.BufferAttribute(bio, 3));
    g.setAttribute('aRoadS', new THREE.BufferAttribute(rs, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // far ground beyond the map edge (continuation of the enclosing ridge, in the haze)
  const ring = new THREE.Mesh(new THREE.RingGeometry(half * 0.98, 3000, 64, 1).rotateX(-Math.PI / 2).translate(0, -4, 0), new THREE.MeshLambertMaterial({ color: '#b7a5b8' }));
  group.add(ring);
  return { group, material: mat };
}
