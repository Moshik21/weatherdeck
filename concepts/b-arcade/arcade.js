/* Weatherdeck, concept B: 8-bit arcade cabinet. Mockup renderer.
   Reads only fixture.json (the phase-2 synthetic fleet), merges its three
   feeds the way the host does, applies the scenario named in the URL hash
   (#normal, #all-clear, #trouble, #night, #one-source-silent, #lost,
   #host-down, #empty, #loading; add "+dev" for the switcher) and draws one
   screen. No network beyond fixture.json; all text goes in via textContent. */
"use strict";

const SPR = window.ArcadeSprites;

/* Product defaults (src/weatherdeck/defaults.json thresholds), not fixture data. */
const TH = { live_within_intervals: 2, late_within_intervals: 4, lost_after_s: 900, retry_every_s: 10, default_interval_s: 30 };
const SCENARIOS = ["normal", "all-clear", "trouble", "night", "one-source-silent", "lost", "host-down", "empty", "loading"];
const SEV = { critical: 0, action: 1, info: 2 };
/* Calls within one severity: what blocks a lane first, then the machine, then capacity. */
const KIND_RANK = { decision: 0, approval: 1, service: 2, source: 2, machine: 3, capacity: 4, credential: 5 };
const TAGS = { orrery: "ORR", folio: "FOL" };
const HOW = { "change request": "PR", "merged itself": "SELF", "local merge": "LOCAL", report: "REPORT" };

const S = { fx: null, scen: "normal", dev: false, motion: "calm", tick: null, drift: null, hostT0: 0 };

/* ---------- small helpers ---------- */
const ep = t => (t == null ? null : Date.parse(t) / 1000);
function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}
function spr(name, scale = 1, label = "") {
  const t = document.createElement("template");
  t.innerHTML = SPR.spriteSVG(name, scale, label); // sprite strings are our own constants, never data
  return t.content.firstChild;
}
const px = (text, cls = "") => el("span", "px " + cls, text);
function dur(s, short = false) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (short) return r ? `${h} h ${r}` : `${h} h`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function hm(epoch) {
  const d = new Date(epoch * 1000);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}
const lower1 = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/* ---------- merge the fixture into one view ---------- */
function buildView(fx, scenId) {
  const sc = fx.scenarios.find(s => s.id === scenId) || fx.scenarios[0];
  const base = ep(fx.now);
  const now = sc.now ? ep(sc.now) : base;
  const shift = now - base; // night is "same data as normal" at 23:40: every timestamp moves with the clock
  const v = { sc, id: sc.id, base, now, shift, night: sc.theme === "night" || inQuiet(fx, now) };
  if (sc.id === "loading") return Object.assign(v, { global: "loading" });
  const feeds = sc.feeds !== undefined ? sc.feeds : JSON.parse(JSON.stringify(fx.feeds));
  if (!feeds.length) return Object.assign(v, { global: "empty" });

  // Sources and their freshness levels (product rule: multiples of interval_s, lost after 900 s).
  v.sources = feeds.map(f => {
    const age = (sc.sources && sc.sources[f.source.id] || {}).received_age_s ?? 0;
    const I = f.interval_s || TH.default_interval_s;
    const level = age <= I * TH.live_within_intervals ? "live" : age <= I * TH.late_within_intervals ? "late" : age <= TH.lost_after_s ? "stale" : "lost";
    return { id: f.source.id, label: f.source.label, machine: f.source.machine, interval: I, age, level, name: f.source.machine.charAt(0).toUpperCase() + f.source.machine.slice(1) };
  });
  const srcOf = id => v.sources.find(s => s.id === id);

  // Scenario patches.
  if (sc.id === "all-clear") {
    feeds.forEach(f => (f.attention = []));
    feeds.forEach(f => f.items.forEach(it => {
      if (it.id === "k-epub-footnotes") { it.state = "running"; it.needs_you = false; }
      if (it.id === "k-spellcheck-loader") { it.handoff.state = "complete"; it.needs_you = false; }
      it.needs_you = false;
    }));
  }
  if (sc.id === "trouble" && sc.supervision_down) feeds.find(f => f.source.id === "kestrel-main").attention.push(sc.supervision_down);

  // Machines: the machine's own source wins; others only probe it.
  const mById = {};
  feeds.forEach(f => f.machines.forEach(m => {
    const own = f.source.machine === m.id;
    if (!mById[m.id] || own) mById[m.id] = Object.assign({}, m, { source: own ? f.source.id : (mById[m.id] || {}).source || f.source.id, own });
  }));
  v.machines = Object.values(mById).map(m => Object.assign(m, { level: (srcOf(m.source) || {}).level || "live" }));

  v.items = feeds.flatMap(f => f.items.map(it => Object.assign({}, it, { source: f.source.id, level: srcOf(f.source.id).level })));
  v.attention = feeds.flatMap(f => (f.attention || []).map(a => Object.assign({}, a, { source: f.source.id, level: srcOf(f.source.id).level })));
  // A silent source becomes a call of its own (host behaviour: stale = action, lost = critical).
  v.sources.forEach(s => {
    if (s.level === "stale" || s.level === "lost") v.attention.push({ id: "source:" + s.id, kind: "source", severity: s.level === "lost" ? "critical" : "action",
      title: `No signal from ${s.name}`, detail: "Its items, machine and numbers below are last known.", how: "Check that it is running and can reach this host",
      sinceEpoch: base - s.age, machine: s.machine, silent: true, level: "live" });
  });
  v.attention.forEach(a => (a.t = a.since ? ep(a.since) : a.sinceEpoch));
  v.attention.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3) || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.t - b.t);
  v.calls = v.attention.filter(a => a.severity !== "info");
  v.info = v.attention.filter(a => a.severity === "info");

  const seen = new Set();
  v.done = feeds.flatMap(f => f.done || []).filter(d => !seen.has(d.title) && seen.add(d.title)).map(d => Object.assign({}, d, { t: ep(d.at) })).sort((a, b) => b.t - a.t);
  v.next = feeds.flatMap(f => f.next || []);
  v.groups = feeds.flatMap(f => f.groups || []);
  v.meters = feeds.flatMap(f => (f.meters && f.meters.accounts) || []);

  const levels = v.sources.map(s => s.level);
  v.global = sc.host_unreachable_s ? "hostdown" : levels.every(l => l === "lost") ? "lost" : "ok";
  v.hostDown = sc.host_unreachable_s || 0;
  v.newestAge = Math.min(...v.sources.map(s => s.age));
  return v;
}
function inQuiet(fx, now) {
  const q = fx.display && fx.display.quiet_hours;
  if (!q) return false;
  const d = new Date(now * 1000), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const [sh, sm] = q.start.split(":").map(Number), [eh, em] = q.end.split(":").map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  return a > b ? m >= a || m < b : m >= a && m < b;
}

