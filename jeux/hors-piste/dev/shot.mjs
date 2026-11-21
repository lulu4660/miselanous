// Headless capture: node dev/shot.mjs <outDir> [scenario] [w] [h]
// scenarios: garage | drive | touch | biomes | perf
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/shots';
const scenario = process.argv[3] || 'garage';
const W = +(process.argv[4] || 393), H = +(process.argv[5] || 852);
mkdirSync(out, { recursive: true });
const mobile = scenario.includes('touch');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const threeSrc = readFileSync(resolve('node_modules/three/build/three.module.min.js'));
await page.route(/cdn\.jsdelivr\.net\/npm\/three@/, (r) => r.fulfill({ body: threeSrc, contentType: 'application/javascript' }));
const url = 'file://' + resolve(process.env.PAGE || 'dist/play.html') + '?q=' + (process.env.Q || 'medium') + '&shot' + (scenario === 'garage' ? '' : '&autoplay');
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__mbBooted || document.getElementById('err')?.classList.contains('on'), null, { timeout: 180000 });
console.log('boot ms', Date.now() - t0);
const errOn = await page.evaluate(() => document.getElementById('err').classList.contains('on') ? document.getElementById('errCode').textContent : null);
if (errOn) { console.log('ERROR OVERLAY:', errOn); console.log(logs.join('\n')); await browser.close(); process.exit(1); }
const wait = (ms) => page.waitForTimeout(ms);
const snap = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const state = () => page.evaluate(() => { const c = window.__mb.car; return { v: +c.forwardSpeed.toFixed(2), thr: c.input.throttle, steer: +c.input.steer.toFixed(2), brake: c.input.brake, surf: document.getElementById('surf').textContent, kmh: document.getElementById('kmh').textContent, x: +c.pos.x.toFixed(1), z: +c.pos.z.toFixed(1) }; });
// keyboard-free driving: override the input mapping each frame
const autopilot = (on) => page.evaluate((on) => {
  const mb = window.__mb;
  if (!on) { mb.phys.world.removeEventListener?.('preStep', window.__ap); window.__apOn = false; return; }
  window.__apOn = true;
});

