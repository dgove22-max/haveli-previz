/* Cue-sheet page — renders the shared cue feed (src/cues.js) as the master
   schedule: stat tiles, phase filters, search, section tables, TOC. */
import { loadCueFeed, fmtClock, fmtDur } from '../cues.js';
import { createNav } from '../nav.js';

createNav('cuesheet');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const PHASE_CHIP = { 'MSM': 'accent', 'MSM ENTRY': 'amber', 'PRE-MSM': 'dim', 'NO-MSM': 'dim' };
const phaseChip = ph => ph ? `<span class="chip ${PHASE_CHIP[ph] ?? 'dim'}">${esc(ph)}</span>` : '';

let feed = null;
let phase = 'ALL';
let query = '';

async function load() {
  feed = await loadCueFeed();
  render();
}

function matches(c) {
  if (phase !== 'ALL' && c.phase !== phase) return false;
  if (!query) return true;
  const hay = [c.cue, c.section, c.phase, c.item, c.type, c.presenters, c.audio,
               c.scene, c.led, c.props, c.lighting, c.notes].join(' ').toLowerCase();
  return hay.includes(query);
}

function render() {
  const { total, sections, phases, cfg, source, error, fetchedAt } = feed;

  $('eyebrow').textContent = `${cfg.title}${cfg.showDate ? ' · ' + cfg.showDate : ''}`;
  $('subline').textContent = `${cfg.venue}. One sheet drives this page, the LED plan and the scene links — edit it in Google Sheets, refresh here.`;

  /* source note + sheet link */
  const t = fetchedAt.toTimeString().slice(0, 5);
  $('src-note').innerHTML = source === 'sheet'
    ? `<span class="chip ok">LIVE · synced ${t}</span>`
    : `<span class="chip amber">SAMPLE DATA</span> ${error ? 'sheet unreachable — ' + esc(error) : 'no sheet configured yet (data/show.json)'}`;
  const os = $('opensheet');
  os.hidden = !cfg.cueSheetEditUrl;
  if (cfg.cueSheetEditUrl) os.href = cfg.cueSheetEditUrl;

  /* stats */
  $('stats').innerHTML = [
    ['Show runtime', fmtDur(total.runSec)],
    ['Cues', String(total.cues)],
    ['Sections', String(total.sections)],
    ['Doors → finish', `${fmtClock(total.startMin)} → ${fmtClock(total.endMin)}`]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  /* phase tabs */
  const phs = ['ALL', ...Object.keys(phases).filter(p => p !== '—')];
  $('phasetabs').innerHTML = phs.map(p =>
    `<button class="btn" type="button" data-phase="${esc(p)}" data-active="${p === phase}">${esc(p === 'ALL' ? 'All phases' : p)}</button>`).join('');
  $('phasetabs').querySelectorAll('button').forEach(b => {
    b.onclick = () => { phase = b.dataset.phase; render(); };
  });

  /* sections */
  $('sections').innerHTML = sections.map((s, i) => {
    const rows = s.cues.filter(matches);
    if (!rows.length) return '';
    return `<div class="card" id="sec-${i}">
      <div class="chead"><h2>${String(i + 1).padStart(2, '0')} · ${esc(s.name)}</h2>
        <span class="soft">${s.cues.length} cue${s.cues.length === 1 ? '' : 's'} · ${fmtDur(s.durSec)}</span>
        <span class="right">${phaseChip(s.phase)}</span></div>
      <div class="tscroll"><table class="cue">
        <tr><th>Cue</th><th>Start</th><th>Dur</th><th>Item</th><th>Type</th><th>Presenters</th><th>Audio</th><th>Scene</th><th>Notes</th></tr>
        ${rows.map(c => `<tr>
          <td class="num">${esc(c.cue)}</td>
          <td class="num">${fmtClock(c.startMin)}</td>
          <td class="num">${esc(c.dur) || '—'}</td>
          <td><strong>${esc(c.item)}</strong></td>
          <td class="dim-cell">${esc(c.type)}</td>
          <td class="dim-cell">${esc(c.presenters)}</td>
          <td class="dim-cell">${esc(c.audio)}</td>
          <td>${c.scene ? `<a class="chip meas" href="index.html?scene=${esc(c.scene)}&cam=seated-mid">${esc(c.scene)}</a>` : '—'}</td>
          <td class="dim-cell">${esc(c.notes)}</td>
        </tr>`).join('')}
      </table></div>
    </div>`;
  }).join('') || '<p class="soft">No cues match.</p>';

  /* toc + phases */
  $('toc').innerHTML = sections.map((s, i) =>
    `<li><a href="#sec-${i}"><span class="n">${i + 1}</span> ${esc(s.name)} ${phaseChip(s.phase)}</a></li>`).join('');
  $('phases').innerHTML = Object.entries(phases).filter(([k]) => k !== '—').map(([k, v]) =>
    `<div class="phrow"><span>${phaseChip(k)}</span><span class="mono">${v.cues} cues · ${fmtDur(v.durSec)}</span></div>`).join('');
}

$('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(); });
$('refresh').onclick = () => load();

load().catch(err => {
  $('subline').innerHTML = `<span class="chip warn">FAILED</span> ${esc(err.message)} — serve over HTTP (see README).`;
});
