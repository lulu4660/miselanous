// Late-afternoon sky dome (deep zenith, warm horizon, sun disc and glare, lit cumulus band and
// high cirrus) and a ring of distant mountains around the map whose style follows the region
// behind it: alpine peaks with snow caps behind the snowfields, blue rolling hills behind the
// tarmac country, red mesas and buttes behind the canyons. The mountains are hazed by hand
// (they sit far beyond the scene fog) and their haze follows the fog colour.
import * as THREE from 'three';
import { U } from './shaders.js';
import { createNoise2D } from '../noise.js';

export function createSky(world) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: U.uSunDir, uTime: U.uTime, uNoise: U.uNoise,
      cZenith: { value: new THREE.Color('#4a74c8') },
      cHorizon: { value: new THREE.Color('#f0d6b8') },
      cGlow: { value: new THREE.Color('#ffbf80') },
      cSun: { value: new THREE.Color('#fff4da') },
      cHaze: { value: new THREE.Color('#d8c8bc') },
      cCloudLit: { value: new THREE.Color('#fff2e0') },
      cCloudShade: { value: new THREE.Color('#9aa3c6') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir; uniform float uTime; uniform sampler2D uNoise;
      uniform vec3 cZenith, cHorizon, cGlow, cSun, cHaze, cCloudLit, cCloudShade;
      varying vec3 vDir;
      float fbm(vec2 p) { return texture2D(uNoise, p).r * 0.5 + texture2D(uNoise, p * 2.03 + 0.31).g * 0.3 + texture2D(uNoise, p * 4.1 + 0.67).b * 0.2; }
      void main() {
        vec3 d = normalize(vDir);
        vec3 s = normalize(uSunDir);
        float y = d.y;
        float sd = max(dot(d, s), 0.0);
        // sky gradient: warm, bright horizon to a deep zenith
        vec3 col = mix(cHorizon, cZenith, pow(smoothstep(-0.02, 0.95, y), 0.5));
        // the sun side of the sky is warmer and brighter low down (forward scattering)
        float low = 1.0 - smoothstep(0.0, 0.55, y);
        col = mix(col, col * 0.55 + cGlow * 0.6, pow(sd, 5.0) * low * 0.7);
        // high thin cirrus
        vec2 cq = d.xz / max(0.12, y + 0.25) * 0.08 + vec2(uTime * 0.0006, 0.0);
        float ci = smoothstep(0.52, 0.8, fbm(cq * vec2(1.0, 3.5))) * smoothstep(0.12, 0.35, y);
        col = mix(col, mix(cCloudLit, cGlow, 0.25), ci * 0.35);
        // cumulus band above the horizon, lit from the sun side, shaded underneath
        vec2 cp = d.xz / max(0.07, y + 0.16) * 0.2 + vec2(uTime * 0.0015, 0.0);
        float c = fbm(cp);
        float cm = smoothstep(0.5, 0.66, c) * smoothstep(0.015, 0.1, y) * (1.0 - smoothstep(0.3, 0.6, y));
        vec2 toSun = normalize(s.xz + 1e-4) * 0.02;
        float lit = clamp((c - fbm(cp + toSun)) * 6.0 + 0.55, 0.0, 1.0);
        vec3 cloud = mix(cCloudShade, cCloudLit, lit);
        cloud += cGlow * pow(sd, 4.0) * 0.35 * (1.0 - cm * 0.5); // silver lining toward the sun
        col = mix(col, cloud, cm * 0.92);
        // sun disc and glare
        col += cSun * (pow(sd, 1800.0) * 9.0 + pow(sd, 90.0) * 0.6 + pow(sd, 10.0) * 0.12);
        // below the horizon: haze
        col = mix(col, cHaze, 1.0 - smoothstep(-0.12, 0.02, y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 20), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // ---- distant mountains
  const n = createNoise2D(4242);
  const SEG = 220, RINGS = 7;
  const pos = [], col = [], idx = [];
  const bw = [0, 0, 0];
  const c = new THREE.Color(), tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const SNOW = new THREE.Color('#f4f7fc'), ROCKB = new THREE.Color('#7d86a6'), HILL = new THREE.Color('#6f8fa8'), HILL2 = new THREE.Color('#8faab0');
  const MESA = [new THREE.Color('#c0704a'), new THREE.Color('#d99566'), new THREE.Color('#a85a40'), new THREE.Color('#e2b08a')];
  const sun = U.uSunDir.value;
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const sx = Math.sin(a), sz = Math.cos(a);
    // what lies behind this direction (sampled at the map edge, smoothed by the blend)
    world.biomeWeights(sx * 470, sz * 470, bw);
    const [ws, wa, wd] = bw;
    for (let r = 0; r <= RINGS; r++) {
      const t = r / RINGS; // 0 = foot (near), 1 = crest (far)
      const radius = 640 + t * 360 + n(a * 3, 7) * 60;
      // ridge heights per style
      const alp = Math.pow(Math.max(0, n(a * 9, 1) * 0.5 + 0.5), 1.6) * 260 + Math.abs(n(a * 23, 2)) * 90 + 60;
      const hil = (n(a * 5, 3) * 0.5 + 0.5) * 90 + Math.abs(n(a * 14, 4)) * 30 + 30;
      const mes = (n(a * 6, 5) > 0.05 ? 150 : 70) + n(a * 30, 6) * 8; // flat tops, steep sides
      const ridge = alp * ws + hil * wa + mes * wd;
      const prof = wd > 0.5 ? Math.min(1, Math.pow(t * 1.25, 0.35)) : Math.sin(t * Math.PI * 0.5);
      const h = 20 + ridge * prof * (0.85 + 0.15 * n(a * 40, r));
      pos.push(sx * radius, h, sz * radius);
      // colour: snow caps above a ragged line, rock below; hills in blue-green haze; mesa strata
      const snowLine = 150 + n(a * 30, 9) * 25;
      const alpC = h > snowLine ? SNOW : tmp.copy(ROCKB).lerp(SNOW, Math.max(0, (h - snowLine + 60) / 120) * 0.4);
      const hilC = tmp2.copy(HILL).lerp(HILL2, n(a * 11, r) * 0.5 + 0.5);
      const mesC = MESA[Math.floor(Math.abs(h * 0.06 + n(a * 4, 2) * 2)) % 4];
      c.setRGB(0, 0, 0);
      c.r = alpC.r * ws + hilC.r * wa + mesC.r * wd;
      c.g = alpC.g * ws + hilC.g * wa + mesC.g * wd;
      c.b = alpC.b * ws + hilC.b * wa + mesC.b * wd;
      // baked light: faces turned toward the sun are brighter
      const face = Math.max(0, -(sx * sun.x + sz * sun.z)) * 0.35 + 0.75;
      c.multiplyScalar(face);
      col.push(c.r, c.g, c.b);
    }
  }
  const V = RINGS + 1;
  for (let i = 0; i < SEG; i++) for (let r = 0; r < RINGS; r++) {
    const a0 = i * V + r, b0 = a0 + V;
    idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mtnMat = new THREE.ShaderMaterial({
    uniforms: { uHaze: { value: new THREE.Color('#e2d6c8') }, uAmt: { value: 0.42 } },
    vertexShader: /* glsl */`
      attribute vec3 color; varying vec3 vC; varying float vH;
      void main() { vC = color; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHaze; uniform float uAmt; varying vec3 vC; varying float vH;
      void main() {
        // aerial perspective: the feet sink into the haze, the crests stand out
        float a = mix(uAmt + 0.35, uAmt, smoothstep(10.0, 140.0, vH));
        gl_FragColor = vec4(mix(vC, uHaze, a), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, fog: false, depthWrite: true,
  });
  const mountains = new THREE.Mesh(g, mtnMat);
  mountains.frustumCulled = false;
  mountains.renderOrder = -5;
  group.add(mountains);
  return { group, dome, mountains, haze: mtnMat.uniforms.uHaze };
}
