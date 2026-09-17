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
