/* Entry point — boot, wiring, render loop. Phase modules (props, lighting,
   exports, editor) are optional dynamic imports so the app runs at every
   commit in the phase sequence.

   The unit of navigation is no longer a "scene" from data/scenes.json but a
   STAGE ADDRESS: "home", "sandbox", "scene:<id>" or "cue:<id>", pulled from the
   programme tracker. A scene carries the set; a cue inherits it and may patch
   anything. See src/stagestate.js for why it is a patch and not a copy. */
import * as THREE from 'three';
import { loadModel, modelFrom } from './model.js';
import { glowIntensity } from './lightmath.js';
import { addTrial, kindOf } from './trials.js';
import { createStage, disposeGroup } from './three-setup.js';
import { buildVenue } from './build/venue.js';
import { createControls, viewPresets } from './camera.js';
import { LedScreen } from './video.js';
import { readState, writeState } from './state.js';
import { partVisible } from './roles.js';
import { createTransport } from './ui/transport.js';
import { createPanel } from './ui/panel.js';
import { createNav } from './nav.js';
import { initSupabase, isOnline } from './data/supabase.js';
import { initAuth, canEdit, onAuthChange } from './auth.js';
import { loadShow, seedDefsIfEmpty, stateId } from './data/showdb.js';
import { resolveTarget } from './ui/tree.js';
import { resolveStage, emptyBase, emptyPatch } from './stagestate.js';
import { setTarget, primeDoc, docFor, onSaveError } from './props/store.js';
import { propDigest } from './sheets/tracker.js';

const optional = p => import(p).then(m => m).catch(() => null);

