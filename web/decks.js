"use strict";
/* Decks: the board's click-in views (docs/theme-spec.md section 16). Every level is a hash route keyed by ship (machine) id
   (frontdoor.js parses them: #/sea, #/board, #/ship/<ship>, .../deck/<deck>, .../item/<key>).
   Preview keys (#night=1, ...) ride after a "?" on a route. The page only reads: an item shows the exact words to say in
   chat and never sends anything. The flagship (the primary source's machine) carries the fleet-wide decks; any other ship's
   decks are the same views filtered to that machine. Moves between levels are drawn by the scene module's art in whole-px
   steps (see the move section below); text plates fold and unroll, never scale. */

const DECK_RANK = { "crows-nest": 0, bridge: 1, logbook: 2, "gun-deck": 3, "chart-room": 4, "cargo-hold": 5 }; // top of the ship to the keel
const deckWord = d => L("deck_" + d.replace(/-/g, "_"));
const deckWhat = d => L("deck_" + d.replace(/-/g, "_") + "_what");
S.route = { level: "sea" };
S.home = null;      // the route the page was opened at: where an idle TV returns
S.deckData = { log: null, logEtag: null, logBusy: false, hist: {}, histBusy: {} };
S.gone = {};        // the last copy of an item seen on a deck, so a vanished one can say when it was last seen

/* ---------- routes (parseRoute, routePath, parentRoute: frontdoor.js) ---------- */
const routeHref = r => "#" + routePath(r) + (S.hashQuery ? "?" + S.hashQuery : "");
/* The page board (#/board): a view of the sea the viewer opens, never the front door. The television profile never shows it:
   there the sea is the whole display, and #/board draws the sea. */
const BOARD = { level: "sea", board: true };
const boardOpen = () => !tvProfile();
const sameRoute = (a, b) => routePath(a) === routePath(b);
/* The flagship: the host's (src/weatherdeck/fleet.py: the configured one, else the primary source's machine), else the primary
   source's machine, else the first reporting source's, else the first machine. */
function flagshipId() {
  const v = S.view;
  if (!v) return null;
  if (v.fleet && v.fleet.flagship && (v.machines || []).some(m => m.id === v.fleet.flagship)) return v.fleet.flagship;
  const rep = (v.sources || []).filter(s => !s.placeholder && s.machine);
  const prim = rep.find(s => s.kind === "primary") || rep[0];
  return prim ? prim.machine : ((v.machines || [])[0] || {}).id || null;
}
const deckRoute = (deck, key, ship) => Object.assign({ level: key != null ? "item" : "deck", ship: ship || flagshipId() || "ship", deck }, key != null ? { key: String(key) } : {});

/* ---------- what belongs on a ship ---------- */
function shipInfo(r, B) {
  const flag = flagshipId(), id = r.ship;
  const ms = (B.machines || []).find(m => m.id === id) || null;
  return { id, flagship: id === flag, known: id === flag || !!ms, label: ms ? ms.label : id, m: ms };
}
function onShip(ship, machine, source) {
  if (ship.flagship) return true;
  if (machine) return machine === ship.id;
  const s = source && srcById(source);
  return !!(s && s.machine === ship.id);
}

/* ---------- deck models: rows from the board model (B) and the view ---------- */
function bridgeRows(B, ship) {
  const rows = [];
  for (const c of B.critical || []) if (onShip(ship, c.machine, c.source)) rows.push(callRow(c, "alarm"));
  for (const a of B.asks || []) if (onShip(ship, a.machine, a.source)) rows.push(callRow(a.c, a.tier));
  // Where the calls and the lanes that say they wait disagree, one line each (frontdoor.js asksDisagree): never counted.
  if (B.disagree && onShip(ship, null, null)) B.disagree.lines.forEach((x, i) => rows.push({ key: "disagree:" + i, tier: "disagree", glyph: "needs", slot: "ink2",
    title: x, age: "", rec: null, sub: null, how: null, frozen: false, c: { id: "disagree:" + i, title: B.disagree.badge, detail: x } }));
  // A source whose share of the number is unverified says so first (the card it named as saying the same, `waiting.note`, goes).
  const unver = B.unverified || [];
  for (const u of unver) if (onShip(ship, null, u.id)) rows.push({ key: "unverified:" + u.id, tier: "also", glyph: "silent", slot: "ink2",
    title: L("unverified_line", { name: u.name, reason: u.reason }), age: "", rec: null, sub: null, how: null, frozen: false, c: { id: "unverified:" + u.id, source: u.id, title: L("waiting_unverified"), detail: u.reason } });
  for (const c of B.pending || []) if (onShip(ship, c.machine, c.source)) rows.push(Object.assign(callRow(c, "also"), { sub: L("alert_unconfirmed_sub"), age: "" }));
  // An info card is an FYI on its own line: never a call, never counted.
  for (const c of B.also || []) if (onShip(ship, c.machine, c.source) && !explainsUnverified(unver, c)) rows.push(Object.assign(callRow(c, "fyi"), { title: c.fyi || c.title || c.id }));
  // Feed 1.12: the viewer's dated holds and someone else's turn, listed apart and never counted (model.js asideModel).
  for (const r of (B.aside || {}).deferred || []) if (onShip(ship, r.card ? r.card.machine : null, r.source)) rows.push({ key: "deferred:" + r.key, tier: "deferred", glyph: "asleep", slot: "ink2",
    title: r.title, age: "", rec: null, sub: [r.untilWord ? L("aside_until", { d: r.untilWord }) : L("aside_until_unreported"), r.hold.reason || L("aside_reason_unreported")].join(" · "), how: null, frozen: false,
    c: Object.assign({ id: "deferred:" + r.key }, r.card || r.row) });
  for (const r of (B.aside || {}).theirs || []) if (onShip(ship, r.card.machine, r.card.source)) rows.push(Object.assign(callRow(r.card, "theirs"), {
    sub: [r.owner ? L("aside_owner", { name: r.owner }) : L("aside_owner_unreported"), r.ageS != null ? L("aside_since", { t: age(r.ageS) }) : L("aside_since_unreported"),
      r.verdict && r.verdict.name ? L("aside_verdict", { name: r.verdict.name, state: r.verdict.state || L("aside_not_reported") }) : null].filter(Boolean).join(" · ") }));
  return rows;
}
function callRow(c, tier) {
  const aside = tier === "also" || tier === "fyi" || tier === "disagree" || tier === "deferred" || tier === "theirs";
  const glyph = tier === "alarm" ? "failed" : aside ? "silent" : c.frozen ? "silent" : c.glyph;
  const slot = tier === "alarm" ? "trouble" : aside || c.frozen ? "ink2" : "needs";
  return { key: c.id, tier, glyph, slot, title: c.title || c.id, age: aside ? "" : callAge(c), rec: c.recommend || null,
    sub: c.detail || null, how: c.how || null, frozen: !!c.frozen, c };
}
/* The Gun deck groups its lanes by project first, then machine (the host's row.order); inside one, off course first, then an
   instruction its source escalated as unread (model.js steerUp), with Stuck as on the log and the page board. */
function lanesOf(B, ship) {
  const off = new Set(B.off || []), rank = l => (off.has(l) ? 0 : steerUp(l) ? 1 : 2);
  const order = [...(B.off || []), ...(B.waiting || []), ...(B.underway || []), ...(B.scouts || []), ...(B.quietLanes || []), ...(B.oldRecords || [])];
  return order.map((l, i) => [l, i]).filter(([l]) => onShip(ship, l.machine, l.it.source)).sort(([a, i], [b, j]) => byProject(a, b) || rank(a) - rank(b) || i - j).map(([l]) => l);
}
/* A project's head: its lanes (the host's count), and how many are off course or waiting as the board counts them (B.off, B.waiting),
   so an old record (Housekeeping) is never counted in either. */
