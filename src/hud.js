import {
  VIEW_W, VIEW_H, WEAPONS, WEAPON_ORDER, RECIPES, RESOURCES, BUILDINGS,
  NIGHTS_IN_CENTURY, VEHICLE_PARTS, PLAYER, VEHICLE,
} from './config.js';
import { BUILD_ORDER } from './player.js';
import { clamp, commas } from './utils.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function panel(ctx, x, y, w, h, r = 8, alpha = 0.72) {
  ctx.fillStyle = `rgba(6,10,22,${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(56,225,255,.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, colour, bg = 'rgba(255,255,255,.12)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}

export function drawHud(ctx, game) {
  const p = game.player;
  ctx.textBaseline = 'middle';

  // ---- night / clock ----------------------------------------------------
  panel(ctx, 10, 10, 216, 46);
  ctx.textAlign = 'left';
  ctx.font = `800 19px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(`NIGHT ${game.night}`, 22, 27);
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText(`/ ${NIGHTS_IN_CENTURY}`, 22 + ctx.measureText(`NIGHT ${game.night}`).width + 44, 27);

  const isNight = game.phase === 'night';
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = isNight ? '#b07bff' : '#ffb454';
  ctx.textAlign = 'right';
  ctx.fillText(isNight ? 'NIGHT' : (game.duskWarning ? 'DUSK' : 'DAY'), 216, 27);
  ctx.textAlign = 'left';
  bar(ctx, 22, 40, 194, 5, 1 - game.phaseRemaining / game.phaseLength,
    isNight ? '#b07bff' : (game.duskWarning ? '#ff4d6d' : '#ffb454'));

  // ---- location / score -------------------------------------------------
  panel(ctx, VIEW_W - 196, 10, 186, 46);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('LOCATION', VIEW_W - 184, 24);
  ctx.fillStyle = '#dfe9ff';
  ctx.font = `800 13px ${FONT}`;
  ctx.fillText(`#${game.world.location}`, VIEW_W - 122, 24);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('KILLS', VIEW_W - 184, 42);
  ctx.fillStyle = '#dfe9ff';
  ctx.font = `800 13px ${FONT}`;
  ctx.fillText(commas(p.kills), VIEW_W - 122, 42);
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = game.heat > 2 ? '#ff4d6d' : '#7c89ab';
  ctx.textAlign = 'right';
  ctx.fillText(`HEAT ${game.heat.toFixed(1)}`, VIEW_W - 20, 33);
  ctx.textAlign = 'left';

  // ---- resources rail ---------------------------------------------------
  const keys = Object.keys(RESOURCES);
  panel(ctx, 10, 66, 112, 14 + keys.length * 15);
  ctx.font = `600 11px ${FONT}`;
  keys.forEach((k, i) => {
    const y = 82 + i * 15;
    ctx.fillStyle = RESOURCES[k].colour;
    ctx.fillRect(22, y - 3, 6, 6);
    ctx.fillStyle = '#9fb2d6';
    ctx.fillText(RESOURCES[k].label, 34, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(p.res[k]), 114, y);
    ctx.textAlign = 'left';
  });

  // ---- health / torch ---------------------------------------------------
  panel(ctx, 10, VIEW_H - 62, 210, 52);
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('HEALTH', 22, VIEW_H - 46);
  bar(ctx, 70, VIEW_H - 51, 138, 9, p.hp / p.maxHp, p.hp > 35 ? '#5ef2a0' : '#ff4d6d');
  ctx.fillStyle = '#fff';
  ctx.font = `800 9px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.ceil(p.hp)), 205, VIEW_H - 46);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#7c89ab';
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText('TORCH', 22, VIEW_H - 26);
  bar(ctx, 70, VIEW_H - 31, 138, 9, p.torchFuel / PLAYER.torchFuelMax, '#ffb454');

  // ---- weapons ----------------------------------------------------------
  const slotW = 62, gap = 5;
  const total = WEAPON_ORDER.length * (slotW + gap) - gap;
  const x0 = VIEW_W - total - 10;
  WEAPON_ORDER.forEach((key, i) => {
    const def = WEAPONS[key];
    const x = x0 + i * (slotW + gap);
    const y = VIEW_H - 52;
    const owned = p.unlocked.has(key);
    const active = p.weapon === key;
    panel(ctx, x, y, slotW, 42, 6, active ? 0.92 : 0.62);
    if (active) {
      ctx.strokeStyle = def.colour;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x + 0.5, y + 0.5, slotW - 1, 41);
    }
    ctx.globalAlpha = owned ? 1 : 0.28;
    ctx.font = `800 10px ${FONT}`;
    ctx.fillStyle = active ? def.colour : '#9fb2d6';
    ctx.textAlign = 'center';
    ctx.fillText(def.short || def.name.toUpperCase(), x + slotW / 2, y + 15);
    ctx.font = `700 9px ${FONT}`;
    ctx.fillStyle = '#5c6a86';
    ctx.fillText(String(def.slot), x + 8, y + 9);
    if (def.ammo) {
      const n = p.ammo[def.ammo] || 0;
      ctx.font = `800 12px ${FONT}`;
      ctx.fillStyle = n > 0 ? '#dfe9ff' : '#ff4d6d';
      ctx.fillText(String(n), x + slotW / 2, y + 30);
    } else if (key === 'torch') {
      ctx.font = `800 12px ${FONT}`;
      ctx.fillStyle = p.torchFuel > 0 ? '#ffb454' : '#ff4d6d';
      ctx.fillText(`${Math.round((p.torchFuel / PLAYER.torchFuelMax) * 100)}%`, x + slotW / 2, y + 30);
    } else {
      ctx.font = `700 10px ${FONT}`;
      ctx.fillStyle = '#5c6a86';
      ctx.fillText('∞', x + slotW / 2, y + 30);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  });

  // ---- flares -----------------------------------------------------------
  if (p.ammo.flares > 0) {
    panel(ctx, VIEW_W - total - 90, VIEW_H - 52, 74, 42, 6);
    ctx.textAlign = 'center';
    ctx.font = `800 10px ${FONT}`;
    ctx.fillStyle = '#ffb454';
    ctx.fillText('FLARE  [F]', VIEW_W - total - 53, VIEW_H - 37);
    ctx.font = `800 14px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(p.ammo.flares), VIEW_W - total - 53, VIEW_H - 20);
    ctx.textAlign = 'left';
  }

  if (game.buildMode) drawBuildBar(ctx, game);
  if (game.vehicle) drawVehicleStatus(ctx, game);
  drawToasts(ctx, game);
  drawPrompt(ctx, game);
  if (game.craftOpen) drawCraftMenu(ctx, game);
  if (game.bannerTime > 0) drawBanner(ctx, game);
}

