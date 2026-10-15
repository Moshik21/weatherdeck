# Credits: ship-deck theme

## Art

All art for this theme was made for this project and is dedicated to the public domain under CC0 1.0
(https://creativecommons.org/publicdomain/zero/1.0/). No third-party art, sprites, characters, logos,
flags of real codes or sounds are used.

| Art | File | Origin |
| --- | --- | --- |
| State glyphs (12 x 12) and machine pips (8 x 8) | `../default/glyphs.json` | Drawn for this project in the phase-1 design research and the ship-deck concept |
| Lookout crow, perched | `sprites.json` (`crow_perch`) | Drawn for the ship-deck concept (`concepts/d-shipdeck/js/art.js`) |
| Lookout crow in flight (`crow_fly1`, `crow_fly2`) | `sprites.json` | Drawn for the ship-deck concept (`concepts/d-shipdeck/js/art.js`) |
| Lookout crow, asleep; ship's bell; lantern lit and dark; two signal flags | `sprites.json` | Drawn for this theme |
| Sky, sea, clouds, weather, the ship, crew (16 x 24, eleven poses), voyage chart | `scene.js` (ported from `concepts/d-shipdeck/js/art.js`, plus the anchor, hoist and dark-section art) | Procedural, drawn for the ship-deck concept |

The two signal flags are plain two-colour patterns. They do not reproduce any real signalling code and
carry no meaning beyond "this board is calling its host"; the words on the hailing plate say that.

## How the art was made (AI-drawn art disclosure)

This repository's own records show the following and nothing more. The art here is code and text in the repository:
procedural drawing code in `scene.js`, sprite strings in `sprites.json` and glyph grids in `../default/glyphs.json`.
There are no raster image files, and no output of an image-generation model, in this theme. The commits that added
the theme and its concept (`concepts/d-shipdeck/`) are authored by `crewmate`, the identity of the AI coding agent
that did this project's work; the one later commit under the owner's name is a squashed pull request that credits
`crewmate` as co-author. So the art was written by an AI agent working for the project's owner. The records do not
say what reference material or direction the agent was given for the designs, and this file does not claim any.

## Fonts

See `fonts/README.md`: Departure Mono, Jersey 15 and Atkinson Hyperlegible Next, all SIL Open Font
License 1.1, with the licence text beside each file.