function projectHead(l, B) {
  const p = ((((S.view || {}).glance || {}).projects) || [])[l.order[0]];
  if (!p) return l.chip || L("no_project");
  const n = p.n === 1 ? L("project_counts_one") : L("project_counts", { n: p.n });
  const mine = ls => (ls || []).filter(x => x.order[0] === l.order[0]).length, off = mine(B.off), waiting = mine(B.waiting);
  return [p.chip || L("no_project"), n, off ? L("off_course", { n: off }) : null, waiting ? L("waiting_n", { n: waiting }) : null].filter(Boolean).join(" · ");
}
/* A lane's row says what the sea and the page board say of it (page.js rowPlain, board.js rowGlyph): one of six words and one sentence. */
function laneRow(l, B) {
  const look = rowGlyph(l);
  return { key: l.id, section: "p" + l.order[0], secLabel: projectHead(l, B), glyph: look.glyph, slot: l.stale ? "fog" : look.slot, title: laneTitle(l, slOf(l.it)).text, age: l.ageText, word: l.rowWord, wordSlot: ROW_INK[l.rowKey] || "ink",
    stale: l.stale, note: l.steer && l.steer.row ? l.steer.row.text : null, sub: [l.machineLabel, l.sentence].filter(Boolean).join(" · ") || null, right: l.range ? l.range.text : l.phase ? L("phase_of", { n: l.phase.n, m: l.phase.m }) : L("no_percent"),
    range: l.range, rangeSlot: RANGE_SLOT[l.kind] || "moving", meta: l.machineLabel, l };
}
const NEXT_LOOK = { queued: ["mate", "ink2"], gate: ["blocked", "needs"], held: ["asleep", "fog"] };
function chartRows(B, ship) {
  const v = S.view, rows = [];
  const title = id => ((v.items || []).find(i => i.id === id) || (v.next || []).find(n => n.id === id) || {}).title || id;
  for (const n of B.next || []) {
    if (!onShip(ship, null, n.source)) continue;
    const look = NEXT_LOOK[n.kind] || NEXT_LOOK.queued;
    const bits = [n.until ? L("deferred_to", { d: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(n.until + "T12:00:00Z")) }) : null,
      n.reason, (n.blocked_by || []).length ? L("waits_on") + " " + n.blocked_by.map(title).join(", ") : null].filter(Boolean);
    rows.push({ key: n.id, section: "next", glyph: look[0], slot: look[1], title: n.title || n.id, word: L("next_" + (n.kind || "queued")), wordSlot: look[1] === "needs" ? "needs" : "ink2",
      sub: bits.join(" · ") || null, right: n.filed ? L("filed_on", { d: dayWord(n.filed) }) : "", n });
  }
  for (const gr of v.groups || []) {
    const cp = gr.checkpoint;
    if (!cp || !onShip(ship, null, cp.source)) continue;
    const gate = (cp.gate || {}).value || "unknown", nx = cp.next || {};
    rows.push({ key: "gate:" + gr.id, section: "next", glyph: gate === "pass" ? "done" : gate === "fail" ? "failed" : "silent", slot: gate === "pass" ? "done" : gate === "fail" ? "trouble" : "fog",
      title: (gr.label || gr.id) + " " + (nx.version || "?"), word: L(gate === "pass" ? "gate_pass" : gate === "fail" ? "gate_fail" : "gate_unknown"), wordSlot: gate === "fail" ? "trouble" : "ink2",
      sub: ((cp.live || {}).version || "?") + " " + L("live_word") + ((nx.waiting_on || []).length ? " · " + L("waits_on") + " " + nx.waiting_on.map(title).join(", ") : ""), right: "", gr });
  }
  // Black holes (feed 1.2): work held outside the fleet, what comes up by date, and merges not yet shipped.
  for (const w of B.outside || []) {
    if (!onShip(ship, null, w.source)) continue;
    rows.push({ key: "outside:" + w.source + ":" + w.id, section: "outside", glyph: "mate", slot: "ink2", title: (w.chip ? w.chip + " · " : "") + w.title,
      word: w.ageS != null ? age(w.ageS) : "", wordSlot: "ink2", sub: w.who, right: "", w });
  }
  for (const c of B.coming || []) {
    if (!onShip(ship, c.kind === "machine" ? c.id : null, c.source)) continue;
    rows.push({ key: "up:" + c.kind + ":" + c.id, section: "coming", glyph: "asleep", slot: "ink2", title: c.title, word: dueWord(c.at, c.date_only, c.date), wordSlot: "ink2",
      sub: L("up_word_" + c.word), right: "", up: c });
  }
  for (const d of B.deploys || []) {
    if (!onShip(ship, null, d.source)) continue;
    rows.push({ key: "deploy:" + d.source + ":" + d.id, section: "shipping", glyph: d.state === "behind" ? "mate" : d.state === "current" ? "done" : "silent", slot: d.state === "unknown" ? "fog" : "ink2",
      title: d.label, word: d.state === "behind" ? L("deploy_behind_n", { n: d.behind }) : d.state === "current" ? L("deploy_current_word") : stateWord("unknown"), wordSlot: "ink2",
      sub: deploySub(d), right: d.group || "", dep: d });
  }
  return rows;
}
function holdRows(B, ship) {
  const today = dayKey(B.now), since = B.landedWindow ? B.landedWindow.since : null;
  return (S.view.done || []).filter(d => onShip(ship, null, d.source)).map(d => {
    const at = epoch(d.at), isToday = since != null ? at >= since : dayKey(at) === today;
    return { key: d.id, glyph: "done", slot: isToday ? "done" : "ink2", title: d.title || d.id, word: isToday ? hm(at) : wkhm(at), wordSlot: "ink2",
      sub: [d.group, d.via, d.owner && d.owner !== d.source ? d.owner : null].filter(Boolean).join(" · ") || null, right: "", today: isToday, d };
  });
}
function nestRows(B, ship) {
  const rows = [];
  for (const m of B.machines || []) {
    if (!ship.flagship && m.id !== ship.id) continue;
    const stations = stationStates(m);
    rows.push({ key: m.id, section: "ships", pip: true, glyph: m.pip, slot: m.slot, title: m.label, word: m.word, wordSlot: m.slot === "ink2" ? "ink2" : m.slot,
      stale: m.key === "silent" || m.key === "lost",
      sub: stations.length ? stations.map(s => s.label + ": " + s.word).join(" · ") : (m.vitals.length ? m.vitals.slice(0, 4).map(v => v.text).join(" · ") : m.role || null),
      right: stations.length ? stations.map(s => s.label).join(" + ") : m.role || "", m, stations });
  }
  for (const s of S.view.sources || []) {
    if (!ship.flagship && s.machine !== ship.id) continue;
    const lv = srcLevel(s), rest = quiet(lv) && (B.machines || []).some(m => m.id === s.machine && m.resting && m.key !== "draining");
    rows.push({ key: "src:" + s.id, section: "reporters", glyph: lv === "live" ? "lamp" : "silent", pip: true, slot: lv === "live" ? "ink" : lv === "late" || rest ? "ink2" : "fog",
      title: srcName(s), word: rest ? L("src_resting") : lv === "absent" ? L("src_absent") : L("src_" + lv), wordSlot: lv === "live" ? "ink" : "ink2", stale: quiet(lv) && !rest,
      sub: s.placeholder ? s.reason : [sourceSay(s).line || L("last_report", { t: age(srcAge(s)) }), s.station, softwareOf(s).adapter, (s.skew || []).length ? L("skew_short") : null, s.rejected ? L("rejected_since", { name: "", t: hm(s.rejected.since), reason: s.rejected.reason }).trim() : null,
        ...(B.slowed || []).filter(f => f.source === s.id).map(() => L("slowed_short")),
        // Feed 1.12: a copy's age since its maker made it, said while it is fine too (an old one is said below as old)
        ...(B.madeAges || []).filter(f => f.source === s.id && f.state === "ok" && f.s != null).map(f => L("collector_made_short", { what: f.label, t: age(f.s) })),
        ...(B.staleCollectors || []).filter(f => f.source === s.id).map(f => f.state === "error" ? L("collector_failed_short", { what: f.label }) : L("collector_old_short", { what: f.label, t: f.s != null ? age(f.s) : "?" }))].filter(Boolean).join(" · "),
      right: machineName(s.machine), s });
  }
  for (const q of B.queues || []) {
    if (!ship.flagship && q.machine !== ship.id) continue;
    rows.push({ key: "queue:" + q.source + ":" + q.id, section: "queues", glyph: q.length ? "mate" : "done", slot: q.stale ? "fog" : q.state === "backed_up" ? "ink" : "ink2", stale: q.stale,
      title: q.label, word: q.length != null ? L("queue_word", { n: q.length }) + (q.state === "backed_up" ? ", " + L("queue_backed_up") : "") : stateWord("unknown"), wordSlot: q.state === "backed_up" ? "ink" : "ink2", sub: queueSub(q), right: machineName(q.machine), q });
  }
  // The library (feed 1.10): each mirrored folder on its source's ship; a folder no source reports only on the flagship.
  for (const lr of B.library || []) {
    if (!ship.flagship && (lr.machine == null || lr.machine !== ship.id)) continue;
    rows.push({ key: "lib:" + (lr.source || "") + ":" + lr.id, section: "library", glyph: lr.glyph, slot: lr.slot, stale: lr.stale, title: lr.label,
      word: lr.word, wordSlot: lr.slot, sub: [...lr.ages, lr.why].filter(Boolean).join(" · ") || null, right: lr.machine ? machineName(lr.machine) : "", lib: lr });
  }
  if (ship.flagship) {
    for (const c of cardStates()) rows.push({ key: "card:" + c.tool, section: "tools", glyph: c.glyph, slot: c.slot, title: c.title, word: c.word, wordSlot: c.slot,
      sub: [c.headline, c.last, c.numbers.join(" · ")].filter(Boolean).join(" · ") || null, right: c.mode || "", card: c });
    for (const ch of allowanceChips()) {
      rows.push({ key: "meter:" + ch.id, section: "allowance", glyph: ch.slot === "fog" ? "silent" : ch.slot === "ink2" ? "moving" : "needs", slot: ch.slot,
        title: ch.provider + (ch.account ? " · " + ch.account : ""), word: ch.bad ? L("chip_unavailable") : ch.left + "%", wordSlot: ch.slot,
        sub: [chipLine(ch), chipNote(ch)].filter(Boolean).join(" · ") || null, right: ch.window ? ch.window.short : "", chip: ch });
    }
  }
  return rows;
}
const machineName = id => (((S.view && S.view.machines) || []).find(m => m.id === id) || {}).label || id || L("unassigned");
/* A machine's stations (docs/feed-spec.md: source.station): each with its own reporters' level, beat age and vitals. */
function stationStates(m) {
  return ((m.m || m).stations || []).map(st => {
    const w = (st.sources || []).map(srcById).filter(Boolean);
    const lv = w.length ? w.map(srcLevel).sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] : "absent";
    const row = Object.assign({}, st, { id: (m.m || m).id, observed_by: st.observed_by });
    const ba = beatAge(row), silent = quiet(lv);
    const word = silent ? pipWord("silent", { t: age(Math.max(...w.map(s => srcAge(s) || 0), 0)) }) : st.status === "down" ? pipWord("down") : st.status === "warn" ? pipWord("warn", { reason: L("reason_pressure") }) : st.status === "ok" ? pipWord("ok") : stateWord("unknown");
    return { id: st.id, label: st.label, lv, word, beat: ba, vitals: machineVitals(row, lv), sources: w };
  });
}
function logRowsFor(ship) {
  const lines = ((S.deckData.log || {}).lines || []).filter(d => ship.flagship || (srcById(d.source) || {}).machine === ship.id);
  const prevBy = {}, out = [];
  for (const d of lines) {
    const prev = prevBy[d.source] || null;
    if (d.result === "ok") prevBy[d.source] = d;
    out.push(pushRow(d, prev));
  }
  return out.reverse();
}
const pushKey = d => "push-" + d.source + "-" + (d.seq != null ? d.seq : Math.round(epoch(d.at) || 0));
const COUNT_WORDS = [["wait_on_you", "log_wait"], ["running", "log_running"], ["failed", "log_failed"], ["next", "log_next"], ["done", "log_done"], ["critical", "log_critical"]];
function pushRow(d, prev) {
  const ok = d.result === "ok", c = d.counts || {}, pc = (prev && prev.counts) || null;
  const counts = COUNT_WORDS.filter(([k]) => c[k] != null && (k !== "critical" || c[k])).map(([k, w]) => L(w, { n: c[k] })).join(" · ");
  const delta = pc ? COUNT_WORDS.filter(([k]) => (c[k] || 0) !== (pc[k] || 0)).map(([k, w]) => ((c[k] || 0) > (pc[k] || 0) ? "+" : "−") + Math.abs((c[k] || 0) - (pc[k] || 0)) + " " + L(w, { n: "" }).trim()) : [];
  return { key: pushKey(d), glyph: ok ? (d.shown ? "moving" : "done") : "failed", slot: ok ? "ink2" : "trouble", title: srcName(srcById(d.source) || { id: d.source }) + " #" + (d.seq ?? "?"),
    word: d.at ? hm(epoch(d.at)) : "?", wordSlot: "ink2", sub: ok ? counts : L("log_rejected", { reason: d.reason || "?" }),
    right: ok ? (delta.length ? delta.join(", ") : prev ? L("log_same") : "") : "", rightSlot: delta.length ? "ink" : "ink2", d, prev };
}
function deckRows(deck, B, ship) {
  switch (deck) {
    case "bridge": return bridgeRows(B, ship);
    case "gun-deck": return lanesOf(B, ship).map(l => laneRow(l, B));
    case "chart-room": return chartRows(B, ship);
    case "cargo-hold": return holdRows(B, ship);
    case "crows-nest": return nestRows(B, ship);
    default: return [...noteRows(ship), ...sightRows(ship), legendRow(), ...logRowsFor(ship).map(r => Object.assign(r, { section: "pushes" }))];
  }
}
/* ---------- the Logbook's world lines (world.js): what this screen's sea showed, and the legend ---------- */
const SIGHT_GLYPH = { landing: "done", dolphins: "done", whale: "done", gulls: "moving", becalmed: "long", lighthouse: "moving", walk: "moving", sound: "needs" };
function sightRows(ship) {
  return WORLD.log.filter(e => ship.flagship || !e.ship || e.ship === ship.id).slice(0, 12).map(e => ({
    key: "sight:" + e.id, section: "sightings", glyph: e.kind === "lighthouse" && /dark/.test(e.text) ? "silent" : SIGHT_GLYPH[e.kind] || "moving",
    slot: e.status === "shown" ? "ink" : "ink2", title: e.text, word: hm(e.at), wordSlot: "ink2",
    sub: [L("status_" + e.status) + (e.why ? ": " + e.why : ""), e.sound].filter(Boolean).join(" · "), right: "", e }));
}
/* Notes a source left once for the Logbook (events[].kind "note": a missing optional feature, a setup hint). */
function noteRows(ship) {
  return (((S.view || {}).history || {}).notes || []).filter(n => ship.flagship || (srcById(n.source) || {}).machine === ship.id).slice(0, 8).map((n, i) => ({
    key: "note:" + n.source + ":" + Math.round(n.at) + ":" + i, section: "notes", glyph: "scout", slot: "ink2", title: n.text, word: wkhm(n.at), wordSlot: "ink2",
    sub: L("note_from", { source: n.source }), right: "", note: n }));
}
const legendRow = () => ({ key: "legend", section: "legend", glyph: "scout", slot: "ink2", title: L("legend_title"), word: "", sub: LEGEND.map(([k]) => L("lg_" + k)).join(" · "), right: "", legend: true });
/* One line per place for its door: the count and what it counts. */
function deckCount(deck, B, ship) {
  const rows = deckRows(deck, B, ship);
  switch (deck) {
    // The asks only, calls and lanes (waitingOnYou, frontdoor.js): a Problem, a difference or an FYI on the Bridge is never part of the number.
    case "bridge": { const n = waitingOnYou(rows), unver = (B.unverified || []).length;
      return { n, text: L(n === 1 && !unver ? "door_bridge_one" : "door_bridge", { n: n + (unver ? "+?" : "") }), loud: n > 0 }; }
    // The amber outline is for what needs action only: running long is said in words, waiting is calm.
    case "gun-deck": { const off = rows.filter(r => offCourse(r.l)).length, act = rows.filter(r => r.l.cls === "needs_action" && !r.l.rowOld).length;
      return { n: rows.length, text: L("door_gun_deck", { n: rows.length }) + (off ? ", " + L("off_course", { n: off }) : ""), loud: act > 0 }; }
    case "chart-room": { const n = rows.filter(r => r.section === "next").length; return { n, text: L("door_chart_room", { n }) }; }
    case "cargo-hold": { const n = rows.filter(r => r.today).length; return { n, text: landedRolling(B) ? L("door_cargo_hold_hours", { n, h: B.landedWindow.hours }) : L("door_cargo_hold", { n }) }; }
    case "crows-nest": { const rep = rows.filter(r => r.section === "reporters" && !(r.s && r.s.placeholder)), live = rep.filter(r => !r.stale).length, tot = rep.length; return { n: tot, text: L("trust_live", { live, total: tot }) }; }
    default: { const nw = newestAt(); return { n: 0, text: nw ? L("door_logbook", { t: age(nowS() - nw) }) : L("nothing_yet") }; }
  }
}

