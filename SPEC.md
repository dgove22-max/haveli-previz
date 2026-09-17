# Haveli Previz — Project Brief

A web-based previsualisation tool for a children's spiritual musical production
in a haveli assembly hall. Its purpose is **briefing three external teams**, not
executing the show. Execution happens in Vectorworks Spotlight and the teams'
own software.

Read this file at the start of every working session before touching code.

---

## 1. Why this exists

Three teams need to be briefed, and each needs a different view of the same
venue model:

| Team | Needs to know | Artefact |
|---|---|---|
| **LED content team** | What is visible on a 25.60 × 4.80 m screen once the cabin and curtains block it | Link filtered to LED, plus a keep-out map in pixel space |
| **Prop builder** | Sizes, positions, and how props read from the audience | Link filtered to set, plus dimensioned elevations |
| **Lighting team** | Available positions, coverage, spill onto the LED, glare on the cabin glass | Link filtered to lighting, plus a position plot |

If a feature does not produce or improve one of those three artefacts, it is out
of scope. This rule settles most arguments.

## 2. Hard constraints

- **Timeline is weeks, not months.** Ship one team per week in priority order:
  LED content → props → lighting → sightlines.
- **One editor group, no per-person accounts.** A single shared login gates
  writing. No permissions model, no conflict resolution. Every save stamps a
  typed-in editor name and keeps the previous value, so changes are traceable
  and reversible without building real accounts.
- **Link-based sharing.** Teams open a read-only URL. They do not install
  anything and do not have the source MP4 files locally.
- **No backend of ours.** Static hosting only (Vercel free tier), no
  `package.json`, no build step — deploying is still copying a folder. Venue
  dimensions stay JSON published with the build. **Amended:** authored show
  state (placements, lighting states, LED assignments) moved to Supabase,
  called directly from the browser. See §3.

## 3. Architecture decisions

**Keep the single-file three.js approach.** Do not rewrite into React or Vite
during the delivery window — it costs a week and buys nothing the teams can see.
Split into ES modules with an importmap and no build step, so deploying is
copying a folder. Migrate later only if maintenance actually hurts.

**Data and renderer stay separate.** All dimensions live in a JSON model. Code
reads it and builds geometry. Never hardcode a dimension in geometry code.

**Authored state lives in Supabase, not in git.** Originally everything was
committed JSON, downloaded from the browser and hand-committed. That cost a
commit plus a Vercel rebuild — 40 to 90 seconds — before anyone else saw a
change, which is unusable when staging 65 sub-states or adjusting during a
rehearsal. Supabase is loaded from the same CDN importmap as three.js, so the
no-build-step rule survives intact and Vercel needs no changes or linking.

The anon key is committed on purpose: it is not a secret, and row-level security
is the actual protection — anyone may read, only the signed-in editor may write.
With the key absent the app degrades to read-only off the committed JSON, so a
view link never breaks.

**The Google Sheets tracker is read-only to us.** It is the production team's
working document. The app pulls, diffs and shows changes before applying them,
and never writes back — not even into its empty "Stage State" column. Keeping
it one-way means no credentials (a link-shared sheet exports CSV to anyone) and
no way for a bug here to damage their document.

**State lives in the URL.** This is non-negotiable and is the difference between
a tool and a toy. A link must open on the exact view intended:

```
?scene=s03&role=content&cam=seated-front&hide=lighting,figures
```

If a link opens on a default view, the brief has failed.

**Content is hosted, not dropped.** Viewers cannot drag in files. MP4s live in
`/public/content/` and are referenced by filename in the model JSON. The local
editor keeps drag-and-drop for fast iteration; the published build uses paths.

**Editor UI can be crude — except props.** Numeric fields and a JSON textarea
are fine for the venue, scenes and lighting: nobody but the owner will touch
them. Props are the exception. Getting an accurate set model in front of the
prop builder is the whole point of week 2, and hand-editing nested part
geometry as JSON is too slow to do well, so props get a real authoring surface
(the Prop workshop, `?edit=1`): a parametric definition editor and a 2D plan
with drag-to-place. It stays owner-only and local-first — edits autosave to the
browser and only reach the team links when `props.json` is downloaded and
committed. This is the one deliberate departure from "crude editor".

## 4. Conventions

- **Units: metres throughout.** Convert imperial inputs on entry, store metric.
- **Origin:** centre of the main stage front edge, at hall floor level.
- **Axes:** +X to the ladies side (house right), +Y up, +Z toward the audience.
  Upstage is −Z.
