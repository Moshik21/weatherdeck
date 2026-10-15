"use strict";
/* The front door (docs/theme-spec.md sections 16 and 24): which screen a route shows, and what a ship's plate says is waiting
   on it. Pure: plain data in, plain data out, no page, no clock. tests/test_frontdoor.py runs this file in Node.

   Routes (hash paths; the page board is a view of the sea the viewer opens, not a place below it):
     #/sea (or no route)                      the open sea: the fleet on the water, the front door
     #/board                                  the page board (page.js)
     #/ship/<ship>                            one ship's plan: its six places as doors
     #/ship/<ship>/deck/<deck>                one place
     #/ship/<ship>/deck/<deck>/item/<key>     one row in full */

const DECKS = ["bridge", "gun-deck", "chart-room", "cargo-hold", "crows-nest", "logbook"];

function parseRoute(path) {
  const p = String(path || "").split("/").filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  if (p[0] === "board") return { level: "sea", board: true };
  if (p[0] !== "ship" || !p[1]) return { level: "sea" };
  const r = { level: "ship", ship: p[1] };
  if (p[2] === "deck" && DECKS.includes(p[3])) {
    r.level = "deck"; r.deck = p[3];
    if (p[4] === "item" && p[5]) { r.level = "item"; r.key = p.slice(5).join("/"); }
  }
  return r;
}
function routePath(r) {
  if (!r || r.level === "sea") return r && r.board ? "/board" : "/sea";
  let s = "/ship/" + encodeURIComponent(r.ship);
  if (r.level === "deck" || r.level === "item") s += "/deck/" + r.deck;
  if (r.level === "item") s += "/item/" + encodeURIComponent(r.key);
  return s;
}
/* Up one level; the board's parent is the open sea, and the sea has none (it is its own parent). */
function parentRoute(r) {
  if (r.level === "item") return { level: "deck", ship: r.ship, deck: r.deck };
  if (r.level === "deck") return { level: "ship", ship: r.ship };
  return { level: "sea" };
}

/* Whether the page board is drawn instead of the stage. On a TV-sized screen only #/board shows it; a phone's #/sea is the
   page board too (its approved one-page layout). The television profile never shows it: there the sea is the whole display
   and #/board draws the sea. A take-over screen (loading, empty, lost contact, hailing, at anchor: any screen but "board")
   keeps the stage everywhere. */
function pageBoardOn(r, o) {
  return !!r && r.level === "sea" && (!!r.board || !!o.phone) && !o.tv && o.screen === "board" && !o.loading;
}

/* One rule for what waits on the viewer, so the call band, the Lists header, the Bridge door and the ship plates show one
   number (the host's `counts.waiting_on_you` is the same rule). An attention card's tier comes from its severity: a critical card
   is a Problem and an info card an FYI, each shown on its own line and never counted; any other card is a call. A lane that says
   it waits for the viewer's OK with its PR open, and that no call names (the host's `lane.asks_you`), is an ask of its own: tier
   "lane", one line with its own reason (laneAskCard). ASK_TIERS lists the tiers that count, one row per ask. askRows is the one
   list of those rows (the board model's B.asks), the calls first, that every place counts and the Bridge lists. */
const ASK_TIERS = ["call", "lane"];
function cardTier(a) {
  const s = a && a.severity;
  return s === "critical" ? "alarm" : s === "info" ? "fyi" : "call";
}
function askRows(d) {
  const row = tier => c => ({ tier, key: c.id, machine: c.machine || null, source: c.source || null, c });
  return [...(d.calls || []).map(row("call")), ...(d.lanes || []).map(row("lane"))];
}
function waitingOnYou(rows) {
  return (rows || []).filter(r => r && ASK_TIERS.includes(r.tier)).length;
}
const ASK_LABELS = ["lane_ask_title", "lane_ask_reason", "lane_ask_reason_none", "disagree_badge", "disagree_lane", "disagree_call"];
const fillWords = (words, k, v) => Object.entries(v || {}).reduce((s, [a, b]) => s.split("{" + a + "}").join(b), words && words[k] != null ? words[k] : k);
const askLaneTitle = it => (it.row && it.row.title) || it.title || String(it.id);
/* A lane that is an ask of its own (a view item whose host `lane.asks_you` is true) as a card the call band, the Lists page and
   the Bridge draw like a call: its title, and its reason, which names the source that raised the calls when exactly one did
   (`callers`, their names). Its wait counts from `handoff.since`; without it, the age is not reported. */