function drawBuildBar(ctx, game) {
  const p = game.player;
  const w = 340, x = (VIEW_W - w) / 2, y = VIEW_H - 108;
  panel(ctx, x, y, w, 46, 8, 0.86);
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.textAlign = 'left';
  ctx.fillText('BUILD  ·  [Q]/[E] pick  ·  [Space] or click to place  ·  [X] remove  ·  [B] exit', x + 12, y + 13);
  BUILD_ORDER.forEach((kind, i) => {
    const def = BUILDINGS[kind];
    const bx = x + 12 + i * 82;
    const sel = p.buildSel === i;
    const afford = p.canAfford(def.cost);
    ctx.fillStyle = sel ? 'rgba(56,225,255,.16)' : 'rgba(255,255,255,.04)';
    ctx.fillRect(bx, y + 20, 76, 20);
    if (sel) { ctx.strokeStyle = '#38e1ff'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 20.5, 75, 19); }
    ctx.font = `800 9px ${FONT}`;
    ctx.fillStyle = afford ? (sel ? '#fff' : '#9fb2d6') : '#5c6a86';
    ctx.fillText(def.short || def.name.toUpperCase(), bx + 5, y + 27);
    ctx.font = `600 8px ${FONT}`;
    ctx.fillStyle = afford ? '#7c89ab' : '#ff4d6d';
    ctx.fillText(Object.entries(def.cost).map(([k, v]) => `${v}${k[0].toUpperCase()}`).join(' '), bx + 5, y + 36);
  });
}

