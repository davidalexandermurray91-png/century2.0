// Central tuning table. Everything a designer would want to twiddle lives here.

export const TILE = 24;
export const GRID_W = 39;   // odd, so the maze carver lines up
export const GRID_H = 23;   // odd
export const VIEW_W = GRID_W * TILE;
export const VIEW_H = GRID_H * TILE;

// --- the century ---------------------------------------------------------
export const NIGHTS_IN_CENTURY = 100;
export const GRACE_NIGHTS = 5;        // nights 1-5: nothing attacks you
export const DUSK_SECONDS = 6;        // warning window folded into the day

// Pacing curve. Early days are long enough to build something worth defending;
// by the time you're deep into a century the days are short and the nights
// are not. A full century lands somewhere around 65-70 minutes.
export function dayLength(night) {
  return Math.max(16, 34 - night * 0.8);
}
export function nightLength(night) {
  return Math.min(26, 12 + night * 0.4);
}

// --- tiles ---------------------------------------------------------------
export const T_FLOOR = 0;
export const T_WALL = 1;
export const T_EXIT = 2;   // drive a vehicle onto one of these to evacuate
export const T_TUNNEL = 3; // Pac-Man style side wrap

// --- player buildings ----------------------------------------------------
export const B_NONE = 0;
export const B_WALL = 1;
export const B_TORCH = 2;
export const B_BENCH = 3;
export const B_TURRET = 4;

export const BUILDINGS = {
  [B_WALL]:   { name: 'Barricade',    short: 'BARRICADE', cost: { wood: 2, scrap: 1 },             hp: 60, solid: true,  light: 0 },
  [B_TORCH]:  { name: 'Torch',        short: 'TORCH',     cost: { wood: 2, fuel: 1 },              hp: 20, solid: false, light: 6 },
  [B_BENCH]:  { name: 'Workbench',    short: 'BENCH',     cost: { wood: 8, scrap: 6 },             hp: 90, solid: true,  light: 1 },
  [B_TURRET]: { name: 'Laser Turret', short: 'TURRET',    cost: { iron: 8, crystal: 4, scrap: 6 }, hp: 70, solid: true,  light: 3 },
};

// --- resources -----------------------------------------------------------
export const RESOURCES = {
  scrap:   { label: 'Scrap',   colour: '#9fb2d6' },
  wood:    { label: 'Wood',    colour: '#c98b4b' },
  iron:    { label: 'Iron',    colour: '#e0e6f2' },
  crystal: { label: 'Crystal', colour: '#38e1ff' },
  fuel:    { label: 'Fuel',    colour: '#ffb454' },
  dough:   { label: 'Dough',   colour: '#f2d9a8' },
  cheese:  { label: 'Cheese',  colour: '#ffd93d' },
};

// how often each resource shows up as a pellet on the floor
export const PELLET_MIX = [
  ['scrap', 30], ['wood', 24], ['iron', 12], ['fuel', 12],
  ['dough', 9], ['cheese', 9], ['crystal', 4],
];

// --- monsters ------------------------------------------------------------
export const M_GHOST = 'ghost';
export const M_VAMPIRE = 'vampire';
export const M_ZOMBIE = 'zombie';

export const MONSTERS = {
  [M_GHOST]: {
    name: 'Wisp', label: 'GHOST',
    hp: 55, speed: 86, touchDamage: 9, colour: '#b07bff',
    phasing: true,          // walks through walls, like it owns the place
    lightBurn: 18,          // hp/sec while standing in light
    lightFear: 1.0,         // how hard it steers away from lit tiles
    scoreValue: 12,
  },
  [M_VAMPIRE]: {
    name: 'Nosferat', label: 'VAMPIRE',
    hp: 80, speed: 104, touchDamage: 12, colour: '#ff4d6d',
    phasing: false,
    lightBurn: 15,
    lightFear: 1.4,
    dashEvery: 4.2, dashSpeed: 260, dashTime: 0.45,
    scoreValue: 20,
  },
  [M_ZOMBIE]: {
    name: 'Hulk', label: 'MUTANT ZOMBIE',
    hp: 260, speed: 52, touchDamage: 22, colour: '#5ef2a0',
    phasing: false,
    smashesWalls: true, smashTime: 1.1,
    lightBurn: 5,           // light hurts it, but it mostly just shrugs
    lightSlow: 0.45,        // it does hate being lit up though
    lightFear: 0.25,
    padBlock: 0.88,         // damage soaked by that iron spiked shoulder pad
    scale: 1.75,
    scoreValue: 45,
  },
};

