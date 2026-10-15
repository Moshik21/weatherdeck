"use strict";
/* Weather transitions (docs/theme-spec.md section 26): when a machine's real state changes between two feeds, its cloud and
   rain come or go over the theme's weather_change token (four steps over 600 ms), then rest. Pure: plain data in, plain
   data out. The real fields are machines[].strain.state and machines[].status, already folded into the page's machine word (model.js machineState); no
   new field. Only a machine whose word is known on both feeds can change: unknown, silent, lost, asleep and resting are
   never tracked, so a stale or silent source keeps its frozen last-known weather and unknown stays unknown.
   tests/test_weather.py runs this file in Node. */

/* Defaults for a theme with no weather_change token (motion.durations_ms / motion.steps); ship-deck sets the same. */
const WX_MS = 600, WX_STEPS = 4;

/* The tracked weather of a machine key, or null when the word is not a verdict from the host's load and status. */
function weatherTracked(key) {
  return key === "alert" ? "storm" : key === "down" ? "squall" : key === "warn" ? "rain" : key === "ok" ? "clear" : null;
}

/* The change events between two tracked maps ({machine id: word|null}): {id: {from, to}} for each machine present and
   known on both feeds whose word differs. No previous map (first load), the same map, or reduced motion (the new weather shows at once) gives none. */
function weatherChanges(prev, cur, still) {
  const out = {};
  if (!prev || still) return out;
  for (const id of Object.keys(cur || {})) {
    const a = prev[id], b = cur[id];
    if (a != null && b != null && a !== b) out[id] = { from: a, to: b };
  }
  return out;
}

/* How much of a weather is drawn: its word and a 0..1 growth. A change between clear and a weather grows or shrinks that
   weather over the steps (step 0 to steps, the theme's weather_change steps); any other change, no event, a stale event (the word has moved on), or no motion draws the final weather at once. */
function weatherShape(word, ev, step, steps = WX_STEPS) {
  if (!ev || ev.to !== word || step >= steps) return { word, grow: word === "clear" ? 0 : 1 };
  if (ev.from === "clear" && ev.to !== "clear") return { word: ev.to, grow: step / steps };
  if (ev.to === "clear" && ev.from !== "clear") return { word: ev.from, grow: 1 - step / steps };
  return { word, grow: word === "clear" ? 0 : 1 };
}

if (typeof module !== "undefined") module.exports = { WX_MS, WX_STEPS, weatherTracked, weatherChanges, weatherShape };
