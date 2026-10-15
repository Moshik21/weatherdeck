# Fonts

Self-hosted, no CDN. Each file is a WOFF2 subset (Basic Latin, Latin-1, general punctuation, arrows and the block and geometric shapes the page uses) made with `pyftsubset` from fontTools, with all layout features kept. The licence text for each family sits next to it.

| Family | Version | Role | Source (pinned commit) | Licence | File | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| Departure Mono | 1.500 | Labels, numbers, state words: everything that is not a title. 11 px per em, cap 8 px; drawn at one font pixel per art pixel | https://github.com/rektdeckard/departure-mono/blob/f9fd64ba50743f0e3a95b6bef1f8f77bfe4b3630/public/assets/DepartureMono-Regular.woff2 | SIL OFL 1.1, Helena Zhang (`DepartureMono-OFL.txt`) | `DepartureMono-Regular.woff2` | `cd261ae0d43fe61cb01f6edbea5dd2c3d4122bae6cf462c2b8de6210e154919b` |
| Jersey 15 | 1.001 | The clock and the call count. 27 px per em, cap 15 px; drawn at 3 (clock) and 4 (count) art pixels per font pixel | https://github.com/google/fonts/blob/0219b6a510161b719c2c44d639ef1628d02ee466/ofl/jersey15/Jersey15-Regular.ttf | SIL OFL 1.1, The Soft Type Project Authors (Sarah Cadigan-Fried) (`Jersey15-OFL.txt`) | `Jersey15-Regular.woff2` | `7d446bf0460add8aec696b9e6b5d4d4c06a7e685757d4916e366b7b0d7e0bbb9` |
| Atkinson Hyperlegible Next | 2.001 (variable, wght 200-800) | Lane and call titles, explanations, where to act | https://github.com/google/fonts/blob/66eef70728ca29f28c31cdc5e7947f2c2de73e8d/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf | SIL OFL 1.1, The Atkinson Hyperlegible Next Project Authors (Braille Institute) (`AtkinsonHyperlegibleNext-OFL.txt`) | `AtkinsonHyperlegibleNext.woff2` | `79d0794015f3cc91a731f44dc6cdc3871d781f281dbb20e16618cf9f25256754` |

SHA-256 values are of the subset files in this folder. Upstream files before subsetting: Departure Mono WOFF2 `5b4fed1daa90708aa9c6ee1190abca9dc22164a1c1def0020386e46b61038cfb`, Jersey 15 TTF `dbe00479d62bb3b9fcf0d28f88a021ffc4bd7b01d6ad5c6f74b5fa371bb210ed`, Atkinson Hyperlegible Next TTF `5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745`.

Rebuild a subset (example):

```
uvx --from fonttools --with brotli pyftsubset DepartureMono-Regular.woff2 \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+2190-2193,U+2212,U+2581-259F,U+25A0-25CF" \
  --flavor=woff2 --layout-features='*' --output-file=DepartureMono-Regular.woff2
```