async function boot() {
  createNav('stage');

  /* The database is optional: unconfigured or unreachable, the app still
     renders the venue from the committed JSON. External teams hold these
     links, so a blank page is never an acceptable failure. */
  await initSupabase();
  await initAuth();

  const [model, cfg] = await Promise.all([
    loadModel(),
    fetch('data/show.json').then(r => r.json()).catch(() => ({}))
  ]);
  let show = await loadShow();
  if (isOnline() && canEdit()) await seedDefsIfEmpty().catch(() => {});

  const state = readState();
  const { scene, camera, renderer, setEnvironment } = createStage(document.getElementById('view'));

  const led = new LedScreen(model.V, model.D);
  led.fit = state.fit;
  led.resIndex = state.res || 0;

  /* parts */
  let parts = {};
  const [propsMod, lightingMod] = await Promise.all([
    optional('./build/props.js'), optional('./build/lighting.js')
  ]);

  /* The props document is now per-stage: the definitions catalogue plus the
     placements resolved for whichever stage is selected. */
  let propsDoc = { definitions: [], instances: [] };
  let selectedInstance = null;
  let target = null;
  /* Declared up here, not beside openEditor below: setAt() runs during boot and
     touches `workshop`, which would hit the temporal dead zone of a later let. */
  let workshop = null;
  let editorOpen = false;

  let ledGlow = null;                         // RectAreaLight fed by the wall content
  function buildAll() {
    parts = buildVenue(model.V, model.D, led.material);
    if (propsMod) parts.props = propsMod.buildProps(model.V, model.D, propsDoc, null, { selectedId: selectedInstance });
    if (lightingMod) {
      parts.coffer = lightingMod.buildCoffer(model.V, model.D);
      parts.lighting = lightingMod.buildFixtures(model.V, model.D, model.lighting, led);
    }
    const { V, D } = model;
    const ledMidY = V.stage.deckHeight + V.led.baseAboveDeck + V.led.height / 2;
    ledGlow = new THREE.RectAreaLight(0xffffff, 0, V.led.width, V.led.height);
    ledGlow.position.set(0, ledMidY, D.LED_Z + 0.06);
    ledGlow.lookAt(0, ledMidY, 20);           // emit toward the audience
    parts.led.add(ledGlow);
    Object.values(parts).forEach(g => scene.add(g));
    applyVisibility();
    applyShowMode();
  }

  /* show mode — dark venue, real fixtures, haze, LED glow */
  function applyShowMode() {
    setEnvironment({ show: state.show3d, house: state.house });
    lightingMod?.applyLightingMode(parts.lighting, { show: state.show3d, haze: state.haze });
    if (ledGlow) ledGlow.intensity = state.show3d ? glowIntensity(led.glow.lum) : 0;
    /* plan annotations are unlit white plates — they vanish on the day */
    for (const [key, g] of Object.entries(parts)) {
      if (key === 'lighting') continue;                    // handled per-fixture above
      g.traverse(o => {
        if (o.isSprite) o.visible = !state.show3d;
        if (key === 'coffer' && o.isLineSegments)          // amber grid whispers in the dark
          o.material.opacity = state.show3d ? 0.12 : 0.5;
        if (key === 'props' && o.isLineSegments) {         // unconfirmed-prop edges too
          o.material.transparent = true;
          o.material.opacity = state.show3d ? 0.15 : 1;
        }
      });
    }
  }
  function setShowMode(patch) {
    Object.assign(state, patch);
    applyShowMode();
    pushState();
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

  /* ── stage selection ──────────────────────────────────────────────── */

  /* Where to land when the URL says nothing: the first cue of the show if
     there is one, otherwise Home. */
  const firstAt = () =>
    show.cues.length ? `cue:${show.cues[0].id}`
      : show.scenes.length ? `scene:${show.scenes[0].id}` : 'home';

  function currentTargetOf(at) {
    const t = resolveTarget(at, show);
    /* A cue's set comes from its scene; its own row holds only the patch. */
    const sceneBase = t.scene
      ? (show.states.get(`scene:${t.scene.id}`)?.base ?? emptyBase())
      : emptyBase();
    const refId = t.cue?.id ?? t.scene?.id ?? null;
    const row = show.states.get(stateId(t.scope, refId)) ?? null;
    return {
      ...t,
      scope: t.scope,
      ref_id: refId,
      base: row?.base ?? emptyBase(),
      patch: row?.patch ?? emptyPatch(),
      sceneBase,
      prop_digest: t.cue ? propDigest(t.cue) : null
    };
  }

  function setAt(at) {
    state.at = at || firstAt();
    target = currentTargetOf(state.at);
    setTarget(target);

    const resolved = target.scope === 'cue'
      ? resolveStage(target.sceneBase, target.patch)
      : resolveStage(target.base, emptyPatch());

    propsDoc = docFor(show.defs,
      { scope: target.scope, base: target.base, patch: target.patch }, target.sceneBase);
    primeDoc(propsDoc);

    led.setScene({ id: state.at, name: stageLabel(target), led: resolved.led ?? null });
    rebuildProps();
    workshop?.setDoc(propsDoc);
    pushState();
  }

  const stageLabel = t =>
    t.scope === 'home' ? 'Home — the hall as built'
      : t.scope === 'sandbox' ? 'Sandbox'
        : t.cue ? `${t.scene?.code ? t.scene.code + ' · ' : ''}${t.scene?.name ?? ''} › ${t.cue.item}`
          : `${t.scene?.code ? t.scene.code + ' · ' : ''}${t.scene?.name ?? 'Stage'}`;

  /* rebuild the props group in place — after a stage change, a workshop edit,
     or a selection change (the selected instance draws a ring). */
  function rebuildProps() {
    if (!propsMod || !parts.props) return;
    scene.remove(parts.props); disposeGroup(parts.props);
    parts.props = propsMod.buildProps(model.V, model.D, propsDoc, null, { selectedId: selectedInstance });
    scene.add(parts.props);
    applyVisibility();
    applyShowMode();                   // fresh props must re-learn the mode
  }

  /* Re-read the database after a pull or a sign-in, keeping where you were. */
  async function reloadShow() {
    show = await loadShow();
    panel?.setShow(show);
    setAt(state.at);
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
  setAt(state.at);
  if (urlT != null) { led.setPlaying(false); led.seek(urlT); }

  /* exports (phase 2+) */
  const exportsMod = await optional('./exports/index.js');
  const exportsApi = exportsMod ? exportsMod.createExports({ model, renderer, scene, camera, controls, state, led }) : {};

  /* trial backdrops — drop or pick files, applied instantly, kept in IndexedDB */
  function applyTrial(rec) {
    led.setTrial(rec);
    transport?.sync();
    panel?.refreshTrials();
  }
  async function addTrialFiles(files) {
    const media = files.filter(f => kindOf(f));
    const skipped = files.length - media.length;
    let first = null;
    for (const f of media) {
      try { const rec = await addTrial(f); first ??= rec; }
      catch (e) { console.warn('trial add failed:', f.name, e); }
    }
    if (first) applyTrial(first);
    else if (skipped) alert('Only images and videos can go on the wall.');
    else panel?.refreshTrials();
  }
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) addTrialFiles(files);
  });

  const transport = createTransport(led, () => pushState());

  const panelCtx = () => ({
    model, parts, views, controls, led, state, cfg,
    show, target: () => target,
    applyVisibility, setGhostCabin, setShowMode,
    setAt, reloadShow, openEditor,
    applyTrial, addTrialFiles,
    onStateChange: pushState,
    exports: exportsApi
  });
  panel = createPanel(panelCtx());

  /* ── editor + prop workshop ──

     ?edit=1 no longer grants anything — it only opens the panel. Whether an
     edit can actually be SAVED is the Supabase session, enforced by RLS. */
  async function openEditor() {
    if (editorOpen) return;
    editorOpen = true;
    const [ed, wsMod] = await Promise.all([
      optional('./ui/editor.js'), optional('./props/workshop.js')
    ]);
    ed?.createEditor({
      model,
      apply(raw) {
        const next = modelFrom(raw);
        Object.assign(model, next);
        led.setModel(model.V, model.D);
        selectedInstance = null;
        teardown(); buildAll();
        setGhostCabin(ghosted);
        setAt(state.at);
        panel = createPanel(panelCtx());
      }
    });
    workshop = wsMod?.createWorkshop({
      model,
      committedPropsRaw: model.raw.propsRaw,
      activeSceneId: () => null,          // membership is the stage itself now
      stageLabel: () => (target ? stageLabel(target) : ''),
      picking: { renderer, camera, getGroup: () => parts.props },
      onDoc(doc, selId) {
        propsDoc = doc;
        selectedInstance = selId ?? null;
        rebuildProps();
      },
      /* live drag — nudge the existing node instead of a full rebuild */
      onDragLive(id, patch) {
        const node = parts.props?.children.find(o => o.userData?.instanceId === id);
        if (!node) return;
        if (patch.pos) { node.position.x = patch.pos[0]; node.position.z = patch.pos[1]; }
        if (patch.rot != null) node.rotation.y = patch.rot * Math.PI / 180;
      }
    });
    workshop?.setDoc(propsDoc);
  }

  onSaveError(msg => panel?.setSaveError(msg));
  /* Seeding runs at boot too, but only for a session that already existed. On
     the very first sign-in there was none, so seed here as well or the prop
     library stays empty until someone happens to reload. */
  onAuthChange(async () => {
    panel?.refresh();
    if (!canEdit()) return;
    const seeded = await seedDefsIfEmpty().catch(() => 0);
    if (seeded) await reloadShow();
    openEditor();
  });
  if (state.edit && canEdit()) openEditor();

  /* loop */
  const readout = document.getElementById('readout');
  function tick() {
    requestAnimationFrame(tick);
    controls.tick();
    led.update();
    transport.tick();
    if (state.show3d && ledGlow) {
      const gl = led.glow;
      ledGlow.color.setRGB(
        THREE.MathUtils.lerp(ledGlow.color.r, Math.max(gl.r, 0.02), 0.15),
        THREE.MathUtils.lerp(ledGlow.color.g, Math.max(gl.g, 0.02), 0.15),
        THREE.MathUtils.lerp(ledGlow.color.b, Math.max(gl.b, 0.03), 0.15));
      ledGlow.intensity += (glowIntensity(gl.lum) - ledGlow.intensity) * 0.15;
    }
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
