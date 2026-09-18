-- haveli-previz — show database
--
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: every statement is guarded.
--
-- Two halves:
--   acts / scenes / cues     the last ACCEPTED snapshot of the Google Sheet
--                            tracker. Replaced wholesale when you press Pull
--                            and apply the diff. Never written back to Sheets.
--   prop_defs / stage_states what we author in the app. Never touched by a pull.
--
-- The split matters: deleting a row in the sheet must not destroy staging work,
-- so stage_states.ref_id is deliberately NOT a foreign key. An orphaned state
-- survives and is flagged in the UI instead of cascading away.

-- ── programme (pulled from the sheet) ──────────────────────────────────────

create table if not exists acts (
  id    text primary key,          -- slug of the ACT cell
  name  text not null,
  sort  int  not null
);

create table if not exists scenes (
  id      text primary key,        -- slug(act + code + scene name); the sheet's
  act_id  text not null references acts(id) on delete cascade,
  code    text,                    -- "A1S2" — NOT unique, "VO" appears twice
  name    text,
  sort    int not null
);

create table if not exists cues (
  id            text primary key,
  scene_id      text not null references scenes(id) on delete cascade,
  item          text,
  type          text,              -- Musical | MSM Live | Gun Grahan | Jingle | …
  type_detail   text,              -- the headerless column right of TYPE ("Talking")
  live_prerec   text,              -- LIVE | PREREC | VO BLACKOUT
  presenter     text,
  final_status  text,              -- NEEDS WORK | IN PROG
  start_time    text,              -- clock time from the sheet, e.g. "19:04:00"
  end_time      text,
  duration      text,              -- the sheet's Allocation column, e.g. "00:55"
  sr_prop       text,              -- free text, straight from the sheet
  sl_prop       text,
  centre_prop   text,
  canopy        text,
  led_item      text,              -- joined from the LED tracker tab on Item Name
  led_meta      jsonb,             -- that tab's row: audio/image/video/led flags, status, owner
  sort          int not null
);

-- Added after the first release, so existing databases need these too.
-- create table if not exists does nothing to a table that already exists.
alter table cues add column if not exists start_time text;
alter table cues add column if not exists end_time   text;
alter table cues add column if not exists duration   text;
alter table cues add column if not exists type_detail text;
alter table cues add column if not exists led_meta   jsonb;

create index if not exists cues_scene_idx  on cues (scene_id);
create index if not exists scenes_act_idx  on scenes (act_id);

-- ── authored in the app ────────────────────────────────────────────────────

create table if not exists prop_defs (
  id          text primary key,    -- "def_pizza_counter"
  name        text not null,
  confidence  text,                -- measured | stated | approx | est
  material    text,
  parts       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Remembers a manual match from sheet prop text to a definition, so
-- "SINK VANITY AREA" only has to be resolved by a human once.
create table if not exists prop_aliases (
  alias   text primary key,        -- normalised: lowercased, punctuation stripped
  def_id  text not null references prop_defs(id) on delete cascade
);

-- One row per authorable stage.
--   scope 'scene'    → base holds the set; patch unused
--   scope 'cue'      → patch holds per-placement overrides; base unused
--   scope 'home'     → the hall as it will be built, incl. proposed lighting
--   scope 'sandbox'  → free scratch stage
--
-- base  {"props":[{id,def_id,pos,rot,on}, …], "lighting":{id:{on,intensity,…}}, "led":null}
-- patch {"props":{placement_id:{op:'move'|'remove'|'add', …}}, "lighting":{…}, "led":null}
create table if not exists stage_states (
  id          text primary key,    -- 'scene:<id>' | 'cue:<id>' | 'home' | 'sandbox'
  scope       text not null check (scope in ('scene', 'cue', 'home', 'sandbox')),
  ref_id      text,                -- scene/cue id; null for home and sandbox
  base        jsonb not null default '{"props":[],"lighting":{},"led":null}'::jsonb,
  patch       jsonb not null default '{"props":{},"lighting":{},"led":null}'::jsonb,
  prop_digest text,                -- sheet prop text when last staged; drives the
                                   -- "sheet changed since you staged this" badge
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create index if not exists stage_states_ref_idx on stage_states (scope, ref_id);

-- Append-only history. Every save writes the PREVIOUS value here first, so any
-- change is recoverable — the mitigation for a shared editor login having no
-- per-person audit trail.
create table if not exists stage_state_versions (
  id        bigserial primary key,
  state_id  text not null,
  base      jsonb,
  patch     jsonb,
  saved_at  timestamptz not null default now(),
  saved_by  text
);

create index if not exists versions_state_idx on stage_state_versions (state_id, saved_at desc);

-- What a fresh pull is diffed against.
create table if not exists sheet_snapshots (
  id          bigserial primary key,
  pulled_at   timestamptz not null default now(),
  applied_by  text,
  rows        jsonb not null       -- the parsed {acts, scenes, cues} at apply time
);

-- ── row-level security ─────────────────────────────────────────────────────
--
-- Anyone with a link reads. Only the shared editor login writes. This is what
-- protects the data — the anon key in data/supabase.json is not a secret and is
-- committed deliberately.

do $$
declare t text;
begin
  foreach t in array array[
    'acts', 'scenes', 'cues', 'prop_defs', 'prop_aliases',
    'stage_states', 'stage_state_versions', 'sheet_snapshots'
  ] loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists "public read" on %I', t);
    execute format(
      'create policy "public read" on %I for select to anon, authenticated using (true)', t);

    execute format('drop policy if exists "editors write" on %I', t);
    execute format(
      'create policy "editors write" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ── the editor login ───────────────────────────────────────────────────────
--
-- Create this in the dashboard, not here: Authentication → Users → Add user.
-- Use any address you control (e.g. editor@yourdomain) and tick "Auto Confirm
-- User" so no email round-trip is needed. That address and password are what
-- the app's Edit button asks for. Do not commit the password.
--
-- Then turn OFF public sign-ups so the login cannot be self-served:
-- Authentication → Sign In / Providers → Email → disable "Allow new users to
-- sign up".
