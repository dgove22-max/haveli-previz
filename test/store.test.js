import test from 'node:test';
import assert from 'node:assert/strict';
import { docFor, toPlacement, toInstance } from '../src/props/store.js';
import { patchFromResolved, emptyBase, emptyPatch } from '../src/stagestate.js';

const defs = [{ id: 'def_bed', name: 'Bed', parts: [] }, { id: 'def_cart', name: 'Cart', parts: [] }];
const sceneBase = { props: [{ id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' }],
                    lighting: {}, led: null };
const actBase = { props: [{ id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' }],
                  lighting: {}, led: null };

test('a saved cue patch rebuilds into the placements it described', () => {
  /* The workshop document is rebuilt from the cached show every time you change
     stage. If that cache is stale this returns an empty document — and the next
     autosave writes the emptiness back over the real placements. The round trip
     has to be faithful. */
  const patch = { props: { cart: { op: 'add', def_id: 'def_cart', pos: [2, 3], rot: 0, on: 'forestage' } },
                  lighting: {}, led: null };
  const doc = docFor(defs, { scope: 'cue', base: emptyBase(), patch }, sceneBase);
  const ids = doc.instances.map(i => i.id).sort();
  assert.deepEqual(ids, ['bed', 'cart'], 'inherited prop AND the added one');
  assert.equal(doc.instances.find(i => i.id === 'cart').def, 'def_cart');
  assert.equal(doc.definitions.length, 2, 'library comes through');
});

test('rebuild then re-derive is a fixed point — no silent wipe', () => {
  /* Opening a stage and saving it without touching anything must not change
     what is stored. */
  const patch = { props: { cart: { op: 'add', def_id: 'def_cart', pos: [2, 3], rot: 0, on: 'forestage' } },
                  lighting: {}, led: null };
  const doc = docFor(defs, { scope: 'cue', base: emptyBase(), patch }, sceneBase);
  const again = patchFromResolved(sceneBase, doc.instances.map(toPlacement), patch);
  assert.equal(again.props.cart.op, 'add', 'added prop survives the round trip');
  assert.equal(again.props.bed, undefined, 'inherited prop still inherits');
});

test('an empty cache would produce an empty doc — the shape of the bug', () => {
  /* Documents the failure mode so it is recognisable if it ever returns:
     given no stored state, the doc carries only what the scene provides. */
  const doc = docFor(defs, { scope: 'cue', base: emptyBase(), patch: emptyPatch() }, sceneBase);
  assert.deepEqual(doc.instances.map(i => i.id), ['bed']);

  const wiped = patchFromResolved(sceneBase, [], emptyPatch());
  assert.equal(wiped.props.bed.op, 'remove',
    'saving an empty doc removes the scene set — which is why the cache must stay fresh');
});

test('placement and instance shapes convert both ways', () => {
  const inst = { id: 'x', def: 'def_bed', pos: [1, 2], rot: 90, on: 'stage', scenes: [], enabled: true };
  const round = toInstance(toPlacement(inst));
  assert.equal(round.def, 'def_bed');
  assert.deepEqual(round.pos, [1, 2]);
  assert.equal(round.rot, 90);
  assert.equal(round.on, 'stage');
  assert.equal(round.enabled, true);
});

/* ── where a save lands ── */
import { rowFor } from '../src/props/store.js';

const docWith = (...ids) => ({
  definitions: defs,
  instances: ids.map((id, n) => ({ id, def: 'def_cart', pos: [n, 1], rot: 0, on: 'forestage', scenes: [], enabled: true }))
});

test('placing on an ACT writes the set every scene under it shares', () => {
  const row = rowFor({ scope: 'act', ref_id: 'act-1', base: emptyBase() }, docWith('bed', 'cart'));
  assert.equal(row.id, 'act:act-1');
  assert.deepEqual(row.base.props.map(p => p.id), ['bed', 'cart']);
  assert.deepEqual(row.patch.props, {}, 'an act carries no patch');
});

test('placing on a SCENE writes only its difference from the act', () => {
  const row = rowFor(
    { scope: 'scene', ref_id: 'act-1/a1s2', base: emptyBase(), inherits: actBase, patch: emptyPatch() },
    docWith('bed', 'cart'));
  assert.equal(row.id, 'scene:act-1/a1s2');
  assert.equal(row.patch.props.cart.op, 'add', 'the new prop is recorded');
  assert.equal(row.patch.props.bed, undefined, 'the inherited bed is not copied');
  assert.deepEqual(row.base.props, [], 'a scene no longer stores a set of its own');
});

test('a scene with no act above it still records its whole set', () => {
  /* An undressed act is an empty base, so every placement is an add. The scene
     looks the same either way — only where it is written changes. */
  const row = rowFor(
    { scope: 'scene', ref_id: 'act-1/a1s2', base: emptyBase(), inherits: emptyBase(), patch: emptyPatch() },
    docWith('bed', 'cart'));
  assert.deepEqual(Object.keys(row.patch.props).sort(), ['bed', 'cart']);
  assert.ok(Object.values(row.patch.props).every(op => op.op === 'add'));
});

test('saving a scene keeps the lighting its base carries', () => {
  /* Only the props move to patch storage. Dropping the base wholesale would
     take the scene's lighting with it. */
  const base = { props: [{ id: 'bed', def_id: 'def_bed', pos: [0, 1] }], lighting: { fw_c: { on: true } }, led: 'x.mp4' };
  const row = rowFor(
    { scope: 'scene', ref_id: 'act-1/a1s2', base, inherits: actBase, patch: emptyPatch() },
    docWith('bed'));
  assert.deepEqual(row.base.props, [], 'props move to the patch');
  assert.deepEqual(row.base.lighting, { fw_c: { on: true } }, 'lighting stays');
  assert.equal(row.base.led, 'x.mp4', 'LED content stays');
});

test('placing on a SUB-STATE writes only its difference from the scene', () => {
  const row = rowFor(
    { scope: 'cue', ref_id: 'act-1/a1s2/musical', inherits: sceneBase, patch: emptyPatch() },
    docWith('bed', 'cart'));
  assert.equal(row.id, 'cue:act-1/a1s2/musical');
  assert.equal(row.patch.props.cart.op, 'add', 'the new prop is recorded');
  assert.equal(row.patch.props.bed, undefined, 'the inherited bed is not copied');
  assert.deepEqual(row.base.props, [], 'a sub-state never stores a set of its own');
});

test('sandbox and home belong to no act', () => {
  for (const scope of ['sandbox', 'home']) {
    const row = rowFor({ scope, ref_id: 'anything', base: emptyBase() }, docWith('cart'));
    assert.equal(row.id, scope);
    assert.equal(row.ref_id, null);
  }
});

test('the row is decided by the stage passed in, not whatever is current later', () => {
  /* The bug this guards: a save read the live target after its network calls,
     so switching scene mid-save filed the placements under the new scene. */
  const a = { scope: 'scene', ref_id: 'scene-a', base: emptyBase(), inherits: emptyBase(), patch: emptyPatch() };
  const row = rowFor(a, docWith('cart'));
  a.ref_id = 'scene-b';                 // the "current" stage moves on
  assert.equal(row.id, 'scene:scene-a', 'already decided — cannot drift');
});

/* ── what a scene shows, built from its act ── */

test('a scene document starts from its act set', () => {
  const doc = docFor(defs, { scope: 'scene', base: emptyBase(), patch: emptyPatch() }, actBase);
  assert.deepEqual(doc.instances.map(i => i.id), ['bed'], 'the act dressed it');
});

test('a scene that moves one prop keeps inheriting the rest', () => {
  const patch = { props: { bed: { op: 'move', pos: [8, 8] } }, lighting: {}, led: null };
  const act = { props: [...actBase.props, { id: 'sink', def_id: 'def_bed', pos: [-3, 1] }], lighting: {}, led: null };
  const doc = docFor(defs, { scope: 'scene', base: emptyBase(), patch }, act);
  assert.deepEqual(doc.instances.find(i => i.id === 'bed').pos, [8, 8], 'pinned');
  assert.deepEqual(doc.instances.find(i => i.id === 'sink').pos, [-3, 1], 'still follows the act');
});
