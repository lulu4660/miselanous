// Preview of the full procedural cars (createVehicleModel: body + wheels + shocks) in 4 views per car.
// node dev/bodies-preview.mjs [out.png] [ids,comma]   env: Z=1 (bigger 2x2 tiles) DIRT=0..1 BRAKE=1 STEER=rad VIEW=x,y,z (4th view)
// Bundles a tiny three.js page with esbuild, renders 4 views per body (front-3/4, rear-3/4, side, top) and screenshots it.
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || '/tmp/claude-0/-home-user-miselanous/8e3e6f61-b3c2-5498-99af-8f18ab678814/scratchpad/bodies/preview.png';
const ids = (process.argv[3] || 'cabri,mistral,bison,criquet').split(',');
mkdirSync(dirname(out), { recursive: true });
const root = resolve(import.meta.dirname, '..');

const entry = `
import * as THREE from 'three';
import { VEHICLES } from './src/vehicles.js';
import { createVehicleModel } from './src/gfx/carModel.js';
const ids = ${JSON.stringify(ids)};
const ZOOM = ${process.env.Z ? 1 : 0};
const DIRT = ${process.env.DIRT ? Number(process.env.DIRT) : 0};
const BRAKE = ${process.env.BRAKE ? 1 : 0};
const STEER = ${process.env.STEER ? Number(process.env.STEER) : 0};
const CW = ZOOM ? 960 : 480, CH = ZOOM ? 660 : 330;
const COLS = ZOOM ? 2 : 4, ROWS_PER = ZOOM ? 2 : 1;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CW * COLS, CH * ROWS_PER * ids.length);
renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfd9e8');
// sky-ish environment (PMREM) like the game will provide
{
  const envScene = new THREE.Scene();
  const sg = new THREE.SphereGeometry(50, 24, 16);
  const cols = [];
  const p = sg.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    if (y > 0) c.set('#9cc8ee').lerp(new THREE.Color('#e8f3ff'), 1 - Math.pow(y, 0.6)); else c.set('#e8f3ff').lerp(new THREE.Color('#8a826c'), Math.min(1, -y * 2.2));
    cols.push(c.r, c.g, c.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sunM = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 9) }));
  sunM.position.set(-30, 35, 25); envScene.add(sunM);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture; scene.environmentIntensity = 0.85; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.15;
}
scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f78', 0.5));
const sun = new THREE.DirectionalLight('#fff4e0', 2.0); sun.position.set(-4, 8, 5); scene.add(sun);
const tris = (m) => { let t = 0; m.traverse((o) => { if (o.isMesh && o.visible) { const g = o.geometry; t += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } }); return t; };
const calls = (m) => { let t = 0; m.traverse((o) => { if (o.isMesh && o.visible) t++; }); return t; };
const info = {};
const fakeCar = (spec) => ({
  rpos: { x: 0, y: 0, z: 0 }, rq: { x: 0, y: 0, z: 0, w: 1 }, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
  wheels: spec.wheels.map((w) => ({ x: w.x, y: w.y, z: w.z, suspLen: spec.restLength * 0.7, spin: 0.3, steerAngle: w.front ? STEER : 0 })),
  throttle: BRAKE ? -1 : 0, brake: BRAKE ? 1 : 0, forwardSpeed: 5, speed: 5, input: { handbrake: false },
});
ids.forEach((id) => {
  const spec = VEHICLES[id];
  const model = createVehicleModel(spec, spec.livery);
  const car = fakeCar(spec);
  for (let i = 0; i < 20; i++) model.sync(car, 0.05);
  if (model.setDirt && DIRT > 0) model.setDirt(DIRT, '#7a5a3a');
  let low = 9;
  for (const w of spec.wheels) low = Math.min(low, w.y - spec.restLength * 0.7 - w.radius);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: '#8b7d63', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = low; ground.receiveShadow = true;
  const g = new THREE.Group(); g.add(model.root, ground); g.userData = { id, low };
  g.visible = false; scene.add(g);
  info[id] = { tris: tris(model.root), calls: calls(model.root) };
});
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
const groups = scene.children.filter((c) => c.userData && c.userData.id);
const cam = new THREE.PerspectiveCamera(28, CW / CH, 0.1, 100);
const tgt = new THREE.Vector3(0, 0.15, 0);
const views = [{ p: [6.2, 3.0, 7.2] }, { p: [6.4, 3.0, -7.0] }, { p: [11, 0.9, 0] }, { p: [-5.5, 1.6, 7.5] }];
const ex = ${process.env.VIEW ? JSON.stringify(process.env.VIEW.split(',').map(Number)) : 'null'};
if (ex) views[3] = { p: ex };
function render() {
  renderer.setClearColor('#bfd9e8');
  groups.forEach((g, row) => {
    groups.forEach((o) => (o.visible = o === g));
    views.forEach((v, col) => {
      cam.position.set(...v.p);
      cam.fov = 28; cam.updateProjectionMatrix();
      cam.lookAt(tgt);
      const x = (col % COLS) * CW, y = (ids.length * ROWS_PER - 1 - (row * ROWS_PER + Math.floor(col / COLS))) * CH;
      renderer.setViewport(x, y, CW, CH); renderer.setScissor(x, y, CW, CH);
      renderer.render(scene, cam);
    });
  });
  window.__info = info; window.__done = true;
}
render();
`;
const res = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', write: false, minify: false, logLevel: 'warning',
});
const js = res.outputFiles[0].text;
const html = `<!doctype html><html><body style="margin:0;background:#000"><script>${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
const htmlPath = out.replace(/\.png$/, '.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: process.env.Z ? { width: 1920, height: 1320 * ids.length } : { width: 480 * 4, height: 330 * ids.length } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('file://' + htmlPath);
try { await page.waitForFunction(() => window.__done, null, { timeout: 60000 }); } catch (e) { console.log('timeout'); }
await page.screenshot({ path: out });
const info = await page.evaluate(() => window.__info);
for (const [id, i] of Object.entries(info || {})) console.log(id.padEnd(8), 'tris', i.tris, 'draw calls', i.calls);
if (logs.length) console.log(logs.join('\n'));
await browser.close();
console.log('wrote', out);
