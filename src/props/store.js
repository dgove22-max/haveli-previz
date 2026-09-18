/* Prop workshop persistence — now the shared show database rather than this
   browser.

   The workshop was built against localStorage, which meant an edit never
   reached anyone else: the whole reason this module changed. It keeps the same
   exported names so workshop.js barely moved, but underneath:

     definitions  → the prop_defs table, a catalogue shared by the whole show
     instances    → placements on whichever stage is currently selected

   The workshop still thinks in a flat {definitions, instances} document and
   knows nothing about scenes, sub-states or inheritance. Everything to do with
   patches happens here, at the boundary, where it can be reasoned about and
   tested in one place (see patchFromResolved in src/stagestate.js).

   Offline the doc is still readable — it just cannot be saved, and the caller
   is told so rather than the edit being silently dropped. */

import { normalizeProps, serializeProps, DEFAULT_DOCS } from './schema.js';
import { isOnline } from '../data/supabase.js';
import { saveDefs, deleteDef, saveStageState, stateId } from '../data/showdb.js';
import { patchFromResolved, emptyBase, emptyPatch, resolveStage } from '../stagestate.js';

/* Which stage the workshop is currently editing. Set by main.js whenever the
   selection changes in the programme tree. */
let target = null;      // { scope, ref_id, base, patch, prop_digest, sceneBase }
let doc = null;         // { definitions, instances } as the workshop sees it
let knownDefIds = new Set();
let reporter = null;    // surfaces save failures to the UI
let savedHook = null;   // lets the host refresh its cache of the show

export const onSaveError = fn => { reporter = fn; };

/* Fires after every successful write with the row that was stored and the
   definition catalogue as it now stands.

   This is not a nicety. The host holds the show in memory and rebuilds the
   workshop's document from it whenever you change stage. Without this the cache
   stays at whatever boot loaded, so leaving a stage and coming back rebuilt an
   EMPTY document from stale data — and the next autosave wrote that emptiness
   over the real thing. Silent data loss, not just a stale view. */
export const onStateSaved = fn => { savedHook = fn; };

/* Where the last save got to, for the workshop to show. An autosave you cannot
   see is an autosave you cannot trust — people press things twice, or leave
   the page before it lands, because nothing told them it had. */
let status = { state: 'idle', at: null, message: null };
const statusHooks = new Set();
export const saveStatus = () => status;
export function onSaveStatus(fn) { statusHooks.add(fn); return () => statusHooks.delete(fn); }
function setStatus(next) {
  status = { ...status, ...next };
  statusHooks.forEach(fn => fn(status));
}

export function setTarget(t) {
  target = t;
  knownDefIds = new Set((doc?.definitions ?? []).map(d => d.id));
}

/* main.js primes this from the database before the workshop is created, so the
   workshop's synchronous load still works. */
export function primeDoc(next) {
  doc = next;
  knownDefIds = new Set((next?.definitions ?? []).map(d => d.id));
}

export const currentTarget = () => target;

/* ── the workshop's interface, unchanged in shape ── */

export function hasLocal() {
  return isOnline() && target != null;
}

export function loadPropsDoc(committedRaw) {
  return doc ?? normalizeProps(committedRaw);
}

export async function savePropsDoc(next) {
  doc = next;
  /* Snapshot the stage NOW, before anything is awaited. This function used to
     read `target` after a run of network round trips, so switching scene while
     it was saving wrote your placements into the scene you had just moved to.
     A save must land where the edit was made. */
  const t = target;
  if (!isOnline()) return report('Not connected — this edit is not saved.');
  if (!t) return report('No stage selected — nothing to save onto.');

  const defs = next.definitions.map(toDefRow);
  const row = rowFor(t, next);
  if (t.scope === 'cue') t.patch = row.patch; else t.base = row.base;

  /* Update the in-memory show before the round trip, not after. Leave a scene
     and come straight back and you should see what you just placed, even if the
     database has not answered yet. */
  savedHook?.({ row, defs });
  setStatus({ state: 'saving', message: null });

  try {
    await saveDefs(defs);
    for (const gone of [...knownDefIds].filter(id => !defs.some(d => d.id === id))) {
      await deleteDef(gone);
    }
    knownDefIds = new Set(defs.map(d => d.id));

    await saveStageState({
      scope: row.scope, ref_id: row.ref_id,
      base: row.base, patch: row.patch, prop_digest: row.prop_digest
    });
    report(null);
    setStatus({ state: 'saved', at: new Date(), message: null });
  } catch (e) {
    report(e.message);
    setStatus({ state: 'error', message: e.message });
  }
}