/* ---------- read-only fetches a deck needs beyond the view: the received log, one item's history ---------- */
async function getDeckJSON(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { cache: "no-store", signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(timer); }
}
/* Fetched when a place that shows it is open, and again only after the view changed (a new push). */
function wantLog() {
  const D = S.deckData;
  if (D.logBusy || (D.log && D.logEtag === S.etag)) return;
  D.logBusy = true;
  getDeckJSON("api/log?n=60").then(j => { D.log = j; D.logEtag = S.etag; }).catch(() => { D.logEtag = S.etag; D.logErr = true; })
    .finally(() => { D.logBusy = false; if (!MV.on) render(); });
}
function wantHistory(item, owner) {
  const D = S.deckData, k = (owner || "") + "|" + item, cur = D.hist[k];
  if (!item || D.histBusy[k] || (cur && cur.etag === S.etag)) return cur || null;
  D.histBusy[k] = true;
  getDeckJSON("api/history?item=" + encodeURIComponent(item) + (owner ? "&owner=" + encodeURIComponent(owner) : ""))
    .then(j => { D.hist[k] = { events: j.events || [], etag: S.etag }; })
    .catch(() => { D.hist[k] = { events: null, etag: S.etag }; })
    .finally(() => { delete D.histBusy[k]; if (!MV.on) render(); });
  return cur || null;
}

