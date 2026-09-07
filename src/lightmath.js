/* Lighting maths — pure functions, tested in test/lightmath.test.js.
   Answers SPEC §6's three questions: spill on the LED, glare on the cabin
   glass, cabin shadowing of front light. Ray sampling, no photometry. */

export function fixtureWorld(f, V) {
  if (f.pos) return { x: f.pos[0], y: f.pos[1], z: f.pos[2] };
  const cf = V.coffer;
  return {
    x: (f.grid?.[0] ?? 0) * cf.spacingX,
    y: cf.soffit,
    z: cf.zOffset + (f.grid?.[1] ?? 0) * cf.spacingZ
  };
}

/* pan: about Y, 0 = facing upstage (−Z), +ve toward +X (ladies side).
   tilt: from straight down, 0 = down, tipping toward the pan direction. */
export function beamDir(panDeg, tiltDeg) {
  const pan = panDeg * Math.PI / 180, tilt = tiltDeg * Math.PI / 180;
  return {
    x: Math.sin(pan) * Math.sin(tilt),
    y: -Math.cos(tilt),
    z: -Math.cos(pan) * Math.sin(tilt)
  };
}

/* Axis + rim rays of the cone (n around the rim at the half-angle). */
export function coneRays(dir, beamDeg, n = 16) {
  const a = beamDeg / 2 * Math.PI / 180;
  const u = normalize(cross(dir, Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
  const v = cross(dir, u);
  const rays = [dir];
  for (let i = 0; i < n; i++) {
    const th = i / n * 2 * Math.PI;
    rays.push(normalize(add(scale(dir, Math.cos(a)),
      scale(add(scale(u, Math.cos(th)), scale(v, Math.sin(th))), Math.sin(a)))));
  }
  return rays;
}

/* First ground the ray lands on: main deck, forestage, or hall floor.
   Returns t (distance) or Infinity. */
export function groundHit(pos, dir, V, D) {
  const planes = [
    { y: V.stage.deckHeight, zMin: D.UPWALL_Z, zMax: 0, xMax: D.SIDE_WALL },
    { y: D.FS_H, zMin: 0, zMax: D.FS_D, xMax: D.FS_W / 2 },
    { y: 0, zMin: D.FS_D, zMax: D.HALL_FRONT_Z, xMax: D.SIDE_WALL }
  ];
  let best = Infinity;
  for (const p of planes) {
    if (dir.y >= 0) continue;
    const t = (p.y - pos.y) / dir.y;
    if (t <= 0) continue;
    const x = pos.x + dir.x * t, z = pos.z + dir.z * t;
    if (Math.abs(x) <= p.xMax && z >= p.zMin && z <= p.zMax) best = Math.min(best, t);
  }
  return best;
}

/* Spill: do any cone rays reach the LED plane inside the LED rectangle
   before hitting the ground? Box is px from LED left edge / bottom. */
export function spillOnLed(f, V, D) {
  const pos = fixtureWorld(f, V);
  const rays = coneRays(beamDir(f.pan, f.tilt), f.beam);
  let hits = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const r of rays) {
    if (r.z >= 0) continue;
    const t = (D.LED_Z - pos.z) / r.z;
    if (t <= 0 || t >= groundHit(pos, r, V, D)) continue;
    const x = pos.x + r.x * t, y = pos.y + r.y * t;
    if (Math.abs(x) > V.led.width / 2 || y < D.LED_BASE_Y || y > D.LED_TOP_Y) continue;
    hits++;
    const px = (x + V.led.width / 2) * D.PX_PER_M;
    const py = (y - D.LED_BASE_Y) * D.PX_PER_M;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return hits ? { hit: true, hits, box: { x0, x1, y0, y1 } } : { hit: false, hits: 0 };
}

/* Glare: rays that strike the front glass reflect (normal +Z). If the
   reflected ray descends through seated eye height inside the audience
   zone, someone sees the fixture in the glass. */
export function glareOnGlass(f, V, D, eyeY = 1.10, audienceZ = 6) {
  const pos = fixtureWorld(f, V);
  const K = V.cabin;
  const gy0 = V.stage.deckHeight + K.floorRaise;
  const gy1 = V.stage.deckHeight + K.height - K.frame;
  const rays = coneRays(beamDir(f.pan, f.tilt), f.beam);
  let hits = 0, zMin = Infinity, zMax = -Infinity;
  for (const r of rays) {
    if (r.z >= 0) continue;
    const t = (D.CABIN_FRONT - pos.z) / r.z;
    if (t <= 0 || t >= groundHit(pos, r, V, D)) continue;
    const hx = pos.x + r.x * t, hy = pos.y + r.y * t;
    if (Math.abs(hx - K.x) > K.width / 2 - K.frame || hy < gy0 || hy > gy1) continue;
    const refl = { x: r.x, y: r.y, z: -r.z };            // off vertical glass
    if (refl.y >= 0) continue;
    const t2 = (eyeY - hy) / refl.y;
    if (t2 <= 0) continue;
    const z = D.CABIN_FRONT + refl.z * t2;
    if (z < audienceZ || z > D.HALL_FRONT_Z) continue;
    hits++;
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  return hits ? { hit: true, hits, zMin, zMax } : { hit: false, hits: 0 };
}

/* Beam length for drawing — axis ray to ground / LED / back wall, capped. */
export function coneLength(f, V, D, cap = 24) {
  const pos = fixtureWorld(f, V);
  const dir = beamDir(f.pan, f.tilt);
  let t = groundHit(pos, dir, V, D);
  if (dir.z < 0) {
    const tl = (D.LED_Z - pos.z) / dir.z;
    if (tl > 0) t = Math.min(t, tl);
    const tw = (D.UPWALL_Z - pos.z) / dir.z;
    if (tw > 0) t = Math.min(t, tw);
  }
  return Math.min(t, cap);
}

/* Where the beam axis lands — the SpotLight target point in show mode. */
export function spotTarget(f, V, D) {
  const pos = fixtureWorld(f, V);
  const dir = beamDir(f.pan, f.tilt);
  const t = coneLength(f, V, D);
  return { x: pos.x + dir.x * t, y: pos.y + dir.y * t, z: pos.z + dir.z * t, throw: t };
}

/* LED glow: average canvas luminance (0–1) → RectAreaLight intensity.
   A 25.6 m wall at full white should dominate the stage; near-black content
   should still leak a little. Tuned visually, kept pure so it's testable. */
export function glowIntensity(lum, max = 9) {
  const l = Math.min(1, Math.max(0, lum));
  return 0.15 + (max - 0.15) * Math.pow(l, 1.4);
}

const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const normalize = a => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
