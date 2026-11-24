// Hors Piste — open-world rally: boot, garage, player car, traffic, camera, HUD, effects.
import * as THREE from 'three';
import { createWorld, ROAD_TYPE } from './world.js';
import { createPhysics } from './physics.js';
import { createTraffic } from './ai.js';
import { VEHICLES, VEHICLE_ORDER, LIVERIES, S, SURF_NAMES } from './vehicles.js';
import { U, PALETTE, makeNoiseTexture, makeCellTexture } from './gfx/shaders.js';
import { createTerrainMesh } from './gfx/terrainMesh.js';
import { createSky } from './gfx/sky.js';
import { createVehicleModel } from './gfx/carModel.js';
import { whenCarTexturesReady, preloadAssetCars } from './gfx/assetCar.js';
import { CREDITS } from './assets/cars.gen.js';
import { PROP_CREDITS } from './assets/props.gen.js';
import { createVegetation } from './gfx/vegetation.js';
import { createPropMeshes, placeRoadProps } from './gfx/objects.js';
import { createParticles, createTracks } from './gfx/fx.js';
import { createBirds } from './gfx/birds.js';
import { createPost } from './gfx/post.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createMinimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
const SURF_LABEL = ['Asphalte', 'Terre', 'Neige damée', 'Herbe', 'Sable', 'Neige', 'Rocher', 'Glace'];

