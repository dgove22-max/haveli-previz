/* 2D plan view — top-down stage with draggable prop instances, the primary
   placement surface (Vectorworks-style). Pure canvas; the 3D scene mirrors
   every change live. World x→right, z→down (audience at the bottom), matching
   the elevations export. */
import { C } from '../palette.js';
import {
  defFootprint, instanceCorners, canvasToWorld, snap, snapAngle, rot2
} from './plangeo.js';

const hex = n => '#' + n.toString(16).padStart(6, '0');

export function createPlanView(ctx) {
  /* ctx: { model, getDoc, activeSceneId, onMove(id,patch), onSelect(id) } */
  const el = document.createElement('div');
  el.className = 'planview';
  el.innerHTML = `
    <div class="pv-bar">
      <span class="pv-title">Plan</span>
      <label class="pv-snap"><input type="checkbox" checked> snap</label>
      <select class="pv-grid">
        <option value="0.1">0.1 m</option>
        <option value="0.25" selected>0.25 m</option>
        <option value="0.5">0.5 m</option>
        <option value="1">1 m</option>
      </select>
      <button class="pv-fit" title="Reset zoom">fit</button>
    </div>
    <canvas class="pv-canvas"></canvas>
    <div class="pv-hint">drag to move · corner grip to rotate · scroll to zoom · shift-drag to pan</div>`;

  const canvas = el.querySelector('.pv-canvas');
  const snapBox = el.querySelector('.pv-snap input');
  const gridSel = el.querySelector('.pv-grid');
  const c = canvas.getContext('2d');

  let selectedId = null;
  let view = { zoom: 1, cx: 0, cz: 0 };            // world point at canvas centre
  let drag = null;                                  // {mode, id, ...}
  let dpr = 1, cw = 0, ch = 0;

  const gridStep = () => (snapBox.checked ? Number(gridSel.value) : 0);
  const model = () => ctx.model;

  /* base metres-per-pixel so the stage working area fills the canvas at zoom 1 */
  function baseScale() {
    const D = model().D;
    const wM = model().V.hall.width * 0.75;           // ~34 m across
    const dM = Math.abs(D.LED_Z) + model().D.FS_D + 4; // LED to past the forestage
    return Math.min((cw - 32) / wM, (ch - 32) / dM);
  }
  const T = () => {
    const s = baseScale() * view.zoom;
    return { scale: s, ox: cw / 2 - view.cx * s, oz: ch / 2 - view.cz * s };
  };
  const toCanvas = (x, z, t = T()) => [x * t.scale + t.ox, z * t.scale + t.oz];

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  /* ── draw ─────────────────────────────────────────────────────────── */
  function render() {
    if (!cw) return;
    const M = model(), V = M.V, D = M.D, t = T();
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#17202a';
    const soft = css.getPropertyValue('--soft').trim() || '#67717c';
    const line = css.getPropertyValue('--line').trim() || '#e0e3dd';
    const accent = css.getPropertyValue('--accent').trim() || '#2563c4';
    const card2 = css.getPropertyValue('--card-2').trim() || '#f7f8f6';

    c.fillStyle = card2; c.fillRect(0, 0, cw, ch);

    /* metre / snap grid */
    const gs = gridStep() || 1;
    if (t.scale * gs > 6) {
      c.strokeStyle = line; c.lineWidth = 1; c.beginPath();
      const [wx0, wz0] = canvasToWorld(0, 0, t), [wx1, wz1] = canvasToWorld(cw, ch, t);
      for (let x = Math.ceil(wx0 / gs) * gs; x < wx1; x += gs) { const [px] = toCanvas(x, 0, t); c.moveTo(px, 0); c.lineTo(px, ch); }
      for (let z = Math.ceil(wz0 / gs) * gs; z < wz1; z += gs) { const [, pz] = toCanvas(0, z, t); c.moveTo(0, pz); c.lineTo(cw, pz); }
      c.stroke();
    }

    /* stage guides */
    c.lineWidth = 1.5;
    strokeRectW(-D.FRONTAGE / 2, D.WIDEN_Z, D.FRONTAGE, -D.WIDEN_Z, soft, t);          // main deck
    strokeRectW(-D.FS_W / 2, 0, D.FS_W, D.FS_D, soft, t);                              // performance stage
    lineW(-V.led.width / 2, D.LED_Z, V.led.width / 2, D.LED_Z, '#3a3f45', 4, t);       // LED
    lineW(-D.CURT_IN, D.CURT_Z, -D.SIDE_WALL + 0.3, D.CURT_Z, ink, 3, t);
    lineW(D.CURT_IN, D.CURT_Z, D.SIDE_WALL - 0.3, D.CURT_Z, ink, 3, t);
    strokeRectW(-V.cabin.width / 2, D.CABIN_BACK, V.cabin.width, D.CABIN_D, soft, t);  // cabin
    label('LED', 0, D.LED_Z - 0.3, soft, t);
    label('audience', 0, D.FS_D + 1.4, soft, t);

    /* origin cross */
    c.strokeStyle = soft; c.lineWidth = 1;
    const [oxp, ozp] = toCanvas(0, 0, t);
    c.beginPath(); c.moveTo(oxp - 6, ozp); c.lineTo(oxp + 6, ozp); c.moveTo(oxp, ozp - 6); c.lineTo(oxp, ozp + 6); c.stroke();

    /* instances */
    const doc = ctx.getDoc();
    const defs = new Map(doc.definitions.map(d => [d.id, d]));
    for (const inst of doc.instances) {
      if (!inst.enabled) continue;
      const def = defs.get(inst.def);
      if (!def) continue;
      const inScene = !inst.scenes?.length || !ctx.activeSceneId() || inst.scenes.includes(ctx.activeSceneId());
      drawInstance(inst, def, { t, accent, ink, soft, inScene, selected: inst.id === selectedId });
    }
  }

  function drawInstance(inst, def, { t, accent, ink, soft, inScene, selected }) {
    const pts = instanceCorners(inst, def).map(([x, z]) => toCanvas(x, z, t));
    const est = def.confidence === 'est' || def.confidence === 'approx';
    c.beginPath();
    pts.forEach(([px, pz], i) => i ? c.lineTo(px, pz) : c.moveTo(px, pz));
    c.closePath();
    c.globalAlpha = inScene ? 1 : 0.28;
    c.fillStyle = est ? 'rgba(192,138,45,0.22)' : hex(C.prop) + '55';
    c.fill();
    c.lineWidth = selected ? 2 : 1.2;
    c.strokeStyle = selected ? accent : (est ? hex(C.amber) : soft);
    c.stroke();

    /* heading tick — local +z (front) direction */
    const fp = defFootprint(def);
    const [hx, hz] = rot2(fp.cx, fp.cz + fp.hd, inst.rot ?? 0);
    const [cxp, czp] = toCanvas(inst.pos[0] + hx, inst.pos[1] + hz, t);
    const [mxp, mzp] = toCanvas(inst.pos[0] + rot2(fp.cx, fp.cz, inst.rot ?? 0)[0],
      inst.pos[1] + rot2(fp.cx, fp.cz, inst.rot ?? 0)[1], t);
    c.beginPath(); c.moveTo(mxp, mzp); c.lineTo(cxp, czp); c.strokeStyle = selected ? accent : soft; c.stroke();

    c.globalAlpha = 1;
    c.fillStyle = ink;
    c.font = '10px ui-monospace, Menlo, Consolas, monospace';
    c.textAlign = 'center';
    c.fillText(inst.name || def.name, (pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2 - 2);

    if (selected) {
      const [gx, gy] = gripCanvas(inst, def, t);
      c.beginPath(); c.arc(gx, gy, 5, 0, Math.PI * 2);
      c.fillStyle = accent; c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
    }
  }

  /* rotate grip sits just outside the front-right footprint corner */
  function gripCanvas(inst, def, t = T()) {
    const fp = defFootprint(def);
    const [ox, oz] = rot2(fp.cx, fp.cz, inst.rot ?? 0);
    const [gx, gz] = rot2(fp.hw + 0.35, fp.hd + 0.35, inst.rot ?? 0);
    return toCanvas(inst.pos[0] + ox + gx, inst.pos[1] + oz + gz, t);
  }

  /* ── hit testing ──────────────────────────────────────────────────── */
  function pick(px, pz) {
    const doc = ctx.getDoc(), t = T();
    const defs = new Map(doc.definitions.map(d => [d.id, d]));
    /* grip of the selected instance wins */
    if (selectedId) {
      const inst = doc.instances.find(i => i.id === selectedId);
      const def = inst && defs.get(inst.def);
      if (def) {
        const [gx, gy] = gripCanvas(inst, def, t);
        if (Math.hypot(px - gx, pz - gy) <= 9) return { mode: 'rotate', id: inst.id };
      }
    }
    for (let k = doc.instances.length - 1; k >= 0; k--) {
      const inst = doc.instances[k];
      if (!inst.enabled) continue;
      const def = defs.get(inst.def);
      if (!def) continue;
      const poly = instanceCorners(inst, def).map(([x, z]) => toCanvas(x, z, t));
      if (pointInPoly(px, pz, poly)) {
        const [wx, wz] = canvasToWorld(px, pz, t);
        return { mode: 'move', id: inst.id, grabX: wx - inst.pos[0], grabZ: wz - inst.pos[1] };
      }
    }
    return null;
  }

  /* ── pointer ──────────────────────────────────────────────────────── */
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, pz = e.clientY - r.top;
    if (e.shiftKey || e.button === 1) { drag = { mode: 'pan', px, pz, cx: view.cx, cz: view.cz }; return; }
    const hit = pick(px, pz);
    if (!hit) { select(null); drag = null; return; }
    select(hit.id);
    drag = hit;
  });

  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, pz = e.clientY - r.top;
    if (!drag) { canvas.style.cursor = pick(px, pz) ? 'grab' : 'default'; return; }
    const t = T();
    if (drag.mode === 'pan') {
      view.cx = drag.cx - (px - drag.px) / t.scale;
      view.cz = drag.cz - (pz - drag.pz) / t.scale;
      render(); return;
    }
    const [wx, wz] = canvasToWorld(px, pz, t);
    const inst = ctx.getDoc().instances.find(i => i.id === drag.id);
    if (!inst) return;
    if (drag.mode === 'move') {
      const g = gridStep();
      ctx.onMove(drag.id, { pos: [round(snap(wx - drag.grabX, g), 3), round(snap(wz - drag.grabZ, g), 3)] });
    } else {
      const ang = Math.atan2(wx - inst.pos[0], wz - inst.pos[1]) * 180 / Math.PI;
      ctx.onMove(drag.id, { rot: e.altKey ? round(ang, 1) : snapAngle(ang, 15) });
    }
  });

  ['pointerup', 'pointercancel'].forEach(ev =>
    canvas.addEventListener(ev, () => {
      const wasEdit = drag && (drag.mode === 'move' || drag.mode === 'rotate');
      drag = null; canvas.style.cursor = 'default';
      if (wasEdit) ctx.onCommit?.();
    }));

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const [wx, wz] = canvasToWorld(e.clientX - r.left, e.clientY - r.top, T());
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.zoom = Math.max(0.3, Math.min(8, view.zoom * f));
    /* keep the point under the cursor fixed */
    const t2 = T();
    const [wx2, wz2] = canvasToWorld(e.clientX - r.left, e.clientY - r.top, t2);
    view.cx += wx - wx2; view.cz += wz - wz2;
    render();
  }, { passive: false });

  el.querySelector('.pv-fit').onclick = () => { view = { zoom: 1, cx: 0, cz: -2 }; render(); };
  snapBox.onchange = render;
  gridSel.onchange = render;
  window.addEventListener('resize', resize);
  window.addEventListener('hp-theme', render);

  function select(id) {
    if (id === selectedId) return;
    selectedId = id;
    ctx.onSelect(id);
    render();
  }

  requestAnimationFrame(resize);
  view.cz = -2;

  return {
    el,
    render,
    resize,
    setSelected(id) { selectedId = id; render(); },
    destroy() { window.removeEventListener('resize', resize); window.removeEventListener('hp-theme', render); }
  };

  /* helpers bound to the closure's ctx */
  function strokeRectW(x, z, w, d, col, t) {
    const [x0, z0] = toCanvas(x, z, t), [x1, z1] = toCanvas(x + w, z + d, t);
    c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(x0, z0, x1 - x0, z1 - z0);
  }
  function lineW(x1, z1, x2, z2, col, w, t) {
    const [a, b] = toCanvas(x1, z1, t), [d, e2] = toCanvas(x2, z2, t);
    c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a, b); c.lineTo(d, e2); c.stroke();
  }
  function label(txt, x, z, col, t) {
    const [px, pz] = toCanvas(x, z, t);
    c.fillStyle = col; c.font = '9px sans-serif'; c.textAlign = 'center';
    c.fillText(txt, px, pz);
  }
}

const round = (v, n) => { const f = 10 ** n; return Math.round(v * f) / f; };

function pointInPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pz) !== (yj > pz)) && (px < (xj - xi) * (pz - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
