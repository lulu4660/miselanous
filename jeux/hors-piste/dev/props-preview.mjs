// Preview of the baked vegetation / rock props (src/assets/props.gen.js), one row per kind, every
// variant side by side at its in-game size, lit like the game (low warm sun, sky fill).
// node dev/props-preview.mjs [out.png] [kinds,comma]   env: SNOW=1 (snow on up-facing faces, like the snow biome)
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/props-preview.png';
const kinds = (process.argv[3] || 'pine,tree,bush,rock,mesa,cactus').split(',');
mkdirSync(dirname(out), { recursive: true });
const root = resolve(import.meta.dirname, '..');
const entry = `
import * as THREE from 'three';
import { PROP_ASSETS } from './src/assets/props.gen.js';
import { propVariants } from './src/gfx/assetProps.js';
const kinds = ${JSON.stringify(kinds)};
const SNOW = ${process.env.SNOW ? 1 : 0};
const GREY = ${Number(process.env.GREY || 0)}, TINT = '${process.env.TINT || '#ffffff'}'; // rocks: greyed and tinted like in the game
const TARGET = { pine: 7.5, tree: 6.2, bush: 1.1, cactus: 3, rock: 0, mesa: 0 }; // heights (m); rocks/mesas by width
const WIDTH = { rock: 3, mesa: 12 };
const W = 1400, H = 360;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H * kinds.length); renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
document.body.style.margin = '0'; document.body.appendChild(renderer.domElement);
const info = {};
kinds.forEach((kind, row) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SNOW ? '#dfe6f0' : '#c9dbe6');
  scene.add(new THREE.HemisphereLight('#cfe0ff', '#8a7f68', 1.1));
  const sun = new THREE.DirectionalLight('#ffe2b8', 2.6); sun.position.set(-30, 25, 30); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 40, bottom: -10, far: 200 }); sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  const names = PROP_ASSETS[kind].map((p) => p.name).sort();
  const V = propVariants(kind, names, { sway: 0, grey: kind === 'rock' ? GREY : 0 });
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: /rock|mesa|cactus/.test(kind) ? THREE.FrontSide : THREE.DoubleSide });
  if (SNOW && kind === 'pine') mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\\nvarying float vUpN;').replace('#include <begin_vertex>', '#include <begin_vertex>\\nvUpN = normalize(mat3(modelMatrix) * objectNormal).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\\nvarying float vUpN;').replace('#include <color_fragment>', '#include <color_fragment>\\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), smoothstep(0.5, 0.85, gl_FrontFacing ? vUpN : -vUpN) * 0.92);');
  };
  let x = 0; const sizes = [];
  for (const v of V) {
    const s = TARGET[kind] ? TARGET[kind] / v.h : WIDTH[kind] / v.w;
    const m = new THREE.Mesh(v.geo, kind === 'rock' ? Object.assign(mat.clone(), { color: new THREE.Color(TINT) }) : mat); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true;
    x += v.w * s * 0.6; m.position.x = x; x += v.w * s * 0.6 + 0.5; scene.add(m);
    sizes.push(v.name + ' ' + v.tris + 't');
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: SNOW ? '#eef2f8' : '#7f9a58' }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const hMax = Math.max(...V.map((v) => (TARGET[kind] ? TARGET[kind] : v.h * WIDTH[kind] / v.w)));
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 1000);
  const dist = Math.max(x / 2 / Math.tan(15 * Math.PI / 180) / (W / H), hMax * 2.4);
  cam.position.set(x / 2, ${process.env.CAMY || 0.75} * hMax, dist); cam.lookAt(x / 2, hMax * 0.45, 0);
  sun.target.position.set(x / 2, 0, 0); scene.add(sun.target);
  const y = (kinds.length - 1 - row) * H;
  renderer.setViewport(0, y, W, H); renderer.setScissor(0, y, W, H);
  renderer.render(scene, cam);
  info[kind] = sizes.join(', ');
});
window.__info = info; window.__done = true;
`;
const res = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, write: false, format: 'esm', logLevel: 'error' });
const html = `<html><body><script type="module">${res.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
const tmp = resolve(dirname(out), 'props-preview.html');
writeFileSync(tmp, html);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 360 * kinds.length } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('file://' + tmp);
await page.waitForFunction(() => window.__done, null, { timeout: 120000 });
console.log(await page.evaluate(() => window.__info));
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
