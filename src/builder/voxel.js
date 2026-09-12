// Voxel storage, terrain generation, chunk meshing and the block raycast.
//
// The world is a fixed island rather than an endless one: it keeps saves small
// enough for local storage and means a world you share is the whole world,
// not a seed someone else's machine has to agree about.

import * as THREE from 'three';
import { AIR, BLOCKS, isOpaque, tileFor, rgb } from './blocks.js';
import { tileUv } from './textures.js';
import { mulberry32 } from '../utils.js';

export const SX = 64, SY = 48, SZ = 64;
export const CHUNK = 16;
export const CHUNKS_X = SX / CHUNK, CHUNKS_Z = SZ / CHUNK;
export const SEA_LEVEL = 14;

export const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ;
const index = (x, y, z) => (y * SZ + z) * SX + x;

// face order: +x, -x, +y, -y, +z, -z
const SIDE_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];
const FLAT_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

const FACES = [
  { dir: [1, 0, 0],  shade: 0.82, corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], uv: SIDE_UV },
  { dir: [-1, 0, 0], shade: 0.72, corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], uv: SIDE_UV },
  { dir: [0, 1, 0],  shade: 1.00, corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], uv: FLAT_UV },
  { dir: [0, -1, 0], shade: 0.55, corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], uv: FLAT_UV },
  { dir: [0, 0, 1],  shade: 0.90, corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]], uv: SIDE_UV },
  { dir: [0, 0, -1], shade: 0.66, corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], uv: SIDE_UV },
];

export class VoxelWorld {
  constructor() {
    this.data = new Uint8Array(SX * SY * SZ);
    this.dirty = new Set();
  }

  get(x, y, z) { return inside(x, y, z) ? this.data[index(x, y, z)] : AIR; }

