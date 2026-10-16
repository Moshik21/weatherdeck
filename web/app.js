"use strict";
/* Weatherdeck page. Plain JavaScript, no framework, no network except GET api/view, healthz and the
   theme's own files on the host that served it. This file runs the page: the art-pixel geometry,
   the render loop, the few motions the board allows (announce once, then rest), polling, the
   reduced-motion and burn-in rules, and the preview controls. */

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const boardEl = document.getElementById("board");
const sceneCv = document.getElementById("scene");
const flyCv = document.getElementById("flight");
S.theme = null; S.mode = "day"; S.geom = null; S.board = null; S.logTight = 0; S.logFold = 0; S.logSig = "";
S.anim = { call: false, flying: false, strike: false };
S.ev = { call: null, storm: null, lost: null, hoist: null, anchor: null, wake: null, strike: null, fog: {}, wx: {} };
S.prev = null;

/* ---------- geometry: one art pixel is a whole number of device pixels (section 3) ---------- */
function geometry() {
  const dpr = window.devicePixelRatio || 1;
  const W = document.documentElement.clientWidth, H = window.innerHeight - (window.weatherdeckDemo ? window.weatherdeckDemo.band() : 0);
  const phone = W < ((S.theme && S.theme.grid.phone_breakpoint_css) || 700);
  if (phone) {
    const apDev = Math.max(2, Math.round(2 * dpr));
    return { dpr, W, H, phone, ap: apDev / dpr, apDev, AW: Math.ceil(W / (apDev / dpr)), AH: (((S.theme.zones || {}).phone || {}).banner || {}).h_ap || 64, ox: 0, oy: 0 };
  }
  const wDev = Math.round(W * dpr), hDev = Math.round(H * dpr);
  const apDev = stageScale(wDev / 640, hDev / 360);
  const ap = apDev / dpr;
  // The stage is centred on whole device pixels. The scene canvas behind it starts at or left of the
  // viewport edge so that its art px (ox, oy) is the stage's (0, 0).
  const offX = Math.floor((wDev - 640 * apDev) / 2), offY = Math.floor((hDev - 360 * apDev) / 2);
  const ox = Math.ceil(offX / apDev), oy = Math.ceil(offY / apDev);
  const cx = offX - ox * apDev, cy = offY - oy * apDev;
  return { dpr, W, H, phone, ap, apDev, ox, oy, left: offX / dpr, top: offY / dpr, sceneX: cx / dpr, sceneY: cy / dpr,
    AW: Math.ceil((wDev - cx) / apDev), AH: Math.ceil((hDev - cy) / apDev) };
}
/* Device px per art px. Whole device px keep the art crisp, and they are used whenever the stage then fills at least
   display.stage_min_fill (0.8) of the window's tighter side; between whole steps (a 1200 x 800 window, where whole px would
   leave a 640 x 360 stage in the middle) the stage scales to fit instead, in quarter device px. display.stage_scale
   "whole" or "fit" forces one rule. */
function stageScale(fx, fy) {
  const fit = Math.max(1, Math.min(fx, fy)), whole = Math.max(1, Math.floor(fit));
  const d = (S.server && cfg().display) || {}, mode = d.stage_scale || "auto", min = d.stage_min_fill ?? 0.8;
  if (mode === "whole" || (mode !== "fit" && whole / fit >= min)) return whole;
  return Math.max(1, Math.floor(fit * 4) / 4);
}
const motionLevel = () => (reducedMotion.matches ? "still" : S.dev.motion || cfg().theme.motion || "calm");

/* ---------- theme ---------- */
let wantedTheme = null, themeBusy = null;
function themeName() { return S.dev.theme || (S.server ? cfg().theme.name : null) || storedTheme() || "default"; }
function storedTheme() { try { return localStorage.getItem("weatherdeck.theme"); } catch (e) { return null; } }
async function ensureTheme() {
  const name = themeName();
  if (S.theme && S.theme.id === name && !themeBusy) return true;
  if (themeBusy && wantedTheme === name) return false;
  wantedTheme = name;
  themeBusy = loadTheme(name).then(T => {
    if (wantedTheme !== name) return;
    S.theme = T;
    GLYPHS = T.glyphs || GLYPHS;
    try { localStorage.setItem("weatherdeck.theme", T.id); } catch (e) { /* storage may be blocked */ }
    S.applied = null;
    if (S.server) {
      const accents = cfg().theme.accents || {};
      const bad = Object.keys(accents).filter(k => k !== "background");
      if (bad.length) warnOnce("accents", "theme.accents." + bad.join(", ") + " ignored: status colours never theme");
    }
  }).catch(e => console.error("theme:", e)).finally(() => { themeBusy = null; render(); });
  return false;
}

