// Controls: the keyboard (one player, or two sharing it) and the on-screen
// touch controls for phones and tablets.
//
// Player 1 (or on your own)        Player 2 (two on one keyboard)
//   WASD / arrows  run               Arrows       run
//   Shift          sprint            Right Shift  sprint
//   E              pass              K            pass
//   Q              lofted pass       J            lofted pass
//   Space          shoot             L            shoot
//   T              slide tackle      U            slide tackle
//   C              switch player     I            switch player

export const KEYMAPS = {
  solo: {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'], pass: ['KeyE'], loft: ['KeyQ'], shoot: ['Space'], slide: ['KeyT'], switch: ['KeyC'],
  },
  p1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    sprint: ['ShiftLeft'], pass: ['KeyE'], loft: ['KeyQ'], shoot: ['Space'], slide: ['KeyT'], switch: ['KeyC'],
  },
  p2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    sprint: ['ShiftRight'], pass: ['KeyK'], loft: ['KeyJ'], shoot: ['KeyL'], slide: ['KeyU'], switch: ['KeyI'],
  },
};

const GAME_KEYS = new Set(Object.values(KEYMAPS).flatMap((m) => Object.values(m).flat()));

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.stick = null; // { x, z } from the touch joystick
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    // Let go of everything if the window loses focus mid-sprint.
    window.addEventListener('blur', () => this.releaseAll());
  }

  releaseAll() {
    for (const k of this.down) this.released.add(k);
    this.down.clear();
    this.stick = null;
  }

  // On-screen buttons press virtual keys.
  press(code) {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  release(code) {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.released.add(code);
  }

  // What one player is doing this frame, with the keys in `map`.
  readFor(map) {
    const k = this.down, any = (codes) => codes.some((c) => k.has(c)), hit = (set, codes) => codes.some((c) => set.has(c));
    let x = (any(map.right) ? 1 : 0) - (any(map.left) ? 1 : 0);
    let z = (any(map.down) ? 1 : 0) - (any(map.up) ? 1 : 0);
    if (!x && !z && this.stick && map === KEYMAPS.solo) ({ x, z } = this.stick);
    const n = Math.max(1, Math.hypot(x, z));
    return {
      move: { x: x / n, z: z / n },
      sprint: any(map.sprint),
      pass: hit(this.pressed, map.pass),
      loft: hit(this.pressed, map.loft),
      shootPressed: hit(this.pressed, map.shoot),
      shootReleased: hit(this.released, map.shoot),
      slide: hit(this.pressed, map.slide),
      switch: hit(this.pressed, map.switch),
    };
  }

  // One player on their own.
  read() {
    const out = this.readFor(KEYMAPS.solo);
    this.clearEdges();
    return out;
  }

  // Two players sharing the keyboard: [Reds, Blues].
  readTwo() {
    const out = [this.readFor(KEYMAPS.p1), this.readFor(KEYMAPS.p2)];
    this.clearEdges();
    return out;
  }

  clearEdges() {
    this.pressed.clear();
    this.released.clear();
  }

  // For one-off keys the page handles itself (pause, mute).
  took(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }
}

// On-screen controls: a joystick that appears wherever your left thumb goes
// down, and buttons on the right. The buttons press the same keys as the
// keyboard, so shooting works the same way: hold, let go, tap again.
export class TouchControls {
  constructor(root, input) {
    this.input = input;
    root.innerHTML = `
      <div class="stick-zone"><div class="stick"><div class="knob"></div></div></div>
      <div class="pad">
        <button class="tbtn shoot" data-key="Space"><b>Shoot</b><small>hold · let go · tap</small></button>
        <button class="tbtn pass" data-key="KeyE"><b>Pass</b></button>
        <button class="tbtn loft" data-key="KeyQ"><b>Lob</b></button>
        <button class="tbtn sprint" data-key="ShiftLeft"><b>Sprint</b></button>
        <button class="tbtn slide" data-key="KeyT"><b>Slide</b></button>
        <button class="tbtn switch" data-key="KeyC"><b>Switch</b></button>
      </div>`;
    this.zone = root.querySelector('.stick-zone');
    this.stickEl = root.querySelector('.stick');
    this.knob = root.querySelector('.knob');
    this.pad = root.querySelector('.pad');

    for (const b of root.querySelectorAll('.tbtn')) {
      const key = b.dataset.key;
      const down = (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        b.classList.add('on');
        input.press(key);
      };
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('on');
        input.release(key);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Joystick.
    let id = null, ox = 0, oy = 0;
    const R = 50;
    this.zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      this.zone.setPointerCapture?.(id);
      ox = e.clientX;
      oy = e.clientY;
      this.stickEl.style.left = `${ox}px`;
      this.stickEl.style.top = `${oy}px`;
      this.stickEl.classList.add('on');
      this.knob.style.transform = 'translate(-50%, -50%)';
      input.stick = { x: 0, z: 0 };
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) (dx *= R / d), (dy *= R / d);
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // A small dead zone, then full speed from about half way out.
      const m = d < 8 ? 0 : Math.min(1, d / (R * 0.6));
      const n = Math.hypot(dx, dy) || 1;
      input.stick = { x: (dx / n) * m, z: (dy / n) * m };
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stickEl.classList.remove('on');
      input.stick = null;
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  // Dim the buttons that don't do anything right now.
  update(match, side) {
    const h = match.ctl[side];
    const has = !!h && match.ball.owner === h;
    this.pad.classList.toggle('attacking', has);
    this.pad.classList.toggle('defending', !has);
  }
}

export const isTouch = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