/* ---------- what each lane is doing, in words ---------- */
function stepOf(it) {
  const p = it.progress || {}, c = p.current;
  if (!c) return null;
  const st = (p.steps || []).find(s => s.id === c.step);
  return Object.assign({}, c, { label: st ? st.label : c.step });
}
function lane(it, v) {
  const p = it.progress || {}, c = stepOf(it);
  const L = { it, glyph: "moving", tag: null, tagKind: "calm", line: "", rank: 9, off: false, bar: null, rng: "" };
  const has = p.percent_floor != null;
  if (has) {
    L.rng = p.percent_floor === p.percent_ceiling ? `${p.percent_floor}%` : `${p.percent_floor}–${p.percent_ceiling}%`;
    L.bar = { floor: p.percent_floor, ceil: p.percent_ceiling, color: "--blue" };
  }
  const flags = it.flags || [];
  const longRun = c && c.p90_s && c.elapsed_s > c.p90_s;
  const stepWords = c ? `${lower1(c.label)} ${dur(c.elapsed_s, true)} of ${dur(c.typical_s)}` : "";
  L.line = stepWords || lower1(it.doing || "");
  const byId = id => v.items.find(x => x.id === id);

  if (it.state === "done" || (it.handoff && it.handoff.state === "complete")) {
    Object.assign(L, { glyph: "done", tag: "LANDED", tagKind: "calm", line: lower1(it.doing || "complete"), rank: 20 });
    if (L.bar) L.bar.color = "--mint";
  } else if (it.needs_you && it.handoff && it.handoff.state === "awaiting_you") {
    Object.assign(L, { glyph: "approve", tag: "YOUR MERGE", tagKind: "amber", line: `ready ${dur(v.base - ep(it.handoff.since))}`, rank: 1, call: true });
    if (L.bar) L.bar.color = "--amber";
  } else if (it.needs_you) {
    Object.assign(L, { glyph: "call", tag: "YOUR CALL", tagKind: "amber", line: `${lower1(c ? c.label : "")} stopped ${dur(v.base - ep(c && c.waiting_since))}`, rank: 0, call: true });
    if (L.bar) L.bar.color = "--amber";
  } else if (it.state === "failed") {
    Object.assign(L, { glyph: "failed", tag: c && c.round ? `FAILED R${c.round}` : "FAILED", tagKind: "red", line: flags.includes("retrying") ? `${lower1(c.label)} failed, retrying` : stepWords, rank: 2, off: true });
    if (L.bar) L.bar.color = "--red";
  } else if (it.state === "unknown") {
    Object.assign(L, { glyph: "unknown", tag: "NO WORD", tagKind: "fog", line: lower1(it.doing || ""), rank: 4, off: true });
  } else if (it.state === "blocked") {
    const dep = (it.state_detail || "").replace(/^blocked on /, "");
    const d = byId(dep);
    Object.assign(L, { glyph: "blocked", tag: "BLOCKED", tagKind: "line", line: d ? `waits on ${d.title.toLowerCase()}` : lower1(it.doing), rank: 5, off: true });
    if (L.bar) L.bar.color = "--ink2";
  } else if (longRun) {
    const quiet = c.activity === "quiet" ? `, quiet ${dur(c.last_activity_age_s)}` : "";
    Object.assign(L, { glyph: "long", tag: "RUNNING LONG", tagKind: "line", line: `${lower1(c.label)} ${dur(c.elapsed_s, true)} of ${dur(c.typical_s)}${quiet}`, rank: 3, off: true });
  } else if (p.regressed) {
    Object.assign(L, { glyph: "round", tag: c && c.round ? `ROUND ${c.round}` : "ROUND 2", tagKind: "line", line: `back to ${lower1(c.label)}, ${p.basis === "default" ? "default weights" : stepWords}`, rank: 6, off: true });
  } else if (it.state === "waiting") {
    Object.assign(L, { glyph: "mate", tag: "ASKED LEAD", tagKind: "calm", line: lower1(it.doing || ""), rank: 12 });
    if (L.bar) L.bar.color = "--ink2";
  } else if (it.kind === "scout") {
    const r = it.reported;
    Object.assign(L, { glyph: "scout", tag: "SCOUT", tagKind: "calm", line: r ? `says ~${r.percent}%: ${r.label}` : lower1(it.doing || ""), rank: 13, rng: "" });
  } else if (p.basis === "coarse") {
    Object.assign(L, { glyph: "coarse", tag: "STATE ONLY", tagKind: "calm", line: lower1(it.doing || ""), rank: 14 });
  } else {
    L.rank = 10;
    if (it.handoff && it.handoff.state === "automatic") L.tag = "LANDS ITSELF";
    if (it.reported && it.reported.percent != null) L.line += `; says ${it.reported.percent}%`;
  }
  if (it.level === "stale" || it.level === "lost") { L.fog = true; L.glyphFog = true; }
  return L;
}

