// Preview candidate GLB models in the game's light (warm low sun, sky fill, sky reflections),
// two chase-like views per model, auto-fitted to a 4.2 m car length.
// node dev/glb-preview.mjs out.png a.glb[,label] b.glb[,label] ...
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2];
const items = process.argv.slice(3).map((a, i) => { const [f, label] = a.split(','); return { f, label: label || `m${i}`, url: `https://assets.local/${i}.glb` }; });
const root = resolve(import.meta.dirname, '..');
const entry = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const items = ${JSON.stringify(items.map(({ label, url }) => ({ label, url })))};
const CW = 560, CH = 360;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(CW * 2, CH * items.length); renderer.setScissorTest(true);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
document.body.style.margin = '0'; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
{
  const envScene = new THREE.Scene(); const sg = new THREE.SphereGeometry(50, 24, 16); const cols = []; const p = sg.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 50; if (y > 0) c.set('#4a74c8').lerp(new THREE.Color('#f0d6b8'), 1 - Math.pow(y, 0.5)); else c.set('#d8c8bc').lerp(new THREE.Color('#8a7a62'), Math.min(1, -y * 2)); cols.push(c.r, c.g, c.b); }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.04).texture; scene.environmentIntensity = 0.6;
}
scene.add(new THREE.HemisphereLight('#b3c6ef', '#cfb28c', 0.95));
const sun = new THREE.DirectionalLight('#ffd9ae', 4.3); sun.position.set(-5, 4.5, 7.4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 }); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: '#b98a62' })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const cam = new THREE.PerspectiveCamera(30, CW / CH, 0.1, 200);
const loader = new GLTFLoader();
const info = [];
(async () => {
  const models = [];
  for (const it of items) {
    const g = await loader.loadAsync(it.url);
    const m = g.scene; m.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(m); const size = box.getSize(new THREE.Vector3());
    // forward = longest horizontal axis -> +z
    if (size.x > size.z) m.rotation.y = Math.PI / 2;
    m.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(m); const s2 = box.getSize(new THREE.Vector3());
    const k = 4.2 / Math.max(s2.x, s2.z); m.scale.multiplyScalar(k); m.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(m); const c = box.getCenter(new THREE.Vector3());
    m.position.x -= c.x; m.position.z -= c.z; m.position.y -= box.min.y;
    let tris = 0, meshes = 0, texs = new Set();
    m.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const mm = o.material; for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (mm[key]) texs.add(mm[key].image ? (mm[key].image.width + 'x' + mm[key].image.height) : '?'); } });
    info.push({ label: it.label, tris, meshes, texs: [...texs] });
    m.visible = false; scene.add(m); models.push(m);
  }
  const views = [[6.0, 2.6, -7.5], [-6.5, 2.2, 6.0]];
  models.forEach((m, row) => {
    models.forEach((o) => (o.visible = o === m));
    views.forEach((v, col) => {
      cam.position.set(...v); cam.lookAt(0, 0.6, 0);
      const x = col * CW, y = (models.length - 1 - row) * CH;
      renderer.setViewport(x, y, CW, CH); renderer.setScissor(x, y, CW, CH); renderer.setClearColor('#e9d4bd'); renderer.render(scene, cam);
    });
  });
  window.__info = info; window.__done = true;
})().catch((e) => { window.__err = String(e && e.stack || e); window.__done = true; });
`;
const res = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, format: 'iife', write: false, logLevel: 'warning' });
const htmlPath = out.replace(/\.png$/, '.html');
writeFileSync(htmlPath, `<!doctype html><html><body style="margin:0"><script>${res.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1120, height: 360 * items.length } });
items.forEach((it, i) => page.route(it.url, (r) => r.fulfill({ body: readFileSync(it.f), contentType: 'model/gltf-binary', headers: { 'Access-Control-Allow-Origin': '*' } })));
await page.goto('file://' + htmlPath);
await page.waitForFunction(() => window.__done, null, { timeout: 240000 });
const err = await page.evaluate(() => window.__err);
if (err) console.log('ERR', err);
await page.screenshot({ path: out });
console.log(JSON.stringify(await page.evaluate(() => window.__info)));
await browser.close();