/* ---------- motion events: announce once, then rest (section 10) ---------- */
function detectEvents(B, g) {
  const now = performance.now(), still = motionLevel() === "still", P = S.prev;
  const at = still ? null : now;
  const calls = new Set((B.askCards || []).map(c => c.id)), crit = new Set((B.critical || []).map(c => c.id));
  const silent = new Set((B.machines || []).filter(m => m.pip === "silent").map(m => m.id));
  // Weather: a machine's tracked word (host's own verdict) changing between two feeds. Not tracked while the host is lost or down
  // (the scene keeps its last-known weather); no event at load, none in still motion (the cut).
  const wxNow = {};
  for (const m of B.machines || []) wxNow[m.id] = weatherTracked(m.key);
  const wxHeld = B.lost || B.hostdown;
  if (P && !wxHeld) { const ch = weatherChanges(P.wx, wxNow, still); for (const id in ch) S.ev.wx[id] = { at: now, from: ch[id].from, to: ch[id].to }; }
  if (P) {
    if ([...calls].some(id => !P.calls.has(id)) && !B.lost && !B.hostdown) { S.ev.call = at; if (at) startCrow(); }
    if ([...crit].some(id => !P.crit.has(id))) S.ev.storm = at;
    for (const id of silent) if (!P.silent.has(id)) S.ev.fog[id] = at;
    if (B.lost && !P.lost) S.ev.lost = at;
    if (B.hostdown && !P.hostdown) S.ev.hoist = at;
    if (B.anchor && !P.anchor) S.ev.anchor = at;
    if (!B.anchor && P.anchor) S.ev.wake = at;
    if (B.score && P.score != null && B.score.n > P.score) S.ev.landing = { at, from: P.score };
  } else {
    // First frame: what is already true is shown in its final state, except a waiting call, which
    // is announced once (the board was just switched on).
    if (calls.size && !B.lost && !B.hostdown && !still && g && !g.phone) { S.ev.call = now; startCrow(); }
    if (crit.size) S.ev.storm = at;
  }
  // Lanes that changed step or state, or reported, feed the scene's work loops (calm: a 4 s burst).
  for (const l of B.lanes || []) {
    const cur = (l.it.progress || {}).current || {};
    const sig = [l.kind, cur.step, (l.it.reported || {}).at, (l.it.last_event || {}).at].join("|");
    if (S.laneSig[l.id] != null && S.laneSig[l.id] !== sig) S.laneChanged[l.id] = nowS();
    S.laneSig[l.id] = sig;
  }
  S.prev = { wx: wxHeld && P ? P.wx : wxNow, calls, crit, silent, lost: !!B.lost, hostdown: !!B.hostdown, anchor: !!B.anchor, score: B.score ? B.score.n : null };
  const durs = (S.theme.motion || {}).durations_ms || {};
  S.anim.call = S.ev.call != null && now - S.ev.call < (durs.crow_flight || 600) + 400 + 1500;
}
/* An alert's one-shot motion is playing (world.js alertBusy): the scene's layers repaint at the frame rate. */
const animating = () => alertBusy();

/* A theme's arrival sprite flies from the scene (its layout's start point) to its mark on the call
   band: 6 frames of 100 ms (components.call.band.flight names the frames). */
let flyTimer = null;
const bandTokens = () => (((S.theme.components || {}).call || {}).band || {});
function startCrow() {
  const frames = bandTokens().flight || [];
  if (!S.theme || !S.theme.spriteSet || !frames.length || !frames.every(f => S.theme.spriteSet.sprites[f]) || S.geom.phone) return;
  S.anim.flying = true;
  clearInterval(flyTimer);
  const t0 = performance.now();
  flyTimer = setInterval(() => {
    const k = Math.min(6, Math.floor((performance.now() - t0) / 100));
    // A theme changed mid-flight (#theme=) may have no such sprite: the flight ends there.
    const perch = document.getElementById("band-mark"), anchors = S.anchors || {}, c = perch && spriteCanvas(S.theme, frames[k % frames.length], S.mode, 1);
    if (k >= 6 || !c) {
      clearInterval(flyTimer); S.anim.flying = false; flyCv.hidden = true; render(); return;
    }
    const g = S.geom, from = anchors.start || { x: 500, y: 40 };
    const pr = perch.getBoundingClientRect(), to = { x: (pr.right - g.left) / g.ap - 20, y: (pr.top - g.top) / g.ap - 4 };
    const f = (k + 1) / 6, x = Math.round(from.x + (to.x - from.x) * f), y = Math.round(from.y + (to.y - from.y) * f - Math.sin(f * Math.PI) * 14);
    flyCv.width = c.width; flyCv.height = c.height;
    flyCv.getContext("2d").drawImage(c, 0, 0);
    flyCv.style.setProperty("--x", String(x)); flyCv.style.setProperty("--y", String(y));
    flyCv.style.setProperty("--sw", String(c.width)); flyCv.style.setProperty("--sh", String(c.height));
    flyCv.hidden = false;
  }, 100);
}
/* The hailing plate's sprite strikes once per failed retry while the host is down (2 frames, 400 ms). */
function strike() {
  if (motionLevel() === "still") return;
  S.ev.strike = performance.now();
  S.anim.strike = true;
  setTimeout(() => { S.anim.strike = false; render(); }, 400);
}

/* ---------- burn-in drift (section 11) ---------- */
function drift(B, g) {
  if (g.phone) return { x: 0, y: 0 };
  const bi = S.theme.burn_in || {}, every = ((bi.drift || {}).every_s || 240);
  const step = Math.floor(Date.now() / 1000 / every);
  if (B.anchor) { // clockwise round a 16 x 8 box: 48 positions
    const [bw, bh] = ((bi.anchor_drift || {}).box_ap) || [16, 8], n = 2 * (bw + bh), i = step % n;
    if (i < bw) return { x: i, y: 0 };
    if (i < bw + bh) return { x: bw, y: i - bw };
    if (i < 2 * bw + bh) return { x: bw - (i - bw - bh), y: bh };
    return { x: 0, y: bh - (i - 2 * bw - bh) };
  }
  const path = (bi.drift || {}).path || [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
  const [x, y] = path[step % path.length];
  return { x, y };
}

/* Only touch an attribute that changes: an unchanged board makes no DOM mutation at all. */
const setHidden = (el, v) => { if (el.hidden !== v) el.hidden = v; };
const setVar = (el, k, v) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); };

