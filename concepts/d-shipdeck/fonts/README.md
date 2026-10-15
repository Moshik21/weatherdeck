# Fonts

Self-hosted; the page makes no font request anywhere else. All three families are under the SIL Open Font License 1.1, whose full text sits next to each file.

| Family | Role on the board | Version | File | Source | Licence | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| Departure Mono | Labels, numbers, ranges (one font pixel = one art pixel, 11 px/em) | 1.500 | `DepartureMono-Regular.woff2` | https://github.com/rektdeckard/departure-mono/blob/main/public/assets/DepartureMono-Regular.woff2 (unchanged) | OFL 1.1, Helena Zhang (`LICENSE-DepartureMono.txt`) | `5b4fed1daa90708aa9c6ee1190abca9dc22164a1c1def0020386e46b61038cfb` |
| Jersey 15 | The call count, the clock, the landed score (27 px/em) | 1.001 | `Jersey15-Regular.woff2` | https://github.com/google/fonts/blob/main/ofl/jersey15/Jersey15-Regular.ttf, subset and converted (below) | OFL 1.1, The Soft Type Project Authors (`OFL-Jersey15.txt`) | `6072296bc9df501be8a6817b1991908b9a2fda01d1ce2d17b5099373b7cdde68` |
| Atkinson Hyperlegible Next | Titles, sentences, ages, the ship's log (variable 200-800) | 2.001 | `AtkinsonHyperlegibleNext-Variable.woff2` | https://github.com/google/fonts/blob/main/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf, subset and converted (below) | OFL 1.1, The Atkinson Hyperlegible Next Project Authors (`OFL-AtkinsonHyperlegibleNext.txt`) | `fa6bdc8b5de3336674f43b1ea490ec86f5ab7d8ef689d7ee3d3b2d12f95acb9f` |

Source TTF hashes, before subsetting: Jersey 15 `dbe00479d62bb3b9fcf0d28f88a021ffc4bd7b01d6ad5c6f74b5fa371bb210ed`, Atkinson Hyperlegible Next `5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745`. Fetched 2026-10-08.

Subset and conversion (fontTools 4, `pyftsubset`), Latin plus the punctuation the board uses:

```
pyftsubset <font>.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2190-2193,U+2212,U+00B7,U+00D7,U+2248,U+25B2,U+25B6,U+25BC,U+25C6" --layout-features='*' --flavor=woff2 --output-file=<font>.woff2
```

The OFL lets a subset be redistributed; neither modified file uses a Reserved Font Name (Jersey 15 and Atkinson Hyperlegible Next declare none).

Pixel metrics (measured with fontTools): Departure Mono is 550 units per em on a 50-unit grid, so 11 font pixels per em with an 8-pixel cap; Jersey 15 is 1350 units per em on a 50-unit grid, 27 font pixels per em with a 15-pixel cap; Atkinson Hyperlegible Next has a cap height of 0.668 em.
