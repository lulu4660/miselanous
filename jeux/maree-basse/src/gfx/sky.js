// Golden-hour sky dome with sun halo and painted clouds, plus hazy distant islands.
import * as THREE from 'three';
import { U } from './shaders.js';
import { createNoise2D } from '../noise.js';

export function createSky() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: U.uSunDir, uTime: U.uTime, uNoise: U.uNoise,
      cZenith: { value: new THREE.Color('#8494dc') },
      cMid: { value: new THREE.Color('#c3b2e4') },
      cHorizon: { value: new THREE.Color('#ffcfae') },
      cSun: { value: new THREE.Color('#fff0cc') },
      cHaze: { value: new THREE.Color('#d9b9d2') },
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
      uniform vec3 cZenith, cMid, cHorizon, cSun, cHaze;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.22, y));
        col = mix(col, cZenith, smoothstep(0.2, 0.75, y));
        col = mix(col, cHaze, 1.0 - smoothstep(-0.08, 0.06, y));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += cSun * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.45 + pow(sd, 8.0) * 0.22);
        // painted clouds: bands of noise near the horizon
        vec2 cp = d.xz / max(0.08, y + 0.18) * 0.22 + vec2(uTime * 0.0015, 0.0);
        float c = texture2D(uNoise, cp).r * 0.6 + texture2D(uNoise, cp * 2.1 + 0.4).g * 0.4;
        float cm = smoothstep(0.55, 0.72, c) * smoothstep(0.02, 0.12, y) * (1.0 - smoothstep(0.35, 0.7, y));
        vec3 cloudCol = mix(vec3(1.0, 0.86, 0.78), vec3(1.0, 0.95, 0.85), pow(sd, 3.0));
        cloudCol = mix(cloudCol, cMid * 1.05, 0.3);
        col = mix(col, cloudCol, cm * 0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // Distant islands / mesas silhouettes, lavender with fog.
  const n = createNoise2D(77);
  const islandMat = new THREE.MeshLambertMaterial({ color: '#b48fa8', flatShading: true });
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2 + n(k, 1) * 0.3;
    const r = 520 + (n(k, 5) * 0.5 + 0.5) * 280;
    const w = 90 + (n(k, 9) * 0.5 + 0.5) * 140;
    const hgt = 18 + (n(k, 13) * 0.5 + 0.5) * 42;
    const geo = new THREE.CylinderGeometry(w * 0.55, w * 0.7, hgt, 9, 3, false);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const j = 1 + n(x * 0.02 + k, z * 0.02) * 0.25;
      p.setXYZ(i, x * j, y + (y > 0 ? n(x * 0.03, z * 0.03 + k) * hgt * 0.25 : 0), z * j);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, islandMat);
    m.position.set(Math.sin(a) * r, hgt / 2 - 6, Math.cos(a) * r);
    m.scale.z = 0.6 + (n(k, 3) * 0.5 + 0.5) * 0.8;
    m.rotation.y = a;
    group.add(m);
  }
  return { group, dome };
}
