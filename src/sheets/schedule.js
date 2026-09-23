/* Clock times for the running order, added up from the tracker's Allocation
   column.

   The sheet used to carry Start Time and End Time as formulas, each row chained
   off the one before. That chain broke — one bad reference turned every time
   from Act 3 onwards into #REF!, and two rows in Act 2 ended before they
   started — and the master tracker now keeps only the allocations. So the
   adding up happens here instead: the first row with an allocation starts at
   the show's start time, and every row after it starts when the one before
   ends. The sheet's own Start and End columns are ignored.

   Rows above the first allocation are pre-show and get no time. A row after it
   with no allocation counts as zero length and is flagged, so a missing figure
   shows up on the page rather than quietly making the show shorter.

   Pure — tested in test/schedule.test.js. */

const HMS = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/* "01:30" → 90. Allocations are minutes:seconds; a third part means
   hours:minutes:seconds. Anything else, "#REF!" included, is null. */
export function allocationSeconds(text) {
  const m = HMS.exec(String(text ?? '').trim());
  if (!m) return null;
  return m[3] === undefined
    ? Number(m[1]) * 60 + Number(m[2])
    : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/* "19:00" or "19:00:00" → seconds since midnight. */
function clockSeconds(text) {
  const m = HMS.exec(String(text ?? '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
}

/* Seconds since midnight → "19:04:00", the shape the sheet used to write. */
const clock = s => [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
  .map(n => String(n).padStart(2, '0')).join(':');

/* Cues in running order → new cues with start_time and end_time replaced by
   the added-up times, and `no_allocation` set on any row counted as zero.
   Without a usable start time the times are cleared, not guessed. */
export function scheduleFromAllocations(cues, startsAt) {
  let at = clockSeconds(startsAt);
  let started = false;
  return cues.map(cue => {
    const out = { ...cue, start_time: '', end_time: '' };
    const len = allocationSeconds(cue.duration);
    if (at == null || (!started && len == null)) return out;
    started = true;
    out.start_time = clock(at);
    at += len ?? 0;
    out.end_time = clock(at);
    if (len == null) out.no_allocation = true;
    return out;
  });
}
