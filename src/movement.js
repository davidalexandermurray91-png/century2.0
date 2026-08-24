import { TILE } from './config.js';
import { toCell } from './world.js';

const EPS = 0.6;

/**
 * Arcade grid movement: you slide along corridors and only change axis at a
 * tile centre, with the requested turn buffered until it becomes legal.
 * Returns true if the entity actually shifted this frame.
 */
export function gridMove(e, dt, world) {
  const phasing = !!e.phasing;
  let budget = e.speed * dt;
  let moved = false;

  while (budget > 1e-5) {
    const step = Math.min(budget, TILE * 0.45);
    budget -= step;

    const cx = toCell(e.x), cy = toCell(e.y);
    const ccx = cx * TILE + TILE / 2;
    const ccy = cy * TILE + TILE / 2;
    const offCentre = Math.abs(e.x - ccx) + Math.abs(e.y - ccy);

    if (offCentre <= step + EPS) {
      // snap, then consider the buffered turn
      if (e.want && (e.want.x !== e.dir.x || e.want.y !== e.dir.y)) {
        if (world.passable(cx + e.want.x, cy + e.want.y, phasing)) {
          e.x = ccx; e.y = ccy;
          e.dir = e.want;
          e.want = null;
        }
      }
      if (!world.passable(cx + e.dir.x, cy + e.dir.y, phasing) && !world.isTunnel(cx, cy)) {
        e.x = ccx; e.y = ccy;
        e.blocked = { x: cx + e.dir.x, y: cy + e.dir.y };
        return moved;
      }
    }

    e.blocked = null;
    e.x += e.dir.x * step;
    e.y += e.dir.y * step;
    moved = true;
    world.wrap(e);
  }
  return moved;
}

/** Is this entity sat close enough to a tile centre to turn a corner? */
export function atJunction(e) {
  const ccx = toCell(e.x) * TILE + TILE / 2;
  const ccy = toCell(e.y) * TILE + TILE / 2;
  return Math.abs(e.x - ccx) + Math.abs(e.y - ccy) < 2.5;
}

/** Ways out of this tile, excluding the way you came. `mode` is a planning
 *  mode from World.passableFor: 'walk', 'ghost' or 'smash'. */
export function exitsFrom(world, cx, cy, mode, from) {
  const out = [];
  for (const d of [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]) {
    if (from && d.x === -from.x && d.y === -from.y) continue;
    if (world.passableFor(cx + d.x, cy + d.y, mode)) out.push(d);
  }
  return out;
}