/* ---------- the scene (section 12) ---------- */
let sceneKey = "", sceneRev = 0, deckKey = "", sceneTimer = null, sceneWarned = false;
function sceneData(B, g, dr) {
  const T = S.theme, crit = new Set((B.critical || []).map(c => c.machine).filter(Boolean));
  const weather = {};
  for (const m of B.machines || []) weather[m.id] = crit.has(m.id) ? "storm" : m.pip === "silent" && !m.resting && !m.asleep ? "fog" : m.key === "down" ? "squall" : m.key === "warn" ? "rain" : "clear";
  const now = nowS(), screen = B.loading ? "loading" : S.route.level !== "sea" && !B.empty ? "deck" : B.screen;
  // The open sea (model.js B.open): the scene window is the whole upper area, and the host's open shares lay out the ships.
  const open = !!B.open && screen === "board", zt = (T.zones || {}).tv || {}, win = ((open ? (zt.open || {}).scene : zt.scene) || {}).window || null;
  const road = B.fleet && B.fleet.roadstead ? B.fleet.roadstead[open ? "open" : "call"] : null;
  return {
    w: g.AW, h: g.AH, layout: g.phone && !g.page ? "phone" : "tv", ox: g.ox, oy: g.oy, tod: B.tod, mode: B.mode, minutes: minutesOf(now), open, window: win,
    screen, room: roomOf(S.route), ship: S.route.ship || null, storm: (B.critical || []).length > 0 && !B.hostdown, lost: !!B.lost, horizon: B.horizon || null,
    machines: (B.machines || []).map(m => ({ id: m.id, label: m.label, pip: m.pip, key: m.key, critical: m.critical, silent_s: m.silent_s, becalmed: !!m.becalmed, resting: !!m.resting, asleep: !!m.asleep })),
    fleet: B.fleet ? { ships: B.fleet.ships.map(x => ({ id: x.id, role: x.role, slot: x.slot, berth: x.berth })),
      convoy: B.fleet.convoy ? { n: B.fleet.convoy.n, worst: B.fleet.convoy.worst, stale: B.fleet.convoy.stale } : null, slots: road } : null,
    world: worldScene(B),
    crew: (B.lanes || []).map(l => ({ id: l.id, machine: l.machine, state: l.kind, tag: l.group, stale: l.stale, changed_s: l.changed != null ? now - l.changed : null, stage: l.stage, light: l.light })),
    calls: { count: (B.askCards || []).length, new: S.anim.call },
    counts: { landed: (B.doneToday || []).length },
    weather, hail: B.hostdown ? { seconds: Math.max(0, Math.ceil((S.retryAt - performance.now()) / 1000)), trying: S.trying } : null,
    palette: { scene: T.color.scene || {}, status: { needs: COL.needs, trouble: COL.trouble, moving: COL.moving, done: COL.done }, ink: { ink: COL.ink, ink2: COL.ink2, fog: COL.fog } },
    sprites: T.spriteSet ? T.spriteSet.sprites : {}, glyphs: T.glyphSet, motion: motionLevel(), drift: dr,
    idle: (T.motion || {}).idle || {},
    wx: { ms: ((T.motion || {}).durations_ms || {}).weather_change || WX_MS, steps: ((T.motion || {}).steps || {}).weather_change || WX_STEPS },
  };
}

/* ---------- ambient motion: the sea and the ship's float (docs/theme-spec.md section 10) ----------
   A channel apart from the alert motion: one slow clock here, whole-px stepped frames drawn by the scene module.
   It runs only while it can be seen (a visible tab, the scene on screen), never under motion level still or
   prefers-reduced-motion, and never when config display.ambient is false. The level (calm or full) and the
   mood (day, night, storm, anchor, hail, lost, plus fog) set the amplitude and tempo, eased over a few seconds. */
const AMB = { on: false, phase: 0, amp: 0, tempo: 0, roll: 0, tAmp: 0, tTempo: 0, tRoll: 0, last: 0, timer: null, visible: true, sc: null, animated: null,
  mood: "day", level: "calm", tok: null, frames: 0, ms: 0, worst: 0, since: 0, started: 0 };
