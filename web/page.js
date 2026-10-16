"use strict";
/* The page board (docs/theme-spec.md section 24): what needs to occur and what each lane reports, in plain words, at a
   glance, on a television, a laptop and a phone. One document that scrolls: a header with the key, the three-state top
   strip (needs you, needs attention, all fine), the places below decks with a caption each, the lanes grouped under the goal they
   serve, else by project (a state icon and word, the job, its project and machine, one sentence, the worker's own notes behind a tap), the sea
   with a caption for every picture, and the quiet rows (watch, allowance, tools, library).

   Every word is arithmetic on feed fields: items[].lane and items[].say (feed 1.5) say what a lane is doing, the host's
   attention list says what waits on the viewer, and nothing is read from a worker's sentence. A lane with no lane word
   is worded from its structured fields only; every row says one of six words (frontdoor.js rowState). Nothing here calls the host or any model:
   it renders the view the page already holds, once a second like the rest of the board. */

/* ---------- the nine lane words ---------- */
/* The source's own lane word (feed 1.5) as a key (frontdoor.js laneKeyOf): it orders, counts and folds a group's rows. A row
   itself says one of the six row words (rowPlain, below). `sup` is the word the source gives its supervising agent ("Waiting on
   the supervisor", or its own name for it). */
const KEY_ORDER = ["you", "att", "unk", "sup", "lane", "paused", "check", "work", "done"];
/* The check each `say` template names, in the words a fold gives it. */
const CHECK_PARTS = { "tests-running": ["ls_tests_running", "ls_tests_still", "fold_tests"], "fixing-findings": ["ls_fixing_findings", "ls_fixing_still", "fold_fixing"],
  "ci-running": ["ls_ci_running", "ls_ci_still", "fold_ci"], "run-active": ["ls_run_active", "ls_run_active_still", "fold_other"] };
const FOLD_MIN = 3;       // a group folds its lanes that wait on a check into one line from this many
const CALLS_SHOWN = 3;    // calls shown in full in the top strip; the rest are counted

/* The supervisor as its source names it: "Waiting on <name>". */
const supName = state => String(state || "").replace(/^\s*waiting on\s+/i, "").trim() || L("ls_who_default");

/* ---------- icons: one fixed shape per state, drawn on a 12 x 12 pixel grid ---------- */
const ICONS = {
  work: [["polygon", { points: "3,1 11,6 3,11" }]],
  check: [["rect", { x: 2, y: 0, width: 8, height: 2 }], ["rect", { x: 2, y: 10, width: 8, height: 2 }], ["polygon", { points: "3,2 9,2 6,6" }], ["polygon", { points: "6,6 3,10 9,10", opacity: 0.45 }]],
  sup: [["rect", { x: 0, y: 1, width: 12, height: 8 }], ["polygon", { points: "2,9 2,12 5,9" }],
    ["rect", { x: 2, y: 4, width: 2, height: 2, class: "cut" }], ["rect", { x: 5, y: 4, width: 2, height: 2, class: "cut" }], ["rect", { x: 8, y: 4, width: 2, height: 2, class: "cut" }]],
  you: [["polygon", { points: "6,0 12,6 6,12 0,6" }], ["rect", { x: 5, y: 2.5, width: 2, height: 4.5, class: "cut dark" }], ["rect", { x: 5, y: 8, width: 2, height: 1.6, class: "cut dark" }]],
  lane: [["polygon", { points: "0,5 5,5 5,2 9,6 5,10 5,7 0,7" }], ["rect", { x: 10, y: 1, width: 2, height: 10 }]],
  paused: [["rect", { x: 2, y: 1, width: 3, height: 10 }], ["rect", { x: 7, y: 1, width: 3, height: 10 }]],
  att: [["polygon", { points: "6,0 12,11 0,11" }], ["rect", { x: 5, y: 3.5, width: 2, height: 4, class: "cut" }], ["rect", { x: 5, y: 8.4, width: 2, height: 1.6, class: "cut" }]],
  done: [["polyline", { points: "1.5,6.5 4.5,9.5 10.5,2.5", class: "stroke" }]],
  unk: [["rect", { x: 0.5, y: 0.5, width: 11, height: 11, class: "dash" }], ["rect", { x: 4, y: 2.5, width: 4, height: 1.5 }], ["rect", { x: 7, y: 3.5, width: 1.5, height: 2 }],
    ["rect", { x: 5.3, y: 5.5, width: 1.8, height: 1.6 }], ["rect", { x: 5.3, y: 8.3, width: 1.8, height: 1.6 }]],
  none: [["rect", { x: 1.5, y: 1.5, width: 9, height: 9, class: "ring" }]],
};
const SVGNS = "http://www.w3.org/2000/svg";
function icon(name, slot, extra) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("class", "pg-ic c-" + slot + (extra ? " " + extra : ""));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("shape-rendering", name === "work" || name === "done" || name === "lane" ? "geometricPrecision" : "crispEdges");
  for (const [tag, at] of ICONS[name] || ICONS.unk) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(at)) n.setAttribute(k, String(v));
    svg.append(n);
  }
  return svg;
}

/* ---------- time on the lane's own clock ---------- */
/* A silent source's lane counts no further than its last report (last known); a lane on a live source counts on. */
function laneClock(l) {
  if (hostDown()) return newestAt();
  const s = srcById(l.it.source);
  return quiet(l.lv) && s && s.received_at != null ? s.received_at : nowS();
}
const agoOf = (at, ref) => { const e = epoch(at); return e == null || !isFinite(e) ? null : age(Math.max(0, ref - e)); };
const untilWord = u => {
  const e = epoch(String(u).length === 10 ? u + "T00:00:00Z" : u);
  return e == null || !isFinite(e) ? null : e - nowS() < 86400 ? hm(e) : wkhm(e);
};

/* ---------- one lane: its word, title, sentence and notes ---------- */
const titlesReal = () => { const p = (S.view && S.view.profile) || {}; return !p.redaction || p.redaction === "none" || p.redaction === "household"; };
/* The job in plain words: the whole title the source sent, wrapped where the row is narrow (a place that must fit one line cuts it
   at a whole word, frontdoor.js fitTitle); else the source's own short title; marked "short name only" when the source says the
   title is only the task's name in words, and "title not reported" when there is none (never the task id as a title). */
