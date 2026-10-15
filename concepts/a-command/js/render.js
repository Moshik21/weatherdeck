/* Fleet command, concept A: builds the command screen from the view model.
   Text is set with textContent only. One DOM serves both layouts: the TV shows the 1-second
   and 5-second layers on one screen; the phone stacks the same panels and adds the 30-second
   detail (every lane, landed table, queue, releases, allowances, machine vitals) below. */
"use strict";

const Render = (() => {
  const { dur, shortMin, hm, dayHm, dateLine } = Model;
  const S = Sprites;

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style") e.style.cssText = v; // CSSOM, allowed by the page's CSP
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  const label = (text, cls) => h("span", { class: "lbl" + (cls ? " " + cls : ""), text });

  // ---------------------------------------------------------------------------------------
  // Resource bar: clock, live lamp, allowance counters, landed score.
  function resourceBar(v) {
    const bar = h("header", { class: "bar frame-well" });
    const [dow, dd, mon] = dateLine(v.now).split(" ");
    bar.append(h("div", { class: "clock" },
      h("span", { class: "time num-big", text: hm(v.now) }),
      h("span", { class: "two date" }, label(dow.toUpperCase(), "dim"), label(`${dd} ${mon.toUpperCase()}`, "dim"))));

    // trust: is the board live?
    const live = h("div", { class: "live" });
    if (v.mode === "loading") live.append(S.lamp("none"), h("div", { class: "two" }, label("CONNECTING"), h("span", { class: "sub", text: "first report on its way" })));
    else if (v.mode === "empty") live.append(S.lamp("none"), h("div", { class: "two" }, label("NO SOURCE YET"), h("span", { class: "sub", text: "waiting for the first report" })));
    else if (v.mode === "hostdown") {
      const next = v.retryEveryS - (v.hostDownS % v.retryEveryS);
      live.classList.add("bad");
      bar.classList.add("host-down");
      live.append(S.lamp("down"), h("div", { class: "two" }, label("HOST NOT ANSWERING", "trouble"),
        h("span", { class: "sub", text: `for ${dur(v.hostDownS)}. Newest data ${dur(v.newestAge)} old, next try in ${dur(next)}.` })));
    } else {
      const n = v.sources.length, liveN = v.sources.filter(s => s.level === "live").length;
      const worst = ["lost", "stale", "late", "live"].find(l => v.sources.some(s => s.level === l));
      const silent = v.sources.filter(s => s.level === "stale" || s.level === "lost");
      let word = worst === "live" ? "LIVE" : worst === "late" ? "LATE" : "SILENT", sub = `${dur(v.newestAge)}, ${liveN} of ${n} sources`;
      if (v.mode === "lost") { word = "NO WORD"; sub = `for ${dur(v.newestAge)}, all ${n} sources`; }
      else if (silent.length) { sub = silent.map(s => `${s.machine[0].toUpperCase() + s.machine.slice(1)} silent ${dur(s.age)}`).join(", "); }
      live.append(S.lamp(worst), h("div", { class: "two" }, label(word, worst === "live" ? "" : "trouble"), h("span", { class: "sub", text: sub })));
    }
    bar.append(live);

    // allowance accounts as resource counters
    const res = h("div", { class: "res" });
    for (const acc of v.accounts) {
      const wk = acc.windows.find(w => w.id === "week") || acc.windows[acc.windows.length - 1];
      const fh = acc.windows.find(w => w.id === "five_hour");
      const short = acc.runway && acc.runway.status === "exhausts_before_reset";
      const runway = short ? "EMPTY " + dayHm(acc.runway.projected_empty_at).toUpperCase() : "LASTS TO RESET";
      const name = acc.machine ? acc.machine[0].toUpperCase() + acc.machine.slice(1) : acc.label;
      res.append(h("div", { class: "counter" + (short ? " warn" : "") + (acc._fog ? " fog" : "") },
        S.battery(wk.percent_remaining, short, acc._fog),
        h("div", { class: "two" },
          h("span", { class: "lbl" }, h("span", { class: "dim", text: `${name.toUpperCase()} ${wk.id === "week" ? "WEEK" : wk.label.toUpperCase()} ` }), `${wk.percent_remaining}%`),
          h("span", { class: "lbl runway" + (short ? " need" : ""), text: acc._fog ? "LAST KNOWN" : runway }))));
    }
    if (!v.accounts.length && v.mode !== "ok" && v.mode !== "hostdown" && v.mode !== "lost") res.append(h("span", { class: "sub", text: "allowances appear with the first report" }));
    bar.append(res);

    // Phone only: the three bases as shape + name, so machine health is on the first screen.
    if (v.machines.length) {
      const order = ["kestrel", "basalt", "tern"];
      bar.append(h("div", { class: "bar-bases" }, v.machines.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map(m => {
        const st = m._fog ? "silent" : m.crit ? "failed" : m.status === "warn" ? "warn" : "square";
        const word = m._fog ? " SILENT" : m.crit ? " ALERT" : m.status === "warn" ? " STRUGGLING" : "";
        return h("span", { class: "bb" }, S.glyph(st, null, "g-sm"), label(m.label.toUpperCase() + word, m._fog ? "fog" : ""));
      })));
    }
    const landed = h("div", { class: "score" }, S.flag(),
      h("div", { class: "two" }, label("LANDED"), label("TODAY", "dim")),
      h("span", { class: "num-big", text: v.mode === "loading" || v.mode === "empty" ? "–" : String(v.done.length) }));
    bar.append(landed);
    return bar;
  }

  // ---------------------------------------------------------------------------------------
  // Units: one card per lane. Off-course lanes lead; normal lanes fold into a formation.
  function moodOf(it) {
    if (it.kind === "scout") return { face: "ok", scout: true };
    return { face: { failed: "hurt", long: "sweat", blocked: "frown", silent: "sleep", quiet: "sleep", regressed: "worry" }[it.off]
      || (it.cls === "landed" ? "happy" : it.cls === "order" ? "worry" : "ok"), scout: false };
  }
  function toneOf(it) {
    if (it._fog) return "fog";
    if (it.state === "done") return "done";
    if (it.off === "failed") return "trouble";
    if (it.off === "blocked" || it.off === "silent" || it.state === "waiting") return "neutral";
    return "move";
  }
  function words(it, v) {
    const c = it.cur;
    let tag = "", why = "", glyph = "moving", tagCls = "";
    if (it.cls === "off") {
      tag = it.offInfo.word; glyph = it.offInfo.glyph;
      if (it.off === "failed") { tagCls = "trouble"; why = [it.stepLabel, c && c.round ? "round " + c.round : null].filter(Boolean).join(", ") + (it.flags.includes("retrying") ? ", retrying" : ""); }
      if (it.off === "long") { tagCls = "need"; why = c.activity === "quiet" ? `quiet ${dur(c.last_activity_age_s)}` : it.flags.includes("machine_degraded") ? `${cap(it.machine)} is struggling` : `${it.stepLabel} past p90`; }
      if (it.off === "blocked") { tagCls = "trouble"; why = `waits on ${it.blockedOn}`; }
      if (it.off === "silent") { why = it.doing; }
      if (it.off === "quiet") { why = `no output for ${dur(c.last_activity_age_s)}`; }
      if (it.off === "regressed") { glyph = "dropped"; tag = "ROUND " + (c && c.round ? c.round : 2); why = `back to ${it.stepLabel}`; }
    } else if (it.cls === "order") {
      glyph = it.handoff && it.handoff.state === "awaiting_you" ? "approve" : "needs";
      tag = glyph === "approve" ? "MERGE READY" : "YOUR CALL"; tagCls = "need";
      why = glyph === "approve" ? `waiting ${dur(v.now - Model.epoch(it.handoff.since))}` : `waiting ${dur(it.waitingSince || 0)}`;
    } else if (it.cls === "landed") {
      glyph = "done"; tag = "LANDED"; tagCls = "done";
      why = it.handoff && it.handoff.since ? `${it.state_detail === "landed" ? "by itself, " : ""}${dur(v.now - Model.epoch(it.handoff.since))} ago` : "complete";
    } else {
      glyph = it.sub === "scout" ? "scout" : it.sub === "mate" ? "mate" : "moving";
      tag = it.sub === "scout" ? "SCOUTING" : it.sub === "mate" ? "ASKING" : (it.stepLabel || "WORKING").toUpperCase();
      why = it.reported ? `says ${it.reported.percent}%, ${it.reported.label}` : it.doing;
    }
    if (it._fog) { tagCls = "fog"; why = `last known, ${dur(it._src.age)} ago`; }
    return { tag, why, glyph, tagCls };
  }
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  function timeText(it) {
    const c = it.cur;
    if (it.state === "done") return "finished";
    if (!c || !c.typical_s) return it.kind === "scout" ? "no honest %" : it.basis === "coarse" ? "state only" : "time unknown";
    return `${shortMin(c.elapsed_s)} of ${shortMin(c.typical_s)}`;
  }
  function rangeText(it) {
    if (!it.range) return it.kind === "scout" && it.reported ? `~${it.reported.percent}%` : "–";
    return it.range[0] === it.range[1] ? `${it.range[0]}%` : `${it.range[0]}–${it.range[1]}%`;
  }

  function unitCard(it, v, opts = {}) {
    const w = words(it, v);
    const pf = h("div", { class: "pf" }, S.portrait(it.id, it.group, moodOf(it)));
    const card = h("article", { class: `unit u-${it.cls}${it.off ? " off-" + it.off : ""}${it._fog ? " fogged" : ""}`, "aria-label": `${it.title}: ${w.tag.toLowerCase()}` },
      pf,
      h("div", { class: "u-main" },
        h("div", { class: "u-l1" },
          h("span", { class: "u-name", text: it.title }),
          h("span", { class: "u-range num", text: rangeText(it), title: it.basis === "default" ? "estimated from default weights" : null })),
        h("div", { class: "u-l2" },
          S.hpBar(60, 6, it.range, toneOf(it)),
          S.stBar(44, 6, it.cur),
          h("span", { class: "u-time", text: timeText(it) })),
        h("div", { class: "u-l3" },
          S.glyph(it._fog ? "silent" : w.glyph, null, "g-sm"),
          h("span", { class: "u-tag lbl " + w.tagCls, text: w.tag }),
          h("span", { class: "u-why", text: w.why }))));
    if (opts.detail) {
      card.querySelector(".u-main").append(h("p", { class: "u-doing" },
        `${it.groupLabel} on ${cap(it.machine)}.` + (it.doing && it.doing !== w.why ? " " + it.doing : ""),
        it.basis === "default" ? h("span", { class: "dim", text: " Range from default step weights." }) : null));
    }
    return card;
  }

  function roster(v) {
    const sec = h("section", { class: "roster frame-steel", "aria-label": "Units" });
    const nOff = v.off.length;
    sec.append(h("h2", { class: "p-head" },
      label(`OFF COURSE ${nOff}`), label(`OF ${v.items.length} UNITS`, "dim")));
    const list = h("div", { class: "units" });
    v.off.forEach(it => list.append(unitCard(it, v)));
    if (!nOff) list.append(h("p", { class: "calm-line", text: "Every unit is on course." }));
    sec.append(list);

    // fold: everything normal becomes a formation and one sentence
    // Lanes waiting on an order live in the orders window; landed lanes count in the LANDED score.
    const normal = v.task;
    const moving = v.task.filter(i => i.sub === "moving").length, scouts = v.task.filter(i => i.sub === "scout").length,
      mate = v.task.filter(i => i.sub === "mate").length;
    const parts = [];
    if (moving) parts.push(`${moving} moving`);
    if (scouts) parts.push(`${scouts} scout${scouts > 1 ? "s" : ""}`);
    if (mate) parts.push(`${mate} asking its supervisor`);
    const fold = h("div", { class: "fold" },
      h("div", { class: "fold-l1" }, label("+" + normal.length + " ON TASK"),
        h("span", { class: "formation" }, normal.map(i => S.mini(i.id, i.kind === "scout" ? "scout" : "task")))),
      h("p", { class: "fold-l2", text: parts.join(", ") }));
    sec.append(fold);
    return sec;
  }

  // ---------------------------------------------------------------------------------------
  // Bases: the minimap.
  function pipTone(it) {
    const cs = getComputedStyle(document.documentElement);
    const c = n => cs.getPropertyValue("--c-" + n).trim();
    if (it._fog) return c("fog");
    if (it.cls === "order") return c("need");
    if (it.off === "failed" || it.off === "blocked") return c("trouble");
    if (it.off === "long" || it.off === "quiet") return c("need");
    if (it.off === "silent") return c("fog");
    if (it.cls === "landed") return c("done");
    return c("ink2");
  }
  function mapPanel(v, artW) {
    const sec = h("section", { class: "bases frame-steel", "aria-label": "Bases" });
    const mapW = artW, mapH = 52;
    const order = ["kestrel", "basalt", "tern"];
    const ms = v.machines.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const xs = [0.17, 0.5, 0.83];
    const bases = ms.map((m, i) => ({ id: m.id, x: xs[i] || 0.5, lanes: m.lanes.map(it => ({ tone: pipTone(it) })), fog: m._fog }));
    const wrap = h("div", { class: "map-wrap" });
    if (v.mode === "loading" || v.mode === "empty") {
      const { canvas } = S.minimap(mapW, mapH, [], "empty");
      wrap.append(canvas, h("p", { class: "map-empty", text: v.mode === "empty" ? "No base has reported yet." : "Reading the map." }));
      sec.append(wrap);
      return sec;
    }
    const { canvas, placed } = S.minimap(mapW, mapH, bases, "fleet");
    wrap.append(canvas);
    ms.forEach((m, i) => {
      const p = placed[i];
      const st = m.crit ? "failed" : m.status === "warn" ? "warn" : m.status === "down" || m.status === "critical" ? "failed" : "square";
      const marker = h("div", { class: "base-mark", style: `--x:${p.cx};--y:${p.top}` }, S.glyph(st, null, "g-sm"));
      if (m.status === "warn" && !m._fog) {
        const sm = h("div", { class: "smoke-wrap", style: `--x:${p.cx};--y:${p.top}` }, S.smoke());
        wrap.append(sm);
      }
      wrap.append(marker);
      const disk = m.disks && m.disks.find(d => d.free_gb <= d.warn_gb);
      let line2, cls2 = "";
      if (m._fog) { line2 = `for ${dur(m.src.age)}`; cls2 = "fog"; }
      else if (m.crit) { line2 = "supervision down"; cls2 = "trouble"; }
      else if (m.status === "warn") { line2 = disk ? `disk ${disk.free_gb} GB, swap ${m.mem.swap_used_pct}%` : "struggling"; cls2 = "need"; }
      else line2 = `${m.lanes.length} units, load ${m.load ? Math.round(m.load.l1) + "/" + m.load.cores : "–"}`;
      wrap.append(h("div", { class: "base-label", style: `--x:${p.cx}` },
        h("span", { class: "lbl" + (m._fog ? " fog" : "") }, m.label.toUpperCase(),
          h("span", { class: "tv-only", text: m._fog ? " SILENT" : m.crit ? " ALERT" : m.status === "warn" ? " STRUGGLING" : " OK" })),
        h("span", { class: "base-sub " + cls2, text: line2 })));
    });
    sec.append(wrap);
    return sec;
  }

  // ---------------------------------------------------------------------------------------
  // Orders: the command card. The one amber object on the board.
  function lookoutMood(v) {
    if (v.mode === "lost" || v.mode === "empty") return "lost";
    if (v.orders.some(o => o.severity === "critical")) return "alarm";
    if (v.theme === "night" && !v.orders.length) return "sleep";
    if (v.orders.length) return "alert";
    return "calm";
  }
  function orderTile(o, i, v) {
    const crit = o.severity === "critical";
    const g = crit ? "failed" : o.k.glyph;
    const tile = h("li", { class: "tile" + (crit ? " crit" : "") + (i === 0 ? " top" : "") + (o._fog ? " fogged" : ""),
        "aria-label": `${o.k.word}: ${o.title}. ${o.how}. Waiting ${dur(o.age)}.` },
      S.glyph(o._fog ? "silent" : g, null, "g-md"),
      h("div", { class: "t-text" },
        h("p", { class: "t-title", text: o.title }),
        o.detail ? h("p", { class: "t-detail", text: o.detail }) : null,
        h("p", { class: "t-how", text: o._fog ? `last known, ${cap(o.machine)} silent ${dur(o._src.age)}` : o.how })),
      h("span", { class: "t-age num", text: shortMin(o.age) }));
    return tile;
  }
  function ordersCard(v) {
    const n = v.orders.length;
    const calm = !n && v.mode !== "loading";
    const sec = h("section", { class: "orders " + (calm || v.mode === "loading" || v.mode === "empty" ? "frame-calm calm" : "frame-gold"), "aria-label": "Orders awaiting you" });
    const title = n ? (n === 1 ? "ORDER AWAITING YOU" : "ORDERS AWAITING YOU") : v.mode === "ok" ? "NO ORDERS WAITING" : "ORDERS";
    sec.append(h("h2", { class: "o-tab lbl", text: title }));

    const top = v.orders[0];
    const count = h("div", { class: "o-count" }, h("span", { class: "num-hero", text: v.mode === "loading" || v.mode === "empty" ? "–" : String(n) }));
    const dlg = h("div", { class: "dialog" });
    const say = h("div", { class: "say" });
    if (v.mode === "loading") say.append(h("p", { class: "d-title", text: "Opening the command screen." }), h("p", { class: "d-how", text: "Orders show here once the host answers." }));
    else if (v.mode === "empty") say.append(h("p", { class: "d-title", text: "Nothing has reported in yet." }), h("p", { class: "d-how", text: "Orders appear when the first machine reports." }));
    else if (!n) say.append(h("p", { class: "d-title", text: "Nothing waits on you." }),
      h("p", { class: "d-how", text: `All ${v.items.length} units are on task or landed.` }),
      h("p", { class: "d-wait", text: "New orders open here." }));
    else {
      const crit = top.severity === "critical";
      say.append(h("p", { class: "d-title" + (crit ? " crit" : "") }, crit ? h("span", { class: "lbl trouble", text: "CRITICAL  " }) : null, top.title),
        h("p", { class: "d-how" }, S.pointer(), top.how),
        top.detail ? h("p", { class: "d-detail", text: top.detail }) : null,
        h("p", { class: "d-wait" }, `Waiting ${dur(top.age)}` + (top._fog ? `, last known (${cap(top.machine)} silent)` : "")));
    }
    dlg.append(h("div", { class: "speaker", title: "Lookout" }, S.lookout(lookoutMood(v))), say);
    if (n) dlg.append(h("span", { class: "more-cursor" }, S.cursor()));
    sec.append(h("div", { class: "o-top" }, count, dlg));

    // Calm: no sockets. The card shows the day's latest landings instead, as a high-score table.
    if (!n) {
      if (v.mode === "ok" && v.done.length) sec.append(h("div", { class: "calm-scores" }, h("h3", { class: "lbl dim", text: "LATEST LANDINGS" }),
        h("ol", { class: "hiscore" }, v.done.slice(0, 4).map((d, i) => h("li", null,
          h("span", { class: "num dim", text: String(i + 1) }),
          h("span", { class: "num", text: hm(Model.epoch(d.at)) }),
          h("span", { class: "lbl tag", text: (v.groups.find(g => g.id === d.group) || { label: d.group }).label.slice(0, 3).toUpperCase() }),
          h("span", { class: "hs-title", text: d.title }))))));
      else sec.append(h("div", { class: "calm-scores" }));
      return sec;
    }
    // The card holds six order slots. Up to four orders get roomy 2 x 2 tiles; five or six use all six slots.
    const slots = n <= 4 ? 4 : 6;
    const tiles = h("ol", { class: `tiles slots-${slots}` });
    v.orders.slice(0, 6).forEach((o, i) => tiles.append(orderTile(o, i, v)));
    for (let i = n; i < slots; i++) tiles.append(h("li", { class: "tile socket", "aria-hidden": "true" }));
    if (n > 6) tiles.lastChild.querySelector(".t-title").textContent = `+${n - 5} more orders, listed on the phone`;
    sec.append(tiles);
    if (v.also.length) sec.append(h("p", { class: "also" }, h("span", { class: "lbl dim", text: "ALSO  " }),
      v.also.map(a => a.title).join("; "), h("span", { class: "phone-only", text: " (not counted)" })));
    return sec;
  }

  // ---------------------------------------------------------------------------------------
  // 30-second detail, phone only: every other lane, landed table, queue, releases, meters, machines.
  function detail(v) {
    const sec = h("div", { class: "detail" });
    const panel = (title, ...kids) => h("section", { class: "frame-steel dpanel" }, h("h2", { class: "p-head" }, label(title)), ...kids);

    const lanes = v.orderLanes.concat(v.task, v.landedLanes);
    sec.append(panel(`ALL OTHER UNITS ${lanes.length}`, h("div", { class: "units" }, lanes.map(it => unitCard(it, v, { detail: true })))));

    sec.append(panel("LANDED TODAY", h("ol", { class: "hiscore" }, v.done.map((d, i) => h("li", null,
      h("span", { class: "num rank", text: String(i + 1).padStart(2, "0") }),
      h("span", { class: "num", text: hm(Model.epoch(d.at)) }),
      h("span", { class: "lbl tag", text: (v.groups.find(g => g.id === d.group) || { label: d.group }).label.slice(0, 3).toUpperCase() }),
      h("span", { class: "hs-title", text: d.title }),
      h("span", { class: "dim hs-via", text: d.via }))))));

    sec.append(panel("NEXT UP", h("ul", { class: "dl" }, v.next.map(n => h("li", null, h("b", { text: n.title }), h("span", { class: "dim", text: ` ${n.reason}${n.until ? ", until " + n.until : ""}.` }))))));

    sec.append(panel("RELEASES", h("ul", { class: "dl" }, v.groups.filter(g => g.checkpoint).map(g => {
      const cp = g.checkpoint;
      const waits = cp.next.waiting_on.map(id => { const it = v.items.find(i => i.id === id); return it ? it.title : id; }).join(", ");
      return h("li", null, h("b", { text: `${g.label} ${cp.next.version}` }),
        h("span", { text: ` waits on ${waits}; ${cp.next.items_ready} ready. Live: ${cp.live.version}. Gate: ${cp.gate.value === "pass" ? "passed" : "not run"}.` }));
    }))));

    sec.append(panel("ALLOWANCE", h("ul", { class: "dl" }, v.accounts.map(a => h("li", null, h("b", { text: a.label }),
      h("span", { text: " " + a.windows.map(w => `${w.label} ${w.percent_remaining}% left, resets ${dayHm(w.resets_at)}`).join("; ") + "." }),
      h("span", { class: "dim", text: a.runway.status === "exhausts_before_reset" ? ` Empty ${dayHm(a.runway.projected_empty_at)} at this pace.` : " Lasts to reset." }))))));

    sec.append(panel("BASES", h("ul", { class: "dl" }, v.machines.map(m => h("li", null, h("b", { text: `${m.label}${m.role ? ", " + m.role : ""}` }),
      h("span", { text: m.load ? ` Load ${m.load.l1} on ${m.load.cores} cores, memory ${m.mem.used_pct}%, swap ${m.mem.swap_used_pct}%, ` + m.disks.map(d => `${d.label} ${d.free_gb} GB free`).join(", ") + "." : "" }),
      h("span", { class: "dim", text: " " + (m.extras || []).map(x => `${x.label} ${x.value}`).join(", ") + "." }))))));

    sec.append(panel("SOURCES", h("ul", { class: "dl" }, v.sources.map(s => h("li", null, h("b", { text: s.label }),
      h("span", { class: s.level === "live" ? "" : "trouble-text", text: ` ${s.level}, last report ${dur(s.age)} ago.` }))))));
    return sec;
  }

  // ---------------------------------------------------------------------------------------
  function takeover(v) {
    if (v.mode !== "lost") return null;
    return h("div", { class: "takeover", role: "alert" },
      h("div", { class: "frame-calm tk-box" },
        h("h2", { class: "o-tab lbl", text: "SIGNAL LOST" }),
        h("div", { class: "tk-row" }, S.lookout("lost"),
          h("div", null,
            h("p", { class: "tk-big", text: `No word from any base for ${dur(v.newestAge)}` }),
            h("p", { class: "tk-body", text: `Everything on this board is last known, from ${hm(v.now - v.newestAge)}. Treat it as unconfirmed until a base reports again.` })))));
  }

  function board(v, layout, artW) {
    const b = h("div", { class: `board mode-${v.mode}`, "data-scenario": v.id });
    b.append(resourceBar(v));
    if (v.mode === "loading" || v.mode === "empty") {
      const sec = h("section", { class: "roster frame-steel", "aria-label": "Units" },
        h("div", { class: "p-head" }, label("UNITS")),
        h("div", { class: "units" }, [0, 1, 2].map(() => h("div", { class: "unit ghost", "aria-hidden": "true" }, h("div", { class: "pf" }), h("div", { class: "u-main" })))),
        h("p", { class: "calm-line", text: v.mode === "empty" ? "Units appear here when a machine reports its lanes." : "Loading units." }));
      b.append(sec);
    } else b.append(roster(v));
    b.append(mapPanel(v, artW));
    b.append(ordersCard(v));
    if (layout === "phone" && v.mode !== "loading" && v.mode !== "empty") b.append(detail(v));
    const tk = takeover(v);
    if (tk) b.append(tk);
    if (v.orders.some(o => o.severity === "critical")) b.append(h("div", { class: "vignette", "aria-hidden": "true" }));
    return b;
  }

  return { board, h };
})();
