// Shared GLSL snippets, procedural textures, and the material patcher used across the world.
import * as THREE from 'three';

export const PALETTE = {
  sun: new THREE.Color('#ffd6a0'),
  sky: new THREE.Color('#a7a8ee'),
  groundBounce: new THREE.Color('#d69a78'),
  fog: new THREE.Color('#cdb4d6'),
  horizon: new THREE.Color('#f6c9a6'),
  zenith: new THREE.Color('#7f8fd8'),
  shallow: new THREE.Color('#62dcc8'),
  lagoon: new THREE.Color('#14a2b4'),
  deep: new THREE.Color('#1a5aa0'),
  abyss: new THREE.Color('#252f6b'),
  foam: new THREE.Color('#fffaf0'),
  underwater: new THREE.Color('#1f9fae'),
};

// Global uniforms shared (by reference) by every patched material.
export const U = {
  uTime: { value: 0 },
  uNoise: { value: null },
  uSunDir: { value: new THREE.Vector3(-0.45, 0.42, 0.79).normalize() },
  uSunColor: { value: PALETTE.sun.clone() },
  uCarPos: { value: new THREE.Vector3() },
  uCarVel: { value: new THREE.Vector2() },
  uWaterLevel: { value: 0 },
  uUnderTint: { value: PALETTE.underwater.clone() },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uCutout: { value: 0 },
};