/* ---------- pieces ---------- */
function marquee(v) {
  const m = el("header", "marquee");
  const bulbs = el("span", "bulbs", el("i"), el("i"), el("i"));
  m.append(el("div", "brand", bulbs, el("span", "led", "Weatherdeck"), bulbs.cloneNode(true)));
  if (v && v.items) {
    const projects = new Set(v.items.map(i => i.group)).size;
    m.append(el("div", "facts", px(`${projects} projects`), px(`${v.machines.length} machines`), px(`${v.items.length} lanes`)));
  } else m.append(el("div", "facts", px(v && v.global === "empty" ? "no sources yet" : "connecting")));
  return m;
}

function hud(v, opts = {}) {
  const box = el("section", "hud");
  box.setAttribute("aria-label", "Score line");
  const blank = opts.blank;
  // CALLS, where 1UP sits: the biggest number on the board
  const lastKnown = !blank && v.global === "lost";
  const n = blank ? null : lastKnown ? v.calls.filter(c => !c.silent).length : v.calls.length;
  const calls = el("div", "slot calls" + (lastKnown ? " fog" : ""));
  calls.append(el("span", "hero" + (n ? "" : " zero"), n == null ? "-" : String(n)));
  calls.append(el("div", "stack", px("Calls", "lab"), el("div", "stack words" + (n ? "" : " zero"),
    lastKnown ? [px("last"), px("known")] : n ? [px("Waiting"), px("on you")] : n === 0 ? [px("Nothing"), px("waits")] : [])));
  box.append(calls);
  // LANDED, the score in the centre
  const landed = el("div", "slot landed");
  const ls = el("div", "stack");
  if (blank) ls.append(el("div", "row", el("span", "num dash", "-"), el("div", "stack", px("Landed", "lab"), px("today", "lab"))));
  else {
    const count = v.done.length;
    const numEl = el("span", "num", String(count));
    numEl.dataset.roll = String(count);
    ls.append(el("div", "row", spr("done", 1), numEl, el("div", "stack", px("Landed", "lab"), px("today", "lab"))));
    const st = streak(v);
    if (st.now >= 2) ls.append(px(`x${st.now} streak`, "streak"));
    else if (v.done[0]) ls.append(px(`last ${dur(v.base - v.done[0].t)} ago`, "sub"));
  }
  landed.append(ls);
  box.append(landed);
  // TIME and the live lamp, where the high score usually sits
  const time = el("div", "slot time");
  const ts = el("div", "stack");
  ts.append(el("div", "row", v.night ? el("div", "stack", px("Quiet", "lab"), px("hours", "lab")) : null, el("span", "num", hm(v.now))));
  if (blank) ts.append(el("div", "live", px(opts.liveWord || "connecting", "blank")));
  else {
    const bad = v.sources.filter(s => s.level === "stale" || s.level === "lost");
    const live = el("div", "live" + (bad.length || v.global === "hostdown" ? " bad" : ""), el("i", "lamp"));
    if (v.global === "hostdown") live.append(px(`host silent ${dur(v.hostDown)}`));
    else if (bad.length === v.sources.length) live.append(px(`all silent ${dur(Math.min(...bad.map(s => s.age)))}`));
    else if (bad.length) live.append(px(`${bad.map(s => s.name).join(", ")} silent ${dur(Math.max(...bad.map(s => s.age)))}`));
    else live.append(px(`live ${dur(v.newestAge)}`));
    ts.append(live);
  }
  time.append(ts);
  box.append(time);
  return box;
}