const rowTitleOf = (it, sl) => {
  const raw = (it.row && it.row.title) || it.title || "";
  if (raw && raw !== it.id) return raw;
  return sl && sl.short_title ? sl.short_title : null;
};
function laneTitle(l, sl) {
  const text = fitTitle(l.rowTitle, 0, 0, null).text;
  return { text: text || L("title_not_reported"), short: !!text && !!sl && !sl.short_title && titlesReal() };
}
/* The sentence, worded from the feed's template parts. A part this page has no words for is left out; nothing is read
   from a worker's sentence. Ages are counted from the part's own time on the lane's clock. */
function laneSentence(l, key, sl) {
  const parts = Array.isArray(l.it.say) ? l.it.say.filter(p => p && typeof p.t === "string") : [], ref = laneClock(l);
  if (!parts.length) return null;
  const P = id => parts.find(p => p.t === id) || null;
  const who = key === "sup" ? supName(sl.state) : L("ls_who_default");
  const stepOf = p => (p && p.step != null && p.of != null ? L("ls_step", { n: p.step, m: p.of }) : "");
  const findings = n => (n === 1 ? L("ls_finding_one") : L("ls_finding_many", { n }));
  const check = parts.find(p => CHECK_PARTS[p.t]) || null, gone = P("worker-gone");
  const out = [];
  if (gone) {
    const t = agoOf(gone.at, ref) || "?", why = L(gone.how === "gone" ? "ls_worker_gone" : "ls_worker_ended", { t });
    if (check) out.push(L("ls_but", { a: L(CHECK_PARTS[check.t][1], { step: stepOf(check) }), b: why }));
    else out.push(L(gone.how === "gone" ? "ls_worker_gone_alone" : "ls_worker_ended_alone", { t }));
  }
  const failed = P("run-failed"), paused = P("paused-by-worker");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    switch (p.t) {
      case "call-open": out.push(L("ls_call_open")); break;
      case "run-failed": if (!paused) { const t = agoOf(p.at, ref); out.push(t ? L("ls_run_failed_ago", { t }) : L("ls_run_failed")); } break;
      case "paused-by-worker": {
        const u = p.until ? untilWord(p.until) : null;
        out.push(L("ls_paused_by") + (failed ? L("ls_paused_failed") : "") + (u ? L("ls_paused_until", { t: u }) : L("ls_paused_open")));
        break;
      }
      case "holds-others": if (p.n > 0) out.push(p.n === 1 ? L("ls_holds_one") : L("ls_holds_many", { n: p.n })); break;
      case "no-news": { const t = agoOf(p.at, ref); if (t) out.push(L("ls_no_news", { t })); break; }
      case "unreadable": {
        // What is recorded leads; "can't be read" is said only when nothing the lane said is recorded.
        const lw = P("last-word"), nlw = P("no-last-word"), t = lw ? agoOf(lw.at, ref) : null, what = lw && lw.verb && LABELS["ls_verb_" + lw.verb] != null ? L("ls_verb_" + lw.verb) : null;
        out.push(what ? (t ? L("ls_recorded", { what, t }) : L("ls_recorded_now", { what })) : L("ls_unreadable") + (nlw || !lw ? L("ls_no_last_word") : "."));
        break;
      }
      case "gate-owner-unknown": out.push(L("ls_gate_owner_unknown")); break;
      case "gate-stop": {
        const n = p.findings != null ? findings(p.findings) : null, worker = p.decides === "worker";
        let s = L(worker ? (n ? "ls_gate_worker_n" : "ls_gate_worker") : n ? "ls_gate_stop_n" : "ls_gate_stop", { gate: p.gate || "?", n, who });
        if (!worker && parts.some(q => q.t === "asked-supervisor")) { s = s.replace(/\.$/, "") + L("ls_asked_after", { who }); i = parts.length; }
        out.push(s);
        break;
      }
      case "asked-help": out.push(L("ls_asked_help", { who })); break;
      case "asked-supervisor": if (!parts.some(q => q.t === "gate-stop" || q.t === "asked-help")) out.push(L("ls_asked", { who })); break;
      case "starts-when-lands": {
        const more = p.more > 0 ? p.more : 0;
        out.push(p.title ? L(more ? "ls_starts_when_more" : "ls_starts_when", { title: p.title, n: more }) : L("ls_starts_when_plain"));
        break;
      }
      case "worker-busy": out.push(L("ls_worker_busy")); break;
      case "working": out.push(L("ls_working")); break;
      case "finished": { const k = "ls_finished_" + (p.how || "other"); out.push(LABELS[k] != null ? L(k) : L("ls_finished_other")); break; }
      case "merges-itself": out.push(L("ls_merges_itself")); break;
      case "your-merge": out.push(L("ls_your_merge")); break;
      default:
        if (CHECK_PARTS[p.t] && !gone) out.push(L(CHECK_PARTS[p.t][0], { step: stepOf(p) }));
    }
  }
  return out.join(" ") || null;
}
/* The right-hand word on a lane's state line: how long it has been so, or what the record gives instead. */
function laneAge(l, key, sl, say) {
  if (!sl) return l.ageText || "";
  const ref = laneClock(l), lw = sl.last_word && sl.last_word.at ? agoOf(sl.last_word.at, ref) : null;
  if (key === "unk") return lw ? L("lane_age_last_word", { t: lw }) : L("lane_age_no_last_word");
  const since = epoch(sl.since);
  if (since != null && isFinite(since)) return age(Math.max(0, ref - since));
  const gate = (Array.isArray(say) ? say : []).find(p => p && p.t === "gate-stop" && p.gate);
  return gate ? L("lane_age_at", { gate: gate.gate }) : L("lane_age_unrecorded");
}
/* ---------- the front door's plain row: one of six words and one sentence (frontdoor.js rowState) ---------- */
const ROW_LOOK = { you: { slot: "needs", icon: "you" }, stuck: { slot: "trouble", icon: "att" }, unk: { slot: "fog", icon: "unk" },
  work: { slot: "moving", icon: "work" }, other: { slot: "ink2", icon: "paused" }, done: { slot: "done", icon: "done" } };
