/* Right-hand sheet.

   Reordered around what the tool is now for. The programme tree and the
   selected stage's resources sit at the top, because that is what you work in;
   the reference material that used to fill the panel — 27 dimension rows, the
   unconfirmed list, the origin statement — is real but occasional, so it lives
   in closed drawers. Between them they were over half the panel's height while
   answering questions nobody asks while staging.

   The panel itself collapses, for when the 3D view is the point.

   Kept on the right deliberately: the Prop workshop docks left, so left is
   what you are building and right is how you are looking at it. */
import { ROLES, partVisible } from '../roles.js';
import { addTrial, listTrials, deleteTrial, fmtSize } from '../trials.js';
import { createTree } from './tree.js';
import { createSync, stagingIssues } from './sync.js';
import { matchCueProps, unmatched } from '../propmatch.js';
import { patchIsEmpty, resolveStage, emptyBase, emptyPatch } from '../stagestate.js';
import { saveStageState } from '../data/showdb.js';
import { isOnline } from '../data/supabase.js';
import { canEdit } from '../auth.js';
import { openSignInDialog } from './signin.js';

const SAVED_VIEWS_KEY = 'hp-saved-views';
const PANEL_KEY = 'hp-panel-open';
const LEFT_KEY = 'hp-left-open';
const loadSavedViews = () => {
  try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) ?? []; } catch { return []; }
};
const storeSavedViews = v => {
  try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(v)); } catch { /* private mode */ }
};

