/* Orbit / pan / zoom with eased goals, plus named view presets whose ids
   travel in the URL (?cam=seated-front). A hand-moved camera serialises to
   ?cv=r,theta,phi,tx,ty,tz so any exact view can be linked (SPEC §3). */
import * as THREE from 'three';

export function viewPresets(V) {
  const EYE = V.figures.seatedEye;
  return [
    { id: 'three-quarter', name: 'Three-quarter',      r: 44, theta:  0.55, phi: 1.12, t: [0, 1.8, -1.5] },
    { id: 'seated-front',  name: 'Seated — front',     r: 10, theta:  0.00, phi: 1.54, t: [0, EYE + 1.2, -2.0] },
    { id: 'seated-mid',    name: 'Seated — mid hall',  r: 24, theta:  0.00, phi: 1.53, t: [0, EYE + 1.4, -2.0] },
    { id: 'seated-rear',   name: 'Seated — rear',      r: 42, theta:  0.00, phi: 1.52, t: [0, EYE + 1.8, -2.0] },
    { id: 'gents-side',    name: 'Gents side',         r: 26, theta: -0.55, phi: 1.46, t: [0, 2.2, -2.5] },
    { id: 'ladies-side',   name: 'Ladies side',        r: 26, theta:  0.55, phi: 1.46, t: [0, 2.2, -2.5] },
    { id: 'backstage',     name: 'Backstage crossing', r: 13, theta: -2.30, phi: 1.42, t: [-14, 2.0, -5.6] },
    { id: 'behind-cabin',  name: 'Behind the cabin',   r: 11, theta:  0.00, phi: 1.50, t: [0, 2.6, -6.2] },
    { id: 'plan',          name: 'Plan',               r: 62, theta:  0.00, phi: 0.07, t: [0, 0, 12] },
    { id: 'section',       name: 'Section',            r: 42, theta:  1.5708, phi: 1.5708, t: [0, 3.0, 4.0] }
  ];
}

export function createControls(camera, dom, onUserMove) {
  const target = new THREE.Vector3(0, 1.8, -1.5);
  const sph = { r: 44, theta: 0.55, phi: 1.12 };
  let goal = { ...sph }, goalTarget = target.clone();
  let activePreset = 'three-quarter';

  function tick() {
    sph.r     += (goal.r - sph.r) * 0.16;
    sph.theta += (goal.theta - sph.theta) * 0.16;
    sph.phi   += (goal.phi - sph.phi) * 0.16;
    target.lerp(goalTarget, 0.16);
    camera.position.set(
      target.x + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
      target.y + sph.r * Math.cos(sph.phi),
      target.z + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta)
    );
    camera.lookAt(target);
  }

  function setView(v) {
    goal = { r: v.r, theta: v.theta, phi: v.phi };
    goalTarget.set(...v.t);
    activePreset = v.id ?? null;
  }

  const fmt = n => Math.round(n * 1000) / 1000;
  function serialize() {
    return [goal.r, goal.theta, goal.phi, goalTarget.x, goalTarget.y, goalTarget.z].map(fmt).join(',');
  }
  function applySerialized(s) {
    const [r, theta, phi, tx, ty, tz] = s.split(',').map(Number);
    if ([r, theta, phi, tx, ty, tz].some(Number.isNaN)) return false;
    setView({ r, theta, phi, t: [tx, ty, tz], id: null });
    return true;
  }

  let drag = null;
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    dom.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    activePreset = null;
    onUserMove?.();
  });
  dom.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const scale = goal.r * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up    = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      goalTarget.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    } else {
      goal.theta -= dx * 0.005;
      goal.phi = Math.max(0.06, Math.min(Math.PI / 2 + 0.06, goal.phi - dy * 0.005));
    }
    onUserMove?.();
  });
  ['pointerup', 'pointercancel'].forEach(ev => dom.addEventListener(ev, () => { drag = null; }));
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    goal.r = Math.max(3, Math.min(170, goal.r * (1 + Math.sign(e.deltaY) * 0.10)));
    activePreset = null;
    onUserMove?.();
  }, { passive: false });

  return {
    tick, setView, serialize, applySerialized,
    get activePreset() { return activePreset; },
    get distance() { return sph.r; },
    position: camera.position
  };
}
