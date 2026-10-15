# Fonts for concept B (arcade cabinet)

Self-hosted, no CDN. Every family is licensed under the SIL Open Font License 1.1; each folder holds the family's licence text as `OFL.txt`, copied from the package it came from. The files are used unmodified (Latin subset as published by Fontsource; Departure Mono as released).

| Family | Version | Source | Licence | File | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Departure Mono | 1.500 | https://github.com/rektdeckard/departure-mono/releases/download/v1.500/DepartureMono-1.500.zip | OFL 1.1, Copyright 2022–2024 Helena Zhang | `departure-mono/DepartureMono-Regular.woff2` | `5b4fed1daa90708aa9c6ee1190abca9dc22164a1c1def0020386e46b61038cfb` |
| Jersey 20 | Google Fonts v4, npm `@fontsource/jersey-20@5.3.0` | https://registry.npmjs.org/@fontsource/jersey-20/-/jersey-20-5.3.0.tgz (upstream https://github.com/scfried/soft-type-jersey) | OFL 1.1, Copyright 2023 The Soft Type Project Authors | `jersey-20/jersey-20-latin-400-normal.woff2` | `222e2b84bc00b0e31ec5354f17853e3478ee808a3d117ae59a9b9997e45f77da` |
| Jersey 15 | Google Fonts v4, npm `@fontsource/jersey-15@5.3.0` | https://registry.npmjs.org/@fontsource/jersey-15/-/jersey-15-5.3.0.tgz (upstream https://github.com/scfried/soft-type-jersey) | OFL 1.1, Copyright 2023 The Soft Type Project Authors | `jersey-15/jersey-15-latin-400-normal.woff2` | `244065acc0429b77f9eb21b4f79ccb5547a8eec944ae1c07d4901f1e9ccd8f3b` |
| DotGothic16 | Google Fonts v21, npm `@fontsource/dotgothic16@5.3.0` | https://registry.npmjs.org/@fontsource/dotgothic16/-/dotgothic16-5.3.0.tgz (upstream https://github.com/fontworks-fonts/DotGothic16) | OFL 1.1, Copyright 2020 The DotGothic16 Project Authors | `dotgothic16/dotgothic16-latin-400-normal.woff2` | `d29abf817463fdba7e9e87fc954cfa2b60ea6534e8a79c46e858a0dc5aa6a6f6` |
| Atkinson Hyperlegible Next (variable, wght 200–800) | Google Fonts v7, npm `@fontsource-variable/atkinson-hyperlegible-next@5.3.0` | https://registry.npmjs.org/@fontsource-variable/atkinson-hyperlegible-next/-/atkinson-hyperlegible-next-5.3.0.tgz (upstream https://github.com/googlefonts/atkinson-hyperlegible-next) | OFL 1.1, Copyright 2020–2024 The Atkinson Hyperlegible Next Project Authors | `atkinson-hyperlegible-next/atkinson-hyperlegible-next-latin-wght-normal.woff2` | `18b2a1a39a2fa298b0ba5390aca68462669826c90925656f1c1f6796e0e1bbaf` |

## Measured grids (fontTools, from these files)

| Family | Units per em | Cap height | Font pixels per em | Use here |
| --- | --- | --- | --- | --- |
| Departure Mono | 550 | 400 (8 font px) | 11 | Labels, numbers, ranges, plates, ages: 11 art px font size, so 1 font px = 1 art px |
| Jersey 20 | 1292 | 760 (20 font px) | 34 | Calls count at 2 art px per font px (68 art px), landed score and clock at 1 (34 art px), Continue countdown at 4 |
| Jersey 15 | 1350 | 750 (15 font px) | 27 | The dialog heading "Player 1, your move" and takeover headings |
| DotGothic16 | 1000 | 787 | 16 (dot matrix) | Marquee lettering only |
| Atkinson Hyperlegible Next | 1000 | 668 | (outline face) | Every title and sentence: call titles, lane titles, step lines |

The ascent minus cap height equals the descent in all three pixel faces, so a line height equal to the cap height boxes the capitals exactly; the stylesheet uses that to keep pixel type on the art-pixel grid.

No Press Start 2P, no machine-specific revivals and no game fonts are used.
