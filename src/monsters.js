import {
  TILE, GRID_W, GRID_H, T_FLOOR, T_WALL, B_NONE,
  MONSTERS, M_VAMPIRE, M_ZOMBIE, statScale, WEAPONS,
} from './config.js';
import { gridMove, atJunction, exitsFrom } from './movement.js';
import { toCell, tileCentre, idx } from './world.js';
import { dist } from './utils.js';

let nextId = 1;

export class Monster {
  constructor(type, cx, cy, night) {
    const def = MONSTERS[type];
    const s = statScale(night);
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.x = tileCentre(cx);
    this.y = tileCentre(cy);
    this.dir = { x: 0, y: 1 };
    this.want = null;
    this.baseSpeed = def.speed * (0.94 + Math.min(0.5, (night - 5) * 0.012));
    this.speed = this.baseSpeed;
    this.maxHp = Math.round(def.hp * s);
    this.hp = this.maxHp;
    this.phasing = !!def.phasing;
    this.planMode = def.phasing ? 'ghost' : (def.smashesWalls ? 'smash' : 'walk');
    this.radius = (def.scale ? def.scale : 1) * 9;
    this.scale = def.scale || 1;

    this.state = 'chase';       // chase | flee | eat | smash
    this.fear = 0;              // seconds left fleeing
    this.smashing = 0;
    this.dashCd = def.dashEvery ? def.dashEvery * (0.5 + Math.random()) : 0;
    this.dashing = 0;
    this.lure = null;           // a pizza on the floor
    this.eatTimer = 0;
    this.hitFlash = 0;
    this.sparkFlash = 0;        // the shoulder pad turning a blow aside
    this.attackCd = 0;
    this.wobble = Math.random() * 6.28;
    this.padDir = { x: 0, y: -1 };
    this.frustration = 0;   // how long it has failed to close on you
    this.bestApproach = Infinity;
  }

  get dead() { return this.hp <= 0; }

  /** The iron shoulder pad sits on its left, relative to the way it's walking. */
  updatePad() {
    this.padDir = { x: this.dir.y, y: -this.dir.x };
  }

  /**
   * Damage with a weapon. `fromX/fromY` is where the blow came from, which
   * matters a great deal to a zombie wearing half a skip on one arm.
   */
  takeHit(amount, weaponKey, fromX, fromY) {
    const w = WEAPONS[weaponKey];
    const mul = w ? (w.vs[this.type] ?? 1) : 1;
    if (mul <= 0) return { dealt: 0, immune: true, blocked: false };

    let dealt = amount * mul;
    let blocked = false;
    if (this.type === M_ZOMBIE && fromX !== undefined) {
      const dx = fromX - this.x, dy = fromY - this.y;
      const axis = Math.abs(dx) > Math.abs(dy)
        ? { x: Math.sign(dx), y: 0 }
        : { x: 0, y: Math.sign(dy) };
      if (axis.x === this.padDir.x && axis.y === this.padDir.y) {
        dealt *= (1 - this.def.padBlock);
        blocked = true;
        this.sparkFlash = 0.22;
      }
    }
    this.hp -= dealt;
    this.hitFlash = 0.14;
    return { dealt, immune: false, blocked };
  }

  scare(seconds) { this.fear = Math.max(this.fear, seconds); }

