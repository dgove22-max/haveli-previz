/* Programme navigator — Act › Scene › Sub-state.

   Replaces the old flat six-button scene list. The real show is 10 acts, 40
   scenes and 65 sub-states, which is far too many for a flat list, so acts
   collapse and only the act you are working in stays open.

   Three things are deliberate:

   · Every level is selectable in its own right, not just a header. Editing an
     act edits the set its whole act plays on; editing a scene edits what that
     scene changes about it. Both are places you need to be able to stand.

   · The act's own row sits inside the disclosure rather than in its summary.
     A summary is the expand/collapse control — a click anywhere in it toggles
     the act — so a second action placed there would fire the wrong one.

   · The needs-staging badge sits on the row rather than in a separate list.
     The brief asked for "an icon, for us to press, that takes us to the stage
     view which would be empty" — so the marker and the way in are one thing. */

const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const TYPE_CHIP = {
  'Musical': 'accent', 'Gun Grahan': 'amber', 'Jingle': 'dim',
  'MSM Live': 'ok', 'MSM Action': 'ok', 'Drama Pre-rec': 'dim',
  'Live Act': '', 'Compere': 'dim', 'Video': 'dim'
};

export function createTree(host, ctx) {
  /* ctx: { show, at, onSelect, issues: Map<cueId, {reason}>, openActs: Set } */
  const open = ctx.openActs ?? new Set();
  /* An explicit "collapse all" has to beat the convenience that reopens the
     act holding the selection, or the button would appear to do nothing. */
  let suppressAutoOpen = false;

  function render() {
    const { acts, scenes, cues } = ctx.show;
    const at = ctx.at();
    const issues = ctx.issues ?? new Map();

    if (!acts.length) {
      host.innerHTML = `<p class="hint">No programme yet — press <strong>Pull from sheet</strong> to load it.</p>`;
      wireSpecials();
      return;
    }

    /* Open the act containing the selection, so a deep link lands somewhere
       visible rather than inside a collapsed section. */
    const sel = selectedIds(at, scenes, cues);
    if (sel.actId && !suppressAutoOpen) open.add(sel.actId);
    suppressAutoOpen = false;

    const scenesByAct = groupBy(scenes, s => s.act_id);
    const cuesByScene = groupBy(cues, c => c.scene_id);

    const anyOpen = acts.some(a => open.has(a.id));
    const tools = `<div class="tree-tools">
      <span class="soft">${acts.length} acts · ${cues.length} sub-states</span>
      <button class="tree-tool" type="button" data-collapse="${anyOpen}">${
        anyOpen ? 'Collapse all' : 'Expand all'}</button>
    </div>`;

    host.innerHTML = specials(at) + tools + acts.map(act => {
      const list = scenesByAct.get(act.id) ?? [];
      const actIssues = list.reduce((n, s) =>
        n + (cuesByScene.get(s.id) ?? []).filter(c => issues.has(c.id)).length, 0);

      return `<details class="act" data-act="${esc(act.id)}"${open.has(act.id) ? ' open' : ''}>
        <summary>
          <span class="act-name">${esc(act.name.replace(/\n/g, ' '))}</span>
          <span class="act-meta">${list.length}</span>
          ${actIssues ? `<span class="chip amber" title="${actIssues} need staging">⚠ ${actIssues}</span>` : ''}
        </summary>
        <button class="tnode act-row" data-at="act:${esc(act.id)}" data-active="${at === `act:${act.id}`}"
                title="Edit the set the whole act plays on — every scene below inherits it">
          <span class="tlabel">Act set</span>
        </button>
        ${list.map(s => sceneBlock(s, cuesByScene.get(s.id) ?? [], at, issues)).join('')}
      </details>`;
    }).join('');

    wire();
    wireSpecials();
  }

  function sceneBlock(scene, sceneCues, at, issues) {
    const active = at === `scene:${scene.id}`;
    return `<div class="scene">
      <button class="tnode scene-row" data-at="scene:${esc(scene.id)}" data-active="${active}"
              title="What this scene changes about the act's set — every sub-state below inherits the result">
        ${scene.code ? `<span class="code">${esc(scene.code)}</span>` : ''}
        <span class="tlabel">${esc(scene.name)}</span>
      </button>
      ${sceneCues.map(c => {
        const iss = issues.get(c.id);
        const on = at === `cue:${c.id}`;
        return `<button class="tnode cue-row" data-at="cue:${esc(c.id)}" data-active="${on}"
                  title="${esc([c.type, c.live_prerec, c.presenter].filter(Boolean).join(' · '))}">
          <span class="tlabel">${esc(c.item)}</span>
          ${c.type ? `<span class="chip ${TYPE_CHIP[c.type] ?? 'dim'}">${esc(c.type)}</span>` : ''}
          ${iss ? `<span class="chip amber stage-flag" title="${esc(iss.reason)}">⚠</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }

  /* Home and Sandbox sit outside the programme — they are not in the sheet and
     must not look like they are. */
  const specials = at => `<div class="specials">
    <button class="tnode special" data-at="home" data-active="${at === 'home'}">
      <span class="tlabel">Home — the hall as built</span>
    </button>
    <button class="tnode special" data-at="sandbox" data-active="${at === 'sandbox'}">
      <span class="tlabel">Sandbox — scratch stage</span>
    </button>
  </div>`;

  function wire() {
    const tool = host.querySelector('.tree-tool');
    if (tool) tool.onclick = () => {
      const collapse = tool.dataset.collapse === 'true';
      open.clear();
      if (collapse) suppressAutoOpen = true;
      else ctx.show.acts.forEach(a => open.add(a.id));
      render();
    };
    host.querySelectorAll('details.act').forEach(d => {
      d.addEventListener('toggle', () => {
        d.open ? open.add(d.dataset.act) : open.delete(d.dataset.act);
      });
    });
    host.querySelectorAll('.tnode').forEach(b => {
      b.onclick = () => ctx.onSelect(b.dataset.at);
    });
  }
  const wireSpecials = () => host.querySelectorAll('.special').forEach(b => {
    b.onclick = () => ctx.onSelect(b.dataset.at);
  });

  render();
  return { render };
}

function selectedIds(at, scenes, cues) {
  if (!at) return {};
  const [kind, id] = at.split(':');
  if (kind === 'act') return { actId: id };
  if (kind === 'scene') return { sceneId: id, actId: scenes.find(s => s.id === id)?.act_id };
  if (kind === 'cue') {
    const cue = cues.find(c => c.id === id);
    const scene = scenes.find(s => s.id === cue?.scene_id);
    return { cueId: id, sceneId: scene?.id, actId: scene?.act_id };
  }
  return {};
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/* Where a given selection resolves to for rendering: which act supplies the
   set, which scene changes it, and which sub-state (if any) changes that.

   Every level above the selection comes back too, because resolving a stage
   means walking the whole chain down to it. */
export function resolveTarget(at, show) {
  if (!at || at === 'home' || at === 'sandbox') {
    return { scope: at || 'home', act: null, scene: null, cue: null };
  }
  const actOf = scene => show.acts.find(a => a.id === scene?.act_id) ?? null;
  const [kind, id] = at.split(':');
  if (kind === 'act') {
    return { scope: 'act', act: show.acts.find(a => a.id === id) ?? null, scene: null, cue: null };
  }
  if (kind === 'scene') {
    const scene = show.scenes.find(s => s.id === id) ?? null;
    return { scope: 'scene', act: actOf(scene), scene, cue: null };
  }
  const cue = show.cues.find(c => c.id === id) ?? null;
  const scene = show.scenes.find(s => s.id === cue?.scene_id) ?? null;
  return { scope: 'cue', act: actOf(scene), scene, cue };
}
