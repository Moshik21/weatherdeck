# Concept A: Fleet Command

A 16-bit strategy command screen for the fleet board. The viewer is the commander; machines are
bases on a minimap, lanes are units in a roster, and anything only the viewer can do arrives as an
order in one gold window. It is a phase-2 design mockup: a standalone page driven only by the
synthetic fixture. It does not touch the product.

## Open it

- Double-click `index.html` (works from `file://`), or serve the folder:
  `python3 -m http.server 8000` and open http://127.0.0.1:8000/.
- Scenario by hash: `#normal` `#all-clear` `#trouble` `#night` `#one-source-silent` `#lost`
  `#host-down` `#empty` `#loading`.
- Add `,dev` (for example `#trouble,dev`) or press the backtick key for the scenario switcher;
  it is hidden by default.
- Add `,still` to stop all motion. The OS "reduce motion" setting does the same.
- Layout follows the window: a wide window is the TV (640 x 360 art pixels, scaled by the largest
  whole number that fits: 6 device px per art pixel on 4K, 3 on 1080p); a narrow one is the phone
  (one column, 6 device px per art pixel at DPR 3).

The page makes no network request beyond its own files.

## Files

| File | What |
| --- | --- |
| `index.html` | The page shell and a strict CSP (`default-src 'self'`) |
| `css/command.css` | Tokens (day and night tables, SNES 15-bit values), the TV grid, the phone column, motion |
| `js/model.js` | Fixture to view model: merges the three feeds, applies a scenario, ranks orders and off-course units, staleness from the host's default thresholds |
| `js/sprites.js` | All pixel art, drawn procedurally into small canvases |
| `js/render.js` | Builds the board (`textContent` only) |
| `js/main.js` | Integer pixel scale, scenario routing, dev switcher, motion level, burn-in drift |
| `fixture.json` | Verbatim copy of the phase-1 `synthetic-fleet.json` |
| `fixture.js` | The same data wrapped for `file://` use; regenerate with `sh make-fixture-js.sh` |
| `fonts/` | Departure Mono, Jersey 15, Atkinson Hyperlegible Next, with licences and `README.md` |
| `CREDITS.md` | Art and font credits (all art original and CC0) |

## How it reads

- **1 second:** the gold orders window with the count on a solid gold plate (the brightest block on
  the board, in colour and in greyscale); the three bases with shape marks (square ok, triangle
  struggling, cross down) and the live lamp with its age.
- **5 seconds:** the top order spoken by the lookout in a dialog window (title, where to act, how long
  it has waited, a continue cursor); the other orders as tiles with an age badge; off-course units
  first in the roster, each with an honest-range health bar (solid floor, hatched ceiling), a stamina
  bar for elapsed against typical (amber past typical, ticks at typical and p90) and a state word.
- **30 seconds / phone:** every lane, the landed high-score table, the queue, releases, allowances,
  machine vitals and source freshness.

Hue only means "look here": amber is a call waiting on you, red is trouble, blue a step running,
green done. Normal units and healthy bases stay neutral. Every state also has a glyph and a word.