// Tileable value-noise texture (RGBA = 4 independent octaves/patterns), repeat-wrapped.
export function makeNoiseTexture(size = 256, seed = 3) {
  const data = new Uint8Array(size * size * 4);
  const rand = (i, j, c, period) => {
    i = ((i % period) + period) % period; j = ((j % period) + period) % period;
    const s = Math.sin(i * 127.1 + j * 311.7 + c * 74.7 + seed * 19.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const vnoise = (x, y, c, period) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = smooth(x - i), fy = smooth(y - j);
    const a = rand(i, j, c, period), b = rand(i + 1, j, c, period);
    const d = rand(i, j + 1, c, period), e = rand(i + 1, j + 1, c, period);
    return (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    for (let c = 0; c < 4; c++) {
      const base = [8, 16, 32, 64][c];
      let v = 0, amp = 0.55, tot = 0, f = base;
      for (let k = 0; k < 3; k++) {
        v += vnoise((x / size) * f, (y / size) * f, c + k * 4, f) * amp;
        tot += amp; amp *= 0.5; f *= 2;
      }
      data[o + c] = Math.round((v / tot) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCarPos;
uniform vec2 uCarVel;
uniform float uWaterLevel;
uniform vec3 uUnderTint;
uniform vec2 uWind;
uniform float uCutout;
float mbBayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[k] + 0.5) / 16.0;
}

vec2 mbHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Voronoi: returns (F1, F2) distances. Animated feature points.
vec2 mbVoronoi(vec2 p, float t) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = mbHash2(ip + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    float d = length(g + o - fp);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return vec2(f1, f2);
}
float mbNoise(vec2 p) { return texture2D(uNoise, p).r; }
float mbCaustic(vec2 p, float t) {
  vec2 w = vec2(texture2D(uNoise, p * 0.021 + t * 0.006).g, texture2D(uNoise, p * 0.021 - t * 0.005 + 0.37).b) - 0.5;
  vec2 v1 = mbVoronoi(p * 0.55 + w * 1.6, t * 0.9);
  vec2 v2 = mbVoronoi(p * 0.42 - w * 1.2 + 3.7, t * 0.7 + 1.3);
  float c1 = 1.0 - smoothstep(0.0, 0.18, v1.y - v1.x);
  float c2 = 1.0 - smoothstep(0.0, 0.22, v2.y - v2.x);
  return c1 * 0.65 + c2 * 0.5;
}
float mbCloud(vec2 xz) {
  vec2 uv = xz * 0.0028 + uWind * uTime * 0.0016;
  float n = texture2D(uNoise, uv).r * 0.65 + texture2D(uNoise, uv * 2.3 + 0.31).g * 0.35;
  return mix(0.62, 1.0, smoothstep(0.38, 0.6, n));
}
`;

// Patch a Lambert/Standard material: world position varying, optional wind sway,
// optional car push (grass), cloud shadows, underwater tint + caustics, wet sand line.
export function patchMaterial(mat, opts = {}) {
  const o = {
    world: true, clouds: true, underwater: true, caustics: true, wetline: false,
    wind: 0, push: 0, detail: 0, ...opts,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nvarying vec3 vMbWorld;\n${o.wind || o.push ? 'attribute float aSway;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      ${o.wind || o.push ? `
      {
        #ifdef USE_INSTANCING
          vec3 ipos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 ipos = vec3(0.0);
        #endif
        vec3 wp0 = (modelMatrix * vec4(ipos, 1.0)).xyz;
        float hgt = max(0.0, transformed.y) * aSway;
        float ph = dot(wp0.xz, vec2(0.21, 0.17));
        float gust = texture2D(uNoise, wp0.xz * 0.006 + uWind * uTime * 0.012).r;
        vec2 sway = uWind * (sin(uTime * 1.9 + ph) * 0.5 + 0.5 + gust * 1.4) * ${(+o.wind).toFixed(3)} * hgt * hgt;
        ${o.push ? `
        vec2 dc = wp0.xz - uCarPos.xz;
        float dd = length(dc);
        float pushK = (1.0 - smoothstep(0.6, ${(+o.push).toFixed(2)}, dd)) * step(abs(wp0.y - uCarPos.y), 2.5);
        sway += normalize(dc + 1e-4) * pushK * hgt * 0.95;
        transformed.y -= pushK * hgt * 0.35;
        ` : ''}
        #ifdef USE_INSTANCING
          // convert world-space sway into instance-local space (approx: inverse rotation via transpose)
          mat3 im = mat3(instanceMatrix);
          vec3 lsway = transpose(im) * vec3(sway.x, 0.0, sway.y);
          float isc = max(1e-3, length(im[0]));
          transformed += lsway / (isc * isc);
        #else
          transformed.xz += sway;
        #endif
      }` : ''}
      `)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 mbw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mbw = instanceMatrix * mbw;
        #endif
        vMbWorld = (modelMatrix * mbw).xyz;
      }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nvarying vec3 vMbWorld;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      ${o.cutout ? `
      {
        vec3 tgt = uCarPos + vec3(0.0, 0.8, 0.0);
        vec3 ab = tgt - cameraPosition;
        float tt = clamp(dot(vMbWorld - cameraPosition, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
        float dd = length(vMbWorld - (cameraPosition + ab * tt));
        float k = (1.0 - smoothstep(1.5, 3.4, dd)) * (1.0 - smoothstep(0.78, 0.92, tt));
        k = max(k, 1.0 - smoothstep(3.0, 6.0, length(vMbWorld - cameraPosition)));
        ${o.cutout === 2 ? 'k *= smoothstep(uCarPos.y + 0.9, uCarPos.y + 1.6, vMbWorld.y);' : ''}
        k *= uCutout;
        if (k > 0.001 && k * 1.08 > mbBayer(gl_FragCoord.xy)) discard;
      }` : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      ${o.detail ? `
      {
        float gn = texture2D(uNoise, vMbWorld.xz * 0.35).a;
        float gn2 = texture2D(uNoise, vMbWorld.xz * 0.045).g;
        diffuseColor.rgb *= 0.9 + gn * 0.16 + (gn2 - 0.5) * 0.12;
      }` : ''}
      ${o.wetline ? `
      {
        float above = vMbWorld.y - uWaterLevel;
        float lap = sin(uTime * 0.8 + vMbWorld.x * 0.05 + vMbWorld.z * 0.04) * 0.06;
        float wet = 1.0 - smoothstep(0.02 + lap, 0.42 + lap, above);
        diffuseColor.rgb *= mix(1.0, 0.74, wet * step(-0.05, above));
      }` : ''}
      ${o.underwater ? `
      float mbDepth = uWaterLevel - vMbWorld.y;
      if (mbDepth > 0.0) {
        float k = 1.0 - exp(-mbDepth * 1.25);
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.78, 0.95, 0.96), uUnderTint * 0.5, k);
      }` : ''}
      `)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      ${o.clouds ? 'reflectedLight.directDiffuse *= mbCloud(vMbWorld.xz);' : ''}
      ${o.caustics ? `
      {
        float dpt = uWaterLevel - vMbWorld.y;
        if (dpt > 0.0) {
          float c = mbCaustic(vMbWorld.xz, uTime);
          float fade = smoothstep(0.0, 0.25, dpt) * exp(-dpt * 0.55);
          reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * c * fade * 1.35 * mbCloud(vMbWorld.xz);
        }
      }` : ''}
      `);
    if (o.extraFrag) shader.fragmentShader = o.extraFrag(shader.fragmentShader);
    if (o.extraVert) shader.vertexShader = o.extraVert(shader.vertexShader);
  };
  mat.customProgramCacheKey = () => JSON.stringify(o, (k, v) => (typeof v === 'function' ? v.toString().length : v));
  return mat;
}
