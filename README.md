# Haveli Previz

Web previz of the haveli assembly-hall stage for briefing three external
teams — LED content, prop builder, lighting. Read `SPEC.md` before touching
code; it settles most arguments.

## Run it locally

```sh
./dev.sh          # → http://localhost:5173  (fetch() needs HTTP, not file://)
```

## Deploy (Vercel)

Static folder, no build step:

```sh
npx vercel --prod         # already linked; login as support@wearemedula.com
```

Live at **https://haveli-previz.vercel.app** (Vercel Authentication is disabled
on the project so external teams need no login; `vercel.json` pins the output
directory to the repo root — without it Vercel serves only `public/`).

## The three team links

After deploying, send each team a link that opens on their view — for example:

| Team | Link |
|---|---|
| LED content | `https://haveli-previz.vercel.app/?role=content&scene=s01&cam=seated-mid&keepout=1` |
| Prop builder | `https://haveli-previz.vercel.app/?role=props&scene=s03&cam=three-quarter` |
| Lighting | `https://haveli-previz.vercel.app/?role=lighting&cam=section` |

Or open the app, set up any view, and use **Copy link to this exact view** —
the URL carries scene, role, camera, fit mode, video time, everything.

## Show mode

`?mode=show` renders the venue as on the day: house dark, every fixture a real
spotlight with shadows, the LED wall lighting the stage with its own content
colour (sampled live). `haze=0..1` previews atmosphere (volumetric beams);
`house=0..1` sets the venue's own light level (default 0.06). All three ride
shared links; the panel's Show mode group has the switch and sliders.

## Cue sheet + LED plan

`cuesheet.html` and `ledplan.html` render the show script; both read ONE feed
(`src/cues.js`). Until the real sheet is connected they show the bundled sample
(`data/cues.csv`) and say SAMPLE DATA.

**Connect the real sheet** (owner, once):
1. Build the sheet with these headers (any order):
   `cue,section,phase,start,dur,item,type,presenters,audio,scene,led,props,lighting,notes`
   — `start` "17:00" (blank = follows previous cue), `dur` "5m"/"30s"/"7m30s",
   `scene` = an id from `data/scenes.json`, `phase` ∈ PRE-MSM / MSM ENTRY / MSM / NO-MSM.
2. File → Share → Publish to web → CSV, paste that link into `cueSheetCsvUrl`
   in `data/show.json` (and the normal edit link into `cueSheetEditUrl`).
3. Redeploy once. After that, edits in the sheet appear on refresh — no deploys.

The LED plan cross-references `data/scenes.json`: a cue's scene with a real
`led` file shows FILE LIVE; a file named only on the sheet shows PLANNED;
nothing planned shows PATTERN. Scene chips deep-link into the previz.

## Editing the model

- All dimensions live in `data/*.json`. Every value carries a confidence flag
  (`measured / approx / est / stated`); estimates render amber with ⚠.
- Quick edits: open `?edit=1`, nudge a field or edit the JSON, **Apply** to see
  it, **Download JSON** → replace the file in `data/` → commit.
- Show content: drop MP4s in `public/content/`, reference by filename in
  `data/scenes.json`. `"led": null` shows the test pattern.

## Exports (buttons in the sheet)

- **Keep-out map** — 10240 × 1920 PNG for the content team: cabin block,
  curtain bleed, performer band, front-seat worst case.
- **Elevations** — dimensioned front / plan / section PNG for the prop builder.
- **Screenshot** — current view with a labelled header.

## Tests

```sh
node --test       # occlusion + lighting maths vs the numbers in SPEC §5
```

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
data/                 venue / scenes / props / lighting JSON — the model
src/model.js          flatten {v,c,note} → values + confidence map; derived dims
src/occlusion.js      pure keep-out maths (tested)
src/lightmath.js      pure spill / glare / cone maths (tested)
src/video.js          LED canvas compositor: MP4 or test pattern, fit modes
src/build/            geometry builders — venue, props, lighting
src/ui/               sheet panel, transport bar, ?edit=1 editor
src/exports/          keep-out PNG, elevations PNG, screenshot
legacy/               the original single-file prototype, for reference
```
