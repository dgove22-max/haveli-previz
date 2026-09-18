/* Lighting — coffer position grid, fixtures, beam cones, and the two
   checks that matter: spill on the LED and glare on the cabin glass.
   Two renderings of the same rig:
   - plan: schematic translucent cones + landing discs (the original view)
   - show: real THREE.SpotLights with shadows, plus volumetric haze cones
     (additive shader, opacity driven by the haze slider)
   Still no photometry — no IES data, no lux claims. The coffer grid is an
   ESTIMATE. */
import * as THREE from 'three';
import { C } from '../palette.js';
import { mat, dimLabel } from './helpers.js';
import { fixtureWorld, beamDir, coneLength, spotTarget, spillOnLed, glareOnGlass } from '../lightmath.js';

/* Show-mode brightness of a full fixture. Tuned against ACES exposure 1.0
   with decay 2 — a wash at ~5 m throw reads as a proper stage wash. */
const SPOT_CANDELA = 90;

function hazeMaterial(colour, len, halfRad) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(colour) },
      uLen: { value: len },
      uTanHalf: { value: Math.tan(halfRad) },
      uOpacity: { value: 0 }
    },
    vertexShader: /* glsl */`
      varying vec3 vPos;                      // object space: apex at origin, axis −Y
      varying vec3 vNormalV;                  // view space
      varying vec3 vViewPos;
      void main() {
        vPos = position;
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vPos; varying vec3 vNormalV; varying vec3 vViewPos;
      uniform vec3 uColor; uniform float uLen, uTanHalf, uOpacity;
      void main() {
        float axial = clamp(-vPos.y / uLen, 0.0, 1.0);
        /* beam body: silhouette edges fade out (normal ⟂ view), the middle
           of the shell glows — the standard fake-volumetric falloff */
        vec3 v = normalize(-vViewPos);
        float body = pow(abs(dot(normalize(vNormalV), v)), 1.4);
        float fade = pow(1.0 - axial, 1.3);           // brighter near the lens
        float tip = smoothstep(0.0, 0.06, axial);     // soften the apex point
        float a = uOpacity * body * fade * tip;
        gl_FragColor = vec4(uColor, a * 0.5);         // ×0.5: DoubleSide doubles up
      }`
  });
}

/* Toggle the rig between plan and show renderings. haze/house ∈ [0,1]. */
export function applyLightingMode(lightingGroup, { show = false, haze = 0, labels = true, beams = true } = {}) {
  if (!lightingGroup) return;
  lightingGroup.traverse(o => {
    /* Beams off still leaves the fixture bodies, so you keep the plot — where
       everything hangs — without looking through its volumes. */
    if (o.userData.planOnly) o.visible = !show && (beams || !o.userData.beam);
    if (o.userData.showOnly) o.visible = show;
    if (o.userData.hazeCone) {
      o.visible = show && haze > 0.01;
      o.material.uniforms.uOpacity.value = haze * 0.9 * (o.userData.fIntensity ?? 0.8);
    }
    if (o.isSpotLight) o.intensity = show ? SPOT_CANDELA * (o.userData.fIntensity ?? 0.8) : 0;
    /* Plan annotations vanish on the day, and are switchable the rest of the
       time: one label per fixture is fine at four, unreadable at thirty. */
    if (o.isSprite) o.visible = !show && labels;
  });
}

export function buildCoffer(V, D) {
  const g = new THREE.Group();
  const cf = V.coffer;
  const pts = [];
  const zEnd = Math.min(D.HALL_FRONT_Z - 1, cf.zOffset + 10 * cf.spacingZ);
  const nx = Math.floor((D.SIDE_WALL - 0.5) / cf.spacingX);
  for (let i = -nx; i <= nx; i++)
    pts.push(i * cf.spacingX, cf.soffit, cf.zOffset - cf.spacingZ,
             i * cf.spacingX, cf.soffit, zEnd);
  for (let z = cf.zOffset - cf.spacingZ; z <= zEnd; z += cf.spacingZ)
    pts.push(-nx * cf.spacingX, cf.soffit, z, nx * cf.spacingX, cf.soffit, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: C.amber, transparent: true, opacity: 0.5 })));
  g.add(dimLabel(`coffer grid EST ${cf.spacingX.toFixed(1)} m — measure!`, 0, cf.soffit + 0.4, cf.zOffset + 4, 5.2));
  return g;
}

