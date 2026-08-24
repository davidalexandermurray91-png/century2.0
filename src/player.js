import {
  PLAYER, WEAPONS, WEAPON_ORDER, BUILDINGS, B_WALL, B_TORCH, B_BENCH, B_TURRET,
} from './config.js';
import { gridMove } from './movement.js';
import { toCell, tileCentre } from './world.js';
import { clamp } from './utils.js';

export const BUILD_ORDER = [B_WALL, B_TORCH, B_BENCH, B_TURRET];

export class Player {
  constructor(world) {
    this.world = world;
    this.x = tileCentre(world.home.x);
    this.y = tileCentre(world.home.y);
    this.dir = { x: 1, y: 0 };
    this.want = null;
    this.speed = PLAYER.speed;
    this.radius = PLAYER.radius;
    this.phasing = false;

    this.hp = PLAYER.maxHp;
    this.maxHp = PLAYER.maxHp;
    this.invuln = 0;
    this.hurtFlash = 0;

    this.res = { scrap: 0, wood: 0, iron: 0, crystal: 0, fuel: 0, dough: 0, cheese: 0 };
    this.ammo = { arrows: 12, bullets: 0, cells: 0, pizzas: 0, flares: 0 };
    this.unlocked = new Set(['torch']);
    this.parts = new Set();

    this.weapon = 'torch';
    this.cooldown = 0;
    this.swing = 0;          // animation timer for melee
    this.torchOut = true;
    this.torchFuel = PLAYER.torchFuelMax;

    this.buildMode = false;
    this.buildSel = 0;
    this.moving = false;
    this.movedSinceTurn = false;

    this.kills = 0;
    this.gathered = 0;
  }

  get cell() { return { x: toCell(this.x), y: toCell(this.y) }; }
  get weaponDef() { return WEAPONS[this.weapon]; }
  get buildKind() { return BUILD_ORDER[this.buildSel]; }

  /** Tile the player is facing — where a build would land. */
  get targetCell() {
    return { x: toCell(this.x) + this.dir.x, y: toCell(this.y) + this.dir.y };
  }

  moveIntent(d) {
    this.moving = !!d;
    if (d) {
      this.want = d;
      // turning on the spot should still change which way you're facing
      if (!this.movedSinceTurn) this.dir = d;
    }
  }

  update(dt, world) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swing = Math.max(0, this.swing - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);

    if (this.moving) {
      this.movedSinceTurn = gridMove(this, dt, world) || this.movedSinceTurn;
    } else {
      this.movedSinceTurn = false;
      // face the last direction asked for, even standing still
      if (this.want) { this.dir = this.want; this.want = null; }
    }

    // torch burns down while it's the thing in your hand
    if (this.weapon === 'torch' && this.torchFuel > 0) {
      this.torchFuel = Math.max(0, this.torchFuel - PLAYER.torchBurnRate * dt);
    }
  }

  torchRadius() {
    if (this.weapon !== 'torch' || this.torchFuel <= 0) return 2.2;   // faint personal glow
    return WEAPONS.torch.light;
  }

  refuelTorch(amount) {
    this.torchFuel = clamp(this.torchFuel + amount, 0, PLAYER.torchFuelMax);
  }

  selectSlot(n) {
    const key = WEAPON_ORDER[n - 1];
    if (key && this.unlocked.has(key)) { this.weapon = key; return true; }
    return false;
  }

  cycleWeapon(step) {
    const owned = WEAPON_ORDER.filter((k) => this.unlocked.has(k));
    const i = owned.indexOf(this.weapon);
    this.weapon = owned[(i + step + owned.length) % owned.length];
  }

  hasAmmo(def = this.weaponDef) {
    if (!def.ammo) return def.key !== 'torch' || this.torchFuel > 0;
    return (this.ammo[def.ammo] || 0) > 0;
  }

  spendAmmo(def = this.weaponDef) {
    if (def.ammo) this.ammo[def.ammo] = Math.max(0, this.ammo[def.ammo] - 1);
  }

  give(res, n = 1) {
    if (res in this.res) { this.res[res] += n; this.gathered += n; }
    else if (res in this.ammo) this.ammo[res] += n;
  }

  canAfford(cost) {
    return Object.entries(cost).every(([k, v]) => (this.res[k] || 0) >= v);
  }

  pay(cost) {
    for (const [k, v] of Object.entries(cost)) this.res[k] -= v;
  }

  hurt(amount) {
    if (this.invuln > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = PLAYER.invulnAfterHit;
    this.hurtFlash = 0.35;
    return true;
  }

  heal(n) { this.hp = clamp(this.hp + n, 0, this.maxHp); }

  get dead() { return this.hp <= 0; }

  // --------------------------------------------------------------- build ---
  cycleBuild(step) {
    this.buildSel = (this.buildSel + step + BUILD_ORDER.length) % BUILD_ORDER.length;
  }

  buildCostReadout() {
    const def = BUILDINGS[this.buildKind];
    return Object.entries(def.cost).map(([k, v]) => `${v} ${k}`).join(' · ');
  }
}
