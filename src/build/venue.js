/* Static venue geometry. Every builder reads the JSON-derived model (V, D)
   and returns a Group — no dimension is ever hardcoded here (SPEC §3). */
import * as THREE from 'three';
import { C } from '../palette.js';
import { box, mat, topPlane, figure, seatedFigure, dimLabel, dimLine } from './helpers.js';

export function buildVenue(V, D, ledMaterial) {
  const parts = {};
  parts.hall       = hall(V, D);
  parts.stage      = mainStage(V, D);
  parts.backstage  = backstage(V, D);
  parts.cordon     = cordon(V, D);
  parts.led        = led(V, D, ledMaterial);
  parts.drape      = drape(V, D);
  parts.curtains   = curtains(V, D);
  parts.cabin      = cabin(V, D);
  parts.chair      = chair(V, D);
  parts.forestage  = forestage(V, D);
  parts.figures    = figures(V, D);
  parts.grid       = grid();
  parts.dimensions = dimensions(V, D);
  return parts;
}

function hall(V, D) {
  const H = V.hall, g = new THREE.Group();
  const backZ = D.UPWALL_Z, frontZ = D.HALL_FRONT_Z, midZ = (backZ + frontZ) / 2;

  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(H.width, H.depth), mat(C.carpet));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0, midZ);
  carpet.receiveShadow = true;
  g.add(carpet);

  const wallMat = mat(C.wall), wh = H.wallHeight, t = 0.40;
  const back = box(H.width, wh, t, C.wall, { material: wallMat });
  back.position.set(0, wh / 2, backZ - t / 2);
  g.add(back);
  [-D.SIDE_WALL, D.SIDE_WALL].forEach(wx => {
    const side = box(t, wh, H.depth, C.wall, { material: wallMat });
    side.position.set(wx, wh / 2, midZ);
    g.add(side);
  });
  const front = box(H.width, wh, t, C.wall, { material: wallMat });
  front.position.set(0, wh / 2, frontZ + t / 2);
  g.add(front);
  return g;
}

function mainStage(V, D) {
  const S = V.stage, g = new THREE.Group(), dh = S.deckHeight;

  const midDepth = Math.abs(D.WIDEN_Z) - D.STAIR_RUN;
  const mid = box(D.FRONTAGE, dh, midDepth, C.deckSide);
  mid.position.set(0, dh / 2, -D.STAIR_RUN - midDepth / 2);
  g.add(mid);
  g.add(topPlane(D.FRONTAGE, midDepth, 0, dh + 0.002, -D.STAIR_RUN - midDepth / 2, C.deckTop));

  const strip = box(S.clearWidth, dh, D.STAIR_RUN, C.deckSide);
  strip.position.set(0, dh / 2, -D.STAIR_RUN / 2);
  g.add(strip);
  g.add(topPlane(S.clearWidth, D.STAIR_RUN, 0, dh + 0.002, -D.STAIR_RUN / 2, C.deckTop));

  const riser = dh / S.risers, tread = D.STAIR_RUN / S.risers;
  [1, -1].forEach(side => {
    const cx = side * (S.clearWidth / 2 + S.stairWidth / 2);
    for (let i = 0; i < S.risers; i++) {
      const h = riser * (i + 1);
      const step = box(S.stairWidth, h, tread, C.deckSide);
      step.position.set(cx, h / 2, -tread * (i + 0.5));
      g.add(step);
    }
  });
  return g;
}

function backstage(V, D) {
  const g = new THREE.Group(), dh = V.stage.deckHeight;
  const w = V.hall.width - 0.8;
  const depth = Math.abs(D.UPWALL_Z) - Math.abs(D.WIDEN_Z);
  const slab = box(w, dh, depth, C.deckSide);
  slab.position.set(0, dh / 2, D.WIDEN_Z - depth / 2);
  g.add(slab);
  g.add(topPlane(w, depth, 0, dh + 0.002, D.WIDEN_Z - depth / 2, C.backTop));
  return g;
}