function streak(v) {
  // A streak is a run of landings each within an hour of the last; "now" counts only if the latest is under an hour old.
  const ts = v.done.map(d => d.t);
  const chains = [];
  ts.forEach((t, i) => { if (i && ts[i - 1] - t <= 3600) chains[chains.length - 1].push(t); else chains.push([t]); });
  const now = ts.length && v.base - ts[0] <= 3600 ? chains[0].length : 0;
  return { now, chains };
}

function callsPanel(v) {
  if (!v.calls.length) {
    const wrap = el("section", "framewrap clear");
    wrap.setAttribute("aria-label", "Waiting on you");
    wrap.append(el("div", "notch", px("Player 1")));
    const fr = el("div", "frame");
    fr.append(spr("player", 3), el("div", "stack", el("div", "head big", "All clear"), px("Player 1 ready", "ready"),
      el("div", "text", v.info.length ? `Nothing is waiting on you. Also: ${lower1(v.info[0].title)}.` : "Nothing is waiting on you.")));
    wrap.append(fr);
    return wrap;
  }
  const wrap = el("section", "framewrap move");
  wrap.setAttribute("aria-label", `Waiting on you: ${v.calls.length}`);
  wrap.setAttribute("role", "region");
  wrap.append(el("div", "notch", el("span", "head", "Player 1, your move")));
  const fr = el("div", "frame");
  const list = el("div", "list");
  v.calls.forEach((a, i) => {
    const top = i === 0;
    const glyph = a.severity === "critical" ? "critical" : a.kind === "approval" ? "approve" : a.kind === "machine" ? "warn" : a.kind === "capacity" ? "capacity" : "call";
    const row = el("div", "call" + (top ? " top" : "") + (a.severity === "critical" ? " crit" : ""));
    row.append(el("div", "ic", spr(glyph, top ? 2 : 1)));
    const body = el("div", "body");
    const t = el("div", "title" + (S.mode === "phone" ? "" : " clip"), a.title);
    t.title = a.title;
    const phoneMode = S.mode === "phone";
    const age = px(a.t ? dur(v.base - a.t, !top && !phoneMode) : "", "age low");
    const tl = el("div", "tline", t, top || phoneMode ? null : age);
    if (a.severity === "critical") tl.prepend(el("span", "plate red px warnbar", a.silent ? "No signal" : "Warning"));
    if (a.level === "stale" || a.level === "lost") tl.insertBefore(px("last known", "lk"), tl.querySelector(".age"));
    body.append(tl);
    if (top || S.mode === "phone") {
      const it = a.item && v.items.find(x => x.id === a.item);
      const bits = [a.how];
      if (it && a.kind === "decision") bits.push(`Stops ${lower1(it.title)}`);
      else if (a.detail && top && !a.silent) bits.push(a.detail.split(". ")[0].replace(/\.$/, ""));
      const where = el("div", "text where", bits.filter(Boolean).join(". ") + ".");
      body.append(phoneMode ? el("div", "sline", age, where) : top ? el("div", "sline", where, age) : where);
    } else if (phoneMode) body.append(age);
    row.append(body);
    list.append(row);
  });
  fr.append(list, el("div", "cursor", spr("cursor", 1)));
  wrap.append(fr);
  if (v.info.length) {
    // Info never counts: one "also" line set into the bottom edge of the window.
    wrap.classList.add("has-foot");
    const also = el("div", "notch foot also", px("Also"), el("span", "text clip", v.info.map(a => a.title).join("; ")));
    wrap.append(also);
  }
  return wrap;
}

function barEl(L, wide) {
  const b = el("div", "bar" + (L.bar ? "" : " none"));
  b.style.width = wide;
  if (L.bar) {
    const c = L.fog ? "--fog" : L.bar.color;
    b.style.setProperty("--c", `var(${c})`);
    const f = el("i", "floor"); f.style.width = L.bar.floor + "%";
    const s = el("i", "span"); s.style.left = L.bar.floor + "%"; s.style.width = Math.max(1, L.bar.ceil - L.bar.floor) + "%";
    b.append(f, s);
  }
  b.setAttribute("aria-hidden", "true");
  return b;
}

function tile(L) {
  const t = el("article", "tile" + (L.fog ? " fogged" : ""));
  t.append(el("div", "ic", spr(L.fog && L.glyph === "moving" ? "unknown" : L.glyph, 1)));
  const title = el("div", "title clip", L.it.title);
  title.title = L.it.title;
  title.style.fontSize = "var(--fs-tile)";
  const tags = el("div", "tags");
  if (L.tag) tags.append(el("span", `plate ${L.tagKind} px`, L.tag));
  t.append(el("div", "top", title, tags));
  const words = el("span", "text", L.line);
  t.append(el("div", "state", L.fog ? el("span", "lkw", px("last known", "lk"), words) : words, L.rng ? px(L.rng, "rng") : null));
  t.append(barEl(L, "100%"));
  return t;
}