- **Confidence flags:** every dimension carries `"measured"`, `"approx"`,
  `"est"`, or `"stated"`. The UI renders measured values differently from
  estimates. Nobody should make a build decision off a guess without knowing
  it is one.

## 5. Confirmed venue data

Measured on site unless marked otherwise.

### Hall
- 45.0 × 50.0 m (165 × 145 ft), no supporting columns
- Average height 7.6 m, coffered ceiling with existing track spots and pendants
- Stage sits along the 45 m edge
- Audience sits on the carpet — **seated eye height ≈ 1.10 m**, not standing

### Main stage
- Frontage 26.30 m (22.50 m between inner stair corners + 2 × 1.90 m stairs)
- Deck height 1.30 m above hall floor
- Depth stage edge to LED face: 7.20 m
- Stairs at both front corners, 1.90 m wide, climbing straight onto the deck
  facing the audience. 5 risers at 260 mm (steep — confirm riser count)
- Deck runs upstage and widens to full hall width ~0.30 m downstage of the
  curtain line, becoming the raised backstage at the same 1.30 m height

### Performance stage
- 122 × 244 cm deck pieces, laid long edge across, 4 wide × 4 deep = 16 pieces
- Overall 9.76 × 4.88 m (≈ 32 × 16 ft)
- Height 1.10 m — **200 mm below the main stage. Not flush.** Either a
  detail to resolve on site or a measurement to recheck
- Butted to the main stage front edge, no access from the hall floor

### LED
- 25.60 × 4.80 m, **10240 × 1920 px, 2.5 mm pitch** (pitch derived and confirms)
- Face at 7.20 m upstage; base raised ~305 mm above the main stage deck
- Runs the full stage width, ending about ¾ along each stair

### Cabin
- ≈ 7.44 m wide, 5.75 m deep (derived), 3.665 m high
- Centred on the stage
- Front glass 1 ft (305 mm) from the stage front edge
- Back face 1.45 m off the upstage wall
- Floor raised 360 mm above the stage deck
- **Front and both sides are clear single-pane glass.** Solid back wall, roof
  and floor
- Main person seated in an armchair 11 ft (3.353 m) from the stage front edge

### Masking
- 6 ft (1.829 m) partition walls, perpendicular to the stage edge, starting at
  the bottom step at each end of the main stage and running outwards along the
  stage front line, parallel to the curtains, to the haveli side walls
- The floor space behind these partitions is empty
- Curtains hang 3.80 m off the back wall, hem at deck level, running from
  3/5 of the stair width inward out to the side walls

### Occlusion — the numbers that matter to the content team
- **Cabin blocks the centre ≈ 7.44 m of LED** (≈ 29% of width) up to 4.965 m
  height, leaving a ~1.44 m clear band above it
- **Curtains clip ≈ 0.79 m at each end**, which is **≈ 316 px per side**
- Treat the outer ~320 px each side as a bleed zone — texture and colour only,
  nothing meaningful
- A 5'6" performer on the performance stage reaches ~2.78 m, occupying roughly
  the bottom quarter of the canvas from a straight-on seat

## 6. Data model

### Venue
Static geometry, as above. One JSON object. Every element carries dimensions,
position, `notes`, and `confidence`.

### Acts, scenes and sub-states
Superseded the flat 5–12 scene list. The real show is 10 acts, 40 scenes and 65
sub-states, and its structure is dictated by the tracker, so the model mirrors
the tracker exactly: **Act › Scene › Sub-state**.

A **scene** carries the set — the props, the base lighting, the LED file. Its
**sub-states** are the individual rows under it, and each is separately
addressable and editable.

A sub-state stores only what it **changed**, keyed by placement id — never a
copy of the scene:

```json
{
  "props": {
    "bed":     { "op": "move", "pos": [1.2, 0.4], "rot": 15 },
    "dresser": { "op": "remove" },
    "cart_a1": { "op": "add", "def_id": "def_cart", "pos": [0, 1], "on": "forestage" }
  },
  "lighting": { "ps_mh_l": { "on": true, "intensity": 1 } },
  "led": null
}
```

Anything absent resolves live from the scene, so fixing the bed's position once
fixes it everywhere that has not deliberately moved it. Touch a placement and it
pins. Copy-on-write, per prop.

This was the only way to satisfy both halves of the brief at once — "one stage
view per row" and "scenes with sub-states". A full copy per row gives the first
and destroys the second.

Two stages sit outside the programme: `home` (the hall as it will be built,
including the proposed lighting) and `sandbox` (free scratch space).

