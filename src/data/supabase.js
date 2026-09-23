/* Supabase client — the shared store for everything we author.

   SPEC §2 said "no backend". That still holds in the sense that matters: there
   is no server of ours to run or deploy, no package.json and no build step.
   What changed is where authored state lives. Committed JSON meant a git commit
   plus a Vercel rebuild — 40-90s — before anyone else saw a change, which is
   unusable when staging 66 cues or adjusting during a rehearsal.

   Loaded by full CDN URL rather than through the importmap: it is imported in
   exactly this one module, so an importmap entry would mean editing all three
   HTML pages for nothing.

   Blank config is NOT an error. With no url/anonKey the app runs offline off
   the committed data/*.json files and hides every write affordance, so a view
   link keeps working before the project is set up. */

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

let client = null;
let config = null;
let pending = null;

export function initSupabase(base = '') {
  pending ??= (async () => {
    try {
      config = await fetch(`${base}data/supabase.json`).then(r => r.json());
    } catch {
      config = {};
    }
    if (!config.url || !config.anonKey) return null;
    try {
      const { createClient } = await import(CDN);
      client = createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hp-auth' }
      });
    } catch (e) {
      console.warn('Supabase unreachable — running offline:', e.message);
      client = null;
    }
    return client;
  })();
  return pending;
}

/* The raw client. Null whenever we are offline — every caller must handle that
   rather than assume a connection. */
export const sb = () => client;
export const isOnline = () => client != null;

/* Why we are offline, for the banner: never configured, or configured and the
   library or network failed. The two want different words in the UI. */
export const offlineReason = () =>
  !config ? 'loading'
    : (!config.url || !config.anonKey) ? 'unconfigured'
      : client ? null : 'unreachable';
