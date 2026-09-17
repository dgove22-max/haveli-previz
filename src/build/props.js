/* Props — Vectorworks split (SPEC §6): a definition is a reusable parametric
   assembly of parts; an instance places one on the stage. Parts: box,
   cylinder, wedge (ramp), plane (flat / image), mesh (glTF).

   Props outside the active scene ghost to 12% so the builder keeps context.
   est/approx definitions carry an amber wireframe — nobody builds off a guess
   without seeing it is one. Each instance group tags userData.instanceId so
   the plan view and 3D picking can find it. */
import * as THREE from 'three';
import { C } from '../palette.js';
import { mat, dimLabel } from './helpers.js';
import { defFootprint } from '../props/plangeo.js';

const num = c => typeof c === 'string' && c[0] === '#' ? new THREE.Color(c).getHex()
  : (C[c] ?? C.prop);

export function buildProps(V, D, doc, activeScene, opts = {}) {
  const g = new THREE.Group();
  g.name = 'props';
  const byId = new Map((doc?.definitions ?? []).map(d => [d.id, d]));
  for (const inst of doc?.instances ?? []) {
    if (!inst.enabled) continue;
    const def = byId.get(inst.def);
    if (!def) continue;
    const node = buildInstance(inst, def, V, D, opts);
    const inScene = !inst.scenes?.length || !activeScene || inst.scenes.includes(activeScene.id);
    if (!inScene) ghost(node);
    g.add(node);
  }
  return g;
}

function ghost(node) {
  node.traverse(o => {
    if (o.isMesh || o.isLine || o.isLineSegments) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.12;
      o.castShadow = false;
    }
  });
}

function baseY(on, V, D) {
  switch (on) {
    case 'stage': return V.stage.deckHeight;
    case 'cabin': return V.stage.deckHeight + V.cabin.floorRaise;
    case 'floor': return 0;
    default:      return D.FS_H;                        // forestage
  }
}

function buildInstance(inst, def, V, D, opts) {
  const g = new THREE.Group();
  g.position.set(inst.pos?.[0] ?? 0, baseY(inst.on, V, D), inst.pos?.[1] ?? 0);
  g.rotation.y = (inst.rot ?? 0) * Math.PI / 180;
  g.userData = { instanceId: inst.id, defId: def.id, kind: 'propInstance' };

  const unconfirmed = def.confidence !== 'measured' && def.confidence !== 'stated';
  let top = 0.4;
  for (const part of def.parts ?? []) {
    const node = buildPart(part, unconfirmed);
    if (!node) continue;
    g.add(node);
    top = Math.max(top, partTop(part));
  }

  const name = inst.name || def.name || def.id;
  g.add(dimLabel(name, 0, top + 0.35, 0, Math.max(1.6, name.length * 0.14)));

  if (opts.selectedId && opts.selectedId === inst.id) g.add(selectionRing(def, top));
  return g;
}

function partTop(p) {
  const oy = p.offset?.[1] ?? 0;
  if (p.shape === 'cylinder') return oy + (p.size?.[1] ?? 0);
  if (p.shape === 'plane')    return oy + (p.size?.[1] ?? 0);
  if (p.shape === 'mesh')     return oy + (p.size?.[1] ?? 1.5);
  return oy + (p.size?.[1] ?? 0);
}

function place(node, part) {
  node.position.set(part.offset?.[0] ?? 0, part.offset?.[1] ?? 0, part.offset?.[2] ?? 0);
  node.rotation.y = (part.rot ?? 0) * Math.PI / 180;
}

function buildPart(part, unconfirmed) {
  const g = new THREE.Group();
  place(g, part);
  const color = num(part.color);

  if (part.shape === 'box' || part.shape === 'wedge') {
    const [w, h, d] = part.size;
    const wedge = part.shape === 'wedge';
    const geo = wedge ? wedgeGeometry(w, h, d) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat(color, wedge ? { side: THREE.DoubleSide } : {}));
    m.position.y = h / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m, edges(geo, h / 2, unconfirmed));
  } else if (part.shape === 'cylinder') {
    const [dia, h] = part.size;
    const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, h, 24);
    const m = new THREE.Mesh(geo, mat(color));
    m.position.y = h / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m, edges(geo, h / 2, unconfirmed));
  } else if (part.shape === 'plane') {
    const [w, h] = part.size;
    const tex = part.file ? fileTexture(part.file) : placeholderTexture(w, h);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    m.position.y = h / 2;
    g.add(m);
  } else if (part.shape === 'mesh') {
    if (!part.file) return null;
    import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      new GLTFLoader().load(`public/content/${part.file}`, gltf => {
        gltf.scene.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        g.add(gltf.scene);
      }, undefined, () => g.add(missingMarker()));
    });
  } else return null;

  return g;
}

/* Right-angle triangular prism, centred on the origin like BoxGeometry: full
   height at the back (−z), tapering to the floor at the front (+z). Reads as a
   ramp / rake from the audience. DoubleSide material covers any odd winding. */
function wedgeGeometry(w, h, d) {
  const geo = new THREE.BufferGeometry();
  const x = w / 2, y = h / 2, z = d / 2;
  const v = new Float32Array([
    -x, -y, -z,  x, -y, -z,  x, y, -z, -x, y, -z,   // back face (full height)
    -x, -y,  z,  x, -y,  z                          // front floor edge
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex([
    0, 2, 1, 0, 3, 2,        // back (−z)
    0, 1, 5, 0, 5, 4,        // bottom
    3, 5, 2, 3, 4, 5,        // slope
    0, 4, 3,                 // left (−x)
    1, 2, 5                  // right (+x)
  ]);
  geo.computeVertexNormals();
  return geo;
}

function edges(geo, yMid, unconfirmed) {
  if (!unconfirmed) return new THREE.Group();
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: C.amber }));
  e.position.y = yMid;
  return e;
}

function selectionRing(def, top) {
  const fp = defFootprint(def);
  const w = fp.hw * 2 + 0.3, d = fp.hd * 2 + 0.3;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 0, -d / 2),
    new THREE.Vector3(w / 2, 0, d / 2), new THREE.Vector3(-w / 2, 0, d / 2),
    new THREE.Vector3(-w / 2, 0, -d / 2)
  ]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: C.blue }));
  line.position.set(fp.cx, top + 0.02, fp.cz);
  const g = new THREE.Group();
  g.add(line);
  return g;
}

function fileTexture(file) {
  const t = new THREE.TextureLoader().load(`public/content/${file}`);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function placeholderTexture(w, h) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.max(64, Math.round(512 * (h || 1) / (w || 1)));
  const c = cv.getContext('2d');
  const s = 32;
  for (let y = 0; y * s < cv.height; y++)
    for (let x = 0; x * s < cv.width; x++) {
      c.fillStyle = (x + y) % 2 ? '#d8d2c4' : '#c4beb0';
      c.fillRect(x * s, y * s, s, s);
    }
  c.fillStyle = '#5a5346';
  c.font = '600 40px Helvetica, Arial, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(`flat — ${w} × ${h} m`, cv.width / 2, cv.height / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function missingMarker() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10),
    mat(C.amber, { transparent: true, opacity: 0.6 }));
  m.position.y = 0.25;
  return m;
}