const ambientTokens = () => (S.theme && S.theme.motion && S.theme.motion.ambient) || null;
function ambientAllowed() {
  if (motionLevel() === "still" || S.dev.ambient === "off") return false;
  return S.dev.ambient === "on" || cfg().display.ambient !== false;
}
function ambientMood(B) {
  if (B.lost) return "lost";
  if (B.anchor) return "anchor";
  if (B.hostdown) return "hail";
  if ((B.critical || []).length) return "storm";
  return B.mode === "day" ? "day" : "night";
}
function ambientTargets(B, tok) {
  const lv = (tok.levels || {})[AMB.level] || (tok.levels || {}).calm || { amp: 1, tempo: 1 }, mo = (tok.moods || {})[AMB.mood] || (tok.moods || {}).day || { amp: 1, tempo: 1, roll: 1 };
  let amp = lv.amp * mo.amp, tempo = lv.tempo * mo.tempo;
  if (AMB.mood !== "lost" && AMB.mood !== "anchor" && (B.machines || []).some(m => m.pip === "silent")) { amp *= (tok.fog || {}).amp ?? 1; tempo *= (tok.fog || {}).tempo ?? 1; }
  return { amp, tempo, roll: mo.roll ?? 1 };
}
function stopAmbient() {
  clearTimeout(AMB.timer); AMB.timer = null;
  if (AMB.on) AMB.on = false; // the still scene repaints at once (paintScene: wasAmbient)
}
function ambientFrame() {
  clearTimeout(AMB.timer); AMB.timer = null;
  if (!AMB.on) return;
  // Parked off screen only where the picture can scroll away (the page board's slot, the phone's banner): the TV stage's sea is
  // fixed behind the whole screen, so an observer's stale "not visible" can never leave it still.
  const scrolls = !!(S.geom && (S.geom.page || S.geom.phone));
  if (document.hidden || (!AMB.visible && scrolls) || sceneCv.hidden || MV.on) { AMB.last = 0; return; } // parked (also under a move): the next render or visibility change resumes it
  const t0 = performance.now(), tok = AMB.tok, dt = AMB.last ? Math.min(0.5, (t0 - AMB.last) / 1000) : 0;
  AMB.last = t0;
  const k = 1 - Math.exp(-dt / Math.max(0.5, tok.ease_s || 6)), near = (a, b) => Math.abs(a - b) < 0.01;
  for (const [cur, tgt] of [["amp", "tAmp"], ["tempo", "tTempo"], ["roll", "tRoll"]]) AMB[cur] = near(AMB[cur], AMB[tgt]) ? AMB[tgt] : AMB[cur] + (AMB[tgt] - AMB[cur]) * k;
  AMB.phase += dt * AMB.tempo;
  const frame = { now: t0, ev: S.ev, animated: AMB.animated, rev: sceneRev, live: animating(),
    ambient: { on: true, phase: AMB.phase, amp: AMB.amp, roll: AMB.roll, tok, mood: AMB.mood, level: AMB.level } };
  try { S.theme.scene.paint(sceneCv.getContext("2d"), AMB.sc, frame); }
  catch (e) {
    if (!sceneWarned) { sceneWarned = true; console.error("scene module failed; showing the plain ground:", e); }
    sceneCv.getContext("2d").clearRect(0, 0, sceneCv.width, sceneCv.height);
  }
  const cost = performance.now() - t0;
  AMB.frames++; AMB.ms += cost; AMB.worst = Math.max(AMB.worst, cost);
  if (!AMB.started) AMB.started = t0;
  if (S.dev.ambient_stats && t0 - AMB.since > 30000) {
    if (AMB.since) console.info("ambient:", AMB.mood, AMB.level, "frames", AMB.frames, "avg ms", (AMB.ms / AMB.frames).toFixed(2), "worst ms", AMB.worst.toFixed(1));
    AMB.since = t0;
  }
  // 8 to 10 frames a second; a held sea (every source lost) only needs the burn-in drift, a couple of seconds apart.
  const held = AMB.tempo < 0.01 && AMB.tTempo < 0.01, every = held ? 2000 : 1000 / ((tok.fps || {})[AMB.level] || 8);
  AMB.timer = setTimeout(ambientFrame, Math.max(20, every - (performance.now() - t0)));
}
if (window.IntersectionObserver) {
  new IntersectionObserver(es => { const v = es[es.length - 1].isIntersecting; if (v !== AMB.visible) { AMB.visible = v; if (v) { AMB.last = 0; ambientFrame(); } } }).observe(sceneCv);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(AMB.timer); AMB.timer = null; } else { AMB.last = 0; render(); } });
const ambientStats = () => ({ on: AMB.on, mood: AMB.mood, level: AMB.level, amp: +AMB.amp.toFixed(3), tempo: +AMB.tempo.toFixed(3), roll: +AMB.roll.toFixed(3), phase: +AMB.phase.toFixed(2),
  frames: AMB.frames, avg_ms: AMB.frames ? +(AMB.ms / AMB.frames).toFixed(3) : 0, worst_ms: +AMB.worst.toFixed(2), running: AMB.timer != null });

function paintScene(B, g, dr) {
  const mod = S.theme.scene;
  setHidden(sceneCv, !mod || (g.phone && B.hostdown));
  if (!mod) { S.anchors = null; stopAmbient(); return; }
  const sc = sceneData(B, g, dr);
  S.sceneNow = sc;   // the phone's convoy strip paints its mini ships from it
  updateReceipt(sc.screen === "deck" ? sceneFor({ level: "sea" }) : sc);
  try { S.anchors = mod.layout ? mod.layout(sc) : null; } catch (e) { S.anchors = null; }
  const animatedSet = (() => { try { return mod.animated ? mod.animated(sc, motionLevel()) : new Set(); } catch (e) { return new Set(); } })();
  let changed;
  if (sc.screen === "deck") { const k = JSON.stringify([sc.w, sc.h, sc.tod, sc.mode, sc.room, sc.machines.map(m => m.pip), sc.counts]); changed = k !== deckKey; deckKey = k; }
  else { changed = seaRev(sc, animatedSet); deckKey = ""; }
  if (sceneCv.width !== sc.w || sceneCv.height !== sc.h) { sceneCv.width = sc.w; sceneCv.height = sc.h; }
  const tok = ambientTokens(), want = !!(mod.ambient && tok) && ambientAllowed() && sc.screen !== "deck";
  if (want) {
    // The sea and the ship: the ambient loop paints; a change of state paints at once.
    AMB.sc = sc; AMB.animated = animatedSet; AMB.tok = tok; AMB.level = motionLevel(); AMB.mood = ambientMood(B);
    const tg = ambientTargets(B, tok);
    AMB.tAmp = tg.amp; AMB.tTempo = tg.tempo; AMB.tRoll = tg.roll;
    if (!AMB.on) { AMB.on = true; AMB.last = 0; AMB.amp = AMB.tAmp; AMB.tempo = AMB.tTempo; AMB.roll = AMB.tRoll; }
    document.documentElement.dataset.ambient = AMB.mood;
    if (changed || !AMB.timer) ambientFrame();
    return;
  }
  const wasAmbient = AMB.on;
  if (wasAmbient) stopAmbient();
  document.documentElement.dataset.ambient = "off";
  const frame = { now: performance.now(), ev: S.ev, animated: animatedSet, rev: sceneRev, live: animating() };
  const live = frame.live || animatedSet.size > 0 || worldBusy();
  if (changed || live || wasAmbient) {
    try { mod.paint(sceneCv.getContext("2d"), sc, frame); }
    catch (e) {
      if (!sceneWarned) { sceneWarned = true; console.error("scene module failed; showing the plain ground:", e); }
      sceneCv.getContext("2d").clearRect(0, 0, sceneCv.width, sceneCv.height);
    }
  }
  // While something moves, repaint at the frame rate (100 ms frames); otherwise only on change.
  clearTimeout(sceneTimer);
  if (live) sceneTimer = setTimeout(() => render(), 100);
}

