/* LED-plan page — per-cue content plan for the wall, cross-referenced against
   the previz scene list so delivery status is visible at a glance. */
import { loadCueFeed, fmtClock } from '../cues.js';
import { createNav } from '../nav.js';

createNav('ledplan');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

let feed = null, scenes = {};
let query = '', ledOnly = false;

async function load() {
  const [f, sc] = await Promise.all([
    loadCueFeed(),
    fetch('data/scenes.json').then(r => r.json())
  ]);
  feed = f;
  scenes = Object.fromEntries(sc.scenes.map(s => [s.id, s]));
  render();
}

function status(c) {
  const sc = c.scene ? scenes[c.scene] : null;
  if (c.scene && !sc) return { chip: 'warn', label: 'UNKNOWN SCENE', title: `${c.scene} is not in data/scenes.json` };
  if (sc?.led) return { chip: 'ok', label: 'FILE LIVE', file: sc.led };
  if (c.led) return { chip: 'amber', label: 'PLANNED', file: c.led };
  return { chip: 'dim', label: 'PATTERN' };
}

function matches(c) {
  if (ledOnly && !c.led && !(c.scene && scenes[c.scene]?.led)) return false;
  if (!query) return true;
  return [c.cue, c.item, c.scene, c.led, c.props, c.lighting, c.notes, c.section]
    .join(' ').toLowerCase().includes(query);
}

function render() {
  const { sections, cues, source, error, fetchedAt } = feed;

  const st = cues.map(status);
  const live = st.filter(s => s.label === 'FILE LIVE').length;
  const planned = st.filter(s => s.label === 'PLANNED').length;
  const pattern = st.filter(s => s.label === 'PATTERN').length;
  $('stats').innerHTML = [
    ['Cues with LED', String(cues.length - pattern)],
    ['Files delivered', String(live)],
    ['Planned, not delivered', String(planned)],
    ['On test pattern', String(pattern)]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  const t = fetchedAt.toTimeString().slice(0, 5);
  $('src-note').innerHTML = source === 'sheet'
    ? `<span class="chip ok">LIVE · synced ${t}</span>`
    : `<span class="chip amber">SAMPLE DATA</span>${error ? ' — sheet unreachable' : ''}`;

  const head = `<tr><th>Cue</th><th>Clock</th><th>Item</th><th>Scene</th><th>Wall content</th><th>Props</th><th>Lighting</th><th>Notes</th></tr>`;
  const body = sections.map((s, i) => {
    const rows = s.cues.filter(matches);
    if (!rows.length) return '';
    return `<tr class="secrow"><td colspan="8">${String(i + 1).padStart(2, '0')} — ${esc(s.name)}</td></tr>` +
      rows.map(c => {
        const stt = status(c);
        return `<tr>
          <td class="num">${esc(c.cue)}</td>
          <td class="num">${fmtClock(c.startMin)}</td>
          <td><strong>${esc(c.item)}</strong></td>
          <td>${c.scene ? `<a class="chip meas" href="index.html?scene=${esc(c.scene)}&role=content&cam=seated-mid&keepout=1" title="${esc(scenes[c.scene]?.name ?? '')}">${esc(c.scene)}</a>` : '—'}</td>
          <td><span class="chip ${stt.chip}" ${stt.title ? `title="${esc(stt.title)}"` : ''}>${stt.label}</span>${stt.file ? ` <span class="file">${esc(stt.file)}</span>` : ''}</td>
          <td class="dim-cell">${esc(c.props) || '—'}</td>
          <td class="dim-cell">${esc(c.lighting) ? `<span class="file">${esc(c.lighting)}</span>` : '—'}</td>
          <td class="dim-cell">${esc(c.notes)}</td>
        </tr>`;
      }).join('');
  }).join('');
  $('grid').innerHTML = head + (body || `<tr><td colspan="8" class="dim-cell">No cues match.</td></tr>`);
}

$('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(); });
$('planned').onchange = e => { ledOnly = e.target.checked; render(); };
$('refresh').onclick = () => load();

load().catch(err => {
  $('grid').innerHTML = `<tr><td class="dim-cell">Failed: ${esc(err.message)} — serve over HTTP (see README).</td></tr>`;
});
