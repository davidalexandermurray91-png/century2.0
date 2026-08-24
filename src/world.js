import {
  TILE, GRID_W, GRID_H, T_FLOOR, T_WALL, T_EXIT, T_TUNNEL,
  B_NONE, B_TORCH, BUILDINGS, PELLET_MIX,
} from './config.js';
import { mulberry32, weightedPick, shuffle, clamp } from './utils.js';

export const idx = (x, y) => y * GRID_W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
export const tileCentre = (c) => c * TILE + TILE / 2;
export const toCell = (px) => Math.floor(px / TILE);

const MID_Y = (GRID_H - 1) / 2;

export class World {
  constructor(seed, locationNumber = 1) {
    this.seed = seed >>> 0;
    this.location = locationNumber;
    this.rng = mulberry32(this.seed);
    this.tiles = new Uint8Array(GRID_W * GRID_H).fill(T_WALL);
    this.build = new Uint8Array(GRID_W * GRID_H);
    this.buildHp = new Float32Array(GRID_W * GRID_H);
    this.turretCharge = new Float32Array(GRID_W * GRID_H);
    this.pellets = new Map();       // idx -> resource key
    this.buildCount = 0;
    this.flarePads = [];            // {x,y,taken}
    this.staticLight = new Float32Array(GRID_W * GRID_H);
    this.dynamicLight = new Float32Array(GRID_W * GRID_H);
    this.exits = [];
    this.spawnPoints = [];
    this.revision = 0;   // bumped whenever the terrain itself changes
    this.generate();
  }

