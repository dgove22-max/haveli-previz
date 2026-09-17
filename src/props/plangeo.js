/* Plan-view geometry — pure functions, unit-tested (test/props.test.js).
   Plan space is the venue x–z plane seen from above: +x right (ladies side),
   +z toward the audience, drawn downward on the canvas so the LED sits at the
   top and the audience at the bottom, matching the elevations export. */

/* Axis-aligned footprint of a definition in its own local frame, as a
   half-extent box {hw, hd} plus centre {cx, cz}. Part offsets and 0/90/180/270
   part rotations are exact; odd angles use the rotated bounding box (a safe
   over-estimate for hit-testing and drawing). */
export function defFootprint(def) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of def?.parts ?? []) {
    const [w, d] = partPlanSize(p);
    const a = ((p.rot ?? 0) % 360 + 360) % 360 * Math.PI / 180;
    const ex = Math.abs(Math.cos(a)) * w / 2 + Math.abs(Math.sin(a)) * d / 2;
    const ez = Math.abs(Math.sin(a)) * w / 2 + Math.abs(Math.cos(a)) * d / 2;
    const ox = p.offset?.[0] ?? 0, oz = p.offset?.[2] ?? 0;
    minX = Math.min(minX, ox - ex); maxX = Math.max(maxX, ox + ex);
    minZ = Math.min(minZ, oz - ez); maxZ = Math.max(maxZ, oz + ez);
  }
  if (!Number.isFinite(minX)) return { hw: 0.5, hd: 0.5, cx: 0, cz: 0 };
  return {
    hw: (maxX - minX) / 2, hd: (maxZ - minZ) / 2,
    cx: (maxX + minX) / 2, cz: (maxZ + minZ) / 2
  };
}

/* Width (x) and depth (z) a part occupies in plan, before its own rotation. */
export function partPlanSize(p) {
  const s = p.size ?? [];
  if (p.shape === 'cylinder') return [s[0] ?? 0.6, s[0] ?? 0.6];   // [dia, h]
  if (p.shape === 'plane')    return [s[0] ?? 1, 0.05];            // thin flat
  return [s[0] ?? 0.6, s[2] ?? 0.6];                               // box / wedge / mesh [w,h,d]
}

export const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

/* Snap a rotation to the nearest `step` degrees, normalised to [0,360). */
export const snapAngle = (deg, step = 15) => {
  const s = snap(((deg % 360) + 360) % 360, step);
  return s === 360 ? 0 : s;
};

/* Map between world metres and canvas pixels. bounds = {minX,maxX,minZ,maxZ}
   in world metres; pad in px. Uniform scale, centred. */
export function planTransform(bounds, canvasW, canvasH, pad = 24) {
  const wM = Math.max(0.001, bounds.maxX - bounds.minX);
  const dM = Math.max(0.001, bounds.maxZ - bounds.minZ);
  const scale = Math.min((canvasW - pad * 2) / wM, (canvasH - pad * 2) / dM);
  const ox = (canvasW - wM * scale) / 2 - bounds.minX * scale;
  const oz = (canvasH - dM * scale) / 2 - bounds.minZ * scale;
  return { scale, ox, oz };
}

export const worldToCanvas = (x, z, T) => [x * T.scale + T.ox, z * T.scale + T.oz];
export const canvasToWorld = (px, pz, T) => [(px - T.ox) / T.scale, (pz - T.oz) / T.scale];

/* Is world point (x,z) inside instance `inst` of definition `def`? Tests the
   rotated footprint rectangle. */
export function pointInInstance(x, z, inst, def) {
  const fp = defFootprint(def);
  const [cx, cz] = rot2(fp.cx, fp.cz, inst.rot ?? 0);   // footprint centre, world
  const [lx, lz] = rot2(x - inst.pos[0] - cx, z - inst.pos[1] - cz, -(inst.rot ?? 0));
  return Math.abs(lx) <= fp.hw && Math.abs(lz) <= fp.hd;
}

/* Rotate a local (x,z) offset by `deg` about Y, matching three's +Y-up frame
   (positive rot turns +x toward −z). */
export function rot2(x, z, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

/* The four plan corners of an instance's footprint, world metres — for drawing
   and for a tight bounds fit. */
export function instanceCorners(inst, def) {
  const fp = defFootprint(def);
  const [ox, oz] = rot2(fp.cx, fp.cz, inst.rot ?? 0);
  return [[-fp.hw, -fp.hd], [fp.hw, -fp.hd], [fp.hw, fp.hd], [-fp.hw, fp.hd]].map(([lx, lz]) => {
    const [rx, rz] = rot2(lx, lz, inst.rot ?? 0);
    return [inst.pos[0] + ox + rx, inst.pos[1] + oz + rz];
  });
}
