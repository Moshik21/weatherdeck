/* Ship-deck scene module (docs/theme-spec.md section 12). Ported from concepts/d-shipdeck/js/art.js.
   It draws art only: the sky, the sea, the ship whose deck sections are the machines, the crew whose
   poses follow their lanes, the weather, the crow at rest, the anchor and the signal hoist. It never
   draws text and never decides state: the core hands it plain data and it depicts it. One canvas
   pixel is one art pixel; the page scales the canvas by whole device pixels. All art is original,
   CC0 (see CREDITS.md). */
(function () {
  "use strict";

  // ---- colour helpers -------------------------------------------------------------------------
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const hex = c => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  // Snap to 5 bits a channel, like a 15-bit console palette.
  const q5 = v => Math.round((Math.max(0, Math.min(255, v)) / 255) * 31) * (255 / 31);
  const snap = h => hex(rgb(h).map(q5));
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  let light = [1, 1, 1];
  const litCache = new Map();
  // Every scene colour is multiplied by the time-of-day light, then snapped. Plates never pass here.
  function lit(h) {
    const k = h + light.join();
    let r = litCache.get(k);
    if (!r) { r = hex(rgb(h).map((v, i) => q5(v * light[i]))); litCache.set(k, r); }
    return r;
  }

  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const hash = str => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const dither = (x, y, t) => BAYER[y & 3][x & 3] < t * 16;

  // ---- crew sprites (16 x 24), built from parts so every pose shares one body -------------------
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
    sit: { L: [[[3, 13], [3, 16]], [4, 17]], R: [[[12, 13], [12, 16]], [11, 17]], sit: true },
    spy: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [12, 11]], [11, 10]], prop: "spyglass" },
    worried: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [12, 11]], [11, 10]], face: "frown" },
    // stations (section 17): bent over the chart table, and holding a lantern over the work at inspection
    chart: { L: [[[3, 13], [5, 15]], [6, 16]], R: [[[12, 13], [10, 15]], [9, 16]] },
    lantern: { L: [[[3, 13], [3, 16]], [3, 17]], R: [[[12, 13], [13, 11]], [14, 10]], prop: "lantern" },
  };
  const gridCache = new Map();
  function crewGrid(pose) {
    if (gridCache.has(pose)) return gridCache.get(pose);
    const P = POSES[pose] || POSES.stand, g = blank(16, 24), dy = P.sit ? 2 : 0;
    if (P.prop === "rope") line(g, 14, 0, 14, 23, "r");
    if (P.sit) { rect(g, 5, 19, 6, 20, "p"); rect(g, 9, 19, 10, 20, "p"); rect(g, 4, 21, 6, 21, "b"); rect(g, 9, 21, 11, 21, "b"); }
    else { rect(g, 5, 18, 6, 21, "p"); rect(g, 9, 18, 10, 21, "p"); put(g, 6, 21, "P"); put(g, 10, 21, "P"); rect(g, 4, 22, 6, 22, "b"); rect(g, 9, 22, 11, 22, "b"); }
    rect(g, 5, 12 + dy, 10, 12 + dy, "c"); rect(g, 4, 13 + dy, 11, 16 + dy, "c"); rect(g, 5, 17 + dy, 10, 17 + dy, "p");
    rect(g, 6, 5 + dy, 9, 5 + dy, "h"); rect(g, 5, 6 + dy, 10, 6 + dy, "h"); rect(g, 5, 7 + dy, 11, 7 + dy, "H");
    rect(g, 5, 8 + dy, 10, 10 + dy, "s"); rect(g, 6, 11 + dy, 9, 11 + dy, "s");
    put(g, 5, 10 + dy, "S"); put(g, 10, 10 + dy, "S"); put(g, 6, 9 + dy, "e"); put(g, 9, 9 + dy, "e");
    if (P.face === "frown") { put(g, 6, 8 + dy, "S"); put(g, 9, 8 + dy, "S"); }
    const sh = pts => pts.map(([x, y]) => [x, y + dy]);
    arm(g, sh(P.L[0]), P.L[1] && sh([P.L[1]])[0]);
    arm(g, sh(P.R[0]), P.R[1] && sh([P.R[1]])[0]);
    if (P.prop === "hammerUp") { line(g, 13, 4, 13, 8, "t"); rect(g, 12, 2, 14, 3, "m"); }
    if (P.prop === "hammerDown") { line(g, 14, 17, 14, 18, "t"); rect(g, 13, 19, 15, 20, "m"); }
    if (P.prop === "scroll") { rect(g, 3, 2, 12, 4, "x"); for (const x of [5, 6, 8, 9, 10]) put(g, x, 3, "X"); rect(g, 2, 1, 2, 5, "X"); rect(g, 13, 1, 13, 5, "X"); }
    if (P.prop === "spyglass") { rect(g, 9, 8, 14, 9, "m"); put(g, 15, 8, "M"); put(g, 15, 9, "M"); }
    if (P.prop === "lantern") { put(g, 14, 6, "M"); rect(g, 13, 7, 15, 9, "M"); put(g, 14, 8, "L"); put(g, 14, 7, "L"); }
    gridCache.set(pose, g);
    return g;
  }
  function withOutline(g) {
    const h = g.length, w = g[0].length, out = g.map(r => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g[y][x] !== ".") continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const v = g[y + dy] && g[y + dy][x + dx]; return v && v !== "." && v !== "r"; })) out[y][x] = "o";
    }
    return out;
  }
  const outlined = new Map();
  const crewSprite = pose => { if (!outlined.has(pose)) outlined.set(pose, withOutline(crewGrid(pose))); return outlined.get(pose); };
  // Crew looks: skin and cap vary by lane id; the shirt says the project by pattern, never by a status hue.
  const SKIN = [["#F0C8A0", "#D09C78"], ["#D8A078", "#B07850"], ["#A86E48", "#84502E"], ["#704830", "#54341F"]];
  const CAPS = [["#3A4A6E", "#2A3652"], ["#4A4A56", "#36363F"], ["#56603E", "#40482E"], ["#6A4A5E", "#4E3646"], ["#2E5A5E", "#224446"]];
  const SHIRTS = [{ c: "#DCD6C8", stripe: "#3A4C70", a: "#B8B0A0" }, { c: "#8A7A64", stripe: null, a: "#6E604E" },
    { c: "#C8C0AC", stripe: "#6A4A5E", a: "#A49C8A" }, { c: "#6E7A64", stripe: null, a: "#58624E" }];
  function crewLook(id, tag) {
    const h = hash(id), sk = SKIN[h % SKIN.length], cp = CAPS[(h >>> 3) % CAPS.length], sh = SHIRTS[hash(tag || "") % SHIRTS.length];
    return { s: sk[0], S: sk[1], h: cp[0], H: cp[1], c: sh.c, stripe: sh.stripe, a: sh.a, p: "#3A4256", P: "#2A3042", b: "#2A2224",
      e: "#1A1420", o: "#1A1420", t: "#7A5232", m: "#A8B0BA", M: "#6A727C", x: "#EADFC4", X: "#B8A47C", r: "#8A6A48", L: "#F2C45A" };
  }
  // ghost: no word from this lane, the shape without the person: a fog outline with a dithered body.
  function drawGrid(ctx, g, x, y, look, ghost, flip) {
    const w = g[0].length;
    for (let j = 0; j < g.length; j++) for (let i = 0; i < w; i++) {
      const ch = g[j][i];
      if (ch === ".") continue;
      const px = x + (flip ? w - 1 - i : i), py = y + j;
      if (ghost) { if (ch === "o" || (px + py) % 2 === 0) { ctx.fillStyle = ghost; ctx.fillRect(px, py, 1, 1); } continue; }
      const col = ch === "c" && look.stripe && j % 2 === 1 ? look.stripe : look[ch];
      if (!col) continue;
      ctx.fillStyle = lit(col);
      ctx.fillRect(px, py, 1, 1);
    }
  }
  const HAMMOCK = withOutline(["................", "r..............r", ".r............r.", "..xxsshhcccccx..", "..xxsshhccccxx..", "...xxxxxxxxxx...", "....XXXXXXXX....", "................"].map(r => [...r]));

  // A sprite from the theme's sprites.json, palette paths into color.scene.
  function spriteRows(S, name) { return S.sprites && S.sprites[name]; }
  function scenePath(S, path) {
    let v = S.palette.scene;
    for (const k of path.replace("{mode}", S.mode === "day" ? "day" : "night").split(".")) v = v == null ? v : v[k];
    if (v && typeof v === "object") v = v[S.mode === "day" ? "day" : "night"];
    return typeof v === "string" && v[0] === "#" ? v : null;
  }
  function drawSprite(ctx, S, name, x, y, opts) {
    const sp = spriteRows(S, name);
    if (!sp) return;
    opts = opts || {};
    const rows = sp.rows, w = rows[0].length, h = rows.length, sc = opts.scale || 1;
    const filled = (i, j) => j >= 0 && j < h && i >= 0 && i < w && rows[j][i] !== ".";
    const outline = sp.outline && !opts.noOutline ? scenePath(S, sp.outline) : null;
    const colour = ch => (opts.tint ? opts.tint : scenePath(S, sp.palette[ch] || ""));
    if (outline) {
      ctx.fillStyle = opts.tint || (opts.lit ? lit(outline) : outline);
      for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) if (!filled(i, j) && (filled(i + 1, j) || filled(i - 1, j) || filled(i, j + 1) || filled(i, j - 1))) ctx.fillRect(x + i * sc, y + j * sc, sc, sc);
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!filled(i, j)) continue;
      const c = colour(rows[j][i]);
      if (!c) continue;
      if (opts.dither && (x + i + y + j) % 2) continue;
      ctx.fillStyle = opts.tint ? c : opts.lit ? lit(c) : c;
      ctx.fillRect(x + i * sc, y + j * sc, sc, sc);
    }
  }
  function drawGlyph(ctx, S, name, x, y, colour) {
    const rows = (S.glyphs.glyphs || {})[name];
    if (!rows) return;
    const dark = (S.palette.scene.glyph_outline || {})[S.mode === "day" ? "day" : "night"] || "#000000";
    const w = rows[0].length, filled = (i, j) => rows[j] && rows[j][i] && rows[j][i] !== ".";
    ctx.fillStyle = dark;
    for (let j = -1; j <= rows.length; j++) for (let i = -1; i <= w; i++) if (!filled(i, j) && (filled(i + 1, j) || filled(i - 1, j) || filled(i, j + 1) || filled(i, j - 1))) ctx.fillRect(x + i, y + j, 1, 1);
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === ".") return; ctx.fillStyle = ch === "#" ? colour : dark; ctx.fillRect(x + i, y + j, 1, 1); }));
  }

  // ---- sky, sea, weather -------------------------------------------------------------------------
  function bands(ctx, x0, y0, w, h, stops) {
    // Solid bands with a Bayer-dithered seam between neighbours (large fields only).
    const n = stops.length;
    for (let y = 0; y < h; y++) {
      const f = (y / Math.max(1, h - 1)) * (n - 1), i = Math.min(n - 2, Math.floor(f)), t = f - i;
      const tt = t < 0.6 ? 0 : (t - 0.6) / 0.4;
      ctx.fillStyle = stops[i]; ctx.fillRect(x0, y0 + y, w, 1);
      if (tt > 0) { ctx.fillStyle = stops[i + 1]; for (let x = 0; x < w; x++) if (dither(x, y0 + y, tt)) ctx.fillRect(x0 + x, y0 + y, 1, 1); }
    }
  }
  function cloud(ctx, cx, cy, w, h, cols, r) {
    const lobes = 3 + Math.floor(r() * 3), pts = [];
    for (let i = 0; i < lobes; i++) pts.push([cx + (i / (lobes - 1 || 1) - 0.5) * w * 0.8, cy - h * (0.5 + r() * 0.5) * 0.3, w * (0.28 + r() * 0.18), h * (0.5 + r() * 0.5)]);
    for (let y = Math.floor(cy - h); y <= cy + h * 0.4; y++) for (let x = Math.floor(cx - w / 2 - 4); x <= cx + w / 2 + 4; x++) {
      let inside = false;
      for (const [lx, ly, lw, lh] of pts) { const dx = (x - lx) / lw, dy = (y - ly) / lh; if (dx * dx + dy * dy <= 1) { inside = true; break; } }
      if (!inside || y > cy + h * 0.25) continue;
      const rel = (y - (cy - h)) / (h * 1.25);
      ctx.fillStyle = rel < 0.35 ? cols[0] : rel < 0.7 ? cols[1] : cols[2];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  function stars(ctx, S, x0, y0, w, h, r) {
    const st = S.palette.scene.stars;
    for (let i = 0; i < (w * h) / 260; i++) {
      const x = x0 + Math.floor(r() * w), y = y0 + Math.floor(r() * h * 0.85), b = r();
      ctx.fillStyle = b > 0.92 ? st[0] : b > 0.6 ? st[1] : st[2];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  function disc(ctx, cx, cy, rad, col, clipY) {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y > rad * rad + rad * 0.6 || (clipY != null && cy + y >= clipY)) continue;
      ctx.fillStyle = col; ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  function waves(ctx, x0, y0, w, h, cols, r, ship) {
    for (let i = 0; i < (w * h) / 40; i++) {
      const y = y0 + Math.floor(r() ** 1.6 * h), x = x0 + Math.floor(r() * w), depth = (y - y0) / h, len = 2 + Math.floor(depth * 6 + r() * 3);
      if (ship && x + len > ship.x0 - 6 && x < ship.x1 + 16 && y < ship.water + 6 && y > ship.deck) continue;
      ctx.fillStyle = depth < 0.2 ? cols[0] : depth < 0.6 ? cols[1] : cols[2];
      ctx.fillRect(x, y, len, 1);
    }
  }
  function fogZone(ctx, z, col, W) {
    for (let y = Math.max(0, z.y0); y < z.y1; y++) for (let x = Math.max(0, z.x0); x < Math.min(W, z.x1); x++) {
      const e = Math.min(1, (x - z.x0) / 12, (z.x1 - x) / 12, (y - z.y0) / 8, (z.y1 - y) / 8);
      if (dither(x, y, z.d * Math.max(0, e))) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
    }
  }
  function rain(ctx, x0, y0, w, h, col, seed, slant) {
    const rr = rng(seed);
    ctx.fillStyle = col;
    for (let i = 0; i < (w * h) / 30; i++) { const x = x0 + Math.floor(rr() * w), y = y0 + Math.floor(rr() * h); ctx.fillRect(x, y, 1, 2); if (slant) ctx.fillRect(x - 1, y + 2, 1, 1); }
  }

  // ---- the ship -----------------------------------------------------------------------------------
  // Draws masts, yards and sails (furled at anchor, none on an empty ship).
  function shipBack(ctx, S, L) {
    const W = S.palette.scene.wood, SA = S.palette.scene.sail;
    ctx.fillStyle = lit("#2A1E18");
    const rig = (ax, ay, bx, by) => { const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)); for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1); };
    const ms = L.masts;
    if (ms.length) {
      rig(ms[0].x, ms[0].top + 4, L.x0 + 4, L.deck - 14);
      rig(ms[ms.length - 1].x, ms[ms.length - 1].top + 4, L.x1 + L.bowsprit, L.deck - 4);
      for (let i = 0; i < ms.length - 1; i++) rig(ms[i].x, ms[i].top + 2, ms[i + 1].x, ms[i + 1].top + 10);
    }
    for (const m of ms) {
      ctx.fillStyle = lit(W.mast); ctx.fillRect(m.x - 1, m.top, 3, L.deck - m.top);
      ctx.fillStyle = lit(W.mast_dark); ctx.fillRect(m.x + 1, m.top, 1, L.deck - m.top);
      if (L.sails === "none") continue;
      const sw = m.sail;
      const sails = [[m.top + L.sailY, m.top + L.sailY + sw.h1, sw.w1], [m.top + L.sailY + 4 + sw.h1, m.top + L.sailY + 4 + sw.h1 + sw.h2, sw.w2]];
      for (const [ya, yb, w] of sails) {
        if (yb >= L.deck - L.clear) continue;
        ctx.fillStyle = lit(W.mast_dark); ctx.fillRect(m.x - w / 2 - 2, ya - 2, w + 4, 2);
        if (L.sails === "furled") {
          // furled: a bundled roll along the yard
          for (let x = -w / 2; x <= w / 2; x++) { ctx.fillStyle = lit(x % 3 === 0 ? SA.outline : SA.furled); ctx.fillRect(m.x + x, ya, 1, 2); }
          continue;
        }
        if (L.slack.has(m.machine)) {
          // becalmed (section 17): the sail hangs straight down, no belly, in folds, its foot ragged
          const half = Math.round(w / 2) - 1, yb2 = yb - 2;
          for (let y = ya; y < yb2; y++) for (let x = -half; x <= half; x++) {
            let c = (x + half) % 5 === 4 ? SA.shade : (x + half) % 5 === 0 ? SA.mid : SA.lit;
            if (x === -half || x === half || y === ya) c = SA.outline;
            if (y === yb2 - 1) { if ((x + half) % 3 === 1) continue; c = SA.outline; }
            ctx.fillStyle = lit(c); ctx.fillRect(m.x + x, y, 1, 1);
          }
          continue;
        }
        for (let y = ya; y < yb; y++) {
          const t = (y - ya) / (yb - ya), half = Math.round(w / 2 - (1 - t) * 2) + Math.round(Math.sin(t * Math.PI) * 3);
          for (let x = -half; x <= half; x++) {
            let c = SA.lit;
            if (x > half * 0.45) c = SA.mid;
            if (x > half * 0.8 || t > 0.85) c = SA.shade;
            if (x === -half || x === half || y === ya) c = SA.outline;
            ctx.fillStyle = lit(c); ctx.fillRect(m.x + x, y, 1, 1);
          }
        }
        ctx.fillStyle = lit(SA.mid);
        for (let s = -w / 2 + 6; s < w / 2 - 2; s += 7) for (let y = ya + 2; y < yb - 1; y += 2) ctx.fillRect(m.x + Math.round(s), y, 1, 1);
      }
      if (m.nest) { ctx.fillStyle = lit(W.mast_dark); ctx.fillRect(m.x - 8, m.nestY + 8, 17, 2); }
    }
  }
  function nestFront(ctx, S, m) {
    const W = S.palette.scene.wood, y = m.nestY;
    for (let i = 0; i < 9; i++) { ctx.fillStyle = lit(i === 0 ? W.outline : i < 3 ? W.light : i < 7 ? W.mid : W.dark); ctx.fillRect(m.x - 8, y + i, 17, 1); }
    ctx.fillStyle = lit(W.outline); ctx.fillRect(m.x - 8, y, 1, 9); ctx.fillRect(m.x + 8, y, 1, 9);
    ctx.fillStyle = lit(W.trim); ctx.fillRect(m.x - 7, y + 1, 15, 1);
  }
  // ---- stern windows (docs/theme-spec.md section 23.2) ----------------------------------------------------
  // One window for each lane on the machine that has work an agent should be at (the core sets the lane's `light` from
  // items[].agent.state alone; finished work has none): lit when the agent is alive, dark glass when its session ended or its
  // endpoint is gone, a shuttered window when the feed reports no agent for it or its report is old. The feed never says idle
  // against busy, so neither does a window. More lanes than windows: the ones that need a look come first (dark, then
  // shuttered, then lit), kept in lane order; the receipt counts every lane. Never decoration: no lane, no window.
  const WIN_RANK = { dark: 0, unknown: 1, lit: 2 };
  function windowsOf(S, id, max) {
    const all = (S.crew || []).filter(c => c.machine === id && c.light), count = { lit: 0, dark: 0, unknown: 0 };
    for (const c of all) count[c.light]++;
    const keep = new Set(all.map((c, i) => [c, i]).sort((a, b) => WIN_RANK[a[0].light] - WIN_RANK[b[0].light] || a[1] - b[1]).slice(0, Math.max(0, max)).map(a => a[0].id));
    return { lights: all.filter(c => keep.has(c.id)).map(c => c.light), count, n: all.length };
  }
  // One window: a 1 ap frame round the glass (lit and dark) or round a shutter's slats (not reported).
  function pane(ctx, S, x, y, fw, fh, state) {
    const W = S.palette.scene.wood, Ln = S.palette.scene.lantern;
    ctx.fillStyle = lit(W.outline); ctx.fillRect(x, y, fw, fh);
    for (let j = 1; j < fh - 1; j++) {
      ctx.fillStyle = state === "lit" ? (j === 1 ? Ln.glass_core : Ln.glass_lit) : state === "dark" ? lit(Ln.glass_dark) : lit(j % 2 ? W.trim : W.mid);
      ctx.fillRect(x + 1, y + j, fw - 2, 1);
    }
  }
  function sternWindows(ctx, S, x0, y, W) { W.lights.forEach((st, i) => pane(ctx, S, x0 + 1 + 5 * i, y, 4, 6, st)); }
  // Livery (section 25): the machine's tone from its id alone (web/livery.js); no id, no livery.
  function liveryOf(S, id) { return typeof liveryTone === "function" ? liveryTone(id, S.palette.scene.livery) : null; }
  function marksOf(role) { return typeof liveryMarks === "function" ? liveryMarks(role) : { stripe: false, pennant: 0 }; }
  // A swallowtail pennant at a masthead: a staff and n rows tapering to the fly. It is a machine's mark, not the longboat's flat project flag.
  function pennant(ctx, x, y, col, n) {
    ctx.fillStyle = lit("#2A1A12"); ctx.fillRect(x, y, 1, n + 2);
    for (let i = 0; i < n; i++) { ctx.fillStyle = lit(col); ctx.fillRect(x + 1, y + i, Math.max(2, n + 3 - i * 2), 1); }
  }
  function hull(ctx, S, L, night) {
    const mk = marksOf(L.role), lv = mk.stripe ? liveryOf(S, L.id) : null;
    const W = S.palette.scene.wood, { x0, x1, deck, water } = L, sternRise = 8, bottom = water + 6;
    const top = x => (x < x0 + 26 ? deck - sternRise : deck);
    const bot = x => { const t = (x - x0) / (x1 - x0); return Math.round(bottom - Math.max(0, (t - 0.82) / 0.18) ** 1.6 * (bottom - deck + 2) - Math.max(0, (0.06 - t) / 0.06) * 6); };
    const prowX = y => x1 + Math.round(((deck + 2 - y) / (bottom - deck + 2)) * 10);
    for (let x = x0; x <= x1 + 12; x++) {
      const yt = top(Math.min(x, x1)), yb = x <= x1 ? bot(x) : 0;
      for (let y = yt; y <= Math.max(yb, yt); y++) {
        if (x > x1 && (x > prowX(y) || y > deck + 10)) continue;
        const k = y - yt;
        let c = k < 2 ? W.trim : k < 4 ? W.light : (Math.floor((y - deck) / 3) % 2 ? W.mid : W.dark);
        if (lv && (k === 4 || k === 5) && y < water - 1) c = lv;
        if (y >= water - 1) c = W.dark;
        if (y > water + 1) c = "#2A1A12";
        ctx.fillStyle = lit(c); ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = lit(W.outline);
    ctx.fillRect(x0 - 1, deck - sternRise, 1, bottom - deck + sternRise - 4);
    ctx.fillRect(x0 - 1, deck - sternRise - 1, 27, 1);
    // the stern windows: one per lane with an agent to be at, lit or dark by the feed (the hull plate sits over the old row of portholes)
    if (L.windows) sternWindows(ctx, S, x0, deck - 6, L.windows);
    for (const m of L.masts) { const lm = m.machine ? liveryOf(S, m.machine) : null; if (lm && mk.pennant) pennant(ctx, m.x + 2, m.top - 1, lm, mk.pennant); }
    ctx.fillStyle = lit(W.mast);
    for (let i = 0; i < L.bowsprit; i++) ctx.fillRect(x1 + 6 + i, deck - 2 - Math.floor(i / 3), 2, 1);
  }
  function rail(ctx, S, L) {
    const W = S.palette.scene.wood, { x0, x1, deck } = L;
    ctx.fillStyle = lit(W.trim); ctx.fillRect(x0 + 26, deck - 8, x1 - x0 - 24, 1);
    ctx.fillStyle = lit(W.outline); ctx.fillRect(x0 + 26, deck - 7, x1 - x0 - 24, 1);
    for (let x = x0 + 28; x < x1; x += 7) { ctx.fillStyle = lit(W.mid); ctx.fillRect(x, deck - 6, 1, 6); }
    ctx.fillStyle = lit(W.trim); ctx.fillRect(x0, deck - 16, 26, 1);
    for (let x = x0 + 2; x < x0 + 26; x += 6) { ctx.fillStyle = lit(W.mid); ctx.fillRect(x, deck - 15, 1, 7); }
  }
  function anchorChain(ctx, S, L) {
    const iron = S.palette.scene.bell.iron_dark;
    for (let i = 0; i < L.water - L.deck + 6; i++) { if (i % 3 === 2) continue; ctx.fillStyle = lit(iron); ctx.fillRect(L.x1 + 4 + Math.floor(i / 4), L.deck + 2 + i, 1, 1); }
  }
  function crate(ctx, x, y) {
    for (let j = 0; j < 9; j++) for (let i = 0; i < 10; i++) {
      const edge = i === 0 || j === 0 || i === 9 || j === 8, diag = i === j || i === 9 - j;
      ctx.fillStyle = lit(edge ? "#2A1A10" : diag ? "#4A321C" : j < 3 ? "#8A6440" : "#6A4A2C");
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
  function barrel(ctx, x, y) {
    for (let j = 0; j < 7; j++) for (let i = 0; i < 8; i++) {
      if ((j === 0 || j === 6) && (i === 0 || i === 7)) continue;
      ctx.fillStyle = lit(i === 0 || i === 7 || j === 0 || j === 6 ? "#2A1A10" : j === 1 || j === 5 ? "#5A5A62" : i < 3 ? "#8A6440" : "#6A4A2C");
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
  // Smoke over a failed station. Grey, never a status hue: the log says FAILED, the scene only shows trouble.
  function smoke(ctx, x, y, tint) {
    for (const [dx, dy, rad] of [[0, 0, 3], [2, -6, 4], [5, -13, 5], [8, -21, 5]]) {
      for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
        if (i * i + j * j > rad * rad || (i * i + j * j > (rad - 1) * (rad - 1) && (i + j) % 2)) continue;
        ctx.fillStyle = tint || lit(j < -rad / 3 ? "#9A9AA2" : "#6E6E78");
        ctx.fillRect(x + dx + i, y + dy + j, 1, 1);
      }
    }
    ctx.fillStyle = tint || lit("#2A1A10"); ctx.fillRect(x - 2, y + 4, 7, 1);
  }

  // ---- layout: the flagship in front, escorts behind (section 21) ------------------------------------
  // One ship per machine. The flagship (the scene's fleet.ships[0]) is drawn at full scale in front with its own crew; the
  // escorts behind it on the roadstead, in their fixed order, each in its own stretch of the window (the core's fleet.slots,
  // src/weatherdeck/fleet.py roadstead), so no escort ever covers another or the lighthouse; past them a convoy cluster. On the
  // open sea (nothing waits on the viewer, the window is the whole upper area) up to two escorts sail at full scale with
  // their own crew at stations, more at half scale; beside a call every escort is at half scale. Where a ship lies never
  // depends on its state, only on its slot and the window. A ship carries at most the sailors that fit on its deck, the
  // most urgent first; the rest are below decks (said in words).
  const CREW_RANK = { call: 0, approval: 1, failed: 2, blocked: 3, long: 4, unknown: 5, regressed: 6, moving: 7, mate: 8, scout: 9, done: 10 };
  function onDeck(crew, fits) {
    if (crew.length <= fits) return crew;
    const keep = new Set(crew.map((c, i) => [c, i]).sort((a, b) => (CREW_RANK[a[0].state] ?? 7) - (CREW_RANK[b[0].state] ?? 7) || a[1] - b[1]).slice(0, Math.max(0, fits)).map(a => a[0].id));
    return crew.filter(c => keep.has(c.id));
  }
  const groupsOf = crew => new Set(crew.map(c => c.stage || "")).size;
  // The fleet as the core hands it (scene.fleet), else every machine in the scene's order with the first as flagship.
  function fleetOf(S) {
    const f = S.fleet && Array.isArray(S.fleet.ships) && S.fleet.ships.length ? S.fleet : { ships: (S.machines || []).slice(0, 6).map((m, i) => ({ id: m.id, role: i ? "escort" : "flagship", berth: "sea" })), convoy: null };
    const byId = Object.fromEntries((S.machines || []).map(m => [m.id, m]));
    return { ships: f.ships.filter(x => byId[x.id]).map(x => Object.assign({}, x, { m: byId[x.id] })), convoy: f.convoy && f.convoy.n ? f.convoy : null, slots: f.slots || null };
  }
  // The roadstead is on when there is more than the flagship to draw, on the TV (the phone shows its convoy strip).
  const roadstead = S => S.layout !== "phone" && S.screen !== "empty" && S.screen !== "loading" && S.screen !== "deck" && (fleetOf(S).ships.length > 1 || !!fleetOf(S).convoy);
  const ESC = { pitch: 24, sp: 5, crew: 6, stern: 5, bow: 6, bowsprit: 4, mast: 34, far: 10, near: 24, convoy: 26 };
  const DEF_WIN = { x: 384, y: 41, w: 236, h: 164 };
  function escortSpan(n, least) { return ESC.stern + Math.max(least ?? 3, n) * ESC.sp + 3 + ESC.bow; }
  // The horizon's shares when the core sent none: the flagship's stretch, then equal stretches, as the core does beside a call.
  function slotsOf(F) {
    const n = F.ships.length, ok = F.slots && Array.isArray(F.slots.ships) && F.slots.ships.length === n;
    if (ok) return F.slots;
    const conv = F.convoy ? 0.11 : 0, f1 = n === 1 ? 1 : Math.max(0.16, 1 - 0.19 * (n - 1)), w = n > 1 ? (1 - conv - f1) / (n - 1) : 0;
    return { open: false, ships: F.ships.map((sh, i) => (i ? { slot: i, x0: f1 + (i - 1) * w, x1: f1 + i * w, scale: "half" } : { slot: 0, x0: 0, x1: f1, scale: "full" })),
      convoy: conv ? { x0: 1 - conv, x1: 1 } : null };
  }
  function shipLayout(S) {
    const phone = S.layout === "phone", anchorScr = S.screen === "anchor", ox = S.ox || 0, oy = S.oy || 0;
    const dx = anchorScr && S.drift ? S.drift.x : 0, dy = anchorScr && S.drift ? S.drift.y : 0;
    const F = fleetOf(S), fleetOn = roadstead(S), flag = F.ships[0] || null;
    const win = S.window || DEF_WIN, open = !!S.open && !phone && !anchorScr && S.screen === "board";
    const P = phone
      ? { x0: 8, deck: S.h - 12, water: S.h - 4, top: 3, spacing: 9, minSec: 28, gap: 4, stern: 20, bow: 8, bowsprit: 8, sail: 0.5, sailY: 3, clear: 18, w: S.w - 30 }
      : anchorScr ? { x0: ox + 232 + dx, deck: oy + 160 + dy, water: oy + 178 + dy, top: oy + 96 + dy, spacing: 16, minSec: 34, gap: 4, stern: 22, bow: 8, bowsprit: 10, sail: 0.7, sailY: 10, clear: 26, w: 176 }
      // the open sea's banner line sits over the top of the window, so the masts start below it
      : { x0: ox + win.x, deck: oy + 180, water: oy + 205, top: oy + (open ? 70 : 58), spacing: 10, minSec: 50, gap: 6, stern: 22, bow: 8, bowsprit: 10, sail: 1, sailY: 14, clear: 26, w: win.w };
    const escorts = [], bigs = [];
    let convoy = null, hz = null, budget = P.w, slot0 = null;
    if (fleetOn) {
      const esc = F.ships.slice(1);
      if (anchorScr) {
        // At anchor the escorts lie beside the anchored ship, each in its own equal stretch up to the window's edge.
        hz = oy + 120 + dy;
        const xL = ox + 416, xR = ox + 616 - (F.convoy ? ESC.convoy + 4 : 0), w = esc.length ? (xR - xL) / esc.length : 0;
        esc.forEach((sh, i) => escorts.push(escortLayout(S, sh, null, hz + ESC.far - 3, hz + ESC.far, false, true, { x0: Math.round(xL + i * w), x1: Math.round(xL + (i + 1) * w) - 2 })));
        if (F.convoy) convoy = { x0: ox + 616 - ESC.convoy, x1: ox + 616 };
      } else {
        hz = oy + 128;
        const sl = slotsOf(F), wx = ox + win.x, ww = win.w - 4, px = f => Math.round(wx + f * ww);
        slot0 = { x0: px(sl.ships[0].x0), x1: px(sl.ships[0].x1) };
        esc.forEach((sh, i) => {
          const q = sl.ships[i + 1], box = { x0: px(q.x0), x1: px(q.x1) };
          if (q.scale === "full" && open) bigs.push(bigEscort(S, sh, box, oy));
          // the plates take turns above the masthead and under the hull, so each has room in its row for its word
          else escorts.push(escortLayout(S, sh, null, hz + ESC.far - 3, hz + ESC.far, i % 2 === 1, false, box));
        });
        if (F.convoy && sl.convoy) convoy = { x0: px(sl.convoy.x0), x1: px(sl.convoy.x1) };
        // The flagship's stretch; never shorter than a deck with a mast, so with many escorts it sails in front of the first.
        P.x0 = slot0.x0; budget = Math.max(96, slot0.x1 - slot0.x0);
      }
      if (convoy) Object.assign(convoy, { water: hz + ESC.far, n: F.convoy.n, stale: !!F.convoy.stale, worst: F.convoy.worst });
    } else if (open && F.slots && F.slots.ships && F.slots.ships.length === 1) {
      // one ship on the open sea: its own stretch of the whole upper area
      const q = F.slots.ships[0], wx = ox + win.x, ww = win.w - 4;
      slot0 = { x0: Math.round(wx + q.x0 * ww), x1: Math.round(wx + q.x1 * ww) };
      P.x0 = slot0.x0; budget = Math.max(96, slot0.x1 - slot0.x0);
    }
    const L = buildShip(S, flag, P, budget - P.stern - P.bow - P.bowsprit, anchorScr);
    Object.assign(L, { escorts, bigs, convoy, fleet: fleetOn, open, win, slot: slot0 });
    if (hz != null) L.hz = hz;
    return L;
  }
  // One ship drawn at full scale from its deck plan P: its section, masts, crew at the station spacing (the most urgent when
  // they do not all fit; the rest below decks), sails set, slack (becalmed), furled (in harbor or at anchor) or none.
  function buildShip(S, sh, P, sec0, anchorScr) {
    const phone = S.layout === "phone";
    const L = { deck: P.deck, water: P.water, bowsprit: P.bowsprit, sections: [], masts: [], spacing: P.spacing, x0: P.x0, sailY: P.sailY, clear: P.clear, stern: P.stern,
      windows: windowsOf(S, sh ? sh.id : null, Math.min(4, Math.floor(P.stern / 5))),
      sails: anchorScr ? "furled" : S.screen === "empty" ? "none" : "set", id: sh ? sh.id : null, role: sh && sh.role === "escort" ? "escort" : "flagship" };
    const machines = S.screen === "empty" || !sh ? [] : [sh.m];
    const all = sh ? S.crew.filter(c => c.machine === sh.id && (anchorScr || c.state !== "scout")) : [];
    // As many sailors as fit at the station spacing, groups apart; asleep in hammocks two rows deep.
    let crew = all;
    if (anchorScr) crew = onDeck(all, 2 * Math.max(1, Math.floor(sec0 / 8)));
    else { let n = all.length; while (n > 0 && n * P.spacing + Math.max(0, groupsOf(onDeck(all, n)) - 1) * GROUP_GAP > sec0) n--; crew = onDeck(all, n); }
    const below = all.length - crew.length;
    let x = P.x0 + P.stern;
    machines.forEach(m => {
      const scouts = anchorScr ? [] : S.crew.filter(c => c.machine === m.id && c.state === "scout");
      const want = Math.max(crew.length * P.spacing + Math.max(0, (anchorScr ? 1 : groupsOf(crew)) - 1) * GROUP_GAP, P.minSec);
      const w = Math.max(16, Math.min(sec0, want));
      const sec = { m, crew, scouts, below, x0: x, x1: x + w, mastX: Math.round(x + w / 2) };
      L.sections.push(sec);
      // Masts by the ship's length (one a machine no longer): one, or two past 120 ap, three past 190.
      const n = phone || w < 120 ? 1 : w < 190 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const mx = n === 1 ? sec.mastX : Math.round(x + w * (i + 0.5) / n), main = i === Math.floor(n / 2);
        const sw = Math.min(n === 1 ? w - 4 : Math.floor(w / n) - 2, phone ? 30 : 60);
        L.masts.push({ machine: m.id, gulls: main, x: mx, top: P.top + (main ? 0 : 6), nest: main && scouts.length > 0, nestY: P.top + 10,
          sail: { w1: Math.round(sw * 0.86 * P.sail * (phone ? 2 : 1)), h1: Math.round(22 * P.sail), w2: Math.round(sw * P.sail * (phone ? 2 : 1)), h2: Math.round(26 * P.sail) } });
      }
      x += w + P.gap;
    });
    if (!machines.length) { // an empty ship at anchor: three bare masts
      const span = phone ? 120 : 160;
      for (let i = 0; i < 3; i++) L.masts.push({ x: Math.round(x + 18 + i * span / 3), top: P.top + 10, nest: false, sail: { w1: 0, h1: 0, w2: 0, h2: 0 } });
      x += span;
    }
    L.x1 = x - (machines.length ? P.gap : 0) + P.bow;
    L.main = L.masts[Math.floor(L.masts.length / 2)] || null;
    // The ship's own sails: furled in harbor or at anchor (idle, or asleep), slack when becalmed, else set.
    if (sh && L.sails === "set" && sh.berth && sh.berth !== "sea") L.sails = "furled";
    L.berth = sh ? sh.berth || "sea" : "sea";
    L.slack = new Set(L.sails === "set" ? machines.filter(m => m.becalmed).map(m => m.id) : []);
    return L;
  }
  // An escort at full scale on the open sea (at most two of them): the flagship's own art in its own stretch, a little
  // further off (higher on the sea, a shorter rig), with its own crew at their stations, its own weather and fog.
  function bigEscort(S, sh, box, oy) {
    const P = { x0: box.x0 + 2, deck: oy + 152, water: oy + 176, top: oy + 72, spacing: 10, minSec: 34, gap: 4, stern: 18, bow: 8, bowsprit: 8, sail: 0.75, sailY: 10, clear: 22, w: box.x1 - box.x0 - 4 };
    const L = buildShip(S, Object.assign({}, sh, { role: "escort" }), P, P.w - P.stern - P.bow - P.bowsprit - 6, false);
    const m = sh.m, silent = m.pip === "silent" && !m.resting && !m.asleep;
    return Object.assign(L, { m, slot: sh.slot, sx0: box.x0, sx1: box.x1, top: Math.min(...L.masts.map(x => x.top)), silent, weather: (S.weather || {})[m.id] || "clear",
      lantern: silent || S.lost ? "dark" : L.berth === "anchored" ? "dim" : "lit", below: (L.sections[0] || {}).below || 0, crew: (L.sections[0] || {}).crew || [] });
  }
  // One escort at half scale: its deck span from its crew (as many as its stretch holds, at most ESC.crew on deck), one mast,
  // its sails, lantern and weather. box: its stretch of the roadstead (the ship is centred in it); else centred on cx.
  function escortLayout(S, sh, cx, deck, water, near, anchorScr, box) {
    const m = sh.m, all = S.crew.filter(c => c.machine === m.id);
    // hull, bowsprit and a mooring bollard take the span plus 10 ap; a tight stretch carries fewer sailors and a shorter hull
    const room = box ? box.x1 - box.x0 : Infinity, fits = Math.max(0, Math.min(ESC.crew, Math.floor((room - 10 - ESC.stern - 3 - ESC.bow) / ESC.sp)));
    const crew = onDeck(all, fits), least = box && escortSpan(crew.length) + 10 > room ? 2 : 3;
    const span = escortSpan(crew.length, least), x0 = box ? Math.round(box.x0 + 1 + Math.max(0, (room - span - 10) / 2)) : Math.round(cx - span / 2), x1 = x0 + span;
    const berth = anchorScr ? (sh.berth === "anchored" ? "anchored" : "harbor") : sh.berth || "sea";
    const sails = berth !== "sea" ? "furled" : m.becalmed ? "slack" : "set";
    const silent = m.pip === "silent" && !m.resting && !m.asleep;
    return { id: m.id, m, slot: sh.slot, near, x0, x1, deck, water, mastX: x0 + Math.round(span * 0.45), top: deck - ESC.mast, crew, below: all.length - crew.length,
      windows: windowsOf(S, m.id, Math.min(4, Math.floor((span - 4) / 5))),
      sx0: box ? box.x0 : x0 - 6, sx1: box ? box.x1 : x1 + 12,
      berth, sails, silent, sleeping: anchorScr, lantern: silent || S.lost ? "dark" : berth === "anchored" || anchorScr ? "dim" : "lit", weather: (S.weather || {})[m.id] || "clear" };
  }

  // Stations on deck, stern to bow within a machine's section (section 17): a plain spot for a lane whose stage is not
  // known, then the chart table, the workbench, inspection, the signal staff, the rail, and the barrels of the landed.
  const STATIONS = ["", "plan", "build", "verify", "ship", "wait", "land"];
  const GROUP_GAP = 3;
  function crewPose(c, animated, frame, sleeping) {
    if (sleeping) return { pose: "hammock" };
    const tool = hash(c.id) % 2 ? "hammer" : "hoist", f = animated ? (frame % 2) + 1 : 1;
    switch (c.state) {
      case "call": case "approval": return { pose: "scroll" };
      case "failed": return { pose: "worried", prop: "smoke" };
      case "blocked": return { pose: "crossed", prop: "crate" };
      case "unknown": return { pose: "stand", ghost: true, mark: "silent" };
      case "mate": return { pose: "stand", flip: true };
      case "done": return { pose: "sit", prop: "barrel" };
    }
    // At work: the station's own pose; with no stage, the old hammer or hoist on a plain spot.
    const at = { plan: "chart", build: "hammer", verify: "lantern", ship: "hoist" }[c.stage];
    const work = at || tool, flags = c.stage === "ship";
    if (c.state === "long") return { pose: work === "hammer" || work === "hoist" ? work + "1" : work, mark: "long", flags };
    return { pose: work === "hammer" || work === "hoist" ? work + f : work, flags };
  }

  // Machines gone silent without leave: a may_sleep machine asleep in quiet hours is expected to be quiet (section 21).
  const silentSet = S => new Set(S.machines.filter(m => m.pip === "silent" && !m.asleep && !m.resting).map(m => m.id));

  // ---- motion steps: whole frames from the time since each event, never eased ------------------------
  const stepAt = (since, ms, steps, now) => (since == null ? steps : Math.max(0, Math.min(steps, Math.floor(((now - since) / ms) * steps))));

  // ---- ambient: the sea and the ship's float (docs/theme-spec.md section 10) ---------------------------
  // The core runs the ambient clock and hands each frame { on, phase, amp, roll, tok }: phase is seconds of
  // sea time (already scaled by tempo), amp and roll the eased amplitude and roll for the level and mood.
  // Everything below is whole art px: the sea is a pixel buffer, the ship a cached layer shifted by whole rows
  // and columns, so no frame holds a half pixel. With no ambient frame the same layers paint the old still scene.
  const TAU = Math.PI * 2;
  const abgr = h => { const c = rgb(h); return (0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const frac = v => v - Math.floor(v);
  const ihash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h ^= h >>> 15; return Math.imul(h, 0x2c1b3c6d) >>> 0; };
  const AMB_TOK = { bob: { px: 1.5, period_s: 7.3 }, lean: { px: 2.2, period_s: 9.1 }, pitch: { px: 1.8, period_s: 5.7 }, surge: { px: 1.3, period_s: 41 },
    heave: { px: 1.6, period_s: 14, wavelength_px: 140 }, scroll_px_s: { far: 1.2, near: 5 }, foam: { per_px: 0.1, life_s: [7, 16] }, haze: { breath_s: 47, crawl_s: 20 },
    burn_in: { cloud_px_per_min: 8 } };
  const tokOf = A => { const t = (A && A.tok) || {}, o = {}; for (const k of Object.keys(AMB_TOK)) o[k] = Object.assign({}, AMB_TOK[k], t[k]); return o; };

  // Offscreen layers, one canvas px per art px, kept between frames (a layer is repainted only when its key changes).
  const LAYERS = {};
  function layer(name, w, h) {
    let L = LAYERS[name];
    if (!L) { const cv = document.createElement("canvas"); L = LAYERS[name] = { cv, ctx: cv.getContext("2d"), key: null }; }
    if (L.cv.width !== w || L.cv.height !== h) { L.cv.width = w; L.cv.height = h; L.key = null; }
    return L;
  }
  let autoRev = 0;

  // The shared numbers of one frame.
  function scenery(S, frame) {
    const pal = S.palette.scene, now = frame.now, storm = !!S.storm && S.screen !== "anchor";
    const tod = storm ? "storm" : S.tod;
    light = pal.light[tod] || pal.light.day;
    const W = S.w, H = S.h, phone = S.layout === "phone";
    const g = { S, pal, now, storm, tod, W, H, phone, night: S.mode !== "day", ox: S.ox || 0, oy: S.oy || 0 };
    g.hz = phone ? Math.round(H * 0.45) : S.screen === "anchor" ? g.oy + 120 + (S.drift ? S.drift.y : 0) : g.oy + 146;
    g.sky = (pal.sky[tod] || pal.sky.day).map(snap);
    g.sea = (pal.sea[tod] || pal.sea.day).map(snap);
    g.loading = S.screen === "loading";
    g.sleeping = S.screen === "anchor";
    g.ghost = (pal.fog || {})[g.night ? "night" : "day"] || "#8D97A5";
    g.fogCol = g.ghost;
    return g;
  }
  function drawClouds(c, g, dx) {
    const { pal, tod, W, hz } = g, cols = (pal.cloud[tod] || pal.cloud.day).map(snap), cr = rng(99);
    for (let i = 0; i < Math.max(3, W / 90); i++) cloud(c, Math.round(cr() * W) + dx, Math.round(hz * (0.18 + cr() * 0.45)), 30 + cr() * 50, 6 + cr() * 6, [cols[1], cols[2], cols[2]], cr);
    for (let i = 0; i < Math.max(2, W / 160); i++) cloud(c, Math.round(cr() * W) + dx, Math.round(hz * (0.1 + cr() * 0.5)), 40 + cr() * 50, 8 + cr() * 7, cols, cr);
  }
  // The sky: bands, stars, moon or sun, the islands ahead, and (still scene only) the clouds.
  function drawSky(c, g, withClouds) {
    const { S, pal, tod, W, H, hz, sky, phone } = g;
    c.clearRect(0, 0, W, H);
    bands(c, 0, 0, W, hz, sky);
    if (tod === "night" || tod === "anchor") {
      stars(c, S, 0, 0, W, hz, rng(77));
      // The moon crosses the open sky with the clock (never quite static at anchor).
      const m = ((S.minutes || 0) + 180) % 1440, k = m / 1440;
      const mo = phone ? { x: W - 24, y: 8 } : S.screen === "anchor" ? { x: Math.round(W * (0.15 + 0.7 * k)), y: Math.round(hz * (0.18 + 0.25 * Math.abs(k - 0.5))) } : { x: g.ox + 400, y: g.oy + (S.open ? 66 : 52) };
      disc(c, mo.x, mo.y, phone ? 4 : 6, pal.moon); disc(c, mo.x + 3, mo.y - 2, phone ? 3 : 5, sky[0]);
    }
    if (tod === "dawn") disc(c, Math.round(W * 0.82), hz - 2, 10, "#E8B8A0", hz);
    if (tod === "day") disc(c, Math.round(W * 0.12), Math.round(hz * 0.2), phone ? 5 : 7, "#EEF0E8");
    if (tod === "dusk") disc(c, Math.round(W * 0.88), hz - 4, 9, "#D08A82", hz);
    if (S.screen !== "anchor" && withClouds) drawClouds(c, g, 0);
    if (g.isles) for (const I of g.isles) island(c, g, I);
  }
  // ---- islands ahead (docs/theme-spec.md section 23.1) ---------------------------------------------------
  // One island per next[] entry the core hands over in scene.horizon (at most three; one on the phone), none when there are
  // none: the horizon is empty because nothing is queued, never filled in. An island's size and distance are its step (a
  // date coming near, or its place in the queue, set by the core); its mark is the entry's kind (a held one in mist, a gate
  // with a beacon post). The feed's own state for it: ok, unknown (dotted outline: that source's queue report is old) or fog
  // (its source is silent). Nothing moves: they are in the cached sky layer, repainted only when the scene's revision changes.
  const ISLE = { w: { 3: 44, 2: 32, 1: 22 }, h: { 3: 9, 2: 6, 1: 4 }, haze: { 3: 0.1, 2: 0.3, 1: 0.45 }, phone: { w: { 3: 36, 2: 30, 1: 24 }, h: { 3: 8, 2: 6, 1: 4 } } };
  // The stretches of horizon no rig stands on, inside the scene window: the lighthouse, every ship's sails, each half-scale
  // escort and the convoy are in the way.
  function freeHorizon(g, L) {
    const win = L.win || DEF_WIN, lo = (g.ox || 0) + win.x + 2, hi = (g.ox || 0) + win.x + win.w - 4, lh = Math.min(g.W - 9, (g.ox || 0) + 628);
    const sails = X => X.masts.map(m => [m.x - Math.round(m.sail.w2 / 2) - 3, m.x + Math.round(m.sail.w2 / 2) + 3]);
    const busy = [[lh - 10, lh + 10], ...sails(L), ...L.bigs.flatMap(sails), ...L.escorts.map(e => [e.x0 - 3, e.x1 + 6]), ...(L.convoy ? [[L.convoy.x0 - 2, L.convoy.x1 + 2]] : [])].sort((a, b) => a[0] - b[0]);
    const free = [];
    let x = lo;
    for (const [a, b] of busy) { if (a - x > 0) free.push([x, Math.min(a, hi)]); x = Math.max(x, b); }
    if (hi - x > 0) free.push([x, hi]);
    return free.filter(f => f[1] > f[0]);
  }
  // Where each island stands: the nearest and largest first, each in the widest free stretch left, never over another.
  function placeIslands(g, L) {
    const list = (g.S.horizon && g.S.horizon.islands) || [];
    if (!list.length || g.S.screen !== "board" || !L) return [];
    const T = g.phone ? ISLE.phone : ISLE, out = [];
    if (g.phone) { const I = list[0]; out.push(Object.assign({ x: g.W - 40, idx: 0 }, I, { w: T.w[I.step], h: T.h[I.step] })); return out; }
    let free = freeHorizon(g, L);
    list.forEach((I, idx) => {
      const w = T.w[I.step], h = T.h[I.step];
      const fit = free.filter(f => f[1] - f[0] >= w + 4).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0] || free.slice().sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
      const win = L.win || DEF_WIN, cx = fit ? Math.round((fit[0] + fit[1]) / 2) : (g.ox || 0) + win.x + Math.round(win.w / 2);
      out.push(Object.assign({ x: cx - (w >> 1), idx }, I, { w, h }));
      if (fit) free = free.flatMap(f => (f === fit ? [[f[0], cx - (w >> 1) - 3], [cx + (w >> 1) + 3, f[1]]] : [f])).filter(f => f[1] - f[0] > 0);
    });
    return out;
  }
  function island(c, g, I) {
    const { hz, pal, sky, night } = g, { x, w, h, step, state, kind, idx } = I;
    const top = i => { const t = i / (w - 1), u = idx % 2 ? t ** 0.8 : t ** 1.25; return Math.max(i === 0 || i === w - 1 ? 0 : 1, Math.round(Math.sin(u * Math.PI) ** 0.85 * h)); };
    const land = snap(mix(g.sea[0], "#0C101A", 0.78)), col = snap(mix(land, sky[sky.length - 1], ISLE.haze[step]));
    const rim = step === 1 ? col : snap(mix(col, night ? pal.moon : "#EEF0E8", night ? 0.45 : 0.22));
    const hts = Array.from({ length: w }, (_, i) => top(i));
    const inside = (i, y) => i >= 0 && i < w && y >= hz - hts[i] && y < hz;
    const edge = (i, y) => y < hz - 1 && !(inside(i - 1, y) && inside(i + 1, y) && inside(i, y - 1));
    for (let i = 0; i < w; i++) for (let y = hz - hts[i]; y < hz; y++) {
      if (state === "fog") { if (edge(i, y) || (x + i + y) % 2 === 0) { c.fillStyle = g.ghost; c.fillRect(x + i, y, 1, 1); } continue; }
      if (state === "unknown") { if (edge(i, y) && (i + y) % 2 === 0) { c.fillStyle = snap(mix(col, "#0C101A", 0.4)); c.fillRect(x + i, y, 1, 1); } continue; }
      c.fillStyle = y === hz - hts[i] ? rim : col; c.fillRect(x + i, y, 1, 1);
    }
    if (state === "fog") return;
    const peak = hts.indexOf(Math.max(...hts)), ph = hts[peak];
    if (kind === "held") {
      // a held item sits in mist: a sparse pale dithered bank over the island's lower body
      for (let i = 0; i < w; i++) for (let y = hz - Math.max(1, Math.round(hts[i] * 0.6)); y < hz; y++) if (dither(x + i, y, 0.3)) { c.fillStyle = g.fogCol; c.fillRect(x + i, y, 1, 1); }
    } else if (kind === "gate") {
      // a gate carries a beacon post: its pole in the island's own shade, a pale light at the tip
      const len = step === 1 ? 2 : step === 2 ? 3 : 4, bx = x + peak;
      for (let k = 1; k <= len; k++) if (state === "ok" || k % 2) { c.fillStyle = snap(mix(col, "#101018", 0.5)); c.fillRect(bx, hz - ph - k, 1, 1); }
      c.fillStyle = state === "ok" ? pal.lantern.glass_lit : snap(mix(pal.lantern.glass_lit, col, 0.6)); c.fillRect(bx, hz - ph - len - 1, 1, 1);
    }
  }
  // Storm: three lightning flashes on arrival, then still.
  function drawFlash(ctx, g, frame) {
    const flashK = frame.ev.storm == null ? 9 : (g.now - frame.ev.storm) / 500;
    if (!(g.storm && flashK < 3 && flashK - Math.floor(flashK) < 0.24)) return;
    const { W, hz } = g;
    ctx.fillStyle = "#3A4050"; ctx.fillRect(0, 0, W, Math.round(hz * 0.6));
    let x = Math.round(W * 0.7), y = 0;
    const r = rng(1234);
    ctx.fillStyle = "#E8ECF0";
    while (y < hz - 10) { const nx = x + Math.round((r() - 0.5) * 8); for (let k = 0; k < 6; k++) ctx.fillRect(Math.round(x + ((nx - x) * k) / 6), y + k, 2, 1); x = nx; y += 6; }
  }

  // The sea, one pixel buffer: the sky's last rows and the sea bands as a base, the wave dashes, whitecaps and haze over it.
  const SEA = { key: null, base: null, u32: null, img: null, dashes: null, foam: null };
  const BAYER_T = BAYER.map(r => r.map(v => v / 16));
  function buildDashes(g, L) {
    // The still scene's waves exactly (same seeded draw as ever), kept as a list so each can move.
    const { W, H, hz, tod, sea } = g, y0 = hz + 2, hh = H - hz - 2, r = rng(5), n = Math.ceil((W * hh) / 40);
    const d = { n, x: new Int16Array(n), y: new Int16Array(n), len: new Uint8Array(n), tier: new Uint8Array(n), depth: new Float32Array(n), skip: new Uint8Array(n) };
    for (let i = 0; i < n; i++) {
      const y = y0 + Math.floor(r() ** 1.6 * hh), x = Math.floor(r() * W), depth = (y - y0) / hh, len = 2 + Math.floor(depth * 6 + r() * 3);
      d.x[i] = x; d.y[i] = y; d.len[i] = len; d.depth[i] = depth; d.tier[i] = depth < 0.2 ? 0 : depth < 0.6 ? 1 : 2;
      d.skip[i] = L && x + len > L.x0 - 6 && x < L.x1 + 16 && y < L.water + 6 && y > L.deck ? 1 : 0;
    }
    const wc = tod === "night" || tod === "anchor" ? ["#24345A", "#1C2A4C", "#16223E"].map(c => (tod === "anchor" ? mix(c, sea[2], 0.5) : c))
      : tod === "storm" ? ["#5A6474", "#4A5260", "#3C4450"] : [mix(sea[0], "#FFFFFF", 0.25), mix(sea[1], "#FFFFFF", 0.18), mix(sea[2], "#FFFFFF", 0.12)];
    d.col = wc.map(snap).map(abgr);
    return d;
  }
  function buildFoam(g, tok) {
    const { W, H, hz } = g, r = rng(31), n = Math.max(8, Math.round(W * tok.foam.per_px)), f = { n, x: [], y: [], life: [], off: [], depth: [] }, [l0, l1] = tok.foam.life_s;
    const y0 = hz + 5, hh = Math.max(1, H - hz - 8);
    for (let i = 0; i < n; i++) { const yy = Math.floor(r() ** 1.3 * hh); f.x.push(Math.floor(r() * W)); f.y.push(y0 + yy); f.life.push(lerp(l0, l1, r())); f.off.push(r()); f.depth.push(yy / hh); }
    const lf = lit("#C8D0DC");
    f.col = [mix(g.sea[0], lf, 0.5), mix(g.sea[1], lf, 0.7), lf].map(c => abgr(snap(c)));
    return f;
  }
  function drawSea(g, A, rev, sky, L) {
    const { W, H, hz, sea } = g, y0 = Math.max(0, (hz - 4) & ~3), hgt = H - y0, tok = tokOf(A); // y0 a multiple of 4 keeps the Bayer seams on the same rows as ever
    const cv = layer("sea", W, hgt), base = layer("seabase", W, hgt);
    const key = [rev, hz, W, H, L ? L.x0 + "." + L.x1 : "", A ? 1 : 0].join();
    if (SEA.key !== key || cv.key !== key) {
      SEA.key = cv.key = key;
      base.ctx.clearRect(0, 0, W, hgt);
      base.ctx.drawImage(sky.cv, 0, y0, W, hz - y0, 0, 0, W, hz - y0);
      bands(base.ctx, 0, hz - y0, W, H - hz, sea);
      base.ctx.fillStyle = snap(mix(sea[0], g.sky[g.sky.length - 1], 0.5)); base.ctx.fillRect(0, hz - y0, W, 1);
      SEA.base = new Uint32Array(base.ctx.getImageData(0, 0, W, hgt).data.buffer);
      SEA.img = new ImageData(W, hgt);
      SEA.u32 = new Uint32Array(SEA.img.data.buffer);
      SEA.dashes = g.loading ? null : buildDashes(g, L);
      SEA.foam = A && !g.loading ? buildFoam(g, tok) : null;
      SEA.hazeCol = abgr(snap(mix(mix(g.sky[g.sky.length - 1], sea[0], 0.5), lit("#C8D0DC"), 0.22)));
    }
    const u = SEA.u32, d = SEA.dashes;
    u.set(SEA.base);
    if (d) {
      const yTop = hz + 2;
      if (!A) {
        for (let i = 0; i < d.n; i++) {
          if (d.skip[i]) continue;
          const row = (d.y[i] - y0) * W, c = d.col[d.tier[i]], e = Math.min(W, d.x[i] + d.len[i]);
          for (let x = d.x[i]; x < e; x++) u[row + x] = c;
        }
      } else {
        const p = A.phase, amp = A.amp, hv = tok.heave, sc = tok.scroll_px_s, k = g.phone ? 0.7 : 1;
        const Hs = Math.min(3.2, hv.px * amp) * k, lam = hv.wavelength_px, tw = hv.period_s, ph = TAU * (p / tw);
        for (let i = 0; i < d.n; i++) {
          // the swell is read at the dash's true (unrounded) position, so a dash steps up or down once, never back and forth
          const dp = d.depth[i], xf = d.x[i] - lerp(sc.far, sc.near, dp) * p, x = (((Math.floor(xf)) % W) + W) % W;
          const y = Math.max(yTop, d.y[i] + Math.round(Hs * (0.35 + 0.65 * dp) * Math.sin(TAU * (xf / lam) + ph)));
          if (y >= H) continue;
          const row = (y - y0) * W, c = d.col[d.tier[i]], len = d.len[i];
          for (let j = 0; j < len; j++) { const px = x + j; u[row + (px >= W ? px - W : px)] = c; }
        }
        // Whitecaps: dithered runs that fade in, drift with the swell and fade out.
        const f = SEA.foam, share = Math.max(0.2, Math.min(1, 0.35 + 0.35 * amp));
        const live = Math.round(f.n * share);
        for (let i = 0; i < live; i++) {
          const T = f.life[i], q = p / T + f.off[i], cyc = Math.floor(q), a = Math.sin(Math.PI * (q - cyc));
          if (a < 0.14) continue;
          const dp = f.depth[i], jit = ihash(i, cyc), vs = lerp(sc.far, sc.near, dp);
          const xf = f.x[i] + (jit % W) - vs * p, x = (((Math.floor(xf)) % W) + W) % W;
          const y0f = f.y[i] + ((jit >>> 8) % 5) - 2;
          const y = Math.min(H - 1, Math.max(yTop, y0f + Math.round(Hs * (0.35 + 0.65 * dp) * Math.sin(TAU * (xf / lam) + ph))));
          const len = 3 + Math.floor(a * (3 + dp * 7)), col = f.col[dp < 0.3 ? 0 : dp < 0.65 ? 1 : 2], row = (y - y0) * W, thr = a * 0.95;
          const brow = BAYER_T[y0f & 3]; // the dither pattern rides with the whitecap, so it fades without shimmering
          for (let j = 0; j < len; j++) {
            if (brow[(j + i) & 3] < thr) u[row + (x + j) % W] = col;
          }
        }
      }
    }
    if (A) { // Horizon haze: a few dithered rows either side of the line that breathe and crawl on the wall clock, whatever the swell does.
      const wall = Date.now() / 1000, hzT = tok.haze, breath = 0.8 + 0.2 * Math.sin(TAU * (wall / hzT.breath_s)), sh = Math.floor(wall / hzT.crawl_s) & 3;
      const prof = [0.12, 0.25, 0.45, 0.7, 0.5, 0.32, 0.2, 0.1];
      for (let r = 0; r < prof.length; r++) {
        const y = hz - 3 + r, row = (y - y0) * W, thr = prof[r] * breath;
        if (y < y0 || y >= H) continue;
        for (let x = 0; x < W; x++) if (BAYER_T[y & 3][(x + sh) & 3] < thr) u[row + x] = SEA.hazeCol;
      }
    }
    cv.ctx.putImageData(SEA.img, 0, 0);
    return { cv: cv.cv, y0 };
  }

  // The ship and everything that rides on it, in three cached layers so the crew's work loop (a new frame every
  // half second) repaints only the sailors: the hull and rigging, the crew, then the rail, marks and the crow.
  function shipBox(g, L) {
    const top = Math.min(...L.masts.map(m => m.top)) - 14;
    return { x0: Math.max(0, L.x0 - 12), x1: Math.min(g.W, L.x1 + 24), y0: Math.max(0, top), y1: Math.min(g.H, L.water + 18) };
  }
  // Where each sailor stood when the crew was last drawn at rest: a stage change walks them from there (300 ms, 3 steps).
  const PREVX = new Map();
  function shipParts(g, L, frame, walking) {
    const { S, W, H, now, sleeping, ghost } = g;
    const frozen = S.screen === "hail" || S.lost;
    const animated = frozen ? new Set() : (frame.animated || new Set());
    const idle = Math.floor(now / 500);
    const silentMachine = silentSet(S);
    // Crew: one sailor per lane, standing at their stage's station in their section; asleep in hammocks at anchor.
    const placed = [], groups = [];
    for (const sec of L.sections) {
      const crew = sleeping ? sec.crew : sec.crew.map((c, i) => [c, i]).sort((a, b) => STATIONS.indexOf(a[0].stage || "") - STATIONS.indexOf(b[0].stage || "") || a[1] - b[1]).map(a => a[0]);
      const n = crew.length, gaps = sleeping ? 0 : Math.max(0, new Set(crew.map(c => c.stage || "")).size - 1) * GROUP_GAP;
      const sp = sleeping ? Math.min(16, Math.floor((sec.x1 - sec.x0) / Math.max(1, n)) || 16) : L.spacing;
      const start = sec.x0 + Math.max(0, Math.round((sec.x1 - sec.x0 - n * sp - gaps) / 2)) + Math.round((sp - 16) / 2);
      let x = start, prev = null, grp = null;
      crew.forEach((cw, i) => {
        const st = sleeping ? "" : cw.stage || "";
        if (i && st !== prev) x += GROUP_GAP;
        if (!grp || st !== prev) { grp = { stage: st, x0: x, x1: x, sec }; groups.push(grp); }
        grp.x1 = x;
        prev = st;
        const p = crewPose(cw, animated.has(cw.id), idle, sleeping);
        placed.push(Object.assign({ c: cw, x, y: L.deck - 23, row: sleeping && sp < 16 ? i % 2 : 0, look: crewLook(cw.id, cw.tag),
          ghost: !sleeping && (cw.stale || S.lost || silentMachine.has(cw.machine)) ? ghost : null }, p));
        x += sp;
      });
    }
    if (walking) for (const p of placed) { const from = PREVX.get(p.c.id); if (from != null && from !== p.x) p.x = Math.round(from + (p.x - from) * walking / 3); }
    else if (walking === 0) for (const p of placed) PREVX.set(p.c.id, p.x);
    return { placed, silentMachine, groups };
  }
  function drawShipBack(c, g, L, frame, parts) {
    const { S, W, H, now, sleeping, ghost, night } = g;
    c.clearRect(0, 0, W, H);
    shipBack(c, S, L);
    for (const sec of L.sections) {
      const mast = L.masts.find(m => m.machine === sec.m.id);
      if (!sec.scouts.length || !mast) continue;
      sec.scouts.forEach((cw, i) => drawGrid(c, crewSprite("spy"), mast.x - 8 + i * 6, mast.nestY - 12, crewLook(cw.id, cw.tag), cw.stale || S.lost ? ghost : null));
      nestFront(c, S, mast);
    }
    // Lanterns at each masthead. A silent section's goes out (lamp_out); with no host, the main one.
    for (const m of L.masts) {
      const fogT = m.machine && frame.ev.fog ? frame.ev.fog[m.machine] : null;
      const out = S.lost || S.screen === "empty" || sleeping || (m.machine && parts.silentMachine.has(m.machine) && stepAt(fogT, 300, 1, now) >= 1) ||
        (m === L.main && S.screen === "hail" && L.role === "flagship") || (L.berth === "anchored" && m !== L.main);
      drawSprite(c, S, out ? "lantern_dark" : "lantern_lit", m.x - 2, m.top - 9, { lit: out });
    }
    hull(c, S, L, night);
    if (sleeping || S.screen === "empty") anchorChain(c, S, L);
    for (const p of parts.placed) if (p.prop === "barrel") barrel(c, p.x + 4, L.deck - 7);
  }
  // The stations' furniture, on the rail line in front of each group (the rail hides the sailors' legs): the chart on its
  // table, the workbench with a box of tools, the plank under inspection. The signal staff flies two flags above the sailor
  // who hauls on its halyard. The rail itself is the waiting station, and the barrels the landed one.
  function stationProps(c, g, L, groups) {
    const Wd = g.S.palette.scene.wood, d = L.deck;
    for (const gr of groups) {
      const x0 = gr.x0 + 2, x1 = gr.x1 + 13, w = x1 - x0 + 1;
      if (gr.stage === "plan") {
        c.fillStyle = lit(Wd.outline); c.fillRect(x0 - 1, d - 12, w + 2, 1);
        c.fillStyle = lit("#E6DCC4"); c.fillRect(x0, d - 11, w, 2);
        c.fillStyle = lit("#6E7A5A"); for (let x = x0 + 1; x < x1; x += 4) c.fillRect(x, d - 11 + ((x >> 2) & 1), 2, 1);
        c.fillStyle = lit(Wd.light); c.fillRect(x0 - 1, d - 9, w + 2, 1);
      } else if (gr.stage === "build") {
        c.fillStyle = lit(Wd.outline); c.fillRect(x0 - 1, d - 11, w + 2, 1);
        c.fillStyle = lit(Wd.trim); c.fillRect(x0, d - 10, w, 1);
        c.fillStyle = lit(Wd.mid); c.fillRect(x0 - 1, d - 9, w + 2, 1);
        c.fillStyle = lit("#2A1A10"); c.fillRect(x0 + 1, d - 14, 5, 3); c.fillStyle = lit("#8A6440"); c.fillRect(x0 + 2, d - 13, 3, 2);
        c.fillStyle = lit("#A8B0BA"); c.fillRect(x1 - 4, d - 12, 3, 1);
      } else if (gr.stage === "verify") {
        c.fillStyle = lit(Wd.outline); c.fillRect(x0 - 1, d - 10, w + 2, 1);
        c.fillStyle = lit(Wd.light); c.fillRect(x0, d - 9, w, 1);
        c.fillStyle = lit("#2A1A10"); for (let x = x0 + 2; x < x1; x += 5) c.fillRect(x, d - 9, 1, 1);
      }
    }
  }
  function signalFlags(c, g, p) {
    const S = g.S, a = scenePath(S, "flag.light") || "#E6DCC4", b = scenePath(S, "flag.dark") || "#3A4C70";
    c.fillStyle = p.ghost || lit((S.palette.scene.wood || {}).mast_dark || "#3A2416"); c.fillRect(p.x + 14, p.y - 11, 1, 11);
    c.fillStyle = p.ghost || lit(a); c.fillRect(p.x + 15, p.y - 11, 4, 3);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { c.fillStyle = p.ghost || lit((i + j) % 2 ? b : a); c.fillRect(p.x + 15 + i, p.y - 7 + j, 1, 1); }
  }
  function drawShipCrew(c, g, L, parts) {
    const { W, H, sleeping } = g, placed = parts.placed;
    c.clearRect(0, 0, W, H);
    for (const p of placed) if (p.pose !== "hammock") drawGrid(c, crewSprite(p.pose), p.x, p.y, p.look, p.ghost, p.flip);
    if (!sleeping) { stationProps(c, g, L, parts.groups); for (const p of placed) if (p.flags) signalFlags(c, g, p); }
    for (const p of placed) if (p.prop === "crate" && !sleeping) crate(c, p.x + 11, L.deck - 9);
    for (const p of placed) if (p.pose === "hammock") drawGrid(c, HAMMOCK, p.x, L.deck - 22 + p.row * 7, Object.assign({}, p.look, { x: "#C8BC9C", X: "#9A8E70" }), null);
  }
  function drawShipFront(c, g, L, frame, parts, ambient) {
    const { S, pal, W, H, now, sleeping, ghost } = g;
    c.clearRect(0, 0, W, H);
    rail(c, S, L);
    for (const p of parts.placed) if (p.prop === "smoke") smoke(c, p.x + 3, p.y - 2, p.ghost);
    // Marks above crew: running long, no word. At anchor, off-course crew keep their mark, in fog.
    for (const p of parts.placed) {
      const mark = p.mark || (sleeping && { long: "long", blocked: "blocked", failed: "failed", unknown: "silent" }[p.c.state]);
      if (!mark) continue;
      const colour = sleeping || p.ghost || mark === "silent" ? ghost : S.palette.ink.ink;
      drawGlyph(c, S, mark, p.x + 2, (sleeping ? L.deck - 36 + p.row * 7 : p.y - 14), colour);
    }
    // Foam along the waterline (the moving sea draws its own when the ship floats).
    if (!ambient) {
      c.fillStyle = lit("#C8D0DC");
      const fr = rng(31);
      for (let x = L.x0 - 3; x < L.x1 + 12; x++) if (fr() > 0.45) c.fillRect(x, L.water + 1 + (fr() > 0.7 ? 1 : 0), 1 + Math.floor(fr() * 2), 1);
    }
    // Host down: the two-flag hoist up the main mast's halyard.
    if (S.screen === "hail" && L.main && L.role === "flagship") {
      const m = L.main, hs = stepAt(frame.ev.hoist, 400, 4, now), y1 = m.top + 4, y0 = L.deck - 22;
      const y = Math.round(y0 + (y1 - y0) * hs / 4);
      c.fillStyle = lit((pal.flag || {}).halyard || "#6A5A48"); c.fillRect(m.x + 2, m.top + 2, 1, L.deck - m.top - 4);
      drawSprite(c, S, "flag_halves", m.x + 3, y, { lit: true });
      drawSprite(c, S, "flag_checks", m.x + 3, y + 9, { lit: true });
    }
    // A full-scale escort moored in its own stretch: a line from the bow to a pile; at anchor, the cable down from the bow.
    if (L.role === "escort") {
      if (L.berth === "harbor") { c.fillStyle = lit("#6A5A48"); for (let i = 0; i < 9; i++) c.fillRect(L.x1 + 4 + i, L.deck + 2 + Math.round(i * 0.7), 1, 1); c.fillStyle = lit("#2A2A34"); c.fillRect(L.x1 + 13, L.deck + 4, 2, L.water - L.deck - 2); }
      if (L.berth === "anchored") anchorChain(c, S, L);
    }
    // The crow: rests on the flagship's stern rail when nothing waits; asleep there at anchor.
    if (L.role === "escort") { /* the crow keeps to the flagship */ }
    else if (sleeping) {
      drawSprite(c, S, "crow_asleep", L.x0 + 2, L.deck - 30, { lit: false });
      drawGlyph(c, S, "asleep", L.x0 + 6, L.deck - 44, ghost);
      // The one warm light: a lit lantern on the stern. It never flickers.
      drawSprite(c, S, "lantern_lit", L.x0 + 1, L.deck - 22, {});
    } else if (!S.calls.count && S.screen === "board") drawSprite(c, S, "crow_perch", L.x0 + 2, L.deck - 16 - 14, { lit: false });
    // Gulls on the top yard of each machine whose reporters are live (section 17); none at night, none in flight.
    for (const m of L.masts) if (m.gulls && gullsPerched(S, L, m.machine)) for (const [x, y] of gullSpots(L, m)) pix(c, ART.gull, x, y, gullCols());
  }
  // The composed ship, rebuilt only when one of its three layers was.
  function shipLayer(g, L, frame, rev, A, liveStep, idleStep, name) {
    const { W, H } = g, box = shipBox(g, L), base = [rev, g.hz, W, H, A ? 1 : 0, liveStep, L.id, L.x0].join(), nm = name || "ship";
    const back = layer(nm + "back", W, H), crew = layer(nm + "crew", W, H), front = layer(nm + "front", W, H), ship = layer(nm, W, H);
    // A crew walk (section 17): three whole-px steps of 100 ms from the old stations to the new.
    const wk = (g.S.world || {}).walk, wt = wk ? g.now - wk.t0 : Infinity, walkStep = wt >= 0 && wt < 300 ? Math.floor(wt / 100) + 1 : 0;
    let parts = null, redo = false;
    if (back.key !== base) { parts = parts || shipParts(g, L, frame); back.key = base; drawShipBack(back.ctx, g, L, frame, parts); redo = true; }
    if (front.key !== base) { parts = parts || shipParts(g, L, frame); front.key = base; drawShipFront(front.ctx, g, L, frame, parts, !!A); redo = true; }
    if (crew.key !== base + "." + idleStep + "." + walkStep) { crew.key = base + "." + idleStep + "." + walkStep; drawShipCrew(crew.ctx, g, L, shipParts(g, L, frame, walkStep)); redo = true; }
    if (redo || ship.key !== crew.key + back.key + front.key) {
      ship.key = crew.key + back.key + front.key;
      const { x0, x1, y0, y1 } = box, c = ship.ctx;
      c.clearRect(x0, y0, x1 - x0, y1 - y0);
      for (const part of [back, crew, front]) c.drawImage(part.cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    }
    return { ship, box };
  }
  // Weather, fog and the critical edge: over the ship, not part of its float.
  // Each ship's weather and fog stay over that ship: they are drawn clipped to its own stretch of the roadstead, so a
  // silent escort's fog or a storm on one never covers a neighbour (it still shows its own, honestly).
  function clipped(c, H, x0, x1, fn) { c.save(); c.beginPath(); c.rect(x0, 0, Math.max(0, x1 - x0), H); c.clip(); fn(); c.restore(); }
  // A machine's weather now (section 26): the final weather at rest, or the clear-to-weather change part-way through its steps.
  // wx is the weather_change token ({ ms, steps }) the core hands in scene data.
  function weatherNow(w, wx, frame, id, now) {
    const ev = frame.ev.wx ? frame.ev.wx[id] : null, d = typeof weatherShape === "function" ? weatherShape(w || "clear", ev, stepAt(ev ? ev.at : null, wx.ms, wx.steps, now), wx.steps) : { word: w, grow: w && w !== "clear" && w !== "fog" ? 1 : 0 };
    const fogged = d.word === "clear" || d.word === "fog";
    return { word: d.word, grow: fogged ? 0 : d.grow, rain: fogged ? 0 : Math.max(0, (4 * d.grow - 1) / 3) };
  }
  function shipWeather(c, g, X, frame, silentMachine) {
    const { S, pal, W, now, night, phone, sleeping, fogCol } = g;
    // Weather per section: rain over a struggling one, a squall (the storm cloud and rain, no lightning) over one that
    // is not answering, a storm cloud over the critical, fog over a silent one.
    const top = X.masts[0] ? Math.min(...X.masts.map(m => m.top)) : X.deck - 60, k = X.role === "escort" ? 0.8 : 1;
    for (const sec of X.sections) {
      const d = weatherNow((S.weather || {})[sec.m.id], S.wx, frame, sec.m.id, now);
      if (d.grow > 0) {
        const cx = sec.mastX + 2, cy = Math.max(top - (phone ? 2 : 14), 11), dark = d.word !== "rain";   // seated inside the window: a cloud above its top edge is unseen
        const dim = sleeping ? 0.5 : 1;
        const cols = (dark || night ? ["#2A3048", "#20263A", "#181C2E"] : ["#6A6E7C", "#4E525E", "#3A3E48"]).map(cc => snap(mix(cc, "#000000", 1 - dim)));
        cloud(c, cx, cy, Math.round((dark ? 46 : 34) * k * d.grow), 7, cols, rng(cx));
        if (d.rain > 0) rain(c, cx - Math.round(16 * k * d.grow), cy + 4, Math.round(32 * k * d.grow), Math.max(2, Math.round(Math.max(8, X.deck - cy - 10) * d.rain)), snap(mix((pal.rain || {})[night ? "night" : "day"] || "#8A94A8", "#000000", 1 - dim)), cx + 1, dark);
      }
    }
    // Fog: a bank rolls over each silent section (4 steps).
    if (S.lost) return;
    for (const sec of X.sections) {
      if (!silentMachine.has(sec.m.id)) continue;
      const st = stepAt(frame.ev.fog ? frame.ev.fog[sec.m.id] : null, 600, 4, now), roll = (4 - st) * 12;
      if (!st) continue;
      fogZone(c, { x0: sec.x0 - 8 + roll, x1: Math.min(W, sec.x1 + 16 + roll), y0: top - 18, y1: X.water + 8, d: (sleeping ? 0.3 : 0.5) * st / 4 }, fogCol, W);
    }
  }
  function drawOver(c, g, L, frame) {
    const { S, pal, W, H, now, hz, night, phone, sleeping, fogCol, storm } = g;
    c.clearRect(0, 0, W, H);
    const silentMachine = silentSet(S);
    // The flagship's own stretch: to the end of its slot, or its hull when it sails in front of the first escorts.
    const fx1 = L.fleet ? Math.max(L.slot ? L.slot.x1 : 0, L.x1 + L.bowsprit + 2) : W;
    clipped(c, H, 0, fx1, () => shipWeather(c, g, L, frame, silentMachine));
    for (const X of L.bigs || []) clipped(c, H, X.sx0, X.sx1, () => shipWeather(c, g, X, frame, silentMachine));
    // Fog over the whole sea when every source is lost.
    if (S.lost) fogZone(c, { x0: 0, x1: W, y0: 0, y1: H, d: 0.5 * stepAt(frame.ev.lost, 600, 4, now) / 4 }, fogCol, W);
    // Each escort's own weather from its own machine (section 21): a small cloud and rain, darker for the storm of a
    // critical on it or the squall of one not answering, and its own fog bank rolling in when it goes silent; a thin
    // fog over a convoy with a silent ship.
    for (const E of L.escorts) clipped(c, H, E.sx0, E.sx1, () => {
      const d = weatherNow(E.weather, S.wx, frame, E.id, now);
      if (d.grow > 0) {
        const cx = E.mastX, cy = E.top - 7, dim = sleeping ? 0.5 : 1, dark = d.word !== "rain";
        const cols = (dark || night ? ["#2A3048", "#20263A", "#181C2E"] : ["#6A6E7C", "#4E525E", "#3A3E48"]).map(cc => snap(mix(cc, "#000000", 1 - dim)));
        cloud(c, cx, cy, Math.round((dark ? 26 : 20) * d.grow), 4, cols, rng(cx));
        if (d.rain > 0) rain(c, cx - 9, cy + 2, Math.max(2, Math.round(18 * d.grow)), Math.max(2, Math.round(Math.max(6, E.deck - cy - 6) * d.rain)), snap(mix((pal.rain || {})[night ? "night" : "day"] || "#8A94A8", "#000000", 1 - dim)), cx + 1, dark);
      }
      if (!S.lost && E.silent) {
        const st = stepAt(frame.ev.fog ? frame.ev.fog[E.id] : null, 600, 4, now);
        if (st) fogZone(c, { x0: E.x0 - 6 + (4 - st) * 6, x1: Math.min(W, E.x1 + 10 + (4 - st) * 6), y0: E.top - 8, y1: E.water + 4, d: 0.5 * st / 4 }, fogCol, W);
      }
    });
    if (L.convoy && L.convoy.stale && !S.lost) fogZone(c, { x0: L.convoy.x0 - 4, x1: Math.min(W, L.convoy.x1 + 4), y0: L.convoy.water - 18, y1: L.convoy.water + 4, d: 0.35 }, fogCol, W);
    // Host down: a thin fog over the sky.
    if (S.screen === "hail" && L.main) fogZone(c, { x0: 0, x1: W, y0: 0, y1: hz + 6, d: 0.22 * stepAt(frame.ev.hoist, 600, 4, now) / 4 }, fogCol, W);
    // Critical: a 1-art-px trouble edge round the canvas, three blinks at 2 Hz on arrival, then steady.
    if (storm && !phone) {
      const k = frame.ev.storm == null ? 9 : (now - frame.ev.storm) / 250;
      if (!(k < 6 && Math.floor(k) % 2 === 1)) {
        c.fillStyle = S.palette.status.trouble;
        c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
      }
    }
  }

  // The ship's pose in whole px: bob (rise and fall), lean (masthead sway), pitch (bow and stern), surge (slow forward drift).
  function shipPose(g, A, tok) {
    const k = g.phone ? 0.7 : 1, ph = per => TAU * (A.phase / per);
    return {
      bob: Math.round(tok.bob.px * A.amp * k * Math.sin(ph(tok.bob.period_s))),
      lean: Math.round(tok.lean.px * A.amp * A.roll * k * Math.sin(ph(tok.lean.period_s) + 1.1)),
      pitch: Math.round(tok.pitch.px * A.amp * A.roll * k * Math.sin(ph(tok.pitch.period_s) + 2.3)),
      surge: A.roll > 0.05 ? Math.round(tok.surge.px * A.amp * Math.sin(ph(tok.surge.period_s) + 0.4)) : 0,
    };
  }
  // Blit the ship layer through two whole-px shears: rows shift sideways (lean, surge), then columns shift up and down (bob, pitch).
  function blitShip(ctx, g, L, ship, box, pose) {
    const { x0, x1, y0, y1 } = box, bw = x1 - x0, bh = y1 - y0, M = 14;
    if (!pose || (!pose.bob && !pose.lean && !pose.pitch && !pose.surge)) { ctx.drawImage(ship.cv, x0, y0, bw, bh, x0, y0, bw, bh); return; }
    const tmp = layer("shiptmp", bw + 2 * M, bh);
    tmp.ctx.clearRect(0, 0, tmp.cv.width, bh);
    const top = Math.min(...L.masts.map(m => m.top)) - 9, ref = L.water, span = Math.max(1, ref - top);
    const offOf = y => pose.surge + (y < ref ? Math.round(pose.lean * (ref - y) / span) : 0);
    for (let y = y0; y < y1;) {
      const o = offOf(y); let e = y + 1;
      while (e < y1 && offOf(e) === o) e++;
      tmp.ctx.drawImage(ship.cv, x0, y, bw, e - y, M + o, y - y0, bw, e - y);
      y = e;
    }
    const cx = (L.x0 + L.x1) / 2, half = Math.max(1, (L.x1 - L.x0) / 2);
    const dyOf = x => pose.bob + Math.round(pose.pitch * (x - cx) / half);
    const tw = tmp.cv.width;
    for (let i = 0; i < tw;) {
      const dy = dyOf(x0 - M + i); let e = i + 1;
      while (e < tw && dyOf(x0 - M + e) === dy) e++;
      ctx.drawImage(tmp.cv, i, 0, e - i, bh, x0 - M + i, y0 + dy, e - i, bh);
      i = e;
    }
  }
  // Water in front of the hull: the sea's own pixels over the keel, with a wavy top edge and a dithered crest of foam.
  function frontWater(ctx, g, L, sea, A) {
    const { W, H } = g, x0 = Math.max(0, L.x0 - 14), x1 = Math.min(W, L.x1 + 26), water = L.water, k = g.phone ? 0.7 : 1;
    const fw = 1 + (A.amp > 1.4 ? 1 : 0), lam = 54, tw = 3.1, ph = TAU * (A.phase / tw);
    const edge = x => water + 2 + Math.round(fw * k * Math.sin(TAU * (x / lam) + ph)) + (A.amp > 1.4 ? Math.round(Math.sin(TAU * (x / 23) + ph * 1.3)) : 0);
    const bottom = Math.min(H, water + 18), crest = [];
    for (let x = x0; x < x1;) {
      const e = edge(x); let xe = x + 1;
      while (xe < x1 && edge(xe) === e) xe++;
      if (bottom > e) ctx.drawImage(sea.cv, x, e - sea.y0, xe - x, bottom - e, x, e, xe - x, bottom - e);
      for (let xx = x; xx < xe; xx++) crest.push(e - 1);
      x = xe;
    }
    // foam crest on the edge, denser as the sea builds
    const dens = Math.max(0.3, Math.min(0.9, 0.35 + 0.28 * A.amp)) * (0.8 + 0.2 * Math.sin(TAU * (A.phase / 2.3)));
    ctx.fillStyle = lit("#C8D0DC");
    for (let x = x0; x < x1;) {
      const y = crest[x - x0];
      if (BAYER_T[y & 3][x & 3] >= dens * 0.9) { x++; continue; }
      let e = x + 1;
      while (e < x1 && crest[e - x0] === y && BAYER_T[y & 3][e & 3] < dens * 0.9) e++;
      ctx.fillRect(x, y, e - x, 1);
      x = e;
    }
  }

  // ---- escorts at half scale (section 21): drawn natively at 8 x 12 a sailor, never a scaled-down full ship -------------
  function miniGrid(pose) {
    const g = blank(8, 12), sit = pose === "sit", dy = sit ? 2 : 0;
    rect(g, 2, dy, 5, dy, "h"); rect(g, 2, 1 + dy, 6, 1 + dy, "H");
    rect(g, 2, 2 + dy, 5, 3 + dy, "s"); put(g, 4, 2 + dy, "e"); put(g, 5, 3 + dy, "S");
    rect(g, 1, 4 + dy, 6, 7 + dy, "c");
    if (sit) { rect(g, 2, 10, 6, 10, "p"); rect(g, 6, 11, 7, 11, "b"); }
    else { rect(g, 2, 8, 3, 10, "p"); rect(g, 4, 8, 5, 10, "p"); rect(g, 1, 11, 3, 11, "b"); rect(g, 4, 11, 6, 11, "b"); }
    const armL = () => { rect(g, 0, 5 + dy, 0, 7 + dy, "a"); put(g, 0, 8 + dy, "s"); };
    const armR = () => { rect(g, 7, 5 + dy, 7, 7 + dy, "a"); put(g, 7, 8 + dy, "s"); };
    switch (pose) {
      case "work": armL(); rect(g, 7, 2, 7, 4, "a"); put(g, 7, 1, "s"); rect(g, 6, 0, 7, 0, "m"); break;
      case "chart": put(g, 0, 6, "a"); put(g, 1, 8, "s"); put(g, 7, 6, "a"); put(g, 6, 8, "s"); break;
      case "lantern": armL(); put(g, 7, 5, "a"); put(g, 7, 6, "s"); rect(g, 7, 7, 7, 8, "L"); put(g, 7, 9, "M"); break;
      case "hoist": armL(); rect(g, 7, 2, 7, 4, "a"); put(g, 7, 1, "s"); break;
      case "scroll": rect(g, 0, 1, 0, 4, "a"); rect(g, 7, 1, 7, 4, "a"); rect(g, 0, 0, 7, 0, "x"); put(g, 0, 0, "X"); put(g, 7, 0, "X"); break;
      case "crossed": rect(g, 1, 6, 6, 6, "a"); put(g, 3, 3, "S"); break;
      case "worried": armL(); put(g, 7, 4, "a"); put(g, 6, 3, "s"); put(g, 3, 3, "S"); break;
      default: armL(); armR();
    }
    return g;
  }
  const miniCache = new Map();
  const miniSprite = pose => { if (!miniCache.has(pose)) miniCache.set(pose, withOutline(miniGrid(pose))); return miniCache.get(pose); };
  function miniPose(c) {
    switch (c.state) {
      case "call": case "approval": return { pose: "scroll" };
      case "failed": return { pose: "worried", smoke: true };
      case "blocked": return { pose: "crossed" };
      case "unknown": return { pose: "stand", ghost: true };
      case "mate": return { pose: "stand", flip: true };
      case "done": return { pose: "sit", barrel: true };
    }
    return { pose: { plan: "chart", build: "work", verify: "lantern", ship: "hoist" }[c.stage] || "work", flags: c.stage === "ship" };
  }
  // The quay: the harbor along the far edge, from the first escort to the lighthouse rock (an escort moors in its own slot).
  function quay(c, g, L) {
    if (!L.escorts.length && !L.convoy) return;   // a full-scale escort lies nearer, and moors to a pile of its own
    const x0 = Math.min(...L.escorts.map(e => e.x0), L.convoy ? L.convoy.x0 : g.W) - 6, x1 = Math.min(g.W - 12, (g.S.ox || 0) + 620), y = g.hz;
    for (let x = x0; x < x1; x++) {
      c.fillStyle = lit((x >> 2) % 2 ? "#4A4A54" : "#3E3E48"); c.fillRect(x, y - 2, 1, 2);
      c.fillStyle = lit("#2A2A34"); c.fillRect(x, y, 1, 1);
      if ((x - x0) % 9 === 4) { c.fillStyle = lit("#5A5A64"); c.fillRect(x, y - 4, 2, 2); }
    }
  }
  // One escort into its layer: hull, rail, mast, sails, lantern, crew, mooring or anchor. Weather and fog go over (drawOver).
  function drawEscort(c, g, E, ghostAll) {
    const S = g.S, W = S.palette.scene.wood, SA = S.palette.scene.sail, d = E.deck, x0 = E.x0, x1 = E.x1, mx = E.mastX;
    const ghost = ghostAll || E.silent ? g.ghost : null;
    // mast and stays
    c.fillStyle = lit(W.mast); c.fillRect(mx, E.top, 1, d - E.top);
    c.fillStyle = lit(W.mast_dark); c.fillRect(mx + 1, E.top + 2, 1, d - E.top - 2);
    // The escort's livery is a bigger pennant and no hull stripe: a 1 px stripe cannot be told apart, a pennant can.
    { const lv = liveryOf(S, E.id), n = marksOf("escort").pennant; if (lv && n) pennant(c, mx + 1, E.top - 1, lv, n); }
    c.fillStyle = lit("#2A1E18");
    for (let i = 0; i < d - 6 - E.top; i += 2) { c.fillRect(mx - 2 - Math.floor(i * (mx - x0 - 2) / (d - E.top)), E.top + 2 + i, 1, 1); c.fillRect(mx + 2 + Math.floor(i * (x1 + 3 - mx) / (d - E.top)), E.top + 2 + i, 1, 1); }
    // sails: set (a belly), slack (hanging in folds), furled (a roll on each yard)
    const yards = [[E.top + 4, 8, 14], [E.top + 15, 9, 18]];
    for (const [ya, h, w] of yards) {
      c.fillStyle = lit(W.mast_dark); c.fillRect(mx - (w >> 1) - 1, ya - 1, w + 3, 1);
      if (E.sails === "furled") { for (let x = -(w >> 1); x <= (w >> 1); x++) { c.fillStyle = lit(x % 3 === 0 ? SA.outline : SA.furled); c.fillRect(mx + x, ya, 1, 2); } continue; }
      for (let y = ya; y < ya + h; y++) {
        const t = (y - ya) / h, half = E.sails === "slack" ? (w >> 1) - 1 : (w >> 1) - Math.round((1 - t) * 1) + Math.round(Math.sin(t * Math.PI) * 1.5);
        for (let x = -half; x <= half; x++) {
          let col = E.sails === "slack" ? ((x + half) % 3 === 0 ? SA.shade : SA.lit) : x > half * 0.5 ? SA.mid : SA.lit;
          if (x === -half || x === half || y === ya) col = SA.outline;
          if (E.sails === "slack" && y === ya + h - 1 && (x + half) % 2) continue;
          c.fillStyle = lit(col); c.fillRect(mx + x, y, 1, 1);
        }
      }
    }
    // lantern at the masthead: lit, dark (silent), or dim (asleep at anchor)
    const glass = S.palette.scene.lantern.glass_lit;
    c.fillStyle = lit("#2A2A34"); c.fillRect(mx - 1, E.top - 4, 3, 1); c.fillRect(mx - 1, E.top - 1, 3, 1);
    c.fillStyle = E.lantern === "lit" ? glass : E.lantern === "dim" ? snap(mix(glass, "#101018", 0.55)) : lit("#3A3E48"); c.fillRect(mx - 1, E.top - 3, 3, 2);
    // hull: a raised stern, planks, a tapered bow and its bowsprit
    for (let x = x0; x <= x1 + 3; x++) {
      const yt = x < x0 + 5 ? d - 2 : d, yb = x <= x1 ? E.water + 2 - (x > x1 - 4 ? x - (x1 - 4) : 0) : d + 2;
      for (let y = yt; y <= yb; y++) {
        if (x > x1 && y > d + 2 - (x - x1)) continue;
        const k = y - yt;
        c.fillStyle = lit(y >= yb ? W.outline : k < 1 ? W.trim : k < 2 ? W.light : y >= E.water ? W.dark : (y - d) % 2 ? W.mid : W.dark);
        c.fillRect(x, y, 1, 1);
      }
    }
    c.fillStyle = lit(W.outline); c.fillRect(x0 - 1, d - 2, 1, E.water - d + 4);
    E.windows.lights.forEach((st, i) => pane(c, S, x0 + 2 + 5 * i, d + 1, 4, 4, st));   // the stern windows, on the hull's side (section 23.2)
    c.fillStyle = lit(W.mast); for (let i = 0; i < ESC.bowsprit; i++) c.fillRect(x1 + 3 + i, d - 1 - (i >> 1), 1, 1);
    // crew at their stations, stern to bow (no stage: a plain spot first), feet on the deck
    const crew = E.crew.map((cw, i) => [cw, i]).sort((a, b) => STATIONS.indexOf(a[0].stage || "") - STATIONS.indexOf(b[0].stage || "") || a[1] - b[1]).map(a => a[0]);
    let x = x0 + ESC.stern, prev = null;
    for (const cw of E.sleeping ? [] : crew) {   // at anchor the crew sleep below
      const st = cw.stage || "";
      if (prev != null && st !== prev) x += 1;
      prev = st;
      const p = miniPose(cw), gh = ghost || (cw.stale ? g.ghost : null) || (p.ghost ? g.ghost : null);
      if (p.barrel) { c.fillStyle = lit("#2A1A10"); c.fillRect(x + 4, d - 4, 4, 4); c.fillStyle = lit("#6A4A2C"); c.fillRect(x + 5, d - 3, 2, 2); }
      drawGrid(c, miniSprite(p.pose), x - 1, d - 12, crewLook(cw.id, cw.tag), gh, p.flip);
      if (p.flags) { c.fillStyle = gh || lit(W.mast_dark); c.fillRect(x + 8, d - 17, 1, 6); c.fillStyle = gh || lit(scenePath(S, "flag.light") || "#E6DCC4"); c.fillRect(x + 9, d - 17, 2, 2); }
      if (p.smoke) { c.fillStyle = gh || lit("#7E7E88"); c.fillRect(x + 2, d - 16, 2, 2); c.fillRect(x + 3, d - 19, 3, 2); }
      x += ESC.sp;
    }
    // gulls on the top yard while its reporters are live (none at night, none in flight)
    if (escortGulls(S, E)) pix(c, ART.gull, mx + 4, E.top, gullCols());
    // the rail over the crew's feet
    c.fillStyle = lit(W.trim); c.fillRect(x0 + 5, d - 3, x1 - x0 - 5, 1);
    c.fillStyle = lit(W.mid); for (let xx = x0 + 6; xx < x1; xx += 4) c.fillRect(xx, d - 2, 1, 2);
    // moored: a line from the bow to a bollard on the quay side; at anchor: the cable down from the bow
    const iron = S.palette.scene.bell.iron_dark;
    if (E.berth === "harbor") { c.fillStyle = lit("#6A5A48"); for (let i = 0; i < 6; i++) c.fillRect(x1 + 2 + i, d + 1 - Math.round(i * 0.8), 1, 1); c.fillStyle = lit("#2A2A34"); c.fillRect(x1 + 8, d - 6, 2, 3); }
    if (E.berth === "anchored") { c.fillStyle = lit(iron); for (let i = 0; i < 7; i++) if (i % 3 !== 2) c.fillRect(x1 + 2 + (i >> 2), d + 1 + i, 1, 1); }
  }
  // The convoy past the escorts: three distant silhouettes, one count plate (the core says how many and what is not OK).
  function drawConvoy(c, g, C) {
    const base = snap(mix(g.sea[0], "#1A1A2A", 0.55)), sail = snap(mix(g.sea[0], "#C8C8C0", 0.45));
    [[C.x0 + 1, 0], [C.x0 + 9, -2], [C.x0 + 17, 1]].forEach(([x, dy]) => {
      const w = C.water + dy;
      c.fillStyle = base; c.fillRect(x, w - 2, 9, 2); c.fillRect(x + 1, w, 7, 1); c.fillRect(x + 4, w - 12, 1, 10);
      c.fillStyle = sail; c.fillRect(x + 2, w - 11, 5, 3); c.fillRect(x + 2, w - 7, 5, 3);
    });
  }
  // The quay and convoy in one still layer; each escort in a small layer of its own (repainted only when the scene
  // changes), blitted after the sea with its own whole-pixel float, the far row first so the near row stands in front.
  const escortBox = (g, E) => ({ x0: Math.max(0, E.x0 - 14), x1: Math.min(g.W, E.x1 + 12), y0: Math.max(0, E.top - 6), y1: Math.min(g.H, E.water + 4) });
  function drawEscorts(ctx, g, L, rev, A) {
    const hb = layer("harbor", g.W, g.H), key = [rev, g.hz, g.W, g.H].join();
    if (hb.key !== key) { hb.key = key; hb.ctx.clearRect(0, 0, g.W, g.H); quay(hb.ctx, g, L); if (L.convoy) drawConvoy(hb.ctx, g, L.convoy); }
    ctx.drawImage(hb.cv, 0, 0);
    for (const E of [...L.escorts].sort((a, b) => a.near - b.near)) {
      const b = escortBox(g, E), w = b.x1 - b.x0, h = b.y1 - b.y0, lay = layer("escort:" + E.slot, w, h);
      if (lay.key !== key + E.id) {
        lay.key = key + E.id;
        lay.ctx.clearRect(0, 0, w, h);
        lay.ctx.save(); lay.ctx.translate(-b.x0, -b.y0); drawEscort(lay.ctx, g, E, g.S.lost); lay.ctx.restore();
      }
      const dy = A ? Math.round(Math.max(-1, Math.min(1, 0.8 * (A.amp || 0) * Math.sin(TAU * (A.phase / 6.1) + E.slot * 1.7)))) : 0;
      ctx.drawImage(lay.cv, b.x0, b.y0 + dy);
    }
  }

  // ---- the world (section 17): gulls, the longboat, dolphins, the whale, the lighthouse ------------------------------------
  // The core hands scene.world: {host, gulls (as last shown, per machine), events [{kind, t0, dur, n, colour, dolphins,
  // machine, to}], walk}. Each creature is drawn from its event's start time in whole-px steps, then rests (it is gone).
  const ART = {
    gull: ["..wb", "gww.", ".gg."],
    gullA: ["w...w", ".w.w.", "..w.."],
    gullB: [".....", "wwwww", "..w.."],
  };
  function pix(c, rows, x, y, cols) {
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const col = cols[rows[j][i]];
      if (!col) continue;
      c.fillStyle = col; c.fillRect(x + i, y + j, 1, 1);
    }
  }
  const gullCols = () => ({ w: lit("#E8ECEC"), g: lit("#8E98A2"), b: lit("#E0A838") });
  function gullSpots(L, m) { const ya = m.top + L.sailY, half = Math.round(m.sail.w1 / 2); return [[m.x - half + 2, ya - 5], [m.x + half - 6, ya - 5]]; }
  const gullsShown = S => S.mode === "day" && (S.screen === "board" || S.screen === "hail") && !S.lost && !!S.world; // hailing: last known
  function escortGulls(S, E) {
    if (!gullsShown(S) || E.sails !== "set" || !S.world.gulls[E.id]) return false;
    return !(S.world.events || []).some(e => e.kind === "gulls" && e.machine === E.id);
  }
  function gullsPerched(S, L, mid) {
    if (!mid || !gullsShown(S) || L.sails !== "set" || !S.world.gulls[mid]) return false;
    return !(S.world.events || []).some(e => e.kind === "gulls" && e.machine === mid);
  }
  // The lighthouse: the board's own host, on a rock at the far edge. Lit while this screen reaches its host, dark while it
  // hails; dim at anchor. Its beam turns once in 8 s, only while the ambient sea runs (the one loop; none under still).
  function lighthouse(c, g) {
    const S = g.S, w = g.phone ? 3 : 4, hgt = g.phone ? 9 : 14, x = g.phone ? g.W - 5 : Math.min(g.W - 9, g.ox + 628), base = g.hz + 1;
    for (let i = -7; i <= 7; i++) { const hh = Math.max(1, Math.round(2.4 * Math.sqrt(Math.max(0, 1 - (i / 8) ** 2)))); c.fillStyle = lit(i < 0 ? "#3E3E48" : "#2A2A34"); c.fillRect(x + (w >> 1) + i, base - hh + 1, 1, hh + 1); }
    for (let j = 0; j < hgt; j++) { c.fillStyle = lit(Math.floor(j / 3) % 2 ? "#A04838" : "#DCD8CC"); c.fillRect(x, base - j, w, 1); }
    const top = base - hgt, on = !!S.world.host, dim = g.sleeping;
    c.fillStyle = lit("#2A2A34"); c.fillRect(x - 1, top, w + 2, 1); c.fillRect(x, top - 4, w, 1); c.fillRect(x + (w >> 1), top - 5, 1, 1);
    c.fillStyle = on ? (dim ? "#B89A58" : g.night ? "#FFE69A" : "#F2D27A") : lit("#3A3E48");
    c.fillRect(x, top - 3, w, 3);
    c.fillStyle = lit("#2A2A34"); c.fillRect(x + (w >> 1), top - 3, 1, 3);
    return { x: x + (w >> 1), y: top - 2, on, dim };
  }
  function beam(c, g, lh) {
    const k = Math.cos(TAU * (Date.now() / 8000)), len = Math.round((g.phone ? 18 : 40) * Math.abs(k)), dir = k < 0 ? -1 : 1;
    if (len < 3) return;
    const core = g.night ? "#FFE69A" : snap(mix(g.sky[g.sky.length - 1], "#FFF4C8", 0.55)), edge = snap(mix(g.sky[g.sky.length - 1], core, 0.45));
    for (let i = 3; i <= len; i++) {
      const x = lh.x + dir * i, hw = Math.floor((i * 3) / (len + 1));
      if (x < 0 || x >= g.W) continue;
      c.fillStyle = edge; if (hw) c.fillRect(x, lh.y - hw, 1, 2 * hw + 1);
      c.fillStyle = core; c.fillRect(x, lh.y, 1, 1);
    }
  }
  // A body as a tilted ellipse (whole px): its back in one colour, its belly in another, cut off below the water line.
  function body(c, cx, cy, rx, ry, ang, back, belly, water) {
    const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.ceil(Math.max(rx, ry)) + 1;
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      if (water != null && cy + y > water) continue;
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      if ((u / rx) ** 2 + (v / ry) ** 2 > 1) continue;
      c.fillStyle = v > ry * 0.25 ? belly : back; c.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  function spray(c, cx, y, w, hgt, col, seed) {
    c.fillStyle = col;
    for (let i = 0; i < w * hgt / 3; i++) {
      const h1 = ihash(seed, i), dx = (h1 % w) - (w >> 1), dy = (h1 >>> 8) % Math.max(1, hgt - Math.abs(dx) * hgt / w | 0 || 1);
      c.fillRect(cx + dx, y - dy, 1, 1);
    }
    c.fillRect(cx - (w >> 1), y, w, 1);
  }
  // The whale breaches on the open horizon between the bow and the lighthouse (between the first two masts when the ship
  // reaches too far): 8 steps in 2 s. A release went live.
  function whaleAt(g, L, lh) {
    if (L.fleet) {
      // the widest stretch of horizon no rig stands on, between the stern and the lighthouse
      const busy = [...L.masts.map(m => [m.x - 32, m.x + 32]), ...L.escorts.map(e => [e.x0 - 4, e.x1 + 8]), ...(L.bigs || []).flatMap(b => [[b.x0 - 4, b.x1 + b.bowsprit + 8], ...b.masts.map(m => [m.x - 24, m.x + 24])]),
        ...(L.convoy ? [[L.convoy.x0 - 2, L.convoy.x1 + 2]] : [])].sort((a, b) => a[0] - b[0]);
      let x = (g.ox || 0) + ((L.win || DEF_WIN).x), best = [x, x];
      for (const [a, b] of busy) { if (a - x > best[1] - best[0]) best = [x, a]; x = Math.max(x, b); }
      if ((lh ? lh.x - 8 : g.W) - x > best[1] - best[0]) best = [x, lh ? lh.x - 8 : g.W];
      return Math.round((best[0] + best[1]) / 2);
    }
    const bow = L.x1 + L.bowsprit + 6;
    if (lh && lh.x - bow >= 34) return Math.round((bow + lh.x) / 2) - 2;
    return L.masts.length > 1 ? Math.round((L.masts[0].x + L.masts[1].x) / 2) : L.x0 + 20;
  }
  function whale(c, g, L, ev, lh) {
    const k = Math.min(7, Math.floor((g.now - ev.t0) / 250)), x = whaleAt(g, L, lh), w0 = g.hz + 1;
    const back = lit("#34445A"), belly = lit("#9AAABA"), sp = g.night ? "#C8D8F0" : lit("#E8ECF0"), s = g.phone ? 0.6 : 1;
    if (k === 0 || k === 7) spray(c, x, w0, Math.round(12 * s), 1, sp, 7 + k);
    if (k === 1) body(c, x, w0 + 1, 11 * s, 3 * s, 0, back, back, w0);
    if (k === 2) { body(c, x - 2, w0 - 3, 12 * s, 4 * s, -0.55, back, belly, w0); spray(c, x - 6, w0, Math.round(10 * s), 3, sp, 2); }
    if (k === 3) { body(c, x, w0 - 8 * s | 0, 12 * s, 4 * s, -0.75, back, belly, w0); c.fillStyle = back; c.fillRect(x - 3, w0 - 6, 2, 3); spray(c, x - 7, w0, Math.round(12 * s), 4, sp, 3); }
    if (k === 4) { body(c, x + 3, w0 - 4, 12 * s, 4 * s, 0.5, back, belly, w0); spray(c, x, w0, Math.round(16 * s), 4, sp, 4); }
    if (k === 5) spray(c, x + 2, w0, Math.round(20 * s), Math.round(8 * s), sp, 5);
    if (k === 6) {
      c.fillStyle = back;
      for (let i = 0; i < 6; i++) c.fillRect(x + 4, w0 - i, 2, 1);
      for (let i = 0; i < 5; i++) { c.fillRect(x + 4 - i - 1, w0 - 6 - Math.floor(i / 2), 1, 2); c.fillRect(x + 5 + i + 1, w0 - 6 - Math.floor(i / 2), 1, 2); }
      spray(c, x + 5, w0, Math.round(10 * s), 2, sp, 6);
    }
  }
  // The longboat rows a chest home from the lighthouse rock to the ship's side (a landing): 6 s rowing, 1 s alongside while
  // the chests go aboard. Dolphins, when they come, leap beside it once.
  function boatPath(g, L, lh) {
    // past full-scale escorts it rows home in front of their hulls, not across their decks
    const sy = (L.bigs || []).length ? Math.max(...L.bigs.map(b => b.water)) + 7 : g.hz + 4;
    return { sx: lh.x - (g.phone ? 14 : 30), sy, ex: L.x1 + 6, ey: L.water + 1 };
  }
  function longboat(c, g, L, ev, lh) {
    const el = g.now - ev.t0, P = boatPath(g, L, lh), f = Math.min(1, el / 6000);
    const x = Math.round(P.sx + (P.ex - P.sx) * f), y = Math.round(P.sy + (P.ey - P.sy) * f);
    const Wd = g.S.palette.scene.wood, row = el < 6000 && Math.floor(el / 400) % 2;
    // the hull, bow to the left (towards the ship), 22 ap long
    c.fillStyle = lit(Wd.outline); c.fillRect(x + 1, y - 2, 21, 1);
    c.fillStyle = lit(Wd.trim); c.fillRect(x + 1, y - 1, 21, 1);
    c.fillStyle = lit(Wd.mid); c.fillRect(x, y, 23, 1); c.fillRect(x + 1, y + 1, 21, 1);
    c.fillStyle = lit(Wd.dark); c.fillRect(x + 2, y + 2, 19, 1);
    c.fillStyle = lit(Wd.outline); c.fillRect(x + 4, y + 3, 15, 1); c.fillRect(x - 1, y - 1, 1, 2);
    // two rowers and their oars, pulling in two frames
    for (const rx of [x + 4, x + 9]) {
      c.fillStyle = lit("#2A3042"); c.fillRect(rx, y - 8, 3, 1);
      c.fillStyle = lit("#D8A078"); c.fillRect(rx, y - 7, 3, 2);
      c.fillStyle = lit("#C8C0AC"); c.fillRect(rx, y - 5, 3, 3); c.fillStyle = lit("#3A4C70"); c.fillRect(rx, y - 4, 3, 1);
      c.fillStyle = lit(Wd.mast_dark);
      for (let i = 0; i < 6; i++) c.fillRect(rx + 1 + (row ? i : -i), y - 3 + i, 1, 1);
    }
    // the chests (one a landing, up to three), aboard until they are hoisted onto the ship
    if (el < 6500) {
      const spots = [[x + 13, y - 5], [x + 17, y - 5], [x + 15, y - 8]].slice(0, Math.max(1, Math.min(3, ev.n || 1)));
      for (const [cx, cy] of spots) {
        c.fillStyle = lit("#2A1A10"); c.fillRect(cx, cy, 4, 3);
        c.fillStyle = lit("#C8A040"); c.fillRect(cx, cy, 4, 1); c.fillStyle = lit("#8A6428"); c.fillRect(cx, cy + 1, 4, 2); c.fillStyle = lit("#2A1A10"); c.fillRect(cx + 1, cy + 1, 2, 1);
      }
    }
    // a pennant at the stern in the group's colour
    c.fillStyle = lit(Wd.mast_dark); c.fillRect(x + 21, y - 10, 1, 9);
    c.fillStyle = ev.colour ? lit(ev.colour) : lit("#D8D0B8"); c.fillRect(x + 22, y - 10, 3, 1); c.fillRect(x + 22, y - 9, 2, 1);
    if (g.night) { c.fillStyle = "#FFE69A"; c.fillRect(x - 2, y - 4, 2, 2); c.fillStyle = lit(Wd.mast_dark); c.fillRect(x - 1, y - 2, 1, 1); }
    if (ev.dolphins && el >= 2200 && el < 3400) {
      const bx = x, by = y + 2; // they keep pace with the boat, off its stern
      const splash = g.night ? "#7AE0C8" : lit("#E8ECF0"), back = lit("#3A5470"), belly = lit("#A8BCCC");
      for (const [ox, lag] of [[27, 0], [38, 1]]) {
        const k = Math.floor((el - 2200) / 200) - lag;
        if (k < 0 || k > 5) continue;
        const dy = [0, -4, -6, -4, -1, 1][k], ang = [-0.6, -0.4, 0, 0.4, 0.7, 0.9][k], cx = bx + ox - k, cy = by + dy;
        if (k < 5) {
          body(c, cx, cy, 7, 2.5, ang, back, belly, by + 1);
          c.fillStyle = back; c.fillRect(cx, cy - 4, 1, 2); c.fillRect(cx + 1, cy - 3, 1, 1);
          const tx = Math.round(cx + Math.cos(ang) * 7), ty = Math.round(cy + Math.sin(ang) * 7);
          if (ty <= by) { c.fillRect(tx, ty - 1, 1, 3); }
        }
        if (k === 0 || k >= 4) spray(c, cx, by + 1, 7, 3, splash, 11 + k + lag);
      }
    }
  }
  // Gulls lift off the yard and away (their reporters went late), or come back and settle: 4 steps in 0.8 s.
  function gullFlight(c, g, L, ev) {
    const X = [L, ...(L.bigs || [])].find(s => s.masts.some(x => x.machine === ev.machine && x.gulls)) || L;
    const m = X.masts.find(x => x.machine === ev.machine && x.gulls), E = L.escorts.find(x => x.id === ev.machine);
    if ((!m && !E) || !gullsShown(g.S)) return;
    const k = Math.min(4, Math.floor((g.now - ev.t0) / 200)), step = ev.to ? 4 - k : k, path = [[0, 0], [1, -3], [3, -7], [6, -12], [10, -18]];
    (m ? gullSpots(X, m) : [[E.mastX + 4, E.top]]).forEach(([x, y], i) => {
      if (step === 0) { pix(c, ART.gull, x, y, gullCols()); return; }
      if (step >= 4 && !ev.to) return;
      const [dx, dy] = path[step];
      pix(c, (k + i) % 2 ? ART.gullA : ART.gullB, x + (i ? dx : -dx - 2), y + dy, gullCols());
    });
  }
  // A rainbow over the ship whose critical cleared: an arc from the horizon behind it, kept to its own stretch; it comes in
  // three steps, holds, and goes in three (2.4 s). At night a dim moonbow.
  const BOW = ["#C85A50", "#D89A48", "#D8C860", "#78A860", "#5880B8", "#7A68A8"];
  function rainbowAt(g, L, mid) {
    const X = [L, ...(L.bigs || [])].find(s => s.sections.some(sec => sec.m.id === mid));
    if (X) { const x1 = X.x1 + X.bowsprit; return { cx: Math.round((X.x0 + x1) / 2), r: Math.round(Math.min(70, (x1 - X.x0) / 2 + 8)), x0: X.sx0 ?? (L.fleet ? 0 : 0), x1: X.sx1 ?? (L.fleet ? Math.max(L.slot ? L.slot.x1 : 0, x1 + 2) : g.W) }; }
    const E = (L.escorts || []).find(e => e.id === mid);
    return E ? { cx: E.mastX, r: Math.round(Math.min(34, (E.sx1 - E.sx0) / 2)), x0: E.sx0, x1: E.sx1 } : null;
  }
  function rainbow(c, g, L, ev) {
    const at = rainbowAt(g, L, ev.machine);
    if (!at) return;
    const el = g.now - ev.t0, k = el < 300 ? 1 : el < 600 ? 2 : el < 1800 ? 3 : el < 2000 ? 2 : el < 2200 ? 1 : el < 2400 ? 0.5 : 0, base = g.hz;
    if (!k) return;
    const cols = BOW.map(col => (g.night ? snap(mix(col, g.sky[g.sky.length - 1], 0.6)) : lit(col)));
    for (let b = 0; b < cols.length; b++) {
      const r = at.r - b;
      for (let x = -r; x <= r; x++) {
        const px = at.cx + x, y = base - Math.round(Math.sqrt(Math.max(0, r * r - x * x)) * 0.55);
        if (px < at.x0 || px >= at.x1 || y < 0) continue;
        if (k < 3 && BAYER[y & 3][px & 3] >= k * 5) continue;   // dithered while it comes and goes
        c.fillStyle = cols[b]; c.fillRect(px, y, 1, 1);
      }
    }
  }
  function drawWorldBehind(ctx, g, L) {
    const W0 = g.S.world;
    if (!W0) return null;
    const lh = lighthouse(ctx, g);
    if (lh.on && !lh.dim && g.ambient) beam(ctx, g, lh);
    for (const ev of W0.events || []) if (ev.kind === "whale" && g.now - ev.t0 < ev.dur) whale(ctx, g, L, ev, lh);
    for (const ev of W0.events || []) if (ev.kind === "rainbow" && g.now - ev.t0 < ev.dur) rainbow(ctx, g, L, ev);
    return lh;
  }
  function drawWorldFront(ctx, g, L, lh) {
    const W0 = g.S.world;
    if (!W0 || !lh) return;
    for (const ev of W0.events || []) {
      if (g.now - ev.t0 >= ev.dur && !(ev.kind === "gulls" && ev.to)) continue;
      if (ev.kind === "landing") longboat(ctx, g, L, ev, lh);
      else if (ev.kind === "gulls") gullFlight(ctx, g, L, ev);
    }
  }
  // A ship's windows for the receipt: every lane counted, and how many of them the hull has room to draw.
  const winWords = W => (W && W.n ? { lit: W.count.lit, dark: W.count.dark, unknown: W.count.unknown, n: W.n, drawn: W.lights.length } : null);
  // The scene receipt (section 17): what this module drew, in plain parts the core puts into words.
  function describe(S) {
    if (S.screen === "deck" || S.screen === "loading" || S.screen === "empty") return null;
    const L = shipLayout(S), sleeping = S.screen === "anchor";
    const stations = crew => { const st = {}; for (const c of crew) { const k = sleeping ? "asleep" : c.stage || "none"; st[k] = (st[k] || 0) + 1; } return st; };
    const ships = L.sections.map(sec => ({ id: sec.m.id, label: sec.m.label || sec.m.id, role: "flagship", berth: L.berth, stations: stations(sec.crew), scouts: sec.scouts.length,
      below: sec.below || 0, sails: L.slack.has(sec.m.id) ? "slack" : L.sails, gulls: gullsPerched(S, L, sec.m.id), weather: (S.weather || {})[sec.m.id] || "clear", windows: winWords(L.windows) }));
    for (const X of L.bigs) for (const sec of X.sections) ships.push({ id: X.id, label: X.m.label || X.id, role: "escort", scale: "full", berth: X.berth, stations: stations(sec.crew), scouts: sec.scouts.length,
      below: sec.below || 0, sails: X.slack.has(X.id) ? "slack" : X.sails, gulls: gullsPerched(S, X, X.id), weather: X.weather, lantern: X.lantern, windows: winWords(X.windows) });
    for (const E of L.escorts) ships.push({ id: E.id, label: E.m.label || E.id, role: "escort", berth: E.berth, stations: stations(E.crew), scouts: 0, below: E.below,
      sails: E.sails, gulls: escortGulls(S, E), weather: E.weather, lantern: E.lantern, windows: winWords(E.windows) });
    ships.sort((a, b) => (a.role === "flagship" ? -1 : b.role === "flagship" ? 1 : 0) || ((fleetOf(S).ships.find(x => x.id === a.id) || {}).slot ?? 0) - ((fleetOf(S).ships.find(x => x.id === b.id) || {}).slot ?? 0));
    const W0 = S.world || {};
    const events = (W0.events || []).map(e => (e.kind === "landing" ? (e.dolphins ? "dolphins" : "longboat") : e.kind === "gulls" ? (e.to ? "gulls_back" : "gulls_off") : e.kind));
    // the islands ahead, as the board draws them (section 23.1): the same entries in the same order, the true total apart
    const hor = S.screen === "board" && S.horizon ? { total: S.horizon.total, shown: S.horizon.islands.map(I => ({ kind: I.kind, step: I.step, dated: I.dated, state: I.state })), more: S.horizon.more } : null;
    return { ships, horizon: hor, convoy: L.convoy ? { n: L.convoy.n } : null, lighthouse: S.world ? (W0.host ? "lit" : "dark") : null, events, replay: (W0.events || []).some(e => e.replay) };
  }

  // ---- below decks (screen "deck", docs/theme-spec.md section 16): the ship's plan and its six places -------------------
  // Static art, painted once per room, size and light, then cached. The list plate covers the left of the stage, so each
  // room puts its one focal piece in the window on the right (x 384-620). Rects and small dithered patches only.
  const ROOM_FOCUS = { plan: [330, 200], bridge: [502, 196], "gun-deck": [500, 236], "chart-room": [505, 214], "cargo-hold": [500, 248], "crows-nest": [500, 170], logbook: [505, 216] };
  // The plan: compartments (where the camera goes in) and their door plates, in stage art px.
  const PLAN = {
    "crows-nest": { x: 312, y: 38, w: 38, h: 18, px: 360, py: 44, pw: 116 },
    bridge: { x: 76, y: 100, w: 118, h: 28, px: 40, py: 60, pw: 130 },
    "chart-room": { x: 78, y: 132, w: 114, h: 54, px: 84, py: 146, pw: 102 },
    "gun-deck": { x: 200, y: 158, w: 270, h: 48, px: 276, py: 164, pw: 118 },
    logbook: { x: 474, y: 158, w: 80, h: 48, px: 494, py: 96, pw: 120 },
    "cargo-hold": { x: 124, y: 214, w: 396, h: 48, px: 262, py: 226, pw: 130 },
  };
  const R = (c, col, x, y, w, h) => { c.fillStyle = lit(col); c.fillRect(x, y, w, h); };
  const Rraw = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  // A plank wall: rows of boards with dark seams and staggered butt joints.
  function planks(c, W, x0, y0, x1, y1, row, cols) {
    for (let y = y0, i = 0; y < y1; y += row, i++) {
      R(c, i % 2 ? cols[0] : cols[1], x0, y, x1 - x0, Math.min(row, y1 - y));
      R(c, W.outline, x0, y + row - 1, x1 - x0, 1);
      for (let x = x0 + ((i * 37) % 61); x < x1; x += 61) R(c, W.outline, x, y, 1, row - 1);
    }
  }
  // Warm light round a lamp: a dithered disc, denser at the centre.
  function glow(c, cx, cy, rad, col, strength) {
    c.fillStyle = col;
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = Math.sqrt(x * x + y * y) / rad;
      if (d <= 1 && dither(cx + x, cy + y, strength * (1 - d) * (1 - d))) c.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  function interior(c, g, W) {
    const { W: w, H: h, ox, oy } = g;
    planks(c, W, 0, 0, w, h, 7, [W.mid, W.dark]);
    R(c, W.outline, 0, 0, w, oy + 16); R(c, W.dark, 0, 0, w, oy + 14);
    for (let x = ox - 40; x < w; x += 92) { R(c, W.outline, x, 0, 10, oy + 16); R(c, W.mid, x + 1, 0, 8, oy + 15); }
    R(c, W.outline, ox + 378, 0, 9, h); R(c, W.dark, ox + 379, 0, 7, h); R(c, W.mid, ox + 380, 0, 2, h);
    R(c, W.outline, ox + 624, 0, 9, h); R(c, W.dark, ox + 625, 0, 7, h); R(c, W.mid, ox + 626, 0, 2, h);
    const fy = oy + 298;
    R(c, W.outline, 0, fy - 1, w, 1);
    for (let y = fy, i = 0; y < h; y += 5 + i, i++) { R(c, i % 2 ? W.deck : W.light, 0, y, w, 5 + i); R(c, W.outline, 0, y + 4 + i, w, 1); }
  }
  function hangLamp(c, g, S, x, y) {
    R(c, "#2A1A12", x + 2, g.oy + 14, 1, y - g.oy - 14);
    glow(c, x + 2, y + 6, 44, lit("#E8B860"), g.night ? 0.55 : 0.32);
    drawSprite(c, S, "lantern_lit", x - 1, y, { scale: 2 });
  }
  function seaView(c, g, x, y, w, h) {
    // a window or port onto the open sea: sky above the horizon, sea below, a cloud
    const hz = y + Math.round(h * 0.55);
    for (let i = 0; i < hz - y; i++) Rraw(c, g.sky[Math.min(g.sky.length - 1, Math.floor((i / (hz - y)) * g.sky.length))], x, y + i, w, 1);
    for (let i = 0; i < y + h - hz; i++) Rraw(c, g.sea[Math.min(g.sea.length - 1, Math.floor((i / (y + h - hz)) * g.sea.length))], x, hz + i, w, 1);
    const cr = rng(x * 7 + y);
    for (let i = 0; i < w * h / 60; i++) Rraw(c, g.sea[0], x + Math.floor(cr() * (w - 4)), hz + 2 + Math.floor(cr() * (y + h - hz - 3)), 2 + Math.floor(cr() * 3), 1);
  }
  function bigCrate(c, x, y, s) {
    const W = 10 * s, H = 9 * s;
    R(c, "#2A1A10", x, y, W, H); R(c, "#6A4A2C", x + s, y + s, W - 2 * s, H - 2 * s); R(c, "#8A6440", x + s, y + s, W - 2 * s, 2 * s);
    for (let i = 1; i < 8; i++) { R(c, "#4A321C", x + i * s, y + i * s * 0.9 | 0, s, s); R(c, "#4A321C", x + W - (i + 1) * s, y + i * s * 0.9 | 0, s, s); }
    R(c, "#2A1A10", x, y + 3 * s, W, 1); R(c, "#2A1A10", x, y + 6 * s, W, 1);
  }
  function bigBarrel(c, x, y, s) {
    const W = 8 * s, H = 10 * s;
    R(c, "#2A1A10", x + s, y, W - 2 * s, H); R(c, "#2A1A10", x, y + s, W, H - 2 * s);
    R(c, "#6A4A2C", x + s, y + s, W - 2 * s, H - 2 * s); R(c, "#8A6440", x + 2 * s, y + s, 2 * s, H - 2 * s);
    for (const yy of [2, H / s - 3]) R(c, "#5A5A62", x, y + yy * s, W, s);
  }
  function cannon(c, x, y, s) {
    // side view, muzzle to the right: barrel, carriage, two wheels
    const iron = "#3A3E46", hi = "#6A707A";
    for (let i = 0; i < 44; i++) { const r = Math.round(6 - i * 0.06); R(c, iron, x + i * s / 2, y - r, Math.ceil(s / 2), 2 * r); }
    R(c, hi, x + 2, y - 4, 20, 1); R(c, iron, x - 4, y - 2, 4, 4); R(c, iron, x + 22, y - 6, 2, 12); R(c, iron, x + 21, y - 4, 1, 8);
    R(c, "#2A1A10", x - 2, y + 4, 30, 9); R(c, "#6A4A2C", x - 1, y + 5, 28, 7);
    for (const wx of [x + 2, x + 18]) { disc(c, wx + 3, y + 15, 5, lit("#2A1A10")); disc(c, wx + 3, y + 15, 3, lit("#5E3C26")); R(c, "#2A1A10", wx + 2, y + 14, 2, 2); }
  }
  function openSky(c, g, S, hz) {
    const gg = Object.assign({}, g, { hz });
    drawSky(c, gg, true);
    for (let i = 0; i < g.H - hz; i++) Rraw(c, g.sea[Math.min(g.sea.length - 1, Math.floor((i / (g.H - hz)) * g.sea.length))], 0, hz + i, g.W, 1);
    waves(c, 0, hz + 2, g.W, g.H - hz - 2, [g.sea[0], g.sea[1], g.sea[2]], rng(5), null);
  }
  const ROOMS = {
    plan(c, g, S) {
      const W = S.palette.scene.wood, SA = S.palette.scene.sail, { ox, oy } = g;
      openSky(c, g, S, oy + 230);
      const X = v => ox + v, Y = v => oy + v;
      // masts and furled sails behind the hull
      for (const [mx, top] of [[190, 70], [330, 22], [470, 46]]) {
        R(c, W.mast, X(mx - 2), Y(top), 5, 150 - top); R(c, W.mast_dark, X(mx + 2), Y(top), 1, 150 - top);
        for (const [yy, ww] of [[top + 18, 70], [top + 50, 84]]) if (yy < 140) { R(c, SA.outline, X(mx - ww / 2), Y(yy), ww, 7); R(c, SA.furled, X(mx - ww / 2 + 1), Y(yy + 1), ww - 2, 5); R(c, SA.lit, X(mx - ww / 2 + 1), Y(yy + 1), ww - 2, 1); }
      }
      R(c, W.outline, X(312), Y(38), 38, 18); R(c, W.mid, X(313), Y(39), 36, 16); R(c, W.trim, X(313), Y(39), 36, 2);
      // the hull, cut open: stern castle left, forecastle right, the keel low
      R(c, W.outline, X(70), Y(96), 132, 4); R(c, W.outline, X(66), Y(96), 4, 170); R(c, W.outline, X(70), Y(150), 490, 3);
      const hullBottom = x => Y(318 - Math.max(0, (x - 470) / 90) ** 1.6 * 70 - Math.max(0, (130 - x) / 60) * 16);
      for (let x = 66; x <= 560; x++) { const yb = hullBottom(x); R(c, W.outline, X(x), Y(262), 1, yb - Y(262) + 2); R(c, x % 6 < 3 ? W.dark : "#2A1A12", X(x), Y(263), 1, yb - Y(263)); }
      R(c, W.trim, X(70), Y(150), 490, 1);
      R(c, "#2A1A12", X(70), Y(100), 128, 50); R(c, "#2A1A12", X(70), Y(153), 490, 109);
      // compartments: lit rooms with their furniture
      const room = (k, fill) => { const d = PLAN[k]; R(c, W.outline, X(d.x - 1), Y(d.y - 1), d.w + 2, d.h + 2); planks(c, W, X(d.x), Y(d.y), X(d.x + d.w), Y(d.y + d.h), 5, fill || [W.mid, W.dark]); };
      for (const k of ["chart-room", "gun-deck", "logbook", "cargo-hold"]) room(k);
      // bridge: the open quarterdeck with its wheel
      const b = PLAN.bridge;
      R(c, W.trim, X(b.x), Y(b.y + b.h - 2), b.w, 2);
      disc(c, X(b.x + 80), Y(b.y + 12), 9, lit(W.outline)); disc(c, X(b.x + 80), Y(b.y + 12), 7, lit(W.light)); disc(c, X(b.x + 80), Y(b.y + 12), 5, lit("#2A1A12")); R(c, W.trim, X(b.x + 79), Y(b.y + 11), 3, 3);
      R(c, W.mast_dark, X(b.x + 79), Y(b.y + 20), 3, 7);
      // chart room: the table and its chart
      const cr = PLAN["chart-room"];
      R(c, W.outline, X(cr.x + 18), Y(cr.y + 30), 70, 4); R(c, "#E6DCC4", X(cr.x + 24), Y(cr.y + 27), 58, 3); R(c, W.dark, X(cr.x + 22), Y(cr.y + 34), 3, 18); R(c, W.dark, X(cr.x + 80), Y(cr.y + 34), 3, 18);
      // gun deck: four cannons at their ports
      const gd = PLAN["gun-deck"];
      for (let i = 0; i < 4; i++) { const x = X(gd.x + 24 + i * 64); R(c, "#14100C", x + 14, Y(gd.y + 10), 12, 12); Rraw(c, g.sea[1], x + 15, Y(gd.y + 16), 10, 5); Rraw(c, g.sky[2], x + 15, Y(gd.y + 11), 10, 5);
        R(c, "#3A3E46", x - 6, Y(gd.y + 30), 22, 5); R(c, "#6A4A2C", x - 4, Y(gd.y + 35), 18, 6); disc(c, x - 1, Y(gd.y + 43), 3, lit("#2A1A10")); disc(c, x + 11, Y(gd.y + 43), 3, lit("#2A1A10")); }
      // logbook: the bell and the open book
      const lb = PLAN.logbook;
      drawSprite(c, S, "bell", X(lb.x + 50), Y(lb.y + 6), { lit: true });
      R(c, W.dark, X(lb.x + 8), Y(lb.y + 34), 40, 4); R(c, "#E6DCC4", X(lb.x + 12), Y(lb.y + 30), 15, 4); R(c, "#D8CCB0", X(lb.x + 28), Y(lb.y + 30), 15, 4);
      // cargo hold: crates and barrels
      const ch = PLAN["cargo-hold"];
      for (let i = 0; i < 9; i++) { const x = X(ch.x + 20 + i * 40); if (i % 3 === 2) bigBarrel(c, x, Y(ch.y + 28), 2); else { bigCrate(c, x, Y(ch.y + 30), 2); if (i % 3 === 0) bigCrate(c, x + 4, Y(ch.y + 12), 2); } }
      // lamps in each lit compartment
      for (const k of ["chart-room", "gun-deck", "logbook", "cargo-hold"]) { const d = PLAN[k]; glow(c, X(d.x + d.w / 2), Y(d.y + 10), Math.min(30, d.h), lit("#E8B860"), g.night ? 0.4 : 0.22); drawSprite(c, S, "lantern_lit", X(d.x + d.w / 2 - 2), Y(d.y + 3), {}); }
      // bowsprit and the stern lantern
      for (let i = 0; i < 46; i++) R(c, W.mast, X(560 + i), Y(150 - Math.floor(i / 3)), 2, 2);
      drawSprite(c, S, "lantern_lit", X(66), Y(80), {});
      // the sea in front of the keel
      for (let y = 262; y < 360; y++) { const row = g.sea[Math.min(g.sea.length - 1, Math.floor(((y - 262) / 98) * g.sea.length))]; for (let x = 0; x < g.W; x += 2) if (dither(x, Y(y), 0.5)) Rraw(c, row, x, Y(y), 1, 1); }
    },
    bridge(c, g, S) {
      const W = S.palette.scene.wood, { ox, oy } = g, X = v => ox + v, Y = v => oy + v;
      openSky(c, g, S, oy + 196);
      // the taffrail and the quarterdeck
      R(c, W.outline, 0, Y(246), g.W, 3); R(c, W.trim, 0, Y(246), g.W, 1);
      for (let x = 0; x < g.W; x += 14) { R(c, W.outline, x, Y(249), 6, 34); R(c, W.mid, x + 1, Y(249), 4, 34); }
      R(c, W.outline, 0, Y(282), g.W, 2);
      for (let y = Y(284), i = 0; y < g.H; y += 6 + i, i++) { R(c, i % 2 ? W.deck : W.light, 0, y, g.W, 6 + i); R(c, W.outline, 0, y + 5 + i, g.W, 1); }
      // the wheel on its pedestal
      const cx = X(502), cy = Y(196);
      R(c, W.outline, cx - 9, cy + 30, 18, 86); R(c, W.mid, cx - 7, cy + 30, 14, 85); R(c, W.light, cx - 7, cy + 30, 3, 85);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU, ex = Math.round(Math.cos(a) * 56), ey = Math.round(Math.sin(a) * 56);
        const n = 56;
        for (let k = 0; k <= n; k++) { const px = cx + Math.round((ex * k) / n), py = cy + Math.round((ey * k) / n); R(c, k > 44 ? W.trim : W.mid, px - 1, py - 1, 3, 3); }
        disc(c, cx + ex, cy + ey, 4, lit(W.light)); disc(c, cx + ex, cy + ey, 2, lit(W.trim));
      }
      for (let r = 46; r >= 38; r--) for (let k = 0; k < 360; k += 1) { const a = (k / 360) * TAU; c.fillStyle = lit(r === 46 || r === 38 ? W.outline : r > 43 ? W.light : W.mid); c.fillRect(cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r), 1, 1); }
      disc(c, cx, cy, 10, lit(W.outline)); disc(c, cx, cy, 8, lit(W.trim)); disc(c, cx, cy, 3, lit("#C8A060"));
      // the binnacle and the stern lantern
      R(c, W.outline, X(420), Y(248), 22, 36); R(c, W.mid, X(421), Y(249), 20, 34); R(c, "#A8B0BA", X(424), Y(240), 14, 9); R(c, "#2A2A30", X(425), Y(241), 12, 7); R(c, "#E8DDB8", X(430), Y(243), 2, 3);
      drawSprite(c, S, "lantern_lit", X(596), Y(222), { scale: 2 });
      if (g.night) glow(c, X(600), Y(236), 34, lit("#E8B860"), 0.5);
    },
    "gun-deck"(c, g, S) {
      const W = S.palette.scene.wood, { ox, oy } = g, X = v => ox + v, Y = v => oy + v;
      interior(c, g, W);
      for (const px of [404, 528]) { R(c, W.outline, X(px - 3), Y(130), 70, 64); R(c, W.light, X(px - 2), Y(131), 68, 62); seaView(c, g, X(px + 2), Y(135), 60, 54); R(c, W.outline, X(px - 3), Y(160), 70, 2); }
      cannon(c, X(410), Y(258), 4);
      cannon(c, X(530), Y(258), 4);
      for (const [bx, by] of [[596, 286], [604, 286], [600, 280]]) disc(c, X(bx), Y(by), 4, lit("#2A2A30"));
      R(c, "#8A6A48", X(380), Y(212), 246, 2);
      hangLamp(c, g, S, X(500), Y(60));
    },
    "chart-room"(c, g, S) {
      const W = S.palette.scene.wood, { ox, oy } = g, X = v => ox + v, Y = v => oy + v;
      interior(c, g, W);
      // the stern gallery: three windows of small panes
      for (let i = 0; i < 3; i++) {
        const wx = X(400 + i * 74), wy = Y(56);
        R(c, W.outline, wx - 3, wy - 3, 66, 104); R(c, W.trim, wx - 2, wy - 2, 64, 102); seaView(c, g, wx, wy, 60, 98);
        for (let k = 1; k < 3; k++) R(c, W.dark, wx + k * 20, wy, 2, 98);
        for (let k = 1; k < 4; k++) R(c, W.dark, wx, wy + k * 24, 60, 2);
      }
      // the chart table, the chart, dividers and a compass rose
      const ty = Y(232);
      R(c, W.outline, X(394), ty, 228, 6); R(c, W.light, X(395), ty + 1, 226, 2);
      for (const lx of [402, 604]) { R(c, W.outline, X(lx), ty + 6, 10, 62); R(c, W.mid, X(lx + 1), ty + 6, 8, 61); }
      R(c, "#2A1A12", X(412), ty - 2, 192, 2);
      R(c, "#A8946C", X(414), ty - 10, 188, 9); R(c, "#E6DCC4", X(416), ty - 9, 184, 7);
      for (let x = 0; x < 180; x += 3) R(c, x % 6 ? "#7A6A4C" : "#E6DCC4", X(418 + x), ty - 5 + Math.round(Math.sin(x / 14) * 2), 2, 1);
      R(c, "#6E7A5A", X(440), ty - 8, 16, 3); R(c, "#6E7A5A", X(520), ty - 7, 22, 3); R(c, "#6E7A5A", X(572), ty - 8, 12, 3);
      R(c, "#A8B0BA", X(480), ty - 22, 1, 13); R(c, "#A8B0BA", X(486), ty - 22, 1, 13); R(c, "#6A727C", X(481), ty - 23, 5, 2);
      hangLamp(c, g, S, X(506), Y(166));
    },
    "cargo-hold"(c, g, S) {
      const W = S.palette.scene.wood, { ox, oy } = g, X = v => ox + v, Y = v => oy + v;
      interior(c, g, W);
      // light through the hatch, down the ladder
      R(c, "#14100C", X(452), 0, 70, Y(16)); R(c, "#E8DDB8", X(456), 0, 62, Y(10));
      for (let y = Y(16); y < Y(298); y++) for (let x = X(452); x < X(522); x++) if (dither(x, y, 0.22 * (1 - (y - Y(16)) / 400))) Rraw(c, lit("#E8DDB8"), x, y, 1, 1);
      for (const lx of [462, 510]) R(c, W.outline, X(lx), Y(16), 4, 282);
      for (let y = Y(30); y < Y(296); y += 18) R(c, W.light, X(466), y, 44, 3);
      // the cargo: one crate per landing today (at most twelve), and the barrels that are always aboard
      const n = Math.min(12, (S.counts || {}).landed || 0);
      const spots = [[392, 262], [430, 262], [530, 262], [568, 262], [392, 226], [568, 226], [411, 190], [549, 190], [430, 226], [530, 226], [606, 262], [606, 226]];
      for (let i = 0; i < n; i++) bigCrate(c, X(spots[i][0]), Y(spots[i][1]), 4);
      bigBarrel(c, X(588), Y(258), 4);
      if (n < 3) bigBarrel(c, X(398), Y(258), 4);
      glow(c, X(487), Y(80), 40, lit("#E8DDB8"), 0.15);
    },
    "crows-nest"(c, g, S) {
      const W = S.palette.scene.wood, { ox, oy } = g, X = v => ox + v, Y = v => oy + v;
      openSky(c, g, S, oy + 300);
      // the topmast, a yard with one lantern per ship (lit while it reports, dark when it is silent)
      R(c, W.outline, X(495), 0, 12, g.H); R(c, W.mast, X(496), 0, 10, g.H); R(c, W.mast_dark, X(503), 0, 3, g.H);
      R(c, W.outline, X(392), Y(86), 230, 7); R(c, W.mast, X(393), Y(87), 228, 5);
      const ms = (S.machines || []).slice(0, 6), step = ms.length > 1 ? Math.min(44, Math.floor(200 / (ms.length - 1))) : 0, x0 = 502 - ((ms.length - 1) * step) / 2;
      ms.forEach((m, i) => {
        const x = X(Math.round(x0 + i * step)), out = m.pip === "silent";
        R(c, "#2A1A12", x + 2, Y(93), 1, 12);
        if (!out) glow(c, x + 4, Y(116), 18, lit("#E8B860"), g.night ? 0.5 : 0.25);
        drawSprite(c, S, out ? "lantern_dark" : "lantern_lit", x - 1, Y(105), { scale: 2, lit: out });
      });
      // the nest: a basket of planks round the mast
      R(c, W.outline, X(404), Y(262), 196, 4); R(c, W.trim, X(404), Y(262), 196, 1);
      planks(c, W, X(408), Y(266), X(596), g.H, 6, [W.light, W.mid]);
      R(c, W.outline, X(404), Y(266), 4, g.H - Y(266)); R(c, W.outline, X(596), Y(266), 4, g.H - Y(266));
      drawSprite(c, S, "crow_perch", X(586), Y(70), { lit: false });
      // a spyglass leaning on the rim
      for (let i = 0; i < 30; i++) R(c, i < 10 ? "#6A727C" : "#A8B0BA", X(560 + i), Y(250 - Math.floor(i / 2)), 2, 3);
    },
    logbook(c, g, S) {
      const W = S.palette.scene.wood, { ox, oy } = g, X = v => ox + v, Y = v => oy + v;
      interior(c, g, W);
      // the ship's bell on its bracket
      R(c, W.outline, X(540), Y(76), 50, 6); R(c, W.light, X(541), Y(77), 48, 3); R(c, W.outline, X(586), Y(76), 6, 30);
      drawSprite(c, S, "bell", X(546), Y(82), { scale: 3, lit: true });
      // the desk, the open log, a quill and its inkwell, a candle
      const ty = Y(240);
      R(c, W.outline, X(398), ty, 224, 7); R(c, W.light, X(399), ty + 1, 222, 3);
      R(c, W.outline, X(404), ty + 7, 210, 52); R(c, W.mid, X(405), ty + 8, 208, 50); R(c, W.dark, X(500), ty + 12, 18, 6);
      R(c, "#2A1A12", X(432), ty - 4, 138, 4);
      R(c, "#E6DCC4", X(436), ty - 30, 64, 27); R(c, "#D8CCB0", X(502), ty - 30, 64, 27); R(c, "#968A70", X(500), ty - 31, 2, 28);
      for (let y = 0; y < 6; y++) { R(c, "#7A6A4C", X(442), ty - 25 + y * 4, 52 - (y % 3) * 7, 1); R(c, "#7A6A4C", X(508), ty - 25 + y * 4, 50 - ((y + 1) % 3) * 9, 1); }
      R(c, "#14100C", X(584), ty - 10, 10, 10); R(c, "#2A2A30", X(585), ty - 9, 8, 8);
      for (let i = 0; i < 24; i++) R(c, i < 4 ? "#2A2A30" : "#E6DCC4", X(588 - Math.floor(i / 2)), ty - 12 - i, i > 8 ? 3 : 1, 1);
      R(c, "#E6DCC4", X(416), ty - 16, 6, 16); R(c, "#F4EEDC", X(418), ty - 20, 2, 4);
      glow(c, X(419), ty - 20, 40, lit("#E8B860"), g.night ? 0.6 : 0.3);
      hangLamp(c, g, S, X(470), Y(70));
    },
  };
  function paintRoom(ctx, S, frame) {
    const g0 = scenery(S, frame), phone = S.layout === "phone";
    const room = ROOMS[S.room] ? S.room : "plan";
    // The phone's banner shows a crop of the TV room round its focal piece.
    const g = phone ? Object.assign({}, g0, { W: 640, H: 360, ox: 0, oy: 0, phone: false }) : g0;
    const key = [room, g.W, g.H, g.ox, g.oy, g.tod, S.mode, (S.machines || []).map(m => m.pip).join(), (S.counts || {}).landed || 0].join("|");
    const L = layer("room:" + room, g.W, g.H);
    if (L.key !== key) { L.key = key; L.ctx.clearRect(0, 0, g.W, g.H); ROOMS[room](L.ctx, g, S); }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, S.w, S.h);
    if (!phone) { ctx.drawImage(L.cv, 0, 0); return null; }
    const [fx, fy] = ROOM_FOCUS[room], sx = Math.max(0, Math.min(640 - S.w, Math.round(fx - S.w / 2))), sy = Math.max(0, Math.min(360 - S.h, Math.round(fy - S.h / 2)));
    ctx.drawImage(L.cv, sx, sy, S.w, S.h, 0, 0, S.w, S.h);
    return null;
  }

  // ---- the whole scene -------------------------------------------------------------------------------
  function paint(ctx, S, frame) {
    if (S.screen === "deck") return paintRoom(ctx, S, frame);
    const g = scenery(S, frame), A = frame.ambient && frame.ambient.on ? frame.ambient : null, { W, H } = g;
    const tok = tokOf(A), rev = frame.rev == null ? ++autoRev : frame.rev;
    // The burn-in drift moves the horizon one row now and then (the still scene's horizon stays put).
    if (A && !g.phone && S.screen !== "anchor" && S.drift) g.hz += S.drift.y;
    const L = g.loading ? null : shipLayout(S);
    if (L) L.dark = S.lost || S.screen === "anchor";
    // The roadstead raises the horizon so the escorts lie on it, behind and right of the flagship (section 21).
    if (L && L.hz != null && S.screen !== "anchor") g.hz = L.hz + (A && S.drift ? S.drift.y : 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    // Sky (cached), the clouds drifting on the wall clock, the storm's flashes.
    const sky = layer("sky", W, H), skyKey = [rev, g.hz, W, H, A ? 1 : 0].join();
    if (sky.key !== skyKey) { sky.key = skyKey; g.isles = placeIslands(g, L); drawSky(sky.ctx, g, !A); }
    ctx.drawImage(sky.cv, 0, 0, W, g.hz, 0, 0, W, g.hz);
    if (A && S.screen !== "anchor") {
      const cl = layer("cloud", W * 2, g.hz), clKey = [rev, g.hz, W].join();
      if (cl.key !== clKey) { cl.key = clKey; cl.ctx.clearRect(0, 0, cl.cv.width, cl.cv.height); drawClouds(cl.ctx, g, 0); drawClouds(cl.ctx, g, W); }
      const o = Math.floor((Date.now() / 60000) * tok.burn_in.cloud_px_per_min) % W;
      ctx.drawImage(cl.cv, o, 0, W, g.hz, 0, 0, W, g.hz);
    }
    drawFlash(ctx, g, frame);

    // Horizon and sea.
    const sea = drawSea(g, A, rev, sky, L);
    ctx.drawImage(sea.cv, 0, sea.y0);
    if (g.loading) return null;

    // The ship, floating.
    const liveStep = frame.live ? Math.floor(g.now / 100) : 0;
    const animatedSet = frame.animated && frame.animated.size > 0, idleStep = animatedSet ? Math.floor(g.now / 500) : 0;
    const { ship, box } = shipLayer(g, L, frame, rev, A, liveStep, idleStep);
    const pose = A ? shipPose(g, A, tok) : null;
    paint.pose = pose; // the last pose, for a look at the float (#ambient=stats)
    g.ambient = !!A;
    const lh = drawWorldBehind(ctx, g, L);
    if (L.escorts.length || L.convoy || L.bigs.length) drawEscorts(ctx, g, L, rev, A);
    // Full-scale escorts (the open sea, three ships or fewer): each in its own layers. Further off, they float as the
    // half-scale escorts do: one whole pixel up or down on their own phase, in one blit, with the sea's own rows over the
    // keel (a flat waterline), so two more ships cost two blits a frame.
    for (const X of L.bigs) {
      const lay = shipLayer(g, X, frame, rev, A, liveStep, idleStep, "big" + X.slot), b = lay.box;
      const dy = A ? Math.round(Math.max(-1, Math.min(1, 0.8 * (A.amp || 0) * Math.sin(TAU * (A.phase / 6.1) + X.slot * 1.7)))) : 0;
      ctx.drawImage(lay.ship.cv, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, b.x0, b.y0 + dy, b.x1 - b.x0, b.y1 - b.y0);
      if (A) { const x0 = Math.max(0, X.x0 - 4), x1 = Math.min(g.W, X.x1 + X.bowsprit + 14), y = X.water + 2, hh = Math.min(g.H, X.water + 12) - y;
        if (hh > 0 && x1 > x0) ctx.drawImage(sea.cv, x0, y - sea.y0, x1 - x0, hh, x0, y, x1 - x0, hh); }
    }
    blitShip(ctx, g, L, ship, box, pose);
    if (A) frontWater(ctx, g, L, sea, A);
    drawWorldFront(ctx, g, L, lh);

    // Weather and fog over everything.
    const over = layer("over", W, H), overKey = [rev, g.hz, W, H, liveStep].join();
    if (over.key !== overKey) { over.key = overKey; drawOver(over.ctx, g, L, frame); }
    ctx.drawImage(over.cv, 0, 0);
    return L;
  }

  // Where the core puts the hull plates and starts the crow's flight; the spots a move into the ship centres on (the ship,
  // and each place's part of it), the ship's own door; and on a plan, each place's compartment and door plate.
  function layout(S) {
    if (S.screen === "deck") return S.room === "plan" ? { doors: PLAN } : {};
    const L = shipLayout(S), out = { machines: {}, mast: null }, ox = S.ox || 0, oy = S.oy || 0;
    // Hull plates: the flagship's under its hull; an escort's under it in the near row, over its masthead in the far row
    // (the core lays each row out so no two plates touch); the convoy's count plate over it.
    for (const sec of L.sections) out.machines[sec.m.id] = { x: Math.round((sec.x0 + sec.x1) / 2) - ox, y: L.deck + 5 - oy, role: "flagship", row: "hull",
      x0: L.x0 - ox, x1: L.x1 + L.bowsprit - ox };
    // A full-scale escort's plate is under its hull like the flagship's (the hull row); it says its own below-decks count.
    for (const X of L.bigs) for (const sec of X.sections) out.machines[sec.m.id] = { x: Math.round((sec.x0 + sec.x1) / 2) - ox, y: X.deck + 5 - oy, role: "escort", row: "hull", full: true,
      x0: X.x0 - ox, x1: X.x1 + X.bowsprit - ox };
    out.onDeck = [...L.sections.flatMap(sec => sec.crew.map(c => c.id)), ...L.bigs.flatMap(X => X.crew.map(c => c.id)), ...L.escorts.flatMap(E => E.crew.map(c => c.id))];
    out.below = Object.fromEntries([...L.sections.map(sec => [sec.m.id, sec.below || 0]), ...L.bigs.map(X => [X.id, X.below]), ...L.escorts.map(E => [E.id, E.below])]);
    for (const E of L.escorts) out.machines[E.id] = { x: E.mastX - ox, y: (E.near ? E.water + 4 : E.top - 32) - oy, role: "escort", row: E.near ? "below" : "above" };
    if (L.convoy) out.convoy = { x: Math.round((L.convoy.x0 + L.convoy.x1) / 2) - ox, y: L.convoy.water - ESC.far + ESC.near + 4 - oy, row: "below" };
    // The roadstead's extent, and where a plate under it may start: past the flagship's crew (its bow may be covered).
    const crewEnd = Math.max(L.x0 + 30, ...L.sections.map(sec => sec.x1));
    const road = [...L.escorts, ...L.bigs];
    out.roadstead = L.fleet ? { x0: Math.min(...road.map(e => e.sx0), L.convoy ? L.convoy.x0 : Infinity) - ox, x1: Math.max(L.convoy ? L.convoy.x1 : -Infinity, ...road.map(e => e.sx1)) - ox,
      below_x0: Math.min(crewEnd + 2, ...road.map(e => e.sx0), L.convoy ? L.convoy.x0 : Infinity) - ox } : null;
    if (L.masts[0]) out.start = { x: L.masts[0].x - ox, y: L.masts[0].top - 10 - oy };
    const top = L.masts.length ? Math.min(...L.masts.map(m => m.top)) : L.deck - 60, mid = Math.round((L.x0 + L.x1) / 2), main = L.main || { x: mid, top };
    const at = (x, y) => ({ x: x - ox, y: y - oy });
    out.spots = { ship: at(mid, Math.round((top + L.water) / 2)), bridge: at(L.x0 + 12, L.deck - 12), "chart-room": at(L.x0 + 14, L.deck + 9), "gun-deck": at(mid, L.deck + 12),
      "cargo-hold": at(mid, L.water - 3), logbook: at(L.x1 - 6, L.deck - 6), "crows-nest": at(main.x, main.top + 4) };
    for (const E of L.escorts) out.spots["ship:" + E.id] = at(E.mastX, Math.round((E.top + E.water) / 2));
    for (const X of L.bigs) out.spots["ship:" + X.id] = at(Math.round((X.x0 + X.x1) / 2), Math.round((X.top + X.water) / 2));
    out.ship = { x: L.x0 - 8 - ox, y: top - 10 - oy, w: L.x1 - L.x0 + 26, h: L.deck - top + 10 };
    out.hits = hits(S, L);
    return out;
  }
  // The other things on the stage a viewer can open, in stage art px (the core makes each a door with a caption): the
  // lighthouse, each yard's perched gulls, and a longboat or whale while it is on the sea (i: its index in world.events).
  function hits(S, L) {
    if (S.layout === "phone" || S.screen !== "board" || !S.world) return [];
    const ox = S.ox || 0, oy = S.oy || 0, hz = L.hz != null ? L.hz : oy + 146, g = { W: S.w, ox, hz, phone: false };
    const lx = Math.min(S.w - 9, ox + 628), lh = { x: lx + 2 }, out = [];
    // in the order a viewer reads them, left to right: the escorts, the convoy, then the lighthouse at the far edge
    const doors = [...L.bigs.map(X => ({ kind: "escort", machine: X.id, x: X.x0 - 6 - ox, y: X.top - 10 - oy, w: X.x1 + X.bowsprit - X.x0 + 12, h: X.water - X.top + 14, at: X.x0 })),
      ...L.escorts.map(E => ({ kind: "escort", machine: E.id, x: E.x0 - 4 - ox, y: E.top - 4 - oy, w: E.x1 - E.x0 + 12, h: E.water - E.top + 7, at: E.x0 }))].sort((a, b) => a.at - b.at);
    for (const d of doors) { delete d.at; out.push(d); }
    if (L.convoy) out.push({ kind: "convoy", x: L.convoy.x0 - 2 - ox, y: L.convoy.water - 16 - oy, w: L.convoy.x1 - L.convoy.x0 + 4, h: 20 });
    out.push({ kind: "lighthouse", on: !!S.world.host, x: lx - 4 - ox, y: hz + 1 - 14 - 7 - oy, w: 12, h: 24 });
    for (const X of [L, ...L.bigs]) for (const m of X.masts) {
      if (!m.machine || !m.gulls || !gullsPerched(S, X, m.machine)) continue;
      const ya = m.top + X.sailY, half = Math.round(m.sail.w1 / 2);
      out.push({ kind: "gulls", machine: m.machine, x: m.x - half - ox, y: ya - 9 - oy, w: 2 * half, h: 10 });
    }
    (S.world.events || []).forEach((ev, i) => {
      if (ev.kind === "whale") { const x = whaleAt(g, L, lh); out.push({ kind: "whale", i, x: x - 14 - ox, y: hz - 16 - oy, w: 30, h: 19 }); }
      if (ev.kind === "landing") {
        const P = boatPath(g, L, lh), x0 = Math.min(P.sx, P.ex) - 3, x1 = Math.max(P.sx, P.ex) + 26, y0 = Math.min(P.sy, P.ey) - 12, y1 = Math.max(P.sy, P.ey) + 4;
        out.push({ kind: "landing", i, x: x0 - ox, y: y0 - oy, w: x1 - x0, h: y1 - y0 });
      }
    });
    return out;
  }

  // One ship at half scale for the phone's convoy strip (section 21): the same escort art on a strip of its own sea, with
  // its weather and fog; id "@convoy" draws the convoy's silhouettes. Still: the strip never animates.
  function mini(ctx, S, id) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const S2 = Object.assign({}, S, { w, h, layout: "tv", screen: S.screen === "anchor" ? "anchor" : "board", ox: 0, oy: 0 });
    const g = scenery(S2, { now: 0 });
    g.hz = h - 18;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    bands(ctx, 0, 0, w, g.hz, g.sky);
    bands(ctx, 0, g.hz, w, h - g.hz, g.sea);
    if (id === "@convoy") { const F = fleetOf(S); drawConvoy(ctx, g, { x0: Math.round(w / 2) - 13, x1: Math.round(w / 2) + 13, water: h - 8, n: F.convoy ? F.convoy.n : 0 }); return true; }
    const sh = fleetOf(S).ships.find(x => x.id === id) || ((S.machines || []).some(m => m.id === id) ? { id, slot: 0, berth: "sea", m: S.machines.find(m => m.id === id) } : null);
    if (!sh) return false;
    const E = escortLayout(S2, sh, Math.round(w / 2) - 4, h - 11, h - 8, false, S.screen === "anchor");
    drawEscort(ctx, g, E, S.lost);
    if (E.weather === "rain" || E.weather === "squall" || E.weather === "storm") {
      cloud(ctx, E.mastX, E.top - 7, E.weather !== "rain" ? 26 : 20, 4, (E.weather !== "rain" || g.night ? ["#2A3048", "#20263A", "#181C2E"] : ["#6A6E7C", "#4E525E", "#3A3E48"]).map(snap), rng(E.mastX));
      rain(ctx, E.mastX - 9, E.top - 5, 18, Math.max(6, E.deck - E.top - 1), snap((g.pal.rain || {})[g.night ? "night" : "day"] || "#8A94A8"), E.mastX + 1, E.weather !== "rain");
    }
    if (E.silent || S.lost) fogZone(ctx, { x0: 0, x1: w, y0: 0, y1: h, d: 0.5 }, g.fogCol, w);
    return true;
  }

  // Which crew members play their work loop now (section 10). Never at night, under still or with no host.
  function animated(S, level) {
    if (level === "still" || S.mode !== "day" || S.screen !== "board" || S.lost) return new Set();
    const busy = S.crew.filter(c => (c.state === "moving" || c.state === "regressed") && !c.stale && c.changed_s != null);
    const win = level === "full" ? (S.idle || {}).window_s || 600 : (S.idle || {}).calm_burst_s || 4;
    return new Set(busy.filter(c => c.changed_s <= win).slice(0, (S.idle || {}).max_sprites || 6).map(c => c.id));
  }

  // The voyage chart in the bar: islands passed today (landed) and ahead (queued), our ship between.
  function chart(ctx, w, h, d) {
    ctx.clearRect(0, 0, w, h);
    const p = d.palette, night = d.mode !== "day", y = Math.round(h / 2) + 2, shipX = Math.round(w * 0.62);
    for (let x = 2; x < w - 2; x++) if (x < shipX ? x % 2 === 0 : x % 4 < 2) { ctx.fillStyle = x < shipX ? p.ink2 : p.fog; ctx.fillRect(x, y, 1, 1); }
    const island = (cx, col, flag) => {
      ["..####..", ".######.", "########"].forEach((r, j) => [...r].forEach((c, i) => { if (c === "#") { ctx.fillStyle = col; ctx.fillRect(cx - 4 + i, y - 2 + j, 1, 1); } }));
      if (flag) { ctx.fillStyle = p.ink2; ctx.fillRect(cx, y - 8, 1, 6); ctx.fillStyle = flag; ctx.fillRect(cx + 1, y - 8, 3, 2); }
    };
    const span = Math.max(1, d.now - d.dayStart);
    for (const at of d.landed) island(Math.round(4 + Math.max(0, Math.min(1, (at - d.dayStart) / span)) * (shipX - 14)), night ? "#4A5040" : "#6E7A5A", p.done);
    const n = d.ahead.length;
    d.ahead.slice(0, 6).forEach((k, i) => {
      const cx = Math.round(shipX + 14 + (i * (w - shipX - 20)) / Math.max(1, Math.min(6, n) - 1));
      island(cx, night ? "#30343C" : "#4A505C", k === "held" ? p.fog : null);
      if (k === "gate") { ctx.fillStyle = p.ink2; ctx.fillRect(cx - 1, y - 9, 3, 7); ctx.fillStyle = p.ink; ctx.fillRect(cx - 1, y - 10, 3, 1); }
    });
    ["...#....", "..##....", ".###....", "####....", "...#....", "########", ".######."].forEach((r, j) => [...r].forEach((c, i) => {
      if (c === "#") { ctx.fillStyle = j < 5 ? p.ink : (night ? "#5A4A3A" : "#8A6440"); ctx.fillRect(shipX - 4 + i, y - 6 + j, 1, 1); }
    }));
  }

  window.WeatherdeckTheme.register("ship-deck", { paint, animated, layout, chart, describe, mini, ambient: true, lastPose: () => paint.pose });
})();
