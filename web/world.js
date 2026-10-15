"use strict";
/* The world on the sea (docs/theme-spec.md section 17). Crew stand at deck stations by their lane's stage (model.js
   laneStage), and a few creatures carry news. Each creature is a messenger with one meaning, driven by one named feed
   field (LEGEND below); nothing appears at random. This file decides what happened and when; the scene module only
   draws what it is handed. The rules:
   - announce once, then rest: a creature event plays once (the longboat 7 s, the others 0.8 to 2 s);
   - one creature event per ship at a time, two on the screen at most (the ship and the horizon), behind the alerts;
   - bursts merge: landings that meet in the queue row home in one longboat with a chest each;
   - rate caps: dolphins once in 10 min per ship, the whale once an hour;
   - each kind's last sighting is kept (sightings.js), shown in the key with its time and the report that drove it, and
     the replay key (R) plays the newest real event again, said as a replay; it never makes one up;
   - no celebration while a critical is open, at anchor, under motion level still or in a hidden tab: the event is
     written in words instead (the bar says it for 60 s);
   - every event is written to this screen's logbook (the Logbook deck), with what the screen did about it;
   - sound is opt-in (config sound.enabled), the TV only, never in quiet hours, one sound in 2 min, never twice for
     one thing, and each sound is captioned in the logbook. */

const LEGEND = [
  ["fleet", "machines[] · sources[].kind"],
  ["stations", "items[].phase · progress.current.step"],
  ["longboat", "done[]"],
  ["dolphins", "done[]"],
  ["gulls", "sources[].received_at"],
  ["whale", "groups[].checkpoint.live.version"],
  ["rainbow", "attention[].severity"],
  ["becalmed", "items[].progress.current.activity"],
  ["islands", "next[] · collectors[] (queue)"],
  ["windows", "items[].agent.state"],
  ["lighthouse", "GET api/view"],
  ["sound", "sound.enabled"],
];
const WORLD = {
  prev: null, seenDone: null, log: [], queue: [], play: { ship: null, horizon: null }, gulls: {},
  lateAt: {}, dolphinsAt: {}, whaleAt: -Infinity, soundAt: -Infinity, rung: {}, note: null, walk: null, receipt: "", seq: 0, last: {},
};
const WD = { landing: 7000, dolphins: 1200, whale: 2000, rainbow: 2400, gulls: 800, walk: 300 };
const WORLD_KEY = "weatherdeck.world";
try {
  const j = JSON.parse(sessionStorage.getItem(WORLD_KEY) || "null");
  if (j && Array.isArray(j.log)) { WORLD.log = j.log.slice(0, 40); WORLD.seq = j.seq || 0; WORLD.last = j.last && typeof j.last === "object" ? j.last : {}; }
}
catch (e) { /* storage may be blocked */ }
function saveWorld() { try { sessionStorage.setItem(WORLD_KEY, JSON.stringify({ log: WORLD.log, seq: WORLD.seq, last: WORLD.last })); } catch (e) { /* ignore */ } }

/* ---------- the logbook: this screen's own record of what its sea showed ---------- */
function logLine(kind, text, extra) {
  const e = Object.assign({ id: "w" + (++WORLD.seq), at: nowS(), kind, text, status: "shown", why: null, sound: null }, extra || {});
  WORLD.log.unshift(e);
  WORLD.log.length = Math.min(WORLD.log.length, 40);
  WORLD.last = noteSighting(WORLD.last, e);
  saveWorld();
  return e;
}
function setStatus(e, status, why) { if (e) { e.status = status; e.why = why || null; WORLD.last = noteSighting(WORLD.last, e); saveWorld(); } }

