import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTracker, propDigest, slug } from '../src/sheets/tracker.js';

/* The real tracker's two header rows, verbatim — the group banner then the
   column names. Tests build data rows into the same 26-wide shape. */
const HEAD_GROUP = 'TIME,TIME,,,,,,PROGRAM,,,,,,,, TRACKERS,,,,,,Backstage,,,,Lighting State';
const HEAD = 'VATSAL (ABC),old,current,Start Time,End Time,Time in between ,Allocation,' +
  'ACT,#,SCENE,,TYPE,,LIVE/PREREC,Presenter,Music/Sound,Script/Cast - ,Content/LED,' +
  'FINAL,Briefs/Docs,Stage State,SR BIG PROP,SL BIG PROP,CENTRE PROPS,CANOPY,';

const COL = { act: 7, num: 8, scene: 9, item: 10, type: 11, detail: 12, live: 13,
              presenter: 14, final: 18, sr: 21, sl: 22, centre: 23, canopy: 24 };

const row = (o = {}) => {
  const r = new Array(26).fill('');
  for (const [k, i] of Object.entries(COL)) if (o[k] != null) r[i] = o[k];
  return r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
};
const csv = (...rows) => [HEAD_GROUP, HEAD, ...rows].join('\n');

test('finds the header row rather than assuming an index', () => {
  const { acts } = parseTracker(csv(row({ act: 'ACT 1', scene: 'S', item: 'I' })));
  assert.equal(acts.length, 1);
  assert.equal(acts[0].name, 'ACT 1');
});

test('ACT fills down — a blank cell means the act above', () => {
  const { acts, scenes } = parseTracker(csv(
    row({ act: 'ACT 1\nMorning', num: 'A1S1', scene: 'Waking', item: 'Beta Uthh' }),
    row({ num: 'A1S2', scene: 'Mayhem', item: 'Musical' }),
    row({ act: 'ACT 2', num: 'A2S1', scene: 'Hate', item: 'Song' })
  ));
  assert.equal(acts.length, 2);
  assert.equal(scenes.filter(s => s.act_id === acts[0].id).length, 2,
    'both A1 scenes belong to Act 1');
  assert.equal(scenes.filter(s => s.act_id === acts[1].id).length, 1);
});

test('# fills down — rows with no code are sub-states of the scene above', () => {
  const { scenes, cues } = parseTracker(csv(
    row({ act: 'A', num: 'A1S2', scene: 'Morning Mayhem', item: 'Mayhem Musical' }),
    row({ item: 'Barabar Brush Karo' }),
    row({ item: 'Brush Our Teeth!' }),
    row({ item: 'Sant Compere' })
  ));
  assert.equal(scenes.length, 1, 'one scene');
  assert.equal(cues.length, 4, 'four sub-states under it');
  assert.ok(cues.every(c => c.scene_id === scenes[0].id));
});

test('duplicate # codes in different acts get distinct ids', () => {
  /* "VO" really does appear twice in the tracker — in PRO 1 and in ACT 6.
     Keying on the code alone would collapse them into one scene. */
  const { scenes } = parseTracker(csv(
    row({ act: 'PRO 1', num: 'VO', scene: 'Curtains Closed', item: 'Brand New Day' }),
    row({ act: 'ACT 6: Games', num: 'VO', scene: 'Sakshat Aarti', item: 'Aarti' })
  ));
  assert.equal(scenes.length, 2);
  assert.notEqual(scenes[0].id, scenes[1].id);
  assert.equal(scenes[0].code, 'VO');
  assert.equal(scenes[1].code, 'VO');
});

test('a scene row with no item of its own still produces one cue', () => {
  /* A1J "Jingle - Morning Recap" has a type but an empty ITEM cell. Without
     this the scene would exist with nothing to click. */
  const { scenes, cues } = parseTracker(csv(
    row({ act: 'A', num: 'A1J', scene: 'Jingle - Morning Recap', type: 'Jingle', live: 'PREREC' })
  ));
  assert.equal(scenes.length, 1);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].item, 'Jingle - Morning Recap');
  assert.equal(cues[0].type, 'Jingle');
});

test('a scene can start from a SCENE name with no code at all', () => {
  const { scenes } = parseTracker(csv(
    row({ act: 'PRO 1', scene: 'Pre-entry', item: 'TBC' }),
    row({ scene: 'Bapa Swagat', item: 'Swagat Dance' })
  ));
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].code, '');
  assert.equal(scenes[1].name, 'Bapa Swagat');
});

test('blank spacer rows are skipped, not treated as cues', () => {
  const { cues } = parseTracker(csv(
    row({ act: 'A', num: 'A1S1', scene: 'S', item: 'One' }),
    row({}),
    row({}),
    row({ item: 'Two' })
  ));
  assert.equal(cues.length, 2);
  assert.deepEqual(cues.map(c => c.item), ['One', 'Two']);
});

test('repeated item names within one scene stay unique', () => {
  /* "Sant Compere" appears under most Act 1 scenes and twice would collide. */
  const { cues } = parseTracker(csv(
    row({ act: 'A', num: 'A1S1', scene: 'S', item: 'Sant Compere' }),
    row({ item: 'Sant Compere' })
  ));
  assert.equal(cues.length, 2);
  assert.notEqual(cues[0].id, cues[1].id);
});

test('the four prop columns are captured per cue', () => {
  const { cues } = parseTracker(csv(
    row({ act: 'A', num: 'A1S2', scene: 'Morning Mayhem', item: 'Musical',
          sr: 'SINK VANITY AREA', sl: 'DRESSER', centre: 'BED, CHAIR', canopy: 'NA' })
  ));
  assert.equal(cues[0].sr_prop, 'SINK VANITY AREA');
  assert.equal(cues[0].centre_prop, 'BED, CHAIR');
  assert.equal(propDigest(cues[0]), 'SINK VANITY AREA | DRESSER | BED, CHAIR | NA');
});

test('sort is monotonic in row order', () => {
  const { cues } = parseTracker(csv(
    row({ act: 'A', num: 'A1S1', scene: 'S', item: 'One' }),
    row({ item: 'Two' }),
    row({ act: 'B', num: 'B1S1', scene: 'T', item: 'Three' })
  ));
  assert.deepEqual(cues.map(c => c.sort), [0, 1, 2]);
});

test('throws a useful error on the wrong tab', () => {
  assert.throws(() => parseTracker('a,b,c\n1,2,3'), /no header row containing "ACT"/);
});

test('slug is stable and url-safe', () => {
  assert.equal(slug('ACT 1\nMorning'), 'act-1-morning');
  assert.equal(slug('ACT 4: Lunch'), 'act-4-lunch');
  assert.equal(slug("Where's My Tie"), 'where-s-my-tie');
  assert.equal(slug(''), '');
});
