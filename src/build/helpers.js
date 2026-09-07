import * as THREE from 'three';
import { C } from '../palette.js';

/* Standard, not Lambert: show mode needs RectAreaLight (LED glow) and decent
   SpotLight response, which Lambert doesn't support. Matte defaults. */
export const mat = (color, o = {}) =>
  new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.88, metalness: 0.0 }, o));

export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || mat(color));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

export function topPlane(w, d, x, y, z, color) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
  p.rotation.x = -Math.PI / 2;
  p.position.set(x, y, z);
  p.receiveShadow = true;
  return p;
}

export function figure(x, z, y, h = 1.70) {
  const g = new THREE.Group();
  const m = mat(C.figure);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, h * 0.5, 12), m);
  legs.position.y = h * 0.25;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.16, h * 0.34, 12), m);
  torso.position.y = h * 0.67;
  const head = new THREE.Mesh(new THREE.SphereGeometry(h * 0.075, 14, 12), m);
  head.position.y = h * 0.92;
  [legs, torso, head].forEach(p => { p.castShadow = true; g.add(p); });
  g.position.set(x, y, z);
  return g;
}

export function seatedFigure(x, z, y) {
  const g = new THREE.Group();
  const m = mat(C.figure);
  const lap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.55), m);
  lap.position.set(0, 0.52, 0.1);
  [-0.14, 0.14].forEach(sx => {
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.44, 10), m);
    shin.position.set(sx, 0.24, 0.34);
    shin.castShadow = true;
    g.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.27), m);
    foot.position.set(sx, 0.035, 0.42);
    foot.castShadow = true;
    g.add(foot);
  });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.62, 12), m);
  torso.position.y = 0.88;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), m);
  head.position.y = 1.30;
  [lap, torso, head].forEach(p => { p.castShadow = true; g.add(p); });
  g.position.set(x, y, z);
  return g;
}

export function dimLabel(text, x, y, z, w = 2.6) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#dee0db'; c.fillRect(0, 0, 512, 128);
  c.fillStyle = '#2c4a63';
  c.font = '600 56px Menlo, Consolas, monospace';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.position.set(x, y, z);
  sp.scale.set(w, w / 4, 1);
  return sp;
}

export function dimLine(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...a), new THREE.Vector3(...b)
  ]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: C.blue, depthTest: false }));
}
