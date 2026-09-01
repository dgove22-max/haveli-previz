/* Dimensioned orthographic elevations — front, plan, side — drawn as 2D
   vector work straight from the venue data at a stated scale (SPEC §7).
   The venue is axis-aligned boxes, so 2D drawing beats a 3D ortho render:
   crisp lines, proper dimension chains, confidence colouring. */
import { download } from './keepout.js';

const S = 28;                     // px per metre — stated on the sheet
const INK = '#16232e', SOFT = '#5a6670', BLUE = '#2c4a63', AMBER = '#a06a10';
const PAPER = '#f4f3ee', FILL = '#e3e1d8', DARK = '#2a2622';

export function exportElevations(model) {
  const { V, D, conf } = model;
  const M = 90;                                    // sheet margin
  const W = Math.ceil(V.hall.width * S + M * 2);
  const frontH = V.hall.wallHeight * S + 200;
  const planH  = 20 * S + 170;
  const sideH  = V.hall.wallHeight * S * 1.6 + 250;
  const H = 130 + frontH + planH + sideH + 90;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = PAPER; c.fillRect(0, 0, W, H);

  c.fillStyle = INK; c.font = '600 34px Helvetica, Arial, sans-serif'; c.textAlign = 'left';
  c.fillText('Haveli Previz — dimensioned elevations', M, 58);
  c.font = '400 22px Helvetica, Arial, sans-serif'; c.fillStyle = SOFT;
  c.fillText(`scale 1 m = ${S} px · ${new Date().toISOString().slice(0, 10)} · blue = measured on site · amber = estimate, confirm before building`, M, 92);

  const cf = p => (conf[p] === 'est' || conf[p] === 'approx') ? AMBER : BLUE;

  front(c, V, D, cf, M, 130, frontH);
  plan(c, V, D, cf, M, 130 + frontH, planH);
  side(c, V, D, cf, M, 130 + frontH + planH, sideH);

  download(cv, 'haveli-elevations.png');
}

/* ── FRONT — audience's view. x → right (+X ladies), y → up ── */
function front(c, V, D, cf, ox, oy, boxH) {
  title(c, 'FRONT ELEVATION — from the audience', ox, oy + 26);
  const gy = oy + boxH - 120;                       // hall floor line
  const X = x => ox + (V.hall.width / 2 + x) * S;   // venue x → sheet
  const Y = y => gy - y * S;
  const dh = V.stage.deckHeight;

  /* hall walls + floor */
  c.strokeStyle = INK; c.lineWidth = 2;
  c.strokeRect(X(-V.hall.width / 2), Y(V.hall.wallHeight), V.hall.width * S, V.hall.wallHeight * S);

  /* raised deck band across the frontage */
  rect(c, X(-D.FRONTAGE / 2), Y(dh), D.FRONTAGE * S, dh * S, FILL);
  /* forestage in front, 200 mm lower */
  rect(c, X(-D.FS_W / 2), Y(D.FS_H), D.FS_W * S, D.FS_H * S, '#d8d5cb');
  /* curtains — deck level to top, from CURT_IN out to the walls */
  [[-V.hall.width / 2, -D.CURT_IN], [D.CURT_IN, V.hall.width / 2]].forEach(([a, b]) =>
    rect(c, X(a), Y(V.curtains.top), (b - a) * S, (V.curtains.top - dh) * S, DARK));
  /* LED */
  rect(c, X(-V.led.width / 2), Y(D.LED_TOP_Y), V.led.width * S, V.led.height * S, '#3a3f45');
  /* cabin front */
  rect(c, X(-V.cabin.width / 2), Y(D.CABIN_TOP_Y), V.cabin.width * S, (V.cabin.height) * S, 'rgba(168,196,200,0.5)', INK);
  /* cordon walls */
  [[-V.hall.width / 2, -D.HALF_FRONT], [D.HALF_FRONT, V.hall.width / 2]].forEach(([a, b]) =>
    rect(c, X(a), Y(V.cordon.height), (b - a) * S, V.cordon.height * S, '#cfccc1'));

  /* dimensions */
  dimH(c, X(-V.led.width / 2), X(V.led.width / 2), Y(D.LED_TOP_Y) - 26, `LED ${V.led.width.toFixed(2)} m · ${V.led.pxW} px`, cf('led.width'));
  dimH(c, X(-V.cabin.width / 2), X(V.cabin.width / 2), Y(D.CABIN_TOP_Y) - 26, `cabin ≈ ${V.cabin.width.toFixed(2)} m`, cf('cabin.width'));
  dimH(c, X(-D.FRONTAGE / 2), X(D.FRONTAGE / 2), gy + 34, `frontage ${D.FRONTAGE.toFixed(2)} m`, BLUE);
  dimV(c, X(V.hall.width / 2) + 30, gy, Y(V.hall.wallHeight), `${V.hall.wallHeight.toFixed(2)} m`, cf('hall.wallHeight'));
  dimV(c, X(-V.hall.width / 2) - 30, gy, Y(dh), `deck ${dh.toFixed(2)} m`, cf('stage.deckHeight'));
  dimV(c, X(-V.led.width / 2) - 30, Y(dh), Y(D.LED_BASE_Y), `${V.led.baseAboveDeck.toFixed(2)}`, cf('led.baseAboveDeck'));
  dimV(c, X(D.CURT_IN + 2) + 0, Y(dh), Y(V.curtains.top), `curtain ${(V.curtains.top - dh).toFixed(2)} m`, cf('curtains.top'));
}

