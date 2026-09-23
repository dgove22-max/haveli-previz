/* The programme tracker — the sheet that drives everything.

   Read-only, always. The tracker is the production team's working document and
   the app must never write to it, which is also why this needs no credentials:
   a published sheet exports CSV to anyone with the link.

   Three things about this sheet that will bite anyone editing this file:

   1. TWO header rows. The first is a merged group banner (TIME / PROGRAM /
      TRACKERS / Backstage / Lighting State), the second the real column names.
      We locate the header by finding the row containing "ACT" rather than
      assuming an index, because parseCsv drops blank rows and a spacer row
      added above would silently shift a hardcoded offset.

   2. ACT and # FILL DOWN. A blank cell means "same as the row above", not
      "empty". Read them literally and Act 1 appears to contain one scene.

   3. The # codes are NOT unique — "VO" appears twice, in PRO 1 and in ACT 6.
      Ids are therefore slugs of act + code + scene name, never the code alone.

   The ITEM column has no header at all (it sits immediately right of SCENE),
   so that one column is found positionally. Same for the type-detail column
   right of TYPE. Everything else is found by name and survives column moves.

   4. SR/SL props moved to a banner row. The sheet used to carry one
      "SR BIG PROP" / "SL BIG PROP" column each. The production team's rebuild
      split each side into two shelf tiers — Lower SR, Upper SR, Lower SL,
      Upper SL — and the tier names sit in the GROUP banner row above the
      header row, not the header row itself, each followed by its own ON/OFF
      pair. Both shapes are supported: a named "SR BIG PROP" column wins if
      present, otherwise the two tiers' ON values are merged into one string
      so the rest of the app (propmatch, the Needs Staging panel) sees a
      single stage-right prop list same as before. Centre and canopy have no
      equivalent in the new layout and simply come back empty. */

import { parseCsv } from '../cues.js';