const slOf = it => (it.source_lane && typeof it.source_lane === "object" && it.source_lane.state ? it.source_lane : null);
/* The sentence from the item's structured fields only (state, waiting_on, link, agent, times); nothing from its prose. */
function rowSentence(l, r, pr) {
  const it = l.it, ref = laneClock(l), ag = it.agent || {}, le = it.last_event || {};
  const wo = (it.lane && it.lane.waiting_on) || it.waiting_on || null;
  const who = r.why === "mate_external" ? it.waiting_for || L("waits_who_" + (wo === "pr" ? "pr" : "external")) : L("ls_who_default");
  const news = le.at || it.state_since || null, ago = news ? agoOf(news, ref) : null;
  // An old record says why it is one (frontdoor.js isOldRecord): its Housekeeping reason, not a live row's sentence.
  let k = (isOldRecord(r.why) ? "hk_" : "rs_") + r.why, detail = null;
  if (((r.why === "unread" || r.why === "unknown") && !ago) || (r.why === "gone_merged" && !agoOf(ag.since, ref))) k += "_never";
  if (r.key === "work") { detail = laneDetail(it, l.kind, l.lv, true); if (detail) k += "_d"; }
  const was = L(LABELS["rs_was_" + it.state] != null ? "rs_was_" + it.state : "rs_was_other");
  // The lane's own last word (feed 1.5 last_word) and how long ago, for a row worded from what its record says.
  const lw = (slOf(it) || {}).last_word || {}, lwAgo = lw.at ? agoOf(lw.at, ref) : null;
  const said = lw.verb && LABELS["ls_verb_" + lw.verb] != null ? (lwAgo ? L("rs_said", { what: L("ls_verb_" + lw.verb), t: lwAgo }) : L("rs_said_now", { what: L("ls_verb_" + lw.verb) })) : "";
  if (k === "rs_key_unk" && said) k = "rs_key_unk_said";   // "can't be read" only when nothing it said is recorded
  let s = L(k, { pr: pr ? "#" + pr.name.split("#").pop() : "?", who, gone: agoOf(ag.since, ref) || "?", ago, was, detail, said });
  const until = it.lane && it.lane.until ? epoch(String(it.lane.until).length === 10 ? it.lane.until + "T00:00:00Z" : it.lane.until) : null;
  if (l.cls === "waiting" && until && until > nowS() && !isOldRecord(r.why)) s += L("rs_until", { t: untilWord(it.lane.until) });
  return s;
}
/* What a lane's row says on the front door, the sea's log and the page board alike: {rowKey, rowWord, sentence, rowTitle}. The
   sentence is the source's own say[] parts when its lane word decided the row, else the structured one. */
function rowPlain(l) {
  const it = l.it, sl = slOf(it), key = sl ? laneKeyOf(sl.state) : null, pr = lanePR(it);
  const r = rowState({ kind: l.kind, laneWord: sl ? sl.state : null, pr: pr ? pr.state : null, state: it.state || null, lastState: (it.last_event || {}).state || null,
    waitingOn: (it.lane && it.lane.waiting_on) || it.waiting_on || null, agent: (it.agent || {}).state || null,
    lastWord: sl && sl.last_word ? sl.last_word.verb || null : null, branch: sl && typeof sl.branch === "boolean" ? sl.branch : null,
    texts: [it.doing, it.state_detail, it.summary, (it.row || {}).summary] });
  const said = r.why.startsWith("key_") && sl ? laneSentence(l, key, sl) : null;
  return { rowKey: r.key, rowOld: isOldRecord(r.why), rowWord: L("row_" + r.key), sentence: said || rowSentence(l, r, pr), rowTitle: rowTitleOf(it, sl), steer: steerOf(l) };
}
/* What waits unread in the lane's steering inbox (frontdoor.js steerNote), from the source's own lane object even when it has no
   lane word; the instruction comes from the home that owns the lane, named as the view names that source. */
function steerOf(l) {
  const it = l.it, home = it.owner || it.source, sl = it.source_lane && typeof it.source_lane === "object" ? it.source_lane : null;
  return steerNote(sl, laneClock(l), srcName(srcById(home)) || home || L("ls_who_default"), Object.fromEntries(STEER_LABELS.map(k => [k, L(k)])));
}
const NOTE_LINES = it => [it.doing, it.state_detail !== it.doing ? it.state_detail : null, it.last_event && it.last_event.text, it.agent && it.agent.reason]
  .filter((x, i, a) => x && String(x).trim() && a.indexOf(x) === i).map(String);
/* Everything a lane row says, once. */
/* The row's word is one of the six (rowPlain); `key` keeps the source's own lane word for the group's order, counts and fold. */
function laneView(l) {
  const it = l.it, sl = slOf(it);
  const key = sl ? laneKeyOf(sl.state) : "none", W = ROW_LOOK[l.rowKey] || ROW_LOOK.unk, ttl = laneTitle(l, sl);
  const cause = sl && sl.cause && LABELS["lane_cause_" + String(sl.cause).replace(/-/g, "_")] != null ? L("lane_cause_" + String(sl.cause).replace(/-/g, "_")) : null;
  return { l, id: l.id, key, slot: W.slot, icon: W.icon, word: l.rowWord, cause: key === "att" && l.rowKey === "stuck" ? cause : null, age: laneAge(l, key, sl, it.say),
    sentence: l.sentence, title: ttl.text, short: ttl.short,
    chip: l.chip || "", machine: l.machine ? l.machineLabel : L("lane_machine_unknown"), notes: NOTE_LINES(it), stale: l.stale, sl, order: l.order,
    check: key === "check" ? (Array.isArray(it.say) ? it.say : []) : null };
}

/* ---------- groups: by the goal a lane serves (feed 1.7), the rest by project ---------- */
/* A goal's name as its feed gave it; a row with no goal has none, and sits under its project. */
const goalOf = x => (x && typeof x.goal === "string" && x.goal ? x.goal : null);
/* The goals the view lists (host: src/weatherdeck/goals.py): {name, lanes, next, done, or_more[]}, in the order the sources name them. */
const goalHeads = () => (((S.view || {}).goals) || []).filter(x => x && typeof x.name === "string" && x.name);
/* The Lists page lists the lanes in the sea's order (frontdoor.js sortRows; the order is `display.row_sort`): one section for each
   row word, and for Working the goal and project cards, in the place Working has in that order. A card says the counts of all its
   lanes (`n`), and lists its working ones (`rows`). */
