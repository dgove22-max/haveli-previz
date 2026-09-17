/* Cue sheet — the running order, and the show-day view.

   Deliberately has NO clock and no countdown. The brief was explicit: things
   get cut on the day, so a fixed schedule would start lying the moment anything
   changed, and a wrong time on a screen during a show is worse than no time.
   What you need mid-show is "what does this row need", so that is what a row
   opens: props by stage area, the lighting state, the LED content, and a way
   into the 3D stage.

   Reads the accepted programme from the show database — the same rows the
   previz navigates — so the two can never drift apart. */
import { createNav } from '../nav.js';
import { initSupabase, isOnline, offlineReason } from '../data/supabase.js';
import { initAuth } from '../auth.js';
import { loadShow } from '../data/showdb.js';
import { matchCueProps, unmatched } from '../propmatch.js';
import { resolveStage, emptyBase, emptyPatch, patchIsEmpty } from '../stagestate.js';
import { stagingIssues } from '../ui/sync.js';

createNav('cuesheet');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const TYPE_CHIP = {
  'Musical': 'accent', 'Gun Grahan': 'amber', 'Jingle': 'dim',
  'MSM Live': 'ok', 'MSM Action': 'ok', 'Drama Pre-rec': 'dim',
  'Compere': 'dim', 'Video': 'dim'
};

let show = null, cfg = {}, issues = new Map();
let query = '';
let typeFilter = 'ALL';
const expanded = new Set();

async function load() {
  await initSupabase();
  await initAuth();
  [show, cfg] = await Promise.all([
    loadShow(),
    fetch('data/show.json').then(r => r.json()).catch(() => ({}))
  ]);
  issues = stagingIssues(show);
  render();
}

/* The resolved stage for a cue: its scene's set, plus its own patch. */
function stageFor(cue) {
  const sceneBase = show.states.get(`scene:${cue.scene_id}`)?.base ?? emptyBase();
  const own = show.states.get(`cue:${cue.id}`);
  return {
    resolved: resolveStage(sceneBase, own?.patch ?? emptyPatch()),
    inherits: patchIsEmpty(own?.patch)
  };
}

const matches = cue => {
  if (typeFilter !== 'ALL' && cue.type !== typeFilter) return false;
  if (!query) return true;
  const scene = show.scenes.find(s => s.id === cue.scene_id);
  return [cue.item, cue.type, cue.presenter, cue.live_prerec, cue.sr_prop, cue.sl_prop,
          cue.centre_prop, cue.canopy, cue.led_item, scene?.code, scene?.name]
    .join(' ').toLowerCase().includes(query);
};

