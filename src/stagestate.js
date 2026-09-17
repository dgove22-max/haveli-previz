/* Scene sets and sub-state patches.

   The brief asked for two things that pull against each other: every row
   addressable and editable ("one per row"), but structured as "scenes with
   sub-states". Storing a full copy per row satisfies the first and breaks the
   second — a scene's set would be duplicated 4 times and fixing the bed's
   position would mean fixing it four times.

   So a sub-state stores only what it CHANGED, keyed by placement id.
   Everything it did not touch resolves live from the scene, which means
   editing the scene set still propagates to its rows. Touch a placement and it
   pins, and from then on the scene no longer moves it. Copy-on-write, per prop.

   That gives sub-states full freedom — add, move, remove, replace the lot —
   without losing inheritance for the props nobody touched.

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
    if (!op) { props.push(placement); continue; }        // untouched — follows the scene
    if (op.op === 'remove') continue;                    // struck in this sub-state
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

/* Does this sub-state change anything at all? Drives the "inherits from scene"
   label and the needs-staging badge. */
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

/* Revert one placement to whatever the scene says. */
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

/* ── scene-level (base) edits ── */

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

   The workshop edits a flat list of placements; it knows nothing about scenes
   or inheritance, and should not have to. So rather than making every edit
   path record its own patch entry, we diff what the workshop produced against
   the scene's base and derive the patch here. One place to get right.

   The rule that matters: a placement identical to the scene's produces NO
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
    /* identical to the scene — deliberately no entry, so it keeps inheriting */
  }

  const present = new Set(resolved.map(r => r.id));
  for (const b of basePlacements) if (!present.has(b.id)) props[b.id] = { op: 'remove' };

  return { ...emptyPatch(), ...prevPatch, props };
}