function stagesPanel(v) {
  const lanes = v.items.map(it => lane(it, v));
  const wrap = el("section", "framewrap stages");
  wrap.setAttribute("aria-label", "Lanes");
  const fr = el("div", "frame");
  const phone = S.mode === "phone";
  // TV: pin what is off course one by one; fold the rest into mini tiles and a count.
  const off = lanes.filter(L => L.off).sort((a, b) => a.rank - b.rank);
  const calm = lanes.filter(L => !L.off && !L.call && L.glyph !== "done").sort((a, b) => a.rank - b.rank);
  const callLanes = lanes.filter(L => L.call);
  const shown = phone ? [...callLanes, ...off, ...calm] : off.slice(0, off.length > 6 ? 5 : 6);
  wrap.append(el("div", "notch", px("Stage select", "sec"),
    px(phone ? `${lanes.filter(L => L.glyph !== "done").length} lanes` : `${off.length} off course`, "dim")));
  const grid = el("div", "grid");
  shown.forEach(L => grid.append(tile(L)));
  fr.append(grid);
  if (!phone) {
    const scouts = calm.filter(L => L.glyph === "scout").length;
    const roster = el("div", "notch right roster");
    const minis = el("div", "minis");
    calm.forEach(L => { const m = el("span", "mini", spr(L.glyph, 1)); m.title = L.it.title; minis.append(m); });
    const extra = off.length - shown.length;
    const words = [`${calm.length} on pace`];
    if (scouts) words.push(`${scouts} scouts`);
    if (callLanes.length) words.push(`${callLanes.length} with you`);
    if (extra > 0) words.unshift(`+${extra} off course`);
    roster.append(minis, px(words.join(", ")));
    wrap.append(fr, roster);
    // The machines stand on the bottom edge like spare lives.
    wrap.classList.add("has-foot");
    const foot = livesRow(v);
    foot.classList.add("notch", "foot", "wide");
    wrap.append(foot);
  } else wrap.append(fr);
  return wrap;
}

function scoresPanel(v, maxRows) {
  const wrap = el("section", "framewrap scores");
  wrap.setAttribute("aria-label", "Landed today");
  wrap.append(el("div", "notch", px("High scores", "sec"), px(S.mode === "phone" ? "landed today" : "today", "dim")));
  const fr = el("div", "frame");
  const st = streak(v);
  const combo = new Map();
  st.chains.forEach(ch => { if (ch.length >= 2) combo.set(ch[0], ch.length); });
  // Classic initials layout as two-line entries: time, three-letter tag, how; then what landed. Newest first.
  const hs = el("div", "hs");
  const ol = el("ol");
  v.done.forEach((d, i) => {
    const c = combo.get(d.t);
    const what = el("div", "row-t clip", d.title);
    what.title = d.title;
    ol.append(el("li", i === 0 ? "newest" : "", el("div", "l1", px(hm(d.t + v.shift), "t"), px(TAGS[d.group] || "", "tag"),
      c ? px(`x${c}`, "x") : null, px(HOW[d.via] || d.via, "how")), what));
  });
  hs.append(ol);
  fr.append(hs);
  wrap.append(fr);
  return wrap;
}

function machineWord(m) {
  if (m.level === "lost" || m.level === "stale") return { cls: "silent", pip: "pipSilent", word: "silent" };
  if (m.status === "down") return { cls: "down", pip: "pipDown", word: "not answering" };
  if (m.status === "warn") {
    const d = (m.disks || []).find(x => x.free_gb != null && x.warn_gb != null && x.free_gb <= x.warn_gb);
    return { cls: "warn", pip: "pipWarn", word: d ? `disk ${d.free_gb} GB` : "struggling" };
  }
  return { cls: "ok", pip: "pipOk", word: "ok" };
}
function livesRow(v) {
  const row = el("footer", "lives");
  row.setAttribute("aria-label", "Machines");
  const ms = el("div", "ms");
  const order = m => (m.level === "lost" || m.level === "stale" || m.status !== "ok" ? 0 : m.own && m.id === v.sources[0].machine ? 1 : 2);
  [...v.machines].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id)).forEach(m => {
    const w = machineWord(m);
    const n = v.items.filter(i => i.machine === m.id).length;
    const src = v.sources.find(s => s.machine === m.id);
    const word = w.cls === "silent" && src ? `silent ${dur(src.age)}` : w.word;
    ms.append(el("div", "life " + w.cls, spr("machine", 1), px(m.label, "name"), spr(w.pip, 1), px(word, "word"), px(`${n} lanes`, "n")));
  });
  row.append(ms);
  const q = v.next.filter(n => n.kind === "queued").length;
  const gate = v.next.find(n => n.kind === "gate");
  if (S.mode !== "phone") row.append(el("div", "credit", px("Next up"), el("b", "px", String(v.next.length))));
  return row;
}

