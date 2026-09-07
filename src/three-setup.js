import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { C } from './palette.js';

/* Renderer, scene, lights. Intensities are the r128 values × π — modern
   three uses physical light units (useLegacyLights is gone).
   setEnvironment() swings the whole stage between the bright planning view
   and the dark show view: house level scales the ambient rig, show mode
   switches background/fog to near-black and turns on ACES tone mapping. */

RectAreaLightUniformsLib.init();      // required once for RectAreaLight (LED glow)

const SHOW_BG = new THREE.Color(0x07090c);

function cssSceneBg() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim();
  return new THREE.Color(v || `#${C.paper.toString(16)}`);
}

export function createStage(host) {
  const scene = new THREE.Scene();
  scene.background = cssSceneBg();
  scene.fog = new THREE.Fog(scene.background, 70, 190);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8bcb4, 0.85 * Math.PI);
  scene.add(hemi);

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

  const env = { show: false, house: 1 };

  function applyBg() {
    const bg = env.show ? SHOW_BG : cssSceneBg();
    scene.background = bg;
    scene.fog.color.copy(bg);
  }
  window.addEventListener('hp-theme', applyBg);

  /* house ∈ [0,1] scales the planning rig; show flips the world dark. */
  function setEnvironment({ show, house }) {
    if (show != null) env.show = show;
    if (house != null) env.house = house;
    const h = env.show ? env.house : Math.max(env.house, 1);   // plan view stays bright
    hemi.intensity = 0.85 * Math.PI * h;
    keyLight.intensity = 0.55 * Math.PI * h;
    fillLight.intensity = 0.18 * Math.PI * h;
    const tm = env.show ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    if (renderer.toneMapping !== tm) {
      renderer.toneMapping = tm;
      renderer.toneMappingExposure = 1.0;
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }
    applyBg();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  return { scene, camera, renderer, setEnvironment };
}

/* Dispose a group's GPU resources before rebuild. */
export function disposeGroup(g) {
  g.traverse(o => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach(m => { m.map?.dispose(); m.dispose(); });
  });
}