/* ── PLAN — x → right, z (downstage) → down ── */
function plan(c, V, D, cf, ox, oy, boxH) {
  title(c, 'PLAN — stage zone (upstage wall at top)', ox, oy + 26);
  const gy = oy + 60;
  const X = x => ox + (V.hall.width / 2 + x) * S;
  const Z = z => gy + (z - D.UPWALL_Z) * S;         // upstage wall at top
  const dh = V.stage.deckHeight;

  /* side + back walls */
  c.strokeStyle = INK; c.lineWidth = 2;
  c.strokeRect(X(-V.hall.width / 2), Z(D.UPWALL_Z), V.hall.width * S, (12 - D.UPWALL_Z) * S);

  /* backstage slab + main deck T */
  rect(c, X(-(V.hall.width - 0.8) / 2), Z(D.UPWALL_Z), (V.hall.width - 0.8) * S, (D.WIDEN_Z - D.UPWALL_Z) * S, '#e9e7de');
  rect(c, X(-D.FRONTAGE / 2), Z(D.WIDEN_Z), D.FRONTAGE * S, (0 - D.WIDEN_Z) * S, FILL);
  /* stairs */
  [[-1, 0], [1, 0]].forEach(([sd]) => {
    const cx = sd * (V.stage.clearWidth / 2 + V.stage.stairWidth / 2);
    rect(c, X(cx - V.stage.stairWidth / 2), Z(-D.STAIR_RUN), V.stage.stairWidth * S, D.STAIR_RUN * S, '#d8d5cb');
    for (let i = 1; i < V.stage.risers; i++) {
      const z = Z(-D.STAIR_RUN + i * D.STAIR_RUN / V.stage.risers);
      hline(c, X(cx - V.stage.stairWidth / 2), X(cx + V.stage.stairWidth / 2), z, SOFT, 1);
    }
  });
  /* forestage grid */
  rect(c, X(-D.FS_W / 2), Z(0), D.FS_W * S, D.FS_D * S, '#d8d5cb');
  for (let i = 1; i < V.forestage.cols; i++) vline(c, X(-D.FS_W / 2 + i * V.forestage.pieceW), Z(0), Z(D.FS_D), SOFT, 1);
  for (let j = 1; j < V.forestage.rows; j++) hline(c, X(-D.FS_W / 2), X(D.FS_W / 2), Z(j * V.forestage.pieceD), SOFT, 1);
  /* LED line */
  hline(c, X(-V.led.width / 2), X(V.led.width / 2), Z(D.LED_Z), '#3a3f45', 6);
  /* curtains */
  [[-V.hall.width / 2 + 0.25, -D.CURT_IN], [D.CURT_IN, V.hall.width / 2 - 0.25]].forEach(([a, b]) =>
    hline(c, X(a), X(b), Z(D.CURT_Z), DARK, 5));
  /* cordon walls on the stage front line */
  [[-V.hall.width / 2 + 0.4, -D.HALF_FRONT], [D.HALF_FRONT, V.hall.width / 2 - 0.4]].forEach(([a, b]) =>
    hline(c, X(a), X(b), Z(0), '#8d8a80', 5));
  /* cabin + chair */
  rect(c, X(-V.cabin.width / 2), Z(D.CABIN_BACK), V.cabin.width * S, D.CABIN_D * S, 'rgba(168,196,200,0.45)', INK);
  hline(c, X(-V.cabin.width / 2), X(V.cabin.width / 2), Z(D.CABIN_FRONT), BLUE, 3);
  c.fillStyle = '#8c4a3c';
  c.fillRect(X(-0.4), Z(D.CHAIR_Z - 0.35), 0.8 * S, 0.7 * S);

  /* dimensions */
  dimH(c, X(-V.stage.clearWidth / 2), X(V.stage.clearWidth / 2), Z(8.0), `${V.stage.clearWidth.toFixed(2)} m between stairs (ticks at the inner stair corners)`, cf('stage.clearWidth'));
  dimH(c, X(-D.FS_W / 2), X(D.FS_W / 2), Z(D.FS_D) + 30, `performance stage ${D.FS_W.toFixed(2)} × ${D.FS_D.toFixed(2)} m (${V.forestage.cols}×${V.forestage.rows} @ 244×122)`, cf('forestage.pieceW'));
  dimV(c, X(-V.hall.width / 2) - 30, Z(0), Z(D.LED_Z), `${V.stage.depthToLed.toFixed(2)} m edge→LED`, cf('stage.depthToLed'));
  dimV(c, X(V.hall.width / 2) + 30, Z(D.UPWALL_Z), Z(D.CURT_Z), `curtain ${V.curtains.fromBackWall.toFixed(2)} m off wall`, cf('curtains.fromBackWall'));
  dimV(c, X(V.cabin.width / 2) + 26, Z(D.CABIN_BACK), Z(D.CABIN_FRONT), `cabin ${D.CABIN_D.toFixed(2)} m`, cf('cabin.backOffWall'));
  label(c, 'audience →', X(0), Z(10.6), SOFT);
}

