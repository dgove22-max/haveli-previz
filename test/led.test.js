import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedTracker, joinLed } from '../src/sheets/led.js';

const CSV = [
  'No. ,Item Name,Audio,Image,Video,Side Screen Alpha,LED,Item Description,Dependency,Ideas,Priority,Status,Assigned to',
  ',Swagat LED backdrop,N,N,Y,N,Y,early morning,,,Low,Complete,Sanjaybhai',
  '#REF!,General Holding,N,N,Y,N,Y,Logo animation,,,Low,Complete,Sanjaybhai',
  ',#REF!,,,,,,,,,,,',
  ',,,,,,,,,,,,'
].join('\n');

test('parses rows and reads the Y/N flags', () => {
  const rows = parseLedTracker(CSV);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Swagat LED backdrop');
  assert.equal(rows[0].video, true);
  assert.equal(rows[0].audio, false);
  assert.equal(rows[0].status, 'Complete');
});

test('skips #REF! and blank rows', () => {
  assert.ok(!parseLedTracker(CSV).some(r => r.name.includes('REF')));
});

test('joins onto cues by normalised item name', () => {
  const cues = [
    { id: 'a', item: 'Swagat LED Backdrop' },        // different case
    { id: 'b', item: 'Something with no content row' }
  ];
  const out = joinLed(cues, parseLedTracker(CSV));
  assert.equal(out[0].led_item, 'Swagat LED backdrop');
  assert.equal(out[0].led_meta.video, true);
  assert.equal(out[1].led_item, undefined, 'unmatched cue passes through untouched');
});

test('throws only when the tab is clearly wrong', () => {
  assert.throws(() => parseLedTracker('a,b\n1,2'), /Item Name/);
});