/* ---------- items: what one row says in full ---------- */
function evidenceOf(sourceId, collector) {
  const s = sourceId && srcById(sourceId);
  if (!s) return [];
  const lv = srcLevel(s), say = sourceSay(s).line;
  const out = [say ? L("ev_source_say", { name: srcName(s), say }) : L("ev_source", { name: srcName(s), t: age(srcAge(s)), level: L("src_" + lv).toLowerCase() })];
  const cs = collector && collectorState(sourceId, collector);
  if (cs) out.push(L("ev_collector", { id: collector, t: age(cs.age) }) + (cs.error ? " · " + L("unavailable") : ""));
  if (s.machine) out.push(L("ev_machine", { name: machineName(s.machine) + (s.station ? " (" + s.station + ")" : "") }));
  if (s.skew_s != null && Math.abs(s.skew_s) > 120) out.push(L("ev_skew", { t: dur(Math.abs(s.skew_s)) }));
  return out;
}
const EVENT_SLOT = { failed: "trouble", finished: "done", approval: "done", alert: "needs", waiting: "needs" };
function eventLines(h) {
  if (!h) return { loading: true, rows: [] };
  if (h.events == null) return { rows: [], failed: true };
  return { rows: h.events.map(e => ({ at: e.at, word: (cfg().labels.event_kinds || {})[e.kind] || words(e.kind), slot: EVENT_SLOT[e.kind] || "ink2", text: e.text || "" })) };
}
function itemModel(r, B, ship) {
  const rows = deckRows(r.deck, B, ship), row = rows.find(x => String(x.key) === r.key);
  const gk = r.deck + "|" + r.key;
  if (!row) return { gone: S.gone[gk] || null };
  S.gone[gk] = { title: row.title, at: B.now };
  const M = { row, head: { glyph: row.glyph, slot: row.slot, pip: row.pip, title: row.title, word: row.word || "", wordSlot: row.wordSlot || "ink2", age: row.age || "" }, look: [], chart: null, open: [], say: null, evidence: [] };
  if (r.deck === "bridge") {
    const c = row.c;
    if (c.detail) M.look.push([L("why_head"), c.detail]);
    if (c.recommend) M.look.push([L("rec_head"), c.recommend]);
    if (c.since) M.look.push([L("waiting_since"), wkhm(c.sinceEpoch) + " · " + age(B.now - c.sinceEpoch)]);
    M.say = c.say ? { text: c.say, how: c.how } : row.tier === "call" ? { text: null, how: c.how } : null;
    if (c.link && c.link.url) M.open.push(c.link);
    const lane = c.item && (B.lanes || []).find(l => l.id === c.item);
    if (lane) M.open.push({ route: deckRoute("gun-deck", lane.id, r.ship), label: L("open_lane", { title: lane.title }) });
    M.chart = lane ? eventLines(wantHistory(lane.id, lane.it.owner)) : null;
    M.evidence = evidenceOf(c.source, "attention");
  } else if (r.deck === "gun-deck") {
    const l = row.l, it = l.it;
    if (l.sentence) M.look.push([L("summary_head"), l.sentence]);
    if (l.chip) M.look.push([L("project_head"), l.chip]);
    // What waits unread in its steering inbox, or "not reported" when its source sends no such field (frontdoor.js steerNote).
    if (l.steer) M.look.push([L("steer_head"), l.steer.detail]);
    if (l.cls === "waiting") M.look.push([L("waiting_on_head"), (l.waitingOn ? L("waits_" + l.waitingOn) : L("waits_none")) + (it.waiting_for ? " · " + it.waiting_for : "")]);
    if (l.inState != null) M.look.push([L("in_state_head"), age(l.inState) + (it.age && it.age.basis ? " · " + L("basis_" + it.age.basis) : "")]);
    if (it.agent && it.agent.state) M.look.push([L("agent_head"), L("agent_state_" + it.agent.state) + (it.agent.since ? " · " + age(B.now - epoch(it.agent.since)) : "") + (it.agent.reason ? " · " + it.agent.reason : "")]);
    // The source's own words in full live here, in the opened row, and nowhere on the board.
    if (it.title && it.title !== row.title) M.look.push([L("title_head"), it.title]);
    if (it.doing && it.doing !== l.sentence) M.look.push([L("doing_head"), it.doing]);
    if (it.state_detail && it.state_detail !== l.sentence && it.state_detail !== it.doing) M.look.push([L("state_head"), it.state_detail]);
    if (it.last_event && it.last_event.text) M.look.push([L("last_event_head"), it.last_event.text + (it.last_event.at ? " · " + age(B.now - epoch(it.last_event.at)) : "")]);
    if (it.started_at) M.look.push([L("started_head"), wkhm(epoch(it.started_at)) + " · " + age(B.now - epoch(it.started_at))]);
    M.look.push([L("machine_head"), l.machineLabel + (l.group ? " · " + l.group : "")]);
    M.look.push([L("station_head"), l.stage ? L("station_line", { station: L("station_" + l.stage), stage: L("stage_" + l.stage) }) : l.kind === "scout" ? L("receipt_nest", { n: 1 }) : L("station_none")]);
    M.steps = ((it.progress || {}).steps || []).map(st => ({ label: st.label || st.id, status: st.status, el: st.elapsed_s, typ: st.typical_s, round: st.round }));
    M.range = l.range; M.rangeSlot = row.rangeSlot; M.rangeText = row.right;
    const call = (B.calls || []).find(c => c.item === l.id);
    M.say = call ? { text: call.say || null, how: call.how, route: deckRoute("bridge", call.id, r.ship) } : l.kind === "agent_gone" ? { act: L("agent_gone_act") } : { none: true };
    if (it.link && it.link.url) M.open.push(it.link);
    M.chart = eventLines(wantHistory(l.id, it.owner));
    M.evidence = evidenceOf(it.source, "items");
  } else if (r.deck === "chart-room") {
    if (row.w) {
      const w = row.w;
      M.look.push([L("waiting_on_head"), w.who]);
      if (w.since) M.look.push([L("waiting_since"), wkhm(epoch(w.since)) + " · " + age(w.ageS || 0)]);
      const lane = (B.lanes || []).find(l => l.id === w.id && l.it.source === w.source);
      if (lane) M.open.push({ route: deckRoute("gun-deck", lane.id, r.ship), label: L("open_lane", { title: lane.title }) });
      if (lane && lane.it.link && lane.it.link.url) M.open.push(lane.it.link);
      M.evidence = evidenceOf(w.source, "items");
    } else if (row.up) {
      const c = row.up;
      M.look.push([L("until_head"), c.date_only ? dueWord(c.at, true, c.date) : wkhm(c.at)], [L("kind_head"), L("up_word_" + c.word)]);
      if (c.kind === "item") { const lane = (B.lanes || []).find(l => l.id === c.id); if (lane) M.open.push({ route: deckRoute("gun-deck", lane.id, r.ship), label: L("open_lane", { title: lane.title }) }); }
      M.evidence = evidenceOf(c.source, null);
    } else if (row.dep) {
      const d = row.dep;
      M.look.push([L("word_head"), row.word], [L("deploy_deployed_head"), d.deployed || "?"], [L("deploy_head_head"), d.head || "?"]);
      if (d.oldS != null) M.look.push([L("deploy_oldest_head"), age(d.oldS)]);
      if (d.error) M.look.push([L("note_head"), d.error]);
      M.evidence = evidenceOf(d.source, "deploys");
    } else if (row.n) {
      const n = row.n;
      M.look.push([L("kind_head"), L("next_" + (n.kind || "queued"))]);
      if (n.reason) M.look.push([L("why_head_next"), n.reason]);
      if ((n.blocked_by || []).length) M.look.push([L("waits_on_head"), row.sub]);
      if (n.until) M.look.push([L("until_head"), dayWord(n.until)]);
      if (n.filed) M.look.push([L("filed_head"), dayWord(n.filed)]);
      M.evidence = evidenceOf(n.source, "queue");
    } else {
      const cp = row.gr.checkpoint, g = cp.gate || {};
      M.look.push([L("gate"), row.word], [L("live_word"), (cp.live || {}).version || "?"]);
      if (g.note) M.look.push([L("note_head"), g.note]);
      if ((g.tiers || []).length) M.look.push([L("tiers_head"), g.tiers.map(x => L("tier_word", { tier: x.id, verdict: x.verdict || "?" })).join(" · ")]);
      if ((g.failing || []).length) M.look.push([L("failing_head"), g.failing.join(", ")]);
      if (g.sha) M.look.push([L("sha_head"), String(g.sha).slice(0, 12)]);
      if (g.ship) M.look.push([L("ship_line", { text: "" }).trim(), g.ship]);
      M.evidence = evidenceOf(cp.source, null);
    }
    M.say = { none: true };
  } else if (r.deck === "cargo-hold") {
    const d = row.d;
    M.look.push([L("landed_at"), wkhm(epoch(d.at)) + " · " + age(B.now - epoch(d.at))]);
    if (d.group) M.look.push([L("group_head"), d.group]);
    if (d.via) M.look.push([L("via_head"), d.via]);
    if (d.owner) M.look.push([L("owner_head"), srcName(srcById(d.owner) || { id: d.owner })]);
    if (d.link && d.link.url) M.open.push(d.link);
    M.chart = eventLines(wantHistory(d.id, d.owner));
    M.say = { none: true };
    M.evidence = evidenceOf(d.source, null);
  } else if (r.deck === "crows-nest") {
    if (row.m) {
      const m = row.m;
      M.look.push([L("word_head"), m.word]);
      M.stations = row.stations.length ? row.stations : null;
      if (m.role && !M.stations) M.look.push([L("role_head"), m.role]);
      if (!M.stations && m.vitals.length) M.look.push([L("vitals_head"), m.vitals.map(v => v.text).join(" · ")]);
      M.look.push([L("reporters_head"), m.watchers.map(s => srcName(s) + " " + age(srcAge(s))).join(" · ") || L("none")]);
      for (const s of m.watchers) { const sw = softwareOf(s); M.look.push([L("software_head"), srcName(s) + ": " + [sw.adapter, sw.pusher, sw.host].filter(Boolean).join(" · ")]); }
      for (const s of m.watchers) for (const note of softwareOf(s).skew) M.look.push([L("skew_head"), note]);
      if (!ship.flagship || m.id !== ship.id) M.open.push({ route: { level: "ship", ship: m.id }, label: L("board_ship", { name: m.label }) });
      M.evidence = m.watchers.flatMap(s => evidenceOf(s.id, null)).slice(0, 4);
    } else if (row.lib) {
      const lr = row.lib;
      M.look.push([L("word_head"), lr.word + (lr.why ? " · " + lr.why : "")]);
      if (lr.checked_at) M.look.push([L("lib_checked_head"), wkhm(epoch(lr.checked_at)) + (lr.checkedS != null ? " · " + agoWord(lr.checkedS) : "")]);
      if (lr.outcome) M.look.push([L("lib_run_head"), words(lr.outcome)]);
      if (lr.changed_at) M.look.push([L("lib_changed_head"), wkhm(epoch(lr.changed_at)) + (lr.changedS != null ? " · " + agoWord(lr.changedS) : "") + (lr.changed_sha ? " · " + lr.changed_sha : "")]);
      // Unknown is not zero: a receipt that gave no count says "?".
      if (lr.source) M.look.push([L("lib_pending_head"), lr.pending != null ? String(lr.pending) + (lr.pendingS != null ? " · " + L("oldest_t", { t: age(lr.pendingS) }) : "") : "?"]);
      if (lr.repo) M.look.push([L("lib_repo_head"), lr.repo]);
      if (lr.state === "retired" && (lr.since || lr.note)) M.look.push([L("lib_retired_head"), [lr.since, lr.note].filter(Boolean).join(" · ")]);
      if (lr.source) M.evidence = evidenceOf(lr.source, "mirrors");
    } else if (row.q) {
      const q = row.q;
      M.look.push([L("word_head"), row.word], [L("queue_head"), queueSub(q)]);
      for (const x of (q.holders || []).slice(0, 8)) M.look.push([L("holder_head"), (x.label || "?") + (x.s != null ? " · " + age(x.s) : "")]);
      M.evidence = evidenceOf(q.source, "queues");
    } else if (row.s) {
      const s = row.s;
      M.look.push([L("word_head"), row.word], [L("last_report_head"), s.received_at ? wkhm(s.received_at) + " · " + age(srcAge(s)) : "?"],
        [L("every_head"), s.interval_s ? dur(s.interval_s) : "?"], [L("pushes_head"), L("pushes_line", { n: s.pushes_24h || 0, gaps: s.gaps_24h || 0 })]);
      if (s.station) M.look.push([L("station_head"), s.station]);
      const sw = softwareOf(s);
      M.look.push([L("adapter_head"), sw.adapter + ((s.producer || {}).name ? " · " + s.producer.name : "")], [L("pusher_head"), sw.pusher]);
      if (sw.host) M.look.push([L("host_head"), sw.host]);
      for (const note of sw.skew) M.look.push([L("skew_head"), note]);
      if (s.pace && s.pace.slowed) M.look.push([L("pace_head"), L("pace_line", { t: s.interval_s ? dur(s.interval_s) : "?", n: s.pace.normal_keepalive_s != null ? dur(s.pace.normal_keepalive_s) : "?", why: paceWhy(s.pace) }) +
        (s.pace.since_s != null ? " · " + L("pace_since", { t: dur(s.pace.since_s) }) : "")]);
      if (s.pace && Object.values(s.pace.cost || {}).some(v => v != null)) {
        const c = s.pace.cost, n = (v, unit) => (v != null ? (Math.round(v * 10) / 10) + unit : L("cost_unmeasured"));
        M.look.push([L("cost_head"), L("cost_line", { cpu: n(c.cpu_s_per_h, " s"), cpuB: n(c.budget_cpu_s_per_h, " s"), run: n(c.run_s, " s"), runB: n(c.budget_run_s, " s") }) +
          (c.over_budget ? " · " + L("cost_over") : "")]);
      }
      if (s.rejected) M.look.push([L("rejected_head"), s.rejected.reason + " · " + hm(s.rejected.since)]);
      if ((s.freshness || []).length) M.look.push([L("collectors_head"), s.freshness.map(c => c.label + " " + (c.state === "ok" ? (c.age_s != null ? age(c.age_s) : c.state) : c.state === "error" ? L("collector_error_word") : L("old", { t: c.age_s != null ? age(c.age_s) : "?" }))).join(" · ")]);
      else if ((s.collectors || []).length) M.look.push([L("collectors_head"), s.collectors.map(c => c.id + " " + (c.status || "?")).join(" · ")]);
      M.open.push({ route: deckRoute("logbook", null, r.ship), label: L("open_logbook") });
      M.evidence = evidenceOf(s.id, null);
    } else {
      M.look.push([L("word_head"), row.word]);
      if (row.sub) M.look.push([L("note_head"), row.sub]);
      if (row.card && row.card.link) M.open.push({ url: row.card.link, label: row.card.link });
    }
    M.say = { none: true };
  } else if (row.note) {
    M.look.push([L("seen_head"), wkhm(row.note.at) + " · " + age(B.now - row.note.at)], [L("note_head"), row.note.text]);
    M.say = { none: true };
    M.evidence = evidenceOf(row.note.source, null);
  } else if (row.e) {
    const e = row.e;
    M.look.push([L("seen_head"), wkhm(e.at) + " · " + age(B.now - e.at)], [L("result_head"), L("status_" + e.status) + (e.why ? ": " + e.why : "")]);
    const lg = { landing: "longboat", dolphins: "dolphins", walk: "stations" }[e.kind] || e.kind, field = (LEGEND.find(x => x[0] === lg) || [])[1];
    if (field) M.look.push([L("means_head"), L("legend_" + lg)], [L("signal_head"), L("signal_" + lg)]);
    if (e.sound) M.look.push([L("sound_head"), e.sound]);
    if (e.route) M.open.push({ route: Object.assign({}, e.route, { ship: r.ship }), label: L("open_place", { place: deckWord(e.route.deck) }) });
    M.say = { none: true };
  } else if (row.legend) {
    // What drives each thing, in words (the feed fields themselves are in docs/theme-spec.md section 17).
    for (const [k] of LEGEND) M.look.push([L("lg_" + k), L("legend_" + k) + " · " + L("signal_head").toLowerCase() + " " + L("signal_" + k)]);
    M.say = { none: true };
  } else {
    const d = row.d, c = d.counts || {};
    M.look.push([L("result_head"), d.result === "ok" ? L("log_ok") : L("log_rejected", { reason: d.reason || "?" })]);
    if (d.result === "ok") M.look.push([L("counts_head"), row.sub]);
    M.look.push([L("via_head"), [d.transport, d.bytes != null ? d.bytes + " B" : null, d.gap ? L("log_gap", { n: d.gap }) : null, d.restarted ? L("log_restarted") : null].filter(Boolean).join(" · ")]);
    if (d.generated_at) M.look.push([L("built_head"), wkhm(epoch(d.generated_at))]);
    M.shown = d.titles || null;
    M.diff = row.prev ? titleDiff(row.prev.titles, d.titles) : null;
    M.check = boardCheck(d);
    M.say = { none: true };
    M.evidence = evidenceOf(d.source, null);
  }
  return M;
}
/* What a push changed in the titles its source showed: added, gone, and lanes whose word changed. */
function titleDiff(a, b) {
  if (!a || !b || a === b) return [];
  const out = [];
  for (const sec of ["wait_on_you", "critical", "next", "done"]) {
    const x = a[sec] || [], y = b[sec] || [];
    for (const t of y) if (!x.includes(t)) out.push(["+", L("log_sec_" + sec), t]);
    for (const t of x) if (!y.includes(t)) out.push(["−", L("log_sec_" + sec), t]);
  }
  const ia = Object.fromEntries((a.items || []).map(([t, w]) => [t, w])), ib = Object.fromEntries((b.items || []).map(([t, w]) => [t, w]));
  for (const t of Object.keys(ib)) if (!(t in ia)) out.push(["+", L("log_sec_items"), t + " (" + ib[t] + ")"]);
  for (const t of Object.keys(ia)) if (!(t in ib)) out.push(["−", L("log_sec_items"), t]);
  for (const t of Object.keys(ib)) if (t in ia && ia[t] !== ib[t]) out.push(["~", L("log_sec_items"), t + ": " + ia[t] + " → " + ib[t]]);
  return out;
}
/* The Logbook's check: what this source's newest push counted against what the board shows from it now. */
function boardCheck(d) {
  if (d.result !== "ok") return null;
  const lines = ((S.deckData.log || {}).lines || []).filter(x => x.source === d.source && x.result === "ok");
  if (!lines.length || lines[lines.length - 1] !== d) return null;
  const board = (S.board && S.board.calls || []).filter(c => c.source === d.source).length;
  const pushed = (d.counts || {}).wait_on_you;
  if (pushed == null) return null;
  return { agrees: board === pushed, text: L("log_board_check", { board, push: pushed, source: srcName(srcById(d.source) || { id: d.source }) }) };
}