/* ---------- sound (opt-in): WebAudio from oscillators and noise, no audio files ---------- */
function soundAllowed(key) {
  const c = cfg().sound || {};
  if (!c.enabled || !S.audio || !S.geom || S.geom.phone || inQuiet(nowS())) return false;
  if (key && WORLD.rung[key]) return false;
  return nowS() - WORLD.soundAt >= (c.min_gap_s ?? 120);
}
let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let s = 1;
  for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
  return noiseBuf;
}
const SOUNDS = {
  bells(ctx, out, t0) { // two strikes of a ship's bell
    for (const at of [0, 0.5]) for (const [f, g] of [[784, 0.22], [784 * 2.76, 0.06]]) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.frequency.value = f; gn.gain.setValueAtTime(0.0001, t0 + at); gn.gain.exponentialRampToValueAtTime(g, t0 + at + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.4); o.connect(gn); gn.connect(out); o.start(t0 + at); o.stop(t0 + at + 1.5);
    }
  },
  splash(ctx, out, t0) { // a soft splash, then the creak of the boat coming alongside
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), gn = ctx.createGain();
    n.buffer = noise(ctx); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.8;
    gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.25, t0 + 0.04); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    n.connect(bp); bp.connect(gn); gn.connect(out); n.start(t0); n.stop(t0 + 0.7);
    const o = ctx.createOscillator(), cg = ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(110, t0 + 0.7); o.frequency.linearRampToValueAtTime(70, t0 + 1.1);
    cg.gain.setValueAtTime(0.0001, t0 + 0.7); cg.gain.exponentialRampToValueAtTime(0.05, t0 + 0.75); cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);
    o.connect(cg); cg.connect(out); o.start(t0 + 0.7); o.stop(t0 + 1.2);
  },
  thunder(ctx, out, t0) { // one low roll
    const n = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), gn = ctx.createGain();
    n.buffer = noise(ctx); n.loop = true; lp.type = "lowpass"; lp.frequency.value = 140;
    gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.5, t0 + 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    n.connect(lp); lp.connect(gn); gn.connect(out); n.start(t0); n.stop(t0 + 2.7);
  },
};
/* Plays one of the three sounds when the rules allow; returns its caption for the logbook, or null. */
function ring(name, key) {
  if (!soundAllowed(key)) return null;
  try {
    const ctx = S.audio, out = ctx.createGain();
    out.gain.value = Math.min(1, Math.max(0, cfg().sound.volume ?? 0.25));
    out.connect(ctx.destination);
    SOUNDS[name](ctx, out, ctx.currentTime + 0.02);
  } catch (e) { return null; }
  WORLD.soundAt = nowS();
  if (key) WORLD.rung[key] = WORLD.soundAt;
  return L("sound_" + name);
}

/* ---------- what is true now, in the terms the world draws ---------- */
const doneKey = d => (d.owner || d.source || "") + "/" + d.id;
function worldFacts(B) {
  const v = S.view || {};
  const gulls = {}, becalmed = {}, stages = {}, versions = {};
  for (const m of B.machines || []) {
    // Gulls leave a machine whose reporters went late (frozen as last known while the host is down, model.js srcAge); a
    // machine under maintenance or reserved is expected to be quiet, so its gulls stay.
    gulls[m.id] = m.watchers.length > 0 && (m.lv === "live" || !!m.resting);
    becalmed[m.id] = !!m.becalmed;
  }
  for (const l of B.lanes || []) stages[l.id] = l.stage;
  for (const gr of v.groups || []) { const lv = ((gr.checkpoint || {}).live || {}).version; if (lv != null) versions[gr.id] = String(lv); }
  const critOn = Object.fromEntries((B.critical || []).map(c => [c.id, { machine: c.machine || null, title: c.title || c.id }]));
  return { gulls, becalmed, stages, versions, host: !B.hostdown, calls: new Set((B.askCards || []).map(c => c.id)), crit: new Set((B.critical || []).map(c => c.id)), critOn };
}
const shipName = id => ((S.board && S.board.machines) || []).find(m => m.id === id)?.label || id || "";
const stationWord = st => L("station_" + st);