/* The stage_states row a save writes, for a given stage and document. Pure, so
   the rule that decides WHERE props are stored is testable on its own:

     scene    → base.props = the placements. Every sub-state inherits them.
     cue      → patch only: what this sub-state does differently from its scene.
     home /
     sandbox  → base.props, and no ref_id — they belong to no scene. */
export function rowFor(t, next) {
  const placements = next.instances.map(toPlacement);
  if (t.scope === 'cue') {
    const patch = patchFromResolved(t.sceneBase ?? emptyBase(), placements, t.patch);
    return { id: stateId('cue', t.ref_id), scope: 'cue', ref_id: t.ref_id,
             base: emptyBase(), patch, prop_digest: t.prop_digest ?? null };
  }
  const loose = t.scope === 'home' || t.scope === 'sandbox';
  return { id: stateId(t.scope, t.ref_id), scope: t.scope, ref_id: loose ? null : t.ref_id,
           base: { ...(t.base ?? emptyBase()), props: placements },
           patch: emptyPatch(), prop_digest: t.prop_digest ?? null };
}

/* Revert this stage to inheriting (a sub-state) or to empty (a scene). */
export async function clearPropsDoc() {
  if (!isOnline() || !target) return;
  try {
    let row;
    if (target.scope === 'cue') {
      target.patch = emptyPatch();
      row = await saveStageState({ scope: 'cue', ref_id: target.ref_id, base: emptyBase(), patch: emptyPatch() });
    } else {
      target.base = emptyBase();
      row = await saveStageState({ scope: target.scope, ref_id: target.ref_id, base: emptyBase(), patch: emptyPatch() });
    }
    savedHook?.({ row, defs: (doc?.definitions ?? []).map(toDefRow) });
    report(null);
  } catch (e) { report(e.message); }
}

/* Still worth keeping: an offline snapshot, and the way to seed a fresh
   database or hand the catalogue to someone. */
export function downloadPropsJson(d) {
  const blob = new Blob([JSON.stringify(serializeProps(d, DEFAULT_DOCS), null, 2) + '\n'],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'props.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ── shape conversion at the boundary ──

   The renderer, the plan view and the schema all speak "instance" with a `def`
   pointer. The database speaks "placement" with `def_id`. Converting here keeps
   both sides idiomatic and means neither had to be rewritten. */

export const toPlacement = i => ({
  id: i.id, def_id: i.def, pos: i.pos, rot: i.rot ?? 0, on: i.on ?? 'forestage',
  /* Only written when false: the workshop's Enabled toggle would otherwise be
     dropped at the boundary and silently reset on reload. */
  ...(i.enabled === false && { enabled: false })
});

export const toInstance = p => ({
  id: p.id, def: p.def_id, pos: p.pos, rot: p.rot ?? 0, on: p.on ?? 'forestage',
  scenes: [], enabled: p.enabled !== false,
  ...(p.overridden && { overridden: true }),
  ...(p.added && { added: true })
});

const toDefRow = d => ({
  id: d.id, name: d.name, confidence: d.confidence, material: d.material, parts: d.parts
});

/* Build the workshop's document for a given stage. */
export function docFor(defs, stageState, sceneBase) {
  const resolved = resolveStage(
    stageState?.scope === 'cue' ? (sceneBase ?? emptyBase()) : (stageState?.base ?? emptyBase()),
    stageState?.scope === 'cue' ? stageState?.patch : emptyPatch()
  );
  return {
    definitions: defs.map(d => ({
      id: d.id, name: d.name, confidence: d.confidence, material: d.material, parts: d.parts ?? []
    })),
    instances: resolved.props.map(toInstance)
  };
}

function report(msg) { reporter?.(msg); }
