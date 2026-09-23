/* Sheet prop text → modelled definitions.

   The tracker's prop columns are free text written for humans: "BED, CHAIR",
   "SINK VANITY AREA", "Toothbrush (hand-sized)", "Tables (x12)", "NA". We match
   what we can and show the rest as "not modelled" rather than guessing — the
   brief was explicit that nothing should be silently dropped, because a prop
   that quietly vanishes is worse than one visibly flagged.

   Matching is deliberately conservative. A wrong auto-match puts the wrong
   object on stage and nobody notices; an unmatched entry is visible and takes
   one click to resolve, and that resolution is remembered in prop_aliases so
   each piece of odd phrasing is only ever read by a human once. */

/* Placeholders the sheet uses for "nothing here". Anything else unmatched is a
   real prop we have not modelled yet, and must stay visible. */
const NOTHING = new Set(['na', 'n/a', '-', '--', 'none', 'nil', 'x']);

export const normaliseAlias = s => String(s ?? '')
  .toLowerCase()
  .replace(/\(.*?\)/g, ' ')          // drop parentheticals: "(wheels)", "(x12)"
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/* Split one cell into individual props. Commas and newlines separate; slashes
   do NOT — "Sink/mirror" and "Mirror / Whiteboard" are single props in this
   sheet, and splitting them produces two things nobody asked for. */
export function splitPropText(text) {
  return String(text ?? '')
    .split(/[,\n;]+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(s => !NOTHING.has(s.toLowerCase()));
}

/* "Tables (x12)" → 12. Absent → 1. */
export function quantityOf(raw) {
  const m = /\(\s*x\s*(\d+)\s*\)|\bx\s*(\d+)\b/i.exec(String(raw ?? ''));
  const n = m ? Number(m[1] ?? m[2]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/* The four prop columns of one cue, resolved against the definition library.

   Returns one entry per listed prop:
     { raw, norm, area, qty, def }   def is null when not modelled yet. */
export function matchCueProps(cue, defs = [], aliases = new Map()) {
  const byNorm = new Map();
  for (const d of defs) {
    const k = normaliseAlias(d.name);
    if (k && !byNorm.has(k)) byNorm.set(k, d);
  }
  const byId = new Map(defs.map(d => [d.id, d]));

  const AREAS = [
    ['sr', 'Stage right', cue.sr_prop],
    ['sl', 'Stage left', cue.sl_prop],
    ['centre', 'Centre', cue.centre_prop],
    ['canopy', 'Canopy', cue.canopy]
  ];

  const out = [];
  for (const [area, areaLabel, cell] of AREAS) {
    for (const raw of splitPropText(cell)) {
      const norm = normaliseAlias(raw);
      const def = byNorm.get(norm) ?? byId.get(aliases.get(norm)) ?? null;
      out.push({ raw, norm, area, areaLabel, qty: quantityOf(raw), def });
    }
  }
  return out;
}

export const matchedCount = list => list.filter(p => p.def).length;
export const unmatched = list => list.filter(p => !p.def);

/* Every distinct unmatched phrase across the show, most-used first — the
   worklist for "what still needs modelling". Doing it once across all cues
   beats discovering the same missing prop 12 times while staging. */
export function modellingBacklog(cues, defs, aliases) {
  const tally = new Map();
  for (const cue of cues) {
    for (const p of unmatched(matchCueProps(cue, defs, aliases))) {
      const e = tally.get(p.norm) ?? { norm: p.norm, raw: p.raw, count: 0, cues: [] };
      e.count++;
      if (e.cues.length < 8) e.cues.push(cue.id);
      tally.set(p.norm, e);
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
}
