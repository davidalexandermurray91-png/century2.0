// Keyboard + a little mouse. Held state for movement, edge-triggered for actions.

const HELD = new Set();
const PRESSED = new Set();
export const mouse = { x: 0, y: 0, down: false, clicked: false, active: false };

const CODE_ALIASES = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

const SWALLOW = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
]);

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    HELD.add(e.code);
    PRESSED.add(e.code);
    const alias = CODE_ALIASES[e.code];
    if (alias) { HELD.add(alias); PRESSED.add(alias); }
  });
  window.addEventListener('keyup', (e) => {
    HELD.delete(e.code);
    const alias = CODE_ALIASES[e.code];
    if (alias) HELD.delete(alias);
  });
  window.addEventListener('blur', () => { HELD.clear(); mouse.down = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    mouse.active = true;
  });
  canvas.addEventListener('mouseleave', () => { mouse.active = false; });
  canvas.addEventListener('mousedown', () => { mouse.down = true; mouse.clicked = true; });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export const held = (code) => HELD.has(code);
export const pressed = (code) => PRESSED.has(code);

/** Call once at the end of every frame. */
export function endFrame() {
  PRESSED.clear();
  mouse.clicked = false;
}

/** Most recently requested direction, or null. */
export function movementIntent() {
  if (held('up')) return { x: 0, y: -1 };
  if (held('down')) return { x: 0, y: 1 };
  if (held('left')) return { x: -1, y: 0 };
  if (held('right')) return { x: 1, y: 0 };
  return null;
}

/**
 * Prefer the most recent keypress so quick corner turns feel right.
 * Returns null when no direction is wanted — releasing the keys has to bring
 * you to a stop, or you could never stand still to build or hold a corridor.
 */
export function freshestIntent() {
  if (pressed('up')) return { x: 0, y: -1 };
  if (pressed('down')) return { x: 0, y: 1 };
  if (pressed('left')) return { x: -1, y: 0 };
  if (pressed('right')) return { x: 1, y: 0 };
  return movementIntent();
}