// --- weapons -------------------------------------------------------------
// dmg tables are multipliers per monster type. This is the heart of the game:
// nothing is a universal answer.
export const WEAPONS = {
  torch: {
    key: 'torch', name: 'Torch', short: 'TORCH', slot: 1, kind: 'melee',
    damage: 10, range: 34, cooldown: 0.42, colour: '#ffb454',
    light: 5.5, ammo: null,
    vs: { ghost: 1.6, vampire: 1.8, zombie: 0.8 },
    blurb: 'Held flame. Weak swing, but it lights the ground you stand on.',
  },
  sword: {
    key: 'sword', name: 'Sword', short: 'SWORD', slot: 2, kind: 'melee',
    damage: 34, range: 42, cooldown: 0.36, colour: '#e0e6f2',
    light: 0, ammo: null, arc: 1.5,
    vs: { ghost: 0, vampire: 0.35, zombie: 1.15 },
    blurb: 'Steel. Cleaves the big one. Passes straight through a ghost.',
  },
  bow: {
    key: 'bow', name: 'Bow', short: 'BOW', slot: 3, kind: 'shoot',
    damage: 26, cooldown: 0.55, speed: 380, colour: '#c98b4b',
    ammo: 'arrows', projectile: 'arrow',
    vs: { ghost: 0, vampire: 0.5, zombie: 1.0 },
    blurb: 'Wooden shafts. Quiet, cheap, and a stake is still a stake.',
  },
  gun: {
    key: 'gun', name: 'Gun', short: 'GUN', slot: 4, kind: 'shoot',
    damage: 22, cooldown: 0.16, speed: 620, colour: '#ffe6a8',
    ammo: 'bullets', projectile: 'bullet', spread: 0.06, muzzleLight: 4,
    vs: { ghost: 0, vampire: 0.25, zombie: 1.25 },
    blurb: 'Loud and fast. Chews through the zombie. Lead means nothing to the dead-er things.',
  },
  laser: {
    key: 'laser', name: 'Laser', short: 'LASER', slot: 5, kind: 'beam',
    damage: 120, cooldown: 0.75, colour: '#38e1ff',
    ammo: 'cells', beamLength: 11, beamTime: 0.12, beamLight: 7,
    vs: { ghost: 1.0, vampire: 0.6, zombie: 0.5 },
    blurb: 'Coherent light. The only thing a ghost can actually feel.',
  },
  pizza: {
    key: 'pizza', name: 'Garlic Pizza', short: 'PIZZA', slot: 6, kind: 'throw',
    damage: 70, cooldown: 0.7, speed: 300, colour: '#ffd93d',
    ammo: 'pizzas', projectile: 'pizza',
    vs: { ghost: 0, vampire: 1.0, zombie: 0.2 },
    blurb: 'Garlic, and far too much of it. Vampires cannot leave it alone.',
  },
};

export const WEAPON_ORDER = ['torch', 'sword', 'bow', 'gun', 'laser', 'pizza'];

