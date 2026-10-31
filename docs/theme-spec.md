# Theme spec: design tokens and the ship-deck theme

This spec defines how the board is themed. The open-source core stays generic, and each look ships as
a theme folder of tokens, fonts and art. It also gives the full token set for the first designed
theme, **ship deck** (the fleet as a ship at sea in hi-bit pixel art, from `concepts/d-shipdeck/`), and
for the neutral **default** theme that the core ships with.

The live page implements it: `web/theme.js` loads a theme and writes its tokens as custom properties,
`web/model.js` and `web/board.js` lay out and fill the zones by role, `web/style.css` holds only role
styles, and `web/themes/ship-deck/scene.js` is the ship-deck scene module. `weatherdeck theme check` runs
the checks of section 14 that need no browser. The machine-readable files are:

| File | What |
| --- | --- |
| `web/themes/theme.schema.json` | JSON Schema for every `tokens.json` |
| `web/themes/default/tokens.json` | The neutral default theme. It also holds the **core** tokens every theme inherits: status palette, text neutrals, glyph map |
| `web/themes/default/glyphs.json` | The state glyphs (12 x 12 art px) and machine pips (8 x 8), CC0 |
| `web/themes/ship-deck/tokens.json` | The ship-deck theme: surfaces, scene palette, faces, zones, components, words |
| `web/themes/ship-deck/sprites.json` | The ship-deck sprite strings for the anchor and hailing scenes (crow, bell, lantern, flags), CC0 |
| `web/themes/ship-deck/fonts/` | Departure Mono, Jersey 15, Atkinson Hyperlegible Next (WOFF2, OFL 1.1) with licences and a README |
| `web/themes/ship-deck/CREDITS.md` | Art and font credits |

Every number below is also in the token files. If the two disagree, the token file wins and this
document is the bug.

