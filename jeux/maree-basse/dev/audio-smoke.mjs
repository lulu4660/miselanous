import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/')('playwright')); }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/audio.js'), 'utf8') + '\nwindow.createAudio = createAudio;\n';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ type: 'module', content: src });
await page.waitForFunction(() => typeof window.createAudio === 'function');

const result = await page.evaluate(async () => {
  const log = [];
  const a = window.createAudio();
  const S = ['sand', 'wetsand', 'grass', 'rock', 'wood', 'water'];
  const K = ['ball', 'ring', 'buoy', 'wood', 'rock', 'ground', 'bogus'];
  const all = () => {
    a.update(0.016, { speed: 10, throttle: 1, rpm: 0.5, load: 0.5, skid: 0.2, surface: 'sand', wade: 0, airborne: false, camDistToShore: 10, paused: false });
    a.horn(true); a.horn(false); a.splash(0.7);
    K.forEach((k) => a.bump(0.8, k));
    for (let i = 0; i < 12; i++) a.chime(i, 12);
    a.uiTap(); a.gull(); a.setMuted(true); a.setMuted(false);
  };
  all(); a.update(0.016); a.update(NaN, null);
  a.setMuted(true);
  log.push('muted before unlock: ' + a.isMuted());
  a.unlock(); a.unlock();
  log.push('muted survives unlock: ' + a.isMuted());
  a.setMuted(false);
  const r = Math.random;
  for (let i = 0; i < 300; i++) {
    a.update(0.016 + (i % 7 === 0 ? NaN : 0), {
      speed: r() * 25, throttle: r() * 2 - 1, rpm: r(), load: r(), skid: r(),
      surface: S[i % S.length], wade: r() < 0.4 ? r() : 0, airborne: r() < 0.2,
      camDistToShore: r() * 60, paused: Math.floor(i / 40) % 2 === 1,
    });
    if (i % 50 === 0) a.update(1, { surface: 'nope', speed: 'x' });
  }
  a.horn(true); a.horn(true); a.horn(false);
  a.splash(0); a.splash(1);
  K.forEach((k) => { a.bump(1, k); a.bump(1, k); });
  for (let i = 0; i < 12; i++) a.chime(i, 12);
  a.chime(0, 1); a.chime(undefined, undefined);
  a.uiTap(); a.gull();
  a.setMuted(true); a.setMuted(false);
  await new Promise((res) => setTimeout(res, 500));
  log.push('done');
  return log;
});
await browser.close();
console.log(result.join('\n'));
if (errors.length) { console.log('FAIL\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: no page errors or console errors');