// --- crafting ------------------------------------------------------------
// benchOnly recipes need you stood next to a workbench.
export const RECIPES = [
  { id: 'sword',   label: 'Sword',            cost: { iron: 6, wood: 2 },              unlock: 'sword', benchOnly: true },
  { id: 'bow',     label: 'Bow',              cost: { wood: 8, scrap: 2 },             unlock: 'bow' },
  { id: 'gun',     label: 'Gun',              cost: { iron: 10, scrap: 8 },            unlock: 'gun',  benchOnly: true },
  { id: 'laser',   label: 'Laser Rifle',      cost: { crystal: 8, iron: 8, scrap: 6 }, unlock: 'laser', benchOnly: true },
  { id: 'arrows',  label: 'Arrows  x8',       cost: { wood: 3 },                       give: { arrows: 8 } },
  { id: 'bullets', label: 'Bullets x12',      cost: { iron: 3, scrap: 2 },             give: { bullets: 12 }, benchOnly: true },
  { id: 'cells',   label: 'Cells   x4',       cost: { crystal: 3 },                    give: { cells: 4 },    benchOnly: true },
  { id: 'pizzas',  label: 'Pizza   x3',       cost: { dough: 3, cheese: 3 },           give: { pizzas: 3 } },
  { id: 'medkit',  label: 'Patch up (+40hp)', cost: { dough: 2, cheese: 1, scrap: 2 }, heal: 40 },
  { id: 'flare',   label: 'Flare',            cost: { fuel: 3, crystal: 1 },           give: { flares: 1 } },
  // vehicle parts
  { id: 'frame',   label: 'Chassis',          cost: { iron: 14, scrap: 16 }, part: 'frame',  benchOnly: true },
  { id: 'engine',  label: 'Engine',           cost: { iron: 12, crystal: 5 }, part: 'engine', benchOnly: true },
  { id: 'wheels',  label: 'Wheels',           cost: { scrap: 18, wood: 8 },  part: 'wheels', benchOnly: true },
  { id: 'tank',    label: 'Fuel Tank',        cost: { fuel: 12, scrap: 6 },  part: 'tank',   benchOnly: true },
];

export const VEHICLE_PARTS = ['frame', 'engine', 'wheels', 'tank'];

// --- player --------------------------------------------------------------
export const PLAYER = {
  maxHp: 100,
  speed: 132,
  radius: 9,
  invulnAfterHit: 0.6,
  torchFuelMax: 100,
  torchBurnRate: 1.6,   // per second while the torch is out
};

// --- vehicle -------------------------------------------------------------
export const VEHICLE = {
  maxHp: 220,
  accel: 300,
  maxSpeed: 250,
  reverse: 110,
  turn: 2.9,
  friction: 1.6,
  fuelMax: 100,
  fuelBurn: 2.4,
  ramDamage: 90,
  headlight: 9,
};

// --- flare (the power pellet) -------------------------------------------
export const FLARE = { duration: 8, radius: 999, burn: 34 };

// Composition of a night's attack. Counts are capped: past a point a bigger
// crowd is just worse framerate, so late nights lean on tougher monsters and
// a nastier mix rather than an unreadable swarm.
export const MAX_WAVE = 24;

export function waveFor(night, heat) {
  if (night <= GRACE_NIGHTS) return [];
  const n = night - GRACE_NIGHTS;
  const pressure = n + heat * 1.5;
  const ghosts = Math.min(10, 1 + Math.floor(pressure * 0.35));
  const vamps = n >= 3 ? Math.min(8, 1 + Math.floor((pressure - 2) * 0.28)) : 0;
  const zombies = n >= 6 ? Math.min(6, 1 + Math.floor((pressure - 5) * 0.16)) : 0;
  const out = [];
  for (let i = 0; i < ghosts; i++) out.push(M_GHOST);
  for (let i = 0; i < vamps; i++) out.push(M_VAMPIRE);
  for (let i = 0; i < zombies; i++) out.push(M_ZOMBIE);
  return out.slice(0, MAX_WAVE);
}

// Monsters get tougher the longer the run goes on, up to a ceiling — beyond
// that a zombie stops being frightening and starts being homework.
export function statScale(night) {
  const n = Math.max(0, night - GRACE_NIGHTS);
  // steep climb through the first century, then a slow creep for anyone
  // stubborn enough to go looking for a second one
  return 1 + Math.min(1.6, n * 0.022) + Math.max(0, night - NIGHTS_IN_CENTURY) * 0.004;
}