Contents: [1 Core and theme](#1-core-and-theme) · [2 Theme folders and loading](#2-theme-folders-and-loading) ·
[3 Grid](#3-the-art-pixel-grid) · [4 Spacing](#4-spacing) · [5 Type](#5-type) · [6 Colour](#6-colour) ·
[7 Glyphs](#7-glyphs-and-pips) · [8 Zones](#8-layout-zones) · [9 Components](#9-components-ship-deck) ·
[10 Motion](#10-motion) · [11 Burn-in, CRT, dither](#11-burn-in-crt-and-dither) ·
[12 Scene module](#12-scene-module) · [13 Review fixes](#13-review-fixes-folded-in) ·
[14 Acceptance checks](#14-acceptance-checks) · [15 Open points](#15-open-points)

---

## 1. Core and theme

The board has fixed **roles**. A theme only fills them. This keeps the core generic: it lays out
regions by role and styles them through role tokens. It never names a ship, a parchment or a crow.

| Owned by the core (never themed) | Owned by a theme |
| --- | --- |
| The data, ranking, fold and overflow rules, "last known" honesty, the machine-alert rule | Surface colours for each role, per mode |
| The **status palette** (`needs`, `trouble`, `moving`, `done`) and the **text neutrals** (`ink`, `ink2`, `fog`), per mode | Faces (which fonts fill the `pixel`, `numeral` and `data` roles) |
| The glyph set and the map from state to glyph, colour slot and default word | Scene art, sprites and how each component is drawn |
| Type roles and their sizes, the grid, the zones' jobs, the motion levels and budgets, the burn-in drift | Vocabulary (`words`), layered under the user's config labels |
| When each mode applies (day, night, sleep) and when the anchor and hailing screens show | What the anchor and hailing screens look like |

Rules that hold in every theme (from the phase-1 research, section b.2):

1. **One focal point.** The call plate is the only object filled with the `needs` hue. Elsewhere,
   `needs` appears only as a glyph of 12 x 12 art px or smaller that points at a call. It never
   appears as text colour beyond the short state word, and never as a bar or a large fill.
2. **Neutral means normal.** Healthy machines, normal lanes and chrome take no status hue.
3. **Shape, word, number.** Every state has a glyph silhouette, a state word and its figures. Colour
   is the third channel.
4. **Red is for failed, critical and down only.** Blocked, running long, regressed and asking-its-lead
   are caution states: a glyph and a word in ink, never red, never amber.
5. **Text sits on solid plates.** No text is drawn over scene art.
6. **Status hexes never theme.** A theme that sets `color.status` or `color.ink` is ignored for those
   keys, and the loader logs it once.

---

## 2. Theme folders and loading

```
web/themes/
  theme.schema.json
  default/      tokens.json  glyphs.json
  ship-deck/    tokens.json  sprites.json  CREDITS.md  fonts/  scene.js
```

- **Choosing a theme.** A new config key `theme.name` names the folder (default `"default"`).
  `theme.mode` (`auto | day | night`) is unchanged. New keys: `theme.motion` (`full | calm | still`,
  default `calm` on the TV), `theme.crt` (default `false`) and `theme.oled_safe` (default `false`).
  `theme.accents` stays for back-compatibility, with a narrower meaning:
  - It applies to the `default` theme only, and only its `background` key, which maps to `surface.ground`.
  - Its status keys (`attention`, `trouble`, `ok`, `work`, `offline`) are ignored with one log line,
    because status never themes.
- **Inheritance.** `extends` names a parent theme. The loader merges the child over the parent key
  by key: objects merge, and arrays and scalars replace. Every theme ends at `default`, which supplies
  `color.status`, `color.ink`, the glyph map and the motion and burn-in rules.
- **Serving.** The host serves `/themes/<id>/<path>` from `web/themes/`. It allows only `.json`,
  `.woff2`, `.js` and `.txt`, resolves the path inside the theme folder, rejects `..`, and sends
  `Cache-Control: no-cache` with an ETag, as `_static` does today. The CSP (`default-src 'self'`) is
  unchanged: fonts, the scene module and `data:` sprites already fit it. No theme file may come from
  another origin.
- **Fonts.** Each entry in `fonts[]` declares `family`, `role`, `file` (under `fonts/`), `format`
  (`woff2` only), `weight`, `style`, `version`, `licence` (an SPDX id), `licence_file` (next to the
  font), `source` (a pinned upstream URL), `modified` (false, or how it was subset) and `integrity`
  (`sha256-` plus base64, the subresource-integrity form).
  - The loader builds `@font-face` rules with `font-display: block`, waits for `document.fonts.load`
    on every role face for up to 2 s, then renders.
  - A face that fails to load falls back to the stack in `faces.<role>`. Layout does not change,
    because sizes are set per role, not per font.
  - A check (section 14) verifies each `integrity` value against its file.
  - The `fonts/README.md` table repeats this information for people.
- **Sprites.** Small static sprites are text grids in a JSON file (`glyphs.json`, `sprites.json`):
  one character per art px, `.` transparent, and a `palette` that maps characters to colour-token
  paths. A sprite is drawn at one sprite px per art px, or at a whole multiple
  when a component says so (the bell is drawn at 3). A sprite may set `outline`; the drawer then adds a 1-art-px outline in that colour on every
  transparent cell that touches a filled one, as the concept's crow does. Large or animated art
  (sky, sea, ship, crew) comes from the theme's **scene module** (section 12). All art is original or
  CC0, with a `CREDITS.md` per theme.
- **Tokens as CSS.** The loader writes one custom property per token on `:root` for the current mode:
  - `--c-<role>`: every status, ink and surface role
  - `--t-<role>-size` and `--t-<role>-line`: type roles
  - `--ap`: the art pixel
  - `--sp-<n>`: spacing steps

  Mode switches swap the colour set. Role styles in the core's CSS read only these properties.

---

## 3. The art-pixel grid

One art pixel (ap) is a whole number of device pixels whenever that leaves a stage of a sensible size (0.2.0: see
"In-between windows" below). Every length on the board (type sizes, gaps, borders, bevels, zones) is a whole number of ap.

| Target | Viewport | ap in device px | ap in CSS px | Rule |
| --- | --- | --- | --- | --- |
| 4K TV | 3840 x 2160 (DPR 1, or 1920 x 1080 at DPR 2) | 6 | 6 (DPR 1) / 3 (DPR 2) | `ap_dev = floor(min(w_dev / 640, h_dev / 360))` |
| 1440p | 2560 x 1440 | 4 | 4 | same |
| 1080p TV | 1920 x 1080 (DPR 1) | 3 | 3 | same |
| Phone | 390 x 844 at DPR 3 | 6 | 2 | `ap_dev = max(2, round(2 x DPR))` |
| Phone | DPR 2 | 4 | 2 | same |

- **Canvas.** 640 x 360 ap, which is 80 x 45 tiles of 8. 1080p and 4K divide it exactly.
- **Layout.** The page uses the TV layout at 700 CSS px wide or more, and the phone layout below.
- **Centring.** The TV canvas is centred on whole device pixels: offsets are
  `floor((w_dev - 640 x ap_dev) / 2)`, then divided by DPR.
- **Non-integer DPR.** With Windows scaling at 150% or 175%, the rule is computed in device pixels, so
  the art pixel stays whole (for example 4 or 5 device px) and the canvas letterboxes. Never use a
  fractional CSS transform to fill the screen.
- **In-between windows (0.2.0).** Whole device px are kept whenever the stage then fills at least
  `display.stage_min_fill` (default 0.8) of the window's tighter side. Between whole steps, where they would leave
  a small stage in the middle (a 1200 x 800 window: a 640 x 360 stage at 1 px), the stage scales to fit, in quarter
  device px (1.75 there), and the art is drawn pixelated at that scale. Text is laid out in the same ap, so nothing
  overlaps at any scale. `display.stage_scale: "whole"` keeps the old rule; `"fit"` always fills.
- **Bitmaps.** Every canvas is drawn at one canvas px per art px and scaled with
  `image-rendering: pixelated`. Corners are pixel steps (`notch` = 1 ap), never `border-radius`.
- **Kiosk.** The TV should run full-screen or in kiosk mode. A browser toolbar that takes the viewport
  just under 1080 CSS px drops 1080p from 3 to 2 device px per ap.
- **Size target.** Everything is sized for a 55-inch set at 3 m. A larger set reads more comfortably.
  A smaller set, or a longer distance, is an open point (section 15).

---

## 4. Spacing

Steps (ap): **0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24**. Named roles:

| Role | ap | Use |
| --- | --- | --- |
| `hair`, `bevel`, `notch` | 1 | rules, plate bevels, cut corners |
| `frame_call` | 4 | the call's frame: 1 dark, 2 amber, 1 dark |
| `gap_inline` | 4 | glyph to text, pip to word |
| `gap_row` | 4 | between rows in a plate |
| `gap_col` | 6 | between columns |
| `gap_zone` | 6 | between plates (the bar ends at y 35, the call starts at y 41) |
| `gap_section` | 8 | between groups inside a plate |
| `inset_bar` | 8 | bar padding |
| `inset_plate` | 10 | plate padding |
| `inset_call` | 12 | call body padding |
| `margin_side` | 20 | canvas side margin (TV set to Just Scan or Fit) |
| `margin_top`, `margin_bottom` | 8 | canvas top and bottom margin |

Phone: 16 CSS px gutters. Between plates, 12 CSS px.

---

## 5. Type

Three face roles:

| Role | Ship deck | Default | Grid | Carries |
| --- | --- | --- | --- | --- |
| `pixel` | Departure Mono 1.500 | system monospace | 11 font px per em, cap 8 px. One font px is one art px | labels, state words, ages, ranges, machine names, headers. Upper case, tabular |
| `numeral` | Jersey 15 1.001 | system condensed | 27 font px per em, cap 15 px, set at 1-4 font px per art px | the call count, the clock, the landed score, the countdown |
| `data` | Atkinson Hyperlegible Next 2.001 | system UI | cap 0.668 em | titles, sentences, where to act, every detail line |

Pixel faces are only used at whole font-px-per-art-px scales, so their pixels land on the grid.
Pixel text that changes always has at least a 7-px cap (Departure Mono has 8). No game or
machine-revival face is used (no Press Start 2P, no arcade or LCD faces).

### TV scale

Cap height is measured at 3 m. Pixel pitch is 0.317 mm on a 55-inch 4K set and 0.375 mm on a
65-inch one. A 1080p set at the same diagonal gives the same arcminutes.

| Role | Face, scale | Size / line (ap) | Cap (ap) | 4K font / cap (device px) | 55 in | 65 in | Use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `numeral_countdown` | Jersey 15 x4 | 108 / 61 | 60 | 648 / 360 | 131′ | 155′ | seconds to the next try (hailing) |
| `numeral_clock_rest` | Jersey 15 x3 | 81 / 46 | 45 | 486 / 270 | 98′ | 116′ | the anchor clock |
| `numeral_hero` | Jersey 15 x2 | 54 / 30 | 30 | 324 / 180 | 65′ | 77′ | the count on the call band, the biggest number while awake |
| `numeral` | Jersey 15 x1 | 27 / 16 | 15 | 162 / 90 | 33′ | 39′ | clock, landed score |
| `label_lg` | Departure Mono x2 | 22 / 22 | 16 | 132 / 96 | 35′ | 41′ | "HAILING" in place of the countdown digit while a try is in flight |
| `statement` | Atkinson 650 | 16 / 19 | 10.7 | 96 / 64 | 23′ | 28′ | "Nothing waits on you." and the hailing sentence |
| `notice_title` | Atkinson 680 | 14 / 17 | 9.4 | 84 / 56 | 20′ | 24′ | lost contact, empty |
| `title` | Atkinson 680 | 13 / 15 | 8.7 | 78 / 52 | 19′ | 22′ | the top call, the alarm title |
| `title_log` | Atkinson 650 | 12 / 14 | 8.0 | 72 / 48 | 17.5′ | 21′ | lane titles in the log |
| `body_quiet` | Atkinson 450 | 12 / 15 | 8.0 | 72 / 48 | 17.5′ | 21′ | the one quiet line on the anchor plate |
| `label` | Departure Mono x1 | 11 / 11 | 8 | 66 / 48 | 17.4′ | 20.6′ | labels, state words, ages, ranges |
| `body` | Atkinson 450 | 11 / 13 | 7.3 | 66 / 44 | **16.0′** | 18.9′ | where to act, other calls, log details: the floor |

The floor is 16′ on a 55-inch set, glance items are 20′ or more on a 65-inch set, and the hero is
60′ or more. Nothing on the TV is smaller than `body`. A line that would not fit is truncated or
moved to the phone, never shrunk.

### Phone scale

At DPR 3, about 460 ppi, read at 35 cm:

| Role | CSS px / line | Cap at 35 cm |
| --- | --- | --- |
| `label` | 14.667 / 16 (4 device px per font px) | 17.4′ |
| `label_lg` | 18.333 / 20 (5 per font px) | 21.7′ |
| `numeral` | 27 / 18 (3 per font px) | 24′ |
| `numeral_hero` | 54 / 32 (6 per font px) | 49′ |
| `numeral_countdown` | 81 / 48 (9 per font px) | 73′ |
| `title`, `notice_title` | 19 / 24 | 20.7′ |
| `title_log` | 18 / 23 | 19.6′ |
| `statement` | 21 / 26 | 22.8′ |
| `body`, `body_quiet` | 16 / 21 (floor 15) | 17.4′ |

Rules for other DPRs:
- **Departure Mono.** `fp_dev = ceil(14 x DPR / 11)` device px per font px, and the label size is
  `11 x fp_dev / DPR` CSS px. That gives 14.667 at DPR 3, 16.5 at DPR 2 and 16.76 at DPR 2.625.
- **Jersey 15.** The size is `27 x n / DPR` CSS px for a whole `n`. Pick the `n` closest to the
  sizes above.
- **Atkinson.** No grid rule. Never go below 15 CSS px.

---

## 6. Colour

### Modes

| Mode | When | What changes |
| --- | --- | --- |
| `day` | outside quiet hours | the full table |
| `night` | quiet hours (`display.quiet_hours`, default 23:00-07:30), or `theme.mode = night` | a separate table, not a dimmer. Chrome and text drop about 60% in luminance. Only `needs` and `trouble` keep their hue; `done` goes neutral and `moving` goes muted |
| `sleep` | the anchor screen (section 9.8) | darker still: black ground, a dim clock, no status hue on screen |

The scene's sky follows the **clock**: dawn 05:30-07:30, day 07:30-18:30, dusk 18:30-21:00 and
night 21:00-05:30, plus `storm` for a critical and `anchor` for sleep. The **plates** follow the
mode. A dusk sky with the day plate table is normal.

### Core status and text neutrals (all themes)

These are the phase-1 research values (c.4), measured on the ship-deck plate (`#0F131A` by day,
`#07090C` at night). One change: the night `ink2` and `fog` are raised from `#6A717B` (4.0:1) to
`#747B85`, so that **every piece of text clears 4.5:1 in every mode** (research f.5 asks for the same
of the current page).

| Slot | Day | Day contrast | Night | Night contrast | Sleep | Glyph and word |
| --- | --- | --- | --- | --- | --- | --- |
| `needs` | `#F7B733` | 10.44 | `#C49023` | 6.99 | (not shown) | "!" diamond, "?"; YOUR CALL, MERGE READY |
| `trouble` | `#FF5F4A` | 6.19 | `#D55240` | 4.85 | (not shown) | cross; FAILED, CRITICAL, NOT ANSWERING, ALERT |
| `moving` | `#5C9DFF` | 6.84 | `#4974B5` (marks only) | 4.22 | (not shown) | play triangle; the step name |
| `done` | `#93DDB4` | 11.74 | `#6A717B` (neutral, marks only) | 4.04 | (not shown) | check; LANDED |
| `ink` | `#E8ECF1` | 15.69 | `#8F9397` | 6.44 | `#868B91` (6.01) | |
| `ink2` | `#B4BDC9` | 9.80 | `#747B85` | 4.67 | `#7A8088` (5.18) | |
| `fog` | `#8D97A5` | 6.29 | `#747B85` | 4.67 | `#7A8088` (5.18) | dotted diamond, dither; LAST KNOWN, NO WORD |
| `clock` (sleep only) | | | | | `#6A7078` (4.13, large-text rule 3:1) | the anchor clock |

Colour-blind separation is the OKLab distance x 100 after Machado (2009) simulation at severity 1,
the phase-1 method. The worst day pair is `done` against `ink`, protan 9.5. The worst night pair is
`needs` against `trouble`, deutan 8.1. Both meet the target of 8. The full table is in
`checks.cvd` in each `tokens.json`.

### Ship-deck surfaces

Tarred-plank plates carry the text. The call is parchment under an amber band, the one light block
by day.

| Role | Day | Night | Sleep | What |
| --- | --- | --- | --- | --- |
| `ground` | `#0B0F16` | `#04060A` | `#000000` | behind everything (the phone gutters) |
| `panel` | `#0F131A` | `#07090C` | `#020304` | every plate: bar, log, hull plates, notices, anchor, hailing |
| `panel_hi` / `panel_lo` | `#2E3846` / `#05070A` | `#1A1F26` / `#000000` | `#0E1116` / `#000000` | 1-ap plate bevel |
| `rule`, `track` | `#252D3A`, `#222A36` | `#151A20`, `#14181E` | `#0C0F13`, `#0A0C10` | row rules, bar tracks |
| `call` | `#ECE2C8` parchment | `#16130E` dark parchment | (as night) | the call plate fill |
| `call_edge` | `#C9B88E` | `#3A3224` | (as night) | the dashed rule inside the call |
| `call_ink` / `call_ink2` | `#20160C` / `#4A3C2C` | `#A39A86` / `#8A8270` | (as night) | call text |
| `call_band` | = `needs` | = `needs` | | the amber band |
| `call_band_ink` | `#1C1206` | `#0C0804` | | the count and the band label |
| `glyph_ink` | `#14100C` | `#000000` | `#000000` | the dark strokes inside glyphs |

The default theme fills the same roles with slate: panel `#151A22`, call `#1B2230` with a 2-ap amber
edge, and an amber band with a dark numeral (values in `default/tokens.json`).

### Contrast checks (ship deck)

Floors: 4.5:1 for text, 3:1 for non-text marks and for text of 60′ or more.
`needs|glyph_ink` takes the better of the amber fill and the glyph's dark strokes.

| Pair | Day | Night | Sleep | Floor |
| --- | --- | --- | --- | --- |
| `ink` on `panel` | 15.69 | 6.44 | 6.01 | 4.5 |
| `ink2` on `panel` | 9.80 | 4.67 | 5.18 | 4.5 |
| `fog` on `panel` | 6.29 | 4.67 | 5.18 | 4.5 |
| `trouble` on `panel` (state words) | 6.19 | 4.85 | | 4.5 |
| `call_ink` on `call` | 13.78 | 6.64 | 6.64 | 4.5 |
| `call_ink2` on `call` | 8.25 | 4.86 | 4.86 | 4.5 |
| `call_band_ink` on `call_band` | 10.34 | 7.00 | 7.00 | 4.5 |
| `needs\|glyph_ink` on `call` | 14.68 | 6.49 | 6.49 | 3.0 |
| `clock` on `panel` | | | 4.13 | 3.0 |

Each `tokens.json` records every pair with its ratio, floor and use under `checks.contrast`.

### Scene palette (ship deck, art only)

`color.scene` holds sky and sea ramps for each time of day (`dawn`, `day`, `dusk`, `night`, `storm`,
`anchor`), clouds, wood, sails (with a `furled` tone), the crow, the lantern, the iron bell, the two
flags, fog, rain and stars. Art rules:

- Every scene colour is multiplied by the time-of-day light (`color.scene.light`) and snapped to
  5-bit channels, so the art reads like a 15-bit console palette. Plates and status hues are never
  relit.
- No scene colour may equal a status hue. Scene colours that sit near status marks were checked: the
  lantern glass against `needs` is 12.1 (day) and 22.0 (night); the flags against `needs` and `moving`
  are 12.4 and 28.7.
- The only status hue the scene may use is the `trouble` 1-ap edge round the canvas during a critical.
- The bell is iron, not brass, so the hailing plate holds nothing amber. The lantern is pale
  (`#E8DDB8`), never the `needs` amber.

---

## 7. Glyphs and pips

There are twelve state glyphs on a 12 x 12 ap grid and five machine pips on 8 x 8 (`default/glyphs.json`).
In a grid, `#` takes the state's colour slot, `k` takes `glyph_ink`, and `.` is clear. On the TV a
glyph is drawn at one glyph px per art px (72 device px on 4K). On the phone it is 2 or 3 device px
per glyph px. Each glyph differs by silhouette, so it survives greyscale and every CVD simulation.

| State | Glyph | Slot | Word | Tier |
| --- | --- | --- | --- | --- |
| a call (decision, capacity) | `needs` ("!" diamond) | needs | YOUR CALL | action |
| a merge or approval a call names | `approve` ("?") | needs | READY TO APPROVE | action |
| an approval nobody has called for (0.2.0) | `approve` ("?") | ink2 | READY TO APPROVE | normal |
| critical | `failed` (cross) | trouble | CRITICAL | critical |
| failed | `failed` (cross) | trouble | FAILED | critical |
| **blocked** | `blocked` (**wall**) | **ink** | BLOCKED | caution |
| running long (past p90) | `long` (clock) | ink | RUNNING LONG | caution |
| regressed | `regressed` (round again) | ink | ROUND n | caution |
| waiting (0.2.0: on a gate, a PR, a person, capacity, quiet hours) | `mate` (hourglass) | ink2 | AT A GATE / ON A PR / ON A PERSON / ON CAPACITY / QUIET HOURS, or WAITING / PAUSED | normal |
| no word (unknown) | `silent` (dotted diamond) | fog | NO WORD | caution |
| moving | `moving` (play) | moving | the step name | normal |
| scouting | `scout` (spyglass) | moving | SCOUTING | normal |
| landed | `done` (check) | done | LANDED | normal |
| asleep | `asleep` (zZ) | fog | ASLEEP | normal |

A lane row on the log, a deck's list and the page board says one of six row words instead of the Word column (section 9.5).

| Machine | Pip | Slot | Word |
| --- | --- | --- | --- |
| ok | `ok` square | ink2 | OK |
| struggling (0.2.0: against its own norm, see the feed spec's "Machine strain") | `warn` triangle | **ink** | the reason (STRUGGLING, DISK 11 GB, ON BATTERY) |
| draining, reserved, maintenance (0.2.0: declared rest) | `rest` bar | ink2 | DRAINING / RESERVED UNTIL 14:00 / MAINTENANCE |
| **a critical is on it** | `down` cross | trouble | **ALERT** |
| not answering | `down` cross | trouble | NOT ANSWERING |
| silent source, or health beat lost | `silent` dotted diamond | fog | SILENT 16 MIN / LOST 16 MIN |
| a machine alert said in one feed only, of any severity but `info` (0.6.0: [honesty.md](honesty.md), the debounce; a pending `info` card only gets its bridge row) | the pip it already has; the word replaces OK and BECALMED, never a worse word | ink2 | ALERT UNCONFIRMED (SHORT: UNCONFIRMED); the ship does not moor; the convoy plate counts it as "alert unconfirmed"; a row in its bridge says it was said once |

The freshness lamp uses the `lamp` pip: ink when live, ink2 when late, and the dotted diamond in
fog when stale.

A struggling machine's triangle is ink, not amber. When that machine raises a call, the call carries
the amber "!" in the call plate, and the triangle stays neutral (rule 1).

---

## 8. Layout zones

### TV (art px on the 640 x 360 canvas)

```
     x: 20                            376 384                     620
  0 ┌───────────────────────────────────────────────────────────────────┐
  8 │ ┌ bar: score · voyage chart · ahead ······ clock · trust lamp ─┐  │
 35 │ └──────────────────────────────────────────────────────────────┘  │
 41 │ ┌ call (parchment, h ≤ 164) ───┐  ┌ scene window ──────────────┐  │
    │ │ [4] WAIT ON YOU        crow  │  │ sky, masts, sails, nests   │  │
    │ │ ! top call title       age   │  │                            │  │
    │ │   where to act, detail       │  │ hailing plate goes here:   │  │
    │ │ - - - - - - - - - - - - - -  │  │ 392,49 220 x 148           │  │
    │ │ ? up to 3 more calls   age   │  │ deck, crew, weather        │  │
    │ └──────────────────────────────┘  │ [hull plates y 185, h 15]  │  │
205 │ ~~~~~~~~~~~~~~~~~~~ waterline ~~~ └────────────────────────────┘  │
213 │ ┌ ship's log (h 139, 6 rows) ──────────────────────────────────┐  │
    │ │ SHIP'S LOG  n OFF COURSE    n UNDER WAY · SCOUTING · LANDED  │  │
    │ │ glyph | title | STATE WORD | detail | range bar | MACHINE    │  │
352 │ └──────────────────────────────────────────────────────────────┘  │
360 └───────────────────────────────────────────────────────────────────┘
```

| Zone | x, y, w, h (ap) | Holds | Overflow |
| --- | --- | --- | --- |
| `bar` | 20, 8, 600, 27 | landed score and latest landing, the voyage chart, "n AHEAD", the clock, trust lamp and words | during a critical it becomes the alarm |
| `call` | 20, 41, 356, h ≤ 164 | band (count, "WAIT ON YOU", crow), the top call in full, up to 3 more, an "also" line when 3 or fewer wait | more than 4 calls: the 4th row reads "+N more waiting, on the phone". The count is always the total |
| `scene` | full bleed. Window 384, 41, 236, 164. Horizon 146, deck 180, water 205 | sky, ship, crew, weather | mood only: nothing is said only by the scene |
| `open` | 0.4.1, section 21.6: the open sea's zone set. `call` 20, 41, 572, 17 (one banner line); `scene.window` 20, 41, 600, 164 (the whole upper area); `since` 20, 62, 208, 32 | nothing waits on the viewer: the all-clear in one line, and the sea | the line is cut to fit; a screen reader hears it in full, and it is the Bridge's door |
| `legend` | 20, 41, 600, 164 (0.4.1: the whole upper area) | the key (section 20.5): shapes, the sea, each creature's last sighting, the replay | |
| `machines` | hull plates (0.4.0, section 21): the flagship's under its hull (y 185, h 15); each escort's under it (near row) or over its masthead (far row) | pip, name, word per ship; the convoy's count plate | past six ships the rest are one convoy plate ("+3 SHIPS · 1 SILENT"); the count is always the total |
| `log` | 20, 213, 600, 139, 6 rows | every off-course lane | see 9.5 |
| `hail` | 392, 49, 220, 148 (inside the scene window) | the hailing plate | |
| `anchor` | ship 232-408, horizon 120, deck 160, water 178. Plate 140, 192, 360, 156 | the sleep screen | |

The default theme uses the same zones, but has no scene. A plain `machines` panel fills the window
(384, 41, 236, 164), and the hailing plate replaces that panel.

### Phone (one column, 16 CSS px gutters)

The order is **bar, banner, call, log, more**.

- **Bar.** Clock, trust lamp and words, one pip, name and word per machine, and the alarm line during
  a critical.
- **Banner.** The scene cropped to the ship, **64 ap (128 CSS px) tall**. It was 112 ap in the
  concept and is shortened here (review fix). When the host is down, the hailing plate replaces it.
- **Call.** Every call in full, with its detail. On a 390 x 844 viewport the call band's top edge
  is at or above **320 CSS px**, so both one-second questions (what waits on me, can I trust this)
  are on the first screen.
- **Log.** Every off-course lane, with no overflow row.
- **More.** Waiting lanes, under way, scouts, landed today, ahead, releases, allowance, machine vitals
  and sources.

The anchor screen is TV only. The phone is opened on purpose, so at night it shows the night board.

---

## 9. Components (ship deck)

Each component below says what is drawn, which text sits beside it, and which tokens it uses. The
default theme provides the same components without art (`default/tokens.json`, `components`).

### 9.1 Plate

- **Fill.** `panel`, with a 1-ap bevel (`panel_hi` top and left, `panel_lo` bottom and right) and
  1-ap notched corners.
- **Text.** All text on the board sits on a plate or on the call.

### 9.2 The call: the one focal point

- **Plate.** Parchment (`call`) inside a 4-ap frame: `call_band_ink` 1 ap, `call_band` 2 ap,
  `call_band_ink` 1 ap.
- **Band.** An amber band across the top holds the count (`numeral_hero` in `call_band_ink`), the
  label "WAIT ON YOU" (`label`) and the perched crow (`crow_perch`, right-aligned). Beside the label, how old the number is
  ("AS OF 3 MIN AGO": the oldest report behind its asks, `counts.calls_snapshot_at` when the view carries one, else when the host
  received each feed; "as of: not reported" when none is known), and, when the calls and the lanes that say they wait for the
  viewer's OK disagree (`waiting_disagree`), a small outlined "SOURCES DISAGREE" badge whose detail lines go with the also lines.
- **What is counted.** One line per ask (`web/frontdoor.js` `askRows`): the calls first, then each lane the host marks
  `lane.asks_you` (it waits for the viewer's OK with its PR open and no call names it), titled "Waiting for your OK: <title>" with
  its own reason. A call that names the lane, by `item` or by the same PR address, is that lane's one line.
- **Top call.**
  - Glyph.
  - Title: `title`, 2 lines at most on the TV.
  - Age: `label`, right.
  - Where to act: `body` in `call_ink2`.
  - Detail: 1 line on the TV, in full on the phone.
- **Other calls.** A dashed 1-ap rule in `call_edge`, then up to 3 rows: glyph, title on 1 line
  (`body`) and age (`label`).
- **Also line.** `body`, only when 3 or fewer calls wait: a waiting number that could not be verified ("Also:"), each difference
  between the calls and the lanes ("Sources disagree", each line saying both sides: what the one source says and what the other says or
  does not say), then each `info` card as an FYI ("FYI:"), in words: what kind of notice it is, its title, and whose it is ("A sign-in
  notice: ... (yours to know; not counted as waiting on you)", or "whose it is: not reported" when the feed has no 1.12 `actor`). A card
  set aside (feed 1.12: deferred, or someone else's turn) is not an FYI and is not on the band (24.1). None is counted in the band's number.
- **Continue mark.** A 7 x 4 ap mark in `call_ink`, bottom right.
- **Arrival.** The crow flies from the mainmast (`crow_flight`, 6 frames of 100 ms). The plate
  unrolls (`open`, 400 ms, 4 steps). The band blinks 3 times at 2 Hz. The count bounces twice. Then
  nothing moves.
- **Night.** Dark parchment with the night amber band, so the plate is still the brightest block,
  but not a light one. With `theme.oled_safe` on, the day plate uses this table too.
- **Calm (nothing waits).** The call zone shows a plain plate instead: "Nothing waits on you"
  (`numeral`, ink), then what is under way (scouts included) and what landed, in words (`body`, ink2). The crow rests
  on the stern rail in the scene. It is never a zero in an empty box.

### 9.3 Alarm: a critical

- **Bar.** The bar becomes the alarm: "PROBLEM" (`label`, trouble), the title (`title`, ink) and
  how to fix it (`body`, ink2). Its frame is 1 ap `trouble` plus 1 ap `panel_lo`.
- **Call.** It stays amber below the alarm. Critical and action are different tiers: a critical is a Problem on its own line
  and is never counted in the waiting-on-you number.
- **Scene.**
  - Storm weather (sky `storm`), with rain over the section the critical is on.
  - A 1-ap `trouble` edge round the canvas. It blinks 3 times at 2 Hz on arrival, then stays steady.
  - Three lightning flashes on arrival, then still.
- **Machine.** **The machine the critical is on shows the `down` pip and ALERT in trouble.** A
  machine never reads OK while a critical is on it (review fix).
- **Supervision.** A `service` card with id `service:supervision:<source>` is worded by the page (`frontdoor.js`
  `supervisionAlarm`), in the core's labels (`supervision_*`), whoever's card it is:
  - The household view retains the heartbeat age only in the fixed form `heartbeat <digits>s old` (or with a space before `s`); guest and public views strip it.
  - The title names whose supervisor it is, by its source's name and never "this home", and its heartbeat's age as the card's
    `detail` says it ("heartbeat 400s old"): "cinder's supervisor hasn't checked in for 6 min". A `detail` with no age says
    "for how long: not reported"; no age is invented.
  - The severity is the page's, not the card's. A source may raise the card on a watcher-down marker that is written on every
    ordinary wake, so neither that marker nor a recent heartbeat's age makes it critical.
  - With no `supervisor` object (on the card, or on its source; no source sends one yet) the card is FYI, never counted and no
    storm, and its line adds "busy or stopped? not reported", while its heartbeat's age is under
    `thresholds.supervision_stale_critical_s` (1800 s) or not reported. A heartbeat at least that old is critical: "cinder's
    supervisor hasn't checked in for 40 min (no busy marker reported)", restart supervision on cinder.
  - With one (`oldest_unacked_wake_age_s`, `watcher` running or down, `busy`), it is critical only when no watcher runs and the
    oldest unacknowledged wake is older than `thresholds.supervision_wake_limit_s` (300 s): "cinder's supervisor has stopped: a
    wake has waited 7 min with no watcher running", restart supervision on cinder. Busy is FYI, "busy in a long turn"; anything
    else is FYI.

### 9.4 Machines: the hull plates

- One plate per ship (0.4.0: one ship per machine, section 21): pip, name (`label`, ink) and word.
- See section 7 for the pips and their words.

### 9.5 The ship's log

- **Header.** `label`, ink2: "UNDER WAY  n OFF COURSE" (0.1.7: the plate was "SHIP'S LOG" until the push log became the
  Logbook, section 16). On the right, the counts "n UNDER WAY" (scouts included), "n WAITING" and "n LANDED", each
  with its glyph (0.2.0: waiting is counted apart, calmly; it was "n SCOUTING"). Off course is needs action plus
  running long, and nothing else (section 18). "n LANDED" is the bar's landed score (section 18.4), the same number;
  the phone, which has no score in its bar, adds the window ("6 LANDED IN 24 H"). (0.10.0; it counted only the
  listed lanes that had finished, so it could read 0 under a bar that said 6.)
- **Row columns.**
  - glyph
  - the project chip (`label`, ink2, a 1 ap rule outline) and the title (`title_log`): the source's `lane.short_title`, else
    its title without its repeated project, cut only at a whole word to its column, never leaving a bracket open and never
    falling below three words: when the column leaves less beside the chip, the chip gives way first (`web/frontdoor.js`
    `fitTitle`). A title the source already cut loses its last, possibly partial, word. No title reads "title not reported",
    never the task id (Unreleased; it was cut at a word boundary to its column from 0.2.0, down to one word)
  - row word (`label`): one of six, the same on the page board (24.2): **Waiting on you** (needs), **Stuck** (trouble),
    **Can't tell** (fog), **Working**, **Waiting on someone else**, **Finished** (`web/frontdoor.js` `rowState`, from the
    host's `lane.kind` and the source's own lane word). A call, or an approval whose PR is neither merged nor closed, is
    Waiting on you whatever else it says. An approval whose PR merged or was closed, and a lane whose PR merged while its
    worker's session ended (unless its record says it finished), are old records (24.3), never Waiting on you and never Stuck,
    whatever else they say. A feed with no lane word is read from its structured fields only, except that a
    failed, blocked or held lane whose only lines are its books' "status-log superseded" or "harness state unavailable" reads
    Can't tell, never FAILED; and a lane whose run failed or whose worker's session ended while its own records say it was
    waiting (its state, its waits-on word or its last event) reads Waiting on someone else. Its glyph follows the word. Until
    Unreleased the word was the lane kind's (FAILED, AGENT GONE, a step name)
  - sentence (`body`, ink2): the source's `say[]` parts worded as on the page board when its lane word decided the row, else
    one sentence from structured fields (state, waits-on, `link.state`, `agent`, times). Never a raw status line, a task id
    or the words "run failed", "superseded", "harness" or "unknown missing": the source's own words in full are shown only in
    the opened row (16.1). An old record's sentence says why it is one (24.3).
    An instruction waiting unread takes this cell, in `needs` (amber), age first because the cell cuts its end ("Unread 25 min
    (1 from atlas)", "Never delivered, 12 min (2 from atlas)"); its words say what it is, so colour is not the only signal. The
    page board and the Lanes deck carry the whole line (Unreleased; `web/frontdoor.js` `steerNote`). It reads only from fields a source may send on its own lane word
    (proposed, not in the feed spec): `unread_steer` `{n, oldest_at, rings, escalated}` with `idle`, and `undelivered_steer`
    `{n, oldest_at}`. An undelivered instruction (its doorbell never reached the worker) shows whatever the worker is doing: "An
    instruction from atlas was never delivered (12 min ago)". An unread one shows only while the source says the worker is idle
    (`idle: true`; a busy worker reads its inbox when its turn ends): "An instruction from atlas has sat unread for 25 min". The
    name is the home that owns the lane, as the view names its source; ages count from `oldest_at`. A line the source marks
    `escalated` sorts with Stuck: right after the off-course rows on the log and, within its project, on the Lanes deck, and with a
    group's Stuck rows on the page board.
    A source that sends neither inbox field says nothing on its rows; its opened row says "Unread messages: not reported",
    never 0 (`unread_steer: null` is the source's own "none unread")
  - range (`label`) with a 30 x 4 ap bar: a solid floor and a 1-on 1-off hatched span in the state
    slot, on `track`
  - machine (`label`, ink2)
- **Last known.** A row from a silent source keeps its state word and adds **LAST KNOWN** beside it
  (`label`, fog). Its title and range turn fog, its glyph slot is dithered, and its time stops.
  The state word is never replaced (review fix).
- **Overflow.** With more rows than the log has room for, it shows the first rows that fit and ends in one overflow row in `body` ink2, with no
  glyph or bar, counting the rest in the six row words: "+N more: 2 working, 1 stuck. Full list on the Gun deck." The rows are in the one
  order the Lists page uses (section 24.2, "One order"), so what the overflow row counts is always the last of them.
  - Nothing disappears without being counted.
- **Wrap.** A detail may wrap once. If the log would still overflow, details truncate with an
  ellipsis before any row folds.
- **Normal lanes.** They are never rows. They are the counts in the header and the sailors on deck.

### 9.6 Lost contact (every source silent)

- **Call zone.** The call zone becomes a notice plate: `panel` with a 1-ap `fog` frame,
  "Lost contact, no report for 21 min" (`notice_title`), then
  "Everything below is last known, as of 19:09." (`body`).
- **Scene.** Fog rolls over the whole sea (`fog_roll`, 4 steps). Every deck lantern goes dark.
  The crew become dithered ghosts in their last pose.
- **Log.** Rows keep their state words, with LAST KNOWN beside them.

### 9.7 A deck section gone dark (one source silent, or a machine's health beat lost)

This is how a silent machine looks in the ship's world.

- **Scene.**
  - That section's mast lantern goes out: it swaps to `lantern_dark` in one step (`lamp_out`).
  - A fog bank rolls over that section only (`fog_roll`).
  - Its sailors turn to dithered ghosts in their last pose.
  - The rest of the ship stays lit.
- **Hull plate.** The `silent` pip and "SILENT 16 MIN" in fog, or "LOST 16 MIN" for a lost health beat.
- **Calls.** That machine's calls stay in the call plate with "as of 19:14" and a frozen age.
- **Log.** Its rows keep their state words, with LAST KNOWN beside them.
- **Declared rest (0.2.0).** A draining, reserved or maintenance machine keeps its lantern lit and shows the `rest`
  pip and its word (RESERVED UNTIL 14:00), with no fog, no card and no amber. A reserved or maintenance machine whose
  sources go quiet stays that way: never SILENT, no trust-line problem, and its gulls stay (section 17).

### 9.8 The anchor: quiet hours with nothing waiting

The purpose (the must-keep from the handheld concept): a calm, low-light, near-still screen for the
hours when nothing waits on the viewer. It is drawn entirely in the ship's world: the ship rides at
anchor under a night sky, with the crew asleep in hammocks, a single lantern, the clock and a quiet
line of text. It uses no four-shade palette, no LCD treatment and no borrowed fonts.

**When.** All of these hold:
- quiet hours
- no call waits
- no critical
- the host answers
- at least one source is live
- TV layout

Any call, critical, host-down or loss of every source ends it at once, and the board wakes in its
night table. When the last call resolves at night, the board waits `settle_s` (120 s) before it
anchors, so the resolution is seen.

**How it is drawn** (palette `sleep`, scene light `anchor`):

| Layer | Drawing |
| --- | --- |
| Sky | `scene.sky.anchor` ramp, darker than night. Static stars (no twinkle). The moon is placed by the clock |
| Sea | `scene.sea.anchor`, no wave motion |
| Ship | Centred (x 232-408, deck at y 160, waterline 178). Sails furled (`sail.furled`). The anchor chain runs from the bow to the waterline. Every deck lantern is dark (`lantern_dark`) |
| Lantern | One `lantern_lit` on the stern: the only warm light on the screen. It never flickers |
| Crew | Every sailor in a hammock, whether landed, idle or working. Off-course crew keep their small mark above the hammock (clock, crate, smoke) in fog. They still show, but quietly |
| Crow | `crow_asleep` (head tucked, eye closed) on the stern rail, with the `asleep` glyph above it in fog |
| Weather | Kept, but dim: rain over a struggling section, a squall over one not answering, a fog bank over a silent one. Never a storm, because a critical wakes the board |

**What text sits beside the art.** One plate (`panel`, sleep table, 1-ap bevel) below the ship at
140, 192, 360 x 156 (the lines take 144 ap with 10-ap insets and 6-ap gaps):

| Line | Role | Colour | Text |
| --- | --- | --- | --- |
| 1 | `numeral_clock_rest` (98′) | `clock` | the time, HH:MM |
| 2 | `statement` | `ink` | Nothing waits on you. |
| 3 | `body_quiet`, 2 lines max | `ink2` | what is still off course and any machine that is not ok, then the end of quiet hours: "6 lanes off course, machine B struggling. Quiet hours until 07:30." |
| 4 | `label` with the lamp pip | `ink2` | trust: "3/3 LIVE, NEWEST 6 S" |

**Night, burn-in and motion rules.**

- **Night.** It uses the `sleep` table, darker than night. The only bright marks are the clock digits,
  the text, the lantern and the moon. The clock is deliberately dim (`#6A7078`, 4.13:1; at 98′ the
  large-text rule of 3:1 applies).
- **Burn-in.**
  - The plate, ship and crow drift together one art px every 4 minutes, round a 16 x 8 ap box
    (48 positions, 3 h 12 min a lap). That is wider than the 3 x 2 box of the awake board, because
    this screen holds for hours.
  - Budget for the whole frame: mean relative luminance at most 0.01, and lit pixels (relative
    luminance above 0.18) at most 3% of the frame.
  - The moon moves with the clock, so the sky is never quite static.
- **Motion.**
  - On entry: `anchor_in`, 800 ms in 4 steps. The plates fade out, the sails furl, the deck lanterns
    go out one by one, and the crow settles.
  - Then nothing moves except the clock digits (once a minute) and the drift.
  - On waking: `anchor_out`, 400 ms in 2 steps, then the normal arrival of whatever woke it.
  - Under `prefers-reduced-motion`, or with motion `still`, entry and exit are instant.
  - No blink, ever.

### 9.9 Hailing the host: the host is down

The purpose (the must-keep from the arcade concept): an unmistakable, counting-down state that says
"we are waiting to hear back". It is drawn in the ship's world: the masthead lamp is out, a signal
hoist runs up the mainmast, and the ship's bell strikes each time the board calls its host again.
It uses no arcade wording and no arcade face. Here the board is the page on this screen, and the host
is the process it reads from.

**When.** The page has had no answer from its host for `thresholds.host_down_after_s` (30 s by
default). It ends on the first good answer.

**How it is drawn:**

| Layer | Drawing |
| --- | --- |
| Masthead lantern | Goes dark (`lamp_out`, one step). The deck section lanterns keep their last state, because the data is last known and not wrong |
| Signal hoist | Two flags, `flag_halves` over `flag_checks` (plain two-colour patterns, not a real signal code), run up the mainmast halyard once (`flag_hoist`, 400 ms in 4 steps), then hang still |
| Sky | A thin fog over the sky (`fog_roll`). The sea and the ship are otherwise frozen |
| Crew | Frozen in their last pose; no idle |
| Bell | The ship's iron bell (`bell`, 12 x 12 sprite px, drawn at 3 ap each) on the hailing plate, beside the countdown. It strikes once per retry (`bell_strike`: a 1-sprite-px swing, 2 frames, 400 ms) |

**What text sits beside the art.** The hailing plate covers the scene window. It is a `panel` with a
double rope line (`ink2` 1 ap, `panel_lo` 1 ap, `ink2` 1 ap). That is not a status hue: host-down is
a trust state, not fleet trouble.

On the TV the plate is at 392, 49, 220 x 148 and holds only the countdown. The lines take 126 ap:

| Line | Role | Colour | Text |
| --- | --- | --- | --- |
| 1 | `label` | ink | HAILING THE HOST |
| 2 | bell (drawn at 3 ap per sprite px, 36 x 36 ap) + `numeral_countdown` (131′) | ink | the seconds to the next try, e.g. "7" |
| 3 | `label` | ink2 | NEXT TRY IN SECONDS |
| 4 | `label` | ink2 | NO ANSWER FOR 50 S |

The facts go to the bar, which reads "NO HOST" (`label`, ink2), then
"This board can't reach its host." (`title`, ink), then "Newest data from 19:29, 51 s ago." (`body`,
ink2). The call and the log stay visible as last known: their ages freeze with "as of 19:29", and the
log's state words keep LAST KNOWN beside them.

On the phone the plate replaces the banner, full width, and holds everything:

| Line | Role | Colour | Text |
| --- | --- | --- | --- |
| 1 | `label` | ink | HAILING THE HOST |
| 2 | bell + `numeral_countdown` | ink | the seconds to the next try |
| 3 | `label` | ink2 | NEXT TRY IN SECONDS |
| 4 | `statement` | ink | This board can't reach its host. |
| 5 | `label` / `label` | ink2 / ink | NO ANSWER FOR · 50 S |
| 6 | `label` / `body` | ink2 / ink | NEWEST DATA · from 19:29, 51 s ago |
| 7 | `label` / `body` | ink2 / ink2 | LIKELY · the host is asleep or restarting, the process stopped, or this device lost the network |

**Countdown.**
- It counts down from `thresholds.retry_every_s` (10 s by default; the ship-deck concept showed a fixed 15 s).
- It ticks every second as an instant digit swap, at every motion level, because the digit is the
  information.
- At zero, the digit gives way to "HAILING" (`label_lg`, 98 ap wide) for the length of the request.
  - On failure, the bell strikes once and the count restarts.
  - On success, the plate closes (`resolve`, 250 ms), the flags come down and the masthead lantern
    relights.

**Night, burn-in and motion rules.**

- **Night.** The night table applies. The hoist and the bell strike still play once each: they are
  the news, not decoration. The lantern stays dark.
- **Burn-in.** The plate drifts with the other plates (3 x 2 box). The digit changes every second,
  and the plate leaves when the host answers, so nothing bright stays static.
- **Motion.** There is no blink, no red and no looping animation.
  - With motion `still`, or under reduced motion, the hoist appears already hoisted and the bell does
    not swing.
  - The digit still updates, as a plain swap.

### 9.10 Empty and loading

- **Empty.** The ship at anchor by day with bare masts, and a notice plate: "No machine has reported
  yet" (`notice_title`), then how to send a feed (`body`). No zeros.
- **Loading.** Sky and sea only, a plate reading "READING THE LOG" (`label`) and dashed placeholder
  lines. No numbers.

### 9.11 Words

`words` in `ship-deck/tokens.json` holds the theme's vocabulary:
- "Wait on you", "Under way", "n off course", "n under way", "n scouting", "n ahead"
- the places below decks (section 16): "Open sea", "Ship's plan", "Bridge", "Gun deck", "Chart room", "Cargo hold",
  "Crow's nest", "Logbook", each beside its plain words ("calls waiting on you", "every lane, grouped by goal, else by project", ...)
- "Hailing the host", "Next try in seconds", "This board can't reach its host."

The loader layers them **under** the user's config labels, so config always wins. A nautical word is
a name, never the only explanation: every one sits beside plain words and numbers.

---

## 10. Motion

Announce once, then rest. Motion steps through discrete frames and never eases.

| Event | Token | Treatment |
| --- | --- | --- |
| New call | `crow_flight` 600 ms (6 frames), `open` 400 ms (4 steps), blink 3 at 2 Hz, bounce 2 x 600 ms (3 steps, 3 ap) | the crow flies in, the plate unrolls, the band blinks, the count bounces |
| Call resolved | `resolve` 250 ms | the row ticks off |
| Step finishes | `step_finish` 300 ms (3 steps) | the bar fills in steps; the number flips once |
| Lane lands | `landing` 600 ms, counter ≤ 1000 ms in ≤ 7 steps | the score rolls up once |
| Regressed | `regress_flash` 200 ms | the bar drops, ROUND n appears |
| Critical | `storm_flash` 1500 ms, blink 3 at 2 Hz | lightning and the red edge, then steady |
| Weather changes | `weather_change` 600 ms (4 steps) | the cloud and rain come or go over the ship whose real state changed (section 26) |
| Source goes silent / comes back | `fog_roll` / `fog_lift` 600 ms (4 steps), `lamp_out` one step | fog over the section, its lantern out |
| Host down | `flag_hoist` 400 ms (4 steps), `bell_strike` 400 ms (2 frames) per retry | see 9.9 |
| Anchor in / out | `anchor_in` 800 ms (4 steps) / `anchor_out` 400 ms (2 steps) | see 9.8 |
| Running long, blocked, no word | none | static glyph and word |
| Landing, release, gulls, a crew walk | section 17.3 | a longboat (with dolphins), the whale, gulls flying, a sailor walking to a new station; one per ship at a time, after the alerts |

### Motion levels

| Level | What moves |
| --- | --- |
| `full` | Everything above, plus idle crew loops. A loop runs on a lane that changed step or reported in the last `window_s` (600 s): 2 frames of 500 ms, at most 6 sprites at once |
| `calm` (TV default) | Everything above. A changed lane's sailor plays its work loop for `calm_burst_s` (4 s), then rests. **No continuous crew loop.** The ambient sea (below) runs at its smallest amplitude and slowest tempo |
| `still` | Nothing animates, not even the ambient sea. Every change is instant |

At night the level is never above `calm`, with no idle at all. On the anchor screen it is `still`
after the entry.

### Ambient: the sea and the ship's float

A channel apart from the announce-once motion above, defined in `motion.ambient` of the theme tokens.
The sea sways and the ship floats, continuously and quietly. It is art only, and it never touches a plate
or any text.

- **Whole art px, stepped, never eased.** The sea is drawn into a pixel buffer; the ship is shifted by whole
  rows and columns: a slow *bob* (1 to 2 px), a *lean* (masthead sway, a row shear about the waterline), a
  *pitch* (bow and stern rise and fall, a column shear), and a slow *surge* (forward drift against the sea).
  Crew and sails are carried along unchanged. Wave dashes scroll in parallax and ride the swell by whole rows;
  dithered whitecaps drift and fade; a dithered haze breathes on the horizon; the water in front of the hull has
  a wavy edge with a dithered foam crest.
- **Frame rate.** 8 fps at `calm`, 10 at `full` (the cap). Each frame is one stepped pose, with no tween.
- **Level and mood.** The level (`calm` smallest and slowest, `full` normal) multiplies a mood: `day`, `night`
  (night and quiet hours: slow and small), `storm` (a critical: bigger, faster swell, harder roll), `anchor` (a
  tiny bob, no roll), `hail` (host down: slower), `lost` (every source lost: still). A silent section's fog slows
  the swell further. Changes of mood ease over `ease_s` seconds.
- **Off.** Under level `still` or `prefers-reduced-motion`, with `display.ambient` false, while the tab is hidden
  or the scene is scrolled out of view (the phone banner).
- **Burn-in.** The clouds, the haze and the horizon keep drifting on the wall clock even when the swell holds
  still (`lost`), so no pixel line stays put for hours. The board's plate drift (section 11) is unchanged.
- **Cost.** One slow timer; layers (sky, hull, crew, rail, weather) are cached and repainted only when they change.
- **Debug.** `#ambient=0` and `#ambient=1` force it off and on; `#ambient=stats` leaves it as configured, logs its
  cost every 30 s and exposes `window.weatherdeckAmbient()`.

### Budgets

- **Blink.** 2 Hz, at most 3 blinks per event, one blinking element at a time. Blinks only for the
  call band on arrival, the critical edge on arrival and storm lightning on arrival.
- **What never blinks.** Text, glyphs, the anchor screen and the hailing plate. At night nothing
  blinks except a new call or critical.
- **Idle.** Only crew sprites, under the window rule. Smoke, lantern and flags never idle. The lighthouse beam turns only
  inside the ambient channel (section 17.3). The waves and
  clouds move only through the ambient channel above.
- **Per second.** Only the hail countdown changes every second. The clock is HH:MM, and ages change
  per minute after the first hour.
- **Reduced motion.** `prefers-reduced-motion: reduce` (or config `still`) makes every transition an
  instant change, or a cross-fade of at most 100 ms.
  - There is no idle.
  - The countdown and the clock still update as plain digit swaps.
  - The burn-in drift continues: one whole-ap jump every 4 minutes is not perceived motion.
  - This satisfies WCAG 2.2.2, because every loop can be stopped.

---

## 11. Burn-in, CRT and dither

**Burn-in.**
- **Drift.** All plates drift together one art px every 240 s, round a 3 x 2 ap box (path
  (0,0) (1,0) (2,0) (2,1) (1,1) (0,1)). The scene canvas is not moved: its sky changes on its own, and the ambient sea (section 10) never holds still for long.
  The anchor screen uses its own wider drift (9.8).
- **Dark fills.** Large fills stay at OKLCH L ≤ 0.25. The exceptions are the call plate by day (the
  one light block), text, glyphs and bars no taller than 4 ap.
- **No static brightness.** There is no static logo or wordmark. Chrome labels are ink2.
- **Self-varying content.** The sky changes with the clock, the clock and ages tick, and the crew
  poses follow state.
- **`theme.oled_safe`.** Off by default. When on, the day call plate uses the night parchment table
  (dark plate, amber band kept), so no large light block sits on the panel for hours. Also turn on
  the TV's own pixel shift and let it run its compensation cycle.

**CRT** (`crt`, off by default).
- Whole-pixel scanlines at the art-px period: the bottom `max(1, floor(ap_dev / 3))` device px of
  each art-px row, darkened 12%.
- The scene canvas only. Never over a plate.
- No barrel distortion, chromatic aberration or flicker.

**Dither.**
- A 4 x 4 Bayer pattern, used only on sky band seams, fog over a silent section, fog over the whole
  sea when lost, and the stale half of a range bar.
- Never on text, glyphs, crew or crow sprites, or plates.

---

## 12. Scene module

A theme with art ships `scene.js`. For ship deck it is ported from `concepts/d-shipdeck/js/art.js`,
together with the crew, ship and weather painters. It registers itself with the core, which calls it
with plain data only:

```js
window.WeatherdeckTheme.register("ship-deck", {
  // Paint one frame into a canvas sized in art px (one canvas px = one art px).
  paint(ctx, scene, frame) {},
  // Which lanes animate now, given the motion level (section 10). Returns a Set of lane ids.
  animated(scene, level) {},
  // Optional: true when paint draws the ambient sea (section 10) from frame.ambient.
  ambient: true,
  // Optional: anchors in stage art px: the hull plates, the crow's start, and for decks (section 16) the spots a move
  // into the ship centres on, the ship's own door, and on the plan each place's compartment and door plate.
  layout(scene) {},
  // Optional (section 17): the scene receipt, what paint draws for this scene, as plain parts the core puts into words.
  describe(scene) {},
  // Optional (section 21): one ship (a machine id, or "@convoy") at half scale into a small canvas, for the phone's
  // convoy strip. Returns true when it drew. Still: never animated.
  mini(ctx, scene, id) {},
});
```

`scene` is built by the core from the view model and contains:

| Field | Content |
| --- | --- |
| `w`, `h`, `layout` | canvas size in ap, `tv` or `phone` |
| `tod`, `mode` | time of day (`dawn`, `day`, `dusk`, `night`), plate mode (`day`, `night`, `sleep`) |
| `screen` | `board`, `anchor`, `hail`, `lost`, `empty`, `loading`, or `deck` below the sea (section 16) |
| `room`, `ship` | on `deck`: `plan` or a place (`bridge`, `gun-deck`, `chart-room`, `cargo-hold`, `crows-nest`, `logbook`), and the ship (machine) id |
| `counts` | `{landed}`: what landed today (the cargo hold's crates) |
| `machines[]` | id, label, pip state (section 7), `critical` (bool), `silent_s`, `becalmed` (bool, section 17), `resting`, `asleep` (bool, 0.4.0) |
| `fleet` | 0.4.0, section 21: `{ships[] {id, role (flagship, escort), slot, berth (sea, harbor, anchored)}, convoy {n, worst, stale} or null, slots}`; `slots` (0.4.1, section 21.2) is the core's roadstead for this window: `{open, ships[] {slot, x0, x1, scale (full, half)}, convoy {x0, x1} or null}`, x as fractions of the window's width |
| `open`, `window` | 0.4.1, section 21.6: whether this is the open sea, and the scene window in stage art px `{x, y, w, h}` |
| `crew[]` | lane id, machine id, state (section 7), project tag, `changed_s`, `stage` (section 17, or null), `light` (section 23.2: `lit`, `dark`, `unknown`, or null for finished or failed work) |
| `horizon` | section 23.1: `{islands[] {id, kind (queued, gate, held), step (3, 2, 1), dated, state (ok, unknown, fog)}, total, more}`; none when the page has no board yet |
| `world` | section 17: `{host, gulls, events[], walk}`; an event has `replay: true` when it is the replay key's (section 17.4.1) |
| `calls` | count, and whether any is new since the last frame |
| `weather` | per machine: `clear`, `rain`, `squall`, `fog`, `storm` |
| `hail` | `{seconds, trying}` when the host is down |
| `palette` | the resolved `color.scene` and status tokens for the mode |
| `motion` | the effective level |

`frame` carries `now`, the event times, `animated`, a `rev` that changes whenever the scene data does (cache key),
`live` while a one-shot event plays, and, while the sea runs, `ambient`: `{on, phase, amp, roll, tok, mood, level}`:
the sea's own clock in seconds (already scaled by tempo), the eased amplitude and roll, and the theme's
`motion.ambient` tokens.

**Rules.**
- The module draws only art. It never draws text.
- It never decides state: the core decides, the module depicts.
- If `scene.js` is missing, or throws, the core paints the plain `ground` and logs once. The board
  loses nothing, because the scene never says anything alone.
- The module may not fetch anything. The CSP already forbids it.

---

## 13. Review fixes folded in

The comparison-board review listed these weaknesses in the ship-deck concept, plus two must-keeps.
Each is now a rule.

| Review finding | Rule here |
| --- | --- |
| BLOCKED used trouble red | Section 7: blocked is the wall glyph and the word in **ink**. Red is only for failed, critical and down |
| Lost and one-source-silent replaced state words with LAST KNOWN | 9.5, 9.6, 9.7: the state word stays, LAST KNOWN sits beside it |
| A machine read OK during a critical on it | 9.3, section 7: `down` pip and ALERT in trouble |
| The phone ship banner pushed the call to about 400 CSS px | Section 8: banner 64 ap (128 CSS px); call top ≤ 320 CSS px on 390 x 844 |
| No overflow rule past 6 off-course lanes | 9.5: 5 rows plus a counted overflow row; details truncate before rows fold |
| Crew idle loops ran by day in calm mode | Section 10: `calm` plays a 4 s burst per changed lane, then rests; no continuous loop |
| Sailors too small to read at 3 m; the ship is mood | 8 and 12: the scene says nothing alone. Names live in the log and on the phone |
| Must-keep: a sleep screen for quiet hours | 9.8: the ship at anchor, in the ship-deck world |
| Must-keep: a counting-down host-down state | 9.9: hailing the host, with the bell and the signal hoist |
| (Research f.5) dim text below 4.5:1 | Section 6: night `ink2` and `fog` raised to `#747B85` |
| A struggling machine's triangle was amber | Section 7: the triangle is ink; amber stays on the call |

---

## 14. Acceptance checks

These are for the implementation lane, run against the fixture scenarios in every mode:

1. `tokens.json` for every theme validates against `theme.schema.json`. Each font's `integrity`
   matches its file, and each `licence_file` exists.
2. Every pair in `checks.contrast` is recomputed from the resolved tokens and meets its floor.
   `checks.cvd` worst values are 8 or more for the status pairs.
3. Every role style reads only the role custom properties (section 2). A grep of the core CSS for
   hex colours outside the default theme finds none.
4. **Sizes.** Measured with `getComputedStyle`, every role at 3840 x 2160, 1920 x 1080 and
   390 x 844 at DPR 3 matches section 5.
   - TV: nothing below 16′ on 55 inches.
   - Phone: nothing below 15 CSS px.
   - Every art-px length is a whole number of device px.
5. **Squint.** Greyscale plus a 4 px blur of the 1080p render: the call plate is the strongest block
   in normal, trouble and night. In sleep the clock is the strongest mark, and the frame meets
   `burn_in.anchor_budget`.
6. **Motion.** At 6 s after load in normal: `calm` has 0 running animations and no DOM mutations
   over 3 s. `still` and reduced motion render the final frame first. The hail countdown still
   ticks under reduced motion.
7. **Honesty.**
   - In one-source-silent and lost, every log row keeps its state word with LAST KNOWN.
   - In trouble, the machine with the critical reads ALERT.
   - With 7 or more off-course lanes, the overflow row's counts add up.
8. **Phone.** At 390 x 844 the call band's top is ≤ 320 CSS px, with no horizontal scroll.
9. **Network.** No request leaves the host. The CSP is unchanged.
10. `scripts/self-audit` finds nothing new under `web/`.

---

## 15. Open points

- **Screen size.** The real TV diagonal is still open. Sizes hold the 16′ floor on 55 inches. A
  smaller set, or a longer distance, needs a larger art scale. That would mean a smaller canvas in
  art px with the same roles, which is not designed yet.
- **Night greys.** The night `ink2` and `fog` change (`#6A717B` to `#747B85`) also applies to the
  default theme. The current page's own night table (`web/style.css`) is not changed in this lane.
- **Scene module.** `scene.js` is ported from the concept's `art.js` and draws the anchor and hailing
  art (furled sails, anchor chain, hammocks for all, lanterns, hoist) from this spec; the bell is a
  sprite the core draws on the hailing plate.
- **Monochrome themes.** A future theme with no hue (like the handheld concept) would need a declared
  exception to "status never themes" (`status_policy: "monochrome"`, mapping status to inversion,
  stripes and dither). This spec leaves room for it, but does not define it.
- **Sound.** Opt-in since 0.1.8: see section 17.6.

---

## 16. Decks: the click-in views (0.1.7)

The board is the open sea. Every plate on it is a door, and the ship opens into its plan. Below the sea there are three
more levels, each a URL, so Back, a shared link and a TV pinned to a deck all work from the address alone:

| Level | Route | What it is |
| --- | --- | --- |
| Sea | `#/sea` (or no route) | the open sea: the fleet (on a phone, the page board; section 24.4) |
| Board | `#/board` | the page board (section 24), a view of the sea opened from its Lists door |
| Ship | `#/ship/<ship>` | the ship's plan: its six places as door plates on a cutaway of the ship |
| Deck | `#/ship/<ship>/deck/<place>` | one place: its list on the left, its room's art on the right |
| Item | `#/ship/<ship>/deck/<place>/item/<key>` | one row in full, unrolled over its place |

Preview keys ride after a `?` on a route: `#/ship/mac/deck/bridge?night=1`. The ship id is a machine id.
The flagship (the primary source's machine) carries the fleet-wide places; any other ship's places are the same views
filtered to that machine, so one ship per device needs no new view. An unknown ship says so instead of guessing.

### 16.1 The places

| Place | Holds (from the view) | Door on the sea | One item |
| --- | --- | --- | --- |
| Bridge | the calls (`attention`, `action`), then the lanes that wait for the viewer's OK under LANES WAITING FOR YOUR OK, with critical alarms first under PROBLEMS, the differences between calls and lanes under SOURCES DISAGREE (never counted), `info` under FYI, and last what the host set aside (feed 1.12) under DEFERRED and SOMEONE ELSE'S TURN (never counted); its door counts the asks only (the calls and those lanes, never an alarm, a difference or an FYI), the same number as the call band, the Lists header and the ship plates | the call plate; the alarm | why it needs you, the recommendation, age, the exact line to say and a Copy button, the PR, the linked lane's history, evidence |
| Gun deck | every lane not landed: off course first, then waiting, under way, scouting | the lane plate ("Under way") | its steps with times, its range, what it is doing, its history, PR, evidence; "nothing to say" unless a call names it |
| Chart room | `next` (queued, gate, held) and release checkpoints | "n ahead" in the bar | kind, why, what it waits on, until, filed; a gate's tiers, failing tests, commit |
| Cargo hold | `done`, today's first | the landed score | when, group, how, owner, PR, history |
| Crow's nest | machines (with their stations), who reports, queues, the library, tools, allowance | a hull plate (that machine's item) | each station's word, beat age and vitals; each reporter's age, pushes and gaps; a library folder's word and why, its last run, last change and what is not in the library ("?" when the receipt gave no count) |
| Logbook | what this screen's sea showed (section 17.4), the legend, and the host's received log (`GET api/log`) | the trust lamp | a sighting: when, what it means, what drove it and what the screen did; a push: what it counted, what it showed, what changed since that source's previous push, and whether the board agrees with it |

Items are read-only. SAY shows the exact words to type in chat (the feed's `attention.say`) and copies them; the page
sends nothing. Without the clipboard API (a plain-http TV) Copy selects the line instead. A row that vanished keeps its
route: the item says when it was last seen on the board.

### 16.2 Doors and keys

- Doors are links (`data-route`); a brass frame (`call_band`, 1 ap) marks the one under the pointer or in focus. Hover
  and focus are the only pixels a door changes on the board.
- Arrows move focus to the nearest door in that direction; Enter opens; Esc (or Backspace) goes up one level, as Back
  does when the page came from there. On the sea, Enter or the remote's OK with nothing in focus opens the Bridge.
- The TV (not the phone) sails back to where it was opened after `display.idle_return_s` (default 60) without input:
  the open sea, or the deck a pinned TV was opened at. `0` turns it off.
- The phone gets the six places as a 3 x 2 grid of doors under the call plate (the call band's top stays at or above
  320 CSS px), and every level is one column: the bar, a banner of the room's art, the list or the item.

### 16.3 Moves

The camera moves, the words don't. Every frame lasts 33 1/3 ms (2 refreshes at 60 Hz, 4 at 120 Hz, 1 at Safari's 30 fps
cap) and is chosen by elapsed time, so a slow frame is skipped rather than stretching the move. Plates fold in 2 frames
before the camera moves and unroll in 3 after (stepped `clip-path`, never a scale). Zoom frames draw the art with
`drawImage`, smoothing off, at a whole number of device px per art px and whole-px offsets; the last step of a zoom is
the theme's 4 x 4 Bayer dissolve (4 frames).

| Move | Frames | Time |
| --- | --- | --- |
| Sea to the plan, or a sea door to a place | fold 2, zoom 6 (ap to 2 ap, onto the ship or the place's spot on it), dissolve 4, unroll 3 | 500 ms |
| Plan to a place | fold 2, zoom 5 (ap to 3 ap, into the compartment), dissolve 4, unroll 3 | 467 ms |
| Place to place | fold 2, a 7-frame pan up or down through the deck planking (a 6 ap beam between the rooms), unroll 3 | 400 ms |
| Back out (to the plan or the sea) | the same, reversed: dissolve to the zoomed picture, zoom out | 467 to 500 ms |
| Open or close an item | the item plate unrolls 3 or folds 2; no camera | 100 or 67 ms |
| Reduced motion or `still` | the cut at once, with the old picture over it at half strength for one frame | 67 ms |

A click during a move ends it at once and starts the next; moves never queue. A swipe-back that brings its own
transition (`popstate` with `hasUAVisualTransition`) cuts. Idle time paints the pictures a move needs (the sea, the
plan, each room) so the first frame never waits on drawing. Nothing moves at rest on a deck: the rooms are still
pictures, and the ambient sea runs only on the sea.

### 16.4 Rooms (ship deck)

`scene.js` paints the plan and six rooms as static art, cached per room, size and light. The list plate covers the left
of the stage, so each room's focal piece sits in the window on the right: the ship's wheel (Bridge), cannons at their
ports (Gun deck), the chart table under the stern windows (Chart room), one crate per landing today under the hatch
(Cargo hold), one masthead lantern per machine, dark while it is silent (Crow's nest), the open log by the ship's bell
(Logbook). The world never says what the plates do not.

## 17. The world: stations and creatures (0.1.8)

The world is a projection with a legend, never a second truth. Every sailor's station and every creature is driven by
one named feed field; the plates and the Logbook say everything in words, and the world repeats it as place and mood.
Creatures are messengers: each has exactly one meaning, and nothing appears at random (the sea's own swell, clouds and
haze are physics, section 10). The core (`web/world.js`, `web/model.js`) decides what happened and when; the scene module
only draws what it is handed.

### 17.1 The legend

| On the sea | Driven by | Means |
| --- | --- | --- |
| A sailor at a station | `items[].phase`, else `progress.current.step` through `display.stage_of_step`, else the lane's state | the lane's stage (17.2) |
| A longboat rowing a chest home | a new `done[]` id | something landed |
| Dolphins leaping beside it | the same `done[]` id | the first landing on that ship in 10 min |
| Gulls on a ship's yard | `sources[].received_at` (the machine's reporters, at the page's live level) | its reporters are live; they fly off when it goes late and the next poll still says so (fog follows at stale, section 9.7) |
| A whale breaching | `groups[].checkpoint.live.version` changed | a release went live |
| A rainbow over a ship (0.4.1) | a `critical` in `attention[]` gone from the next report (its `machine`; with none, the flagship) | the critical on that ship cleared: the storm is over |
| Slack sails | `items[].progress.current.activity` = `quiet` on every running lane of a machine | becalmed: work runs there but nothing has stirred; each quiet lane's row says "quiet 42 min", and the machine's word is "Becalmed 42 min" (the hull plate when there is room, the phone, the Crow's nest) |
| Islands on the far horizon | `next[]` (kind, until, order) and the queue collector's freshness | what is queued next, nearer as its date comes (section 23.1) |
| Stern windows on a ship | `items[].agent.state` of that machine's lanes | an agent at the work: lit, dark or shuttered (section 23.2) |
| A stripe on the hull and a swallowtail pennant at the masthead | `machines[].id` (the FNV-1a hash of the id, modulo six, picks one of six fixed tones) | which machine, nothing more; never a state (section 25) |
| The lighthouse | this screen's own `GET api/view` | lit while the page reaches its host, dark while it hails (section 9.9), dim at anchor |
| Sound (opt-in) | `sound.enabled` | 17.6 |

The Logbook (section 16.1) carries this legend as one row under "What the sea means" that opens it in full, and each
sighting's item says what it means and what drove it, in words ("when each source last reported"; since 0.3.1 the page
never shows the field names themselves, section 20.4).

### 17.2 Stations by stage

| Stage | Station (stern to bow within a machine's section) | Pose | Comes from |
| --- | --- | --- | --- |
| none | a plain spot | the old hammer or hoist | no stage known: unknown is not build |
| `plan` | the chart table | bent over the chart | `phase`, or a step such as `plan`, `intent` |
| `build` | the workbench | hammer | `phase`, or `build`, `implement`, `rebase`, `fix` |
| `verify` | the inspection plank, on the rail | a lantern held over it; the hourglass mark when running long | `phase`, or `review`, `test`, `lint`, `document`, `validate` |
| `ship` | the signal staff, two flags flying above the sailor | hauling on the halyard | `phase`, or `push`, `pr`, `ci`, `deploy`, `merge`; an open PR (section 9.5) |
| `wait` | the rail | holding a scroll | a call or approval on the lane (it waits on you) |
| `land` | the barrels | sitting on a barrel | the lane landed |

Off-course poses keep their meaning at the station: failed smokes, blocked crosses its arms on a crate, paused or
waiting on its lead sits turned away, no word is a ghost outline. Scouts stay in the crow's nest. A station's furniture
stands on the rail line in front of its group (the rail hides the sailors' legs), and groups stand 3 ap apart. A
sailor whose stage changes walks to the new station in 3 whole-px steps of 100 ms; under `still` they are simply there.
At anchor the crew sleep in hammocks, with no stations.

### 17.3 Events

| Event | Lane | Time | Night | Rate |
| --- | --- | --- | --- | --- |
| Longboat | the ship | 6 s rowing from the lighthouse rock to the bow, 1 s alongside while the chests go aboard; up to 3 chests, a pennant in the group's colour | a lantern on its bow | every landing; bursts merge |
| Dolphins | the ship (with the longboat) | 1.2 s, two leaps | bioluminescent splash | once in 10 min per ship |
| Gulls fly off or settle | the ship | 0.8 s, 4 steps | none: gulls roost (said in words) | only on a change |
| Whale | the horizon, between the bow and the lighthouse (0.4.0: with escorts, the widest stretch of horizon no rig stands on) | 2 s, 8 steps | moonlit spray | once an hour |
| Rainbow (0.4.1) | the ship whose critical cleared: an arc from the horizon behind it, kept to its own stretch of the roadstead | 2.4 s: three dithered steps in, a hold, three out | a dim moonbow | on each clear; never while another critical is open (then in words) |
| Crew walk | (crew motion, not a creature) | 300 ms, 3 steps | same | on a stage change |

- **Announce once, then rest.** Each event plays once and is gone; only the gulls stay, as a state.
- **One creature event per ship at a time, two on screen at most** (the ship and the horizon), and only after the
  alerts' own motion (crow, storm, fog, hail, anchor) has finished. Priority: landing, then release, then gulls.
- **Bursts merge.** A landing that arrives while another waits its turn joins its longboat (one chest each, up to 3).
  Gulls that change back before their turn do not fly at all.
- **No celebration** while a critical is open or at anchor, and no event motion under `still`, reduced motion or in a
  hidden tab. The event is then said in words: the bar's landed line reads "+2 landed 14:02" (or "Skyforge 0.15 live
  14:20") for 60 s. An event that waits a minute for its turn is said in words the same way.
- **Never over a plate.** Creatures keep to the sea right of the call plate and below the bar; the scene canvas is behind
  every plate, so a text panel never changes a pixel.
- **The lighthouse beam** turns once in 8 s while the ambient sea runs (it is drawn by that loop); under `still`, or with
  the sea off, the lamp is lit and still.
- **Past full-scale escorts** (section 21.6) the longboat rows home in front of their hulls, never across their decks.

### 17.4 The logbook

Every event, held or shown, writes one line to this screen's logbook: when, what (the lane, release or ship, in plain
words), and what the screen did ("shown", "dolphins escorted it", "in words only: a critical is open", "merged"). Crew
walks, becalming and the wind returning, and the lighthouse going dark or lit are logged too. The Logbook deck shows the
newest 12 under "What this screen's sea showed", then the legend row, then the pushes. The log lives in the page (40 lines, kept across a
reload in session storage): it is what this screen showed, not a host record.

### 17.4.1 Last seen, and the replay (0.4.1)

A creature that came while nobody looked is still findable. The core (`web/sightings.js`, pure) keeps, per kind
(longboat, dolphins, whale, rainbow, gulls), the newest logbook entry that brought it: its time and its words, which name
the report that drove it ("Longboat home: Lobby: ready-check countdown"). An event that was only told in words counts
too, and says so ("told in words: a critical is open"). The key (section 20.5) shows one line per kind, or "not yet on
this screen". Like the logbook it lives in this screen's session storage.

**The replay** (the `R` key, or the key's REPLAY button) plays the newest real creature event of this screen's logbook
once more: the same creature with the same chests, dolphins, ship or flight. Honesty rules:

- only the newest: when it cannot be played as it was (gulls that no longer stand as that flight left them), nothing
  plays; never an older event, never a made-up one, and with no event it does nothing (the button reads "No event to
  replay yet");
- it is said as a replay: the bar's landed line reads "Replay of 14:02: Longboat home: ..." while it plays, the logbook
  writes a `replay` line, and the scene receipt adds "Played again on request: the last event";
- it obeys the board: nothing plays while an alert's motion runs, a critical is open, at anchor, under `still`, in a
  hidden tab or while that lane is busy;
- it is not news: it is not a sighting, and it neither rings a sound nor counts against the dolphins' or the whale's
  rate.

### 17.5 The scene receipt

`describe(scene)` returns what `paint` draws: per drawn ship its label, the sailors per station (or asleep), scouts,
sails (`set`, `slack`, `furled`, `none`), whether gulls are perched, the weather, its windows (lit, dark and shuttered
counted over every lane, and how many were drawn); the islands ahead (kind, due step and state of each drawn one, and
the true count); the lighthouse (`lit`, `dark`); and the
events playing. The core words it ("Atlas: 1 at the inspection plank, 1 at the signal staff, 2 at the rail, gulls on the yard.
Borealis: sails slack (becalmed), ... The lighthouse is lit.") into a polite live region (`#receipt`, so the canvas,
which is `aria-hidden`, has a text equivalent) and at the top of the Logbook.

### 17.6 Sound (opt-in)

Off by default (`sound.enabled: false`). On a TV only; the phone stays silent. Synthesized with WebAudio from
oscillators and noise, so there are no audio files to license. Three sounds: two bell strikes for a new call, a splash
and a creak when a longboat sets off, one low thunder roll for a new critical. Nothing for routine events, staleness or
host retries. Never in quiet hours, never twice for the same thing, and at most one in `sound.min_gap_s` (120). Every
sound is captioned on its logbook line ("sound: two bells"). Browsers allow audio only after one tap or key press on the
page, so a kiosk needs one tap after it boots.

### 17.7 Budgets

The motion budgets of section 10 hold. Creatures are drawn each frame by a small pass after the cached layers (a few
dozen rectangles), never into them; the ship's layers repaint only when the stations, sails, gulls or lighthouse change
state, and the crew layer 3 more times during a walk. Nothing animates at rest: with no event playing, the only world
motion is the lighthouse beam inside the ambient loop.

---

## 18. The honest board (0.2.0)

What the board says, and how loud, follows one rule: generic behaviour in the core and the feed spec, a tool's own
mapping in its adapter, personal choices in config. No state is inferred from silence.

### 18.1 Five classes

Every lane is in one class (the feed spec, "Lanes on the board"; `src/weatherdeck/lanes.py`):

| Class | Where it shows | Loudness |
| --- | --- | --- |
| needs action (failed, blocked, a call) | off course, first in the log, the Bridge | the only class with amber (on its call) and the door outline |
| running long | off course, after needs action | ink, in words ("running long, 52 min of typical 20") |
| waiting (gate, PR, person, capacity, quiet hours; until when) | its own count, its own section on the phone, after the rows that are Waiting on you, Stuck, Can't tell and Working in the log | calm ink2, never an alarm |
| quiet (no word, or a silent source) | after waiting rows | fog, last known |
| ok | under way, scouting, landed | calm |

A silent source's lanes turn quiet (last known) except those that need action, which keep their place and LAST KNOWN.

### 18.2 Row text

A row shows: glyph, project chip, title, state word, one-line summary, range, machine. The chip is the item's
`project` (else its group). A title that repeats its project loses the repeat, and every title is cut at a word
boundary to its column. The summary is the source's `summary`, else its `doing`; the opened row (16.1) shows the full
title, `doing`, `state_detail` and the last event.

### 18.3 Allowance chips

The host builds one chip per account (`meters.chips`, the feed spec): provider, account, the lowest window, the percent
left and the reset time, in a fixed order (provider, account, id). On the TV they are one last row of the log,
"ALLOWANCE  Orbit Team plan wk 18% Mon 07:08 · ...", each in the fullest form that lets them all fit; in the shortest
form those that still do not fit fold into "+N". A low chip is ink, an empty one trouble; never amber. The phone and the
Crow's nest give each chip in full words with its running-out sentence, which comes only from the source's projection. When
`display.tz` is null, reset words use the host zone and include its UTC offset at the reset time.

### 18.4 Landed

"Landed" is a rolling 24 hours by default ("LANDED, LAST 24 H"), or since `display.landed.day_start`
("LANDED TODAY"), so a board never reads 0 just after midnight.

### 18.5 Notes, not cards

A missing optional feature or a setup hint is a note (`events[].kind: "note"`), listed once under NOTES FROM SOURCES in
the Logbook, never a standing card in the call plate. The core has no words of its own for any tool's features.

### 18.6 Plates that move

A plate's position is set through the CSSOM (`el.style`), never as a `style` attribute, which the page's content
security policy blocks: a machine plate on the sea or a door on the plan moves with its words at every stage size.

## 19. Black holes (0.3.0)

Work that waits where nobody looks is said on the board itself, in words, and never in amber unless someone must act
(the feed spec, "Black holes"; `src/weatherdeck/gaps.py`).

### 19.1 No agent at the work

A lane whose agent's session ended, or whose endpoint is gone, for `thresholds.agent_gone_min` minutes is needs action
with the state word AGENT GONE (glyph `needs`, slot `needs`, tier action: core, never themed; a lane row says Stuck, section 9.5). Its row says how long
("its agent's session ended 14 min ago"), it sorts after failed and before blocked, and its opened row's Say box says
what to do instead of offering a line ("relaunch its agent or close it"). An agent idle between turns is never flagged.

### 19.2 The watch strip

On the TV one last row of the log, WATCH, carries what waits outside the calls, as chips in this order: queues backed
up, work waiting outside the fleet ("2 outside, oldest 2 d"), merges not shipped ("Web 4 not shipped, oldest 2 d"),
queues still moving, and the next two coming-up dates. Each chip has a fullest and a shorter form, every form saying
what it counts; when even the shorter forms do not fit, the rest fold into "+N" (the phone and the decks list them all).
Backed-up queues are ink, the rest ink2. The row takes one lane row from the log while it has something to say.

### 19.3 Places

The phone adds sections WAITING OUTSIDE (each with who and for how long), QUEUES (waiting, oldest, held of cap, who
holds), SHIPPING (behind, oldest unshipped, the two versions) and COMING UP (when, what, what ends). The Chart room
gains sections WAITING OUTSIDE, COMING UP and SHIPPING after AHEAD (its door still counts only what is ahead); the
Crow's nest gains QUEUES, and each reporter's line names a collector whose answer is old ("tracker 14 min old").

### 19.4 Freshness and answer age

The call plate says how old the answer behind its number is: on the TV in the band ("ANSWER 12 MIN OLD"), on the phone
as the first line under the calls, and on the calm plate after its sentence. A collector past its limit, or failed, is a
line in the trust line ("atlas-main: tracker answer 14 min old"); it does not turn "Nothing is waiting on you" into
a past fact unless its source is silent.

### 19.5 Burn rate

An allowance chip whose source projects it runs out before its reset leads with the countdown ("Orbit Team plan wk 18%
out in 3 h 10 min"), and its sentence says both the countdown and the time. The host never works out a rate.


### 19.6 Slowed on purpose (0.7.0, feed 1.4)

A source whose feed says `pace.factor` above 1 has stretched its own intervals (a busy machine, battery power, a spent
budget). It is said in words, never by a creature or a colour alone, in three places:

- the trust line, before any old answers it explains: "atlas-main: slowed on purpose (the machine is busy), reports about
  every 3 min" (labels `trust_slowed`, `pace_why_load`, `pace_why_battery`, `pace_why_cpu_budget`, `pace_why_run_budget`,
  `pace_why_none`);
- the Crow's nest, on that reporter's row ("slowed on purpose", label `slowed_short`), and in its detail: PACE ("slowed on
  purpose to every 3 min, normally 1 min: the machine is busy · for 4 min") and COST ("CPU 41.5 s an hour (budget 60 s),
  last pass 2.4 s (budget 10 s)", with "not measured yet" for a figure the source did not measure, and "over budget"
  when it says so);
- nowhere else: no lamp changes, no new creature or sound, and the call plate, the lamps and the lighthouse keep
  their rules. The lamp counts in the interval the source declared, so a slowed source on time is lit, and one that stops
  is dimmed, then silent, in multiples of the slower interval.

A source that sends no `pace` gets no words about pace at all.

### 19.7 The library (feed 1.10)

Each mirrored folder a source reports (`gaps.mirrors`, the feed spec's "Library") is one row with one of eight words: UP TO DATE,
WAITING n, FAILING, NOT CHECKED (with how long), SILENT (with how long, and the last word as last known), UNKNOWN, NOT REPORTING
and RETIRED (with its date), worst first. The words are labels (`lib_*`), and every row says what it rests on: "checked 14 min
ago", "last change 2 d ago", and the word's reason ("nothing new since Mon", "sync last ran 9 h ago; the board cannot tell why",
"no source reports this folder", "the receipt could not be read"). It is drawn in four places:

- the TV log (a scene layout): one last row, LIBRARY, a chip per folder in the fullest form that fits ("main/ UP TO DATE ·
  CHECKED 14 MIN AGO", then "main/ UP TO DATE", then the folder's last part), the rest folded into "+N"; it takes one lane row
  from the log while it has a row to show;
- the page board's quiet rows, after the tools, each chip in its fullest form;
- the phone's LIBRARY section and the Crow's nest's LIBRARY section (each folder on its source's ship, a folder no source reports
  only on the flagship), with the opened row's last run, last change and the count not in the library.

Calm, never a call: FAILING and NOT CHECKED are ink, waiting and up to date ink2, silent, unknown and not reporting fog; never
amber or trouble, and no card, creature or sound. A silent source's rows say SILENT on this page's own clock, as its lanes do, and
their ages stop. A folder no source reports is drawn only when the host config lists it.

## 20. At a glance (0.3.1)

A board read from across a room, or opened once a day, says what changed, how long things have been as they are, and
what everything on it means (the feed spec, "The view at a glance"; `src/weatherdeck/glance.py`).

### 20.1 Since you last looked

When a screen comes back (the page opens, or its tab is shown again) after `display.since_last.min_away_min` (10) or
more, a plate says what changed since its last look: "SINCE YOU LOOKED 3 H AGO" (or "SINCE 3 H AGO" where that does not
fit) over "3 landed · 1 new call · 2 newly stuck", with a GOT IT button. It stays for `display.since_last.show_min` (15)
or until GOT IT; then the screen's look moves to now. While a screen is looked at with nothing to show, its look
follows it (every 30 s, and when the tab is hidden). The look lives only in that browser (`localStorage`), holds no ids
or titles, and is never sent to the host; a browser that blocks storage simply shows no plate. TV: zone `since`
(ship-deck: the top of the scene window). Phone: over the bottom of the scene banner, so the call keeps its place.

### 20.2 Age in state and the oldest wait

Every lane row says how long it has been in its state, right after its state word ("YOUR CALL 2 H 11 MIN", "NEW" under a
minute), from the host's `items[].age`, counted on while its source reports and frozen while it is silent. A row whose
source gave no time for its state shows no age; it is never guessed. The log head's waiting count carries the oldest
wait ("3 WAITING, OLDEST 2 D 4 H"); the phone opens its lists with the oldest wait and its lane.

### 20.3 Grouped by project

Rows group by project first and machine second (`items[].row.order`), the project as the row's chip. The TV log keeps
off-course rows first (most urgent kind first, then by project); the rows below them, the phone's lists and the decks
are in project order. The Gun deck heads each project with its counts ("INKWELL · 3 LANES · 1 OFF COURSE · 2 WAITING")
and names each row's machine at the start of its second line.

### 20.4 Plain words

Times on the page are relative ("12 min ago", "just now", "in 3 h") or a clock time with its day ("Tue 14:00",
"today", "yesterday", "12 Oct"); never an epoch, an ISO date or time, or an internal label (snake_case, a template
placeholder). The release check walks every place and opened row for these.

### 20.5 The first visit, the key and doors on the stage

- **First-visit hint (the phone only, since 0.4.1).** Once per browser, over the phone's banner: "TAP THE SHIP TO LOOK
  INSIDE". It goes for good on GOT IT, on opening any place, or after `display.hint.show_s` (180) seconds of being
  shown; `display.hint.enabled: false` never shows it. The TV layout (a TV, a wall screen, any window 700 CSS px or
  wider) never shows it: a TV has no pointer and often no remote, so its GOT IT would stay over the sea for good. The
  key below still explains the board there. (0.3.1 to 0.4.0 drew a TV hint in zone `hint`; that zone is gone.)
- **The key.** A small `?` button (zone `key`) and the `?` key open a legend plate (zone `legend`; 0.4.1: the whole upper
  area): every glyph shape with its word and what the sea's things mean on the left; on the right each creature's last
  sighting (section 17.4.1) and "Every colour comes with a shape or a word."; in its head the replay button beside
  CLOSE. Esc or CLOSE shuts it. The phone lists the same key at the end of its page.
- **Doors on the stage.** Every clickable thing on the TV stage shows a dashed brass frame and a caption saying what it
  opens while it is pointed at or has keyboard focus: the ship (its places), the lighthouse (the Logbook), a ship's
  perched gulls (its Crow's nest row), and a longboat or whale while it is on the sea (the Cargo hold, the Chart room).
  A scene module names these in `layout()` as `hits[] {kind, x, y, w, h, on?, machine?, i?}` in stage art px; arrows
  reach them like any door. On the phone the scene banner is one door, to the ship's places.
- **Never colour alone.** Each colour cue has a shape or a word beside it: a door outlined in amber also carries the
  `needs` glyph (and its label says "needs action"), a backed-up queue says "backed up", a silent row is dotted and says
  LAST KNOWN, and every state has its glyph.

### 20.6 The auto-tour

For a TV with no pointer, `display.tour` (off by default) visits places in turn: after `pause_s` (120) without input and
`sea_s` (240) on the open sea, each of `places` (Bridge, Gun deck, Chart room, Crow's nest) for `dwell_s` (20), then
home. Any key, tap or click stops it where it is (the idle return brings the screen home later). It never starts while
a critical is open, the host does not answer or a call has just arrived; the deck's hint plate says it is touring, and
its moves replace history entries so a TV touring all day keeps a short history. `#tour=1` (or `#tour=fast`) forces it
on to check it, except on the television profile (the `tv` view, any household-level or privacy profile), where the option is refused
whatever the config or the hash says and the console says so: a TV is never auto-paged. `#fresh=1` forgets this browser's last look and first-visit hint.

## 21. One ship per machine (0.4.0)

World direction A, step two: the sea is the fleet. A ship is wherever work runs: its identity is the feed's machine id
(a laptop, a desktop, a CI service). The host decides the fleet's shape (`src/weatherdeck/fleet.py`; the feed spec, "The
fleet"); the page judges each machine on its own clock and the scene module draws what it is handed.

### 21.1 Rules

- **Ships never swap places.** The order is the flagship first, then `display.fleet.order`, then the rest by name (case,
  hyphens and underscores folded). It never depends on state. A ship keeps its slot; a sailor keeps their ship.
- **One signal per element.** Each thing a ship shows comes from that machine alone, and the hull plate says it in
  words:

  | On a ship | Driven by | Means |
  | --- | --- | --- |
  | where it lies | its slot in the fleet order | the flagship in front; escorts on the roadstead behind it, right of its bow |
  | the hull plate | the machine's pip and word (section 7) | OK, DRAINING, ALERT, SILENT 16 MIN, LOST 16 MIN, ASLEEP; reserved and maintenance in neutral ink2 with their until |
  | weather over it | its own state: storm (a critical on it), squall (not answering), rain (struggling), fog (silent, lost or no word), clear | nothing about any other machine |
  | sails | set (work on it), slack (becalmed, section 17), furled (moored or at anchor) | |
  | berth | at sea; moored (furled, a line to a bollard) when idle and well: a calm state, no lane and no call on it; at anchor (furled, its cable out, a dim lantern) when asleep (`display.may_sleep` in quiet hours) | silence never moors: a silent, lost, struggling or alerting machine stays at sea |
  | lantern | lit; dark when its reporters went silent; dim at anchor | |
  | crew | one sailor per lane on that machine, at the station for its stage (section 17) | |
  | gulls | its reporters are live (section 17) | |
  | stern windows | `items[].agent.state` of that machine's lanes (section 23.2) | one window per lane with an agent to be at: lit, dark, or shuttered when none is reported |
  | livery | `machines[].id` (section 25) | a hull stripe and a masthead pennant in one of six fixed tones: which machine, never a state |

- **Redundant, never sole.** The plates, the bar's pip line on the phone, the Crow's nest and the scene receipt say
  everything; the ships repeat it.
- **Bounded.** At most six ships are drawn (`display.fleet.max_ships`, at most 6): the flagship and five escorts.
  Past them the rest gather as one **convoy**: three distant silhouettes with one count plate ("+3 SHIPS · 1 ALERT"),
  whose count is always the true total and whose words name every state that is not OK, worst first. A ship carries on
  deck only the sailors that fit (an escort at most six), the most urgent first (calls, failed, blocked, running long,
  no word, then the rest in order); the others are **below decks**, said on the flagship's plate ("+6 BELOW"), in each
  ship's door caption and in the scene receipt ("6 more below decks").
- **Monotonic.** More trouble never looks calmer: the ships drawn and the convoy keep their places as states change, the
  convoy plate's words only grow with trouble, and a quiet machine is never moored.
- **No false precision.** A ship's size follows how many sailors stand on it, never a percent; distance on the
  roadstead is order, not importance.

### 21.2 The TV roadstead (ship deck)

With more than one machine the horizon rises to y 128 and the roadstead opens on it, inside the scene window (beside a
call: 384, 41, 236, 164; on the open sea, section 21.6: the whole upper area):

- **Stretches (0.4.1).** The window's width is shared out by the core (`src/weatherdeck/fleet.py` `roadstead`, the view's
  `fleet.roadstead`, the scene's `fleet.slots`): the flagship's stretch first, then one equal stretch per escort in the
  fleet's order, then the convoy's at the far edge, 2% (open sea) or 1% (beside a call) of the width apart. Only the
  number of ships and whether a convoy sails decide them, never a machine's state. **No escort ever covers another or
  the lighthouse**: each is drawn inside its own stretch, and the stretches end before the lighthouse rock.
- **The flagship** in front at full scale (deck 180, water 205), from the start of its stretch, its deck as long as its
  crew needs but no longer than its stretch, and at least 96 ap: with five escorts beside a call its stretch is shorter
  than that, so it sails in front of the first escorts (it never hides their plates). Its masts follow its length (one;
  two past 120 ap; three past 190). Its sails furl when it is idle and well; it never leaves the front.
- **Escorts at half scale** (beside a call; on the open sea from four ships), drawn natively at that size: 8 x 12 ap
  sailors, a hull of 5 ap a sailor, one mast 34 ap high, two sails, centred in their stretch on the horizon (water at
  the horizon + 10). A stretch holds as many sailors on deck as fit (at most six); the rest are below decks. Each floats
  on its own small swell, one whole pixel at most.
- **Escorts at full scale** (the open sea with three ships or fewer, section 21.6).
- **The convoy** in its stretch at the far edge.
- **The harbor** is the quay along the horizon from the first half-scale escort to the lighthouse rock. A moored escort
  lies in its own stretch with a line to a bollard (a full-scale one to a pile of its own): it never leaves its stretch.
- **Weather and fog stay local (0.4.1).** Each ship's storm cloud, rain and fog bank are drawn clipped to its own
  stretch (the flagship's: its stretch, or its hull when it sails in front), so a silent escort still shows its own fog
  honestly and never fogs a neighbour. Only lost contact (every source silent) fogs the whole sea.
- **Plates.** The flagship's under its hull (y 185); a full-scale escort's under its hull; half-scale escorts take turns:
  the first over its masthead, the next under its hull, and so on, so each row has room for its words; the convoy's
  under it. Each row is laid out on its own: words give way to short words, then words only for alarms and silence,
  then none; then plates spread apart; last, names are cut (the convoy's count never is).
- **Doors.** Each escort (`layout().hits` kind `escort`, with its `machine`) opens that ship's places (`#/ship/<id>`,
  its decks filtered to that machine); the convoy (kind `convoy`) opens the Crow's nest; the flagship keeps the ship
  door to the fleet's decks. A move into an escort centres on it (`layout().spots["ship:<id>"]`).
- **At anchor** the escorts lie furled beside the sleeping flagship with dim lanterns (the stern lantern stays the one warm light), each in an equal stretch of its own; their crews sleep below (the receipt says so).
- **Creatures.** The longboat still rows to the flagship (it carries the fleet's landings); gulls perch on any ship's
  yard; the whale breaches in the widest stretch of horizon no rig stands on; the rainbow rises behind the ship whose
  critical cleared, inside its stretch.

With one machine and a call waiting nothing changes from 0.3.1: one ship at the old horizon.

### 21.3 The phone

The banner shows the flagship. Under the call plate, a **convoy strip** (zone `fleetstrip`, only with more than one
machine) lists every ship in the fleet's order as a mini ship (the scene module's `mini`, 64 x 52 ap, still), its pip,
name and short word, and, past the ships drawn, one convoy tile. The strip scrolls sideways inside itself (the page
never does); each tile is a door: a ship opens its places, the convoy the Crow's nest. A theme without `mini` shows the
same doors without art.

### 21.4 The receipt and the key

The scene receipt names each ship's role and berth: "Flagship Aster: 2 at the workbench, ... 6 more below decks. Birch:
1 at the signal staff, gulls on the yard. Elm: no crew, moored in the harbor, sails furled. Fern: ..., at anchor, sails
furled, its lantern dim. A convoy of 3 more ships (1 alert)." The key and the Logbook's legend gain "Ships: one per
machine · furled: idle · dim lantern: asleep".

### 21.5 Budgets

Each half-scale escort is a small cached layer repainted only when the scene changes; a frame blits at most six of them
and one still harbor layer. A full-scale escort (at most two) has the flagship's own three cached layers and float.
Measured with `#ambient=stats` for 1 to 7 machines in the 0.4.0 and 0.4.1 notes (CHANGELOG): within section 10's
budgets.

### 21.6 The open sea (0.4.1)

On a TV, with nothing waiting on the viewer, the sea is the board's picture rather than a window beside a panel:

- **When.** The TV layout, a theme with a scene and an `open` zone set (zones.tv.open), the board screen (not the
  anchor, hailing, lost contact, empty or loading), no call and no unverified waiting number (model.js `B.open`). A call
  arriving brings the panel and the narrow window back at once (its crow flies in as ever); when the last call goes,
  the sea opens again.
- **The call plate is one banner line** (zone `open.call`): "NOTHING WAITS ON YOU" (or "NOTHING WAITED AT THE LAST
  REPORT" while a source that has reported is not reporting), then the calm line ("22 under way, 0 off course, 15 waiting, 13 landed in
  24 h."), the answer's age and the "also" notes, cut to fit. A screen reader hears it all; it is still the Bridge's door.
- **The scene window is the whole upper area** (zone `open.scene.window`, 20, 41, 600, 164); the masts start below the
  banner line (the flagship's top at y 70). The since plate moves under the banner, at the left (zone `open.since`).
- **One ship** has its own stretch in the middle of the sea (10% to 80% of the window).
- **Two or three ships: escorts at full scale.** Each escort is drawn with the flagship's own art (16 x 24 sailors at
  their stations, station furniture, scouts in its nest), a little further off: deck 152, water 176, masts from y 72
  with sails at 0.75. It has its own plate under its hull (with its own "+N BELOW"), weather, fog, lantern, gulls and
  float, all inside its own stretch. With three ships the flagship has half the width and each escort a quarter.
- **Four to six ships** keep half-scale escorts, one equal stretch each across the horizon right of the flagship.
- **Minimum size.** Everything is drawn natively at whole art px, and the stage scales by whole device px (section 3):
  at 1080p one art px is 3 device px (a full-scale sailor 48 x 72 px, a half-scale one 24 x 36 px, a plate's words
  33 px), at 4K 6 device px.

The scene module is told the window (`window`, stage art px) and `open`, and reads the stretches from `fleet.slots`
(section 12); a module that ignores them still draws inside the narrow window.

## 22. Versions per machine (0.5.0)

The board says which software each machine's reports come from, from the feed's `producer` (feed spec, "Versions per
machine"); nothing is drawn for it, so no creature, light or number is added.

- **Reporter rows** (Machines, "Who reports"): the sub line ends with the adapter ("adapter 1.10") or "version unknown",
  and "older adapter" when the source is flagged. Opening the row lists Adapter (with the producer's name), Pusher
  ("pusher 1.9" or "pusher version unknown"), Runs on (the feed's `producer.host`, only when given and not redacted) and a
  Version gap line per reason, each "NAME runs adapter V, older than SINCE, which OTHER already runs (NEWER): EFFECT". A
  machine row gives one Software line per reporter ("NAME: adapter V · pusher V · HOST", the host left out when not given
  or redacted, "version unknown" and "pusher version unknown" when not reported), and the gap lines.
- **The watch strip** (TV): one chip per flagged source, fullest first ("NAME adapter V: EFFECT"), then "NAME adapter V is
  older than SINCE", then "NAME adapter V behind".
- **The trust line**: "NAME: adapter V is behind, see Machines", counted with the old-collector notes (it does not turn the
  all-clear into a past fact).
- **The phone** has a SOFTWARE section after SHIPPING: one item per reporting source with its adapter (or version unknown),
  pusher, where it runs and the gap lines.
- Never colour alone, never a guessed version: a source that did not say shows "version unknown".

## 23. The far horizon and the stern windows (0.6.0)

Two more pictures that carry a real field each; neither is decoration. Both are drawn into cached layers (the sky and each
ship's hull) and repainted only when the scene's revision changes, so they cost nothing per frame, and nothing moves: no
island drifts and no window flickers without a change in the feed.

### 23.1 Islands ahead

One island for each entry in the feed's `next[]` (the merged view's `next`), and none otherwise: with `next[]` empty or
missing the far horizon is empty and the receipt says "No islands ahead: nothing next in the feed". Nothing is added to fill
the horizon, and no island is random.

| Feed | Picture |
| --- | --- |
| an entry in `next[]` | one island; at most three (one on the phone banner); the bar's "n up next" and the receipt keep the true count, and say how many are not drawn |
| `kind` `held` / `gate` / `queued` | a mist bank over the island / a beacon post with a pale light / a plain island. Any other word is a plain island |
| `until` (a date) | its step by days from today on the page's calendar: today or earlier is near and large (step 3), tomorrow middle (2), a later date far and small (1), each farther step also hazier. The picture never says how many days |
| no `until` | the step comes from order: the first of the undated is step 2 (next in line), the rest step 1. A value that is not a date counts as no `until` |
| order | dated entries first, soonest first, then holds and gates, then queued work, each in the source's order; the first three are drawn |
| the entry's source's `queue` collector `error` or `stale`, or older than `thresholds.collector_stale_s.queue` | the same island as a **dotted outline**: the last known, and shown as not known to be current |
| the entry's source silent (stale, lost or absent, section 9.7) | the island under **fog** (a fog outline with a dithered body, like a sailor from a silent lane) |

Placement is the widest stretch of horizon inside the scene window that no rig stands on (the lighthouse, every ship's
sails, each half-scale escort and the convoy are in the way), the nearest and largest island first, never over another;
only when no free stretch is left does an island stand behind a rig. Islands are drawn on the board screen only (not at
anchor, hailing, lost contact or below decks). At night each has a moonlit rim on its ridge. Sizes are 44, 32 and 22 art px
wide (9, 6 and 4 tall) for steps 3, 2 and 1 on the TV; the phone banner's one island is 36, 30 or 24 wide.

### 23.2 Stern windows

One window for each lane on the ship's machine that has work an agent should be at, in the stern castle of a full-scale ship
(up to four) and along the side of a half-scale escort's hull (up to four, fewer on a short hull); the phone's banner and the
convoy strip's mini ships show them too. The field is `items[].agent.state` alone, as the core sets each lane's `light`:

| `items[].agent.state` | Window |
| --- | --- |
| `alive` | **lit**: pale glass (the lantern's, never a status colour) |
| `ended` or `gone` | **dark glass**, as soon as the feed says so: the AGENT GONE card (section 19.1) follows after `thresholds.agent_gone_min`, and the receipt counts the window either way |
| no `agent` record, or a state this page does not know | a **shuttered** window (closed slats): "not reported", never dark and never lit |
| the lane's source is silent or the host is unreachable (its report is old) | shuttered: the state is not known now |
| the lane is finished work (landed, a pull request open or unread) | no window: it needs no agent |
| the lane failed | no window: it needs no agent, and it is flagged as needing action separately (section 7) |

An agent that is idle between turns is `alive`, so a lit window never says busy against idle (the feed does not either). With more lanes than windows, the ones that
need a look come first (dark, then shuttered, then lit) and keep their lane order; the receipt counts every lane ("windows 2 lit
(agent alive), 1 dark (agent ended or gone), 1 shuttered (no agent reported) (3 more not drawn)"). A ship with no such lane has
no window. This replaces the old row of portholes, which was lit at night whatever the fleet did and sat under the hull plate;
no light on a ship now lacks a field. A window is 4 x 6 art px (a half-scale escort's 4 x 4), so 12 x 18 px at 1080p and 24 x 36 at 4K.

### 23.3 Key, legend and budget

The key's "On the sea" line and the Logbook's legend gain "Islands: queued next" and "Stern windows: an agent at the work",
each with what drives it in words (section 20.4: never the field names). No new feed field and no new config. Budget: nothing is drawn per frame for either (the islands are in the sky layer, the windows in each hull layer); `#ambient=stats` on the open sea read an average of 1.08 ms a frame with the scenario against 0.97 ms without it, on a busy shared machine in headless Chrome. The demo's
`horizon` and `horizon-open` scenarios (five items next, three agent states, a stale queue report after 45 s and a silent source after 90 s)
show every state.

## 24. The page board (0.7.0)

The page board is one scrolling document (`web/page.js`, styles at the end of `web/style.css`), approved as a mock-up by the
maintainer. From 0.7.0 to 0.8.0 it was the board's normal screen on every size; since then (Unreleased) it is a view the viewer
opens, and the open sea is the front door again (section 24.4). The take-over screens (loading, empty, lost contact, hailing the
host, at anchor) and every place below decks keep the stage of sections 3 to 9 and 16; a move between the page and the sea or a
place is a cut, because a document has no picture to zoom. The page sets `data-page` on the root; the stage's zones, the call
plate and the log are not drawn while it is on.

From the top: the header (on a TV-sized screen, **Open sea**, the way back out; the clock, "N of M feeds report" (a placeholder source, one never seen, is not in M) with the newest report's age, and the **Key** button, which sticks to the top on every size);
what changed since this screen last looked; the three-state strip; the places below decks, each with its caption; the lanes
in the one order (24.2), the working ones grouped by the goal they serve (else by project), with the sea after them; and one quiet block of what waits where nobody looks, the allowance and the tool cards.

### 24.1 The strip: needs you, problems, all fine

- **Needs you** lists the asks (the calls, then the lanes that wait for the viewer's OK that no call names, as in 9.2), with the
  number's age beside it and, when the calls and the lanes disagree, the "Sources disagree" badge and one line per difference
  above the asks. It lists the calls the host lists (`attention[]` that wait on the viewer, never a keyed status), each as its title, its
  reason (two lines, "Read all" opens the rest), what the source recommends when it sent one, how long it has waited (or "as of"
  when its source is silent), where to answer and the exact line to say with a Copy button. It makes no option list of its own:
  the feed has no options field, and nothing is read from prose. When the call's feed sends `answer_link` (feed 1.6) the call carries one plain
  link, "Open the review board", that opens the review board where the call is waiting in a new tab (not the call's own card: the board
  has no per-card anchors yet, and a per-card deep link needs a change in the board template, outside this repository), with "board link checked N min ago"; when the feed says there is no link, the call
  says the source's own reason in words ("no review board is open for this home") with the same age, never a stale address. It is not a button,
  runs no script and writes nothing; the television, guest and public views carry no `answer_link`. A door opens the call's page here.
- **Problems** (called Needs attention before) lists, in this order: the critical cards; lanes whose word is Needs attention (or, for a feed that sends no lane
  word, lanes whose row word is Stuck); the lanes whose row word is Can't tell, one line per machine; a feed that is silent, rejected or
  missing; a collector that failed or is disabled; a waiting number that could not be verified; and add-in cards that read bad. A line carries its icon and says what is wrong.
  A tool's own incident cards join it as add-in cards when a tool sends them.
- **All fine** is lit only when both lists are empty and every expected feed reports. A collector that failed or is disabled is a line of Problems, so a surface the board could not read never reads as fine. Otherwise it is dim and says how much is open.
  A silent feed is itself a line of Problems, so quiet never hides a silent source. The number on Needs you is the one
  waiting-on-you number (the call band's, the Bridge door's and the ship plates'); nothing on Problems is counted in it. A copy whose
  maker stopped remaking it (feed 1.12 `made_at`, past its limit) is a line of Problems and leads the header's trust line: "its queue copy
  was made 40 min ago and is remade every 5 min: STALE". Its age is the made age, never the age of the file or of the read.
- **Deferred · someone else's turn** (0.10.0, feed 1.12) sits under Needs you, in its column, folded until tapped; it is drawn only when
  the host set something aside (the view's `aside`). Its head says how many in each group ("Deferred 2 · skipper's turn 3") and the open
  fold says "Not counted in Needs you." **Deferred** lists the viewer's dated holds that still hold, cards and queued rows alike, soonest
  first, each as its whole title and "until Thu 22 Oct · <the hold's reason>". The second group is headed "<name>'s turn" when every row
  names one actor, else "Someone else's turn", and lists each as its whole title and "<actor> owns it · since 3 h ago · waits on the fleet
  verdict: pending". A missing date, reason, owner or age says "not reported". Nothing here is a call, counted, amber or on a ship plate.

### 24.2 A lane row

One state icon and word, the same six row words as the sea's log (9.5: Waiting on you, Stuck, Can't tell, Working, Waiting on
someone else, Finished, each with a fixed icon shape and the board's status colour; colour is never the only signal; "Stuck" keeps
the source's cause beside it), how long the lane has been so (or its last word and age for Can't tell, or "since: not recorded"),
the job in plain words (the item's whole title, wrapped, never cut on the page; `lane.short_title` only when there is no title (0.10.0);
"short name only" when the source says the only title is the task's name; "title not reported" when there is none, never the task id), its project and machine ("machine
not reported" for a second-hand lane), the one sentence worded from `say[]`, and the worker's own notes (`doing`, `state_detail`,
the last event, the agent's reason) behind a tap. A part of `say[]` this page has no words for is left out; the source's own nine
words (the feed spec's "Lane state") still order, count and fold a group's rows. A lane whose feed sends no lane word says "No lane
word sent", and its word and sentence come from its structured fields only (9.5); nothing is read from its prose. A lane whose word is
Can't tell but whose last word was done or paused says what its record holds instead (0.10.0): Waiting on someone else, "Finished;
waiting on upstream review of PR #12" (its PR open), Finished, "PR #12 has merged" (merged), "Held; no worker is moving it" (a hold on
record), or, after a paused last word, "Paused; its PR #12 is waiting on upstream review" / "Paused; its PR #12 has merged" (never
"Finished"), or with no PR and its worker's session ended "Branch only, no worker running" (feed 1.12 `branch: true`) or "No PR is recorded and
no worker is running", each followed by "The last thing it said was that it was done, 6 d ago". A Can't tell row with a recorded last word
leads with it ("The last thing it said was ..., 6 d ago; nothing newer is recorded"); "Its state can't be read now" is said only when
nothing it said is recorded. A machine's row says its lanes across every home on it (feed 1.12: "lanes 3 running of 5 · 2 homes"), early in
its vitals. The household view
hides worker notes and keeps titles; a guest or public view's replaced titles carry no "short name only". An instruction waiting
unread in the lane's steering inbox is one amber line under the title, the same line as on the sea's log (9.5); a lane that carries
one is never folded, and an escalated one sorts with the group's Stuck rows and brings its group forward like one (Unreleased).

**One order.** The sea's log and the Lists page put the lanes in one order, from one function (`web/frontdoor.js` `sortRows`) and one
list (`display.row_sort` in `defaults.json`: `you`, `stuck`, `unk`, `work`, `other`, `done`, `housekeeping`, the keys of the six row words
and the folded last place): Waiting on you, then Stuck, then Can't tell, then Working, then Waiting on someone else, then Finished, and last
the old records. Inside Waiting on you and Stuck the longest-waiting row is first, from the host's age in state (`age.since`); a row with no
age follows the rows that have one, keeps its place and says nothing of how long. Inside every other word the rows go by project (`row.order`),
then start time; a tie keeps the feed's order. An old record (`web/frontdoor.js` `isOldRecord`) keeps its word and sorts last, never above a
live row, and on the Lists page it is folded under "Housekeeping: N old records", closed until a tap lists them; the phone's list ends with the same
fold, and the sea's "+N more" line counts them as "N old records". These are the old records the board can tell from the feed alone, each with
its reason as its sentence (`hk_*` labels):
- **Old approval**: a lane that says it waits for the viewer's OK (`handoff.state: awaiting_you`) whose PR merged ("PR #1 merged, nothing left
  to approve") or was closed unmerged.
- **Finished but never closed**: a lane whose PR merged and whose worker's session ended (`agent.state` `ended` or `gone`) while its record
  never said it finished, as a lane paused after its PR merged ("PR #6 merged, and its worker's session ended 4 d ago"). The host never
  calls it agent gone (feed spec, "No agent at the work").
- **Old record**: a row that reads Can't tell only because its books are old (the "status-log superseded" and "harness state unavailable"
  lines, 9.5).

Nothing in Housekeeping is counted: not in the waiting-on-you number, off course (the log's header, the phone's list, a project's head on the
Gun deck), a ship's trouble badge, the Gun deck door's outline, the Problems lines, the waiting count or the waits outside the fleet, and none of it is the oldest wait. The
page never closes or changes any of it: it only folds it and says why (Unreleased). A word the list leaves out sorts after the listed ones; an empty or missing list
is the six words in order. The Lists page draws one card for each word (its name and "N lanes"); where Working falls it draws the goal and
project cards below, each listing its working lanes in that order and counting all its lanes in its header, and a goal or project with no lane at
work is a counts line after the last card. A page with the same lanes lists the same first rows as the sea, in the same order.

Working lanes are grouped by the goal they serve (feed 1.7, the view's `goals[]` and each item's `goal`), and a lane no goal names by project
(`row.order`); the cards come in the order their first lane has in the one order. A goal's header is its name (the owner's own words) and one count line: "N lanes", then the
lanes' words as below, "N next" (`next[]`) and "N done" (`done[]`), each read as the host counted the rows, with "or more" beside any count its
`or_more` names, so a capped count is never a total; a count of nothing is left out, not drawn as 0. A goal with no lane in flight is one line,
its name and its counts. A project group beside goals carries the tag "no goal set: shown by project", and its queued and landed counts leave out
the rows a goal claimed. Each group's counts say how many lanes are in each word (a lane with no lane word counts as "N with no lane word", one with a
word this board does not know as "N with a word this board does not know"; each count shows once per group), how many are queued (`next[]`, by group label), and how many landed
("N done, or more": the feeds cap what they send, so a count is never a total). Lanes waiting on a check fold into one line
("+N waiting on a check", what they run, how many have no news and since when) from three lanes up; a tap lists them. With no goals set (no `goals[]` in the
view, which is also what a guest or public view has) the board groups by project exactly as before and says so once ("No goals are set: lanes are shown
by project"); it is not an error and nothing else changes.

### 24.3 Captions and the key

Every place and every picture has a one-line caption (the `deck_*_what` words and `pic_*` / `cp_*` labels): the places under their names, the
sea's ship, sailor, crow, lighthouse, islands ahead and lit windows under the picture while they are drawn, and every picture in the key. The
sea is the scene's 236 x 164 art-px window onto the stage, painted in whole (or quarter) device px at the width the column gives it.
The key lists the six row words with what each means, then the pictures, the places, and when each creature was last seen; `?` and Esc work as before.
It uses no feed field not named here, no model call and nothing new per refresh.

### 24.4 The front door: the open sea, and the Lists door (Unreleased)

Which screen a route shows is one pure rule (`web/frontdoor.js` `pageBoardOn`, tested in `tests/test_frontdoor.py`):

| Route | TV layout (window 700 CSS px or wider) | Phone layout (narrower) | Television profile (any size) |
| --- | --- | --- | --- |
| `#/sea` (or no route) | the stage: the open sea with the fleet | the page board | the stage |
| `#/board` | the page board | the page board | the stage (the sea is the whole display) |
| a ship, a place, an item | the stage (section 16) | the same, one column | the same |

A take-over screen keeps the stage on every row. The layout is the window's width against the theme's
`grid.phone_breakpoint_css` (700): narrower is the phone layout (`data-layout="phone"`), anything wider is the TV layout
(`data-layout="tv"`), whatever the device. The television profile is the view the host serves: the `tv` profile (by default at
`/tv/`, or the only profile a listen address serves), any profile with household redaction, or any profile in privacy mode
(`view.profile` in `/api/view`; the page's `tvProfile()`). It is chosen by the host, never by the browser.

- **The Lists door** (`#/board`): a plate reading **Lists** with a right triangle in the theme's zone `lists` (ship-deck: left of
  the `?` key, x 548, y 41, w 45, h 15; default: x 548, y 173), growing leftwards for a longer word; the since plate and the open
  sea's banner end before it. It is on the open sea's normal screen only, and never on the television profile. A ship's plan bar
  carries the same door between its title and the clock. On the board, the header's **Open sea** door, Esc and Back go up to the
  sea; an idle TV left on the board sails home after `display.idle_return_s`, as from a place.
- **The headline card** with calls waiting stacks them: the top call plainly (title, where to answer, age), the next two as rows,
  then "+N more waiting". It is a door to the Bridge, where every call is listed in full, on every profile.
- **The ship plates' badges** (TV layout, ship-deck): after a ship's name and word, the needs glyph and the number of calls waiting
  on the viewer from that machine (a card's own `machine`, else its source's machine; a card naming neither is on no plate), then
  the failed glyph and the number of that machine's lanes off course plus its critical cards (`frontdoor.js` `badgeCounts`). A
  plate says nothing when both are zero, and the badges never add up to more than the card and the log. Never colour alone: each
  number has its glyph, and a screen reader hears both in words.
- **The sea keeps moving.** The ambient loop (section 10) parks off screen only where its picture can scroll away (the page
  board's picture slot, the phone's banner); on the TV stage the sea is fixed behind the whole screen and paints whenever the tab
  is visible and motion is not still.

## 25. Per-machine livery (Unreleased)

A ship has a face at a distance: a stripe along its hull and a swallowtail pennant at each masthead, in a colour that says which
machine it is. The colour is identity only and never a state.

| Picture | Driven by | Rule |
| --- | --- | --- |
| Hull stripe (flagship) and masthead pennant (flagship and full-scale escorts) | `machines[].id`, the one real field | the FNV-1a hash (32 bit, over the id's UTF-16 units) modulo six picks one of the six tones in `color.scene.livery` of the theme's `tokens.json` |

- **Identity, never state.** The tone takes the id and nothing else: no status, weather, fog, lantern or time. A silent machine keeps
  its colour under its fog and dark lantern, so the livery never says anything the plate does not.
- **No id, no livery.** A machine row without an id (or a theme without exactly six tones) draws no stripe and no pennant; a colour is
  never guessed. Two ids can share a tone, so the key says "which machine", never "unique"; the plate names each ship.
- **Shape.** The pennant is a swallowtail on the mast; the longboat's project-coloured pennant (section 17.3) is a flat flag at the
  stern, so the two differ in shape and the key says what this one means. Escorts drop the hull stripe (one art pixel cannot be told
  apart at distance) and carry a larger pennant instead. The phone's convoy strip shares the escort painter and gets the pennant too.
- **Cost.** Drawn into the hull layer, which is cached and repainted on change: no per-frame cost, no new feed field, no new config.
- **Key.** The key's "On the sea" line gains: "Pennant colours: which machine, nothing more. Picked from each machine's id by a fixed
  rule, so a machine keeps its colour. Never a state."
- **Unchecked on devices.** The livery is new; the tones have not been checked on a television or a phone (`docs/device-checklist.md`).

## 26. Weather transitions (Unreleased)

Cloud and rain come and go in a few steps when a machine's real state changes, then rest. Nothing is drawn that the feed did not say.
- **Field to picture.** The machine's word from `machines[].strain.state` and `machines[].status` (the host's verdict from load, folded
  with the status by the page, the same word the scene already paints): `ok` is clear, `warn` (struggling) is rain, `down` is a squall,
  `alert` (a critical) is a storm. No new field and no new weather.
- **When it runs.** Only on a real change of that word between two consecutive feeds, for a machine whose word is known on both. Never
  on first load, never on a timer, never looping, never for the same value twice. Clear to a weather grows its cloud and lengthens its
  rain in four steps over 600 ms (`weather_change`); a weather to clear runs the same four steps backward; a change between two weathers
  is a cut. Then it rests: no cost at rest.
- **Reduced motion.** `motion: still` (and the system's reduced-motion setting) records no change: the new weather appears at once.
- **Stale, silent, unknown.** Unknown, silent, lost, asleep and resting machines are not tracked. A silent source keeps its frozen
  last-known weather under its fog and its "as of" marking, with no animation; unknown stays unknown; no "recovery" plays when a source
  comes back, because silence is not recovery. While the host is lost or down, no change is read.
- **Rule.** `web/weather.js` (pure; `tests/test_weather.py` runs it in Node on synthetic feeds). The phone's convoy strip never animates.
- **Key.** The key names no weather, so it has no new line.
- **Unchecked on devices.** The transitions are new; they have not been checked on a television or a phone (`docs/device-checklist.md`).
