/* Prop data model — Vectorworks split: DEFINITIONS are reusable parametric
   symbols, INSTANCES are one definition placed on the stage (SPEC §6).

   definition = { id, name, confidence, material, parts: [part] }
   part       = { shape, size, offset:[x,y,z], rot, color, file? }
                 shape ∈ box | cylinder | wedge | plane | mesh
                 size  — box/wedge [w,h,d] · cylinder [dia,h] · plane [w,h]
                 offset is metres from the instance origin; y is up from the
                 base the instance sits on; rot is degrees about Y
   instance   = { id, def, name?, pos:[x,z], rot, on, scenes:[], enabled }
                 on ∈ forestage | stage | cabin | floor — resolves base height

   Everything here is pure so the plan-view maths and the migration can be
   unit-tested without a browser. */

export const SHAPES = ['box', 'cylinder', 'wedge', 'plane', 'mesh'];
export const SURFACES = ['forestage', 'stage', 'cabin', 'floor'];
export const CONFIDENCE = ['measured', 'stated', 'approx', 'est'];

export const SURFACE_LABEL = {
  forestage: 'Performance stage', stage: 'Main stage', cabin: 'Cabin floor', floor: 'Hall floor'
};

let seq = 0;
export const uid = prefix =>
  `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* ── defaults ─────────────────────────────────────────────────────────── */

export function newPart(shape = 'box') {
  const base = { shape, offset: [0, 0, 0], rot: 0, color: 'prop' };
  if (shape === 'cylinder') return { ...base, size: [0.9, 0.75] };
  if (shape === 'plane')    return { ...base, size: [2.44, 1.22], file: null };
  if (shape === 'mesh')     return { ...base, size: [1, 1.5, 1], file: null };
  return { ...base, size: [1.0, 0.9, 0.6] };            // box, wedge
}

export function newDefinition(name = 'New prop') {
  return { id: uid('def'), name, confidence: 'est', material: '', parts: [newPart('box')] };
}

export function newInstance(defId, pos = [0, 2.0]) {
  return { id: uid('i'), def: defId, pos: [...pos], rot: 0, on: 'forestage', scenes: [], enabled: true };
}

/* ── normalisation / legacy migration ─────────────────────────────────── */

/* Accepts either the current shape ({definitions, instances}) or the original
   flat one ({props:[{type, shape, size, ...}]}) and always returns the current
   shape. Old props become one definition + one instance each, ids preserved so
   scene assignments and links keep working. */
export function normalizeProps(raw) {
  if (!raw || typeof raw !== 'object') return { definitions: [], instances: [] };

  if (Array.isArray(raw.definitions) || Array.isArray(raw.instances)) {
    return {
      definitions: (raw.definitions ?? []).map(normalizeDefinition),
      instances: (raw.instances ?? []).map(normalizeInstance)
    };
  }

  if (Array.isArray(raw.props)) {
    const definitions = [], instances = [];
    for (const p of raw.props) {
      const defId = `${p.id ?? uid('def')}__def`;
      definitions.push(normalizeDefinition({
        id: defId,
        name: p.name ?? p.id ?? 'Prop',
        confidence: p.confidence ?? 'est',
        material: p.material ?? '',
        parts: [legacyPart(p)]
      }));
      instances.push(normalizeInstance({
        id: p.id ?? uid('i'), def: defId, name: p.name,
        pos: p.pos ?? [0, 2], rot: p.rot ?? 0, on: p.on ?? 'forestage',
        scenes: p.scenes ?? [], enabled: p.enabled ?? true
      }));
    }
    return { definitions, instances };
  }

  return { definitions: [], instances: [] };
}

function legacyPart(p) {
  if (p.type === 'image') return { ...newPart('plane'), size: p.size ?? [2.44, 1.22], file: p.file ?? null };
  if (p.type === 'mesh')  return { ...newPart('mesh'), file: p.file ?? null };
  if (p.shape === 'cylinder') return { ...newPart('cylinder'), size: p.size ?? [0.9, 0.75] };
  return { ...newPart('box'), size: p.size ?? [1, 0.9, 0.6] };
}

function normalizeDefinition(d) {
  return {
    id: d.id ?? uid('def'),
    name: d.name ?? 'Prop',
    confidence: CONFIDENCE.includes(d.confidence) ? d.confidence : 'est',
    material: d.material ?? '',
    parts: (d.parts?.length ? d.parts : [newPart('box')]).map(normalizePart)
  };
}

function normalizePart(p) {
  const shape = SHAPES.includes(p.shape) ? p.shape : 'box';
  const def = newPart(shape);
  return {
    shape,
    size: Array.isArray(p.size) ? p.size.map(Number) : def.size,
    offset: Array.isArray(p.offset) ? p.offset.map(Number) : [0, 0, 0],
    rot: Number(p.rot) || 0,
    color: p.color ?? 'prop',
    ...(shape === 'plane' || shape === 'mesh' ? { file: p.file ?? null } : {})
  };
}

function normalizeInstance(i) {
  return {
    id: i.id ?? uid('i'),
    def: i.def,
    ...(i.name ? { name: i.name } : {}),
    pos: Array.isArray(i.pos) ? [Number(i.pos[0]) || 0, Number(i.pos[1]) || 0] : [0, 2],
    rot: Number(i.rot) || 0,
    on: SURFACES.includes(i.on) ? i.on : 'forestage',
    scenes: Array.isArray(i.scenes) ? i.scenes.filter(Boolean) : [],
    enabled: i.enabled !== false
  };
}

/* Serialise back to a data/props.json payload — stable key order, keeps the
   docs block so the committed file stays self-describing. */
export function serializeProps({ definitions, instances }, docs) {
  return {
    _docs: docs ?? DEFAULT_DOCS,
    definitions: definitions.map(d => ({
      id: d.id, name: d.name, confidence: d.confidence, material: d.material,
      parts: d.parts.map(p => ({
        shape: p.shape, size: p.size, offset: p.offset, rot: p.rot, color: p.color,
        ...(p.file != null ? { file: p.file } : {})
      }))
    })),
    instances: instances.map(i => ({
      id: i.id, def: i.def, ...(i.name ? { name: i.name } : {}),
      pos: i.pos, rot: i.rot, on: i.on, scenes: i.scenes, enabled: i.enabled
    }))
  };
}

export const DEFAULT_DOCS = {
  model: 'definitions = reusable parametric props (Vectorworks symbols) · instances = a definition placed on the stage',
  part: 'shape box|cylinder|wedge|plane|mesh · size box/wedge [w,h,d], cylinder [dia,h], plane [w,h] · offset [x,y,z] m from the instance origin · rot deg about Y · color palette key or #hex',
  instance: 'pos [x,z] m in venue coordinates · rot deg about Y · on forestage|stage|cabin|floor resolves the base height · scenes [] = all scenes',
  confidence: 'measured | stated | approx | est — approx/est props render with a hatched amber wireframe',
  edit: 'Open ?edit=1 for the Prop workshop. Local edits autosave to this browser; Download props.json and commit to publish to the team links.'
};

export const lookupDef = (doc, id) => doc.definitions.find(d => d.id === id) ?? null;
