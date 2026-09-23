import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStage, patchIsEmpty, emptyBase, emptyPatch,
  withMove, withRemove, withAdd, withInherit, withLed, withLighting,
  baseUpsert, baseRemove, patchFromResolved
} from '../src/stagestate.js';

const scene = () => ({
  props: [
    { id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' },
    { id: 'dresser', def_id: 'def_dresser', pos: [3, 1], rot: 90, on: 'forestage' },
    { id: 'sink', def_id: 'def_sink', pos: [-3, 1], rot: 0, on: 'forestage' }
  ],
  lighting: { fw_c: { on: true, intensity: 0.8 } },
  led: 'morning_v1.mp4'
});

test('an empty patch resolves to exactly the scene', () => {
  const r = resolveStage(scene(), emptyPatch());
  assert.equal(r.props.length, 3);
  assert.deepEqual(r.props.map(p => p.id), ['bed', 'dresser', 'sink']);
  assert.equal(r.led, 'morning_v1.mp4');
});

test('untouched props keep following the scene after it changes', () => {
  /* The whole point of copy-on-write: move the bed in one sub-state, then
     move the dresser at scene level, and the sub-state must see it. */
  let patch = withMove(emptyPatch(), scene(), 'bed', { pos: [5, 2] });
  const changed = baseUpsert(scene(), { id: 'dresser', pos: [9, 9] });

  const r = resolveStage(changed, patch);
  assert.deepEqual(r.props.find(p => p.id === 'bed').pos, [5, 2], 'pinned stays pinned');
  assert.deepEqual(r.props.find(p => p.id === 'dresser').pos, [9, 9], 'untouched follows the scene');
});

test('move overrides only the fields it names', () => {
  const patch = withMove(emptyPatch(), scene(), 'dresser', { pos: [1, 1] });
  const d = resolveStage(scene(), patch).props.find(p => p.id === 'dresser');
  assert.deepEqual(d.pos, [1, 1]);
  assert.equal(d.rot, 90, 'rotation not named, so inherited');
  assert.equal(d.def_id, 'def_dresser');
  assert.equal(d.overridden, true);
});

test('remove strikes a prop in this sub-state only', () => {
  const patch = withRemove(emptyPatch(), scene(), 'dresser');
  const r = resolveStage(scene(), patch);
  assert.deepEqual(r.props.map(p => p.id), ['bed', 'sink']);
  assert.equal(resolveStage(scene(), emptyPatch()).props.length, 3, 'scene itself untouched');
});

test('add introduces a prop that exists only here', () => {
  const patch = withAdd(emptyPatch(), { id: 'cart', def_id: 'def_cart', pos: [2, 3], rot: 45 });
  const r = resolveStage(scene(), patch);
  const cart = r.props.find(p => p.id === 'cart');
  assert.ok(cart, 'added prop appears');
  assert.equal(cart.def_id, 'def_cart');
  assert.equal(cart.rot, 45);
  assert.equal(cart.added, true);
});

test('moving an added prop keeps it an add, not a move', () => {
  /* Demoting it would drop def_id and the prop would vanish on reload. */
  let patch = withAdd(emptyPatch(), { id: 'cart', def_id: 'def_cart', pos: [2, 3] });
  patch = withMove(patch, scene(), 'cart', { pos: [8, 8] });
  assert.equal(patch.props.cart.op, 'add');
  assert.equal(patch.props.cart.def_id, 'def_cart');
  assert.deepEqual(resolveStage(scene(), patch).props.find(p => p.id === 'cart').pos, [8, 8]);
});

test('removing an added prop drops the entry rather than leaving a tombstone', () => {
  let patch = withAdd(emptyPatch(), { id: 'cart', def_id: 'def_cart', pos: [2, 3] });
  patch = withRemove(patch, scene(), 'cart');
  assert.equal(patch.props.cart, undefined);
  assert.ok(patchIsEmpty(patch), 'back to inheriting cleanly');
});

test('inherit reverts one prop to the scene', () => {
  let patch = withMove(emptyPatch(), scene(), 'bed', { pos: [5, 5] });
  patch = withInherit(patch, 'bed');
  assert.deepEqual(resolveStage(scene(), patch).props.find(p => p.id === 'bed').pos, [0, 1]);
  assert.ok(patchIsEmpty(patch));
});

test('lighting merges per fixture, led overrides wholesale', () => {
  let patch = withLighting(emptyPatch(), 'ps_mh_1', { on: true, intensity: 1 });
  patch = withLed(patch, 'brush_v2.mp4');
  const r = resolveStage(scene(), patch);
  assert.equal(r.lighting.fw_c.intensity, 0.8, 'scene fixture survives');
  assert.equal(r.lighting.ps_mh_1.intensity, 1, 'sub-state fixture added');
  assert.equal(r.led, 'brush_v2.mp4');
});

test('patchIsEmpty distinguishes inheriting from edited', () => {
  assert.ok(patchIsEmpty(emptyPatch()));
  assert.ok(!patchIsEmpty(withRemove(emptyPatch(), scene(), 'bed')));
  assert.ok(!patchIsEmpty(withLed(emptyPatch(), 'x.mp4')));
});

test('resolve tolerates null/absent state', () => {
  assert.deepEqual(resolveStage(null, null), { props: [], lighting: {}, led: null });
  assert.equal(resolveStage(emptyBase(), undefined).props.length, 0);
});

test('edits never mutate the input', () => {
  const base = scene();
  const patch = emptyPatch();
  withMove(patch, base, 'bed', { pos: [9, 9] });
  withRemove(patch, base, 'sink');
  baseRemove(base, 'bed');
  assert.deepEqual(patch, emptyPatch(), 'patch untouched');
  assert.equal(base.props.length, 3, 'base untouched');
});

test('patchFromResolved records only genuine differences', () => {
  const base = scene();
  const resolved = [
    { id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' },        // unchanged
    { id: 'dresser', def_id: 'def_dresser', pos: [7, 7], rot: 90, on: 'forestage' }, // moved
    { id: 'cart', def_id: 'def_cart', pos: [2, 2], rot: 0, on: 'forestage' }         // new
    /* 'sink' absent => removed */
  ];
  const p = patchFromResolved(base, resolved, emptyPatch());
  assert.equal(p.props.bed, undefined, 'unchanged prop keeps inheriting');
  assert.equal(p.props.dresser.op, 'move');
  assert.deepEqual(p.props.dresser.pos, [7, 7]);
  assert.equal(p.props.cart.op, 'add');
  assert.equal(p.props.cart.def_id, 'def_cart');
  assert.equal(p.props.sink.op, 'remove');
});

test('resolving then re-deriving with no edits produces no patch', () => {
  /* The round trip has to be a fixed point, or simply opening a sub-state and
     saving it would pin every prop and quietly break inheritance. */
  const base = scene();
  const flat = resolveStage(base, emptyPatch()).props;
  const p = patchFromResolved(base, flat, emptyPatch());
  assert.ok(patchIsEmpty(p), 'editing nothing produces no patch');
  assert.equal(resolveStage(base, p).props.length, 3);
});

test('a disabled prop survives the patch round trip', () => {
  /* enabled was being dropped at the store boundary, so switching a prop off
     in a sub-state looked fine until the next reload. */
  const base = scene();
  const resolved = resolveStage(base, emptyPatch()).props
    .map(p => p.id === 'bed' ? { ...p, enabled: false } : p);
  const p = patchFromResolved(base, resolved, emptyPatch());
  assert.equal(p.props.bed.op, 'move');
  assert.equal(p.props.bed.enabled, false);
  assert.equal(resolveStage(base, p).props.find(x => x.id === 'bed').enabled, false);
  assert.equal(p.props.dresser, undefined, 'others still inherit');
});

/* ── the third level: an act's set, inherited by its scenes ── */

import { chainFrom, sceneInherits, scenePatchFrom } from '../src/stagestate.js';

const actRow = () => ({ base: {
  props: [
    { id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' },
    { id: 'dresser', def_id: 'def_dresser', pos: [3, 1], rot: 90, on: 'forestage' }
  ],
  lighting: {}, led: null
} });

test('a scene with no row of its own shows its act set unchanged', () => {
  const { sceneStage } = chainFrom({ act: actRow(), scene: null, cue: null });
  assert.deepEqual(sceneStage.props.map(p => p.id), ['bed', 'dresser']);
});

test('a scene pins only what it changes; the act still moves the rest', () => {
  const scene = { base: emptyBase(), patch: withMove(emptyPatch(), null, 'bed', { pos: [7, 7] }) };
  const act = actRow();
  act.base.props[1] = { ...act.base.props[1], pos: [9, 9] };   // the act moves the dresser

  const { sceneStage } = chainFrom({ act, scene, cue: null });
  assert.deepEqual(sceneStage.props.find(p => p.id === 'bed').pos, [7, 7], 'pinned stays pinned');
  assert.deepEqual(sceneStage.props.find(p => p.id === 'dresser').pos, [9, 9], 'untouched follows the act');
});

test('an act edit reaches all the way down to a sub-state', () => {
  /* The point of three levels: dress the act once and every row under it
     changes, unless that row said otherwise. */
  const act = actRow();
  act.base.props[0] = { ...act.base.props[0], pos: [4, 4] };
  const cue = { patch: withMove(emptyPatch(), null, 'dresser', { rot: 45 }) };

  const { cueStage } = chainFrom({ act, scene: null, cue });
  assert.deepEqual(cueStage.props.find(p => p.id === 'bed').pos, [4, 4], 'act edit arrives');
  assert.equal(cueStage.props.find(p => p.id === 'dresser').rot, 45, 'sub-state keeps its own');
});

test('a sub-state is not credited with what an act or scene changed', () => {
  /* The marks say what the LAST level did. Left unstripped, a prop the SCENE
     added read as "added by this sub-state" and the UI would offer to revert
     something the sub-state never touched. */
  const scene = { base: emptyBase(), patch: withAdd(emptyPatch(), { id: 'cart', def_id: 'def_cart', pos: [2, 3] }) };
  const { sceneStage, cueStage } = chainFrom({ act: actRow(), scene, cue: null });
  assert.equal(sceneStage.props.find(p => p.id === 'cart').added, true, 'the scene added it');
  assert.equal(cueStage.props.find(p => p.id === 'cart').added, undefined,
    'but a sub-state under it did not');
});

test('a scene stored the old way, as a base, still reads as itself', () => {
  /* Scenes authored before acts carried sets keep their placements in `base`.
     Nothing migrates them, so the conversion has to be exact. */
  const legacy = { base: { props: [
    { id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' },
    { id: 'lamp', def_id: 'def_lamp', pos: [5, 2], rot: 0, on: 'forestage' }
  ], lighting: {}, led: null }, patch: emptyPatch() };

  const { sceneStage } = chainFrom({ act: actRow(), scene: legacy, cue: null });
  assert.deepEqual(sceneStage.props.map(p => p.id).sort(), ['bed', 'lamp'],
    'exactly what the scene had — the act dresser it never carried stays out');
});

test('a legacy scene under an undressed act is unchanged in every respect', () => {
  const props = [{ id: 'bed', def_id: 'def_bed', pos: [0, 1], rot: 0, on: 'forestage' }];
  const legacy = { base: { props, lighting: {}, led: 'morning.mp4' }, patch: emptyPatch() };
  const { sceneStage } = chainFrom({ act: null, scene: legacy, cue: null });
  assert.deepEqual(sceneStage.props.map(p => p.id), ['bed']);
  assert.equal(sceneStage.led, 'morning.mp4', 'its LED content comes through too');
});

test('a real patch wins over a legacy base, so a save is not undone', () => {
  const row = {
    base: { props: [{ id: 'bed', def_id: 'def_bed', pos: [0, 1] }], lighting: {}, led: null },
    patch: withAdd(emptyPatch(), { id: 'cart', def_id: 'def_cart', pos: [2, 3] })
  };
  const patch = scenePatchFrom(row, emptyBase());
  assert.deepEqual(Object.keys(patch.props), ['cart'], 'the base is ignored once a patch exists');
});

test('a scene layers its own lighting over the act, without taking its props', () => {
  const inherited = sceneInherits(
    { props: [{ id: 'bed' }], lighting: { fw_c: { on: false } }, led: 'act.mp4' },
    { props: [], lighting: { fw_c: { on: true } }, led: null });
  assert.deepEqual(inherited.props.map(p => p.id), ['bed'], 'props come from the act');
  assert.equal(inherited.lighting.fw_c.on, true, 'the nearer level wins');
  assert.equal(inherited.led, 'act.mp4', 'and falls back to the act');
});
