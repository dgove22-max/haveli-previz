/* Reading and writing the show.

   Every read tolerates being offline. A view link must keep rendering when
   Supabase is unconfigured or unreachable — external teams have these links and
   "the LED plan is blank today" is not an acceptable failure mode. Offline we
   fall back to the committed data/*.json, exactly as the app behaved before.

   Every write refuses when offline, rather than silently dropping the change.

   The programme (acts/scenes/cues) is owned by the sheet and replaced wholesale
   on apply. Authored state (prop_defs/stage_states) is owned by us and is never
   touched by a pull — which is why stage_states.ref_id is not a foreign key.
   A row deleted from the sheet by accident must not take the staging with it. */

import { sb, isOnline } from './supabase.js';
import { savedBy } from '../auth.js';

const rows = async (table, order = 'sort') => {
  const { data, error } = await sb().from(table).select('*').order(order);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
};

/* ── read ── */

export async function loadShow(base = '') {
  if (!isOnline()) return loadOffline(base);
  try {
    const [acts, scenes, cues, defs, aliases, states, snaps] = await Promise.all([
      rows('acts'), rows('scenes'), rows('cues'),
      rows('prop_defs', 'name'),
      rows('prop_aliases', 'alias'),
      rows('stage_states', 'id'),
      sb().from('sheet_snapshots').select('*').order('pulled_at', { ascending: false }).limit(1)
        .then(r => r.data ?? [])
    ]);
    return {
      online: true,
      acts, scenes, cues, defs,
      aliases: new Map(aliases.map(a => [a.alias, a.def_id])),
      states: new Map(states.map(s => [s.id, s])),
      snapshot: snaps[0]?.rows ?? null,
      snapshotAt: snaps[0]?.pulled_at ?? null
    };
  } catch (e) {
    console.warn('Show database unreachable — falling back to committed files:', e.message);
    return { ...(await loadOffline(base)), error: e.message };
  }
}

/* The committed files, shaped like a loadShow() result so callers need no
   special case beyond checking `online`. */
async function loadOffline(base) {
  const propsRaw = await fetch(`${base}data/props.json`).then(r => r.json()).catch(() => ({}));
  return {
    online: false,
    acts: [], scenes: [], cues: [],
    defs: propsRaw.definitions ?? [],
    aliases: new Map(),
    states: new Map(),
    snapshot: null,
    snapshotAt: null
  };
}

/* ── programme: replace from an accepted pull ── */

/* Only these columns exist. Projecting explicitly means a new field on the
   parsed cue (or a stray one from a join) cannot fail the whole pull with
   "column does not exist" — the parser and the table can drift safely. */
const COLUMNS = {
  acts: ['id', 'name', 'sort'],
  scenes: ['id', 'act_id', 'code', 'name', 'sort'],
  cues: ['id', 'scene_id', 'item', 'type', 'type_detail', 'live_prerec', 'presenter',
         'final_status', 'start_time', 'end_time', 'duration',
         'sr_prop', 'sl_prop', 'centre_prop', 'canopy',
         'led_item', 'led_meta', 'sort']
};
const project = (rows, cols) =>
  rows.map(r => Object.fromEntries(cols.filter(c => r[c] !== undefined).map(c => [c, r[c]])));

export async function applyProgramme({ acts, scenes, cues }) {
  requireOnline('apply a pull');
  const db = sb();

  /* Upsert parents first so the child foreign keys resolve. */
  const skipped = [];
  for (const [table, data] of [['acts', acts], ['scenes', scenes], ['cues', cues]]) {
    if (!data.length) continue;
    skipped.push(...await upsertTolerant(db, table, data, COLUMNS[table]));
  }

  /* Then drop what the sheet no longer contains, children first. */
  for (const [table, data] of [['cues', cues], ['scenes', scenes], ['acts', acts]]) {
    const keep = data.map(r => r.id);
    const q = db.from(table).delete();
    const { error } = keep.length
      ? await q.not('id', 'in', `(${keep.map(id => `"${id}"`).join(',')})`)
      : await q.neq('id', '');
    if (error) throw new Error(`${table} prune: ${error.message}`);
  }

  const { error } = await db.from('sheet_snapshots')
    .insert({ rows: { acts, scenes, cues }, applied_by: savedBy() });
  if (error) throw new Error(`snapshot: ${error.message}`);
  return { skipped };
}

/* Upsert, dropping any column the database does not have yet and trying again.

   The schema grows over time and "create table if not exists" does nothing to a
   database that already exists, so a deployment can easily be a column or two
   behind. That should cost you the column, not the entire pull — losing the
   whole running order because the sheet gained a Duration field is a bad trade.
   Which columns were dropped is reported back so the UI can say so. */
async function upsertTolerant(db, table, rows, cols) {
  let use = [...cols];
  const skipped = [];
  for (let attempt = 0; attempt <= cols.length; attempt++) {
    const { error } = await db.from(table).upsert(project(rows, use), { onConflict: 'id' });
    if (!error) return skipped;

    const miss = /Could not find the '?([\w.]+)'? column/i.exec(error.message ?? '');
    const col = miss && miss[1].split('.').pop();
    /* Only ever drop an optional column — never the keys the rows are made of. */
    if (!col || !use.includes(col) || ['id', 'sort', 'scene_id', 'act_id'].includes(col)) {
      throw new Error(explain(table, error));
    }
    use = use.filter(c => c !== col);
    skipped.push(`${table}.${col}`);
  }
  throw new Error(`${table}: too many columns missing — run sql/schema.sql.`);
}