/* The sea's revision: its cached layers stay valid while the decks are shown, and a move back out finds them warm. */
function seaRev(sc, animatedSet) {
  const key = JSON.stringify([sc.w, sc.h, sc.tod, sc.mode, sc.screen, sc.open, sc.storm, sc.lost, sc.machines.map(m => [m.id, m.label, m.pip, m.key, m.critical, m.becalmed, m.asleep]), sc.fleet,
    sc.crew.map(c => [c.id, c.machine, c.state, c.tag, c.stale, c.stage, c.light]), sc.horizon, sc.calls.count, sc.drift, Math.floor(sc.minutes / 10), [...animatedSet].join(),
    sc.world.host, sc.world.gulls, sc.world.events.filter(e => e.kind === "gulls").map(e => e.machine)]);
  if (key === sceneKey) return false;
  sceneKey = key; sceneRev++;
  return true;
}
/* A route's picture, painted off screen at the scene canvas's size (decks.js moves between them). The sea is drawn
   as it stands now, with the ambient sea's current phase, so the move lands on the frame that is already live. */
function sceneFor(r) {
  const g = S.geom, B = S.board, saved = S.route;
  S.route = r;
  try { return sceneData(B, g, drift(B, g)); } finally { S.route = saved; }
}
function sceneShot(cv, r) {
  const mod = S.theme && S.theme.scene;
  if (!mod || !S.board) return false;
  const sc = sceneFor(r);
  if (sc.screen === "board" || sc.screen === "anchor") sc.w = cv.width, sc.h = cv.height;
  const tok = ambientTokens();
  const A = sc.screen !== "deck" && mod.ambient && tok && ambientAllowed()
    ? { on: true, phase: AMB.phase, amp: AMB.amp || 1, roll: AMB.roll || 1, tok, mood: ambientMood(S.board), level: motionLevel() } : null;
  let animatedSet = new Set();
  if (sc.screen !== "deck") { try { animatedSet = mod.animated ? mod.animated(sc, motionLevel()) : animatedSet; } catch (e) { /* none */ } seaRev(sc, animatedSet); }
  try { mod.paint(cv.getContext("2d"), sc, { now: performance.now(), ev: S.ev, animated: animatedSet, rev: sceneRev, live: false, ambient: A }); return true; }
  catch (e) { console.error("scene snapshot:", e); return false; }
}
/* The scene module's anchors for a route (the spots on the sea's ship, the doors on a plan), in stage art px. */
function sceneLayout(r) {
  const mod = S.theme && S.theme.scene;
  if (!mod || !mod.layout || !S.board) return {};
  try { return mod.layout(sceneFor(r)) || {}; } catch (e) { return {}; }
}

