// The one save that spans both halves of the game.
//
// Survival runs always start you empty-handed — that is the point of them.
// What you carry out of a run gets banked here, and your worlds spend from the
// bank. Nothing flows the other way, so no amount of building in a world can
// make a night any easier.

import { RESOURCES } from './config.js';

const KEY = 'century.profile.v1';
const keyFor = (accountId) => `${KEY}:${accountId}`;

const blankRes = () => Object.fromEntries(Object.keys(RESOURCES).map((k) => [k, 0]));

export function blankProfile(account = null) {
  return {
    accountId: account?.id || null,
    ownerId: account?.ownerId || newOwnerId(),
    res: blankRes(),
    unlocked: ['torch'],
    bestNight: 0,
    centuries: 0,
    totalKills: 0,
    runs: 0,
  };
}

function newOwnerId() {
  // enough to tell your worlds from someone else's in an exported file
  const r = () => Math.floor(Math.random() * 0xffffffff).toString(36);
  return `own_${r()}${r()}`;
}

export function loadProfile(account) {
  let raw = null;
  try { raw = localStorage.getItem(keyFor(account.id)); } catch { /* storage unavailable */ }
  if (!raw) return blankProfile(account);
  try {
    const p = JSON.parse(raw);
    const base = blankProfile(account);
    return {
      ...base,
      ...p,
      accountId: account.id,
      // the account is the authority on identity, not the stored copy
      ownerId: account.ownerId,
      // a profile saved before a resource existed must not come back undefined
      res: { ...base.res, ...(p.res || {}) },
      unlocked: Array.isArray(p.unlocked) && p.unlocked.length ? p.unlocked : base.unlocked,
    };
  } catch {
    return blankProfile(account);
  }
}

export function saveProfile(profile) {
  if (!profile?.accountId) return false;
  try { localStorage.setItem(keyFor(profile.accountId), JSON.stringify(profile)); return true; }
  catch { return false; }
}

/** Fold what a finished run gathered into the bank. Returns what was added. */
export function bankRun(profile, player, stats = {}) {
  const gained = {};
  for (const [k, v] of Object.entries(player.res)) {
    if (!v) continue;
    profile.res[k] = (profile.res[k] || 0) + v;
    gained[k] = v;
  }
  for (const w of player.unlocked) {
    if (!profile.unlocked.includes(w)) profile.unlocked.push(w);
  }
  profile.totalKills += player.kills || 0;
  profile.runs += 1;
  if (stats.night > profile.bestNight) profile.bestNight = stats.night;
  if (stats.centuries > profile.centuries) profile.centuries = stats.centuries;
  saveProfile(profile);
  return gained;
}

export function canAfford(profile, cost) {
  return Object.entries(cost).every(([k, v]) => (profile.res[k] || 0) >= v);
}

export function spend(profile, cost) {
  if (!canAfford(profile, cost)) return false;
  for (const [k, v] of Object.entries(cost)) profile.res[k] -= v;
  saveProfile(profile);
  return true;
}

export function refund(profile, cost, fraction = 1) {
  for (const [k, v] of Object.entries(cost)) {
    profile.res[k] = (profile.res[k] || 0) + Math.floor(v * fraction);
  }
  saveProfile(profile);
}
