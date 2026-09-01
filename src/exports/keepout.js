/* Keep-out map for the content team — the cabin's blocked region and the
   curtain bleed drawn in true pixel space, 10240 × 1920 (SPEC §7 phase 2). */
import { cabinBlock, curtainClip, performerBand, cabinShadowFromSeat } from '../occlusion.js';

export function exportKeepout(model) {
  const { V, D } = model;
  const W = V.led.pxW, H = V.led.pxH;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  /* safe field */
  c.fillStyle = '#0f2416'; c.fillRect(0, 0, W, H);

  /* metre grid — 1 m = PX_PER_M px */
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 2;
  for (let x = 0; x <= W; x += D.PX_PER_M) line(c, x, 0, x, H);
  for (let y = H; y >= 0; y -= D.PX_PER_M) line(c, 0, y, W, y);
  c.strokeStyle = 'rgba(255,255,255,0.25)'; line(c, W / 2, 0, W / 2, H);

  /* px ruler ticks every 1000 px */
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.font = '600 40px Menlo, monospace'; c.textAlign = 'center';
  for (let x = 1000; x < W; x += 1000) { line(c, x, H - 30, x, H); c.fillText(String(x), x, H - 48); }

  /* cabin block — hard red, bottom-up */
  const cb = cabinBlock(V, D);
  c.fillStyle = 'rgba(190,50,40,0.55)';
  c.fillRect(cb.x0, H - cb.hPx, cb.wPx, cb.hPx);
  c.strokeStyle = '#e05a4a'; c.lineWidth = 6;
  c.strokeRect(cb.x0, H - cb.hPx, cb.wPx, cb.hPx);
  c.fillStyle = '#ffffff'; c.font = '600 84px Helvetica, Arial, sans-serif';
  c.fillText('CABIN BLOCK', W / 2, H - cb.hPx / 2 - 20);
  c.font = '400 56px Menlo, monospace';
  c.fillText(`x ${Math.round(cb.x0)}–${Math.round(cb.x1)} px · bottom ${Math.round(cb.hPx)} px (${cb.wM.toFixed(2)} × ${cb.hM.toFixed(2)} m)`,
             W / 2, H - cb.hPx / 2 + 60);

  /* worst-case parallax outline from a front seat, dashed */
  const front = cabinShadowFromSeat(V, D, { z: 8 });
  const fx0 = (W - front.wPx) / 2;
  c.setLineDash([28, 18]); c.strokeStyle = 'rgba(224,90,74,0.7)'; c.lineWidth = 5;
  c.strokeRect(fx0, H - Math.min(front.hPx, H), front.wPx, Math.min(front.hPx, H));
  c.setLineDash([]);
  c.fillStyle = 'rgba(224,90,74,0.9)'; c.font = '400 48px Helvetica, Arial, sans-serif';
  c.fillText(`dashed: blocked from a front seat (≈8 m) — ${Math.round(front.fracH * 100)}% height`, W / 2, Math.max(70, H - front.hPx - 20));

  /* curtain bleed bands */
  const cc = curtainClip(V, D);
  c.fillStyle = 'rgba(210,150,40,0.45)';
  c.fillRect(0, 0, cc.bleedPx, H);
  c.fillRect(W - cc.bleedPx, 0, cc.bleedPx, H);
  c.fillStyle = '#ffd98a'; c.font = '600 52px Helvetica, Arial, sans-serif';
  for (const cx of [cc.bleedPx / 2, W - cc.bleedPx / 2]) {
    c.save();
    c.translate(cx, H / 2); c.rotate(-Math.PI / 2);
    c.fillText(`BLEED ${cc.bleedPx} px — texture only`, 0, 18);
    c.restore();
  }

  /* performer band */
  const pb = performerBand(V, D);
  c.strokeStyle = 'rgba(140,200,255,0.6)'; c.lineWidth = 4;
  c.setLineDash([12, 12]);
  line(c, cc.bleedPx, H - pb.hPx, W - cc.bleedPx, H - pb.hPx);
  c.setLineDash([]);
  c.fillStyle = 'rgba(140,200,255,0.85)'; c.font = '400 44px Helvetica, Arial, sans-serif';
  c.textAlign = 'left';
  c.fillText(`5'6" performer on the performance stage reaches here (bottom ${Math.round(pb.frac * 100)}%)`, cc.bleedPx + 40, H - pb.hPx - 18);

  /* header */
  c.fillStyle = '#ffffff'; c.font = '600 64px Helvetica, Arial, sans-serif';
  c.fillText(`Haveli Previz — LED keep-out map · ${W} × ${H} px · ${V.led.width.toFixed(2)} × ${V.led.height.toFixed(2)} m · ${D.PITCH_MM.toFixed(1)} mm`, 60, 90);
  c.font = '400 44px Helvetica, Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.7)';
  c.fillText(`${new Date().toISOString().slice(0, 10)} · cabin width is APPROX and curtain line partly ESTIMATED — treat edges ±100 px until confirmed`, 60, 150);

  download(cv, 'led-keepout-10240x1920.png');
}

const line = (c, x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };

export function download(cv, name) {
  cv.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