/* ---------- detection: called on every render with the fresh board model ---------- */
function worldUpdate(B, g) {
  if (!S.view || B.loading || B.empty) return;
  const F = worldFacts(B), P = WORLD.prev, now = nowS(), still = motionLevel() === "still";
  const doneNow = (S.view.done || []).filter(d => d.at && now - epoch(d.at) < 1800);
  if (!P) {
    WORLD.prev = F;
    WORLD.seenDone = new Set((S.view.done || []).map(doneKey));
    WORLD.gulls = Object.assign({}, F.gulls);
    return;
  }
  // Landings: a done[] id this screen has not seen, from the last half hour (a restarted source's old list is no news).
  const fresh = doneNow.filter(d => !WORLD.seenDone.has(doneKey(d)));
  for (const d of S.view.done || []) WORLD.seenDone.add(doneKey(d));
  if (fresh.length) landing(B, fresh, still);
  // A release went live: a group's checkpoint.live.version changed.
  for (const [gid, ver] of Object.entries(F.versions)) {
    if (P.versions[gid] != null && P.versions[gid] !== ver) release(B, gid, ver, still);
  }
  // A rainbow: a critical cleared (the storm over its ship ends). While the host is down nothing is known to have cleared.
  if (!B.hostdown && !P.hostdown) for (const id of P.crit) if (!F.crit.has(id) && P.critOn && P.critOn[id]) rainbowFor(B, P.critOn[id], still);
  // Gulls: a machine's reporters turned late (or live again).
  // Late counts only when a poll after it still says so: a screen's own poll gap (the phone asks every 15 s) is no silence.
  for (const [mid, on] of Object.entries(F.gulls)) {
    if (P.gulls[mid] == null) { WORLD.gulls[mid] = on; continue; }
    if (!on && P.gulls[mid]) {
      if (WORLD.lateAt[mid] == null) WORLD.lateAt[mid] = S.polls;
      if (S.polls <= WORLD.lateAt[mid]) { F.gulls[mid] = true; continue; }
    }
    delete WORLD.lateAt[mid];
    if (P.gulls[mid] !== on) gullsTurn(B, mid, on, still);
  }
  // Becalmed and the wind again: states, drawn at once; the logbook says when.
  for (const [mid, on] of Object.entries(F.becalmed)) {
    if (P.becalmed[mid] != null && P.becalmed[mid] !== on) {
      const m = (B.machines || []).find(x => x.id === mid);
      logLine("becalmed", on ? L("sight_becalmed", { ship: shipName(mid), t: m && m.becalmed && m.becalmed.s != null ? age(m.becalmed.s) : "?" }) : L("sight_wind", { ship: shipName(mid) }), { ship: mid, route: deckRoute("gun-deck", null, mid) });
    }
  }
  // The lighthouse: this screen reaching its host.
  if (P.host !== F.host) logLine("lighthouse", L(F.host ? "sight_lit" : "sight_dark"), { route: deckRoute("logbook") });
  // Crew walking to a new station (crew motion, not a creature: it plays at once, 300 ms).
  const moved = [];
  for (const [id, st] of Object.entries(F.stages)) if (id in P.stages && P.stages[id] !== st) moved.push(id);
  if (moved.length) {
    if (!still && !document.hidden) WORLD.walk = { t0: performance.now(), ids: moved };
    const onDeck = (S.anchors || {}).onDeck;   // the sailors this screen's scene draws (the rest are below decks or not drawn)
    for (const id of moved) {
      const l = B.lanes.find(x => x.id === id), st = F.stages[id], seen = !onDeck || onDeck.includes(id);
      logLine("walk", st ? L("sight_walk", { title: l ? l.title : id, station: stationWord(st), stage: L("stage_" + st) }) : L("sight_walk_off", { title: l ? l.title : id }),
        { item: id, route: deckRoute("gun-deck", id), status: still || !seen ? "words" : "shown", why: still ? L("why_still") : !seen ? L("why_below") : null });
    }
  }
  // Sound for the two alerts that have one: a new call (two bells), a new critical (thunder).
  const newCrit = [...F.crit].filter(id => !P.crit.has(id)), newCall = [...F.calls].filter(id => !P.calls.has(id));
  if (newCrit.length) { const cap = ring("thunder", "crit:" + newCrit[0]); if (cap) logLine("sound", L("sight_sound_crit", { title: titleOf(B.critical, newCrit[0]) }), { sound: cap, route: deckRoute("bridge", newCrit[0]) }); }
  else if (newCall.length) { const cap = ring("bells", "call:" + newCall[0]); if (cap) logLine("sound", L("sight_sound_call", { title: titleOf(B.askCards, newCall[0]) }), { sound: cap, route: deckRoute("bridge", newCall[0]) }); }
  WORLD.prev = F;
}
const titleOf = (list, id) => ((list || []).find(c => c.id === id) || {}).title || id;

