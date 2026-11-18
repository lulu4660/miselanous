// Headless capture: node dev/shot.mjs <outDir> [scenario] [w] [h]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/shots';
const scenario = process.argv[3] || 'title';
const W = +(process.argv[4] || 393), H = +(process.argv[5] || 852);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: scenario.includes('touch'), isMobile: scenario.includes('touch') });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const threeSrc = readFileSync(resolve('node_modules/three/build/three.module.min.js'));
await page.route(/cdn\.jsdelivr\.net\/npm\/three@/, (r) => r.fulfill({ body: threeSrc, contentType: 'application/javascript' }));
const url = 'file://' + resolve('dist/play.html') + '?q=medium&shot' + (scenario === 'title' ? '' : '&autoplay');
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__mbBooted || document.getElementById('err')?.classList.contains('on'), null, { timeout: 120000 });
console.log('boot ms', Date.now() - t0);
const errOn = await page.evaluate(() => document.getElementById('err').classList.contains('on') ? document.getElementById('errCode').textContent : null);
if (errOn) { console.log('ERROR OVERLAY:', errOn); console.log(logs.join('\n')); await browser.close(); process.exit(1); }
const wait = (ms) => page.waitForTimeout(ms);
const snap = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const drive = (thr, steer, hb = false) => page.evaluate(([a, b, c]) => { window.__mbDrive = { a, b, c }; }, [thr, steer, hb]);
// override input each frame from the test
await page.evaluate(() => {
  const mb = window.__mb;
  const orig = mb.car.step;
  mb.car.step = function (dt) { if (window.__mbDrive) { mb.car.input.throttle = window.__mbDrive.a; mb.car.input.steer = window.__mbDrive.b; mb.car.input.handbrake = window.__mbDrive.c; } return orig.call(this, dt); };
});
if (scenario === 'title') { await wait(2500); await snap('title'); }
else if (scenario.startsWith('touch')) {
  // drive with the on-screen joystick (pointer events) and the handbrake button
  await wait(800); await snap('touch_ui');
  const box = await page.locator('#zone').boundingBox();
  const sx = box.x + box.width * 0.4, sy = box.y + box.height * 0.7;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx, sy - 70, { steps: 5 });
  await wait(2500);
  const a = await page.evaluate(() => ({ v: window.__mb.car.forwardSpeed, thr: window.__mb.car.input.throttle, steer: window.__mb.car.input.steer }));
  console.log('joystick up ->', JSON.stringify(a));
  await page.mouse.move(sx + 70, sy - 20, { steps: 5 });
  await wait(1200);
  const b = await page.evaluate(() => ({ v: window.__mb.car.forwardSpeed, thr: window.__mb.car.input.throttle, steer: window.__mb.car.input.steer }));
  console.log('joystick right ->', JSON.stringify(b));
  await snap('touch_drive');
  await page.mouse.up();
  await wait(300);
  const c = await page.evaluate(() => ({ thr: window.__mb.car.input.throttle, steer: window.__mb.car.input.steer }));
  console.log('released ->', JSON.stringify(c));
  // collect a shell by teleporting onto it
  const r = await page.evaluate(async () => {
    const mb = window.__mb; const s = mb.layout.shells[0];
    mb.car.reset(s.x, s.z - 0.5, 0);
    await new Promise((res) => setTimeout(res, 900));
    return { found: mb.game.found, count: document.getElementById('shellCount').textContent, toast: document.getElementById('toastBig').textContent };
  });
  console.log('collect ->', JSON.stringify(r));
  await wait(300); await snap('touch_collect');
  const e = await page.evaluate(async () => {
    const mb = window.__mb;
    for (const s of mb.layout.shells.slice(1)) { mb.car.reset(s.x, s.z - 0.5, 0); await new Promise((res) => setTimeout(res, 350)); }
    await new Promise((res) => setTimeout(res, 2200));
    return { found: mb.game.found, end: document.getElementById('end').classList.contains('on') };
  });
  console.log('all ->', JSON.stringify(e));
  await snap('touch_end');
}
else if (scenario.startsWith('beam')) {
  const info = await page.evaluate(() => {
    const mb = window.__mb, s = mb.layout.shells[3];
    mb.car.reset(s.x, s.z - 30, 0);
    return { s, n: mb.layout.shells.length };
  });
  console.log('shell', JSON.stringify(info));
  await wait(2500); await snap('beam_far');
  await page.evaluate(() => { const mb = window.__mb, s = mb.layout.shells[3]; mb.car.reset(s.x, s.z - 9, 0); });
  await wait(1500); await snap('beam_near');
}
else if (scenario.startsWith('jump')) {
  await page.evaluate(() => {
    const mb = window.__mb, r = mb.layout.ramps[0];
    mb.car.reset(r.x - Math.sin(r.angle) * 22, r.z - Math.cos(r.angle) * 22, r.angle);
    window.__mbCamHook = (cam, car) => {
      const sx = Math.cos(r.angle), sz = -Math.sin(r.angle);
      cam.position.set(car.pos.x + sx * 9, car.pos.y + 2.2, car.pos.z + sz * 9);
      cam.lookAt(car.pos.x, car.pos.y + 0.3, car.pos.z);
    };
  });
  await drive(1, 0);
  for (let k = 0; k < 6; k++) { await wait(k === 0 ? 2200 : 330); await snap('jump' + k); }
}
else if (scenario.startsWith('wake')) {
  // find open lagoon water ~0.6-1.2 m deep near spawn and drive a slalom
  await page.evaluate(() => {
    const mb = window.__mb, t = mb.terrain;
    let best = null;
    for (let k = 0; k < 4000; k++) { const x = (Math.random() - 0.5) * 200, z = (Math.random() - 0.5) * 200; const h = t.heightAt(x, z); if (h < -0.6 && h > -1.0) { let ok = true; for (let d = 0; d < 30; d += 3) if (t.heightAt(x, z + d) > -0.4) { ok = false; break; } if (ok) { best = { x, z }; break; } } }
    mb.car.reset(best.x, best.z, 0);
    window.__mbCamHook = (cam, car) => { cam.position.set(car.pos.x - 6, car.pos.y + 16, car.pos.z - 10); cam.lookAt(car.pos.x, car.pos.y, car.pos.z + 4); };
  });
  await drive(1, 0.35); await wait(2500); await snap('wake1');
  await drive(1, -0.5); await wait(2000); await snap('wake2');
  await drive(0, 0); await wait(1500); await snap('wake3');
}
else if (scenario.startsWith('tour')) {
  // teleport next to a few landmarks, facing them
  const spots = await page.evaluate(() => {
    const L = window.__mb.layout, out = [];
    const sh = L.shells; out.push({ x: sh[2].x, z: sh[2].z, name: 'shell' });
    const g = L.palms[10]; out.push({ x: g.x, z: g.z, name: 'palms' });
    if (L.lighthouse) out.push({ x: L.lighthouse.x, z: L.lighthouse.z, name: 'mesa' });
    if (L.pier) out.push({ x: L.pier.x0 + L.pier.dx * 6, z: L.pier.z0 + L.pier.dz * 6, name: 'pier', heading: L.pier.ang });
    out.push({ x: L.ramps[0].x - Math.sin(L.ramps[0].angle) * 14, z: L.ramps[0].z - Math.cos(L.ramps[0].angle) * 14, name: 'ramp', heading: L.ramps[0].angle });
    return out;
  });
  for (const sp of spots) {
    await page.evaluate((sp) => {
      const mb = window.__mb; const t = mb.terrain;
      let x = sp.x, z = sp.z, heading = sp.heading;
      if (heading === undefined) {
        // back off 16 m toward the island centre-ish, face the spot
        let best = null;
        for (let a = 0; a < 16; a++) { const ang = a / 16 * Math.PI * 2; const px = sp.x + Math.sin(ang) * 16, pz = sp.z + Math.cos(ang) * 16; const h = t.heightAt(px, pz); if (h > -0.3 && h < 3 && (!best || Math.abs(h - 0.8) < Math.abs(best.h - 0.8))) best = { px, pz, h, ang }; }
        if (best) { x = best.px; z = best.pz; heading = best.ang + Math.PI; }
      }
      mb.car.reset(x, z, heading || 0);
    }, sp);
    await drive(sp.name === 'ramp' ? 1 : 0.0, 0);
    await wait(sp.name === 'ramp' ? 2600 : 1800);
    await snap('tour_' + sp.name);
  }
}
else {
  await wait(1500); await snap('start');
  await drive(1, 0); await wait(3500); await snap('drive1');
  await drive(1, 0.6); await wait(2500); await snap('drive2');
  await drive(1, -0.3); await wait(3000); await snap('drive3');
  await drive(0.3, 0); await wait(1500); await snap('drive4');
  const st = await page.evaluate(() => { const c = window.__mb.car; return { pos: c.pos, speed: c.speed, sub: c.submersion, fps: null }; });
  console.log(JSON.stringify(st));
}
const perf = await page.evaluate(() => window.__mb && { calls: window.__mb.renderer.info.render.calls, tris: window.__mb.renderer.info.render.triangles });
console.log('render info', JSON.stringify(perf));
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
await browser.close();
