// The block palette for world mode.
//
// `tiles` names the atlas slot used for the top, the sides and the bottom of a
// block. `cost` is only charged when a world is running under survival rules —
// an owner in creative mode pays nothing, which is most of what admin power is.

import { T } from './textures.js';

export const AIR = 0;

export const BLOCKS = {
  1:  { id: 1,  name: 'Grass',      colour: '#5fa83f', cost: {},
        tiles: { top: T.grassTop, side: T.grassSide, bottom: T.dirt } },
  2:  { id: 2,  name: 'Dirt',       colour: '#7b5734', cost: {}, tiles: { all: T.dirt } },
  3:  { id: 3,  name: 'Stone',      colour: '#8b8f99', cost: {}, tiles: { all: T.stone } },
  4:  { id: 4,  name: 'Sand',       colour: '#dbc88c', cost: {}, tiles: { all: T.sand } },
  5:  { id: 5,  name: 'Log',        colour: '#6b4a2c', cost: { wood: 1 },
        tiles: { top: T.logTop, side: T.logSide, bottom: T.logTop } },
  6:  { id: 6,  name: 'Leaves',     colour: '#3f8f3d', cost: { wood: 1 },
        tiles: { all: T.leaves }, transparent: true, cutout: true },
  7:  { id: 7,  name: 'Glass',      colour: '#cfe9f2', cost: { scrap: 1 },
        tiles: { all: T.glass }, transparent: true, cutout: true },
  8:  { id: 8,  name: 'Lamp',       colour: '#ffd691', cost: { fuel: 1 },
        tiles: { all: T.lamp }, emissive: true, light: 1 },
  9:  { id: 9,  name: 'Crystal',    colour: '#38e1ff', cost: { crystal: 1 },
        tiles: { all: T.crystal }, emissive: true, light: 1 },
  10: { id: 10, name: 'Metal',      colour: '#b9c2d4', cost: { iron: 1 }, tiles: { all: T.metal } },
  11: { id: 11, name: 'Emitter',    colour: '#7ef0ff', cost: { laserbeam: 1, battery: 1, iron: 2 },
        tiles: { all: T.emitter }, emissive: true, light: 1, device: 'laser' },
  12: { id: 12, name: 'Dark Stone', colour: '#3c4256', cost: {}, tiles: { all: T.darkStone } },
  13: { id: 13, name: 'Bedrock',    colour: '#24262e', cost: {}, tiles: { all: T.bedrock }, unbreakable: true },
  14: { id: 14, name: 'Planks',     colour: '#9b6b3d', cost: { wood: 1 }, tiles: { all: T.planks } },
};

/** The order blocks appear in the hotbar, keys 1-9 then 0. */
export const HOTBAR = [1, 3, 14, 7, 8, 10, 9, 11, 12, 4];

export const isOpaque = (id) => id !== AIR && !BLOCKS[id]?.transparent;
export const isEmissive = (id) => !!BLOCKS[id]?.emissive;
export const isCutout = (id) => !!BLOCKS[id]?.cutout;

/** Atlas slot for one face of a block. `dy` is the face's Y direction. */
export function tileFor(id, dy) {
  const t = BLOCKS[id]?.tiles;
  if (!t) return 0;
  if (t.all !== undefined) return t.all;
  if (dy === 1) return t.top;
  if (dy === -1) return t.bottom;
  return t.side;
}

export function costOf(id) { return BLOCKS[id]?.cost || {}; }
export function hasCost(id) { return Object.keys(costOf(id)).length > 0; }

/** '#rrggbb' -> [r,g,b] in 0..1 */
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