/* Why a creature cannot show now, or null. */
function heldWhy(B, still) {
  if (still) return L("why_still");
  if ((B.critical || []).length) return L("why_critical");
  if (B.anchor) return L("why_anchor");
  return null;
}
function landing(B, fresh, still) {
  const ship = flagshipId() || "ship";
  const titles = fresh.map(d => d.title || d.id), gr = (S.view.groups || []).find(x => x.id === fresh[0].group);
  const why = heldWhy(B, still);
  const q = WORLD.queue.find(e => e.kind === "landing" && e.lane === "ship");
  if (q && !why) { // merge with the longboat still waiting to row
    q.titles.push(...titles); q.n = q.titles.length;
    q.entry.text = L("sight_landing", { n: q.n, titles: q.titles.join(", ") });
    if (q.entry.play) q.entry.play.n = q.n;
    WORLD.last = noteSighting(WORLD.last, q.entry);
    saveWorld();
    return;
  }
  const colour = gr && /^#[0-9a-f]{6}$/i.test(gr.color || "") ? gr.color : null;
  const entry = logLine("landing", L("sight_landing", { n: titles.length, titles: titles.join(", ") }), { ship, item: fresh[0].id, route: deckRoute("cargo-hold", fresh[0].id), status: "queued",
    play: { kind: "landing", lane: "ship", ship, n: titles.length, colour, dolphins: false } });
  if (why) { setStatus(entry, "words", why); WORLD.note = { text: L("note_landing", { n: titles.length, t: hm(nowS()) }), until: nowS() + 60 }; return; }
  WORLD.queue.push({ kind: "landing", lane: "ship", ship, prio: 4, at: nowS(), titles, n: titles.length, colour, entry });
}
function release(B, gid, ver, still) {
  const gr = (S.view.groups || []).find(x => x.id === gid) || { id: gid };
  const entry = logLine("whale", L("sight_whale", { group: gr.label || gid, version: ver }), { route: deckRoute("chart-room", "gate:" + gid), status: "queued",
    play: { kind: "whale", lane: "horizon", ship: "horizon" } });
  let why = heldWhy(B, still);
  if (!why && nowS() - WORLD.whaleAt < 3600) why = L("why_whale_hour");
  if (why) { setStatus(entry, "words", why); WORLD.note = { text: L("note_release", { group: gr.label || gid, version: ver, t: hm(nowS()) }), until: nowS() + 60 }; return; }
  WORLD.queue.push({ kind: "whale", lane: "horizon", ship: "horizon", prio: 5, at: nowS(), entry });
}
/* A rainbow over the ship whose critical cleared (a critical with no machine is the fleet's: over the flagship). Never while
   another critical is open, at anchor or under still: then it is said in words. */
function rainbowFor(B, c, still) {
  const mid = c.machine && (B.machines || []).some(m => m.id === c.machine) ? c.machine : flagshipId();
  const entry = logLine("rainbow", L("sight_rainbow", { ship: shipName(mid), title: c.title }), { ship: mid, route: deckRoute("bridge"), status: "queued",
    play: { kind: "rainbow", lane: "ship", ship: mid, machine: mid } });
  const why = heldWhy(B, still) || (!shipDrawn(B, mid) ? L("why_not_drawn") : null);
  if (why) { setStatus(entry, "words", why); return; }
  WORLD.queue.push({ kind: "rainbow", lane: "ship", ship: mid, machine: mid, prio: 5, at: nowS(), entry });
}
function gullsTurn(B, mid, on, still) {
  const q = WORLD.queue.find(e => e.kind === "gulls" && e.machine === mid);
  const text = L(on ? "sight_gulls_back" : "sight_gulls_off", { ship: shipName(mid) });
  if (q) { // the last word wins; back where they started is no flight at all
    WORLD.queue.splice(WORLD.queue.indexOf(q), 1);
    setStatus(q.entry, "merged", L("why_merged"));
    if (WORLD.gulls[mid] === on) { logLine("gulls", text, { ship: mid, status: "merged", why: L("why_merged"), route: deckRoute("crows-nest", mid) }); return; }
  }
  const entry = logLine("gulls", text, { ship: mid, route: deckRoute("crows-nest", mid), status: "queued", play: { kind: "gulls", lane: "ship", ship: flagshipId() || "ship", machine: mid, to: on } });
  const why = still ? L("why_still") : B.mode !== "day" || B.anchor ? L("why_night") : !shipDrawn(B, mid) ? L("why_not_drawn") : null;
  if (why) { WORLD.gulls[mid] = on; setStatus(entry, "words", why); return; }
  WORLD.queue.push({ kind: "gulls", lane: "ship", ship: flagshipId() || "ship", machine: mid, to: on, prio: 7, at: nowS(), entry });
}

/* A ship this screen draws: on the TV the flagship and its escorts (not the convoy); the phone's banner, the flagship. */
function shipDrawn(B, mid) {
  const fl = B.fleet;
  if (!fl) return true;
  return S.geom && S.geom.phone ? mid === fl.flagship : fl.ships.some(x => x.id === mid);
}

