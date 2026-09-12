// The account picker. Deliberately plain about what an account is here.

import {
  listAccounts, createAccount, signIn, deleteAccount,
  exportAccount, importAccount,
} from './accounts.js';

export class SignIn {
  constructor({ mount, onSignedIn }) {
    this.mount = mount;
    this.onSignedIn = onSignedIn;
  }

  show() { this.mount.hidden = false; this.render(); }
  hide() { this.mount.hidden = true; }

  render(message = '') {
    const accounts = listAccounts();
    this.mount.innerHTML = `
      <div class="signin-inner">
        <p class="presents">Alexander J. Murray presents</p>
        <h1>CENTURY</h1>
        <p class="tag">Who's playing?</p>

        ${accounts.length ? `
          <ul class="acct-list">
            ${accounts.map((a) => `
              <li class="acct-row">
                <button class="acct-pick" data-act="signin" data-id="${a.id}">
                  <span class="acct-name">${esc(a.name)}</span>
                  <span class="acct-meta">since ${new Date(a.created).toLocaleDateString()}</span>
                </button>
                <button class="ghost" data-act="export" data-id="${a.id}">Back up</button>
                <button class="ghost danger" data-act="delete" data-id="${a.id}">Delete</button>
              </li>`).join('')}
          </ul>` : `<p class="empty">No accounts on this device yet.</p>`}

        <div class="acct-new">
          <input id="acctname" type="text" maxlength="24" placeholder="New account name"
                 autocomplete="off" spellcheck="false" />
          <button data-act="create" class="primary">Create</button>
          <button data-act="restore" class="ghost">Restore from backup</button>
        </div>

        ${message ? `<p class="acct-msg">${esc(message)}</p>` : ''}

        <p class="acct-note">
          An account keeps your bank, your worlds and your admin rights together,
          and keeps two players on one device apart. It lives in this browser
          &mdash; there is no server and no password, so it is not protection, and
          clearing site data clears it. <b>Back up</b> gives you a code that
          carries your progress to another browser or device.
        </p>
      </div>`;
    this.mount.onclick = (e) => this.handle(e);
    const input = this.mount.querySelector('#acctname');
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.create(); });
  }

  create() {
    const input = this.mount.querySelector('#acctname');
    const res = createAccount(input?.value);
    if (!res.ok) return this.render(res.reason);
    this.onSignedIn(signIn(res.account.id));
  }

  async handle(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { act, id } = btn.dataset;

    if (act === 'signin') return this.onSignedIn(signIn(id));
    if (act === 'create') return this.create();

    if (act === 'delete') {
      const a = listAccounts().find((x) => x.id === id);
      if (!a) return;
      if (!confirm(`Delete "${a.name}"? Their bank and every world they own goes with it. This cannot be undone.`)) return;
      deleteAccount(id);
      return this.render('Account deleted.');
    }

    if (act === 'export') {
      const text = exportAccount(id);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Back up'; }, 1800);
      } catch {
        prompt('Copy this and keep it somewhere safe:', text);
      }
      return;
    }

    if (act === 'restore') {
      const text = prompt('Paste your backup code');
      if (!text) return;
      const res = importAccount(text);
      if (!res.ok) return this.render(res.reason);
      return this.render(`Restored ${res.account.name}${res.worlds ? ` and ${res.worlds} world${res.worlds === 1 ? '' : 's'}` : ''}.`);
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
