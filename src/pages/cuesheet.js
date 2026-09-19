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
import { createSync, stagingIssues } from '../ui/sync.js';
import { scheduleFromAllocations } from '../sheets/schedule.js';
import { openSignInDialog } from '../ui/signin.js';

const nav = createNav('cuesheet');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/* Times come out as 19:04:00 and allocations as 00:55. Trim the seconds off
   clock times so the column scans, but keep durations as-is — most are under a
   minute and "00:55" says more than "1m" rounded. */
const hhmm = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};
const dur = d => String(d ?? '').trim().replace(/^00:/, '').replace(/^0/, '') || '';

/* Total a scene or act by its first start and last end, which survives rows
   that carry no time of their own. */
function span(list) {
  const starts = list.map(c => hhmm(c.start_time)).filter(Boolean);
  const ends = list.map(c => hhmm(c.end_time)).filter(Boolean);
  if (!starts.length) return '';
  return `${starts[0]} → ${ends.length ? ends[ends.length - 1] : '—'}`;
}

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
  nav.paintAuth();          // built before the client existed — see nav.js
  [show, cfg] = await Promise.all([
    loadShow(),
    fetch('data/show.json').then(r => r.json()).catch(() => ({}))
  ]);
  /* The master tracker keeps only allocations now, so the times are added up
     from those rather than read from its broken Start and End formulas. */
  show.cues = scheduleFromAllocations(show.cues, cfg.startsAt);
  issues = stagingIssues(show);
  mountSync();
  render();
}

/* Pull lives here as well as on the stage page — arguably more naturally here,
   since this IS the programme. Both mount the same component. */