function render() {
  $('eyebrow').textContent = `${cfg.title ?? 'Show'}${cfg.showDate ? ' · ' + cfg.showDate : ''}`;
  $('subline').textContent = cfg.venue
    ? `${cfg.venue}. Click any row to see what it needs on stage.`
    : 'Click any row to see what it needs on stage.';

  /* connection state */
  if (!isOnline()) {
    const why = offlineReason();
    $('src-note').innerHTML = `<span class="chip amber">OFFLINE</span> ${
      why === 'unconfigured' ? 'no show database configured' : 'database unreachable'}`;
  } else if (!show.cues.length) {
    $('src-note').innerHTML = `<span class="chip amber">EMPTY</span> pull the sheet in the stage view`;
  } else {
    const when = show.snapshotAt
      ? new Date(show.snapshotAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';
    $('src-note').innerHTML = `<span class="chip ok">LIVE</span> synced ${esc(when)}`;
  }

  const os = $('opensheet');
  os.hidden = !cfg.tracker?.editUrl;
  if (cfg.tracker?.editUrl) os.href = cfg.tracker.editUrl;

  /* stats */
  const backlog = new Set();
  for (const c of show.cues) for (const m of unmatched(matchCueProps(c, show.defs, show.aliases))) backlog.add(m.norm);
  $('stats').innerHTML = [
    ['Acts', String(show.acts.length)],
    ['Scenes', String(show.scenes.length)],
    ['Sub-states', String(show.cues.length)],
    ['Props to model', String(backlog.size)]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  /* type filter */
  const types = [...new Set(show.cues.map(c => c.type).filter(Boolean))].sort();
  $('phasetabs').innerHTML = ['ALL', ...types].map(t =>
    `<button class="btn" type="button" data-type="${esc(t)}" data-active="${t === typeFilter}">${
      esc(t === 'ALL' ? 'All types' : t)}</button>`).join('');
  $('phasetabs').querySelectorAll('button').forEach(b => {
    b.onclick = () => { typeFilter = b.dataset.type; render(); };
  });

  if (!show.acts.length) {
    $('sections').innerHTML = `<div class="card"><div class="chead"><h2>No programme loaded</h2></div>
      <p class="legend" style="padding:0 16px 16px">
        ${isOnline()
          ? 'Open the stage view and press <strong>Pull from sheet</strong> to load the tracker.'
          : 'Not connected to the show database — see data/supabase.json.'}
      </p></div>`;
    $('toc').innerHTML = '';
    $('flags').innerHTML = '';
    return;
  }

  /* acts → scenes → cues */
  $('sections').innerHTML = show.acts.map((act, i) => {
    const scenes = show.scenes.filter(s => s.act_id === act.id);
    const rows = scenes.map(scene => {
      const cues = show.cues.filter(c => c.scene_id === scene.id && matches(c));
      if (!cues.length) return '';
      return `<div class="scene-block">
        <div class="scene-head">
          ${scene.code ? `<span class="chip meas">${esc(scene.code)}</span>` : ''}
          <strong>${esc(scene.name)}</strong>
          <a class="chip dim" href="index.html?at=scene:${encodeURIComponent(scene.id)}&cam=seated-mid"
             title="Open the scene's set in the previz">set ↗</a>
        </div>
        ${cues.map(c => cueRow(c)).join('')}
      </div>`;
    }).join('');
    if (!rows) return '';
    return `<div class="card" id="act-${i}">
      <div class="chead"><h2>${esc(act.name.replace(/\n/g, ' '))}</h2>
        <span class="soft">${scenes.length} scene${scenes.length === 1 ? '' : 's'}</span></div>
      <div class="act-body">${rows}</div>
    </div>`;
  }).join('') || '<p class="soft">Nothing matches.</p>';

  wireRows();

  /* sidebar */
  $('toc').innerHTML = show.acts.map((a, i) =>
    `<li><a href="#act-${i}"><span class="n">${i + 1}</span> ${esc(a.name.replace(/\n/g, ' '))}</a></li>`).join('');

  const flagged = [...issues.entries()];
  $('flags').innerHTML = flagged.length
    ? flagged.slice(0, 20).map(([id, iss]) => {
        const c = show.cues.find(x => x.id === id);
        return `<div class="phrow"><a href="index.html?at=cue:${encodeURIComponent(id)}&edit=1">${
          esc(c?.item ?? id)}</a><span class="chip amber">⚠</span></div>`;
      }).join('')
    : '<p class="legend" style="padding:6px 16px">Every row with props in the sheet has been staged.</p>';
}

function cueRow(c) {
  const open = expanded.has(c.id);
  const iss = issues.get(c.id);
  return `<div class="cue-item" data-cue="${esc(c.id)}">
    <button class="cue-head" data-toggle="${esc(c.id)}" aria-expanded="${open}">
      <span class="tw">${open ? '▾' : '▸'}</span>
      <span class="nm">${esc(c.item)}</span>
      ${c.type ? `<span class="chip ${TYPE_CHIP[c.type] ?? 'dim'}">${esc(c.type)}</span>` : ''}
      ${c.live_prerec ? `<span class="chip dim">${esc(c.live_prerec)}</span>` : ''}
      ${iss ? `<span class="chip amber" title="${esc(iss.reason)}">⚠ needs staging</span>` : ''}
    </button>
    ${open ? `<div class="cue-detail">${cueDetail(c)}</div>` : ''}
  </div>`;
}

function cueDetail(c) {
  const { resolved, inherits } = stageFor(c);
  const props = matchCueProps(c, show.defs, show.aliases);
  const lightsOn = Object.entries(resolved.lighting ?? {}).filter(([, v]) => v?.on !== false).length;

  const sheetProps = props.length
    ? `<ul class="proplist">${props.map(m => `<li>
         <span class="chip ${m.def ? 'ok' : 'amber'}">${m.def ? '✓' : '⚠'}</span>
         <span class="area">${esc(m.areaLabel)}</span>
         <span>${esc(m.raw)}${m.qty > 1 ? ` <span class="soft">×${m.qty}</span>` : ''}</span>
         ${m.def ? '' : '<span class="soft">not modelled</span>'}</li>`).join('')}</ul>`
    : '<p class="legend">No props listed in the sheet for this row.</p>';

  return `
    <div class="dgrid">
      <div>
        <h3>Props — from the sheet</h3>
        ${sheetProps}
      </div>
      <div>
        <h3>On stage in the model</h3>
        <p class="legend">${resolved.props.length
          ? `${resolved.props.length} prop${resolved.props.length === 1 ? '' : 's'} placed`
          : 'Nothing placed yet'} ·
          ${inherits ? '<span class="chip dim">inherits the scene</span>'
                     : '<span class="chip accent">own changes</span>'}</p>
        <h3>Lighting</h3>
        <p class="legend">${lightsOn ? `${lightsOn} fixture${lightsOn === 1 ? '' : 's'} in this state` : 'Default rig'}</p>
        ${resolved.led || c.led_item ? `<h3>LED / content</h3>
          <p class="legend">${esc(resolved.led ?? c.led_item)}</p>` : ''}
        ${c.presenter ? `<h3>Presenter</h3><p class="legend">${esc(c.presenter)}</p>` : ''}
      </div>
    </div>
    <div class="dactions">
      <a class="btn" href="index.html?at=cue:${encodeURIComponent(c.id)}&cam=seated-mid">Open stage view ↗</a>
      <a class="btn" href="index.html?at=cue:${encodeURIComponent(c.id)}&edit=1">Edit this stage ↗</a>
    </div>`;
}

function wireRows() {
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.toggle;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      render();
      document.querySelector(`[data-cue="${CSS.escape(id)}"] .cue-head`)?.scrollIntoView(
        { block: 'nearest', behavior: 'smooth' });
    };
  });
}

$('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(); });
$('refresh').onclick = () => load();

load().catch(err => {
  $('subline').innerHTML = `<span class="chip warn">FAILED</span> ${esc(err.message)} — serve over HTTP (see README).`;
  console.error(err);
});
