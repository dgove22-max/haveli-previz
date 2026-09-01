/* Owner-only editor (?edit=1) — crude by design (SPEC §3): quick numeric
   fields for the dimensions most likely to change, plus a JSON textarea
   per data file. No backend: Apply rebuilds the scene in place; Download
   saves the JSON to replace the file in data/ and commit. */
import { getPath } from '../model.js';

const QUICK = [
  ['venueRaw', 'cabin.width.v',        'Cabin width (m)'],
  ['venueRaw', 'cabin.height.v',       'Cabin height (m)'],
  ['venueRaw', 'curtains.top.v',       'Curtain top (m)'],
  ['venueRaw', 'led.baseAboveDeck.v',  'LED base above deck (m)'],
  ['venueRaw', 'forestage.height.v',   'Perf. stage height (m)'],
  ['venueRaw', 'coffer.spacingX.v',    'Coffer pitch X (m)'],
  ['venueRaw', 'coffer.spacingZ.v',    'Coffer pitch Z (m)'],
  ['venueRaw', 'coffer.soffit.v',      'Soffit height (m)']
];
const FILES = ['venueRaw', 'scenesRaw', 'propsRaw', 'lightingRaw'];
const NAMES = { venueRaw: 'venue.json', scenesRaw: 'scenes.json', propsRaw: 'props.json', lightingRaw: 'lighting.json' };

export function createEditor({ model, apply }) {
  const el = document.createElement('div');
  el.id = 'editor';
  el.innerHTML = `
    <h2>Editor — owner only</h2>
    <div class="qf"></div>
    <select class="file">${FILES.map(f => `<option value="${f}">${NAMES[f]}</option>`).join('')}</select>
    <textarea spellcheck="false"></textarea>
    <div class="err"></div>
    <div class="ebtns">
      <button class="apply">Apply</button>
      <button class="dl">Download JSON</button>
    </div>`;
  document.body.appendChild(el);

  const qf = el.querySelector('.qf');
  const ta = el.querySelector('textarea');
  const fileSel = el.querySelector('.file');
  const err = el.querySelector('.err');

  for (const [file, path, label] of QUICK) {
    const lab = document.createElement('span');
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.01';
    inp.value = getPath(model.raw[file], path);
    inp.onchange = () => {
      const raw = structuredClone(model.raw);
      setPath(raw[file], path, Number(inp.value));
      tryApply(raw);
    };
    qf.append(lab, inp);
  }

  function showFile() { ta.value = JSON.stringify(model.raw[fileSel.value], null, 2); err.textContent = ''; }
  fileSel.onchange = showFile;
  showFile();

  el.querySelector('.apply').onclick = () => {
    let parsed;
    try { parsed = JSON.parse(ta.value); }
    catch (e) { err.textContent = `JSON: ${e.message}`; return; }
    const raw = structuredClone(model.raw);
    raw[fileSel.value] = parsed;
    tryApply(raw);
  };

  el.querySelector('.dl').onclick = () => {
    const blob = new Blob([JSON.stringify(model.raw[fileSel.value], null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = NAMES[fileSel.value];
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  function tryApply(raw) {
    try { apply(raw); err.textContent = ''; showFile(); }
    catch (e) { err.textContent = `Apply failed: ${e.message}`; }
  }
}

function setPath(obj, path, v) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = v;
}
