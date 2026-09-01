/* Data loading and derivation. Pure except loadModel() (fetch).
   venue.json leaves are { v, c, note } — flatten() splits them into plain
   values (for geometry) and a path→confidence map (for the UI). */

export function flatten(node, path = '', values = {}, conf = {}, notes = {}) {
  for (const [k, val] of Object.entries(node)) {
    if (k.startsWith('_')) continue;
    const p = path ? `${path}.${k}` : k;
    if (val && typeof val === 'object' && 'v' in val) {
      setPath(values, p, val.v);
      conf[p] = val.c ?? 'est';
      if (val.note) notes[p] = val.note;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      flatten(val, p, values, conf, notes);
    } else {
      setPath(values, p, val);
    }
  }
  return { values, conf, notes };
}

function setPath(obj, path, v) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = v;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

/* Derived dimensions — the single place geometry constants come from. */
export function derive(V) {
  const S = V.stage, L = V.led, K = V.cabin, FS = V.forestage;
  const FRONTAGE   = S.clearWidth + 2 * S.stairWidth;                  // 26.30
  const HALF_FRONT = FRONTAGE / 2;                                     // 13.15
  const STAGE_D    = S.depthToLed + S.wallBehindLed;                   // 7.50
  const LED_Z      = -S.depthToLed;                                    // −7.20
  const UPWALL_Z   = -STAGE_D;                                         // −7.50
  const CURT_Z     = UPWALL_Z + V.curtains.fromBackWall;               // −3.70
  const WIDEN_Z    = CURT_Z + S.widenAheadOfCurtain;                   // −3.40
  const CURT_IN    = HALF_FRONT - V.curtains.inFraction * S.stairWidth;// 12.01
  const CABIN_BACK = UPWALL_Z + K.backOffWall;                         // −6.05
  const CABIN_FRONT= -K.frontFromEdge;                                 // −0.30
  return {
    FRONTAGE, HALF_FRONT, STAGE_D, LED_Z, UPWALL_Z, CURT_Z, WIDEN_Z, CURT_IN,
    CABIN_BACK, CABIN_FRONT,
    CABIN_D:    CABIN_FRONT - CABIN_BACK,                              // 5.75
    CHAIR_Z:    -V.chair.zFromEdge,                                    // −3.353
    PITCH_MM:   L.width / L.pxW * 1000,                                // 2.5
    PX_PER_M:   L.pxW / L.width,                                       // 400
    STAIR_RUN:  S.risers * 0.29,                                       // 1.45
    FS_W:       FS.cols * FS.pieceW,                                   // 14.64
    FS_D:       FS.rows * FS.pieceD,                                   // 4.88
    FS_H:       FS.height,                                             // 1.10
    LED_BASE_Y: S.deckHeight + L.baseAboveDeck,                        // 1.605
    LED_TOP_Y:  S.deckHeight + L.baseAboveDeck + L.height,             // 6.405
    CABIN_TOP_Y:S.deckHeight + K.height,                               // 4.965
    SIDE_WALL:  V.hall.width / 2,
    HALL_FRONT_Z: V.hall.depth + UPWALL_Z
  };
}

export async function loadModel(base = '') {
  const [venueRaw, scenesRaw, propsRaw, lightingRaw] = await Promise.all(
    ['venue', 'scenes', 'props', 'lighting'].map(n =>
      fetch(`${base}data/${n}.json`).then(r => {
        if (!r.ok) throw new Error(`data/${n}.json → HTTP ${r.status}`);
        return r.json();
      }))
  );
  return modelFrom({ venueRaw, scenesRaw, propsRaw, lightingRaw });
}

/* Build the working model from raw JSON — also used by the editor on Apply. */
export function modelFrom({ venueRaw, scenesRaw, propsRaw, lightingRaw }) {
  const { values: V, conf, notes } = flatten(venueRaw);
  return {
    V, D: derive(V), conf, notes,
    scenes: scenesRaw.scenes,
    props: propsRaw.props,
    lighting: lightingRaw,
    raw: { venueRaw, scenesRaw, propsRaw, lightingRaw }
  };
}