function laneAskCard(it, words, callers) {
  const who = (callers || []).length === 1 ? callers[0] : null;
  return { id: "lane:" + (it.owner || it.source || "") + "/" + it.id, item: it.id, kind: "approval", severity: "action", lane: true,
    source: it.source || null, machine: it.machine || null, link: it.link || null, since: (it.handoff || {}).since || null,
    title: fillWords(words, "lane_ask_title", { title: askLaneTitle(it) }),
    detail: who ? fillWords(words, "lane_ask_reason", { who }) : fillWords(words, "lane_ask_reason_none") };
}
/* How old the waiting-on-you number is: the oldest report behind its asks, in seconds before `now`. A call's report is when its
   calls were snapshotted (the view's `counts.calls_snapshot_at` when it carries one), else when the host received the feed of the
   source that sent it; a lane's is when the host received its source's feed. Null when no ask has a known time. */
function asksAge(rows, sources, counts, now) {
  const snap = counts && counts.calls_snapshot_at;
  const at = typeof snap === "number" ? snap : snap ? Date.parse(snap) / 1000 : null;
  const recv = {};
  for (const s of sources || []) if (s && s.id != null) recv[s.id] = s.received_at;
  const times = (rows || []).filter(r => r && ASK_TIERS.includes(r.tier))
    .map(r => (r.tier === "call" && at != null && isFinite(at) ? at : recv[r.source])).filter(t => typeof t === "number" && isFinite(t));
  return times.length ? Math.max(0, now - Math.min(...times)) : null;
}
/* "Sources disagree": the host's `waiting_disagree` (src/weatherdeck/view.py lane_asks) in words, or null when the calls and the
   lanes that say they wait for the viewer's OK agree. A lane no call names, and a call whose lane does not say it waits, each give
   one line of the badge's detail. `names` maps a source id to its name; titles come from the view's items and attention. */
function asksDisagree(list, items, attention, words, names) {
  const name = id => (names && names[id]) || id || "?";
  const lines = (list || []).map(d => {
    const it = (items || []).find(i => i && i.id === d.item && i.source === d.item_source);
    if (d.kind === "call") {
      const c = (attention || []).find(a => a && a.id === d.call);
      return fillWords(words, "disagree_call", { source: name(d.call_source), call: c ? c.title || c.id : d.call, lane_source: name(d.item_source) });
    }
    return fillWords(words, "disagree_lane", { source: name(d.item_source), title: it ? askLaneTitle(it) : d.item });
  });
  return lines.length ? { badge: fillWords(words, "disagree_badge"), lines } : null;
}

/* A ship plate's badge: the asks waiting on the viewer from that machine (d.asks, else askRows of d.calls), and how many of its lanes are off course plus its
   critical alerts. A card counts on the machine it names, else on its source's machine; one that names neither is on no
   plate (the call card still counts it). Only what the view lists is counted, so the plates never add up to more than the
   card and the log say. */
function badgeCounts(id, d) {
  const srcMachine = {};
  for (const s of d.sources || []) if (s && s.id != null) srcMachine[s.id] = s.machine || null;
  const on = a => (a.machine || srcMachine[a.source] || null) === id;
  return {
    calls: waitingOnYou((d.asks || askRows(d)).filter(on)),
    trouble: (d.critical || []).filter(on).length + (d.off || []).filter(l => l.machine === id).length,
  };
}

/* The trust line's counts of sources (docs/feed-spec.md, "Source levels"). One row per source: {placeholder, level, restingQuiet}.
   A placeholder (named by another source, never seen by this host) is no feed that failed: it is left out of the total and the
   live count, and the Crow's nest still lists it as not reporting. A source that reports is counted like any other. A quiet source on a machine that declared rest is counted apart ("resting"), not as live and not as silent. */
function trustCounts(rows) {
  const rep = (rows || []).filter(r => r && !r.placeholder);
  const awake = rep.filter(r => !r.restingQuiet);
  return {
    live: awake.filter(r => r.level === "live").length,
    total: awake.length,
    resting: rep.length - awake.length,
  };
}