const workRow = v => rowSortKey(v.l) === "work" && !v.l.rowOld;
function pageGroups(B, views) {
  const by = new Map(), byGoal = new Map(), heads = goalHeads(), at = new Map(views.map((v, i) => [v.id, i]));
  heads.forEach((hd, i) => byGoal.set(hd.name, { goal: hd.name, head: hd, rank: i, chip: hd.name, all: [] }));
  for (const v of views) {
    const goal = goalOf(v.l.it);
    if (goal) {
      if (!byGoal.has(goal)) byGoal.set(goal, { goal, head: null, rank: 1e5 + byGoal.size, chip: goal, all: [] });
      byGoal.get(goal).all.push(v);
      continue;
    }
    const k = v.order && v.order[0] != null ? v.order[0] : 1e6;
    if (!by.has(k)) by.set(k, { rank: k, chip: v.chip, all: [] });
    by.get(k).all.push(v);
  }
  const groupLabel = id => ((((S.view || {}).groups) || []).find(g => g.id === id) || {}).label || id || "";
  // A project's queued and landed rows are the ones no goal claimed: a goal's own are counted in its header.
  const queued = new Map(), landed = new Map();
  for (const n of B.next || []) { const k = goalOf(n) ? null : foldName(groupLabel(n.group)); if (k) queued.set(k, (queued.get(k) || 0) + 1); }
  for (const d of B.doneToday || []) { const k = goalOf(d) ? null : foldName(groupLabel(d.group)); if (k) landed.set(k, (landed.get(k) || 0) + 1); }
  const groups = [...byGoal.values(), ...by.values()].map(g => {
    const n = {};
    for (const r of g.all) n[r.key] = (n[r.key] || 0) + 1;
    const k = g.goal ? null : foldName(g.chip);
    g.rows = g.all.filter(workRow);   // already in the shared order
    return Object.assign(g, { n, queued: k ? queued.get(k) || 0 : 0, landed: k ? landed.get(k) || 0 : 0, supWord: (g.all.find(r => r.key === "sup") || {}).word,
      first: g.rows.length ? at.get(g.rows[0].id) : Infinity });
  });
  // Cards with working lanes in the order their first lane has in the shared sort; then a goal's counts line, and a project with queued or landed rows.
  return groups.filter(g => g.rows.length || g.goal || g.queued || g.landed).sort((a, b) => (a.first - b.first) || (!!b.goal - !!a.goal) || a.rank - b.rank);
}
function countLine(g) {
  const out = [], put = (cls, text) => out.push(h("span", { class: cls }, text));
  const word = k => {
    const n = g.n[k];
    if (!n) return;
    if (k === "sup") return put("c-sup", L("cnt_sup", { n, word: String(g.supWord || L("lane_sup")).toLowerCase() }));
    const cls = { you: "c-you", att: "c-att", unk: "c-unk", done: "c-done" }[k] || "";
    put(cls, L("cnt_" + { you: "you", att: "att", unk: "unk", lane: "lane", paused: "paused", check: "check", work: "work", done: "done", none: "none", other: "other" }[k], { n }));
  };
  const hd = g.goal ? g.head : null, more = new Set((hd && hd.or_more) || []);
  // A goal says how many lanes, next and done rows it has as the host counted them, and "or more" where it may be low.
  if (hd && hd.lanes > 0) put("", hd.lanes === 1 && !more.has("lanes") ? L("cnt_goal_lane_one") : L(more.has("lanes") ? "cnt_goal_lane_more" : "cnt_goal_lane_many", { n: hd.lanes }));
  for (const k of [...KEY_ORDER, "none", "other"]) word(k);
  if (hd) {
    if (hd.next > 0) put("", L(more.has("next") ? "cnt_goal_next_more" : "cnt_goal_next", { n: hd.next }));
    if (hd.done > 0) put("c-done", L(more.has("done") ? "cnt_landed_more" : "cnt_goal_done", { n: hd.done }));
    return out;
  }
  if (g.queued) put("", L("cnt_queued", { n: g.queued }));
  if (g.landed) put("c-done", L("cnt_landed_more", { n: g.landed }));
  return out;
}

/* ---------- the top strip ---------- */
/* What waits on the viewer: the calls the host lists (attention items, never a keyed status). Each shows its title, why,
   what the source recommends, where to answer, the exact line to say and, when the source sent `answer_link`, one plain link
   to its review board (or the reason there is none); nothing is invented, and no option list is made from prose. */
/* Where the call can be answered on the source's review board (feed 1.6 `answer_link`): one plain link that opens in a new tab,
   with how long ago the source checked that the board is open; or, with no link, the source's own words for why there is none
   and the same age. The board sends nothing, so no script and no write; a feed with no `answer_link` adds nothing. */
function boardLink(c) {
  const bl = c.answer_link;
  if (!bl || typeof bl !== "object") return [];
  const e = epoch(bl.state_as_of), ref = c.frozen && c.asOf ? c.asOf : nowS();
  const ago = e == null || !isFinite(e) ? null : agoWord(Math.max(0, ref - e));
  if (bl.url) {
    return [h("span", { class: "pg-boardwrap" }, [h("a", { class: "pg-board", href: bl.url, target: "_blank", rel: "noopener noreferrer" }, L("strip_board_open")),
      ago ? h("span", { class: "pg-board-age" }, L("strip_board_checked", { t: ago })) : null].filter(Boolean))];
  }
  return bl.why ? [h("span", { class: "pg-board-why" }, ago ? L("strip_board_why", { why: bl.why, t: ago }) : bl.why)] : [];
}
function callBlock(c, i, B) {
  const ship = flagshipId(), sayId = "pg-say-" + i;
  const kids = [h("div", { class: "pg-q" }, c.title || c.id)];
  if (c.detail) kids.push(h("details", { class: "pg-reason" + (i ? " pg-short1" : ""), "data-k": "r:" + c.id, open: S.pg.open.has("r:" + c.id) || null },
    h("summary", { class: "pg-reason-sum" }, h("span", { class: "pg-reason-text" }, c.detail), h("span", { class: "pg-reason-more" }, L("strip_reason_more")))));
  /* The choices the source's own record lists (feed 1.9 `options`): read-only chips, not buttons; answering stays on the review board. */
  const opts = Array.isArray(c.options) ? c.options.filter(o => typeof o === "string" && o).slice(0, 4) : [];
  if (opts.length) kids.push(h("ul", { class: "pg-opts", "aria-label": L("strip_options") }, opts.map(o => h("li", { class: "pg-opt" }, o))));
  if (c.recommend) kids.push(h("div", { class: "pg-rec" }, L("strip_recommend", { text: c.recommend })));
  const where = [];
  where.push(h("span", { class: "pg-wait" }, c.frozen ? L("as_of", { t: hm(c.asOf) }) : c.ageS != null ? L("strip_waiting", { t: age(c.ageS) }) : L("strip_waiting_unknown")));
  if (c.lastKnown && !c.frozen) where.push(h("span", { class: "pg-lk" }, L("call_last_known", { t: age(c.answerAgeS) })));
  if (c.how) where.push(h("span", { class: "pg-how" }, c.how));
  where.push(...boardLink(c));
  if (c.say) {
    where.push(h("code", { class: "pg-sayline", id: sayId }, c.say), h("button", { type: "button", class: "copy", "data-copy": sayId }, S.copied === c.say ? L("copied") : S.copied === "select:" + c.say ? L("copy_select") : L("copy")));
  }
  if (ship) where.push(h("a", Object.assign({ class: "pg-door" }, doorAttrs(deckRoute("bridge", c.id, ship), L("strip_open_call") + ": " + (c.title || c.id))), L("strip_open_call")));
  kids.push(h("div", { class: "pg-where" }, where));
  return h("div", { class: "pg-call" + (c.frozen ? " frozen" : "") }, kids);
}
/* The lines of "Problems", in the order the board raises them: criticals, lanes that need attention, lanes that cannot be
   read (one line per machine), a feed that is silent or missing, a number that cannot be verified, and the add-in cards that
   are bad. A line says what is wrong and carries its icon; the doctor's incident cards join it as cards when they are built. */