/* ---------- drawing: the deck plates ---------- */
const DZ = () => (((S.theme.zones || {}).tv || {}).deck) || { list: { x: 20, y: 41, w: 356, h: 311 }, item: { x: 20, y: 41, w: 600, h: 311 }, hint: { x: 384, y: 330, w: 236, h: 22 } };
const doorAttrs = (r, label) => ({ href: routeHref(r), "data-route": routePath(r), "aria-label": label || null });
function tri(dir) { return h("i", { class: "tri " + dir, "aria-hidden": "true" }); }
function deckTitle(r, ship) {
  if (r.level === "ship") return { name: ship.flagship ? L("place_plan") : L("place_ship", { name: ship.label }), what: ship.flagship ? L("plan_what", { name: ship.label }) : L("ship_what") };
  if (r.level === "item") return { name: L("item_" + r.deck.replace(/-/g, "_")), what: deckWord(r.deck) + " · " + deckWhat(r.deck) };
  return { name: deckWord(r.deck), what: deckWhat(r.deck) + (ship.flagship ? "" : " · " + ship.label) };
}
function placeName(r, ship) {
  if (r.level === "sea") return r.board ? L("place_board") : L("place_sea");
  if (r.level === "ship") return deckTitle(r, ship).name;
  return deckWord(r.deck);
}
function renderDeckBar(B, g, r, ship) {
  const bar = h("header", { class: "zone bar plate deckbar", style: zoneStyle(ZT().bar) });
  const up = parentRoute(r);
  const back = h("a", Object.assign({ class: "door back" }, doorAttrs(up, L("back_to", { place: placeName(up, ship) }))), tri("left"), lbl(placeName(up, ship), "ink2", "nowrap"));
  const tt = deckTitle(r, ship);
  const crit = (B.critical || [])[0];
  bar.append(back, h("div", { class: "stack place" }, h("span", { class: "t-label_lg c-ink nowrap ellipsis", id: "place-name", tabindex: "-1" }, tt.name),
    crit && !B.hostdown ? t("body", "trouble", L("problem") + ": " + (crit.title || crit.id), "ellipsis") : t("body", "ink2", tt.what, "ellipsis")));
  bar.append(h("span", { class: "spacer" }));
  if (r.level === "ship" && boardOpen()) bar.append(boardDoor("door listsdoor"));
  if (!g.phone) bar.append(t("numeral", "ink", hm(B.now), "clock"));
  if (B.trust) bar.append(barTrust(B, g.phone));
  return bar;
}
/* One row: glyph, title and a line under it, its word and right-hand note; a door to the item. */
function deckRowEl(r, row, g) {
  const href = deckRoute(r.deck, row.key, r.ship);
  const card = r.deck === "bridge" && (row.tier === "call" || row.tier === "lane" || row.tier === "alarm");
  const el = h("a", Object.assign({ class: "drow" + (card ? " card" : "") + (row.tier ? " " + row.tier : "") + (row.stale ? " stale" : "") }, doorAttrs(href)),
    row.pip ? h("span", { class: "pipbox" }, G(row.glyph, row.slot)) : G(row.glyph, row.slot, card && row.tier !== "alarm" && !row.frozen ? { ink: COL.glyph_ink } : { dither: row.stale }),
    h("span", { class: "main" },
      t(card ? "title" : "title_log", card ? "call-ink" : row.stale ? "fog" : "ink", row.title, g.phone ? "" : "clamp2"),
      row.rec ? t("body", card ? "call-ink" : "ink", L("recommend", { text: row.rec }), g.phone ? "" : "clamp2") : null,
      // An instruction waiting unread (frontdoor.js steerNote) on its own line, in amber as on the sea and the page board.
      row.note ? t("body", "needs", row.note, g.phone ? "" : "clamp2") : null,
      row.sub ? t("body", card ? "call-ink2" : "ink2", row.sub, g.phone ? "" : "clamp2") : null),
    h("span", { class: "dside" },
      row.age ? lbl(row.age, card ? "call-ink" : "ink2", "nowrap") : null,
      row.word ? lbl(row.word, row.wordSlot || "ink2", "nowrap") : null,
      row.right ? lbl(row.right, row.rightSlot || "ink2", "nowrap") : null,
      row.range ? rangeBar(row.range, row.rangeSlot, row.stale) : null));
  return el;
}
const SECTIONS = { bridge: r => r.tier, "crows-nest": r => r.section, logbook: r => r.section, "chart-room": r => r.section, "gun-deck": r => r.section };
function renderDeckList(B, g, r, ship) {
  const el = h("section", { class: "zone deck plate deck-" + r.deck, style: zoneStyle(DZ().list), "aria-label": deckWord(r.deck) });
  if (r.deck === "logbook") wantLog();
  const rows = deckRows(r.deck, B, ship), sec = SECTIONS[r.deck];
  if (r.deck === "logbook" && !S.deckData.log) { el.append(lbl(L(S.deckData.logErr ? "log_unreadable" : "reading"), "ink2"), h("div", { class: "skel" }), h("div", { class: "skel short" })); return el; }
  if (!rows.length) { el.append(t("body", "ink2", L("deck_empty_" + r.deck.replace(/-/g, "_")), "empty")); return el; }
  if (r.deck === "logbook") {
    const newest = rows.find(x => x.d && x.d.result === "ok" && boardCheck(x.d));
    const chk = newest && boardCheck(newest.d);
    if (chk) el.append(h("div", { class: "check" }, G(chk.agrees ? "done" : "needs", chk.agrees ? "done" : "needs"), t("body", chk.agrees ? "ink2" : "needs", chk.text + " " + L(chk.agrees ? "log_agrees" : "log_differs"))));
    if (WORLD.receipt && ship.flagship) el.append(h("div", { class: "check receipt" }, t("body", "ink2", L("receipt_now", { text: WORLD.receipt }))));
  }
  let last = null;
  for (const row of rows) {
    const s = sec ? sec(row) : null;
    if (s && s !== last) { el.append(lbl(row.secLabel || L("sec_" + s), "ink2", "sechead")); last = s; }
    el.append(deckRowEl(r, row, g));
  }
  return el;
}
function verb(name, title, ...kids) {
  return h("section", { class: "verb" }, h("div", { class: "vhead" }, lbl(L("verb_" + name), "ink"), title ? lbl(title, "ink2") : null), ...kids);
}
function pairs(list) {
  return h("dl", { class: "pairs" }, list.flatMap(([k, v]) => [h("dt", null, lbl(k, "ink2")), h("dd", null, t("body", "ink", v))]));
}
function sayBox(M) {
  const s = M.say;
  if (!s) return null;
  if (s.none) return verb("say", null, t("body", "ink2", L("say_none")), s.route ? null : null);
  if (s.act) return verb("say", null, t("body", "ink", s.act));   // something to do, not to say
  const kids = [];
  if (s.text) {
    const line = h("code", { class: "sayline", id: "say-text" }, s.text);
    const btn = h("button", { type: "button", class: "copy", "data-copy": "say-text" }, lbl(L("copy"), "ink"));
    kids.push(h("div", { class: "saybox" }, line, btn), lbl(S.copied === s.text ? L("copied") : S.copied === "select:" + s.text ? L("copy_select") : "", "ink2", "copied"));
  } else kids.push(t("body", "ink", L("say_free")));
  if (s.how) kids.push(t("body", "ink2", L("say_where", { how: s.how })));
  if (s.route) kids.push(h("a", Object.assign({ class: "door link" }, doorAttrs(s.route)), lbl(L("open_call"), "ink"), tri("right")));
  return verb("say", null, ...kids);
}
function chartBox(M) {
  const kids = [];
  if (M.steps && M.steps.length) {
    kids.push(h("ol", { class: "track" }, M.steps.map(st => h("li", { class: "st " + (st.status || "pending") },
      h("i", { class: "mark", "aria-hidden": "true" }), lbl(st.label, st.status === "current" ? "ink" : st.status === "done" ? "ink2" : "fog", "nowrap"),
      lbl(st.el != null ? dur(st.el) + (st.typ ? " / " + dur(st.typ) : "") : st.typ ? "~" + dur(st.typ) : "", "ink2", "nowrap"),
      h("span", { class: "sr" }, L("step_" + (st.status || "pending")))))));
    if (M.rangeText) kids.push(h("div", { class: "rline" }, lbl(M.rangeText, "ink", "nowrap"), M.range ? rangeBar(M.range, M.rangeSlot, false) : null));
  }
  if (M.chart) {
    if (M.chart.loading) kids.push(lbl(L("reading"), "ink2"));
    else if (M.chart.failed) kids.push(t("body", "ink2", L("history_failed")));
    else if (!M.chart.rows.length) kids.push(t("body", "ink2", L("no_history")));
    else kids.push(h("ol", { class: "events" }, M.chart.rows.slice(0, 12).map(e => h("li", null, lbl(wkhm(e.at), "ink2", "nowrap"), lbl(e.word, e.slot, "nowrap"), t("body", "ink", e.text)))));
  }
  if (M.shown) {
    const secs = [["wait_on_you", M.shown.wait_on_you], ["critical", M.shown.critical], ["items", (M.shown.items || []).map(([x, w]) => x + " (" + w + ")")], ["next", M.shown.next], ["done", M.shown.done]];
    for (const [k, list] of secs) if ((list || []).length) kids.push(h("div", { class: "shown" }, lbl(L("log_sec_" + k) + " " + list.length, "ink2"), h("ul", null, list.map(x => h("li", null, t("body", "ink", x))))));
  }
  if (M.diff) kids.push(h("div", { class: "diff" }, lbl(L("diff_head"), "ink2"), M.diff.length ? h("ul", null, M.diff.map(([s, sec, x]) => h("li", null, lbl(s + " " + sec, s === "+" ? "ink" : "ink2", "nowrap"), t("body", "ink", x)))) : t("body", "ink2", L("log_same"))));
  if (M.check) kids.push(h("div", { class: "check" }, G(M.check.agrees ? "done" : "needs", M.check.agrees ? "done" : "needs"), t("body", M.check.agrees ? "ink2" : "needs", M.check.text + " " + L(M.check.agrees ? "log_agrees" : "log_differs"))));
  if (M.stations) kids.push(h("div", { class: "stations" }, M.stations.map(st => h("div", { class: "station" },
    h("div", { class: "line" }, lbl(st.label, "ink"), lbl(st.word, quiet(st.lv) ? "fog" : "ink2")),
    t("body", "ink2", [st.beat != null ? L("beat") + " " + L("old", { t: age(st.beat) }) : null, ...st.vitals.map(v => v.text), st.sources.map(s => srcName(s) + " " + age(srcAge(s))).join(", ")].filter(Boolean).join(" · "))))));
  return kids.length ? verb(M.stations ? "stations" : M.shown ? "shown" : "chart", null, ...kids) : null;
}
function openBox(M) {
  if (!M.open.length) return null;
  return verb("open", null, h("div", { class: "links" }, M.open.map(o => o.route
    ? h("a", Object.assign({ class: "door link" }, doorAttrs(o.route)), lbl(o.label, "ink"), tri("right"))
    : h("a", { class: "door link out", href: o.url, target: "_blank", rel: "noopener noreferrer" }, lbl(o.label || o.url, "ink"), t("body", "ink2", o.url, "ellipsis url")))));
}
function renderItem(B, g, r, ship) {
  const M = itemModel(r, B, ship);
  const el = h("section", { class: "zone item plate item-" + r.deck, style: zoneStyle(DZ().item), "aria-label": M.row ? M.row.title : L("item_missing") });
  const close = h("a", Object.assign({ class: "door back close" }, doorAttrs(parentRoute(r), L("back_to", { place: deckWord(r.deck) }))), tri("left"), lbl(deckWord(r.deck), "ink2", "nowrap"));
  if (!M.row) {
    el.append(h("div", { class: "ihead" }, close), t("notice_title", "ink", M.gone ? L("item_gone_title", { title: M.gone.title }) : L("item_missing")),
      t("body", "ink2", M.gone ? L("item_gone_body", { t: hm(M.gone.at) }) : L("item_missing_body")));
    return el;
  }
  const hd = M.head;
  el.append(h("div", { class: "ihead" }, hd.pip ? h("span", { class: "pipbox" }, G(hd.glyph, hd.slot)) : G(hd.glyph, hd.slot),
    t("title", "ink", hd.title, g.phone ? "" : "clamp2 ititle"),
    h("span", { class: "dside" }, hd.word ? lbl(hd.word, hd.wordSlot, "nowrap") : null, hd.age ? lbl(hd.age, "ink2", "nowrap") : null)));
  const left = h("div", { class: "col" }, M.look.length ? verb("look", null, pairs(M.look)) : null, sayBox(M));
  const right = h("div", { class: "col" }, chartBox(M), openBox(M), M.evidence.length ? verb("evidence", null, h("ul", { class: "ev" }, M.evidence.map(x => h("li", null, t("body", "ink2", x))))) : null);
  el.append(h("div", { class: "cols" }, left, right));
  return el;
}
/* The ship's plan: its six places as doors where the scene draws them (or a grid without a scene). */
function renderPlan(B, g, r, ship) {
  const anchors = (S.anchors || {}).doors || null;
  const el = h("nav", { class: "plan" + (anchors && !g.phone ? " placed" : " grid"), "aria-label": deckTitle(r, ship).name });
  for (const d of DECKS) {
    const c = deckCount(d, B, ship), a = anchors && anchors[d];
    el.append(h("a", Object.assign({ class: "pdoor plate" + (c.loud ? " loud" : ""), style: a && !g.phone ? `--x:${a.px};--y:${a.py};--w:${a.pw}` : null }, doorAttrs(deckRoute(d, null, r.ship), deckWord(d) + ", " + c.text + (c.loud ? ", " + L("door_loud") : ""))),
      h("span", { class: "dname" }, c.loud ? G("needs", "needs") : null, lbl(deckWord(d), "ink", "nowrap")), t("body", c.loud ? "needs" : "ink2", c.text, g.phone ? "" : "ellipsis")));
  }
  return el;
}
/* Phone: the places as a 3 x 2 grid of doors under the call. */
function renderSeaDoors(B, g) {
  const ship = shipInfo({ ship: flagshipId() }, B);
  if (!g.phone || B.loading || B.empty || !ship.id) return null;
  return h("nav", { class: "zone seadoors", "aria-label": L("place_plan") }, DECKS.map(d => {
    const c = deckCount(d, B, ship);
    return h("a", Object.assign({ class: "pdoor plate" + (c.loud ? " loud" : "") }, doorAttrs(deckRoute(d, null, ship.id), deckWord(d) + ", " + c.text + (c.loud ? ", " + L("door_loud") : ""))),
      h("span", { class: "dname" }, c.loud ? G("needs", "needs") : null, lbl(deckWord(d), "ink")), t("body", c.loud ? "needs" : "ink2", c.text));
  }));
}
function renderHint(g, r) {
  if (g.phone) return null;
  return h("div", { class: "zone dhint plate", style: zoneStyle(DZ().hint), "aria-hidden": "true" }, lbl(TOUR.on ? L("tour_on") : L(r.level === "item" ? "keys_item" : "keys_deck"), "ink2", "nowrap ellipsis"));
}
const SEA_ZONES = ["bar", "call", "side", "marks", "log", "hail", "anchor", "more", "since", "firsthint", "keybtn", "boarddoor", "legend", "seahits", "fleetstrip"];
const DECK_ZONES = ["deckbar", "deck", "item", "plan", "dhint"];
/* Called by render() when the route is below the sea. */
function renderDecks(B, g) {
  const r = S.route, ship = shipInfo(r, B);
  for (const id of SEA_ZONES) mount(boardEl, id, null);
  mount(boardEl, "seadoors", null);
  mount(boardEl, "shipdoor", null);
  mount(boardEl, "deckbar", safe("deckbar", () => renderDeckBar(B, g, r, ship)));
  if (B.loading) { for (const id of ["deck", "item", "plan", "dhint"]) mount(boardEl, id, null); return; }
  if (!ship.known) {
    mount(boardEl, "deck", h("section", { class: "zone deck plate", style: zoneStyle(DZ().list) }, t("notice_title", "ink", L("ship_unknown", { id: r.ship })), t("body", "ink2", L("ship_unknown_body"))));
    for (const id of ["item", "plan"]) mount(boardEl, id, null);
    mount(boardEl, "dhint", renderHint(g, r));
    return;
  }
  mount(boardEl, "plan", r.level === "ship" ? safe("plan", () => renderPlan(B, g, r, ship)) : null);
  // On the TV the item plate unrolls over its deck; the phone shows the item alone.
  mount(boardEl, "deck", r.level === "deck" || (r.level === "item" && !g.phone) ? safe("deck", () => renderDeckList(B, g, r, ship)) : null);
  mount(boardEl, "item", r.level === "item" ? safe("item", () => renderItem(B, g, r, ship)) : null);
  mount(boardEl, "dhint", renderHint(g, r));
}
/* Phone: the convoy strip (theme-spec section 21), under the call: every ship in the fleet's fixed order as a mini ship
   with its pip, name and word, scrolling sideways in a strip of its own; tapping one opens that ship's places. Past the
   ships drawn, one convoy tile carries the count and what is not OK, and opens the Crow's nest. A theme without a scene
   module (or without its `mini`) shows the same doors without art. Only with more than one machine. */
