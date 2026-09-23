/* Orbit / pan / zoom with eased goals, plus named view presets whose ids
   travel in the URL (?cam=seated-front). A hand-moved camera serialises to
   ?cv=r,theta,phi,tx,ty,tz so any exact view can be linked (SPEC §3). */
import * as THREE from 'three';

/* A preset written the way a person would describe it: "I am sitting HERE,
   looking at THERE". The rig orbits, so it wants radius / azimuth / elevation
   about the look-at point — derive those rather than hand-tuning phi.

   Hand-tuning is what put the audience in the air. Every seated view was
   authored as a look-at point plus a phi just under the horizontal, which
   quietly lifted the eye ABOVE the target: "Seated — rear" sat at 5.0 m, a
   storey and a half over a hall whose audience is on the carpet. Say where the
   eye is and the angles follow. */
function fromEye(id, name, eye, look) {
  const dx = eye[0] - look[0], dy = eye[1] - look[1], dz = eye[2] - look[2];
  const r = Math.hypot(dx, dy, dz);
  return { id, name, r, theta: Math.atan2(dx, dz), phi: Math.acos(dy / r), t: look };
}

export function viewPresets(V) {
  /* The audience sits on the carpet, so 1.10 m is the whole of its height
     advantage. The look-at points are the ones these views always used: same
     framing, now from where you would really be watching it.

     Backstage and Behind the cabin are crew positions on the deck rather than
     seats in the hall, so they keep their own heights. */
  const EYE = V.figures.seatedEye;
  return [
    { id: 'three-quarter', name: 'Three-quarter',      r: 44, theta:  0.55, phi: 1.12, t: [0, 1.8, -1.5] },
    fromEye('seated-front', 'Seated — front',      [0, EYE,  8.0], [0, 2.3, -2.0]),
    fromEye('seated-mid',   'Seated — mid hall',   [0, EYE, 22.0], [0, 2.5, -2.0]),
    fromEye('seated-rear',  'Seated — rear',       [0, EYE, 40.0], [0, 2.9, -2.0]),
    fromEye('gents-side',   'Gents side',    [-13.5, EYE, 19.5], [0, 2.2, -2.5]),
    fromEye('ladies-side',  'Ladies side',   [ 13.5, EYE, 19.5], [0, 2.2, -2.5]),
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

  /* How far the camera may swing below the horizontal.

     The old cap was a flat pi/2 + 0.06, which assumed you always look DOWN at
     the stage. A seated view looks up at it, so that cap snapped the eye back
     into the air on the first drag and undid the preset. What actually has to
     hold is that the camera stays out of the floor, so clamp on that instead:
     y = target.y + r cos(phi) must keep clear of the carpet. */
  const FLOOR_CLEAR = 0.15;
  const maxPhi = () =>
    Math.acos(Math.max(-1, (FLOOR_CLEAR - goalTarget.y) / goal.r));
  const clampPhi = () => { goal.phi = Math.max(0.06, Math.min(maxPhi(), goal.phi)); };

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
      goal.phi -= dy * 0.005;
    }
    clampPhi();                      // a pan moves the target, so clamp either way
    onUserMove?.();
  });
  ['pointerup', 'pointercancel'].forEach(ev => dom.addEventListener(ev, () => { drag = null; }));
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    goal.r = Math.max(3, Math.min(170, goal.r * (1 + Math.sign(e.deltaY) * 0.10)));
    clampPhi();                      // zooming in shortens the reach to the floor
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