function attentionLines(B, views) {
  const out = [];
  for (const c of B.critical || []) out.push({ key: "c:" + c.id, icon: "att", slot: "trouble", who: c.title || c.id, text: [c.how, c.ageS != null ? L("ago", { t: age(c.ageS) }) : null].filter(Boolean).join(", ") });
  // An old record (Housekeeping) is never a problem, whatever its lane word or row word says.
  const rows = views.filter(r => !r.l.rowOld);
  for (const r of rows) {
    const old = r.key === "none" && r.l.rowKey === "stuck";   // a feed with no lane word: its row word says it is stuck
    if (r.key !== "att" && !old) continue;
    out.push({ key: "l:" + r.id, icon: old ? "att" : r.icon, slot: "trouble", who: r.title, text: lowerFirst(r.sentence || r.word) });
  }
  const unk = new Map();
  for (const r of rows) if (r.l.rowKey === "unk") { const k = r.machine; if (!unk.has(k)) unk.set(k, 0); unk.set(k, unk.get(k) + 1); }
  for (const [where, n] of unk) out.push({ key: "u:" + where, icon: "unk", slot: "fog", who: null, text: L(n === 1 ? "att_unreadable_one" : "att_unreadable_many", { n, where }) });
  for (const p of (B.trust && B.trust.problems) || []) out.push({ key: "p:" + p, icon: "att", slot: "trouble", who: null, text: p });
  for (const u of B.unverified || []) out.push({ key: "v:" + u.id, icon: "unk", slot: "fog", who: null, text: L("att_unverified", { name: u.name, reason: u.reason || "?" }) });
  for (const c of cardStates()) if (c.key === "bad") out.push({ key: "k:" + c.tool, icon: "att", slot: "trouble", who: c.title, text: c.headline || c.word });
  return out;
}
const lowerFirst = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
function renderStrip(B, views) {
  const calls = B.askCards || [], lines = attentionLines(B, views), c = waitingOnYou(B.asks), a = lines.length;
  // Next to the number: how old it is, and a "sources disagree" badge whose detail lists what differs (frontdoor.js asksDisagree).
  const dis = c && B.disagree;
  const you = h("div", { class: "pg-tile plate pg-you" + (c ? "" : " pg-empty") },
    h("div", { class: "pg-band" }, c && B.callsAtLeast ? h("span", { class: "pg-bandword" }, L("at_least")) : null, h("span", { class: "pg-n" }, String(c)), h("span", { class: "pg-bandword" }, L("strip_you")),
      c ? h("span", { class: "pg-asof" }, asksAsOf(B)) : null, dis ? h("span", { class: "pg-disagree", title: dis.lines.join("\n") }, dis.badge) : null),
    h("div", { class: "pg-body" }, c ? [dis ? h("ul", { class: "pg-differs", "aria-label": dis.badge }, dis.lines.map(x => h("li", null, x))) : null,
      calls.slice(0, CALLS_SHOWN).map((x, i) => callBlock(x, i, B)),
      c > CALLS_SHOWN ? h("div", { class: "pg-more" }, L("call_more", { n: c - CALLS_SHOWN })) : null] : L("strip_you_none")));
  const att = h("div", { class: "pg-tile plate pg-att" + (a ? "" : " pg-empty") },
    h("div", { class: "pg-band" }, h("span", { class: "pg-n" }, String(a)), h("span", { class: "pg-bandword" }, L(a === 1 ? "strip_att_one" : "strip_att"))),
    h("div", { class: "pg-body" }, a ? h("ul", null, lines.map(x => h("li", { "data-k": x.key }, icon(x.icon, x.slot), h("span", null, x.who ? [h("span", { class: "pg-who" }, x.who), ": "] : null, x.text)))) : L("strip_att_none")));
  const aside = renderAside(B);
  const fineOn = !c && !a && B.trust.live === B.trust.total && B.trust.total > 0;
  const open = [c ? L(c === 1 ? "strip_n_call" : "strip_n_calls", { n: c }) : null, a ? L(a === 1 ? "strip_n_problem" : "strip_n_problems", { n: a }) : null].filter(Boolean);
  const nlive = B.trust;
  const fine = h("div", { class: "pg-tile plate pg-fine" + (fineOn ? " on" : "") },
    h("div", { class: "pg-band" }, fineOn ? icon("done", "done") : null, h("span", { class: "pg-bandword" }, L("strip_fine"))),
    h("div", { class: "pg-body" }, fineOn ? L("strip_fine_yes", { live: nlive.live, total: nlive.total, t: age(nlive.newest) })
      : open.length ? L("strip_fine_not", { parts: open.join(" and ") }) : L("strip_fine_not", { parts: L("hdr_feeds", { live: nlive.live, total: nlive.total }) })));
  // The set-aside fold sits under "Needs you", in its column, so the strip keeps its three columns.
  return h("section", { class: "pg-strip", "aria-label": L("strip_label") }, aside ? h("div", { class: "pg-youcol" }, you, aside) : you, att, fine);
}
/* Beside "Needs you", folded until tapped (feed 1.12, model.js asideModel): what the viewer deferred to a date (each with its date and
   reason) and what is someone else's turn (each with whose, since when, and the verdict it waits on). Not counted in "Needs you"; the
   fold's head says so. Nothing to list draws nothing. */