/* Phone only: the 30-second layer (queue, releases, allowance, machine vitals). */
function moreSections(v) {
  const box = el("div", "more");
  const sec = (title, sub, ...kids) => {
    const w = el("section", "framewrap");
    w.setAttribute("aria-label", title);
    w.append(el("div", "notch", px(title, "sec"), sub ? px(sub, "dim") : null));
    w.append(el("div", "frame", kids));
    return w;
  };
  box.append(sec("Next stage", `${v.next.length} waiting`, v.next.map(n => el("div", "kv", el("span", "row-t k", n.title), px(TAGS[n.group] || "", "low"),
    el("span", "text s", n.until ? `${n.reason}, until ${n.until}` : n.reason)))));
  box.append(sec("Releases", null, v.groups.filter(g => g.checkpoint).map(g => {
    const c = g.checkpoint, waits = (c.next.waiting_on || []).map(id => v.items.find(i => i.id === id)?.title || id).join(", ");
    return el("div", "kv", el("span", "row-t k", `${g.label} ${c.next.version}`), px(`gate ${c.gate.value === "pass" ? "passing" : c.gate.value === "fail" ? "failing" : "not run"}`, "low"),
      el("span", "text s", `Live ${c.live.version}. Waits on ${waits}; ${c.next.items_ready} items ready.`));
  })));
  box.append(sec("Power", "allowance", v.meters.flatMap(a => a.windows.map(w => {
    const m = el("div", "meter" + (w.percent_remaining < 25 ? " low" : ""), el("i"));
    m.firstChild.style.width = w.percent_remaining + "%";
    const runway = a.runway && a.runway.status === "exhausts_before_reset" && w.id === "week" ? `empty ${hm(ep(a.runway.projected_empty_at) + v.shift)}, before the ${hm(ep(w.resets_at) + v.shift)} reset` : `resets ${hm(ep(w.resets_at) + v.shift)}`;
    return el("div", "kv", el("span", "row-t k", `${a.machine.charAt(0).toUpperCase() + a.machine.slice(1)} ${w.label.toLowerCase()}`), px(`${w.percent_remaining}% left`, "low"), m, el("span", "text s", runway));
  }))));
  box.append(sec("Machines", null, v.machines.map(m => {
    const bits = [];
    if (m.load) bits.push(`load ${m.load.l1} on ${m.load.cores} cores`);
    if (m.mem) bits.push(`mem ${m.mem.used_pct}%, swap ${m.mem.swap_used_pct}%`);
    (m.disks || []).forEach(d => bits.push(`${d.label.toLowerCase()} ${d.free_gb} GB free`));
    const w = machineWord(m);
    return el("div", "kv", el("span", "row-t k", `${m.label}${m.role ? ", " + m.role : ""}`), px(w.word, "low"), el("span", "text s", (m.level === "stale" || m.level === "lost" ? "Last known: " : "") + bits.join("; ")));
  })));
  return box;
}

/* ---------- takeovers ---------- */
function lostTakeover(v) {
  const newest = Math.min(...v.sources.map(s => s.age));
  const tk = el("div", "takeover inline");
  tk.setAttribute("role", "alert");
  const facts = el("div", "facts");
  v.sources.forEach(s => facts.append(px(s.label, "k low"), px(`silent ${dur(s.age)}`, "v")));
  facts.append(px("Last known", "k"), px(`${v.items.length} lanes, ${v.calls.filter(c => !c.silent).length} waiting on you`, "v low"));
  tk.append(el("div", "card red", spr("nosignal", 4), el("div", "h2", "No signal"),
    el("div", "title", `No word from any source for ${dur(newest)}`),
    el("p", "text msg", `This board shows the last known state from ${hm(v.now - newest)}. Treat everything on it as unconfirmed.`), facts));
  return tk;
}
function hostTakeover(v) {
  const tk = el("div", "takeover over");
  tk.setAttribute("role", "alert");
  const n = el("div", "giant", String(TH.retry_every_s - 1));
  n.id = "continue-n";
  const facts = el("div", "facts");
  const silentFor = px(dur(v.hostDown), "v");
  silentFor.id = "host-for";
  facts.append(px("No answer for", "k"), silentFor, px("Newest data", "k"), px(`from ${hm(v.now - v.newestAge)}, ${dur(v.newestAge)} ago`, "v low"),
    px("Likely", "k"), el("span", "text v", "The host is asleep or restarting, the process stopped, or this device lost the network."));
  tk.append(el("div", "card", el("div", "h2", "Continue?"), n, px("next try in seconds", "k"),
    el("div", "title", "This screen can't reach its host"), facts));
  return tk;
}
function emptyScreen(v) {
  const tk = el("div", "takeover inline");
  tk.append(el("div", "card", spr("player", 3), el("div", "h2", "Insert a source"),
    el("div", "title", "No source has reported yet"),
    el("p", "text msg", "Any tool can send a feed with one HTTP POST to this host's /api/ingest; see docs/feed-spec.md. The board fills in when the first feed arrives.")));
  return tk;
}

