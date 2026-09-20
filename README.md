# Haveli Previz

Web previz of the haveli assembly-hall stage for briefing three external
teams — LED content, prop builder, lighting. Read `SPEC.md` before touching
code; it settles most arguments.

## Run it locally

`./dev.sh` serves with caching disabled. `python3 -m http.server` sends no cache
headers at all, so browsers hold on to ES modules indefinitely — you edit a file,
reload, and silently get the old code back.

```sh
./dev.sh          # → http://localhost:5173  (fetch() needs HTTP, not file://)
```

## Deploy (Vercel)

Static folder, no build step:

```sh
git push                  # auto-deploys: the Vercel project is connected to GitHub
npx vercel --prod         # manual fallback; login as support@wearemedula.com
```

Live at **https://haveli-previz.vercel.app** (Vercel Authentication is disabled
on the project so external teams need no login; `vercel.json` pins the output
directory to the repo root — without it Vercel serves only `public/`).

## The three team links

After deploying, send each team a link that opens on their view — for example:

| Team | Link |
|---|---|
| LED content | `https://haveli-previz.vercel.app/?role=content&cam=seated-mid&keepout=1` |
| Prop builder | `https://haveli-previz.vercel.app/?role=props&cam=three-quarter` |
| Lighting | `https://haveli-previz.vercel.app/?role=lighting&cam=section` |

Add `&at=cue:<id>` (or `at=act:<id>`, `at=scene:<id>`, `at=home`,
`at=sandbox`) to land on a particular stage. Or open the app, set up any view, and use **Copy link to this
exact view** — the URL carries the stage, role, camera, fit mode, video time,
everything. These links are read-only: editing needs the shared login, so it is
safe to send them out.

## Staging: act, scene, sub-state

The programme tree is three levels deep and every one of them is a place you
can stand and dress:

| Level | What it holds | Who sees it |
|---|---|---|
| **Act set** | the set the whole act plays on | every scene and sub-state under it |
| **Scene** | what this scene changes about the act's set | every sub-state under it |
| **Sub-state** | what this row changes about its scene | that row alone |

Each level below the act stores only what it **changed**, per prop. Move the
bed in one scene and that scene pins the bed; everything it did not touch keeps
following the act, so re-dressing the act still reaches the whole thing. The
panel says which you are looking at — `INHERITS` or `OWN CHANGES` — and
**Clear this stage** drops a level's changes and puts it back on what it
inherits.

Scenes dressed before acts had sets are read as though they had always been
patches, so nothing needs migrating and nothing moves on screen.

## Rapid iteration

**Trial backdrops** — drag any image or video onto the stage page (or panel →
Trial backdrops → Add) and it plays on the wall instantly, with the keep-out
overlay and upscale readout applied. Trials are stored in your browser
(IndexedDB), survive reloads, and never leave the machine — shared links keep
showing hosted content, so promote keepers to public/content/ + scenes.json.

**Saved views** — frame a shot, panel → Views → Save this view, name it. Saved
views live in your browser; to hand one to someone, apply it and Copy link
(the URL carries the exact camera).

**Labels** — panel → Elements has separate switches for **Fixture labels** and
**Prop labels**, because they are wanted at different moments: prop names while
you are staging, fixture names while you are plotting, neither while you are
looking at the set. Both ride the link (`&labels=0`, `&plabels=0`) and both
disappear in show mode.

## Show mode

`?mode=show` renders the venue as on the day: house dark, every fixture a real
spotlight with shadows, the LED wall lighting the stage with its own content
colour (sampled live). `haze=0..1` previews atmosphere (volumetric beams);
`house=0..1` sets the venue's own light level (default 0.06). All three ride
shared links; the panel's Show mode group has the switch and sliders.

## The show database (Supabase)

Authored state — prop definitions, what is placed on each stage, lighting
states, LED assignments — lives in Supabase rather than in committed JSON, so a
change reaches everyone in seconds instead of after a commit and a Vercel
rebuild. It is called straight from the browser: no `package.json`, no build
step, no Vercel integration, and the two services are never linked.

**Set up (once):**
1. Create a project at supabase.com (free tier is plenty).
2. SQL Editor → paste `sql/schema.sql` → Run.
3. Authentication → Users → Add user. Tick **Auto Confirm User**. That address
   and password are the shared editor login. Then Sign In / Providers → Email →
   turn OFF "Allow new users to sign up".
4. Settings → API → paste the Project URL and the **anon** key into
   `data/supabase.json`.

The anon key is committed deliberately — it is not a secret. Row-level security
is what protects the data: anyone may read, only a signed-in editor may write.
The password is never stored in this repo.

With the fields blank the app still runs, read-only, off the committed JSON.

## Pulling the programme

The show's running order lives in a Google Sheets tracker and the app is
**read-only** to it — the sheet is the production team's working document, and
nothing here writes back, not even its empty "Stage State" column. That also
means no credentials: a link-shared sheet exports CSV to anyone.

Press **Pull from sheet** in the stage panel. It fetches the tracker, diffs it
against what was last accepted, and shows exactly what changed before anything
is applied. Pull is manual by design — a background poll could reshuffle the
running order mid-rehearsal.

Applying replaces acts/scenes/sub-states only. Authored stage states are never
touched: a row deleted from the sheet leaves its staging orphaned and flagged,
never deleted.

