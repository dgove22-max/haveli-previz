import * as THREE from 'three';
import { C } from './palette.js';

/* Renderer, scene, lights. Intensities are the r128 values × π — modern
   three uses physical light units (useLegacyLights is gone). */
export function createStage(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.paper);
  scene.fog = new THREE.Fog(C.paper, 70, 190);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcb4, 0.85 * Math.PI));

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.55 * Math.PI);
  keyLight.position.set(18, 26, 20);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const sh = 34;
  Object.assign(keyLight.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh, near: 1, far: 110 });
  keyLight.shadow.bias = -0.0008;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.18 * Math.PI);
  fillLight.position.set(-20, 12, 10);
  scene.add(fillLight);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  return { scene, camera, renderer };
}

/* Dispose a group's GPU resources before rebuild. */
export function disposeGroup(g) {
  g.traverse(o => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach(m => { m.map?.dispose(); m.dispose(); });
  });
}
