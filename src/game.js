import {
  TILE, VIEW_W, VIEW_H,
  dayLength, nightLength, DUSK_SECONDS, GRACE_NIGHTS, NIGHTS_IN_CENTURY,
  WEAPONS, WEAPON_ORDER, RECIPES, BUILDINGS, VEHICLE_PARTS, VEHICLE, FLARE,
  B_BENCH, GUNPOWDER_WINDOW, GUNPOWDER_PER_DOUBLE, DROPS, ARMOUR, RESOURCES,
  M_GHOST, M_VAMPIRE, M_ZOMBIE, waveFor,
} from './config.js';
import { World, toCell, tileCentre, idx } from './world.js';
import { Player } from './player.js';
import { spawnWave } from './monsters.js';
import { Projectile, GroundPizza, Beam, Particle, Floater } from './projectiles.js';
import { Vehicle } from './vehicle.js';
import { held, pressed, freshestIntent, endFrame, mouse } from './input.js';
import { sfx, toggleAudio } from './audio.js';
import { bankRun } from './profile.js';
import { clamp, dist } from './utils.js';
import * as R from './render.js';
import { drawHud, drawCodex } from './hud.js';

const AMBIENT_DAY = 0.94;
const AMBIENT_NIGHT = 0.09;

export class Game {
  constructor(onGameOver, profile = null) {
    this.onGameOver = onGameOver;
    this.profile = profile;
    this.reset();
  }

  reset() {
    this.world = new World((Math.random() * 1e9) | 0, 1);
    this.player = new Player(this.world);
    this.monsters = [];
    this.projectiles = [];
    this.pizzasOnGround = [];
    this.beams = [];
    this.particles = [];
    this.floaters = [];
    this.transientLights = [];
    this.vehicle = null;
    this.driving = false;

    this.night = 1;
    this.phase = 'day';
    this.phaseLength = dayLength(1);
    this.phaseRemaining = this.phaseLength;
    this.heat = 0;
    this.centuries = 0;
    this.state = 'playing';
    this.time = 0;
    this.shakeAmount = 0;
    this.flareTime = 0;
    this.evacHold = 0;
    this.noMoreSpawns = false;
    this.flowTimer = 0;
    this.pendingWave = [];
    this.nextBatchIn = 0;

    this.toasts = [];
    this.prompt = null;
    this.craftOpen = false;
    this.craftIndex = 0;
    this.codexOpen = false;
    this.bannerTime = 0;
    this.bannerTitle = '';
    this.bannerSub = '';
    this.bannerColour = '#fff';
    this.seenMonster = new Set();
    // when each of the two lighter monsters last died, for the powder rule
    this.lastKillAt = { [M_GHOST]: -99, [M_VAMPIRE]: -99 };
    this.banked = false;

    this.banner('DAY ONE', 'Five quiet nights. Use them.', '#ffb454', 2.6);
    this.toast('Walk over the dots to gather. [Tab] to craft, [B] to build.', '#38e1ff', 6);
  }

  get buildMode() { return this.player.buildMode; }
  get duskWarning() { return this.phase === 'day' && this.phaseRemaining <= DUSK_SECONDS; }
  get atBench() { return !!this.world.benchNear(this.player.x, this.player.y, 2); }

  // ------------------------------------------------------------- helpers ---
  toast(text, colour = '#dfe9ff', life = 2.6) {
    this.toasts.unshift({ text, colour, life, max: life });
    if (this.toasts.length > 4) this.toasts.pop();
  }

  banner(title, sub, colour, time = 2.2) {
    this.bannerTitle = title; this.bannerSub = sub;
    this.bannerColour = colour; this.bannerTime = time;
  }

  spark(x, y, colour, n = 6) {
    // a busy night can throw a lot of these about; don't let it run away
    const room = 320 - this.particles.length;
    for (let i = 0; i < Math.min(n, room); i++) this.particles.push(new Particle(x, y, colour));
  }

  floater(x, y, text, colour) {
    this.floaters.push(new Floater(x, y - 14, text, colour));
  }

  shake(n) { this.shakeAmount = Math.min(14, this.shakeAmount + n); }

  dropPizza(x, y) {
    this.pizzasOnGround.push(new GroundPizza(x, y));
    this.spark(x, y, '#ffd93d', 8);
  }

  flash(x, y, radius, life = 0.09) {
    this.transientLights.push({ x, y, radius, life, max: life });
  }

