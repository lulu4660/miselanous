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
const url = 'file://' + resolve(page_) + '?q=' + (process.env.Q || 'medium') + '&shot' + (scenario === 'title' ? '' : '&autoplay');
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
  const orig = mb.car.preStep;
  mb.car.preStep = function (dt) { if (window.__mbDrive) { mb.car.input.throttle = window.__mbDrive.a; mb.car.input.steer = window.__mbDrive.b; mb.car.input.handbrake = window.__mbDrive.c; mb.car.input.brake = 0; } return orig.call(this, dt); };
});
if (scenario === 'title') { await wait(2500); await snap('title'); }
else if (scenario.startsWith('touch')) {
  // drive with the pedals + steering bar (CDP touches)
  await wait(800); await snap('touch_ui');
  const cdp = await page.context().newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const g = await page.locator('#gasP').boundingBox(), wbb = await page.locator('#wheel').boundingBox();
  const gx = g.x + g.width / 2, gy = g.y + g.height / 2;
  await T('touchStart', [{ x: gx, y: gy, id: 1 }]);
  await wait(2500);
  const a = await page.evaluate(() => ({ v: window.__mb.car.forwardSpeed, thr: window.__mb.car.input.throttle, steer: window.__mb.car.input.steer }));
  console.log('gas held ->', JSON.stringify(a));
  await T('touchStart', [{ x: gx, y: gy, id: 1 }, { x: wbb.x + wbb.width - 12, y: wbb.y + wbb.height / 2, id: 2 }]);
  await wait(1200);
  const b = await page.evaluate(() => ({ v: window.__mb.car.forwardSpeed, thr: window.__mb.car.input.throttle, steer: window.__mb.car.input.steer }));
  console.log('gas + right ->', JSON.stringify(b));
  await snap('touch_drive');
  await T('touchEnd', []);
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
  const simWait = async (sec) => { const t0 = await page.evaluate(() => window.__mb.phys.time); await page.waitForFunction((t) => window.__mb.phys.time >= t, t0 + sec, { timeout: 120000, polling: 50 }); };
  const spot = await page.evaluate(() => {
    const mb = window.__mb, t = mb.terrain;
    let sd = 12345; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20000; k++) {
      const x = (R() - 0.5) * 220, z = (R() - 0.5) * 220, a = R() * 6.28;
      let ok = true;
      for (let d = -5; d <= 60; d += 2) { const h = t.heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d); if (h < 0.5 || h > 2.2 || t.mesaAt(x + Math.sin(a) * d, z + Math.cos(a) * d) > 0.05) { ok = false; break; } }
      if (ok) return { x, z, a };
    }
  });
  const resetSpot = () => page.evaluate((s) => { const mb = window.__mb; mb.car.reset(s.x, s.z, s.a); mb.phys.disableObstaclesNear(s.x, s.z, 70); }, spot);
  const ctr = async (sel) => { const r = await page.locator(sel).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };
  const gas = await ctr('#gasP'), brk = await ctr('#brakeP'), wh = await ctr('#wheel');
  await resetSpot(); await simWait(1.5);
  const s0 = await st(); await simWait(2); const s1 = await st();
  ok(Math.abs(s1.v) < 0.3 && s1.thr === 0, `no finger: the car stays put (${s1.v} m/s)`);
  await T('touchStart', [{ x: gas.x, y: gas.y, id: 1 }]);
  await simWait(2.2);
  const a = await st(); console.log('gas', JSON.stringify(a));
  ok(a.v > 6 && a.steer === 0, 'gas pedal drives forward straight');
  await snap('ctl_drive');
  // steer: touch the right arrow end of the wheel while gas stays down
  await T('touchStart', [{ x: gas.x, y: gas.y, id: 1 }, { x: wh.r.x + wh.r.width - 14, y: wh.y, id: 2 }]);
  await simWait(1.0);
  const b = await st(); console.log('gas+right arrow', JSON.stringify(b));
  ok(b.steer < -0.9 && Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) < -0.2, 'tapping ▶ while on the gas turns right at full lock');
  // slide steering to a half-left position
  await T('touchMove', [{ x: gas.x, y: gas.y, id: 1 }, { x: wh.x - wh.r.width * 0.2, y: wh.y, id: 2 }]);
  await simWait(0.4);
  const c = await st(); console.log('slide half left', JSON.stringify(c));
  ok(c.steer > 0.2 && c.steer < 0.8, 'sliding on the wheel gives analog steering');
  await T('touchMove', [{ x: gas.x, y: gas.y, id: 1 }, { x: wh.x, y: wh.y, id: 2 }]);
  await simWait(0.3);
  const c2 = await st();
  ok(c2.steer === 0, 'wheel centre gives exactly zero steering');
  // roll the gas thumb onto the brake (same finger) while still steering
  await T('touchMove', [{ x: brk.x, y: brk.y, id: 1 }, { x: wh.x, y: wh.y, id: 2 }]);
  await simWait(0.3);
  const d0 = await st(); console.log('rolled to brake', JSON.stringify(d0));
  ok(d0.thr === -1, 'rolling the thumb from gas to brake brakes without lifting');
  await simWait(4.0);
  const d = await st(); console.log('brake held', JSON.stringify(d));
  ok(d.v < -0.5, 'holding brake stops then reverses');
  await T('touchEnd', []);
  await simWait(0.5);
  const e = await st();
  ok(e.thr === 0 && e.steer === 0, 'releasing everything zeroes the inputs');
  // coast: gas then release -> slows gently, no auto acceleration
  await resetSpot(); await simWait(0.8);
  await T('touchStart', [{ x: gas.x, y: gas.y, id: 3 }]); await simWait(2.5);
  const f0 = await st(); await T('touchEnd', []); await simWait(2.0); const f1 = await st();
  console.log('coast', JSON.stringify(f0), '->', JSON.stringify(f1));
  ok(f1.v < f0.v && f1.v > 0.5, 'releasing gas coasts and slows down (no auto throttle, no hard stop)');
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
else if (scenario.startsWith('fx')) {
  // identity check: RenderPass + OutputPass (no effect passes) must match the direct render
  await drive(0, 0); await wait(1500);
  const grab = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); return page.screenshot(); };
  await page.evaluate(() => window.__mb.setFx(0)); await wait(400); const a = await grab('fx0_direct');
  await page.evaluate(() => window.__mb.setFx(0)); await wait(400); const a2 = await grab('fx0_direct2');
  await page.evaluate(() => { const mb = window.__mb; mb.setFx(1); mb.post.passes.grade.enabled = false; }); await wait(400); const b = await grab('fx_identity');
  await page.evaluate(() => window.__mb.setFx(1)); await wait(400); await grab('fx1_grade');
  await page.evaluate(() => window.__mb.setFx(2)); await wait(400); await grab('fx2_tilt');
  await page.evaluate(() => window.__mb.setFx(3)); await wait(400); await grab('fx3_bloom');
  const info = await page.evaluate(() => ({ broken: window.__mb.post.broken, level: window.__mb.post.level }));
  console.log('post', JSON.stringify(info));
  const { PNG } = await import('file://' + resolve('dev/png.mjs'));
  const diff = (p, q) => { const A = PNG(p), B = PNG(q); let s = 0; for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]); return (s / A.length).toFixed(2); };
  console.log('mean abs diff direct vs direct (1 frame later):', diff(a, a2), ' direct vs composer identity:', diff(a, b));
}
else if (scenario.startsWith('views')) {
  await drive(1, 0); await wait(2500);
  for (const v of ['chase', 'high', 'cinema']) {
    await page.evaluate((v) => window.__mb.setView(v), v);
    await drive(1, v === 'cinema' ? 0.35 : 0.2); await wait(1600); await snap('view_' + v);
  }
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
