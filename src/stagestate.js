/* Act sets, scene changes and sub-state patches.

   The brief asked for two things that pull against each other: every row
   addressable and editable ("one per row"), but structured as "scenes with
   sub-states". Storing a full copy per row satisfies the first and breaks the
   second — a scene's set would be duplicated 4 times and fixing the bed's
   position would mean fixing it four times.

   So a level stores only what it CHANGED from the level above, keyed by
   placement id. Everything it did not touch resolves live from above, which
   means editing the set still propagates down. Touch a placement and it pins,
   and from then on the level above no longer moves it. Copy-on-write, per prop.

   That gives every level full freedom — add, move, remove, replace the lot —
   without losing inheritance for the props nobody touched.

   The chain is three deep, because most of an act is dressed once:

     act    the set the whole act plays on, stored as a base
     scene  what this scene changes about it, stored as a patch
     cue    what this sub-state changes about the scene, stored as a patch

   An act with no set of its own is simply an empty base, which is what every
   scene authored before acts carried sets resolves against — see
   scenePatchFrom, which reads such a scene's stored base as a patch so nothing
   has to be migrated by hand.

   base   { props: [ {id, def_id, pos:[x,z], rot, on}, … ], lighting: {…}, led }
   patch  { props: { <placement id>: {op:'move'|'remove'|'add', …} }, lighting, led }

   All functions are pure and return new objects — the workshop's undo and the
   version history both depend on never mutating in place. */

export const emptyBase = () => ({ props: [], lighting: {}, led: null });
export const emptyPatch = () => ({ props: {}, lighting: {}, led: null });

/* The stage as it should actually render. */
export function resolveStage(base, patch) {
  const b = { ...emptyBase(), ...(base ?? {}) };
  const p = { ...emptyPatch(), ...(patch ?? {}) };
  const ops = p.props ?? {};

  const props = [];
  for (const placement of b.props ?? []) {
    const op = ops[placement.id];
    if (!op) { props.push(placement); continue; }        // untouched — follows the level above
    if (op.op === 'remove') continue;                    // struck at this level
    if (op.op === 'move') {
      props.push({
        ...placement,
        ...(op.pos !== undefined && { pos: op.pos }),
        ...(op.rot !== undefined && { rot: op.rot }),
        ...(op.on !== undefined && { on: op.on }),
        ...(op.enabled !== undefined && { enabled: op.enabled }),
        overridden: true
      });
      continue;
    }
    props.push(placement);
  }

  /* Placements that exist only in this sub-state. Kept in insertion order so
     the list does not reshuffle as you add things. */
  for (const [id, op] of Object.entries(ops)) {
    if (op.op !== 'add') continue;
    if (props.some(x => x.id === id)) continue;
    props.push({ id, def_id: op.def_id, pos: op.pos, rot: op.rot ?? 0, on: op.on ?? 'forestage', added: true });
  }

  return {
    props,
    lighting: { ...(b.lighting ?? {}), ...(p.lighting ?? {}) },
    led: p.led ?? b.led ?? null
  };
}

/* What a scene inherits from its act.

   The act supplies the props. Lighting and LED content layer, because a scene
   may set its own without disturbing the act's, and the nearer level wins.
   Props do not layer: they are patched, which is the whole point. */
export const sceneInherits = (actBase, sceneBase) => ({
  props: actBase?.props ?? [],
  lighting: { ...(actBase?.lighting ?? {}), ...(sceneBase?.lighting ?? {}) },
  led: sceneBase?.led ?? actBase?.led ?? null
});

/* A scene's changes, as a patch over what it inherits.

   Scenes predate acts having sets, and those scenes stored their placements as
   a base — a complete set of their own. Rather than migrate the database, read
   such a base as the patch it is equivalent to: diffing it against what the
   scene now inherits gives adds for what only the scene has, moves for what it
   positions differently, and removes for anything in the act's set the scene
   does not carry. The scene therefore looks exactly as it did before its act
   gained a set, and pins only what it genuinely differs on.

   Keyed on props alone, not patchIsEmpty: a scene may carry patch lighting and
   a legacy prop base at once, and both have to survive. The conversion stops
   applying as soon as the scene is saved again, because a save empties the
   base and writes the patch. */
export function scenePatchFrom(row, inherited) {
  if (!row) return emptyPatch();
  const patch = { ...emptyPatch(), ...(row.patch ?? {}) };
  if (Object.keys(patch.props ?? {}).length) return patch;
  const legacy = row.base?.props ?? [];
  if (!legacy.length) return patch;
  return patchFromResolved(inherited ?? emptyBase(), legacy, patch);
}

/* The whole chain resolved from the three stage_states rows that feed it, any
   of which may be missing: an act nobody has dressed, a scene that inherits
   everything, a sub-state that has never been staged.

   Every page that renders a stage needs this same walk, so it lives here
   rather than three times over — the stage view, the cue sheet and the LED plan
   disagreeing about what a row shows is exactly the failure to avoid.

   Returns the intermediate levels too, because the caller that is EDITING one
   of them needs to know what it inherits in order to diff against it. */
export function chainFrom({ act, scene, cue } = {}) {
  const actBase = sceneInherits(act?.base ?? emptyBase(), scene?.base);
  const scenePatch = scenePatchFrom(scene, actBase);
  const sceneStage = resolveStage(actBase, scenePatch);
  const cuePatch = cue?.patch ?? emptyPatch();
  return {
    actBase, scenePatch, sceneStage, cuePatch,
    cueStage: resolveStage(stripMarks(sceneStage), cuePatch)
  };
}

