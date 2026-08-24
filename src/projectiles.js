import { TILE, WEAPONS } from './config.js';
import { toCell } from './world.js';
import { dist } from './utils.js';

export class Projectile {
  constructor(kind, x, y, dx, dy, def) {
    this.kind = kind;               // bullet | arrow | pizza
    this.x = x; this.y = y;
    this.vx = dx * def.speed;
    this.vy = dy * def.speed;
    this.damage = def.damage;
    this.weaponKey = def.key;
    this.colour = def.colour;
    this.life = kind === 'pizza' ? 0.65 : 1.6;
    this.dead = false;
    this.spin = 0;
    this.trail = [];
  }

  update(dt, ctx) {
    this.life -= dt;
    this.spin += dt * 12;
    if (this.life <= 0) { this.expire(ctx); return; }

    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / (TILE * 0.4)));
    for (let s = 0; s < steps; s++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;

      if (this.kind !== 'pizza' && ctx.world.isBlocked(toCell(this.x), toCell(this.y))) {
        ctx.spark(this.x, this.y, this.colour, 5);
        this.dead = true; return;
      }
      if (this.kind === 'pizza' && ctx.world.isBlocked(toCell(this.x), toCell(this.y))) {
        this.expire(ctx); return;
      }

      for (const m of ctx.monsters) {
        if (m.dead) continue;
        if (dist(this.x, this.y, m.x, m.y) < m.radius + 5) {
          const res = m.takeHit(this.damage, this.weaponKey, this.x - this.vx * 0.01, this.y - this.vy * 0.01);
          if (res.immune) {
            ctx.floater(m.x, m.y, 'no effect', '#7c89ab');
            ctx.spark(this.x, this.y, '#7c89ab', 4);
          } else {
            ctx.onHit(m, res, this.x, this.y);
          }
          if (this.kind === 'pizza') { this.expire(ctx); return; }
          this.dead = true; return;
        }
      }
    }
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.shift();
  }

  expire(ctx) {
    this.dead = true;
    if (this.kind === 'pizza') ctx.dropPizza(this.x, this.y);
  }
}

/** A pizza sat on the floor, radiating garlic. */
export class GroundPizza {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.life = 14;
    this.dead = false;
    this.bob = Math.random() * 6.28;
  }
  update(dt) {
    this.life -= dt;
    this.bob += dt * 3;
    if (this.life <= 0) this.dead = true;
  }
}

export class Beam {
  constructor(x1, y1, x2, y2, colour) {
    this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
    this.colour = colour;
    this.life = WEAPONS.laser.beamTime;
    this.max = this.life;
    this.dead = false;
  }
  update(dt) { this.life -= dt; if (this.life <= 0) this.dead = true; }
}

export class Particle {
  constructor(x, y, colour, speed = 90) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random());
    this.x = x; this.y = y;
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.colour = colour;
    this.life = 0.35 + Math.random() * 0.35;
    this.max = this.life;
    this.dead = false;
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vx *= 0.92; this.vy *= 0.92;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}

export class Floater {
  constructor(x, y, text, colour) {
    this.x = x; this.y = y; this.text = text; this.colour = colour;
    this.life = 0.9; this.max = 0.9; this.dead = false;
  }
  update(dt) { this.y -= 26 * dt; this.life -= dt; if (this.life <= 0) this.dead = true; }
}
