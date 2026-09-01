import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flatten, derive } from '../src/model.js';
import { beamDir, fixtureWorld, spillOnLed, glareOnGlass, coneLength, groundHit } from '../src/lightmath.js';

const venueRaw = JSON.parse(readFileSync(new URL('../data/venue.json', import.meta.url)));
const { values: V } = flatten(venueRaw);
const D = derive(V);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('beamDir conventions', () => {
  const down = beamDir(0, 0);
  near(down.y, -1, 1e-9, 'tilt 0 is straight down');
  const upstage = beamDir(0, 90);
  near(upstage.z, -1, 1e-9, 'tilt 90 pan 0 faces upstage');
  const ladies = beamDir(90, 90);
  near(ladies.x, 1, 1e-9, 'pan 90 faces +X');
});

test('grid placement uses the (estimated) coffer', () => {
  const p = fixtureWorld({ grid: [-2, 1] }, V);
  near(p.x, -2 * V.coffer.spacingX, 1e-9, 'x from grid');
  near(p.y, V.coffer.soffit, 1e-9, 'hangs at the soffit');
  near(p.z, V.coffer.zOffset + V.coffer.spacingZ, 1e-9, 'z from grid');
});

test('straight-down fixture over the forestage: no spill, no glare', () => {
  const f = { grid: [0, 1], pan: 0, tilt: 0, beam: 30 };
  assert.equal(spillOnLed(f, V, D).hit, false, 'no spill');
  assert.equal(glareOnGlass(f, V, D).hit, false, 'no glare');
  const t = groundHit(fixtureWorld(f, V), beamDir(0, 0), V, D);
  near(t, V.coffer.soffit - D.FS_H, 1e-6, 'beam lands on the forestage');
});

test('fixture aimed at the LED centre spills, centred', () => {
  /* from the first coffer row, aim the axis at LED mid-height */
  const pos = fixtureWorld({ grid: [0, 1] }, V);
  const dz = D.LED_Z - pos.z, dy = (D.LED_BASE_Y + V.led.height / 2) - pos.y;
  const tilt = Math.atan2(Math.abs(dz), -dy) * 180 / Math.PI;
  const f = { grid: [0, 1], pan: 0, tilt, beam: 20 };
  const s = spillOnLed(f, V, D);
  assert.ok(s.hit, 'spill detected');
  near((s.box.x0 + s.box.x1) / 2, V.led.pxW / 2, 60, 'patch centred');
});

test('default front wash grazes the LED (the check earns its keep)', () => {
  const f = { grid: [0, 1], pan: 0, tilt: 52, beam: 32 };
  assert.ok(spillOnLed(f, V, D).hit, 'upper rim of a 32° wash at 52° tilt reaches the LED');
});

test('a shallow fixture on the cabin glass throws glare into the house', () => {
  const f = { grid: [0, 1], pan: 0, tilt: 63, beam: 20 };
  const g = glareOnGlass(f, V, D);
  assert.ok(g.hit, 'glare detected');
  assert.ok(g.zMin >= 6 && g.zMax < D.HALL_FRONT_Z, `seats in hall range (${g.zMin?.toFixed(1)}–${g.zMax?.toFixed(1)} m)`);
});

test('cone length stops at surfaces and is capped', () => {
  const down = coneLength({ grid: [0, 1], pan: 0, tilt: 0, beam: 30 }, V, D);
  near(down, V.coffer.soffit - D.FS_H, 1e-6, 'down to forestage');
  const flat = coneLength({ grid: [0, 6], pan: 0, tilt: 89, beam: 30 }, V, D);
  assert.ok(flat <= 24.01, 'capped');
});