/* resolveStage marks what the level it just applied changed. Those marks say
   where a placement came from, so they are true only of the stage that produced
   them: strip them whenever a resolved stage is used as a base somewhere else,
   or a prop the ACT added still reads as "added here" two levels down. The same
   applies to a stage copied onto another one, or forked into the sandbox. */
export const unmark = ({ overridden, added, ...placement }) => placement;

const stripMarks = stage => ({ ...stage, props: (stage.props ?? []).map(unmark) });

/* Does this level change anything at all? Drives the "inherits from the level
   above" label and the needs-staging badge. */
export const patchIsEmpty = patch => {
  const p = patch ?? {};
  return !Object.keys(p.props ?? {}).length &&
    !Object.keys(p.lighting ?? {}).length &&
    (p.led == null);
};

/* ── patch edits ── every one returns a new patch ── */

const put = (patch, id, op) => ({
  ...emptyPatch(), ...patch,
  props: { ...(patch?.props ?? {}), [id]: op }
});

export function withMove(patch, base, id, { pos, rot, on }) {
  const existing = patch?.props?.[id];
  /* Moving something this sub-state added keeps it an 'add' — demoting it to a
     'move' would lose the def_id and the placement would vanish on reload. */
  if (existing?.op === 'add') {
    return put(patch, id, { ...existing, ...(pos && { pos }), ...(rot !== undefined && { rot }), ...(on && { on }) });
  }
  return put(patch, id, { op: 'move', ...(pos && { pos }), ...(rot !== undefined && { rot }), ...(on && { on }) });
}

export function withRemove(patch, base, id) {
  /* Removing a placement this sub-state added just drops the entry — recording
     "add then remove" would leave a tombstone that resolves to nothing. */
  if (patch?.props?.[id]?.op === 'add') return withInherit(patch, id);
  return put(patch, id, { op: 'remove' });
}

export function withAdd(patch, placement) {
  return put(patch, placement.id, {
    op: 'add',
    def_id: placement.def_id,
    pos: placement.pos,
    rot: placement.rot ?? 0,
    on: placement.on ?? 'forestage'
  });
}

/* Revert one placement to whatever the level above says. */
export function withInherit(patch, id) {
  const props = { ...(patch?.props ?? {}) };
  delete props[id];
  return { ...emptyPatch(), ...patch, props };
}

export const withLighting = (patch, fixtureId, state) => ({
  ...emptyPatch(), ...patch,
  lighting: { ...(patch?.lighting ?? {}), [fixtureId]: state }
});

export const withLed = (patch, led) => ({ ...emptyPatch(), ...patch, led });

/* ── base edits (an act's set, home, sandbox) ── */

export const baseUpsert = (base, placement) => {
  const props = [...(base?.props ?? [])];
  const i = props.findIndex(p => p.id === placement.id);
  if (i < 0) props.push(placement); else props[i] = { ...props[i], ...placement };
  return { ...emptyBase(), ...base, props };
};

export const baseRemove = (base, id) => ({
  ...emptyBase(), ...base,
  props: (base?.props ?? []).filter(p => p.id !== id)
});

/* ── deriving a patch from an edited result ──

   The workshop edits a flat list of placements; it knows nothing about acts,
   scenes or inheritance, and should not have to. So rather than making every
   edit path record its own patch entry, we diff what the workshop produced
   against what this level inherits and derive the patch here. One place to get
   right, and the same one whether a scene is being diffed against its act or a
   sub-state against its scene.

   The rule that matters: a placement identical to the inherited one produces NO
   entry, so it keeps inheriting. Only genuine differences pin. */

const samePos = (a, b) =>
  Math.abs((a?.[0] ?? 0) - (b?.[0] ?? 0)) < 1e-6 &&
  Math.abs((a?.[1] ?? 0) - (b?.[1] ?? 0)) < 1e-6;

export function patchFromResolved(base, resolved, prevPatch) {
  const basePlacements = base?.props ?? [];
  const byId = new Map(basePlacements.map(p => [p.id, p]));
  const props = {};

  for (const r of resolved) {
    const b = byId.get(r.id);
    if (!b) {
      props[r.id] = {
        op: 'add', def_id: r.def_id, pos: r.pos, rot: r.rot ?? 0, on: r.on ?? 'forestage',
        ...(r.enabled === false && { enabled: false })
      };
      continue;
    }
    const moved = !samePos(b.pos, r.pos) ||
      (b.rot ?? 0) !== (r.rot ?? 0) ||
      (b.on ?? 'forestage') !== (r.on ?? 'forestage') ||
      (b.enabled !== false) !== (r.enabled !== false);
    if (moved) props[r.id] = {
      op: 'move', pos: r.pos, rot: r.rot ?? 0, on: r.on ?? 'forestage',
      ...(r.enabled === false && { enabled: false })
    };
    /* identical to what it inherits — no entry, so it keeps inheriting */
  }

  const present = new Set(resolved.map(r => r.id));
  for (const b of basePlacements) if (!present.has(b.id)) props[b.id] = { op: 'remove' };

  return { ...emptyPatch(), ...prevPatch, props };
}
