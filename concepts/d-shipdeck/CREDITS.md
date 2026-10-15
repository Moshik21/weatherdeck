# Credits

## Art

All art on this board was made for this project and is dedicated to the public domain under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). No third-party art, sprites, characters, logos or sounds are used.

| Art | Where | How it is made |
| --- | --- | --- |
| Sky, clouds, sun, moon, stars, sea, waves, horizon island, fog, rain, storm, lightning | `js/art.js` (`paintScene`) | Procedural: banded ramps with 4 x 4 Bayer dithering on the seams, seeded random clouds and waves |
| The ship: hull, rail, masts, sails, rigging, crow's nests, lantern, portholes, bowsprit | `js/art.js` (`shipBack`, `hull`, `rail`, `nestFront`) | Procedural, from the fleet's machine sections |
| Crew sprites (16 x 24) in eleven poses: stand, hammer (2 frames), hoist (2 frames), scroll, arms crossed, cheer, sit, spyglass, worried; hammock | `js/art.js` (`POSES`, `crewGrid`, `HAMMOCK`) | Built from shared body parts with an automatic outline; skin and cap vary by lane id, shirt pattern by project |
| The lookout crow (20 x 14), perched and two flight frames | `js/art.js` (`CROW`) | Sprite strings |
| Crate, barrel, smoke, ember | `js/art.js` | Procedural |
| Voyage chart: islands, lighthouse, ship marker | `js/art.js` (`paintChart`) | Procedural |
| State glyphs (12 x 12): needs you, ready to approve, moving, done, failed, blocked, waiting on its mate, scout, silent, asleep | `js/art.js` (`G`) | Drawn for this project in the phase-1 research (`sketches/palettes.html`, CC0) |
| State glyphs added here: running long (clock), regressed (round again) | `js/art.js` (`G`) | Drawn for this concept |
| Machine pips (8 x 8): ok square, warn triangle, down cross, silent diamond, live lamp | `js/art.js` (`PIP`) | Drawn for this concept |

## Fonts

See `fonts/README.md`: Departure Mono, Jersey 15 and Atkinson Hyperlegible Next, all SIL Open Font License 1.1.

## Data

`fixture.json` is a copy of the phase-1 synthetic fleet (`synthetic-fleet.json`, fixture version in the file). Every name and number in it is invented.
