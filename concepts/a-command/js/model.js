/* Fleet command, concept A: the view model.
   Turns the fixture (three lookout.feed documents plus scenario overlays) into what the
   command screen draws. Nothing here invents data: every title, number and time comes from
   the fixture; the only constants are the host's default staleness thresholds
   (src/weatherdeck/defaults.json and web/app.js TH()). */
"use strict";

const Model = (() => {
  // Host defaults: live within 2 intervals, late within 4, lost after 15 min, retry every 10 s.
  const TH = { live_within_intervals: 2, late_within_intervals: 4, lost_after_s: 900, retry_every_s: 10 };

  const epoch = iso => Date.parse(iso) / 1000;
  const clone = o => JSON.parse(JSON.stringify(o));

  // Order kinds as the commander reads them. Lower rank sorts first after severity.
  const KIND = {
    service:    { rank: 0, word: "Critical",   glyph: "failed" },
    decision:   { rank: 1, word: "Your call",  glyph: "needs" },
    approval:   { rank: 2, word: "Merge ready", glyph: "approve" },
    machine:    { rank: 3, word: "Machine",    glyph: "needs" },
    capacity:   { rank: 4, word: "Allowance",  glyph: "needs" },
    credential: { rank: 5, word: "Sign-in",    glyph: "needs" },
  };
  const SEV = { critical: 0, action: 1, info: 2 };

  // Off-course order: what most needs a look first.
  const OFF = {
    failed:    { rank: 0, word: "FAILED",       glyph: "failed" },
    long:      { rank: 1, word: "RUNNING LONG", glyph: "moving" },
    blocked:   { rank: 2, word: "BLOCKED",      glyph: "blocked" },
    silent:    { rank: 3, word: "NO WORD",      glyph: "silent" },
    quiet:     { rank: 4, word: "QUIET",        glyph: "moving" },
    regressed: { rank: 5, word: "ROUND",        glyph: "moving" },
  };

  function sourceLevel(ageS, intervalS) {
    if (ageS == null) return "absent";
    if (ageS <= TH.live_within_intervals * intervalS) return "live";
    if (ageS <= TH.late_within_intervals * intervalS) return "late";
    if (ageS <= TH.lost_after_s) return "stale";
    return "lost";
  }

  function applyPatch(feeds, sc) {
    if (!sc.patch && !sc.supervision_down) return;
    const p = sc.patch || {};
    if (p.attention === "remove all") feeds.forEach(f => { f.attention = []; });
    for (const [k, v] of Object.entries(p)) {
      const m = /^items\.([^.]+)\.(.+)$/.exec(k);
      if (!m) continue;
      for (const f of feeds) for (const it of f.items) if (it.id === m[1]) {
        const path = m[2].split(".");
        let o = it;
        while (path.length > 1) o = o[path.shift()];
        o[path[0]] = v;
        // The scenario text says the call is gone, so the lane no longer needs the viewer.
        it.needs_you = false;
        if (k.endsWith(".state") && v === "running" && it.progress && it.progress.current) it.progress.current.activity = "active";
      }
    }
    if (p["kestrel-main.attention"] === "append supervision_down") {
      const f = feeds.find(x => x.source.id === "kestrel-main");
      if (f) f.attention.push(clone(sc.supervision_down));
    }
  }

  // Build the merged, scenario-specific view.
  function build(fx, scenarioId) {
    const sc = fx.scenarios.find(s => s.id === scenarioId) || fx.scenarios[0];
    const now = epoch(sc.now || fx.now);
    const theme = sc.theme || (scenarioId === "night" ? "night" : "day");
    const v = {
      id: sc.id, what: sc.what, now, theme, quiet: fx.display && fx.display.quiet_hours,
      mode: "ok", hostDownS: sc.host_unreachable_s || 0, retryEveryS: TH.retry_every_s,
      sources: [], machines: [], items: [], orders: [], also: [], next: [], done: [], groups: [], accounts: [],
    };
    if (scenarioId === "loading") { v.mode = "loading"; return v; }
    const feeds = clone(sc.feeds !== undefined ? sc.feeds : fx.feeds);
    if (!feeds.length) { v.mode = "empty"; return v; }
    applyPatch(feeds, sc);

    // Sources and their staleness, from the host's receive age.
    for (const f of feeds) {
      const age = sc.sources && sc.sources[f.source.id] ? sc.sources[f.source.id].received_age_s : null;
      const level = sourceLevel(age, f.interval_s || 30);
      v.sources.push({ id: f.source.id, label: f.source.label, machine: f.source.machine, age, level, interval: f.interval_s });
    }
    const srcOf = id => v.sources.find(s => s.id === id);
    const fogged = s => s.level === "stale" || s.level === "lost";

    // Machines: each machine's own feed is authoritative; a peer's stub only fills a gap.
    const byMachine = new Map();
    for (const f of feeds) for (const m of f.machines) {
      const own = f.source.machine === m.id;
      const prev = byMachine.get(m.id);
      if (!prev || (own && !prev.own)) byMachine.set(m.id, { m, own, src: srcOf(f.source.id) });
    }

    // Items, attention, queue, landed, groups, meters: union across sources.
    const seen = new Set();
    for (const f of feeds) {
      const s = srcOf(f.source.id);
      for (const it of f.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        v.items.push(Object.assign(it, { _src: s, _fog: fogged(s) }));
      }
      for (const a of f.attention) {
        const o = Object.assign(a, { _src: s, _fog: fogged(s), age: Math.max(0, now - epoch(a.since)) });
        (a.severity === "info" ? v.also : v.orders).push(o);
      }
      for (const n of f.next) v.next.push(n);
      for (const d of f.done) if (!v.done.some(x => x.id === d.id)) v.done.push(Object.assign(d, { age: now - epoch(d.at) }));
      for (const g of f.groups) if (!v.groups.some(x => x.id === g.id)) v.groups.push(g);
      if (f.meters) for (const acc of f.meters.accounts) v.accounts.push(Object.assign(acc, { _src: s, _fog: fogged(s) }));
    }
    v.done.sort((a, b) => b.at.localeCompare(a.at));
    v.orders.sort((a, b) => (SEV[a.severity] - SEV[b.severity]) || ((KIND[a.kind] || KIND.credential).rank - (KIND[b.kind] || KIND.credential).rank) || (b.age - a.age));
    v.orders.forEach(o => { o.k = KIND[o.kind] || KIND.credential; });

    const groupLabel = id => { const g = v.groups.find(x => x.id === id); return g ? g.label : id; };
    const orderLanes = new Set(v.orders.map(o => o.item).filter(Boolean));

    // Classify every lane: an order, off course, landed, or on task.
    for (const it of v.items) {
      const p = it.progress || {};
      const c = p.current || null;
      it.groupLabel = groupLabel(it.group);
      it.range = p.percent_floor != null ? [p.percent_floor, p.percent_ceiling] : null;
      it.basis = p.basis;
      it.cur = c;
      it.stepLabel = c && p.steps ? (p.steps.find(s => s.id === c.step) || {}).label : null;
      it.flags = it.flags || [];
      let cls = "task", off = null;
      if (it.needs_you || orderLanes.has(it.id)) cls = "order";
      else if (it.state === "done") cls = "landed";
      else if (it.state === "failed") off = "failed";
      else if (it.state === "blocked") off = "blocked";
      else if (it.state === "unknown") off = "silent";
      else if (c && c.elapsed_s > c.p90_s) off = "long";
      else if (c && c.activity === "quiet") off = "quiet";
      else if (p.regressed) off = "regressed";
      if (off) cls = "off";
      it.cls = cls;
      it.off = off;
      it.offInfo = off ? OFF[off] : null;
      if (cls === "task") it.sub = it.kind === "scout" ? "scout" : (it.state === "waiting" ? "mate" : "moving");
      // Blocked lanes name what they wait on, from the item they point at.
      const bm = /^blocked on (.+)$/.exec(it.state_detail || "");
      if (bm) { const other = v.items.find(x => x.id === bm[1]); it.blockedOn = other ? other.title : bm[1]; }
      it.waitingSince = c && c.waiting_since ? now - epoch(c.waiting_since) : null;
    }
    // Resolve blocked titles for items listed after the one they point at.
    for (const it of v.items) {
      const bm = /^blocked on (.+)$/.exec(it.state_detail || "");
      if (bm) { const other = v.items.find(x => x.id === bm[1]); if (other) it.blockedOn = other.title; }
    }

    // Machines carry their lanes (the minimap pips) in a stable order: Kestrel, Basalt, Tern.
    for (const [id, rec] of byMachine) {
      const lanes = v.items.filter(i => i.machine === id);
      const src = v.sources.find(s => s.machine === id) || rec.src;
      v.machines.push(Object.assign(rec.m, { src, _fog: fogged(src), lanes,
        crit: v.orders.some(o => o.machine === id && o.severity === "critical") }));
    }

    v.off = v.items.filter(i => i.cls === "off").sort((a, b) => a.offInfo.rank - b.offInfo.rank);
    v.task = v.items.filter(i => i.cls === "task");
    v.landedLanes = v.items.filter(i => i.cls === "landed");
    v.orderLanes = v.items.filter(i => i.cls === "order");

    const all = v.sources.map(s => s.level);
    if (all.every(l => l === "lost")) v.mode = "lost";
    else if (v.hostDownS) v.mode = "hostdown";
    v.newestAge = Math.min(...v.sources.map(s => s.age));
    return v;
  }

  // Formatting, in the board's own words.
  function dur(s, short) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60), r = m % 60;
    if (short) return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const shortMin = s => { const m = Math.round(s / 60); return m < 60 ? m + " m" : dur(s, true); };
  const hm = t => { const d = new Date(t * 1000); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayHm = iso => { const t = epoch(iso); return DAYS[new Date(t * 1000).getUTCDay()] + " " + hm(t); };
  const dateLine = t => { const d = new Date(t * 1000); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

  return { build, dur, shortMin, hm, dayHm, dateLine, epoch, TH, KIND, OFF };
})();
