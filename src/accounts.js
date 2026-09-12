// Local accounts.
//
// Be clear-eyed about what this is: there is no server, so an account is a
// named profile stored in this browser, not a login. It does two real jobs —
// it keeps two people's progress apart on a shared machine, and it is the
// identity that world ownership is stamped with, so only the person who made a
// world gets the admin panel for it.
//
// It is NOT protection. Anyone with this browser can sign into any account
// here. The export code is how progress actually travels between devices.

const KEY = 'century.accounts.v1';
const CURRENT = 'century.currentAccount.v1';

const read = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

export function listAccounts() {
  const a = read(KEY, []);
  return Array.isArray(a) ? a : [];
}

function newId(prefix) {
  const r = () => Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${prefix}_${r()}${r()}`;
}

export function createAccount(name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return { ok: false, reason: 'Give the account a name.' };
  const accounts = listAccounts();
  if (accounts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: 'There is already an account with that name.' };
  }
  const account = {
    id: newId('acc'),
    ownerId: newId('own'),     // what worlds get stamped with
    name: clean,
    created: Date.now(),
  };
  accounts.push(account);
  if (!write(KEY, accounts)) return { ok: false, reason: 'Browser storage is full or blocked.' };
  return { ok: true, account };
}

export const getAccount = (id) => listAccounts().find((a) => a.id === id) || null;

export function currentAccount() {
  let id = null;
  try { id = localStorage.getItem(CURRENT); } catch { /* storage unavailable */ }
  return id ? getAccount(id) : null;
}

export function signIn(id) {
  try { localStorage.setItem(CURRENT, id); } catch { /* storage unavailable */ }
  return getAccount(id);
}

export function signOut() {
  try { localStorage.removeItem(CURRENT); } catch { /* storage unavailable */ }
}

export function renameAccount(id, name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return false;
  const accounts = listAccounts();
  const a = accounts.find((x) => x.id === id);
  if (!a) return false;
  a.name = clean;
  return write(KEY, accounts);
}

/** Removes the account, its bank, and every world it owns. */
export function deleteAccount(id) {
  const account = getAccount(id);
  write(KEY, listAccounts().filter((a) => a.id !== id));
  try {
    localStorage.removeItem(`century.profile.v1:${id}`);
    if (account) {
      const worlds = read('century.worlds.v1', []);
      write('century.worlds.v1', worlds.filter((w) => w.ownerId !== account.ownerId));
    }
    if (localStorage.getItem(CURRENT) === id) localStorage.removeItem(CURRENT);
  } catch { /* storage unavailable */ }
}

// ----------------------------------------------------------- portability ---

/**
 * Everything that belongs to one account, as text. This is the only way
 * progress moves between browsers or devices, so it carries the bank and every
 * world the account owns.
 */
export function exportAccount(id) {
  const account = getAccount(id);
  if (!account) return null;
  const profile = read(`century.profile.v1:${id}`, null);
  const worlds = read('century.worlds.v1', []).filter((w) => w.ownerId === account.ownerId);
  return JSON.stringify({ format: 'century-account-1', account, profile, worlds });
}

export function importAccount(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: "That doesn't look like account data." }; }
  if (parsed?.format !== 'century-account-1' || !parsed.account?.id) {
    return { ok: false, reason: 'Unrecognised account data.' };
  }

  const accounts = listAccounts();
  const incoming = parsed.account;
  // Restoring the same account onto a machine that already has it should
  // replace it, not leave two entries that quietly diverge.
  const existing = accounts.findIndex((a) => a.id === incoming.id);
  if (existing >= 0) accounts[existing] = incoming;
  else {
    if (accounts.some((a) => a.name.toLowerCase() === incoming.name.toLowerCase())) {
      incoming.name = `${incoming.name} (2)`;
    }
    accounts.push(incoming);
  }
  if (!write(KEY, accounts)) return { ok: false, reason: 'Browser storage is full.' };

  if (parsed.profile) write(`century.profile.v1:${incoming.id}`, parsed.profile);

  if (Array.isArray(parsed.worlds) && parsed.worlds.length) {
    const worlds = read('century.worlds.v1', []);
    const byId = new Map(worlds.map((w) => [w.id, w]));
    for (const w of parsed.worlds) byId.set(w.id, w);
    write('century.worlds.v1', [...byId.values()]);
  }
  return { ok: true, account: incoming, worlds: parsed.worlds?.length || 0 };
}