/* ---------- the player: one event per lane (the ship, the horizon), alerts first ---------- */
function alertBusy() {
  const now = performance.now(), recent = t => t != null && now - t < 3200;
  return S.anim.flying || recent(S.ev.call) || recent(S.ev.storm) || recent(S.ev.lost) || recent(S.ev.hoist) ||
    recent(S.ev.anchor) || recent(S.ev.strike) || Object.values(S.ev.fog).some(recent) ||
    Object.values(S.ev.wx).some(e => recent(e.at));
}
function worldBusy() {
  const now = performance.now();
  return Object.values(WORLD.play).some(p => p && now - p.t0 < p.dur) || (WORLD.walk != null && now - WORLD.walk.t0 < WD.walk + 100);
}
function finishEvent(p) {
  if (p.kind === "gulls") WORLD.gulls[p.machine] = p.to;
}
function worldStep(B) {
  const now = performance.now(), nowE = nowS();
  for (const lane of Object.keys(WORLD.play)) {
    const p = WORLD.play[lane];
    if (p && now - p.t0 >= p.dur) { finishEvent(p); WORLD.play[lane] = null; }
  }
  if (WORLD.walk && now - WORLD.walk.t0 > WD.walk + 100) WORLD.walk = null;
  if (WORLD.note && nowE > WORLD.note.until) WORLD.note = null;
  // An event that waited a minute is news no longer: it is said in words.
  for (const e of [...WORLD.queue]) {
    if (nowE - e.at < 60) continue;
    WORLD.queue.splice(WORLD.queue.indexOf(e), 1);
    setStatus(e.entry, "words", L("why_waited"));
    if (e.kind === "gulls") WORLD.gulls[e.machine] = e.to;
    if (e.kind === "landing") WORLD.note = { text: L("note_landing", { n: e.n, t: hm(e.at) }), until: nowE + 60 };
  }
  if (!B || B.loading || document.hidden || alertBusy() || motionLevel() === "still") return;
  for (const lane of ["ship", "horizon"]) {
    if (WORLD.play[lane] || !WORLD.queue.some(e => e.lane === lane)) continue;
    const e = WORLD.queue.filter(x => x.lane === lane).sort((a, b) => a.prio - b.prio || a.at - b.at)[0];
    WORLD.queue.splice(WORLD.queue.indexOf(e), 1);
    const why = e.kind === "gulls" ? (B.mode !== "day" || B.anchor ? L("why_night") : null) : heldWhy(B, false);
    if (why) { setStatus(e.entry, "words", why); if (e.kind === "gulls") WORLD.gulls[e.machine] = e.to; continue; }
    const p = Object.assign({}, e, { t0: now, dur: WD[e.kind] || 1000 });
    if (e.kind === "landing") {
      p.dolphins = nowE - (WORLD.dolphinsAt[e.ship] ?? -Infinity) >= 600;
      if (p.dolphins) { WORLD.dolphinsAt[e.ship] = nowE; e.entry.kind = "dolphins"; if (e.entry.play) e.entry.play.dolphins = true; }
      const cap = ring("splash", "done:" + e.titles.join("|"));
      if (cap) e.entry.sound = cap;
    }
    if (e.kind === "whale") WORLD.whaleAt = nowE;
    setStatus(e.entry, "shown", p.dolphins ? L("why_dolphins") : null);
    WORLD.play[lane] = p;
  }
}

/* The replay key (R): the newest real creature event this screen logged plays once more, said as a replay in the bar and the
   logbook (sightings.js replayPick). With none, or while it could not play now (an alert playing, a critical open, at
   anchor, under still, its lane busy), nothing happens: a replay is never made up and never jumps the queue. It does not
   count as a sighting, and the rate caps and sound stay out of it. -> true when it plays. */
function worldReplay() {
  const B = S.board, e = replayPick(WORLD.log, WORLD.gulls);
  if (!B || !e || B.loading || B.empty || B.hostdown || document.hidden || alertBusy() || motionLevel() === "still") return false;
  const p = e.play, why = p.kind === "gulls" ? (B.mode !== "day" || B.anchor ? L("why_night") : null) : heldWhy(B, false);
  if (why || WORLD.play[p.lane] || (p.machine && !shipDrawn(B, p.machine))) return false;
  const text = L("sight_replay", { t: hm(e.at), text: e.text });
  logLine("replay", text, { replay: true, ship: e.ship || null, route: e.route || null });
  WORLD.note = { text, until: nowS() + 12 };
  WORLD.play[p.lane] = Object.assign({}, p, { replay: true, t0: performance.now(), dur: WD[p.kind] || 1000, entry: null });
  render();
  return true;
}

/* What the scene module is handed: the events playing now (start times on the page's clock), the gulls as last shown,
   the lighthouse, and a crew walk. */
