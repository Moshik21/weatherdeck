/* Ship deck concept: turns fixture.json plus one scenario into the view the page draws.
   Everything shown comes from the fixture; nothing here invents fleet data. */
(function () {
  "use strict";
  const SD = (window.SD = window.SD || {});

  const STALE_AFTER_INTERVALS = 3; // a source is stale after three missed pushes
  const LOST_AFTER_S = 15 * 60; // and lost after 15 min, as the fixture's scenarios say
  SD.RETRY_S = 15; // the page's own retry cadence when its host does not answer

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const t = (iso) => Date.parse(iso) / 1000;

  // Ages and durations in the words the board uses: "44 min", "2 h 38", "6 s".
  SD.dur = function (s, opts) {
    if (s == null || !isFinite(s)) return "";
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60), r = m % 60;
    if (opts && opts.short) return h + " h" + (r ? " " + String(r).padStart(2, "0") : "");
    return r ? h + " h " + String(r).padStart(2, "0") : h + " h";
  };
  SD.mins = function (s) {
    // "31" when the typical is in minutes too, so "test 31 of 44 min" reads in one unit.
    return Math.round(s / 60);
  };
  SD.clock = function (epoch) {
    const d = new Date(epoch * 1000);
    return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  SD.dayClock = function (epoch) {
    const d = new Date(epoch * 1000);
    return DAYS[d.getUTCDay()] + " " + SD.clock(epoch);
  };

  // Time of day for the sky, from the fixture clock (the fixture's tz is UTC).
  SD.timeOfDay = function (epoch) {
    const d = new Date(epoch * 1000);
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (m >= 6 * 60 && m < 8 * 60 + 30) return "dawn";
    if (m >= 8 * 60 + 30 && m < 18 * 60 + 30) return "day";
    if (m >= 18 * 60 + 30 && m < 21 * 60) return "dusk";
    return "night";
  };

  function applyScenario(fx, sc) {
    const feeds = Array.isArray(sc.feeds) ? clone(sc.feeds) : clone(fx.feeds);
    const p = sc.patch || {};
    if (p.attention === "remove all") feeds.forEach((f) => (f.attention = []));
    for (const [key, val] of Object.entries(p)) {
      const m = /^items\.([^.]+)\.(.+)$/.exec(key);
      if (!m) continue;
      for (const f of feeds) {
        const it = f.items.find((i) => i.id === m[1]);
        if (!it) continue;
        const path = m[2].split(".");
        let o = it;
        while (path.length > 1) o = o[path.shift()];
        o[path[0]] = val;
        it._patched = true;
      }
    }
    if (p.attention === "remove all") feeds.forEach((f) => f.items.forEach((i) => (i.needs_you = false)));
    if (p["kestrel-main.attention"] === "append supervision_down" && sc.supervision_down) {
      const f = feeds.find((x) => x.source.id === "kestrel-main");
      if (f) f.attention.push(clone(sc.supervision_down));
    }
    return feeds;
  }

  function laneKind(it) {
    const pr = it.progress || {};
    const cur = pr.current || {};
    const flags = it.flags || [];
    if (it.state === "done") return it.handoff && it.handoff.state === "awaiting_you" ? "merge" : "landed";
    if (it.state === "waiting" && it.needs_you) return "call";
    if (it.state === "failed") return "failed";
    if (it.state === "blocked") return "blocked";
    if (it.state === "unknown") return "unknown";
    if (it.state === "waiting") return "mate";
    if (it.kind === "scout") return "scout";
    if (flags.includes("running_long") || (cur.p90_s && cur.elapsed_s > cur.p90_s)) return "long";
    if (pr.regressed) return "regressed";
    return "moving";
  }

  // The order off-course lanes are pinned in: trouble first, then what has drifted.
  const OFF_ORDER = { failed: 0, long: 1, blocked: 2, regressed: 3, unknown: 4 };
  const OFF = new Set(Object.keys(OFF_ORDER));
  const ATT_ORDER = { decision: 0, approval: 1, machine: 2, capacity: 3, service: 4, credential: 5 };

  function stepOf(it) {
    const pr = it.progress || {};
    const cur = pr.current;
    const steps = pr.steps || [];
    const s = steps.find((x) => x.status === "current" || x.status === "failed");
    return { cur: cur || null, step: s || null, label: s ? s.label : null };
  }

  function laneFacts(it, kind, allItems) {
    const pr = it.progress || {};
    const { cur, label } = stepOf(it);
    const lo = pr.percent_floor, hi = pr.percent_ceiling;
    const range = lo == null ? null : lo === hi ? lo + "%" : lo + "–" + hi + "%";
    let time = null; // "test 31 of 44 min"
    if (cur && cur.elapsed_s != null && cur.typical_s) {
      const step = (label || cur.step || "").toLowerCase();
      const el = cur.elapsed_s, ty = cur.typical_s;
      if (el >= 3600 || ty >= 3600) time = step + " " + SD.dur(el) + " of typical " + SD.dur(ty);
      else time = step + " " + SD.mins(el) + " of " + SD.mins(ty) + " min";
    }
    let word = null, note = null;
    const flags = it.flags || [];
    switch (kind) {
      case "call": word = "Your call"; note = it.state_detail; break;
      case "merge": word = "Merge ready"; note = "waiting for your merge"; break;
      case "failed":
        word = "Failed";
        note = [cur && cur.round ? "round " + cur.round : null, flags.includes("retrying") ? "retrying from rebase" : null].filter(Boolean).join(", ") || null;
        break;
      case "blocked": {
        word = "Blocked";
        const m = /blocked on (\S+)/.exec(it.state_detail || "");
        const on = m && allItems.find((x) => x.id === m[1]);
        note = on ? "waits on " + on.title + " (" + cap(on.machine) + ")" : it.state_detail;
        break;
      }
      case "long":
        word = "Running long";
        note = cur && cur.activity === "quiet" ? "no output for " + SD.dur(cur.last_activity_age_s) : null;
        break;
      case "regressed": word = "Round " + ((cur && cur.round) || 2); note = pr.basis === "default" ? "default weights" : null; break;
      case "unknown": word = "No word"; note = pr.reason ? pr.reason.replace(/^state unreadable: /, "") : null; break;
      case "mate": word = "Asking its lead"; note = null; break;
      case "scout": word = "Scouting"; note = it.reported ? "says ~" + it.reported.percent + "%: " + it.reported.label : "no honest percent"; break;
      case "landed": word = "Landed"; note = it.handoff && it.handoff.state === "complete" ? "merged by itself" : null; break;
      default:
        word = null;
        if (it.reported && it.reported.percent != null) note = "says " + it.reported.percent + "%: " + it.reported.label;
        if (pr.basis === "coarse") note = "state only";
    }
    if (it._patched) note = null;
    return { range, time, word, note, lo, hi, basis: pr.basis || null, round: cur && cur.round };
  }

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  SD.cap = cap;

  SD.buildView = function (fx, scenarioId) {
    const sc = fx.scenarios.find((s) => s.id === scenarioId) || fx.scenarios[0];
    const now = t(sc.now || fx.now);
    const v = {
      id: sc.id, what: sc.what, now, night: sc.theme === "night", tod: SD.timeOfDay(now),
      loading: sc.id === "loading", hostDownS: sc.host_unreachable_s || 0,
      sources: [], machines: [], lanes: [], calls: [], critical: [], also: [],
      done: [], next: [], groups: [], meters: [],
    };
    if (v.night) v.tod = "night";
    if (v.loading) return v;
    const feeds = applyScenario(fx, sc);
    v.empty = feeds.length === 0;

    // Sources and their freshness.
    for (const f of feeds) {
      const age = sc.sources && sc.sources[f.source.id] ? sc.sources[f.source.id].received_age_s : 0;
      const staleAfter = (f.interval_s || 20) * STALE_AFTER_INTERVALS;
      const status = age > LOST_AFTER_S ? "lost" : age > staleAfter ? "stale" : "live";
      v.sources.push({ id: f.source.id, label: f.source.label, machine: f.source.machine, age, status, interval: f.interval_s });
    }
    const srcOf = (f) => v.sources.find((s) => s.id === f.source.id);

    // Machines: each machine's own feed is the authority for it.
    const seen = new Map();
    for (const f of feeds) {
      for (const m of f.machines) {
        const own = f.source.machine === m.id;
        const prev = seen.get(m.id);
        if (!prev || (own && !prev.own) || (prev.m.status === "unknown" && m.status !== "unknown")) seen.set(m.id, { m, own, src: srcOf(f) });
      }
    }
    const lanesBy = {};
    for (const f of feeds) for (const it of f.items) lanesBy[it.machine] = (lanesBy[it.machine] || 0) + 1;
    for (const { m, src } of seen.values()) {
      const ownSrc = v.sources.find((s) => s.machine === m.id) || src;
      v.machines.push({ ...m, lanes: lanesBy[m.id] || 0, src: ownSrc, fresh: ownSrc ? ownSrc.status : "live" });
    }
    const MORDER = { kestrel: 0, basalt: 1, tern: 2 };
    v.machines.sort((a, b) => (MORDER[a.id] ?? 9) - (MORDER[b.id] ?? 9) || a.id.localeCompare(b.id));

    // Lanes.
    const all = feeds.flatMap((f) => f.items);
    for (const f of feeds) {
      const src = srcOf(f);
      for (const it of f.items) {
        const kind = laneKind(it);
        v.lanes.push({ it, id: it.id, title: it.title, group: it.group, machine: it.machine, kind, off: OFF.has(kind),
          facts: laneFacts(it, kind, all), fresh: src.status, srcAge: src.age, started: t(it.started_at),
          lastEvent: it.last_event ? t(it.last_event.at) : null, reportedAt: it.reported ? t(it.reported.at) : null });
      }
    }

    // What waits on the viewer.
    for (const f of feeds) {
      const src = srcOf(f);
      for (const a of f.attention) {
        const row = { ...a, age: now - t(a.since), fresh: src.status, src: src.id, glyph: a.kind === "approval" ? "approve" : "needs" };
        if (a.severity === "critical") v.critical.push(row);
        else if (a.severity === "info") v.also.push(row);
        else v.calls.push(row);
      }
    }
    v.calls.sort((a, b) => (ATT_ORDER[a.kind] ?? 9) - (ATT_ORDER[b.kind] ?? 9) || b.age - a.age);

    for (const f of feeds) {
      for (const d of f.done || []) v.done.push({ ...d, ago: now - t(d.at), at: t(d.at) });
      for (const n of f.next || []) v.next.push(n);
      for (const g of f.groups || []) v.groups.push(g);
      if (f.meters) for (const a of f.meters.accounts) v.meters.push({ ...a, fresh: srcOf(f).status });
    }
    v.done.sort((a, b) => b.at - a.at);

    v.off = v.lanes.filter((l) => l.off).sort((a, b) => OFF_ORDER[a.kind] - OFF_ORDER[b.kind]);
    v.underway = v.lanes.filter((l) => l.kind === "moving" || l.kind === "mate");
    v.scouts = v.lanes.filter((l) => l.kind === "scout");
    v.landedLanes = v.lanes.filter((l) => l.kind === "landed");
    v.waitingLanes = v.lanes.filter((l) => l.kind === "call" || l.kind === "merge");

    const live = v.sources.filter((s) => s.status === "live").length;
    v.trust = {
      live, total: v.sources.length,
      newest: v.sources.length ? Math.min(...v.sources.map((s) => s.age)) : null,
      oldest: v.sources.length ? Math.max(...v.sources.map((s) => s.age)) : null,
      allLost: v.sources.length > 0 && v.sources.every((s) => s.status === "lost"),
      silent: v.sources.filter((s) => s.status !== "live"),
    };
    v.weather = v.critical.length ? "storm" : v.trust.allLost ? "fog" : v.trust.silent.length ? "patchy-fog" : "clear";
    return v;
  };

  // Which crew members loop their work animation. "calm": lanes whose state changed or who
  // reported in the last 10 minutes; "full": every lane producing output right now. Never more than six.
  SD.animatedLanes = function (v, motion) {
    if (motion === "still" || v.night) return new Set();
    const busy = v.lanes.filter((l) => (l.kind === "moving" || l.kind === "regressed") && l.fresh === "live");
    let pick;
    if (motion === "full") pick = busy.filter((l) => { const c = (l.it.progress || {}).current; return !c || c.activity === "active"; });
    else pick = busy.filter((l) => [l.lastEvent, l.reportedAt, l.started].some((x) => x && v.now - x <= 600));
    return new Set(pick.slice(0, 6).map((l) => l.id));
  };
})();