const MINI = new Map();
function miniCanvas(id, key, sc) {
  const mod = S.theme.scene;
  if (!mod || !mod.mini || !sc) return null;
  const k = id + "|" + key;
  if (!MINI.has(k)) {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 52; cv.className = "mini"; cv.dataset.key = k; cv.setAttribute("aria-hidden", "true");
    try { if (!mod.mini(cv.getContext("2d"), sc, id)) return null; } catch (e) { return null; }
    if (MINI.size > 40) MINI.clear();
    MINI.set(k, cv);
  }
  const src = MINI.get(k), cv = document.createElement("canvas");   // a fresh node; patch() keeps the old one while the key holds
  cv.width = src.width; cv.height = src.height; cv.className = "mini"; cv.dataset.key = k; cv.setAttribute("aria-hidden", "true");
  cv.getContext("2d").drawImage(src, 0, 0);
  return cv;
}
function renderFleetStrip(B, g) {
  const fl = B.fleet;
  if (!g.phone || B.loading || B.empty || !fl || fl.ships.length + (fl.convoy ? 1 : 0) < 2) return null;
  const sc = S.sceneNow || null, look = sc ? [sc.tod, sc.mode, sc.screen === "anchor", sc.lost, ((sc.world || {}).gulls)] : [];
  const tiles = fl.ships.map(sh => {
    const m = sh.m, crew = (B.lanes || []).filter(l => l.machine === m.id).map(l => [l.kind, l.stage, l.stale]);
    const key = JSON.stringify([m.pip, m.key, !!m.becalmed, !!m.asleep, sh.berth, crew, (sc && sc.weather || {})[m.id], look]);
    const label = L("open_place", { place: m.label }) + ", " + m.word + (sh.role === "flagship" ? "" : "");
    return h("a", Object.assign({ class: "mship" + (m.key === "silent" || m.key === "lost" ? " stale" : "") + (sh.role === "flagship" ? " flag" : ""), "data-machine": m.id }, doorAttrs({ level: "ship", ship: m.id }, label)),
      miniCanvas(m.id, key, sc), h("span", { class: "mline" }, G(m.pip, m.slot), lbl(m.label, m.key === "silent" ? "fog" : "ink", "nowrap name")),
      lbl(m.short || m.word, m.slot === "ink2" || m.key === "ok" ? "ink2" : m.slot, "nowrap word"));
  });
  const cv = fl.convoy;
  if (cv) tiles.push(h("a", Object.assign({ class: "mship convoy" + (cv.stale ? " stale" : ""), "data-machine": "@convoy" }, doorAttrs(deckRoute("crows-nest"), cv.text)),
    miniCanvas("@convoy", JSON.stringify([cv.n, cv.stale, look]), sc), h("span", { class: "mline" }, lbl(L(cv.n === 1 ? "fleet_convoy_one" : "fleet_convoy", { n: cv.n }), "ink", "nowrap name")),
    lbl(cv.words.length ? cv.words.map(([w, k]) => k + " " + L("hull_" + w)).join(" · ") : L("machine_ok"), "ink2", "word")));
  return h("nav", { class: "zone fleetstrip plate", "aria-label": L("fleet_strip") }, h("div", { class: "strip" }, tiles));
}
/* The door to the page board: on the sea's stage beside the key's button, and in a ship's plan bar. */
function boardDoor(cls, style) {
  return h("a", Object.assign({ class: cls, style: style || null }, doorAttrs(BOARD, L("open_board"))), lbl(L("place_board"), "ink", "nowrap"), tri("right"));
}
function renderBoardDoor(B, g) {
  const z = ZO(B, "lists");   // the theme's zone (zones.tv.lists); a longer word grows the plate leftwards from its right edge
  if (g.phone || !z || !boardOpen() || B.loading || B.screen !== "board") return null;
  const w = Math.max(z.w, textW("label", L("place_board")) + 14);
  return boardDoor("zone boarddoor plate", zoneStyle({ x: z.x + z.w - w, y: z.y, w, h: z.h }));
}
/* Called by render() on the sea: the ship itself is a door to its plan, and the phone gets its door grid. */
function renderSeaDecks(B, g) {
  for (const id of DECK_ZONES) mount(boardEl, id, null);
  mount(boardEl, "fleetstrip", safe("fleet", () => renderFleetStrip(B, g)));
  mount(boardEl, "seadoors", safe("doors", () => renderSeaDoors(B, g)));
  const box = (S.anchors || {}).ship, id = flagshipId();
  mount(boardEl, "shipdoor", !g.phone && box && id && S.theme.scene && B.screen === "board"
    ? h("a", Object.assign({ class: "shipdoor", style: `--x:${box.x};--y:${box.y};--w:${box.w};--h:${box.h}` }, doorAttrs({ level: "ship", ship: id }, L("cap_ship") + belowWords(id))), caption(L("cap_ship") + belowWords(id), box)) : null);
  mount(boardEl, "seahits", !g.phone && id && S.theme.scene && B.screen === "board" ? seaHits(B) : null);
}
/* A ship's door says how many of its sailors are below decks (the scene draws only those that fit, theme-spec section 21). */
const belowWords = id => { const n = ((S.anchors || {}).below || {})[id] || 0; return n ? " · " + L("below_decks_long", { n }) : ""; };
/* A door's caption: shown while it is pointed at or focused, so every clickable thing on the stage says what it opens. */
function caption(text, box) {
  const right = box.x + (box.w || 0) / 2 > 420;
  return h("span", { class: "cap plate" + (right ? " right" : ""), "aria-hidden": "true" }, t("body", "ink", text));
}
/* The stage's other doors (the scene module's layout hits): each escort opens its own ship's places, the convoy the Crow's
   nest, the lighthouse the Logbook, a ship's gulls its Crow's nest row, a longboat the Cargo hold, a whale the Chart
   room. A creature is a door only while it is on the sea. */
function seaHits(B) {
  const hits = (S.anchors || {}).hits || [], play = (WORLD && worldScene(B).events) || [], out = [];
  for (const x of hits) {
    let r = null, text = null;
    if (x.kind === "lighthouse") { r = deckRoute("logbook"); text = L(x.on ? "cap_lighthouse" : "cap_lighthouse_dark"); }
    else if (x.kind === "escort") { r = { level: "ship", ship: x.machine }; text = L("cap_escort", { name: shipName(x.machine) }) + belowWords(x.machine); }
    else if (x.kind === "convoy") { r = deckRoute("crows-nest"); text = L("cap_convoy", { text: ((B.fleet || {}).convoy || {}).text || "" }); }
    else if (x.kind === "gulls") { r = deckRoute("crows-nest", x.machine); text = L("cap_gulls", { ship: shipName(x.machine) }); }
    else if (x.kind === "landing" || x.kind === "whale") { const ev = play[x.i]; r = ev && ev.route ? ev.route : deckRoute(x.kind === "whale" ? "chart-room" : "cargo-hold"); text = L(x.kind === "whale" ? "cap_whale" : "cap_landing"); }
    if (!r) continue;
    out.push(h("a", Object.assign({ class: "hitdoor " + x.kind, style: `--x:${x.x};--y:${x.y};--w:${x.w};--h:${x.h}`, "data-hit": x.kind + (x.machine ? ":" + x.machine : "") }, doorAttrs(r, text)), caption(text, x)));
  }
  return out.length ? h("div", { class: "seahits" }, out) : null;
}
/* The sea's plates are doors (board.js asks here which place each opens). */
function seaDoor(deck, key) {
  const id = flagshipId();
  if (!id) return {};
  const r = deck ? deckRoute(deck, key, id) : { level: "ship", ship: id };
  return { "data-route": routePath(r), tabindex: "0", role: "link", "aria-label": L("open_place", { place: deck ? deckWord(deck) : L("place_plan") }) };
}