  // ---------------------------------------------------------------- gen ---
  generate() {
    const rng = this.rng;
    const carve = (x, y) => { if (inBounds(x, y)) this.tiles[idx(x, y)] = T_FLOOR; };

    // 1. randomised DFS over odd cells
    const stack = [[1, 1]];
    const seen = new Set([idx(1, 1)]);
    carve(1, 1);
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = shuffle(rng, [[2, 0], [-2, 0], [0, 2], [0, -2]])
        .map(([dx, dy]) => [cx + dx, cy + dy])
        .filter(([nx, ny]) => nx > 0 && ny > 0 && nx < GRID_W - 1 && ny < GRID_H - 1 && !seen.has(idx(nx, ny)));
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny] = opts[0];
      carve((cx + nx) >> 1, (cy + ny) >> 1);
      carve(nx, ny);
      seen.add(idx(nx, ny));
      stack.push([nx, ny]);
    }

    // 2. punch out extra walls — dead ends are miserable to be chased down
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        if (this.tiles[idx(x, y)] === T_WALL && rng() < 0.12) carve(x, y);
      }
    }

    // 3. mirror the left half onto the right for that arcade symmetry
    const mid = (GRID_W - 1) / 2;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < mid; x++) {
        this.tiles[idx(GRID_W - 1 - x, y)] = this.tiles[idx(x, y)];
      }
    }

    // 4. home plaza in the middle — somewhere to actually build
    const hx = mid, hy = (GRID_H - 1) / 2;
    for (let y = hy - 2; y <= hy + 2; y++) {
      for (let x = hx - 3; x <= hx + 3; x++) carve(x, y);
    }
    this.home = { x: hx, y: hy };

    // 5. the side tunnels: run off one edge, appear at the other
    for (let x = 0; x < GRID_W; x++) carve(x, MID_Y);
    this.tiles[idx(0, MID_Y)] = T_TUNNEL;
    this.tiles[idx(GRID_W - 1, MID_Y)] = T_TUNNEL;

    // 6. evacuation exits, top and bottom
    for (const ex of [Math.floor(mid / 2), mid, mid + Math.floor(mid / 2)]) {
      for (const [x, y] of [[ex, 0], [ex, GRID_H - 1]]) {
        // make sure there's a route up to it
        const dy = y === 0 ? 1 : -1;
        for (let yy = y; yy !== MID_Y; yy += dy) carve(x, yy);
        this.tiles[idx(x, y)] = T_EXIT;
        this.exits.push({ x, y });
      }
    }

    // 7. anything the carver stranded becomes solid again
    this.pruneUnreachable();

    // 8. scatter loot and the four flare pads
    this.scatterPellets();
    this.placeFlarePads();
    this.spawnPoints = this.pickSpawnPoints();
    this.recomputeStaticLight(true);
  }

  pruneUnreachable() {
    const open = new Uint8Array(GRID_W * GRID_H);
    const q = [idx(this.home.x, this.home.y)];
    open[q[0]] = 1;
    while (q.length) {
      const i = q.pop();
      const x = i % GRID_W, y = (i / GRID_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (open[ni] || this.tiles[ni] === T_WALL) continue;
        open[ni] = 1; q.push(ni);
      }
    }
    for (let i = 0; i < this.tiles.length; i++) {
      if (!open[i] && this.tiles[i] !== T_WALL) this.tiles[i] = T_WALL;
    }
  }

  scatterPellets() {
    const rng = this.rng;
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        const i = idx(x, y);
        if (this.tiles[i] !== T_FLOOR) continue;
        if (Math.abs(x - this.home.x) <= 3 && Math.abs(y - this.home.y) <= 2) continue;
        if (rng() < 0.62) this.pellets.set(i, weightedPick(rng, PELLET_MIX));
      }
    }
  }

  placeFlarePads() {
    const spots = [
      [2, 2], [GRID_W - 3, 2], [2, GRID_H - 3], [GRID_W - 3, GRID_H - 3],
    ];
    for (const [sx, sy] of spots) {
      const near = this.nearestFloor(sx, sy);
      if (near) {
        this.flarePads.push({ ...near, taken: false });
        this.pellets.delete(idx(near.x, near.y));
      }
    }
  }

  nearestFloor(x, y) {
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          if (this.tiles[idx(nx, ny)] === T_FLOOR) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  pickSpawnPoints() {
    const pts = [];
    for (let x = 1; x < GRID_W - 1; x++) {
      for (const y of [1, GRID_H - 2]) {
        if (this.tiles[idx(x, y)] === T_FLOOR) pts.push({ x, y });
      }
    }
    for (let y = 1; y < GRID_H - 1; y++) {
      for (const x of [1, GRID_W - 2]) {
        if (this.tiles[idx(x, y)] === T_FLOOR) pts.push({ x, y });
      }
    }
    return pts.length ? pts : [{ x: 1, y: 1 }];
  }

  // ------------------------------------------------------------ queries ---
  tileAt(x, y) { return inBounds(x, y) ? this.tiles[idx(x, y)] : T_WALL; }
  buildAt(x, y) { return inBounds(x, y) ? this.build[idx(x, y)] : B_NONE; }

  /** Solid to normal walkers? Ghosts get their own check. */
  isBlocked(x, y) {
    if (!inBounds(x, y)) return true;
    const i = idx(x, y);
    if (this.tiles[i] === T_WALL) return true;
    const b = this.build[i];
    return b !== B_NONE && BUILDINGS[b].solid;
  }

  /** Ghosts only respect the outer shell of the map. */
  isBlockedForGhost(x, y) {
    if (!inBounds(x, y)) return true;
    if (x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1) {
      return this.tiles[idx(x, y)] === T_WALL;
    }
    return false;
  }

  passable(x, y, phasing) {
    return phasing ? !this.isBlockedForGhost(x, y) : !this.isBlocked(x, y);
  }

  /**
   * Passability for route planning. Mode 'smash' deliberately ignores player
   * buildings, so a zombie plots a course straight through your barricade
   * rather than politely walking round it.
   */
  passableFor(x, y, mode) {
    if (mode === 'ghost') return !this.isBlockedForGhost(x, y);
    if (mode === 'smash') return inBounds(x, y) && this.tiles[idx(x, y)] !== T_WALL;
    return !this.isBlocked(x, y);
  }

  isExit(x, y) { return this.tileAt(x, y) === T_EXIT; }
  isTunnel(x, y) { return this.tileAt(x, y) === T_TUNNEL; }

  // ---------------------------------------------------------- buildings ---
  canPlace(x, y) {
    if (!inBounds(x, y)) return false;
    const i = idx(x, y);
    if (this.tiles[i] === T_WALL || this.tiles[i] === T_EXIT || this.tiles[i] === T_TUNNEL) return false;
    return this.build[i] === B_NONE;
  }

  place(x, y, kind) {
    const i = idx(x, y);
    if (this.build[i] === B_NONE) this.buildCount++;
    this.build[i] = kind;
    this.buildHp[i] = BUILDINGS[kind].hp;
    this.turretCharge[i] = 0;
    this.pellets.delete(i);
    this.recomputeStaticLight();
  }

  damageBuild(x, y, amount) {
    if (!inBounds(x, y)) return false;
    const i = idx(x, y);
    if (this.build[i] === B_NONE) return false;
    this.buildHp[i] -= amount;
    if (this.buildHp[i] <= 0) {
      this.build[i] = B_NONE;
      this.buildCount--;
      this.recomputeStaticLight();
      return true;
    }
    return false;
  }

  removeBuild(x, y) {
    const i = idx(x, y);
    const kind = this.build[i];
    if (kind === B_NONE) return null;
    this.build[i] = B_NONE;
    this.buildCount--;
    this.recomputeStaticLight();
    return kind;
  }

  /** Nearest workbench within `cells` tiles of a pixel position. */
  benchNear(px, py, cells = 2) {
    const cx = toCell(px), cy = toCell(py);
    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const x = cx + dx, y = cy + dy;
        if (inBounds(x, y) && this.build[idx(x, y)] === 3) return { x, y };
      }
    }
    return null;
  }

  // -------------------------------------------------------------- light ---
  /** Flood light out from a source, blocked by walls, into `target`. */
  spill(target, sx, sy, radius, strength = 1) {
    if (!inBounds(sx, sy) || radius <= 0) return;
    const seen = new Map();
    const q = [[sx, sy, 0]];
    seen.set(idx(sx, sy), 0);
    while (q.length) {
      const [x, y, d] = q.shift();
      const level = clamp((1 - d / radius) * strength, 0, 1);
      const i = idx(x, y);
      if (level > target[i]) target[i] = level;
      if (d >= radius) continue;
      // walls catch the light but don't pass it on
      if (d > 0 && this.isOpaque(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        const nd = d + 1;
        if (seen.has(ni) && seen.get(ni) <= nd) continue;
        seen.set(ni, nd);
        q.push([nx, ny, nd]);
      }
    }
  }

  isOpaque(x, y) {
    const i = idx(x, y);
    if (this.tiles[i] === T_WALL) return true;
    const b = this.build[i];
    return b !== B_NONE && BUILDINGS[b].solid;
  }

  recomputeStaticLight() {
    this.staticLight.fill(0);
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const b = this.build[idx(x, y)];
        if (b === B_NONE) continue;
        const r = BUILDINGS[b].light;
        if (r > 0) this.spill(this.staticLight, x, y, r, b === B_TORCH ? 1 : 0.7);
      }
    }
  }

  beginDynamicLight() { this.dynamicLight.fill(0); }

  addLight(px, py, radius, strength = 1) {
    this.spill(this.dynamicLight, toCell(px), toCell(py), radius, strength);
  }

  /** 0 = pitch black, 1 = floodlit. Cell coords. */
  lightAtCell(x, y) {
    if (!inBounds(x, y)) return 0;
    const i = idx(x, y);
    return Math.max(this.staticLight[i], this.dynamicLight[i]);
  }

  lightAt(px, py) { return this.lightAtCell(toCell(px), toCell(py)); }

  // -------------------------------------------------------------- misc ---
  takePellet(px, py) {
    const i = idx(toCell(px), toCell(py));
    const res = this.pellets.get(i);
    if (res) { this.pellets.delete(i); return res; }
    return null;
  }

  takeFlarePad(px, py) {
    const cx = toCell(px), cy = toCell(py);
    for (const pad of this.flarePads) {
      if (!pad.taken && pad.x === cx && pad.y === cy) { pad.taken = true; return true; }
    }
    return false;
  }

  /** Respawn some loot and re-arm the flare pads. Called at dawn. */
  replenish(amount = 0.18) {
    const rng = this.rng;
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        const i = idx(x, y);
        if (this.tiles[i] !== T_FLOOR || this.build[i] !== B_NONE) continue;
        if (this.pellets.has(i)) continue;
        if (Math.abs(x - this.home.x) <= 2 && Math.abs(y - this.home.y) <= 1) continue;
        if (rng() < amount) this.pellets.set(i, weightedPick(rng, PELLET_MIX));
      }
    }
    for (const pad of this.flarePads) pad.taken = false;
  }

  /** Pac-Man wrap: step off the side tunnel and come out the other side. */
  wrap(entity) {
    if (entity.y / TILE < MID_Y || entity.y / TILE > MID_Y + 1) return;
    if (entity.x < -TILE / 2) entity.x = GRID_W * TILE - TILE / 2;
    else if (entity.x > GRID_W * TILE + TILE / 2) entity.x = TILE / 2;
  }

  // ------------------------------------------------------- pathfinding ---
  /**
   * Breadth-first distance field out from a target cell, one per movement
   * mode. Monsters steer downhill on this rather than guessing from straight
   * line distance, which is what stops them getting wedged behind a wall
   * they can see straight through.
   */
  computeFlow(tx, ty, mode) {
    if (!this.flows) this.flows = {};
    if (!this.flows[mode]) this.flows[mode] = new Int32Array(GRID_W * GRID_H);
    const field = this.flows[mode];
    field.fill(-1);
    if (!inBounds(tx, ty)) return field;

    const start = idx(tx, ty);
    field[start] = 0;
    let frontier = [start];
    let d = 0;
    while (frontier.length) {
      const next = [];
      d++;
      for (const i of frontier) {
        const x = i % GRID_W, y = (i / GRID_W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nx = x + dx, ny = y + dy;
          // the side tunnels are genuinely connected, so the field must be too
          if (ny === MID_Y && nx < 0) nx = GRID_W - 1;
          else if (ny === MID_Y && nx >= GRID_W) nx = 0;
          if (!inBounds(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (field[ni] !== -1) continue;
          if (!this.passableFor(nx, ny, mode)) continue;
          field[ni] = d;
          next.push(ni);
        }
      }
      frontier = next;
    }
    return field;
  }

  flowFor(mode) { return this.flows && this.flows[mode]; }

  /** Steps to the target from this cell, or a big number if unreachable. */
  flowAt(mode, x, y) {
    const f = this.flowFor(mode);
    if (!f || !inBounds(x, y)) return 9999;
    const v = f[idx(x, y)];
    return v < 0 ? 9999 : v;
  }

  turretTiles() {
    const out = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) if (this.build[idx(x, y)] === 4) out.push({ x, y });
    }
    return out;
  }
}
