// Touch joystick (floating, left side), hold buttons, keyboard. Produces a camera-relative
// direction intent that the game turns into steer/throttle.

export function createInput({ zone, stick, knob, buttons }) {
  const state = {
    joy: { active: false, x: 0, y: 0, id: null, ox: 0, oy: 0 },
    keys: new Set(),
    handbrake: false, horn: false,
    usedTouch: false, usedKeys: false,
    onFirstUse: null,
  };
  const R = 62; // px radius of travel
  const first = () => { if (state.onFirstUse) { const f = state.onFirstUse; state.onFirstUse = null; f(); } };

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  zone.addEventListener('pointerdown', (e) => {
    if (state.joy.active) return;
    e.preventDefault();
    state.usedTouch = true;
    first();
    zone.setPointerCapture?.(e.pointerId);
    const j = state.joy;
    j.active = true; j.id = e.pointerId; j.ox = e.clientX; j.oy = e.clientY; j.x = 0; j.y = 0;
    stick.style.left = `${e.clientX}px`; stick.style.top = `${e.clientY}px`;
    stick.classList.add('on');
    setKnob(0, 0);
  });
  const move = (e) => {
    const j = state.joy;
    if (!j.active || e.pointerId !== j.id) return;
    e.preventDefault();
    let dx = e.clientX - j.ox, dy = e.clientY - j.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      // drag the origin along so direction changes stay responsive
      const over = l - R;
      j.ox += (dx / l) * over; j.oy += (dy / l) * over;
      stick.style.left = `${j.ox}px`; stick.style.top = `${j.oy}px`;
      dx = (dx / l) * R; dy = (dy / l) * R;
    }
    j.x = dx / R; j.y = -dy / R;
    setKnob(dx, dy);
  };
  const end = (e) => {
    const j = state.joy;
    if (!j.active || e.pointerId !== j.id) return;
    j.active = false; j.x = 0; j.y = 0; j.id = null;
    stick.classList.remove('on');
    setKnob(0, 0);
  };
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);

  for (const [name, el] of Object.entries(buttons)) {
    const down = (e) => { e.preventDefault(); state[name] = true; el.classList.add('down'); first(); el.setPointerCapture?.(e.pointerId); };
    const up = () => { state[name] = false; el.classList.remove('down'); };
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
    state.usedKeys = true;
    first();
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) state.keys.delete(k); });
  window.addEventListener('blur', () => { state.keys.clear(); state.joy.active = false; state.joy.x = state.joy.y = 0; stick.classList.remove('on'); });

  // Returns { mode: 'dir'|'car', x, y, handbrake, horn }
  state.read = function () {
    const K = state.keys;
    const kx = (K.has('right') ? 1 : 0) - (K.has('left') ? 1 : 0);
    const ky = (K.has('up') ? 1 : 0) - (K.has('down') ? 1 : 0);
    const hb = state.handbrake || K.has('hb');
    const horn = state.horn || K.has('horn');
    if (state.joy.active) return { mode: 'dir', x: state.joy.x, y: state.joy.y, handbrake: hb, horn };
    return { mode: 'car', x: kx, y: ky, handbrake: hb, horn };
  };
  return state;
}
