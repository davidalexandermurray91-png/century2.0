import { VEHICLE } from './config.js';
import { toCell } from './world.js';
import { clamp, dist } from './utils.js';

export class Vehicle {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.angle = -Math.PI / 2;
    this.vel = 0;
    this.hp = VEHICLE.maxHp;
    this.maxHp = VEHICLE.maxHp;
    this.fuel = VEHICLE.fuelMax;
    this.occupied = false;
    this.evacHold = 0;
    this.wheelSpin = 0;
    this.dead = false;
  }

  get halfW() { return 8.5; }
  get halfL() { return 14; }

  /**
   * Collision is a small axis-aligned cross rather than the drawn chassis.
   * A rotating rectangle can never fit a one-tile corridor, and an arcade car
   * that wedges itself on a corner is no fun at all — so the body is allowed
   * to overhang the walls a little while the hitbox stays honest.
   */
  probes() {
    const r = 8;
    return [
      { x: this.x, y: this.y },
      { x: this.x + r, y: this.y }, { x: this.x - r, y: this.y },
      { x: this.x, y: this.y + r }, { x: this.x, y: this.y - r },
    ];
  }

  update(dt, ctx) {
    const { world, input, monsters } = ctx;

    if (this.occupied) {
      const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
      if (this.fuel > 0 && throttle !== 0) {
        const a = throttle > 0 ? VEHICLE.accel : -VEHICLE.accel * 0.7;
        this.vel += a * dt;
        this.fuel = Math.max(0, this.fuel - VEHICLE.fuelBurn * dt * Math.abs(throttle));
      }
      const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (Math.abs(this.vel) > 6) {
        this.angle += steer * VEHICLE.turn * dt * clamp(Math.abs(this.vel) / 120, 0.35, 1) * Math.sign(this.vel);
      }
    }

    // drag
    this.vel -= this.vel * VEHICLE.friction * dt;
    if (Math.abs(this.vel) < 2) this.vel = 0;
    this.vel = clamp(this.vel, -VEHICLE.reverse, VEHICLE.maxSpeed);
    this.wheelSpin += this.vel * dt * 0.12;

    // move with a couple of substeps so we don't tunnel through walls
    const steps = Math.max(1, Math.ceil(Math.abs(this.vel * dt) / 6));
    for (let i = 0; i < steps; i++) {
      const nx = this.x + Math.cos(this.angle) * (this.vel * dt) / steps;
      const ny = this.y + Math.sin(this.angle) * (this.vel * dt) / steps;
      const was = { x: this.x, y: this.y };
      this.x = nx; this.y = ny;
      if (this.hitsWall(world)) {
        this.x = was.x; this.y = was.y;
        const impact = Math.abs(this.vel);
        if (impact > 70) {
          this.damage(impact * 0.06);
          ctx.spark(this.x + Math.cos(this.angle) * this.halfL, this.y + Math.sin(this.angle) * this.halfL, '#ffb454', 8);
          ctx.shake(4);
        }
        this.vel *= -0.25;
        break;
      }
    }

    // flatten whatever's in the way
    if (Math.abs(this.vel) > 60) {
      for (const m of monsters) {
        if (m.dead) continue;
        if (dist(m.x, m.y, this.x, this.y) < this.halfL + m.radius) {
          const res = m.takeHit(VEHICLE.ramDamage * (Math.abs(this.vel) / VEHICLE.maxSpeed), 'gun', this.x, this.y);
          if (!res.immune) {
            ctx.onHit(m, res, m.x, m.y);
            this.damage(6);
            this.vel *= 0.75;
            ctx.shake(6);
          }
        }
      }
    }

    if (this.occupied) world.wrap(this);
  }

  hitsWall(world) {
    for (const p of this.probes()) {
      const cx = toCell(p.x), cy = toCell(p.y);
      if (world.isExit(cx, cy) || world.isTunnel(cx, cy)) continue;
      if (world.isBlocked(cx, cy)) return true;
    }
    return false;
  }

  damage(n) {
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0) this.dead = true;
  }

  refuel(n) { this.fuel = clamp(this.fuel + n, 0, VEHICLE.fuelMax); }

  onExitTile(world) {
    return world.isExit(toCell(this.x), toCell(this.y));
  }
}
