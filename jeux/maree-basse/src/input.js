// Touch: a steering bar on the left (tap ◀ / ▶ for full lock, slide for analog) and two
// pedals on the right (gas, brake → reverse once stopped). Nothing moves without a finger.
// The pedals are one hit zone so a thumb can roll from gas to brake without lifting.
// Keyboard too.

export function createInput({ wheel, wheelKnob, pedals, gas, brake, horn }) {
  const state = {
    steer: { id: null, x: 0 },
    pedalPointers: new Map(), // pointerId -> 'gas' | 'brake' | null
    keys: new Set(),
    horn: false,
    onFirstUse: null,
    enabled: false,
  };
  const first = () => { if (state.onFirstUse) { const f = state.onFirstUse; state.onFirstUse = null; f(); } };

  // ---- steering bar
  const steerFrom = (clientX) => {
    const r = wheel.getBoundingClientRect();
    const half = r.width / 2;
    let v = (clientX - (r.left + half)) / (half * 0.78);
    const DZ = 0.08;
    v = Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ);
    return Math.max(-1, Math.min(1, v));
  };
  const showKnob = (v) => {
    const r = wheel.getBoundingClientRect();
    wheelKnob.style.transform = `translateX(${(v * r.width * 0.36).toFixed(1)}px)`;
    wheel.classList.toggle('left', v < -0.05);
    wheel.classList.toggle('right', v > 0.05);
  };
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!state.enabled || state.steer.id !== null) return;
    first();
    try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    state.steer.id = e.pointerId;
    state.steer.x = steerFrom(e.clientX);
    wheel.classList.add('down');
    showKnob(state.steer.x);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== state.steer.id) return;
    e.preventDefault();
    state.steer.x = steerFrom(e.clientX);
    showKnob(state.steer.x);
  });
  const steerEnd = (e) => {
    if (e.pointerId !== state.steer.id) return;
    state.steer.id = null; state.steer.x = 0;
    wheel.classList.remove('down');
    showKnob(0);
  };
  wheel.addEventListener('pointerup', steerEnd);
  wheel.addEventListener('pointercancel', steerEnd);
  wheel.addEventListener('lostpointercapture', steerEnd);

  // ---- pedals (single hit zone)
  const pedalAt = (x, y) => {
    let best = null, bd = Infinity;
    for (const [name, el] of [['gas', gas], ['brake', brake]]) {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = name; }
    }
    return bd < 40 ? best : null;
  };
  const refreshPedals = () => {
    let g = false, b = false;
    for (const v of state.pedalPointers.values()) { if (v === 'gas') g = true; if (v === 'brake') b = true; }
    gas.classList.toggle('down', g && !b);
    brake.classList.toggle('down', b);
  };
  pedals.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!state.enabled) return;
    first();
    try { pedals.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    state.pedalPointers.set(e.pointerId, pedalAt(e.clientX, e.clientY));
    refreshPedals();
  });
  pedals.addEventListener('pointermove', (e) => {
    if (!state.pedalPointers.has(e.pointerId)) return;
    e.preventDefault();
    state.pedalPointers.set(e.pointerId, pedalAt(e.clientX, e.clientY));
    refreshPedals();
  });
  const pedalEnd = (e) => { if (state.pedalPointers.delete(e.pointerId)) refreshPedals(); };
  pedals.addEventListener('pointerup', pedalEnd);
  pedals.addEventListener('pointercancel', pedalEnd);
  pedals.addEventListener('lostpointercapture', pedalEnd);

  // ---- horn
  let hornId = null;
  horn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (hornId !== null) return;
    hornId = e.pointerId; state.horn = true; horn.classList.add('down'); first();
    try { horn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  const hornEnd = (e) => { if (e.pointerId !== hornId) return; hornId = null; state.horn = false; horn.classList.remove('down'); };
  horn.addEventListener('pointerup', hornEnd);
  horn.addEventListener('pointercancel', hornEnd);
  horn.addEventListener('lostpointercapture', hornEnd);
  for (const el of [wheel, pedals, horn]) el.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- keyboard
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
    e.preventDefault();
    state.keys.add(k);
    first();
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) state.keys.delete(k); });
  const reset = () => {
    state.keys.clear(); state.steer.id = null; state.steer.x = 0; state.pedalPointers.clear(); state.horn = false; hornId = null;
    wheel.classList.remove('down'); showKnob(0); refreshPedals(); horn.classList.remove('down');
  };
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  // steer: -1 right .. +1 left (car frame); throttle: 1 gas, -1 brake/reverse; brake: engine braking when coasting
  state.read = function () {
    const K = state.keys;
    const kx = (K.has('right') ? 1 : 0) - (K.has('left') ? 1 : 0);
    const ky = (K.has('up') ? 1 : 0) - (K.has('down') ? 1 : 0);
    let g = false, b = false;
    for (const v of state.pedalPointers.values()) { if (v === 'gas') g = true; if (v === 'brake') b = true; }
    const sx = state.steer.id !== null ? Math.sign(state.steer.x) * Math.pow(Math.abs(state.steer.x), 1.25) : 0;
    const steer = kx !== 0 ? -kx : -sx;
    const throttle = b || ky < 0 ? -1 : g || ky > 0 ? 1 : 0;
    return { steer, throttle, brake: throttle === 0 ? 0.12 : 0, handbrake: K.has('hb'), horn: state.horn || K.has('horn') };
  };
  state.reset = reset;
  return state;
}
