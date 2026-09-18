/* The editor gate.

   SPEC §3 wants "single editor, no accounts", so writing is behind one shared
   login rather than per-person auth. That choice was deliberate over magic
   links: a magic link needs email delivery to work, and depending on that over
   venue wifi minutes before a show is the wrong risk to take.

   Its one real weakness — no record of who changed what — is covered cheaply:
   each editor types a display name once per device, it rides along on every
   save, and stage_state_versions keeps the previous value so any change can be
   rolled back.

   ?edit=1 no longer grants anything. It only pre-opens the editor UI; the
   actual permission is the Supabase session, enforced server-side by RLS. Old
   links therefore still work, they just ask you to sign in. */

import { sb, isOnline } from './data/supabase.js';

const NAME_KEY = 'hp-editor-name';

let session = null;
let lastCanEdit = false;
const listeners = new Set();

const notify = () => listeners.forEach(fn => fn(canEdit()));

/* Subscribe to sign-in/sign-out. Returns an unsubscribe. */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initAuth() {
  if (!isOnline()) return null;
  try {
    const { data } = await sb().auth.getSession();
    session = data.session ?? null;
    lastCanEdit = canEdit();

    /* supabase-js emits on far more than sign-in and sign-out: it registers a
       visibilitychange listener and re-checks the session whenever a tab
       regains focus, firing SIGNED_IN / TOKEN_REFRESHED each time. Subscribers
       here care about one question — may I write? — so only tell them when the
       answer actually changes.

       Without this, following any external link and coming back counted as an
       auth event, and the stage page opened the prop workshop uninvited. */
    sb().auth.onAuthStateChange((_event, s) => {
      session = s ?? null;
      const now = canEdit();
      if (now === lastCanEdit) return;
      lastCanEdit = now;
      notify();
    });
  } catch {
    session = null;
  }
  return session;
}

/* The single source of truth for "may I write". Anything that mutates must
   check this — but note the real enforcement is RLS, not this function. */
export const canEdit = () => isOnline() && session != null;

export const currentEmail = () => session?.user?.email ?? null;

export function editorName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export function setEditorName(name) {
  try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* private mode */ }
}

/* Who to stamp on a save. Falls back to the login address, then to something
   honest rather than pretending we know. */
export const savedBy = () => editorName() || currentEmail() || 'unknown editor';

export async function signIn(email, password) {
  if (!isOnline()) throw new Error('Not connected to the show database.');
  const { error } = await sb().auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) throw new Error(error.message);
  return true;
}

export async function signOut() {
  if (!isOnline()) return;
  await sb().auth.signOut();
}