/* What a quiet source says about itself and its machine, in the order of evidence (docs/feed-spec.md, "Source levels").
   `f`: {level (the page's own: live, late, stale, lost, absent), ageS (since its last push, on the host's clock), intervalS,
   declared (true: the feed declares `interval_s`; false: it does not, the host's default stood in; null: the host did not say),
   lateN (the multiple of the interval after which a source is missing), hasMachine, beat: null (no beat for the machine was ever
   seen) or {ageS, intervalS (null when the beat declares none)}, beatIntervalS (the host's default, standing in for a beat that
   declares none, as the machine row's own `beatSaying` does)}. Words are the labels in `words`.
   - late: "Late 1 min (missing after 4 x 20 s)". A source that declares no interval is never called late or missing: "Last push 1 min
     ago (interval not declared)".
   - silent: "Silent for 6 min (missing after 4 x 20 s)", then the machine: seen through a beat fresh or recent (within `lateN` of the
     beat's own interval) "machine last seen 40 s ago via its beat"; a beat that also stopped "machine not seen for 20 min, its
     beat is silent too"; no beat ever seen "machine not seen". A silent source is never said to be down, and the machine is
     said only as far as a beat shows it.
   -> {kind: live|late|silent|absent, source, machine, line, seenS, evidence: beat|old-beat|none|null}. */
const SOURCE_SAYING_LABELS = ["src_say_late", "src_say_last", "src_say_silent", "src_say_missing", "src_say_undeclared", "src_say_with", "src_say_join",
  "machine_seen_beat", "machine_seen_old", "machine_unseen"];
function sourceSaying(f, words) {
  const say = (k, v) => Object.entries(v || {}).reduce((s, [a, b]) => s.split("{" + a + "}").join(b), words[k] != null ? words[k] : k);
  const kind = f.level === "late" ? "late" : f.level === "stale" || f.level === "lost" ? "silent" : f.level === "absent" ? "absent" : "live";
  const none = { kind, source: null, machine: null, line: null, seenS: null, evidence: null };
  if (kind === "live" || kind === "absent") return none;
  const why = f.declared === true ? say("src_say_missing", { n: f.lateN, i: dur(f.intervalS) }) : f.declared === false ? say("src_say_undeclared") : null;
  const t = dur(f.ageS);
  const head = kind === "late" ? (f.declared === false ? say("src_say_last", { t }) : say("src_say_late", { t })) : say("src_say_silent", { t });
  const source = why ? say("src_say_with", { say: head, why }) : head;
  if (kind === "late" || !f.hasMachine) return Object.assign(none, { source, line: source });
  const seen = beatSaying({ beat: f.beat, lateN: f.lateN, intervalS: f.beatIntervalS || f.intervalS }, words);
  return { kind, source, machine: seen.text, line: say("src_say_join", { src: source, machine: seen.text }), seenS: seen.seenS, evidence: seen.evidence };
}
/* A machine's liveness through its beat alone: `f` {beat: null or {ageS, intervalS}, lateN, intervalS (the fallback when the beat
   declares none)}. Fresh or recent is within `lateN` intervals of the beat's own. -> {text, seenS, evidence: beat|old-beat|none}. */
function beatSaying(f, words) {
  const say = (k, v) => Object.entries(v || {}).reduce((s, [a, b]) => s.split("{" + a + "}").join(b), words[k] != null ? words[k] : k);
  const b = f.beat;
  if (!b) return { text: say("machine_unseen"), seenS: null, evidence: "none" };
  const recent = b.ageS <= f.lateN * (b.intervalS || f.intervalS);
  return { text: say(recent ? "machine_seen_beat" : "machine_seen_old", { t: dur(b.ageS) }), seenS: b.ageS, evidence: recent ? "beat" : "old-beat" };
}

/* A span in words: "38 s", "6 min", "2 h 10 min", "3 d 4 h". */
function dur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min";
  const hh = Math.floor(m / 60), mm = m % 60;
  if (hh < 24) return hh + " h" + (mm ? " " + mm + " min" : "");
  const d = Math.floor(hh / 24);
  return d + " d" + (hh % 24 ? " " + (hh % 24) + " h" : "");
}

/* A supervision alarm in words: whose it is and how old (docs/theme-spec.md 9.3, "Supervision"). A `service` card whose id is
   `service:supervision:<source>` says its heartbeat's age only in `detail` ("heartbeat 400s old"). The title names the home
   (`home`, never "this home") and that age. The severity is the page's, never the card's alone: the down marker the card may be
   raised on is written on every ordinary wake, so neither it nor a recent heartbeat's age is evidence of a stop.
   - With a `supervisor` object (`sup`: {oldest_unacked_wake_age_s, watcher: running|down, busy}), critical only when no watcher
     runs and the oldest unacknowledged wake is older than `limitS`; busy is said as FYI ("busy in a long turn"); anything else is FYI.
   - Without one, busy or stopped is "not reported" (`note`, said beside the title), never a guess, and the card is FYI while its
     beat's age is under `staleS` or not reported; a beat at least `staleS` old is critical, "(no busy marker reported)".
   Words are the labels in `words`; any other card gives null. */
