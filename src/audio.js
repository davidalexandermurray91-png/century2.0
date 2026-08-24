// Tiny WebAudio noise-maker. No assets, no licensing, no 40MB of wavs.
let ctx = null;
let master = null;
let enabled = true;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { enabled = false; return; }
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
}

export function toggleAudio() {
  enabled = !enabled;
  if (master) master.gain.value = enabled ? 0.22 : 0;
  return enabled;
}

export const audioOn = () => enabled;

function tone({ freq = 440, to = null, dur = 0.12, type = 'square', gain = 0.5, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.15, gain = 0.4, filter = 900, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'lowpass'; bp.frequency.value = filter;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t0);
}

export const sfx = {
  pickup: () => tone({ freq: 620, to: 900, dur: 0.06, type: 'triangle', gain: 0.22 }),
  craft: () => { tone({ freq: 300, to: 700, dur: 0.12, type: 'sawtooth', gain: 0.25 }); tone({ freq: 700, dur: 0.1, delay: 0.1, type: 'triangle', gain: 0.2 }); },
  build: () => noise({ dur: 0.12, gain: 0.35, filter: 700 }),
  deny: () => tone({ freq: 180, to: 90, dur: 0.14, type: 'square', gain: 0.2 }),
  swing: () => noise({ dur: 0.09, gain: 0.25, filter: 2400 }),
  shoot: () => { tone({ freq: 900, to: 200, dur: 0.07, type: 'square', gain: 0.22 }); noise({ dur: 0.06, gain: 0.2, filter: 3000 }); },
  bow: () => tone({ freq: 380, to: 160, dur: 0.12, type: 'triangle', gain: 0.2 }),
  laser: () => { tone({ freq: 1500, to: 300, dur: 0.22, type: 'sawtooth', gain: 0.24 }); },
  throwPizza: () => tone({ freq: 240, to: 400, dur: 0.16, type: 'sine', gain: 0.2 }),
  hit: () => noise({ dur: 0.07, gain: 0.3, filter: 1600 }),
  block: () => tone({ freq: 2000, to: 900, dur: 0.08, type: 'square', gain: 0.18 }),
  kill: () => { tone({ freq: 220, to: 60, dur: 0.3, type: 'sawtooth', gain: 0.3 }); noise({ dur: 0.25, gain: 0.3, filter: 500 }); },
  hurt: () => { tone({ freq: 160, to: 70, dur: 0.22, type: 'square', gain: 0.3 }); },
  nightfall: () => { [220, 165, 110].forEach((f, i) => tone({ freq: f, dur: 0.6, type: 'sine', gain: 0.28, delay: i * 0.22 })); },
  dawn: () => { [330, 440, 660].forEach((f, i) => tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.24, delay: i * 0.14 })); },
  flare: () => { tone({ freq: 500, to: 2400, dur: 0.5, type: 'sawtooth', gain: 0.3 }); noise({ dur: 0.5, gain: 0.3, filter: 4000 }); },
  engine: () => tone({ freq: 90, to: 140, dur: 0.4, type: 'sawtooth', gain: 0.2 }),
  evac: () => { [330, 392, 523, 659].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.26, delay: i * 0.16 })); },
  century: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.7, type: 'triangle', gain: 0.3, delay: i * 0.18 })); },
  death: () => { [200, 150, 100, 60].forEach((f, i) => tone({ freq: f, dur: 0.7, type: 'sawtooth', gain: 0.3, delay: i * 0.2 })); },
};
