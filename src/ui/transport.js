/* Bottom transport bar: scrub, play/pause, loop, and the two controls that
   only matter for whatever is actually on the LED.

   Trimmed deliberately. The fps box and the "10240×1920 → 10240×1920 · 1× / 1×
   stretch" readout were always visible and almost never useful — fps only fed
   the frame-step buttons, and the upscale readout restated numbers already in
   the LED plan. Frame stepping now uses the 25 fps default in video.js.

   Fit mode and pattern resolution are mutually exclusive by nature: fit applies
   to real content, resolution to the generated test pattern. Showing whichever
   one applies keeps the bar to what you can actually act on. */
import { PATTERN_RES } from '../video.js';

export function createTransport(led, onStateChange) {
  const el = document.createElement('div');
  el.id = 'transport';
  el.innerHTML = `
    <button id="tp-play" title="play / pause (space)">⏸</button>
    <button id="tp-back" title="frame back (,)">⏮</button>
    <button id="tp-fwd" title="frame forward (.)">⏭</button>
    <span id="tp-time" class="mono">0:00 / 0:00</span>
    <input id="tp-scrub" type="range" min="0" max="1000" value="0">
    <label class="tp-l"><input id="tp-loop" type="checkbox" checked> loop</label>
    <select id="tp-fit" title="how the content fits the LED">
      <option value="stretch">stretch</option>
      <option value="width">fit width</option>
      <option value="height">fit height</option>
      <option value="native">native px</option>
    </select>
    <select id="tp-res" title="test pattern resolution"></select>
    <span id="tp-warn"></span>`;
  document.body.appendChild(el);

  const $ = id => el.querySelector(id);
  const play = $('#tp-play'), scrub = $('#tp-scrub'), time = $('#tp-time');
  const resSel = $('#tp-res'), fitSel = $('#tp-fit'), warn = $('#tp-warn');

  PATTERN_RES.forEach((r, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = r.label;
    resSel.appendChild(o);
  });

  play.onclick = () => { led.setPlaying(!led.playing); sync(); };
  $('#tp-back').onclick = () => { led.stepFrame(-1); sync(); };
  $('#tp-fwd').onclick  = () => { led.stepFrame(1); sync(); };
  $('#tp-loop').onchange = e => led.setLoop(e.target.checked);
  fitSel.onchange = e => { led.setFit(e.target.value); onStateChange(); sync(); };
  resSel.onchange = e => { led.setPatternRes(Number(e.target.value)); onStateChange(); sync(); };

  let scrubbing = false;
  scrub.addEventListener('input', () => {
    scrubbing = true;
    led.seek(scrub.value / 1000 * led.duration);
  });
  scrub.addEventListener('change', () => { scrubbing = false; onStateChange(); });

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); led.setPlaying(!led.playing); sync(); }
    if (e.key === ',') { led.stepFrame(-1); sync(); }
    if (e.key === '.') { led.stepFrame(1); sync(); }
  });

  function sync() {
    play.textContent = led.playing ? '⏸' : '▶';
    fitSel.value = led.fit;
    resSel.value = String(led.resIndex);

    /* Real content or generated pattern — never both, so show only the control
       that applies to what is on the wall. */
    const hasContent = !!(led.video || led.still);
    resSel.hidden = hasContent;
    fitSel.hidden = !hasContent;

    const isStill = !!led.still;                 // a still has no timeline
    [play, $('#tp-back'), $('#tp-fwd'), scrub].forEach(b => b.disabled = isStill);
    warn.textContent = led.videoError ?? '';
  }

  function tick() {
    if (!scrubbing) scrub.value = String(led.time / led.duration * 1000 || 0);
    time.textContent = `${fmtT(led.time)} / ${fmtT(led.duration)}`;
  }

  led.onchange = sync;
  sync();
  return { sync, tick, el };
}

const fmtT = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