/* ---------- navigation: the URL is the state ---------- */
const NAV = { trail: [], at: 0, lastInput: performance.now(), touched: performance.now() };
function initRoute(path, query) {
  S.hashQuery = query;
  S.route = parseRoute(path);
  S.home = S.route;
  const st = history.state;
  NAV.at = st && typeof st.lk === "number" ? st.lk : 0;
  NAV.trail[NAV.at] = routePath(S.route);
  try { history.replaceState({ lk: NAV.at }, "", location.hash || routeHref(S.route)); } catch (e) { /* sandboxed */ }
}
const curRoute = () => (MV.on ? MV.on.to : S.route); // where the page is, or is going
function navigate(to, opts) {
  opts = opts || {};
  if (sameRoute(to, curRoute())) return;
  if (to.level !== "sea" && !opts.tour) hintDone();
  if (opts.replace) { try { history.replaceState({ lk: NAV.at }, "", routeHref(to)); } catch (e) { /* sandboxed */ } }
  else { NAV.at++; NAV.trail.length = NAV.at; history.pushState({ lk: NAV.at }, "", routeHref(to)); }
  NAV.trail[NAV.at] = routePath(to);
  startMove(curRoute(), to, opts);
}
/* Up one level: Back when the page came from there (so Back and Esc agree), else a new entry. */
function goUp() {
  if (curRoute().level === "sea" && !curRoute().board) return;
  const up = parentRoute(curRoute());
  if (NAV.at > 0 && NAV.trail[NAV.at - 1] === routePath(up)) history.back();
  else navigate(up);
}
/* An idle TV sails back to where it was opened (the open sea unless the page was opened at a deck: a pinned TV). */
function idleReturn(g) {
  const s = (cfg().display || {}).idle_return_s ?? 60;
  if (TOUR.on) return;   // the tour brings the screen home itself
  if (!s || g.phone || MV.on || sameRoute(S.route, S.home)) { if (MV.on || sameRoute(S.route, S.home)) NAV.lastInput = performance.now(); return; }
  if ((performance.now() - NAV.lastInput) / 1000 < s) return;
  NAV.lastInput = performance.now();
  const home = routePath(S.home), i = NAV.trail.lastIndexOf(home, NAV.at - 1);
  if (i >= 0) history.go(i - NAV.at);
  else navigate(S.home);
}
/* ---------- the auto-tour (display.tour, off by default): a TV with no pointer shows each place in turn ----------
   After pause_s with no input, and sea_s on the open sea, the screen visits each of display.tour.places for dwell_s, then
   sails home. Any key, tap or click stops it where it is (the idle return brings it home later). It never starts while a
   critical is open, the host does not answer or a call has just arrived; it replaces history entries, so a TV that tours
   all day keeps a short history. #tour=1 (or #tour=fast) forces it on to check it. Never on the television profile (the `tv`
   view, any household-level or privacy profile): the option is refused there, whatever the config or the hash says, and one
   console line says so. */
const TOUR = { on: false, at: 0, i: 0, seaSince: performance.now() };
/* The television profile: the tv view, or any profile at household level or in privacy mode. A TV is never auto-paged. */
function tvProfile() {
  const p = (S.view && S.view.profile) || {};
  return p.name === "tv" || p.redaction === "household" || !!p.privacy;
}
let tourRefused = false;
function tourCfg() {
  const c = Object.assign({ enabled: false, dwell_s: 20, sea_s: 240, pause_s: 120, places: ["bridge", "gun-deck", "chart-room", "crows-nest"] }, cfg().display.tour || {});
  if (S.dev.tour) c.enabled = true;
  if (S.dev.tour === "fast") Object.assign(c, { dwell_s: 6, sea_s: 6, pause_s: 6 });
  if (c.enabled && tvProfile()) {
    c.enabled = false;
    if (!tourRefused) { tourRefused = true; console.info("Weatherdeck: the auto-tour is not available on the television profile, so it stays off."); }
  }
  return c;
}
function tourStep(B, g) {
  const c = tourCfg(), now = performance.now(), places = (c.places || []).filter(d => DECKS.includes(d));
  const stop = () => { if (TOUR.on) { TOUR.on = false; TOUR.seaSince = now; } };
  if (!c.enabled || !places.length || !B || g.phone || !S.view || !flagshipId() || B.loading || B.empty) { stop(); return; }
  if (MV.on) return;
  if (TOUR.on) {
    if (NAV.touched > TOUR.at) { TOUR.on = false; render(); return; }   // someone took the helm
    if (now - TOUR.at < c.dwell_s * 1000) return;
    TOUR.i++;
    TOUR.at = now;
    if (TOUR.i < places.length) navigate(deckRoute(places[TOUR.i]), { replace: true, tour: true });
    else { TOUR.on = false; TOUR.seaSince = now; navigate({ level: "sea" }, { replace: true, tour: true }); }
    return;
  }
  if (S.route.level !== "sea") { TOUR.seaSince = now; return; }
  const calm = !B.hostdown && !(B.critical || []).length && !S.anim.call;
  if (!calm || (now - NAV.touched) / 1000 < c.pause_s || (now - TOUR.seaSince) / 1000 < c.sea_s) return;
  TOUR.on = true; TOUR.i = 0; TOUR.at = now;
  navigate(deckRoute(places[0]), { replace: true, tour: true });
}
function onLocation(e) {
  const raw = location.hash.slice(1), path = raw.startsWith("/") ? raw.split("?")[0] : "";
  const to = parseRoute(path);
  if (e && e.state && typeof e.state.lk === "number") NAV.at = e.state.lk;
  NAV.trail[NAV.at] = routePath(to);
  if (sameRoute(to, curRoute())) return;
  startMove(curRoute(), to, { cut: !!(e && e.hasUAVisualTransition) });
}
addEventListener("popstate", onLocation);
for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, () => { NAV.lastInput = NAV.touched = performance.now(); }, { passive: true, capture: true });
document.addEventListener("click", e => {
  const cp = e.target.closest && e.target.closest("[data-copy]");
  if (cp) { copySay(cp); return; }
  const gb = e.target.closest && e.target.closest("[data-glance], [data-hint], [data-key]");
  if (gb) { glanceButton(gb); return; }
  const a = e.target.closest && e.target.closest("[data-route]");
  if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(parseRoute(a.dataset.route));
});
/* Keys: arrows move between doors by where they sit, Enter opens, Esc (or Backspace) goes up. On the sea, OK with nothing in focus opens the Bridge. */
const FOCUSABLE = "[data-route], button.copy, a.out, button[data-glance], button[data-hint], button[data-key], .pg summary";
/* The since strip's Got it, the hint's Got it, the key's button and its Close. */
function glanceButton(b) {
  if (b.dataset.glance) glanceSeen();
  if (b.dataset.hint) hintDone();
  if (b.dataset.key === "replay") { worldReplay(); return; }
  if (b.dataset.key) {
    S.legendOpen = b.dataset.key === "toggle" ? !S.legendOpen : false;
    if (!S.legendOpen) setTimeout(() => { const k = document.querySelector("button[data-key='toggle']"); if (k) k.focus(); }, 0);
    else setTimeout(() => { const c = document.querySelector("button[data-key='close']"); if (c) c.focus(); }, 0);
  }
  render();
}
function spatial(dir) {
  const els = [...document.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el.getClientRects().length);
  if (!els.length) return;
  const cur = document.activeElement && els.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) { els[0].focus(); return; }
  const rc = cur.getBoundingClientRect(), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
  let best = null, bestD = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
    const along = dir === "ArrowRight" ? dx : dir === "ArrowLeft" ? -dx : dir === "ArrowDown" ? dy : -dy;
    const across = dir === "ArrowRight" || dir === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const d = along + across * 2;
    if (d < bestD) { bestD = d; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k.startsWith("Arrow")) { e.preventDefault(); spatial(k); return; }
  if (k === "?" && curRoute().level === "sea" && !(S.geom && S.geom.phone && !S.geom.page)) { e.preventDefault(); S.legendOpen = !S.legendOpen; render(); return; }
  if (k === "Escape" && S.legendOpen) { e.preventDefault(); S.legendOpen = false; render(); return; }
  // R: replay the newest real event on the sea (world.js worldReplay); with none it does nothing.
  if ((k === "r" || k === "R") && curRoute().level === "sea" && !/input|textarea/i.test((e.target || {}).nodeName || "")) { e.preventDefault(); worldReplay(); return; }
  if (k === "Escape" || (k === "Backspace" && !/input|textarea/i.test((e.target || {}).nodeName || ""))) { if (curRoute().level !== "sea" || curRoute().board) { e.preventDefault(); goUp(); } return; }
  const el = document.activeElement;
  if ((k === "Enter" || k === " ") && el && el.dataset && el.dataset.route && el.nodeName !== "A") { e.preventDefault(); navigate(parseRoute(el.dataset.route)); return; }
  if (el && el.nodeName === "BUTTON") return;   // a button's own Enter and Space click it
  // "Decks open on any input": with nothing focused, the remote's OK (Enter) or Space on the sea opens the Bridge.
  if (["Enter", " ", "Select", "Accept"].includes(k) && curRoute().level === "sea" && S.view && flagshipId() && !(el && el.closest && el.closest("[data-route], button, a, .devbar"))) { e.preventDefault(); navigate(deckRoute("bridge")); }
});
/* SAY copies the exact line (never sends). Without the clipboard API (a plain-http TV) the line is selected to copy by hand. */
function copySay(btn) {
  const el = document.getElementById(btn.dataset.copy), text = el ? el.textContent : "";
  const select = () => { try { const rg = document.createRange(); rg.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); return document.execCommand && document.execCommand("copy"); } catch (e) { return false; } };
  const done = v => { S.copied = v; render(); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(text), () => done(select() ? text : "select:" + text));
  else done(select() ? text : "select:" + text);
}

/* ---------- moves (docs/theme-spec.md 16.3) ----------
   The camera moves, the words don't: plates fold (2 frames), the scene art zooms in whole device px per art px, the last step
   is the theme's 4 x 4 Bayer dissolve (4 frames), and the new plates unroll (3 frames). Every frame lasts 33 1/3 ms (2 refreshes
   at 60 Hz, 4 at 120 Hz, 1 at Safari's 30 fps cap) and is picked by elapsed time, so a slow frame never stretches a move. A click
   during a move ends it at once and starts the next; moves never queue. Under reduced motion or motion still, a move cuts at
   once and the old picture lies over the new one at half strength for one 67 ms frame. */
const FRAME = 1000 / 30;
const MV = { on: null, cv: null, masks: {} };
const moveCv = () => MV.cv || (MV.cv = document.getElementById("move"));
const lvl = r => ({ sea: 0, ship: 1, deck: 2, item: 3 })[r.level];
const roomOf = r => (r.level === "sea" ? null : r.level === "ship" ? "plan" : r.deck);
function commitRoute(to) {
  S.route = to;
  S.copied = null;
  render();
  const name = document.getElementById(to.level === "item" ? "item" : "place-name");
  const say = document.getElementById("announce");
  if (say) say.textContent = to.level === "sea" ? L("place_sea") : (document.getElementById("place-name") || {}).textContent || "";
  if (name && to.level !== "sea" && name.focus) { if (to.level === "item") name.setAttribute("tabindex", "-1"); name.focus({ preventScroll: true }); }
  if ((S.geom && S.geom.phone) || S.pageOn || S.pageEligible) scrollTo(0, 0);
}
function endMove() {
  const m = MV.on;
  if (!m) return;
  MV.on = null;
  cancelAnimationFrame(m.raf);
  clearTimeout(m.timer);
  if (!m.committed) { m.committed = true; commitRoute(m.to); }
  boardEl.removeAttribute("data-move");
  const cv = moveCv();
  if (cv) cv.hidden = true;
}
/* The art px canvas a route shows, painted off screen by the scene module (null without one). */
function snapshot(r) {
  const c = document.createElement("canvas");
  c.width = sceneCv.width; c.height = sceneCv.height;
  return sceneShot(c, r) ? c : null;
}
function copyOf(cv) { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; c.getContext("2d").drawImage(cv, 0, 0); return c; }
/* The dissolve mask for a step of the 4 x 4 Bayer matrix, in art px (the scene canvas's own grid): opaque where the new
   picture shows. inverse: the complement, for a dissolve laid the other way round. */