function cordon(V, D) {
  const CD = V.cordon, g = new THREE.Group();
  [1, -1].forEach(side => {
    const inner = side * D.HALF_FRONT;
    const outer = side * (D.SIDE_WALL - 0.4);
    const w = Math.abs(outer - inner);
    const wall = box(w, CD.height, CD.thickness, C.cordon);
    wall.position.set((inner + outer) / 2, CD.height / 2, -CD.thickness / 2);
    g.add(wall);
  });
  return g;
}

function led(V, D, ledMaterial) {
  const L = V.led, g = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(L.width, L.height), ledMaterial);
  surface.name = 'ledSurface';
  surface.position.set(0, D.LED_BASE_Y + L.height / 2, D.LED_Z);
  g.add(surface);
  const carcass = box(L.width + 0.10, L.height + 0.10, 0.24, C.ledBody);
  carcass.position.set(0, D.LED_BASE_Y + L.height / 2, D.LED_Z - 0.13);
  g.add(carcass);
  return g;
}

function drape(V, D) {
  const H = V.hall, g = new THREE.Group();
  const d = box(H.width - 1.0, H.wallHeight - 0.4, 0.08, C.drape, { cast: false });
  d.position.set(0, (H.wallHeight - 0.4) / 2 + 0.2, D.UPWALL_Z + 0.12);
  g.add(d);
  return g;
}

function curtains(V, D) {
  const CT = V.curtains, g = new THREE.Group();
  const dh = V.stage.deckHeight, h = CT.top - dh;
  [1, -1].forEach(side => {
    const inner = side * D.CURT_IN;
    const outer = side * (D.SIDE_WALL - 0.25);
    const w = Math.abs(outer - inner);
    const pane = box(w, h, 0.07, C.drape, { cast: true });
    pane.position.set((inner + outer) / 2, dh + h / 2, D.CURT_Z);
    g.add(pane);
  });
  return g;
}

function cabin(V, D) {
  const K = V.cabin, g = new THREE.Group();
  const baseY = V.stage.deckHeight;
  const cz = (D.CABIN_BACK + D.CABIN_FRONT) / 2;

  const plinth = box(K.width, K.floorRaise, D.CABIN_D, C.deckSide);
  plinth.position.set(K.x, baseY + K.floorRaise / 2, cz);
  g.add(plinth);
  g.add(topPlane(K.width, D.CABIN_D, K.x, baseY + K.floorRaise + 0.002, cz, C.deckTop));

  const bodyY = baseY + K.floorRaise;
  const bodyH = K.height - K.floorRaise;
  const glassMat = new THREE.MeshPhongMaterial({
    color: C.glass, transparent: true, opacity: 0.22,
    shininess: 110, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false
  });

  const backW = box(K.width, bodyH, K.frame, C.cabin);
  backW.position.set(K.x, bodyY + bodyH / 2, D.CABIN_BACK + K.frame / 2);
  g.add(backW);

  const roof = box(K.width, K.frame, D.CABIN_D, C.cabin);
  roof.position.set(K.x, bodyY + bodyH - K.frame / 2, cz);
  g.add(roof);

  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(K.width - K.frame * 2, bodyH - K.frame), glassMat);
  front.position.set(K.x, bodyY + (bodyH - K.frame) / 2, D.CABIN_FRONT);
  g.add(front);

  [1, -1].forEach(side => {
    const sideGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(D.CABIN_D - K.frame, bodyH - K.frame), glassMat);
    sideGlass.rotation.y = Math.PI / 2;
    sideGlass.position.set(K.x + side * (K.width / 2 - K.frame / 2),
                           bodyY + (bodyH - K.frame) / 2, cz);
    g.add(sideGlass);
  });
  return g;
}