async function boot() {
  window.__mbStarted = true;
  const bar = $('bar').firstElementChild;
  const progress = async (p, text) => { bar.style.width = `${Math.round(p * 100)}%`; if (text) $('loadText').textContent = text; await nextFrame(); };
  const params = new URLSearchParams(location.search);

  // ---------- quality
  const coarse = matchMedia('(pointer: coarse)').matches;
  const TIERS = {
    // dpr: the sharpest the tier may go; scale: where it starts (it climbs while frames keep up)
    high: { dpr: 2.5, shadow: 2048, grass: 5000, trees: 2600, traffic: 6, aa: true, scale: 1, fx: 3, far: 420 },
    medium: { dpr: 2.4, shadow: 2048, grass: 3600, trees: 2000, traffic: 5, aa: true, scale: 0.65, fx: 2, far: 340 },
    low: { dpr: 1.6, shadow: 1024, grass: 1500, trees: 1100, traffic: 3, aa: true, scale: 0.75, fx: 1, far: 260, treeShadows: false }, // the firs' shadow pass is half the triangles
  };
  const tierName = params.get('q') || (coarse ? 'medium' : 'high');
  const quality = TIERS[tierName] || TIERS.medium;
  const lockQuality = params.has('q');

  // ---------- renderer
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.aa, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = tierName === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  let renderScale = quality.scale, maxScale = 1, upCooldown = 4;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog.clone(), 30, quality.far);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 3200);
  let particles = null, post = null;
  try { post = createPost(renderer, scene, camera); } catch (e) { post = null; }
  let fxLevel = store.get('hp-fx') === '0' ? 0 : quality.fx;
  post?.setLevel(fxLevel);
  const applySize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr) * renderScale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    cam.offX = cam.offY = 1e9; // re-frame the garage view (cleared again once driving)
    particles?.setScale(h * renderer.getPixelRatio(), camera.fov);
    post?.setSize(w, h, renderer.getPixelRatio());
  };

  await progress(0.06, 'Les montagnes se lèvent…');
  U.uNoise.value = makeNoiseTexture(256);
  U.uCells.value = makeCellTexture(256);
  U.uWaterLevel.value = -1e4; // no sea on this map: disables the underwater tint and caustics
  const world = createWorld(11);
  await progress(0.3, 'On trace les pistes…');
  const phys = createPhysics(world);

  // ---------- lights
  // late afternoon: a warm low sun, cool sky fill, warm bounce from the ground
  const hemi = new THREE.HemisphereLight('#b3c6ef', '#cfb28c', 0.95);
  scene.add(hemi);
  const sunDir = new THREE.Vector3(-0.5, 0.45, 0.74).normalize();
  U.uSunDir.value.copy(sunDir);
  const sun = new THREE.DirectionalLight('#ffd9ae', 4.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  const SH = 34; // a tighter shadow box: crisper car and tree shadows
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 260 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // ---------- world meshes
  const terrain = createTerrainMesh(world);
  scene.add(terrain.group);
  await progress(0.5, 'Les sapins poussent…');
  const veg = createVegetation(world, quality);
  scene.add(veg.group);
  for (const o of veg.obstacles) phys.addObstacle(o);
  const sky = createSky(world);
  scene.add(sky.group);
  // reflections for the car paint and glass: a pre-filtered copy of the sky
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.dome.geometry, sky.dome.material));
    scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 3000).texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
  } catch (e) { /* no reflections: fine */ }
  placeRoadProps(world, phys.props);
  const propMeshes = createPropMeshes(phys.props);
  scene.add(propMeshes.root);
  particles = createParticles(tierName === 'high' ? 1600 : 1200);
  scene.add(particles.points);
  const tracks = createTracks(4, 520);
  scene.add(tracks.group);
  const birds = createBirds(6);
  scene.add(birds.group);
  await progress(0.72, 'Le garage ouvre…');

  // ---------- player car
  let carId = VEHICLES[store.get('hp-car')] ? store.get('hp-car') : 'cabri';
  let paint = Math.max(0, Math.min(3, +(store.get('hp-paint') || 0)));
  const liveryFor = (id, k) => (k === 0 ? VEHICLES[id].livery : LIVERIES[(k - 1 + VEHICLE_ORDER.indexOf(id)) % LIVERIES.length]);
  let car = phys.addVehicle(VEHICLES[carId], { player: true });
  car.livery = liveryFor(carId, paint);
  car.assist = 1;
  let model = createVehicleModel(VEHICLES[carId], car.livery);
  scene.add(model.root);
  const sp = world.spawn;
  // parked in the left lane: traffic always drives in the right one
  phys.resetCar(car, sp.x + Math.cos(sp.heading) * 2.2, sp.z - Math.sin(sp.heading) * 2.2, sp.heading);
  function swapCar(id, k) {
    const pos = { x: car.pos.x, z: car.pos.z, h: car.headingYaw() };
    phys.removeVehicle(car);
    scene.remove(model.root); model.dispose();
    carId = id; paint = k;
    car = phys.addVehicle(VEHICLES[id], { player: true });
    car.livery = liveryFor(id, k);
    car.assist = 1;
    model = createVehicleModel(VEHICLES[id], car.livery);
    scene.add(model.root);
    phys.resetCar(car, pos.x, pos.z, pos.h);
    store.set('hp-car', id); store.set('hp-paint', String(k));
    for (let i = 0; i < 4; i++) tracks.cut(i);
    cam.snap = true;
  }

  // ---------- traffic
  const traffic = createTraffic(phys, world, { count: quality.traffic });
  const aiModels = traffic.cars.map((c) => { const m = createVehicleModel(c.spec, c.livery); scene.add(m.root); return m; });
  await progress(0.85, 'Les moteurs chauffent…');
  if (!globalThis.__hpProceduralCars) preloadAssetCars();
  await whenCarTexturesReady(); // no car shows up untextured, even the first time it is picked in the garage

  // ---------- audio, input, UI
  const audio = createAudio();
  if (store.get('hp-muted') === '1') audio.setMuted(true);
  const input = createInput({ wheel: $('wheel'), wheelKnob: $('wheelKnob'), pedals: $('pedals'), gas: $('gasP'), brake: $('brakeP'), hbrake: $('hbP'), horn: $('horn') });
  const touchUI = !matchMedia('(hover: hover) and (pointer: fine)').matches;
  $('how').innerHTML = touchUI
    ? '<b>À gauche</b> : glisse ou touche les flèches pour tourner. <b>À droite</b> : Avancer, Frein pour freiner puis reculer, Frein à main pour pivoter dans les épingles.'
    : '<b>Flèches</b> ou <b>ZQSD / WASD</b> · <b>Espace</b> frein à main · <b>K</b> klaxon · <b>C</b> vue';
  const minimap = createMinimap($('minimap'), world);
  const toast = (() => { let t = 0; return (big, small = '', ms = 2200) => { $('toastBig').textContent = big; $('toastSmall').textContent = small; $('toast').classList.add('on'); clearTimeout(t); t = setTimeout(() => $('toast').classList.remove('on'), ms); }; })();

  const game = { mode: 'garage', time: 0, playTime: 0 };
  // garage card
  let gIdx = VEHICLE_ORDER.indexOf(carId), gPaint = paint;
  const STAT_LABELS = [['vitesse', 'Vitesse'], ['accel', 'Accélération'], ['adherence', 'Adhérence'], ['toutTerrain', 'Tout-terrain']];
  function renderGarage() {
    const spec = VEHICLES[VEHICLE_ORDER[gIdx]];
    $('carName').textContent = spec.name;
    $('carTag').textContent = /4×4|propulsion/.test(spec.tagline) ? spec.tagline : `${spec.tagline} · ${spec.drive === 'awd' ? '4×4' : 'propulsion'}`;
    $('stats').innerHTML = STAT_LABELS.map(([k, l]) => `<span>${l}</span><div class="bar"><i style="width:${Math.round(spec.stats[k] * 100)}%"></i></div>`).join('');
    $('paints').innerHTML = [0, 1, 2, 3].map((k) => { const lv = liveryFor(spec.id, k); return `<button type="button" data-k="${k}" aria-label="Peinture ${k + 1}" aria-pressed="${k === gPaint}" style="background:linear-gradient(135deg, ${lv.primary} 0 55%, ${lv.secondary} 55% 80%, ${lv.accent} 80%)"></button>`; }).join('');
    $('go').textContent = game.mode === 'garage' && game.started ? 'Retour en piste' : 'Rouler';
  }
  const pickGarage = (idx, k) => {
    gIdx = (idx + VEHICLE_ORDER.length) % VEHICLE_ORDER.length; gPaint = k;
    swapCar(VEHICLE_ORDER[gIdx], gPaint);
    // the swatches are re-rendered: keep keyboard focus on the one that was used
    const focusedPaint = document.activeElement?.closest?.('#paints button[data-k]')?.dataset.k;
    renderGarage();
    if (focusedPaint !== undefined) $('paints').querySelector(`button[data-k="${focusedPaint}"]`)?.focus();
    audio.uiTap?.();
  };
  $('prevCar').addEventListener('click', () => pickGarage(gIdx - 1, 0));
  $('nextCar').addEventListener('click', () => pickGarage(gIdx + 1, 0));
  $('paints').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (b) pickGarage(gIdx, +b.dataset.k); });
  renderGarage();

  const start = () => {
    audio.unlock(); audio.uiTap?.();
    game.mode = 'play'; game.started = true;
    input.enabled = true;
    document.body.classList.add('playing');
    $('garage').classList.add('gone');
    setTimeout(() => { if (game.mode === 'play') $('garage').hidden = true; }, 500);
    $('hud').classList.add('on');
    document.activeElement?.blur?.();
    toast(VEHICLES[carId].name, 'La carte est à toi : routes, neige, poussière.', 2600);
    try { navigator.wakeLock?.request?.('screen').catch(() => {}); } catch (e) { /* optional */ }
  };
  const openGarage = () => {
    game.mode = 'garage'; input.enabled = false; input.reset?.();
    $('hud').classList.remove('on');
    document.body.classList.remove('playing');
    $('garage').hidden = false; requestAnimationFrame(() => $('garage').classList.remove('gone'));
    $('menu').hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false');
    gIdx = VEHICLE_ORDER.indexOf(carId); gPaint = paint; renderGarage();
  };
  $('go').addEventListener('click', (e) => { e.currentTarget.blur(); start(); });
  window.addEventListener('keydown', (e) => { if (game.mode === 'garage' && e.code === 'Enter' && !(e.target instanceof Element && e.target.closest('button'))) { e.preventDefault(); start(); } });
  window.addEventListener('pointerdown', () => { if (game.mode === 'play') audio.unlock(); }, { passive: true });

  // menu
  const setMenuStates = () => {
    $('mFxState').textContent = fxLevel > 0 ? 'Oui' : 'Non';
    $('mSoundState').textContent = audio.isMuted() ? 'Non' : 'Oui';
    $('mPerfState').textContent = $('perf').hidden ? 'Non' : 'Oui';
    $('mFx').hidden = !post || post.broken;
  };
  $('btnMenu').addEventListener('click', (e) => {
    const open = $('menu').hidden; $('menu').hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); setMenuStates(); audio.uiTap?.(); e.currentTarget.blur();
  });
  $('mGarage').addEventListener('click', openGarage);
  $('mReset').addEventListener('click', () => { $('menu').hidden = true; respawnOnRoad('Retour sur la route'); });
  $('mFx').addEventListener('click', () => { if (!post || post.broken) return; fxLevel = fxLevel > 0 ? 0 : quality.fx; post.setLevel(fxLevel); store.set('hp-fx', fxLevel ? '1' : '0'); setMenuStates(); });
  $('mSound').addEventListener('click', () => { audio.unlock(); audio.setMuted(!audio.isMuted()); store.set('hp-muted', audio.isMuted() ? '1' : '0'); setMenuStates(); });
  $('perf').hidden = store.get('hp-perf') === '0';
  const togglePerf = () => { $('perf').hidden = !$('perf').hidden; store.set('hp-perf', $('perf').hidden ? '0' : '1'); setMenuStates(); };
  $('mPerf').addEventListener('click', togglePerf);
  $('speed').addEventListener('click', togglePerf);
  document.addEventListener('pointerdown', (e) => { if (!$('menu').hidden && !e.target.closest('#menu') && !e.target.closest('#btnMenu')) { $('menu').hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false'); } });
  // credits of the licensed models (CC BY: title, author, link, licence, modified)
  {
    const USE = { pine: 'Arbres, buissons et rochers', mesa: 'Formations rocheuses', cactus: 'Cactus' };
    const list = $('creditsList');
    for (const c of [...CREDITS, ...PROP_CREDITS]) {
      const li = document.createElement('li');
      const use = document.createElement('span'); use.className = 'use'; use.textContent = VEHICLES[c.for] ? 'Voiture « ' + VEHICLES[c.for].name + ' »' : USE[c.for] || c.for;
      const b = document.createElement('b'); b.textContent = c.name;
      const a = document.createElement('a'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = c.url.replace(/^https?:\/\//, '');
      const lic = /CC0|public domain/i.test(c.license) ? 'CC0' : 'CC BY 4.0';
      li.append(use, b, 'par ' + c.author + ' — ' + lic + ' — ', a);
      list.append(li);
    }
    // the dialog holds the controls (keys would still drive the car behind it)
    const close = () => { if ($('credits').hidden) return; $('credits').hidden = true; if (game.mode === 'play') input.enabled = true; $('btnMenu').focus({ preventScroll: true }); };
    $('mCredits').addEventListener('click', () => { $('menu').hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false'); $('credits').hidden = false; input.enabled = false; input.reset?.(); $('creditsList').scrollTop = 0; $('creditsClose').focus({ preventScroll: true }); });
    $('creditsClose').addEventListener('click', close);
    $('credits').addEventListener('pointerdown', (e) => { if (e.target === e.currentTarget) close(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !$('credits').hidden) close(); });
  }

  // respawn on the nearest road point, facing along it
  function nearestRoadPoint(x, z) {
    let best = null, bd = Infinity;
    for (const r of world.roads) for (let i = 0; i < r.pts.length; i += 2) { const p = r.pts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  let respawning = false, notUpright = 0;
  const lastGood = { x: world.spawn.x, z: world.spawn.z, h: world.spawn.heading };
  function respawnOnRoad(msg) {
    if (respawning) return;
    respawning = true;
    $('fade').classList.add('on');
    setTimeout(() => {
      respawning = false; notUpright = 0;
      try {
        // a NaN'd body has no position left: fall back to the last sane one
        const ok = Number.isFinite(car.pos.x + car.pos.z);
        const p = nearestRoadPoint(ok ? car.pos.x : lastGood.x, ok ? car.pos.z : lastGood.z) || world.loop.pts[world.spawn.idx];
        const yaw = ok ? car.headingYaw() : lastGood.h;
        let h = Math.atan2(p.tx, p.tz);
        if (Math.cos(wrapAngle(h - yaw)) < 0) h += Math.PI;
        // the road's left lane (traffic keeps to the right one), whichever way we face
        phys.resetCar(car, p.x + p.tz * 2.2, p.z - p.tx * 2.2, h);
        if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z)) phys.resetCar(car, world.spawn.x, world.spawn.z, world.spawn.heading);
        for (let i = 0; i < 4; i++) tracks.cut(i);
        cam.snap = true;
        if (msg) toast(msg, '', 1500);
      } finally {
        $('fade').classList.remove('on');
      }
    }, 320);
  }

  // ---------- camera views
  const VIEWS = {
    chase: { label: 'Poursuite', p: { dist: 9.5, hgt: 4.4, look: 5, lookY: 0.9, fov: 62 }, l: { dist: 8.5, hgt: 3.4, look: 4, lookY: 0.8, fov: 50 } },
    high: { label: 'Plongée', p: { dist: 20, hgt: 30, look: 7, lookY: 0.3, fov: 52 }, l: { dist: 14, hgt: 24, look: 2, lookY: 0.3, fov: 38 } },
    cinema: { label: 'Cinéma', p: { dist: 12, hgt: 3.0, look: 0.3, lookY: 0.9, fov: 60, side: 0.85 }, l: { dist: 9, hgt: 2.2, look: 0.4, lookY: 0.8, fov: 46, side: 0.95 } },
    bonnet: { label: 'Embarquée', p: { dist: -0.4, hgt: 1.35, look: 30, lookY: 0.7, fov: 70 }, l: { dist: -0.4, hgt: 1.25, look: 30, lookY: 0.7, fov: 58 } },
  };
  const VIEW_ORDER = ['chase', 'high', 'cinema', 'bonnet'];
  let view = VIEWS[store.get('hp-cam')] ? store.get('hp-cam') : 'chase';
  const cam = { yaw: sp.heading, target: new THREE.Vector3(car.pos.x, car.pos.y, car.pos.z), pos: new THREE.Vector3(), shake: 0, snap: true, roll: 0, offX: 0, offY: 0 };
  const garageCard = document.querySelector('#garage .card'), garageHead = document.querySelector('#garage .head');
  const tmpV = new THREE.Vector3(), desired = new THREE.Vector3();
  const localP = { x: 0, y: 0, z: 0 }, worldP = car.body.position.clone();
  function setFov(f) {
    if (Math.abs(camera.fov - f) < 0.01) return;
    camera.fov += (f - camera.fov) * 0.15;
    camera.updateProjectionMatrix();
    particles?.setScale(window.innerHeight * renderer.getPixelRatio(), camera.fov);
  }
  function updateCamera(dt) {
    const portrait = window.innerHeight > window.innerWidth;
    const cp = car.rpos;
    const carYaw = car.headingYaw();
    const spd = Math.min(car.speed, 45);
    if (game.mode === 'garage') {
      cam.yaw += dt * 0.12;
      // frame the car in the free space beside / above the garage card
      const W = window.innerWidth, H = window.innerHeight;
      const card = garageCard.getBoundingClientRect(), head = garageHead.getBoundingClientRect();
      let fx = W / 2, fy = H / 2, freeH = H;
      // card beside the heading (short landscape) or below it (portrait, tall landscape)
      const side = card.left > W * 0.45 && card.top < H * 0.45;
      if (!side) { fy = (head.bottom + card.top) / 2; freeH = Math.max(80, card.top - head.bottom); }
      else { fx = card.left / 2; fy = (head.bottom + H) / 2; freeH = H - head.bottom; }
      const offX = W / 2 - fx, offY = H / 2 - fy;
      if (Math.abs(offX - cam.offX) > 0.5 || Math.abs(offY - cam.offY) > 0.5) { cam.offX = offX; cam.offY = offY; camera.setViewOffset(W, H, offX, offY, W, H); }
      const fov = portrait ? 50 : 40;
      const d = Math.max(7.5, Math.min(14, 5.2 / ((freeH / H) * Math.tan((fov * Math.PI) / 360))));
      cam.pos.set(cp.x - Math.sin(cam.yaw) * d, cp.y + d * 0.24, cp.z - Math.cos(cam.yaw) * d);
      cam.pos.y = Math.max(cam.pos.y, world.heightAt(cam.pos.x, cam.pos.z) + 1.2);
      camera.position.copy(cam.pos);
      cam.target.set(cp.x, cp.y + 0.3, cp.z);
      camera.lookAt(cam.target);
      setFov(fov);
      scene.fog.near = 30; scene.fog.far = quality.far;
      cam.snap = true;
      return;
    }
    if (cam.offX || cam.offY) { cam.offX = cam.offY = 0; camera.clearViewOffset(); }
    const V = portrait ? VIEWS[view].p : VIEWS[view].l;
    if (view === 'bonnet') {
      cam.yaw = carYaw;
      const bx = car.spec.box, camY = bx.minY + (bx.maxY - bx.minY) * 0.5;
      localP.x = 0; localP.y = camY; localP.z = Math.max(bx.maxZ, model.noseZ ?? -9) + 0.35; // bumper cam, just ahead of the nose (bull bars, plates and light pods stay out of view)
      car.body.pointToWorldFrame(localP, worldP);
      camera.position.set(worldP.x, worldP.y, worldP.z);
      localP.y = camY - 0.25; localP.z = V.look;
      car.body.pointToWorldFrame(localP, worldP);
      cam.target.set(worldP.x, worldP.y, worldP.z);
      camera.up.set(car.R[1], car.R[4], car.R[7]);
      camera.lookAt(cam.target);
      camera.up.set(0, 1, 0);
      setFov(V.fov + spd * 0.15);
      scene.fog.near = 25; scene.fog.far = quality.far;
      cam.pos.copy(camera.position);
      return;
    }
    const vYaw = Math.atan2(car.vel.x, car.vel.z);
    const moveW = Math.min(1, Math.max(0, (car.forwardSpeed - 2) / 6));
    const wantYaw = carYaw + wrapAngle(vYaw - carYaw) * moveW * 0.65;
    const follow = car.forwardSpeed > -1.5 ? 3.0 : 0.4;
    const k = 1 - Math.exp(-dt * follow * Math.min(1, 0.3 + spd / 5));
    const prevYaw = cam.yaw;
    cam.yaw += wrapAngle(wantYaw - cam.yaw) * (cam.snap ? 1 : k);
    const yawRate = wrapAngle(cam.yaw - prevYaw) / Math.max(dt, 1e-3);
    const look = V.look + spd * (view === 'high' ? 0.35 : view === 'cinema' ? 0.04 : 0.2);
    tmpV.set(cp.x + Math.sin(cam.yaw) * look, cp.y + V.lookY, cp.z + Math.cos(cam.yaw) * look);
    if (cam.snap) cam.target.copy(tmpV); else cam.target.lerp(tmpV, 1 - Math.exp(-dt * 8));
    const dist = V.dist + spd * (view === 'high' ? 0.22 : 0.09);
    const hgt = V.hgt + spd * (view === 'high' ? 0.3 : 0.025);
    const ca = cam.yaw + Math.PI + (V.side || 0);
    desired.set(cp.x + Math.sin(ca) * dist, cp.y + hgt, cp.z + Math.cos(ca) * dist);
    let gh = world.heightAt(desired.x, desired.z);
    gh = Math.max(gh, world.heightAt((desired.x + cp.x) / 2, (desired.z + cp.z) / 2) - hgt * 0.3);
    if (desired.y < gh + 1.5) desired.y = gh + 1.5;
    if (cam.snap) cam.pos.copy(desired); else cam.pos.lerp(desired, 1 - Math.exp(-dt * 7));
    camera.position.copy(cam.pos);
    cam.snap = false;
    camera.lookAt(cam.target);
    const rollT = view === 'high' ? 0 : Math.max(-0.05, Math.min(0.05, -yawRate * 0.03 * Math.min(1, car.speed / 10)));
    cam.roll += (rollT - cam.roll) * Math.min(1, dt * 4);
    if (cam.roll) camera.rotateZ(cam.roll);
    setFov(V.fov + (view === 'high' ? 0 : Math.min(10, spd * 0.28)));
    const cd = camera.position.distanceTo(cp);
    scene.fog.near = Math.max(20, cd * 1.2); scene.fog.far = cd + quality.far;
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt * 2.2);
      const s = cam.shake * cam.shake * 0.3;
      camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
    }
  }
  const cycleView = () => {
    view = VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length];
    store.set('hp-cam', view);
    toast(`Vue ${VIEWS[view].label}`, '', 1100);
    cam.snap = true;
    audio.uiTap?.();
  };
  $('btnCam').addEventListener('click', (e) => { cycleView(); e.currentTarget.blur(); });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && game.mode === 'play') cycleView(); });

  // ---------- controls -> car
  let hornWas = false;
  function drive() {
    const inp = input.read();
    if (game.mode !== 'play' || !input.enabled) { car.input.throttle = 0; car.input.steer = 0; car.input.brake = 0.6; car.input.handbrake = false; return inp; }
    car.input.throttle = inp.throttle; car.input.steer = inp.steer; car.input.brake = inp.brake; car.input.handbrake = inp.handbrake;
    return inp;
  }

  // ---------- biome mood: fog colour and grade follow where you are
  const FOG = { snow: new THREE.Color('#d2dcec'), asph: new THREE.Color('#e4dccb'), dirt: new THREE.Color('#efcfaa') };
  const FOG_SUN = new THREE.Color('#ffd3a0'), camFwd = new THREE.Vector3();
  const fogTarget = new THREE.Color(), bwCam = [0, 0, 0];
  const SKY_HORIZON = { snow: new THREE.Color('#e2e8f3'), asph: new THREE.Color('#f1dcc2'), dirt: new THREE.Color('#f6d2ac') };
  const skyTarget = new THREE.Color();
  const mix3 = (out, C, w) => out.setRGB(C.snow.r * w[0] + C.asph.r * w[1] + C.dirt.r * w[2], C.snow.g * w[0] + C.asph.g * w[1] + C.dirt.g * w[2], C.snow.b * w[0] + C.asph.b * w[1] + C.dirt.b * w[2]);
  function updateMood(dt) {
    world.biomeWeights(camera.position.x, camera.position.z, bwCam);
    mix3(fogTarget, FOG, bwCam);
    // looking toward the sun the haze glows warm (forward scattering), away from it it stays cool
    camera.getWorldDirection(camFwd);
    const toSun = Math.max(0, (camFwd.x * sunDir.x + camFwd.z * sunDir.z) / Math.max(1e-3, Math.hypot(sunDir.x, sunDir.z)));
    fogTarget.lerp(FOG_SUN, toSun * toSun * 0.35);
    scene.fog.color.lerp(fogTarget, Math.min(1, dt * 1.5));
    sky.haze.value.copy(scene.fog.color);
    const hz = sky.dome.material.uniforms.cHorizon?.value;
    if (hz) hz.lerp(mix3(skyTarget, SKY_HORIZON, bwCam), Math.min(1, dt * 1.5));
    if (post?.passes?.grade) {
      const g = post.passes.grade.uniforms;
      g.uShadow.value.setRGB(0.5 + 0.1 * bwCam[0], 0.52 + 0.08 * bwCam[0], 0.84 + 0.1 * bwCam[0]);
      g.uSat.value = 1.08 + 0.08 * bwCam[2] - 0.06 * bwCam[0];
    }
  }

  // ---------- the body gets muddy on dirt, dusty on sand, white on snow; tarmac slowly cleans it
  const DIRT_COL = { mud: new THREE.Color('#7b5a40'), sand: new THREE.Color('#c9a173'), snow: new THREE.Color('#eef3fa') };
  const dirtCol = new THREE.Color();
  function updateDirt(c, m, dt) {
    if (!m.setDirt) return;
    const s = c.surface, sp = Math.min(1, c.speed / 20);
    const kind = s === S.SNOW || s === S.SNOWROAD || s === S.ICE ? 'snow' : s === S.SAND ? 'sand' : s === S.DIRT || s === S.GRASS ? 'mud' : null;
    m.dirtKind = m.dirtKind || 'mud';
    let a = m.dirt || 0;
    if (kind && c.groundedCount > 0) {
      if (kind !== m.dirtKind) { a *= Math.max(0, 1 - dt * 0.6); if (a < 0.08) m.dirtKind = kind; } // the old layer washes off first
      else a = Math.min(0.6, a + dt * 0.03 * (0.3 + sp + c.skid)); // (capped: the paint stays readable)
    } else a = Math.max(0, a - dt * 0.006);
    dirtCol.copy(DIRT_COL[m.dirtKind]);
    if (Math.abs(a - (m.dirt || 0)) > 0.002 || !m.dirtSet) { m.setDirt(a, dirtCol); m.dirtSet = true; }
  }

  // ---------- per-frame effects (player car)
  const fxState = [0, 1, 2, 3].map(() => ({ acc: 0, chip: 0 }));
  const DUST = ['#5a5a60', '#e8c9a0', '#fffaf3', '#d6c79a', '#f2d1a2', '#fffbf5', '#c9beb4', '#f2f8fb'];
  function wheelEffects(dt, c, trackIdx) {
    for (let i = 0; i < 4; i++) {
      const w = c.wheels[i];
      if (!w.grounded) { if (trackIdx) tracks.cut(i); continue; }
      const sp = c.speed, s = w.surf;
      const soft = s === S.DIRT || s === S.SAND || s === S.SNOW || s === S.SNOWROAD || s === S.GRASS;
      if (trackIdx) {
        if (soft || (s === S.ASPHALT && w.slip > 0.35) || (s === S.ICE && w.slip > 0.3)) {
          const str = s === S.ASPHALT || s === S.ICE ? Math.min(1, w.slip * 1.6) : s === S.GRASS ? 0.45 : s === S.SNOW ? 1.2 : 0.85;
          tracks.add(i, w.contact.x, w.contact.y, w.contact.z, c.vel.x, c.vel.z, w.radius * 0.75, str, phys.time);
        } else tracks.cut(i);
      }
      // effects by surface: smoke on tarmac slides, dust (and gravel) on dirt, sand and grass,
      // powder and lumps on snow
      const snowy = s === S.SNOW || s === S.SNOWROAD;
      const wf = fxState[i];
      let rate = 0;
      if (s === S.ASPHALT) rate = w.slip > 0.3 ? w.slip * 26 : 0;
      else if (soft) rate = sp * (s === S.SNOW || s === S.SAND ? 0.6 : snowy ? 0.45 : s === S.GRASS ? 0.18 : 0.42) + w.slip * 12;
      wf.acc += dt * rate;
      while (wf.acc > 1) {
        wf.acc -= 1;
        if (s === S.ASPHALT) particles.smoke(w.contact.x, w.contact.y, w.contact.z, c.vel.x, c.vel.z);
        else particles.dust(w.contact.x, w.contact.y, w.contact.z, c.vel.x, c.vel.z, DUST[s], snowy ? 0.85 : 1, snowy ? 0.68 : 0.5);
      }
      // thrown gravel / snow lumps when the tyre works hard
      if (soft && s !== S.GRASS && (w.slip > 0.25 || (sp > 9 && !w.front))) {
        wf.chip = (wf.chip || 0) + dt * (w.slip * 30 + sp * (snowy ? 0.45 : 0.15));
        while (wf.chip > 1) { wf.chip -= 1; particles.chips(w.contact.x, w.contact.y, w.contact.z, c.vel.x, c.vel.z, snowy ? '#fffaf3' : s === S.SAND ? '#c99a66' : '#6f5644'); }
      }
    }
  }
  function handleEvents() {
    for (const e of phys.events) {
      const mine = e.car === car;
      const near = e.car && Math.hypot(e.car.pos.x - car.pos.x, e.car.pos.z - car.pos.z) < 40;
      switch (e.type) {
        case 'carHit': if (mine || near) audio.bump(e.intensity, e.kind); if (mine && e.intensity > 0.5) cam.shake = Math.max(cam.shake, e.intensity * 0.4); break;
        case 'propBump': if (Math.hypot(e.x - car.pos.x, e.z - car.pos.z) < 40) audio.bump(e.intensity * 0.7, e.kind); break;
        case 'obstacle': if (mine) { audio.bump(e.intensity, e.kind); cam.shake = Math.max(cam.shake, e.intensity * 0.8); } break;
        case 'carCar': if (mine || near) { audio.bump(e.intensity, 'buoy'); if (mine) cam.shake = Math.max(cam.shake, e.intensity * 0.9); } break;
        case 'land': if (mine) { audio.bump(e.intensity, 'ground'); cam.shake = Math.max(cam.shake, e.intensity * 0.7); } break;
        case 'scrape': if (mine) audio.bump(e.intensity * 0.6, 'rock'); break;
        case 'nan': if (mine) respawnOnRoad(); break;
      }
    }
    phys.events.length = 0;
  }

  // snowfall near the camera in the snow biome
  let snowAcc = 0;
  function snowfall(dt) {
    if (bwCam[0] < 0.2) return;
    snowAcc += dt * 70 * bwCam[0];
    while (snowAcc > 1) {
      snowAcc -= 1;
      const a = Math.random() * 6.28, r = 3 + Math.random() * 30;
      particles.spawn({ x: camera.position.x + Math.sin(a) * r, y: camera.position.y + 6 + Math.random() * 8, z: camera.position.z + Math.cos(a) * r,
        vx: 0.6, vy: -1.6 - Math.random(), vz: 0.3, max: 6, s0: 0.09, s1: 0.09, grav: 0, drag: 0, color: '#ffffff', type: 1 });
    }
  }

  window.addEventListener('resize', applySize);
  applySize();
  await progress(0.95, 'En route…');
  renderer.compile(scene, camera);
  await progress(1);
  $('loading').classList.add('gone');
  window.__mbBooted = true;

  // ---------- loop
  let last = performance.now(), hudT = 0, perfAcc = 0, perfN = 0, perfT = 0, fpsShown = 60, fpsAcc = 0, fpsN = 0;
  window.__mb = { phys, world, game, veg, camera, renderer, scene, quality, traffic, post, get car() { return car; }, start, setFx: (n) => { fxLevel = n; post?.setLevel(n); }, setView: (v) => { view = v; cam.snap = true; }, swapCar };

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    game.time += dt;
    if (game.mode === 'play') game.playTime += dt;

    const inp = drive();
    if (inp.horn !== hornWas) audio.horn(inp.horn);
    if (inp.horn && !hornWas) birds.scare(car.pos.x, car.pos.z);
    hornWas = inp.horn;

    traffic.update(dt, car);
    phys.update(dt);
    handleEvents();
    if (game.mode === 'play') {
      wheelEffects(dt, car, true);
      if (car.groundedCount >= 2 && Number.isFinite(car.pos.x + car.pos.z)) { lastGood.x = car.pos.x; lastGood.z = car.pos.z; lastGood.h = car.headingYaw(); }
      // stuck on the side or roof: the self-righting push can make flippedTime saw-tooth, so
      // also count time spent not upright (slow decay)
      notUpright = car.R[4] < 0.5 ? notUpright + dt : Math.max(0, notUpright - dt * 0.5);
      if (car.pos.y < world.heightAt(car.pos.x, car.pos.z) - 5 || car.flippedTime > 6 || notUpright > 7 || Math.abs(car.pos.x) > world.half - 4 || Math.abs(car.pos.z) > world.half - 4) respawnOnRoad('Retour sur la route');
    }

    U.uTime.value = phys.time % 2000;
    U.uCarPos.value.set(car.pos.x, car.pos.y, car.pos.z);
    U.uCutout.value += ((game.mode === 'play' && view !== 'bonnet' ? 1 : 0) - U.uCutout.value) * Math.min(1, dt * 3);
    model.sync(car, dt);
    updateDirt(car, model, dt);
    traffic.cars.forEach((c, i) => {
      const m = aiModels[i];
      const d2 = (c.pos.x - camera.position.x) ** 2 + (c.pos.z - camera.position.z) ** 2;
      m.root.visible = d2 < quality.far * quality.far;
      if (m.root.visible) { m.sync(c, dt); updateDirt(c, m, dt); if (c.active && d2 < 70 * 70) wheelEffects(dt, c, false); }
    });
    propMeshes.sync(camera.position, quality.far * 0.6);
    particles.update(dt);
    tracks.update(phys.time, scene.fog);
    birds.update(game.time, dt, car.pos);
    sky.dome.position.copy(camera.position); // the sky is infinitely far: centre it on the eye
    updateCamera(dt);
    updateMood(dt);
    snowfall(dt);
    veg.cull(camera.position, scene.fog.far);
    sun.target.position.set(cam.target.x, car.pos.y, cam.target.z);
    const texel = (2 * SH) / quality.shadow;
    sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
    sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 120);

    audio.update(dt, {
      speed: car.speed, throttle: car.input.throttle, rpm: car.rpm, load: car.load, skid: car.skid, pitch: car.spec.sound.pitch,
      surface: [ 'asphalt', 'sand', 'snow', 'grass', 'sand', 'snow', 'rock', 'asphalt'][car.surface], wade: 0, airborne: car.airborne,
      camDistToShore: 60, paused: game.mode !== 'play',
    });

    hudT += dt;
    if (hudT > 0.1) {
      hudT = 0;
      if (game.mode === 'play') {
        $('kmh').textContent = String(Math.round(Math.abs(car.forwardSpeed) * 3.6));
        $('gear').textContent = car.forwardSpeed < -0.5 ? 'R' : String(car.gear);
        $('surf').textContent = SURF_LABEL[car.surface];
        minimap.draw(car, traffic.cars, cam.yaw);
      }
    }
    if (post && fxLevel > 0) {
      tmpV.set(car.pos.x, car.pos.y + 0.5, car.pos.z).project(camera);
      post.setFocus(view === 'bonnet' && game.mode === 'play' ? 0.5 : Math.max(0.15, Math.min(0.85, tmpV.y * 0.5 + 0.5)));
      post.render(dt);
      if (post.broken && fxLevel) { fxLevel = 0; setMenuStates(); }
    } else renderer.render(scene, camera);

    perfAcc += dt; perfN++; perfT += dt; upCooldown -= dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { if (!$('perf').hidden) $('perf').innerHTML = `<b>${Math.round(fpsN / fpsAcc)}</b> i/s`; fpsAcc = 0; fpsN = 0; }
    if (perfT > 2) {
      const avg = perfAcc / perfN;
      perfAcc = 0; perfN = 0; perfT = 0; fpsShown = 1 / avg;
      if (!lockQuality) {
        if (avg > 0.0215) {
          if (post && fxLevel > 1) { fxLevel--; post.setLevel(fxLevel); upCooldown = 12; }
          else if (traffic.nearDist > 90) { traffic.nearDist -= 40; traffic.farDist -= 40; upCooldown = 12; }
          else if (renderScale > 0.5) { renderScale = Math.max(0.5, renderScale - (avg > 0.03 ? 0.15 : 0.08)); maxScale = Math.min(maxScale, renderScale + 0.08); upCooldown = 10; applySize(); }
          else if (post && fxLevel > 0) { fxLevel = 0; post.setLevel(0); }
        } else if (avg < 0.0178 && upCooldown <= 0 && renderScale < maxScale - 0.001) { renderScale = Math.min(maxScale, renderScale + 0.07); upCooldown = 3; applySize(); }
      }
      const txt = `${Math.round(fpsShown)} i/s · ${renderer.getPixelRatio().toFixed(2)}x · fx ${post ? (post.broken ? 'off' : post.level) : '-'} · ${tierName}`;
      $('garagePerf').textContent = txt;
    }
  }
  requestAnimationFrame(frame);
  if (params.has('autoplay')) start();
}

boot().catch((e) => { console.error(e); window.__mbShowError?.(e && (e.stack || e.message) || e); });
