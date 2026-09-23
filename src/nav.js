/* Shared top nav, theme, and the editor session.

   Auth lives here rather than in a page's side panel because it is global
   state: you are signed in for the whole app, not for one view, and all three
   pages need it. It was briefly duplicated into the cue-sheet toolbar, which
   was the tell that it belonged in shared chrome. */
import { canEdit, onAuthChange, editorName, setEditorName, currentEmail, signOut } from './auth.js';
import { isOnline } from './data/supabase.js';
import { openSignInDialog } from './ui/signin.js';

export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('hp-theme', t); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('hp-theme', { detail: t }));
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function createNav(active) {
  const pages = [
    ['stage',    'Stage',     'index.html'],
    ['cuesheet', 'Cue Sheet', 'cuesheet.html'],
    ['ledplan',  'LED Plan',  'ledplan.html']
  ];
  const nav = document.createElement('div');
  nav.id = 'nav';
  nav.innerHTML = `
    <span class="brand">Haveli Previz <span class="soft">· Bal Din</span></span>
    ${pages.map(([id, label, href]) =>
      `<a class="tab" href="${href}" data-active="${id === active}">${label}</a>`).join('')}
    <span class="spacer"></span>
    <span class="auth"></span>
    <button class="theme" type="button" aria-label="Toggle dark mode"></button>`;
  const btn = nav.querySelector('button.theme');
  const paint = () => { btn.textContent = currentTheme() === 'dark' ? '☾' : '☀'; };
  btn.onclick = () => { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); paint(); };
  paint();

  /* The session is not ready when the nav is built — pages create the nav
     first, then connect. Render what we know and repaint on every change;
     supabase-js emits an initial event on subscribe, so this settles itself. */
  const authSlot = nav.querySelector('.auth');
  function paintAuth() {
    if (!isOnline()) { authSlot.innerHTML = ''; return; }
    authSlot.innerHTML = canEdit()
      ? `<span class="who" title="${esc(currentEmail() ?? '')}">
           <span class="dot"></span>${esc(editorName() || currentEmail() || 'editor')}
         </span>
         <button class="btn rename" type="button">Name</button>
         <button class="btn out" type="button">Sign out</button>`
      : `<button class="btn signin" type="button">Sign in</button>`;

    const si = authSlot.querySelector('.signin');
    if (si) si.onclick = () => openSignInDialog(paintAuth);
    const rn = authSlot.querySelector('.rename');
    if (rn) rn.onclick = () => {
      const n = prompt('Your name — stamped on every save so changes can be traced', editorName());
      if (n != null) { setEditorName(n); paintAuth(); }
    };
    const out = authSlot.querySelector('.out');
    if (out) out.onclick = async () => { await signOut(); paintAuth(); };
  }
  paintAuth();
  onAuthChange(paintAuth);

  document.body.prepend(nav);
  return Object.assign(nav, { paintAuth });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
