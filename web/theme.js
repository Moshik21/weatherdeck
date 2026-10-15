"use strict";
/* Theme loader (docs/theme-spec.md section 2). A theme is a folder under themes/: tokens.json, plus
   the fonts, glyphs, sprites and scene module it names. The loader merges the chain (the theme over
   its parent, ending at default), keeps the core keys from default, loads the faces, and writes the
   tokens as custom properties. Nothing here knows any particular theme. */

/* A theme with art registers its scene module here (section 12). */
window.WeatherdeckTheme = window.WeatherdeckTheme || { modules: {}, register(id, mod) { this.modules[id] = mod; } };

const THEME = { T: null, id: null, loading: null, warned: {} };
const CORE_KEYS = [["color", "status"], ["color", "ink"], ["glyphs", "states"], ["glyphs", "pips"]]; // status never themes (rule 6)
const COLOR_ROLES = { status: ["needs", "trouble", "moving", "done"], ink: ["ink", "ink2", "fog", "clock"] };

function warnOnce(key, ...msg) {
  if (THEME.warned[key]) return;
  THEME.warned[key] = true;
  console.warn("theme:", ...msg);
}
function mergeInto(base, over) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) mergeInto(base[k], v);
    else base[k] = v;
  }
  return base;
}
const clone = v => JSON.parse(JSON.stringify(v));
const pick = (o, path) => path.reduce((x, k) => (x == null ? x : x[k]), o);
async function getJSON(url) {
  if (window.weatherdeckDemo && window.weatherdeckDemo.files[url]) return clone(window.weatherdeckDemo.files[url]); // the static demo has no host to ask
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + ": HTTP " + r.status);
  return r.json();
}
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src + " did not load"));
    document.head.append(s);
  });
}

/* Load and resolve a theme. Falls back to default (logged) if anything in the chain fails. */
async function loadTheme(name) {
  try { return await resolveTheme(name || "default"); }
  catch (e) {
    console.error("theme:", name, "failed, using default:", e);
    if (name && name !== "default") return resolveTheme("default");
    throw e;
  }
}
async function resolveTheme(name) {
  const docs = [], seen = new Set();
  for (let id = name; id; ) {
    if (seen.has(id) || !/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw new Error("bad theme chain at " + id);
    seen.add(id);
    const doc = await getJSON("themes/" + id + "/tokens.json");
    docs.push(doc);
    id = doc.extends || (id === "default" ? null : "default");
  }
  const core = docs[docs.length - 1];
  const T = {};
  for (const doc of docs.slice().reverse()) {
    const d = clone(doc);
    for (const f of d.fonts || []) f._dir = doc.id;
    if (d.sprites) d.sprites._dir = doc.id;
    if (d !== core && doc.id !== "default") {
      for (const path of CORE_KEYS) {
        if (pick(d, path) !== undefined) {
          warnOnce("core:" + doc.id + path.join("."), doc.id, "sets", path.join("."), "which is core: ignored");
          const parent = pick(d, path.slice(0, -1));
          if (parent) delete parent[path[path.length - 1]];
        }
      }
    }
    // Fonts are per theme: a child's list replaces its parent's (arrays replace).
    mergeInto(T, d);
  }
  T.chain = docs.map(d => d.id);
  const glyphFile = (core.glyphs && core.glyphs.file) || "glyphs.json";
  T.glyphSet = await getJSON("themes/" + core.id + "/" + glyphFile);
  T.spriteSet = null;
  if (T.sprites && T.sprites.file) {
    try { T.spriteSet = await getJSON("themes/" + T.sprites._dir + "/" + T.sprites.file); }
    catch (e) { console.error("theme: sprites", e); }
  }
  await loadFaces(T);
  T.scene = null;
  const mod = T.sprites && T.sprites.scene_module;
  if (mod && mod.file) {
    try {
      if (!window.WeatherdeckTheme.modules[T.id]) await loadScript("themes/" + T.sprites._dir + "/" + mod.file);
      T.scene = window.WeatherdeckTheme.modules[T.id] || null;
      if (!T.scene) console.error("theme: " + mod.file + " did not register " + T.id);
    } catch (e) { console.error("theme: scene module", e); }
  }
  return T;
}
/* Self-hosted faces: FontFace with display block, then wait for every role face (2 s at most). */
async function loadFaces(T) {
  const fonts = T.fonts || [];
  if (!fonts.length || !document.fonts || typeof FontFace !== "function") return;
  const loads = [];
  for (const f of fonts) {
    if (f.format !== "woff2") continue;
    try {
      const face = new FontFace(f.family, "url(themes/" + f._dir + "/" + f.file + ") format(\"woff2\")",
        { weight: f.weight || "400", style: f.style || "normal", display: ((T.faces || {}).load || {}).font_display || "block" });
      document.fonts.add(face);
      loads.push(face.load().catch(e => console.error("theme: font", f.family, e)));
    } catch (e) { console.error("theme: font", f.family, e); }
  }
  const budget = ((T.faces || {}).load || {}).block_budget_ms || 2000;
  await Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, budget))]);
}

