/* Prop schema migration + plan-view geometry — pure, no browser.
   Run: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProps, serializeProps } from '../src/props/schema.js';
import {
  defFootprint, partPlanSize, snap, snapAngle, pointInInstance, instanceCorners
} from '../src/props/plangeo.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('committed data/props.json normalises cleanly and round-trips', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/props.json', import.meta.url)));
  const doc = normalizeProps(raw);
  assert.ok(doc.definitions.length >= 1);
  assert.ok(doc.instances.length >= 1);
  /* every instance points at a real definition */
  for (const i of doc.instances) assert.ok(doc.definitions.some(d => d.id === i.def), `orphan ${i.id}`);
  /* serialise → normalise is a fixed point */
  assert.deepEqual(normalizeProps(serializeProps(doc)), doc);
});

test('legacy flat props migrate to definitions + instances, ids kept', () => {
  const legacy = {
    props: [{
      id: 'pizza_counter', name: 'Pizza counter', type: 'primitive', shape: 'box',
      size: [1.8, 0.95, 0.6], pos: [-3, 2], on: 'forestage', rot: 0,
      confidence: 'est', scenes: ['s03'], enabled: true
    }, {
      id: 'flat_a', name: 'Flat', type: 'image', file: 'x.png',
      size: [2.44, 1.22], pos: [6, -1], on: 'stage', rot: -15, scenes: [], enabled: false
    }]
  };
  const doc = normalizeProps(legacy);
  assert.equal(doc.instances.length, 2);
  assert.equal(doc.instances[0].id, 'pizza_counter');
  assert.equal(doc.instances[0].scenes[0], 's03');
  const d0 = doc.definitions.find(d => d.id === doc.instances[0].def);
  assert.equal(d0.parts[0].shape, 'box');
  assert.deepEqual(d0.parts[0].size, [1.8, 0.95, 0.6]);
  const d1 = doc.definitions.find(d => d.id === doc.instances[1].def);
  assert.equal(d1.parts[0].shape, 'plane');
  assert.equal(d1.parts[0].file, 'x.png');
  assert.equal(doc.instances[1].enabled, false);
});

test('defFootprint — a centred box is half its size', () => {
  const fp = defFootprint({ parts: [{ shape: 'box', size: [2, 1, 0.6], offset: [0, 0, 0], rot: 0 }] });
  near(fp.hw, 1, 1e-9, 'hw'); near(fp.hd, 0.3, 1e-9, 'hd');
  near(fp.cx, 0, 1e-9, 'cx'); near(fp.cz, 0, 1e-9, 'cz');
});

test('defFootprint — part offset shifts the centre and grows the box', () => {
  const fp = defFootprint({ parts: [
    { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0], rot: 0 },
    { shape: 'box', size: [1, 0.1, 1], offset: [1, 1, 0], rot: 0 }
  ] });
  near(fp.cx, 0.5, 1e-9, 'cx');            // spans x −0.5 … 1.5
  near(fp.hw, 1, 1e-9, 'hw');
});

test('defFootprint — a 90° part swaps width and depth', () => {
  const fp = defFootprint({ parts: [{ shape: 'box', size: [2, 1, 0.5], offset: [0, 0, 0], rot: 90 }] });
  near(fp.hw, 0.25, 1e-6, 'hw'); near(fp.hd, 1, 1e-6, 'hd');
});

test('partPlanSize — cylinder uses its diameter both ways', () => {
  assert.deepEqual(partPlanSize({ shape: 'cylinder', size: [0.9, 0.75] }), [0.9, 0.9]);
});

test('snap + snapAngle', () => {
  near(snap(1.13, 0.25), 1.25, 1e-9, 'snap');
  assert.equal(snap(1.13, 0), 1.13);
  assert.equal(snapAngle(7), 0);
  assert.equal(snapAngle(8), 15);
  assert.equal(snapAngle(358), 0);
  assert.equal(snapAngle(352), 345);
  assert.equal(snapAngle(190, 90), 180);
});

test('pointInInstance — inside, edge, and after a rotation', () => {
  const def = { parts: [{ shape: 'box', size: [2, 1, 1], offset: [0, 0, 0], rot: 0 }] };
  const inst = { pos: [5, 3], rot: 0 };
  assert.equal(pointInInstance(5, 3, inst, def), true);
  assert.equal(pointInInstance(5.9, 3, inst, def), true);
  assert.equal(pointInInstance(6.2, 3, inst, def), false);
  /* rotate 90° — the 2 m axis now lies along z */
  const rot = { pos: [5, 3], rot: 90 };
  assert.equal(pointInInstance(5, 3.9, rot, def), true);
  assert.equal(pointInInstance(5.9, 3, rot, def), false);
});

test('instanceCorners returns four points', () => {
  const def = { parts: [{ shape: 'box', size: [1, 1, 1], offset: [0, 0, 0], rot: 0 }] };
  const pts = instanceCorners({ pos: [0, 0], rot: 30 }, def);
  assert.equal(pts.length, 4);
});
