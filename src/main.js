import { Game } from './game.js';
import { initInput } from './input.js';
import { initAudio } from './audio.js';
import { VIEW_W, VIEW_H, RESOURCES } from './config.js';
import { ordinal } from './utils.js';
import { loadProfile } from './profile.js';
import { Menu } from './menu.js';
import { getWorld } from './worlds.js';

const profile = loadProfile();

const screens = {
  menu: document.getElementById('menu'),
  survival: document.getElementById('survival'),
  world: document.getElementById('world3d'),
};
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const titlecard = document.getElementById('titlecard');
const overlay = document.getElementById('overlay');
const bestEl = document.getElementById('bestrun');
const quitBtn = document.getElementById('quitrun');

initInput(canvas);

let game = null;
let builder = null;
let running = false;
let last = performance.now();

function show(which) {
  for (const [name, el] of Object.entries(screens)) el.hidden = name !== which;
}

// ------------------------------------------------------------------- menu ---
const menu = new Menu({
  mount: screens.menu,
  profile,
  onSurvival: () => openSurvival(),
  onWorld: (id) => openWorld(id),
});

function backToMenu() {
  running = false;
  if (builder) { builder.stop(); builder = null; }
  game = null;
  show('menu');
  menu.render();
}

// --------------------------------------------------------------- survival ---
function openSurvival() {
  show('survival');
  overlay.classList.add('hidden');
  titlecard.classList.remove('hidden');
  quitBtn.hidden = true;
  bestEl.textContent = profile.bestNight ? `night ${profile.bestNight}` : '—';
  running = false;
}

function startRun() {
  initAudio();
  overlay.classList.add('hidden');
  titlecard.classList.add('hidden');
  quitBtn.hidden = false;
  game = new Game(gameOver, profile);
  window.century = game;
  last = performance.now();
  running = true;
}

function gameOver(stats) {
  running = false;
  quitBtn.hidden = true;
  const survived = stats.night - 1;
  const verdict = stats.centuries > 0
    ? `${stats.centuries} ${stats.centuries === 1 ? 'century' : 'centuries'} and then some.`
    : survived >= 50 ? 'Halfway. So close.'
      : survived >= 20 ? 'A decent run.'
        : survived >= 6 ? 'They got you early.'
          : 'You did not last the grace period.';

  overlay.innerHTML = `
    <h2 style="color:#ff4d6d">THEY GOT YOU</h2>
    <p class="tag">on the ${ordinal(stats.night)} night</p>
    <p class="stat">
      Nights survived <b>${survived}</b><br/>
      Monsters put down <b>${stats.kills}</b><br/>
      Locations burned through <b>${stats.location}</b><br/>
      Centuries <b>${stats.centuries}</b>
    </p>
    ${bankedBlock(stats.gained)}
    <p class="tag" style="margin-top:.4rem">${verdict}</p>
    <div class="btn-row">
      <button id="againbtn">GO AGAIN</button>
      <button id="menubtn" class="ghost">BACK TO MENU</button>
    </div>`;
  overlay.classList.remove('hidden');
  document.getElementById('againbtn').addEventListener('click', startRun);
  document.getElementById('menubtn').addEventListener('click', backToMenu);
}

function bankedBlock(gained) {
  const entries = Object.entries(gained || {}).filter(([, v]) => v > 0);
  if (!entries.length) return '<p class="tag">Nothing made it to the bank.</p>';
  const list = entries
    .map(([k, v]) => `<span class="banked-chip"><i style="background:${RESOURCES[k].colour}"></i>${v} ${RESOURCES[k].label}</span>`)
    .join('');
  return `<p class="banked-head">Banked for your worlds</p><div class="banked">${list}</div>`;
}

document.getElementById('startbtn').addEventListener('click', startRun);
quitBtn.addEventListener('click', () => {
  if (game) { game.bank(); game.state = 'over'; }
  backToMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && screens.survival.hidden === false && !running) backToMenu();
  if (!running && e.code === 'Enter' && !screens.survival.hidden) startRun();
});

// ------------------------------------------------------------------ world ---
async function openWorld(id) {
  const world = getWorld(id);
  if (!world) { backToMenu(); return; }
  show('world');
  screens.world.innerHTML = '<p class="loading">Building the world&hellip;</p>';
  initAudio();
  try {
    // never leave someone staring at a spinner if the library can't be had
    const load = import('./builder/builder.js');
    const timeout = new Promise((_, reject) => setTimeout(
      () => reject(new Error('Timed out loading the 3D library.')), 20000,
    ));
    const { Builder } = await Promise.race([load, timeout]);
    screens.world.innerHTML = '';
    builder = new Builder({
      mount: screens.world,
      world,
      profile,
      onExit: backToMenu,
    });
    builder.start();
    window.century3d = builder;
  } catch (err) {
    screens.world.innerHTML = `
      <div class="loading error">
        <h2>World mode could not start</h2>
        <p>${String(err && err.message || err)}</p>
        <p class="tag">World mode needs the 3D library in <code>vendor/</code>.
           The survival game works without it.</p>
        <button id="backbtn">Back to menu</button>
      </div>`;
    document.getElementById('backbtn').addEventListener('click', backToMenu);
  }
}

// ------------------------------------------------------------------- loop ---
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!game || screens.survival.hidden) return;
  if (running) game.update(dt);
  game.draw(ctx);
}
requestAnimationFrame(frame);

show('menu');
menu.render();
