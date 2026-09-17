/* The LED / content tracker tab.

   Separate from the programme tracker and joined to it on Item Name, because
   that is the only key the two share — the content team's tab has no act or
   scene codes. The join is therefore best-effort by design: it enriches cues
   that match and silently leaves the rest alone. A cue with no LED row is not
   an error, it just means content has not been logged for it yet.

   Deliberately never fails the pull. If this tab is renamed or moved, the
   programme still loads; you lose the LED column, not the show. */

import { parseCsv } from '../cues.js';
import { csvUrl } from './tracker.js';

const norm = s => String(s ?? '')
  .toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const YES = v => /^(y|yes|true|1|✓)$/i.test(String(v ?? '').trim());

export function parseLedTracker(csvText) {
  const rows = parseCsv(csvText);
  const headAt = rows.findIndex(r => r.some(c => /item\s*name/i.test(c)));
  if (headAt < 0) throw new Error('LED tracker: no "Item Name" column found.');
  const head = rows[headAt].map(h => String(h ?? '').trim());
  const at = re => head.findIndex(h => re.test(h));

  const col = {
    name: at(/item\s*name/i), audio: at(/^audio$/i), image: at(/^image$/i),
    video: at(/^video$/i), alpha: at(/side\s*screen/i), led: at(/^led$/i),
    desc: at(/item\s*description/i), status: at(/^status$/i),
    assigned: at(/assigned/i), priority: at(/^priority$/i)
  };

  const out = [];
  for (const r of rows.slice(headAt + 1)) {
    const g = i => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const name = g(col.name);
    if (!name || /^#REF!$/i.test(name)) continue;
    out.push({
      name, key: norm(name),
      audio: YES(g(col.audio)), image: YES(g(col.image)),
      video: YES(g(col.video)), alpha: YES(g(col.alpha)), led: YES(g(col.led)),
      description: g(col.desc), status: g(col.status),
      assigned: g(col.assigned), priority: g(col.priority)
    });
  }
  return out;
}

/* Attach the matching LED row to each cue. Returns new cue objects. */
export function joinLed(cues, ledRows) {
  const byKey = new Map();
  for (const row of ledRows) if (row.key && !byKey.has(row.key)) byKey.set(row.key, row);
  return cues.map(c => {
    const hit = byKey.get(norm(c.item));
    return hit ? { ...c, led_item: hit.name, led_meta: hit } : c;
  });
}

export async function fetchLedTracker({ sheetId, gid }) {
  const res = await fetch(csvUrl(sheetId, gid), { redirect: 'follow' });
  if (!res.ok) throw new Error(`LED tracker fetch failed (${res.status})`);
  return parseLedTracker(await res.text());
}