const SUPERVISION_LABELS = ["supervision_stale", "supervision_stale_unmarked", "supervision_age_unknown", "supervision_busy_unreported", "supervision_how",
  "supervision_stopped", "supervision_stopped_how", "supervision_busy", "supervision_busy_how"];
function supervisionAlarm(card, home, words, limitS, sup, staleS) {
  if (!card || card.kind !== "service" || !/^service:supervision(:|$)/.test(String(card.id || ""))) return null;
  const say = (k, v) => Object.entries(v || {}).reduce((s, [a, b]) => s.split("{" + a + "}").join(b), words[k] != null ? words[k] : k);
  const m = /^heartbeat (\d+) ?s old$/.exec(String(card.detail || "").trim());
  const beatS = m ? Number(m[1]) : null;
  const quiet = beatS == null ? say("supervision_age_unknown", { home }) : say("supervision_stale", { home, t: dur(beatS) });
  const s = sup && typeof sup === "object" ? sup : null;
  const wakeS = s && typeof s.oldest_unacked_wake_age_s === "number" ? s.oldest_unacked_wake_age_s : null;
  if (s && s.watcher === "down" && wakeS != null && limitS != null && wakeS > limitS)
    return { title: say("supervision_stopped", { home, t: dur(wakeS) }), detail: null, how: say("supervision_stopped_how", { home }), severity: "critical", beatS };
  if (s && s.busy === true)
    return { title: say("supervision_busy", { home }), detail: null, how: say("supervision_busy_how"), severity: "info", beatS };
  if (!s && beatS != null && staleS != null && beatS >= staleS)
    return { title: say("supervision_stale_unmarked", { home, t: dur(beatS) }), detail: null, how: say("supervision_stopped_how", { home }), severity: "critical", beatS };
  const note = !s || typeof s.busy !== "boolean" ? say("supervision_busy_unreported") : null;
  return { title: quiet, detail: note, note, how: say("supervision_how", { home }), severity: "info", beatS };
}

/* ---------- plain rows (docs/theme-spec.md sections 9.5 and 24.2) ----------
   Every lane row on the front door says one state word from a closed set of six and one sentence. The word comes from the
   host's lane.kind and, when the source sends its own lane word (source_lane.state, feed 1.5, as the page's nine-word key), from
   that word; a lane that waits on the viewer (a call, or an approval whose PR is neither merged nor closed) says so whatever else
   it says. A feed with no lane word (an older pusher) is read from its structured fields only: the state, waiting_on, link.state
   and agent, never its prose, with one exception: the words such a pusher passes through when its books cannot say what the lane
   is doing (a run record a newer status replaced, a state that could not be read). With no record field in the feed they are
   the only evidence, so the row says Can't tell, never failed or blocked. -> {key, why}: `why` names the sentence (rs_<why>). */
const ROW_KEYS = ["you", "stuck", "unk", "work", "other", "done"];
/* The nine lane words as keys; any other "Waiting on ..." is the source's name for its supervisor (`sup`), and a word this board
   does not know is `other`. */
const LANE_BY_WORD = { "waiting on you": "you", "needs attention": "att", "can't tell": "unk", "cant tell": "unk", "waiting on another lane": "lane",
  "paused on purpose": "paused", "waiting on a check": "check", "working": "work", "finished": "done" };