export function createPanel(ctx) {
  /* ctx: { model, parts, views, controls, led, state, cfg, show, target,
            applyVisibility, setAt, reloadShow, openEditor, setGhostCabin,
            setShowMode, applyTrial, addTrialFiles, onStateChange, exports } */
  const sheet = document.getElementById('sheet');
  const left = document.getElementById('programme') ?? sheet;
  sheet.innerHTML = '';
  if (left !== sheet) left.innerHTML = '';
  let show = ctx.show;
  const openActs = new Set();

  /* ── panel collapse ── both docks fold away independently, so you can have
     the whole hall to yourself without losing your place in the programme. */
  const dock = (key, id, side, labels) => {
    let open = true;
    try { open = localStorage.getItem(key) !== '0'; } catch { /* ignore */ }
    const btn = document.getElementById(id) ?? (() => {
      const b = document.createElement('button');
      b.id = id;
      document.body.appendChild(b);
      return b;
    })();
    const apply = () => {
      document.body.dataset[side] = open ? 'open' : 'closed';
      btn.textContent = open ? labels.close : labels.openGlyph;
      btn.title = open ? labels.hide : labels.show;
    };
    btn.onclick = () => {
      open = !open;
      try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* ignore */ }
      apply();
    };
    apply();
  };
  dock(PANEL_KEY, 'sheet-toggle', 'panel',
    { close: '›', openGlyph: '‹', hide: 'Hide the view panel', show: 'Show the view panel' });
  if (left !== sheet) {
    dock(LEFT_KEY, 'left-toggle', 'left',
      { close: '‹', openGlyph: '›', hide: 'Hide the programme', show: 'Show the programme' });
  }

  /* Auth used to live here as an "Editing" group. It moved to the shared
     header (src/nav.js): being signed in is global state, not a property of
     this view, and every page needs it. The save-error line stays, because a
     failed write IS about this panel's content. */
  const saveErr = document.createElement('p');
  saveErr.className = 'legend warn-text';
  saveErr.hidden = true;

  /* ── programme: pull + tree ── */
  const progGroup = group('Programme', { side: 'left' });
  createSync(progGroup, {
    cfg: ctx.cfg,
    get show() { return show; },
    online: isOnline,
    onApplied: () => ctx.reloadShow(),
    onNeedSignIn: () => openSignInDialog(() => ctx.reloadShow())
  });
  progGroup.appendChild(saveErr);
  const treeHost = document.createElement('div');
  treeHost.className = 'tree';
  progGroup.appendChild(treeHost);
  let tree = null;
  function renderTree() {
    tree = createTree(treeHost, {
      show,
      at: () => ctx.state.at,
      issues: stagingIssues(show),
      openActs,
      onSelect: at => { ctx.setAt(at); refresh(); }
    });
  }
  renderTree();

  /* ── the selected stage: what this row actually needs ──
     Right, not left, and first: it is an inspector for whatever the tree has
     selected, and you read it WHILE placing props. Below the tree it would sit
     under 64 rows of programme and never be seen. */
  const stageGroup = group('This stage');
  const stageBox = document.createElement('div');
  stageGroup.appendChild(stageBox);

  function renderStage() {
    const t = ctx.target?.();
    if (!t) { stageBox.innerHTML = ''; return; }

    const cue = t.cue, scene = t.scene;
    const bits = [];

    bits.push(`<p class="stage-title">${esc(
      t.scope === 'home' ? 'Home — the hall as built'
      : t.scope === 'sandbox' ? 'Sandbox — scratch stage'
      : cue ? cue.item : (scene?.name ?? 'Stage'))}</p>`);

    if (cue) {
      bits.push(`<p class="legend">${[scene?.code, scene?.name].filter(Boolean).map(esc).join(' · ')}</p>`);
      const meta = [cue.type, cue.live_prerec, cue.presenter, cue.final_status].filter(Boolean);
      if (meta.length) bits.push(`<p class="legend">${meta.map(m => `<span class="chip dim">${esc(m)}</span>`).join(' ')}</p>`);
      bits.push(patchIsEmpty(t.patch)
        ? `<p class="legend"><span class="chip dim">INHERITS</span> using the scene's set unchanged</p>`
        : `<p class="legend"><span class="chip accent">OWN CHANGES</span> this sub-state differs from the scene</p>`);
    } else if (scene) {
      bits.push(`<p class="legend"><span class="chip accent">SET</span> every sub-state below inherits this</p>`);
    }

    if (cue) {
      const matches = matchCueProps(cue, show.defs, show.aliases);
      if (matches.length) {
        const items = matches.map(m =>
          `<li><span class="chip ${m.def ? 'ok' : 'amber'}">${m.def ? '✓' : '⚠'}</span>
             <span class="area">${esc(m.areaLabel)}</span> ${esc(m.raw)}
             ${m.qty > 1 ? `<span class="soft">×${m.qty}</span>` : ''}
             ${m.def ? '' : '<span class="soft">not modelled</span>'}</li>`).join('');
        const missing = unmatched(matches).length;
        bits.push(`<h3>Props listed in the sheet</h3><ul class="proplist">${items}</ul>`);
        if (missing) bits.push(`<p class="legend">${missing} not modelled yet — open the workshop to build or map them.</p>`);
      } else {
        bits.push(`<p class="legend">No props listed for this row in the sheet.</p>`);
      }
      if (cue.led_item) bits.push(`<h3>LED / content</h3><p class="legend">${esc(cue.led_item)}</p>`);
    }
    stageBox.innerHTML = bits.join('');

    /* Edit mode needs a visible way in and out. It was only reachable by
       signing in (which opened it uninvited) or by hand-editing ?edit=1, and
       once the workshop's close button was pressed there was no way back at
       all. */
    if (canEdit()) {
      const editing = ctx.isEditing?.() ?? false;
      const toggle = btn(
        editing ? 'Done editing' : 'Edit this stage',
        () => { editing ? ctx.closeEditor?.() : ctx.openEditor?.(); },
        editing ? '' : 'accent');
      toggle.title = editing
        ? 'Close the prop workshop and go back to viewing'
        : 'Open the prop workshop for this stage';
      stageBox.appendChild(toggle);
      stageBox.appendChild(p(editing
        ? 'Editing — changes save as you work.'
        : 'Viewing.'));
    }

    /* Try an idea on a real set without risking the show: copy this stage into
       the sandbox and break it there. */
    if (canEdit() && (t.scope === 'scene' || t.scope === 'cue')) {
      const fork = btn('Try this in the sandbox', async () => {
        fork.disabled = true; fork.textContent = 'Copying…';
        try {
          const resolved = t.scope === 'cue'
            ? resolveStage(t.sceneBase, t.patch)
            : resolveStage(t.base, emptyPatch());
          await saveStageState({
            scope: 'sandbox', ref_id: null,
            base: { props: resolved.props.map(stripMarks), lighting: resolved.lighting, led: resolved.led },
            patch: emptyPatch()
          });
          await ctx.reloadShow();
          ctx.setAt('sandbox');
        } catch (e) {
          alert(`Could not copy to the sandbox.\n\n${e.message}`);
        } finally {
          fork.disabled = false; fork.textContent = 'Try this in the sandbox';
        }
      });
      stageBox.appendChild(fork);
    }
  }

  /* resolveStage tags where a placement came from; the sandbox is its own
     stage, so those tags would be lies once copied. */
  const stripMarks = ({ overridden, added, ...p }) => p;
  renderStage();

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
  roleGroup.appendChild(p('Links carry the role — send each team their own view.'));

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

  /* ── show mode — real lighting, dark venue ── */
  let syncSliders = () => {};
  if (ctx.parts.lighting && ctx.setShowMode) {
    const sm = group('Show mode');
    const sw = document.createElement('label');
    sw.className = 'row';
    sw.innerHTML = `<input type="checkbox" class="sw"><span>Show mode — lights as on the day</span>`;
    const swInp = sw.querySelector('input');
    swInp.checked = ctx.state.show3d;
    swInp.onchange = e => { ctx.setShowMode({ show3d: e.target.checked }); syncSliders(); };
    sm.appendChild(sw);

    const mk = (label, key, max) => {
      const l = document.createElement('label');
      l.className = 'slider';
      l.innerHTML = `<span>${label}</span><input type="range" min="0" max="${max}" step="0.01">`;
      const inp = l.querySelector('input');
      inp.value = ctx.state[key];
      inp.oninput = e => ctx.setShowMode({ [key]: Number(e.target.value) });
      sm.appendChild(l);
      return inp;
    };
    const hazeInp = mk('Haze', 'haze', 1);
    const houseInp = mk('House', 'house', 1);
    syncSliders = () => { hazeInp.value = ctx.state.haze; houseInp.value = ctx.state.house; };
    sm.appendChild(p('Haze previews what a hazer buys — beams in the air. House is the venue’s own lighting level. Both ride the link.'));
  }

  /* ── lighting checks ── */
  if (ctx.parts.lighting?.userData?.warnings) {
    const lc = group('Lighting checks');
    const warnings = ctx.parts.lighting.userData.warnings;
    if (warnings.length) {
      const ul = document.createElement('ul');
      ul.className = 'unconf';
      for (const w of warnings) {
        const li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      }
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

  /* ── toggles (collapsed — set once, rarely revisited) ── */
  const togGroup = group('Elements', { collapsible: true });
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
  /* One label per fixture reads fine on a four-lamp rig and not at all on
     thirty, so it is switchable and rides the link like everything else. */
  const beamRow = document.createElement('label');
  beamRow.className = 'row';
  beamRow.innerHTML = `<input type="checkbox" class="sw"><span>Beam cones</span>`;
  const beamInp = beamRow.querySelector('input');
  beamInp.checked = ctx.state.beams;
  beamInp.onchange = e => { ctx.setShowMode({ beams: e.target.checked }); };
  togGroup.appendChild(beamRow);

  const labelRow = document.createElement('label');
  labelRow.className = 'row';
  labelRow.innerHTML = `<input type="checkbox" class="sw"><span>Fixture labels</span>`;
  const labelInp = labelRow.querySelector('input');
  labelInp.checked = ctx.state.labels;
  labelInp.onchange = e => { ctx.setShowMode({ labels: e.target.checked }); };
  togGroup.appendChild(labelRow);

  const ghost = document.createElement('label');
  ghost.className = 'row';
  ghost.innerHTML = `<input type="checkbox" class="sw"><span>Ghost the cabin</span>`;
  ghost.querySelector('input').onchange = e => ctx.setGhostCabin(e.target.checked);
  togGroup.appendChild(ghost);

  const ko = document.createElement('label');
  ko.className = 'row';
  ko.innerHTML = `<input type="checkbox" class="sw"><span>Keep-out overlay on LED</span>`;
  const koInp = ko.querySelector('input');
  koInp.onchange = e => { ctx.led.setKeepout(e.target.checked); ctx.state.keepout = e.target.checked; ctx.onStateChange(); };
  togGroup.appendChild(ko);

  /* ── exports (collapsed) ── */
  if (ctx.exports && Object.keys(ctx.exports).length) {
    const ex = group('Exports', { collapsible: true });
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

  /* ── trial backdrops (collapsed) ── */
  const trialGroup = group('Trial backdrops', { collapsible: true });
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
      back.textContent = '← Back to stage content';
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

  /* ── reference (collapsed) — dimensions, unconfirmed, origin in one drawer ──
     All three are things you check occasionally and read never. */
  const ref = group('Reference — dimensions & confidence', { collapsible: true });

  const table = document.createElement('table');
  table.className = 'dims';
  const tb = document.createElement('tbody');
  table.appendChild(tb);
  ref.appendChild(table);
  ref.appendChild(p('Blue — measured on site. Grey — stated. Amber ⚠ — estimate, confirm before building.'));
  fillDims(tb, ctx.model);

  const ucHead = document.createElement('h3');
  ucHead.textContent = 'Unconfirmed — SPEC §10';
  ref.appendChild(ucHead);
  const ul = document.createElement('ul');
  ul.className = 'unconf';
  const flagged = Object.entries(ctx.model.conf)
    .filter(([, c]) => c === 'est' || c === 'approx')
    .filter(([k]) => ctx.model.notes[k]);
  for (const [k] of flagged) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="mono">${esc(k)}</span> — ${esc(ctx.model.notes[k])}`;
    ul.appendChild(li);
  }
  ref.appendChild(ul);

  const ogHead = document.createElement('h3');
  ogHead.textContent = 'Origin';
  ref.appendChild(ogHead);
  ref.appendChild(p(ctx.model.raw.venueRaw.meta.origin));

  /* ── helpers ── */
  /* `side` decides which dock a group lands in: 'left' is what you are working
     on (the programme, the selected stage), 'right' is how you are looking at
     it (roles, cameras, show mode, reference). */
  function group(title, { collapsible = false, open = false, side = 'right' } = {}) {
    const host = side === 'left' ? left : sheet;
    if (!collapsible) {
      const g = document.createElement('div');
      g.className = 'group';
      g.innerHTML = `<h2>${title}</h2>`;
      host.appendChild(g);
      return g;
    }
    const d = document.createElement('details');
    d.className = 'group collapsible';
    d.open = open;
    d.innerHTML = `<summary><h2>${title}</h2></summary>`;
    host.appendChild(d);
    return d;
  }

  function btn(label, onclick, cls = '') {
    const b = document.createElement('button');
    b.className = `view ${cls}`.trim();
    b.textContent = label;
    b.onclick = onclick;
    return b;
  }

  function refresh() {
    tabs.querySelectorAll('.tab').forEach(b => b.dataset.active = String(b.dataset.role === ctx.state.role));
    viewGroup.querySelectorAll('button[data-view]').forEach(b =>
      b.dataset.active = String(b.dataset.view === ctx.controls.activePreset));
    savedWrap.querySelectorAll('button[data-cv]').forEach(b =>
      b.dataset.active = String(!ctx.controls.activePreset && ctx.state.cv === b.dataset.cv));
    for (const [key, inp] of Object.entries(togInputs))
      inp.checked = partVisible(key, ctx.state.role, ctx.state.hide, ctx.state.show);
    koInp.checked = ctx.led.keepout;
    labelInp.checked = ctx.state.labels;
    beamInp.checked = ctx.state.beams;
    tree?.render();
    renderStage();
  }

  refresh();
  return {
    refresh,
    refreshTrials: renderTrials,
    setShow(next) { show = next; renderTree(); renderStage(); },
    setSaveError(msg) {
      saveErr.hidden = !msg;
      saveErr.textContent = msg ? `Not saved — ${msg}` : '';
    }
  };
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
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