function chair(V, D) {
  const g = new THREE.Group();
  const floorY = V.stage.deckHeight + V.cabin.floorRaise;
  const cm = mat(C.chair), CZ = D.CHAIR_Z;

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.72), cm);
  seat.position.set(0, floorY + 0.44, CZ);
  const backr = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.72, 0.14), cm);
  backr.position.set(0, floorY + 0.88, CZ - 0.30);

  [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.28], [0.32, 0.28]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.36, 0.09), cm);
    leg.position.set(lx, floorY + 0.18, CZ + lz);
    leg.castShadow = true;
    g.add(leg);
  });
  [-1, 1].forEach(sdx => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, 0.66), cm);
    arm.position.set(sdx * 0.44, floorY + 0.62, CZ - 0.02);
    arm.castShadow = true;
    g.add(arm);
  });
  [seat, backr].forEach(p => { p.castShadow = true; g.add(p); });
  g.add(seatedFigure(0, CZ + 0.05, floorY + 0.08));
  return g;
}

function forestage(V, D) {
  const FS = V.forestage, g = new THREE.Group(), seam = FS.seam;
  for (let c = 0; c < FS.cols; c++) {
    for (let r = 0; r < FS.rows; r++) {
      const cx = -D.FS_W / 2 + FS.pieceW * (c + 0.5);
      const cz = FS.pieceD * (r + 0.5);
      const piece = box(FS.pieceW - seam, D.FS_H, FS.pieceD - seam, C.deckSide);
      piece.position.set(cx, D.FS_H / 2, cz);
      g.add(piece);
      g.add(topPlane(FS.pieceW - seam, FS.pieceD - seam, cx, D.FS_H + 0.002, cz, C.deckTop));
    }
  }
  return g;
}

function figures(V, D) {
  const g = new THREE.Group();
  g.add(figure(0, 2.4, D.FS_H, 1.6764));   // 5'6" — centre of the performance stage
  return g;
}

function grid() {
  const gr = new THREE.GridHelper(100, 100, 0xb4b7b1, 0xd0d3cd);
  gr.position.set(0, 0.004, 15);
  return gr;
}

function dimensions(V, D) {
  const g = new THREE.Group();
  const dh = V.stage.deckHeight, L = V.led, K = V.cabin;
  const ledBase = D.LED_BASE_Y;

  g.add(dimLine([-V.stage.clearWidth / 2, dh + 0.05, 0.8], [V.stage.clearWidth / 2, dh + 0.05, 0.8]));
  g.add(dimLabel(`${V.stage.clearWidth.toFixed(2)} m`, 0, dh + 0.45, 0.8));

  g.add(dimLine([-L.width / 2, ledBase + L.height + 0.4, D.LED_Z], [L.width / 2, ledBase + L.height + 0.4, D.LED_Z]));
  g.add(dimLabel(`${L.width.toFixed(2)} m`, 0, ledBase + L.height + 0.8, D.LED_Z));

  g.add(dimLine([-13.9, dh + 0.05, 0], [-13.9, dh + 0.05, D.LED_Z]));
  g.add(dimLabel(`${V.stage.depthToLed.toFixed(2)} m`, -13.9, dh + 0.45, D.LED_Z / 2, 2.0));

  g.add(dimLine([1.2, dh + K.floorRaise + 0.05, 0], [1.2, dh + K.floorRaise + 0.05, D.CHAIR_Z]));
  g.add(dimLabel("11'0\"", 1.2, dh + K.floorRaise + 0.45, D.CHAIR_Z / 2, 1.6));

  g.add(dimLine([-(D.HALF_FRONT + 2.0), 0, 0.15], [-(D.HALF_FRONT + 2.0), V.cordon.height, 0.15]));
  g.add(dimLabel("6'0\"", -(D.HALF_FRONT + 3.1), V.cordon.height / 2, 0.15, 1.4));

  g.add(dimLine([-V.hall.width / 2, 0.05, 12], [V.hall.width / 2, 0.05, 12]));
  g.add(dimLabel(`${V.hall.width.toFixed(2)} m`, 0, 0.5, 12, 3.2));
  return g;
}
