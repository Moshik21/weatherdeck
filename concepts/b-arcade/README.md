# Concept B: arcade cabinet

A standalone, high-fidelity mockup of the Weatherdeck board as an 8-bit arcade screen. It is a phase-2 design concept, not product code: nothing in `src/` or `web/` uses it.

## Run it

The page reads `fixture.json` with `fetch`, which browsers refuse over `file://`, so serve the folder:

```
cd concepts/b-arcade
python3 -m http.server 8961 --bind 127.0.0.1
```

Then open http://127.0.0.1:8961/index.html. The page makes no other network request.

## Scenarios

Pick one with the URL hash: `#normal`, `#all-clear`, `#trouble`, `#night`, `#one-source-silent`, `#lost`, `#host-down`, `#empty`, `#loading`. Add `+dev` (for example `#trouble+dev`) or press D to show the small scenario switcher; add `+still` to turn motion off.

Layout follows the window: wider than 720 CSS px and landscape draws the TV screen (640 x 360 art pixels, art pixel = 6 device px on a 4K panel, 3 on 1080p); narrower or portrait draws the phone column (art pixel = 2 CSS px).

## Files

| File | What |
| --- | --- |
| `index.html` | The page shell, with a strict CSP (`default-src 'self'`) |
| `arcade.css` | Tokens (day and night tables), the art-pixel grid, TV and phone layouts, motion |
| `arcade.js` | Merges the fixture's feeds the way the host does, applies the scenario, draws the board |
| `sprites.js` | The original CC0 sprite sheet, drawn as inline SVG on the art-pixel grid |
| `fixture.json` | Copy of the phase-2 synthetic fleet |
| `fonts/` | Self-hosted OFL fonts with licences and a provenance table |
| `CREDITS.md` | Art and data credits |

## Where values come from

Everything shown comes from `fixture.json`. Three rules come from the product instead, and are named in `arcade.js`: the freshness levels (live within 2 intervals, late within 4, lost after 900 s), the host retry interval (10 s, which drives the Continue countdown) and the quiet hours in the fixture's `display` block. The night scenario is "the same data at 23:40", so its timestamps move with the clock and ages stay as in the normal scenario.
