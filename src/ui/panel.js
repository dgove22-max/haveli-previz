/* Right-hand sheet: role tabs, scenes, trial backdrops, views (presets +
   saved), element toggles, dimension table with confidence badges,
   unconfirmed list, exports, copy-link. */
import { ROLES, partVisible } from '../roles.js';
import { addTrial, listTrials, deleteTrial, fmtSize } from '../trials.js';

const SAVED_VIEWS_KEY = 'hp-saved-views';
const loadSavedViews = () => {
  try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) ?? []; } catch { return []; }
};
const storeSavedViews = v => {
  try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(v)); } catch { /* private mode */ }
};

export function createPanel(ctx) {
  /* ctx: { model, parts, views, controls, led, state, applyVisibility,
            onStateChange, exports: {keepout, elevations, screenshot} } */
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = '';

  /* ── roles ── */
  const roleGroup = group('Role view');
  const tabs = document.createElement('div');
  tabs.id = 'roletabs';
  Object.entries(ROLES).forEach(([id, r]) => {
    const b = document.createElement('button');
    b.className = 'tab'; b.textContent = r.label; b.dataset.role = id;
    b.onclick = () => {
      ctx.state.role = id;
      ctx.state.hide.clear(); ctx.state.show.clear();
      if (ROLES[id].keepout && ctx.state.keepout == null) ctx.led.setKeepout(true);
      ctx.applyVisibility();
      ctx.onStateChange();
      refresh();
    };
    tabs.appendChild(b);
  });
  roleGroup.appendChild(tabs);
  const roleHint = p('Links carry the role — send each team their own view.');
  roleGroup.appendChild(roleHint);

  /* ── scenes ── */
  const sceneGroup = group('Scenes');
  const sceneList = document.createElement('div');
  ctx.model.scenes.forEach(s => {
    const b = document.createElement('button');
    b.className = 'view'; b.dataset.scene = s.id;
    b.innerHTML = `${esc(s.name)}${s.led ? '' : ' <span class="soft">· pattern</span>'}`;
    b.title = s.notes ?? '';
    b.onclick = () => { ctx.setScene(s.id); refresh(); };
    sceneList.appendChild(b);
  });
  sceneGroup.appendChild(sceneList);

  /* ── trial backdrops — drop files, iterate, all local to this browser ── */
  const trialGroup = group('Trial backdrops');
  const trialList = document.createElement('div');
  trialGroup.appendChild(trialList);
  const addBtn = document.createElement('button');
  addBtn.className = 'view accent';
  addBtn.textContent = '＋ Add image or video';
  const fileInp = document.createElement('input');
  fileInp.type = 'file';
  fileInp.accept = 'image/*,video/*';
  fileInp.multiple = true;
  fileInp.hidden = true;
  addBtn.onclick = () => fileInp.click();
  fileInp.onchange = () => { ctx.addTrialFiles([...fileInp.files]); fileInp.value = ''; };
  trialGroup.appendChild(addBtn);
  trialGroup.appendChild(fileInp);
  trialGroup.appendChild(p('…or drop files anywhere on the page. Trials live in this browser only — shared links show hosted content, so promote keepers to public/content/.'));

  async function renderTrials() {
    let trials = [];
    try { trials = await listTrials(); } catch { /* IndexedDB unavailable */ }
    trialList.innerHTML = '';
    if (ctx.led.trial) {
      const back = document.createElement('button');
      back.className = 'view';
      back.textContent = '← Back to scene content';
      back.onclick = () => { ctx.applyTrial(null); };
      trialList.appendChild(back);
    }
    for (const t of trials) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';
      const b = document.createElement('button');
      b.className = 'view';
      b.style.cssText = 'flex:1;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      b.dataset.active = String(ctx.led.trial?.id === t.id);
      b.innerHTML = `${esc(t.name)} <span class="soft">· ${t.kind === 'image' ? 'still' : 'video'} · ${fmtSize(t.size)}</span>`;
      b.onclick = () => ctx.applyTrial(t);
      const del = document.createElement('button');
      del.className = 'view';
      del.style.cssText = 'width:28px;margin:0;text-align:center;padding:6px 0';
      del.textContent = '×';
      del.title = `Remove ${t.name} from this browser`;
      del.onclick = async () => {
        await deleteTrial(t.id);
        if (ctx.led.trial?.id === t.id) ctx.applyTrial(null); else renderTrials();
      };
      row.append(b, del);
      trialList.appendChild(row);
    }
  }
  renderTrials();

  /* ── views — presets, then the user's saved views ── */
  const viewGroup = group('Views');
  ctx.views.forEach(v => {
    const b = document.createElement('button');
    b.className = 'view'; b.textContent = v.name; b.dataset.view = v.id;
    b.onclick = () => {
      ctx.controls.setView(v);
      ctx.state.cam = v.id; ctx.state.cv = null;
      ctx.onStateChange(); refresh();
    };
    viewGroup.appendChild(b);
  });

  const savedWrap = document.createElement('div');
  viewGroup.appendChild(savedWrap);
  function renderSavedViews() {
    const saved = loadSavedViews();
    savedWrap.innerHTML = '';
    for (const v of saved) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';
      const b = document.createElement('button');
      b.className = 'view';
      b.style.cssText = 'flex:1;margin:0';
      b.dataset.cv = v.cv;
      b.textContent = `★ ${v.name}`;
      b.onclick = () => {
        ctx.controls.applySerialized(v.cv);
        ctx.state.cam = null; ctx.state.cv = v.cv;
        ctx.onStateChange(); refresh();
      };
      const del = document.createElement('button');
      del.className = 'view';
      del.style.cssText = 'width:28px;margin:0;text-align:center;padding:6px 0';
      del.textContent = '×';
      del.title = `Delete saved view "${v.name}"`;
      del.onclick = () => { storeSavedViews(saved.filter(s => s !== v)); renderSavedViews(); };
      row.append(b, del);
      savedWrap.appendChild(row);
    }
  }
  renderSavedViews();

  const saveViewBtn = document.createElement('button');
  saveViewBtn.className = 'view accent';
  saveViewBtn.textContent = '＋ Save this view';
  saveViewBtn.onclick = () => {
    const saved = loadSavedViews();
    const name = prompt('Name this view', `View ${saved.length + 1}`);
    if (!name) return;
    saved.push({ name: name.trim(), cv: ctx.controls.serialize() });
    storeSavedViews(saved);
    renderSavedViews(); refresh();
  };
  viewGroup.appendChild(saveViewBtn);
  viewGroup.appendChild(p('Saved views stay in this browser; “Copy link” below carries the exact camera for anyone.'));

  /* ── toggles ── */
  const togGroup = group('Elements');
  const LABELS = {
    hall: 'Hall shell', stage: 'Main stage & stairs', backstage: 'Raised backstage',
    cordon: 'Cordon walls (6 ft)', led: 'LED wall', drape: 'Upstage drape',
    curtains: 'Masking curtains', cabin: 'Cabin', chair: 'Armchair at 11 ft',
    forestage: 'Performance stage', figures: "Performer (5'6\")", grid: 'Floor grid',
    dimensions: 'Dimension lines', props: 'Props', coffer: 'Ceiling coffer grid',
    lighting: 'Lighting fixtures'
  };
  const togInputs = {};
  for (const key of Object.keys(ctx.parts)) {
    const l = document.createElement('label');
    l.className = 'row';
    l.innerHTML = `<input type="checkbox" class="sw"><span>${LABELS[key] ?? key}</span>`;
    const inp = l.querySelector('input');
    inp.onchange = () => {
      const base = partVisible(key, ctx.state.role, new Set(), new Set());
      ctx.state.hide.delete(key); ctx.state.show.delete(key);
      if (inp.checked && !base) ctx.state.show.add(key);
      if (!inp.checked && base) ctx.state.hide.add(key);
      ctx.applyVisibility(); ctx.onStateChange();
    };
    togInputs[key] = inp;
    togGroup.appendChild(l);
  }
  /* ghost-cabin extra */
  const ghost = document.createElement('label');
  ghost.className = 'row';
  ghost.innerHTML = `<input type="checkbox" class="sw"><span>Ghost the cabin</span>`;
  ghost.querySelector('input').onchange = e => ctx.setGhostCabin(e.target.checked);
  togGroup.appendChild(ghost);

  /* keepout toggle lives with the LED */
  const ko = document.createElement('label');
  ko.className = 'row';
  ko.innerHTML = `<input type="checkbox" class="sw"><span>Keep-out overlay on LED</span>`;
  const koInp = ko.querySelector('input');
  koInp.onchange = e => { ctx.led.setKeepout(e.target.checked); ctx.state.keepout = e.target.checked; ctx.onStateChange(); };
  togGroup.appendChild(ko);

  /* ── show mode — real lighting, dark venue ── */
  if (ctx.parts.lighting && ctx.setShowMode) {
    const sm = group('Show mode');

    const sw = document.createElement('label');
    sw.className = 'row';
    sw.innerHTML = `<input type="checkbox" class="sw"><span>Show mode — lights as on the day</span>`;
    const swInp = sw.querySelector('input');
    swInp.checked = ctx.state.show3d;
    swInp.onchange = e => { ctx.setShowMode({ show3d: e.target.checked }); syncSliders(); };
    sm.appendChild(sw);

    const slider = (label, key, val) => {
      const wrap = document.createElement('label');
      wrap.className = 'row';
      wrap.innerHTML = `<span>${label}</span>
        <input type="range" min="0" max="1" step="0.02" style="flex:1;accent-color:var(--accent)">
        <span class="mono soft" style="width:30px;text-align:right"></span>`;
      const inp = wrap.querySelector('input'), out = wrap.querySelector('.mono');
      inp.value = val; out.textContent = Math.round(val * 100) + '%';
      inp.oninput = () => {
        out.textContent = Math.round(inp.value * 100) + '%';
        ctx.setShowMode({ [key]: Number(inp.value) });
      };
      sm.appendChild(wrap);
      return inp;
    };
    const hazeInp = slider('Haze', 'haze', ctx.state.haze);
    const houseInp = slider('House', 'house', ctx.state.house);

    function syncSliders() {
      const on = ctx.state.show3d;
      hazeInp.disabled = houseInp.disabled = !on;
      hazeInp.closest('label').style.opacity = on ? 1 : 0.45;
      houseInp.closest('label').style.opacity = on ? 1 : 0.45;
    }
    syncSliders();
    sm.appendChild(p('Haze previews what a hazer buys — beams in the air. House is the venue’s own lighting level. Both ride the link.'));
  }

  /* ── lighting checks (phase 3) ── */
  if (ctx.parts.lighting) {
    const lc = group('Lighting checks');
    const w = ctx.parts.lighting.userData?.warnings ?? [];
    if (w.length) {
      const ul = document.createElement('ul');
      ul.className = 'unconf';
      w.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      lc.appendChild(ul);
    } else {
      lc.appendChild(p('No LED spill or cabin-glass glare from the current rig.'));
    }
    lc.appendChild(p('Positions sit on an ESTIMATED coffer grid — measure before plotting.'));
  }

  /* ── share ── */
  const shareGroup = group('Share');
  const copy = document.createElement('button');
  copy.className = 'view accent'; copy.textContent = 'Copy link to this exact view';
  copy.onclick = async () => {
    ctx.onStateChange(true);
    try { await navigator.clipboard.writeText(location.href); copy.textContent = 'Copied ✓'; }
    catch { prompt('Copy this link:', location.href); }
    setTimeout(() => { copy.textContent = 'Copy link to this exact view'; }, 1400);
  };
  shareGroup.appendChild(copy);

  /* ── exports (appear as the phases land) ── */
  if (ctx.exports && Object.keys(ctx.exports).length) {
    const ex = group('Exports');
    const defs = [
      ['keepout',    'Keep-out map PNG (10240 × 1920)'],
      ['elevations', 'Dimensioned elevations PNG'],
      ['screenshot', 'Screenshot this view PNG']
    ];
    for (const [k, label] of defs) {
      if (!ctx.exports[k]) continue;
      const b = document.createElement('button');
      b.className = 'view'; b.textContent = label;
      b.onclick = () => ctx.exports[k]();
      ex.appendChild(b);
    }
  }

  /* ── dimensions table ── */
  const dimGroup = group('Dimensions');
  const table = document.createElement('table');
  table.className = 'dims';
  const tb = document.createElement('tbody');
  table.appendChild(tb);
  dimGroup.appendChild(table);
  dimGroup.appendChild(p('Blue — measured on site. Grey — stated. Amber ⚠ — estimate, confirm before building.'));
  fillDims(tb, ctx.model);

  /* ── unconfirmed ── */
  const uc = group('Unconfirmed — SPEC §10');
  const ul = document.createElement('ul');
  ul.className = 'unconf';
  const flagged = Object.entries(ctx.model.conf)
    .filter(([, c]) => c === 'est' || c === 'approx')
    .filter(([k]) => ctx.model.notes[k]);
  for (const [k] of flagged) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="mono">${k}</span> — ${esc(ctx.model.notes[k])}`;
    ul.appendChild(li);
  }
  uc.appendChild(ul);

  /* ── origin note ── */
  const og = group('Origin');
  og.appendChild(p(ctx.model.raw.venueRaw.meta.origin));

  function group(title) {
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<h2>${title}</h2>`;
    sheet.appendChild(g);
    return g;
  }

  function refresh() {
    tabs.querySelectorAll('.tab').forEach(b => b.dataset.active = String(b.dataset.role === ctx.state.role));
    sceneList.querySelectorAll('button').forEach(b => b.dataset.active = String(b.dataset.scene === ctx.state.scene));
    viewGroup.querySelectorAll('button[data-view]').forEach(b =>
      b.dataset.active = String(b.dataset.view === ctx.controls.activePreset));
    savedWrap.querySelectorAll('button[data-cv]').forEach(b =>
      b.dataset.active = String(!ctx.controls.activePreset && ctx.state.cv === b.dataset.cv));
    for (const [key, inp] of Object.entries(togInputs))
      inp.checked = partVisible(key, ctx.state.role, ctx.state.hide, ctx.state.show);
    koInp.checked = ctx.led.keepout;
  }

  refresh();
  return { refresh, refreshTrials: renderTrials };
}

