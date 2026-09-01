/* Props — three types, one data shape (SPEC §6): primitive, image plane,
   glTF mesh. Props outside the active scene ghost to 12% so the builder
   keeps context. est/approx props carry an amber wireframe — nobody builds
   off a guess without seeing it is one. */
import * as THREE from 'three';
import { C } from '../palette.js';
import { mat, dimLabel } from './helpers.js';

export function buildProps(V, D, props, activeScene) {
  const g = new THREE.Group();
  for (const p of props ?? []) {
    if (!p.enabled) continue;
    const node = buildProp(p, V, D);
    if (!node) continue;
    const inScene = !p.scenes?.length || !activeScene || p.scenes.includes(activeScene.id);
    if (!inScene) node.traverse(o => {
      if (o.isMesh || o.isLine) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.12;
        o.castShadow = false;
      }
    });
    g.add(node);
  }
  return g;
}

function baseY(p, V, D) {
  switch (p.on) {
    case 'stage':  return V.stage.deckHeight;
    case 'cabin':  return V.stage.deckHeight + V.cabin.floorRaise;
    case 'floor':  return 0;
    default:       return D.FS_H;            // forestage
  }
}

function buildProp(p, V, D) {
  const y = baseY(p, V, D);
  const g = new THREE.Group();
  g.position.set(p.pos?.[0] ?? 0, y, p.pos?.[1] ?? 0);
  g.rotation.y = (p.rot ?? 0) * Math.PI / 180;
  let h = 1;

  if (p.type === 'primitive' && p.shape === 'box') {
    const [w, bh, d] = p.size; h = bh;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, bh, d), mat(C.prop));
    m.position.y = bh / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m, unconfirmedEdges(p, new THREE.BoxGeometry(w, bh, d), bh / 2));
  } else if (p.type === 'primitive' && p.shape === 'cylinder') {
    const [dia, ch] = p.size; h = ch;
    const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, ch, 24);
    const m = new THREE.Mesh(geo, mat(C.prop));
    m.position.y = ch / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m, unconfirmedEdges(p, geo, ch / 2));
  } else if (p.type === 'image') {
    const [w, ih] = p.size; h = ih;
    const texture = p.file ? fileTexture(p.file) : placeholderTexture(p);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ih),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }));
    m.position.y = ih / 2;
    g.add(m);
  } else if (p.type === 'mesh') {
    if (!p.file) return null;
    h = 1.5;
    import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      new GLTFLoader().load(`public/content/${p.file}`, gltf => {
        gltf.scene.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        g.add(gltf.scene);
      }, undefined, () => g.add(missingMarker()));
    });
  } else return null;

  const label = dimLabel(p.name ?? p.id, 0, h + 0.35, 0, Math.max(1.6, (p.name ?? p.id).length * 0.14));
  g.add(label);
  return g;
}

function unconfirmedEdges(p, geo, yMid) {
  const g = new THREE.Group();
  if (p.confidence === 'measured' || p.confidence === 'stated') return g;
  const e = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: C.amber }));
  e.position.y = yMid;
  g.add(e);
  return g;
}

function fileTexture(file) {
  const t = new THREE.TextureLoader().load(`public/content/${file}`);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function placeholderTexture(p) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.max(64, Math.round(512 * (p.size?.[1] ?? 1) / (p.size?.[0] ?? 1)));
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
  c.fillText(`${p.name} — ${p.size[0]} × ${p.size[1]} m`, cv.width / 2, cv.height / 2);
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
