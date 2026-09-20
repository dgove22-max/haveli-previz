/* Prop workshop — the authoring surface. Build parametric prop definitions
   (Vectorworks symbols), then place them on the 2D plan or in the 3D view.

   Edits autosave to the shared show database, so they reach everyone on their
   next load rather than being trapped in this browser. The workshop itself
   stays deliberately ignorant of acts, scenes, sub-states and inheritance: it
   edits a flat list of placements for whichever stage is selected, and
   src/props/store.js works out what that means for the database. */
import {
  SHAPES, SURFACES, SURFACE_LABEL, CONFIDENCE,
  newDefinition, newPart, newInstance, lookupDef
} from './schema.js';
import {
  loadPropsDoc, savePropsDoc, clearPropsDoc, downloadPropsJson, hasLocal,
  saveStatus, onSaveStatus
} from './store.js';
import { createPlanView } from './plan.js';
import * as THREE from 'three';

export function createWorkshop(ctx) {
  /* ctx: { model, committedPropsRaw, onDoc(doc, selectedId), picking } */
  let doc = loadPropsDoc(ctx.committedPropsRaw);
  let selectedId = null;
  let openDefId = doc.definitions[0]?.id ?? null;
  let saveTimer = null, sceneRaf = 0;
  let statusEl = null;

  const el = document.createElement('div');
  el.id = 'workshop';
  /* Into the left dock beside the programme tree, not floating over the page:
     staging is a constant tree -> place -> tree loop. */
  (document.getElementById('left-dock') ?? document.body).appendChild(el);
  document.body.dataset.editing = '1';

  const instById = id => doc.instances.find(i => i.id === id);

  const plan = createPlanView({
    model: ctx.model,
    getDoc: () => doc,
    activeSceneId: () => ctx.activeSceneId(),
    /* live during a drag: move the existing 3D node, skip the full rebuild */
    onMove: (id, patch) => {
      const i = instById(id);
      if (!i) return;
      Object.assign(i, patch);
      scheduleSave();
      ctx.onDragLive?.(id, patch);
      plan.render();
    },
    onCommit: () => commit(),              // drag ended — rebuild + refresh fields
    onSelect: id => { selectedId = id; if (id) openDefId = instById(id)?.def ?? openDefId; commit(); }
  });

  bindPicking();
  renderAll();
  commitToScene();          // push the loaded (possibly local) doc into the 3D scene at boot

  /* ── save status ── painted in place so a save does not re-render the panel.
     statusEl is declared with the other state at the top: header() assigns it
     during the first renderAll(), which runs before this point in the file. */
  function paintStatus(st) {
    if (!statusEl) return;
    const t = st.at ? st.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    statusEl.dataset.state = st.state;
    statusEl.textContent =
      st.state === 'saving' ? 'Saving…'
      : st.state === 'saved' ? `Saved ${t} — everyone sees it on their next load.`
      : st.state === 'error' ? `NOT saved: ${st.message}`
      : 'Saves to the show database as you work.';
  }
  onSaveStatus(paintStatus);

  /* ── mutation + persistence ───────────────────────────────────────── */
  /* Autosave waits for a pause so a drag is one write, not sixty. The catch is
     that a pending save must never be left behind when the stage changes — it
     used to fire afterwards, read the NEW stage's document, and silently drop
     whatever you had just placed. flush() is called before every stage switch. */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; savePropsDoc(doc); }, 350);
  }
  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    savePropsDoc(doc);            // snapshots the current stage synchronously
  }

  function commit({ full = true, save = true } = {}) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (save) scheduleSave();
    if (!sceneRaf) sceneRaf = requestAnimationFrame(() => {
      sceneRaf = 0;
      commitToScene();
      plan.render();
    });
    plan.setSelected(selectedId);
    if (full) renderAll();
  }
  function commitToScene() { ctx.onDoc(doc, selectedId); }

  function addDefinition() {
    const d = newDefinition(`Prop ${doc.definitions.length + 1}`);
    doc.definitions.push(d);
    openDefId = d.id;
    commit();
  }
  function duplicateDefinition(id) {
    const src = lookupDef(doc, id);
    if (!src) return;
    const d = structuredClone(src);
    d.id = newDefinition().id;
    d.name = src.name + ' copy';
    doc.definitions.push(d);
    openDefId = d.id;
    commit();
  }
  function deleteDefinition(id) {
    const used = doc.instances.filter(i => i.def === id).length;
    if (used && !confirm(`Delete this prop and its ${used} placement${used > 1 ? 's' : ''}?`)) return;
    doc.definitions = doc.definitions.filter(d => d.id !== id);
    doc.instances = doc.instances.filter(i => i.def !== id);
    if (openDefId === id) openDefId = doc.definitions[0]?.id ?? null;
    commit();
  }
  function placeInstance(defId) {
    const inst = newInstance(defId, [0, ctx.model.D.FS_D / 2]);
    inst.scenes = ctx.activeSceneId() ? [ctx.activeSceneId()] : [];
    doc.instances.push(inst);
    selectedId = inst.id;
    commit();
  }
  function duplicateInstance(id) {
    const src = instById(id);
    if (!src) return;
    const i = structuredClone(src);
    i.id = newInstance(src.def).id;
    i.pos = [src.pos[0] + 0.5, src.pos[1] + 0.5];
    doc.instances.push(i);
    selectedId = i.id;
    commit();
  }
  function deleteInstance(id) {
    doc.instances = doc.instances.filter(i => i.id !== id);
    if (selectedId === id) selectedId = null;
    commit();
  }

  /* ── 3D click-to-select ───────────────────────────────────────────── */
  function bindPicking() {
    const { renderer, camera, getGroup } = ctx.picking;
    const ray = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const g = getGroup();
      if (!g || !g.visible) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(g.children, true)[0];
      let o = hit?.object, id = null;
      while (o && !id) { id = o.userData?.instanceId; o = o.parent; }
      if (id) { selectedId = id; openDefId = instById(id)?.def ?? openDefId; commit(); }
    });
  }

  /* ── render ───────────────────────────────────────────────────────── */
  function renderAll() {
    const scrollTop = el.scrollTop;
    el.innerHTML = '';
    el.appendChild(header());
    const pw = section('Plan');
    pw.appendChild(plan.el);
    plan.resize();

    el.appendChild(library());
    if (openDefId) el.appendChild(definitionEditor(lookupDef(doc, openDefId)));
    el.appendChild(instanceList());
    if (selectedId) el.appendChild(instanceEditor(instById(selectedId)));
    el.scrollTop = scrollTop;

    function section(title) {
      const s = document.createElement('div');
      s.className = 'ws-group';
      s.innerHTML = `<h3>${title}</h3>`;
      el.appendChild(s);
      return s;
    }
  }

  function header() {
    const h = document.createElement('div');
    h.className = 'ws-group ws-head';
    const where = ctx.stageLabel?.() ?? '';
    h.innerHTML = `<h3>Prop workshop<button class="ws-close" type="button"
      title="Close the workshop">×</button></h3>${where ? `<p class="ws-note ws-where">${
      String(where).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
    }</p>` : ''}`;
    const row = document.createElement('div');
    row.className = 'ws-btnrow';
    row.append(
      btn('Download props.json', () => downloadPropsJson(doc), 'accent'),
      btn('Clear this stage', async () => {
        const inheriting = ctx.stageScope?.() === 'cue' || ctx.stageScope?.() === 'scene';
        if (!confirm(inheriting
          ? 'Drop every change this stage makes?\n\nIt goes back to showing whatever it inherits, unchanged.'
          : 'Remove every prop from this stage?\n\nDefinitions are kept — only the placements go.')) return;
        await clearPropsDoc();
        doc = { ...doc, instances: [] };
        selectedId = null;
        commit({ save: false });      // clearPropsDoc already wrote
      }));
    const x = h.querySelector('.ws-close');
    if (x) x.onclick = () => { hide(); ctx.onClosed?.(); };

    /* Say what "place" will actually do. On a sub-state it adds to that one row
       only; on a scene it adds to every row beneath it; on an act it adds to
       the whole act. Without this it is easy to dress one sub-state and wonder
       why the rest are empty. */
    const scope = ctx.stageScope?.();
    const reach = document.createElement('p');
    reach.className = 'ws-note ws-reach';
    reach.textContent =
      scope === 'act' ? 'Adding to the whole act — every scene and sub-state under it shows these props.'
      : scope === 'scene' ? 'Adding to this scene — every sub-state under it shows these props, but the rest of the act will not.'
      : scope === 'cue' ? 'Adding to this sub-state only. The rest of the scene will not see it.'
      : scope === 'sandbox' ? 'Sandbox — nothing placed here reaches the show.'
      : scope === 'home' ? 'Home — the hall as built, outside any act.'
      : '';
    if (reach.textContent) h.appendChild(reach);
    /* The usual thing you actually want when adding a prop is the level above:
       dress it once where it belongs rather than repeating it down the tree. */
    if (scope === 'cue' && ctx.editScene) {
      h.appendChild(btn('Edit the whole scene instead', () => ctx.editScene(), 'block'));
    }
    if ((scope === 'cue' || scope === 'scene') && ctx.editAct) {
      h.appendChild(btn('Edit the whole act instead', () => ctx.editAct(), 'block'));
    }

    h.appendChild(row);
    if (!hasLocal()) {
      h.appendChild(note('Not connected to the show database. Edits render here but are NOT saved.'));
    } else {
      statusEl = document.createElement('p');
      statusEl.className = 'ws-note ws-status';
      paintStatus(saveStatus());
      h.appendChild(statusEl);
    }
    return h;
  }

  function library() {
    const s = document.createElement('div');
    s.className = 'ws-group';
    s.innerHTML = `<h3>Library — ${doc.definitions.length} prop${doc.definitions.length === 1 ? '' : 's'}</h3>`;
    for (const d of doc.definitions) {
      const row = document.createElement('div');
      row.className = 'ws-row';
      const open = btn(d.name || d.id, () => { openDefId = openDefId === d.id ? null : d.id; renderAll(); });
      open.classList.add('ws-grow');
      open.dataset.active = String(openDefId === d.id);
      if (d.confidence === 'est' || d.confidence === 'approx') open.classList.add('ws-est');
      row.append(
        open,
        btn('place', () => placeInstance(d.id)),
        btn('⧉', () => duplicateDefinition(d.id)),
        btn('×', () => deleteDefinition(d.id)));
      s.appendChild(row);
    }
    s.appendChild(btn('＋ New prop', addDefinition, 'accent block'));
    return s;
  }

  function definitionEditor(d) {
    const s = document.createElement('div');
    s.className = 'ws-group ws-def';
    s.innerHTML = `<h3>Prop · ${esc(d.name)}</h3>`;

    s.appendChild(textField('Name', d.name, v => { d.name = v; commit(); }));
    s.appendChild(selectField('Confidence', CONFIDENCE, d.confidence, v => { d.confidence = v; commit(); }));
    s.appendChild(textField('Material note', d.material, v => { d.material = v; commit(); }));

    const partsWrap = document.createElement('div');
    d.parts.forEach((part, idx) => partsWrap.appendChild(partEditor(d, part, idx)));
    s.appendChild(partsWrap);

    const add = document.createElement('div');
    add.className = 'ws-btnrow';
    SHAPES.forEach(sh => add.appendChild(btn('＋ ' + sh, () => { d.parts.push(newPart(sh)); commit(); })));
    s.appendChild(add);

    s.appendChild(btn('Place on stage', () => placeInstance(d.id), 'accent block'));
    return s;
  }

  function partEditor(d, part, idx) {
    const w = document.createElement('div');
    w.className = 'ws-part';
    const head = document.createElement('div');
    head.className = 'ws-row';
    const sel = selectInline(SHAPES, part.shape, v => {
      const keep = { offset: part.offset, rot: part.rot, color: part.color };
      for (const k of Object.keys(part)) delete part[k];
      Object.assign(part, newPart(v), keep);
      commit();
    });
    head.append(labelSpan(`Part ${idx + 1}`), sel);
    if (d.parts.length > 1) head.appendChild(btn('×', () => { d.parts.splice(idx, 1); commit(); }));
    w.appendChild(head);

    const dims = document.createElement('div');
    dims.className = 'ws-dims';
    const upd = () => commit();
    if (part.shape === 'cylinder') {
      dims.append(
        mini('Ø', part.size[0], v => { part.size[0] = v; upd(); }),
        mini('H', part.size[1], v => { part.size[1] = v; upd(); }));
    } else if (part.shape === 'plane') {
      dims.append(
        mini('W', part.size[0], v => { part.size[0] = v; upd(); }),
        mini('H', part.size[1], v => { part.size[1] = v; upd(); }));
    } else {
      dims.append(
        mini('W', part.size[0], v => { part.size[0] = v; upd(); }),
        mini('H', part.size[1], v => { part.size[1] = v; upd(); }),
        mini('D', part.size[2], v => { part.size[2] = v; upd(); }));
    }
    w.appendChild(dims);

    const off = document.createElement('div');
    off.className = 'ws-dims';
    off.append(
      mini('x', part.offset[0], v => { part.offset[0] = v; upd(); }),
      mini('y', part.offset[1], v => { part.offset[1] = v; upd(); }),
      mini('z', part.offset[2], v => { part.offset[2] = v; upd(); }),
      mini('rot°', part.rot, v => { part.rot = v; upd(); }, 5));
    w.appendChild(off);

    if (part.shape === 'plane' || part.shape === 'mesh')
      w.appendChild(textField('File (public/content/)', part.file ?? '', v => { part.file = v || null; commit(); }));
    return w;
  }

  function instanceList() {
    const s = document.createElement('div');
    s.className = 'ws-group';
    const n = doc.instances.length;
    s.innerHTML = `<h3>On stage — ${n} placement${n === 1 ? '' : 's'}</h3>`;
    for (const i of doc.instances) {
      const def = lookupDef(doc, i.def);
      const row = document.createElement('div');
      row.className = 'ws-row';
      const b = btn(`${i.name || def?.name || '?'}  ·  ${i.pos[0].toFixed(1)}, ${i.pos[1].toFixed(1)} m`,
        () => { selectedId = selectedId === i.id ? null : i.id; commit(); });
      b.classList.add('ws-grow');
      b.dataset.active = String(selectedId === i.id);
      if (!i.enabled) b.classList.add('ws-off');
      row.append(b, btn('⧉', () => duplicateInstance(i.id)), btn('×', () => deleteInstance(i.id)));
      s.appendChild(row);
    }
    if (!n) s.appendChild(note('No props placed. Open a prop in the Library and hit “place”.'));
    return s;
  }

  function instanceEditor(i) {
    const def = lookupDef(doc, i.def);
    const s = document.createElement('div');
    s.className = 'ws-group ws-sel';
    s.innerHTML = `<h3>Placement · ${esc(i.name || def?.name || '')}</h3>`;

    s.appendChild(textField('Label (optional)', i.name ?? '', v => { i.name = v || undefined; commit(); }));

    const pos = document.createElement('div');
    pos.className = 'ws-dims';
    pos.append(
      mini('X', i.pos[0], v => { i.pos[0] = v; commit(); }),
      mini('Z', i.pos[1], v => { i.pos[1] = v; commit(); }),
      mini('rot°', i.rot, v => { i.rot = v; commit(); }, 15));
    s.appendChild(pos);

    s.appendChild(selectField('Sits on', SURFACES, i.on, v => { i.on = v; commit(); }, SURFACE_LABEL));

    /* The per-scene checkboxes that used to live here are gone: a placement now
       belongs to the stage being edited, so "which scenes is this in?" is
       answered by where you placed it. Sub-states inherit it automatically. */

    const en = document.createElement('label');
    en.className = 'ws-chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = i.enabled;
    cb.onchange = () => { i.enabled = cb.checked; commit(); };
    en.append(cb, document.createTextNode(' Enabled'));
    s.appendChild(en);

    const row = document.createElement('div');
    row.className = 'ws-btnrow';
    row.append(
      btn('Duplicate', () => duplicateInstance(i.id)),
      btn('Delete', () => deleteInstance(i.id)));
    s.appendChild(row);
    return s;
  }

  /* The workshop had no way out once open — and it used to open uninvited on
     any auth event, which made that worse. Hiding keeps the loaded document
     and the selection, so reopening is instant. */
  function hide() {
    flush();                      // closing is a stage change as far as saving goes
    el.hidden = true;
    document.body.dataset.editing = '';
  }
  function show() {
    el.hidden = false;
    document.body.dataset.editing = '1';
  }

  return {
    el, hide, show, flush,
    isOpen: () => !el.hidden,
    getDoc: () => doc,
    getSelected: () => selectedId,
    /* Adopt a document from outside — a stage change, or the raw-JSON editor.
       Does NOT save by default: this is us catching up with the database, not
       an edit, and writing it straight back would be a pointless round trip. */
    setDoc(next, { save = false } = {}) {
      doc = next;
      selectedId = null;
      openDefId = doc.definitions[0]?.id ?? null;
      if (save) savePropsDoc(doc);
      plan.setSelected(null);
      renderAll();
    }
  };

  /* ── tiny DOM helpers (panel.js house style) ──────────────────────── */
  function btn(text, onclick, cls = '') {
    const b = document.createElement('button');
    b.className = 'ws-btn ' + cls;
    b.textContent = text;
    b.onclick = onclick;
    return b;
  }
  function note(txt) { const p = document.createElement('p'); p.className = 'ws-note'; p.textContent = txt; return p; }
  function labelSpan(txt) { const s = document.createElement('span'); s.className = 'ws-lab'; s.textContent = txt; return s; }

  function textField(label, value, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'ws-field';
    wrap.append(labelSpan(label));
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = value ?? '';
    inp.onchange = () => onChange(inp.value.trim());
    wrap.appendChild(inp);
    return wrap;
  }
  function selectField(label, opts, value, onChange, labels = {}) {
    const wrap = document.createElement('label');
    wrap.className = 'ws-field';
    wrap.append(labelSpan(label), selectInline(opts, value, onChange, labels));
    return wrap;
  }
  function selectInline(opts, value, onChange, labels = {}) {
    const sel = document.createElement('select');
    sel.className = 'ws-select';
    for (const o of opts) {
      const op = document.createElement('option');
      op.value = o; op.textContent = labels[o] ?? o;
      if (o === value) op.selected = true;
      sel.appendChild(op);
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }
  function mini(label, value, onChange, step = 0.05) {
    const wrap = document.createElement('label');
    wrap.className = 'ws-mini';
    wrap.append(labelSpan(label));
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = String(step);
    inp.value = round(value ?? 0);
    inp.onchange = () => onChange(Number(inp.value) || 0);
    wrap.appendChild(inp);
    return wrap;
  }
}

const round = v => Math.round(v * 1000) / 1000;
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