const laneKeyOf = state => {
  const k = String(state || "").trim().toLowerCase().replace(/’/g, "'");
  if (LANE_BY_WORD[k]) return LANE_BY_WORD[k];
  return /^waiting on /.test(k) ? "sup" : "other";
};
const ROW_OF_LANE = { you: "you", att: "stuck", unk: "unk", work: "work", check: "work", sup: "other", lane: "other", paused: "other", done: "done" };
const ROW_UNREAD = [/status-log superseded/i, /harness state unavailable/i];
const ROW_UNREAD_KINDS = ["failed", "blocked", "mate"];
const ROW_HELD = ["paused", "waiting"];
const ROW_ENDED = ["ended", "gone"];
const ROW_MATE = { gate: "mate_gate", human: "mate_human", capacity: "mate_capacity", quiet_hours: "mate_quiet" };
const ROW_WORK = { moving: "work", regressed: "regressed", long: "long", scout: "scout" };
/* f: {kind, laneWord (source_lane.state, or null), pr (link.state of the lane's PR: open|merged|closed, or null when there is no PR),
   state (the item's state), lastState (last_event.state), waitingOn (lane.waiting_on, else the item's), agent (agent.state),
   texts (the item's own lines: doing, state_detail, summary)} */
function rowState(f) {
  const kind = f.kind, pr = f.pr || null, said = !!f.laneWord, lane = said ? ROW_OF_LANE[laneKeyOf(f.laneWord)] || null : null;
  if (kind === "call") return { key: "you", why: "call" };
  if (kind === "approval") {
    if (pr === "merged") return { key: "done", why: "approval_merged" };
    if (pr === "closed") return { key: "unk", why: "approval_closed" };
    return { key: "you", why: pr ? "approval_pr" : "approval" };
  }
  // A PR that merged while its worker's session ended, on a lane whose record never said it finished: nothing is live on it. An old
  // record (Housekeeping), whatever the record or the lane word says, never trouble.
  if (pr === "merged" && ROW_ENDED.includes(f.agent) && kind !== "done" && f.state !== "done" && lane !== "done") return { key: "done", why: "gone_merged" };
  if (lane) return { key: lane, why: "key_" + lane };
  // A run that failed, or a worker that went, while the lane's own records say it was waiting (paused or held, as its state, its
  // waits-on word or its last event says) is a wait that went quiet, not a failure: Waiting on someone else.
  const waited = ROW_HELD.includes(f.state) || ROW_HELD.includes(f.lastState) || !!f.waitingOn;
  if (!said && waited && (kind === "failed" || kind === "agent_gone") && pr !== "merged") return { key: "other", why: kind === "failed" ? "died_waiting" : "gone_waiting" };
  const unread = !said && ROW_UNREAD_KINDS.includes(kind) && (f.texts || []).some(t => typeof t === "string" && ROW_UNREAD.some(re => re.test(t)));
  if (unread) return { key: "unk", why: "unread" };
  if (kind === "agent_gone") return { key: "stuck", why: f.agent === "gone" ? "gone_pane" : "gone" };
  if (kind === "failed") return { key: "stuck", why: pr === "closed" ? "failed_closed" : "failed" };
  if (kind === "blocked") return { key: "stuck", why: "blocked" };
  if (kind === "done") return { key: "done", why: pr === "merged" ? "done_merged" : pr === "closed" ? "done_closed" : "done" };
  if (kind === "pr_open" || kind === "pr_unread") return { key: "other", why: kind };
  if (kind === "mate") {
    const wo = f.waitingOn;
    if (wo === "external" || wo === "pr") return { key: "other", why: pr === "open" ? "pr_open" : "mate_external" };
    return { key: "other", why: ROW_MATE[wo] || (f.state === "paused" ? "mate_paused" : "mate") };
  }
  if (ROW_WORK[kind]) return { key: "work", why: ROW_WORK[kind] };
  return { key: "unk", why: "unknown" };
}

/* ---------- one sort for both front doors (docs/theme-spec.md section 24.3) ----------
   The sea's log and the Lists page put a lane's row in the same place: by its row word in the order `display.row_sort` gives
   (Waiting on you, Stuck, Can't tell, Working, Waiting on someone else, Finished; "housekeeping" last), the rows of an old
   record after every live row whatever they say. Inside Waiting on you and Stuck the longest-waiting row comes first (the
   host's age in state); a row with no age follows the aged ones and keeps its place, saying nothing of how long. Everywhere
   else the rows go by project (the host's row.order), then start time. A row that ties on every count keeps the feed's order. */
const ROW_HOUSEKEEPING = "housekeeping";
const ROW_AGED = ["you", "stuck"];
/* An old record, not a live row (Housekeeping, theme-spec 24.3): a row that reads Can't tell only because its books are old (a run
   record a newer status replaced, a state its books cannot give), an approval whose PR merged or was closed (nothing is left to
   approve), and a lane whose PR merged and whose worker's session ended without the lane being closed. Each says why in its sentence
   (`hk_<why>`). Nothing here is counted as waiting on you, off course or trouble, and the page never closes or changes any of it. */
