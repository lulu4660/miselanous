// Touch: one thumb is wheel + accelerator. Put it down anywhere on the play area to drive
// forward; slide it left/right to steer (analog, car-relative); lift it and the car brakes
// to a stop. A hold button reverses (works together with the steering thumb). Keyboard too.

export function createInput({ zone, steerUI, knob, buttons }) {
  const state = {
    drag: { active: false, id: null, ox: 0, x: 0, y0: 0 },
    keys: new Set(),
    reverse: false, horn: false,
    onFirstUse: null,
  };
  const RANGE = 64; // px of horizontal travel for full lock
  const first = () => { if (state.onFirstUse) { const f = state.onFirstUse; state.onFirstUse = null; f(); } };

  const showSteer = (x, y) => { steerUI.style.left = `${x}px`; steerUI.style.top = `${y}px`; steerUI.classList.add('on'); };
  const setKnob = (v) => { knob.style.transform = `translateX(${v * RANGE}px)`; };

  zone.addEventListener('pointerdown', (e) => {
    const d = state.drag;
    if (d.active) return;
    e.preventDefault();
    first();
    try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    d.active = true; d.id = e.pointerId; d.ox = e.clientX; d.x = 0; d.y0 = e.clientY;
    showSteer(e.clientX, e.clientY);
    setKnob(0);
  });
  zone.addEventListener('pointermove', (e) => {
    const d = state.drag;
    if (!d.active || e.pointerId !== d.id) return;
    e.preventDefault();
    // origin stays where the thumb landed: coming back to it always means "straight"
    let dx = e.clientX - d.ox;
    const DZ = 6;
    dx = Math.abs(dx) < DZ ? 0 : dx - Math.sign(dx) * DZ;
    d.x = Math.max(-1, Math.min(1, dx / (RANGE - DZ)));
    setKnob(d.x);
  });
  const end = (e) => {
    const d = state.drag;
    if (!d.active || e.pointerId !== d.id) return;
    d.active = false; d.id = null; d.x = 0;
    steerUI.classList.remove('on');
    setKnob(0);
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);

  for (const [name, el] of Object.entries(buttons)) {
    let pid = null;
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pid !== null) return;
      pid = e.pointerId;
      state[name] = true; el.classList.add('down'); first();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    const up = (e) => {
      if (pid !== null && e.pointerId !== pid) return;
      pid = null; state[name] = false; el.classList.remove('down');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', KeyZ: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'hb', KeyK: 'horn', KeyH: 'horn',
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    if (e.target && /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName) && e.code === 'Space') return;
    e.preventDefault();
    state.keys.add(k);
    first();
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) state.keys.delete(k); });
  const reset = () => {
    state.keys.clear(); state.drag.active = false; state.drag.x = 0; state.drag.id = null;
    state.reverse = false; state.horn = false;
    steerUI.classList.remove('on'); setKnob(0);
    for (const el of Object.values(buttons)) el.classList.remove('down');
  };
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  // Returns car-relative commands: steer (-1 right .. +1 left), throttle (-1..1), brake (0..1)
  state.read = function () {
    const K = state.keys;
    const d = state.drag;
    const horn = state.horn || K.has('horn');
    if (K.size && !K.has('horn')) {
      const kx = (K.has('right') ? 1 : 0) - (K.has('left') ? 1 : 0);
      const ky = (K.has('up') ? 1 : 0) - (K.has('down') ? 1 : 0);
      return { steer: -kx, throttle: ky, brake: ky === 0 ? 0.6 : 0, handbrake: K.has('hb'), horn, touching: false };
    }
    // analog steering with a gentle response curve (finer control near centre)
    const sx = d.active ? Math.sign(d.x) * Math.pow(Math.abs(d.x), 1.35) : 0;
    if (state.reverse) return { steer: -sx, throttle: -1, brake: 0, handbrake: false, horn, touching: true };
    if (d.active) return { steer: -sx, throttle: 1, brake: 0, handbrake: false, horn, touching: true };
    return { steer: 0, throttle: 0, brake: 0.6, handbrake: K.has('hb'), horn, touching: false };
  };
  return state;
}
