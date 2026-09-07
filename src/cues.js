/* Cue feed — one Google Sheet (or the bundled sample CSV) drives both the
   cue-sheet and LED-plan pages. Parsing and time maths are pure functions,
   tested in test/cues.test.js.

   Column schema (the published sheet must use these headers, any order):
   cue,section,phase,start,dur,item,type,presenters,audio,scene,led,props,lighting,notes
   - start "17:00" (blank = follows on from the previous cue's end)
   - dur   "5m" "30s" "7m30s" "1h"
   - scene sNN matching data/scenes.json — links the row into the previz */

/* ── CSV ── (RFC-ish: quoted fields, embedded commas/quotes/newlines) */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

/* ── time maths ── */
export function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export function durToSec(s) {
  const t = (s ?? '').trim().toLowerCase();
  if (!t) return 0;
  let sec = 0, matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let m;
  while ((m = re.exec(t))) { matched = true; sec += Number(m[1]) * { h: 3600, m: 60, s: 1 }[m[2]]; }
  if (!matched && /^\d+(\.\d+)?$/.test(t)) return Number(t) * 60;  // bare number = minutes
  return sec;
}
export const fmtClock = min => min == null ? '—'
  : `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
export function fmtDur(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.round(sec % 60);
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
}

/* ── rows → cues ── */
export function parseCues(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const idx = name => head.indexOf(name);
  return rows.slice(1).map(r => {
    const get = name => (r[idx(name)] ?? '').trim();
    return {
      cue: get('cue'), section: get('section'), phase: get('phase').toUpperCase(),
      start: get('start'), dur: get('dur'), item: get('item'), type: get('type'),
      presenters: get('presenters'), audio: get('audio'),
      scene: get('scene'), led: get('led'), props: get('props'),
      lighting: get('lighting'), notes: get('notes')
    };
  }).filter(c => c.item || c.cue);
}

/* ── schedule: fill blank starts, compute ends and totals ── */
export function schedule(cues) {
  let clock = null;
  const out = cues.map(c => {
    const explicit = hhmmToMin(c.start);
    const startMin = explicit ?? clock;
    const durSec = durToSec(c.dur);
    const endMin = startMin == null ? null : startMin + durSec / 60;
    if (endMin != null) clock = endMin;
    return { ...c, startMin, durSec, endMin };
  });

  const sections = [];
  for (const c of out) {
    let s = sections[sections.length - 1];
    if (!s || s.name !== (c.section || s.name)) {
      if (!s || c.section && s.name !== c.section) {
        s = { name: c.section || 'UNSECTIONED', cues: [], durSec: 0, phase: c.phase };
        sections.push(s);
      }
    }
    s.cues.push(c); s.durSec += c.durSec;
    if (c.phase && !s.phase) s.phase = c.phase;
  }

  const timed = out.filter(c => c.startMin != null);
  const first = timed[0], last = timed[timed.length - 1];
  const phases = {};
  for (const c of out) {
    const k = c.phase || '—';
    phases[k] = phases[k] || { cues: 0, durSec: 0 };
    phases[k].cues++; phases[k].durSec += c.durSec;
  }
  return {
    cues: out, sections, phases,
    total: { cues: out.length, sections: sections.length,
             startMin: first?.startMin ?? null, endMin: last?.endMin ?? null,
             runSec: out.reduce((a, c) => a + c.durSec, 0) }
  };
}

/* ── feed loader: published Google Sheet CSV, else the bundled sample ── */
export async function loadCueFeed() {
  const cfg = await fetch('data/show.json').then(r => r.json());
  let source = 'sample', text = null, error = null;
  if (cfg.cueSheetCsvUrl) {
    try {
      const r = await fetch(cfg.cueSheetCsvUrl, { redirect: 'follow' });
      if (!r.ok) throw new Error(`sheet fetch ${r.status}`);
      text = await r.text();
      source = 'sheet';
    } catch (e) { error = e.message; }
  }
  if (text == null) text = await fetch('data/cues.csv').then(r => r.text());
  const sched = schedule(parseCues(text));
  return { ...sched, cfg, source, error, fetchedAt: new Date() };
}