const OLD_RECORDS = ["unread", "approval_merged", "approval_closed", "gone_merged"];
const isOldRecord = why => OLD_RECORDS.includes(why);
/* The order `display.row_sort` gives; the six row words, then housekeeping, when it gives none. */
const rowSortOrder = order => (Array.isArray(order) && order.length ? order : ROW_KEYS.concat(ROW_HOUSEKEEPING));
/* rows: any list; facts(row) -> {key (a row word), old (an old record), waited (seconds in its state, or null), order ([project, machine]), started (epoch)}.
   A key `order` does not list sorts after the listed ones, and housekeeping after all of them. */
function sortRows(rows, order, facts) {
  const list = rowSortOrder(order);
  const rank = f => { const k = f.old ? ROW_HOUSEKEEPING : f.key, i = list.indexOf(k); return i >= 0 ? i : f.old ? list.length + 1 : list.length; };
  const num = v => (typeof v === "number" && isFinite(v) ? v : null);
  return rows.map((r, i) => ({ r, i, f: facts(r) })).sort((a, b) => {
    const d = rank(a.f) - rank(b.f);
    if (d) return d;
    if (!a.f.old && ROW_AGED.includes(a.f.key)) {
      const x = num(a.f.waited), y = num(b.f.waited);
      if (x != null && y != null && x !== y) return y - x;
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    }
    const oa = a.f.order || [], ob = b.f.order || [];
    return ((oa[0] ?? 1e6) - (ob[0] ?? 1e6)) || ((oa[1] ?? 1e6) - (ob[1] ?? 1e6)) || (a.f.started || 0) - (b.f.started || 0) || a.i - b.i;
  }).map(x => x.r);
}

/* ---------- titles that read ----------
   A title is cut only at a whole word, never leaves a bracket open and never falls to one word: when its column leaves less than
   TITLE_MIN_WORDS words beside the project chip, the chip goes first, and only then is the title cut further. A title the source
   already cut ("…" at its end, which may fall inside a word) loses that last, partial word. No title at all is null: the page
   says "title not reported", never the task id. */
