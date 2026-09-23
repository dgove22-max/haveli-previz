/* What changed in the sheet since we last accepted it.

   Pull is manual and nothing is applied without being shown first, so this has
   to be readable by a person deciding whether to accept — not just correct.
   Hence field-level changes with before/after rather than a bare "12 rows
   differ".

   Reordering is reported separately from content changes. Moving a cue up the
   running order is a real change worth seeing, but it is not the same kind of
   event as renaming it, and lumping them together makes a reshuffle look like
   the whole show was rewritten. */

const KIND_LABEL = { acts: 'Act', scenes: 'Scene', cues: 'Cue' };

/* Fields compared for content changes. `sort` is deliberately absent — it is
   handled as reordering. */
const FIELDS = {
  acts: ['name'],
  scenes: ['act_id', 'code', 'name'],
  cues: ['scene_id', 'item', 'type', 'type_detail', 'live_prerec', 'presenter',
         'final_status', 'sr_prop', 'sl_prop', 'centre_prop', 'canopy']
};

const labelOf = (kind, row) =>
  kind === 'cues' ? (row.item || row.id)
    : kind === 'scenes' ? [row.code, row.name].filter(Boolean).join(' · ')
      : (row.name || row.id);

const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();

export function diffProgramme(prev, next) {
  const out = { kinds: {}, reordered: [], total: 0 };
  const empty = { acts: [], scenes: [], cues: [] };
  const before = prev ?? empty;

  for (const kind of ['acts', 'scenes', 'cues']) {
    const a = new Map((before[kind] ?? []).map(r => [r.id, r]));
    const b = new Map((next[kind] ?? []).map(r => [r.id, r]));

    const added = [], removed = [], changed = [];

    for (const [id, row] of b) {
      if (!a.has(id)) { added.push({ id, label: labelOf(kind, row), row }); continue; }
      const was = a.get(id);
      const fields = FIELDS[kind]
        .filter(f => norm(was[f]) !== norm(row[f]))
        .map(f => ({ field: f, from: norm(was[f]), to: norm(row[f]) }));
      if (fields.length) changed.push({ id, label: labelOf(kind, row), fields, row });
      if ((was.sort ?? -1) !== (row.sort ?? -1)) {
        out.reordered.push({ kind, id, label: labelOf(kind, row), from: was.sort, to: row.sort });
      }
    }
    for (const [id, row] of a) {
      if (!b.has(id)) removed.push({ id, label: labelOf(kind, row), row });
    }

    out.kinds[kind] = { label: KIND_LABEL[kind], added, removed, changed };
    out.total += added.length + removed.length + changed.length;
  }

  out.isEmpty = out.total === 0 && out.reordered.length === 0;
  out.isFirstPull = prev == null;
  return out;
}

/* One-line summary for the sync badge. */
export function summarise(d) {
  if (d.isFirstPull) return 'first pull — nothing accepted yet';
  if (d.isEmpty) return 'up to date';
  const bits = [];
  for (const kind of ['acts', 'scenes', 'cues']) {
    const k = d.kinds[kind];
    const n = k.added.length + k.removed.length + k.changed.length;
    if (n) bits.push(`${n} ${kind.slice(0, -1)}${n === 1 ? '' : 's'}`);
  }
  if (d.reordered.length) bits.push(`${d.reordered.length} reordered`);
  return bits.join(' · ');
}

/* Cues whose sheet prop text no longer matches what was staged. These are the
   rows that get the "needs staging" badge after a pull — the whole point of the
   diff, from the brief: show me which stages I now have to go and fill in. */
export function needsStaging(cues, statesById, digestOf) {
  const out = [];
  for (const cue of cues) {
    const st = statesById.get(`cue:${cue.id}`);
    const digest = digestOf(cue);
    const staged = st && (
      (st.patch?.props && Object.keys(st.patch.props).length) ||
      st.patch?.led || (st.patch?.lighting && Object.keys(st.patch.lighting).length));

    if (digest.replace(/[\s|]/g, '') === '') continue;   // sheet lists no props
    if (!staged) { out.push({ cue, reason: 'never staged' }); continue; }
    if (st.prop_digest != null && st.prop_digest !== digest) {
      out.push({ cue, reason: 'sheet props changed since staged', was: st.prop_digest, now: digest });
    }
  }
  return out;
}