/* ---------- render ---------- */
function applyTheme(B, g) {
  const c = cfg();
  const opts = { oled: !!c.theme.oled_safe, background: /^#[0-9a-f]{6}$/i.test((c.theme.accents || {}).background || "") ? c.theme.accents.background : null };
  const key = JSON.stringify([S.theme.id, B.mode, g.ap, g.phone, g.dpr, opts]);
  if (S.applied !== key) { COL = applyTokens(S.theme, B.mode, g, opts); S.applied = key; }
  LABELS = themeLabels(S.theme, c.labels || {}, c.labels_set);
  if (document.title !== (c.title || "Weatherdeck")) document.title = c.title || "Weatherdeck";
  const root = document.documentElement;
  const setData = (k, v) => { if (root.dataset[k] !== v) root.dataset[k] = v; };
  setData("layout", g.phone ? "phone" : "tv");
  if (g.page) root.setAttribute("data-page", ""); else root.removeAttribute("data-page");
  setData("screen", B.screen || "board");
  setData("motion", motionLevel());
  root.toggleAttribute("data-crt", !!c.theme.crt && !!S.theme.scene && !g.phone && !g.page);
  root.toggleAttribute("data-scene", !!S.theme.scene);
}
function render() {
  if (!S.theme) { ensureTheme(); return; }
  if (S.server) ensureTheme();
  let g = geometry();
  S.geom = g;
  const B = boardModel(g);
  // The open sea (#/sea) is the front door on a TV-sized screen: the stage with the fleet on the water. The page board (page.js)
  // is what the sea's and a plan's Lists doors open (#/board), and a phone's #/sea (its approved one-page layout). The television
  // profile never shows it. The take-over screens (loading, empty, lost contact, hailing, at anchor) keep the stage everywhere.
  const pageOn = pageBoardOn(S.route, { phone: g.phone, tv: !boardOpen(), screen: B.screen, loading: B.loading });
  S.pageEligible = B.screen === "board" && !B.loading;
  if (pageOn) { g = pageGeometry(g, B); S.geom = g; B.open = false; B.horizon = horizonOf(B.next, B.now, false); }
  S.pageOn = pageOn;
  S.board = B;
  S.mode = B.mode;
  applyTheme(B, g);
  detectEvents(B, g);
  worldUpdate(B, g);
  worldStep(B);
  const dr = drift(B, g);
  setVar(boardEl, "--dx", String(B.anchor ? 0 : dr.x));
  setVar(boardEl, "--dy", String(B.anchor ? 0 : dr.y));
  if (!g.phone && !g.page) {
    for (const [k, v] of [["--stage-x", g.left + "px"], ["--stage-y", g.top + "px"], ["--scene-x", g.sceneX + "px"], ["--scene-y", g.sceneY + "px"],
      ["--aw", String(g.AW)], ["--ah", String(g.AH)], ["--crt-d", Math.max(1, Math.floor(g.apDev / 3)) / g.dpr + "px"]]) setVar(document.documentElement, k, v);
  }
  // The scene canvas: behind the whole TV stage, or the phone's banner.
  // The phone banner gives way to an alarm, so the call stays on the first screen (the scene says nothing alone).
  const banner = g.phone && !g.page && S.theme.scene && !B.hostdown && !B.loading && !(B.critical || []).length && !B.lost;
  if (g.page) {
    // The page's sea: the scene canvas lives in the page's picture slot (below), not behind the stage.
    const bn = document.getElementById("banner");
    if (bn) { for (const k of ["firsthint-p", "since-p"]) mount(bn, k, null); bn.remove(); }
  } else if (g.phone) {
    let bn = document.getElementById("banner");
    if (!bn) { bn = h("div", { class: "banner" }); bn.id = "banner"; boardEl.prepend(bn); }
    setHidden(bn, !banner);
    // The phone's ship is a door too: the banner opens the ship's places, and carries the first-visit hint.
    for (const [k, v] of Object.entries(banner && !B.loading && !B.empty ? Object.assign(seaDoor(null), { "aria-label": L("cap_ship") }) : {})) if (bn.getAttribute(k) !== v) bn.setAttribute(k, v);
    if (!banner || B.loading || B.empty) for (const k of ["data-route", "tabindex", "role", "aria-label"]) bn.removeAttribute(k);
    if (sceneCv.parentNode !== bn) bn.append(sceneCv);
  } else if (sceneCv.parentNode !== document.body) { document.body.prepend(sceneCv); const bn = document.getElementById("banner"); if (bn) bn.remove(); }
  paintScene(B, g, dr);
  const anchorIn = B.anchor && S.ev.anchor != null && performance.now() - S.ev.anchor < ((S.theme.motion.durations_ms || {}).anchor_in || 800);
  const sleeping = B.anchor && !anchorIn;
  const fade = anchorIn ? " fade-out" : "";
  const wrap = el => { if (el && fade) el.className += fade; return el; };
  if (S.route.level !== "sea") {
    mount(boardEl, "page", null);
    renderDecks(B, g);
    const bn = document.getElementById("banner");   // the phone's since plate and hint belong to the open sea
    if (bn) { mount(bn, "firsthint-p", null); mount(bn, "since-p", null); }
  } else if (pageOn) {
    for (const id of [...SEA_ZONES, ...DECK_ZONES, "seadoors", "shipdoor"]) mount(boardEl, id, null);
    mount(boardEl, "page", safe("page", () => renderPage(B, g)));
    seatScene(g);
  } else {
    mount(boardEl, "page", null);
    mount(boardEl, "bar", sleeping ? null : wrap(safe("bar", () => renderBar(B, g))));
    mount(boardEl, "call", sleeping ? null : wrap(safe("call", () => renderCall(B, g))));
    const side = !g.phone && !sleeping && !B.loading && !B.empty && !scenePlates() && !B.hostdown;
    mount(boardEl, "side", side ? wrap(safe("machines", () => renderMachinesPanel(B))) : null);
    const marks = !g.phone && !sleeping && !B.loading && !B.empty && scenePlates() && S.theme.scene;
    mount(boardEl, "marks", marks ? wrap(safe("machines", () => renderScenePlates(B, g, (S.anchors || {}).machines || {}))) : null);
    mount(boardEl, "log", sleeping ? null : wrap(safe("log", () => renderLog(B, g))));
    mount(boardEl, "hail", B.hostdown && !B.anchor ? safe("hail", () => renderHail(B, g)) : null);
    mount(boardEl, "anchor", sleeping ? safe("anchor", () => renderAnchor(B)) : null);
    mount(boardEl, "more", g.phone ? safe("more", () => renderMore(B)) : null);
    // At a glance: what changed since this screen last looked, the first-visit hint, and the key.
    const since = sleeping ? null : safe("since", () => renderSince(B, g));
    const hint = sleeping ? null : safe("hint", () => renderFirstHint(B, g));
    // The phone lays both over the bottom of the scene banner (the call keeps its place on the first screen); the hint wins.
    if (g.phone) {
      mount(boardEl, "since", banner ? null : since); mount(boardEl, "firsthint", null);
      const bn = document.getElementById("banner");
      if (bn) { mount(bn, "firsthint-p", banner ? hint : null); mount(bn, "since-p", banner && !hint ? since : null); }
    } else { mount(boardEl, "since", since); mount(boardEl, "firsthint", hint); }
    mount(boardEl, "keybtn", sleeping ? null : safe("key", () => renderKey(B, g)));
    mount(boardEl, "boarddoor", sleeping ? null : safe("boarddoor", () => renderBoardDoor(B, g)));
    mount(boardEl, "legend", sleeping ? null : safe("legend", () => renderLegend(B, g)));
    renderSeaDecks(B, g);
  }
  fitLog(B);
  fitCall(B);
  if (anchorIn) { clearTimeout(S.anchorTimer); S.anchorTimer = setTimeout(render, 220); }
  if (S.anim.call) { clearTimeout(S.callTimer); S.callTimer = setTimeout(render, 500); }
  document.querySelector(".boot-note")?.remove();
}
/* The page's sea: the scene canvas sits in the page's picture slot, painted as a window onto the stage (pageGeometry). */
function seatScene(g) {
  const pic = document.getElementById("pg-pic");
  if (!pic) return;
  if (sceneCv.parentNode !== pic) pic.append(sceneCv);
  setVar(pic, "--pw", String(g.AW));
  setVar(pic, "--ph", String(g.AH));
}
function safe(name, fn) {
  try { return fn(); }
  catch (e) { console.error(name, e); return h("section", { class: "zone plate notice" }, t("body", "ink2", L("draw_failed", { name }))); }
}
/* A detail may wrap once; when the log would still overflow, details truncate before rows fold (tight),
   then the tools row gives up its top gap (tighter), and then rows fold into the last "+N more" row, one at a
   time, so a row is never cut off at the bottom of the zone. */
function fitLog(B) {
  const ledgerEl = () => { const el = document.getElementById("log"); return el && el.querySelector(".ledger"); };
  let ledger = ledgerEl();
  if (!ledger) return;
  // Titles are cut at a word boundary to their column (board.js logTitle): measure it, and draw again once when it changed.
  const cell = ledger.querySelector(".tcell");
  const room = cell ? Math.floor(cell.clientWidth / S.geom.ap) : 0;
  if (cell && room !== S.titleRoom) { S.titleRoom = room; mount(boardEl, "log", renderLog(B, S.geom)); ledger = ledgerEl(); if (!ledger) return; }
  const over = () => ledger.scrollHeight > ledger.clientHeight + 1;
  const remount = () => { logRows(B, S.geom); mount(boardEl, "log", renderLog(B, S.geom)); ledger = ledgerEl(); };
  const sig = JSON.stringify([S.geom.ap, (B.lanes || []).map(l => [l.id, l.sentence, l.rowWord, l.kind, l.steer && l.steer.row && l.steer.row.text]), cardStates().length, (B.library || []).length]);
  if (sig !== S.logSig) {
    S.logSig = sig;
    if (S.logFold) { S.logTight = 0; S.logFold = 0; remount(); }
    else if (S.logTight) { S.logTight = 0; ledger.classList.remove("tight", "tighter"); }
  }
  while (S.logTight < 2 && over()) {
    S.logTight++;
    ledger.classList.add(S.logTight > 1 ? "tighter" : "tight");
  }
  while (ledger && S.logFold < 4 && over() && (B.shown || []).length > 1) {
    S.logFold++;
    remount();
  }
}

/* The call keeps to its zone: first the top call's detail line goes (it is on the phone), then its
   title keeps one line. */
function fitCall(B) {
  const el = document.getElementById("call");
  if (!el || S.geom.phone || !el.classList.contains("focal")) return;
  const sig = JSON.stringify([S.geom.ap, (B.askCards || []).map(c => [c.id, c.title, c.how, c.detail, c.recommend]), (B.also || []).length, (B.disagree || {}).lines]);
  if (sig !== S.callSig) { S.callSig = sig; S.callTight = 0; el.dataset.tight = "0"; }
  while (S.callTight < 2 && el.scrollHeight > el.clientHeight + 1) { S.callTight++; el.dataset.tight = String(S.callTight); }
}

/* ---------- sound (world.js): the page may play it only after one tap or key ---------- */
function unlockAudio() {
  if (S.audio || !cfg().sound.enabled) return;
  try { S.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio here */ }
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, unlockAudio, { once: true, passive: true });

/* ---------- guarded reloads: only after the host answers a probe ---------- */
async function reloadIfHealthy() {
  try { const r = await fetch("healthz", { cache: "no-store" }); if (r.ok) location.reload(); } catch (e) { /* try again later */ }
}
function dailyReload() {
  const tm = nowS();
  if (hm(tm) !== "04:00") return;
  let last = null;
  try { last = sessionStorage.getItem("weatherdeck.reloaded"); } catch (e) { /* storage may be blocked */ }
  const today = dayKey(tm);
  if (last === today) return;
  try { sessionStorage.setItem("weatherdeck.reloaded", today); } catch (e) { /* ignore */ }
  reloadIfHealthy();
}

/* ---------- polling ---------- */
let polling = false;
/* The static demo (scripts/build-static-demo) answers the poll from recorded frames; absent on the live page. */
function demoPoll() {
  const r = window.weatherdeckDemo.poll();
  if (r) {
    S.failSince = null;
    S.polls++;
    S.clockHeld = true; S.srv0 = r.frame.served_at + 0.5; S.p0 = performance.now();
    if (r.changed) {
      S.view = r.frame.view; S.server = r.frame.server; S.etag = null;
      if (S.loadedVersion == null) S.loadedVersion = S.server.version;
    }
  } else if (S.failSince == null) { S.failSince = performance.now(); S.failAt = nowS(); }
  schedule();
  if (!MV.on) render();
}
addEventListener("weatherdeck-demo-step", () => { if (window.weatherdeckDemo) demoPoll(); });
async function poll() {
  if (polling) return;
  if (window.weatherdeckDemo) return demoPoll();
  polling = true;
  S.trying = S.failSince != null;
  if (S.trying) render();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch("api/view", { headers: S.etag ? { "If-None-Match": S.etag } : {}, signal: ctl.signal });
    const date = Date.parse(r.headers.get("Date") || "");
    if (r.status !== 304 && !r.ok) throw new Error("HTTP " + r.status);
    if (!Number.isNaN(date)) { S.srv0 = date / 1000 + 0.5; S.p0 = performance.now(); }
    S.failSince = null;
    S.polls++;
    if (r.status === 200) {
      const data = await r.json();
      S.view = data.view; S.server = data.server; S.etag = r.headers.get("ETag");
      if (S.loadedVersion == null) S.loadedVersion = S.server.version;
      else if (S.loadedVersion !== S.server.version) reloadIfHealthy();
    }
  } catch (e) {
    const wasDown = hostDown();
    if (S.failSince == null) { S.failSince = performance.now(); S.failAt = nowS(); }
    if (wasDown) strike();
  } finally {
    clearTimeout(timer);
    polling = false;
    S.trying = false;
    schedule();
    if (!MV.on) render();
  }
}
let pollTimer = null;
function schedule() {
  clearTimeout(pollTimer);
  const th = TH(), p = cfg().poll || {};
  const every = S.failSince != null ? (th.retry_every_s || 10) : (S.geom && S.geom.phone ? p.phone_s : p.tv_s) || 5;
  S.retryAt = performance.now() + every * 1000;
  pollTimer = setTimeout(() => { if (document.hidden && S.failSince == null) schedule(); else poll(); }, every * 1000);
}
function tick() {
  if (S.view) dailyReload();
  if (MV.on) return; // a move owns the screen; its end renders
  render();
  if (S.geom) idleReturn(S.geom);
  if (S.geom) tourStep(S.board, S.geom);
  if (S.view) warmIdle();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { glanceBack(); poll(); } else glanceLeave(); });
