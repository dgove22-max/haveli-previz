/* Lighting — coffer position grid, fixtures, beam cones, and the two
   checks that matter: spill on the LED and glare on the cabin glass.
   Visual only, no photometry (SPEC §6). The coffer grid is an ESTIMATE. */
import * as THREE from 'three';
import { C } from '../palette.js';
import { mat, dimLabel } from './helpers.js';
import { fixtureWorld, beamDir, coneLength, spillOnLed, glareOnGlass } from '../lightmath.js';

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

  for (const f of lighting?.fixtures ?? []) {
    if (!f.on) continue;
    const pos = fixtureWorld(f, V);
    const dir = beamDir(f.pan, f.tilt);
    const len = coneLength(f, V, D);
    const colour = new THREE.Color(f.colour ?? '#ffffff');

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), mat(C.fixture));
    body.position.set(pos.x, pos.y, pos.z);
    g.add(body);

    const radius = Math.tan((f.beam ?? 25) / 2 * Math.PI / 180) * len;
    const coneGeo = new THREE.ConeGeometry(radius, len, 24, 1, true);
    coneGeo.translate(0, -len / 2, 0);                       // apex at origin, opening −Y
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: colour, transparent: true, depthWrite: false,
      opacity: 0.08 + 0.14 * (f.intensity ?? 0.8), side: THREE.DoubleSide
    }));
    cone.position.set(pos.x, pos.y, pos.z);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
    g.add(cone);

    /* landing disc on the axis */
    const hit = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.12, radius * 0.5), 20),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5 }));
    hit.rotation.x = -Math.PI / 2;
    hit.position.set(pos.x + dir.x * len, Math.max(0.02, pos.y + dir.y * len) + 0.015, pos.z + dir.z * len);
    g.add(hit);

    g.add(dimLabel(f.name ?? f.id, pos.x, pos.y + 0.55, pos.z, Math.max(1.8, (f.name ?? f.id).length * 0.15)));

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