The invariant to protect: resolving a scene and re-deriving a patch with no
edits must produce an EMPTY patch. Otherwise merely opening a sub-state would
pin every prop and silently break inheritance. Tested in
`test/stagestate.test.js`.

### Props — definitions and instances (the Vectorworks split)
A **definition** is a reusable parametric prop — a "symbol". It is an assembly
of **parts**, each a `box`, `cylinder`, `wedge` (ramp), `plane` (flat / image at
real size), or `mesh` (glTF). A part carries its own size, offset from the prop
origin, rotation, and colour. The definition carries name, material note, and a
confidence flag (est/approx render with an amber wireframe — nobody builds off a
guess without seeing it is one).

An **instance** places one definition on the stage: `pos` `[x, z]`, rotation,
the surface it sits on (`forestage` / `stage` / `cabin` / `floor`, which
resolves the base height), scene assignments, and an enabled flag.

`data/props.json` holds `{ definitions, instances }`. The loader still reads the
original flat `props: []` shape and migrates it, so old files keep working.

The Prop workshop (`?edit=1`) is the authoring tool: a library of definitions, a
part-by-part editor, and a 2D plan view for drag-placement with grid snap and
15° rotation snap. Instances are also click-selectable in the 3D view. Work
autosaves locally; **Download props.json** produces the file to commit.

### Lighting
- Fixture positions constrained to the **ceiling coffer grid** where possible —
  model the coffer spacing as a position grid rather than free 3D placement
- Per fixture: position, pan, tilt, beam angle, colour, intensity
- Two renderings of one rig: plan (schematic cones) and **show mode** (`?mode=show`)
  — dark venue, real spotlights with shadows, LED glow sampled live from the wall
  content, haze and house-level sliders. Visually realistic, still **not**
  photometric — no IES data, no lux claims
- The three questions worth answering: spill washing out the LED, glare and
  reflection on the cabin glass, and whether the cabin blocks front light onto
  the performance stage

### Role views
Steal the Vectorworks classes-and-layers idea. One model, three visibility sets:
`content`, `props`, `lighting`. Encode in the URL. Build this early — it is
cheap and shapes everything after it.

## 7. Build phases

### Phase 1 — content team (week 1)
Modularise the existing file. Scene list. MP4 on the LED with fit modes
(stretch / fit width / fit height / native pixels) and a transport bar with
scrub, play/pause, loop, frame step. Role views. URL state. Deploy.

Fit modes matter: show source resolution, LED resolution, and the scale factor,
so a 1080p file across 25.6 m reads as "5.3× upscale" before it is rendered.

### Phase 2 — prop builder (week 2)
Prop objects, all three types. Keep-out map export: the cabin's blocked region
and the curtain clip drawn on a 10240 × 1920 canvas, exported as PNG. Dimensioned
orthographic elevations — front, plan, side — at a stated scale. Screenshot
export of any camera angle with labels.

### Phase 3 — lighting team (week 3)
Ceiling position grid. Fixture placement, beam cones, colour. Spill check on
the LED. Glare check on the cabin glass.

### Phase 4 — later, or never
Sightline occlusion maths across all seats. Cue-based lighting states. MVR or
GDTF export. Rendering quality. Animation. Show timeline scrubbing.

## 8. Explicitly out of scope

Do not build any of this, however tempting:

DMX patching · power planning · Lightwright integration · rigging load
calculations · audio coverage modelling · manufacturer symbol libraries ·
seating layouts · cloud collaboration · AR/VR · multi-user editing · undo
history beyond a simple state stack · photometric lighting · export to
production software

Every one is either an external team's job or solves a problem this project
does not have. Vectorworks already does them properly.

## 9. Working with Claude in VS Code

- Point Claude at this file at the start of each session. It prevents the slow
  drift where geometry conventions quietly diverge
- Ask for one component per turn. "Build the LED surface that reads from the
  venue JSON" beats "build the app"
- Commit after every phase. 3D work fails in ways that are hard to unpick
- When geometry looks wrong, screenshot the render and paste it in. Far faster
  than describing what is off
- Ask for occlusion maths as a pure function with tests, separate from
  rendering. It is the part most worth trusting

## 10. Open questions

- Ceiling coffer spacing and height to the beam soffits — needed before the
  lighting module
- Whether the 200 mm step between main and performance stage is real
- Confirm cabin height reading (3645 mm + 20 mm ply)
- Confirm LED base height above deck (read as "raised a foot")
- Curtain drop height (currently estimated at 6.80 m to clear the LED top)
- Stair riser count — 5 risers over 1.30 m is steep for children in costume
- Access onto the performance stage from the hall floor
