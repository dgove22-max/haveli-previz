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
import { saveDef, deleteDef, saveStageState, stateId } from '../data/showdb.js';
import { patchFromResolved, emptyBase, emptyPatch, resolveStage } from '../stagestate.js';

/* Which stage the workshop is currently editing. Set by main.js whenever the
   selection changes in the programme tree. */
let target = null;      // { scope, ref_id, base, patch, prop_digest, sceneBase }
let doc = null;         // { definitions, instances } as the workshop sees it
let knownDefIds = new Set();
let reporter = null;    // surfaces save failures to the UI

export const onSaveError = fn => { reporter = fn; };

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
  if (!isOnline()) return report('Not connected — this edit is not saved.');
  if (!target) return report('No stage selected — nothing to save onto.');

  try {
    /* Definitions are global; write the whole catalogue rather than tracking
       which one changed. Five to a few dozen rows, so the simplicity is worth
       more than the round trips saved. */
    for (const def of next.definitions) await saveDef(toDefRow(def));
    for (const gone of [...knownDefIds].filter(id => !next.definitions.some(d => d.id === id))) {
      await deleteDef(gone);
    }
    knownDefIds = new Set(next.definitions.map(d => d.id));

    const placements = next.instances.map(toPlacement);

    if (target.scope === 'cue') {
      /* A sub-state stores only its differences from the scene's set. */
      const patch = patchFromResolved(target.sceneBase ?? emptyBase(), placements, target.patch);
      target.patch = patch;
      await saveStageState({
        scope: 'cue', ref_id: target.ref_id,
        base: emptyBase(), patch, prop_digest: target.prop_digest
      });
    } else {
      const base = { ...(target.base ?? emptyBase()), props: placements };
      target.base = base;
      await saveStageState({
        scope: target.scope, ref_id: target.ref_id,
        base, patch: emptyPatch(), prop_digest: target.prop_digest
      });
    }
    report(null);
  } catch (e) {
    report(e.message);
  }
}

/* Revert this stage to inheriting (a sub-state) or to empty (a scene). */
export async function clearPropsDoc() {
  if (!isOnline() || !target) return;
  try {
    if (target.scope === 'cue') {
      target.patch = emptyPatch();
      await saveStageState({ scope: 'cue', ref_id: target.ref_id, base: emptyBase(), patch: emptyPatch() });
    } else {
      target.base = emptyBase();
      await saveStageState({ scope: target.scope, ref_id: target.ref_id, base: emptyBase(), patch: emptyPatch() });
    }
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
