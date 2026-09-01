/* Occlusion maths — pure functions, no three.js, tested in test/occlusion.test.js.
   All px values are in LED canvas space: 10240 × 1920, origin top-left,
   x rightward as seen by the audience. Per SPEC §9 this is the part most
   worth trusting, so keep rendering out of it. */

/* Curtains clip the outer ends of the LED. Returns per-side values. */
export function curtainClip(V, D) {
  const m = Math.max(0, V.led.width / 2 - D.CURT_IN);   // metres clipped each side
  const px = m * D.PX_PER_M;
  return { metres: m, px, bleedPx: Math.ceil(px / 10) * 10 };  // bleed zone ≈ clip, rounded up
}

/* Region of the LED hidden behind the cabin, straight-on (orthographic).
   Heights measured up from the LED base. */
export function cabinBlock(V, D) {
  const wM = V.cabin.width;
  const hM = Math.min(V.led.height, D.CABIN_TOP_Y - D.LED_BASE_Y);
  const wPx = wM * D.PX_PER_M;
  const x0 = (V.led.pxW - wPx) / 2 + V.cabin.x * D.PX_PER_M;
  return {
    wM, hM, wPx, hPx: hM * D.PX_PER_M,
    x0, x1: x0 + wPx,
    fracW: wM / V.led.width,
    clearAboveM: Math.max(0, D.LED_TOP_Y - D.CABIN_TOP_Y)
  };
}

/* Band of LED covered by a performer on the performance stage, straight on. */
export function performerBand(V, D, personH = 1.6764) {
  const topY = D.FS_H + personH;                 // above hall floor
  const hM = Math.max(0, Math.min(V.led.height, topY - D.LED_BASE_Y));
  return { hM, hPx: hM * D.PX_PER_M, frac: hM / V.led.height };
}

/* Cabin shadow on the LED as seen from one seat (parallax expands it).
   seat: { z (metres downstage of stage edge, +ve), eyeY }. Rays from the eye
   past the cabin's front-top edge and front-side edges, projected onto the
   LED plane. The straight-on numbers above are this with z → ∞. */
export function cabinShadowFromSeat(V, D, seat) {
  const zEye = seat.z, yEye = seat.eyeY ?? V.figures.seatedEye;
  const k = (zEye - D.LED_Z) / (zEye - D.CABIN_FRONT);   // projection factor ≥ 1
  const yTop = yEye + (D.CABIN_TOP_Y - yEye) * k;        // shadow top on LED plane, above hall floor
  const xHalf = (seat.x ?? 0) + (V.cabin.width / 2 - (seat.x ?? 0)) * k;
  const hM = clamp(yTop - D.LED_BASE_Y, 0, V.led.height);
  const wM = Math.min(V.led.width, 2 * xHalf);
  return { k, hM, wM, hPx: hM * D.PX_PER_M, wPx: wM * D.PX_PER_M,
           fracH: hM / V.led.height, fracW: wM / V.led.width };
}

/* Upscale readout for a source file on the canvas, per fit mode. */
export function upscale(srcW, srcH, fit, led) {
  const sx = led.pxW / srcW, sy = led.pxH / srcH;
  let s, note;
  switch (fit) {
    case 'width':  s = sx; note = 'fit width';  break;
    case 'height': s = sy; note = 'fit height'; break;
    case 'native': s = 1;  note = 'native px';  break;
    default:       s = null; note = 'stretch';  break;  // anisotropic
  }
  return {
    scaleX: fit === 'stretch' ? sx : s,
    scaleY: fit === 'stretch' ? sy : s,
    label: fit === 'stretch'
      ? `${fmt(sx)}× / ${fmt(sy)}× stretch`
      : s === 1 ? '1× native' : `${fmt(s)}× upscale (${note})`
  };
}

/* Destination rect for drawing a srcW×srcH source onto a canvasW×canvasH
   canvas that represents the full LED, per fit mode. Pure, so testable. */
export function fitRect(srcW, srcH, fit, led, canvasW, canvasH) {
  const kx = canvasW / led.pxW;                  // canvas px per LED px
  let w, h;
  switch (fit) {
    case 'width':  w = led.pxW; h = srcH * (led.pxW / srcW); break;
    case 'height': h = led.pxH; w = srcW * (led.pxH / srcH); break;
    case 'native': w = srcW; h = srcH; break;
    default:       w = led.pxW; h = led.pxH; break;
  }
  return { x: (led.pxW - w) / 2 * kx, y: (led.pxH - h) / 2 * (canvasH / led.pxH),
           w: w * kx, h: h * (canvasH / led.pxH) };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = v => (Math.round(v * 10) / 10).toString();