  // ------------------------------------------------------------------ AI ---
  update(dt, ctx) {
    const { world, player, pizzas } = ctx;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.sparkFlash = Math.max(0, this.sparkFlash - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.fear = Math.max(0, this.fear - dt);
    this.wobble += dt * 6;

    // A monster that has spent too long failing to reach you stops respecting
    // the torchlight and comes in anyway. Without this, a fully lit base is a
    // permanent stalemate and the night never actually happens.
    const reach = dist(this.x, this.y, player.x, player.y);
    if (reach < this.bestApproach - TILE) { this.bestApproach = reach; this.frustration = 0; }
    else this.frustration += dt;
    this.enraged = this.frustration > 9;

    const light = world.lightAt(this.x, this.y);

    // light hurts everything out here, just by different amounts
    if (light > 0.2) {
      this.hp -= this.def.lightBurn * light * dt;
      if (this.def.lightSlow) this.speed = this.baseSpeed * (1 - this.def.lightSlow * light);
      else this.speed = this.baseSpeed;
      if (light > 0.55 && this.type !== M_ZOMBIE && !this.enraged) this.scare(0.4);
    } else {
      this.speed = this.baseSpeed;
    }

    if (this.dead) return;

    // vampires cannot walk past a garlic pizza
    if (this.type === M_VAMPIRE) this.updateLure(dt, pizzas);

    if (this.type === M_VAMPIRE) {
      this.dashCd -= dt;
      if (this.dashing > 0) {
        this.dashing -= dt;
        this.speed = this.def.dashSpeed;
      } else if (this.dashCd <= 0 && this.state === 'chase' && dist(this.x, this.y, player.x, player.y) < TILE * 7) {
        this.dashing = this.def.dashTime;
        this.dashCd = this.def.dashEvery;
      }
    }

    if (this.state === 'eat') {
      this.eatTimer -= dt;
      this.hp -= 55 * dt;                       // it is *so* much garlic
      if (this.eatTimer <= 0 || !this.lure || this.lure.dead) { this.state = 'chase'; this.lure = null; }
      return;
    }

    // zombies come through the wall rather than round it
    if (this.def.smashesWalls && this.blocked) {
      const b = this.blocked;
      const isWall = world.tileAt(b.x, b.y) === T_WALL;
      if (world.buildAt(b.x, b.y) !== B_NONE || isWall) {
        this.smashing += dt;
        this.state = 'smash';
        if (this.smashing >= this.def.smashTime) {
          this.smashing = 0;
          if (!world.damageBuild(b.x, b.y, 9999)) {
            const inner = b.x > 0 && b.y > 0 && b.x < GRID_W - 1 && b.y < GRID_H - 1;
            if (world.tileAt(b.x, b.y) === T_WALL && inner) {
              world.tiles[idx(b.x, b.y)] = T_FLOOR;
              world.revision++;
              world.recomputeStaticLight();
            }
          }
          ctx.onSmash?.(b.x, b.y);
        }
        return;
      }
    } else {
      this.smashing = 0;
      if (this.state === 'smash') this.state = 'chase';
    }

    this.think(world, player);
    gridMove(this, dt, world);
    this.updatePad();
  }

  updateLure(dt, pizzas) {
    if (this.lure && !this.lure.dead) {
      if (dist(this.x, this.y, this.lure.x, this.lure.y) < TILE * 0.7) {
        this.state = 'eat';
        this.eatTimer = 2.4;
      }
      return;
    }
    this.lure = null;
    let best = null, bestD = TILE * 11;
    for (const p of pizzas) {
      if (p.dead) continue;
      const d = dist(this.x, this.y, p.x, p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) { this.lure = best; this.state = 'lured'; }
    else if (this.state === 'lured') this.state = 'chase';
  }

  think(world, player) {
    if (!atJunction(this)) return;

    const cx = toCell(this.x), cy = toCell(this.y);
    const options = exitsFrom(world, cx, cy, this.planMode, this.dir);
    const all = options.length ? options : exitsFrom(world, cx, cy, this.planMode, null);
    if (!all.length) return;

    const fleeing = this.fear > 0;
    let tx = player.x, ty = player.y;
    if (this.state === 'lured' && this.lure) { tx = this.lure.x; ty = this.lure.y; }

    // Ghosts walk through walls, so straight-line distance is already the
    // true distance for them. Everything else steers on the flow field.
    const useFlow = !this.phasing && this.state !== 'lured';

    let bestDir = all[0];
    let bestScore = Infinity;
    for (const d of all) {
      const nx = cx + d.x, ny = cy + d.y;
      const px = tileCentre(nx), py = tileCentre(ny);
      let score = useFlow
        ? world.flowAt(this.planMode, nx, ny) * TILE
        : dist(px, py, tx, ty);
      if (fleeing) score = -score;
      // Steer away from lit ground — but only as a preference. Make this too
      // strong and a ring of torches becomes an invisible wall, which kills
      // the tension a base is supposed to create.
      const lit = world.lightAtCell(nx, ny);
      let committed = dist(this.x, this.y, tx, ty) < TILE * 3.5 ? 0.4 : 1;
      if (this.enraged) committed *= 0.12;
      score += lit * this.def.lightFear * TILE * 2.6 * committed;
      // a touch of noise so a pack doesn't move as one animal
      score += (Math.sin(this.wobble + nx * 3.1 + ny * 1.7)) * TILE * 0.5;
      if (score < bestScore) { bestScore = score; bestDir = d; }
    }
    this.want = bestDir;
  }
}

export function spawnWave(world, types, night, awayFrom) {
  const pts = world.spawnPoints;
  const out = [];
  for (const t of types) {
    let best = null, bestD = -1;
    for (let i = 0; i < 7; i++) {
      const p = pts[(Math.random() * pts.length) | 0];
      const d = dist(tileCentre(p.x), tileCentre(p.y), awayFrom.x, awayFrom.y);
      if (d > bestD) { bestD = d; best = p; }
    }
    out.push(new Monster(t, best.x, best.y, night));
  }
  return out;
}
