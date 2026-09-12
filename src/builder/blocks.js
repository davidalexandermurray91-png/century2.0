// The block palette for world mode.
//
// `cost` is only charged when a world is running under survival rules. An
// owner in creative mode pays nothing — that is most of what admin power is.

export const AIR = 0;

export const BLOCKS = {
  1:  { id: 1,  name: 'Grass',      colour: '#5ea84e', top: '#74c85e', cost: {} },
  2:  { id: 2,  name: 'Dirt',       colour: '#7a5636', cost: {} },
  3:  { id: 3,  name: 'Stone',      colour: '#8d93a1', cost: {} },
  4:  { id: 4,  name: 'Sand',       colour: '#ddc98d', cost: {} },
  5:  { id: 5,  name: 'Wood',       colour: '#9b6b3d', cost: { wood: 1 } },
  6:  { id: 6,  name: 'Leaves',     colour: '#3f8f47', cost: { wood: 1 }, transparent: true },
  7:  { id: 7,  name: 'Glass',      colour: '#9fd8e8', cost: { scrap: 1 }, transparent: true, opacity: 0.42 },
  8:  { id: 8,  name: 'Lamp',       colour: '#ffd691', cost: { fuel: 1 }, emissive: true, light: 1 },
  9:  { id: 9,  name: 'Crystal',    colour: '#38e1ff', cost: { crystal: 1 }, emissive: true, light: 1 },
  10: { id: 10, name: 'Metal',      colour: '#b9c2d4', cost: { iron: 1 } },
  11: { id: 11, name: 'Emitter',    colour: '#7ef0ff', cost: { laserbeam: 1, battery: 1, iron: 2 }, emissive: true, light: 1, device: 'laser' },
  12: { id: 12, name: 'Dark Stone', colour: '#3a4055', cost: {} },
  13: { id: 13, name: 'Bedrock',    colour: '#22252e', cost: {}, unbreakable: true },
};

/** The order blocks appear in the hotbar, keys 1-9 then 0. */
export const HOTBAR = [1, 3, 5, 7, 8, 10, 9, 11, 12, 4];

export const isSolid = (id) => id !== AIR && !BLOCKS[id]?.transparent;
export const isOpaque = (id) => id !== AIR && !BLOCKS[id]?.transparent;
export const blocks = (id) => id !== AIR;          // stops you walking through it
export const isEmissive = (id) => !!BLOCKS[id]?.emissive;

export function costOf(id) { return BLOCKS[id]?.cost || {}; }
export function hasCost(id) { return Object.keys(costOf(id)).length > 0; }

/** '#rrggbb' -> [r,g,b] in 0..1 */
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
