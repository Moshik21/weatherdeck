/* Ship deck concept: lays out the stage on one art-pixel grid, renders the plates from the view,
   composes the scene and runs the little motion there is. */
(function () {
  "use strict";
  const SD = window.SD;
  const $ = (id) => document.getElementById(id);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") el.style.cssText = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  const CALL_W = 356; // the call dialog's width in art px on the TV (css .call)
  const SCENARIOS = ["normal", "all-clear", "trouble", "night", "one-source-silent", "lost", "host-down", "empty", "loading"];
  const SKIES = ["auto", "dawn", "day", "dusk", "night"];
  const MOTIONS = ["calm", "full", "still"];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let FX = null, fetchFailed = false;
  const opt = { scenario: "normal", sky: "auto", motion: "calm", dev: false };
  let timer = null, driftTimer = null;

  function readHash() {
    const parts = location.hash.replace(/^#/, "").split("&").filter(Boolean);
    opt.scenario = "normal"; opt.sky = "auto"; opt.motion = "calm"; opt.dev = false;
    for (const p of parts) {
      const [k, val] = p.split("=");
      if (SCENARIOS.includes(k)) opt.scenario = k;
      else if (k === "sky" && SKIES.includes(val)) opt.sky = val;
      else if (k === "motion" && MOTIONS.includes(val)) opt.motion = val;
      else if (k === "dev") opt.dev = true;
    }
  }
  function writeHash() {
    const p = [opt.scenario];
    if (opt.sky !== "auto") p.push("sky=" + opt.sky);
    if (opt.motion !== "calm") p.push("motion=" + opt.motion);
    if (opt.dev) p.push("dev");
    history.replaceState(null, "", "#" + p.join("&"));
    render();
  }

  // ---- Geometry: one art pixel is a whole number of device pixels ----------------------------
  function geometry() {
    const dpr = window.devicePixelRatio || 1;
    // The media query follows the initial containing block, which content overflow cannot widen.
    const phone = window.matchMedia("(max-width: 699px)").matches;
    document.body.dataset.layout = phone ? "phone" : "tv";
    const W = phone ? document.documentElement.clientWidth : window.innerWidth, H = window.innerHeight;
    const ap = phone ? Math.max(1, Math.round(2 * dpr)) / dpr : Math.max(1, Math.floor(Math.min(W / 640, H / 360) * dpr)) / dpr;
    const AW = Math.ceil(W / ap);
    const AH = phone ? 112 : Math.ceil(H / ap);
    const ox = phone ? 0 : Math.floor((AW - 640) / 2), oy = phone ? 0 : Math.floor((AH - 360) / 2);
    return { dpr, W, H, phone, ap, AW, AH, ox, oy };
  }

  // ---- Ship layout ----------------------------------------------------------------------------
  function shipLayout(v, g) {
    const P = g.phone
      ? { x0: 6, deck: 90, water: 104, top: 24, spacing: 9, minSec: 30, gap: 4, stern: 20, bow: 8, bowsprit: 10, sail: 0.8 }
      : { x0: g.ox + 384, deck: g.oy + 180, water: g.oy + 205, top: g.oy + 58, spacing: 10, minSec: 50, gap: 6, stern: 22, bow: 8, bowsprit: 10, sail: 1 };
    const L = { deck: P.deck, water: P.water, bowsprit: P.bowsprit, sections: [], masts: [], spacing: P.spacing, x0: P.x0 };
    let x = P.x0 + P.stern;
    const machines = v.machines.length ? v.machines : [];
    for (const m of machines) {
      const crew = v.lanes.filter((l) => l.machine === m.id && l.kind !== "scout").sort((a, b) => a.started - b.started);
      const scouts = v.lanes.filter((l) => l.machine === m.id && l.kind === "scout");
      const w = Math.max(crew.length * P.spacing, P.minSec);
      const sec = { m, crew, scouts, x0: x, x1: x + w, mastX: Math.round(x + w / 2) };
      L.sections.push(sec);
      const sw = Math.min(w - 4, g.phone ? 40 : 60);
      L.masts.push({ x: sec.mastX, top: P.top, nest: scouts.length > 0, nestY: P.top + 4, sail: { w1: Math.round(sw * 0.86 * P.sail), h1: Math.round(22 * P.sail), w2: Math.round(sw * P.sail), h2: Math.round(26 * P.sail) } });
      x += w + P.gap;
    }
    if (!machines.length) { // an empty ship at anchor: three bare masts
      for (let i = 0; i < 3; i++) { const sx = x + 20 + i * 70 * (g.phone ? 0.6 : 1); L.masts.push({ x: Math.round(sx), top: P.top + 10, nest: false, sail: { w1: 0, h1: 0, w2: 0, h2: 0 } }); }
      x += g.phone ? 140 : 210;
    }
    L.x1 = x - P.gap + P.bow;
    return L;
  }

  function stepName(l) {
    const pr = l.it.progress || {};
    const s = (pr.steps || []).find((x) => x.status === "current" || x.status === "failed");
    return s ? s.id : "";
  }

  function crewSpec(l, animated, frame, night) {
    const step = stepName(l);
    const tool = /build|review|rebase|intent|working|fuzzing/.test(step) ? "hammer" : "hoist";
    const f = animated ? (frame % 2) + 1 : 1;
    switch (l.kind) {
      case "call": return { pose: "scroll", mark: "needs" };
      case "merge": return { pose: "scroll", mark: "approve" };
      case "failed": return { pose: "worried", prop: "smoke" };
      case "blocked": return { pose: "crossed", prop: "crate" };
      case "unknown": return { pose: "stand", mode: "ghost", mark: "unknown" };
      case "mate": return { pose: "stand", flip: true };
      case "landed": return night ? { pose: "hammock" } : { pose: "sit", prop: "barrel" };
      case "long": return { pose: tool + "1", mark: "long" };
      default: return { pose: tool + f };
    }
  }

  function drawGlyph(ctx, name, x, y, color, dark) {
    const rows = SD.GLYPHS[name];
    const w = rows[0].length;
    const filled = (i, j) => rows[j] && rows[j][i] && rows[j][i] !== ".";
    ctx.fillStyle = dark;
    for (let j = -1; j <= rows.length; j++) for (let i = -1; i <= w; i++) {
      if (filled(i, j)) continue;
      if (filled(i + 1, j) || filled(i - 1, j) || filled(i, j + 1) || filled(i, j - 1)) ctx.fillRect(x + i, y + j, 1, 1);
    }
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === ".") return; ctx.fillStyle = ch === "#" ? color : dark; ctx.fillRect(x + i, y + j, 1, 1); }));
  }

  // ---- The scene ------------------------------------------------------------------------------
  function sceneSpec(v, g, L, t) {
    const night = v.night;
    const tod = opt.sky !== "auto" ? opt.sky : v.tod;
    const st = SD.STATUS[night ? "night" : "day"];
    const animated = SD.animatedLanes(v, effectiveMotion());
    const crew = [], nests = [];
    const frame = Math.floor(t.ms / 500);
    if (L && !v.loading && !v.empty) {
      L.sections.forEach((sec, si) => {
        const n = sec.crew.length;
        const start = sec.x0 + Math.round((sec.x1 - sec.x0 - n * L.spacing) / 2) + Math.round((L.spacing - 16) / 2);
        sec.crew.forEach((l, i) => {
          const sp = crewSpec(l, animated.has(l.id), frame, night);
          const look = SD.crewLook(l.id, l.group);
          look.ghost = st.fog;
          crew.push({ ...sp, x: start + i * L.spacing, y: L.deck - 23, look, lane: l });
        });
        if (sec.scouts.length) {
          const m = L.masts[si];
          const ns = { mast: m, crew: [] };
          sec.scouts.forEach((l, i) => { const look = SD.crewLook(l.id, l.group); ns.crew.push({ pose: "spy", x: m.x - 8 + i * 6, y: m.nestY - 12, look, lane: l }); });
          nests.push(ns);
        }
      });
    }
    const S = { trouble: st.trouble, W: g.AW, H: g.AH, horizon: g.phone ? 58 : g.oy + 146, tod, night, frame, crew, nests, weather: v.weather, ship: L };
    if (v.loading) { S.ship = null; }
    // The moon sits in the open sky between the call and the ship.
    S.moon = g.phone ? { x: g.AW - 30, y: 14 } : { x: g.ox + 20 + CALL_W + 4 + 10, y: g.oy + 52 };
    // Island ahead on the horizon when there is queued work.
    if (v.next && v.next.length) S.island = { x: g.phone ? g.AW - 46 : g.AW - Math.max(40, g.ox) - 10 };
    // Tern's local weather when its machine is struggling.
    if (L) S.degraded = L.sections.filter((s) => s.m.status === "warn" && s.m.fresh === "live").map((s) => ({ x: s.mastX + 2, y: L.masts[0].top - (g.phone ? 8 : 14) }));
    // Fog over what has gone quiet.
    const roll = t.fogStep < 4 ? (4 - t.fogStep) * 12 : 0;
    if (v.trust && v.trust.allLost) S.fog = "all";
    else if (L && v.trust) {
      const zones = L.sections.filter((s) => s.m.fresh !== "live").map((s) => ({ x0: s.x0 - 8 + roll, x1: Math.min(g.AW, s.x1 + 30 + roll), y0: L.masts[0].top - 18, y1: L.water + 8, d: s.m.fresh === "lost" ? 0.56 : 0.36 }));
      if (zones.length) S.fog = zones;
    }
    if (v.hostDownS) S.fog = [{ x0: 0, x1: g.AW, y0: 0, y1: S.horizon + 6, d: 0.22 }];
    S.flash = t.flash;
    S.vignette = v.critical && v.critical.length > 0 && !g.phone;
    // The crow: flies in and perches on the call, or rests at the stern when nothing waits.
    if (!v.loading && !v.empty) {
      const calls = v.calls.length > 0;
      let perch;
      if (calls) perch = g.phone ? { x: 10, y: g.AH - 14 } : { x: g.ox + 20 + CALL_W - 36, y: g.oy + 41 + 4 + 34 - 15 };
      else if (L) perch = { x: L.x0 + 2, y: L.deck - 16 - 14 };
      if (perch) {
        if (calls && t.crowStep < 6) {
          const from = L ? { x: L.masts[0].x, y: L.masts[0].top - 10 } : { x: g.AW, y: 0 };
          const k = (t.crowStep + 1) / 6;
          S.crow = { frame: t.crowStep % 2 ? "fly2" : "fly1", x: Math.round(from.x + (perch.x - from.x) * k), y: Math.round(from.y + (perch.y - from.y) * k - Math.sin(k * Math.PI) * 14) };
        } else S.crow = { frame: "perch", x: perch.x, y: perch.y };
      }
    }
    S.marks = crew.filter((c) => c.mark).map((c) => ({ name: c.mark, x: c.x + 2, y: c.y - (c.pose === "scroll" ? 12 : 8), color: c.lane.fresh !== "live" || c.mark === "unknown" ? st.fog : c.mark === "needs" || c.mark === "approve" ? st.needs : st.ink }));
    return S;
  }

  function paint(v, g, L, t) {
    const cv = $("scene");
    const ctx = cv.getContext("2d");
    const S = sceneSpec(v, g, L, t);
    // On the TV the crow flies over the plates, so it is drawn on its own small canvas above them.
    const crow = !g.phone && S.crow && v.calls.length ? S.crow : null;
    if (crow) delete S.crow;
    SD.paintScene(ctx, S);
    const cc = $("crow");
    cc.hidden = !crow;
    if (crow) {
      const c2 = cc.getContext("2d");
      c2.clearRect(0, 0, 20, 14);
      SD.drawCrow(c2, crow.frame, 0, 0, false, v.night);
      cc.style.left = (crow.x - g.ox) * g.ap + "px";
      cc.style.top = (crow.y - g.oy) * g.ap + "px";
    }
    for (const m of S.marks) drawGlyph(ctx, m.name, m.x, m.y, m.color, "#14100C");
    cv.setAttribute("aria-label", sceneLabel(v, S));
  }

  function sceneLabel(v, S) {
    if (v.loading) return "The sea, waiting for the first report";
    if (v.empty) return "An empty ship at anchor: no machine has reported yet";
    const w = { storm: "a storm", fog: "thick fog", "patchy-fog": "fog over part of the deck", clear: "clear weather" }[v.weather];
    return "The fleet as a ship at " + S.tod + " in " + w + ", " + v.lanes.length + " crew on deck" + (v.calls.length ? ", the lookout crow has brought " + v.calls.length + " calls" : "");
  }

  function effectiveMotion() { return reduced.matches ? "still" : opt.motion; }

  // ---- Plates ---------------------------------------------------------------------------------
  const GLYPH_OF = { call: "needs", merge: "approve", failed: "failed", blocked: "blocked", unknown: "unknown", long: "long", regressed: "regressed", mate: "mate", scout: "scout", landed: "done", moving: "moving" };
  function colorOf(kind, st) {
    return { call: st.needs, merge: st.needs, failed: st.trouble, blocked: st.trouble, unknown: st.fog, long: st.ink, regressed: st.ink, mate: st.ink2, scout: st.moving, landed: st.done, moving: st.moving }[kind] || st.ink;
  }
  const lbl = (text, cls) => h("span", { class: "lbl" + (cls ? " " + cls : ""), text });

  function lampFor(v) {
    if (!v.trust || v.loading || v.empty) return "silent";
    if (v.hostDownS) return "down";
    return v.trust.silent.length ? "silent" : "lamp";
  }

  function renderBar(v, g, st) {
    const bar = $("bar");
    bar.className = "bar plate";
    bar.replaceChildren();
    const clock = h("span", { class: "num clock", text: SD.clock(v.now) });
    const trust = h("div", { class: "trust" });
    const lamp = lampFor(v);
    trust.append(SD.glyphCanvas(lamp, lamp === "lamp" ? st.ink : st.fog, { cls: "pip" }));
    const tstack = h("div", { class: "stack" });
    if (v.loading) tstack.append(lbl("Reading the log"));
    else if (v.empty) tstack.append(lbl("No source yet"), h("span", { class: "sub", text: "waiting for the first report" }));
    else if (v.hostDownS) tstack.append(lbl("Host silent " + v.hostDownS + " s"), h("span", { class: "sub", text: "newest data " + SD.dur(v.trust.newest) + " old" }));
    else {
      tstack.append(lbl(v.trust.live + "/" + v.trust.total + " live"));
      const sil = v.trust.silent;
      const subText = v.trust.allLost ? "all silent " + SD.dur(v.trust.newest) + " or more" : sil.length ? sil.map((s) => SD.cap(s.machine) + " silent " + SD.dur(s.age)).join(", ") : "oldest report " + SD.dur(v.trust.oldest);
      tstack.append(h("span", { class: "sub", text: subText }));
    }
    trust.append(tstack);

    const alarm = (glyph, color, word, title, how, cls) => {
      bar.classList.add(cls);
      return h("div", { class: "alarm" }, SD.glyphCanvas(glyph, color), h("div", { class: "stack" }, h("span", { class: "t" }, h("span", { class: "lbl w", text: word }), " ", title), h("span", { class: "h", text: how })));
    };

    if (!v.loading && !v.empty && v.critical.length) {
      const c = v.critical[0];
      bar.append(alarm("failed", st.trouble, "Critical", c.title, c.how + ", " + SD.dur(c.age) + " ago" + (v.critical.length > 1 ? " (+" + (v.critical.length - 1) + " more)" : ""), "critical"));
    } else if (!v.loading && !v.empty && v.trust.allLost) {
      const asOf = v.now - v.trust.newest;
      bar.append(alarm("unknown", st.fog, "Lost contact", "No report for " + SD.dur(v.trust.newest), "Everything below is last known, as of " + SD.clock(asOf) + ".", "notice"));
    } else if (!v.loading && !v.empty && v.hostDownS) {
      bar.append(alarm("unknown", st.fog, "No host", "This board cannot reach its host", "Showing data from " + SD.dur(v.trust.newest) + " ago. Trying again in " + SD.RETRY_S + " s.", "notice"));
    } else if (!v.loading && !v.empty) {
      const latest = v.done[0];
      bar.append(h("div", { class: "score" }, h("span", { class: "num", text: String(v.done.length) }),
        h("div", { class: "stack" }, lbl("Landed today"), h("span", { class: "sub", text: latest ? latest.title + ", " + SD.dur(latest.ago) + " ago" : "nothing yet" }))));
      if (!g.phone) {
        const cv = h("canvas", { class: "px chart", width: 150, height: 20, "aria-hidden": "true" });
        // The day's voyage starts when quiet hours end (fixture display.quiet_hours.end).
        const qEnd = (FX.display && FX.display.quiet_hours && FX.display.quiet_hours.end) || "07:30";
        const start = Date.parse(new Date(v.now * 1000).toISOString().slice(0, 10) + "T" + qEnd + ":00Z") / 1000;
        const xs = v.done.map((d) => Math.max(0, Math.min(1, (d.at - start) / (v.now - start))));
        SD.paintChart(cv.getContext("2d"), 150, 20, xs, v.next.map((n) => n.kind), v.night);
        bar.append(cv, lbl(v.next.length + " ahead", "ahead"));
      }
    }
    bar.append(h("span", { class: "spacer" }), clock, trust);

    if (g.phone && !v.loading && !v.empty) {
      const pips = h("div", { class: "pips" });
      for (const m of v.machines) pips.append(machineTag(m, st, true));
      bar.append(pips);
    }
  }

  function machineState(m) {
    if (m.fresh === "lost" || m.fresh === "stale") return { pip: "silent", word: "silent " + SD.dur(m.src.age) };
    if (m.status === "down") return { pip: "down", word: "down" };
    if (m.status === "warn") {
      const d = (m.disks || []).find((x) => x.free_gb <= x.warn_gb);
      return { pip: "warn", word: d ? "disk " + d.free_gb + " GB" : "struggling" };
    }
    return { pip: "ok", word: m.lanes + " crew" };
  }
  function machineTag(m, st, small, nameOnly) {
    const ms = machineState(m);
    const col = ms.pip === "warn" ? st.needs : ms.pip === "down" ? st.trouble : ms.pip === "silent" ? st.fog : st.ink;
    return h("span", { class: "hull" + (ms.pip === "silent" ? " stale" : ""), style: small ? "position:static;transform:none;padding:0" : null },
      SD.glyphCanvas(ms.pip, col, { cls: "pip" }), lbl(m.label), nameOnly ? h("span", { class: "sr", text: ms.word }) : lbl(ms.word, "dim"));
  }

  function renderHulls(v, g, L, st) {
    const box = $("hulls");
    box.replaceChildren();
    if (g.phone || !L || v.loading || v.empty) return;
    L.sections.forEach((sec) => {
      const tag = machineTag(sec.m, st, false, true);
      tag.classList.add("plate");
      tag.style.left = sec.mastX * g.ap + "px";
      tag.style.top = (L.deck + 4) * g.ap + "px";
      box.append(tag);
    });
  }

  function renderCall(v, g, st, arrive) {
    const el = $("call");
    el.replaceChildren();
    el.className = "call plate";
    if (v.loading) {
      el.classList.add("notice");
      el.append(lbl("Reading the log"), h("div", { class: "skel" }), h("div", { class: "skel", style: "width:70%" }), h("div", { class: "h", text: "The lookout is fetching the first report." }));
      return;
    }
    if (v.empty) {
      el.classList.add("notice");
      el.append(lbl("Empty deck"), h("div", { class: "t", text: "No machine has reported yet" }), h("div", { class: "h", text: "The crew comes aboard as soon as the first machine sends its report to this board." }));
      return;
    }
    if (!v.calls.length) {
      el.classList.add("calm");
      const moving = v.lanes.filter((l) => l.kind !== "landed").length;
      el.append(lbl("All clear"), h("div", { class: "big", text: "Nothing waits on you" }),
        h("div", { class: "h", text: moving + " lanes under way, " + v.off.length + " off course, " + v.done.length + " landed today. The lookout is resting at the stern." }));
      return;
    }
    el.className = "call";
    const lost = (row) => row.fresh !== "live";
    const srcAgeOf = (row) => (v.sources.find((s) => s.id === row.src) || { age: 0 }).age;
    const shownAge = (row) => (lost(row) ? row.age - srcAgeOf(row) : row.age);
    const band = h("div", { class: "band" },
      h("span", { class: "hero" + (arrive ? " bounce" : ""), text: String(v.calls.length) }),
      lbl(v.calls.length === 1 ? "Waits on you" : "Wait on you"),
      v.trust.allLost ? lbl("last known", "age") : null);
    const top = v.calls[0];
    const body = h("div", { class: "body" });
    const topRow = h("div", { class: "top" },
      SD.glyphCanvas(top.glyph, st.needs, { dark: "#20160C" }),
      h("div", { class: "t", text: top.title }),
      lbl(SD.dur(shownAge(top), { short: true })),
      h("div", { class: "h", text: top.how + (lost(top) ? " (last known)" : "") }));
    if (g.phone && top.detail) topRow.append(h("div", { class: "d", text: top.detail }));
    body.append(topRow);
    if (v.calls.length > 1) {
      body.append(h("hr"));
      const rows = h("div", { class: "rows" });
      for (const c of v.calls.slice(1)) {
        rows.append(h("div", { class: "row" + (lost(c) ? " frozen" : "") },
          SD.glyphCanvas(lost(c) ? "unknown" : c.glyph, lost(c) ? "#6A6050" : st.needs, { dark: "#20160C" }),
          h("div", { class: "t" }, c.title, lost(c) ? h("span", { class: "sr", text: " (last known)" }) : null),
          lost(c) ? lbl("as of " + SD.clock(v.now - srcAgeOf(c))) : lbl(SD.dur(c.age, { short: true }))));
      }
      body.append(rows);
    }
    // Info never counts; on the TV it gets a line only when the dialog has room for it.
    if (g.phone || v.calls.length <= 3) for (const a of v.also) body.append(h("div", { class: "also" }, lbl("Also"), h("span", { text: a.title })));
    el.append(band, body, h("i", { class: "cursor", "aria-hidden": "true" }));
    if (arrive) { el.classList.add("arrive", "blink"); }
  }

  function laneRow(l, v, st, opts) {
    const f = l.facts;
    const stale = l.fresh !== "live";
    const kindCol = stale ? st.fog : colorOf(l.kind, st);
    const r = h("div", { class: "r" });
    if (f.range) {
      const bar = h("span", { class: "rng", style: "--c:" + (stale ? st.fog : l.kind === "failed" ? st.trouble : l.kind === "landed" ? st.done : st.moving) });
      bar.append(h("i", { class: "floor", style: "width:" + f.lo + "%" }), h("i", { class: "span", style: "left:" + f.lo + "%;width:" + Math.max(0, f.hi - f.lo) + "%" }));
      r.append(lbl(f.range), bar);
    } else r.append(lbl(l.kind === "scout" ? "no %" : "—"));
    const sub = h("div", { class: "s" });
    if (f.word) sub.append(lbl(f.word, l.kind === "failed" || l.kind === "blocked" ? "trouble" : l.kind === "unknown" ? "fog" : null));
    const bits = [];
    if (f.time) bits.push(f.time);
    if (f.note) bits.push(f.note);
    if (stale) bits.push("last known " + SD.dur(l.srcAge) + " ago");
    bits.push(SD.cap(l.machine));
    let text = bits.join(", ") + ".";
    if (opts && opts.doing && l.it.doing && !l.it._patched && !f.note) text += " " + l.it.doing + ".";
    sub.append(h("span", { text }));
    return h("div", { class: "lane" + (stale ? " stale" : "") }, SD.glyphCanvas(GLYPH_OF[l.kind] || "moving", kindCol), h("div", { class: "t", text: l.title }), r, sub);
  }

  // One line per lane on the TV, columns aligned like a log book: what, state, how long, how far, where.
  function ledgerRow(l, v, st) {
    const f = l.facts;
    const stale = l.fresh !== "live";
    const cur = (l.it.progress || {}).current || {};
    const step = (stepName(l) || "").replace(/^ci$/, "checks").replace(/^pr$/, "publish");
    let d = "";
    switch (l.kind) {
      case "failed": d = step + (f.round ? " round " + f.round : "") + ((l.it.flags || []).includes("retrying") ? ", retrying" : ""); break;
      case "long": d = step + " " + SD.dur(cur.elapsed_s, { short: true }) + " of typical " + SD.dur(cur.typical_s) + (cur.activity === "quiet" ? ", quiet " + SD.dur(cur.last_activity_age_s) : ""); break;
      case "blocked": d = f.note || ""; break;
      case "unknown": { const m = /(\d+ min)/.exec(f.note || ""); d = m ? "no answer for " + m[1] : f.note || ""; break; }
      default: d = f.time || f.note || "";
    }
    const kindCol = stale ? st.fog : colorOf(l.kind, st);
    const r = h("span", { class: "r" });
    if (f.range) {
      const bar = h("span", { class: "rng", style: "--c:" + (stale ? st.fog : l.kind === "failed" ? st.trouble : st.moving) });
      bar.append(h("i", { class: "floor", style: "width:" + f.lo + "%" }), h("i", { class: "span", style: "left:" + f.lo + "%;width:" + Math.max(0, f.hi - f.lo) + "%" }));
      r.append(lbl(f.range), bar);
    } else r.append(lbl("no %", "dim"));
    const wordCls = stale || l.kind === "unknown" ? "fog" : l.kind === "failed" || l.kind === "blocked" ? "trouble" : null;
    return h("div", { class: "row" + (stale ? " stale" : "") },
      SD.glyphCanvas(GLYPH_OF[l.kind] || "moving", kindCol),
      h("span", { class: "t", text: l.title }),
      lbl(stale ? "Last known" : f.word || "", "w" + (wordCls ? " " + wordCls : "")),
      h("span", { class: "d", text: d }),
      r,
      lbl(l.machine, "m"));
  }

  function renderLog(v, g, st) {
    const el = $("log");
    el.replaceChildren();
    el.className = "log plate";
    if (v.empty) { el.hidden = true; return; }
    el.hidden = false;
    const head = h("div", { class: "head" }, lbl("Ship's log", "on"));
    if (v.loading) {
      el.append(head, h("div", { style: "display:grid;gap:calc(var(--ap)*8);align-content:start" }, h("div", { class: "skel" }), h("div", { class: "skel", style: "width:80%" }), h("div", { class: "skel", style: "width:60%" })));
      return;
    }
    head.append(lbl(v.off.length + " off course"));
    const count = (glyph, col, n, word) => h("span", { class: "count" }, SD.glyphCanvas(glyph, col), lbl(n + " " + word));
    const push = h("span", { class: "count push" });
    head.append(push);
    head.append(count("moving", st.moving, v.underway.length, "under way"), count("scout", st.moving, v.scouts.length, "scouting"), count("done", st.done, v.landedLanes.length, "landed"));
    const off = h("div", { class: g.phone ? "off" : "off ledger" });
    const max = g.phone ? Infinity : 6;
    v.off.slice(0, max).forEach((l) => off.append(g.phone ? laneRow(l, v, st, { doing: true }) : ledgerRow(l, v, st)));
    if (!v.off.length) off.append(h("div", { class: "empty", text: "Every lane is on course." }));
    el.append(head, off);
    if (v.off.length > max) el.append(h("div", { class: "fold", text: "+" + (v.off.length - max) + " more off course: " + v.off.slice(max).map((l) => l.title).join(", ") }));
  }

  // Phone only: the 30-second layer, scrolled to.
  function renderMore(v, g, st) {
    const el = $("more");
    el.replaceChildren();
    if (!g.phone || v.loading || v.empty) return;
    const sec = (title, ...kids) => h("section", { class: "plate" }, h("h2", { class: "lbl big", text: title }), ...kids);
    const lanesBlock = (ls) => h("div", { style: "display:grid;gap:8px" }, ls.map((l) => laneRow(l, v, st, { doing: true })));
    el.append(sec("Waiting on you, by lane", lanesBlock(v.waitingLanes)));
    el.append(sec("Under way " + v.underway.length, lanesBlock(v.underway)));
    el.append(sec("In the crow's nest " + v.scouts.length, lanesBlock(v.scouts)));
    el.append(sec("Landed today " + v.done.length, ...v.done.map((d) => h("div", { class: "item" }, lbl(SD.clock(d.at)), h("div", null, d.title, h("small", { text: SD.cap(d.group) + ", " + d.via + ", " + SD.dur(d.ago) + " ago" }))))));
    const KIND = { queued: "queued", gate: "release gate", held: "held" };
    el.append(sec("Ahead " + v.next.length, ...v.next.map((n) => h("div", { class: "item" }, lbl(KIND[n.kind] || n.kind), h("div", null, n.title, h("small", { text: n.reason + (n.until ? " (until " + n.until + ")" : "") }))))));
    const byId = Object.fromEntries(v.lanes.map((l) => [l.id, l]));
    el.append(sec("Releases", ...v.groups.map((gr) => {
      const c = gr.checkpoint;
      const waits = (c.next.waiting_on || []).map((id) => (byId[id] ? byId[id].title : id)).join(", ");
      return h("div", { class: "kv" }, h("b", { text: gr.label + " " + c.next.version }), " waits on " + waits + ". Live: " + c.live.version + ". Gate: " + (c.gate.value === "pass" ? "passed" : "not run") + ".");
    })));
    el.append(sec("Allowance", ...v.meters.map((a) => h("div", { class: "kv" }, h("b", { text: SD.cap(a.machine) }), " " + a.windows.map((w) => w.label + " " + w.percent_remaining + "% left").join(", ") + ". " +
      (a.runway.status === "exhausts_before_reset" ? "Empty " + SD.dayClock(Date.parse(a.runway.projected_empty_at) / 1000) + ", before the reset." : "Lasts through the reset.")))));
    el.append(sec("Machines", ...v.machines.map((m) => {
      const bits = [];
      if (m.load) bits.push("load " + m.load.l1 + " on " + m.load.cores + " cores");
      if (m.mem) bits.push("memory " + m.mem.used_pct + "%, swap " + m.mem.swap_used_pct + "%");
      for (const d of m.disks || []) bits.push(d.label + " " + d.free_gb + " GB free");
      for (const x of m.extras || []) bits.push(x.label + " " + x.value);
      return h("div", { class: "kv" }, h("b", { text: m.label + (m.role ? ", " + m.role : "") }), ": " + bits.join(", ") + ".");
    })));
    el.append(sec("Sources", ...v.sources.map((s) => h("div", { class: "kv" }, h("b", { text: s.label }), ": " + s.status + ", last report " + SD.dur(s.age) + " ago."))));
  }

  // ---- Dev switcher ---------------------------------------------------------------------------
  function renderDev() {
    const el = $("dev");
    el.hidden = !opt.dev;
    if (!opt.dev) return;
    el.replaceChildren();
    const grp = (name, list, key) => h("div", { class: "grp" }, h("b", { text: name }), list.map((x) => {
      const b = h("button", { type: "button", "aria-pressed": String(opt[key] === x), text: x });
      b.addEventListener("click", () => { opt[key] = x; writeHash(); });
      return b;
    }));
    el.append(grp("State", SCENARIOS, "scenario"), grp("Sky", SKIES, "sky"), grp("Motion", MOTIONS, "motion"));
    if (FX) { const sc = FX.scenarios.find((s) => s.id === opt.scenario); if (sc) el.append(h("p", { text: sc.what })); }
    el.append(h("p", { text: "Press D to hide. Fixture clock " + (FX ? FX.now : "") + "." }));
  }

  // ---- Render and motion ------------------------------------------------------------------------
  let lastKey = "";
  function render() {
    readHashIfNeeded();
    const g = geometry();
    document.documentElement.style.setProperty("--ap", g.ap + "px");
    document.body.dataset.layout = g.phone ? "phone" : "tv";
    const deck = $("deck"), box = $("scenebox");
    if (g.phone) { deck.insertBefore(box, $("call")); box.style.setProperty("--banner-h", g.AH * g.ap + "px"); }
    else document.body.insertBefore(box, deck);
    deck.style.setProperty("--ox", g.ox * g.ap + "px");
    deck.style.setProperty("--oy", g.oy * g.ap + "px");

    let v;
    if (!FX) v = { id: "loading", loading: true, now: Date.parse("2026-10-08T19:30:00Z") / 1000, tod: "dusk", night: false, lanes: [], machines: [], calls: [], critical: [], next: [], done: [] };
    else v = SD.buildView(FX, opt.scenario);
    if (fetchFailed) v.loadError = true;
    if (v.night) document.body.dataset.night = ""; else delete document.body.dataset.night;
    const st = SD.STATUS[v.night ? "night" : "day"];

    const cv = $("scene");
    cv.width = g.AW; cv.height = g.AH;
    cv.style.width = g.AW * g.ap + "px"; cv.style.height = g.AH * g.ap + "px";
    const L = v.loading ? shipLayout({ machines: [], lanes: [] }, g) : shipLayout(v, g);

    const motion = effectiveMotion();
    const key = opt.scenario + "|" + (FX ? 1 : 0);
    const arrive = motion !== "still" && key !== lastKey && v.calls && v.calls.length > 0 && !v.trust.allLost;
    lastKey = key;

    renderBar(v, g, st);
    renderCall(v, g, st, arrive);
    renderHulls(v, g, L, st);
    renderLog(v, g, st);
    renderMore(v, g, st);
    renderDev();
    if (fetchFailed) {
      const el = $("call");
      el.className = "call plate notice";
      el.replaceChildren(lbl("No log to read"), h("div", { class: "t", text: "fixture.json did not load" }), h("div", { class: "h", text: "Serve this folder over HTTP, for example python3 -m http.server, and open it from there." }));
    }

    // Motion timeline: crow flight (6 x 100 ms), dialog unroll and blink (CSS), storm flashes, fog rolling in.
    clearInterval(timer);
    const t = { ms: 0, crowStep: arrive ? 0 : 6, flash: false, fogStep: motion === "still" ? 4 : 0 };
    const call = $("call");
    if (arrive) call.style.visibility = "hidden"; else call.style.visibility = "";
    const storm = v.weather === "storm" && motion !== "still";
    const animated = SD.animatedLanes(v, motion);
    // Exposed for checks: what motion the board is allowed, and how many crew are looping.
    document.body.dataset.motion = motion;
    document.body.dataset.looping = String(animated.size);
    document.body.dataset.viewport = g.W + "x" + g.H + "@" + g.dpr + " ap=" + g.ap;
    paint(v, g, L, t);
    const t0 = performance.now();
    let last = "";
    timer = setInterval(() => {
      t.ms = performance.now() - t0;
      if (arrive) { t.crowStep = Math.min(6, Math.floor(t.ms / 100)); if (t.crowStep >= 6) call.style.visibility = ""; }
      if (storm) { const k = t.ms / 500; t.flash = k < 3 && k - Math.floor(k) < 0.24; }
      t.fogStep = motion === "still" ? 4 : Math.min(4, Math.floor(t.ms / 150));
      const k = [t.crowStep, t.flash, t.fogStep, animated.size ? Math.floor(t.ms / 500) % 2 : 0].join();
      if (k !== last) { last = k; paint(v, g, L, t); }
      const settled = t.crowStep >= 6 && !t.flash && t.ms > 1600 && t.fogStep >= 4;
      if (settled && !animated.size) clearInterval(timer);
    }, 50);

    // Burn-in drift on the TV: one art pixel every 4 minutes inside a 3 x 2 box.
    clearInterval(driftTimer);
    const path = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
    let di = 0;
    const applyDrift = () => {
      const [dx, dy] = g.phone ? [0, 0] : path[di % path.length];
      for (const el of [deck, $("hulls")]) { el.style.setProperty("--dx", dx * g.ap + "px"); el.style.setProperty("--dy", dy * g.ap + "px"); }
      $("hulls").style.transform = "translate(" + dx * g.ap + "px," + dy * g.ap + "px)";
    };
    applyDrift();
    if (!g.phone) driftTimer = setInterval(() => { di++; applyDrift(); }, 4 * 60 * 1000);
  }
  function readHashIfNeeded() { readHash(); }

  window.addEventListener("hashchange", render);
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 120); });
  reduced.addEventListener("change", render);
  window.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") { if (e.target.closest && e.target.closest("input,textarea")) return; opt.dev = !opt.dev; writeHash(); }
  });

  SD.render = render; // for the screenshot harness
  readHash();
  render();
  document.fonts.ready.then(() => {
    fetch("fixture.json", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((fx) => { FX = fx; }, (e) => { console.error("fixture.json:", e); fetchFailed = true; })
      .then(render);
  });
})();
