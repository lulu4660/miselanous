// Post-processing with three.js addons: MSAA render target → bloom (UnrealBloomPass) →
// miniature tilt-shift (Horizontal/VerticalTiltShiftShader with an in-focus band) →
// colour grade + vignette (ShaderPass) → OutputPass (tone mapping + sRGB).
// Effects levels: 0 = direct render, 1 = grade, 2 = + tilt-shift, 3 = + bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

// keep a sharp band around the focus line, blur grows beyond it
function withFocusBand(shader) {
  const s = THREE.UniformsUtils.clone ? { ...shader, uniforms: THREE.UniformsUtils.clone(shader.uniforms) } : shader;
  s.uniforms.band = { value: 0.24 };
  s.fragmentShader = shader.fragmentShader
    .replace('uniform float r;', 'uniform float r;\nuniform float band;')
    .replace(/abs\(\s*r\s*-\s*vUv\.y\s*\)/g, 'max( 0.0, abs( r - vUv.y ) - band )');
  return s;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uShadow: { value: new THREE.Color('#7f7fd6') },   // lavender shadows
    uHigh: { value: new THREE.Color('#ffd9a8') },     // warm highlights
    uSat: { value: 1.12 },
    uVignette: { value: 0.32 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec3 uShadow; uniform vec3 uHigh; uniform float uSat; uniform float uVignette; uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      // split toning (in linear light, before tone mapping)
      float sh = 1.0 - smoothstep(0.0, 0.35, l);
      float hi = smoothstep(0.45, 1.3, l);
      c.rgb = mix(c.rgb, c.rgb * uShadow * 1.35, sh * 0.32);
      c.rgb = mix(c.rgb, c.rgb * uHigh * 1.08, hi * 0.35);
      // saturation
      c.rgb = max(vec3(0.0), mix(vec3(l), c.rgb, uSat));
      // soft warm vignette
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.35, 0.95, length(d) * 1.15);
      c.rgb *= mix(1.0, 0.72, v * uVignette / 0.32);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.0, 0.86, 0.95), v * 0.25);
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera) {
  const gl = renderer.getContext();
  const halfOK = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.55, 0.92);
  const tiltH = new ShaderPass(withFocusBand(HorizontalTiltShiftShader));
  const tiltV = new ShaderPass(withFocusBand(VerticalTiltShiftShader));
  const grade = new ShaderPass(GradeShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(tiltH);
  composer.addPass(tiltV);
  composer.addPass(grade);
  composer.addPass(output);

  const post = {
    level: 0, broken: false, checked: false,
    passes: { bloom, tiltH, tiltV, grade },
    setLevel(n) {
      post.level = post.broken ? 0 : Math.max(0, Math.min(3, n));
      bloom.enabled = post.level >= 3;
      tiltH.enabled = tiltV.enabled = post.level >= 2;
      grade.enabled = post.level >= 1;
    },
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      bloom.resolution.set(w * pr / 2, h * pr / 2);
      const pw = Math.max(1, w * pr);
      tiltH.uniforms.h.value = 2.0 / pw;
      tiltV.uniforms.v.value = 2.0 / (h * pr);
      grade.uniforms.uAspect.value = w / h;
    },
    setFocus(r) { tiltH.uniforms.r.value = r; tiltV.uniforms.r.value = r; },
    render(dt) {
      if (post.level === 0 || post.broken) { renderer.render(scene, camera); return; }
      try {
        composer.render(dt);
      } catch (e) {
        post.broken = true; post.setLevel(0);
        renderer.render(scene, camera);
        return;
      }
      if (!post.checked) {
        // first frame: if the half-float/MSAA chain produced nothing, fall back to direct rendering
        post.checked = true;
        const px = new Uint8Array(4);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        let lit = 0;
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.7], [0.7, 0.3]]) {
          gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          lit += px[0] + px[1] + px[2];
        }
        if (lit === 0 || gl.getError() !== gl.NO_ERROR && lit === 0) {
          post.broken = true; post.setLevel(0);
          renderer.render(scene, camera);
        }
      }
    },
  };
  return post;
}
