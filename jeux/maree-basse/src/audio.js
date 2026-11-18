// Marée Basse - procedural WebAudio (no assets, no dependencies).
// Cosy golden-hour lagoon: soft engine, sandy tyres, surf, breeze, gulls.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function num(v, lo, hi, def = 0) {
  v = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(v)) v = def;
  return clamp(v, lo, hi);
}
const rand = (a, b) => a + Math.random() * (b - a);

const SURFACES = {
  //            bp freq, Q,   level, noise
  sand:    { f: 1800, q: 0.5, g: 0.10 },
  wetsand: { f: 900,  q: 0.8, g: 0.12 },
  grass:   { f: 3200, q: 0.4, g: 0.07 },
  rock:    { f: 1400, q: 0.9, g: 0.16 },
  wood:    { f: 700,  q: 1.2, g: 0.15 },
  water:   { f: 600,  q: 0.5, g: 0.0 },
};

export function createAudio() {
  let ctx = null;
  let unlocked = false;
  let failed = false;
  let muted = false;
  let visHooked = false;

  // graph nodes
  let master, comp, engineBus, ambBus;
  let pinkBuf, brownBuf;
  let eng = null, tyre = null, skid = null, wade = null, surf = null, breeze = null;
  let hornNodes = null;
  const lastBump = {};
  let swellT = 0, swellHigh = false, breezeT = 0, gullT = 0, bloopT = 0;
  let wasPaused = null;

  const now = () => ctx.currentTime;
  const smooth = (param, v, tc = 0.07) => {
    try { param.setTargetAtTime(v, ctx.currentTime, tc); } catch (e) { /* ignore */ }
  };

  function makeNoise(kind) {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    // crossfade the loop seam
    const n = 256;
    for (let i = 0; i < n; i++) {
      const a = i / n;
      d[len - n + i] = d[len - n + i] * (1 - a) + d[i] * a;
    }
    return buf;
  }

  function loopNoise(buf) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = buf.duration - 256 / ctx.sampleRate;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  function lfo(freq, amount, target, type = 'sine') {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amount;
    o.connect(g);
    g.connect(target);
    o.start();
    return { osc: o, amt: g };
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.knee.value = 20;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);

    engineBus = ctx.createGain();
    engineBus.connect(master);
    ambBus = ctx.createGain();
    ambBus.connect(master);

    pinkBuf = makeNoise('pink');
    brownBuf = makeNoise('brown');

    // ---- engine
    {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 38;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 76;
      const g1 = ctx.createGain(); g1.gain.value = 0.5;
      const g2 = ctx.createGain(); g2.gain.value = 0.22;
      const fire = ctx.createGain(); fire.gain.value = 0.6;
      const fl = lfo(7, 0.3, fire.gain);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.8;
      const vol = ctx.createGain(); vol.gain.value = 0;
      o1.connect(g1); o2.connect(g2); g1.connect(fire); g2.connect(fire);
      fire.connect(lp); lp.connect(vol); vol.connect(engineBus);
      o1.start(); o2.start();
      eng = { o1, o2, fire, fl, lp, vol };
    }

    // ---- tyres
    {
      const src = loopNoise(pinkBuf);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.5;
      const mod = ctx.createGain(); mod.gain.value = 1;
      const ml = lfo(6, 0, mod.gain, 'triangle');
      const vol = ctx.createGain(); vol.gain.value = 0;
      src.connect(bp); bp.connect(mod); mod.connect(vol); vol.connect(engineBus);
      tyre = { bp, mod, ml, vol };
    }
    // ---- skid (sandy scrub)
    {
      const src = loopNoise(pinkBuf);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
      const vol = ctx.createGain(); vol.gain.value = 0;
      src.connect(bp); bp.connect(vol); vol.connect(engineBus);
      skid = { bp, vol };
    }
    // ---- wading
    {
      const src = loopNoise(brownBuf);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.7;
      lfo(0.37, 180, lp.frequency);
      const sw = ctx.createGain(); sw.gain.value = 0.7;
      lfo(0.9, 0.25, sw.gain);
      const vol = ctx.createGain(); vol.gain.value = 0;
      src.connect(lp); lp.connect(sw); sw.connect(vol); vol.connect(engineBus);
      wade = { vol };
    }
    // ---- surf
    {
      const src = loopNoise(brownBuf);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.5;
      const swell = ctx.createGain(); swell.gain.value = 0.5;
      const shore = ctx.createGain(); shore.gain.value = 0.05;
      src.connect(lp); lp.connect(swell); swell.connect(shore); shore.connect(ambBus);
      surf = { swell, shore };
    }
    // ---- breeze
    {
      const src = loopNoise(pinkBuf);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.7;
      lfo(0.05, 40, bp.frequency);
      const vol = ctx.createGain(); vol.gain.value = 0.03;
      src.connect(bp); bp.connect(vol); vol.connect(ambBus);
      breeze = { vol };
    }
    swellT = 0; breezeT = 0; gullT = rand(6, 14); bloopT = 1;
  }

  function hookVisibility() {
    if (visHooked || typeof document === 'undefined') return;
    visHooked = true;
    document.addEventListener('visibilitychange', () => {
      try {
        if (!ctx || !unlocked || ctx.state === 'closed') return;
        if (document.hidden) ctx.suspend().catch(() => {});
        else ctx.resume().catch(() => {});
      } catch (e) { /* ignore */ }
    });
  }

  function ok() {
    return unlocked && !failed && ctx && ctx.state !== 'closed';
  }

  // ---------- one-shot helpers
  function cleanup(src, nodes) {
    src.onended = () => {
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    };
  }

  function tone(type, f0, f1, t, dur, vol, attack = 0.004, dest = master, pan = null) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    let out = g;
    const nodes = [o, g];
    if (pan) { g.connect(pan); nodes.push(pan); out = pan; }
    out.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    cleanup(o, nodes);
  }

  function noiseBurst(ftype, f0, f1, q, t, dur, vol, attack = 0.005) {
    const s = ctx.createBufferSource();
    s.buffer = pinkBuf;
    const f = ctx.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 1.5, dur + 0.05);
    cleanup(s, [s, f, g]);
  }

  function bloop(t, vol) {
    const f = rand(450, 1100);
    tone('sine', f, f * rand(1.5, 2.1), t, rand(0.04, 0.08), vol, 0.004);
  }

  function makePan() {
    try {
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = rand(-0.8, 0.8);
        return p;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- public
  const api = {
    unlock() {
      if (failed) return;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) { failed = true; return; }
          ctx = new AC();
          try {
            const b = ctx.createBuffer(1, 1, 22050);
            const s = ctx.createBufferSource();
            s.buffer = b; s.connect(ctx.destination); s.start(0);
          } catch (e) { /* ignore */ }
          build();
          unlocked = true;
          hookVisibility();
        }
        if (ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) {
        failed = true;
        unlocked = false;
      }
    },

    setMuted(m) {
      muted = !!m;
      if (!ok()) return;
      try {
        const t = now();
        const g = master.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(muted ? 0 : 0.85, t + 0.15);
      } catch (e) { /* ignore */ }
    },

    isMuted() { return muted; },

    update(dt, s) {
      if (!ok()) return;
      try {
        dt = num(dt, 0, 0.5, 0.016);
        s = s || {};
        const speed = num(s.speed, 0, 40);
        const rpm = num(s.rpm, 0, 1);
        const load = num(s.load, 0, 1);
        const skidA = num(s.skid, 0, 1);
        const wadeA = num(s.wade, 0, 1);
        const dist = num(s.camDistToShore, 0, 60, 60);
        const airborne = !!s.airborne;
        const paused = !!s.paused;
        const surface = SURFACES[s.surface] ? s.surface : 'sand';
        const t = now();

        // pause ducking
        const act = paused ? 0 : 1;
        smooth(engineBus.gain, act, paused ? 0.1 : 0.12);
        smooth(ambBus.gain, paused ? 0.5 : 1, 0.12);

        // engine
        const f0 = 38 + 82 * rpm;
        smooth(eng.o1.frequency, f0, 0.05);
        smooth(eng.o2.frequency, f0 * 2, 0.05);
        const fireHz = 6 + 30 * rpm;
        smooth(eng.fl.osc.frequency, fireHz, 0.08);
        const depth = clamp(0.75 * (1 - rpm) + 0.1, 0, 0.85);
        smooth(eng.fire.gain, 1 - depth / 2, 0.08);
        smooth(eng.fl.amt.gain, depth / 2, 0.08);
        let cut = 300 + 1100 * clamp(0.65 * rpm + 0.35 * load, 0, 1);
        cut *= 1 - 0.7 * wadeA;
        smooth(eng.lp.frequency, cut, 0.08);
        const ev = (0.08 + 0.13 * load + 0.04 * rpm) * (1 - 0.35 * wadeA);
        smooth(eng.vol.gain, ev, 0.08);

        // tyres
        const sp = SURFACES[surface];
        const grounded = !airborne && surface !== 'water';
        const spd = clamp(speed / 12, 0, 1);
        smooth(tyre.vol.gain, grounded ? sp.g * spd * (1 - 0.6 * wadeA) : 0, 0.08);
        smooth(tyre.bp.frequency, sp.f * (0.8 + 0.4 * spd), 0.1);
        smooth(tyre.bp.Q, sp.q, 0.1);
        const wd = surface === 'wood' ? 0.8 : 0;
        smooth(tyre.mod.gain, 1 - wd / 2, 0.05);
        smooth(tyre.ml.amt.gain, wd / 2, 0.05);
        smooth(tyre.ml.osc.frequency, 2 + speed * 1.2, 0.08);

        // skid
        smooth(skid.vol.gain, airborne ? 0 : skidA * 0.12 * clamp(0.35 + speed / 8, 0, 1), 0.07);
        smooth(skid.bp.frequency, 1800 + 1200 * skidA, 0.1);

        // wade
        smooth(wade.vol.gain, wadeA * Math.min(1, speed / 6) * 0.28, 0.1);
        if (wadeA > 0.05 && speed > 0.5) {
          bloopT -= dt;
          if (bloopT <= 0) {
            bloopT = rand(0.25, 0.9) / (0.4 + wadeA);
            bloop(t, 0.025 * wadeA);
          }
        }

        // surf
        swellT -= dt;
        if (swellT <= 0) {
          swellT = rand(5, 9);
          swellHigh = !swellHigh;
          smooth(surf.swell.gain, swellHigh ? rand(0.85, 1) : rand(0.35, 0.5), swellT * 0.3);
        }
        const near = 1 - dist / 60;
        smooth(surf.shore.gain, 0.04 + 0.16 * Math.pow(near, 1.3), 0.3);

        // breeze
        breezeT -= dt;
        if (breezeT <= 0) {
          breezeT = rand(3, 7);
          smooth(breeze.vol.gain, rand(0.012, 0.05), breezeT * 0.35);
        }

        // gulls
        gullT -= dt;
        if (gullT <= 0) {
          gullT = rand(12, 30);
          if (!paused) api.gull();
        }
        wasPaused = paused;
      } catch (e) { /* ignore */ }
    },

    horn(on) {
      if (!ok()) return;
      try {
        on = !!on;
        const t = now();
        if (on && !hornNodes) {
          const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 415;
          const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 522; o2.detune.value = 9;
          const m1 = ctx.createGain(); m1.gain.value = 0.5;
          const m2 = ctx.createGain(); m2.gain.value = 0.5;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.16, t + 0.015);
          const vib = ctx.createOscillator(); vib.frequency.value = 6;
          const vg = ctx.createGain(); vg.gain.value = 5;
          vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
          o1.connect(m1); o2.connect(m2); m1.connect(bp); m2.connect(bp);
          bp.connect(g); g.connect(master);
          o1.start(t); o2.start(t); vib.start(t);
          hornNodes = { o1, o2, vib, g, nodes: [o1, o2, vib, vg, m1, m2, bp, g] };
        } else if (!on && hornNodes) {
          const h = hornNodes;
          hornNodes = null;
          h.g.gain.cancelScheduledValues(t);
          h.g.gain.setValueAtTime(Math.max(h.g.gain.value, 0.0001), t);
          h.g.gain.linearRampToValueAtTime(0.0001, t + 0.06);
          h.o1.stop(t + 0.08); h.o2.stop(t + 0.08); h.vib.stop(t + 0.08);
          cleanup(h.o1, h.nodes);
        }
      } catch (e) { /* ignore */ }
    },

    splash(intensity) {
      if (!ok()) return;
      try {
        const i = num(intensity, 0, 1);
        const t = now() + 0.005;
        const dur = 0.25 + 0.5 * i;
        noiseBurst('bandpass', rand(2600, 3600), rand(500, 800), 0.8, t, dur, 0.06 + 0.3 * i, 0.012);
        noiseBurst('lowpass', 1200, 300, 0.5, t, dur * 1.2, 0.05 + 0.2 * i, 0.02);
        const n = Math.floor(i * 5 + (i > 0.35 ? 1 : 0));
        for (let k = 0; k < n; k++) bloop(t + 0.08 + k * rand(0.05, 0.12), 0.03 + 0.04 * i);
      } catch (e) { /* ignore */ }
    },

    bump(intensity, kind) {
      if (!ok()) return;
      try {
        const i = num(intensity, 0, 1);
        if (i <= 0.01) return;
        const k = typeof kind === 'string' ? kind : 'ground';
        const t = now();
        if (lastBump[k] !== undefined && t - lastBump[k] < 0.05) return;
        lastBump[k] = t;
        const v = 0.05 + 0.3 * i;
        const r = rand(0.92, 1.08);
        switch (k) {
          case 'ball':
            tone('sine', 420 * r, 230 * r, t, 0.16, v * 0.8, 0.003);
            tone('triangle', 840 * r, 400 * r, t, 0.06, v * 0.3, 0.002);
            noiseBurst('bandpass', 1500, 900, 1.5, t, 0.04, v * 0.3, 0.002);
            break;
          case 'ring':
            tone('sine', 110, 70, t, 0.14, v, 0.004);
            tone('triangle', 520 * r, 900 * r, t, 0.12, v * 0.25, 0.01);
            tone('triangle', 900 * r, 640 * r, t + 0.1, 0.1, v * 0.15, 0.01);
            noiseBurst('lowpass', 700, 300, 0.5, t, 0.08, v * 0.4, 0.004);
            break;
          case 'buoy':
            tone('sine', 190 * r, 150 * r, t, 0.22, v * 0.9, 0.003);
            tone('sine', 480 * r, 470 * r, t, 0.55, v * 0.3, 0.002);
            tone('sine', 1130 * r, 1120 * r, t, 0.35, v * 0.15, 0.002);
            break;
          case 'wood':
            noiseBurst('bandpass', 750 * r, 500, 1.8, t, 0.09, v * 0.7, 0.002);
            tone('sine', 200 * r, 120 * r, t, 0.12, v * 0.7, 0.003);
            tone('triangle', 330 * r, 260 * r, t + 0.045, 0.08, v * 0.3, 0.002);
            break;
          case 'rock':
            tone('sine', 85 * r, 42, t, 0.28, v * 1.1, 0.004);
            noiseBurst('lowpass', 420, 150, 0.6, t, 0.14, v * 0.5, 0.004);
            break;
          default: // ground
            tone('sine', 70 * r, 38, t, 0.22, v * 1.1, 0.004);
            noiseBurst('bandpass', 900, 400, 0.9, t + 0.02, 0.16, v * 0.35, 0.006);
        }
      } catch (e) { /* ignore */ }
    },

    chime(index, total) {
      if (!ok()) return;
      try {
        total = Math.round(num(total, 1, 999, 1));
        const idx = Math.round(num(index, 0, 998, 0));
        const last = idx >= total - 1;
        const prog = total > 1 ? Math.min(idx, total - 1) / (total - 1) : 1;
        const root = 392 * Math.pow(2, (prog * 5) / 12); // G4 rising up to ~C5
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
        const t0 = now() + 0.01;
        const note = (deg, when, vol, dur) => {
          const f = root * Math.pow(2, scale[deg] / 12);
          tone('sine', f, 0, when, dur, vol, 0.004);
          tone('sine', f * 2, 0, when, dur * 0.35, vol * 0.3, 0.003);
          tone('triangle', f * 4.02, 0, when, 0.05, vol * 0.12, 0.002);
        };
        if (!last) {
          const seq = idx % 2 === 0 ? [0, 1, 2, 3] : [0, 2, 3, 5];
          const n = idx % 3 === 2 ? 3 : 4;
          for (let k = 0; k < n; k++) note(seq[k], t0 + k * 0.085, 0.13, 0.7);
        } else {
          const seq = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
          for (let k = 0; k < seq.length; k++) note(seq[k], t0 + k * 0.1, 0.12, 1.0 + k * 0.05);
          const tc = t0 + 1.0;
          [0, 2, 4, 5].forEach((d, k) => {
            const f = root * Math.pow(2, scale[d] / 12);
            tone('triangle', f, 0, tc + k * 0.02, 1.4, 0.07, 0.05);
            tone('sine', f * 2, 0, tc + k * 0.02, 1.2, 0.04, 0.04);
          });
          for (let k = 0; k < 6; k++) {
            const f = root * 4 * Math.pow(2, scale[(k * 2) % 5] / 12);
            tone('sine', f, 0, tc + 0.1 + k * 0.1, 0.35, 0.035, 0.003);
          }
        }
      } catch (e) { /* ignore */ }
    },

    uiTap() {
      if (!ok()) return;
      try {
        const t = now();
        tone('sine', 1250, 800, t, 0.035, 0.07, 0.002);
        noiseBurst('bandpass', 2500, 1800, 1, t, 0.02, 0.015, 0.001);
      } catch (e) { /* ignore */ }
    },

    gull() {
      if (!ok()) return;
      try {
        const t0 = now() + 0.02;
        const pan = makePan();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 3200;
        lp.connect(master);
        setTimeout(() => { try { lp.disconnect(); } catch (e) { /* ignore */ } }, 4000);
        const n = Math.random() < 0.5 ? 2 : 3;
        let t = t0;
        const base = rand(1500, 1900);
        for (let k = 0; k < n; k++) {
          const d = rand(0.16, 0.3);
          const o = ctx.createOscillator();
          o.type = k % 2 ? 'triangle' : 'sine';
          o.frequency.setValueAtTime(base * 0.8, t);
          o.frequency.exponentialRampToValueAtTime(base * rand(1.3, 1.6), t + d * 0.3);
          o.frequency.exponentialRampToValueAtTime(base * rand(0.9, 1.1), t + d);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(rand(0.025, 0.04), t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          o.connect(g);
          const nodes = [o, g];
          if (pan) { g.connect(pan); } else { g.connect(lp); }
          o.start(t); o.stop(t + d + 0.05);
          cleanup(o, nodes);
          t += d + rand(0.05, 0.12);
        }
        if (pan) pan.connect(lp);
      } catch (e) { /* ignore */ }
    },
  };

  return api;
}
