"use strict";
/* Sightings (docs/theme-spec.md section 17): when each creature kind last came to this screen, and the one event a replay
   may play again. Pure: plain data in, plain data out, no clock, no page and no storage (world.js keeps the state;
   tests/test_roadstead.py runs this file in Node).

   A logbook entry (world.js logLine) is {id, at, kind, text, status, why, ship, play}. Its kind says which creatures it
   brought: a landing rows the longboat home (with dolphins when they came), a release brings the whale, a critical that
   cleared brings the rainbow, and gulls fly off or come back. `play` is what the scene needs to play it again. A replay
   is written to the logbook too, as kind "replay", and is never itself a sighting or replayed. */

const SIGHT_KINDS = ["longboat", "dolphins", "whale", "rainbow", "gulls"];

/* The creature kinds one logbook entry brought (none for a replay, a crew walk or a state). */
function sightKinds(e) {
  if (!e || e.replay) return [];
  if (e.kind === "landing") return ["longboat"];
  if (e.kind === "dolphins") return ["longboat", "dolphins"];
  return e.kind === "whale" || e.kind === "rainbow" || e.kind === "gulls" ? [e.kind] : [];
}

/* The last sighting of each kind once the entry is counted: {kind: {at, id, text, status, why}}. A newer entry wins; the
   same entry again (its status moved on: queued, then shown or said in words) replaces its own record. An event that was
   only said in words still counts, so a missed one stays findable; the record says how it was told. */
function noteSighting(last, e) {
  const out = Object.assign({}, last || {});
  for (const k of sightKinds(e)) {
    const cur = out[k];
    if (cur && cur.id !== e.id && cur.at > e.at) continue;
    out[k] = { at: e.at, id: e.id, text: e.text, status: e.status, why: e.why || null };
  }
  return out;
}

/* The one event a replay plays: the newest real creature event in the logbook (newest first), or null when there is none.
   Only the newest counts; when it cannot be played again as it was (no `play` record, or gulls that no longer stand as
   that flight left them), the answer is null, never an older or a made-up event. gullsNow: {machine: perched}. */
function replayPick(log, gullsNow) {
  const e = (log || []).find(x => sightKinds(x).length);
  if (!e || !e.play) return null;
  if (e.play.kind === "gulls" && gullsNow && e.play.machine in gullsNow && !!gullsNow[e.play.machine] !== !!e.play.to) return null;
  return e;
}

if (typeof module !== "undefined") module.exports = { SIGHT_KINDS, sightKinds, noteSighting, replayPick };
