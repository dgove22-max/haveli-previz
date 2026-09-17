import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseAlias, splitPropText, quantityOf, matchCueProps, unmatched, modellingBacklog
} from '../src/propmatch.js';

const defs = [
  { id: 'def_bed', name: 'Bed' },
  { id: 'def_chair', name: 'Chair' },
  { id: 'def_sink', name: 'Sink vanity area' }
];
const cue = (o = {}) => ({ id: 'c1', sr_prop: '', sl_prop: '', centre_prop: '', canopy: '', ...o });

test('splits on commas and newlines', () => {
  assert.deepEqual(splitPropText('BED, CHAIR'), ['BED', 'CHAIR']);
  assert.deepEqual(splitPropText('Bed\nChair\n'), ['Bed', 'Chair']);
});

test('does NOT split on slashes', () => {
  /* "Sink/mirror" and "Mirror / Whiteboard" are single props in this sheet. */
  assert.deepEqual(splitPropText('Sink/mirror'), ['Sink/mirror']);
  assert.deepEqual(splitPropText('Mirror / Whiteboard'), ['Mirror / Whiteboard']);
});

test('placeholder cells resolve to nothing', () => {
  for (const s of ['NA', 'n/a', '-', 'None', '']) {
    assert.deepEqual(splitPropText(s), [], `"${s}" should be empty`);
  }
});

test('a real prop is never dropped as a placeholder', () => {
  assert.deepEqual(splitPropText('TBC'), ['TBC'], 'TBC is unresolved, not absent');
});

test('normalise strips parentheticals and punctuation', () => {
  assert.equal(normaliseAlias('Bed (wheels)'), 'bed');
  assert.equal(normaliseAlias('Toothbrush (hand-sized)'), 'toothbrush');
  assert.equal(normaliseAlias('SINK VANITY AREA'), 'sink vanity area');
  assert.equal(normaliseAlias("Parent's Love"), 'parent s love');
});

test('quantity is read from (xN)', () => {
  assert.equal(quantityOf('Tables (x12)'), 12);
  assert.equal(quantityOf('Chairs x4'), 4);
  assert.equal(quantityOf('Bed'), 1);
});

test('matches case-insensitively across all four areas', () => {
  const m = matchCueProps(cue({ sr_prop: 'SINK VANITY AREA', centre_prop: 'BED, CHAIR' }), defs);
  assert.equal(m.length, 3);
  assert.equal(m.find(p => p.raw === 'SINK VANITY AREA').def.id, 'def_sink');
  assert.equal(m.find(p => p.raw === 'BED').def.id, 'def_bed');
  assert.equal(m.find(p => p.raw === 'BED').area, 'centre');
});

test('unmatched props are reported, not dropped', () => {
  const m = matchCueProps(cue({ sr_prop: 'DRESSER, BED' }), defs);
  assert.equal(m.length, 2);
  assert.deepEqual(unmatched(m).map(p => p.raw), ['DRESSER']);
});

test('an alias resolves a phrase a human matched once', () => {
  const aliases = new Map([['dresser', 'def_bed']]);
  const m = matchCueProps(cue({ sr_prop: 'DRESSER' }), defs, aliases);
  assert.equal(m[0].def.id, 'def_bed');
});

test('a parenthetical does not prevent a match', () => {
  const m = matchCueProps(cue({ centre_prop: 'Bed (wheels)' }), defs);
  assert.equal(m[0].def.id, 'def_bed');
  assert.equal(m[0].raw, 'Bed (wheels)', 'raw text preserved for display');
});

test('backlog tallies distinct unmatched phrases across the show', () => {
  const cues = [
    cue({ id: 'a', sr_prop: 'DRESSER' }),
    cue({ id: 'b', sr_prop: 'dresser', centre_prop: 'BED' }),
    cue({ id: 'c', canopy: 'PIZZA CART' })
  ];
  const b = modellingBacklog(cues, defs, new Map());
  assert.equal(b.length, 2);
  assert.equal(b[0].norm, 'dresser');
  assert.equal(b[0].count, 2, 'both spellings counted as one prop');
  assert.deepEqual(b[0].cues, ['a', 'b']);
});