const TITLE_MIN_WORDS = 3;
const TITLE_TAIL = /[\s,;:.\-–—·([]+$/;
function titleWords(title) {
  let s = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
  const cut = /(…|\.\.\.)$/.test(s);
  if (cut) s = s.replace(/(…|\.\.\.)$/, "").trim();
  const words = s ? s.split(" ") : [];
  return { words: cut && words.length > 1 ? words.slice(0, -1) : words, cut };
}
/* The text before its first bracket that is never closed. */
function closeBrackets(s) {
  const open = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(" || s[i] === "[") open.push(i);
    else if ((s[i] === ")" || s[i] === "]") && open.length) open.pop();
  }
  return open.length ? s.slice(0, open[0]) : s;
}
/* The title's first n words, with "…" when anything was left out. -> {text, n} */
function titleAt(w, n) {
  const raw = w.words.slice(0, n).join(" "), closed = closeBrackets(raw);
  const cut = n < w.words.length || w.cut || closed !== raw, s = closed.replace(TITLE_TAIL, "");
  return { text: s ? s + (cut ? "…" : "") : "", n: s ? s.split(" ").length : 0 };
}
/* `room` and `chipRoom` in the units of `measure(text)` (room 0: nothing measured yet, the title whole). -> {text, chip}: chip false
   when the chip gives way. */
function fitTitle(title, room, chipRoom, measure) {
  const w = titleWords(title), withChip = !!chipRoom;
  if (!w.words.length) return { text: null, chip: withChip };
  const full = titleAt(w, w.words.length), min = Math.min(TITLE_MIN_WORDS, full.n);
  if (!room) return { text: full.text, chip: withChip };
  const best = r => {
    for (let n = w.words.length; n >= 1; n--) { const c = titleAt(w, n); if (c.n >= min && measure(c.text) <= r) return c; }
    return null;
  };
  const beside = withChip ? best(room - chipRoom) : null;
  if (beside) return { text: beside.text, chip: true };
  const alone = best(room);
  if (alone) return { text: alone.text, chip: false };
  // Too narrow for even the shortest title that reads: that one, alone (its cell clips what does not fit).
  for (let n = 1; n <= w.words.length; n++) { const c = titleAt(w, n); if (c.n >= min) return { text: c.text, chip: false }; }
  return { text: full.text, chip: false };
}

/* ---------- an instruction that waits unread (docs/theme-spec.md 24.2) ----------
   A source may say, on its own lane word (feed `items[].lane`, the view's source_lane), what waits in the lane's steering inbox:
   `unread_steer` {n, oldest_at, rings, escalated} (null: it looked and found none), `undelivered_steer` {n, oldest_at} (an
   instruction whose doorbell never reached the worker) and `idle` (the worker is between turns). These are proposed fields; a
   source that sends none of the two inbox fields has not reported them, and the opened row says so ("not reported"), never 0, while the row says nothing.
   The row says one amber line: an undelivered instruction whatever the worker is doing, else an unread one only while the
   worker is idle (a busy worker reads its inbox when its turn ends). `escalated` (the source's own escalation, sent with
   unread_steer) sorts that line with Stuck. Ages count from `oldest_at` to `ref` (seconds); `who` is the home that sent it.
   -> {row: {text, short, escalated} | null, detail}: `short` leads with the age, for a cell that cuts its end (the sea's log). */
const STEER_LABELS = ["steer_unread_one", "steer_unread_many", "steer_undelivered_one", "steer_undelivered_many", "steer_not_reported",
  "steer_short_unread", "steer_short_undelivered", "steer_none", "steer_detail_unread", "steer_detail_undelivered", "steer_rings", "steer_idle", "steer_busy", "steer_idle_unreported"];
function steerNote(sl, ref, who, words) {
  const say = (k, v) => Object.entries(v || {}).reduce((s, [a, b]) => s.split("{" + a + "}").join(b), words[k] != null ? words[k] : k);
  const o = sl && typeof sl === "object" ? sl : {};
  const has = k => Object.prototype.hasOwnProperty.call(o, k);
  if (!has("unread_steer") && !has("undelivered_steer")) return { row: null, detail: say("steer_not_reported") };
  // A count with a readable oldest time, or nothing: a box with neither is not evidence of an instruction.
  const box = b => {
    const at = b && typeof b === "object" && typeof b.oldest_at === "string" ? Date.parse(b.oldest_at) / 1000 : NaN;
    return b && typeof b.n === "number" && b.n > 0 && isFinite(at) ? { n: b.n, t: dur(Math.max(0, ref - at)), b } : null;
  };
  const un = box(o.unread_steer), ud = box(o.undelivered_steer), idle = o.idle === true;
  const parts = [];
  if (un) {
    const rings = typeof un.b.rings === "number" && un.b.rings > 0 ? say("steer_rings", { n: un.b.rings }) : "";
    const state = o.idle === true ? say("steer_idle") : o.idle === false ? say("steer_busy") : say("steer_idle_unreported");
    parts.push(say("steer_detail_unread", { n: un.n, t: un.t }) + rings + state);
  } else if (o.unread_steer === null) parts.push(say("steer_none"));
  if (ud) parts.push(say("steer_detail_undelivered", { n: ud.n, t: ud.t }));
  if (!parts.length) parts.push(say("steer_not_reported"));
  let row = null;
  if (ud) row = { text: say(ud.n === 1 ? "steer_undelivered_one" : "steer_undelivered_many", { n: ud.n, who, t: ud.t }),
    short: say("steer_short_undelivered", { n: ud.n, who, t: ud.t }), escalated: false };
  else if (un && idle) row = { text: say(un.n === 1 ? "steer_unread_one" : "steer_unread_many", { n: un.n, who, t: un.t }),
    short: say("steer_short_unread", { n: un.n, who, t: un.t }), escalated: un.b.escalated === true };
  return { row, detail: parts.join(" ") };
}

if (typeof module !== "undefined") module.exports = { DECKS, parseRoute, routePath, parentRoute, pageBoardOn, ASK_TIERS, cardTier, askRows, waitingOnYou, laneAskCard, asksAge, asksDisagree, askLabels: () => ASK_LABELS, badgeCounts, trustCounts, sourceSaying, beatSaying, sourceSayingLabels: () => SOURCE_SAYING_LABELS, dur, supervisionLabels: () => SUPERVISION_LABELS, supervisionAlarm, ROW_KEYS, ROW_HOUSEKEEPING, OLD_RECORDS, isOldRecord, rowSortOrder, sortRows, laneKeyOf, rowState, fitTitle, steerLabels: () => STEER_LABELS, steerNote };