export function buildFixtures(V, D, lighting, led) {
  const g = new THREE.Group();
  const warnings = [];
  const spillBoxes = [];

  /* Beam cones are translucent and they STACK, so what matters is not the
     opacity of one cone but the opacity of the pile. A flat per-cone value was
     fine for the four-fixture rig this was written for and opaque at
     twenty-six — the venue vanished behind its own lighting plot.

     So solve for the total instead: pick a per-cone opacity such that N of them
     overlapping land on BEAM_STACK, whatever N is. The wash then looks the same
     density on any size of rig, and the room stays visible through it. */
  /* Calibrated, not picked: at the original four-fixture rig this yields a
     per-cone 0.195, matching the flat 0.192 the tool shipped with — so the rig
     it was designed around looks exactly as it always did, and larger rigs
     thin out from there rather than the beams being dimmed across the board. */
  const BEAM_STACK = 0.58;
  const lit = (lighting?.fixtures ?? []).filter(f => f.on).length;

  /* Shadow maps are the hard limit here, not performance.

     Every fixture builds a real SpotLight for show mode. Each one that casts a
     shadow claims a texture unit, and WebGL commonly offers only 16. At four
     fixtures that was invisible; at twenty-six the LIT shader fails to link and
     every lit surface — floor, walls, cabin, deck — renders black, while unlit
     geometry (beam cones, discs, the coffer grid, labels) carries on as normal.
     The room disappears behind its own lighting plot and nothing in the scene
     graph looks wrong.

     So shadows are a budget. The rest still light the stage, they just do not
     cast — which is a far better trade than losing the building. */
  let shadowBudget = 6;
  const perCone = 1 - Math.pow(1 - BEAM_STACK, 1 / Math.max(1, lit));
  const crowd = Math.min(1, 5 / Math.max(1, lit));      // discs/labels still thin out

  for (const f of lighting?.fixtures ?? []) {
    if (!f.on) continue;
    const pos = fixtureWorld(f, V);
    const dir = beamDir(f.pan, f.tilt);
    const len = coneLength(f, V, D);
    /* Slightly darker than the raw fixture colour — full-brightness swatches
       read as too saturated/glowy once they're actually filling the stage. */
    const colour = new THREE.Color(f.colour ?? '#ffffff').multiplyScalar(0.92);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), mat(C.fixture));
    body.position.set(pos.x, pos.y, pos.z);
    g.add(body);

    const halfRad = (f.beam ?? 25) / 2 * Math.PI / 180;
    const radius = Math.tan(halfRad) * len;
    const aim = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));

    /* plan rendering — schematic cone + landing disc */
    const coneGeo = new THREE.ConeGeometry(radius, len, 24, 1, true);
    coneGeo.translate(0, -len / 2, 0);                       // apex at origin, opening −Y
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: colour, transparent: true, depthWrite: false,
      opacity: perCone * (0.5 + 0.5 * (f.intensity ?? 0.8)), side: THREE.DoubleSide
    }));
    cone.position.set(pos.x, pos.y, pos.z);
    cone.quaternion.copy(aim);
    cone.userData.planOnly = true;
    cone.userData.beam = true;            // switchable independently of the fixture
    g.add(cone);

    /* landing disc on the axis */
    const hit = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.12, radius * 0.5), 20),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true,
        opacity: Math.min(0.5, perCone * 6) }));
    hit.rotation.x = -Math.PI / 2;
    hit.position.set(pos.x + dir.x * len, Math.max(0.02, pos.y + dir.y * len) + 0.015, pos.z + dir.z * len);
    hit.userData.planOnly = true;
    hit.userData.beam = true;
    g.add(hit);

    /* show rendering — a real light with shadows, aimed where the axis lands */
    const tgt = spotTarget(f, V, D);
    const spot = new THREE.SpotLight(colour, 0, tgt.throw + 6, halfRad, 0.45, 2);
    spot.position.set(pos.x, pos.y, pos.z);
    spot.target.position.set(tgt.x, tgt.y, tgt.z);
    spot.castShadow = f.shadow !== false && shadowBudget > 0;
    if (spot.castShadow) {
      shadowBudget--;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.camera.near = 0.5;
      spot.shadow.camera.far = tgt.throw + 6;
      spot.shadow.bias = -0.002;
    }
    spot.userData.fIntensity = f.intensity ?? 0.8;
    g.add(spot, spot.target);

    /* haze cone — additive volumetric, opacity driven by the haze slider */
    const hazeGeo = new THREE.ConeGeometry(radius, len, 32, 1, true);
    hazeGeo.translate(0, -len / 2, 0);
    const hazeCone = new THREE.Mesh(hazeGeo, hazeMaterial(colour, len, halfRad));
    hazeCone.position.set(pos.x, pos.y, pos.z);
    hazeCone.quaternion.copy(aim);
    hazeCone.userData.hazeCone = true;
    hazeCone.userData.fIntensity = f.intensity ?? 0.8;
    hazeCone.visible = false;
    g.add(hazeCone);

    /* Constant on-screen size: with 30-odd fixtures scattered from the cabin to
       the back of house, distance-scaled labels were unreadable at both ends. */
    g.add(dimLabel(f.name ?? f.id, pos.x, pos.y + 0.55, pos.z, 0.085, { fixed: true }));

    const spill = spillOnLed(f, V, D);
    if (spill.hit) {
      warnings.push(`⚠ ${f.name}: spills on the LED (${Math.round(spill.box.x0)}–${Math.round(spill.box.x1)} px)`);
      spillBoxes.push(spill.box);
    }
    const glare = glareOnGlass(f, V, D);
    if (glare.hit) {
      warnings.push(`⚠ ${f.name}: glare on the cabin glass for seats ≈ ${glare.zMin.toFixed(0)}–${glare.zMax.toFixed(0)} m back`);
    }
  }

  g.userData.warnings = warnings;
  if (led) { led.spillBoxes = spillBoxes; led.draw(); }
  return g;
}
