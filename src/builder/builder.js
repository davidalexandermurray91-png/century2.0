// World mode: a 3D voxel world you own.
//
// The survival game is where you earn things; this is where you keep them. An
// owner gets the admin panel and, by default, creative rules — free blocks,
// flight, nothing that can hurt them. Flipping a world to survival rules turns
// the costs and the monsters back on, for people who want the walls they build
// to mean something.

import * as THREE from 'three';
import { VoxelWorld, SX, SY, SZ, CHUNK, CHUNKS_X, CHUNKS_Z, inside } from './voxel.js';
import { AIR, BLOCKS, HOTBAR, costOf, hasCost, tileFor } from './blocks.js';
import { buildAtlasCanvas, TILE_PX, ATLAS_TILES } from './textures.js';
import { saveWorld, isOwner, canBuild } from '../worlds.js';
import { canAfford, spend, refund, saveProfile } from '../profile.js';
import { sfx } from '../audio.js';

const EYE = 1.62;
const WIDTH = 0.6;
const HEIGHT = 1.8;
const GRAVITY = 26;
const WALK = 5.2, SPRINT = 8.4, FLY = 12;
const JUMP = 8.4;
const REACH = 7;

const MONSTER_KINDS = {
  ghost:   { hp: 60,  speed: 2.6, colour: 0xb07bff, floats: true,  damage: 8,  scale: 0.9 },
  vampire: { hp: 90,  speed: 4.0, colour: 0xff4d6d, floats: false, damage: 11, scale: 0.95 },
  zombie:  { hp: 220, speed: 1.9, colour: 0x5ef2a0, floats: false, damage: 18, scale: 1.6 },
};

export class Builder {
  constructor({ mount, world, profile, onExit }) {
    this.mount = mount;
    this.world = world;
    this.profile = profile;
    this.onExit = onExit;
    this.owner = isOwner(world, profile);
    this.mayBuild = canBuild(world, profile);

    this.voxels = new VoxelWorld();
    if (world.voxels) this.voxels.decode(world.voxels);
    else this.voxels.generate(world.seed);

    this.chunkMeshes = new Map();
    this.emitters = [];
    this.monsters = [];
    this.beams = [];
    this.hotbarIndex = 0;
    this.keys = new Set();
    this.running = false;
    this.paused = false;
    this.flying = this.settings.creative;
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.hp = 100;
    this.hurtCooldown = 0;
    this.toastTimer = 0;
    this.disposers = [];

    this.buildScene();
    this.buildDom();
    this.placePlayer();
    this.scanEmitters();
  }

  get settings() { return this.world.settings; }
  get creative() { return this.owner && this.settings.creative; }

