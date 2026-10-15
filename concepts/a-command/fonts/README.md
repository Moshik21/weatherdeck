# Fonts

Self-hosted; the page loads nothing from a CDN. Each face ships with its licence file beside it.
All three are under the SIL Open Font License 1.1. No face here imitates a game or machine font.

| Family | Version | File | Source | Licence | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Departure Mono | 1.500 | `DepartureMono-Regular.woff2` | https://github.com/rektdeckard/departure-mono/releases/download/v1.500/DepartureMono-1.500.zip (WOFF2 from the release, unmodified) | OFL 1.1, Helena Zhang, `DepartureMono-LICENSE.txt` | `5b4fed1daa90708aa9c6ee1190abca9dc22164a1c1def0020386e46b61038cfb` |
| Jersey 15 | 1.001 | `Jersey15-latin.woff2` | npm `@fontsource/jersey-15@5.2.8`, `files/jersey-15-latin-400-normal.woff2` (Latin subset of google/fonts `ofl/jersey15`) | OFL 1.1, The Soft Type Project Authors (Sarah Cadigan-Fried), `Jersey15-OFL.txt` from https://github.com/google/fonts/tree/main/ofl/jersey15 | `244065acc0429b77f9eb21b4f79ccb5547a8eec944ae1c07d4901f1e9ccd8f3b` |
| Atkinson Hyperlegible Next (variable, wght 200-800) | 2.001 | `AtkinsonHyperlegibleNext-latin-wght.woff2` | npm `@fontsource-variable/atkinson-hyperlegible-next@5.3.0`, `files/atkinson-hyperlegible-next-latin-wght-normal.woff2` (Latin subset) | OFL 1.1, The Atkinson Hyperlegible Next Project Authors (Braille Institute, Applied Design Works, Letters From Sweden), `AtkinsonHyperlegibleNext-OFL.txt` from https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegiblenext | `18b2a1a39a2fa298b0ba5390aca68462669826c90925656f1c1f6796e0e1bbaf` |

Licence files: `DepartureMono-LICENSE.txt` (SHA-256 `b65e4275…0e83`), `Jersey15-OFL.txt` (`436d5836…f922`),
`AtkinsonHyperlegibleNext-OFL.txt` (`aca6a428…4030`).

Roles and grid (measured with fontTools):

- Departure Mono: 11 px per em, cap 8 px. Labels, tags, ranges and ages, at one font pixel per art pixel (66 device px on a 4K TV, cap 48 device px).
- Jersey 15: 27 px per em, cap 15 px. The clock and the landed score at one font pixel per art pixel, the orders count at two.
- Atkinson Hyperlegible Next: cap 0.668 em. Unit names, order titles and every sentence, at 12 and 11 art pixels (72 and 66 device px on 4K).

Characters checked present in each subset: digits, `% : ~ – …`. Arrows and pointers are drawn as sprites, not set as text.
