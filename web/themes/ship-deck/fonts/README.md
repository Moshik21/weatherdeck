# Fonts: ship-deck theme

Self-hosted; the page loads no font from anywhere else. All three families are under the SIL Open Font
License 1.1, whose full text sits next to each file. The files are byte copies of the ones in
`concepts/d-shipdeck/fonts/` (fetched 2026-10-08). Hashes are given in subresource-integrity form
(`sha256-` + base64), the same value `tokens.json` carries as `integrity`, so the loader or a check can
verify each file. The hex forms of the same hashes are in `concepts/d-shipdeck/fonts/README.md`.

| Family | Role | Version | File | Source | Licence | Integrity |
| --- | --- | --- | --- | --- | --- | --- |
| Departure Mono | `pixel`: labels, state words, numbers, ranges; one font px = one art px (11 px/em, cap 8) | 1.500 | `DepartureMono-Regular.woff2` | https://github.com/rektdeckard/departure-mono/blob/main/public/assets/DepartureMono-Regular.woff2 (unchanged) | OFL 1.1, Helena Zhang (`LICENSE-DepartureMono.txt`) | `sha256-W0/tHaqQcIqpxu4RkKvKncIhZKHB3vACA4bka2EDjPs=` |
| Jersey 15 | `numeral`: the call count, the clock, the landed score, the hail countdown (27 px/em, cap 15) | 1.001 | `Jersey15-Regular.woff2` | https://github.com/google/fonts/blob/main/ofl/jersey15/Jersey15-Regular.ttf, subset and converted | OFL 1.1, The Soft Type Project Authors (`OFL-Jersey15.txt`) | `sha256-YHIpa8nfUBvopoF7GZGQi5ov2gHRzi0XtQmTc7fN3mg=` |
| Atkinson Hyperlegible Next (variable, wght 200-800) | `data`: titles, sentences, where to act, the log (cap 0.668 em) | 2.001 | `AtkinsonHyperlegibleNext-Variable.woff2` | https://github.com/google/fonts/blob/main/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf, subset and converted | OFL 1.1, The Atkinson Hyperlegible Next Project Authors (`OFL-AtkinsonHyperlegibleNext.txt`) | `sha256-+mvci13jM2Z09DsepJDshvWrfY72idfuPTstEvlay58=` |

The upstream TTF hashes before subsetting are recorded in `concepts/d-shipdeck/fonts/README.md`.

Subset (fontTools `pyftsubset`), Latin plus the punctuation the board uses:

```
pyftsubset <font>.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2190-2193,U+2212,U+00B7,U+00D7,U+2248,U+25B2,U+25B6,U+25BC,U+25C6" --layout-features='*' --flavor=woff2 --output-file=<font>.woff2
```

The OFL allows redistributing a subset. Neither modified file uses a Reserved Font Name (Jersey 15 and
Atkinson Hyperlegible Next declare none). Every character the theme's words use is in these subsets;
arrows, pointers and the continue mark are drawn, not set as text.