Sheet ids live in `data/show.json`. The parser handles the tracker's two header
rows, its fill-down ACT and `#` columns, and the fact that `#` codes are not
unique (`VO` appears in two different acts).

## Cue sheet + LED plan

`cuesheet.html` is also the **show-day view**: click any row to see the props it
needs by stage area, the lighting state, the LED content and a way into the 3D
stage. There is deliberately no clock and no countdown — things get cut on the
day, and a wrong time on screen is worse than no time.

Its rough timings are added up from the tracker's **Allocation** column,
starting at `startsAt` in `data/show.json` (19:00): each row starts when the one
before it ends. The tracker's own Start/End Time columns are ignored — they were
formulas doing the same sum, and they broke. A row with no allocation counts as
zero and is marked `?`.

`ledplan.html` cross-references three sources: the content team's LED tracker
tab, the programme, and what has actually been assigned in the previz. FILE
ASSIGNED means a file is on that stage; PLANNED means the content tracker lists
it but nothing is assigned yet; PATTERN means neither.

## Editing the model

- All dimensions live in `data/*.json`. Every value carries a confidence flag
  (`measured / approx / est / stated`); estimates render amber with ⚠.
- Quick edits: open `?edit=1`, nudge a field or edit the JSON, **Apply** to see
  it, **Download JSON** → replace the file in `data/` → commit.
- Show content: drop MP4s in `public/content/`, reference by filename in
  `data/scenes.json`. `"led": null` shows the test pattern.

## Prop workshop (`?edit=1`)

Build props like CAD symbols, then place them on the stage.

- **Definitions** are reusable parametric props — an assembly of parts (`box`,
  `cylinder`, `wedge`, `plane`/image, glTF `mesh`), each with size, offset and
  rotation. Set a confidence flag; `est`/`approx` props carry an amber wireframe.
- **Place** a definition from the Library — it drops an instance on the stage.
- **2D plan view** (left panel): drag instances, grid-snap (0.1–1 m toggle),
  drag the corner grip to rotate (15° snap, hold Alt for free). Scroll to zoom,
  shift-drag to pan. Instances are also click-selectable in the 3D view.
- The selected placement has numeric X / Z / rotation, the surface it sits on,
  and per-scene visibility.
- Edits **autosave to this browser** (like saved views). **Download props.json**
  → replace `data/props.json` → commit to publish to the team links. **Reset to
  committed** discards local work. `data/props.json` still accepts the old flat
  `props: []` shape — it is migrated on load.

## Exports (buttons in the sheet)

- **Keep-out map** — 10240 × 1920 PNG for the content team: cabin block,
  curtain bleed, performer band, front-seat worst case.
- **Elevations** — dimensioned front / plan / section PNG for the prop builder.
- **Screenshot** — current view with a labelled header.

## Tests

```sh
node --test       # all pure logic: sheet parsing, diff, stage inheritance,
                  # prop matching, occlusion + lighting maths (SPEC §5)
```

`test/tracker.test.js` covers the tracker's real traps — fill-down columns,
duplicate `#` codes, the headerless ITEM column. `test/stagestate.test.js`
covers act→scene→sub-state inheritance, including the fixed point that opening
a level and saving it must NOT pin every prop, and that a scene stored the old
way — a full set in `base` rather than a patch — still reads as itself.

## Still unconfirmed (SPEC §10) — measure before trusting

1. **Ceiling coffer spacing + soffit height** — lighting positions are on an
   estimated 3.0 m grid until this is taped.
2. The 200 mm step between main and performance stage.
3. Cabin height (read as 3645 mm + 20 mm ply).
4. LED base height above deck (read as "raised a foot").
5. Curtain drop (estimated 6.80 m).
6. Stair riser count (5 over 1.30 m is steep for children in costume).
7. Access onto the performance stage from the hall floor.

The viewer lists these in the sheet under **Unconfirmed**, generated from the
confidence flags in `data/venue.json`.

## Layout

```
index.html            viewer shell + importmap (three 0.180.0, no build step)
sql/schema.sql        the show database — tables + row-level security
data/venue.json       the venue model: every dimension with a confidence flag
data/lighting.json    fixtures, including the whole requested rig (all est)
data/props.json       seed prop definitions for a fresh database
data/show.json        which sheet + tab to pull from
data/supabase.json    project URL + anon key (safe to commit; RLS protects)
src/model.js          flatten {v,c,note} → values + confidence map; derived dims
src/stagestate.js     act sets + scene and sub-state patches, copy-on-write (tested)
src/propmatch.js      sheet prop text → modelled definitions (tested)
src/sheets/           tracker parser, LED tracker join, diff (all tested)
src/data/             Supabase client + show database reads and writes
src/auth.js           the shared editor login
src/occlusion.js      pure keep-out maths (tested)
src/lightmath.js      pure spill / glare / cone maths (tested)
src/video.js          LED canvas compositor: MP4 or test pattern, fit modes
src/build/            geometry builders — venue, props (defs + instances), lighting
src/props/            prop workshop: schema + migration, database store,
                      plan-view geometry (tested), 2D plan canvas, authoring UI
src/ui/               sheet panel, programme tree, pull/review, transport bar
src/exports/          keep-out PNG, elevations PNG, screenshot
legacy/               the original single-file prototype, for reference

data/scenes.json and data/cues.csv are no longer read by the app — they are
fixtures for the older cue-parsing tests. The programme comes from the tracker.
```
