/* Handheld LCD: draws a view model as the TV poster or the phone column.
   Text goes in with textContent only; sprites come from glyphs.js. */
(function () {
  "use strict";
  const HH = window.HH;
  const dur = (s, c) => HH.model.dur(s, c);

  function h(tag, cls, kids) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (kids == null) return el;
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => {
      if (k == null || k === false) return;
      el.appendChild(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k);
    });
    return el;
  }

  const GLYPH_FOR = {
    call: "call", approve: "approve", failed: "failed", long: "long", quiet: "quiet", blocked: "blocked",
    unknown: "unknown", regressed: "regressed", mate: "mate", scout: "scout", moving: "moving", landed: "done",
  };
  function attnGlyph(a) {
    if (a.severity === "critical") return "critical";
    if (a.kind === "approval") return "approve";
    return "call";
  }

  /* ---------- shared pieces ---------- */

  function trustLine(v) {
    const lamp = v.trust === "live" ? "live" : v.trust === "late" ? "late" : v.trust === "host" ? "host" : v.trust === "lost" ? "lost" : "stale";
    let words;
    if (v.trust === "host") words = "Host not answering " + dur(v.hostDown) + ". Data " + dur(v.newestAge) + " old, next try in " + dur(v.nextTry);
    else if (v.trust === "lost") words = "No report for " + dur(v.newestAge);
    else if (v.trust === "stale") words = v.liveCount + " of " + v.sources.length + " live, newest " + dur(v.newestAge);
    else if (v.trust === "late") words = "Late, newest " + dur(v.newestAge);
    else words = "Live, newest " + dur(v.newestAge);
    return h("p", "trust t-" + v.trust, [HH.lamp(lamp), h("span", null, words)]);
  }

  function birdMood(v) {
    if (v.loading || v.empty) return "awake";
    if (v.allLost || v.trust === "stale") return "worried";
    if (v.callCount > 0) return "alert";
    if (v.night) return "asleep";
    return "awake";
  }

  function bird(v) {
    const mood = birdMood(v);
    const wrap = h("div", "pet mood-" + mood, [HH.bird(mood)]);
    if (mood === "alert") wrap.appendChild(h("span", "bubble", "!"));
    if (mood === "worried") wrap.appendChild(h("span", "bubble", "?"));
    if (mood === "asleep") wrap.appendChild(h("span", "zzz", "Z Z Z"));
    return wrap;
  }

  function machineRow(m, phone) {
    const li = h("li", "mach p-" + m.pip + (m.stale ? " is-stale" : ""), [
      h("span", "pipbox", HH.pip(m.pip)),
      h("span", "mname", m.label),
      h("span", "mlanes", m.lanes + (m.lanes === 1 ? " lane" : " lanes")),
      h("span", "mword", phone && m.notes.length && !m.stale ? m.notes.join(", ") : m.word),
    ]);
    if (phone) {
      const bits = [];
      if (m.role) bits.push(m.role);
      if (!m.stale && m.word !== "ok") bits.push(m.word);
      if (m.load) bits.push("load " + m.load.l1 + " on " + m.load.cores);
      if (m.mem) bits.push("memory " + m.mem.used_pct + "%");
      m.disks.forEach((d) => bits.push(d.label.toLowerCase() + " " + d.free_gb + " GB free"));
      if (m.stale) bits.push("last known");
      li.appendChild(h("span", "msub", bits.join(", ")));
    }
    return li;
  }

  // honest range: the floor and ceiling, snapped to whole art pixels of a 30-px track
  function bar(item) {
    const p = item.progress || {};
    const b = h("span", "bar" + (item.stale ? " is-stale" : ""));
    if (p.percent_floor == null) { b.classList.add("is-none"); return b; }
    const W = 30;
    const f = Math.round((W * p.percent_floor) / 100);
    const c = Math.round((W * p.percent_ceiling) / 100);
    const track = h("span", "track");
    const fl = h("i", "floor");
    fl.style.width = (100 * f) / W + "%";
    const sp = h("i", "span");
    sp.style.left = (100 * f) / W + "%";
    sp.style.width = (100 * Math.max(c - f, 0)) / W + "%";
    track.appendChild(fl);
    track.appendChild(sp);
    b.appendChild(track);
    return b;
  }

  /* ---------- the plate: the one inverted object ---------- */

  function plate(v, phone) {
    if (v.callCount === 0) return calmPlate(v, phone);
    const top = v.top;
    const crit = v.critical.length > 0;
    const lastKnown = v.allLost;
    const sec = h("section", "plate" + (crit ? " is-crit" : "") + (lastKnown ? " is-lastknown" : ""));
    sec.setAttribute("aria-labelledby", "plate-kicker");
    if (crit) sec.appendChild(h("i", "hazard"));
    sec.appendChild(h("div", "corner", HH.glyph(attnGlyph(top), "g2")));

    const kicker = lastKnown ? "Last known" : crit ? "Trouble first" : "Waiting on you";
    const head = h("div", "plate-head", [
      h("div", "count", [h("span", "count-n", String(v.callCount)), h("span", "sr", v.callCount === 1 ? " thing" : " things")]),
      h("div", "headtext", [
        h("p", "kicker", [h("span", null, kicker)]),
        h("h1", "call-title", top.title),
        h("p", "call-how", [
          h("span", "how", top.how + "."),
          h("span", "age", [(top.stale && !lastKnown ? "Last known, waiting " : "Waiting ") + dur(top.age), h("span", "caret", "")]),
        ]),
      ]),
    ]);
    head.querySelector(".kicker").id = "plate-kicker";
    sec.appendChild(head);
    if (phone && top.detail) sec.appendChild(h("p", "call-detail", top.detail));

    const rest = v.calls.slice(1);
    if (rest.length) {
      const ul = h("ul", "more");
      rest.forEach((a) => {
        const li = h("li", "more-row" + (a.stale ? " is-stale" : ""), [
          h("span", "mg", HH.glyph(attnGlyph(a))),
          h("span", "mt", (a.stale && !v.allLost ? "Last known: " : "") + a.title),
          h("span", "ma", dur(a.age, true)),
        ]);
        if (phone) li.appendChild(h("span", "mh", a.how + "."));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    }
    sec.appendChild(h("span", "cont", HH.glyph("cont")));
    if (v.info.length) {
      sec.appendChild(h("p", "also", "Also, not counted: " + v.info.map((a) => a.title.charAt(0).toLowerCase() + a.title.slice(1)).join("; ") + "."));
    }
    return sec;
  }

  function calmPlate(v, phone) {
    const sec = h("section", "plate is-calm");
    const moving = v.fold.moving + v.fold.scouts;
    sec.appendChild(h("div", "calm-row", [
      h("span", "calm-g", HH.glyph("done", "g3")),
      h("div", "calm-text", [
        h("p", "calm-big", "Nothing waits on you."),
        h("p", "calm-sub", moving + " lanes moving, " + v.done.length + " landed today" + (v.night ? ". Quiet hours until 07:30." : ".")),
      ]),
    ]));
    return sec;
  }

  /* ---------- off course ---------- */

  // detail text wraps only between its comma-separated parts
  function parts(text) {
    const out = h("span", "ld");
    String(text || "").split(", ").forEach((bit, i, all) => {
      out.appendChild(h("span", "nw", bit + (i < all.length - 1 ? "," : "")));
      if (i < all.length - 1) out.appendChild(document.createTextNode(" "));
    });
    return out;
  }

  function laneRow(it, phone, allLost) {
    const c = it.cls;
    const li = h("li", "lane k-" + c.kind + (it.stale ? " is-stale" : ""));
    li.appendChild(h("span", "lg", HH.glyph(GLYPH_FOR[c.kind] || "moving")));
    li.appendChild(h("span", "lt", it.title));
    li.appendChild(h("span", "lw", c.word));
    li.appendChild(bar(it));
    li.appendChild(h("span", "lr", it.range || "no %"));
    // a silent source's lanes keep their last state word, and say how old it is
    let det = c.detail;
    if (it.stale && !allLost) det = phone ? "last known " + dur(it.staleAge) + " ago, " + c.detail : "last known " + dur(it.staleAge) + " ago";
    li.appendChild(parts(det));
    return li;
  }

  function foldLine(v) {
    const parts = [];
    parts.push(v.fold.moving + " moving on course");
    if (v.fold.scouts) parts.push(v.fold.scouts + (v.fold.scouts === 1 ? " scout" : " scouts"));
    if (v.fold.mate) parts.push(v.fold.mate + " asking " + (v.fold.mate === 1 ? "its lead" : "their leads"));
    return parts.join(", ");
  }

  function course(v, phone) {
    const sec = h("section", "course");
    const head = h("header", "course-head", [
      h("h2", "ch-title", v.off.length ? "Off course " + v.off.length : "Every lane on course"),
      h("p", "ch-fold", foldLine(v)),
    ]);
    sec.appendChild(head);
    if (v.off.length) {
      const ol = h("ol", "lanes");
      v.off.forEach((it) => ol.appendChild(laneRow(it, phone, v.allLost)));
      sec.appendChild(ol);
    }
    return sec;
  }

  function landedBlock(v) {
    const latest = v.done[0];
    return h("div", "landed", [
      h("p", "landed-n", [HH.glyph("landed"), h("span", null, v.done.length + " landed today")]),
      latest ? h("p", "landed-t", "Latest: " + latest.title + ", " + dur(latest.age) + " ago") : null,
    ]);
  }

  function footLine(v, phone) {
    const bits = [];
    const latest = v.done[0];
    const landed = h("p", "foot-landed", [
      HH.glyph("landed"),
      h("b", null, v.done.length + " landed today"),
      latest ? h("span", null, "Latest: " + latest.title + ", " + dur(latest.age) + " ago") : null,
    ]);
    if (phone) bits.push(landed);
    if (v.releases.length) {
      bits.push(h("p", "foot-rel", v.releases.map((r) => r.label + " waits on " + r.waits.join(", ")).join(". ") + "."));
    }
    return h("footer", "course-foot", bits);
  }

  /* ---------- whole boards ---------- */

  function clockBlock(v) {
    return h("div", "clockblock", [
      h("p", "clock", v.clock),
      h("div", "dayrow", [
        h("div", "daytext", [h("p", "day", v.day + ", " + v.tz), v.sources && !v.allLost ? trustLine(v) : null]),
        bird(v),
      ]),
    ]);
  }

  function machines(v, phone) {
    const ul = h("ul", "machines");
    ul.setAttribute("aria-label", "Machines");
    v.machines.forEach((m) => ul.appendChild(machineRow(m, phone)));
    return ul;
  }

  function lostBox(v) {
    return h("div", "notice", [
      h("p", "notice-big", "No signal for " + dur(v.newestAge)),
      h("p", "notice-sub", "Last report " + HH.model.hhmm(v.now - v.newestAge * 1000) + ". Everything here is last known."),
    ]);
  }

  /* Quiet hours with nothing waiting: the LCD falls asleep to the clock. */
  function tvSleep(v, b) {
    b.classList.add("is-asleep");
    const off = v.off.length;
    const warn = v.machines.filter((m) => m.pip !== "ok");
    const facts = [];
    if (off) facts.push(off + (off === 1 ? " lane" : " lanes") + " off course");
    warn.forEach((m) => facts.push(m.label + " " + m.word));
    b.appendChild(h("div", "sleep", [
      h("div", "sleep-top", [h("p", "clock", v.clock), bird(v)]),
      h("p", "sleep-big", "Nothing waits on you."),
      h("p", "sleep-sub", (facts.length ? facts.join(", ") + ". " : "") + "Quiet hours until 07:30."),
      trustLine(v),
    ]));
    return b;
  }

  function tv(v) {
    const b = h("div", "board tv");
    if (v.loading || v.empty) return tvWaiting(v, b);
    if (v.night && v.callCount === 0 && !v.allLost) return tvSleep(v, b);
    const left = h("div", "col-left", [clockBlock(v)]);
    if (v.allLost) left.appendChild(lostBox(v));
    left.appendChild(machines(v, false));
    left.appendChild(landedBlock(v));
    b.appendChild(left);
    b.appendChild(plate(v, false));
    const lower = course(v, false);
    lower.appendChild(footLine(v, false));
    b.appendChild(lower);
    return b;
  }

  function tvWaiting(v, b) {
    b.classList.add(v.loading ? "is-loading" : "is-empty");
    b.appendChild(h("div", "col-left", [clockBlock(v)]));
    const box = h("section", "plate is-waiting");
    if (v.loading) {
      box.appendChild(h("p", "calm-big", ["Reading the fleet", h("span", "caret", "")]));
      box.appendChild(h("p", "calm-sub", "The first view has been asked for. Calls, lanes and machines appear here when it answers."));
    } else {
      box.appendChild(h("p", "calm-big", "No machine has reported yet."));
      box.appendChild(h("p", "calm-sub", "This screen fills in when the first feed reaches the host. Start a pusher on any machine to begin."));
    }
    b.appendChild(box);
    const slots = h("section", "course is-waiting", [
      h("p", "slot", "Off course"),
      h("p", "slot", "Machines"),
      h("p", "slot", "Landed today"),
    ]);
    b.appendChild(slots);
    return b;
  }

  /* ---------- phone ---------- */

  function phone(v) {
    const b = h("div", "board phone");
    const top = h("header", "ph-top", [
      h("div", "ph-clock", [h("p", "clock", v.clock), h("p", "day", v.day + ", " + v.tz)]),
      bird(v),
    ]);
    b.appendChild(top);
    if (v.loading || v.empty) {
      const box = h("section", "plate is-waiting");
      box.appendChild(h("p", "calm-big", v.loading ? ["Reading the fleet", h("span", "caret", "")] : "No machine has reported yet."));
      box.appendChild(h("p", "calm-sub", v.loading ? "Calls, lanes and machines appear when the host answers." : "This screen fills in when the first feed reaches the host."));
      b.appendChild(box);
      return b;
    }
    b.appendChild(trustLine(v));
    // the one-second health answer: one pip and a word per machine
    const pips = h("ul", "ph-pips");
    pips.setAttribute("aria-label", "Machines");
    v.machines.forEach((m) => pips.appendChild(h("li", "p-" + m.pip, [HH.pip(m.pip), h("span", null, m.label + (m.pip === "ok" ? "" : " " + m.word))])));
    b.appendChild(pips);
    if (v.allLost) b.appendChild(lostBox(v));
    b.appendChild(plate(v, true));
    b.appendChild(course(v, true));
    const ms = h("section", "ph-sec");
    ms.appendChild(h("h2", "sec-h", "Machines"));
    ms.appendChild(machines(v, true));
    b.appendChild(ms);
    b.appendChild(footLine(v, true));

    // the 30-second layer: everything, scrolled
    b.appendChild(h("p", "ph-divider", "Every lane, the queue and the meters"));
    v.machines.forEach((m) => {
      const sec = h("section", "ph-sec");
      sec.appendChild(h("h2", "sec-h", m.label + ", " + m.lanes + " lanes"));
      const ol = h("ol", "roster");
      v.items.filter((i) => i.machine === m.id).forEach((it) => ol.appendChild(rosterRow(it, v)));
      sec.appendChild(ol);
      b.appendChild(sec);
    });
    if (v.next.length) {
      const sec = h("section", "ph-sec", [h("h2", "sec-h", "Next " + v.next.length)]);
      const ol = h("ol", "plain");
      v.next.forEach((n) => ol.appendChild(h("li", null, [h("span", "pt", n.title), h("span", "ps", n.reason)])));
      sec.appendChild(ol);
      b.appendChild(sec);
    }
    if (v.releases.length) {
      const sec = h("section", "ph-sec", [h("h2", "sec-h", "Releases")]);
      const ol = h("ol", "plain");
      v.releases.forEach((r) => ol.appendChild(h("li", null, [
        h("span", "pt", r.label + " (live " + r.live + ")"),
        h("span", "ps", "waits on " + r.waits.join(", ") + "; floor check " + (r.gate === "pass" ? "passed" : r.gate === "unknown" ? "not run" : r.gate)),
      ])));
      sec.appendChild(ol);
      b.appendChild(sec);
    }
    if (v.meters.length) {
      const sec = h("section", "ph-sec", [h("h2", "sec-h", "Allowance")]);
      const ol = h("ol", "plain");
      v.meters.forEach((a) => a.windows.forEach((w) => {
        const left = w.percent_remaining;
        const m = h("span", "meter");
        const f = h("i", "floor");
        f.style.width = left + "%";
        m.appendChild(f);
        let runway = "";
        if (w.id === "week" && a.runway) {
          runway = a.runway.status === "exhausts_before_reset" && a.runway.projected_empty_at
            ? ", empty " + HH.model.dayLabel(Date.parse(a.runway.projected_empty_at)).slice(0, 3) + " " + HH.model.hhmm(Date.parse(a.runway.projected_empty_at)) + " before reset"
            : a.runway.status === "through_reset" ? ", lasts to reset" : "";
        }
        ol.appendChild(h("li", null, [
          h("span", "pt", a.label.replace("Primary plan, ", "") + ", " + w.label.toLowerCase() + ": " + left + "% left"),
          m,
          h("span", "ps", "resets " + HH.model.dayLabel(Date.parse(w.resets_at)).slice(0, 3) + " " + HH.model.hhmm(Date.parse(w.resets_at)) + runway),
        ]));
      }));
      sec.appendChild(ol);
      b.appendChild(sec);
    }
    if (v.done.length) {
      const sec = h("section", "ph-sec", [h("h2", "sec-h", "Landed today")]);
      const ol = h("ol", "plain");
      v.done.forEach((d) => ol.appendChild(h("li", null, [h("span", "pt", d.title), h("span", "ps", HH.model.hhmm(Date.parse(d.at)) + ", " + d.via)])));
      sec.appendChild(ol);
      b.appendChild(sec);
    }
    return b;
  }

  function rosterRow(it, v) {
    const c = it.cls;
    const p = it.progress || {};
    const bits = [];
    if (c.word) bits.push(c.word.toLowerCase());
    if (it.doing) bits.push(it.doing);
    const sub = [];
    const cur = p.current;
    if (cur && cur.elapsed_s != null && c.kind !== "long" && c.kind !== "regressed") sub.push(c.detail || "");
    else if (c.detail) sub.push(c.detail);
    if (it.reported) sub.push("agent says " + it.reported.percent + "%: " + it.reported.label);
    if (p.basis === "default") sub.push("default weights");
    if (p.basis === "history" && p.history_n) sub.push(p.history_n + " past runs");
    if (p.reason && c.kind !== "unknown") sub.push(p.reason);
    const li = h("li", "lane rrow k-" + c.kind + (it.stale ? " is-stale" : ""), [
      h("span", "lg", HH.glyph(GLYPH_FOR[c.kind] || "moving")),
      h("span", "lt", it.title),
      h("span", "lr", it.range || "no %"),
      bar(it),
      h("span", "ld", [c.word ? h("b", "lw", c.word) : null, c.word ? " " : null, it.doing || ""]),
      sub.filter(Boolean).length ? h("span", "lx", sub.filter(Boolean).join(", ")) : null,
    ]);
    return li;
  }

  /* The TV never scrolls. If a zone is taller than its slot, drop what the phone also carries:
     first the plate's info line, then the release line under the lanes. */
  function fit(board) {
    if (!board.classList.contains("tv")) return;
    // overflow of in-flow content only; the corner and continue marks sit on the frame on purpose
    const over = (el) => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      let bottom = 0;
      for (const k of el.children) {
        if (getComputedStyle(k).position === "absolute") continue;
        bottom = Math.max(bottom, k.getBoundingClientRect().bottom);
      }
      return bottom > box.bottom - pad + 1;
    };
    const plateEl = board.querySelector(".plate");
    if (over(plateEl)) { const a = plateEl.querySelector(".also"); if (a) a.remove(); }
    const left = board.querySelector(".col-left");
    if (over(left)) { const l = left.querySelector(".landed"); if (l) l.remove(); }
    const course = board.querySelector(".course");
    if (over(course)) { const f = course.querySelector(".course-foot"); if (f) f.remove(); }
    board.classList.toggle("is-overfull", over(plateEl) || over(course) || over(board.querySelector(".col-left")));
  }

  HH.render = { tv: tv, phone: phone, fit: fit };
})();
