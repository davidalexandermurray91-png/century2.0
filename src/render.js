import {
  TILE, GRID_W, GRID_H, VIEW_W, VIEW_H,
  T_WALL, T_TUNNEL, B_NONE, B_WALL, B_TORCH, B_BENCH, B_TURRET,
  BUILDINGS, RESOURCES, M_GHOST, M_VAMPIRE, M_ZOMBIE, WEAPONS,
} from './config.js';
import { idx, tileCentre } from './world.js';
import { clamp, TAU } from './utils.js';

const PALETTE = {
  floor: '#080c18',
  floorAlt: '#0a1020',
  wall: '#16224a',
  wallEdge: '#2f4a8f',
  wallNight: '#101a3c',
  grid: '#0d1428',
};

let lightCanvas = null, lightCtx = null, lightImage = null;
let terrainCanvas = null, terrainCtx = null, terrainWorld = null, terrainRev = -1;

/**
 * Canvas `shadowBlur` is lovely and ruinously slow — thirty-odd glowing things
 * a frame was costing more than everything else in the renderer put together.
 * These are the same look as a pre-rendered sprite, blitted instead of blurred.
 */
const glowCache = new Map();
function glowSprite(colour) {
  let sprite = glowCache.get(colour);
  if (sprite) return sprite;
  const size = 128;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;
  const g = sprite.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `${colour}ff`);
  grad.addColorStop(0.35, `${colour}88`);
  grad.addColorStop(0.7, `${colour}22`);
  grad.addColorStop(1, `${colour}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(colour, sprite);
  return sprite;
}

/** Soft halo around a point. `colour` must be a 6-digit hex. */
function glow(ctx, x, y, radius, colour, alpha = 1) {
  const sprite = glowSprite(colour);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

function ensureLightBuffer() {
  if (lightCanvas) return;
  lightCanvas = document.createElement('canvas');
  lightCanvas.width = GRID_W;
  lightCanvas.height = GRID_H;
  lightCtx = lightCanvas.getContext('2d');
  lightImage = lightCtx.createImageData(GRID_W, GRID_H);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The maze itself only changes when a zombie puts a hole in it, so it is
 * painted once into an offscreen canvas and blitted from then on. Re-pathing
 * four hundred wall tiles every frame was the single biggest cost in here.
 */
function ensureTerrain(world) {
  if (terrainWorld === world && terrainRev === world.revision) return;
  if (!terrainCanvas) {
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = VIEW_W;
    terrainCanvas.height = VIEW_H;
    terrainCtx = terrainCanvas.getContext('2d');
  }
  terrainWorld = world;
  terrainRev = world.revision;
  paintTerrain(terrainCtx, world);
}

export function drawWorld(ctx, world, t) {
  ensureTerrain(world);
  ctx.drawImage(terrainCanvas, 0, 0);

  // exits and tunnels animate, so they stay live
  for (const e of world.exits) drawExit(ctx, e.x, e.y, t);
  drawPellets(ctx, world, t);
  drawFlarePads(ctx, world, t);
  drawBuildings(ctx, world, t);
}

function paintTerrain(ctx, world) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // floor weave
  ctx.fillStyle = PALETTE.floorAlt;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (((x + y) & 1) === 0) continue;
      if (world.tiles[idx(x, y)] === T_WALL) continue;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  // walls, drawn as connected neon slabs
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const tile = world.tiles[idx(x, y)];
      if (tile !== T_WALL) continue;
      const px = x * TILE, py = y * TILE;
      const open = (dx, dy) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) return false;
        return world.tiles[idx(nx, ny)] !== T_WALL;
      };
      const pad = 2;
      const l = open(-1, 0) ? pad : 0, r = open(1, 0) ? pad : 0;
      const u = open(0, -1) ? pad : 0, d = open(0, 1) ? pad : 0;
      ctx.fillStyle = PALETTE.wall;
      roundRect(ctx, px + l, py + u, TILE - l - r, TILE - u - d, 5);
      ctx.fill();
      ctx.strokeStyle = PALETTE.wallEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // side tunnels
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (world.tiles[idx(x, y)] !== T_TUNNEL) continue;
      const g = ctx.createLinearGradient(x * TILE, 0, x * TILE + TILE, 0);
      g.addColorStop(0, 'rgba(56,225,255,0)');
      g.addColorStop(1, 'rgba(56,225,255,.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
}

function drawExit(ctx, x, y, t) {
  const px = x * TILE, py = y * TILE;
  const pulse = 0.45 + Math.sin(t * 3 + x) * 0.2;
  ctx.fillStyle = `rgba(94,242,160,${pulse})`;
  ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
  ctx.strokeStyle = '#5ef2a0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 2.5, py + 2.5, TILE - 5, TILE - 5);
  ctx.fillStyle = '#03130a';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', px + TILE / 2, py + TILE / 2);
}

function drawPellets(ctx, world, t) {
  for (const [i, res] of world.pellets) {
    const x = i % GRID_W, y = (i / GRID_W) | 0;
    const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
    const c = RESOURCES[res].colour;
    const wob = 1 + Math.sin(t * 4 + i * 0.7) * 0.12;
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.6 * wob, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5 * wob, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawFlarePads(ctx, world, t) {
  for (const pad of world.flarePads) {
    if (pad.taken) continue;
    const cx = tileCentre(pad.x), cy = tileCentre(pad.y);
    const pulse = 1 + Math.sin(t * 5) * 0.22;
    glow(ctx, cx, cy, 17 * pulse, '#ffb454', 0.85);
    ctx.fillStyle = '#ffdca8';
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,180,84,${0.6 + Math.sin(t * 5) * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 10 * pulse, 0, TAU);
    ctx.stroke();
  }
}

function drawBuildings(ctx, world, t) {
  if (!world.buildCount) return;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = idx(x, y);
      const b = world.build[i];
      if (b === B_NONE) continue;
      const px = x * TILE, py = y * TILE;
      const hpFrac = clamp(world.buildHp[i] / BUILDINGS[b].hp, 0, 1);

      if (b === B_WALL) {
        ctx.fillStyle = `rgba(140,110,70,${0.45 + hpFrac * 0.45})`;
        roundRect(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 3); ctx.fill();
        ctx.strokeStyle = '#c98b4b'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath();
        ctx.moveTo(px + 3, py + TILE / 2); ctx.lineTo(px + TILE - 3, py + TILE / 2);
        ctx.stroke();
      } else if (b === B_TORCH) {
        const flick = 1 + Math.sin(t * 14 + x * 3 + y) * 0.15;
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(px + TILE / 2 - 1.5, py + TILE / 2, 3, 8);
        glow(ctx, px + TILE / 2, py + TILE / 2 - 2, 15 * flick, '#ffb454', 0.9);
        ctx.fillStyle = '#ffd07a';
        ctx.beginPath();
        ctx.ellipse(px + TILE / 2, py + TILE / 2 - 2, 3.6 * flick, 5.4 * flick, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff4d0';
        ctx.beginPath();
        ctx.ellipse(px + TILE / 2, py + TILE / 2 - 2, 1.8, 3, 0, 0, TAU);
        ctx.fill();
      } else if (b === B_BENCH) {
        ctx.fillStyle = '#3a2c1d';
        roundRect(ctx, px + 2, py + 5, TILE - 4, TILE - 9, 3); ctx.fill();
        ctx.fillStyle = '#c98b4b';
        ctx.fillRect(px + 3, py + 6, TILE - 6, 3);
        ctx.fillStyle = '#9fb2d6';
        ctx.fillRect(px + 5, py + 12, 5, 2);
        ctx.fillRect(px + 13, py + 11, 3, 5);
        ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1;
        roundRect(ctx, px + 2.5, py + 5.5, TILE - 5, TILE - 10, 3); ctx.stroke();
      } else if (b === B_TURRET) {
        const spin = t * 1.6;
        ctx.fillStyle = '#1b2a4d';
        ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 8, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#38e1ff'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.save();
        ctx.translate(px + TILE / 2, py + TILE / 2);
        ctx.rotate(spin);
        ctx.fillStyle = '#38e1ff';
        ctx.fillRect(0, -1.5, 11, 3);
        ctx.restore();
        const charge = clamp(world.turretCharge[i], 0, 1);
        ctx.fillStyle = `rgba(56,225,255,${0.25 + charge * 0.6})`;
        ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 3.2, 0, TAU); ctx.fill();
      }

      if (hpFrac < 1) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(px + 3, py + TILE - 4, TILE - 6, 2.5);
        ctx.fillStyle = hpFrac > 0.4 ? '#5ef2a0' : '#ff4d6d';
        ctx.fillRect(px + 3, py + TILE - 4, (TILE - 6) * hpFrac, 2.5);
      }
    }
  }
}

// ---------------------------------------------------------------- actors ---

export function drawPlayer(ctx, p, t, driving) {
  if (driving) return;
  const flash = p.invuln > 0 && Math.floor(t * 20) % 2 === 0;
  const ang = Math.atan2(p.dir.y, p.dir.x);
  // the chomp is the Pac-Man tell — it should stop when you do
  const chomp = p.moving ? Math.abs(Math.sin(t * 9)) * 0.5 + 0.06 : 0.16;

  ctx.save();
  ctx.translate(p.x, p.y);

  // torch glow held in hand
  if (p.weapon === 'torch' && p.torchFuel > 0) {
    const fx = Math.cos(ang) * 11, fy = Math.sin(ang) * 11;
    glow(ctx, fx, fy, 20, '#ffb454', 0.95);
    ctx.fillStyle = '#ffd07a';
    ctx.beginPath();
    ctx.arc(fx, fy, 3.6 + Math.sin(t * 16) * 0.5, 0, TAU);
    ctx.fill();
  }

  glow(ctx, 0, 0, 17, flash ? '#ff4d6d' : '#38e1ff', 0.5);
  ctx.rotate(ang);
  ctx.fillStyle = flash ? '#ff8fa3' : '#ffe27a';
  ctx.beginPath();
  ctx.arc(0, 0, p.radius + 1, chomp, TAU - chomp);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // an eye, so it reads as a person rather than a wedge of cheese
  ctx.fillStyle = '#1a1200';
  ctx.beginPath();
  ctx.arc(1.5, -4.5, 1.5, 0, TAU);
  ctx.fill();

  // melee swing arc
  if (p.swing > 0) {
    const def = WEAPONS[p.weapon];
    const k = 1 - p.swing / (def.cooldown * 0.6);
    ctx.strokeStyle = def.colour;
    ctx.globalAlpha = clamp(1 - k, 0, 1);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, (def.range || 36) * 0.75, -0.9 + k * 1.8, -0.4 + k * 1.8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function drawMonster(ctx, m, t) {
  const s = m.scale;
  ctx.save();
  ctx.translate(m.x, m.y);
  const hurt = m.hitFlash > 0;
  const scared = m.fear > 0;

  if (m.type === M_GHOST) {
    const bob = Math.sin(t * 4 + m.id) * 1.6;
    ctx.translate(0, bob);
    ctx.globalAlpha = 0.88;
    glow(ctx, 0, 0, 20, scared ? '#9fb2d6' : m.def.colour, 0.55);
    ctx.fillStyle = hurt ? '#ffffff' : (scared ? '#3b4a6b' : m.def.colour);
    ctx.beginPath();
    ctx.arc(0, -2, 10, Math.PI, 0);
    ctx.lineTo(10, 8);
    for (let i = 0; i < 3; i++) {
      const x0 = 10 - i * 6.66, x1 = 10 - (i + 1) * 6.66;
      ctx.quadraticCurveTo((x0 + x1) / 2, 8 + (i % 2 ? -5 : 5), x1, 8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-3.4, -3, 2.6, 0, TAU); ctx.arc(3.4, -3, 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = scared ? '#ff4d6d' : '#1b1030';
    ctx.beginPath();
    ctx.arc(-3.4 + m.dir.x * 1.1, -3 + m.dir.y * 1.1, 1.2, 0, TAU);
    ctx.arc(3.4 + m.dir.x * 1.1, -3 + m.dir.y * 1.1, 1.2, 0, TAU);
    ctx.fill();
  }

  if (m.type === M_VAMPIRE) {
    const flap = Math.sin(t * 9 + m.id) * 3;
    ctx.fillStyle = hurt ? '#fff' : '#2a0a14';
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.quadraticCurveTo(-16, -6 + flap, -13, 9);
    ctx.quadraticCurveTo(-6, 3, 0, 8);
    ctx.quadraticCurveTo(6, 3, 13, 9);
    ctx.quadraticCurveTo(16, -6 + flap, 0, 2);
    ctx.fill();
    glow(ctx, 0, -1, 16, m.def.colour, 0.5);
    ctx.fillStyle = hurt ? '#fff' : (scared ? '#5b3040' : '#c9203f');
    ctx.beginPath(); ctx.arc(0, -1, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-3, -2.5, 2.1, 0, TAU); ctx.arc(3, -2.5, 2.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath(); ctx.arc(-3, -2.5, 1, 0, TAU); ctx.arc(3, -2.5, 1, 0, TAU); ctx.fill();
    // fangs
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-2.5, 2); ctx.lineTo(-1.2, 6); ctx.lineTo(-0.2, 2);
    ctx.moveTo(2.5, 2); ctx.lineTo(1.2, 6); ctx.lineTo(0.2, 2);
    ctx.fill();
    if (m.state === 'eat') {
      ctx.fillStyle = '#ffd93d';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!!!', 0, -14);
    }
  }

  if (m.type === M_ZOMBIE) {
    const lurch = Math.sin(t * 3.4 + m.id) * 1.5;
    ctx.save();
    ctx.translate(0, lurch);
    // bulk
    ctx.fillStyle = hurt ? '#fff' : (scared ? '#31513f' : m.def.colour);
    roundRect(ctx, -11 * s, -10 * s, 22 * s, 21 * s, 7 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    roundRect(ctx, -11 * s, 2 * s, 22 * s, 9 * s, 5 * s);
    ctx.fill();
    // head
    ctx.fillStyle = hurt ? '#fff' : '#8fe8bb';
    ctx.beginPath(); ctx.arc(0, -11 * s, 6 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a1a12';
    ctx.beginPath();
    ctx.arc(-2.4 * s, -12 * s, 1.5 * s, 0, TAU);
    ctx.arc(2.4 * s, -12 * s, 1.5 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0a1a12';
    ctx.fillRect(-3.5 * s, -8.5 * s, 7 * s, 1.6 * s);

    // the iron spiked shoulder pad — armour on one side only
    const pd = m.padDir;
    const ox = pd.x * 13 * s, oy = pd.y * 13 * s;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(Math.atan2(pd.y, pd.x) + Math.PI / 2);
    ctx.fillStyle = m.sparkFlash > 0 ? '#fff' : '#8d9bb5';
    roundRect(ctx, -8 * s, -5 * s, 16 * s, 10 * s, 3 * s);
    ctx.fill();
    ctx.strokeStyle = '#5c6a86'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = m.sparkFlash > 0 ? '#fff' : '#c6d2e6';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5.5 * s - 2.4 * s, -5 * s);
      ctx.lineTo(i * 5.5 * s, -11 * s);
      ctx.lineTo(i * 5.5 * s + 2.4 * s, -5 * s);
      ctx.fill();
    }
    ctx.restore();

    if (m.sparkFlash > 0) {
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2;
      ctx.globalAlpha = m.sparkFlash / 0.22;
      ctx.beginPath();
      ctx.arc(ox, oy, 14 * s, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (m.state === 'smash') {
      ctx.fillStyle = '#ffb454';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SMASH', 0, -22 * s);
    }
    ctx.restore();
  }

  ctx.restore();

  // health bar once it's been hurt
  if (m.hp < m.maxHp) {
    const w = 26 * s;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(m.x - w / 2, m.y - 18 * s, w, 3);
    ctx.fillStyle = m.def.colour;
    ctx.fillRect(m.x - w / 2, m.y - 18 * s, w * clamp(m.hp / m.maxHp, 0, 1), 3);
  }
}

export function drawVehicle(ctx, v, t, driving) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);

  // headlights
  if (driving) {
    const g = ctx.createRadialGradient(v.halfL, 0, 2, v.halfL, 0, 130);
    g.addColorStop(0, 'rgba(255,244,208,.5)');
    g.addColorStop(1, 'rgba(255,244,208,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(v.halfL, 0);
    ctx.arc(v.halfL, 0, 130, -0.55, 0.55);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#1a1207';
  for (const [lx, ly] of [[-9, -12], [-9, 12], [10, -12], [10, 12]]) {
    ctx.save(); ctx.translate(lx, ly);
    ctx.fillRect(-4, -3, 8, 6);
    ctx.restore();
  }
  const body = ctx.createLinearGradient(0, -v.halfW, 0, v.halfW);
  body.addColorStop(0, '#3d4f7a');
  body.addColorStop(1, '#1b2540');
  ctx.fillStyle = body;
  roundRect(ctx, -v.halfL, -v.halfW, v.halfL * 2, v.halfW * 2, 5);
  ctx.fill();
  ctx.strokeStyle = '#5ef2a0'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#0d1728';
  roundRect(ctx, -4, -7, 11, 14, 3); ctx.fill();
  ctx.fillStyle = '#fff4d0';
  ctx.fillRect(v.halfL - 3, -8, 3, 4);
  ctx.fillRect(v.halfL - 3, 4, 3, 4);
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(-v.halfL, -7, 2, 3);
  ctx.fillRect(-v.halfL, 4, 2, 3);
  ctx.restore();

  const hpFrac = clamp(v.hp / v.maxHp, 0, 1);
  if (hpFrac < 1) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(v.x - 16, v.y - 24, 32, 3);
    ctx.fillStyle = hpFrac > 0.35 ? '#5ef2a0' : '#ff4d6d';
    ctx.fillRect(v.x - 16, v.y - 24, 32 * hpFrac, 3);
  }
}

export function drawEffects(ctx, game, t) {
  for (const p of game.pizzasOnGround) {
    const bob = Math.sin(p.bob) * 1.5;
    const fade = clamp(p.life / 3, 0, 1);
    ctx.globalAlpha = fade;
    glow(ctx, p.x, p.y + bob, 16, '#ffd93d', 0.7);
    ctx.fillStyle = '#e2a33f';
    ctx.beginPath(); ctx.arc(p.x, p.y + bob, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath(); ctx.arc(p.x, p.y + bob, 6.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9203f';
    for (const [dx, dy] of [[-2.5, -2], [2.5, -1], [0, 2.6]]) {
      ctx.beginPath(); ctx.arc(p.x + dx, p.y + bob + dy, 1.4, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  for (const pr of game.projectiles) {
    glow(ctx, pr.x, pr.y, 11, pr.colour, 0.6);
    ctx.save();
    ctx.fillStyle = pr.colour;
    if (pr.kind === 'arrow') {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.translate(pr.x, pr.y); ctx.rotate(a);
      ctx.fillRect(-7, -1, 14, 2);
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3); ctx.fill();
    } else if (pr.kind === 'pizza') {
      ctx.translate(pr.x, pr.y); ctx.rotate(pr.spin);
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9203f';
      ctx.beginPath(); ctx.arc(2, -2, 1.4, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 2.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  for (const b of game.beams) {
    const k = b.life / b.max;
    ctx.save();
    ctx.strokeStyle = b.colour;
    ctx.globalAlpha = clamp(k, 0, 1) * 0.5;
    ctx.lineWidth = 10 + k * 12;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = clamp(k, 0, 1);
    ctx.lineWidth = 2 + k * 7;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 + k * 2;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.restore();
  }

  for (const p of game.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.colour;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    ctx.globalAlpha = 1;
  }
}

export function drawFloaters(ctx, game) {
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px system-ui, sans-serif';
  for (const f of game.floaters) {
    ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
    ctx.fillStyle = '#000';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.colour;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }
}

/** Build-mode ghost preview on the tile you're facing. */
export function drawBuildGhost(ctx, world, player, target, t) {
  if (!player.buildMode) return;
  const { x, y } = target;
  const ok = world.canPlace(x, y) && player.canAfford(BUILDINGS[player.buildKind].cost);
  const px = x * TILE, py = y * TILE;
  ctx.save();
  ctx.globalAlpha = 0.35 + Math.sin(t * 6) * 0.12;
  ctx.fillStyle = ok ? '#5ef2a0' : '#ff4d6d';
  roundRect(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ok ? '#5ef2a0' : '#ff4d6d';
  ctx.lineWidth = 1.5;
  roundRect(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 4);
  ctx.stroke();
  ctx.restore();
}

/**
 * Darkness pass. Light is computed per tile, then blitted up smoothed, which
 * gives soft pools of torchlight for almost no cost.
 */
export function drawDarkness(ctx, world, ambient, tint) {
  ensureLightBuffer();
  const data = lightImage.data;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = idx(x, y);
      const lit = Math.max(world.staticLight[i], world.dynamicLight[i]);
      const visible = clamp(ambient + lit * (1 - ambient) * 1.15, 0, 1);
      const a = Math.round((1 - visible) * 255);
      const o = i * 4;
      data[o] = tint[0]; data[o + 1] = tint[1]; data[o + 2] = tint[2]; data[o + 3] = a;
    }
  }
  lightCtx.putImageData(lightImage, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lightCanvas, -TILE / 2, -TILE / 2, VIEW_W + TILE, VIEW_H + TILE);
  ctx.restore();
}

let vignetteCanvas = null;

/** Painted once at full strength and faded with globalAlpha — evaluating a
 *  full-screen gradient every frame was costing milliseconds for nothing. */
export function drawVignette(ctx, strength = 0.5) {
  if (!vignetteCanvas) {
    vignetteCanvas = document.createElement('canvas');
    vignetteCanvas.width = VIEW_W;
    vignetteCanvas.height = VIEW_H;
    const vc = vignetteCanvas.getContext('2d');
    const g = vc.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.32, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    vc.fillStyle = g;
    vc.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * strength;
  ctx.drawImage(vignetteCanvas, 0, 0);
  ctx.globalAlpha = prev;
}