function worldScene(B) {
  return {
    host: !B.hostdown, gulls: Object.assign({}, WORLD.gulls),
    events: Object.values(WORLD.play).filter(Boolean).map(p => ({ kind: p.kind, t0: p.t0, dur: p.dur, n: p.n || 0, colour: p.colour || null, dolphins: !!p.dolphins, machine: p.machine || null, to: p.to,
      route: (p.entry && p.entry.route) || null, replay: !!p.replay })),
    walk: WORLD.walk,
  };
}

/* ---------- the scene receipt: the plain words of what the scene drew (its module's describe) ---------- */
/* The stern windows in words (section 23.2): every lane counted, so a window the hull has no room for is still said. */
function windowWords(w) {
  const bits = [];
  if (w.lit) bits.push(L("receipt_win_lit", { n: w.lit }));
  if (w.dark) bits.push(L("receipt_win_dark", { n: w.dark }));
  if (w.unknown) bits.push(L("receipt_win_unknown", { n: w.unknown }));
  return L("receipt_windows", { words: bits.join(", "), more: w.drawn < w.n ? L("receipt_win_more", { n: w.n - w.drawn }) : "" });
}
/* The islands ahead in words (section 23.1): each island's kind and when it is due, the true count when more were not drawn. */
function horizonWords(h) {
  if (!h) return "";
  if (!h.total) return L("receipt_horizon_open");
  const one = I => [L("receipt_isle_" + I.kind), I.dated ? L("receipt_isle_due_" + I.step) : "", I.state === "unknown" ? L("receipt_isle_unknown") : I.state === "fog" ? L("receipt_isle_fog") : ""].filter(Boolean).join(" ");
  return L("receipt_horizon", { n: h.total, words: h.shown.map(one).join("; "), more: h.more ? L("receipt_horizon_more", { n: h.more }) : "" });
}
function receiptWords(d) {
  if (!d) return "";
  const parts = [];
  for (const m of d.ships || []) {
    const bits = [];
    for (const st of STAGES) if (m.stations[st]) bits.push(L("receipt_station", { n: m.stations[st], station: stationWord(st) }));
    if (m.stations.none) bits.push(L("receipt_plain", { n: m.stations.none }));
    if (m.stations.asleep) bits.push(L("receipt_asleep", { n: m.stations.asleep }));
    if (m.scouts) bits.push(L("receipt_nest", { n: m.scouts }));
    if (m.sails === "slack") bits.push(L("receipt_becalmed"));
    if (m.gulls) bits.push(L("receipt_gulls"));
    if (m.weather && m.weather !== "clear") bits.push(L("receipt_" + m.weather));
    if (m.below) bits.push(L("receipt_below", { n: m.below }));
    if (m.windows) bits.push(windowWords(m.windows));
    if (m.berth === "harbor") bits.push(L("receipt_harbor"));
    else if (m.berth === "anchored") bits.push(L("receipt_anchored"));
    else if (m.sails === "furled" && m.role === "escort") bits.push(L("receipt_furled"));
    const name = d.ships.length > 1 || d.convoy ? L(m.role === "flagship" ? "receipt_flagship" : "receipt_escort", { name: m.label }) : m.label;
    parts.push(name + ": " + (bits.join(", ") || L("receipt_empty")));
  }
  if (d.convoy) {
    const cv = ((S.board || {}).fleet || {}).convoy, words = cv && cv.words.length ? " (" + cv.words.map(([w, k]) => k + " " + L("hull_" + w).toLowerCase()).join(", ") + ")" : "";
    parts.push(L(d.convoy.n === 1 ? "receipt_convoy_one" : "receipt_convoy", { n: d.convoy.n, words }));
  }
  if (d.horizon) parts.push(horizonWords(d.horizon));
  if (d.lighthouse) parts.push(L("receipt_lighthouse_" + d.lighthouse));
  for (const e of d.events || []) parts.push(L("receipt_event_" + e));
  if (d.replay) parts.push(L("receipt_replay"));
  return parts.join(". ") + (parts.length ? "." : "");
}
function updateReceipt(sc) {
  const mod = S.theme && S.theme.scene;
  let text = "";
  if (mod && mod.describe && sc && sc.screen !== "deck") { try { text = receiptWords(mod.describe(sc)); } catch (e) { text = ""; } }
  WORLD.receipt = text;
  const el = document.getElementById("receipt");
  if (el && el.textContent !== text) el.textContent = text;
}