function renderAside(B) {
  const A = B.aside;
  if (!A || !A.n) return null;
  const key = "f:aside", open = S.pg.open.has(key);
  const row = (k, title, parts) => h("li", { class: "pg-arow", "data-k": k }, h("div", { class: "pg-atitle" }, title), h("div", { class: "pg-ameta" }, parts.filter(Boolean).join(" · ")));
  const deferred = A.deferred.map(r => row(r.key, r.title, [r.untilWord ? L("aside_until", { d: r.untilWord }) : L("aside_until_unreported"), r.hold.reason || L("aside_reason_unreported")]));
  const theirs = A.theirs.map(r => {
    const vd = r.verdict && r.verdict.name ? L("aside_verdict", { name: r.verdict.name, state: r.verdict.state ? (LABELS["verdict_" + r.verdict.state] != null ? L("verdict_" + r.verdict.state) : r.verdict.state) : L("aside_not_reported") }) : null;
    return row(r.key, r.title, [r.owner ? L("aside_owner", { name: r.owner }) : L("aside_owner_unreported"),
      r.frozen && r.card.asOf ? L("as_of", { t: hm(r.card.asOf) }) : r.ageS != null ? L("aside_since", { t: age(r.ageS) }) : L("aside_since_unreported"), vd]);
  });
  const head = [A.deferred.length ? L("aside_deferred_n", { n: A.deferred.length }) : null, A.theirs.length ? A.theirsHead + " " + A.theirs.length : null].filter(Boolean).join(" · ");
  return h("details", { class: "pg-tile plate pg-aside", "data-k": key, open: open || null },
    h("summary", { class: "pg-band" }, h("span", { class: "pg-bandword" }, head), h("span", { class: "pg-tap" }, open ? L("fold_hide") : L("fold_tap"))),
    h("div", { class: "pg-body" }, h("p", { class: "pg-anote" }, L("aside_not_counted")),
      A.deferred.length ? [h("h4", null, L("aside_deferred")), h("ul", { class: "pg-alist" }, deferred)] : null,
      A.theirs.length ? [h("h4", null, A.theirsHead), h("ul", { class: "pg-alist" }, theirs)] : null));
}

/* ---------- lanes ---------- */
function pgLaneRow(v, ship) {
  const title = ship ? h("a", Object.assign({ class: "pg-ttl-link" }, doorAttrs(deckRoute("gun-deck", v.id, ship), v.title)), v.title) : v.title;
  const notes = v.notes.length ? h("details", { class: "pg-notes", "data-k": "n:" + v.id, open: S.pg.open.has("n:" + v.id) || null },
    h("summary", null, L("lane_notes")), h("pre", null, v.notes.join("\n"))) : null;
  return h("div", { class: "pg-lane s-" + v.key + (v.stale ? " stale" : ""), "data-lane": v.id },
    icon(v.icon, v.stale ? "fog" : v.slot),
    h("div", { class: "min0" },
      h("div", { class: "pg-st c-" + (v.stale ? "fog" : v.slot) }, h("span", { class: "pg-w" }, v.word, v.cause ? " · " + v.cause : ""),
        h("span", { class: "pg-age" }, v.age, v.stale ? " · " + L("lane_fresh_old") : "")),
      h("div", { class: "pg-ttl" }, title, v.short ? [" ", h("span", { class: "pg-short" }, L("lane_short_only"))] : null, v.key === "none" ? [" ", h("span", { class: "pg-short" }, L("lane_none_word"))] : null),
      h("div", { class: "pg-pm" }, [v.chip, v.machine].filter(Boolean).join(" · ")),
      v.l.steer && v.l.steer.row ? h("div", { class: "pg-steer c-needs" }, v.l.steer.row.text) : null,
      v.sentence ? h("div", { class: "pg-say" }, v.sentence) : null),
    notes);
}
/* The television fold: lanes waiting on a check are one line with counts, each opening to the list. */
function foldRow(rows, ship, gkey) {
  const ref = nowS(), what = new Map();
  let quietN = 0, quietMin = Infinity;
  for (const r of rows) {
    const part = (r.check || []).find(p => CHECK_PARTS[p.t]), k = part ? CHECK_PARTS[part.t][2] : "fold_other";
    what.set(k, (what.get(k) || 0) + 1);
    const nn = (r.check || []).find(p => p.t === "no-news" && p.at);
    if (nn) { const s = ref - epoch(nn.at); if (isFinite(s)) { quietN++; quietMin = Math.min(quietMin, s); } }
  }
  const total = rows.length;
  const said = [...what].map(([k, n]) => (what.size === 1 ? L("fold_sentence_on_all", { what: L(k), n: total }) : L(k) + " " + n));
  const quietLine = quietN ? L("fold_no_news", { n: quietN, t: dur(quietMin >= 3600 ? Math.floor(quietMin / 3600) * 3600 : Math.floor(quietMin / 60) * 60) }) : null;
  const key = "f:" + gkey, open = S.pg.open.has(key);
  return h("details", { class: "pg-fold", "data-k": key, open: open || null },
    h("summary", null, h("span", { class: "pg-label" }, L("fold_head", { n: total })), " · ", [...said, quietLine].filter(Boolean).join("; ") + ". ", h("span", { class: "pg-tap" }, open ? L("fold_hide") : L("fold_tap"))),
    h("div", { class: "pg-foldlist" }, rows.map(r => pgLaneRow(r, ship))));
}
function renderGroup(g, ship, goalsOn) {
  // A goal or a project with no lane at work is a line: its name and its counts.
  if (!g.rows.length) return h("div", { class: "pg-goalline plate" }, h("b", null, g.goal || g.chip || L("grp_no_project")), h("div", { class: "pg-counts" }, countLine(g)));
  // A lane with an instruction waiting unread keeps its own row, so its amber line is never folded away.
  const foldable = r => r.key === "check" && !(r.l.steer && r.l.steer.row);
  const folded = g.rows.filter(foldable), fold = folded.length >= FOLD_MIN;
  const shown = fold ? g.rows.filter(r => !foldable(r)) : g.rows;
  return h("article", { class: "pg-goal plate" },
    h("h3", null, g.goal || g.chip || L("grp_no_project"), goalsOn && !g.goal ? [" ", h("span", { class: "pg-short" }, L("grp_goal_none"))] : null),
    h("div", { class: "pg-counts" }, countLine(g)),
    shown.map(r => pgLaneRow(r, ship)), fold ? foldRow(folded, ship, g.goal ? "g:" + g.goal : String(g.rank)) : null);
}
/* One row word's lanes, as their own card: the word and how many. */
function renderSection(key, rows, ship) {
  const slot = (ROW_LOOK[key] || ROW_LOOK.unk).slot;
  return h("article", { class: "pg-goal plate pg-sect s-" + key, "data-sect": key },
    h("h3", null, icon((ROW_LOOK[key] || ROW_LOOK.unk).icon, slot), " ", h("span", { class: "c-" + slot }, L("row_" + key))),
    h("div", { class: "pg-counts" }, h("span", null, L(rows.length === 1 ? "sect_n_one" : "sect_n", { n: rows.length }))),
    rows.map(r => pgLaneRow(r, ship)));
}
/* Old records come last and folded: what no live lane says, never failed and never counted as work. */
function renderHousekeeping(rows, ship) {
  const key = "f:housekeeping", open = S.pg.open.has(key);
  return h("details", { class: "pg-fold pg-hk plate", "data-k": key, open: open || null },
    h("summary", null, h("span", { class: "pg-label" }, L(rows.length === 1 ? "hk_head_one" : "hk_head", { n: rows.length })), " · ", h("span", { class: "pg-tap" }, open ? L("fold_hide") : L("fold_tap"))),
    h("div", { class: "pg-foldlist" }, rows.map(r => pgLaneRow(r, ship))));
}
/* The Lists page's cards in the one order: a section for each row word but Working, the goal and project cards where Working falls, and
   a goal's or project's counts line last. -> [{kind: "section"|"cards"|"housekeeping"|"lines", key, rows | groups}] */