/* ---------- the field: a sparse, still starfield in whole art pixels (decoration only, never behind text panels' content) ---------- */
function starfield(screen) {
  const c = document.createElement("canvas");
  c.className = "stars";
  c.setAttribute("aria-hidden", "true");
  const ap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ap")) * (devicePixelRatio || 1);
  const W = Math.round(screen.clientWidth * (devicePixelRatio || 1)), H = Math.round(screen.clientHeight * (devicePixelRatio || 1));
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  const css = getComputedStyle(document.documentElement);
  const cols = [css.getPropertyValue("--rule2").trim(), css.getPropertyValue("--rule").trim(), css.getPropertyValue("--trim").trim()];
  let seed = 20261008;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const n = Math.round((W / ap) * (H / ap) / 900);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rnd() * W / ap) * ap, y = Math.floor(rnd() * H / ap) * ap, k = rnd();
    g.fillStyle = cols[k < 0.7 ? 1 : k < 0.95 ? 0 : 2];
    g.fillRect(x, y, ap, ap);
    if (k > 0.985) { g.fillRect(x - ap, y, ap * 3, ap); g.fillRect(x, y - ap, ap, ap * 3); }
  }
  return c;
}

/* ---------- compose ---------- */
function render() {
  const v = buildView(S.fx, S.scen);
  S.v = v;
  document.documentElement.toggleAttribute("data-night", !!v.night);
  document.documentElement.dataset.motion = S.motion;
  const screen = document.getElementById("screen");
  screen.textContent = "";
  if (S.stars !== false) screen.append(starfield(screen));
  const board = el("main", "board");
  board.append(el("h1", "sr", `Weatherdeck fleet board, scenario ${v.id}`));
  screen.append(board);
  const phone = S.mode === "phone";

  if (v.global === "loading" || v.global === "empty") {
    board.append(marquee(v), hud(v, { blank: true, liveWord: v.global === "empty" ? "no sources" : "connecting" }));
    if (v.global === "loading") {
      const msg = el("div", "takeover inline");
      msg.append(el("div", "card", el("div", "px", "Loading the board", el("span", "dots", el("i"), el("i"), el("i")))));
      board.append(msg);
    } else board.append(emptyScreen(v));
    return finish(board, v);
  }
  if (v.global === "lost") {
    board.append(marquee(v), hud(v), lostTakeover(v));
    return finish(board, v);
  }
  if (v.calls.some(c => c.severity === "critical")) screen.append(el("div", "vignette"));
  board.append(marquee(v), hud(v));
  if (phone) board.append(livesRow(v));
  if (phone) board.append(callsPanel(v), stagesPanel(v), scoresPanel(v, 0)); // phone: same order as the glance hierarchy
  else {
    const mid = el("div", "mid");
    mid.append(callsPanel(v), scoresPanel(v, 0));
    board.append(mid, stagesPanel(v));
  }
  if (phone) board.append(moreSections(v));
  if (v.global === "hostdown") {
    board.classList.add("fogboard");
    screen.append(hostTakeover(v));
    startContinue(v);
  }
  return finish(board, v);
}

function finish(board, v) {
  // Announce once: the dialog opens, the "!" bounces, the score rolls; then the board is still.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || S.motion === "still";
  if (!reduce) {
    board.classList.add("anim");
    const n = board.querySelector(".landed .num[data-roll]");
    if (n && !v.night) {
      rollUp(n, Number(n.dataset.roll));
      const f = el("span", "landflash", spr("star", 2));
      n.parentNode.style.position = "relative";
      n.parentNode.append(f);
    }
    setTimeout(() => board.classList.remove("anim"), 2600);
  }
  tighten(board); fitTV(board);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tighten(board); fitTV(board); });
}

function rollUp(node, target) {
  let k = 0;
  const steps = Math.min(target, 7);
  node.textContent = "0";
  const iv = setInterval(() => {
    k++;
    node.textContent = String(Math.round(target * k / steps));
    if (k >= steps) clearInterval(iv);
  }, Math.floor(900 / Math.max(steps, 1)));
}

function startContinue(v) {
  clearInterval(S.tick);
  const t0 = performance.now();
  S.tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    const left = Math.max(0, TH.retry_every_s - 1 - Math.floor(s % TH.retry_every_s));
    const n = document.getElementById("continue-n"), f = document.getElementById("host-for");
    if (n) n.textContent = String(left);
    if (f) f.textContent = dur(v.hostDown + s);
  }, 250);
}

/* TV only: if the lanes would spill off the screen (a busy call list), tighten spacing in whole art pixels. */
function tighten(board) {
  if (S.mode !== "tv") return;
  const ap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ap"));
  const bottom = q => { const e = board.querySelector(q); return e ? e.getBoundingClientRect().bottom : 0; };
  const over = () => board.scrollHeight > board.clientHeight + 1 ||
    bottom(".stages .grid") > bottom(".stages .frame") - 6 * ap || bottom(".move .list") > bottom(".move .frame") - 6 * ap ||
    bottom(".stages") > board.getBoundingClientRect().bottom - 9 * ap;
  board.classList.remove("tight", "tighter");
  if (over()) board.classList.add("tight");
  if (over()) board.classList.add("tighter");
}