if (scenario === 'garage') {
  await wait(2500); await snap('garage');
  await page.click('#nextCar'); await wait(900); await snap('garage_next');
  await page.click('#paints button[data-k="2"]'); await wait(700); await snap('garage_paint');
  const g = await page.evaluate(() => ({ name: document.getElementById('carName').textContent, car: window.__mb.car.spec.id, livery: window.__mb.car.livery }));
  console.log('garage ->', JSON.stringify(g));
  await page.click('#go'); await wait(1800); await snap('garage_go');
  console.log('after go ->', JSON.stringify(await state()), await page.evaluate(() => window.__mb.game.mode));
}
else if (scenario === 'drive' || scenario === 'touch') {
  await wait(800); await snap(`${scenario}_start`);
  if (scenario === 'touch') {
    const cdp = await page.context().newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const g = await page.locator('#gasP').boundingBox(), wbb = await page.locator('#wheel').boundingBox(), b = await page.locator('#brakeP').boundingBox();
    const gx = g.x + g.width / 2, gy = g.y + g.height / 2;
    console.log('idle ->', JSON.stringify(await state()));
    const bx = b.x + b.width / 2, by = b.y + b.height / 2;
    const st2 = () => page.evaluate(() => { const c = window.__mb.car; return `v=${c.forwardSpeed.toFixed(1)} thr=${c.input.throttle} grounded=${c.groundedCount} y=${c.pos.y.toFixed(1)} roadD=${window.__mb.world.roadDistAt(c.pos.x, c.pos.z).toFixed(1)}`; });
    await T('touchStart', [{ x: gx, y: gy, id: 1 }]);
    await wait(2500);
    console.log('gas held 2.5 s ->', await st2());
    await T('touchEnd', []);
    await T('touchStart', [{ x: bx, y: by, id: 3 }]);
    for (let k = 0; k < 9; k++) { await wait(500); console.log(`  brake ${(k + 1) * 0.5}s ->`, await st2()); }
    await T('touchEnd', []);
    await wait(500);
    console.log('released ->', JSON.stringify(await state()));
    await T('touchStart', [{ x: gx, y: gy, id: 1 }]);
    await wait(1500);
    await T('touchStart', [{ x: gx, y: gy, id: 1 }, { x: wbb.x + wbb.width - 14, y: wbb.y + wbb.height / 2, id: 2 }]);
    await wait(800);
    console.log('gas + right ->', JSON.stringify(await state()));
    await snap('touch_drive');
    await T('touchEnd', []);
  } else {
    await page.evaluate(() => { const mb = window.__mb; window.__ev = []; const ev = mb.phys.events; const push = ev.push.bind(ev); ev.push = (...a) => { for (const e of a) if (e.car === mb.car && e.type !== 'propBump') window.__ev.push(`${mb.phys.time.toFixed(2)} ${e.type} ${(e.intensity || 0).toFixed(2)} ${e.kind || ''} up=${mb.car.R[4].toFixed(2)} v=${mb.car.forwardSpeed.toFixed(1)}`); return push(...a); }; });
    await page.keyboard.down('ArrowUp'); await wait(4000);
    console.log('up held ->', JSON.stringify(await state()));
    await snap('drive_fast');
    await page.keyboard.down('ArrowLeft'); await wait(900); await page.keyboard.up('ArrowLeft');
    await snap('drive_turn');
    await page.keyboard.up('ArrowUp');
    for (const v of ['high', 'bonnet', 'chase']) { await page.click('#btnCam'); await wait(900); await snap(`view_${v}`); }
    console.log((await page.evaluate(() => window.__ev)).join('\n'));
    await page.click('#btnMenu'); await wait(300); await snap('menu');
    await page.click('#mReset'); await wait(900);
    console.log('after reset ->', JSON.stringify(await state()));
  }
}
else if (scenario === 'biomes') {
  // teleport the player onto each road type and photograph it
  const spots = await page.evaluate(() => {
    const w = window.__mb.world, res = {};
    for (const r of w.roads) for (let i = 0; i < r.pts.length; i += 40) { const p = r.pts[i]; if (!res[p.type]) res[p.type] = { x: p.x, z: p.z, h: Math.atan2(p.tx, p.tz) }; }
    return res;
  });
  for (const [t, s] of Object.entries(spots)) {
    await page.evaluate((s) => { const mb = window.__mb; mb.phys.resetCar(mb.car, s.x, s.z, s.h); }, s);
    await page.keyboard.down('ArrowUp'); await wait(2600); await page.keyboard.up('ArrowUp'); await wait(500);
    console.log('biome', t, JSON.stringify(await state()));
    await snap(`biome_${t}`);
  }
}
else if (scenario === 'traffic') {
  // drop the player just behind an AI car and follow it
  await page.evaluate(() => {
    const mb = window.__mb, c = mb.traffic.cars[0], d = mb.traffic.drivers[0], road = mb.world.loop, n = road.pts.length;
    const p = road.pts[(d.idx - 14 + n) % n];
    mb.phys.resetCar(mb.car, p.x - p.tz * 2.2, p.z + p.tx * 2.2, Math.atan2(p.tx, p.tz));
  });
  await page.keyboard.down('ArrowUp'); await wait(2500);
  const t = await page.evaluate(() => window.__mb.traffic.cars.map((c) => ({ active: c.active, v: +c.forwardSpeed.toFixed(1), d: Math.round(Math.hypot(c.pos.x - window.__mb.car.pos.x, c.pos.z - window.__mb.car.pos.z)) })));
  console.log('traffic ->', JSON.stringify(t));
  await snap('traffic');
  await page.keyboard.up('ArrowUp');
  await page.evaluate(() => window.__mb.setView('high'));
  await wait(1500);
  const proj = await page.evaluate(() => {
    const mb = window.__mb; const THREE_V = mb.camera.position.clone();
    return mb.traffic.cars.map((c) => { const v = THREE_V.clone().set(c.rpos.x, c.rpos.y, c.rpos.z).project(mb.camera); return { active: c.active, sx: Math.round((v.x * 0.5 + 0.5) * innerWidth), sy: Math.round((-v.y * 0.5 + 0.5) * innerHeight), inFront: v.z < 1, posVsRpos: +Math.hypot(c.pos.x - c.rpos.x, c.pos.z - c.rpos.z).toFixed(2) }; });
  });
  console.log('projected ->', JSON.stringify(proj));
  await snap('traffic_high');
  // in-car view, upright, for two bodies
  for (const id of ['cabri', 'mistral']) {
    await page.evaluate((id) => { const mb = window.__mb; mb.swapCar(id, 0); mb.setView('bonnet'); }, id);
    await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp');
    console.log('bonnet', id, await page.evaluate(() => window.__mb.car.R[4].toFixed(2)));
    await snap(`bonnet_${id}`);
  }
  await page.evaluate(() => window.__mb.setView('cinema')); await wait(1200); await snap('cinema');
}
else if (scenario === 'perf') {
  await page.keyboard.down('ArrowUp');
  await wait(6000);
  await page.evaluate(() => window.__mb.setFx(0));
  await wait(500);
  const p = await page.evaluate(() => new Promise((res) => {
    const mb = window.__mb; let n = 0, t0 = performance.now();
    const ph0 = mb.phys.steps;
    function f() { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else { const t1 = performance.now(); mb.phys.update(1 / 60); const physMs = performance.now() - t1; res({ physMs: +physMs.toFixed(2), fps: n / 4, calls: mb.renderer.info.render.calls, tris: mb.renderer.info.render.triangles, active: mb.traffic.cars.filter((c) => c.active).length, perf: document.getElementById('garagePerf').textContent }); } }
    requestAnimationFrame(f);
  }));
  console.log('perf ->', JSON.stringify(p));
  await snap('perf');
}
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[warning]'));
console.log(errs.length ? errs.join('\n') : 'no console errors/warnings');
await browser.close();
