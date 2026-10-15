# Concept D: ship deck

The fleet as a ship at sea, drawn in hi-bit pixel art. The ship's three deck sections are the three machines (Kestrel aft, Basalt amidships, Tern forward), every lane is a sailor whose pose says its state, and scouts stand in the crow's nests with a spyglass. When something waits on you, the lookout crow brings it: it flies in from the mast and perches on a parchment dialog under an amber band, the one focal point. Under the waterline, the ship's log lists every off-course lane on its own line in plain type: what, state, time against typical, honest range, where.

The scene carries the mood and the plates carry the facts. Weather and light follow the fleet and the clock: clear when healthy, a rain cloud over a struggling machine, fog over a source that went quiet, a storm with a red edge only for a critical; dawn, day, dusk and night skies follow the fixture clock and double as the night palette.

## Open it

The page reads `fixture.json` next to it, so serve the folder over HTTP:

```
cd concepts/d-shipdeck
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/#normal
```

No request leaves the folder: fonts are self-hosted, every sprite is drawn in code, and the page sets a `default-src 'self'` content security policy.

## Scenarios and switches

Choose a scenario with the hash: `#normal`, `#all-clear`, `#trouble`, `#night`, `#one-source-silent`, `#lost`, `#host-down`, `#empty`, `#loading`. Add `&sky=dawn|day|dusk|night` to preview another sky, `&motion=full|still` to change the motion level (default `calm`), and `&dev` (or press D) to show the switcher.

Layouts: below 700 CSS px wide the page uses the phone layout. The TV is one 640 x 360 art-pixel stage, scaled by a whole number of device pixels (6 on a 4K panel, 3 on 1080p), so 3840 x 2160, 1920 x 1080 at DPR 2 and 1920 x 1080 at DPR 1 are the same picture. The phone keeps the art pixel at 2 CSS px and stacks the bar, a scene banner, the call, the log and the full 30-second layer.

## Files

| File | What |
| --- | --- |
| `index.html` | The page shell |
| `css/shipdeck.css` | Tokens (day and night tables), the plates, both layouts |
| `js/model.js` | Fixture plus scenario to the view the page draws: freshness, lane kinds, calls, ages |
| `js/art.js` | Palettes, glyphs, crew and crow sprites, the ship, sky, sea and weather painter |
| `js/app.js` | Layout on the art grid, the plates, scene composition, motion, the dev switcher, burn-in drift |
| `fixture.json` | Copy of the phase-1 synthetic fleet |
| `fonts/` | Departure Mono, Jersey 15, Atkinson Hyperlegible Next, with licences and a README |
| `CREDITS.md` | Art credits (all original, CC0) |
