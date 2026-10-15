/* Handheld LCD: turns the fixture plus one scenario into the view this page draws.
   No data is invented here: every title, age and number comes from fixture.json. */
(function () {
  "use strict";

  const LIVE_INTERVALS = 2;
  const LATE_INTERVALS = 4;
  const LOST_AFTER_S = 900;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function t(iso) { return Date.parse(iso); }

  // "2 h 11 min", "25 min", "40 s"
  function dur(s, compact) {
    if (s == null || isNaN(s)) return "";
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (compact) return h + " h " + String(r).padStart(2, "0");
    return r ? h + " h " + r + " min" : h + " h";
  }

  function hhmm(ms) {
    const d = new Date(ms);
    return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  }
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayLabel(ms) {
    const d = new Date(ms);
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  }
  function inQuiet(ms, q) {
    if (!q) return false;
    const d = new Date(ms);
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    const [sh, sm] = q.start.split(":").map(Number);
    const [eh, em] = q.end.split(":").map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    return s > e ? m >= s || m < e : m >= s && m < e;
  }

  function scenarioList(fx) {
    const list = fx.scenarios.map((s) => ({ id: s.id, what: s.what, derived: false }));
    // One combination of two fixture scenarios: the all-clear patch at the night clock.
    // It shows the sleeping LCD from this concept's brief; it adds no data.
    const ni = list.findIndex((s) => s.id === "night");
    list.splice(ni + 1, 0, {
      id: "night-all-clear",
      what: "Derived: the all-clear patch at the night scenario's clock (23:40). Nothing waits, so the LCD sleeps.",
      derived: true,
    });
    return list;
  }

  function findScenario(fx, id) {
    if (id === "night-all-clear") {
      const ac = fx.scenarios.find((s) => s.id === "all-clear");
      const ng = fx.scenarios.find((s) => s.id === "night");
      return Object.assign(clone(ac), { id: id, now: ng.now, theme: "night", what: "all-clear at night" });
    }
    return fx.scenarios.find((s) => s.id === id) || fx.scenarios[0];
  }

  function applyPatch(feeds, sc) {
    const p = sc.patch || {};
    for (const key of Object.keys(p)) {
      const val = p[key];
      if (key === "attention" && val === "remove all") {
        feeds.forEach((f) => { f.attention = []; });
        continue;
      }
      let m = key.match(/^items\.([^.]+)\.(.+)$/);
      if (m) {
        feeds.forEach((f) => f.items.forEach((it) => {
          if (it.id !== m[1]) return;
          const path = m[2].split(".");
          let o = it;
          for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
          o[path[path.length - 1]] = val;
          // a lane that no longer stops at the viewer stops asking for the viewer
          if (m[2] === "state") it.needs_you = false;
        }));
        continue;
      }
      m = key.match(/^([^.]+)\.attention$/);
      if (m && /^append /.test(val)) {
        const what = val.replace(/^append /, "");
        const f = feeds.find((x) => x.source.id === m[1]);
        if (f && sc[what]) f.attention.push(clone(sc[what]));
      }
    }
  }

  function sourceLevel(ageS, interval) {
    if (ageS == null) return "unknown";
    if (ageS <= interval * LIVE_INTERVALS) return "live";
    if (ageS <= interval * LATE_INTERVALS) return "late";
    if (ageS <= LOST_AFTER_S) return "stale";
    return "lost";
  }

  const STEP_WORD = { ci: "checks", pr: "publish" };

  function stepLabel(item, stepId) {
    const st = (item.progress && item.progress.steps || []).find((s) => s.id === stepId);
    const l = STEP_WORD[stepId] || (st ? st.label : stepId) || "";
    return l.toLowerCase();
  }

  function rangeText(p) {
    if (!p || p.percent_floor == null) return null;
    if (p.percent_floor === p.percent_ceiling) return p.percent_floor + "%";
    return p.percent_floor + "–" + p.percent_ceiling + "%";
  }

  function timeText(item, compact) {
    const c = item.progress && item.progress.current;
    if (!c || c.elapsed_s == null) return "";
    return stepLabel(item, c.step) + " " + dur(c.elapsed_s, compact) + " of " + dur(c.typical_s, compact);
  }

  /* Classify one lane. `off` lanes are listed one by one; the rest fold into counts. */
  function classify(item, titles) {
    const p = item.progress || {};
    const c = p.current || {};
    const r = { kind: "moving", word: "", detail: "", off: false, rank: 9 };
    if (item.needs_you && item.state === "waiting") {
      return Object.assign(r, { kind: "call", word: "Your call", detail: "stopped at " + stepLabel(item, c.step), rank: 0, inPlate: true });
    }
    if (item.state === "done" && item.handoff && item.handoff.state === "awaiting_you") {
      return Object.assign(r, { kind: "approve", word: "Merge ready", detail: "awaiting your merge", rank: 0, inPlate: true });
    }
    if (item.state === "done") {
      return Object.assign(r, { kind: "landed", word: "Landed", detail: "" });
    }
    if (item.state === "failed") {
      const bits = [];
      if (c.round) bits.push("round " + c.round + " failed");
      if ((item.flags || []).includes("retrying")) bits.push("retrying");
      return Object.assign(r, { kind: "failed", word: "Failed", detail: bits.join(", ") || "step failed", off: true, rank: 1 });
    }
    const long = c.elapsed_s != null && c.p90_s && c.elapsed_s > c.p90_s;
    const quiet = c.activity === "quiet";
    if (item.state === "running" && long) {
      const d = [timeText(item, true)];
      if (quiet) d.push("silent " + dur(c.last_activity_age_s));
      return Object.assign(r, { kind: "long", word: "Running long", detail: d.join(", "), off: true, rank: 2, quiet: quiet });
    }
    if (item.state === "running" && quiet) {
      return Object.assign(r, { kind: "quiet", word: "Quiet", detail: "no output " + dur(c.last_activity_age_s), off: true, rank: 3 });
    }
    if (item.state === "blocked") {
      const m = (item.state_detail || "").match(/blocked on (\S+)/);
      const on = m && titles[m[1]] ? titles[m[1]] : "other work";
      return Object.assign(r, { kind: "blocked", word: "Blocked", detail: "on " + on, off: true, rank: 4 });
    }
    if (item.state === "unknown") {
      const m = (p.reason || "").match(/(\d+ min)/);
      return Object.assign(r, { kind: "unknown", word: "No word", detail: m ? "silent " + m[1] : "state unreadable", off: true, rank: 5 });
    }
    if (p.regressed) {
      return Object.assign(r, { kind: "regressed", word: "Round " + (c.round || 2), detail: timeText(item, true), off: true, rank: 6 });
    }
    if (item.state === "waiting") {
      return Object.assign(r, { kind: "mate", word: "Asked its lead", detail: "being answered" });
    }
    if (item.kind === "scout") {
      return Object.assign(r, { kind: "scout", word: "Scouting", detail: "" });
    }
    return Object.assign(r, { kind: "moving", word: "", detail: timeText(item, true) });
  }

  // Attention ranking: critical, then a decision that stops a lane, approvals, machines, capacity.
  const KIND_RANK = { decision: 1, approval: 2, machine: 3, capacity: 4 };
  function attnRank(a) {
    if (a.severity === "critical") return 0;
    if (a.kind === "decision" && a.item) return 1;
    return KIND_RANK[a.kind] || 5;
  }

  function build(fx, scenarioId) {
    const sc = findScenario(fx, scenarioId);
    const now = t(sc.now || fx.now);
    const quiet = inQuiet(now, fx.display && fx.display.quiet_hours);
    const night = sc.theme === "night" || quiet;
    const v = {
      scenario: sc,
      id: sc.id,
      now: now,
      clock: hhmm(now),
      day: dayLabel(now),
      tz: (fx.display && fx.display.tz) || "UTC",
      night: night,
      loading: sc.id === "loading",
      empty: false,
      hostDown: sc.host_unreachable_s || 0,
    };
    // the product's defaults (web/app.js): retry every 10 s once the host is down
    const RETRY_EVERY_S = 10;
    v.nextTry = v.hostDown ? RETRY_EVERY_S - (v.hostDown % RETRY_EVERY_S || RETRY_EVERY_S) || RETRY_EVERY_S : 0;
    if (v.loading) return v;

    const feeds = clone(sc.feeds !== undefined ? sc.feeds : fx.feeds);
    if (!feeds.length) { v.empty = true; return v; }
    applyPatch(feeds, sc);

    // sources and their freshness
    v.sources = feeds.map((f) => {
      const age = sc.sources && sc.sources[f.source.id] ? sc.sources[f.source.id].received_age_s : null;
      return { id: f.source.id, label: f.source.label, machine: f.source.machine, interval: f.interval_s, age: age, level: sourceLevel(age, f.interval_s) };
    });
    const srcBy = {};
    v.sources.forEach((s) => { srcBy[s.id] = s; });
    const fresh = v.sources.filter((s) => s.level === "live" || s.level === "late");
    v.newestAge = Math.min.apply(null, v.sources.map((s) => s.age));
    v.allLost = v.sources.every((s) => s.level === "lost");
    v.anyStale = v.sources.some((s) => s.level === "stale" || s.level === "lost");
    v.liveCount = fresh.length;
    v.trust = v.allLost ? "lost" : v.hostDown ? "host" : v.sources.some((s) => s.level === "lost" || s.level === "stale") ? "stale" : v.sources.some((s) => s.level === "late") ? "late" : "live";

    // machines: each machine's own source wins
    const mach = {};
    feeds.forEach((f) => f.machines.forEach((m) => {
      const own = f.source.machine === m.id;
      if (!mach[m.id] || own) mach[m.id] = Object.assign({}, m, { _src: own ? f.source.id : (mach[m.id] && mach[m.id]._src) || f.source.id, _own: own });
    }));

    // items
    const titles = {};
    const items = [];
    feeds.forEach((f) => f.items.forEach((it) => {
      titles[it.id] = it.title;
      items.push(Object.assign(it, { _src: f.source.id }));
    }));
    items.forEach((it) => {
      it.cls = classify(it, titles);
      const s = srcBy[it._src];
      it.stale = s.level === "stale" || s.level === "lost";
      it.staleAge = s.age;
      it.range = rangeText(it.progress);
    });
    v.items = items;

    v.machines = Object.values(mach).map((m) => {
      const s = srcBy[m._src];
      const lanes = items.filter((i) => i.machine === m.id).length;
      const stale = s && (s.level === "stale" || s.level === "lost");
      let word = "ok";
      const notes = [];
      (m.disks || []).forEach((d) => {
        if (d.crit_gb != null && d.free_gb <= d.crit_gb) notes.push("disk " + d.free_gb + " GB");
        else if (d.warn_gb != null && d.free_gb <= d.warn_gb) notes.push("disk " + d.free_gb + " GB");
      });
      if (m.mem && m.mem.swap_used_pct >= 50) notes.push("swap " + m.mem.swap_used_pct + "%");
      if (m.status === "warn") word = "struggling";
      if (m.status === "down" || m.status === "critical") word = "down";
      if (m.status === "unknown") word = "no report";
      const pip = stale ? "silent" : m.status === "ok" ? "ok" : m.status === "warn" ? "warn" : m.status === "down" || m.status === "critical" ? "down" : "unknown";
      return {
        id: m.id, label: m.label, role: m.role, status: m.status, lanes: lanes, word: stale ? "silent " + dur(s.age) : word,
        notes: notes, pip: pip, stale: stale, age: s ? s.age : null,
        load: m.load, mem: m.mem, disks: m.disks || [], extras: m.extras || [],
      };
    });
    const mrank = (m) => (m.pip === "down" ? 0 : m.pip === "warn" ? 1 : m.pip === "silent" ? 2 : 3);
    v.machines.sort((a, b) => mrank(a) - mrank(b) || b.lanes - a.lanes);

    // attention
    const attn = [];
    feeds.forEach((f) => (f.attention || []).forEach((a) => {
      const s = srcBy[f.source.id];
      attn.push(Object.assign({}, a, {
        _src: f.source.id,
        age: (now - t(a.since)) / 1000,
        stale: s.level === "stale" || s.level === "lost",
        rank: attnRank(a),
      }));
    }));
    attn.sort((a, b) => a.rank - b.rank || a.age - b.age);
    v.calls = attn.filter((a) => a.severity !== "info");
    v.info = attn.filter((a) => a.severity === "info");
    v.critical = v.calls.filter((a) => a.severity === "critical");
    v.callCount = v.calls.length;
    v.top = v.calls[0] || null;
    if (v.top && v.top.item) {
      const it = items.find((i) => i.id === v.top.item);
      v.topLane = it ? it.title : null;
    }

    // lanes off course, then the folded counts
    v.off = items.filter((i) => i.cls.off).sort((a, b) => a.cls.rank - b.cls.rank);
    const count = (k) => items.filter((i) => i.cls.kind === k).length;
    v.fold = { moving: count("moving"), scouts: count("scout"), mate: count("mate") };

    // landed today
    const done = [];
    feeds.forEach((f) => (f.done || []).forEach((d) => done.push(Object.assign({}, d, { age: (now - t(d.at)) / 1000 }))));
    done.sort((a, b) => a.age - b.age);
    v.done = done;

    // queue, releases, allowance
    v.next = [];
    feeds.forEach((f) => (f.next || []).forEach((n) => v.next.push(n)));
    v.groups = [];
    feeds.forEach((f) => (f.groups || []).forEach((g) => v.groups.push(g)));
    v.releases = v.groups.filter((g) => g.checkpoint && g.checkpoint.next).map((g) => ({
      label: g.label + " " + g.checkpoint.next.version,
      waits: (g.checkpoint.next.waiting_on || []).map((id) => titles[id] || id),
      gate: g.checkpoint.gate ? g.checkpoint.gate.value : null,
      live: g.checkpoint.live ? g.checkpoint.live.version : null,
    }));
    v.meters = [];
    feeds.forEach((f) => ((f.meters && f.meters.accounts) || []).forEach((a) => v.meters.push(a)));
    v.titles = titles;
    return v;
  }

  window.HH = window.HH || {};
  window.HH.model = { build: build, scenarioList: scenarioList, dur: dur, hhmm: hhmm, dayLabel: dayLabel };
})();
