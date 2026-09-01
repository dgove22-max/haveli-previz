/* URL state — the difference between a tool and a toy (SPEC §3).
   ?scene=s03&role=content&cam=seated-front&hide=figures&show=grid
   &fit=width&t=12.4&res=1&keepout=1&edit=1&cv=r,th,phi,tx,ty,tz */
export function readState() {
  const q = new URLSearchParams(location.search);
  const list = k => (q.get(k) ?? '').split(',').filter(Boolean);
  return {
    scene:   q.get('scene'),
    role:    q.get('role') ?? 'all',
    cam:     q.get('cam'),
    cv:      q.get('cv'),
    hide:    new Set(list('hide')),
    show:    new Set(list('show')),
    fit:     q.get('fit') ?? 'stretch',
    t:       q.has('t') ? Number(q.get('t')) : null,
    res:     q.has('res') ? Number(q.get('res')) : 0,
    keepout: q.get('keepout') === '1' ? true : q.get('keepout') === '0' ? false : null,
    edit:    q.get('edit') === '1'
  };
}

export function writeState(s) {
  const q = new URLSearchParams();
  if (s.scene) q.set('scene', s.scene);
  if (s.role && s.role !== 'all') q.set('role', s.role);
  if (s.cam) q.set('cam', s.cam);
  else if (s.cv) q.set('cv', s.cv);
  if (s.hide.size) q.set('hide', [...s.hide].join(','));
  if (s.show.size) q.set('show', [...s.show].join(','));
  if (s.fit !== 'stretch') q.set('fit', s.fit);
  if (s.t != null && s.t > 0) q.set('t', s.t.toFixed(1));
  if (s.res) q.set('res', String(s.res));
  if (s.keepout != null) q.set('keepout', s.keepout ? '1' : '0');
  if (s.edit) q.set('edit', '1');
  const qs = q.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

export function shareUrl() {
  return location.href;
}