/* TV only: the score table keeps the newest entries that fit and says how many earlier ones it folded. */
function fitTV(board) {
  if (S.mode !== "tv") return;
  const fr = board.querySelector(".scores .frame");
  if (!fr) return;
  const items = [...fr.querySelectorAll(".hs li")];
  items.forEach(li => (li.hidden = false));
  fr.querySelectorAll(".more-rows").forEach(n => n.remove());
  const note = px("", "more-rows");
  fr.querySelector(".hs").append(note);
  let hidden = 0;
  while (fr.scrollHeight > fr.clientHeight + 1 && items.length - hidden > 1) {
    hidden++;
    items[items.length - hidden].hidden = true;
    note.textContent = `+${hidden} earlier today`;
  }
  if (!hidden) note.remove();
}

/* ---------- the pixel grid: art pixel snapped to whole device pixels ---------- */
function layout() {
  const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1;
  const phone = W < 720 || H > W * 1.15;
  S.mode = phone ? "phone" : "tv";
  document.body.classList.toggle("phone", phone);
  const r = document.documentElement.style;
  let ap;
  if (phone) {
    ap = Math.max(1, Math.round(2 * dpr)) / dpr; // 2 CSS px = 6 device px at DPR 3
    const lab = 11 * Math.max(1, Math.round(4 / 3 * dpr)) / dpr; // Departure Mono at 4 device px per font px
    set(r, { "--fs-label": lab, "--lh-label": lab * 8 / 11, "--fs-hero": 68, "--lh-hero": 40, "--fs-score": 34, "--lh-score": 20,
      "--fs-head": 27, "--lh-head": 15, "--fs-led": 16, "--fs-title": 18, "--fs-title-top": 20, "--fs-call": 17, "--fs-text": 15.5, "--fs-row": 15.5, "--fs-tile": 17 });
  } else {
    ap = Math.max(1, Math.floor(Math.min(W / 640, H / 360) * dpr)) / dpr;
    set(r, { "--fs-label": 11 * ap, "--lh-label": 8 * ap, "--fs-hero": 68 * ap, "--lh-hero": 40 * ap, "--fs-score": 34 * ap, "--lh-score": 20 * ap,
      "--fs-head": 27 * ap, "--lh-head": 15 * ap, "--fs-led": 12 * ap, "--fs-title": 14 * ap, "--fs-title-top": 14 * ap, "--fs-call": 13 * ap, "--fs-text": 12 * ap, "--fs-row": 11.5 * ap, "--fs-tile": 12.5 * ap });
  }
  r.setProperty("--ap", ap + "px");
}
function set(style, o) { for (const k in o) style.setProperty(k, o[k] + "px"); }

/* Burn-in: drift the whole board one art pixel at a time inside a 3 x 2 box, every 4 minutes. */
function startDrift() {
  const path = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
  let i = 0;
  clearInterval(S.drift);
  S.drift = setInterval(() => {
    i = (i + 1) % path.length;
    const r = document.documentElement.style;
    r.setProperty("--dx", path[i][0]); r.setProperty("--dy", path[i][1]);
  }, 240000);
}

/* ---------- dev switcher and routing ---------- */
function readHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const parts = h.split("+");
  S.scen = SCENARIOS.includes(parts[0]) ? parts[0] : "normal";
  S.dev = parts.includes("dev") || S.devSticky;
  if (parts.includes("still")) S.motion = "still";
}
function devPanel() {
  let d = document.getElementById("dev");
  if (!d) {
    d = el("nav", "dev");
    d.id = "dev";
    d.setAttribute("aria-label", "Scenario switcher");
    document.body.append(d);
  }
  d.textContent = "";
  const opts = el("div", "opts");
  SCENARIOS.forEach(s => {
    const a = el("a", "", s);
    a.href = "#" + s + (S.dev ? "+dev" : "");
    if (s === S.scen) a.setAttribute("aria-current", "true");
    opts.append(a);
  });
  const mot = el("button", "", `motion: ${S.motion}`);
  mot.setAttribute("aria-pressed", S.motion === "still" ? "true" : "false");
  mot.onclick = () => { S.motion = S.motion === "still" ? "calm" : "still"; render(); devPanel(); };
  d.append(el("div", "", "Scenario (D hides this)"), opts, mot, el("div", "", S.fx ? (S.fx.scenarios.find(x => x.id === S.scen) || {}).what || "" : ""));
  d.hidden = !S.dev;
}

async function boot() {
  layout();
  readHash();
  try {
    const res = await fetch("fixture.json", { cache: "no-store" });
    S.fx = await res.json();
  } catch (e) {
    document.getElementById("screen").textContent = "Could not read fixture.json. Serve this folder over HTTP (for example: python3 -m http.server) and open index.html from there.";
    return;
  }
  render();
  devPanel();
  startDrift();
  addEventListener("hashchange", () => { clearInterval(S.tick); readHash(); render(); devPanel(); });
  addEventListener("resize", () => { clearTimeout(S.rz); S.rz = setTimeout(() => { layout(); render(); }, 200); });
  addEventListener("keydown", e => {
    if (e.key === "d" || e.key === "D") { S.dev = !S.dev; S.devSticky = S.dev; devPanel(); }
  });
}
boot();
