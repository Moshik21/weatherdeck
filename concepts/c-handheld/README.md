# Concept C: Handheld LCD

A phase-2 design mockup for the fleet dashboard. The whole TV becomes a calm handheld LCD screen: four shades only, a faint screen door, and no hue at all. State is carried by shape, inversion, dither and words. The one thing that waits on you is the only inverted object on the screen: a dark dialog plate with a "!" in its corner, a big count and the top call.

This folder is a standalone mockup. It touches nothing in the product, makes no network calls (a strict CSP in `index.html` allows only its own files), and draws everything from `fixture.json`.

## Open it

- Double-click `index.html`, or serve the folder (`python3 -m http.server`) and open `index.html`.
- `fixture.js` holds the same JSON as `fixture.json` so the page also opens from `file://`. After changing `fixture.json`, regenerate it:

  ```
  python3 -c "d=open('fixture.json').read(); open('fixture.js','w').write('/* Generated from fixture.json so the page also opens from file://. Regenerate: see README.md. */\nwindow.HH_FIXTURE = '+d.strip()+';\n')"
  ```

## Scenarios

Pick one with the URL hash. Press `D` for the small switcher (hidden by default).

| Hash | What it shows |
| --- | --- |
| `#normal` | Day, four calls, six lanes off course |
| `#all-clear` | Nothing waits: an outlined window says so in words |
| `#trouble` | A critical first: hazard stripes round the plate, a dithered rim on the screen that blinks three times, then rests |
| `#night` | 23:40, quiet hours: the backlight-off palette |
| `#night-all-clear` | Derived from two fixture scenarios (the all-clear patch at the night clock): the LCD sleeps to the clock and "Z Z Z" |
| `#one-source-silent` | Tern silent 16 min: its rows keep their state word, say "last known", and their glyph slot and bar are dithered |
| `#lost` | No signal for 21 min: the plate turns into a dashed window, every bar is dithered, a notice says everything is last known |
| `#host-down` | The page cannot reach its host: the freshness line says so, with the data age and the next try |
| `#empty` | No feed yet: the frame with named empty slots |
| `#loading` | First response pending: the frame, a caret, no fake zeros |

Modifiers, joined with `+`: `grey` or `green` (LCD tint; auto is pea green by day and warm grey at night), `nodoor` (screen door off), `still` (no motion), `dev` (switcher open), `phone` or `tv` (force a layout). Example: `#trouble+grey+dev`.

## How it is built

- `js/model.js` turns the fixture and one scenario into a view: merges the three feeds, applies the scenario patch, computes each source's freshness (live, late, stale, lost) from `received_age_s`, ranks the calls, classifies every lane (off course or folded into counts) and keeps the honest ranges as given.
- `js/render.js` draws the TV poster or the phone column with `textContent` only, and `fit()` drops what the phone also carries if a TV zone would overflow (the TV never scrolls).
- `js/glyphs.js` holds every sprite as a text grid and draws it as crisp inline SVG.
- `js/app.js` snaps the art pixel to whole device pixels, handles the hash, motion, burn-in drift and the switcher.
- `css/handheld.css` holds the four-shade palettes (day pea green, day warm grey, two night tables) and every size in art pixels.

One art pixel is 6 device pixels on a 4K TV (3 CSS px at DPR 2, 3 px on a 1080p panel) and 2 CSS px on a DPR-3 phone. The TV canvas is 640 x 360 art pixels, centred and scaled by whole numbers only.
