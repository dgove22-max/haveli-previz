import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationSeconds, scheduleFromAllocations } from '../src/sheets/schedule.js';

const cue = (item, duration, extra = {}) => ({ id: item, item, duration, ...extra });

test('allocations read as minutes:seconds, with hours when there are three parts', () => {
  assert.equal(allocationSeconds('01:30'), 90);
  assert.equal(allocationSeconds('00:10'), 10);
  assert.equal(allocationSeconds(' 04:00 '), 240);
  assert.equal(allocationSeconds('0:45:39'), 45 * 60 + 39);
  for (const bad of ['', null, undefined, '#REF!', 'TBC', '1:5'])
    assert.equal(allocationSeconds(bad), null, String(bad));
});

test('each row starts when the one before it ends', () => {
  const out = scheduleFromAllocations(
    [cue('Swagat Dance', '01:45'), cue('Brand New Day', '01:00'), cue('Beta Uthh', '00:40')], '19:00');
  assert.deepEqual(out.map(c => [c.start_time, c.end_time]), [
    ['19:00:00', '19:01:45'],
    ['19:01:45', '19:02:45'],
    ['19:02:45', '19:03:25']
  ]);
});

test('rows before the first allocation are pre-show and get no time', () => {
  const out = scheduleFromAllocations(
    [cue('Pre-Entry', ''), cue('Squeeze Time', ''), cue('Swagat Dance', '01:45')], '19:00');
  assert.deepEqual(out.map(c => c.start_time), ['', '', '19:00:00']);
  assert.ok(!out[0].no_allocation);
});

test('a missing allocation after the start counts as zero and is flagged', () => {
  const out = scheduleFromAllocations(
    [cue('A', '01:00'), cue('B', ''), cue('C', '00:30')], '19:00');
  assert.deepEqual(out[1], { ...out[1], start_time: '19:01:00', end_time: '19:01:00', no_allocation: true });
  assert.equal(out[2].start_time, '19:01:00');
  assert.ok(!out[2].no_allocation);
});

test("the sheet's own Start and End columns are ignored, broken or not", () => {
  const out = scheduleFromAllocations([
    cue('Jingle - Fighting Back', '01:30', { start_time: '19:14:44', end_time: '19:17:14' }),
    cue('Balak Prasang', '00:30', { start_time: '19:17:14', end_time: '19:15:14' }),
    cue('Attendance with Akshar', '01:30', { start_time: '#REF!', end_time: '#REF!' })
  ], '19:14:44');
  assert.deepEqual(out.map(c => [c.start_time, c.end_time]), [
    ['19:14:44', '19:16:14'],
    ['19:16:14', '19:16:44'],
    ['19:16:44', '19:18:14']
  ]);
});

test('without a start time, times are cleared rather than guessed', () => {
  for (const startsAt of [undefined, '', 'TBC']) {
    const out = scheduleFromAllocations([cue('A', '01:00', { start_time: '#REF!' })], startsAt);
    assert.equal(out[0].start_time, '');
    assert.equal(out[0].end_time, '');
  }
});

test('the input cues are not modified', () => {
  const input = [cue('A', '01:00', { start_time: '#REF!' })];
  scheduleFromAllocations(input, '19:00');
  assert.equal(input[0].start_time, '#REF!');
  assert.equal(input[0].end_time, undefined);
});