/* ---------- tokens as custom properties ---------- */
const kebab = s => s.replace(/_/g, "-");
const stack = list => (list || []).map(f => (/^[a-z-]+$/.test(f) && !/\s/.test(f) ? f : JSON.stringify(f))).join(", ");
/* The colour table for a mode: status and ink from the core, the theme's surfaces. Day under
   theme.oled_safe takes the night call plate, so no large light block sits on the panel for hours. */
function colours(T, mode, oled) {
  const c = T.color, out = {};
  Object.assign(out, c.status[mode] || c.status.day, c.ink[mode] || c.ink.day, (c.surface || {})[mode] || c.surface.day);
  if (!out.clock) out.clock = out.ink2;
  if (oled && mode === "day") for (const k of ["call", "call_edge", "call_ink", "call_ink2", "call_band", "call_band_ink"]) out[k] = c.surface.night[k];
  return out;
}
/* Type sizes per role in CSS px for a geometry (section 5): art px on the TV, the phone rules below. */
function typeSizes(T, g) {
  const out = {};
  for (const [role, r] of Object.entries(T.type.roles)) {
    let size, line;
    if (!g.phone) { size = r.size_ap * g.ap; line = r.line_ap * g.ap; }
    else {
      const ph = r.phone || { css_px: r.size_ap * 2, line_css_px: r.line_ap * 2 };
      if (r.face === "pixel") {
        // Whole device px per font px: 14.667 CSS px at DPR 3 for a label, 18.333 for label_lg.
        const fp = Math.ceil((role === "label_lg" ? 17.5 : 14) * g.dpr / 11);
        size = 11 * fp / g.dpr;
      } else if (r.face === "numeral") {
        const n = Math.max(1, Math.round(ph.css_px * g.dpr / 27));
        size = 27 * n / g.dpr;
      } else size = Math.max(T.type.phone_floor_css_px || 15, ph.css_px);
      line = ph.line_css_px * size / ph.css_px;
    }
    out[role] = { size, line, weight: r.weight, face: r.face };
  }
  return out;
}
function applyTokens(T, mode, g, opts) {
  const root = document.documentElement, set = (k, v) => root.style.setProperty(k, v);
  const col = colours(T, mode, opts.oled);
  if (opts.background && T.id === "default") col.ground = opts.background;
  for (const [k, v] of Object.entries(col)) set("--c-" + kebab(k), v);
  set("--ap", g.ap + "px");
  for (const n of T.space.steps_ap) set("--sp-" + n, n * g.ap + "px");
  for (const [k, n] of Object.entries(T.space.roles_ap)) set("--sp-" + kebab(k), n * g.ap + "px");
  for (const [role, s] of Object.entries(typeSizes(T, g))) {
    set("--t-" + kebab(role) + "-size", s.size + "px");
    set("--t-" + kebab(role) + "-line", s.line + "px");
    set("--t-" + kebab(role) + "-weight", String(s.weight));
  }
  set("--f-pixel", stack(T.faces.pixel));
  set("--f-numeral", stack(T.faces.numeral));
  set("--f-data", stack(T.faces.data));
  const adj = T.faces.adjust || {};
  for (const f of ["pixel", "numeral", "data"]) set("--fa-" + f, adj[f] || "none");
  // The call's frame from its token list ("call_band_ink 1", ...): nested 1-ap-step inset rings.
  const frame = (((T.components || {}).call || {}).frame || ["call_edge 2"]).map(f => f.split(" "));
  let width = 0;
  set("--call-frame", frame.map(([role, n]) => { width += Number(n); return "inset 0 0 0 " + width * g.ap + "px " + (col[role] || "transparent"); }).join(", "));
  set("--call-frame-w", width * g.ap + "px");
  set("--gp", g.phone ? "1px" : g.ap + "px");
  const plate = (T.components || {}).plate || {};
  set("--notch", (plate.notch_ap || 0) * g.ap + "px");
  set("--bevel", (plate.bevel_ap ?? 1) * g.ap + "px");
  root.dataset.theme = T.id;
  root.dataset.mode = mode;
  if (T.grid.pixelated) root.dataset.pixelated = ""; else delete root.dataset.pixelated;
  return col;
}

