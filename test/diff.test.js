import test from 'node:test';
import assert from 'node:assert/strict';
import { diffProgramme, summarise, needsStaging } from '../src/sheets/diff.js';
import { propDigest } from '../src/sheets/tracker.js';

const cue = (o = {}) => ({
  id: 'c1', scene_id: 's1', item: 'Musical', type: 'Musical', type_detail: '',
  live_prerec: 'PREREC', presenter: '', final_status: '',
  sr_prop: '', sl_prop: '', centre_prop: '', canopy: '', sort: 0, ...o
});
const prog = (cues = [], scenes = [], acts = []) => ({ acts, scenes, cues });

test('first pull is flagged, not reported as 65 additions to review', () => {
  const d = diffProgramme(null, prog([cue()]));
  assert.ok(d.isFirstPull);
  assert.equal(summarise(d), 'first pull — nothing accepted yet');
});

test('identical programmes produce no diff', () => {
  const p = prog([cue()]);
  const d = diffProgramme(p, prog([cue()]));
  assert.ok(d.isEmpty);
  assert.equal(summarise(d), 'up to date');
});

test('added and removed cues are separated', () => {
  const d = diffProgramme(
    prog([cue({ id: 'a' }), cue({ id: 'b' })]),
    prog([cue({ id: 'b' }), cue({ id: 'c' })])
  );
  assert.deepEqual(d.kinds.cues.added.map(x => x.id), ['c']);
  assert.deepEqual(d.kinds.cues.removed.map(x => x.id), ['a']);
});

test('field changes are reported with before and after', () => {
  const d = diffProgramme(
    prog([cue({ item: 'Musical', sr_prop: 'BED' })]),
    prog([cue({ item: 'Musical v2', sr_prop: 'BED, CHAIR' })])
  );
  const ch = d.kinds.cues.changed[0];
  assert.equal(ch.fields.length, 2);
  const item = ch.fields.find(f => f.field === 'item');
  assert.equal(item.from, 'Musical');
  assert.equal(item.to, 'Musical v2');
});

test('whitespace-only differences are not changes', () => {
  /* Sheets are full of trailing spaces — "Deodorant " vs "Deodorant". Treating
     those as edits would make every pull look busy and train people to ignore it. */
  const d = diffProgramme(
    prog([cue({ item: 'Sant Compere', sr_prop: 'BED ' })]),
    prog([cue({ item: '  Sant   Compere ', sr_prop: 'BED' })])
  );
  assert.ok(d.isEmpty);
});

test('reordering is reported separately from content changes', () => {
  const d = diffProgramme(
    prog([cue({ id: 'a', sort: 0 }), cue({ id: 'b', sort: 1 })]),
    prog([cue({ id: 'a', sort: 1 }), cue({ id: 'b', sort: 0 })])
  );
  assert.equal(d.kinds.cues.changed.length, 0, 'nothing changed in content');
  assert.equal(d.reordered.length, 2);
  assert.ok(!d.isEmpty);
});

test('summary counts each kind', () => {
  const d = diffProgramme(
    prog([cue({ id: 'a' })], [{ id: 's1', act_id: 'a1', code: 'A1', name: 'One', sort: 0 }]),
    prog([cue({ id: 'a', item: 'Changed' }), cue({ id: 'b' })],
         [{ id: 's1', act_id: 'a1', code: 'A1', name: 'Renamed', sort: 0 }])
  );
  assert.equal(summarise(d), '1 scene · 2 cues');
});

test('needsStaging flags cues the sheet lists props for but nothing was staged', () => {
  const cues = [
    cue({ id: 'a', sr_prop: 'BED' }),
    cue({ id: 'b' })                              // sheet lists no props at all
  ];
  const out = needsStaging(cues, new Map(), propDigest);
  assert.equal(out.length, 1);
  assert.equal(out[0].cue.id, 'a');
  assert.equal(out[0].reason, 'never staged');
});

test('needsStaging flags a cue whose sheet props changed after staging', () => {
  const c = cue({ id: 'a', sr_prop: 'BED, CHAIR' });
  const states = new Map([['cue:a', {
    patch: { props: { bed: { op: 'move', pos: [1, 1] } }, lighting: {}, led: null },
    prop_digest: 'BED |  |  | '           // what the sheet said when it was staged
  }]]);
  const out = needsStaging([c], states, propDigest);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, 'sheet props changed since staged');
  assert.equal(out[0].now, 'BED, CHAIR |  |  | ');
});

test('needsStaging leaves an up-to-date staged cue alone', () => {
  const c = cue({ id: 'a', sr_prop: 'BED' });
  const states = new Map([['cue:a', {
    patch: { props: { bed: { op: 'move', pos: [1, 1] } }, lighting: {}, led: null },
    prop_digest: propDigest(c)
  }]]);
  assert.equal(needsStaging([c], states, propDigest).length, 0);
});
