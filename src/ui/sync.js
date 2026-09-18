/* Pull from the sheet, review what changed, apply.

   Pull is manual and always shows its work before committing anything. Two
   reasons, both from the brief: a background poll could reshuffle the
   programme mid-rehearsal, and an unreviewed auto-apply would let one careless
   edit in a shared spreadsheet silently rewrite the show.

   Applying replaces the programme only. Authored stage states are never
   touched — a row deleted from the sheet leaves its staging orphaned and
   flagged, never deleted, because "someone tidied the spreadsheet" must not be
   able to destroy an evening's work. */

import { fetchTracker, propDigest } from '../sheets/tracker.js';
import { fetchLedTracker, joinLed } from '../sheets/led.js';
import { diffProgramme, summarise } from '../sheets/diff.js';
import { applyProgramme } from '../data/showdb.js';
import { canEdit } from '../auth.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

export function createSync(host, ctx) {
  /* ctx: { cfg, show, onApplied, online } */
  let pulled = null, diff = null, busy = false;

  const el = document.createElement('div');
  el.className = 'sync';
  host.appendChild(el);

  function render() {
    const when = ctx.show.snapshotAt
      ? new Date(ctx.show.snapshotAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : null;

    el.innerHTML = `
      <button class="view accent pull" ${busy ? 'disabled' : ''}>
        ${busy ? 'Pulling…' : 'Pull from sheet'}
      </button>
      <p class="hint sync-note">${
        !ctx.online() ? '<span class="chip amber">OFFLINE</span> not connected to the show database'
        : when ? `<span class="chip ok">SYNCED</span> ${esc(when)} · ${ctx.show.cues.length} cues`
        : '<span class="chip amber">NEVER PULLED</span> the programme is empty'
      }</p>
      ${ctx.cfg?.tracker?.editUrl
        ? `<a class="view" href="${esc(ctx.cfg.tracker.editUrl)}" target="_blank" rel="noopener">Open the sheet ↗</a>`
        : ''}`;

    el.querySelector('.pull').onclick = pull;
  }

  async function pull() {
    if (busy) return;
    busy = true; render();
    try {
      const prog = await fetchTracker(ctx.cfg.tracker);
      /* The LED tracker is a nice-to-have: if that tab moves or is renamed the
         pull should still deliver the programme rather than failing entirely. */
      try {
        prog.cues = joinLed(prog.cues, await fetchLedTracker(ctx.cfg.ledTracker));
      } catch (e) {
        console.warn('LED tracker not joined:', e.message);
      }
      pulled = prog;
      diff = diffProgramme(ctx.show.snapshot, prog);
      showReview();
    } catch (e) {
      alert(`Pull failed.\n\n${e.message}`);
    } finally {
      busy = false; render();
    }
  }

  function showReview() {
    const modal = document.createElement('div');
    modal.className = 'modal-wrap';
    modal.innerHTML = `<div class="modal">
      <div class="modal-head">
        <h2>Changes from the sheet</h2>
        <span class="soft">${esc(summarise(diff))}</span>
      </div>
      <div class="modal-body">${reviewBody()}</div>
      ${canEdit() ? '' : `<p class="modal-note">
        <span class="chip amber">SIGNED OUT</span>
        Applying writes to the show database, so it needs the editor login.
      </p>`}
      <div class="modal-foot">
        <button class="view cancel">Cancel</button>
        ${canEdit()
          ? `<button class="view accent apply">${
              diff.isEmpty ? 'Nothing to apply' : `Apply — ${pulled.cues.length} cues`}</button>`
          : `<button class="view accent signin-first">Sign in to apply</button>`}
      </div>
    </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.cancel').onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };

    /* A disabled button with only a tooltip was a dead end — the click did
       nothing and said nothing. Send them somewhere they can actually act. */
    const si = modal.querySelector('.signin-first');
    if (si) si.onclick = () => { close(); ctx.onNeedSignIn?.(); };

    const applyBtn = modal.querySelector('.apply');
    if (applyBtn) applyBtn.onclick = async () => {
      const btn = modal.querySelector('.apply');
      btn.disabled = true; btn.textContent = 'Applying…';
      try {
        const { skipped } = await applyProgramme(pulled) ?? {};
        close();
        await ctx.onApplied();
        if (skipped?.length) {
          /* The programme is in; some fields could not be stored. Say which,
             and how to get them, without having blocked the pull over it. */
          const cols = [...new Set(skipped.map(c => c.split('.').pop()))];
          alert(
            `Applied, but your database has no column for:\n  ${cols.join(', ')}\n\n` +
            `Everything else is in. To store these too, run in the Supabase SQL editor:\n` +
            cols.map(c => `  alter table cues add column if not exists ${c} text;`).join('\n') +
            `\n\nThen pull again.`);
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Apply';
        alert(`Apply failed.\n\n${e.message}`);
      }
    };
  }

  function reviewBody() {
    if (diff.isFirstPull) {
      return `<p class="hint">Nothing has been accepted yet, so this is the whole programme:</p>
        <ul class="difflist">
          <li><strong>${pulled.acts.length}</strong> acts</li>
          <li><strong>${pulled.scenes.length}</strong> scenes</li>
          <li><strong>${pulled.cues.length}</strong> sub-states</li>
        </ul>`;
    }
    if (diff.isEmpty) return `<p class="hint">The sheet matches what is already loaded.</p>`;

    let html = '';
    for (const kind of ['acts', 'scenes', 'cues']) {
      const k = diff.kinds[kind];
      if (!k.added.length && !k.removed.length && !k.changed.length) continue;
      html += `<h3>${esc(k.label)}s</h3><ul class="difflist">`;
      html += k.added.map(x => `<li><span class="chip ok">NEW</span> ${esc(x.label)}</li>`).join('');
      html += k.removed.map(x =>
        `<li><span class="chip warn">GONE</span> ${esc(x.label)}
           <span class="soft">— any staging for it is kept, not deleted</span></li>`).join('');
      html += k.changed.map(x => `<li><span class="chip amber">EDIT</span> ${esc(x.label)}
        <ul class="fields">${x.fields.map(f =>
          `<li><span class="mono">${esc(f.field)}</span>
             <s>${esc(f.from) || '—'}</s> → <strong>${esc(f.to) || '—'}</strong></li>`).join('')}</ul></li>`).join('');
      html += '</ul>';
    }
    if (diff.reordered.length) {
      html += `<h3>Reordered</h3><p class="hint">${diff.reordered.length} rows moved in the running order.</p>`;
    }
    return html;
  }

  render();
  return { render };
}

/* Cues whose sheet prop text implies staging work. Exposed here so the panel
   and the cue-sheet page flag the same rows for the same reason. */
export function stagingIssues(show) {
  const out = new Map();
  for (const cue of show.cues) {
    const digest = propDigest(cue);
    if (digest.replace(/[\s|]/g, '') === '') continue;
    const st = show.states.get(`cue:${cue.id}`);
    const staged = st && (
      Object.keys(st.patch?.props ?? {}).length ||
      Object.keys(st.patch?.lighting ?? {}).length || st.patch?.led);
    if (!staged) out.set(cue.id, { reason: 'Sheet lists props — nothing staged yet' });
    else if (st.prop_digest != null && st.prop_digest !== digest) {
      out.set(cue.id, { reason: 'Sheet props changed since this was staged' });
    }
  }
  return out;
}
