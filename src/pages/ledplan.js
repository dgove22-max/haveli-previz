/* LED-plan page — what goes on the wall, per sub-state, and whether it exists.

   Three sources have to agree before a cue's wall content is real:
   the content team's LED tracker tab says it is planned, the programme tracker
   says which row it belongs to, and the previz says a file has actually been
   assigned to that stage. This page shows all three side by side so the gap is
   obvious rather than discovered in the room. */
import { createNav } from '../nav.js';
import { initSupabase, isOnline, offlineReason } from '../data/supabase.js';
import { initAuth } from '../auth.js';
import { loadShow } from '../data/showdb.js';
import { resolveStage, emptyBase, emptyPatch } from '../stagestate.js';

createNav('ledplan');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

let show = null, cfg = {};
let query = '', ledOnly = false;

async function load() {
  await initSupabase();
  await initAuth();
  [show, cfg] = await Promise.all([
    loadShow(),
    fetch('data/show.json').then(r => r.json()).catch(() => ({}))
  ]);
  render();
}

/* The file actually assigned to this cue's stage, scene inheritance included. */
function assignedLed(cue) {
  const sceneBase = show.states.get(`scene:${cue.scene_id}`)?.base ?? emptyBase();
  const own = show.states.get(`cue:${cue.id}`);
  return resolveStage(sceneBase, own?.patch ?? emptyPatch()).led ?? null;
}

function status(cue) {
  const file = assignedLed(cue);
  if (file) return { chip: 'ok', label: 'FILE ASSIGNED', file };
  if (cue.led_item) {
    const st = cue.led_meta?.status;
    return {
      chip: 'amber', label: 'PLANNED', file: cue.led_item,
      title: st ? `Content tracker: ${st}` : 'Listed in the content tracker, no file assigned here yet'
    };
  }
  return { chip: 'dim', label: 'PATTERN' };
}

const matches = (cue, scene) => {
  if (ledOnly && !cue.led_item && !assignedLed(cue)) return false;
  if (!query) return true;
  return [cue.item, cue.type, cue.led_item, cue.presenter, scene?.code, scene?.name,
          cue.led_meta?.status, cue.led_meta?.assigned]
    .join(' ').toLowerCase().includes(query);
};

function render() {
  if (!isOnline()) {
    const why = offlineReason();
    $('src-note').innerHTML = `<span class="chip amber">OFFLINE</span> ${
      why === 'unconfigured' ? 'no show database configured' : 'database unreachable'}`;
  } else {
    const when = show.snapshotAt
      ? new Date(show.snapshotAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';
    $('src-note').innerHTML = show.cues.length
      ? `<span class="chip ok">LIVE</span> synced ${esc(when)}`
      : `<span class="chip amber">EMPTY</span> pull the sheet in the stage view`;
  }

  const st = show.cues.map(status);
  $('stats').innerHTML = [
    ['Sub-states', String(show.cues.length)],
    ['Files assigned', String(st.filter(s => s.label === 'FILE ASSIGNED').length)],
    ['Planned, not assigned', String(st.filter(s => s.label === 'PLANNED').length)],
    ['On test pattern', String(st.filter(s => s.label === 'PATTERN').length)]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  const head = `<tr><th>Act</th><th>Scene</th><th>Sub-state</th><th>Type</th>
    <th>Wall content</th><th>Owner</th><th>Stage</th></tr>`;

  const body = show.acts.map((act, i) => {
    const rows = [];
    for (const scene of show.scenes.filter(s => s.act_id === act.id)) {
      for (const cue of show.cues.filter(c => c.scene_id === scene.id)) {
        if (!matches(cue, scene)) continue;
        const s = status(cue);
        rows.push(`<tr>
          <td class="dim-cell">—</td>
          <td>${scene.code ? `<span class="chip meas">${esc(scene.code)}</span> ` : ''}${esc(scene.name)}</td>
          <td><strong>${esc(cue.item)}</strong></td>
          <td class="dim-cell">${esc(cue.type)}</td>
          <td><span class="chip ${s.chip}"${s.title ? ` title="${esc(s.title)}"` : ''}>${s.label}</span>${
            s.file ? ` <span class="file">${esc(s.file)}</span>` : ''}</td>
          <td class="dim-cell">${esc(cue.led_meta?.assigned ?? '')}</td>
          <td><a class="chip meas" href="index.html?at=cue:${encodeURIComponent(cue.id)}&role=content&cam=seated-mid&keepout=1">open ↗</a></td>
        </tr>`);
      }
    }
    if (!rows.length) return '';
    return `<tr class="secrow"><td colspan="7">${String(i + 1).padStart(2, '0')} — ${
      esc(act.name.replace(/\n/g, ' '))}</td></tr>` + rows.join('');
  }).join('');

  $('grid').innerHTML = head + (body ||
    `<tr><td colspan="7" class="dim-cell">${
      show.cues.length ? 'No rows match.' : 'No programme loaded — pull the sheet in the stage view.'
    }</td></tr>`);
}

$('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(); });
$('planned').onchange = e => { ledOnly = e.target.checked; render(); };
$('refresh').onclick = () => load();

load().catch(err => {
  $('grid').innerHTML = `<tr><td class="dim-cell">Failed: ${esc(err.message)} — serve over HTTP (see README).</td></tr>`;
  console.error(err);
});