export const slug = s => String(s ?? '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export function csvUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/* Parse the tracker into the three-level model. Pure — tested directly. */
export function parseTracker(csvText) {
  const rows = parseCsv(csvText);

  const headerAt = rows.findIndex(r => r.some(c => clean(c).toUpperCase() === 'ACT'));
  if (headerAt < 0) throw new Error('Tracker: no header row containing "ACT" — wrong tab?');
  const head = rows[headerAt].map(clean);

  const at = name => head.findIndex(h => h.toUpperCase() === name.toUpperCase());
  const iAct = at('ACT');
  const iNum = at('#');
  const iScene = at('SCENE');
  const iType = at('TYPE');

  /* Tier banner sits one row above the header row (see note 4 above). Its own
     cell IS the tier's ON column — OFF follows immediately after. */
  const banner = headerAt > 0 ? rows[headerAt - 1].map(clean) : [];
  const bannerAt = name => banner.findIndex(h => h.toUpperCase() === name.toUpperCase());

  const col = {
    act: iAct,
    num: iNum,
    scene: iScene,
    item: iScene + 1,        // headerless, immediately right of SCENE
    type: iType,
    typeDetail: iType + 1,   // headerless, "Talking" / "Action"
    start: at('Start Time'),
    end: at('End Time'),
    duration: at('Allocation'),      // clock-time span for the row, e.g. "01:45"
    live: at('LIVE/PREREC'),
    presenter: at('Presenter'),
    final: at('FINAL'),
    sr: at('SR BIG PROP'),
    sl: at('SL BIG PROP'),
    centre: at('CENTRE PROPS'),
    canopy: at('CANOPY'),
    srLower: bannerAt('Lower SR'),
    srUpper: bannerAt('Upper SR'),
    slLower: bannerAt('Lower SL'),
    slUpper: bannerAt('Upper SL')
  };
  if (iAct < 0 || iScene < 0) throw new Error('Tracker: missing ACT or SCENE column.');

  const acts = [], scenes = [], cues = [];
  const seenAct = new Map();
  const cueIds = new Set();
  let act = null, scene = null, sort = 0;

  for (const raw of rows.slice(headerAt + 1)) {
    const g = i => (i >= 0 ? clean(raw[i]) : '');

    const actCell = g(col.act);
    const numCell = g(col.num);
    const sceneCell = g(col.scene);
    const itemCell = g(col.item);
    const mergeTiers = (lowerIdx, upperIdx) =>
      [g(lowerIdx), g(upperIdx)].filter(Boolean).join(', ');
    const props = {
      sr: col.sr >= 0 ? g(col.sr) : mergeTiers(col.srLower, col.srUpper),
      sl: col.sl >= 0 ? g(col.sl) : mergeTiers(col.slLower, col.slUpper),
      centre: g(col.centre), canopy: g(col.canopy)
    };
    const detail = {
      type: g(col.type),
      typeDetail: g(col.typeDetail),
      live: g(col.live),
      presenter: g(col.presenter),
      final: g(col.final),
      /* Times are sparse — the opening rows carry none at all — so they are
         carried through as written rather than inferred. A blank start means
         the sheet has not scheduled that row, not that it runs at midnight. */
      start: g(col.start),
      end: g(col.end),
      duration: g(col.duration)
    };

    /* ACT fills down. */
    const prevAct = act;
    if (actCell) {
      const id = `act-${slug(actCell)}`;
      if (!seenAct.has(id)) {
        act = { id, name: actCell, sort: acts.length };
        seenAct.set(id, act);
        acts.push(act);
      } else {
        act = seenAct.get(id);
      }
    }
    /* A new act cannot continue the previous act's scene. Without this, a row
       that opens an act but fills neither # nor SCENE — "ACT 7: Aarti" with
       only an item on it — kept the scene pointer from the act before and its
       cue was filed under the wrong act entirely, leaving the new one empty. */
    if (act !== prevAct) scene = null;

    const hasContent = numCell || sceneCell || itemCell ||
      detail.type || detail.live || detail.presenter || detail.start ||
      props.sr || props.sl || props.centre || props.canopy;
    if (!hasContent) continue;          // spacer / totals row

    if (!act) {                          // content before any ACT cell
      act = { id: 'act-unassigned', name: 'Unassigned', sort: acts.length };
      seenAct.set(act.id, act);
      acts.push(act);
    }

    /* A new scene begins wherever EITHER # or SCENE is filled — and also at the
       start of an act, where there is no scene to continue and the row's own
       item has to name one. Both blank mid-act means another sub-state of the
       scene above. */
    if (numCell || sceneCell || !scene) {
      const name = sceneCell || itemCell || numCell;
      const id = uniq(`${act.id}/${slug(numCell)}${numCell && name ? '-' : ''}${slug(name)}`,
        new Set(scenes.map(s => s.id)));
      scene = { id, act_id: act.id, code: numCell, name, sort: scenes.length };
      scenes.push(scene);
    }
    if (!scene) continue;                // props with no scene yet — nothing to hang them on

    /* The row that opens a scene usually also IS its first sub-state. Where it
       carries no item of its own (A1J "Jingle - Morning Recap"), the scene name
       is the item — otherwise that scene would have nothing to click. */
    const item = itemCell || (numCell || sceneCell ? scene.name : '');
    if (!item) continue;

    cues.push({
      id: uniq(`${scene.id}/${slug(item)}`, cueIds),
      scene_id: scene.id,
      item,
      type: detail.type,
      type_detail: detail.typeDetail,
      live_prerec: detail.live,
      presenter: detail.presenter,
      final_status: detail.final,
      start_time: detail.start,
      end_time: detail.end,
      duration: detail.duration,
      sr_prop: props.sr,
      sl_prop: props.sl,
      centre_prop: props.centre,
      canopy: props.canopy,
      led_item: null,
      sort: sort++
    });
    cueIds.add(cues.at(-1).id);
  }

  return { acts, scenes, cues };
}

/* Ids must survive a re-pull unchanged, so disambiguate by appending an index
   rather than anything derived from position in the file. */
function uniq(base, taken) {
  const root = base || 'row';
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

/* The four prop columns as one string, used to detect "the sheet's props
   changed since you staged this". Order is fixed so it is comparable. */
export const propDigest = cue =>
  [cue.sr_prop, cue.sl_prop, cue.centre_prop, cue.canopy]
    .map(s => clean(s)).join(' | ');

export async function fetchTracker({ sheetId, gid }) {
  const res = await fetch(csvUrl(sheetId, gid), { redirect: 'follow' });
  if (!res.ok) throw new Error(`Tracker fetch failed (${res.status}) — is the sheet shared?`);
  return parseTracker(await res.text());
}