  get hitContext() {
    return {
      world: this.world,
      monsters: this.monsters,
      spark: (x, y, c, n) => this.spark(x, y, c, n),
      floater: (x, y, t, c) => this.floater(x, y, t, c),
      dropPizza: (x, y) => this.dropPizza(x, y),
      onHit: (m, res, x, y) => this.registerHit(m, res, x, y),
      shake: (n) => this.shake(n),
    };
  }

  registerHit(m, res, x, y) {
    if (res.blocked) {
      sfx.block();
      this.floater(m.x, m.y - 6, 'CLANG', '#c6d2e6');
      this.spark(x, y, '#ffe27a', 7);
    } else {
      sfx.hit();
      this.spark(x, y, m.def.colour, 5);
    }
    if (m.hp <= 0) this.killMonster(m);
  }

  killMonster(m) {
    if (m.counted) return;
    m.counted = true;
    m.hp = 0;
    this.player.kills++;
    this.spark(m.x, m.y, m.def.colour, 18);
    this.shake(m.type === M_ZOMBIE ? 8 : 3);
    sfx.kill();
    let row = 0;
    for (const drop of DROPS[m.type] || []) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      this.player.give(drop.res, drop.n);
      const rare = drop.chance !== undefined;
      this.floater(m.x, m.y - row * 12, `+${drop.n} ${RESOURCES[drop.res].label}`,
        rare ? '#ffe27a' : RESOURCES[drop.res].colour);
      row++;
      if (rare) {
        this.toast(`Iron plating! Take it to a bench for the best armour there is.`, '#ffe27a', 6);
        this.spark(m.x, m.y, '#ffe27a', 20);
        sfx.craft();
      }
    }
    this.checkDoubleKill(m);
  }

  /**
   * Gunpowder has exactly one source: a ghost and a vampire going out within
   * a couple of seconds of each other. Both deaths are consumed by the payout,
   * so you can't hold one ghost kill open and cash it against a row of
   * vampires — every charge costs you a fresh pair.
   */
  checkDoubleKill(m) {
    if (m.type !== M_GHOST && m.type !== M_VAMPIRE) return;
    this.lastKillAt[m.type] = this.time;
    const other = m.type === M_GHOST ? M_VAMPIRE : M_GHOST;
    if (this.time - this.lastKillAt[other] > GUNPOWDER_WINDOW) return;

    this.lastKillAt[M_GHOST] = -99;
    this.lastKillAt[M_VAMPIRE] = -99;
    this.player.give('gunpowder', GUNPOWDER_PER_DOUBLE);
    this.floater(m.x, m.y - 16, `+${GUNPOWDER_PER_DOUBLE} GUNPOWDER`, '#ffe27a');
    this.spark(m.x, m.y, '#ffe27a', 16);
    this.shake(5);
    sfx.craft();
    if (!this.seenPowder) {
      this.seenPowder = true;
      this.toast('Gunpowder! Only a ghost and a vampire dying together leave it.', '#ffe27a', 6);
    }
  }

  // ---------------------------------------------------------------- loop ---
  update(dt) {
    this.time += dt;
    if (this.state !== 'playing') return;

    this.handleInput(dt);

    if (!this.craftOpen && !this.codexOpen) {
      this.updateFlowFields(dt);
      this.updateWorldClock(dt);
      this.updateSpawns(dt);
      this.updatePlayer(dt);
      this.updateVehicle(dt);
      this.updateMonsters(dt);
      this.updateProjectiles(dt);
      this.updateTurrets(dt);
      this.updateFlare(dt);
    }

    this.updateEphemera(dt);
    this.buildLighting();

    if (this.player.dead && this.state === 'playing') this.die();
    endFrame();
  }

  // --------------------------------------------------------------- input ---
  handleInput(dt) {
    const p = this.player;

    if (pressed('KeyM')) this.toast(toggleAudio() ? 'Sound on' : 'Sound off', '#7c89ab', 1.4);
    if (pressed('KeyC') && !this.craftOpen) this.codexOpen = !this.codexOpen;
    if (this.codexOpen) { if (pressed('Escape')) this.codexOpen = false; return; }

    if (pressed('Tab')) {
      this.craftOpen = !this.craftOpen;
      if (this.craftOpen) p.buildMode = false;
    }
    if (this.craftOpen) {
      if (pressed('Escape')) this.craftOpen = false;
      if (pressed('up')) this.craftIndex = (this.craftIndex - 1 + RECIPES.length) % RECIPES.length;
      if (pressed('down')) this.craftIndex = (this.craftIndex + 1) % RECIPES.length;
      if (pressed('Enter') || pressed('Space')) this.craft(RECIPES[this.craftIndex]);
      return;
    }

    if (this.driving) {
      // on an exit tile [E] is held to evacuate, so it mustn't also eject you
      if (pressed('KeyE') && !this.vehicle.onExitTile(this.world)) this.exitVehicle();
      return;
    }

    // movement
    p.moveIntent(freshestIntent());

    // weapon select
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      if (pressed(`Digit${i}`)) {
        if (!p.selectSlot(i)) { sfx.deny(); this.toast(`You haven't made a ${WEAPONS[WEAPON_ORDER[i - 1]].name.toLowerCase()} yet`, '#ff4d6d', 1.6); }
      }
    }

    if (pressed('KeyB')) {
      p.buildMode = !p.buildMode;
      this.toast(p.buildMode ? 'Build mode' : 'Build mode off', '#38e1ff', 1.2);
    }

    if (p.buildMode) {
      if (pressed('KeyQ')) p.cycleBuild(-1);
      if (pressed('KeyE')) p.cycleBuild(1);
      if (pressed('Space') || mouse.clicked) this.placeBuild();
      if (pressed('KeyX')) this.removeBuild();
    } else {
      if (pressed('KeyQ')) p.cycleWeapon(-1);
      if (held('Space')) this.attack();
      if (pressed('KeyE')) this.interact();
    }

    if (pressed('KeyF')) this.useFlare();
  }

  // -------------------------------------------------------------- clock ---
  updateWorldClock(dt) {
    this.phaseRemaining -= dt;
    if (this.phaseRemaining > 0) return;

    if (this.phase === 'day') {
      this.phase = 'night';
      this.phaseLength = nightLength(this.night);
      this.phaseRemaining = this.phaseLength;
      this.startNight();
    } else {
      this.phase = 'day';
      this.startDay();
      this.phaseLength = dayLength(this.night);
      this.phaseRemaining = this.phaseLength;
    }
  }

  startNight() {
    this.noMoreSpawns = false;
    this.pendingWave = [];
    const wave = waveFor(this.night, this.heat);
    if (!wave.length) {
      this.banner('NIGHT', `Nothing came. ${GRACE_NIGHTS - this.night} quiet ${GRACE_NIGHTS - this.night === 1 ? 'night' : 'nights'} left.`, '#b07bff');
      sfx.nightfall();
      return;
    }
    sfx.nightfall();
    // first push arrives immediately, the rest trickle in so the night has
    // a shape to it rather than one lump at sundown
    const firstWave = Math.max(1, Math.ceil(wave.length * 0.55));
    this.spawnMonsters(wave.slice(0, firstWave));
    this.pendingWave = wave.slice(firstWave);
    this.nextBatchIn = this.phaseLength / 3;
    const kinds = new Set(wave);
    this.banner('NIGHT FALLS', `${wave.length} out there`, '#b07bff');
    for (const k of kinds) this.noteMonster(k);
  }

  spawnMonsters(wave) {
    if (this.noMoreSpawns || !wave.length) return;
    this.monsters.push(...spawnWave(this.world, wave, this.night, this.player));
  }

  updateSpawns(dt) {
    if (this.phase !== 'night' || !this.pendingWave.length) return;
    this.nextBatchIn -= dt;
    if (this.nextBatchIn > 0) return;
    const batch = Math.max(1, Math.ceil(this.pendingWave.length / 2));
    this.spawnMonsters(this.pendingWave.splice(0, batch));
    this.nextBatchIn = this.phaseLength / 3;
    if (!this.noMoreSpawns) this.toast('More of them', '#b07bff', 1.6);
  }

  noteMonster(kind) {
    if (this.seenMonster.has(kind)) return;
    this.seenMonster.add(kind);
    const lines = {
      [M_GHOST]: 'A ghost. It walks through walls. Bullets do nothing — laser and light only. [C] for notes.',
      [M_VAMPIRE]: 'A vampire. Fast. It cannot resist garlic pizza, and light burns it.',
      [M_ZOMBIE]: 'A mutant zombie. Guns, arrows, swords — but that iron shoulder pad turns blows aside. Flank it.',
    };
    this.toast(lines[kind], '#ffb454', 7);
  }

  startDay() {
    // sunrise burns off whatever is left standing
    for (const m of this.monsters) {
      if (!m.dead) { this.spark(m.x, m.y, '#ffb454', 10); }
    }
    this.monsters.length = 0;
    this.pendingWave.length = 0;
    this.night++;
    this.heat += 0.6;
    this.world.replenish(0.2);
    sfx.dawn();

    if (this.night > NIGHTS_IN_CENTURY + this.centuries * NIGHTS_IN_CENTURY) {
      this.centuries++;
      this.banner('A CENTURY', `${this.centuries * NIGHTS_IN_CENTURY} nights survived. Keep going.`, '#5ef2a0', 4);
      sfx.century();
    } else if (this.night === GRACE_NIGHTS + 1) {
      this.banner('DAY 6', 'The quiet is over. They come tonight.', '#ff4d6d', 3.2);
    } else {
      this.banner(`DAY ${this.night}`, this.phaseSubtitle(), '#ffb454', 1.8);
    }
  }

  phaseSubtitle() {
    const left = NIGHTS_IN_CENTURY - this.night + 1;
    if (this.night <= GRACE_NIGHTS) return `${GRACE_NIGHTS - this.night + 1} quiet nights left`;
    return `${left} to the century`;
  }

  // -------------------------------------------------------------- player ---
  updatePlayer(dt) {
    const p = this.player;
    if (this.driving) return;
    p.update(dt, this.world);

    // pellets
    const got = this.world.takePellet(p.x, p.y);
    if (got) {
      p.give(got, 1);
      if (got === 'fuel') p.refuelTorch(7);
      sfx.pickup();
    }
    if (this.world.takeFlarePad(p.x, p.y)) {
      p.ammo.flares++;
      sfx.craft();
      this.toast('Flare recovered — [F] to burn the whole map', '#ffb454', 3);
    }

    // contact damage
    for (const m of this.monsters) {
      if (m.dead || m.state === 'eat') continue;
      if (dist(p.x, p.y, m.x, m.y) < p.radius + m.radius - 2) {
        if (m.attackCd <= 0 && p.hurt(m.def.touchDamage)) {
          m.attackCd = 0.55;
          sfx.hurt();
          this.shake(5);
          this.floater(p.x, p.y, `-${p.lastHit ?? m.def.touchDamage}`, '#ff4d6d');
        }
      }
    }

    this.prompt = null;
    if (this.vehicle && !this.driving && dist(p.x, p.y, this.vehicle.x, this.vehicle.y) < 34) {
      this.prompt = '[E] get in';
    }
  }

  // ------------------------------------------------------------- combat ---
  attack() {
    const p = this.player;
    if (p.cooldown > 0) return;
    const def = p.weaponDef;
    if (!p.hasAmmo(def)) {
      sfx.deny();
      p.cooldown = 0.3;
      this.toast(def.ammo ? `No ${def.ammo} left` : 'The torch is burnt out — find fuel', '#ff4d6d', 1.4);
      return;
    }
    p.cooldown = def.cooldown;

    if (def.kind === 'melee') this.meleeAttack(def);
    else if (def.kind === 'shoot') this.shootAttack(def);
    else if (def.kind === 'beam') this.beamAttack(def);
    else if (def.kind === 'throw') this.throwAttack(def);
  }

  meleeAttack(def) {
    const p = this.player;
    p.swing = def.cooldown * 0.6;
    sfx.swing();
    const hx = p.x + p.dir.x * def.range * 0.6;
    const hy = p.y + p.dir.y * def.range * 0.6;
    let landed = false;
    for (const m of this.monsters) {
      if (m.dead) continue;
      if (dist(hx, hy, m.x, m.y) < def.range * 0.8 + m.radius * 0.6) {
        const res = m.takeHit(def.damage, def.key, p.x, p.y);
        if (res.immune) this.floater(m.x, m.y, 'no effect', '#7c89ab');
        else { this.registerHit(m, res, m.x, m.y); landed = true; }
      }
    }
    if (def.key === 'torch') this.flash(p.x, p.y, 6, 0.12);
    if (landed) this.shake(2);
  }

  shootAttack(def) {
    const p = this.player;
    const spread = def.spread || 0;
    const a = Math.atan2(p.dir.y, p.dir.x) + (Math.random() - 0.5) * spread * 2;
    const pr = new Projectile(def.projectile, p.x + p.dir.x * 12, p.y + p.dir.y * 12,
      Math.cos(a), Math.sin(a), def);
    this.projectiles.push(pr);
    p.spendAmmo(def);
    if (def.muzzleLight) this.flash(p.x, p.y, def.muzzleLight, 0.07);
    def.key === 'bow' ? sfx.bow() : sfx.shoot();
  }

  throwAttack(def) {
    const p = this.player;
    const pr = new Projectile(def.projectile, p.x + p.dir.x * 12, p.y + p.dir.y * 12,
      p.dir.x, p.dir.y, def);
    this.projectiles.push(pr);
    p.spendAmmo(def);
    sfx.throwPizza();
  }

  beamAttack(def) {
    const p = this.player;
    p.spendAmmo(def);
    sfx.laser();
    const end = this.castBeam(p.x, p.y, p.dir, def.beamLength);
    this.beams.push(new Beam(p.x, p.y, end.x, end.y, def.colour));
    this.flash(p.x, p.y, def.beamLight, 0.14);
    this.flash(end.x, end.y, def.beamLight * 0.7, 0.14);

    for (const m of this.monsters) {
      if (m.dead) continue;
      if (pointNearSegment(m.x, m.y, p.x, p.y, end.x, end.y) < m.radius + 6) {
        const res = m.takeHit(def.damage, def.key, p.x, p.y);
        if (res.immune) this.floater(m.x, m.y, 'no effect', '#7c89ab');
        else this.registerHit(m, res, m.x, m.y);
      }
    }
    this.shake(2);
  }

  castBeam(x, y, dir, lengthTiles) {
    let ex = x, ey = y;
    const step = TILE * 0.25;
    const originX = toCell(x), originY = toCell(y);
    // Turrets are solid buildings, so the beam has to ignore the tile it is
    // fired from or every shot stops dead in the barrel.
    for (let d = step; d < lengthTiles * TILE; d += step) {
      const nx = x + dir.x * d, ny = y + dir.y * d;
      const cx = toCell(nx), cy = toCell(ny);
      if (!(cx === originX && cy === originY) && this.world.isBlocked(cx, cy)) break;
      ex = nx; ey = ny;
    }
    return { x: ex, y: ey };
  }

  useFlare() {
    const p = this.player;
    if (p.ammo.flares <= 0) { sfx.deny(); return; }
    p.ammo.flares--;
    this.flareTime = FLARE.duration;
    sfx.flare();
    this.shake(6);
    this.banner('FLARE', 'Everything out there is burning', '#ffb454', 1.4);
    for (const m of this.monsters) m.scare(FLARE.duration);
  }

  updateFlare(dt) {
    if (this.flareTime <= 0) return;
    this.flareTime -= dt;
    for (const m of this.monsters) {
      if (m.dead) continue;
      m.hp -= FLARE.burn * dt;
      if (m.hp <= 0) this.killMonster(m);
    }
  }

  /** Refresh the pathfinding fields a few times a second — cheap, and it
   *  keeps the hunt honest when you barricade a corridor mid-chase. */
  updateFlowFields(dt) {
    this.flowTimer -= dt;
    if (this.flowTimer > 0) return;
    this.flowTimer = 0.12;
    const cx = toCell(this.player.x), cy = toCell(this.player.y);
    this.world.computeFlow(cx, cy, 'walk');
    this.world.computeFlow(cx, cy, 'smash');
  }

  // ------------------------------------------------------------ monsters ---
  updateMonsters(dt) {
    const ctx = {
      world: this.world,
      player: this.player,
      pizzas: this.pizzasOnGround,
      onSmash: (x, y) => { this.shake(7); this.spark(tileCentre(x), tileCentre(y), '#c98b4b', 14); },
    };
    for (const m of this.monsters) {
      if (m.dead) { this.killMonster(m); continue; }
      m.update(dt, ctx);
      if (m.hp <= 0) this.killMonster(m);
    }
    this.monsters = this.monsters.filter((m) => !m.counted);
  }

  updateTurrets(dt) {
    const turrets = this.world.turretTiles();
    for (const t of turrets) {
      const i = idx(t.x, t.y);
      this.world.turretCharge[i] = Math.min(1, this.world.turretCharge[i] + dt / 1.6);
      if (this.world.turretCharge[i] < 1) continue;
      const tx = tileCentre(t.x), ty = tileCentre(t.y);
      let best = null, bestD = TILE * 8;
      for (const m of this.monsters) {
        if (m.dead) continue;
        const d = dist(tx, ty, m.x, m.y);
        if (d < bestD) { bestD = d; best = m; }
      }
      if (!best) continue;
      this.world.turretCharge[i] = 0;
      const a = Math.atan2(best.y - ty, best.x - tx);
      const end = this.castBeam(tx, ty, { x: Math.cos(a), y: Math.sin(a) }, 8);
      this.beams.push(new Beam(tx, ty, end.x, end.y, '#38e1ff'));
      this.flash(tx, ty, 6, 0.12);
      sfx.laser();
      for (const m of this.monsters) {
        if (m.dead) continue;
        if (pointNearSegment(m.x, m.y, tx, ty, end.x, end.y) < m.radius + 5) {
          const res = m.takeHit(58, 'laser', tx, ty);
          if (!res.immune) this.registerHit(m, res, m.x, m.y);
        }
      }
    }
  }

  updateProjectiles(dt) {
    const ctx = this.hitContext;
    for (const pr of this.projectiles) pr.update(dt, ctx);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    for (const p of this.pizzasOnGround) p.update(dt);
    this.pizzasOnGround = this.pizzasOnGround.filter((p) => !p.dead);
  }

  updateEphemera(dt) {
    for (const b of this.beams) b.update(dt);
    this.beams = this.beams.filter((b) => !b.dead);
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => !p.dead);
    for (const f of this.floaters) f.update(dt);
    this.floaters = this.floaters.filter((f) => !f.dead);
    for (const l of this.transientLights) l.life -= dt;
    this.transientLights = this.transientLights.filter((l) => l.life > 0);
    for (const t of this.toasts) t.life -= dt;
    this.toasts = this.toasts.filter((t) => t.life > 0);
    this.bannerTime = Math.max(0, this.bannerTime - dt);
    this.shakeAmount *= Math.pow(0.0015, dt);
  }

  // ------------------------------------------------------------ building ---
  /**
   * Where a build would land: the tile under the cursor when the mouse is in
   * play and within arm's reach, otherwise the tile you're facing. Facing
   * alone is fiddly when you're stood in a corridor with a wall in front.
   */
  buildTargetCell() {
    const p = this.player;
    if (mouse.active) {
      const mx = toCell(mouse.x), my = toCell(mouse.y);
      const near = Math.abs(mx - toCell(p.x)) <= 4 && Math.abs(my - toCell(p.y)) <= 4;
      if (near) return { x: mx, y: my };
    }
    return p.targetCell;
  }

  placeBuild() {
    const p = this.player;
    const { x, y } = this.buildTargetCell();
    const kind = p.buildKind;
    const def = BUILDINGS[kind];
    if (!this.world.canPlace(x, y)) { sfx.deny(); this.toast('No room there', '#ff4d6d', 1.2); return; }
    if (!p.canAfford(def.cost)) { sfx.deny(); this.toast(`Need ${p.buildCostReadout()}`, '#ff4d6d', 1.6); return; }
    p.pay(def.cost);
    this.world.place(x, y, kind);
    sfx.build();
    this.spark(tileCentre(x), tileCentre(y), '#c98b4b', 6);
    if (kind === B_BENCH) this.toast('Workbench up. Stand beside it to craft the good stuff.', '#5ef2a0', 3.5);
  }

  removeBuild() {
    const p = this.player;
    const { x, y } = this.buildTargetCell();
    const kind = this.world.removeBuild(x, y);
    if (!kind) { sfx.deny(); return; }
    // half your materials back, rounded down
    for (const [k, v] of Object.entries(BUILDINGS[kind].cost)) p.give(k, Math.floor(v / 2));
    sfx.build();
    this.toast(`${BUILDINGS[kind].name} salvaged`, '#9fb2d6', 1.4);
  }

  // ------------------------------------------------------------- crafting ---
  craft(recipe) {
    const p = this.player;
    if (recipe.benchOnly && !this.atBench) {
      sfx.deny(); this.toast('You need to be at a workbench', '#ff4d6d', 2); return;
    }
    if (recipe.unlock && p.unlocked.has(recipe.unlock)) {
      sfx.deny(); this.toast('Already made one', '#7c89ab', 1.4); return;
    }
    if (recipe.part && p.parts.has(recipe.part)) {
      sfx.deny(); this.toast('That part is already built', '#7c89ab', 1.4); return;
    }
    if (recipe.armour && ARMOUR[recipe.armour].rank <= p.armourDef.rank) {
      sfx.deny(); this.toast('You are already wearing better', '#7c89ab', 1.8); return;
    }
    if (!p.canAfford(recipe.cost)) { sfx.deny(); this.toast('Not enough materials', '#ff4d6d', 1.6); return; }

    p.pay(recipe.cost);
    sfx.craft();

    if (recipe.unlock) {
      p.unlocked.add(recipe.unlock);
      p.weapon = recipe.unlock;
      this.toast(`${WEAPONS[recipe.unlock].name} made — ${WEAPONS[recipe.unlock].blurb}`, WEAPONS[recipe.unlock].colour, 5);
    }
    if (recipe.give) {
      for (const [k, v] of Object.entries(recipe.give)) p.ammo[k] = (p.ammo[k] || 0) + v;
      this.toast(`+${Object.entries(recipe.give).map(([k, v]) => `${v} ${k}`).join(', ')}`, '#5ef2a0', 1.8);
    }
    if (recipe.heal) { p.heal(recipe.heal); this.toast(`Patched up +${recipe.heal}`, '#5ef2a0', 1.6); }
    if (recipe.armour) {
      const def = ARMOUR[recipe.armour];
      p.equipArmour(recipe.armour);
      this.toast(`${def.label} armour on — ${Math.round(def.reduce * 100)}% off every hit, +${def.bonusHp} health`, '#5ef2a0', 4.5);
    }
    if (recipe.id === 'pizzas') p.refuelTorch(0);
    if (recipe.part) {
      p.parts.add(recipe.part);
      this.toast(`${recipe.label} built (${p.parts.size}/${VEHICLE_PARTS.length})`, '#5ef2a0', 2.4);
      this.tryAssembleVehicle();
    }
    if (recipe.id === 'flare') this.toast('Flare made. [F] burns everything on the map.', '#ffb454', 2.4);
  }

  tryAssembleVehicle() {
    const p = this.player;
    if (this.vehicle) return;
    if (!VEHICLE_PARTS.every((k) => p.parts.has(k))) return;
    const bench = this.world.benchNear(p.x, p.y, 3) || this.world.home;
    const spot = this.world.nearestFloor(bench.x, bench.y + 1) || this.world.home;
    // deliberately leaves the crafting menu as it was — yanking it shut under
    // the player's hands makes the next [Tab] do the opposite of what they mean
    this.vehicle = new Vehicle(tileCentre(spot.x), tileCentre(spot.y));
    this.banner('VEHICLE READY', '[E] to drive · reach an EXIT to evacuate', '#5ef2a0', 3.4);
    sfx.evac();
  }

  // -------------------------------------------------------------- vehicle ---
  interact() {
    const p = this.player;
    if (this.vehicle && dist(p.x, p.y, this.vehicle.x, this.vehicle.y) < 34) {
      this.driving = true;
      this.vehicle.occupied = true;
      sfx.engine();
      this.toast('[WASD] drive · [E] get out · reach a green EXIT to evacuate', '#5ef2a0', 4);
    }
  }

  exitVehicle() {
    const v = this.vehicle;
    this.driving = false;
    v.occupied = false;
    v.vel = 0;
    const p = this.player;
    const spot = this.world.nearestFloor(toCell(v.x), toCell(v.y));
    if (spot) { p.x = tileCentre(spot.x); p.y = tileCentre(spot.y); }
    this.evacHold = 0;
  }

  updateVehicle(dt) {
    const v = this.vehicle;
    if (!v) return;

    v.update(dt, {
      world: this.world,
      monsters: this.monsters,
      input: {
        forward: held('up'), back: held('down'),
        left: held('left'), right: held('right'),
      },
      spark: (x, y, c, n) => this.spark(x, y, c, n),
      shake: (n) => this.shake(n),
      onHit: (m, res, x, y) => this.registerHit(m, res, x, y),
    });

    if (this.driving) {
      this.player.x = v.x; this.player.y = v.y;
      const scooped = this.world.takePellet(v.x, v.y);
      if (scooped) {
        this.player.give(scooped, 1);
        if (scooped === 'fuel') { v.refuel(4); this.player.refuelTorch(4); }
        sfx.pickup();
      }
      if (this.world.takeFlarePad(v.x, v.y)) { this.player.ammo.flares++; sfx.craft(); }
      if (v.dead) {
        this.exitVehicle();
        this.vehicle = null;
        this.player.parts.clear();
        this.toast('The vehicle is wrecked. Build another.', '#ff4d6d', 4);
        this.spark(v.x, v.y, '#ffb454', 30);
        this.shake(12);
        return;
      }
      if (v.onExitTile(this.world)) {
        // brake hard on arrival, or you bounce off the boundary before the
        // hold completes and it feels like the exit is broken
        v.vel *= Math.pow(0.01, dt * 2.5);
        this.prompt = 'Hold [E] to evacuate';
        if (held('KeyE')) {
          this.evacHold += dt;
          if (this.evacHold >= 1.1) this.evacuate();
        } else this.evacHold = Math.max(0, this.evacHold - dt * 2);
      } else {
        this.prompt = v.fuel > 0 ? null : 'Out of fuel — build a fuel tank or scavenge';
        // decay rather than reset, so clipping a corner doesn't punish you
        this.evacHold = Math.max(0, this.evacHold - dt * 1.5);
      }
    }
  }

  evacuate() {
    const p = this.player;
    const keep = {
      res: { ...p.res }, ammo: { ...p.ammo }, unlocked: new Set(p.unlocked),
      parts: new Set(p.parts), hp: p.hp, torchFuel: p.torchFuel,
      kills: p.kills, gathered: p.gathered, weapon: p.weapon,
    };
    const nextLocation = this.world.location + 1;
    this.world = new World((Math.random() * 1e9) | 0, nextLocation);
    this.player = new Player(this.world);
    Object.assign(this.player, keep);
    this.player.res = keep.res;
    this.player.ammo = keep.ammo;

    this.monsters.length = 0;
    this.pendingWave.length = 0;
    this.projectiles.length = 0;
    this.pizzasOnGround.length = 0;
    this.beams.length = 0;
    this.heat = 0;
    this.noMoreSpawns = true;
    this.evacHold = 0;

    const v = this.vehicle;
    v.x = tileCentre(this.world.home.x);
    v.y = tileCentre(this.world.home.y + 1);
    v.vel = 0;
    v.refuel(35);
    this.player.x = v.x; this.player.y = v.y;

    sfx.evac();
    this.banner('EVACUATED', `Location #${nextLocation} — the heat is off you, for now`, '#5ef2a0', 3);
    this.toast('New ground, fresh scrap, no base. Get building.', '#38e1ff', 4);
  }

  // -------------------------------------------------------------- lighting ---
  buildLighting() {
    const w = this.world;
    w.beginDynamicLight();
    const p = this.player;

    if (this.flareTime > 0) {
      const k = clamp(this.flareTime / FLARE.duration, 0, 1);
      w.dynamicLight.fill(clamp(0.55 + k * 0.45, 0, 1));
    }

    if (!this.driving) w.addLight(p.x, p.y, p.torchRadius());
    if (this.vehicle && this.driving) {
      const v = this.vehicle;
      w.addLight(v.x, v.y, 3.5, 0.8);
      w.addLight(v.x + Math.cos(v.angle) * TILE * 2.5, v.y + Math.sin(v.angle) * TILE * 2.5, VEHICLE.headlight, 0.95);
    }
    for (const l of this.transientLights) {
      w.addLight(l.x, l.y, l.radius * (l.life / l.max), 1);
    }
    for (const pz of this.pizzasOnGround) w.addLight(pz.x, pz.y, 1.6, 0.35);
  }

  ambient() {
    if (this.phase === 'day') {
      if (this.duskWarning) {
        const k = this.phaseRemaining / DUSK_SECONDS;
        return AMBIENT_NIGHT + (AMBIENT_DAY - AMBIENT_NIGHT) * k;
      }
      return AMBIENT_DAY;
    }
    const dawnIn = this.phaseRemaining;
    if (dawnIn < 4) return AMBIENT_NIGHT + (AMBIENT_DAY - AMBIENT_NIGHT) * (1 - dawnIn / 4) * 0.6;
    return AMBIENT_NIGHT;
  }

  tint() {
    if (this.flareTime > 0) return [40, 26, 8];
    return this.phase === 'day' ? [8, 10, 24] : [3, 4, 14];
  }

  /** Fold this run's haul into the profile. Safe to call more than once. */
  bank() {
    if (this.banked || !this.profile) return null;
    this.banked = true;
    return bankRun(this.profile, this.player, {
      night: this.night, centuries: this.centuries,
    });
  }

  die() {
    this.state = 'dead';
    sfx.death();
    const gained = this.bank();
    this.onGameOver?.({
      gained,
      night: this.night,
      kills: this.player.kills,
      gathered: this.player.gathered,
      location: this.world.location,
      centuries: this.centuries,
    });
  }

  // ----------------------------------------------------------------- draw ---
  draw(ctx) {
    ctx.save();
    if (this.shakeAmount > 0.4) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmount, (Math.random() - 0.5) * this.shakeAmount);
    }

    R.drawWorld(ctx, this.world, this.time);
    R.drawEffects(ctx, this, this.time);
    if (this.vehicle) R.drawVehicle(ctx, this.vehicle, this.time, this.driving);
    for (const m of this.monsters) R.drawMonster(ctx, m, this.time);
    R.drawPlayer(ctx, this.player, this.time, this.driving);
    R.drawBuildGhost(ctx, this.world, this.player, this.buildTargetCell(), this.time);

    R.drawDarkness(ctx, this.world, this.ambient(), this.tint());
    R.drawFloaters(ctx, this);
    R.drawVignette(ctx, this.phase === 'night' ? 0.62 : 0.34);

    if (this.player.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,77,109,${this.player.hurtFlash * 0.45})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (this.flareTime > 0) {
      const k = clamp(this.flareTime / FLARE.duration, 0, 1);
      ctx.fillStyle = `rgba(255,220,150,${k * 0.16})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.restore();

    drawHud(ctx, this);
    drawCodex(ctx, this);
  }
}

function pointNearSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  return dist(px, py, x1 + dx * t, y1 + dy * t);
}
