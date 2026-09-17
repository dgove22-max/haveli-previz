/* Prop workshop persistence — local to this browser, like saved views
   (SPEC §3: shared links show committed content). The committed
   data/props.json is the baseline; once the owner touches anything in
   ?edit=1 the whole doc is owned locally and autosaved here. "Download
   props.json" produces the file to commit; "Reset" drops the local copy. */
import { normalizeProps, serializeProps, DEFAULT_DOCS } from './schema.js';

const KEY = 'hp-props';

export function hasLocal() {
  try { return localStorage.getItem(KEY) != null; } catch { return false; }
}

/* Returns the working doc: the local copy if present, else the committed one
   normalised into the current shape. */
export function loadPropsDoc(committedRaw) {
  if (hasLocal()) {
    try {
      const doc = normalizeProps(JSON.parse(localStorage.getItem(KEY)));
      if (doc.definitions.length || doc.instances.length || committedEmpty(committedRaw)) return doc;
    } catch { /* corrupt — fall through to committed */ }
  }
  return normalizeProps(committedRaw);
}

const committedEmpty = raw =>
  !(raw?.props?.length || raw?.definitions?.length || raw?.instances?.length);

export function savePropsDoc(doc) {
  try { localStorage.setItem(KEY, JSON.stringify(serializeProps(doc, DEFAULT_DOCS))); }
  catch { /* private mode / quota — edits stay in memory for this session */ }
}

export function clearPropsDoc() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function downloadPropsJson(doc) {
  const blob = new Blob([JSON.stringify(serializeProps(doc, DEFAULT_DOCS), null, 2) + '\n'],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'props.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
