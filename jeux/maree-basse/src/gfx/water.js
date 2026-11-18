// Stylised lagoon water: depth colour from the terrain heightmap, interactive ripples,
// shore foam, cellular foam lace, sky reflection, sun glitter.
import * as THREE from 'three';
import { U, GLSL_COMMON, PALETTE } from './shaders.js';

function makeWaterGeometry(M = 90) {
  const n = 2 * M + 1;
  const pos = new Float32Array(n * n * 3);
  const f = (u) => Math.sign(u) * (55 * Math.abs(u) + 1445 * Math.pow(Math.abs(u), 5));
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
    cSkyTop: { value: new THREE.Color('#9aa2e6') },
    cSkyHorizon: { value: new THREE.Color('#ffd6bd') },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density },
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
    uniform vec3 uFogColor; uniform float uFogDensity;
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
      vec2 sg = (s.gb - 0.50196) * (0.6 * 255.0 / 127.0) * fade;
      float sfoam = s.a * fade;

      // swell slope (analytic)
      float dx = cos(xz.x * 0.11 + t * 0.9) * 0.11 * 0.035 + cos(xz.y * 0.087 - t * 0.7 + xz.x * 0.03) * 0.03 * 0.03
        + cos((xz.x + xz.y) * 0.23 + t * 1.7) * 0.23 * 0.012;
      float dz = cos(xz.y * 0.087 - t * 0.7 + xz.x * 0.03) * 0.087 * 0.03 + cos((xz.x + xz.y) * 0.23 + t * 1.7) * 0.23 * 0.012;

      // detail ripples from scrolling noise
      vec2 n1 = texture2D(uNoise, xz * 0.045 + t * vec2(0.010, 0.006)).rg - 0.5;
      vec2 n2 = texture2D(uNoise, xz * 0.11 - t * vec2(0.008, -0.012)).ba - 0.5;
      vec2 n3 = texture2D(uNoise, xz * 0.31 + t * vec2(-0.02, 0.017)).gr - 0.5;
      vec2 detail = n1 * 0.55 + n2 * 0.45 + n3 * 0.25;
      float calm = mix(0.35, 1.0, smoothstep(0.1, 1.5, d));
      vec3 N = normalize(vec3(-(sg.x * 1.6 + dx) - detail.x * 0.5 * calm, 1.0, -(sg.y * 1.6 + dz) - detail.y * 0.5 * calm));

      vec3 V = normalize(cameraPosition - vWorld);
      float ndv = max(dot(N, V), 0.0);
      float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);

      // body colour by depth
      vec3 col = mix(cShallow, cLagoon, smoothstep(0.05, 0.75, d));
      col = mix(col, cDeep, smoothstep(0.9, 2.8, d));
      col = mix(col, cAbyss, smoothstep(3.0, 7.0, d));
      float cloud = mbCloud(xz);
      float ndl = max(dot(N, uSunDir), 0.0);
      col *= (0.62 + 0.45 * ndl) * mix(0.8, 1.0, cloud);
      // light scattering through wave crests
      col += cLagoon * 0.25 * smoothstep(0.0, 0.12, vSimH) * fade;

      // sky reflection
      vec3 R = reflect(-V, N);
      vec3 sky = mix(cSkyHorizon, cSkyTop, smoothstep(-0.05, 0.55, R.y));
      sky += uSunColor * pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.6;
      col = mix(col, sky, fres * 0.85);

      // sun highlight + golden glitter
      vec3 Hh = normalize(uSunDir + V);
      float nh = max(dot(N, Hh), 0.0);
      float spec = pow(nh, 260.0) * 5.0;
      float lobe = pow(nh, 22.0);
      float sparkle = smoothstep(0.80, 0.94, texture2D(uNoise, xz * 0.9 + vec2(t * 0.07, -t * 0.05)).a
        * texture2D(uNoise, xz * 1.7 - vec2(t * 0.05, t * 0.09)).r * 1.9);
      col += uSunColor * (spec + sparkle * lobe * 2.6) * cloud;

      // ---- Foam
      float nf = texture2D(uNoise, xz * 0.07 + t * 0.01).g;
      // shore line + receding bands
      float shore = 1.0 - smoothstep(0.0, 0.07 + nf * 0.05, d);
      float bands = smoothstep(0.55, 0.85, sin(d * 26.0 - t * 1.7 + nf * 7.0)) * (1.0 - smoothstep(0.08, 0.42, d)) * smoothstep(0.0, 0.03, d);
      // cellular lace (animated)
      vec2 warp = (texture2D(uNoise, xz * 0.02 + t * 0.004).rg - 0.5) * 3.0;
      vec2 vor = mbVoronoi(xz * 0.42 + warp, t * 0.45);
      float lace = 1.0 - smoothstep(0.03, 0.09, vor.y - vor.x);
      vec2 vor2 = mbVoronoi(xz * 0.9 - warp * 1.3 + 7.0, t * 0.6);
      float lace2 = 1.0 - smoothstep(0.03, 0.08, vor2.y - vor2.x);
      float shallowMask = (1.0 - smoothstep(0.15, 0.75, d)) * smoothstep(0.35, 0.65, nf);
      float capMask = smoothstep(0.66, 0.78, texture2D(uNoise, xz * 0.012 - t * 0.003).b) * smoothstep(1.0, 2.5, d);
      float wakeMask = smoothstep(0.03, 0.5, sfoam);
      float foam = max(shore, bands);
      foam = max(foam, lace * max(shallowMask * 0.85, capMask * 0.7));
      foam = max(foam, max(lace, lace2 * 0.9) * wakeMask);
      foam = max(foam, smoothstep(0.55, 0.95, sfoam) * 0.9);
      foam = clamp(foam, 0.0, 1.0);
      col = mix(col, cFoam * (0.78 + 0.32 * ndl) * mix(0.85, 1.0, cloud), foam * 0.92);

      // transparency (shallow water shows the sand + caustics)
      float a = smoothstep(0.0, 0.05, d) * mix(0.42, 0.97, smoothstep(0.03, 1.25, d));
      a = max(a, fres * 0.6 * smoothstep(0.0, 0.05, d));
      a = max(a, foam * 0.95);

      // fog
      float fd = length(vWorld - cameraPosition);
      float ff = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
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
      uniforms.uFogDensity.value = fog.density;
    },
  };
}