function drawVehicleStatus(ctx, game) {
  const v = game.vehicle;
  const x = VIEW_W - 196, y = 62;
  panel(ctx, x, y, 186, 46);
  ctx.textAlign = 'left';
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = '#5ef2a0';
  ctx.fillText(game.driving ? 'DRIVING' : 'VEHICLE READY', x + 12, y + 14);
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('HULL', x + 12, y + 29);
  bar(ctx, x + 46, y + 24, 128, 7, v.hp / v.maxHp, '#5ef2a0');
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('FUEL', x + 12, y + 40);
  bar(ctx, x + 46, y + 35, 128, 7, v.fuel / VEHICLE.fuelMax, '#ffb454');
}

function drawToasts(ctx, game) {
  ctx.textAlign = 'center';
  game.toasts.forEach((t, i) => {
    const a = clamp(t.life / 0.6, 0, 1);
    ctx.globalAlpha = a;
    const y = 92 + i * 24;
    ctx.font = `700 13px ${FONT}`;
    const w = ctx.measureText(t.text).width + 26;
    panel(ctx, VIEW_W / 2 - w / 2, y - 12, w, 24, 12, 0.8 * a);
    ctx.globalAlpha = a;
    ctx.fillStyle = t.colour || '#dfe9ff';
    ctx.fillText(t.text, VIEW_W / 2, y);
    ctx.globalAlpha = 1;
  });
  ctx.textAlign = 'left';
}

function drawPrompt(ctx, game) {
  if (!game.prompt) return;
  ctx.textAlign = 'center';
  ctx.font = `700 12px ${FONT}`;
  const w = ctx.measureText(game.prompt).width + 30;
  panel(ctx, VIEW_W / 2 - w / 2, VIEW_H - 150, w, 26, 13, 0.85);
  ctx.fillStyle = '#38e1ff';
  ctx.fillText(game.prompt, VIEW_W / 2, VIEW_H - 137);
  ctx.textAlign = 'left';

  if (game.evacHold > 0) {
    bar(ctx, VIEW_W / 2 - 60, VIEW_H - 120, 120, 5, game.evacHold / 1.1, '#5ef2a0');
  }
}

function drawBanner(ctx, game) {
  const a = clamp(game.bannerTime / 0.8, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(3,5,12,.55)';
  ctx.fillRect(0, VIEW_H / 2 - 62, VIEW_W, 124);
  ctx.font = `900 46px ${FONT}`;
  // cheap glow: the same text a few times, spread and faded
  ctx.globalAlpha = a * 0.16;
  ctx.fillStyle = game.bannerColour || '#fff';
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
    ctx.fillText(game.bannerTitle, VIEW_W / 2 + dx, VIEW_H / 2 - 12 + dy);
  }
  ctx.globalAlpha = a;
  ctx.fillText(game.bannerTitle, VIEW_W / 2, VIEW_H / 2 - 12);
  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = '#b9c6e6';
  ctx.fillText(game.bannerSub || '', VIEW_W / 2, VIEW_H / 2 + 26);
  ctx.restore();
  ctx.textAlign = 'left';
}