  set(x, y, z, id) {
    if (!inside(x, y, z)) return false;
    const i = index(x, y, z);
    if (this.data[i] === id) return false;
    this.data[i] = id;
    // the edited chunk, plus any neighbour whose faces this exposes or hides
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = Math.floor((x + dx) / CHUNK), cz = Math.floor((z + dz) / CHUNK);
        if (cx >= 0 && cz >= 0 && cx < CHUNKS_X && cz < CHUNKS_Z) this.dirty.add(`${cx},${cz}`);
      }
    }
    return true;
  }

  markAllDirty() {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      for (let cz = 0; cz < CHUNKS_Z; cz++) this.dirty.add(`${cx},${cz}`);
    }
  }

  /** Highest non-air cell at this column, or -1. */
  surfaceAt(x, z) {
    for (let y = SY - 1; y >= 0; y--) if (this.get(x, y, z) !== AIR) return y;
    return -1;
  }

  // ------------------------------------------------------------- terrain ---
  generate(seed) {
    const rng = mulberry32(seed >>> 0);
    const noise = valueNoise(rng);
    this.data.fill(AIR);

    // Heights first, as a continuous field, so they can be smoothed before
    // being rounded to whole blocks. Rounding the raw noise leaves the ground
    // covered in one-block bumps that read as litter rather than landscape.
    const raw = new Float32Array(SX * SZ);
    for (let x = 0; x < SX; x++) {
      for (let z = 0; z < SZ; z++) {
        const n = noise(x * 0.045, z * 0.045) * 0.7 + noise(x * 0.11, z * 0.11) * 0.3;
        // pull the edges down so it reads as an island, not a cut-off slab
        const ex = Math.min(x, SX - 1 - x) / (SX * 0.5);
        const ez = Math.min(z, SZ - 1 - z) / (SZ * 0.5);
        const edge = Math.min(1, Math.min(ex, ez) * 2.2);
        raw[z * SX + x] = SEA_LEVEL + n * 15 * edge - (1 - edge) * 8;
      }
    }
    const smoothed = boxBlur(boxBlur(raw, SX, SZ), SX, SZ);

    for (let x = 0; x < SX; x++) {
      for (let z = 0; z < SZ; z++) {
        const h = Math.max(1, Math.round(smoothed[z * SX + x]));

        for (let y = 0; y <= h && y < SY; y++) {
          let id = 3;                                   // stone
          if (y === h) id = h <= SEA_LEVEL + 1 ? 4 : 1; // sand at the shore, else grass
          else if (y > h - 4) id = 2;                   // dirt
          if (y === 0) id = 13;                         // bedrock floor
          this.data[index(x, y, z)] = id;
        }
      }
    }

    // A thin scatter of crystal, deliberately not enough to build with. The
    // supply you can actually rely on comes out of a survival run.
    const veins = 5 + Math.floor(rng() * 4);
    for (let v = 0; v < veins; v++) {
      const vx = 4 + Math.floor(rng() * (SX - 8));
      const vz = 4 + Math.floor(rng() * (SZ - 8));
      const vy = 2 + Math.floor(rng() * 8);
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const x = vx + Math.floor(rng() * 3) - 1;
        const y = vy + Math.floor(rng() * 3) - 1;
        const z = vz + Math.floor(rng() * 3) - 1;
        if (inside(x, y, z) && this.data[index(x, y, z)] === 3) this.data[index(x, y, z)] = 9;
      }
    }

    this.plantTrees(rng);
    this.markAllDirty();
  }

  plantTrees(rng) {
    const wanted = 26;
    for (let t = 0; t < wanted; t++) {
      const x = 3 + Math.floor(rng() * (SX - 6));
      const z = 3 + Math.floor(rng() * (SZ - 6));
      const y = this.surfaceAt(x, z);
      if (y < SEA_LEVEL + 1 || y > SY - 9) continue;
      if (this.get(x, y, z) !== 1) continue;            // grass only
      const h = 4 + Math.floor(rng() * 3);
      for (let i = 1; i <= h; i++) this.set0(x, y + i, z, 5);
      for (let dy = h - 1; dy <= h + 1; dy++) {
        const r = dy === h + 1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (dx === 0 && dz === 0 && dy <= h) continue;
            if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
            if (this.get(x + dx, y + dy, z + dz) === AIR) this.set0(x + dx, y + dy, z + dz, 6);
          }
        }
      }
    }
  }

  /** set without dirtying — only safe during generation */
  set0(x, y, z, id) { if (inside(x, y, z)) this.data[index(x, y, z)] = id; }

  // -------------------------------------------------------------- meshing ---
  /**
   * Build the two geometries for one chunk: everything that takes light, and
   * everything that gives it off. Only faces touching air are emitted, which
   * is what keeps a 200k-cell world drawable.
   */
  buildChunk(cx, cz) {
    const bucket = () => ({ pos: [], norm: [], col: [], uv: [], idx: [] });
    const lit = bucket();      // ordinary blocks, take the light
    const cutout = bucket();   // leaves and glass, alpha-tested
    const glow = bucket();     // emissive blocks, full bright
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    for (let x = x0; x < x0 + CHUNK; x++) {
      for (let z = z0; z < z0 + CHUNK; z++) {
        for (let y = 0; y < SY; y++) {
          const id = this.get(x, y, z);
          if (id === AIR) continue;
          const def = BLOCKS[id];
          if (!def) continue;
          const target = def.emissive ? glow : (def.cutout ? cutout : lit);

          for (const face of FACES) {
            const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
            const neighbour = this.get(nx, ny, nz);
            // a transparent block still hides the face of another of its own kind
            if (isOpaque(neighbour) || (neighbour === id && def.transparent)) continue;

            // The texture carries the detail now; the vertex colour only
            // shades by face direction, with a whisper of per-block variation
            // so large flat runs don't look stamped.
            const jitter = def.emissive ? 1 : 0.96 + hash3(x, y, z) * 0.08;
            const k = (def.emissive ? 1 : face.shade) * jitter;
            const uvw = tileUv(tileFor(id, face.dir[1]));
            const start = target.pos.length / 3;
            for (let i = 0; i < 4; i++) {
              const c = face.corners[i];
              target.pos.push(x + c[0], y + c[1], z + c[2]);
              target.norm.push(face.dir[0], face.dir[1], face.dir[2]);
              target.col.push(k, k, k);
              const [lu, lv] = face.uv[i];
              target.uv.push(uvw.u0 + (uvw.u1 - uvw.u0) * lu, uvw.v0 + (uvw.v1 - uvw.v0) * lv);
            }
            target.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          }
        }
      }
    }
    return { lit: toGeometry(lit), cutout: toGeometry(cutout), glow: toGeometry(glow) };
  }

  // -------------------------------------------------------------- raycast ---
  /**
   * Step a ray through the grid one cell boundary at a time (Amanatides &
   * Woo). Returns the block hit and the empty cell in front of it, which is
   * where a placed block goes.
   */
  raycast(origin, dir, maxDist = 7) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const step = [Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z)];
    const inv = [Math.abs(1 / dir.x), Math.abs(1 / dir.y), Math.abs(1 / dir.z)];
    const dist = (i, p, s) => (s > 0 ? Math.ceil(p) - p : p - Math.floor(p)) * inv[i];
    let tMax = [dist(0, origin.x, step[0]), dist(1, origin.y, step[1]), dist(2, origin.z, step[2])];
    let normal = [0, 0, 0];
    let travelled = 0;

    for (let guard = 0; guard < 256 && travelled <= maxDist; guard++) {
      if (inside(x, y, z) && this.get(x, y, z) !== AIR) {
        return {
          block: { x, y, z },
          place: { x: x + normal[0], y: y + normal[1], z: z + normal[2] },
          id: this.get(x, y, z),
          normal,
        };
      }
      const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      travelled = tMax[axis];
      if (axis === 0) { x += step[0]; normal = [-step[0], 0, 0]; }
      else if (axis === 1) { y += step[1]; normal = [0, -step[1], 0]; }
      else { z += step[2]; normal = [0, 0, -step[2]]; }
      tMax[axis] += inv[axis];
    }
    return null;
  }

  // ----------------------------------------------------------- save/load ---
  /** Run-length encode the cells. A generated world packs to a few kB. */
  encode() {
    const runs = [];
    let cur = this.data[0], len = 1;
    for (let i = 1; i < this.data.length; i++) {
      if (this.data[i] === cur && len < 65535) { len++; continue; }
      runs.push(cur, len);
      cur = this.data[i]; len = 1;
    }
    runs.push(cur, len);
    return runs.join(',');
  }

  decode(str) {
    const runs = str.split(',');
    let i = 0;
    for (let r = 0; r < runs.length; r += 2) {
      const id = +runs[r], len = +runs[r + 1];
      for (let n = 0; n < len && i < this.data.length; n++) this.data[i++] = id;
    }
    this.markAllDirty();
  }
}

/** 3x3 average over a height field. Two passes turn noise into hills. */
function boxBlur(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += src[ny * w + nx]; n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

/** Cheap deterministic hash of a cell position, 0..1. */
function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function toGeometry(b) {
  const g = new THREE.BufferGeometry();
  if (!b.pos.length) return g;
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setIndex(b.idx);
  return g;
}

/** Smooth 2D value noise on a seeded lattice. */
function valueNoise(rng) {
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const at = (x, y) => table[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
  };
}