addEventListener("pagehide", glanceLeave);
addEventListener("resize", () => { clearTimeout(S.rz); S.rz = setTimeout(() => { S.applied = null; render(); }, 150); });
reducedMotion.addEventListener("change", () => render());

/* ---------- preview controls: #controls=1, or hash keys, force a state so it can be checked ---------- */
/* The hash holds a route (decks.js) and the preview keys: "#/ship/a/deck/bridge?night=1", or the keys alone ("#night=1"). */
const hashParts = () => { const raw = location.hash.slice(1); return raw.startsWith("/") ? [raw.split("?")[0], raw.split("?").slice(1).join("?")] : ["", raw]; };
function readHash() {
  const p = new URLSearchParams(hashParts()[1]);
  S.hashQuery = hashParts()[1];
  const pv = p.get("preview");
  S.dev.mode = ["late", "stale", "lost"].includes(pv) ? pv : null;
  S.dev.host = pv === "host";
  S.dev.screen = ["loading", "empty"].includes(pv) ? pv : null;
  S.dev.night = p.get("night") === "1" ? true : p.get("night") === "0" ? false : null;
  S.dev.sleep = p.get("sleep") === "1";
  S.dev.sky = ["dawn", "day", "dusk", "night"].includes(p.get("sky")) ? p.get("sky") : null;
  S.dev.motion = ["full", "calm", "still"].includes(p.get("motion")) ? p.get("motion") : null;
  // #ambient=0 or 1 forces the sea off or on (level still and reduced motion still win); #ambient=stats leaves it as configured, logs its cost every 30 s and
  // exposes window.weatherdeckAmbient() for a look at the clock.
  S.dev.ambient = ["0", "off"].includes(p.get("ambient")) ? "off" : ["1", "on"].includes(p.get("ambient")) ? "on" : null;
  S.dev.ambient_stats = p.get("ambient") === "stats";
  if (S.dev.ambient_stats) window.weatherdeckAmbient = ambientStats; else delete window.weatherdeckAmbient;
  S.dev.theme = /^[a-z][a-z0-9-]{1,31}$/.test(p.get("theme") || "") ? p.get("theme") : null;
  // #tour=1 (or fast) forces the auto-tour on; #fresh=1 forgets this browser's last look and first-visit hint (to check them).
  S.dev.tour = ["1", "fast"].includes(p.get("tour")) ? (p.get("tour") === "fast" ? "fast" : true) : null;
  if (p.get("fresh") === "1") { try { localStorage.removeItem("weatherdeck.seen"); localStorage.removeItem("weatherdeck.hint"); } catch (e) { /* blocked */ } }
  return p;
}
function setupDevbar() {
  const p = readHash(), bar = document.getElementById("devbar");
  bar.hidden = p.get("controls") !== "1";
  if (bar.hidden) return;
  const set = (k, v) => { const [path] = hashParts(), q = new URLSearchParams(hashParts()[1]); if (v == null) q.delete(k); else q.set(k, v); location.hash = path ? path + (q.toString() ? "?" + q : "") : q.toString(); };
  const cur = new URLSearchParams(hashParts()[1]);
  const grp = (name, key, values) => h("div", { class: "grp" }, h("b", null, name), values.map(([label, v]) => {
    const b = h("button", { type: "button", "aria-pressed": String((cur.get(key) || null) === v) }, label);
    b.addEventListener("click", () => set(key, v));
    return b;
  }));
  bar.replaceChildren(
    grp("State", "preview", [["live", null], ["late", "late"], ["stale", "stale"], ["lost", "lost"], ["host down", "host"], ["empty", "empty"], ["loading", "loading"]]),
    grp("Mode", "night", [["auto", null], ["night", "1"], ["day", "0"]]),
    grp("Rest", "sleep", [["auto", null], ["anchor", "1"]]),
    grp("Sky", "sky", [["clock", null], ["dawn", "dawn"], ["day", "day"], ["dusk", "dusk"], ["night", "night"]]),
    grp("Motion", "motion", [["config", null], ["full", "full"], ["calm", "calm"], ["still", "still"]]),
    grp("Sea", "ambient", [["config", null], ["on", "1"], ["off", "0"], ["stats", "stats"]]),
    grp("Theme", "theme", [["config", null], ...((S.server && S.server.config.themes) || ["default"]).map(n => [n, n])]));
}
/* A changed preview key resets the board; a changed route is a move (decks.js onLocation). */
addEventListener("hashchange", e => { if (hashParts()[1] === S.hashQuery) { onLocation(e); return; } setupDevbar(); S.prev = null; S.applied = null; onLocation(e); render(); });
setupDevbar();
initRoute(hashParts()[0], hashParts()[1]);
setInterval(tick, 1000);
ensureTheme();
poll();