let syncMounted = false;
function mountSync() {
  if (syncMounted) return;
  syncMounted = true;
  const host = $('sync-host');
  if (!host) return;
  createSync(host, {
    cfg,
    get show() { return show; },
    online: isOnline,
    onApplied: async () => { await load(); },
    onNeedSignIn: () => openSignInDialog(() => load())
  });
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
    ? `${cfg.venue}. Rough timings added up from the sheet's allocations — click any row for what it needs on stage.`
    : "Rough timings added up from the sheet's allocations — click any row for what it needs on stage.";

  /* Connection state is the sync component's job — it already shows OFFLINE /
     NEVER PULLED / SYNCED with the timestamp, and printing it twice in one
     toolbar just made the row noisy. */

  const os = $('opensheet');
  os.hidden = !cfg.tracker?.editUrl;
  if (cfg.tracker?.editUrl) os.href = cfg.tracker.editUrl;

  /* stats */
  const backlog = new Set();
  for (const c of show.cues) for (const m of unmatched(matchCueProps(c, show.defs, show.aliases))) backlog.add(m.norm);
  const allSpan = span(show.cues);
  $('stats').innerHTML = [
    ['Acts', String(show.acts.length)],
    ['Scenes', String(show.scenes.length)],
    ['Sub-states', String(show.cues.length)],
    ['Doors → finish', allSpan || '—'],
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
          ? 'Press <strong>Pull from sheet</strong> above to load the tracker.'
          : 'Not connected to the show database — see data/supabase.json.'}
      </p></div>`;
    $('toc').innerHTML = '';
    $('flags').innerHTML = '';
    return;
  }

  /* acts → scenes → cues, as one schedule per act.

     ONE table per act, not one per scene. Each scene used to render its own
     table, so every table sized its columns independently and Type, Source and
     Presenter landed in a different place in each block — the page staggered
     down the screen. A single table with fixed layout makes the columns a
     property of the act, and the shared colgroup widths carry that across acts
     too, so the whole page reads down one set of rules.

     Scene stays prominent: it gets a full-width row of its own rather than
     being demoted to a cell, because it is the unit the set changes on. */
  const COLS = `<colgroup>
      <col class="c-start"><col class="c-dur"><col class="c-item">
      <col class="c-type"><col class="c-src"><col class="c-pres"><col class="c-stage">
    </colgroup>`;
  const HEAD = `<tr class="hrow">
      <th>Start</th><th>Dur</th><th>Sub-state</th>
      <th>Type</th><th>Source</th><th>Presenter</th><th>Stage</th>
    </tr>`;

  /* Number over acts that actually render. An act filtered out or genuinely
     empty used to keep its number, leaving a hole — 08 followed by 10 — which
     reads as a missing act rather than an absent one. */
  let shownActs = 0;
  const rendered = [];                 // acts that produced a card, in card order
  $('sections').innerHTML = show.acts.map(act => {
    const scenes = show.scenes.filter(s => s.act_id === act.id);
    const actCues = show.cues.filter(c => scenes.some(s => s.id === c.scene_id));

    const body = scenes.map(scene => {
      const cues = show.cues.filter(c => c.scene_id === scene.id);
      const shown = cues.filter(matches);
      if (!shown.length) return '';
      return `<tr class="scene-row"><td colspan="7">
          ${scene.code ? `<span class="chip meas">${esc(scene.code)}</span>` : ''}
          <strong>${esc(scene.name)}</strong>
          <span class="soft">${cues.length} sub-state${cues.length === 1 ? '' : 's'}</span>
          ${span(cues) ? `<span class="scene-span mono">${esc(span(cues))}</span>` : ''}
          <a class="chip dim" href="index.html?at=scene:${encodeURIComponent(scene.id)}&cam=seated-mid"
             title="Open the scene's set in the previz">set ↗</a>
        </td></tr>
        ${shown.map(c => cueRow(c)).join('')}`;
    }).join('');

    if (!body) return '';
    const i = shownActs++;
    rendered.push(act);
    return `<div class="card" id="act-${i}">
      <div class="chead">
        <h2>${String(i + 1).padStart(2, '0')} · ${esc(act.name.replace(/\n/g, ' '))}</h2>
        <span class="soft">${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ${actCues.length} sub-states</span>
        ${span(actCues) ? `<span class="right mono soft">${esc(span(actCues))}</span>` : ''}
      </div>
      <div class="tscroll"><table class="cue sched">${COLS}${HEAD}${body}</table></div>
    </div>`;
  }).join('') || '<p class="soft">Nothing matches.</p>';

  wireRows();

  /* sidebar — built from the acts that actually rendered, so its numbers and
     its anchors both match the cards. Listing a filtered-out act here would
     give you a link that scrolls nowhere. */
  $('toc').innerHTML = rendered.map((a, i) =>
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
  return `<tr class="cue-row" data-cue="${esc(c.id)}" data-open="${open}">
      <td class="num mono">${esc(hhmm(c.start_time)) || '<span class="soft">—</span>'}</td>
      <td class="num mono soft">${c.no_allocation
        ? '<span class="chip amber" title="No allocation in the sheet — counted as zero">?</span>'
        : esc(dur(c.duration))}</td>
      <td>
        <button class="cue-name" data-toggle="${esc(c.id)}" aria-expanded="${open}">
          <span class="tw">${open ? '▾' : '▸'}</span><strong>${esc(c.item)}</strong>
        </button>
        ${iss ? `<span class="chip amber" title="${esc(iss.reason)}">⚠ needs staging</span>` : ''}
      </td>
      <td>${c.type ? `<span class="chip ${TYPE_CHIP[c.type] ?? 'dim'}">${esc(c.type)}</span>` : ''}</td>
      <td>${c.live_prerec ? `<span class="chip dim">${esc(c.live_prerec)}</span>` : ''}</td>
      <td class="dim-cell">${esc(c.presenter)}</td>
      <td><a class="chip meas" href="index.html?at=cue:${encodeURIComponent(c.id)}&cam=seated-mid">open ↗</a></td>
    </tr>
    ${open ? `<tr class="detail-row"><td colspan="7"><div class="cue-detail">${cueDetail(c)}</div></td></tr>` : ''}`;
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
      document.querySelector(`tr[data-cue="${CSS.escape(id)}"]`)?.scrollIntoView(
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
