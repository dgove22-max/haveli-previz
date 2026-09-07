/* Shared top nav + theme. Theme is chosen once per browser (localStorage),
   defaulting to the OS preference, and is applied before first paint by the
   inline snippet each page carries in <head>. */

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
    <button class="theme" type="button" aria-label="Toggle dark mode"></button>`;
  const btn = nav.querySelector('button.theme');
  const paint = () => { btn.textContent = currentTheme() === 'dark' ? '☾' : '☀'; };
  btn.onclick = () => { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); paint(); };
  paint();
  document.body.prepend(nav);
  return nav;
}