export function drawCraftMenu(ctx, game) {
  const p = game.player;
  const w = 470, h = 396;
  const x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
  ctx.fillStyle = 'rgba(3,5,12,.78)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  panel(ctx, x, y, w, h, 12, 0.96);

  ctx.textAlign = 'left';
  ctx.font = `900 18px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('CRAFTING', x + 22, y + 28);
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = game.atBench ? '#5ef2a0' : '#ff4d6d';
  ctx.fillText(game.atBench ? 'AT WORKBENCH' : 'NO WORKBENCH NEARBY — some recipes locked', x + 128, y + 28);

  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('[↑/↓] choose   [Enter] craft   [Tab] close', x + 22, y + 46);

  const rowH = 20;
  RECIPES.forEach((r, i) => {
    const ry = y + 66 + i * rowH;
    const sel = game.craftIndex === i;
    const locked = r.benchOnly && !game.atBench;
    const afford = p.canAfford(r.cost) && !locked;
    if (sel) {
      ctx.fillStyle = 'rgba(56,225,255,.12)';
      ctx.fillRect(x + 14, ry - rowH / 2 - 1, w - 28, rowH);
      ctx.fillStyle = '#38e1ff';
      ctx.fillRect(x + 14, ry - rowH / 2 - 1, 2, rowH);
    }
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = afford ? (sel ? '#fff' : '#c3d0ec') : '#4d5a7a';
    ctx.fillText(r.label, x + 26, ry);

    ctx.font = `600 11px ${FONT}`;
    const cost = Object.entries(r.cost).map(([k, v]) => `${v} ${RESOURCES[k].label}`).join(', ');
    ctx.fillStyle = afford ? '#7c89ab' : '#5c3a4a';
    ctx.textAlign = 'right';
    ctx.fillText(cost, x + w - 68, ry);
    if (r.benchOnly) {
      ctx.font = `700 8px ${FONT}`;
      ctx.fillStyle = locked ? '#ff4d6d' : '#5ef2a0';
      ctx.fillText('BENCH', x + w - 26, ry);
    }
    ctx.textAlign = 'left';
    if (r.unlock && p.unlocked.has(r.unlock)) {
      ctx.fillStyle = '#5ef2a0';
      ctx.font = `700 9px ${FONT}`;
      ctx.fillText('✓', x + 18, ry);
    }
    if (r.part && p.parts.has(r.part)) {
      ctx.fillStyle = '#5ef2a0';
      ctx.font = `700 9px ${FONT}`;
      ctx.fillText('✓', x + 18, ry);
    }
  });

  // vehicle progress
  const vy = y + h - 42;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('VEHICLE', x + 22, vy);
  VEHICLE_PARTS.forEach((part, i) => {
    const bx = x + 82 + i * 74;
    const have = p.parts.has(part);
    ctx.fillStyle = have ? 'rgba(94,242,160,.18)' : 'rgba(255,255,255,.05)';
    ctx.fillRect(bx, vy - 9, 68, 18);
    ctx.fillStyle = have ? '#5ef2a0' : '#5c6a86';
    ctx.font = `800 9px ${FONT}`;
    ctx.fillText(part.toUpperCase(), bx + 8, vy);
  });
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = game.vehicle ? '#5ef2a0' : '#7c89ab';
  ctx.fillText(
    game.vehicle ? 'Built and parked at your bench.' : 'Build all four parts at a workbench to assemble it.',
    x + 22, vy + 22,
  );
}

export function drawCodex(ctx, game) {
  if (!game.codexOpen) return;
  const w = 520, h = 300, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
  ctx.fillStyle = 'rgba(3,5,12,.8)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  panel(ctx, x, y, w, h, 12, 0.96);
  ctx.textAlign = 'left';
  ctx.font = `900 18px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('FIELD NOTES', x + 22, y + 30);
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  ctx.fillText('[C] close', x + w - 70, y + 30);

  const rows = [
    ['GHOST', '#b07bff', 'Walks through walls. Lead, arrows and steel go straight through it. Laser and light are all it fears.'],
    ['VAMPIRE', '#ff4d6d', 'Fast, dashes in. Garlic pizza stops it dead — throw one and it cannot help itself. Light burns it.'],
    ['MUTANT ZOMBIE', '#5ef2a0', 'Enormous, smashes through your walls. Guns, arrows and swords cut it down — but not through the iron shoulder pad. Get round the other side.'],
  ];
  rows.forEach((r, i) => {
    const ry = y + 62 + i * 74;
    ctx.font = `800 13px ${FONT}`;
    ctx.fillStyle = r[1];
    ctx.fillText(r[0], x + 22, ry);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = '#b9c6e6';
    wrapText(ctx, r[2], x + 22, ry + 18, w - 44, 15);
  });
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = '#7c89ab';
  wrapText(ctx, 'Everything hates light. Torches you plant burn them where they stand — a well-lit base does half the fighting for you.', x + 22, y + h - 40, w - 44, 14);
}

export function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '', yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy); line = word; yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}
