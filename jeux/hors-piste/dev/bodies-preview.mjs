// Preview of the procedural car bodies: node dev/bodies-preview.mjs [out.png] [ids,comma] [cols]
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
import { buildBody } from './src/gfx/bodies.js';
const ids = ${JSON.stringify(ids)};
const ZOOM = ${process.env.Z ? 1 : 0};
const CW = ZOOM ? 960 : 480, CH = ZOOM ? 660 : 330, VIEWS = 4;
const COLS = ZOOM ? 2 : 4, ROWS_PER = ZOOM ? 2 : 1;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CW * COLS, CH * ROWS_PER * ids.length);
renderer.setScissorTest(true);
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const info = {};
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfd9e8');
scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f78', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(-4, 8, 5); scene.add(sun);
const sun2 = new THREE.DirectionalLight('#dfe8ff', 0.8); sun2.position.set(5, 3, -6); scene.add(sun2);
const matShell = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
const matGlass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3 });
const matLight = new THREE.MeshBasicMaterial({ vertexColors: true });
const matBrake = new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.35 });
const matTyre = new THREE.MeshStandardMaterial({ color: '#2b2730', roughness: 0.9 });
const matHub = new THREE.MeshStandardMaterial({ color: '#d8cdb8', roughness: 0.5 });
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
ids.forEach((id, row) => {
  const spec = VEHICLES[id];
  const grp = new THREE.Group();
  const b = buildBody(id, spec.livery);
  info[id] = { shell: tris(b.shell), glass: tris(b.glass), lights: tris(b.lights), brake: tris(b.brake), antenna: b.antenna };
  info[id].total = info[id].shell + info[id].glass + info[id].lights + info[id].brake;
  grp.add(new THREE.Mesh(b.shell, matShell), new THREE.Mesh(b.glass, matGlass), new THREE.Mesh(b.lights, matLight), new THREE.Mesh(b.brake, matBrake));
  if (b.antenna) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.6, 5).translate(0, 0.3, 0), new THREE.MeshBasicMaterial({ color: '#000' })); a.position.set(b.antenna.x, b.antenna.y, b.antenna.z); grp.add(a); }
  let low = 9;
  for (const w of spec.wheels) {
    const yc = w.y - spec.restLength * 0.7;
    low = Math.min(low, yc - w.radius);
    const ww = id === 'bison' ? 0.3 : 0.24;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, ww, 20).rotateZ(Math.PI / 2), matTyre);
    t.position.set(w.x, yc, w.z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(w.radius * 0.6, w.radius * 0.6, ww + 0.02, 14).rotateZ(Math.PI / 2), matHub);
    hub.position.copy(t.position);
    grp.add(t, hub);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: '#8b7d63', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = low;
  const bx = spec.box; // wire box for the spec bounds
  const bb = new THREE.Box3(new THREE.Vector3(bx.minX, bx.minY, bx.minZ), new THREE.Vector3(bx.maxX, bx.maxY, bx.maxZ));
  const helper = new THREE.Box3Helper(bb, '#ff00ff'); helper.visible = ${process.env.BOX ? 'true' : 'false'};
  const sceneGroup = new THREE.Group(); sceneGroup.add(grp, ground, helper);
  sceneGroup.userData = { id, low };
  scene.add(sceneGroup);
  sceneGroup.visible = false;
  grp.userData.row = row;
});
const groups = scene.children.filter((c) => c.userData && c.userData.id);
const cam = new THREE.PerspectiveCamera(28, CW / CH, 0.1, 100);
const tgt = new THREE.Vector3(0, 0.15, 0);
const views = [
  { p: [-6.2, 3.2, 7.0] },   // front 3/4 (car front is +z; left side is +x, so view from +x... mirrored below)
  { p: [6.4, 3.0, -7.0] },  // rear 3/4
  { p: [11, 0.9, 0] },      // side (car left)
  { p: [0, 15, 0.01] },     // top
];
views[0].p = [6.2, 3.0, 7.2];
function render() {
  renderer.setClearColor('#bfd9e8');
  groups.forEach((g, row) => {
    groups.forEach((o) => (o.visible = o === g));
    views.forEach((v, col) => {
      cam.position.set(...v.p);
      if (col === 3) cam.up.set(0, 0, 1); else cam.up.set(0, 1, 0);
      cam.fov = col === 3 ? 22 : 28; cam.updateProjectionMatrix();
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
for (const [id, i] of Object.entries(info || {})) console.log(id.padEnd(8), 'tris total', i.total, '(shell', i.shell, 'glass', i.glass, 'lights', i.lights, 'brake', i.brake + ')', 'antenna', JSON.stringify(i.antenna));
if (logs.length) console.log(logs.join('\n'));
await browser.close();
console.log('wrote', out);
