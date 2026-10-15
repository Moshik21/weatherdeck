/* Fleet command, concept A: procedural pixel art.
   Every sprite is drawn here at art resolution into a small canvas and scaled by CSS with
   image-rendering: pixelated, at an integer number of device pixels per art pixel.
   All art is original to this project (CC0, see CREDITS.md). The 12 x 12 state glyphs are the
   phase-1 research set (sketches/palettes.html), plus a warning triangle and a range-dropped arrow. */
"use strict";

const Sprites = (() => {
  let P = {}; // palette, read from CSS custom properties so day and night tables stay in one place

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const names = ["ground", "panel", "well", "line", "bevel-hi", "bevel", "bevel-lo", "ink", "ink2", "fog",
      "need", "need-hi", "need-lo", "need-deep", "trouble", "trouble-lo", "move", "move-lo", "done", "done-lo",
      "sea", "sea-hi", "land", "land-hi", "land-lo", "road", "wall", "wall-hi", "wall-lo", "window",
      "squad-orrery", "squad-folio", "skin-1", "skin-2", "skin-3", "skin-4", "hair-1", "hair-2", "hair-3", "hair-4",
      "kit-1", "kit-2", "kit-3", "kit-4", "smoke", "smoke-hi"];
    P = {};
    for (const n of names) P[n] = cs.getPropertyValue("--c-" + n).trim() || "#ff00ff";
    return P;
  }

  // ---- canvas helpers ------------------------------------------------------------------
  function canvas(w, h, cls) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.className = "px" + (cls ? " " + cls : "");
    c.style.setProperty("--w", w);
    c.style.setProperty("--h", h);
    c.setAttribute("aria-hidden", "true");
    return c;
  }
  const ctx = c => { const x = c.getContext("2d"); x.imageSmoothingEnabled = false; return x; };
  function rect(x, X, Y, w, h, col) { x.fillStyle = col; x.fillRect(X, Y, w, h); }

  // A grid of colour strings; lets sprites get an automatic one-pixel outline.
  function grid(w, h) {
    const g = { w, h, a: new Array(w * h).fill(null) };
    g.set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) g.a[y * w + x] = c; };
    g.get = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? g.a[y * w + x] : null;
    g.fill = (x, y, ww, hh, c) => { for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) g.set(x + i, y + j, c); };
    g.outline = c => {
      const add = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (g.get(x, y)) continue;
        if (g.get(x - 1, y) || g.get(x + 1, y) || g.get(x, y - 1) || g.get(x, y + 1)) add.push([x, y]);
      }
      add.forEach(([x, y]) => g.set(x, y, c));
    };
    g.paint = (x, ox = 0, oy = 0) => {
      for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) { const c = g.a[y * w + i]; if (c) rect(x, ox + i, oy + y, 1, 1, c); }
    };
    return g;
  }

  // Seeded random, so a lane's portrait is the same on every screen and every reload.
  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---- state glyphs (12 x 12). '#' state colour, 'o' outline ink, 'k' ground ----------------
  const G = {
    needs: [".....##.....", "....####....", "...##kk##...", "..###kk###..", ".####kk####.", "#####kk#####", "#####kk#####", ".####kk####.", "..########..", "...##kk##...", "....####....", ".....##....."],
    approve: ["...oooooo...", "..o######o..", ".o##oooo##o.", ".oooo..o##o.", "......o##o..", ".....o##o...", "....o##o....", "....o##o....", ".....oo.....", "....o##o....", "....o##o....", ".....oo....."],
    moving: ["............", "..o.........", "..o#o.......", "..o##o......", "..o###o.....", "..o####o....", "..o####o....", "..o###o.....", "..o##o......", "..o#o.......", "..o.........", "............"],
    done: ["............", "..........o.", ".........o#o", "........o#o.", ".o.....o#o..", "o#o...o#o...", ".o#o.o#o....", "..o#o#o.....", "...o#o......", "....o.......", "............", "............"],
    failed: ["............", ".o.......o..", "o#o.....o#o.", ".o#o...o#o..", "..o#o.o#o...", "...o#o#o....", "...o#o#o....", "..o#o.o#o...", ".o#o...o#o..", "o#o.....o#o.", ".o.......o..", "............"],
    blocked: ["............", "oooooooooooo", "o###o###o##o", "oooooooooooo", "o#o###o###oo", "oooooooooooo", "o###o###o##o", "oooooooooooo", "o#o###o###oo", "oooooooooooo", "............", "............"],
    mate: ["oooooooooooo", "o##########o", ".o########o.", "..o######o..", "...o####o...", "....o##o....", "....o..o....", "...o....o...", "..o..##..o..", ".o.######.o.", "o##########o", "oooooooooooo"],
    scout: ["............", "............", "oo..........", "o#oooo......", "o#####oooo..", "o##########o", "o#####oooo..", "o#oooo......", "oo..........", "............", "............", "............"],
    silent: [".....oo.....", "....o..o....", "...o.oo.o...", "..o.o..o.o..", ".o.....o..o.", "o.....o....o", "o....o.....o", ".o...o....o.", "..o.......o.", "...o.o..o...", "....o..o....", ".....oo....."],
    asleep: ["............", "......oooo..", ".........o..", "........o...", ".......oooo.", "..ooo.......", "....o.......", "...o........", "..ooo.......", "............", "............", "............"],
    warn: [".....oo.....", "....o##o....", "....o##o....", "...o####o...", "...o#kk#o...", "..o##kk##o..", "..o##kk##o..", ".o###kk###o.", ".o########o.", "o####kk####o", "o##########o", "oooooooooooo"],
    dropped: ["....oooo....", "....o##o....", "....o##o....", "....o##o....", ".oooo##oooo.", ".o########o.", "..o######o..", "...o####o...", "....o##o....", ".....oo.....", "............", "............"],
    square: ["............", "............", "..oooooooo..", "..o######o..", "..o######o..", "..o######o..", "..o######o..", "..o######o..", "..o######o..", "..oooooooo..", "............", "............"],
  };
  function glyphColour(name) {
    return { needs: P.need, approve: P.need, warn: P.need, moving: P.move, done: P.done, failed: P.trouble, blocked: P.trouble,
      mate: P.ink2, scout: P.move, silent: P.fog, asleep: P.fog, dropped: P.move, square: P.ink2 }[name] || P.ink;
  }
  function glyph(name, col, cls) {
    const rows = G[name] || G.silent;
    const c = canvas(12, 12, "glyph" + (cls ? " " + cls : ""));
    const x = ctx(c);
    const fill = col || glyphColour(name);
    const out = (name === "silent" || name === "asleep") ? (col || P.fog) : P.ink;
    rows.forEach((r, j) => [...r].forEach((ch, i) => {
      if (ch === ".") return;
      rect(x, i, j, 1, 1, ch === "#" ? fill : ch === "k" ? P.ground : out);
    }));
    return c;
  }

  // ---- bevelled 9-slice frames, drawn per theme and used as CSS border-image ---------------
  // layers: from the outside in. Corners are cut in pixel steps, never border-radius.
  function frameURL(kind) {
    const L = {
      steel:  { b: 4, cut: 2, layers: [P.line, "bevel", P.bevel, P.line], hi: P["bevel-hi"], lo: P["bevel-lo"], fill: P.panel },
      well:   { b: 2, cut: 1, layers: [P.line, "bevel"], hi: P["bevel-lo"], lo: P.bevel, fill: P.well },
      gold:   { b: 4, cut: 2, layers: [P.line, "bevel", P.need, P.line], hi: P["need-hi"], lo: P["need-lo"], fill: P["need-deep"] },
      tile:   { b: 2, cut: 1, layers: [P.line, "bevel"], hi: P["need-lo"], lo: P.line, fill: P.panel },
      top:    { b: 2, cut: 1, layers: [P.line, "bevel"], hi: P.need, lo: P["need-lo"], fill: P.panel },
      crit:   { b: 2, cut: 1, layers: [P.trouble, "bevel"], hi: P["trouble-lo"], lo: P.line, fill: P.panel },
      socket: { b: 2, cut: 1, layers: [P.line, "bevel"], hi: P["bevel-lo"], lo: P.bevel, fill: P.well },
      calm:   { b: 4, cut: 2, layers: [P.line, "bevel", P["bevel-hi"], P.line], hi: P.ink2, lo: P["bevel-lo"], fill: P.panel },
      fog:    { b: 2, cut: 1, layers: [P.fog, "bevel"], hi: P.well, lo: P.well, fill: P.well },
    }[kind];
    const N = 2 * L.b + 1;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const x = ctx(c);
    for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) {
      const cx = Math.min(i, N - 1 - i), cy = Math.min(y, N - 1 - y);
      if (cx < L.cut && cy < L.cut && cx + cy < L.cut) continue;
      let col;
      const d = Math.min(cx, cy);
      if (cx < L.cut && cy < L.cut && cx + cy === L.cut) col = L.layers[0];
      else if (d >= L.b) col = L.fill;
      else {
        col = L.layers[d];
        if (col === "bevel") {
          const top = cy <= cx ? y < N / 2 : i < N / 2;
          col = top ? L.hi : L.lo;
        }
      }
      rect(x, i, y, 1, 1, col);
    }
    return { url: c.toDataURL(), b: L.b };
  }

  // ---- honest-range bar ("health"): solid floor, hatched ceiling -----------------------------
  function hpBar(w, h, range, tone) {
    const c = canvas(w, h, "meter");
    const x = ctx(c);
    rect(x, 0, 0, w, h, P.line);
    rect(x, 1, 1, w - 2, h - 2, P.well);
    const iw = w - 2;
    if (!range) { // no honest percent: a dotted, empty track
      for (let i = 1; i < w - 1; i += 3) rect(x, i, Math.floor(h / 2), 1, 1, P.fog);
      return c;
    }
    const col = { trouble: P.trouble, move: P.move, done: P.done, need: P.need, fog: P.fog }[tone] || P.ink2;
    const f = Math.round(iw * range[0] / 100), cl = Math.round(iw * range[1] / 100);
    rect(x, 1, 1, f, h - 2, col);
    for (let i = f; i < cl; i++) for (let j = 1; j < h - 1; j++) if ((i + j) % 3 === 0) rect(x, 1 + i, j, 1, 1, col);
    if (cl > f) rect(x, 1 + cl - 1, 1, 1, h - 2, col); // ceiling edge, so the range has two ends
    return c;
  }

  // ---- elapsed against typical ("stamina"): neutral to typical, amber past it, ticks at typical and p90
  function stBar(w, h, cur) {
    const c = canvas(w, h, "meter");
    const x = ctx(c);
    rect(x, 0, 0, w, h, P.line);
    rect(x, 1, 1, w - 2, h - 2, P.well);
    if (!cur || !cur.typical_s) return c;
    const iw = w - 2, max = Math.max(cur.p90_s * 1.25, cur.typical_s * 1.5);
    const at = s => Math.min(iw, Math.round(iw * s / max));
    const e = at(cur.elapsed_s), t = at(cur.typical_s), p = at(cur.p90_s);
    rect(x, 1, 1, Math.min(e, t), h - 2, P.ink2);
    if (e > t) rect(x, 1 + t, 1, e - t, h - 2, P.need);
    if (cur.elapsed_s > max) { // overflow: chevrons at the end say "off the scale"
      for (let k = 0; k < 2; k++) { const ox = w - 2 - k * 3; rect(x, ox - 1, 1, 1, h - 2, P.line); }
    }
    rect(x, 1 + t, 0, 1, h, P.ink);   // typical tick
    rect(x, 1 + p, 0, 1, h, P.ink);   // p90 tick
    rect(x, 1 + p, Math.floor(h / 2), 1, 1, P.line);
    return c;
  }

  // ---- unit portrait, 24 x 24, seeded from the lane id ----------------------------------------
  function portrait(seed, group, mood) {
    const r = rng(hash(seed));
    const pick = a => a[Math.floor(r() * a.length)];
    const skin = pick([P["skin-1"], P["skin-2"], P["skin-3"], P["skin-4"]]);
    const hair = pick([P["hair-1"], P["hair-2"], P["hair-3"], P["hair-4"]]);
    const kit = pick([P["kit-1"], P["kit-2"], P["kit-3"], P["kit-4"]]);
    const scout = mood.scout;
    const hat = scout ? 2 : pick([0, 1, 3, 4, 5]);
    const g = grid(24, 24);
    // shoulders and uniform
    g.fill(6, 17, 12, 1, kit); g.fill(4, 18, 16, 1, kit); g.fill(2, 19, 20, 5, kit);
    g.fill(9, 17, 6, 2, P.line); g.fill(10, 17, 4, 1, skin);
    // neck and head
    g.fill(10, 15, 4, 2, skin);
    g.fill(7, 6, 10, 10, skin); g.set(7, 6, null); g.set(16, 6, null); g.set(7, 15, null); g.set(16, 15, null);
    g.fill(16, 8, 1, 7, P.line === skin ? skin : shade(skin));
    // headgear
    if (hat === 0) { g.fill(6, 3, 12, 5, kit); g.set(6, 3, null); g.set(17, 3, null); g.fill(6, 8, 12, 1, P.line); g.fill(8, 4, 3, 1, P["bevel-hi"]); }
    if (hat === 1) { g.fill(7, 4, 10, 3, kit); g.fill(5, 7, 13, 1, P.line); g.fill(9, 5, 2, 1, P["bevel-hi"]); g.fill(7, 8, 1, 3, hair); g.fill(16, 8, 1, 3, hair); }
    if (hat === 2) { g.fill(5, 3, 14, 4, kit); g.fill(5, 7, 2, 10, kit); g.fill(17, 7, 2, 10, kit); g.set(5, 3, null); g.set(18, 3, null); g.fill(7, 6, 10, 1, shade(kit)); }
    if (hat === 3) { g.fill(7, 4, 10, 3, hair); g.fill(6, 5, 1, 4, hair); g.fill(17, 5, 1, 4, hair); g.fill(6, 3, 12, 1, P.line); g.fill(5, 9, 2, 3, P.line); g.fill(17, 9, 2, 3, P.line); g.fill(14, 13, 3, 1, P.line); }
    if (hat === 4) { g.fill(6, 3, 12, 5, kit); g.set(6, 3, null); g.set(17, 3, null); g.fill(11, 1, 2, 3, P["bevel-hi"]); g.fill(6, 8, 12, 1, P.line); g.fill(16, 6, 1, 6, kit); g.fill(7, 6, 1, 6, kit); }
    if (hat === 5) { g.fill(7, 4, 10, 3, hair); g.fill(6, 5, 1, 3, hair); g.fill(17, 5, 1, 3, hair); g.fill(7, 6, 10, 2, P.line); g.fill(8, 6, 3, 1, P["bevel-hi"]); g.fill(13, 6, 3, 1, P["bevel-hi"]); }
    // face by mood: eyes, brows, mouth
    const eye = P.line;
    const m = mood.face || "ok";
    if (m === "sleep" || m === "hurt") { g.fill(9, 11, 2, 1, eye); g.fill(13, 11, 2, 1, eye); }
    else { g.fill(9, 10, 1, 2, eye); g.fill(14, 10, 1, 2, eye); }
    if (m === "frown") { g.set(8, 9, eye); g.set(9, 9, eye); g.set(14, 9, eye); g.set(15, 9, eye); g.set(10, 8, null); }
    if (m === "worry") { g.set(9, 8, eye); g.set(14, 8, eye); }
    if (m === "ok" || m === "sleep" || m === "worry") g.fill(11, 13, 2, 1, shade(skin));
    if (m === "happy") { g.set(10, 13, eye); g.fill(11, 14, 2, 1, eye); g.set(13, 13, eye); }
    if (m === "frown" || m === "hurt") { g.set(10, 14, eye); g.fill(11, 13, 2, 1, eye); g.set(13, 14, eye); }
    if (m === "sweat") { g.fill(11, 13, 3, 1, eye); g.set(18, 8, P.ink); g.fill(18, 9, 1, 2, P.ink); g.set(19, 10, P.ink); }
    if (m === "hurt") { g.fill(7, 7, 10, 2, P.ink); g.set(13, 7, P.trouble); g.set(13, 8, P.trouble); }
    g.outline(P.line);
    const c = canvas(24, 24, "portrait");
    const x = ctx(c);
    rect(x, 0, 0, 24, 24, P.well);
    for (let i = 0; i < 24; i += 4) rect(x, i, 23 - (i % 8 ? 1 : 0), 1, 1, P.bevel); // faint floor dots
    g.paint(x);
    // squad band: project tint, never a status hue, with an emblem shape (ring = Orrery, page = Folio)
    const band = group === "orrery" ? P["squad-orrery"] : P["squad-folio"];
    rect(x, 0, 20, 24, 4, P.line); rect(x, 0, 21, 24, 3, band);
    if (group === "orrery") { rect(x, 2, 21, 3, 3, P.line); rect(x, 3, 22, 1, 1, band); rect(x, 6, 22, 1, 1, P.line); }
    else { rect(x, 2, 21, 3, 3, P.line); rect(x, 3, 21, 2, 1, band); }
    return c;
  }
  function shade(hex) { // one SNES step darker (5-bit channels, minus 4 steps)
    const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return "#" + v.map(c => { const s = Math.max(0, (c >> 3) - 4); return ((s << 3) | (s >> 2)).toString(16).padStart(2, "0"); }).join("");
  }

  // ---- the lookout: the speaker in the orders window, 32 x 32. Face follows the board's mood.
  function lookout(mood) {
    const g = grid(32, 32);
    const skin = P["skin-2"], coat = P["kit-1"], cap = P["kit-3"];
    g.fill(4, 25, 24, 7, coat); g.fill(7, 23, 18, 2, coat); g.fill(12, 23, 8, 3, P.ink2); g.fill(15, 24, 2, 4, P.line);
    g.fill(13, 20, 6, 3, skin);
    g.fill(9, 8, 14, 13, skin); g.set(9, 8, null); g.set(22, 8, null); g.set(9, 20, null); g.set(22, 20, null);
    g.fill(21, 10, 1, 9, shade(skin));
    g.fill(8, 4, 16, 5, cap); g.set(8, 4, null); g.set(23, 4, null); g.fill(7, 8, 18, 2, P.line); g.fill(10, 5, 4, 1, P["bevel-hi"]);
    g.fill(14, 3, 4, 1, P.ink2);
    const e = P.line;
    if (mood === "sleep") { g.fill(11, 13, 3, 1, e); g.fill(18, 13, 3, 1, e); }
    else if (mood === "alarm") { g.fill(11, 12, 2, 3, e); g.fill(19, 12, 2, 3, e); g.set(11, 11, null); }
    else { g.fill(12, 12, 1, 2, e); g.fill(19, 12, 1, 2, e); }
    if (mood === "alert" || mood === "alarm") { g.fill(11, 10, 3, 1, e); g.fill(18, 10, 3, 1, e); }
    if (mood === "lost") { g.fill(11, 11, 3, 1, e); g.set(18, 10, e); g.set(19, 10, e); g.set(20, 11, e); }
    if (mood === "calm" || mood === "sleep") { g.set(14, 16, e); g.fill(15, 17, 3, 1, e); g.set(18, 16, e); }
    else if (mood === "alarm") { g.fill(14, 16, 4, 3, e); g.fill(15, 17, 2, 1, P.trouble); }
    else g.fill(14, 17, 4, 1, e);
    // spyglass held at the shoulder
    g.fill(22, 21, 9, 3, P["wall-hi"]); g.fill(22, 21, 1, 3, P.line); g.fill(26, 21, 1, 3, P.line); g.fill(30, 20, 2, 5, P["wall"]);
    g.outline(P.line);
    const c = canvas(32, 32, "lookout");
    const x = ctx(c);
    rect(x, 0, 0, 32, 32, P.well);
    g.paint(x);
    if (mood === "alarm") { rect(x, 26, 7, 1, 2, P.ink); rect(x, 25, 9, 3, 2, P.ink); }
    if (mood === "sleep") { rect(x, 25, 3, 3, 1, P.fog); rect(x, 26, 4, 1, 1, P.fog); rect(x, 25, 5, 3, 1, P.fog); }
    return c;
  }

  // ---- small icons ------------------------------------------------------------------------
  function battery(pct, warn, fog) {
    const c = canvas(8, 13, "icon");
    const x = ctx(c);
    rect(x, 2, 0, 4, 1, P.line); rect(x, 2, 1, 4, 1, P.ink2);
    rect(x, 0, 1, 8, 12, P.line); rect(x, 1, 2, 6, 10, P.well);
    const lv = Math.round(10 * pct / 100);
    rect(x, 1, 12 - lv, 6, lv, fog ? P.fog : warn ? P.need : P.ink2);
    for (let j = 4; j < 12; j += 3) rect(x, 1, j, 6, 1, P.line);
    return c;
  }
  function lamp(level) {
    const c = canvas(8, 8, "icon");
    const x = ctx(c);
    const col = { live: P.done, late: P.need, stale: P.trouble, lost: P.trouble, down: P.trouble, none: P.fog }[level] || P.fog;
    rect(x, 1, 0, 6, 8, P.line); rect(x, 0, 1, 8, 6, P.line);
    rect(x, 1, 1, 6, 6, col); rect(x, 2, 2, 2, 1, P.ink);
    if (level === "stale" || level === "lost" || level === "down") { rect(x, 2, 2, 4, 4, P.line); rect(x, 3, 3, 2, 2, col); }
    return c;
  }
  function flag() { // landed banner on a pole
    const c = canvas(12, 13, "icon");
    const x = ctx(c);
    rect(x, 1, 0, 2, 13, P.line); rect(x, 1, 1, 1, 12, P.ink2);
    rect(x, 3, 1, 8, 6, P.line); rect(x, 3, 2, 7, 4, P.done); rect(x, 5, 3, 3, 2, P["done-lo"]);
    rect(x, 0, 12, 4, 1, P.ink2);
    return c;
  }
  function cursor(col) { // the continue cursor of a dialog window
    const c = canvas(7, 5, "cursor");
    const x = ctx(c);
    rect(x, 0, 0, 7, 1, P.line); rect(x, 0, 1, 7, 1, col || P.ink); rect(x, 1, 2, 5, 1, col || P.ink); rect(x, 2, 3, 3, 1, col || P.ink); rect(x, 3, 4, 1, 1, col || P.ink);
    return c;
  }
  function pointer() { // the JRPG menu pointer: "act here"
    const c = canvas(5, 7, "pointer");
    const x = ctx(c);
    for (let j = 0; j < 7; j++) { const w = 4 - Math.abs(3 - j); rect(x, 0, j, w + 1, 1, P.line); if (w > 0) rect(x, 0, j, w, 1, P.need); }
    return c;
  }
  function mini(seed, tone) { // a 10 x 10 unit token for the folded "on task" formation
    const r = rng(hash(seed));
    const c = canvas(10, 10, "mini");
    const x = ctx(c);
    const kit = [P["kit-1"], P["kit-2"], P["kit-3"], P["kit-4"]][Math.floor(r() * 4)];
    const skin = [P["skin-1"], P["skin-2"], P["skin-3"], P["skin-4"]][Math.floor(r() * 4)];
    rect(x, 2, 0, 6, 1, P.line); rect(x, 1, 1, 8, 4, P.line); rect(x, 2, 1, 6, 2, kit); rect(x, 2, 3, 6, 2, skin);
    rect(x, 3, 3, 1, 1, P.line); rect(x, 6, 3, 1, 1, P.line);
    rect(x, 0, 5, 10, 5, P.line); rect(x, 1, 6, 8, 4, kit);
    rect(x, 1, 9, 8, 1, tone === "done" ? P.done : tone === "scout" ? P.move : P.ink2);
    return c;
  }

  // ---- the minimap: three bases on a small tile map, unit pips per lane ---------------------
  // bases: [{id, label, x (0..1), lanes: [{tone}], warn, crit, fog}]
  function minimap(w, h, bases, seedText) {
    const c = canvas(w, h, "map");
    const x = ctx(c);
    const r = rng(hash(seedText || "fleet"));
    rect(x, 0, 0, w, h, P.sea);
    // sea swell: sparse two-pixel wave marks on an 8 x 8 tile rhythm
    for (let ty = 0; ty < h; ty += 8) for (let tx = (ty / 8) % 2 ? 4 : 0; tx < w; tx += 16) if (r() < 0.55) rect(x, tx + 2, ty + 3, 3, 1, P["sea-hi"]);
    // islands: one land mass per base, made of overlapping discs, coast highlight on the lit side
    const land = new Uint8Array(w * h);
    const disc = (cx, cy, rad) => { for (let y = Math.max(0, cy - rad); y < Math.min(h, cy + rad + 1); y++) for (let i = Math.max(0, cx - rad); i < Math.min(w, cx + rad + 1); i++) if ((i - cx) ** 2 + ((y - cy) * 1.4) ** 2 <= rad * rad) land[y * w + i] = 1; };
    const top = 4;
    for (const b of bases) {
      const cx = Math.round(b.x * w), cy = Math.round(h * 0.42);
      disc(cx, cy, Math.round(h * 0.42));
      for (let k = 0; k < 5; k++) disc(cx + Math.round((r() - 0.5) * w * 0.16), cy + Math.round((r() - 0.5) * h * 0.4), Math.round(h * (0.14 + r() * 0.16)));
    }
    // causeways between bases: the network
    for (let i = 0; i + 1 < bases.length; i++) {
      const a = Math.round(bases[i].x * w), b2 = Math.round(bases[i + 1].x * w), y0 = Math.round(h * 0.5);
      for (let xx = a; xx <= b2; xx++) { land[y0 * w + xx] = 1; land[(y0 + 1) * w + xx] = 1; land[(y0 + 2) * w + xx] = 1; }
    }
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      if (!land[y * w + i]) continue;
      const edgeTop = y === 0 || !land[(y - 1) * w + i], edgeBot = y === h - 1 || !land[(y + 1) * w + i];
      rect(x, i, y, 1, 1, edgeTop ? P["land-hi"] : edgeBot ? P["land-lo"] : P.land);
      if (!edgeTop && !edgeBot && (i * 7 + y * 13) % 29 === 0) rect(x, i, y, 1, 1, P["land-lo"]);
    }
    // road: dotted line along the causeway
    for (let i = 0; i + 1 < bases.length; i++) {
      const a = Math.round(bases[i].x * w), b2 = Math.round(bases[i + 1].x * w), y0 = Math.round(h * 0.5) + 1;
      for (let xx = a; xx <= b2; xx += 3) rect(x, xx, y0, 2, 1, P.road);
    }
    // bases and their formations
    const placed = [];
    bases.forEach((b, bi) => {
      const cx = Math.round(b.x * w);
      const by = top + 2;
      const kind = bi; // 0 headquarters, 1 fortress, 2 laboratory
      const g = grid(30, 20);
      const W = P.wall, WH = P["wall-hi"], WL = P["wall-lo"], WIN = b.fog ? P.fog : P.window;
      if (kind === 0) { // headquarters: wide hall, tower, antenna
        g.fill(2, 9, 26, 10, W); g.fill(2, 9, 26, 1, WH); g.fill(2, 18, 26, 1, WL);
        g.fill(11, 2, 8, 8, W); g.fill(11, 2, 8, 1, WH); g.fill(14, 0, 2, 2, P.ink2);
        for (let i = 5; i < 26; i += 4) g.fill(i, 12, 2, 2, WIN);
        g.fill(13, 4, 4, 2, WIN); g.fill(13, 15, 4, 4, P.line);
      } else if (kind === 1) { // fortress: blocky keep with battlements
        g.fill(4, 6, 22, 13, W); g.fill(4, 6, 22, 1, WH); g.fill(4, 18, 22, 1, WL);
        for (let i = 4; i < 26; i += 4) g.fill(i, 4, 2, 2, W);
        g.fill(10, 1, 10, 6, W); g.fill(10, 1, 10, 1, WH);
        for (let i = 7; i < 24; i += 5) g.fill(i, 10, 2, 3, WIN);
        g.fill(13, 14, 4, 5, P.line);
      } else { // laboratory: dome and annex
        g.fill(5, 10, 20, 9, W); g.fill(5, 10, 20, 1, WH); g.fill(5, 18, 20, 1, WL);
        g.fill(9, 5, 12, 5, WH); g.fill(11, 3, 8, 2, WH); g.fill(13, 2, 4, 1, WH); g.fill(10, 7, 10, 1, W);
        for (let i = 8; i < 24; i += 5) g.fill(i, 13, 2, 2, WIN);
        g.fill(22, 4, 2, 6, W);
      }
      g.outline(P.line);
      const ox = cx - 15, oy = by;
      g.paint(x, ox, oy);
      // formation: one pip per lane, 3 x 3 with a one-pixel gap
      const n = b.lanes.length, cols = Math.min(n, 9);
      const fx = cx - Math.round(cols * 4 / 2), fy = oy + 22;
      b.lanes.forEach((ln, k) => {
        const px = fx + (k % 9) * 4, py = fy + Math.floor(k / 9) * 4;
        rect(x, px - 1, py - 1, 5, 5, P.line);
        rect(x, px, py, 3, 3, ln.tone);
      });
      if (b.fog) { // fog over a silent base: ordered dither, never hidden
        for (let y = oy - 2; y < Math.min(h, fy + 8); y++) for (let i = ox - 4; i < ox + 34; i++) if ((i + y) % 2 === 0 && i >= 0 && i < w) rect(x, i, y, 1, 1, P.fog);
      }
      placed.push({ cx, top: oy, bottom: fy + 4 + Math.floor((n - 1) / 9) * 4 });
    });
    return { canvas: c, placed };
  }

  // Smoke over a struggling base: three frames, shown one at a time by CSS steps().
  function smoke() {
    const c = canvas(36, 12, "smoke");
    const x = ctx(c);
    const puffs = [[[2, 8, 3], [5, 4, 2], [8, 1, 2]], [[3, 7, 2], [6, 3, 3], [9, 0, 2]], [[2, 6, 3], [6, 5, 2], [8, 2, 2]]];
    puffs.forEach((f, k) => f.forEach(([px, py, s]) => { rect(x, k * 12 + px, py, s + 1, s, P.smoke); rect(x, k * 12 + px, py, 1, 1, P["smoke-hi"]); }));
    return c;
  }

  // Console ground: one dim pixel per 8 x 8 tile, so the 80 x 45 tile grid shows faintly behind the panels.
  function groundTile() {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const x = ctx(c);
    rect(x, 0, 0, 8, 8, P.ground);
    rect(x, 0, 0, 1, 1, P["bevel-lo"] === P.ground ? P.well : P.panel);
    return c.toDataURL();
  }

  return { groundTile, pointer, readPalette, glyph, frameURL, hpBar, stBar, portrait, lookout, battery, lamp, flag, cursor, mini, minimap, smoke, canvas, hash };
})();