function listsPlan(views, groups) {
  const bucket = v => (v.l.rowOld ? ROW_HOUSEKEEPING : rowSortKey(v.l)), seen = new Set(), out = [];
  for (const k of [...rowSortOrder((cfg().display || {}).row_sort), ...ROW_KEYS, ROW_HOUSEKEEPING]) {
    if (seen.has(k)) continue;
    seen.add(k);
    const rows = views.filter(v => bucket(v) === k);
    if (k === "work") { if (groups.some(g => g.rows.length)) out.push({ kind: "cards", key: k, groups: groups.filter(g => g.rows.length) }); }
    else if (rows.length) out.push({ kind: k === ROW_HOUSEKEEPING ? "housekeeping" : "section", key: k, rows });
  }
  if (groups.some(g => !g.rows.length)) out.push({ kind: "lines", key: "lines", groups: groups.filter(g => !g.rows.length) });
  return out;
}
const renderLists = (plan, ship, goalsOn) => plan.flatMap(p => p.kind === "section" ? [renderSection(p.key, p.rows, ship)] : p.kind === "housekeeping" ? [renderHousekeeping(p.rows, ship)]
  : p.groups.map(g => renderGroup(g, ship, goalsOn)));

/* ---------- the sea, with a caption for every picture ---------- */
/* One caption for each picture the sea draws now, from the feed field that drives it (docs/honesty.md); the names of the
   machines are the ship's own. */
function seaCaptions(B) {
  const out = [], put = (name, text) => out.push([L("pic_" + name), text]);
  const ships = ((B.fleet && B.fleet.ships) || []).map(x => x.m.label);
  put("ship", ships.length ? L("cp_ship", { names: ships.join(", ") }) : L("cp_ship_plain"));
  if ((B.lanes || []).length) put("sailor", L("cp_sailor"));
  if ((B.askCards || []).length) put("crow", L("cp_crow"));
  put("lighthouse", L("cp_lighthouse"));   // a board with no host takes the hail screen over, so on this one the lamp is lit
  if (B.horizon && (B.horizon.islands || []).length) put("islands", L("cp_islands"));
  if ((B.lanes || []).some(l => l.light)) put("windows", L("cp_windows"));
  return out;
}
function captionList(items, cls) {
  return h("ul", { class: "pg-cap" + (cls ? " " + cls : "") }, items.map(([k, v]) => h("li", null, h("span", { class: "pg-label" }, k), h("span", null, v))));
}
function renderSea(B) {
  if (!S.theme.scene || !S.geom.page) return null;
  const el = h("div", { class: "pg-sea plate", "aria-label": L("sea_label") });
  const pic = h("div", { class: "pg-pic", id: "pg-pic", "data-keep": "1", role: "img", "aria-label": L("cp_ship_plain") });
  el.append(pic, captionList(seaCaptions(B)));
  return el;
}

/* ---------- the places below decks, each with its caption ---------- */
function renderPlaces(B, g) {
  const ship = shipInfo({ ship: flagshipId() }, B);
  if (!ship.id) return null;
  return h("nav", { class: "pg-places", "aria-label": L("page_places") }, DECKS.map(d => {
    const c = deckCount(d, B, ship), name = deckWord(d);
    return h("a", Object.assign({ class: "pg-pdoor plate" + (c.loud ? " loud" : "") }, doorAttrs(deckRoute(d, null, ship.id), name + ", " + deckWhat(d) + ", " + c.text + (c.loud ? ", " + L("door_loud") : ""))),
      h("span", { class: "pg-dname" }, c.loud ? icon("you", "needs") : null, h("span", { class: "pg-label" }, name)), h("span", { class: "pg-dwhat" }, deckWhat(d)), h("span", { class: "pg-dcount" + (c.loud ? " loud" : "") }, c.text));
  }));
}

/* ---------- the key: the six row words, then every picture ---------- */
function renderKeyPanel(B) {
  const rows = ROW_KEYS.map(k => h("div", { class: "pg-keyrow" }, icon(ROW_LOOK[k].icon, ROW_LOOK[k].slot),
    h("div", null, h("span", { class: "pg-label c-" + ROW_LOOK[k].slot }, L("row_" + k)), " ", h("span", { class: "pg-m" }, L("row_" + k + "_what")))));
  rows.push(h("div", { class: "pg-keyrow" }, icon("none", "fog"), h("div", null, h("span", { class: "pg-label c-fog" }, L("lane_none_word")), " ", h("span", { class: "pg-m" }, L("lane_none_what")))));
  const pics = [["ship", "cp_ship_plain"], ["sailor", "cp_sailor"], ["crow", "cp_crow"], ["longboat", "cp_longboat"], ["dolphins", "cp_dolphins"], ["gulls", "cp_gulls"], ["fog", "cp_fog"],
    ["slack", "cp_slack"], ["whale", "cp_whale"], ["rainbow", "cp_rainbow"], ["lighthouse", "cp_lighthouse"], ["islands", "cp_islands"], ["windows", "cp_windows"]]
    .map(([n, t]) => [L("pic_" + n), L(t)]);
  const seen = S.theme.scene ? seenLines(true) : [];
  return h("section", { class: "pg-keypanel", id: "pg-key", role: "dialog", "aria-label": L("key_title") },
    h("div", { class: "pg-keyhead" }, h("h5", null, L("key_lanes_head")), h("button", { type: "button", class: "key-close", "data-key": "close", "aria-label": L("key_close") }, L("close_word"))),
    rows,
    S.theme.scene ? [h("h5", { class: "pg-later" }, L("key_pictures_head")), captionList(pics, "keycap")] : null,
    h("h5", { class: "pg-later" }, L("key_places_head")), captionList(DECKS.map(d => [deckWord(d), deckWhat(d)]), "keycap"),
    seen.length ? [h("h5", { class: "pg-later" }, L("seen_head")), h("div", { class: "pg-seenlist" }, seen), replayButton(true)] : null,
    h("p", { class: "pg-never" }, L("key_never_colour")));
}

