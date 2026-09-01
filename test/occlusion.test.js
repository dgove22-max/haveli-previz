/* Verifies the occlusion maths against the numbers published in SPEC §5.
   Run: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flatten, derive } from '../src/model.js';
import { curtainClip, cabinBlock, performerBand, cabinShadowFromSeat, upscale, fitRect } from '../src/occlusion.js';

const venueRaw = JSON.parse(readFileSync(new URL('../data/venue.json', import.meta.url)));
const { values: V } = flatten(venueRaw);
const D = derive(V);

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('derived constants match the prototype', () => {
  near(D.FRONTAGE, 26.30, 1e-9, 'frontage');
  near(D.LED_Z, -7.20, 1e-9, 'LED z');
  near(D.CURT_Z, -3.70, 1e-9, 'curtain z');
  near(D.CURT_IN, 12.01, 1e-9, 'curtain inner edge');
  near(D.CABIN_D, 5.75, 0.005, 'cabin depth');
  near(D.PITCH_MM, 2.5, 1e-9, 'pixel pitch');
  near(D.PX_PER_M, 400, 1e-9, 'px per metre');
  near(D.LED_BASE_Y, 1.605, 1e-9, 'LED base height');
  near(D.CABIN_TOP_Y, 4.965, 1e-9, 'cabin top height');
});

test('SPEC §5: curtains clip ≈0.79 m ≈ 316 px per side', () => {
  const c = curtainClip(V, D);
  near(c.metres, 0.79, 0.005, 'clip metres');
  near(c.px, 316, 2, 'clip px');
  assert.ok(c.bleedPx >= c.px && c.bleedPx <= 330, 'bleed rounds up sensibly');
});

test('SPEC §5: cabin blocks ≈7.44 m ≈29% of width, 1.44 m clear above', () => {
  const b = cabinBlock(V, D);
  near(b.wM, 7.44, 1e-9, 'blocked width');
  near(b.fracW, 0.29, 0.005, 'fraction of width');
  near(b.clearAboveM, 1.44, 1e-9, 'clear band above cabin');
  near(b.hM, 3.36, 1e-9, 'blocked height above LED base');
  near(b.hPx, 1344, 1, 'blocked height px');
  near(b.x0, 3632, 1, 'block left px');
  near(b.x1, 6608, 1, 'block right px');
});

test("SPEC §5: 5'6\" performer occupies roughly the bottom quarter", () => {
  const p = performerBand(V, D);
  near(p.frac, 0.25, 0.03, 'fraction of canvas height');
});

test('parallax: shadow grows for near seats, tends to straight-on far away', () => {
  const far = cabinShadowFromSeat(V, D, { z: 5000 });
  near(far.hM, cabinBlock(V, D).hM, 0.01, 'far seat ≈ orthographic');
  const front = cabinShadowFromSeat(V, D, { z: 8 });
  assert.ok(front.hM > far.hM, 'front seat blocked more');
  assert.ok(front.k > 1.5, 'projection factor grows near the stage');
  const mid = cabinShadowFromSeat(V, D, { z: 25 });
  assert.ok(front.hM > mid.hM && mid.hM > far.hM, 'monotonic with distance');
});

test('SPEC §7: 1080p across 25.6 m reads as 5.3× upscale', () => {
  const u = upscale(1920, 1080, 'width', V.led);
  near(u.scaleX, 5.33, 0.05, 'scale factor');
  assert.match(u.label, /5\.3× upscale/);
  assert.equal(upscale(10240, 1920, 'native', V.led).label, '1× native');
});

test('fitRect maps sources onto the canvas correctly', () => {
  const led = V.led, cw = 2560, ch = 480;
  const st = fitRect(1920, 1080, 'stretch', led, cw, ch);
  assert.deepEqual([st.x, st.y, st.w, st.h], [0, 0, cw, ch], 'stretch fills');
  const fw = fitRect(1920, 1080, 'width', led, cw, ch);
  near(fw.w, cw, 1e-6, 'fit-width spans full width');
  assert.ok(fw.h > ch, 'fit-width 16:9 overflows the strip vertically');
  near(fw.y, (ch - fw.h) / 2, 1e-6, 'vertically centred');
  const nat = fitRect(2560, 480, 'native', led, cw, ch);
  near(nat.w, 640, 1e-6, 'native: 2560 src px = 640 canvas px at ¼ scale');
});
