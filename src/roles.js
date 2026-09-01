/* Role views — one model, three visibility baselines (SPEC §6).
   Everything is visible unless listed in hide; show forces a part on. */
export const ROLES = {
  all:      { label: 'All',      hide: ['grid', 'dimensions'] },
  content:  { label: 'Content',  hide: ['grid', 'dimensions', 'props', 'lighting', 'coffer'], keepout: true },
  props:    { label: 'Props',    hide: ['grid', 'lighting', 'coffer'], show: ['dimensions', 'props'] },
  lighting: { label: 'Lighting', hide: ['grid', 'dimensions', 'props'], show: ['lighting', 'coffer'] }
};

/* Resolve final visibility for a part key given role + user overrides.
   userHide/userShow are Sets from the URL and the toggle panel. */
export function partVisible(key, role, userHide, userShow) {
  const r = ROLES[role] ?? ROLES.all;
  let vis = !(r.hide ?? []).includes(key);
  if ((r.show ?? []).includes(key)) vis = true;
  if (userShow.has(key)) vis = true;
  if (userHide.has(key)) vis = false;
  return vis;
}
