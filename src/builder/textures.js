// A texture atlas, painted at runtime.
//
// The look is the classic 16-pixel blocky one: small tiles, nearest-neighbour
// filtering, per-pixel noise rather than smooth gradients. Every tile here is
// drawn from scratch by these functions — no asset files, nothing copied — so
// the game stays a single self-contained page.

export const TILE_PX = 16;
export const ATLAS_TILES = 8;              // 8x8 grid of tiles
export const ATLAS_PX = TILE_PX * ATLAS_TILES;

// tile slots in the atlas, by name
export const T = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, sand: 4,
  logSide: 5, logTop: 6, leaves: 7, glass: 8, lamp: 9,
  crystal: 10, metal: 11, emitter: 12, darkStone: 13, bedrock: 14, planks: 15,
};

/** Deterministic per-pixel noise so a rebuild looks identical. */
function rand(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  return [
    clamp255(((n >> 16) & 255) + amount),
    clamp255(((n >> 8) & 255) + amount),
    clamp255((n & 255) + amount),
  ];
}

/**
 * Paint one tile. `fn(x, y)` returns [r,g,b] or [r,g,b,a]; returning null
 * leaves the pixel fully transparent.
 */
function paint(img, slot, fn) {
  const tx = (slot % ATLAS_TILES) * TILE_PX;
  const ty = Math.floor(slot / ATLAS_TILES) * TILE_PX;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const px = ((ty + y) * ATLAS_PX + (tx + x)) * 4;
      const c = fn(x, y);
      if (!c) { img.data[px + 3] = 0; continue; }
      img.data[px] = c[0];
      img.data[px + 1] = c[1];
      img.data[px + 2] = c[2];
      img.data[px + 3] = c.length > 3 ? c[3] : 255;
    }
  }
}

/** Speckled base colour — the workhorse for earth and rock. */
const speckle = (hex, spread, salt) => (x, y) => {
  const n = rand(x, y, salt);
  return shade(hex, Math.round((n - 0.5) * spread));
};

export function buildAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(ATLAS_PX, ATLAS_PX);

  paint(img, T.grassTop, speckle('#5fa83f', 46, 1));
  paint(img, T.dirt, speckle('#7b5734', 40, 2));
  paint(img, T.stone, (x, y) => {
    const n = rand(x, y, 3);
    const blob = rand(Math.floor(x / 4), Math.floor(y / 4), 31) > 0.72 ? -16 : 0;
    return shade('#8b8f99', Math.round((n - 0.5) * 34) + blob);
  });
  paint(img, T.sand, speckle('#dbc88c', 30, 4));
  paint(img, T.darkStone, speckle('#3c4256', 26, 5));
  paint(img, T.bedrock, (x, y) => {
    const n = rand(Math.floor(x / 2), Math.floor(y / 2), 6);
    return shade('#24262e', Math.round((n - 0.5) * 54));
  });

  // grass side: a ragged fringe of green over dirt
  paint(img, T.grassSide, (x, y) => {
    const depth = 2 + Math.floor(rand(x, 0, 7) * 3);
    if (y < depth) return shade('#5fa83f', Math.round((rand(x, y, 8) - 0.5) * 40));
    return shade('#7b5734', Math.round((rand(x, y, 2) - 0.5) * 40));
  });

  // bark: vertical streaks
  paint(img, T.logSide, (x, y) => {
    const streak = rand(x, 0, 9) > 0.62 ? -20 : 0;
    return shade('#6b4a2c', Math.round((rand(x, y, 10) - 0.5) * 22) + streak);
  });
  // end grain: rings out from the middle
  paint(img, T.logTop, (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const ring = Math.sin(d * 1.9) > 0.25 ? 14 : -10;
    return shade('#9b7448', ring + Math.round((rand(x, y, 11) - 0.5) * 16));
  });

  // leaves: dense, clustered, with a few gaps punched through
  paint(img, T.leaves, (x, y) => {
    if (rand(x, y, 12) > 0.93) return null;
    const cluster = rand(Math.floor(x / 3), Math.floor(y / 3), 13) > 0.55 ? 18 : -14;
    return shade('#3f8f3d', cluster + Math.round((rand(x, y, 14) - 0.5) * 26));
  });

  // glass: a pane with a frame and one highlight
  paint(img, T.glass, (x, y) => {
    const edge = x === 0 || y === 0 || x === TILE_PX - 1 || y === TILE_PX - 1;
    if (edge) return shade('#cfe9f2', 0);
    if (x === 1 && y > 1 && y < 6) return shade('#eaf7fb', 0);
    if (y === 1 && x > 1 && x < 6) return shade('#eaf7fb', 0);
    return null;                                   // see straight through
  });

  paint(img, T.lamp, (x, y) => {
    const grid = (x % 5 === 0 || y % 5 === 0) ? -34 : 0;
    const glow = 18 - Math.hypot(x - 7.5, y - 7.5) * 2;
    return shade('#ffd691', grid + Math.round(glow));
  });

  paint(img, T.crystal, (x, y) => {
    const facet = ((x + y) % 6 < 3) ? 22 : -18;
    return shade('#38e1ff', facet + Math.round((rand(x, y, 15) - 0.5) * 20));
  });

  paint(img, T.metal, (x, y) => {
    const rivet = ((x - 3) % 8 === 0 && (y - 3) % 8 === 0) ? 34 : 0;
    const band = y % 8 === 0 ? -18 : 0;
    return shade('#b9c2d4', rivet + band + Math.round((rand(x, y, 16) - 0.5) * 14));
  });

  // emitter: a dark housing with a bright lens
  paint(img, T.emitter, (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 3) return shade('#d8fbff', Math.round((rand(x, y, 17) - 0.5) * 20));
    if (d < 4.6) return shade('#7ef0ff', -10);
    const plate = (x % 7 === 0 || y % 7 === 0) ? -16 : 0;
    return shade('#2b3348', plate + Math.round((rand(x, y, 18) - 0.5) * 16));
  });

  paint(img, T.planks, (x, y) => {
    const seam = (y % 5 === 0) ? -26 : 0;
    const join = ((y % 10 < 5 ? x : x + 7) % 14 === 0) ? -20 : 0;
    return shade('#9b6b3d', seam + join + Math.round((rand(x, y, 19) - 0.5) * 16));
  });

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * UV window for a tile, inset by half a texel so neighbouring tiles can't
 * bleed in at the edges once the texture is minified.
 */
export function tileUv(slot) {
  const inset = 0.5 / ATLAS_PX;
  const col = slot % ATLAS_TILES;
  const row = Math.floor(slot / ATLAS_TILES);
  const u0 = col / ATLAS_TILES + inset;
  const u1 = (col + 1) / ATLAS_TILES - inset;
  // canvas row 0 is the top, which is v = 1 once the texture is flipped
  const v1 = 1 - row / ATLAS_TILES - inset;
  const v0 = 1 - (row + 1) / ATLAS_TILES + inset;
  return { u0, u1, v0, v1 };
}
