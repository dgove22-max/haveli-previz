/* Entry point — boot, wiring, render loop. Phase modules (props, lighting,
   exports, editor) are optional dynamic imports so the app runs at every
   commit in the phase sequence. */
import { loadModel, modelFrom } from './model.js';
import { createStage, disposeGroup } from './three-setup.js';
import { buildVenue } from './build/venue.js';
import { createControls, viewPresets } from './camera.js';
import { LedScreen } from './video.js';
import { readState, writeState } from './state.js';
import { partVisible } from './roles.js';
import { createTransport } from './ui/transport.js';
import { createPanel } from './ui/panel.js';
import { createNav } from './nav.js';

const optional = p => import(p).then(m => m).catch(() => null);

async function boot() {
  createNav('stage');
  const model = await loadModel();
  const state = readState();
  const { scene, camera, renderer } = createStage(document.getElementById('view'));

  const led = new LedScreen(model.V, model.D);
  led.fit = state.fit;
  led.resIndex = state.res || 0;

  /* parts */
  let parts = {};
  const [propsMod, lightingMod] = await Promise.all([
    optional('./build/props.js'), optional('./build/lighting.js')
  ]);

  function buildAll() {
    parts = buildVenue(model.V, model.D, led.material);
    if (propsMod) parts.props = propsMod.buildProps(model.V, model.D, model.props, activeScene());
    if (lightingMod) {
      parts.coffer = lightingMod.buildCoffer(model.V, model.D);
      parts.lighting = lightingMod.buildFixtures(model.V, model.D, model.lighting, led);
    }
    Object.values(parts).forEach(g => scene.add(g));
    applyVisibility();
  }
  function teardown() {
    Object.values(parts).forEach(g => { scene.remove(g); disposeGroup(g); });
    parts = {};
  }

  /* visibility */
  function applyVisibility() {
    for (const [key, g] of Object.entries(parts))
      g.visible = partVisible(key, state.role, state.hide, state.show);
  }

  /* scenes */
  function activeScene() {
    return model.scenes.find(s => s.id === state.scene) ?? model.scenes[0];
  }
  function setScene(id) {
    state.scene = id;
    const sc = activeScene();
    led.setScene(sc);
    if (propsMod && parts.props) {
      scene.remove(parts.props); disposeGroup(parts.props);
      parts.props = propsMod.buildProps(model.V, model.D, model.props, sc);
      scene.add(parts.props);
      applyVisibility();
    }
    pushState();
  }

  /* ghost cabin */
  let ghosted = false;
  function setGhostCabin(on) {
    ghosted = on;
    parts.cabin?.traverse(o => {
      if (!o.isMesh) return;
      o.material.userData.o ??= o.material.opacity ?? 1;
      o.material.transparent = on || o.material.userData.o < 1;
      o.material.opacity = on ? 0.18 : o.material.userData.o;
      o.castShadow = !on;
    });
  }

  /* camera */
  const views = viewPresets(model.V);
  const controls = createControls(camera, renderer.domElement, () => {
    state.cam = null;
    queueStateWrite();
  });

  /* URL state */
  let panel = null;
  let stateTimer = null;
  function pushState(now = false) {
    state.fit = led.fit;
    state.res = led.resIndex;
    state.keepout = led.keepout;
    state.t = led.playing ? null : led.time;
    if (!state.cam) state.cv = controls.serialize();
    writeState(state);
    panel?.refresh();
  }
  function queueStateWrite() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => pushState(), 300);
  }

  /* boot sequence — apply URL state BEFORE the first pushState can stomp it */
  const urlT = state.t;
  buildAll();
  if (state.cv && controls.applySerialized(state.cv)) { /* exact linked camera */ }
  else {
    const v = views.find(v => v.id === state.cam) ?? views[0];
    controls.setView(v);
    state.cam = v.id;
  }
  led.setKeepout(state.keepout ?? (state.role === 'content'));
  setScene(state.scene ?? model.scenes[0].id);
  if (urlT != null) { led.setPlaying(false); led.seek(urlT); }

  /* exports (phase 2+) */
  const exportsMod = await optional('./exports/index.js');
  const exportsApi = exportsMod ? exportsMod.createExports({ model, renderer, scene, camera, controls, state, led }) : {};

  const transport = createTransport(led, () => pushState());
  panel = createPanel({
    model, parts, views, controls, led, state,
    applyVisibility, setScene, setGhostCabin,
    onStateChange: pushState,
    exports: exportsApi
  });

  /* editor (owner only, ?edit=1) */
  if (state.edit) {
    const ed = await optional('./ui/editor.js');
    ed?.createEditor({
      model,
      apply(raw) {
        const next = modelFrom(raw);
        Object.assign(model, next);
        led.setModel(model.V, model.D);
        teardown(); buildAll();
        setGhostCabin(ghosted);
        led.setScene(activeScene());
        panel = createPanel({
          model, parts, views, controls, led, state,
          applyVisibility, setScene, setGhostCabin,
          onStateChange: pushState, exports: exportsApi
        });
      }
    });
  }

  /* loop */
  const readout = document.getElementById('readout');
  function tick() {
    requestAnimationFrame(tick);
    controls.tick();
    led.update();
    transport.tick();
    readout.textContent =
      `x ${camera.position.x.toFixed(1)}   y ${camera.position.y.toFixed(1)}   ` +
      `z ${camera.position.z.toFixed(1)}   ·   ${controls.distance.toFixed(1)} m from target`;
    renderer.render(scene, camera);
  }
  tick();
}

boot().catch(err => {
  document.getElementById('boot-error').textContent =
    `Failed to start: ${err.message}. Serve this folder over HTTP (see README) — file:// cannot load the model JSON.`;
  console.error(err);
});