/* ── SIDE — section on the centreline. z → right (audience right), y → up ── */
function side(c, V, D, cf, ox, oy, boxH) {
  title(c, 'SECTION — centreline, audience to the right', ox, oy + 26);
  const gy = oy + boxH - 130;
  const zMin = D.UPWALL_Z - 1, zMax = 16;
  const Z = z => ox + (z - zMin) * S * 1.6;         // stretch depth ×1.6 for read
  const Y = y => gy - y * S * 1.6;
  const dh = V.stage.deckHeight;

  /* floor + back wall */
  hline(c, Z(zMin), Z(zMax), Y(0), INK, 2);
  vline(c, Z(D.UPWALL_Z), Y(0), Y(V.hall.wallHeight), INK, 4);
  hline(c, Z(zMin), Z(zMax), Y(V.hall.wallHeight), SOFT, 1);

  /* deck + forestage */
  rect(c, Z(D.UPWALL_Z), Y(dh), (0 - D.UPWALL_Z) * S * 1.6, dh * S * 1.6, FILL);
  rect(c, Z(0), Y(D.FS_H), D.FS_D * S * 1.6, D.FS_H * S * 1.6, '#d8d5cb');
  /* LED */
  rect(c, Z(D.LED_Z) - 4, Y(D.LED_TOP_Y), 8, V.led.height * S * 1.6, '#3a3f45');
  /* curtain */
  rect(c, Z(D.CURT_Z) - 3, Y(V.curtains.top), 6, (V.curtains.top - dh) * S * 1.6, DARK);
  /* cabin section */
  rect(c, Z(D.CABIN_BACK), Y(D.CABIN_TOP_Y), D.CABIN_D * S * 1.6, V.cabin.height * S * 1.6, 'rgba(168,196,200,0.45)', INK);
  rect(c, Z(D.CABIN_BACK), Y(dh + V.cabin.floorRaise), D.CABIN_D * S * 1.6, V.cabin.floorRaise * S * 1.6, FILL);
  /* chair mark */
  c.fillStyle = '#8c4a3c';
  c.fillRect(Z(D.CHAIR_Z) - 8, Y(dh + V.cabin.floorRaise + 0.5), 16, 0.5 * S * 1.6);
  /* seated audience eye line */
  hline(c, Z(6), Z(zMax), Y(V.figures.seatedEye), BLUE, 1);
  label(c, `seated eye 1.10 m`, Z(11), Y(V.figures.seatedEye) - 10, BLUE);

  /* dimensions */
  dimV(c, Z(D.LED_Z) - 40, Y(0), Y(dh), `deck ${dh.toFixed(2)}`, cf('stage.deckHeight'));
  dimV(c, Z(D.FS_D) + 40, Y(0), Y(D.FS_H), `perf ${D.FS_H.toFixed(2)} (−200 mm)`, cf('forestage.height'));
  dimV(c, Z(D.CABIN_BACK) - 40, Y(dh), Y(D.CABIN_TOP_Y), `cabin ${V.cabin.height.toFixed(3)}`, cf('cabin.height'));
  dimV(c, Z(D.LED_Z) - 90, Y(D.LED_BASE_Y), Y(D.LED_TOP_Y), `LED ${V.led.height.toFixed(2)}`, cf('led.height'));
  dimH(c, Z(D.LED_Z), Z(0), Y(0) + 34, `${V.stage.depthToLed.toFixed(2)} m`, cf('stage.depthToLed'));
  dimH(c, Z(D.CABIN_FRONT), Z(0), Y(dh + V.cabin.height) - 26, `glass ${V.cabin.frontFromEdge.toFixed(2)} m from edge`, cf('cabin.frontFromEdge'));
  dimH(c, Z(D.CHAIR_Z), Z(0), Y(dh + V.cabin.floorRaise + 1.2) - 8, `chair 11'0"`, cf('chair.zFromEdge'));
}