/* Theme words sit under the user's own labels: config always wins (section 9.11). */
function themeLabels(T, labels, setKeys) {
  const out = Object.assign({}, labels), mine = new Set(setKeys || []);
  for (const [k, v] of Object.entries(T.words || {})) {
    if (k.startsWith("$") || mine.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/* ---------- glyphs and sprites as small canvases ---------- */
/* One canvas px per art px; CSS scales it by whole device px (image-rendering: pixelated). */
function drawRows(ctx, rows, x0, y0, colourOf, outline) {
  const w = rows[0].length, h = rows.length;
  const filled = (i, j) => j >= 0 && j < h && i >= 0 && i < w && rows[j][i] !== ".";
  if (outline) {
    ctx.fillStyle = outline;
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
      if (filled(i, j)) continue;
      if (filled(i + 1, j) || filled(i - 1, j) || filled(i, j + 1) || filled(i, j - 1)) ctx.fillRect(x0 + i, y0 + j, 1, 1);
    }
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = rows[j][i];
    if (ch === ".") continue;
    const c = colourOf(ch, i, j);
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(x0 + i, y0 + j, 1, 1);
  }
}
/* A state glyph or machine pip. '#' takes the slot colour, 'k' the glyph ink. dither: the stale
   form, the slot colour on alternate pixels (a 2 x 2 Bayer step). */
function glyphCanvas(T, col, name, slot, opts) {
  opts = opts || {};
  const set = T.glyphSet, rows = (set.glyphs || {})[name] || (set.pips || {})[name] || set.glyphs.silent;
  const c = document.createElement("canvas");
  c.width = rows[0].length; c.height = rows.length;
  c.className = "px " + (set.pips && set.pips[name] ? "pip" : "glyph") + (opts.cls ? " " + opts.cls : "");
  c.setAttribute("aria-hidden", "true");
  const colour = col[slot] || slot;
  c.dataset.key = name + ":" + colour + (opts.dither ? ":d" : "");
  drawRows(c.getContext("2d"), rows, 0, 0, (ch, i, j) => (ch === "k" ? (opts.ink || col.glyph_ink) : opts.dither && (i + j) % 2 ? null : colour));
  return c;
}
/* A theme sprite: palette characters map to color.scene token paths ("wood.dark"). */
function spriteColour(T, path, mode) {
  const p = path.replace("{mode}", mode === "day" ? "day" : "night").split(".");
  let v = (T.color || {}).scene;
  for (const k of p) v = v == null ? v : v[k];
  if (v && typeof v === "object") v = v[mode === "day" ? "day" : "night"];
  return typeof v === "string" && v.startsWith("status.") ? null : v;
}
function spriteCanvas(T, name, mode, scale, opts) {
  const sp = T.spriteSet && T.spriteSet.sprites[name];
  if (!sp) return null;
  const c = document.createElement("canvas"), pad = sp.outline ? 1 : 0;
  c.width = sp.rows[0].length + 2 * pad; c.height = sp.rows.length + 2 * pad;
  c.className = "px sprite s-" + name + (opts && opts.cls ? " " + opts.cls : "");
  c.setAttribute("aria-hidden", "true");
  c.dataset.key = name + ":" + mode + ":" + scale;
  c.style.setProperty("--sw", String(c.width * (scale || 1)));
  c.style.setProperty("--sh", String(c.height * (scale || 1)));
  const outline = sp.outline ? spriteColour(T, sp.outline, mode) : null;
  drawRows(c.getContext("2d"), sp.rows, pad, pad, ch => spriteColour(T, sp.palette[ch] || "", mode), outline);
  return c;
}
