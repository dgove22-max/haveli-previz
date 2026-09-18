/* The editor sign-in, as a modal.

   Lives apart from panel.js because the cue sheet needs it too: Pull writes to
   the show database, so any page offering Pull has to be able to get you signed
   in. Without this, pressing Apply while signed out was a dead end — a disabled
   button and a tooltip.

   The panel keeps its own inline form, which is better in context. This is for
   pages that have no panel. */
import { signIn, editorName, setEditorName } from '../auth.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

export function openSignInDialog(onDone) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" style="width:min(380px,100%)">
    <div class="modal-head">
      <h2>Sign in to edit</h2>
      <span class="soft">The shared editor login</span>
    </div>
    <div class="modal-body">
      <form class="signin">
        <input type="email" name="email" placeholder="editor email" autocomplete="username" required>
        <input type="password" name="password" placeholder="shared password" autocomplete="current-password" required>
        <input type="text" name="who" placeholder="your name (for the change log)" value="${esc(editorName())}">
        <p class="legend err" hidden></p>
      </form>
    </div>
    <div class="modal-foot">
      <button class="view cancel" type="button">Cancel</button>
      <button class="view accent go" type="button">Sign in</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);

  const form = wrap.querySelector('form');
  const err = wrap.querySelector('.err');
  const close = () => wrap.remove();
  wrap.querySelector('.cancel').onclick = close;
  wrap.onclick = e => { if (e.target === wrap) close(); };

  async function submit() {
    const f = new FormData(form);
    err.hidden = true;
    try {
      if (String(f.get('who')).trim()) setEditorName(String(f.get('who')));
      await signIn(String(f.get('email')), String(f.get('password')));
      close();
      onDone?.();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  }
  wrap.querySelector('.go').onclick = submit;
  form.onsubmit = e => { e.preventDefault(); submit(); };
  form.querySelector('input')?.focus();
}