  // ----------------------------------------------------------------- setup ---
  buildScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fc6e8, 40, 150);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.2, 220);
    this.yaw = 0; this.pitch = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.domElement.className = 'b3d-canvas';
    this.mount.appendChild(this.renderer.domElement);

    // Deliberately flat lighting. Each face already carries a baked shade in
    // its vertex colour, so a strong directional sun only makes half the world
    // unreadable; the ambient sky light does the work and the sun is a hint.
    this.sun = new THREE.DirectionalLight(0xffffff, 0.4);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x53482f, 1.1);
    this.scene.add(this.hemi);

    // One atlas, painted once, sampled with nearest-neighbour so the pixels
    // stay square however close you get.
    this.atlasCanvas = buildAtlasCanvas();
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestMipmapNearestFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.colorSpace = THREE.SRGBColorSpace;

    this.litMaterial = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true });
    // leaves and glass punch holes rather than blend, which keeps them out of
    // the transparency sort entirely
    this.cutoutMaterial = new THREE.MeshLambertMaterial({
      map: this.atlas, vertexColors: true, alphaTest: 0.5,
    });
    this.glowMaterial = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true });

    // the block you're pointing at
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x05070f, transparent: true, opacity: 0.85 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.monsterGroup = new THREE.Group();
    this.scene.add(this.monsterGroup);
    this.beamGroup = new THREE.Group();
    this.scene.add(this.beamGroup);
  }

  placePlayer() {
    const s = this.world.spawn;
    if (s) { this.pos = new THREE.Vector3(s.x, s.y, s.z); this.yaw = s.yaw || 0; return; }
    // spiral out from the middle for open ground — landing inside a tree
    // makes a fresh world look broken when it isn't
    const mid = { x: SX >> 1, z: SZ >> 1 };
    let best = null;
    for (let r = 0; r < 18 && !best; r++) {
      for (let dx = -r; dx <= r && !best; dx++) {
        for (let dz = -r; dz <= r && !best; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = mid.x + dx, z = mid.z + dz;
          if (x < 1 || z < 1 || x >= SX - 1 || z >= SZ - 1) continue;
          const y = this.voxels.surfaceAt(x, z);
          const ground = this.voxels.get(x, y, z);
          if (y < 2 || (ground !== 1 && ground !== 4)) continue;   // grass or sand
          let clear = true;
          for (let h = 1; h <= 4; h++) if (this.voxels.get(x, y + h, z) !== AIR) clear = false;
          if (clear) best = { x, y, z };
        }
      }
    }
    const spot = best || { x: mid.x, y: this.voxels.surfaceAt(mid.x, mid.z), z: mid.z };
    this.pos = new THREE.Vector3(spot.x + 0.5, spot.y + 1.1, spot.z + 0.5);
    this.pitch = -0.18;   // a shade downward, so you land looking at the ground
  }

  // ------------------------------------------------------------------- dom ---
  buildDom() {
    const el = document.createElement('div');
    el.className = 'b3d-ui';
    el.innerHTML = `
      <div class="b3d-crosshair"></div>
      <div class="b3d-top">
        <span class="b3d-worldname"></span>
        <span class="b3d-badge"></span>
        <span class="b3d-clock"></span>
      </div>
      <div class="b3d-vitals" hidden>
        <span class="b3d-vlabel">HEALTH</span>
        <span class="b3d-hpbar"><i></i></span>
      </div>
      <div class="b3d-toast" hidden></div>
      <div class="b3d-hotbar"></div>
      <div class="b3d-hint">
        <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>F</kbd> fly ·
        <b>click</b> break · <b>right-click</b> place · <kbd>1</kbd>–<kbd>0</kbd> block ·
        <kbd>Esc</kbd> menu
      </div>
      <div class="b3d-pause" hidden>
        <div class="b3d-panel">
          <h2>Paused</h2>
          <div class="b3d-row"><button data-act="resume">Resume</button></div>
          <div class="b3d-admin"></div>
          <div class="b3d-row">
            <button data-act="save">Save</button>
            <button data-act="exit" class="ghost">Save &amp; leave</button>
          </div>
          <p class="b3d-note"></p>
        </div>
      </div>`;
    this.mount.appendChild(el);
    this.ui = el;
    this.$ = (sel) => el.querySelector(sel);

    this.$('.b3d-worldname').textContent = this.world.name;
    this.renderBadge();
    this.renderHotbar();
    this.renderAdmin();

    el.querySelector('.b3d-pause').addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act');
      if (act === 'resume') this.setPaused(false);
      if (act === 'save') this.save(true);
      if (act === 'exit') { this.save(false); this.quit(); }
    });
  }

  renderBadge() {
    const b = this.$('.b3d-badge');
    if (!this.owner) { b.textContent = this.mayBuild ? 'VISITOR · building allowed' : 'VISITOR · read only'; b.dataset.kind = 'guest'; }
    else { b.textContent = this.creative ? 'ADMIN · creative' : 'ADMIN · survival rules'; b.dataset.kind = this.creative ? 'creative' : 'survival'; }
    this.$('.b3d-vitals').hidden = this.creative || !this.settings.monsters;
  }

  renderHotbar() {
    const bar = this.$('.b3d-hotbar');
    bar.innerHTML = '';
    HOTBAR.forEach((id, i) => {
      const def = BLOCKS[id];
      const slot = document.createElement('button');
      slot.className = 'b3d-slot' + (i === this.hotbarIndex ? ' on' : '');
      const affordable = this.creative || canAfford(this.profile, costOf(id));
      slot.innerHTML = `
        <span class="b3d-swatch" style="background-image:url(${this.blockIcon(id)});background-color:${def.colour}"></span>
        <span class="b3d-sname">${def.name}</span>
        <span class="b3d-scost">${this.creative || !hasCost(id) ? 'free' : costLabel(id)}</span>`;
      slot.dataset.key = String((i + 1) % 10);
      if (!affordable) slot.classList.add('poor');
      slot.addEventListener('click', () => { this.hotbarIndex = i; this.renderHotbar(); });
      bar.appendChild(slot);
    });
  }

  /** A scaled-up crop of the atlas, for the hotbar. Cached per block. */
  blockIcon(id) {
    this.iconCache = this.iconCache || new Map();
    if (this.iconCache.has(id)) return this.iconCache.get(id);
    const size = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const slot = tileFor(id, 0);                       // the side face reads best
    const sx = (slot % ATLAS_TILES) * TILE_PX;
    const sy = Math.floor(slot / ATLAS_TILES) * TILE_PX;
    g.drawImage(this.atlasCanvas, sx, sy, TILE_PX, TILE_PX, 0, 0, size, size);
    const url = c.toDataURL();
    this.iconCache.set(id, url);
    return url;
  }

  renderAdmin() {
    const host = this.$('.b3d-admin');
    if (!this.owner) {
      host.innerHTML = `<p class="b3d-note">This world belongs to someone else, so the admin controls are theirs.
        ${this.mayBuild ? 'They have left building open to visitors.' : 'It is read-only for you.'}</p>`;
      return;
    }
    host.innerHTML = `
      <h3>Admin</h3>
      <label class="b3d-check"><input type="checkbox" data-set="creative"> Creative rules <small>free blocks, flight, no damage</small></label>
      <label class="b3d-check"><input type="checkbox" data-set="monsters"> Monsters at night</label>
      <label class="b3d-check"><input type="checkbox" data-set="allowGuestBuilding"> Visitors may build</label>
      <label class="b3d-check"><input type="checkbox" data-set="frozenTime"> Freeze the clock</label>
      <label class="b3d-slider">Time of day <input type="range" min="0" max="1000" data-set="timeOfDay"></label>
      <div class="b3d-row">
        <button data-spawn="ghost">Spawn ghost</button>
        <button data-spawn="vampire">Spawn vampire</button>
        <button data-spawn="zombie">Spawn zombie</button>
        <button data-act2="clear" class="ghost">Clear monsters</button>
      </div>`;

    for (const input of host.querySelectorAll('[data-set]')) {
      const key = input.dataset.set;
      if (input.type === 'checkbox') input.checked = !!this.settings[key];
      else input.value = String(Math.round((this.settings[key] ?? 0) * 1000));
      input.addEventListener('input', () => {
        this.settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value) / 1000;
        if (key === 'creative') { this.flying = this.settings.creative && this.flying; this.renderHotbar(); }
        this.renderBadge();
        this.save(false);
      });
    }
    host.querySelectorAll('[data-spawn]').forEach((b) => {
      b.addEventListener('click', () => { this.spawnMonster(b.dataset.spawn); this.toast(`Spawned a ${b.dataset.spawn}`); });
    });
    host.querySelector('[data-act2="clear"]')?.addEventListener('click', () => {
      this.clearMonsters(); this.toast('Monsters cleared');
    });
  }

  // ----------------------------------------------------------------- input ---
  bindInput() {
    const canvas = this.renderer.domElement;

    const onKeyDown = (e) => {
      if (e.code === 'Escape') { this.setPaused(!this.paused); return; }
      if (this.paused) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' && this.creative) { this.flying = !this.flying; this.toast(this.flying ? 'Flying' : 'Walking'); }
      if (/^Digit[0-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        this.hotbarIndex = (n === 0 ? 10 : n) - 1;
        this.renderHotbar();
      }
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();

    // Pointer lock where the host allows it, drag-to-look where it doesn't —
    // an artifact runs in a sandboxed frame that may refuse the lock.
    const onMouseMove = (e) => {
      if (this.paused) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !this.dragging) return;
      this.look(e.movementX || 0, e.movementY || 0);
    };
    const onDown = (e) => {
      if (this.paused) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        this.dragging = true;
        this.dragButton = e.button;
        return;
      }
      if (e.button === 0) this.breakBlock();
      if (e.button === 2) this.placeBlock();
    };
    const onUp = () => { this.dragging = false; };
    const onContext = (e) => e.preventDefault();
    const onResize = () => this.resize();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('resize', onResize);

    // when the lock is held, clicks come through without a preceding drag
    const onClickLocked = (e) => {
      if (this.paused || document.pointerLockElement !== canvas) return;
      if (e.button === 0) this.breakBlock();
    };
    canvas.addEventListener('click', onClickLocked);

    this.disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClickLocked);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    });
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0024;
    this.pitch -= dy * 0.0024;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  setPaused(v) {
    this.paused = v;
    this.$('.b3d-pause').hidden = !v;
    if (v && document.pointerLockElement) document.exitPointerLock?.();
    if (v) this.keys.clear();
  }

  // ----------------------------------------------------------------- blocks ---
  targeted() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
    return this.voxels.raycast(eye, dir, REACH);
  }

  breakBlock() {
    if (!this.mayBuild) { this.toast('This world is read-only for you'); return; }
    const hit = this.targeted();
    if (!hit) return;
    const def = BLOCKS[hit.id];
    if (def?.unbreakable) { this.toast('Bedrock will not budge'); return; }
    this.voxels.set(hit.block.x, hit.block.y, hit.block.z, AIR);
    // survival rules hand the material back; creative never charged you
    if (!this.creative && hasCost(hit.id)) refund(this.profile, costOf(hit.id), 1);
    this.afterEdit();
    sfx.build();
  }

  placeBlock() {
    if (!this.mayBuild) { this.toast('This world is read-only for you'); return; }
    const hit = this.targeted();
    if (!hit) return;
    const p = hit.place;
    if (!inside(p.x, p.y, p.z) || this.voxels.get(p.x, p.y, p.z) !== AIR) return;
    if (this.overlapsPlayer(p)) return;

    const id = HOTBAR[this.hotbarIndex];
    if (!this.creative && hasCost(id)) {
      if (!spend(this.profile, costOf(id))) {
        this.toast(`Not enough materials — ${costLabel(id)}`);
        sfx.deny();
        return;
      }
    }
    this.voxels.set(p.x, p.y, p.z, id);
    this.afterEdit();
    sfx.build();
  }

  overlapsPlayer(c) {
    const half = WIDTH / 2;
    return c.x + 1 > this.pos.x - half && c.x < this.pos.x + half
      && c.z + 1 > this.pos.z - half && c.z < this.pos.z + half
      && c.y + 1 > this.pos.y && c.y < this.pos.y + HEIGHT;
  }

  afterEdit() {
    this.scanEmitters();
    this.renderHotbar();
    this.dirtySince = performance.now();
  }

  scanEmitters() {
    this.emitters = [];
    for (let x = 0; x < SX; x++) {
      for (let y = 0; y < SY; y++) {
        for (let z = 0; z < SZ; z++) {
          if (BLOCKS[this.voxels.get(x, y, z)]?.device === 'laser') {
            this.emitters.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, cooldown: Math.random() });
          }
        }
      }
    }
  }

  // --------------------------------------------------------------- monsters ---
  spawnMonster(kind, at = null) {
    const def = MONSTER_KINDS[kind];
    if (!def) return;
    let x, y, z;
    if (at) { ({ x, y, z } = at); }
    else {
      // somewhere on the surface, but not on top of you
      for (let tries = 0; tries < 30; tries++) {
        x = 2 + Math.random() * (SX - 4);
        z = 2 + Math.random() * (SZ - 4);
        y = this.voxels.surfaceAt(Math.floor(x), Math.floor(z)) + 1.2;
        if (Math.hypot(x - this.pos.x, z - this.pos.z) > 12) break;
      }
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8 * def.scale, 1.6 * def.scale, 0.8 * def.scale),
      new THREE.MeshLambertMaterial({
        color: def.colour,
        transparent: kind === 'ghost',
        opacity: kind === 'ghost' ? 0.72 : 1,
      }),
    );
    mesh.position.set(x, y, z);
    this.monsterGroup.add(mesh);
    this.monsters.push({ kind, def, mesh, hp: def.hp, vy: 0, attackCd: 0 });
  }

  clearMonsters() {
    for (const m of this.monsters) {
      this.monsterGroup.remove(m.mesh);
      m.mesh.geometry.dispose();
      m.mesh.material.dispose();
    }
    this.monsters.length = 0;
  }

  updateMonsters(dt) {
    const night = this.isNight();
    if (this.settings.monsters && night && this.monsters.length < 12) {
      this.spawnAccum = (this.spawnAccum || 0) + dt;
      if (this.spawnAccum > 4) {
        this.spawnAccum = 0;
        this.spawnMonster(['ghost', 'vampire', 'zombie'][Math.floor(Math.random() * 3)]);
      }
    }

    for (const m of this.monsters) {
      const p = m.mesh.position;
      const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
      const dist = Math.hypot(dx, dz) || 1;
      const step = m.def.speed * dt;
      const nx = p.x + (dx / dist) * step;
      const nz = p.z + (dz / dist) * step;

      if (m.def.floats) {
        p.x = nx; p.z = nz;
        const want = this.pos.y + 0.4 + Math.sin(performance.now() / 600 + p.x) * 0.3;
        p.y += (want - p.y) * Math.min(1, dt * 1.6);
      } else {
        if (!this.solidAt(nx, p.y, p.z)) p.x = nx;
        else if (!this.solidAt(nx, p.y + 1, p.z)) { p.x = nx; p.y += 1; }
        if (!this.solidAt(p.x, p.y, nz)) p.z = nz;
        else if (!this.solidAt(p.x, p.y + 1, nz)) { p.z = nz; p.y += 1; }
        m.vy -= GRAVITY * dt * 0.5;
        const ny = p.y + m.vy * dt;
        if (this.solidAt(p.x, ny - 0.1, p.z)) { m.vy = 0; p.y = Math.floor(ny) + 1; }
        else p.y = ny;
      }
      m.mesh.rotation.y = Math.atan2(dx, dz);

      // touch damage, only where the rules allow it
      m.attackCd = Math.max(0, m.attackCd - dt);
      if (!this.creative && dist < 1.2 && Math.abs(p.y - this.pos.y) < 2 && m.attackCd <= 0) {
        m.attackCd = 1;
        this.damage(m.def.damage);
      }
    }
  }

  updateEmitters(dt) {
    for (const e of this.emitters) {
      e.cooldown -= dt;
      if (e.cooldown > 0) continue;
      let best = null, bestD = 14;
      for (const m of this.monsters) {
        const d = m.mesh.position.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
        if (d < bestD) { bestD = d; best = m; }
      }
      if (!best) continue;
      e.cooldown = 1.1;
      best.hp -= 55;
      this.addBeam(new THREE.Vector3(e.x, e.y, e.z), best.mesh.position.clone());
      sfx.laser();
      if (best.hp <= 0) this.killMonster(best);
    }
    for (const b of this.beams) b.life -= dt;
    for (const b of this.beams.filter((x) => x.life <= 0)) {
      this.beamGroup.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
    }
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  addBeam(from, to) {
    this.__beamCount = (this.__beamCount || 0) + 1;
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7ef0ff }));
    this.beamGroup.add(mesh);
    this.beams.push({ mesh, life: 0.16 });
  }

  killMonster(m) {
    this.monsterGroup.remove(m.mesh);
    m.mesh.geometry.dispose(); m.mesh.material.dispose();
    this.monsters = this.monsters.filter((x) => x !== m);
    sfx.kill();
  }

  damage(n) {
    if (this.creative || this.hurtCooldown > 0) return;
    this.hurtCooldown = 0.6;
    this.hp = Math.max(0, this.hp - n);
    this.$('.b3d-hpbar').firstElementChild.style.width = `${this.hp}%`;
    sfx.hurt();
    if (this.hp <= 0) {
      this.hp = 100;
      this.$('.b3d-hpbar').firstElementChild.style.width = '100%';
      this.placePlayer();
      this.vel.set(0, 0, 0);
      this.toast('You went down. Back at spawn.');
    }
  }

  // --------------------------------------------------------------- physics ---
  solidAt(x, y, z) {
    const half = WIDTH / 2;
    for (const cx of [Math.floor(x - half), Math.floor(x + half)]) {
      for (const cz of [Math.floor(z - half), Math.floor(z + half)]) {
        for (const cy of [Math.floor(y), Math.floor(y + HEIGHT * 0.5), Math.floor(y + HEIGHT - 0.05)]) {
          if (!inside(cx, cy, cz)) { if (cy < 0) return true; continue; }
          if (this.voxels.get(cx, cy, cz) !== AIR) return true;
        }
      }
    }
    return false;
  }

  updatePlayer(dt) {
    const k = (c) => this.keys.has(c);
    const forward = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    const strafe = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const sprint = k('ShiftLeft') || k('ShiftRight');
    const speed = this.flying ? FLY : (sprint ? SPRINT : WALK);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * forward + cos * strafe);
    let mz = (-cos * forward - sin * strafe);
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    if (this.flying) {
      const lift = (k('Space') ? 1 : 0) - (k('ControlLeft') || k('ShiftLeft') ? 1 : 0);
      this.step(mx * speed * dt, lift * speed * dt, mz * speed * dt, true);
      this.vel.y = 0;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (k('Space') && this.onGround) { this.vel.y = JUMP; this.onGround = false; }
      this.step(mx * speed * dt, this.vel.y * dt, mz * speed * dt, false);
    }

    // fell off the edge of the island
    if (this.pos.y < -6) { this.placePlayer(); this.vel.set(0, 0, 0); this.toast('Back to spawn'); }
  }

  /** Move one axis at a time in small steps so nothing tunnels through a wall. */
  step(dx, dy, dz, noclipGravity) {
    const subs = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.2));
    for (let i = 0; i < subs; i++) {
      const sx = dx / subs, sy = dy / subs, sz = dz / subs;

      this.pos.x += sx;
      if (this.solidAt(this.pos.x, this.pos.y, this.pos.z)) this.pos.x -= sx;

      this.pos.z += sz;
      if (this.solidAt(this.pos.x, this.pos.y, this.pos.z)) this.pos.z -= sz;

      this.pos.y += sy;
      if (this.solidAt(this.pos.x, this.pos.y, this.pos.z)) {
        this.pos.y -= sy;
        if (!noclipGravity) {
          if (sy < 0) this.onGround = true;
          this.vel.y = 0;
        }
      } else if (!noclipGravity && sy < 0) {
        this.onGround = false;
      }
    }
  }

  // ------------------------------------------------------------------ time ---
  isNight() {
    const t = this.settings.timeOfDay;
    return t < 0.2 || t > 0.8;
  }

  updateSky(dt) {
    if (!this.settings.frozenTime) {
      this.settings.timeOfDay = (this.settings.timeOfDay + dt / 240) % 1;
    }
    const t = this.settings.timeOfDay;
    const angle = t * Math.PI * 2 - Math.PI / 2;
    this.sun.position.set(Math.cos(angle) * 100, Math.sin(angle) * 100, 40);
    const day = Math.max(0, Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
    this.sun.intensity = 0.08 + day * 0.42;
    this.hemi.intensity = 0.3 + day * 1.05;
    const sky = new THREE.Color(0x05070f).lerp(new THREE.Color(0x9fc6e8), day);
    this.scene.background = sky;
    this.scene.fog.color = sky;
    const hh = String(Math.floor(t * 24)).padStart(2, '0');
    const mm = String(Math.floor((t * 24 % 1) * 60)).padStart(2, '0');
    this.$('.b3d-clock').textContent = `${hh}:${mm}`;
  }

  // ----------------------------------------------------------------- chunks ---
  rebuildDirtyChunks(budget = 2) {
    let done = 0;
    for (const key of this.voxels.dirty) {
      if (done >= budget) break;
      this.voxels.dirty.delete(key);
      const [cx, cz] = key.split(',').map(Number);
      const built = this.voxels.buildChunk(cx, cz);
      const old = this.chunkMeshes.get(key);
      if (old) {
        for (const m of old.all) { this.scene.remove(m); m.geometry.dispose(); }
      }
      // an empty bucket is simply not added — there is no sense handing the
      // renderer geometry with no vertices in it
      const made = [
        new THREE.Mesh(built.lit, this.litMaterial),
        new THREE.Mesh(built.cutout, this.cutoutMaterial),
        new THREE.Mesh(built.glow, this.glowMaterial),
      ];
      for (const m of made) {
        if (m.geometry.getAttribute('position')) this.scene.add(m);
      }
      this.chunkMeshes.set(key, { all: made });
      done++;
    }
  }

  // ------------------------------------------------------------------- loop ---
  start() {
    this.bindInput();
    this.running = true;
    this.last = performance.now();
    // draw every chunk before the first frame so nothing pops in
    while (this.voxels.dirty.size) this.rebuildDirtyChunks(CHUNKS_X * CHUNKS_Z);
    this.resize();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (!this.paused) {
      this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
      this.updatePlayer(dt);
      this.updateSky(dt);
      this.updateMonsters(dt);
      this.updateEmitters(dt);
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) this.$('.b3d-toast').hidden = true;
      }
      // autosave a little after the last edit, never mid-drag
      if (this.dirtySince && now - this.dirtySince > 4000) this.save(false);
    }

    this.rebuildDirtyChunks();

    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    const hit = this.targeted();
    this.highlight.visible = !!hit;
    if (hit) this.highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.mount.clientWidth || 960;
    const h = this.mount.clientHeight || 540;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  toast(text) {
    const t = this.$('.b3d-toast');
    t.textContent = text;
    t.hidden = false;
    this.toastTimer = 2.4;
  }

  // ------------------------------------------------------------------ save ---
  save(announce) {
    if (!this.owner) { if (announce) this.toast('You can only save a world you own'); return; }
    this.world.voxels = this.voxels.encode();
    this.world.spawn = { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw };
    const res = saveWorld(this.world);
    saveProfile(this.profile);
    this.dirtySince = 0;
    const note = this.$('.b3d-note');
    if (res.ok) {
      if (announce) this.toast('World saved');
      if (note) note.textContent = `Saved ${new Date().toLocaleTimeString()}`;
    } else {
      this.toast(res.reason);
      if (note) note.textContent = res.reason;
    }
  }

  quit() { this.stop(); this.onExit?.(); }

  stop() {
    this.running = false;
    for (const d of this.disposers) d();
    this.disposers = [];
    this.clearMonsters();
    for (const { all } of this.chunkMeshes.values()) {
      for (const m of all) m.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this.litMaterial.dispose();
    this.cutoutMaterial.dispose();
    this.glowMaterial.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.mount.innerHTML = '';
  }
}

function costLabel(id) {
  return Object.entries(costOf(id)).map(([k, v]) => `${v} ${k}`).join(', ');
}
