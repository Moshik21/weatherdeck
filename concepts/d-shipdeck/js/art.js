/* Ship deck concept: all art is drawn here, procedurally or from small sprite strings made for
   this project (CC0, see CREDITS.md). One canvas pixel is one art pixel; the page scales the
   canvas by a whole number of device pixels, so nothing is ever smoothed. */
(function () {
  "use strict";
  const SD = (window.SD = window.SD || {});

  // ---- Colour -------------------------------------------------------------------------------
  // Status hues are fixed by the research palette (c.4) and are never lit or tinted.
  SD.STATUS = {
    day: { needs: "#F7B733", trouble: "#FF5F4A", moving: "#5C9DFF", done: "#93DDB4", ink: "#E8ECF1", ink2: "#B4BDC9", fog: "#8D97A5" },
    night: { needs: "#C49023", trouble: "#D55240", moving: "#4974B5", done: "#6A717B", ink: "#8F9397", ink2: "#6A717B", fog: "#6A717B" },
  };

  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  // Snap to 5 bits a channel, like a 15-bit console palette.
  const q5 = (v) => Math.round((Math.max(0, Math.min(255, v)) / 255) * 31) * (255 / 31);
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  SD.mix = mix;

  // Scene light by time of day: every scene colour is multiplied by the light, then snapped.
  // The text plates are DOM and never pass through this.
  const LIGHT = {
    dawn: [1.0, 0.86, 0.84], day: [1, 1, 1], dusk: [0.82, 0.66, 0.78], night: [0.36, 0.42, 0.62], storm: [0.5, 0.54, 0.6],
  };
  let curLight = LIGHT.day;
  const litCache = new Map();
  function lit(h) {
    const k = h + curLight.join();
    let r = litCache.get(k);
    if (!r) { const c = rgb(h); r = hex(c.map((v, i) => q5(v * curLight[i]))); litCache.set(k, r); }
    return r;
  }

  // ---- Seeded randomness so the scene is identical on every render -----------------------
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  const hash = (str) => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const dither = (x, y, t) => BAYER[y & 3][x & 3] < t * 16;

  // ---- State glyphs (12 x 12): drawn for this project in phase 1, CC0 ----------------------
  // '#' state colour, 'k' dark, 'o' dark outline.
  const G = {
    needs: [".....##.....", "....####....", "...##kk##...", "..###kk###..", ".####kk####.", "#####kk#####", "#####kk#####", ".####kk####.", "..########..", "...##kk##...", "....####....", ".....##....."],
    approve: ["...oooooo...", "..o######o..", ".o##oooo##o.", ".oooo..o##o.", "......o##o..", ".....o##o...", "....o##o....", "....o##o....", ".....oo.....", "....o##o....", "....o##o....", ".....oo....."],
    moving: ["............", "..o.........", "..o#o.......", "..o##o......", "..o###o.....", "..o####o....", "..o####o....", "..o###o.....", "..o##o......", "..o#o.......", "..o.........", "............"],
    done: ["............", "..........o.", ".........o#o", "........o#o.", ".o.....o#o..", "o#o...o#o...", ".o#o.o#o....", "..o#o#o.....", "...o#o......", "....o.......", "............", "............"],
    failed: ["............", ".o.......o..", "o#o.....o#o.", ".o#o...o#o..", "..o#o.o#o...", "...o#o#o....", "...o#o#o....", "..o#o.o#o...", ".o#o...o#o..", "o#o.....o#o.", ".o.......o..", "............"],
    blocked: ["............", "############", "#k###k###k##", "############", "##k###k###k#", "############", "#k###k###k##", "############", "##k###k###k#", "############", "............", "............"],
    mate: ["############", "#k########k#", ".#k######k#.", "..#k####k#..", "...#k##k#...", "....#kk#....", "....#..#....", "...#....#...", "..#..##..#..", ".#.######.#.", "#k########k#", "############"],
    scout: ["............", "............", "##..........", "#k####......", "#k########..", "#kkkkkkkkkk#", "#k########..", "#k####......", "##..........", "............", "............", "............"],
    unknown: [".....##.....", "....#..#....", "...#.##.#...", "..#.#..#.#..", ".#.....#..#.", "#.....#....#", "#....#.....#", ".#...#....#.", "..#.......#.", "...#.#..#...", "....#..#....", ".....##....."],
    long: ["...######...", "..#......#..", ".#...##...#.", "#....##....#", "#....##....#", "#....#####.#", "#....#####.#", "#..........#", ".#........#.", "..#......#..", "...######...", "............"],
    regressed: ["...######...", "..##....##..", ".##......##.", ".#........#.", ".#........#.", "###.......#.", ".#.......##.", "........##..", ".......##...", "....####....", "............", "............"],
    asleep: ["............", "......####..", ".........#..", "........#...", ".......####.", "..###.......", "....#.......", "...#........", "..###.......", "............", "............", "............"],
  };
  // Machine pips (8 x 8): square ok, triangle warn, cross down, dotted diamond silent.
  const PIP = {
    ok: ["........", ".######.", ".######.", ".######.", ".######.", ".######.", ".######.", "........"],
    warn: ["...##...", "...##...", "..####..", "..####..", ".######.", ".######.", "########", "........"],
    down: ["##....##", "###..###", ".######.", "..####..", "..####..", ".######.", "###..###", "##....##"],
    silent: ["...#....", "..#.#...", ".#...#..", "#.....#.", ".#...#..", "..#.#...", "...#....", "........"],
    lamp: ["..####..", ".######.", "########", "########", "########", "########", ".######.", "..####.."],
  };
  SD.GLYPHS = G;

  // A glyph as a small canvas at one art pixel per glyph pixel; CSS scales it by --ap.
  SD.glyphCanvas = function (name, color, opts) {
    const rows = G[name] || PIP[name];
    const c = document.createElement("canvas");
    c.width = rows[0].length; c.height = rows.length;
    c.className = "px glyph g-" + name + (opts && opts.cls ? " " + opts.cls : "");
    c.setAttribute("aria-hidden", "true");
    const x = c.getContext("2d");
    const dark = (opts && opts.dark) || "#14100C";
    rows.forEach((r, y) => [...r].forEach((ch, i) => {
      if (ch === ".") return;
      x.fillStyle = ch === "#" ? color : dark;
      x.fillRect(i, y, 1, 1);
    }));
    return c;
  };

  // ---- Crew sprites (16 x 24), built from parts so every pose shares one body ----------------
  function blank(w, h) { return Array.from({ length: h }, () => Array(w).fill(".")); }
  function put(g, x, y, ch) { if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch; }
  function line(g, x0, y0, x1, y1, ch) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) { put(g, x0, y0, ch); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function rect(g, x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, ch); }
  function arm(g, pts, hand) {
    for (let i = 0; i < pts.length - 1; i++) line(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], "a");
    if (hand) put(g, hand[0], hand[1], "s");
  }

  const POSES = {
    stand: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [12, 16]], [12, 17]] },
    hammer1: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [12, 9]], [12, 8]], prop: "hammerUp" },
    hammer2: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [13, 15]], [14, 16]], prop: "hammerDown" },
    hoist1: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [13, 10]], [14, 8]], prop: "rope" },
    hoist2: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [13, 13]], [14, 12]], prop: "rope" },
    scroll: { L: [[[3, 13], [2, 9], [2, 7]], [2, 6]], R: [[[12, 13], [13, 9], [13, 7]], [13, 6]], prop: "scroll" },
    crossed: { L: [[[3, 13], [3, 15], [10, 15]], null], R: [[[12, 13], [12, 16], [5, 16]], null], face: "frown" },
    cheer: { L: [[[3, 13], [2, 10], [1, 7]], [1, 6]], R: [[[12, 13], [13, 10], [14, 7]], [14, 6]], face: "open" },
    sit: { L: [[[3, 13], [3, 16]], [4, 17]], R: [[[12, 13], [12, 16]], [11, 17]], sit: true },
    spy: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [12, 11]], [11, 10]], prop: "spyglass" },
    worried: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [12, 11]], [11, 10]], face: "frown" },
  };

  const gridCache = new Map();
  function crewGrid(pose) {
    if (gridCache.has(pose)) return gridCache.get(pose);
    const P = POSES[pose] || POSES.stand;
    const g = blank(16, 24);
    const dy = P.sit ? 2 : 0;
    if (P.prop === "rope") line(g, 14, 0, 14, 23, "r");
    // legs and boots
    if (P.sit) { rect(g, 5, 19, 6, 20, "p"); rect(g, 9, 19, 10, 20, "p"); rect(g, 4, 21, 6, 21, "b"); rect(g, 9, 21, 11, 21, "b"); }
    else { rect(g, 5, 18, 6, 21, "p"); rect(g, 9, 18, 10, 21, "p"); put(g, 6, 21, "P"); put(g, 10, 21, "P"); rect(g, 4, 22, 6, 22, "b"); rect(g, 9, 22, 11, 22, "b"); }
    // torso
    rect(g, 5, 12 + dy, 10, 12 + dy, "c");
    rect(g, 4, 13 + dy, 11, 16 + dy, "c");
    rect(g, 5, 17 + dy, 10, 17 + dy, "p");
    // head
    rect(g, 6, 5 + dy, 9, 5 + dy, "h");
    rect(g, 5, 6 + dy, 10, 6 + dy, "h");
    rect(g, 5, 7 + dy, 11, 7 + dy, "H");
    rect(g, 5, 8 + dy, 10, 10 + dy, "s");
    rect(g, 6, 11 + dy, 9, 11 + dy, "s");
    put(g, 5, 10 + dy, "S"); put(g, 10, 10 + dy, "S");
    put(g, 6, 9 + dy, "e"); put(g, 9, 9 + dy, "e");
    if (P.face === "open") { put(g, 7, 11 + dy, "e"); put(g, 8, 11 + dy, "e"); }
    if (P.face === "frown") { put(g, 6, 8 + dy, "S"); put(g, 9, 8 + dy, "S"); }
    // arms
    const sh = (pts) => pts.map(([x, y]) => [x, y + dy]);
    arm(g, sh(P.L[0]), P.L[1] && sh([P.L[1]])[0]);
    arm(g, sh(P.R[0]), P.R[1] && sh([P.R[1]])[0]);
    // props
    if (P.prop === "hammerUp") { line(g, 13, 4, 13, 8, "t"); rect(g, 12, 2, 14, 3, "m"); }
    if (P.prop === "hammerDown") { line(g, 14, 17, 14, 18, "t"); rect(g, 13, 19, 15, 20, "m"); }
    if (P.prop === "scroll") { rect(g, 3, 2, 12, 4, "x"); for (const x of [5, 6, 8, 9, 10]) put(g, x, 3, "X"); rect(g, 2, 1, 2, 5, "X"); rect(g, 13, 1, 13, 5, "X"); }
    if (P.prop === "spyglass") { rect(g, 9, 8, 14, 9, "m"); put(g, 15, 8, "M"); put(g, 15, 9, "M"); }
    gridCache.set(pose, g);
    return g;
  }

  // Outline every filled pixel's empty 4-neighbours, the way hand-pixelled sprites are inked.
  function withOutline(g) {
    const h = g.length, w = g[0].length;
    const out = g.map((r) => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g[y][x] !== ".") continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const v = g[y + dy] && g[y + dy][x + dx]; return v && v !== "." && v !== "r"; })) out[y][x] = "o";
    }
    return out;
  }
  const outlined = new Map();
  function crewSprite(pose) { if (!outlined.has(pose)) outlined.set(pose, withOutline(crewGrid(pose))); return outlined.get(pose); }

  // Crew looks: skin and cap vary by lane id; the shirt says the project by pattern, never by a status hue.
  const SKIN = [["#F0C8A0", "#D09C78"], ["#D8A078", "#B07850"], ["#A86E48", "#84502E"], ["#704830", "#54341F"]];
  const CAPS = [["#3A4A6E", "#2A3652"], ["#4A4A56", "#36363F"], ["#56603E", "#40482E"], ["#6A4A5E", "#4E3646"], ["#2E5A5E", "#224446"]];
  const PROJECT_LOOK = {
    orrery: { c: "#DCD6C8", stripe: "#3A4C70", a: "#B8B0A0" }, // striped deck shirt
    folio: { c: "#8A7A64", stripe: null, a: "#6E604E" }, // plain oilcloth smock
  };
  SD.crewLook = function (id, group) {
    const h = hash(id);
    const sk = SKIN[h % SKIN.length], cp = CAPS[(h >>> 3) % CAPS.length];
    const pl = PROJECT_LOOK[group] || PROJECT_LOOK.folio;
    return { s: sk[0], S: sk[1], h: cp[0], H: cp[1], c: pl.c, stripe: pl.stripe, a: pl.a, p: "#3A4256", P: "#2A3042", b: "#2A2224",
      e: "#1A1420", o: "#1A1420", t: "#7A5232", m: "#A8B0BA", M: "#6A727C", x: "#EADFC4", X: "#B8A47C", r: "#8A6A48" };
  };

  // Draw a sprite grid at (x, y). mode "ghost" draws a dithered outline only (no word from the lane).
  function drawGrid(ctx, g, x, y, look, mode, flip) {
    const w = g[0].length;
    for (let j = 0; j < g.length; j++) for (let i = 0; i < w; i++) {
      let ch = g[j][i];
      if (ch === ".") continue;
      const px = x + (flip ? w - 1 - i : i), py = y + j;
      if (mode === "ghost") {
        // No word from this lane: an outline in fog with a dithered body, the shape without the person.
        if (ch === "o" || (px + py) % 2 === 0) { ctx.fillStyle = look.ghost; ctx.fillRect(px, py, 1, 1); }
        continue;
      }
      let col;
      if (ch === "c" && look.stripe && j % 2 === 1) col = look.stripe;
      else col = look[ch];
      if (!col) continue;
      ctx.fillStyle = lit(col);
      ctx.fillRect(px, py, 1, 1);
    }
  }
  SD.drawCrew = function (ctx, pose, x, y, look, mode, flip) { drawGrid(ctx, crewSprite(pose), x, y, look, mode, flip); };

  // Hammock (16 x 8) for crew resting at night.
  const HAMMOCK = withOutline([
    "................",
    "r..............r",
    ".r............r.",
    "..xxsshhcccccx..",
    "..xxsshhccccxx..",
    "...xxxxxxxxxx...",
    "....XXXXXXXX....",
    "................",
  ].map((r) => [...r]));
  SD.drawHammock = function (ctx, x, y, look) { drawGrid(ctx, HAMMOCK, x, y, { ...look, x: "#C8BC9C", X: "#9A8E70" }); };

  // ---- The lookout crow (16 x 12) ---------------------------------------------------------------
  const CROW = {
    perch: ["......kkkk..........", ".....kkkkkk.........", "....kkwkkkkk........", "..bbbkkkkkkk........", "....bbkkkkkkk.......", ".....kkkkkkkkk......", ".....kkkKKKKkkkk....", "......kkKKKKKKkkkk..", "......kkkKKKKKKkkkkk", ".......kkkkkkkkkk.kk", "........kkkkkk......", ".........y..y.......", ".........y..y.......", "........yy.yy......."],
    fly1: ["..........kk........", ".........kKk........", "........kKKk........", ".......kKKk.........", "..kkk.kKKk..........", ".kkwkkKKk...........", "bbkkkkkkkkkk........", "..bkkkkkkkkkkkk.....", ".....kkkkkkkkkkkkk..", "........kkkkk...kkk.", "....................", "....................", "....................", "...................."],
    fly2: ["....................", "....................", "..kkk...............", ".kkwkk..............", "bbkkkkkkkkkk........", "..bkkkkkkkkkkkk.....", ".....kkKKKkkkkkkkk..", "......kKKKk.....kkk.", ".......kKKk.........", "........kKk.........", ".........kk.........", "....................", "....................", "...................."],
  };
  const crowGrids = {};
  for (const k in CROW) {
    const g = CROW[k].map((r) => [...r]);
    const h = g.length, w = g[0].length;
    const out = g.map((r) => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y][x] === "." && [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx] && g[y + dy][x + dx] !== ".")) out[y][x] = "o";
    crowGrids[k] = out;
  }
  SD.drawCrow = function (ctx, frame, x, y, flip, night) {
    const look = { k: "#1C1A26", K: "#46445E", b: "#8A8F98", w: "#E8ECF1", y: "#6A6E78", o: night ? "#3A4258" : "#14100C" };
    const g = crowGrids[frame] || crowGrids.perch;
    const w = g[0].length;
    for (let j = 0; j < g.length; j++) for (let i = 0; i < w; i++) {
      const ch = g[j][i];
      if (ch === ".") continue;
      ctx.fillStyle = look[ch];
      ctx.fillRect(x + (flip ? w - 1 - i : i), y + j, 1, 1);
    }
  };

  // ---- Sky, sea and weather ---------------------------------------------------------------------
  const SKY = {
    dawn: ["#262A58", "#3E4A84", "#6E6CA4", "#A882A2", "#D49C86"],
    day: ["#1E3E66", "#2E5888", "#4474A6", "#6694C2", "#8EB6DA"],
    dusk: ["#181634", "#252148", "#38305C", "#56406A", "#7E5070", "#A0606E"],
    night: ["#050816", "#080E22", "#0B142E", "#0F1C3C", "#142446"],
    storm: ["#101218", "#171A22", "#1E222C", "#272C38", "#323844"],
  };
  const SEA = {
    dawn: ["#56689A", "#3E4E7E", "#2C3962", "#1E284A", "#151C38"],
    day: ["#3C7098", "#2E5C84", "#22496C", "#183856", "#102842"],
    dusk: ["#4C3E68", "#3A3258", "#2A2646", "#1E1C38", "#14142A"],
    night: ["#14223E", "#0F1A32", "#0B1428", "#080F20", "#050A16"],
    storm: ["#343C48", "#283038", "#1E242C", "#161A22", "#101318"],
  };
  const CLOUD = {
    dawn: ["#E2B4A6", "#B8909E", "#8E7090"], day: ["#D6E2EE", "#AFC2D6", "#8AA2BE"], dusk: ["#B07488", "#86566E", "#5E405A"],
    night: ["#1E2A4A", "#18223E", "#121A32"], storm: ["#3A404C", "#2C313B", "#22262E"],
  };

  function bands(ctx, x0, y0, w, h, stops, seedX) {
    // Vertical ramp: solid bands with a Bayer-dithered seam between neighbours (large fields only).
    const n = stops.length;
    for (let y = 0; y < h; y++) {
      const f = (y / Math.max(1, h - 1)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f)), t = f - i;
      // Hold each band solid for most of its height and dither only the last third.
      const tt = t < 0.66 ? 0 : (t - 0.66) / 0.34;
      for (let x = 0; x < w; x++) {
        ctx.fillStyle = dither(x + (seedX || 0), y, tt) ? stops[i + 1] : stops[i];
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  }
  // Faster banded fill: draw rows run-length (the dither pattern repeats every 4 px).
  function bandsFast(ctx, x0, y0, w, h, stops) {
    const n = stops.length;
    for (let y = 0; y < h; y++) {
      const f = (y / Math.max(1, h - 1)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f)), t = f - i;
      const tt = t < 0.6 ? 0 : (t - 0.6) / 0.4;
      ctx.fillStyle = stops[i];
      ctx.fillRect(x0, y0 + y, w, 1);
      if (tt > 0) {
        ctx.fillStyle = stops[i + 1];
        for (let x = 0; x < w; x++) if (dither(x, y0 + y, tt)) ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  }

  function cloud(ctx, cx, cy, w, h, cols, r) {
    // A pixel cumulus: stacked ellipse lobes, lit top, shaded base.
    const lobes = 3 + Math.floor(r() * 3);
    const pts = [];
    for (let i = 0; i < lobes; i++) {
      const lx = cx + (i / (lobes - 1 || 1) - 0.5) * w * 0.8, lw = w * (0.28 + r() * 0.18), lh = h * (0.5 + r() * 0.5);
      pts.push([lx, cy - lh * 0.3, lw, lh]);
    }
    for (let y = Math.floor(cy - h); y <= cy + h * 0.4; y++) for (let x = Math.floor(cx - w / 2 - 4); x <= cx + w / 2 + 4; x++) {
      let inside = false;
      for (const [lx, ly, lw, lh] of pts) { const dx = (x - lx) / lw, dy = (y - ly) / lh; if (dx * dx + dy * dy <= 1) { inside = true; break; } }
      if (!inside || y > cy + h * 0.25) continue;
      const rel = (y - (cy - h)) / (h * 1.25);
      ctx.fillStyle = rel < 0.35 ? cols[0] : rel < 0.7 ? cols[1] : cols[2];
      ctx.fillRect(x, y, 1, 1);
    }
  }

  function stars(ctx, x0, y0, w, h, r) {
    for (let i = 0; i < (w * h) / 260; i++) {
      const x = x0 + Math.floor(r() * w), y = y0 + Math.floor(r() * h * 0.85);
      const b = r();
      ctx.fillStyle = b > 0.92 ? "#C8CCD8" : b > 0.6 ? "#7C849C" : "#4A5270";
      ctx.fillRect(x, y, 1, 1);
      if (b > 0.97) { ctx.fillStyle = "#4A5270"; ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    }
  }

  function disc(ctx, cx, cy, rad, col, clipY) {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y > rad * rad + rad * 0.6) continue;
      if (clipY != null && cy + y >= clipY) continue;
      ctx.fillStyle = col; ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }

  // ---- The ship -------------------------------------------------------------------------------
  const WOOD = { o: "#1A1014", dark: "#3E2618", mid: "#5E3C26", light: "#7E5434", trim: "#A2744A", deck: "#8A6040", mast: "#5A3A24", mastD: "#3A2416" };
  const SAIL = { lit: "#E6DCC4", mid: "#C4B698", shade: "#968A70", o: "#4A3E30" };

  // Draws the hull, rigging and sails. L: {x0, x1, deck, water, masts:[{x, top, nest}], sections}.
  function shipBack(ctx, L, r) {
    // Rigging: dark lines from mast heads to the bow and stern.
    ctx.fillStyle = lit("#2A1E18");
    const rig = (ax, ay, bx, by) => { const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)); for (let i = 0; i <= n; i += 1) ctx.fillRect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1); };
    const ms = L.masts;
    if (ms.length) {
      rig(ms[0].x, ms[0].top + 4, L.x0 + 4, L.deck - 14);
      rig(ms[ms.length - 1].x, ms[ms.length - 1].top + 4, L.x1 + L.bowsprit, L.deck - 4);
      for (let i = 0; i < ms.length - 1; i++) rig(ms[i].x, ms[i].top + 2, ms[i + 1].x, ms[i + 1].top + 10);
    }
    // Masts, yards, sails.
    for (const m of ms) {
      ctx.fillStyle = lit(WOOD.mast); ctx.fillRect(m.x - 1, m.top, 3, L.deck - m.top);
      ctx.fillStyle = lit(WOOD.mastD); ctx.fillRect(m.x + 1, m.top, 1, L.deck - m.top);
      // pennant
      ctx.fillStyle = lit("#B8B0A0");
      for (let i = 0; i < 8; i++) ctx.fillRect(m.x + 2 + i, m.top + 1 + (i > 4 ? 1 : 0), 1, i < 6 ? 2 : 1);
      const sw = m.sail;
      const sails = [[m.top + 14, m.top + 14 + sw.h1, sw.w1], [m.top + 18 + sw.h1, m.top + 18 + sw.h1 + sw.h2, sw.w2]];
      for (const [ya, yb, w] of sails) {
        if (yb >= L.deck - 26) continue;
        ctx.fillStyle = lit(WOOD.mastD); ctx.fillRect(m.x - w / 2 - 2, ya - 2, w + 4, 2);
        for (let y = ya; y < yb; y++) {
          const t = (y - ya) / (yb - ya);
          const bulge = Math.round(Math.sin(t * Math.PI) * 3);
          const half = Math.round(w / 2 - (1 - t) * 2) + bulge;
          for (let x = -half; x <= half; x++) {
            const edge = x === -half || x === half || y === ya;
            let c = SAIL.lit;
            if (x > half * 0.45) c = SAIL.mid;
            if (x > half * 0.8 || t > 0.85) c = SAIL.shade;
            if (edge) c = SAIL.o;
            ctx.fillStyle = lit(c); ctx.fillRect(m.x + x, y, 1, 1);
          }
        }
        // seams
        ctx.fillStyle = lit(SAIL.mid);
        for (let s = -w / 2 + 6; s < w / 2 - 2; s += 7) for (let y = ya + 2; y < yb - 1; y += 2) ctx.fillRect(m.x + Math.round(s), y, 1, 1);
      }
      if (m.nest) {
        // crow's nest: a barrel platform; scouts are drawn by the caller between back and nest front
        ctx.fillStyle = lit(WOOD.mastD); ctx.fillRect(m.x - 8, m.nestY + 8, 17, 2);
      }
    }
  }
  function nestFront(ctx, m) {
    const y = m.nestY;
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = lit(i === 0 ? WOOD.o : i < 3 ? WOOD.light : i < 7 ? WOOD.mid : WOOD.dark);
      ctx.fillRect(m.x - 8, y + i, 17, 1);
    }
    ctx.fillStyle = lit(WOOD.o);
    ctx.fillRect(m.x - 8, y, 1, 9); ctx.fillRect(m.x + 8, y, 1, 9);
    ctx.fillStyle = lit(WOOD.trim); ctx.fillRect(m.x - 7, y + 1, 15, 1);
  }

  function hull(ctx, L, night) {
    const { x0, x1, deck, water } = L;
    const sternRise = 8;
    const bottom = water + 6;
    // Outline of the hull as a function of x: top edge and bottom edge.
    const top = (x) => (x < x0 + 26 ? deck - sternRise : deck);
    const bot = (x) => {
      const t = (x - x0) / (x1 - x0);
      return Math.round(bottom - Math.max(0, (t - 0.82) / 0.18) ** 1.6 * (bottom - deck + 2) - Math.max(0, (0.06 - t) / 0.06) * 6);
    };
    const prowX = (y) => x1 + Math.round(((deck + 2 - y) / (bottom - deck + 2)) * 10); // raked bow
    for (let x = x0; x <= x1 + 12; x++) {
      const yt = top(Math.min(x, x1)), yb = x <= x1 ? bot(x) : 0;
      for (let y = yt; y <= Math.max(yb, yt); y++) {
        if (x > x1 && x > prowX(y)) continue;
        if (x > x1 && y > deck + 10) continue;
        const k = y - yt;
        let c = k < 2 ? WOOD.trim : k < 4 ? WOOD.light : (Math.floor((y - deck) / 3) % 2 ? WOOD.mid : WOOD.dark);
        if (y >= water - 1) c = WOOD.dark;
        if (y > water + 1) c = "#2A1A12";
        ctx.fillStyle = lit(c); ctx.fillRect(x, y, 1, 1);
      }
    }
    // dark outline: stern post and keel line
    ctx.fillStyle = lit(WOOD.o);
    ctx.fillRect(x0 - 1, deck - sternRise, 1, bottom - deck + sternRise - 4);
    ctx.fillRect(x0 - 1, deck - sternRise - 1, 27, 1);
    // stern lantern
    ctx.fillStyle = lit(WOOD.mastD); ctx.fillRect(x0 + 2, deck - sternRise - 9, 1, 8);
    ctx.fillStyle = night ? "#E8DDB8" : lit("#C8BC9C"); ctx.fillRect(x0 + 1, deck - sternRise - 12, 3, 4);
    ctx.fillStyle = lit(WOOD.o); ctx.fillRect(x0 + 1, deck - sternRise - 13, 3, 1);
    // portholes, lit at night
    for (let x = x0 + 14; x < x1 - 14; x += 22) {
      ctx.fillStyle = lit(WOOD.o); ctx.fillRect(x, deck + 12, 4, 4);
      ctx.fillStyle = night ? "#C8BC90" : lit("#2A1A12"); ctx.fillRect(x + 1, deck + 13, 2, 2);
    }
    // bowsprit
    ctx.fillStyle = lit(WOOD.mast);
    for (let i = 0; i < L.bowsprit; i++) ctx.fillRect(x1 + 6 + i, deck - 2 - Math.floor(i / 3), 2, 1);
  }

  function rail(ctx, L) {
    const { x0, x1, deck } = L;
    ctx.fillStyle = lit(WOOD.trim);
    ctx.fillRect(x0 + 26, deck - 8, x1 - x0 - 24, 1);
    ctx.fillStyle = lit(WOOD.o);
    ctx.fillRect(x0 + 26, deck - 7, x1 - x0 - 24, 1);
    for (let x = x0 + 28; x < x1; x += 7) { ctx.fillStyle = lit(WOOD.mid); ctx.fillRect(x, deck - 6, 1, 6); }
    // quarterdeck rail
    ctx.fillStyle = lit(WOOD.trim); ctx.fillRect(x0, deck - 16, 26, 1);
    for (let x = x0 + 2; x < x0 + 26; x += 6) { ctx.fillStyle = lit(WOOD.mid); ctx.fillRect(x, deck - 15, 1, 7); }
  }

  function crate(ctx, x, y) {
    const c = [["#8A6440", "#6A4A2C", "#4A321C"]][0];
    for (let j = 0; j < 9; j++) for (let i = 0; i < 10; i++) {
      const edge = i === 0 || j === 0 || i === 9 || j === 8;
      const diag = i === j || i === 9 - j;
      ctx.fillStyle = lit(edge ? "#2A1A10" : diag ? c[2] : j < 3 ? c[0] : c[1]);
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
  function barrel(ctx, x, y) {
    for (let j = 0; j < 7; j++) for (let i = 0; i < 8; i++) {
      if ((j === 0 || j === 6) && (i === 0 || i === 7)) continue;
      const hoop = j === 1 || j === 5;
      ctx.fillStyle = lit(i === 0 || i === 7 || j === 0 || j === 6 ? "#2A1A10" : hoop ? "#5A5A62" : i < 3 ? "#8A6440" : "#6A4A2C");
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
  function ember(ctx, x, y, red) {
    // A small fire at the failed station, in the trouble hue so the smoke reads as a failure.
    const px = [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
    ctx.fillStyle = red; for (const [i, j] of px) ctx.fillRect(x + i, y + j, 1, 1);
    ctx.fillStyle = "#3A1A10"; ctx.fillRect(x - 1, y + 3, 6, 1);
  }
  function smoke(ctx, x, y, phase) {
    const puffs = [[0, 0, 3], [2 + (phase % 2), -6, 4], [5, -13, 5], [8 + (phase % 2), -21, 5]];
    for (const [dx, dy, rad] of puffs) {
      for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
        if (i * i + j * j > rad * rad) continue;
        const shade = j < -rad / 3 ? "#9A9AA2" : "#6E6E78";
        if (i * i + j * j > (rad - 1) * (rad - 1) && (i + j) % 2) continue;
        ctx.fillStyle = lit(shade); ctx.fillRect(x + dx + i, y + dy + j, 1, 1);
      }
    }
  }

  function waves(ctx, x0, y0, w, h, cols, r, ship) {
    // Short highlight dashes, denser near the horizon, as a far-to-near parallax.
    for (let i = 0; i < (w * h) / 40; i++) {
      const y = y0 + Math.floor(r() ** 1.6 * h);
      const x = x0 + Math.floor(r() * w);
      const depth = (y - y0) / h;
      const len = 2 + Math.floor(depth * 6 + r() * 3);
      if (ship && x + len > ship.x0 - 6 && x < ship.x1 + 16 && y < ship.water + 6 && y > ship.deck) continue;
      ctx.fillStyle = depth < 0.2 ? cols[0] : depth < 0.6 ? cols[1] : cols[2];
      ctx.fillRect(x, y, len, 1);
    }
  }

  // ---- Whole scene ----------------------------------------------------------------------------
  // S: { W, H, horizon, ship (layout or null), crew: [{x, y, pose, look, mode, mark, prop, flip}], nests, crow,
  //      tod, weather, fog: [{x0,x1}] | "all", degraded: [{x, y}], frame, flash, night, vignette, harbour }
  SD.paintScene = function (ctx, S) {
    const tod = S.weather === "storm" ? "storm" : S.tod;
    curLight = LIGHT[tod] || LIGHT.day;
    const W = S.W, H = S.H, hz = S.horizon;
    const r = rng(1234);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    // Sky: unlit stops (they are already the light of that hour).
    bandsFast(ctx, 0, 0, W, hz, SKY[tod]);
    const moon = S.moon || { x: Math.round(W * 0.8), y: Math.round(hz * 0.3) };
    if (tod === "night") { stars(ctx, 0, 0, W, hz, rng(77)); disc(ctx, moon.x, moon.y, 6, "#D8DCE6"); disc(ctx, moon.x + 3, moon.y - 2, 5, SKY.night[0]); }
    if (tod === "dawn") disc(ctx, Math.round(W * 0.82), hz - 2, 10, "#E8B8A0", hz);
    if (tod === "day") disc(ctx, Math.round(W * 0.12), Math.round(hz * 0.2), 7, "#EEF0E8");
    if (tod === "dusk") disc(ctx, Math.round(W * 0.88), hz - 4, 9, "#D08A82", hz);
    // Clouds in two layers.
    const cr = rng(99);
    const cols = CLOUD[tod];
    for (let i = 0; i < Math.max(3, W / 90); i++) cloud(ctx, Math.round(cr() * W), Math.round(hz * (0.18 + cr() * 0.45)), 30 + cr() * 50, 6 + cr() * 6, [cols[1], cols[2], cols[2]], cr);
    for (let i = 0; i < Math.max(2, W / 160); i++) cloud(ctx, Math.round(cr() * W), Math.round(hz * (0.1 + cr() * 0.5)), 40 + cr() * 50, 8 + cr() * 7, cols, cr);
    // Storm: lightning on flash frames.
    if (tod === "storm" && S.flash) {
      ctx.fillStyle = "#3A4050"; ctx.fillRect(0, 0, W, Math.round(hz * 0.6));
      let x = Math.round(W * 0.7), y = 0;
      ctx.fillStyle = "#E8ECF1";
      while (y < hz - 10) { const nx = x + Math.round((r() - 0.5) * 8); for (let k = 0; k < 6; k++) ctx.fillRect(Math.round(x + ((nx - x) * k) / 6), y + k, 2, 1); x = nx; y += 6; }
    }

    // Horizon and sea.
    const sea = SEA[tod];
    bandsFast(ctx, 0, hz, W, H - hz, sea);
    ctx.fillStyle = mix(sea[0], SKY[tod][SKY[tod].length - 1], 0.5); ctx.fillRect(0, hz, W, 1);
    // A far island ahead on the horizon: the next stop on the voyage.
    if (S.island) {
      const ix = S.island.x, iw = 34;
      for (let i = 0; i < iw; i++) { const hgt = Math.round(Math.sin((i / iw) * Math.PI) * 6); ctx.fillStyle = mix(sea[0], "#1A1A2A", 0.55); ctx.fillRect(ix + i, hz - hgt, 1, hgt); }
    }
    const wc = tod === "night" ? ["#24345A", "#1C2A4C", "#16223E"] : tod === "storm" ? ["#5A6474", "#4A5260", "#3C4450"] : [mix(sea[0], "#FFFFFF", 0.25), mix(sea[1], "#FFFFFF", 0.18), mix(sea[2], "#FFFFFF", 0.12)];
    waves(ctx, 0, hz + 2, W, H - hz - 2, wc, rng(5), S.ship);
    if (tod === "night") { // moon path
      const mx = moon.x;
      for (let y = hz + 2; y < H; y += 2) { const w = 2 + Math.floor(rng(y)() * 6); ctx.fillStyle = "#3A4A6E"; ctx.fillRect(mx - w / 2, y, w, 1); }
    }

    // The ship and her crew.
    if (S.ship) {
      const L = S.ship;
      shipBack(ctx, L, r);
      // Scouts stand in the nests: draw them, then the nest front over their legs.
      for (const n of S.nests || []) {
        for (const c of n.crew) SD.drawCrew(ctx, c.pose, c.x, c.y, c.look, c.mode, c.flip);
        nestFront(ctx, n.mast);
      }
      if (!S.harbour) hull(ctx, L, S.night);
      else hull(ctx, L, S.night);
      // Props behind crew.
      for (const c of S.crew) {
        if (c.prop === "barrel") barrel(ctx, c.x + 4, L.deck - 7);
      }
      for (const c of S.crew) {
        if (c.pose === "hammock") continue;
        SD.drawCrew(ctx, c.pose, c.x, c.y, c.look, c.mode, c.flip);
      }
      for (const c of S.crew) if (c.prop === "crate") crate(ctx, c.x + 11, L.deck - 9);
      for (const c of S.crew) if (c.pose === "hammock") SD.drawHammock(ctx, c.x, L.deck - 22, c.look);
      rail(ctx, L);
      for (const c of S.crew) if (c.prop === "smoke") { smoke(ctx, c.x + 3, c.y - 2, 0); ember(ctx, c.x - 1, L.deck - 4, S.trouble || "#FF5F4A"); }
      // Foam along the waterline.
      ctx.fillStyle = lit("#C8D0DC");
      const fr = rng(31);
      for (let x = L.x0 - 3; x < L.x1 + 12; x++) if (fr() > 0.45) ctx.fillRect(x, L.water + 1 + (fr() > 0.7 ? 1 : 0), 1 + Math.floor(fr() * 2), 1);
      // Local weather over a struggling machine: a small rain cloud over its mast.
      for (const d of S.degraded || []) {
        cloud(ctx, d.x, d.y, 34, 7, tod === "night" ? ["#2A3048", "#20263A", "#181C2E"] : ["#6A6E7C", "#4E525E", "#3A3E48"], rng(d.x));
        ctx.fillStyle = tod === "night" ? "#3A4462" : "#8A94A8";
        const rr = rng(d.x + 1);
        for (let i = 0; i < 20; i++) { const x = d.x - 14 + Math.floor(rr() * 28), y = d.y + 4 + Math.floor(rr() * 14); ctx.fillRect(x, y, 1, 2); }
      }
    }

    // Storm rain over everything.
    if (tod === "storm") {
      ctx.fillStyle = "#6A7484";
      const rr = rng(7 + (S.frame || 0));
      for (let i = 0; i < (W * H) / 70; i++) { const x = Math.floor(rr() * W), y = Math.floor(rr() * H); ctx.fillRect(x, y, 1, 1); ctx.fillRect(x - 1, y + 1, 1, 1); ctx.fillRect(x - 2, y + 2, 1, 1); }
    }

    // Fog: stale data. Dithered fog over the silent part of the deck, or the whole sea.
    if (S.fog) {
      const fogCol = S.night ? "#3A4048" : "#8D97A5";
      const zones = S.fog === "all" ? [{ x0: 0, x1: W, y0: 0, y1: H, d: 0.5 }] : S.fog;
      for (const z of zones) {
        for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
          // soft edges: density falls off over 12 px at each side
          const e = Math.min(1, (x - z.x0) / 12, (z.x1 - x) / 12, (y - z.y0) / 8, (z.y1 - y) / 8);
          if (dither(x, y, z.d * Math.max(0, e))) { ctx.fillStyle = fogCol; ctx.fillRect(x, y, 1, 1); }
        }
      }
    }

    // Crow.
    if (S.crow) SD.drawCrow(ctx, S.crow.frame, S.crow.x, S.crow.y, S.crow.flip, S.night);

    // Critical: a dark red edge, stepped in whole art pixels.
    if (S.vignette) {
      const cs = ["#5A1A18", "#3E1414", "#2A0E0E"];
      for (let k = 0; k < 3; k++) { ctx.fillStyle = cs[k]; ctx.fillRect(k, k, W - 2 * k, 1); ctx.fillRect(k, H - 1 - k, W - 2 * k, 1); ctx.fillRect(k, k, 1, H - 2 * k); ctx.fillRect(W - 1 - k, k, 1, H - 2 * k); }
      ctx.fillStyle = "#FF5F4A"; ctx.fillRect(0, 0, W, 1); ctx.fillRect(0, H - 1, W, 1); ctx.fillRect(0, 0, 1, H); ctx.fillRect(W - 1, 0, 1, H);
    }
  };

  // The voyage chart: islands passed (landed) and ahead (queued), drawn on a small canvas.
  SD.paintChart = function (ctx, w, h, landedXs, aheadKinds, night) {
    ctx.clearRect(0, 0, w, h);
    const y = Math.round(h / 2) + 2;
    const st = SD.STATUS[night ? "night" : "day"];
    const shipX = Math.round(w * 0.62);
    // route: dotted line behind, dashed ahead
    for (let x = 2; x < w - 2; x++) {
      if (x < shipX ? x % 2 === 0 : x % 4 < 2) { ctx.fillStyle = x < shipX ? st.ink2 : st.fog; ctx.fillRect(x, y, 1, 1); }
    }
    const island = (cx, col, flag) => {
      const rows = ["..####..", ".######.", "########"];
      rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === "#") { ctx.fillStyle = col; ctx.fillRect(cx - 4 + i, y - 2 + j, 1, 1); } }));
      if (flag) { ctx.fillStyle = st.ink2; ctx.fillRect(cx, y - 8, 1, 6); ctx.fillStyle = flag; ctx.fillRect(cx + 1, y - 8, 3, 2); }
    };
    for (const x of landedXs) island(Math.round(4 + x * (shipX - 14)), night ? "#4A5040" : "#6E7A5A", st.done);
    const n = aheadKinds.length;
    aheadKinds.forEach((k, i) => {
      const cx = Math.round(shipX + 14 + (i * (w - shipX - 20)) / Math.max(1, n - 1));
      if (k === "gate") { // lighthouse: a release gate
        island(cx, night ? "#30343C" : "#4A505C", null);
        ctx.fillStyle = st.ink2; ctx.fillRect(cx - 1, y - 9, 3, 7); ctx.fillStyle = st.ink; ctx.fillRect(cx - 1, y - 10, 3, 1);
      } else island(cx, night ? "#30343C" : "#4A505C", k === "held" ? st.fog : null);
    });
    // our ship marker
    const S = ["...#....", "..##....", ".###....", "####....", "...#....", "########", ".######."];
    S.forEach((r, j) => [...r].forEach((c, i) => { if (c === "#") { ctx.fillStyle = j < 5 ? st.ink : (night ? "#5A4A3A" : "#8A6440"); ctx.fillRect(shipX - 4 + i, y - 6 + j, 1, 1); } }));
    return shipX;
  };
})();
