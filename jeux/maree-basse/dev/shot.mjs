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
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: scenario.includes('touch') || scenario.includes('controls'), isMobile: scenario.includes('touch') || scenario.includes('controls') });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const threeSrc = readFileSync(resolve('node_modules/three/build/three.module.min.js'));
await page.route(/cdn\.jsdelivr\.net\/npm\/three@/, (r) => r.fulfill({ body: threeSrc, contentType: 'application/javascript' }));
const page_ = process.env.PAGE || 'dist/play.html';
const url = 'file://' + resolve(page_) + '?q=medium&shot' + (scenario === 'title' ? '' : '&autoplay');
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
  console.log('thumb held ->', JSON.stringify(a));
  await page.mouse.move(sx + 70, sy - 20, { steps: 5 });
  await wait(1200);
  const b = await page.evaluate(() => ({ v: window.__mb.car.forwardSpeed, thr: window.__mb.car.input.throttle, steer: window.__mb.car.input.steer }));
  console.log('thumb slid right ->', JSON.stringify(b));
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
else if (scenario.startsWith('controls')) {
  // Real pointer path: CDP multi-touch through input.js -> drive() -> vehicle.
  const cdp = await page.context().newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const st = () => page.evaluate(() => { const c = window.__mb.car; return { v: +c.forwardSpeed.toFixed(2), yaw: +Math.atan2(c.R[2], c.R[8]).toFixed(3), steer: +c.input.steer.toFixed(2), thr: c.input.throttle, brake: c.input.brake }; });
  const ok = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  // headless SwiftShader renders slower than real time, so wait in *simulation* seconds
  const simWait = async (sec) => { const t0 = await page.evaluate(() => window.__mb.phys.time); await page.waitForFunction((t) => window.__mb.phys.time >= t, t0 + sec, { timeout: 120000, polling: 50 }); };
  // put the car on a long, dry, flat stretch facing along it
  const spot = await page.evaluate(() => {
    const mb = window.__mb, t = mb.terrain;
    let sd = 12345; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20000; k++) {
      const x = (R() - 0.5) * 220, z = (R() - 0.5) * 220, a = R() * 6.28;
      let ok = true;
      for (let d = -5; d <= 60; d += 2) { const h = t.heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d); if (h < 0.5 || h > 2.2 || t.mesaAt(x + Math.sin(a) * d, z + Math.cos(a) * d) > 0.05) { ok = false; break; } }
      if (ok) return { x, z, a };
    }
    return { x: mb.layout.spawn.x, z: mb.layout.spawn.z, a: mb.layout.spawn.heading };
  });
  console.log('test strip', JSON.stringify(spot));
  const resetSpot = () => page.evaluate((s) => { const mb = window.__mb; mb.car.reset(s.x, s.z, s.a); for (const o of mb.phys.obstacles) if (Math.hypot(o.x - s.x, o.z - s.z) < 70) o.y1 = -99; }, spot);
  await resetSpot();
  await simWait(1.2);
  const X = 200, Y = 640;
  await T('touchStart', [{ x: X, y: Y, id: 1 }]);
  await simWait(2.2);
  let a = await st(); console.log('hold straight', JSON.stringify(a));
  ok(a.v > 5 && Math.abs(a.steer) < 0.05, 'thumb down drives forward straight');
  await snap('ctl_drive');
  for (let k = 1; k <= 6; k++) { await T('touchMove', [{ x: X + k * 12, y: Y, id: 1 }]); }
  await simWait(1.0);
  const b = await st(); console.log('slide right', JSON.stringify(b));
  ok(b.steer < -0.5 && Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) < -0.2, 'slide right turns right');
  await T('touchMove', [{ x: X, y: Y, id: 1 }]); await simWait(1.6);
  const c1 = await st(); await simWait(0.8); const c2 = await st();
  console.log('back to centre', JSON.stringify(c1), JSON.stringify(c2));
  ok(c1.steer === 0 && c2.steer === 0 && c2.thr === 1, 'thumb back on its landing point gives exactly zero steering (straight-line hold is asserted in the Node physics test)');
  // reverse while the thumb stays down (multi-touch)
  const rb = await page.locator('#rev').boundingBox();
  await T('touchEnd', []); await resetSpot(); await simWait(0.6);
  await T('touchStart', [{ x: X, y: Y, id: 1 }]); await simWait(1.5);
  await T('touchStart', [{ x: X, y: Y, id: 1 }, { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2, id: 2 }]);
  await simWait(3.2);
  const d = await st(); console.log('reverse held', JSON.stringify(d));
  const dragAlive = await page.evaluate(() => document.getElementById('steer').classList.contains('on'));
  ok(d.v < -0.5, 'reverse button brakes then reverses');
  ok(dragAlive, 'steering thumb survives the second finger');
  await T('touchEnd', [{ x: X, y: Y, id: 1 }]);
  await simWait(0.2);
  await T('touchEnd', []);
  // speed up again then lift
  await resetSpot();
  await simWait(0.6);
  await T('touchStart', [{ x: X, y: Y, id: 3 }]); await simWait(2.5);
  const e0 = await st();
  await T('touchEnd', []);
  await simWait(3.0);
  const e1 = await st(); console.log('lift', JSON.stringify(e0), '->', JSON.stringify(e1));
  ok(Math.abs(e1.v) < 1.0, 'lifting the thumb stops the car within 3 s (from ' + e0.v + ' m/s)');
  await snap('ctl_after');
}
else if (scenario.startsWith('wadecam')) {
  // gameplay camera (no hook): drive through 0.3-0.6 m water at ~10 m/s
  const simWait = async (sec) => { const t0 = await page.evaluate(() => window.__mb.phys.time); await page.waitForFunction((t) => window.__mb.phys.time >= t, t0 + sec, { timeout: 120000, polling: 50 }); };
  await page.evaluate(() => {
    const mb = window.__mb, t = mb.terrain;
    let sd = 777; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40000; k++) {
      const x = (R() - 0.5) * 220, z = (R() - 0.5) * 220, a = R() * 6.28;
      let ok = true;
      for (let d = -4; d <= 40; d += 2) { const h = t.heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d); if (h > -0.3 || h < -0.6) { ok = false; break; } }
      if (ok) { mb.car.reset(x, z, a); return; }
    }
  });
  await drive(0.75, 0); await simWait(2.5); await snap('wadecam1');
  await drive(0.75, 0.25); await simWait(1.2); await snap('wadecam2');
  const st = await page.evaluate(() => ({ v: window.__mb.car.speed, wade: window.__mb.car.wade }));
  console.log('wade', JSON.stringify(st));
}
else if (scenario.startsWith('perf')) {
  // fixed-quality perf proxy: frame ms under SwiftShader, JS ms per frame, tris & calls
  await drive(1, 0.15); await wait(2000);
  const r = await page.evaluate(() => new Promise((res) => {
    const mb = window.__mb; const R = mb.renderer;
    let js = 0, nJs = 0; const origR = R.render.bind(R);
    let tris = 0, calls = 0, n = 0;
    R.render = (s, c) => { const t0 = performance.now(); origR(s, c); js += 0; tris += R.info.render.triangles; calls += R.info.render.calls; n++; };
    const origU = mb.phys.update; mb.phys.update = (dt) => { const t0 = performance.now(); const k = origU(dt); js += performance.now() - t0; nJs++; return k; };
    const times = []; let last = performance.now();
    const tick = (now) => { times.push(now - last); last = now; if (times.length < 90) requestAnimationFrame(tick); else res({ frameMs: times.slice(10).reduce((a, b) => a + b, 0) / (times.length - 10), physMs: js / Math.max(1, nJs), tris: Math.round(tris / n), calls: Math.round(calls / n) }); };
    requestAnimationFrame(tick);
  }));
  console.log('PERF', JSON.stringify(r));
  await snap('perf');
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