/* ── stage states ── */

/* 'act:<id>' | 'scene:<id>' | 'cue:<id>' | 'home' | 'sandbox'. */
export const stateId = (scope, refId) =>
  scope === 'home' || scope === 'sandbox' ? scope : `${scope}:${refId}`;

/* The stage_states rows that feed one sub-state, outermost first: the set its
   act plays on, what its scene changes about that, and what the sub-state
   itself changes. Pair it with chainFrom() in src/stagestate.js — every page
   that renders a row needs the same walk and must agree on the answer. */
export function stageRowsFor(show, cue) {
  const scene = show.scenes.find(s => s.id === cue?.scene_id) ?? null;
  return {
    act:   scene ? show.states.get(`act:${scene.act_id}`) ?? null : null,
    scene: scene ? show.states.get(`scene:${scene.id}`) ?? null : null,
    cue:   cue ? show.states.get(`cue:${cue.id}`) ?? null : null
  };
}

/* Writes the PREVIOUS value to the version log before overwriting, so every
   change is recoverable. That history is what makes one shared editor login
   acceptable — no per-person audit, but nothing is unrecoverable either. */
export async function saveStageState({ scope, ref_id, base, patch, prop_digest }) {
  requireOnline('save a stage');
  const db = sb();
  const id = stateId(scope, ref_id);

  const { data: prev } = await db.from('stage_states').select('base,patch').eq('id', id).maybeSingle();
  if (prev) {
    await db.from('stage_state_versions')
      .insert({ state_id: id, base: prev.base, patch: prev.patch, saved_by: savedBy() });
  }

  const row = {
    id, scope,
    ref_id: scope === 'home' || scope === 'sandbox' ? null : ref_id,
    base: base ?? { props: [], lighting: {}, led: null },
    patch: patch ?? { props: {}, lighting: {}, led: null },
    updated_at: new Date().toISOString(),
    updated_by: savedBy()
  };
  if (prop_digest !== undefined) row.prop_digest = prop_digest;

  const { error } = await db.from('stage_states').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`stage state: ${error.message}`);
  return row;
}

export async function stateHistory(id, limit = 20) {
  if (!isOnline()) return [];
  const { data } = await sb().from('stage_state_versions')
    .select('*').eq('state_id', id).order('saved_at', { ascending: false }).limit(limit);
  return data ?? [];
}

/* ── prop definitions ── */

/* The whole library in one request. It used to be one request per definition,
   which made every save several round trips long — and the longer a save takes,
   the wider the window for the stage to change underneath it. */
export async function saveDefs(defs) {
  requireOnline('save the prop library');
  if (!defs.length) return;
  const now = new Date().toISOString(), by = savedBy();
  const { error } = await sb().from('prop_defs').upsert(
    defs.map(d => ({ ...d, updated_at: now, updated_by: by })), { onConflict: 'id' });
  if (error) throw new Error(`prop library: ${error.message}`);
}

export async function saveDef(def) {
  requireOnline('save a prop definition');
  const { error } = await sb().from('prop_defs').upsert({
    ...def, updated_at: new Date().toISOString(), updated_by: savedBy()
  }, { onConflict: 'id' });
  if (error) throw new Error(`prop def: ${error.message}`);
}

export async function deleteDef(id) {
  requireOnline('delete a prop definition');
  const { error } = await sb().from('prop_defs').delete().eq('id', id);
  if (error) throw new Error(`prop def: ${error.message}`);
}

export async function saveAlias(alias, defId) {
  requireOnline('remember a prop match');
  const { error } = await sb().from('prop_aliases').upsert({ alias, def_id: defId }, { onConflict: 'alias' });
  if (error) throw new Error(`alias: ${error.message}`);
}

/* Seeds an empty database from the committed data/props.json, so a fresh
   project starts with the definitions already in the repo rather than blank. */
export async function seedDefsIfEmpty(base = '') {
  if (!isOnline()) return 0;
  const { count } = await sb().from('prop_defs').select('id', { count: 'exact', head: true });
  if (count) return 0;
  const raw = await fetch(`${base}data/props.json`).then(r => r.json()).catch(() => null);
  const defs = raw?.definitions ?? [];
  if (!defs.length) return 0;
  const { error } = await sb().from('prop_defs').insert(
    defs.map(d => ({ id: d.id, name: d.name, confidence: d.confidence, material: d.material, parts: d.parts })));
  if (error) throw new Error(`seed: ${error.message}`);
  return defs.length;
}

/* A column added to sql/schema.sql after a database was created does not exist
   in it — "create table if not exists" does nothing to an existing table. The
   raw PostgREST message names the column but not the cure, and the cure is one
   line of SQL, so say it. */
function explain(table, error) {
  const miss = /Could not find the '?([\w.]+)'? column/i.exec(error.message ?? '');
  if (miss) {
    const col = miss[1].split('.').pop();
    return `${table}: the database has no "${col}" column yet.\n\n` +
      `Run this in the Supabase SQL editor, then pull again:\n` +
      `  alter table ${table} add column if not exists ${col} text;\n\n` +
      `sql/schema.sql carries the full set of these.`;
  }
  return `${table} upsert: ${error.message}`;
}

function requireOnline(what) {
  if (!isOnline()) throw new Error(`Not connected to the show database — cannot ${what}.`);
}