/* ---------- the header, the quiet rows and the page ---------- */
function renderHeader(B) {
  const tr = B.trust, crit = (B.critical || []).length > 0;
  const feeds = L("hdr_feeds", { live: tr.live, total: tr.total }) + (tr.resting ? " +" + L("trust_resting_n", { n: tr.resting }) : "");
  const line2 = tr.problems.length || tr.oldNotes.length || tr.slowNotes.length ? tr.line2
    : [B.sample ? L("sample") : null, B.redacted ? L(profileWord()) : null, L("trust_ok", { t: age(tr.newest), host: S.server.host || "" })].filter(Boolean).join(" · ");
  const sea = !!(S.geom && !S.geom.phone);   // back out to the open sea (a phone's page board is its sea, so it has no such door)
  return h("header", { class: "pg-bar plate" + (crit ? " alarm" : "") + (sea ? " withsea" : ""), role: crit ? "alert" : "status" },
    sea ? h("a", Object.assign({ class: "pg-seadoor" }, doorAttrs({ level: "sea" }, L("back_to_sea"))), tri("left"), h("span", { class: "pg-label" }, L("place_sea"))) : null,
    h("div", { class: "pg-clock", "aria-label": hm(B.now) }, hm(B.now)),
    h(flagshipId() ? "a" : "div", Object.assign({ class: "pg-trust min0" }, flagshipId() ? doorAttrs(deckRoute("logbook", null, flagshipId()), L("open_place", { place: deckWord("logbook") })) : {}),
      h("span", { class: "pg-lamp l-" + tr.lamp, "aria-hidden": "true" }), h("span", { class: "pg-label" }, feeds), " · ", h("span", { class: "line2" }, line2)),
    h("button", { type: "button", class: "pg-keybtn", "data-key": "toggle", "aria-expanded": String(!!S.legendOpen), "aria-controls": "pg-key" }, L("key_button")));
}
function renderSinceStrip(B) {
  const d = B.since;
  if (!d) return null;
  const w = sinceWords(d);
  return h("section", { class: "pg-since plate", "aria-label": L("since_label") }, h("span", { class: "pg-label" }, w.head), " ", h("span", { class: "pg-parts" }, w.parts.join(" · ")),
    h("button", { type: "button", class: "since-ok", "data-glance": "seen", "aria-label": L("since_ok") + ": " + L("since_label") }, L("since_ok")));
}
/* The quiet rows: what waits where nobody looks, the allowance, the tool cards and the library, in the fullest words. */
function renderQuiet(B) {
  const rows = [], row = (head, kids) => rows.push(h("div", { class: "pg-qrow" }, h("span", { class: "pg-label" }, head), h("span", { class: "pg-chips" }, kids)));
  if ((B.strip || []).length) row(L("strip_head"), B.strip.slice(0, 8).map(c => h("span", { class: "pg-chip", title: c.title }, c.forms[0])));
  const chips = allowanceChips();
  if (chips.length) row(L("allowance"), chips.slice(0, 8).map(c => h("span", { class: "pg-chip " + (c.slot === "trouble" ? "c-trouble" : ""), title: c.title }, c.forms[0])));
  const cards = cardStates();
  if (cards.length) row(L("tools"), cards.slice(0, 8).map(c => h("span", { class: "pg-chip c-" + c.slot, title: c.headline || c.title }, c.title + (c.mode ? " " + c.mode : "") + " " + c.word)));
  if ((B.library || []).length) row(L("library"), B.library.map(r => h("span", { class: "pg-chip c-" + r.slot, title: r.title }, r.forms[0])));
  return rows.length ? h("section", { class: "pg-quiet plate" }, rows) : null;
}
function renderPage(B, g) {
  const views = B.sorted.map(laneView), groups = pageGroups(B, views), ship = flagshipId(), goalsOn = groups.some(x => x.goal);
  const page = h("div", { class: "pg" });
  const lanes = h("section", { class: "pg-lanes", "aria-label": L(goalsOn ? "grp_lanes_goals" : "grp_lanes") },
    groups.length && !goalsOn ? h("p", { class: "pg-nogoals" }, L("grp_no_goals")) : null,
    h("div", { class: "pg-cols" }, renderLists(listsPlan(views, groups), ship, goalsOn), renderSea(B) || null));
  for (const part of [renderHeader(B), S.legendOpen ? renderKeyPanel(B) : null, renderSinceStrip(B), renderStrip(B, views), renderPlaces(B, g),
    views.length || groups.length ? lanes : h("section", { class: "pg-lanes pg-empty plate" }, h("p", null, L("log_empty")), renderSea(B)), renderQuiet(B)]) if (part) page.append(part);
  return page;
}

/* What the user opens or closes stays so across the once-a-second redraw. */
document.addEventListener("toggle", e => {
  const d = e.target;
  if (!d || !d.dataset || !d.dataset.k) return;
  if (d.open) S.pg.open.add(d.dataset.k); else S.pg.open.delete(d.dataset.k);
}, true);
S.pg = { open: new Set() };

/* ---------- geometry of the page: the sea is a window onto the scene's 640 x 360 stage ---------- */
/* How many columns the lanes have at this width (style.css: the same two breakpoints), and the width of one in CSS px. */
const PAGE_COLS = W => (W > 1500 ? 3 : W > 760 ? 2 : 1);
function pageGeometry(g0, B) {
  const W = g0.W, cols = PAGE_COLS(W), font = Math.min(44, Math.max(15, W * 0.0122)), gut = 16, gap = font * 0.5;
  const colW = (W - 2 * gut - (cols - 1) * gap) / cols - font * 1.2;   // the sea's plate has its own padding
  const win = ((((S.theme.zones || {}).tv || {}).scene || {}).window) || { x: 384, y: 41, w: 236, h: 164 };
  const dpr = g0.dpr, fit = Math.max(1, (colW * dpr) / win.w), whole = Math.max(1, Math.floor(fit));
  const apDev = whole / fit >= 0.8 ? whole : Math.max(1, Math.floor(fit * 4) / 4), ap = apDev / dpr;
  return Object.assign({}, g0, { page: true, ap, apDev, AW: win.w, AH: win.h, ox: -win.x, oy: -win.y, win, left: 0, top: 0, sceneX: 0, sceneY: 0 });
}
