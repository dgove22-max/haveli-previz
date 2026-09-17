/* Screenshot of the current camera with a labelled header strip. */
import { download } from './keepout.js';

export function exportScreenshot({ model, renderer, scene, camera, state, controls, led }) {
  renderer.render(scene, camera);                    // fresh frame, same task
  const src = renderer.domElement;
  const strip = 64;
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height + strip * devicePixelRatioSafe();
  const c = cv.getContext('2d');
  const k = devicePixelRatioSafe();

  c.fillStyle = '#16232e'; c.fillRect(0, 0, cv.width, strip * k);
  c.fillStyle = '#ffffff'; c.font = `600 ${22 * k}px Helvetica, Arial, sans-serif`; c.textAlign = 'left';
  /* The stage address is an id; the LED holds the readable label for it. */
  const stage = led?.sceneName ?? '';
  c.fillText(`Haveli Previz · ${stage} · ${controls.activePreset ?? 'custom view'} · role: ${state.role}`, 18 * k, 27 * k);
  c.font = `400 ${15 * k}px Helvetica, Arial, sans-serif`; c.fillStyle = 'rgba(255,255,255,0.65)';
  c.fillText(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${location.href}`, 18 * k, 50 * k);
  c.drawImage(src, 0, strip * k);

  const slug = String(state.at ?? 'view').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  download(cv, `previz-${slug || 'view'}-${controls.activePreset ?? 'custom'}.png`);
}

const devicePixelRatioSafe = () => Math.min(devicePixelRatio || 1, 2);
