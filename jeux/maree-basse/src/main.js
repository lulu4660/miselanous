// Marée Basse — boot, game loop, camera, HUD, audio and effects wiring.
import * as THREE from 'three';
import { createTerrain, SURF, SURF_NAME } from './terrain.js';
import { createLayout } from './layout.js';
import { createPhysics } from './physics.js';
import { U, PALETTE, makeNoiseTexture } from './gfx/shaders.js';
import { createTerrainMesh } from './gfx/terrainMesh.js';
import { createWater } from './gfx/water.js';
import { createSky } from './gfx/sky.js';
import { createCarModel } from './gfx/carModel.js';
import { createVegetation } from './gfx/vegetation.js';
import { createPropMeshes, createStructures, createShells } from './gfx/objects.js';
import { createParticles, createTracks } from './gfx/fx.js';
import { createBirds } from './gfx/birds.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const SEED = 5;

async function boot(hot) {
  window.__mbStarted = true;
  const bar = $('bar').firstElementChild;
  const progress = async (p, text) => { bar.style.width = `${Math.round(p * 100)}%`; if (text) $('loadText').textContent = text; await nextFrame(); };
  const params = new URLSearchParams(location.search);

  // ---------- Quality
  const coarse = matchMedia('(pointer: coarse)').matches;
  const TIERS = {
    high: { dpr: 2, shadow: 2048, grass: 9000, aa: true },
    medium: { dpr: 1.6, shadow: 1536, grass: 6500, aa: false },
    low: { dpr: 1.15, shadow: 1024, grass: 3500, aa: false },
  };
  const tierName = params.get('q') || (coarse ? 'medium' : 'high');
  const quality = TIERS[tierName] || TIERS.medium;
  const lockQuality = params.has('q');

  // ---------- Renderer
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.aa, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let renderScale = 1;
  const applySize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr) * renderScale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const portrait = h > w;
    camera.fov = portrait ? 56 : 44;
    camera.updateProjectionMatrix();
    particles?.setScale(h * renderer.getPixelRatio(), camera.fov);
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PALETTE.fog.clone(), 0.0042);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 2600);
  let particles = null;

  await progress(0.08, 'Le sable se met en place…');
  U.uNoise.value = makeNoiseTexture(256);
  const terrain = createTerrain(SEED);
  const layout = createLayout(terrain);
  await progress(0.25, 'Les vagues se forment…');
  const phys = createPhysics(terrain);
  const { car, props, waves, water } = phys;

  // ---------- Lights
  const hemi = new THREE.HemisphereLight(PALETTE.sky, PALETTE.groundBounce, 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  const S = 34;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 220 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.045;
  scene.add(sun, sun.target);

  // ---------- World meshes
  const terrainMesh = createTerrainMesh(terrain);
  scene.add(terrainMesh.group);
  await progress(0.42, 'Les palmiers poussent…');
  const veg = createVegetation(terrain, layout, quality);
  scene.add(veg.group);
  const structures = createStructures(terrain, layout);
  scene.add(structures.group);
  const sky = createSky();
  scene.add(sky.group);
  await progress(0.6, 'On gonfle les bouées…');

  // Physics obstacles
  for (const p of layout.palms) phys.addObstacle({ x: p.x, z: p.z, r: 0.3, y0: p.y - 1, y1: p.y + 6, kind: 'wood' });
  for (const r of layout.rocks) phys.addObstacle({ x: r.x, z: r.z, r: r.s * 0.85, y0: r.y - 2, y1: r.y + r.s * 0.55, kind: 'rock' });
  for (const o of structures.obstacles) phys.addObstacle(o);
  for (const p of layout.props) props.add(p.kind, p.x, p.z, { tether: p.tether, color: p.color });

  const propMeshes = createPropMeshes(props, scene);
  const shells = createShells(layout, terrain);
  scene.add(shells.group);
  const waterGfx = createWater({ heightTex: terrainMesh.heightTex, terrain, waves, fog: scene.fog });
  scene.add(waterGfx.mesh);
  const carModel = createCarModel();
  scene.add(carModel.root);
  particles = createParticles(900);
  scene.add(particles.points);
  const tracks = createTracks(4);
  scene.add(tracks.group);
  const birds = createBirds(7);
  scene.add(birds.group);
  await progress(0.82, 'Le moteur chauffe…');

  // ---------- State
  const spawn = layout.spawn;
  car.reset(spawn.x, spawn.z, spawn.heading);
  const safe = { x: spawn.x, z: spawn.z, heading: spawn.heading, t: 0 };
  const game = { mode: 'title', found: 0, total: shells.items.length, time: 0, deepTime: 0, ended: false };
  if (hot && hot.found) {
    for (const id of hot.found) { const it = shells.items.find((s) => s.id === id); if (it) { it.taken = true; it.group.visible = false; game.found++; } }
  }
  if (hot && hot.car) car.reset(hot.car.x, hot.car.z, hot.car.heading);
  window.claude?.hot?.snapshot?.(() => ({
    found: shells.items.filter((s) => s.taken).map((s) => s.id),
    car: { x: car.pos.x, z: car.pos.z, heading: Math.atan2(car.R[2], car.R[8]) },
  }));

  const audio = createAudio();
  try { if (localStorage.getItem('mb-muted') === '1') audio.setMuted(true); } catch (e) { /* storage unavailable */ }
  const updateSoundIcon = () => {
    const m = audio.isMuted();
    $('wave1').style.display = m ? 'none' : ''; $('wave2').style.display = m ? 'none' : ''; $('mute').style.display = m ? '' : 'none';
    $('btnSound').setAttribute('aria-pressed', String(m));
    $('btnSound').setAttribute('aria-label', m ? 'Remettre le son' : 'Couper le son');
  };
  updateSoundIcon();

  const input = createInput({ zone: $('zone'), stick: $('stick'), knob: $('knob'), buttons: { handbrake: $('hb'), horn: $('horn') } });
  input.onFirstUse = () => { $('stickHint').style.opacity = '0'; $('stick').classList.remove('ghost'); };
  const touchUI = !matchMedia('(hover: hover) and (pointer: fine)').matches;
  $('how').innerHTML = touchUI
    ? 'Pouce gauche : conduire dans la direction voulue. <b>Dérapage</b> et <b>klaxon</b> à droite.'
    : '<b>Flèches</b> ou <b>ZQSD / WASD</b> pour conduire · <b>Espace</b> frein à main · <b>K</b> klaxon';
  // ghost stick position
  const placeGhost = () => {
    const st = $('stick'), h = $('stickHint');
    const x = Math.max(96, window.innerWidth * 0.24), y = window.innerHeight - Math.max(160, window.innerHeight * 0.21);
    st.style.left = `${x}px`; st.style.top = `${y}px`;
    const hw = h.offsetWidth || 200;
    h.style.left = `${Math.max(x, hw / 2 + 14)}px`; h.style.top = `${y}px`;
  };
  placeGhost();

  // ---------- UI
  const toast = (() => {
    let timer = 0;
    return (big, small = '', ms = 2600) => {
      $('toastBig').textContent = big; $('toastSmall').textContent = small;
      $('toast').classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(() => $('toast').classList.remove('on'), ms);
    };
  })();
  const setCount = () => { $('shellCount').textContent = String(game.found); };
  setCount();

  const start = () => {
    if (game.mode !== 'title') return;
    audio.unlock();
    audio.uiTap();
    game.mode = 'play';
    $('title').classList.add('gone');
    $('hud').classList.add('on');
    if (touchUI) { $('stick').classList.add('ghost'); $('stickHint').style.opacity = '1'; }
    setTimeout(() => toast('Trouve les 12 coquillages', 'Suis les rayons dorés', 3200), 600);
    try { navigator.wakeLock?.request?.('screen').catch(() => {}); } catch (e) { /* optional */ }
  };
  $('play').addEventListener('click', start);
  window.addEventListener('keydown', (e) => { if (game.mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); start(); } });
  $('btnSound').addEventListener('click', () => {
    audio.unlock();
    audio.setMuted(!audio.isMuted());
    try { localStorage.setItem('mb-muted', audio.isMuted() ? '1' : '0'); } catch (e) { /* ignore */ }
    updateSoundIcon();
    audio.uiTap();
  });
  const respawn = (msg) => {
    $('fade').classList.add('on');
    setTimeout(() => {
      car.reset(safe.x, safe.z, safe.heading);
      cam.snap = true;
      for (let i = 0; i < 4; i++) tracks.cut(i);
      $('fade').classList.remove('on');
      if (msg) toast(msg, '', 1800);
    }, 380);
  };
  $('btnReset').addEventListener('click', () => { audio.uiTap(); respawn(); });
  $('endBtn').addEventListener('click', () => { $('end').classList.remove('on'); audio.uiTap(); });

  // ---------- Camera
  const cam = { yaw: spawn.heading, target: new THREE.Vector3(car.pos.x, car.pos.y, car.pos.z), shake: 0, snap: true, dist: 12 };
  const tmpV = new THREE.Vector3();
  function updateCamera(dt) {
    const portrait = window.innerHeight > window.innerWidth;
    const fx = car.R[2], fz = car.R[8];
    const carYaw = Math.atan2(fx, fz);
    const sp = car.speed;
    if (game.mode === 'title') {
      cam.yaw += dt * 0.07;
      const d = portrait ? 15 : 13;
      tmpV.set(car.pos.x - Math.sin(cam.yaw) * d, car.pos.y + (portrait ? 4.2 : 3.4), car.pos.z - Math.cos(cam.yaw) * d);
      camera.position.copy(tmpV);
      cam.target.set(car.pos.x, car.pos.y + (portrait ? 0.4 : 1.0), car.pos.z);
      camera.lookAt(cam.target);
      return;
    }
    const follow = car.forwardSpeed > -1.5 ? 1.7 : 0.35;
    const k = 1 - Math.exp(-dt * follow * Math.min(1, 0.25 + sp / 6));
    cam.yaw += wrapAngle(carYaw - cam.yaw) * (cam.snap ? 1 : k);
    const look = 1.8 + Math.min(sp, 20) * 0.16;
    tmpV.set(car.pos.x + fx * look, car.pos.y + 0.5, car.pos.z + fz * look);
    if (cam.snap) cam.target.copy(tmpV); else cam.target.lerp(tmpV, 1 - Math.exp(-dt * 6));
    const dist = (portrait ? 12.5 : 11) + Math.min(sp, 20) * 0.12;
    const hgt = (portrait ? 9.2 : 6.6) + Math.min(sp, 20) * 0.06;
    tmpV.set(cam.target.x - Math.sin(cam.yaw) * dist, cam.target.y + hgt, cam.target.z - Math.cos(cam.yaw) * dist);
    const gh = Math.max(terrain.heightAt(tmpV.x, tmpV.z), 0);
    if (tmpV.y < gh + 2.5) tmpV.y = gh + 2.5;
    if (cam.snap) camera.position.copy(tmpV); else camera.position.lerp(tmpV, 1 - Math.exp(-dt * 5));
    cam.snap = false;
    camera.lookAt(cam.target);
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt * 2.2);
      const s = cam.shake * cam.shake * 0.35;
      camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
    }
  }

  // ---------- Controls -> car
  function drive() {
    const inp = input.read();
    if (game.mode !== 'play') { car.input.throttle = 0; car.input.steer = 0; car.input.handbrake = false; return inp; }
    const carYaw = Math.atan2(car.R[2], car.R[8]);
    if (inp.mode === 'dir') {
      const m = Math.min(1, Math.hypot(inp.x, inp.y));
      if (m < 0.12) { car.input.throttle = 0; car.input.steer = 0; }
      else {
        // camera-relative direction -> world yaw
        const a = cam.yaw;
        const dx = inp.y * Math.sin(a) - inp.x * Math.cos(a);
        const dz = inp.y * Math.cos(a) + inp.x * Math.sin(a);
        const want = Math.atan2(dx, dz);
        const err = wrapAngle(want - carYaw);
        const back = Math.abs(err) > 2.1 && car.forwardSpeed < 3.5;
        if (back) {
          const errB = wrapAngle(want + Math.PI - carYaw);
          car.input.throttle = -m;
          car.input.steer = Math.max(-1, Math.min(1, -errB * 1.8));
        } else {
          car.input.throttle = m * (0.55 + 0.45 * Math.max(0, Math.cos(err)));
          car.input.steer = Math.max(-1, Math.min(1, err * 1.9));
        }
      }
    } else {
      car.input.throttle = inp.y;
      car.input.steer = -inp.x; // left key = +steer (turn left)
    }
    car.input.handbrake = inp.handbrake;
    return inp;
  }

  // ---------- Effects per frame
  const wheelFx = car.wheels.map(() => ({ dustAcc: 0, sprayAcc: 0 }));
  const surfColor = ['#efd6ab', '#cfae86', '#c4b072', '#b98172', '#c79a6a'];
  function wheelEffects(dt) {
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const fx = wheelFx[i];
      const sp = car.speed;
      if (!w.grounded) { tracks.cut(i); continue; }
      const wl = water.levelAt(w.contact.x, w.contact.z);
      const wet = wl - w.contact.y;
      // tracks on soft ground (also slightly underwater, they fade)
      if ((w.surf === SURF.SAND || w.surf === SURF.WETSAND || w.surf === SURF.GRASS) && wet < 0.35) {
        const str = (w.surf === SURF.GRASS ? 0.45 : 1) * (wet > 0 ? 0.5 : 1) * Math.min(1, 0.4 + w.load / 4000);
        tracks.add(i, w.contact.x, w.contact.y, w.contact.z, car.vel.x, car.vel.z, 0.34, str, phys.time);
      } else tracks.cut(i);
      if (wet > 0.02 && sp > 1.2) {
        fx.sprayAcc += dt * sp * (1.2 + wet * 4);
        while (fx.sprayAcc > 1) { fx.sprayAcc -= 1; particles.spray(w.contact.x, wl + 0.05, w.contact.z, car.vel.x, car.vel.z, Math.min(1, sp / 10)); }
      } else if (wet <= 0.02 && (w.surf === SURF.SAND || w.surf === SURF.WETSAND || w.surf === SURF.GRASS) && (sp > 4 || w.slip > 0.25)) {
        fx.dustAcc += dt * (sp * 0.5 + w.slip * 18) * (w.surf === SURF.WETSAND ? 0.35 : 1);
        while (fx.dustAcc > 1) { fx.dustAcc -= 1; particles.dust(w.contact.x, w.contact.y, w.contact.z, car.vel.x, car.vel.z, surfColor[w.surf]); }
      }
    }
  }

  function handleEvents() {
    for (const e of phys.events) {
      switch (e.type) {
        case 'carSplash':
          audio.splash(e.intensity);
          particles.splash(e.x, water.levelAt(e.x, e.z), e.z, e.intensity, car.vel.x, car.vel.z, water.levelAt);
          cam.shake = Math.max(cam.shake, e.intensity * 0.9);
          break;
        case 'propSplash':
          audio.splash(e.intensity * 0.6);
          particles.splash(e.x, water.levelAt(e.x, e.z), e.z, e.intensity * 0.5, 0, 0, water.levelAt);
          waves.disturb(e.x, e.z, -e.intensity * 1.5, e.r * 1.4);
          break;
        case 'carHit':
          audio.bump(e.intensity, e.kind);
          if (e.intensity > 0.5) cam.shake = Math.max(cam.shake, e.intensity * 0.4);
          break;
        case 'propBump': audio.bump(e.intensity * 0.7, e.kind); break;
        case 'obstacle':
          audio.bump(e.intensity, e.kind === 'rock' ? 'rock' : 'wood');
          cam.shake = Math.max(cam.shake, e.intensity * 0.8);
          break;
        case 'land':
          audio.bump(e.intensity, 'ground');
          cam.shake = Math.max(cam.shake, e.intensity * 0.7);
          for (let k = 0; k < 4; k++) { const w = car.wheels[k]; if (w.grounded && water.levelAt(w.contact.x, w.contact.z) < w.contact.y) for (let j = 0; j < 6; j++) particles.dust(w.contact.x, w.contact.y, w.contact.z, car.vel.x, car.vel.z, surfColor[w.surf]); }
          break;
        case 'scrape': audio.bump(e.intensity * 0.6, 'rock'); break;
        case 'nan': respawn(); break;
      }
    }
    phys.events.length = 0;
  }

  function checkShells() {
    let nearest = null, nd = Infinity;
    for (const s of shells.items) {
      if (s.taken) continue;
      const d = Math.hypot(s.x - car.pos.x, s.z - car.pos.z);
      if (d < 2.9 && Math.abs(s.baseY - car.pos.y) < 3) {
        s.taken = true; s.collectT = 0;
        game.found++;
        setCount();
        audio.chime(game.found - 1, game.total);
        particles.sparkle(s.x, s.baseY, s.z, 50);
        waves.disturb(s.x, s.z, -0.8, 1.5);
        if (game.found < game.total) toast(`Coquillage ${game.found}/${game.total}`, ['Joli !', 'Encore un pour la collection', 'Il brillait sous le sable', 'La marée l\'avait gardé pour toi'][game.found % 4]);
        else {
          toast('Les douze !', '', 2400);
          setTimeout(() => $('end').classList.add('on'), 1600);
        }
        continue;
      }
      if (d < nd) { nd = d; nearest = s; }
    }
    return { nearest, nd };
  }

  // ---------- Resize
  window.addEventListener('resize', () => { applySize(); placeGhost(); });
  applySize();

  await progress(0.95, 'En route…');
  // warm up shaders
  renderer.compile(scene, camera);
  await progress(1);
  $('loading').classList.add('gone');
  window.__mbBooted = true;

  // ---------- Loop
  let last = performance.now();
  let hudT = 0, perfAcc = 0, perfN = 0, perfT = 0, hornWas = false;
  const frameTimes = [];
  window.__mb = { phys, car, game, camera, renderer, scene, start, quality, layout, terrain };

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    game.time += dt;

    const inp = drive();
    if (inp.horn && !hornWas) birds.scare(car.pos.x, car.pos.z);
    if (inp.horn !== hornWas) audio.horn(inp.horn);
    hornWas = inp.horn;

    // soft world boundary: a current pushes the car back toward the islands
    const rr = Math.hypot(car.pos.x, car.pos.z);
    if (rr > 135) { const k = (rr - 135) * 0.35 * dt; car.vel.x -= (car.pos.x / rr) * k; car.vel.z -= (car.pos.z / rr) * k; }

    phys.update(dt);
    handleEvents();
    if (game.mode === 'play') wheelEffects(dt);

    // safe point & stuck detection
    if (game.mode === 'play') {
      safe.t += dt;
      const upright = car.R[4] > 0.85;
      if (safe.t > 1 && car.groundedCount === 4 && car.submersion < 0.15 && upright && car.speed < 15) {
        safe.t = 0; safe.x = car.pos.x; safe.z = car.pos.z; safe.heading = Math.atan2(car.R[2], car.R[8]);
      }
      if (car.submersion > 0.8) game.deepTime += dt; else game.deepTime = Math.max(0, game.deepTime - dt);
      if (game.deepTime > 5 || car.pos.y < -6 || car.flippedTime > 7 || rr > 175) { game.deepTime = 0; car.flippedTime = 0; respawn('Retour sur la plage'); }
    }

    const { nearest, nd } = game.mode === 'play' ? checkShells() : { nearest: null, nd: 0 };

    // uniforms
    U.uTime.value = phys.time % 2000;
    U.uCarPos.value.set(car.pos.x, car.pos.y, car.pos.z);
    U.uCutout.value += ((game.mode === 'play' ? 1 : 0) - U.uCutout.value) * Math.min(1, dt * 3);
    // visuals
    carModel.sync(car, dt);
    propMeshes.sync();
    waterGfx.update(camera.position.x * 0.5 + car.pos.x * 0.5, camera.position.z * 0.5 + car.pos.z * 0.5);
    shells.update(game.time, dt);
    particles.update(dt);
    tracks.update(phys.time, scene.fog);
    birds.update(game.time, dt, car.pos);
    if (structures.lamp) structures.lamp.scale.setScalar(1 + Math.sin(game.time * 2.2) * 0.08);
    updateCamera(dt);
    // sun & shadow frustum follow the car
    sun.target.position.set(car.pos.x, car.pos.y, car.pos.z);
    sun.position.copy(sun.target.position).addScaledVector(U.uSunDir.value, 90);
    // snap shadow camera to texels to avoid shimmering
    const texel = (2 * S) / quality.shadow;
    sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
    sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
    sun.position.copy(sun.target.position).addScaledVector(U.uSunDir.value, 90);

    // audio
    let shoreD = 60;
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      for (let d = 0; d < 60; d += 6) {
        const h = terrain.heightAt(car.pos.x + Math.sin(ang) * d, car.pos.z + Math.cos(ang) * d);
        if ((h < 0) !== (terrain.heightAt(car.pos.x, car.pos.z) < 0)) { shoreD = Math.min(shoreD, d); break; }
      }
    }
    audio.update(dt, {
      speed: car.speed, throttle: car.input.throttle, rpm: car.rpm, load: car.load, skid: car.skid,
      surface: car.wade > 0.25 ? 'water' : SURF_NAME[car.surface], wade: car.wade, airborne: car.airborne,
      camDistToShore: shoreD, paused: game.mode !== 'play',
    });

    // HUD (10 Hz)
    hudT += dt;
    if (hudT > 0.1 && game.mode === 'play') {
      hudT = 0;
      $('kmh').textContent = String(Math.round(Math.abs(car.forwardSpeed) * 3.6));
      if (nearest) {
        const ang = Math.atan2(nearest.x - car.pos.x, nearest.z - car.pos.z);
        const rel = wrapAngle(cam.yaw - ang);
        $('arr').style.transform = `rotate(${rel}rad)`;
        $('dist').textContent = `${Math.round(nd)} m`;
        $('compass').style.opacity = '1';
      } else $('compass').style.opacity = '0';
    }

    renderer.render(scene, camera);

    // adaptive resolution
    if (!lockQuality) {
      perfAcc += dt; perfN++; perfT += dt;
      if (perfT > 2.5) {
        const avg = perfAcc / perfN;
        perfAcc = 0; perfN = 0; perfT = 0;
        if (avg > 0.026 && renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.12); applySize(); }
        else if (avg < 0.0145 && renderScale < 1) { renderScale = Math.min(1, renderScale + 0.08); applySize(); }
      }
    }
    frameTimes.push(dt); if (frameTimes.length > 120) frameTimes.shift();
  }
  requestAnimationFrame(frame);
  if (params.has('autoplay')) start();
}

const hot = window.claude?.hot;
const run = (data) => boot(data || {}).catch((e) => {
  console.error(e);
  window.__mbShowError?.(e && (e.stack || e.message) || e);
});
if (hot?.ready) hot.ready(run); else run(hot?.data ?? {});
