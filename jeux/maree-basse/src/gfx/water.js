// Stylised lagoon water: depth colour from the terrain heightmap, interactive ripples,
// shore foam, cellular foam lace, sky reflection, sun glitter.
import * as THREE from 'three';
import { U, GLSL_COMMON, PALETTE } from './shaders.js';

function makeWaterGeometry(M = 64) {
  const n = 2 * M + 1;
  const pos = new Float32Array(n * n * 3);
  const f = (u) => Math.sign(u) * (40 * Math.abs(u) + 1460 * Math.pow(Math.abs(u), 5));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / M - 1, v = j / M - 1;
    const o = (j * n + i) * 3;
    pos[o] = f(u); pos[o + 1] = 0; pos[o + 2] = f(v);
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000);
  return g;
}

export function createWater({ heightTex, terrain, waves, fog }) {
  const simTex = new THREE.DataTexture(waves.pixels, waves.n, waves.n, THREE.RGBAFormat);
  simTex.magFilter = THREE.LinearFilter;
  simTex.minFilter = THREE.LinearFilter;
  simTex.needsUpdate = true;

  const uniforms = {
    ...U,
    uHeight: { value: heightTex },
    uHalf: { value: terrain.half },
    uHV: { value: terrain.V },
    uSim: { value: simTex },
    uSimOrigin: { value: new THREE.Vector2() },
    uSimSize: { value: waves.size },
    uSimN: { value: waves.n },
    cShallow: { value: PALETTE.shallow.clone() },
    cLagoon: { value: PALETTE.lagoon.clone() },
    cDeep: { value: PALETTE.deep.clone() },
    cAbyss: { value: PALETTE.abyss.clone() },
    cFoam: { value: PALETTE.foam.clone() },
    cSkyTop: { value: new THREE.Color('#a9b4ee') },
    cSkyHorizon: { value: new THREE.Color('#f6c9a6') },
    uFogColor: { value: fog.color },
    uFogNear: { value: fog.near }, uFogFar: { value: fog.far },
  };

  const vertexShader = /* glsl */`
    ${GLSL_COMMON}
    uniform sampler2D uSim; uniform vec2 uSimOrigin; uniform float uSimSize; uniform float uSimN;
    varying vec3 vWorld;
    varying float vSimH;
    float swell(vec2 p, float t) {
      return sin(p.x * 0.11 + t * 0.9) * 0.035 + sin(p.y * 0.087 - t * 0.7 + p.x * 0.03) * 0.03
        + sin((p.x + p.y) * 0.23 + t * 1.7) * 0.012;
    }
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec2 suv = (wp.xz - uSimOrigin) / uSimSize;
      suv = suv + 0.5 / uSimN;
      float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
      float simH = (texture2D(uSim, suv).r - 0.50196) * (0.35 * 255.0 / 127.0) * inside;
      vSimH = simH;
      wp.y = uWaterLevel + swell(wp.xz, uTime) + simH;
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const fragmentShader = /* glsl */`
    ${GLSL_COMMON}
    uniform sampler2D uHeight; uniform float uHalf; uniform float uHV;
    uniform sampler2D uSim; uniform vec2 uSimOrigin; uniform float uSimSize; uniform float uSimN;
    uniform vec3 cShallow, cLagoon, cDeep, cAbyss, cFoam, cSkyTop, cSkyHorizon;
    uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
    varying vec3 vWorld;
    varying float vSimH;

    void main() {
      vec2 xz = vWorld.xz;
      float t = uTime;
      vec2 huv = (xz + uHalf) / (2.0 * uHalf);
      huv = huv * ((uHV - 1.0) / uHV) + 0.5 / uHV;
      float th = texture2D(uHeight, clamp(huv, 0.0, 1.0)).r;
      if (abs(xz.x) > uHalf || abs(xz.y) > uHalf) th = min(th, -7.5);
      float depth = vWorld.y - th;
      if (depth < -0.02) discard;
      float d = max(depth, 0.0);

      // interactive ripples
      vec2 suv = (xz - uSimOrigin) / uSimSize;
      vec2 e = smoothstep(vec2(0.0), vec2(0.12), suv) * smoothstep(vec2(0.0), vec2(0.12), 1.0 - suv);
      float fade = e.x * e.y;
      suv = suv + 0.5 / uSimN;
      vec4 s = texture2D(uSim, suv);
      vec2 sg = clamp((s.gb - 0.50196) * (0.6 * 255.0 / 127.0), -0.22, 0.22) * fade;
      float sfoam = s.a * fade;

      // swell slope (analytic)
      float dx = cos(xz.x * 0.11 + t * 0.9) * 0.11 * 0.035 + cos(xz.y * 0.087 - t * 0.7 + xz.x * 0.03) * 0.03 * 0.03
        + cos((xz.x + xz.y) * 0.23 + t * 1.7) * 0.23 * 0.012;
      float dz = cos(xz.y * 0.087 - t * 0.7 + xz.x * 0.03) * 0.087 * 0.03 + cos((xz.x + xz.y) * 0.23 + t * 1.7) * 0.23 * 0.012;

      // detail ripples from scrolling noise, calmer with distance (no far-field blotches)
      float camD = length(vWorld - cameraPosition);
      vec2 n1 = texture2D(uNoise, xz * 0.045 + t * vec2(0.010, 0.006)).rg - 0.5;
      vec2 n2 = texture2D(uNoise, xz * 0.12 - t * vec2(0.008, -0.012)).ba - 0.5;
      vec2 detail = n1 * 0.6 + n2 * 0.4;
      float calm = mix(0.3, 0.8, smoothstep(0.1, 1.5, d)) * (1.0 - smoothstep(20.0, 70.0, camD) * 0.75);
      vec3 N = normalize(vec3(-(sg.x * 2.4 + dx) - detail.x * 0.42 * calm, 1.0, -(sg.y * 2.4 + dz) - detail.y * 0.42 * calm));

      vec3 V = normalize(cameraPosition - vWorld);
      float ndv = max(dot(N, V), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

      // body colour: absorption by depth (clear -> turquoise -> blue -> abyss)
      vec3 col = mix(cShallow, cLagoon, smoothstep(0.12, 0.6, d));
      col = mix(col, cDeep, smoothstep(0.8, 1.9, d));
      col = mix(col, cAbyss, smoothstep(2.6, 6.5, d));
      float cloud = mbCloud(xz);
      float ndl = max(dot(N, uSunDir), 0.0);
      col *= (0.78 + 0.3 * ndl) * mix(0.85, 1.0, cloud);
      col += vec3(0.55, 0.95, 0.9) * 0.1 * smoothstep(0.0, 0.1, vSimH) * fade;
      col *= 1.0 - 0.14 * smoothstep(0.0, 0.1, -vSimH) * fade;

      // sky reflection, biased to the warm horizon
      vec3 R = reflect(-V, N);
      vec3 sky = mix(cSkyHorizon, cSkyTop, smoothstep(0.05, 0.7, R.y) * 0.6);
      sky += uSunColor * pow(max(dot(R, uSunDir), 0.0), 24.0) * 0.5;
      col = mix(col, sky, fres * 0.7);

      // sun highlight + restrained glitter inside the sun lobe
      vec3 Hh = normalize(uSunDir + V);
      float nh = max(dot(N, Hh), 0.0);
      float spec = pow(nh, 300.0) * 4.0;
      float lobe = pow(nh, 40.0);
      float sparkle = step(0.86, texture2D(uNoise, xz * 0.8 + vec2(t * 0.06, -t * 0.045)).a);
      col += uSunColor * (spec + sparkle * lobe * 1.2) * cloud;

      // ---- Foam (baked cell distance fields, crisp at any scale)
      float nf = texture2D(uNoise, xz * 0.07 + t * 0.01).g;
      float shore = 1.0 - smoothstep(0.0, 0.05 + nf * 0.06, d);
      float bands = smoothstep(0.62, 0.8, sin(d * (20.0 + nf * 10.0) - t * 1.5 + nf * 7.0)) * (1.0 - smoothstep(0.06, 0.32 + nf * 0.2, d)) * smoothstep(0.0, 0.03, d);
      vec2 warp = (texture2D(uNoise, xz * 0.02 + t * 0.004).rg - 0.5) * 0.35;
      float e1 = texture2D(uCells, xz * 0.055 + warp + vec2(t * 0.006, t * 0.004)).r * 0.6;
      float e2 = texture2D(uCells, xz * 0.11 - warp * 1.3 + vec2(-t * 0.008, t * 0.01)).g * 0.6;
      float lace = 1.0 - smoothstep(0.035, 0.06, e1);
      float lace2 = 1.0 - smoothstep(0.035, 0.06, e2);
      float shallowMask = (1.0 - smoothstep(0.12, 0.45, d)) * smoothstep(0.45, 0.7, nf);
      float capMask = smoothstep(0.7, 0.8, texture2D(uNoise, xz * 0.012 - t * 0.003).b) * smoothstep(1.2, 2.6, d);
      float wakeMask = smoothstep(0.03, 0.45, sfoam);
      float foam = max(shore, bands);
      foam = max(foam, lace * max(shallowMask * 0.8, capMask * 0.65));
      foam = max(foam, max(lace, lace2) * wakeMask);
      foam = max(foam, smoothstep(0.8, 1.0, sfoam) * 0.65);
      float crest = smoothstep(0.06, 0.16, vSimH) * fade;
      foam = max(foam, lace2 * crest * 0.6);
      foam = clamp(foam, 0.0, 1.0);
      col = mix(col, cFoam * (0.82 + 0.25 * ndl) * mix(0.88, 1.0, cloud), foam * 0.94);

      // transparency (shallow water shows the sand + caustics)
      float a = smoothstep(0.0, 0.04, d) * mix(0.3, 0.96, smoothstep(0.06, 1.0, d));
      a = max(a, fres * 0.5 * smoothstep(0.0, 0.05, d));
      a = max(a, foam * 0.95);

      // fog
      float ff = smoothstep(uFogNear, uFogFar, camD);
      col = mix(col, uFogColor, ff);
      a = mix(a, 1.0, ff);

      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(makeWaterGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  return {
    mesh,
    update(focusX, focusZ) {
      mesh.position.set(Math.round(focusX / 4) * 4, 0, Math.round(focusZ / 4) * 4);
      waves.pack();
      simTex.needsUpdate = true;
      uniforms.uSimOrigin.value.set(waves.ox, waves.oz);
      uniforms.uFogNear.value = fog.near; uniforms.uFogFar.value = fog.far;
    },
  };
}