/* ── drawing helpers ── */
function title(c, t, x, y) {
  c.fillStyle = INK; c.font = '600 26px Helvetica, Arial, sans-serif'; c.textAlign = 'left';
  c.fillText(t, x, y);
}
function rect(c, x, y, w, h, fill, stroke = SOFT) {
  c.fillStyle = fill; c.fillRect(x, y, w, h);
  c.strokeStyle = stroke; c.lineWidth = 1.5; c.strokeRect(x, y, w, h);
}
function hline(c, x1, x2, y, col, w) {
  c.strokeStyle = col; c.lineWidth = w;
  c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke();
}
function vline(c, x, y1, y2, col, w) {
  c.strokeStyle = col; c.lineWidth = w;
  c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y2); c.stroke();
}
function dimH(c, x1, x2, y, text, col) {
  c.strokeStyle = col; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke();
  [x1, x2].forEach(x => { c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke(); });
  c.fillStyle = col; c.font = '500 20px Menlo, Consolas, monospace'; c.textAlign = 'center';
  c.fillText(text, (x1 + x2) / 2, y - 8);
}
function dimV(c, x, y1, y2, text, col) {
  c.strokeStyle = col; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y2); c.stroke();
  [y1, y2].forEach(y => { c.beginPath(); c.moveTo(x - 7, y); c.lineTo(x + 7, y); c.stroke(); });
  c.save();
  c.fillStyle = col; c.font = '500 20px Menlo, Consolas, monospace'; c.textAlign = 'center';
  c.translate(x - 10, (y1 + y2) / 2); c.rotate(-Math.PI / 2);
  c.fillText(text, 0, 0);
  c.restore();
}
function label(c, t, x, y, col) {
  c.fillStyle = col; c.font = '400 20px Helvetica, Arial, sans-serif'; c.textAlign = 'center';
  c.fillText(t, x, y);
}
