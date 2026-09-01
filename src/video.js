/* The LED surface: a canvas compositor driving one CanvasTexture.
   Sources are either a hosted MP4 (public/content/<file>, from scenes.json)
   or a generated test pattern at a selectable virtual resolution — so fit
   modes and the upscale readout work before any show content exists. */
import * as THREE from 'three';
import { fitRect, upscale, curtainClip, cabinBlock } from './occlusion.js';

export const PATTERN_RES = [
  { w: 10240, h: 1920, label: '10240 × 1920 (native)' },
  { w: 5120,  h: 960,  label: '5120 × 960 (½ res)' },
  { w: 2560,  h: 480,  label: '2560 × 480 (¼ res)' },
  { w: 1920,  h: 1080, label: '1920 × 1080 (16:9 mismatch)' },
  { w: 3840,  h: 720,  label: '3840 × 720' }
];
const PATTERN_DUR = 60;

export class LedScreen {
  constructor(V, D) {
    this.V = V; this.D = D;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2560; this.canvas.height = 480;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });

    this.fit = 'stretch';
    this.resIndex = 0;
    this.keepout = false;
    this.loop = true;
    this.fps = 25;
    this.playing = true;
    this.t = 0;
    this.video = null;          // active <video> or null → pattern
    this.videoError = null;
    this.sceneName = '';
    this.spillBoxes = [];       // amber patches from the lighting spill check
    this._pattern = document.createElement('canvas');
    this._lastNow = performance.now();
    this.onchange = null;       // UI refresh hook
  }

  setModel(V, D) { this.V = V; this.D = D; this.draw(); }

  /* ── source ── */
  setScene(scene) {
    this.sceneName = scene?.name ?? '';
    this.videoError = null;
    if (this.video) { this.video.pause(); this.video.src = ''; this.video = null; }
    if (scene?.led) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.loop = this.loop;
      v.src = `public/content/${scene.led}`;
      v.addEventListener('loadedmetadata', () => {
        if (this.t) v.currentTime = this.t;
        if (this.playing) v.play().catch(() => {});
        this.onchange?.();
      });
      v.addEventListener('error', () => {
        this.videoError = `${scene.led} not found in public/content/ — showing pattern`;
        this.video = null;
        this.onchange?.();
      });
      this.video = v;
    }
    this.t = 0;
    this.draw();
  }

  get sourceSize() {
    if (this.video && this.video.videoWidth) return { w: this.video.videoWidth, h: this.video.videoHeight, name: 'file' };
    const r = PATTERN_RES[this.resIndex] ?? PATTERN_RES[0];
    return { w: r.w, h: r.h, name: 'pattern' };
  }
  get duration() { return this.video?.duration || PATTERN_DUR; }
  get time() { return this.video ? this.video.currentTime : this.t; }

  upscaleLabel() {
    const s = this.sourceSize;
    return upscale(s.w, s.h, this.fit, this.V.led).label;
  }

  /* ── transport ── */
  setPlaying(p) {
    this.playing = p;
    if (this.video) p ? this.video.play().catch(() => {}) : this.video.pause();
  }
  setLoop(l) { this.loop = l; if (this.video) this.video.loop = l; }
  seek(t) {
    t = Math.max(0, Math.min(this.duration, t));
    if (this.video) this.video.currentTime = t; else this.t = t;
    this.draw();
  }
  stepFrame(dir) {
    this.setPlaying(false);
    this.seek(this.time + dir / (this.fps || 25));
  }
  setFit(f) { this.fit = f; this.draw(); }
  setPatternRes(i) { this.resIndex = i; this.draw(); }
  setKeepout(k) { this.keepout = k; this.draw(); }

  /* ── per-frame ── */
  update() {
    const now = performance.now();
    const dt = (now - this._lastNow) / 1000;
    this._lastNow = now;
    if (this.video) {
      if (this.playing || this._dirty) this.draw();
    } else if (this.playing) {
      this.t += dt;
      if (this.t >= PATTERN_DUR) this.t = this.loop ? this.t % PATTERN_DUR : PATTERN_DUR;
      this.draw();
    }
  }

  draw() {
    const x = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    x.fillStyle = '#101317'; x.fillRect(0, 0, cw, ch);

    const src = this.sourceSize;
    const r = fitRect(src.w, src.h, this.fit, this.V.led, cw, ch);
    if (this.video && this.video.readyState >= 2) {
      x.drawImage(this.video, r.x, r.y, r.w, r.h);
    } else {
      this._drawPattern(src.w, src.h);
      x.drawImage(this._pattern, r.x, r.y, r.w, r.h);
    }
    if (this.keepout) this._drawKeepout();
    for (const b of this.spillBoxes) {
      const k = cw / this.V.led.pxW;
      x.strokeStyle = 'rgba(255,170,40,0.9)'; x.lineWidth = 3;
      x.setLineDash([10, 6]);
      x.strokeRect(b.x0 * k, (1 - (b.y1 / this.V.led.pxH)) * ch, (b.x1 - b.x0) * k, (b.y1 - b.y0) / this.V.led.pxH * ch);
      x.setLineDash([]);
    }
    this.texture.needsUpdate = true;
  }

  _drawPattern(w, h) {
    const pc = this._pattern;
    /* draw at a capped internal size to stay cheap; aspect is what matters */
    const scale = Math.min(1, 2048 / w);
    const pw = Math.round(w * scale), ph = Math.round(h * scale);
    if (pc.width !== pw || pc.height !== ph) { pc.width = pw; pc.height = ph; }
    const c = pc.getContext('2d');

    c.fillStyle = '#1f242a'; c.fillRect(0, 0, pw, ph);
    /* metre grid in source space: source px per metre of LED when stretched */
    const pxPerM = pw / this.V.led.width;
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1;
    for (let i = 0; i <= this.V.led.width; i++) line(c, i * pxPerM, 0, i * pxPerM, ph);
    for (let j = 0; j * pxPerM <= ph; j++) line(c, 0, j * pxPerM, pw, j * pxPerM);
    c.strokeStyle = 'rgba(255,255,255,0.30)';
    line(c, pw / 2, 0, pw / 2, ph);

    /* moving time bar proves play / pause / scrub at a glance */
    const bx = (this.t / PATTERN_DUR) * pw;
    c.fillStyle = 'rgba(120,190,255,0.35)';
    c.fillRect(bx - 3, 0, 6, ph);

    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = `600 ${Math.round(ph * 0.18)}px Helvetica, Arial, sans-serif`;
    c.textAlign = 'center';
    c.fillText(`${w} × ${h}`, pw / 2, ph * 0.42);
    c.font = `400 ${Math.round(ph * 0.11)}px Helvetica, Arial, sans-serif`;
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillText(
      `test pattern · canvas ${this.V.led.pxW} × ${this.V.led.pxH} px · ${fmtT(this.t)}`,
      pw / 2, ph * 0.60);
  }

  _drawKeepout() {
    const x = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    const k = cw / this.V.led.pxW, kv = ch / this.V.led.pxH;
    const cb = cabinBlock(this.V, this.D);
    const cc = curtainClip(this.V, this.D);

    /* cabin block — bottom-up region, red */
    x.fillStyle = 'rgba(200,60,50,0.28)';
    x.fillRect(cb.x0 * k, ch - cb.hPx * kv, cb.wPx * k, cb.hPx * kv);
    x.strokeStyle = 'rgba(200,60,50,0.85)'; x.lineWidth = 2;
    x.strokeRect(cb.x0 * k, ch - cb.hPx * kv, cb.wPx * k, cb.hPx * kv);

    /* curtain bleed — outer bands, amber */
    x.fillStyle = 'rgba(220,160,40,0.28)';
    x.fillRect(0, 0, cc.bleedPx * k, ch);
    x.fillRect(cw - cc.bleedPx * k, 0, cc.bleedPx * k, ch);

    x.fillStyle = 'rgba(255,255,255,0.8)';
    x.font = '600 20px Helvetica, Arial, sans-serif';
    x.textAlign = 'center';
    x.fillText(`cabin blocks ${Math.round(cb.wPx)} px × ${Math.round(cb.hPx)} px`, cw / 2, ch - cb.hPx * kv - 8);
    x.save(); x.textAlign = 'left';
    x.fillText(`bleed ${cc.bleedPx} px`, cc.bleedPx * k + 6, 24);
    x.restore();
  }
}

const line = (c, x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
const fmtT = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
