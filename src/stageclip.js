/* The stage clipboard — copy one stage's dressing, paste it onto another.

   Inheritance answers "every scene in this act plays on the same set". It does
   not answer "this scene is dressed like that one, and then diverges", which is
   the far commoner case: two scenes share four of five props and nothing above
   them should own either arrangement. Pushing the set up to the act to get it
   into one more scene puts it into ALL of them.

   So this is deliberately a one-off duplicate, not a link. Paste and the two
   stages are identical; edit either afterwards and they part company. If you
   want them to stay together, that is what the act level is for.

   It lives in localStorage rather than the database because a clipboard belongs
   to the person doing the copying, not to the show — the same reasoning as
   saved views. It survives navigating between stages and reloading, which is
   the whole point: you copy on one stage and paste on another. */

const KEY = 'hp-stage-clip';

/* { at, label, props: [ {id, def_id, pos, rot, on}, … ], copiedAt } */
export function readClip() {
  try {
    const clip = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(clip?.props) ? clip : null;
  } catch { return null; }                 // private mode, or something stale
}

export function writeClip(clip) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...clip, copiedAt: Date.now() })); }
  catch { /* private mode — the copy just does not persist */ }
  return clip;
}

export function clearClip() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/* What the paste button should say it will do. Kept here so the wording and the
   thing being described cannot drift apart. */
export function clipSummary(clip) {
  if (!clip) return null;
  const n = clip.props.length;
  return `${n} prop${n === 1 ? '' : 's'} from “${clip.label}”`;
}
