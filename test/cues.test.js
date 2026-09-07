import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, parseCues, schedule, hhmmToMin, durToSec, fmtClock, fmtDur } from '../src/cues.js';

test('parseCsv handles quotes, embedded commas and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y",\"he said \"\"hi\"\"\"\n,,\n2,plain,');
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['1', 'x, y', 'he said "hi"']);
  assert.deepEqual(rows[2], ['2', 'plain', '']);   // the blank ,, line is dropped
});

test('time parsing', () => {
  assert.equal(hhmmToMin('17:00'), 1020);
  assert.equal(hhmmToMin(''), null);
  assert.equal(durToSec('5m'), 300);
  assert.equal(durToSec('30s'), 30);
  assert.equal(durToSec('7m30s'), 450);
  assert.equal(durToSec('1h'), 3600);
  assert.equal(durToSec('4'), 240);           // bare number = minutes
  assert.equal(durToSec(''), 0);
  assert.equal(fmtClock(1020), '17:00');
  assert.equal(fmtClock(null), '—');
  assert.equal(fmtDur(3900), '1h 5m');
});

test('schedule fills blank starts from the previous end', () => {
  const cues = parseCues(
    'cue,section,phase,start,dur,item\n' +
    '1,OPEN,PRE-MSM,17:00,5m,first\n' +
    '2,OPEN,PRE-MSM,,3m,second\n' +
    '3,ACT,MSM,18:00,10m,jump');
  const s = schedule(cues);
  assert.equal(s.cues[1].startMin, 1025);          // 17:05
  assert.equal(s.cues[1].endMin, 1028);
  assert.equal(s.cues[2].startMin, 1080);          // explicit start wins
  assert.equal(s.sections.length, 2);
  assert.equal(s.sections[0].durSec, 480);
  assert.equal(s.total.startMin, 1020);
  assert.equal(s.total.endMin, 1090);
  assert.equal(s.phases['MSM'].cues, 1);
});

test('sample cue sheet is valid against the scene list', () => {
  const csv = readFileSync(new URL('../data/cues.csv', import.meta.url), 'utf8');
  const scenes = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url), 'utf8'))
    .scenes.map(s => s.id);
  const s = schedule(parseCues(csv));
  assert.ok(s.cues.length >= 10, 'has a realistic number of cues');
  const known = new Set(['PRE-MSM', 'MSM ENTRY', 'MSM', 'NO-MSM']);
  for (const c of s.cues) {
    assert.ok(!c.scene || scenes.includes(c.scene), `scene ${c.scene} exists (cue ${c.cue})`);
    assert.ok(!c.phase || known.has(c.phase), `phase ${c.phase} is known (cue ${c.cue})`);
    assert.notEqual(c.startMin, null, `cue ${c.cue} has a resolvable start`);
  }
  for (let i = 1; i < s.cues.length; i++)
    assert.ok(s.cues[i].startMin >= s.cues[i - 1].startMin, `cue ${s.cues[i].cue} does not go backwards`);
  assert.ok(s.total.runSec > 0 && s.sections.length >= 4);
});
