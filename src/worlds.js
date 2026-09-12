// World records: the list, the saves, and who owns what.
//
// There is no server behind this. A world lives in this browser, and "owning"
// it means your profile's id is stamped on it. Ownership still does real work:
// it decides who gets the admin panel, and an imported world someone else made
// stays read-only unless they left building open.

const KEY = 'century.worlds.v1';

export function listWorlds() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function persist(worlds) {
  try { localStorage.setItem(KEY, JSON.stringify(worlds)); return true; } catch { return false; }
}

export function newWorldId() {
  return `w_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createWorld({ name, seed, ownerId }) {
  const worlds = listWorlds();
  const world = {
    id: newWorldId(),
    name: name?.trim() || 'Untitled World',
    seed: seed >>> 0,
    ownerId,
    created: Date.now(),
    updated: Date.now(),
    // world settings the owner can change from the admin panel
    settings: {
      creative: true,        // free blocks, flight, nothing can hurt you
      monsters: false,       // let them in at night
      allowGuestBuilding: false,
      timeOfDay: 0.3,        // 0..1, 0.25 is mid-morning
      frozenTime: false,
    },
    voxels: null,            // filled on first save
    spawn: null,
  };
  worlds.push(world);
  persist(worlds);
  return world;
}

export function getWorld(id) {
  return listWorlds().find((w) => w.id === id) || null;
}

export function saveWorld(world) {
  const worlds = listWorlds();
  const i = worlds.findIndex((w) => w.id === world.id);
  world.updated = Date.now();
  if (i === -1) worlds.push(world); else worlds[i] = world;
  if (!persist(worlds)) return { ok: false, reason: 'Browser storage is full or blocked.' };
  return { ok: true };
}

export function deleteWorld(id) {
  persist(listWorlds().filter((w) => w.id !== id));
}

export const isOwner = (world, profile) => !!world && world.ownerId === profile.ownerId;

/** Can this person change blocks here at all? */
export function canBuild(world, profile) {
  return isOwner(world, profile) || !!world.settings?.allowGuestBuilding;
}

// ------------------------------------------------------------ share codes ---

export function exportWorld(world) {
  return JSON.stringify({ format: 'century-world-1', world });
}

/**
 * Bring in a world someone else exported. It keeps their owner id, so it lands
 * read-only for you — that is the point of the stamp.
 */
export function importWorld(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: "That doesn't look like world data." }; }
  const w = parsed?.world;
  if (parsed?.format !== 'century-world-1' || !w?.id) {
    return { ok: false, reason: 'Unrecognised world file.' };
  }
  const worlds = listWorlds();
  // never clobber a world you already have
  if (worlds.some((x) => x.id === w.id)) w.id = newWorldId();
  w.name = `${w.name} (imported)`;
  w.imported = true;
  worlds.push(w);
  if (!persist(worlds)) return { ok: false, reason: 'Browser storage is full.' };
  return { ok: true, world: w };
}
