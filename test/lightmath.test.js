import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flatten, derive } from '../src/model.js';
import { beamDir, fixtureWorld, spillOnLed, glareOnGlass, coneLength, groundHit, spotTarget, glowIntensity } from '../src/lightmath.js';

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

test('an upward beam stops at the ceiling, not the 24 m cap', () => {
  /* groundHit only tests downward planes, so anything aimed up used to fall
     through to the cap and draw a 24 m cone across the whole hall. */
  const up = { pos: [0, 1.1, 4], pan: 0, tilt: 135, beam: 16 };
  const len = coneLength(up, V, D);
  const rise = Math.cos(45 * Math.PI / 180);            // vertical component
  near(len, (V.hall.wallHeight - 1.1) / rise, 1e-6, 'terminates on the ceiling');
  assert.ok(len < 24, 'and is well short of the cap');
});

test('a wide beam is limited by tip radius, not length', () => {
  /* Width is what makes the view unreadable. A 120 deg cone run to any real
     length buries the model, so the tip radius is what gets capped. */
  const wide = coneLength({ pos: [0, 6, 4], pan: 0, tilt: 0, beam: 120 }, V, D, 24, 4);
  const tipR = wide * Math.tan(60 * Math.PI / 180);
  assert.ok(tipR <= 4.01, `tip radius capped (${tipR.toFixed(2)} m)`);

  const narrow = coneLength({ pos: [0, 6, 4], pan: 0, tilt: 0, beam: 10 }, V, D, 24, 4);
  assert.ok(narrow > wide, 'a narrow beam is still allowed to run long');
});

test('an explicit throw overrides the raycast', () => {
  /* Cabin-interior units sit inside a volume the raycast does not model, and
     pixel tape grazes a surface rather than throwing a beam. */
  const len = coneLength({ pos: [0, 4.6, -3], pan: 0, tilt: 130, beam: 18, throw: 2.5 }, V, D);
  near(len, 2.5, 1e-9, 'uses the stated throw');
});

test('a beam landing on the deck/forestage seam still lands', () => {
  /* The floor planes have exclusive bounds, so a ray hitting the z = 0 join
     between the main deck and the performance stage missed both and reported
     "never lands" — drawing a 23 m cone from a bar fixture aimed at the floor. */
  const seam = { x: 0, y: 6.5, z: 2.44 };
  const dir = beamDir(0, 25);
  const t = groundHit(seam, dir, V, D);
  assert.ok(Number.isFinite(t), 'lands on something');
  assert.ok(t < 12, `and lands nearby, not at the cap (${t.toFixed(1)} m)`);
});

test('spotTarget lands the front wash on the deck, the special on the forestage', () => {
  const fw = { grid: [0, 1], pan: 0, tilt: 52, beam: 32 };
  const t1 = spotTarget(fw, V, D);
  assert.ok(t1.z < 0 && t1.z > D.UPWALL_Z, `front wash lands on stage (z=${t1.z.toFixed(2)})`);
  assert.ok(t1.throw > 0 && t1.throw <= 24.01);
  const sp = { grid: [0, 2], pan: 0, tilt: 38, beam: 22 };
  const t2 = spotTarget(sp, V, D);
  assert.ok(t2.z > 0 && t2.z < D.FS_D + 0.5, `special lands on the forestage (z=${t2.z.toFixed(2)})`);
});

test('glowIntensity is monotonic and bounded', () => {
  assert.ok(glowIntensity(0) > 0, 'black content still leaks a little');
  assert.ok(glowIntensity(1) <= 9);
  let prev = -1;
  for (let l = 0; l <= 1.001; l += 0.1) {
    const v = glowIntensity(l);
    assert.ok(v > prev, `monotonic at ${l.toFixed(1)}`);
    prev = v;
  }
});