function bayerMask(w, h, step, inverse) {
  const k = [w, h, step, inverse ? 1 : 0].join();
  if (MV.masks[k]) return MV.masks[k];
  const tile = document.createElement("canvas");
  tile.width = tile.height = 4;
  const tc = tile.getContext("2d");
  const B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((B4[y][x] < step * 4) !== !!inverse) tc.fillRect(x, y, 1, 1);
  const m = document.createElement("canvas");
  m.width = w; m.height = h;
  const mc = m.getContext("2d");
  mc.fillStyle = mc.createPattern(tile, "repeat");
  mc.fillRect(0, 0, w, h);
  if (Object.keys(MV.masks).length > 12) MV.masks = {};
  return (MV.masks[k] = m);
}
/* Zoom ladders: whole device px per art px, from the base (ap) up. */
const ladder = (ap, n, to) => Array.from({ length: n }, (_, i) => ap + Math.ceil(((i + 1) * (to - ap)) / n));
/* One zoom frame: only the part of the picture that lands on screen is drawn (whole art px, k device px each). */
function zoomDraw(ctx, img, k, F, P) {
  const dx = Math.round(P.x - F.x * k), dy = Math.round(P.y - F.y * k), W = ctx.canvas.width, H = ctx.canvas.height;
  const sx = Math.max(0, Math.floor(-dx / k)), sy = Math.max(0, Math.floor(-dy / k));
  const sw = Math.min(img.width, Math.ceil((W - dx) / k)) - sx, sh = Math.min(img.height, Math.ceil((H - dy) / k)) - sy;
  if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, dx + sx * k, dy + sy * k, sw * k, sh * k);
}
/* Where a move centres: a point in art px of the image it zooms (the scene module names the spots). */
function focusOf(r, img, from) {
  const g = S.geom, ox = g.phone ? 0 : g.ox, oy = g.phone ? 0 : g.oy;
  const sea = from === "sea" ? sceneLayout({ level: "sea" }).spots || {} : null, esc = sea && r.ship !== flagshipId() ? sea["ship:" + r.ship] : null;
  const spot = from === "sea" ? esc || sea[r.level === "ship" ? "ship" : r.deck]
    : (sceneLayout({ level: "ship", ship: r.ship }).doors || {})[r.deck];
  if (!spot) return { x: img.width / 2, y: img.height / 2 };
  return { x: spot.x + (spot.w || 0) / 2 + ox, y: spot.y + (spot.h || 0) / 2 + oy };
}
function startMove(from, to, opts) {
  opts = opts || {};
  if (MV.on) endMove();
  const g = S.geom;
  if (!g || !S.view || !S.theme) { S.route = to; render(); return; }
  const still = motionLevel() === "still" || opts.cut;
  // The page board is a document, not a stage: there is no picture to zoom between it and the sea or a place, so the move is a cut.
  const B0 = S.board || {}, page = r => pageBoardOn(r, { phone: g.phone, tv: !boardOpen(), screen: B0.screen, loading: B0.loading });
  if (page(from) || page(to)) { commitRoute(to); return; }
  const m = { from, to, t0: performance.now(), committed: false, raf: 0, timer: 0 };
  MV.on = m;
  // Within one place: the item plate unrolls (3 frames) or folds (2 frames) over its deck; no camera.
  const same = lvl(from) >= 2 && lvl(to) >= 2 && from.ship === to.ship && from.deck === to.deck;
  const art = !!(S.theme.scene && !sceneCv.hidden && sceneCv.width);
  if (still || same || !art) {
    if (still && art && !same) {
      // The cut happens at once; the old picture lies over the new one at half strength for one 67 ms frame.
      const A = copyOf(sceneCv);
      m.committed = true; commitRoute(to);
      const cv = showMove(), c = cv.getContext("2d");
      c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false; c.globalAlpha = 0.5; c.drawImage(A, 0, 0, cv.width, cv.height); c.globalAlpha = 1;
      m.timer = setTimeout(endMove, 67);
      return;
    }
    if (still) { endMove(); return; }
    if (same && lvl(to) < lvl(from)) { boardEl.dataset.move = "fold-item"; m.timer = setTimeout(() => { m.committed = true; commitRoute(to); boardEl.removeAttribute("data-move"); MV.on = null; }, 67); return; }
    if (same) { m.committed = true; commitRoute(to); boardEl.dataset.move = "unroll-item"; m.timer = setTimeout(endMove, 100); return; }
    boardEl.dataset.move = "fold";
    m.timer = setTimeout(() => { m.committed = true; commitRoute(to); boardEl.dataset.move = "unroll"; m.timer = setTimeout(endMove, 100); }, 67);
    return;
  }
  boardEl.dataset.move = "fold";
  if (g.phone) scrollTo(0, 0);
  // Build both pictures now (the first frame never waits on drawing later), then fold, then the camera.
  const A0 = copyOf(sceneCv), Bi = snapshot(to);
  if (!Bi) { m.timer = setTimeout(() => { m.committed = true; commitRoute(to); boardEl.dataset.move = "unroll"; m.timer = setTimeout(endMove, 100); }, 67); return; }
  m.frames = plotMove(from, to, A0, Bi, g);
  m.timer = setTimeout(() => {
    const cv = showMove();
    boardEl.dataset.move = "hidden";
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const t0 = performance.now();
    let shown = -1;
    const step = () => {
      if (MV.on !== m) return;
      const i = Math.floor((performance.now() - t0) / FRAME);
      if (i >= m.frames.length) {
        if (!m.committed) { m.committed = true; commitRoute(to); }
        cv.hidden = true;
        boardEl.dataset.move = "unroll";
        m.timer = setTimeout(endMove, 100);
        return;
      }
      if (i !== shown) { shown = i; ctx.imageSmoothingEnabled = false; m.frames[i](ctx, cv); }
      m.raf = requestAnimationFrame(step);
    };
    step();
  }, 67);
}
function showMove() {
  const cv = moveCv(), g = S.geom, r = sceneCv.getBoundingClientRect();
  const w = Math.round(sceneCv.width * g.apDev), hh = Math.round(sceneCv.height * g.apDev);
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  cv.style.setProperty("--mx", r.left + "px"); cv.style.setProperty("--my", r.top + "px");
  cv.style.setProperty("--mw", r.width + "px"); cv.style.setProperty("--mh", r.height + "px");
  cv.hidden = false;
  return cv;
}
/* The frames of one move, each a function that draws it (art px images, k device px per art px). */
function plotMove(from, to, A, Bi, g) {
  const ap = g.apDev, W = Math.round(A.width * ap), H = Math.round(A.height * ap), frames = [];
  const base = (ctx, img) => { ctx.clearRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H); };
  // The dissolve masks the art px picture at art px (2 full-screen draws a frame): the new picture over the old (in), or the
  // old picture thinning over the new zoomed one (out). Step 4 is the new picture alone.
  const dissolve = (under, art, inverse, last) => [1, 2, 3, 4].map(st => (ctx) => {
    if (st === 4) { last(ctx); return; }
    under(ctx);
    const tmp = MV.tmp || (MV.tmp = document.createElement("canvas"));
    if (tmp.width !== art.width || tmp.height !== art.height) { tmp.width = art.width; tmp.height = art.height; }
    const tc = tmp.getContext("2d");
    tc.globalCompositeOperation = "source-over"; tc.clearRect(0, 0, tmp.width, tmp.height);
    tc.drawImage(art, 0, 0);
    tc.globalCompositeOperation = "destination-in";
    tc.drawImage(bayerMask(art.width, art.height, st, inverse), 0, 0);
    tc.globalCompositeOperation = "source-over";
    ctx.drawImage(tmp, 0, 0, W, H);
  });
  const C = { x: Math.round(W / 2), y: Math.round(H / 2) };
  const zoomIn = (img, F, ks) => {
    const P0 = { x: F.x * ap, y: F.y * ap };
    const at = i => ({ x: Math.round(P0.x + (C.x - P0.x) * (i + 1) / ks.length), y: Math.round(P0.y + (C.y - P0.y) * (i + 1) / ks.length) });
    return ks.map((k, i) => ctx => { ctx.clearRect(0, 0, W, H); zoomDraw(ctx, img, k, F, at(i)); });
  };
  const zoomEnd = (img, F, k) => ctx => { ctx.clearRect(0, 0, W, H); zoomDraw(ctx, img, k, F, C); };
  const lf = lvl(from), lt = lvl(to), rf = roomOf(from), rt = roomOf(to);
  if (lf === 0 || lt === 0) {
    // the open sea and the ship: the camera closes on the ship (or the place's spot on it), or pulls back out
    const sea = lf === 0 ? A : Bi, other = lf === 0 ? Bi : A, F = focusOf(lf === 0 ? to : from, sea, "sea"), ks = ladder(ap, 6, ap * 2);
    const far = zoomEnd(sea, F, ks[ks.length - 1]);
    if (lf === 0) frames.push(...zoomIn(sea, F, ks), ...dissolve(far, other, false, ctx => base(ctx, other)));
    else frames.push(...dissolve(far, other, true, far), ...zoomIn(sea, F, ks).reverse().slice(1), ctx => base(ctx, sea));
  } else if (rf === "plan" || rt === "plan") {
    // the plan and a place on it: in through the place's door, or back out to the plan
    const plan = rf === "plan" ? A : Bi, room = rf === "plan" ? Bi : A, F = focusOf(rf === "plan" ? to : from, plan, "plan"), ks = ladder(ap, 5, ap * 3);
    const near = zoomEnd(plan, F, ks[ks.length - 1]);
    if (rf === "plan") frames.push(...zoomIn(plan, F, ks), ...dissolve(near, room, false, ctx => base(ctx, room)));
    else frames.push(...dissolve(near, room, true, near), ...zoomIn(plan, F, ks).reverse().slice(1), ctx => base(ctx, plan));
  } else if (rf !== rt && from.ship === to.ship) {
    // place to place: through the deck planking, up or down, with a beam between the rooms
    const down = (DECK_RANK[rt] ?? 0) > (DECK_RANK[rf] ?? 0), beam = 6 * ap, n = 7;
    for (let i = 1; i <= n; i++) frames.push(ctx => {
      const s = Math.round((i / n) * (H + beam) / ap) * ap;
      ctx.clearRect(0, 0, W, H);
      const ya = down ? -s : s, yb = down ? H + beam - s : -(H + beam) + s;
      ctx.drawImage(A, 0, ya, W, H);
      ctx.drawImage(Bi, 0, yb, W, H);
      ctx.fillStyle = (S.theme.color.scene || {}).beam || "#2A1A12";
      ctx.fillRect(0, down ? H - s : s - beam, W, beam);
    });
  } else frames.push(...dissolve(ctx => base(ctx, A), Bi, false, ctx => base(ctx, Bi)));
  return frames;
}
/* Idle time paints the pictures a move would need (the sea, the plan, the places) so the first frame never waits on them:
   one picture per idle slot, the whole round at most once a minute (their art changes with the light and the data, not faster). */
let warmQ = [], warmAt = 0;
function warmIdle() {
  if (!S.theme || !S.theme.scene || sceneCv.hidden || MV.on || document.hidden || motionLevel() === "still") return;
  if (!warmQ.length && (!warmAt || performance.now() - warmAt > 60000)) {
    warmAt = performance.now();
    const ship = flagshipId();
    if (!ship) return;
    warmQ = [{ level: "sea" }, { level: "ship", ship }, ...DECKS.map(d => deckRoute(d, null, ship))].filter(r => roomOf(r) !== roomOf(S.route));
  }
  if (!warmQ.length) return;
  const idle = window.requestIdleCallback || (f => setTimeout(f, 200));
  idle(() => {
    const r = warmQ.shift();
    if (!r || MV.on) return;
    snapshot(r);
    if (!warmQ.length) { // last: the dissolve masks and the move canvas at this size, so the first move builds nothing
      for (const inv of [false, true]) for (const st of [1, 2, 3]) bayerMask(sceneCv.width, sceneCv.height, st, inv);
      const cv = moveCv(), w = Math.round(sceneCv.width * S.geom.apDev), hh = Math.round(sceneCv.height * S.geom.apDev);
      if (cv && (cv.width !== w || cv.height !== hh)) { cv.width = w; cv.height = hh; }
    }
  });
}
/* Doors warm their place's picture while pointed at or focused, so the first frame is ready when it is opened. */
let warmTimer = null;
function warm(e) {
  const a = e.target.closest && e.target.closest("[data-route]");
  if (!a || MV.on || !S.theme || !S.theme.scene) return;
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => { const r = parseRoute(a.dataset.route); if (roomOf(r) && roomOf(r) !== roomOf(S.route)) snapshot(r); }, 30);
}
document.addEventListener("pointerover", warm, { passive: true });
document.addEventListener("focusin", warm);
