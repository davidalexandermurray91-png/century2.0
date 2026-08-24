import { Game } from './game.js';
import { initInput } from './input.js';
import { initAudio } from './audio.js';
import { VIEW_W, VIEW_H } from './config.js';
import { ordinal } from './utils.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const titlecard = document.getElementById('titlecard');
const overlay = document.getElementById('overlay');
const bestEl = document.getElementById('bestrun');

const BEST_KEY = 'century.best';
const readBest = () => {
  const n = Number(localStorage.getItem(BEST_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
};
const writeBest = (n) => { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* private mode */ } };

function renderBest() {
  const b = readBest();
  bestEl.textContent = b ? `night ${b}` : '—';
}
renderBest();

initInput(canvas);

let game = null;
let last = performance.now();
let running = false;

function gameOver(stats) {
  running = false;
  if (stats.night > readBest()) writeBest(stats.night);
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
      Materials gathered <b>${stats.gathered}</b><br/>
      Locations burned through <b>${stats.location}</b><br/>
      Centuries <b>${stats.centuries}</b>
    </p>
    <p class="tag" style="margin-top:.6rem">${verdict}</p>
    <button id="againbtn">GO AGAIN</button>
  `;
  overlay.classList.remove('hidden');
  document.getElementById('againbtn').addEventListener('click', start);
}

function start() {
  initAudio();
  overlay.classList.add('hidden');
  titlecard.classList.add('hidden');
  game = new Game(gameOver);
  window.century = game;   // handy for poking at a run from the console
  last = performance.now();
  running = true;
  renderBest();
}

document.getElementById('startbtn').addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if (!running && (e.code === 'Enter' || e.code === 'Space')) {
    if (!titlecard.classList.contains('hidden') || !overlay.classList.contains('hidden')) start();
  }
});

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!game) return;
  if (running) game.update(dt);
  game.draw(ctx);
}
requestAnimationFrame(frame);