function fillDims(tb, model) {
  const { V, D, conf } = model;
  const covH = ((V.cabin.height - V.led.baseAboveDeck) / V.led.height * 100).toFixed(0);
  const c = path => conf[path] ?? 'derived';
  const rows = [
    ['Hall',               `${V.hall.width.toFixed(1)} × ${V.hall.depth.toFixed(1)} m`, c('hall.width')],
    ['Hall height',        `${V.hall.wallHeight.toFixed(2)} m`, c('hall.wallHeight')],
    ['Stage frontage',     `${D.FRONTAGE.toFixed(2)} m`, 'measured'],
    ['Between stairs',     `${V.stage.clearWidth.toFixed(2)} m`, c('stage.clearWidth')],
    ['Stage edge → LED',   `${V.stage.depthToLed.toFixed(2)} m`, c('stage.depthToLed')],
    ['Deck height',        `${V.stage.deckHeight.toFixed(2)} m`, c('stage.deckHeight')],
    ['Performance stage',  `${D.FS_W.toFixed(2)} × ${D.FS_D.toFixed(2)} m`, c('forestage.pieceW')],
    ['Perf. stage height', `${D.FS_H.toFixed(2)} m`, c('forestage.height')],
    ['Step down to perf.', `${((V.stage.deckHeight - D.FS_H) * 1000).toFixed(0)} mm`, 'est'],
    ['Deck pieces',        `${V.forestage.cols} × ${V.forestage.rows} @ 244 × 122 cm`, c('forestage.cols')],
    ['Cordon wall height', `6'0" (1.83 m)`, c('cordon.height')],
    ['Curtain → back wall',`${V.curtains.fromBackWall.toFixed(2)} m`, c('curtains.fromBackWall')],
    ['Curtain inner edge', `± ${D.CURT_IN.toFixed(2)} m`, 'derived'],
    ['LED behind curtain', `${(V.led.width / 2 - D.CURT_IN).toFixed(2)} m / ${Math.round((V.led.width / 2 - D.CURT_IN) * D.PX_PER_M)} px each end`, 'derived'],
    ['LED',                `${V.led.width.toFixed(2)} × ${V.led.height.toFixed(2)} m`, c('led.width')],
    ['LED pixels',         `${V.led.pxW} × ${V.led.pxH}`, c('led.pxW')],
    ['Pixel pitch',        `${D.PITCH_MM.toFixed(1)} mm`, 'derived'],
    ['LED base above deck',`${V.led.baseAboveDeck.toFixed(2)} m`, c('led.baseAboveDeck')],
    ['Cabin width',        `≈ ${V.cabin.width.toFixed(2)} m`, c('cabin.width')],
    ['Cabin depth',        `${D.CABIN_D.toFixed(2)} m`, 'derived'],
    ['Cabin height',       `${V.cabin.height.toFixed(3)} m`, c('cabin.height')],
    ['Glass from edge',    `1'0" (0.30 m)`, c('cabin.frontFromEdge')],
    ['Cabin floor raise',  `${V.cabin.floorRaise.toFixed(2)} m`, c('cabin.floorRaise')],
    ['Chair from edge',    `11'0" (3.35 m)`, c('chair.zFromEdge')],
    ['Cabin : LED width',  `≈ ${(V.cabin.width / V.led.width * 100).toFixed(0)}%`, 'derived'],
    ['Cabin : LED height', `≈ ${covH}%`, 'derived'],
    ['Coffer grid (est)',  `${V.coffer.spacingX.toFixed(1)} × ${V.coffer.spacingZ.toFixed(1)} m @ ${V.coffer.soffit.toFixed(1)} m`, c('coffer.spacingX')]
  ];
  const cls = { measured: 'meas', stated: 'stat', derived: 'stat', approx: 'estv', est: 'estv' };
  for (const [k, v, cf] of rows) {
    const tr = document.createElement('tr');
    const flag = (cf === 'est' || cf === 'approx') ? '<span class="warnb">⚠</span> ' : '';
    tr.innerHTML = `<td class="k">${k}</td><td class="n ${cls[cf] ?? 'estv'}">${flag}${v}</td>`;
    tb.appendChild(tr);
  }
}

const p = txt => { const e = document.createElement('p'); e.className = 'legend'; e.textContent = txt; return e; };
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
