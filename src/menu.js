// The front door: pick a survival run or one of your worlds, and see what the
// bank is holding.

import { RESOURCES } from './config.js';
import { listWorlds, createWorld, deleteWorld, exportWorld, importWorld, isOwner } from './worlds.js';

export class Menu {
  constructor({ mount, profile, onSurvival, onWorld }) {
    this.mount = mount;
    this.profile = profile;
    this.onSurvival = onSurvival;
    this.onWorld = onWorld;
  }

  show() {
    this.mount.hidden = false;
    this.render();
  }

  hide() { this.mount.hidden = true; }

  render() {
    const worlds = listWorlds();
    this.mount.innerHTML = `
      <div class="menu-inner">
        <header class="menu-head">
          <h1>CENTURY</h1>
          <p class="tag">Survive one hundred nights &middot; then go build something</p>
        </header>

        <div class="menu-cards">
          <button class="card card-survival" data-act="survival">
            <span class="card-kicker">The game</span>
            <span class="card-title">Survival</span>
            <p>A hundred nights in the 2D maze. Ghosts, vampires, and the big one.
               Everything you carry out gets banked.</p>
            <span class="card-go">Start a run &rarr;</span>
          </button>

          <div class="card card-bank">
            <span class="card-kicker">The bank</span>
            <span class="card-title">Materials</span>
            <ul class="bank-list">${this.bankRows()}</ul>
            <p class="bank-note">Crystal is scarce out there and scarcer in a world.
               A survival run is how you stock up.</p>
          </div>
        </div>

        <section class="menu-worlds">
          <div class="worlds-head">
            <h2>Your worlds</h2>
            <div class="worlds-actions">
              <button data-act="new" class="primary">New world</button>
              <button data-act="import" class="ghost">Import&hellip;</button>
            </div>
          </div>
          ${worlds.length ? `<ul class="world-list">${worlds.map((w) => this.worldRow(w)).join('')}</ul>`
            : `<p class="empty">No worlds yet. Make one &mdash; you start with admin over everything in it.</p>`}
        </section>

        <p class="menu-fine">
          Best night <b>${this.profile.bestNight || '&mdash;'}</b> &middot;
          Centuries <b>${this.profile.centuries}</b> &middot;
          Runs <b>${this.profile.runs}</b> &middot;
          Kills <b>${this.profile.totalKills}</b>
        </p>
      </div>`;

    this.mount.onclick = (e) => this.handle(e);
  }

  bankRows() {
    return Object.entries(RESOURCES).map(([k, def]) => `
      <li>
        <i style="background:${def.colour}"></i>
        <span>${def.label}</span>
        <b>${this.profile.res[k] || 0}</b>
      </li>`).join('');
  }

  worldRow(w) {
    const mine = isOwner(w, this.profile);
    return `
      <li class="world-row">
        <div class="world-id">
          <span class="world-name">${escapeHtml(w.name)}</span>
          <span class="world-meta">
            ${mine ? '<b class="tag-admin">ADMIN</b>' : '<b class="tag-guest">VISITOR</b>'}
            seed ${w.seed} &middot; ${w.settings?.creative ? 'creative' : 'survival rules'}
            &middot; saved ${new Date(w.updated).toLocaleDateString()}
          </span>
        </div>
        <div class="world-buttons">
          <button data-act="play" data-id="${w.id}" class="primary">Enter</button>
          <button data-act="export" data-id="${w.id}" class="ghost">Copy</button>
          <button data-act="delete" data-id="${w.id}" class="ghost danger">Delete</button>
        </div>
      </li>`;
  }

  async handle(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'survival') return this.onSurvival();
    if (act === 'play') return this.onWorld(id);

    if (act === 'new') {
      const name = prompt('Name your world', `World ${listWorlds().length + 1}`);
      if (name === null) return;
      const world = createWorld({ name, seed: (Math.random() * 1e9) | 0, ownerId: this.profile.ownerId });
      return this.onWorld(world.id);
    }

    if (act === 'delete') {
      const w = listWorlds().find((x) => x.id === id);
      if (!w) return;
      if (!confirm(`Delete "${w.name}"? This cannot be undone.`)) return;
      deleteWorld(id);
      return this.render();
    }

    if (act === 'export') {
      const w = listWorlds().find((x) => x.id === id);
      if (!w) return;
      const text = exportWorld(w);
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      } catch {
        // clipboard is blocked in some frames; fall back to something selectable
        prompt('Copy this world data:', text);
      }
      return;
    }

    if (act === 'import') {
      const text = prompt('Paste world data');
      if (!text) return;
      const res = importWorld(text);
      if (!res.ok) { alert(res.reason); return; }
      return this.render();
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
