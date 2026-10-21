"use strict";
/* Board model. Turns the merged view from /api/view into what the board shows: the calls, the
   alarm, the off-course lanes, each machine's pip and word, and the trust line. Staleness is
   computed here, per source, from the host's receive time and the host's Date header, so a dead
   host cannot hide it. Nothing here draws, and nothing here knows which theme is in use. */

const S = {
  view: null, server: null, etag: null,
  srv0: Date.now() / 1000, p0: performance.now(), // host clock at the last response, and when it arrived
  clockHeld: false,
  failSince: null, retryAt: 0, trying: false, loadedVersion: null, sig: null, dyn: [],
  dev: { mode: null, host: false, night: null, sleep: false, sky: null, motion: null, ambient: null, ambient_stats: false, theme: null, screen: null },
  audio: null,
  lastCallAt: null, laneSig: {}, laneChanged: {}, polls: 0,
};
const redacted = () => !!(S.view && S.view.profile && S.view.profile.redaction !== "none");
const LEVEL_RANK = { live: 0, late: 1, stale: 2, lost: 3, absent: 3 };
const KIND_ORDER = { decision: 0, approval: 1, machine: 2, capacity: 3, service: 4, disk: 5, credential: 6 };
/* Off course is needs_action plus running_long, nothing else (docs/feed-spec.md, "Lanes on the board"). */
const OFF_ORDER = { failed: 0, agent_gone: 1, blocked: 2, call: 3, approval: 4, long: 5 };
const OFF_CLASSES = ["needs_action", "running_long"];
/* An old record (frontdoor.js isOldRecord) is housekeeping, never off course, whatever its class. */
const offCourse = l => OFF_CLASSES.includes(l.cls) && !l.rowOld;
/* Declared machine rest: shown neutral, never as silence or an alarm. */
const RESTING = ["maintenance", "reserved", "draining"];

/* ---------- config, words and time ---------- */
const cfg = () => (S.server && S.server.config) || { labels: {}, theme: {}, display: {}, thresholds: {}, poll: {}, sound: {} };
let LABELS = {};
function L(key, vars) {
  let s = LABELS[key];
  if (s == null) s = cfg().labels[key];
  if (s == null) s = key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(v);
  return s;
}
const TH = () => Object.assign({ default_interval_s: 30, live_within_intervals: 2, late_within_intervals: 4, lost_after_s: 900,
  host_down_after_s: 30, retry_every_s: 10, collector_stale_s: {}, supervision_wake_limit_s: 300, supervision_stale_critical_s: 1800 }, cfg().thresholds);
const nowS = () => S.srv0 + (S.clockHeld ? 0 : (performance.now() - S.p0) / 1000);
const epoch = iso => (iso ? Date.parse(iso) / 1000 : null);
// dur (a span in words) is in frontdoor.js, so its tests can run it
/* Ages on the board change once a minute at most: only the hail countdown ticks every second. */
function age(s) {
  return s == null || !isFinite(s) ? "?" : s < 60 ? L("under_a_minute") : dur(s);
}
/* How long ago, in plain words: "just now" under a minute, else "12 min ago" (src/weatherdeck/glance.py relative). */
const agoWord = s => (s == null || !isFinite(s) ? "?" : s < 60 ? L("just_now") : L("ago", { t: dur(s) }));
/* A row's age in its state, short: "new" under a minute, else "2 h 10 min". */
const ageShort = s => (s == null || !isFinite(s) ? null : s < 60 ? L("age_new") : dur(s));
/* Seconds that must still read as seconds (no answer for, newest data): in steps of 10 s. */
const coarse = s => (s < 60 ? Math.max(0, Math.floor(s / 10) * 10) + " s" : dur(s));
function fmt(opts) {
  const tz = cfg().display.tz || undefined;
  try { return new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: tz }, opts)); }
  catch (e) { return new Intl.DateTimeFormat("en-GB", opts); }
}
const hm = t => fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000));
const wkhm = t => fmt({ weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000)).replace(",", "");
const dayKey = t => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: cfg().display.tz || undefined }).format(new Date(t * 1000)); } catch (e) { return new Date(t * 1000).toLocaleDateString("en-CA"); } };
const minutesOf = t => { const [a, b] = hm(t).split(":").map(Number); return a * 60 + b; };
const parseHM = s => { const [a, b] = String(s).split(":").map(Number); return a * 60 + b; };
const within = (x, a, b) => (a > b ? x >= a || x < b : x >= a && x < b);
function inQuiet(t) {
  const q = cfg().display.quiet_hours;
  if (!q || !q.start || !q.end) return false;
  return within(minutesOf(t), parseHM(q.start), parseHM(q.end));
}
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const words = s => String(s || "").replace(/_/g, " ");

/* ---------- per-source state, from the host's receive time ---------- */
/* While the host does not answer, a source's age stops at the last answer: its data is last known,
   not wrong, so its section keeps its state (spec 9.9). */
function srcAge(s) {
  if (s.received_at == null) return null;
  const a = (S.failSince != null ? S.failAt : nowS()) - s.received_at;
  const I = s.interval_s || TH().default_interval_s, t = TH();
  const forced = { late: 3 * I, stale: 4 * I + 120, lost: t.lost_after_s + 120 }[S.dev.mode];
  return forced != null ? Math.max(a, forced) : a;
}
function srcLevel(s) {
  if (s.placeholder) return "absent";
  const a = srcAge(s), I = s.interval_s || TH().default_interval_s, t = TH();
  if (a <= I * t.live_within_intervals) return "live";
  if (a <= I * t.late_within_intervals) return "late";
  if (a <= t.lost_after_s) return "stale";
  return "lost";
}
const reporting = () => (S.view.sources || []).filter(s => !s.placeholder);
const hostDown = () => S.dev.host || (S.failSince != null && (performance.now() - S.failSince) / 1000 > TH().host_down_after_s);
function globalLevel() {
  if (!S.view) return "loading";
  if (hostDown()) return "hostdown";
  const rep = reporting();
  if (!rep.length) return "waiting";
  if (rep.every(s => srcLevel(s) === "lost")) return "lost";
  return "ok";
}
const srcById = id => (S.view.sources || []).find(s => s.id === id);
const srcName = s => (s && (s.label || s.id)) || "";
const levelOfSource = id => { const s = srcById(id); return s ? srcLevel(s) : "live"; };
const quiet = lv => lv === "stale" || lv === "lost" || lv === "absent";
const worseLevel = (a, b) => (b && LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);
function collectorState(sourceId, cid) {
  const s = srcById(sourceId);
  const c = s && (s.collectors || []).find(x => x.id === cid);
  if (!c) return null;
  const gen = epoch(s.generated_at);
  const a = (c.as_of && gen != null ? gen - epoch(c.as_of) : 0) + srcAge(s);
  const limit = (TH().collector_stale_s || {})[cid];
  return { age: a, bad: c.status === "error" || c.status === "stale" || (limit != null && a > limit), error: c.status === "error" };
}
/* What a source says about its own software (feed 1.3, producer), in words. A version it did not report reads "version
   unknown", never a guessed one; a skew note is the adapter's own reason for a gap that changes what the machine can say. */
function softwareOf(s) {
  const p = s.producer || {}, pu = p.pusher || {};
  const other = k => srcName(srcById(k.newer_source) || { id: k.newer_source });
  return { s, adapter: p.version ? L("adapter_v", { v: p.version }) : L("adapter_unknown"), pusher: pu.version ? L("pusher_v", { v: pu.version }) : L("pusher_unknown"),
    host: p.host || null, known: !!p.version,
    skewShort: (s.skew || []).length ? L("skew_trust", { name: srcName(s), v: p.version }) : null,
    skew: (s.skew || []).map(k => L(k.effect ? "skew_note" : "skew_note_n", { name: srcName(s), v: p.version, since: k.since, newer: k.newer_version, other: other(k), effect: k.effect })) };
}
/* The newest receive time of any reporting source: what "last known" is as of. */
const newestAt = () => (S.view ? Math.max(0, ...reporting().map(s => s.received_at || 0)) : 0);

/* A machine's own beat has an age the reporting source states (a delta on its own clock); the host's
   receive time adds the time since, so a skewed clock cannot make a beat look old or fresh. */
function beatAge(m) {
  const s = m.observed_by && srcById(m.observed_by);
  return m.beat && m.beat.age_s != null && s && s.received_at != null ? m.beat.age_s + srcAge(s) : null;
}
function beatLevel(m) {
  const a = beatAge(m), I = (m.beat && m.beat.interval_s) || TH().default_interval_s, t = TH();
  if (a == null) return null;
  return a <= I * t.live_within_intervals ? "live" : a <= I * t.late_within_intervals ? "late" : a <= t.lost_after_s ? "stale" : "lost";
}
function machineWatchers(m) {
  const own = (S.view.sources || []).filter(s => s.machine === m.id);
  return own.length ? own : (m.observed_by && srcById(m.observed_by) ? [srcById(m.observed_by)] : []);
}
function machineLevel(m) {
  const w = machineWatchers(m);
  const lv = w.length ? w.map(srcLevel).sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] : "live";
  return { lv, watchers: w };
}

/* What a quiet source says about itself and its machine (frontdoor.js sourceSaying): how long it has been silent against the interval
   it declares, and the machine's own liveness from its beat (the host's `beat_seen`). A host that does not say leaves the machine out. */
const sayingWords = () => Object.fromEntries(SOURCE_SAYING_LABELS.map(k => [k, L(k)]));
const beatFacts = seen => (seen ? { ageS: Math.max(0, (S.failSince != null ? S.failAt : nowS()) - epoch(seen.at)), intervalS: seen.interval_s || null } : null);
function sourceSay(s) {
  const t = TH(), mach = s.machine && (S.view.machines || []).find(m => m.id === s.machine);
  return sourceSaying({ level: srcLevel(s), ageS: srcAge(s), intervalS: s.interval_s || t.default_interval_s,
    declared: s.interval_declared == null ? null : s.interval_declared, lateN: t.late_within_intervals,
    hasMachine: !!(mach && mach.beat_seen !== undefined), beat: mach ? beatFacts(mach.beat_seen) : null, beatIntervalS: t.default_interval_s }, sayingWords());
}
/* A silent machine's liveness through its beat alone, or null when the host does not say. */
function machineSeen(m) {
  return m.beat_seen === undefined ? null : beatSaying({ beat: beatFacts(m.beat_seen), lateN: TH().late_within_intervals, intervalS: TH().default_interval_s }, sayingWords());
}

/* ---------- add-in cards (docs/ADDINS.md): data a tool left in the drop directory ---------- */
const CARD_LOOK = { ok: ["done", "ink2"], warn: ["needs", "needs"], bad: ["failed", "trouble"], unknown: ["silent", "fog"] };
const CARD_ORDER = { bad: 0, warn: 1, stale: 2, unknown: 3, ok: 4 };
/* Staleness is decided here from the host clock, like a source's: an old card never reads OK. */
function cardState(c) {
  const ageS = Math.max(0, nowS() - epoch(c.updated_at)), stale = ageS > (c.stale_after_s || 900);
  const key = stale ? "stale" : c.status, look = stale ? CARD_LOOK.unknown : CARD_LOOK[c.status] || CARD_LOOK.unknown;
  const word = stale ? L("card_stale", { t: age(ageS) }) : L("card_" + c.status);
  return { tool: c.tool, title: c.title || c.tool, key, glyph: look[0], slot: look[1], word, ageS, mode: c.mode || null, headline: c.headline || null,
    numbers: (c.numbers || []).map(n => n.label + " " + n.value + (n.unit ? " " + n.unit : "")), link: c.link || null,
    last: stale ? L("card_last", { s: L("card_" + c.status) }) : null };
}
const cardStates = () => ((S.view && S.view.cards) || []).map(cardState).sort((a, b) => CARD_ORDER[a.key] - CARD_ORDER[b.key] || (a.title < b.title ? -1 : 1));

/* ---------- the glyph map (core) and state words ---------- */
let GLYPHS = { states: {}, pips: {} };
function stateWord(key, vars) {
  const w = LABELS["state_" + key] ?? cfg().labels["state_" + key] ?? ((GLYPHS.states[key] || {}).word) ?? key;
  let s = w;
  for (const [k, v] of Object.entries(vars || {})) s = s.split("{" + k + "}").join(v);
  return s;
}
function pipWord(key, vars) {
  let s = LABELS["machine_" + key] ?? cfg().labels["machine_" + key] ?? ((GLYPHS.pips[key] || {}).word) ?? key;
  for (const [k, v] of Object.entries(vars || {})) s = s.split("{" + k + "}").join(v);
  return s;
}

/* ---------- lanes ---------- */
function stepLabel(it) {
  const p = it.progress || {}, cur = p.current, steps = p.steps || [];
  if (!cur || cur.step == null) return null;
  return (steps.find(x => x.id === cur.step) || {}).label || cur.step;
}
function grown(it, lv) {
  const s = srcById(it.source);
  return lv === "live" && s ? Math.min(nowS() - s.received_at, 2 * (s.interval_s || 30)) : 0;
}
/* The lane's pull request, when its link is one: {url, state (open|merged|closed|null), name "owner/repo#n"}. */
function lanePR(it) {
  const l = it.link || {}, m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(l.url || "");
  return m ? { url: l.url, state: l.state || null, name: m[1] + "#" + m[2] } : null;
}
/* A lane whose run record says failed (or done, or nothing) but whose recorded PR is open did its work and waits on review
   upstream: "PR open", calm, never FAILED. FAILED only when the PR was closed unmerged, or there is no PR. A merged PR has
   landed. A PR whose state could not be read is said as such, not as a failure. A lane still at work keeps its own plate. */
function prKind(it) {
  const pr = lanePR(it);
  if (!pr || !["failed", "done", "unknown", null, undefined].includes(it.state)) return null;
  if (pr.state === "open") return "pr_open";
  if (pr.state === "merged") return "done";
  if (pr.state === "closed") return it.state === "failed" ? "failed" : null;
  return it.state === "failed" ? "pr_unread" : null;
}
/* The host classifies every lane (src/weatherdeck/lanes.py); this copy only serves a view from an older host. */
function laneKind(it, lv) {
  if (it.lane && it.lane.kind) return it.lane.kind;
  const p = it.progress || {}, cur = p.current || {}, hand = (it.handoff || {}).state;
  if (hand === "awaiting_you") return "approval";
  if (it.state === "waiting" && it.needs_you) return "call";
  const byPR = prKind(it);
  if (byPR) return byPR;
  if (it.state === "done") return "done";
  if (it.state === "failed") return "failed";
  if (it.state === "blocked") return "blocked";
  if (it.state == null || it.state === "unknown") return "unknown";
  if (it.state === "waiting" || it.state === "paused") return "mate";
  if (it.kind === "investigation" || it.kind === "scout") return "scout";
  const el = cur.elapsed_s != null ? cur.elapsed_s + grown(it, lv) : null;
  if ((it.flags || []).includes("running_long") || (cur.p90_s != null && el != null && el > cur.p90_s)) return "long";
  if (p.regressed || (cur.round || 0) > 1) return "regressed";
  return "moving";
}
/* Steps with no weights (a source that knows the phase, not how far through it): where the work is, as "2 of 4". */
function lanePhase(it) {
  const p = it.progress || {}, steps = p.steps || [];
  if (!steps.length || laneRange(it)) return null;
  const cur = steps.findIndex(x => x.status === "current");
  if (cur >= 0) return { n: cur + 1, m: steps.length };
  return steps.every(x => x.status === "done" || x.status === "skipped") ? { n: steps.length, m: steps.length } : null;
}
function laneRange(it) {
  const p = it.progress || {}, rp = it.reported;
  if (p.percent_floor != null) {
    const lo = Math.max(0, Math.min(100, p.percent_floor)), hi = Math.max(lo, Math.min(100, p.percent_ceiling ?? lo));
    return { lo, hi, text: lo === hi ? lo + "%" : lo + "–" + hi + "%", reported: false };
  }
  if (rp && rp.percent != null) {
    const n = Math.max(0, Math.min(100, Math.round(rp.percent)));
    return { lo: 0, hi: n, text: "~" + n + "%", reported: true };
  }
  return null;
}
/* plain: structured fields only (the front door's row sentence, page.js rowPlain): no summary, no agent reason, no basis note. */
function laneDetail(it, kind, lv, plain) {
  const p = it.progress || {}, cur = p.current || {}, bits = [];
  const step = stepLabel(it);
  const el = cur.elapsed_s != null ? cur.elapsed_s + grown(it, lv) : null;
  const pr = lanePR(it);
  const ag = it.agent || {};
  const said = plain ? null : summaryOf(it);
  if (kind === "agent_gone") bits.push(L(ag.state === "gone" ? "agent_gone_line" : "agent_ended_line", { t: age(nowS() - epoch(ag.since)) }), plain ? null : ag.reason || null, said);
  else if (kind === "pr_open") bits.push(L("pr_open_detail", { pr: pr.name }));
  else if (kind === "pr_unread") bits.push(L("pr_unread_detail", { pr: pr.name, state: it.state }));
  else if (it.state === "unknown") { if (said) bits.push(said); }
  else if (cur.waiting_since) bits.push(L("stopped", { step: step || "" }).trim(), L("waiting_t", { t: age(nowS() - epoch(cur.waiting_since)) }));
  else if (step && el != null) {
    bits.push(L("step_of_typical", { step, t: age(el), typical: cur.typical_s != null ? dur(cur.typical_s) : "?" }));
    if (kind === "long" && cur.activity === "quiet" && cur.last_activity_age_s != null) bits.push(L("quiet_for", { t: age(cur.last_activity_age_s) }));
  } else if (said) bits.push(said);
  // Quiet work (becalmed when every running lane on its machine is): said on the lane's own row, not only when long.
  if ((kind === "moving" || kind === "regressed") && cur.activity === "quiet" && cur.last_activity_age_s != null) bits.unshift(L("quiet_for", { t: age(cur.last_activity_age_s + grown(it, lv)) }));
  if (kind === "regressed" && p.regressed) bits.push(L("regressed_note"));
  const rp = it.reported;
  if (rp && rp.percent != null) {
    const at = epoch(rp.at);
    bits.push(L("reported_line", { pct: Math.max(0, Math.min(100, Math.round(rp.percent))), label: rp.label ? ", " + rp.label : "", t: at != null ? age(nowS() - at) : "?" }));
  }
  if (it.second_hand) bits.push(L("second_hand", { source: srcName(srcById(it.source)) }));
  if ((it.handoff || {}).state === "automatic") bits.push(L("automatic"));
  if (!plain && p.basis === "coarse" && !rp && !lanePhase(it)) bits.push(L("basis_coarse"));
  return bits.filter(Boolean).join(", ");
}
/* The row's one line: the source's summary (feed 1.1), else what the host made of its 1.0 words; never the raw status. */
function summaryOf(it) {
  if (it.row) return it.row.summary || null;
  return (["blocked", "failed", "waiting", "paused"].includes(it.state) ? it.state_detail || it.doing : it.doing) || null;
}
/* A lane's class: the host's, except that a silent source's lane is quiet (last known) unless it needs action. */
function laneClass(it, kind, stale) {
  const cls = (it.lane && it.lane.cls) || (kind in OFF_ORDER ? (kind === "long" ? "running_long" : "needs_action") : ["mate", "approval", "pr_open", "pr_unread"].includes(kind) ? "waiting" : kind === "unknown" ? "quiet" : "ok");
  return stale && cls !== "needs_action" ? "quiet" : cls;
}
/* The lane's stage, for its sailor's station on deck (docs/theme-spec.md section 17): waits on you and landed from its
   state; else the feed's items[].phase; else the step under way through display.stage_of_step; else an open PR is at the
   signal mast. Null when none of these says, and the sailor stands at a plain spot: unknown is not build. An approval whose PR
   merged has landed, and one whose PR was closed waits on nobody: neither is at the rail (an old record, frontdoor.js isOldRecord). */
const STAGES = ["plan", "build", "verify", "ship", "wait", "land"];
function laneStage(it, kind) {
  const prState = (lanePR(it) || {}).state;
  if (kind === "call" || (kind === "approval" && prState !== "merged" && prState !== "closed")) return "wait";
  if (kind === "done" || (kind === "approval" && prState === "merged")) return "land";
  if (kind === "approval") return null;
  if (kind === "unknown" || kind === "scout") return null;
  if (STAGES.includes(it.phase)) return it.phase;
  const map = cfg().display.stage_of_step || {}, cur = (it.progress || {}).current || {};
  const step = cur.step != null ? ((it.progress.steps || []).find(x => x.id === cur.step) || { id: cur.step }) : null;
  for (const k of step ? [step.id, step.label] : []) {
    const w = String(k == null ? "" : k).toLowerCase().trim();
    if (STAGES.includes(map[w])) return map[w];
    if (STAGES.includes(map[w.split(/[\s:(]/)[0]])) return map[w.split(/[\s:(]/)[0]];
  }
  return kind === "pr_open" ? "ship" : null;
}
/* The stern window of a lane (docs/theme-spec.md section 23.2), from the feed's own items[].agent.state and nothing else:
   "lit" (the agent is alive), "dark" (its session ended, or its endpoint is gone), "unknown" (the source reports no agent for
   it, a word this page does not know, or the report is old: a shutter, never lit and never plain dark), null (finished work
   needs no agent, and failed work is flagged as needing action on its own, so no window). It never says idle against busy: the feed does not either. */
function agentLight(it, kind, stale) {
  if (kind === "done" || kind === "failed" || kind === "pr_open" || kind === "pr_unread") return null;
  if (stale) return "unknown";
  const st = it.agent && typeof it.agent === "object" ? it.agent.state : null;
  return st === "alive" ? "lit" : st === "ended" || st === "gone" ? "dark" : "unknown";
}
function buildLanes(mstate) {
  const out = [], hostdown = hostDown();
  for (const it of S.view.items || []) {
    const lv = levelOfSource(it.source);
    const kind = laneKind(it, lv);
    const g = GLYPHS.states[kind] || GLYPHS.states.unknown || {};
    const cur = (it.progress || {}).current || {};
    const machineLost = it.machine && mstate[it.machine] && mstate[it.machine].key === "lost";
    const waitingOn = (it.lane && it.lane.waiting_on) || null;
    let word;
    if (kind === "moving") word = stepLabel(it) || stateWord("running");
    else if (kind === "regressed") word = stateWord("regressed", { n: cur.round || 2 });
    else if (kind === "mate") word = waitingOn ? L("waits_" + waitingOn) : stateWord(it.state === "paused" ? "paused" : "mate");
    else word = stateWord(kind);
    const stale = quiet(lv) || hostdown || !!machineLost;
    const cls = laneClass(it, kind, stale);
    // Amber is for what needs action: a ready approval nobody has called for waits calmly.
    const slot = (g.slot || "fog") === "needs" && cls !== "needs_action" ? "ink2" : g.slot || "fog";
    const until = it.lane && it.lane.until ? epoch(String(it.lane.until).length === 10 ? it.lane.until + "T00:00:00Z" : it.lane.until) : null;
    let detail = laneDetail(it, kind, lv);
    if (cls === "waiting" && until && until > nowS()) detail = [L("until_t", { t: until - nowS() < 86400 ? hm(until) : wkhm(until) }), detail].filter(Boolean).join(", ");
    // How long it has been in its state (the host's age_in_state, counted on from the time it measured from).
    const since = it.age && it.age.since ? epoch(String(it.age.since).length === 10 ? it.age.since + "T00:00:00Z" : it.age.since) : null;
    const inState = since != null ? Math.max(0, (stale && S.view ? Math.min(nowS(), (srcById(it.source) || {}).received_at || nowS()) : nowS()) - since) : null;
    if (cls === "waiting" && ["external", "pr"].includes(waitingOn)) {
      const who = it.waiting_for || L("waits_who_" + waitingOn);
      detail = [inState != null ? L("outside_line", { who, t: age(inState) }) : L("outside_who", { who }), detail].filter(Boolean).join(", ");
    }
    const row = it.row || {};
    out.push({ id: it.id, it, kind, cls, waitingOn, glyph: g.glyph || "silent", slot, tier: g.tier, word, order: row.order || [1e6, 1e6], ageText: ageShort(inState),
      title: row.title || it.title || it.id, chip: row.chip || null, detail, range: laneRange(it), phase: lanePhase(it), machine: it.machine || "",
      lv, stale, started: epoch(it.started_at) || 0, group: it.group || null, changed: S.laneChanged[it.id] || null, stage: laneStage(it, kind), inState, light: agentLight(it, kind, stale),
      quiet: ["moving", "long", "regressed"].includes(kind) && cur.activity === "quiet" ? (cur.last_activity_age_s != null ? cur.last_activity_age_s + grown(it, lv) : -1) : null });
  }
  return out;
}

/* ---------- the horizon: the islands ahead (docs/theme-spec.md section 23.1) ----------
   One island per next[] entry, from that entry's own kind, until and place in the queue; nothing else puts one there, and an
   empty or missing next[] is an open horizon. Dated entries come first, soonest first, then holds and gates, then queued
   work, each in the source's order. At most three are drawn (one on the phone); `total` stays the true count, said in words.
   step: 3 near and large (due today, or past), 2 (tomorrow; or the first of the undated, which is next in line), 1 far and
   small (a later date, or the rest of the undated). state: "ok", "unknown" (that source's queue collector is old or failed:
   the last known island, as a dotted outline) or "fog" (the source is silent: the last known island under its fog). */
const HORIZON_MAX = 3;
function horizonOf(next, now, phone) {
  const list = Array.isArray(next) ? next : [], today = dayKey(now), day = d => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
  const dated = n => /^\d{4}-\d{2}-\d{2}/.test(String(n.until || "")) && !isNaN(day(n.until));
  const kindOf = n => (n.kind === "held" || n.kind === "gate" ? n.kind : "queued");
  const rows = list.map((n, i) => ({ n, i, d: dated(n) })).sort((a, b) => (b.d - a.d) || (a.d ? day(a.n.until) - day(b.n.until) : (kindOf(a.n) === "queued") - (kindOf(b.n) === "queued")) || a.i - b.i);
  let undated = 0;
  const islands = rows.slice(0, phone ? 1 : HORIZON_MAX).map(({ n, d }) => {
    const gap = d ? Math.round((day(n.until) - day(today)) / 86400000) : null;
    const step = d ? (gap <= 0 ? 3 : gap === 1 ? 2 : 1) : (undated++ === 0 ? 2 : 1);
    const lv = n.source ? levelOfSource(n.source) : "live", cs = n.source ? collectorState(n.source, "queue") : null;
    return { id: n.id, kind: kindOf(n), step, dated: d, state: quiet(lv) ? "fog" : cs && cs.bad ? "unknown" : "ok" };
  });
  return { islands, total: list.length, more: Math.max(0, list.length - islands.length) };
}

/* ---------- machines ---------- */
function lowDisk(m) { return (m.disks || []).find(x => x.free_gb != null && x.warn_gb != null && x.free_gb < x.warn_gb) || null; }
function machineReason(m) {
  const d = lowDisk(m);
  if (d) return L("reason_disk", { n: Math.round(d.free_gb) });
  if (m.on_battery) return L("reason_battery");
  return L("reason_pressure");
}
/* Struggling, against the machine's own norm (the host's strain verdict, src/weatherdeck/norms.py): only when its load stayed
   above max(baseline x k, floor) for the configured minutes. A machine the host has no load figures for keeps its
   source's own word. A low disk and running on battery are said whatever the load. */
function strained(m) {
  if (lowDisk(m) || m.on_battery) return true;
  if ((m.pressure || {}).level === "critical") return true;   // the norm judges load; a memory or swap emergency is absolute
  const st = (m.strain || {}).state;
  if (st === "struggling") return true;
  if (st === "ok") return false;
  const pr = (m.pressure || {}).level;
  return m.status === "warn" || pr === "warn" || pr === "critical";
}
/* A declared rest (maintenance, reserved, draining) that has not run past its until. */
function restingOf(m) {
  const h = m.health || {};
  if (!RESTING.includes(h.state)) return null;
  const until = h.until ? epoch(String(h.until).length === 10 ? h.until + "T23:59:59Z" : h.until) : null;
  if (until != null && until < nowS()) return null;
  return { state: h.state, until, reason: h.reason || null };
}
function machineVitals(m, lv) {
  const out = [], add = (text, cls) => out.push({ text, cls: cls || "" });
  const hs = (m.health || {}).state;
  if (quiet(lv) && m.as_of) add(L("as_of_last", { t: hm(epoch(m.as_of)) }), "fog");
  const bl = beatLevel(m), ba = beatAge(m), seen = quiet(lv) ? machineSeen(m) : null;
  if (seen) add(cap(seen.text), seen.evidence === "beat" ? "" : "fog");   // a silent source's machine: seen through its beat, or not seen
  else if (bl && bl !== "live") add(L("beat") + " " + L("old", { t: age(ba) }), bl === "late" ? "warn" : "bad");
  if (hs === "lost" && m.health.reason) add(m.health.reason, "bad");
  if (RESTING.includes(hs) && m.health.reason) add(m.health.reason);
  // Feed 1.12 (said early, so a short list keeps it): the lanes on this machine, every home's own count added up by the host; "or more" when a home with lanes here sent none.
  const ln = m.lanes;
  if (ln && typeof ln.running === "number") {
    const homes = (ln.homes || []).length, more = ln.or_more ? " " + L("lanes_or_more") : "";
    add(L(ln.total != null ? "lanes_running_of" : "lanes_running", { n: ln.running, total: ln.total }) + more + " · " + L(homes === 1 ? "lanes_homes_one" : "lanes_homes", { n: homes })
      + ((ln.unreported || []).length ? " · " + L("lanes_unreported", { n: ln.unreported.length }) : ""));
  }
  const sn = m.strain || {};
  if (sn.state === "struggling") add(L("strain_line", { v: sn.value, b: sn.baseline ?? "?", thr: sn.threshold, t: age(sn.sustained_s) }), "warn");
  else if (sn.state === "ok" && sn.value != null && sn.baseline != null) add(L("strain_ok", { v: sn.value, b: sn.baseline }));
  const pr = m.pressure, judged = sn.state === "ok" || sn.state === "struggling";
  if (pr && pr.level) {   // with a norm to judge by, the reporter's own level is a detail, not an alarm
    add(L("pressure") + " " + L("pressure_" + pr.level) + ((pr.level !== "ok" && (pr.why || []).length) ? ": " + pr.why.slice(0, 2).join("; ") : ""), pr.level === "ok" || judged ? "" : pr.level === "warn" ? "warn" : "bad");
  }
  if (m.load && m.load.runq_per_core != null) add(L("runq") + " " + L("per_core", { n: m.load.runq_per_core.toFixed(1) }));
  const io = m.mem && (m.mem.swap_rate_pps_1m != null ? ["swap_io", m.mem.swap_rate_pps_1m] : m.mem.paging_pps != null ? ["paging_io", m.mem.paging_pps] : null);
  if (io) add(L(io[0]) + " " + L("per_s", { n: Math.round(io[1]) }));
  const cost = m.beat && m.beat.cost;
  if (cost && cost.over_budget) add(L("beat_cost") + " " + cost.cpu_pct.toFixed(2) + "%", "warn");
  if (m.load && m.load.l1 != null) add(L("load") + " " + m.load.l1.toFixed(1) + (m.load.cores ? "/" + m.load.cores : ""), m.load.cores && m.load.l1 / m.load.cores > 0.85 ? "warn" : "");
  if (m.mem && m.mem.used_pct != null) add(L("mem") + " " + m.mem.used_pct + "%", m.mem.used_pct > 85 ? "warn" : "");
  if (m.mem && m.mem.swap_used_pct != null) add(L("swap") + " " + m.mem.swap_used_pct + "%", m.mem.swap_used_pct > 20 ? "warn" : "");
  for (const d of m.disks || []) {
    if (d.free_gb == null) continue;
    add((d.label || L("disk")) + " " + L("free", { n: d.free_gb }), d.crit_gb != null && d.free_gb < d.crit_gb ? "bad" : d.warn_gb != null && d.free_gb < d.warn_gb ? "warn" : "");
  }
  if (m.on_battery) add(L("battery") + " " + L("on"), "warn");
  for (const x of m.extras || []) add(x.label + " " + String(x.value), x.severity === "critical" ? "bad" : x.severity === "warn" || x.severity === "action" ? "warn" : "");
  return out;
}
/* A machine the config lists in display.may_sleep, whose reporters went quiet inside quiet hours (or in the hour
   before them) and which is still in quiet hours, is asleep, not missing. The board still fogs it and shows its
   ages; only the word changes. Outside quiet hours, or after 14 hours, it is just silent again. */
function asleepSince(m, watchers) {
  if (!watchers.length || !(cfg().display.may_sleep || []).includes(m.id)) return null;
  const q = cfg().display.quiet_hours;
  if (!q || !q.start || !q.end) return null;
  const last = Math.max(...watchers.map(s => s.received_at || 0)), now = nowS();
  if (!last || now - last > 14 * 3600) return null;
  const from = (parseHM(q.start) + 1380) % 1440;
  return inQuiet(now) && within(minutesOf(last), from, parseHM(q.end)) ? last : null;
}
/* One pip and one word per machine (section 7). A machine never reads OK while a critical is on it. */
function machineState(m, criticalOn) {
  const { lv, watchers } = machineLevel(m);
  const hs = (m.health || {}).state, rest = restingOf(m);
  const silentFor = () => Math.max(...watchers.map(s => srcAge(s) || 0));
  let key, vars = {};
  // Declared rest comes first: a machine under maintenance or reserved is expected to go quiet, so it never reads
  // silent or lost, and no gulls leave it (world.js).
  if (rest && rest.state !== "draining") key = rest.state;
  else if (quiet(lv) && watchers.length) { key = "silent"; vars.t = age(silentFor()); }
  else if (hs === "lost") { key = "lost"; vars.t = age(m.health.since ? nowS() - epoch(m.health.since) : beatAge(m) || 0); }
  else if (criticalOn) key = "alert";
  else if (m.status === "down") key = "down";
  else if (rest) key = "draining";
  else if (strained(m)) { key = "warn"; vars.reason = machineReason(m); }
  else if (m.status === "ok" || m.status === "warn" || (m.strain || {}).state === "ok") key = "ok";
  else key = "unknown";
  const asleep = key === "silent" ? asleepSince(m, watchers) : null;
  const p = GLYPHS.pips[key] || (RESTING.includes(key) ? GLYPHS.pips.draining : null) || GLYPHS.pips.silent || { pip: "silent", slot: "fog" };
  let word = asleep ? L("machine_asleep", { t: hm(asleep) }) : key === "unknown" ? stateWord("unknown") : pipWord(key, vars);
  if (rest && key === rest.state && rest.until) word = L("machine_" + key + "_until", { t: rest.until - nowS() < 86400 ? hm(rest.until) : wkhm(rest.until) });
  return { id: m.id, label: m.label || m.id, role: m.role || "", key, pip: key === "unknown" ? "silent" : p.pip, slot: key === "unknown" ? "fog" : RESTING.includes(key) ? "ink2" : p.slot,
    word, short: asleep ? L("machine_asleep_short") : key === "silent" || key === "lost" ? pipWord(key, { t: "" }).trim() : RESTING.includes(key) ? pipWord(key) : word, lv, watchers,
    asleep, resting: RESTING.includes(key) ? rest : null, vitals: machineVitals(m, lv), silent_s: key === "silent" ? silentFor() : 0, critical: !!criticalOn, m };
}

/* ---------- the fleet: one ship per machine (src/weatherdeck/fleet.py; docs/feed-spec.md "The fleet") ----------
   The host hands the fixed order (the flagship, the configured order, then names) and the most ships drawn; the page
   judges each machine on its own clock and applies the same berth and convoy rules as fleet.py (kept in step with it). */
const HULL_ORDER = ["alert", "down", "lost", "silent", "warn", "unconfirmed", "unknown", "asleep", "draining", "maintenance", "reserved", "ok"];
const HULL_WORD = { alert: "alert", down: "not_answering", lost: "lost", silent: "silent", warn: "struggling", unconfirmed: "unconfirmed", unknown: "no_word", asleep: "asleep",
  draining: "draining", maintenance: "maintenance", reserved: "reserved", ok: "ok" };
const CALM_KEYS = ["ok", "draining", "maintenance", "reserved"];
const foldName = x => String(x || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
function berthOf(m, lanes, calls) {
  if (m.asleep) return "anchored";
  return CALM_KEYS.includes(m.key) && !lanes && !calls ? "harbor" : "sea";
}
function convoyWords(ms) {
  const n = {};
  for (const m of ms) { const k = m.asleep ? "asleep" : m.key === "ok" && m.unconfirmed ? "unconfirmed" : HULL_WORD[m.key] ? m.key : "unknown"; n[k] = (n[k] || 0) + 1; }
  return HULL_ORDER.filter(k => k !== "ok" && n[k]).map(k => [HULL_WORD[k], n[k]]);
}
// A pending card moves the machine's word and berth only if it would once confirmed: an info card never does either.
const pendingCounts = a => a.severity !== "info";
function buildFleet(B) {
  const fv = (S.view && S.view.fleet) || {}, byId = Object.fromEntries(B.machines.map(m => [m.id, m]));
  const flag = byId[fv.flagship] ? fv.flagship : flagshipId();
  const order = (Array.isArray(fv.order) ? fv.order : []).filter(id => byId[id]);
  if (flag && byId[flag] && !order.includes(flag)) order.unshift(flag);
  const rest = B.machines.filter(m => !order.includes(m.id)).sort((a, b) => foldName(a.label).localeCompare(foldName(b.label)) || String(a.id).localeCompare(String(b.id)));
  order.push(...rest.map(m => m.id));
  const cap = Math.max(1, Math.min(6, +fv.max_ships || 6)), shown = order.length <= cap ? order : order.slice(0, cap);
  const onIt = id => [...(B.askCards || []), ...(B.critical || []), ...(B.pending || []).filter(pendingCounts)].filter(c => c.machine === id).length;
  const ships = shown.map((id, i) => {
    const m = byId[id], lanes = (B.lanes || []).filter(l => l.machine === id).length;
    return { id, slot: i, role: i === 0 ? "flagship" : "escort", berth: berthOf(m, lanes, onIt(id)), lanes, m };
  });
  const cm = order.slice(shown.length).map(id => byId[id]);
  const words = convoyWords(cm);
  const convoy = cm.length ? { ids: cm.map(m => m.id), n: cm.length, words,
    text: [L(cm.length === 1 ? "fleet_convoy_one" : "fleet_convoy", { n: cm.length }), ...words.map(([w, k]) => k + " " + L("hull_" + w))].join(" · "),
    worst: (words.find(([w]) => w !== "unconfirmed") || ["ok"])[0], stale: cm.some(m => m.key === "silent" || m.key === "lost") } : null;
  // The horizon's shares from the host (fleet.py roadstead), for the open sea and beside a call.
  const road = fv.roadstead && fv.roadstead.open && fv.roadstead.call && (fv.roadstead.open.ships || []).length === ships.length ? fv.roadstead : null;
  return { flagship: flag || (ships[0] || {}).id || null, order, ships, convoy, roadstead: road };
}

/* What "landed" counts (history.landed from the host): "Landed, last 24 h" or "Landed today" (a configured day start). */
const landedRolling = B => !!(B.landedWindow && B.landedWindow.mode === "rolling");
const landedWord = B => (landedRolling(B) ? L("landed_hours", { h: B.landedWindow.hours }) : L("landed_today"));
const landedWhen = B => (landedRolling(B) ? L("when_hours", { h: B.landedWindow.hours }) : L("when_today"));
/* Text cut to fit `room` art px at a word boundary (measured with the loaded face), with an ellipsis when cut. */
function cutToWidth(role, text, room, measure) {
  text = String(text || "");
  if (!room || measure(role, text) <= room) return text;
  const words = text.split(" ");
  while (words.length > 1) {
    words.pop();
    const t = words.join(" ").replace(/[\s,;:.\-–—·]+$/, "") + "…";
    if (measure(role, t) <= room) return t;
  }
  let t = text;
  while (t.length > 1 && measure(role, t + "…") > room) t = t.slice(0, -1);
  return t + "…";
}

/* ---------- black holes (feed 1.2): what waits where nobody looks ---------- */
/* Seconds since a host-clock epoch, frozen at the source's last report while it is silent (last known, never counted on). */
function liveSince(t, sourceId) {
  if (t == null) return null;
  const s = sourceId && srcById(sourceId), frozen = hostDown() || (s && quiet(srcLevel(s)));
  return Math.max(0, (frozen ? (hostDown() ? newestAt() : s.received_at) : nowS()) - t);
}
/* The age a source's answer had when it built its feed (one clock), plus the time since the host received it. */
function answerAge(s) {
  const w = s.waiting;
  if (!w || (w.as_of == null && w.age_s == null)) return null;
  const at = w.age_s != null ? w.age_s : Math.max(0, epoch(s.generated_at) - epoch(w.as_of));
  return isFinite(at) ? at + srcAge(s) : null;
}
function blackHoles(B) {
  const gp = (S.view && S.view.gaps) || {}, now = nowS();
  // Work held by someone outside the fleet, oldest first, each with who and for how long; an old record (Housekeeping) waits on nobody.
  const oldIds = new Set((B.oldRecords || []).map(l => l.it.source + "\n" + l.id));
  const outside = (gp.waits_outside || []).filter(w => !oldIds.has(w.source + "\n" + w.id)).map(w => Object.assign({}, w, { ageS: w.since ? liveSince(epoch(String(w.since).length === 10 ? w.since + "T00:00:00Z" : w.since), w.source) : null }));
  // Shared queues: the oldest wait counts on from the host's clock while its source reports.
  const queues = (gp.queues || []).map(q => Object.assign({}, q, { waitS: q.oldest_since != null ? liveSince(q.oldest_since, q.source) : null,
    stale: quiet(levelOfSource(q.source)) }));
  // Dated holds and rests that end within the configured days, soonest first.
  const today = dayKey(now), coming = (gp.coming_up || []).filter(c => (c.date ? c.date >= today : c.at >= now));
  // What is merged but not deployed, per deploy the sources report.
  const deploys = (gp.deploys || []).map(d => Object.assign({}, d, { oldS: d.oldest_unshipped_at ? liveSince(epoch(d.oldest_unshipped_at), d.source) : null }));
  // How old each reporting source's answers are: the waiting number's own answer, and every collector past its limit.
  const answers = [], old = [], slowed = [], made = [];
  for (const s of reporting()) {
    if (quiet(srcLevel(s))) continue;   // a silent source is said by the source rules already
    if (s.pace && s.pace.slowed) slowed.push({ source: s.id, name: srcName(s), pace: s.pace, everyS: s.interval_s });
    const a = answerAge(s);
    if (a != null) answers.push({ id: s.id, name: srcName(s), s: a, basis: (s.waiting || {}).basis || null });
    const since = Math.max(0, nowS() - S.srv0);
    for (const f of s.freshness || []) {
      const row = { source: s.id, name: srcName(s), id: f.id, label: f.label, state: f.state, s: f.age_s != null ? f.age_s + since : null, error: f.error, made: !!f.made, refreshS: f.refresh_s || null };
      if (f.state !== "ok") old.push(row);
      if (f.made) made.push(row);   // feed 1.12: the age of the copy since its maker made it, said whether or not it is old
    }
  }
  answers.sort((a, b) => b.s - a.s);
  return { outside, queues, coming, deploys, answers, staleCollectors: old, madeAges: made, slowed, queueing: queues.filter(q => q.length) };
}

/* When a coming-up time falls: "14:00" today, "tomorrow", "Tue 14:00" within the week, else "12 Oct". A date with no
   time is the whole day: "today", "tomorrow", "Tue". */
function dueWord(at, dateOnly, date) {
  // A date with no time is a calendar day ("2026-10-11"): compared with today's date as it is, never moved by a time zone.
  const day = date ? Date.parse(date + "T12:00:00Z") / 1000 : null, ref = day != null ? day : at;
  const days = Math.round((Date.parse((day != null ? date : dayKey(at)) + "T12:00:00Z") - Date.parse(dayKey(nowS()) + "T12:00:00Z")) / 86400000);
  const utc = o => new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "UTC" }, o)).format(new Date(ref * 1000));
  if (days <= 0) return dateOnly ? L("due_today") : hm(at);
  if (days === 1 && dateOnly) return L("due_tomorrow");
  if (days < 7) return dateOnly ? (day != null ? utc({ weekday: "short" }) : fmt({ weekday: "short" }).format(new Date(at * 1000))) : wkhm(at);
  return day != null ? utc({ day: "numeric", month: "short" }) : fmt({ day: "numeric", month: "short" }).format(new Date(at * 1000));
}
/* A calendar date (or a time) in plain words for a row: "today", "yesterday", "tomorrow", a weekday within the week either
   way, else "12 Oct". A date with no time stays that calendar day; it is never moved by a time zone. */
function dayWord(text) {
  const str = String(text || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null, at = date ? null : epoch(str);
  if (!date && (at == null || !isFinite(at))) return str;
  const key = date || dayKey(at), days = Math.round((Date.parse(key + "T12:00:00Z") - Date.parse(dayKey(nowS()) + "T12:00:00Z")) / 86400000);
  const utc = o => new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "UTC" }, o)).format(new Date(key + "T12:00:00Z"));
  if (days === 0) return L("due_today");
  if (days === 1) return L("due_tomorrow");
  if (days === -1) return L("day_yesterday");
  if (Math.abs(days) < 7) return utc({ weekday: "short" });
  return utc({ day: "numeric", month: "short" });
}
/* The watch strip: what waits where nobody looks, as chips with words from fullest to shortest for the page to fit.
   Queues backed up first, then work waiting outside, merges not shipped, queues still moving, and what comes up. Calm
   words, never amber: these are things to know, not calls. */
function stripChips(B) {
  const out = [], cut = (x, n) => (String(x).length > n ? String(x).slice(0, n - 1) + "…" : String(x));
  const qChip = q => ({ key: "q:" + q.source + ":" + q.id, slot: q.state === "backed_up" ? "ink" : "ink2", title: [q.label, L("queue_word", { n: q.length }), q.held != null ? (q.cap != null ? L("queue_held", { n: q.held, cap: q.cap }) : L("queue_held_n", { n: q.held })) : null, q.waitS != null ? L("oldest_t", { t: age(q.waitS) }) : null].filter(Boolean).join(", "),
    // A backed-up queue says so in words, not only in the brighter ink.
    forms: q.state === "backed_up"
      ? [q.waitS != null ? L("strip_queue_backed", { q: q.label, n: q.length, t: age(q.waitS) }) : L("strip_queue_backed_n", { q: q.label, n: q.length }), L("strip_queue_backed_n", { q: q.label, n: q.length })]
      : [q.waitS != null ? L("strip_queue", { q: q.label, n: q.length, t: age(q.waitS) }) : L("strip_queue_n", { q: q.label, n: q.length }), L("strip_queue_n", { q: q.label, n: q.length })] });
  for (const q of B.queueing.filter(q => q.state === "backed_up")) out.push(qChip(q));
  if (B.outside.length) {
    const o = B.outside[0], n = B.outside.length;
    out.push({ key: "outside", slot: "ink2", title: B.outside.map(w => w.title + ": " + w.who + (w.ageS != null ? " " + age(w.ageS) : "")).join("; "),
      forms: [o.ageS != null ? L("strip_outside", { n, t: age(o.ageS), who: o.who }) : L("strip_outside_n", { n }), o.ageS != null ? L("strip_outside_short", { n, t: age(o.ageS) }) : L("strip_outside_n", { n }), L("strip_outside_n", { n })] });
  }
  for (const d of B.deploys.filter(d => d.state === "behind")) {
    out.push({ key: "deploy:" + d.id, slot: "ink2", title: L("deploy_line", { d: d.label, n: d.behind, deployed: d.deployed || "?", head: d.head || "?" }),
      forms: [d.oldS != null ? L("strip_deploy", { d: d.label, n: d.behind, t: age(d.oldS) }) : L("strip_deploy_n", { d: d.label, n: d.behind }), L("strip_deploy_n", { d: d.label, n: d.behind })] });
  }
  // A version gap that changes what a machine can say (feed 1.3): the reason in words when it fits, the gap when it does not.
  for (const sw of B.software.filter(x => x.skew.length)) {
    const p = sw.s.producer || {}, first = sw.s.skew[0];
    out.push({ key: "skew:" + sw.s.id, slot: "ink2", title: sw.skew.join("; "),
      forms: [...(first.effect ? [L("strip_skew", { name: srcName(sw.s), v: p.version, effect: first.effect })] : []), L("strip_skew_n", { name: srcName(sw.s), v: p.version, since: first.since }), L("strip_skew_s", { name: srcName(sw.s), v: p.version })] });
  }
  for (const q of B.queueing.filter(q => q.state !== "backed_up")) out.push(qChip(q));
  for (const c of B.coming.slice(0, 2)) {
    const w = dueWord(c.at, c.date_only, c.date);
    out.push({ key: "up:" + c.kind + ":" + c.id, slot: "ink2", title: L("up_" + c.word, { title: c.title, t: w }), forms: [L("up_" + c.word, { title: cut(c.title, 28), t: w }), L("up_" + c.word, { title: cut(c.title, 14), t: w })] });
  }
  return out;
}

/* ---------- the library (feed 1.10): one row per mirrored folder, its word decided on the host (src/weatherdeck/gaps.py mirrors) ---------- */
/* Each word is read from the host's row, and only the source's silence is read again here, on this page's clock, so a row never reads
   newer than its source. A silent source's row says SILENT, keeps its last word as last known, and its ages stop. Calm: no amber, no call. */
const LIB_LOOK = { failing: ["failed", "ink"], not_checked: ["long", "ink"], silent: ["silent", "fog"], unknown: ["silent", "fog"],
  not_reporting: ["silent", "fog"], waiting: ["mate", "ink2"], up_to_date: ["done", "ink2"], retired: ["asleep", "ink2"] };
function libWord(state, r, silentS, checkedS) {
  switch (state) {
    case "failing": return L("lib_failing");
    case "not_checked": return L("lib_not_checked", { t: age(checkedS) });
    case "silent": return L("lib_silent", { t: age(silentS) });
    case "unknown": return L("lib_unknown");
    case "not_reporting": return L("lib_not_reporting");
    case "waiting": return L("lib_waiting", { n: r.pending != null ? r.pending : "?" });
    case "up_to_date": return L("lib_up_to_date");
    case "retired": return r.since ? L("lib_retired_since", { d: r.since }) : L("lib_retired");
    default: return cap(words(state));
  }
}
function libraryRows() {
  return ((((S.view || {}).gaps || {}).mirrors) || []).map(r => {
    const src = r.source ? srcById(r.source) : null, at = r.at || {};
    const silent = r.state === "silent" || (r.state !== "retired" && !!src && quiet(srcLevel(src)));
    const state = silent ? "silent" : r.state, last = silent ? (r.state === "silent" ? r.last_known : r.state) : null;
    const since = t => (t == null ? null : liveSince(t, r.source));   // stopped at the source's last report while it is silent
    const checkedS = since(at.checked), changedS = since(at.changed), failingS = since(at.failing), pendingS = since(at.pending);
    const silentS = src ? srcAge(src) : null, lastWord = last ? libWord(last, r, silentS, checkedS) : "?";
    const why = {
      failing: [words(r.outcome) + (r.detail ? ": " + r.detail : ""), failingS != null ? L("lib_failing_for", { t: age(failingS) }) : null].filter(Boolean).join(" · "),
      not_checked: L("lib_why_not_checked", { t: age(checkedS) }),
      silent: L("lib_why_silent", { t: age(silentS), word: lastWord }),
      unknown: L("lib_why_unknown"),
      not_reporting: L("lib_why_not_reporting"),
      waiting: pendingS != null ? L("lib_why_waiting", { n: r.pending, t: age(pendingS) }) : L("lib_why_waiting_n", { n: r.pending }),
      up_to_date: r.nothing_new && r.changed_at ? L("lib_nothing_new", { d: dayWord(r.changed_at) }) : "",
      retired: r.note || "",
    }[state] || "";
    const ages = [checkedS != null && state !== "not_checked" ? L("lib_checked", { t: agoWord(checkedS) }) : null, changedS != null ? L("lib_changed", { t: agoWord(changedS) }) : null];
    const word = libWord(state, r, silentS, checkedS), look = LIB_LOOK[state] || LIB_LOOK.unknown, leaf = String(r.label).replace(/\/+$/, "").split("/").pop() + "/";
    const tail = state === "silent" ? L("lib_last_known", { word: lastWord }) : ages[0];
    return Object.assign({}, r, { state, last, word, why, ages: ages.filter(Boolean), glyph: look[0], slot: look[1], stale: silent,
      checkedS, changedS, pendingS, title: [r.label, word, why, ...ages].filter(Boolean).join(" · "),
      forms: [r.label + " " + word + (tail ? " · " + tail : ""), r.label + " " + word, leaf + " " + word] });
  });
}

/* ---------- at a glance (src/weatherdeck/glance.py): project order, and what changed since this screen last looked ---------- */
/* Rows grouped by project first, machine second: the host's row.order, which depends on names only, never on states. */
const byProject = (a, b) => (a.order[0] - b.order[0]) || (a.order[1] - b.order[1]);
/* A screen's last look lives only in this browser (localStorage), as the host's opaque marks and a time on the host's
   clock; nothing about it is ever sent to the host. A blocked store degrades quietly: no strip, nothing remembered. */
const SEEN_KEY = "weatherdeck.seen";
const GL = { arrive: true, delta: null, shownAt: null, savedAt: -Infinity, blocked: false };
const sinceCfg = () => Object.assign({ enabled: true, min_away_min: 10, show_min: 15 }, cfg().display.since_last || {});
const viewMarks = () => (((S.view || {}).glance || {}).marks) || null;
function seenRead() {
  try { const j = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); return j && j.v === 1 ? j : null; }
  catch (e) { GL.blocked = true; return null; }
}
function seenWrite(at) {
  const m = viewMarks();
  if (!m || GL.blocked || !sinceCfg().enabled) return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ v: 1, at: Math.round(at), calls: m.calls || [], stuck: m.stuck || [] })); GL.savedAt = performance.now(); }
  catch (e) { GL.blocked = true; }
}
/* glance.delta: landed after the last look, and calls and stuck lanes whose keys that look did not hold. Null on a first
   visit, for a look less than minAway seconds ago, or for a stored look that cannot be read. */
function glanceDelta(seen, m, minAway, now) {
  if (!seen || typeof seen.at !== "number" || !isFinite(seen.at)) return null;
  const away = now - seen.at;
  if (away < Math.max(0, minAway || 0)) return null;
  const had = k => new Set(Array.isArray(seen[k]) ? seen[k] : []);
  const calls = had("calls"), stuck = had("stuck");
  const d = { since: seen.at, away_s: Math.floor(away), landed: (m.landed || []).filter(t => t > seen.at).length,
    calls: (m.calls || []).filter(k => !calls.has(k)).length, stuck: (m.stuck || []).filter(k => !stuck.has(k)).length };
  d.any = !!(d.landed || d.calls || d.stuck);
  return d;
}
/* An old record (frontdoor.js isOldRecord) is never newly stuck: its lane's mark (the host's row.mark) is left out of the stuck keys. */
function glanceLive(m, lanes) {
  const old = new Set((lanes || []).filter(l => l.rowOld).map(l => ((l.it || {}).row || {}).mark).filter(Boolean));
  return old.size ? Object.assign({}, m, { stuck: (m.stuck || []).filter(k => !old.has(k)) }) : m;
}
/* Called on every render: on arrival (the page opened, or its tab came back) compare with the stored look; while the
   screen is looked at with nothing to show, the stored look follows it (every 30 s, and when the tab is hidden). */
function glanceNow(now, lanes) {
  const c = sinceCfg(), m = viewMarks();
  if (!c.enabled || !m || GL.blocked) return null;
  if (GL.arrive) {
    GL.arrive = false;
    const d = glanceDelta(seenRead(), glanceLive(m, lanes), c.min_away_min * 60, now);
    GL.delta = d && d.any ? d : null;
    GL.shownAt = GL.delta ? now : null;
    if (!GL.delta) seenWrite(now);
  }
  if (GL.delta && now - GL.shownAt > c.show_min * 60) { GL.delta = null; seenWrite(now); }
  if (!GL.delta && !document.hidden && performance.now() - GL.savedAt > 30000) seenWrite(now);
  return GL.delta;
}
function glanceSeen() { GL.delta = null; seenWrite(nowS()); }
function glanceLeave() { if (!GL.delta && S.view) seenWrite(nowS()); }
function glanceBack() { GL.arrive = true; }
/* The strip's words, fullest first: "Since you looked 3 h ago: 4 landed, 1 new call, 2 newly stuck". */
function sinceWords(d) {
  const parts = [d.landed ? L("since_landed", { n: d.landed }) : null, d.calls ? (d.calls === 1 ? L("since_calls_one") : L("since_calls", { n: d.calls })) : null,
    d.stuck ? L("since_stuck", { n: d.stuck }) : null].filter(Boolean);
  // How long ago, coarse: minutes within the hour, else whole hours, else days (a look is not timed to the minute).
  const a = d.away_s, t = a < 3600 ? agoWord(a) : L("ago", { t: a < 172800 ? Math.round(a / 3600) + " h" : Math.round(a / 86400) + " d" });
  return { head: L("since_head", { t }), short: L("since_head_short", { t }), parts };
}

/* ---------- the board ---------- */
function timeOfDay(t) {
  const tod = (S.theme && S.theme.color && S.theme.color.time_of_day) || { dawn: ["05:30", "07:30"], day: ["07:30", "18:30"], dusk: ["18:30", "21:00"], night: ["21:00", "05:30"] };
  const x = minutesOf(t);
  for (const k of ["dawn", "day", "dusk", "night"]) if (tod[k] && within(x, parseHM(tod[k][0]), parseHM(tod[k][1]))) return k;
  return "day";
}
function themeMode() {
  if (S.dev.night != null) return S.dev.night ? "night" : "day";
  return cfg().theme.mode || "auto";
}
/* Feed 1.11 `waiting.note`: a source whose waiting number is unverified may name the one attention card that explains it. The board
   says so itself ("unverified", and why), so that card is not listed twice. A card nobody named stays; so does one from another source. */
const explainsUnverified = (unver, c) => (unver || []).some(u => u.note != null && u.id === c.source && u.note === c.id);
function attention() {
  const v = S.view, hd = hostDown();
  const rows = (v.attention || []).map(a => {
    const src = srcById(a.source), lv = src ? srcLevel(src) : "live";
    const frozen = hd || quiet(lv);
    const asOf = hd ? newestAt() : frozen && src ? src.received_at : null;
    const since = epoch(a.since);
    // Feed 1.8 `as_of`: how old the answer behind this call was on the host's clock (its age when the source built the feed,
    // plus the time since the host received it). Past the source's own limit for it, the card is last known, never confirmed.
    // With no `as_of` or no limit the card says nothing more: unknown stays unknown.
    const gen = src ? epoch(src.generated_at) : null, at = epoch(a.as_of), lim = src && (src.freshness || []).find(f => f.id === "attention");
    const answerAgeS = src && gen != null && at != null && srcAge(src) != null ? Math.max(0, gen - at) + srcAge(src) : null;
    const lastKnown = answerAgeS != null && !!lim && !!lim.limit_s && answerAgeS > lim.limit_s;
    return Object.assign({}, a, { frozen, asOf, answerAgeS, lastKnown, sinceEpoch: since, glyph: a.kind === "approval" ? "approve" : "needs",
      ageS: since == null ? null : (asOf || nowS()) - since },
      supervisionAlarm(a, srcName(src) || a.source, Object.fromEntries(SUPERVISION_LABELS.map(k => [k, L(k)])), TH().supervision_wake_limit_s,
        a.supervisor || (src && src.supervisor), TH().supervision_stale_critical_s));
  });
  const order = (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (a.sinceEpoch ?? Infinity) - (b.sinceEpoch ?? Infinity);
  // cardTier (frontdoor.js): a critical card is a Problem, an info card an FYI; only the calls wait on the viewer.
  const calls = rows.filter(a => cardTier(a) === "call").sort(order);
  // A lane that waits for the viewer's OK and that no call names (the host's lane.asks_you) is an ask of its own, oldest first.
  const words = Object.fromEntries(ASK_LABELS.map(k => [k, L(k)]));
  const callers = [...new Set(calls.map(c => c.source).filter(Boolean))].map(id => srcName(srcById(id)) || id);
  const lanes = (v.items || []).filter(it => it.lane && it.lane.asks_you === true).map(it => {
    const c = laneAskCard(it, words, callers), src = srcById(it.source), frozen = hd || (src ? quiet(srcLevel(src)) : false);
    const asOf = hd ? newestAt() : frozen && src ? src.received_at : null, since = epoch(c.since);
    return Object.assign(c, { frozen, asOf, sinceEpoch: since, glyph: "approve", ageS: since == null ? null : (asOf || nowS()) - since });
  }).sort((a, b) => (a.sinceEpoch ?? Infinity) - (b.sinceEpoch ?? Infinity));
  const asks = askRows({ calls, lanes });
  const names = Object.fromEntries((v.sources || []).map(s => [s.id, srcName(s) || s.id]));
  return {
    critical: rows.filter(a => cardTier(a) === "alarm").sort(order),
    calls,
    // the rows the waiting-on-you number counts (askRows, frontdoor.js): the band, the Lists header, the Bridge and the plates;
    // askCards are their cards, the calls first, as the band and the Lists page list them
    asks,
    askCards: asks.map(a => a.c),
    // how old the number is (the oldest report behind it), and whether the calls and the lanes that say they wait disagree
    asksAgeS: asksAge(asks, v.sources, v.counts, nowS()),
    disagree: asksDisagree(v.waiting_disagree, v.items, rows, words, names),
    // true while any call card is unconfirmed: the number is then "at least N", never a plain N
    callsAtLeast: rows.some(a => a.lastKnown && cardTier(a) === "call"),
    // An FYI says what it is and whose it is, in words (fyiLine); an FYI is never counted.
    also: rows.filter(a => cardTier(a) === "fyi").map(a => Object.assign(a, { fyi: fyiLine(a, names) })),
    // Feed 1.12, set aside by the host (view.py `aside`), never counted: what the viewer deferred to a date, and what is someone else's turn.
    deferred: rows.filter(a => cardTier(a) === "deferred"),
    theirs: rows.filter(a => cardTier(a) === "theirs"),
    // Machine alerts said in one feed and not yet confirmed by a second (src/weatherdeck/debounce.py): never counted, never hidden.
    pending: (v.attention_pending || []).map(a => Object.assign({}, a, { frozen: hd || (srcById(a.source) ? quiet(srcLevel(srcById(a.source))) : false), glyph: "needs" })),
  };
}
/* Whose turn a card is (feed 1.12 `actor`), in words: its name as the source gives it, else a word for its role; null when the source
   does not say (never a guess). */
function actorWord(a) {
  const ac = a && a.actor && typeof a.actor === "object" ? a.actor : null;
  if (!ac) return null;
  if (typeof ac.name === "string" && ac.name.trim()) return ac.name.trim();
  return LABELS["actor_" + ac.role] != null ? L("actor_" + ac.role) : ac.role ? String(ac.role) : null;
}
/* An FYI in plain words: what kind of notice it is, its title, and whose it is: the actor the source names (feed 1.12), "you" when it
   names the viewer, else the source it came from with its owner "not reported". */
function fyiLine(a, names) {
  const what = LABELS["fyi_kind_" + a.kind] != null ? L("fyi_kind_" + a.kind) : L("fyi_kind_other");
  const role = a.actor && a.actor.role, who = actorWord(a);
  const owner = role === "viewer" ? L("fyi_owner_you") : who ? L("fyi_owner", { name: who }) : L("fyi_owner_unreported", { source: names[a.source] || a.source || "?" });
  return L("fyi_line", { what, title: [a.title || a.id, a.note].filter(Boolean).join(" · "), owner });
}
/* The section beside "Needs you" (feed 1.12): the viewer's dated holds that still hold (cards and queued rows the host set aside as
   deferred, soonest first, each with its date and reason) and what is someone else's turn (each with whose, since when, and the
   verdict it waits on). Every word is a field; a missing one says "not reported". Neither group is ever counted. */
function asideModel(B) {
  const holdOf = x => (x.hold && typeof x.hold === "object" ? x.hold : {});
  const untilAt = u => epoch(String(u).length === 10 ? u + "T00:00:00Z" : u);
  // The hold's own date in full ("Thu 22 Oct"; a time adds its hour): a date is that calendar day, never moved by a time zone.
  const untilDate = u => {
    const d = String(u).length === 10, at = untilAt(u);
    if (at == null || !isFinite(at)) return null;
    const o = { weekday: "short", day: "numeric", month: "short" };
    return d ? new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "UTC" }, o)).format(new Date((at + 43200) * 1000)) : fmt(o).format(new Date(at * 1000)) + " " + hm(at);
  };
  const deferred = [...(B.deferred || []).map(c => ({ key: "c:" + c.id, title: c.title || c.id, hold: holdOf(c), source: c.source, card: c })),
    ...((S.view.next || []).filter(n => n.aside === "deferred").map(n => ({ key: "n:" + n.id, title: n.title || n.id, hold: holdOf(n), source: n.source, row: n })))]
    .map(r => Object.assign(r, { untilWord: r.hold.until ? untilDate(r.hold.until) : null, at: r.hold.until ? untilAt(r.hold.until) : Infinity }))
    .sort((a, b) => a.at - b.at || String(a.title).localeCompare(String(b.title)));
  const theirs = (B.theirs || []).map(c => ({ key: "c:" + c.id, title: c.title || c.id, owner: actorWord(c), ageS: c.ageS, frozen: c.frozen, verdict: c.verdict && typeof c.verdict === "object" ? c.verdict : null, card: c }))
    .sort((a, b) => (b.ageS ?? -1) - (a.ageS ?? -1));
  const owners = [...new Set(theirs.map(r => r.owner))];
  return { deferred, theirs, theirsHead: owners.length === 1 && owners[0] ? L("aside_theirs_named", { name: owners[0] }) : L("aside_theirs"), n: deferred.length + theirs.length };
}
/* Why a source slowed itself, in words: its own reasons ("load", "battery", ...), each in the board's words; a reason the
   board has no words for is shown as the source said it, and none at all is said as such. */
function paceWhy(pace) {
  const w = (pace.why || []).map(k => { const t = L("pace_why_" + k); return t === "pace_why_" + k ? k : t; });
  return w.length ? w.join(", ") : L("pace_why_none");
}
function trustLine(B) {
  const rep = reporting();
  // A source on a machine that declares rest (reserved, maintenance) is neither live nor an alarm: it is counted apart.
  // A placeholder (never reported) is no failing feed: it is not in the count (frontdoor.js trustCounts) and not a named problem;
  // the Crow's nest and the Sources list still say "not reporting" for it.
  const restingOn = new Set((B.machines || []).filter(m => m.resting && m.key !== "draining").map(m => m.id));
  const restingQuiet = s => restingOn.has(s.machine) && quiet(srcLevel(s));
  const { live, total, resting } = trustCounts((S.view.sources || []).map(s => ({ placeholder: !!s.placeholder, level: srcLevel(s), restingQuiet: restingQuiet(s) })));
  const lvs = rep.filter(s => !restingQuiet(s)).map(srcLevel);
  const worst = lvs.sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] || "absent";
  const newest = rep.length ? Math.min(...rep.map(srcAge)) : null;
  const lamp = B.hostdown ? "stale" : worst === "live" ? "live" : worst === "late" ? "late" : "stale";
  const line1 = L("trust_live", { live, total }) + (resting ? ", " + L("trust_resting_n", { n: resting }) : "") + (newest != null ? ", " + L("trust_newest", { t: age(newest) }) : "");
  const problems = [], skewNotes = [];
  for (const s of rep) {
    const lv = srcLevel(s);
    const sleeper = (B.machines || []).find(m => m.id === s.machine && m.asleep);
    const resting = (B.machines || []).find(m => m.id === s.machine && m.resting);
    if (quiet(lv) && resting) continue;   // a machine under maintenance or reserved is expected to be quiet
    if (quiet(lv)) {
      const say = sleeper ? null : sourceSay(s).machine, silent = L("trust_silent", { name: srcName(s), t: age(srcAge(s)) });
      problems.push(sleeper ? L("trust_asleep", { name: srcName(s), t: hm(sleeper.asleep) }) : say ? L("src_say_join", { src: silent, machine: say }) : silent);
    }
  }
  for (const s of rep) { const sk = softwareOf(s).skewShort; if (sk) skewNotes.push(sk); }
  for (const s of rep) if (s.rejected) problems.push(L("rejected_since", { name: srcName(s), t: hm(s.rejected.since), reason: s.rejected.reason }));
  // A collector whose answer is too old, failed or disabled is said here, not only in the Crow's nest (feed 1.2: collectors).
  // An old one is a note and does not make "nothing was waiting" a past fact unless the answer behind the number is the old one;
  // a failed or disabled one is a Problem, which the Bridge numeral reads as "at the last report" (board.js).
  const oldNotes = [...skewNotes];
  // A copy whose maker stopped remaking it (feed 1.12 `made_at`) is a problem, said loudly: it can look fresh while it is re-read.
  for (const f of B.staleCollectors || []) {
    // A collector that failed or is switched off leaves a surface unread: said as a Problem, so the page never says all fine over it.
    if (f.state === "error" || f.state === "disabled") problems.push(L(f.state === "error" ? "collector_failed" : "collector_disabled", { name: f.name, what: f.label }));
    else if (f.made && f.state === "old") problems.push(L(f.refreshS ? "collector_made_stale" : "collector_made_stale_n", { name: f.name, what: f.label, t: f.s != null ? age(f.s) : "?", every: dur(f.refreshS || 0) }));
    else oldNotes.push(L("collector_old", { name: f.name, what: f.label, t: f.s != null ? age(f.s) : "?" }));
  }
  // A source that stretched its own intervals says why, and how often it now reports: slower on purpose, not silent and not
  // as fresh as before (feed 1.4: pace). It comes before the old answers it explains.
  const slowNotes = (B.slowed || []).map(x => L("trust_slowed", { name: x.name, why: paceWhy(x.pace), t: dur(x.everyS || TH().default_interval_s) }));
  let line2;
  if (B.lost && !B.asleep) line2 = L("trust_all_silent", { t: age(newest) });
  else if (problems.length || slowNotes.length || oldNotes.length) {
    const all = [...problems, ...slowNotes, ...oldNotes];
    line2 = all[0] + (all.length > 1 ? " " + L("more", { n: all.length - 1 }) : "");
  } else line2 = S.server.host ? L("served_by", { host: S.server.host }) : "";
  return { live, total, resting, lamp, line1, line2, newest, problems, oldNotes, slowNotes };
}
/* The rows a log leaves out, counted in the six row words (frontdoor.js ROW_KEYS) and old records apart, never by the record's own state. */
/* What the one sort needs of a lane. */
const laneFacts = l => ({ key: rowSortKey(l), old: l.rowOld, waited: l.inState, order: l.order, started: l.started });
function rowCounts(rest) {
  const n = {};
  for (const l of rest) { const k = l.rowOld ? ROW_HOUSEKEEPING : l.rowKey; n[k] = (n[k] || 0) + 1; }
  return ROW_KEYS.concat(ROW_HOUSEKEEPING).filter(k => n[k]).map(k => L(k === ROW_HOUSEKEEPING && n[k] === 1 ? "rcount_housekeeping_one" : "rcount_" + k, { n: n[k] })).join(", ");
}
/* A lane whose source escalated an instruction left unread while its worker is idle (frontdoor.js steerNote): its row sorts with
   Stuck, on the sea's log and the Lists page alike (rowSortKey). */
const steerUp = l => !!(l && l.steer && l.steer.row && l.steer.row.escalated);
/* The row word a lane sorts under: its own, or Stuck for an escalated unread instruction whose own word comes after Stuck. */
function rowSortKey(l) {
  if (!steerUp(l)) return l.rowKey;
  const o = rowSortOrder((cfg().display || {}).row_sort), i = o.indexOf(l.rowKey), j = o.indexOf("stuck");
  return j >= 0 && (i < 0 || i > j) ? "stuck" : l.rowKey;
}
/* Which lanes get a row in the TV log: all of them in the one order the Lists page uses (B.sorted, frontdoor.js sortRows), and a
   last row counting the rest. S.logFold takes rows away when even the tightened log does not fit its zone (app.js fitLog). */
function logRows(B, g) {
  const rows = g && !g.phone ? ((S.theme.zones || {}).tv || {}).log : null;
  B.shown = B.sorted; B.more = null;
  if (!rows) return;   // the phone lists every lane in its own sections
  // The allowance chips, the tool cards and the library each take a last row.
  const cap = Math.max(2, (rows.rows_max || 6) - (cardStates().length ? 1 : 0) - ((((S.view || {}).meters || {}).chips || []).length ? 1 : 0) - (B.strip.length ? 1 : 0)
    - (B.library.length ? 1 : 0));
  const total = B.sorted.length, lanes = Math.max(1, (total <= cap ? total : cap - 1) - (S.logFold || 0));
  B.shown = B.sorted.slice(0, lanes);
  const rest = B.sorted.slice(lanes);
  if (rest.length) B.more = L("log_more", { n: rest.length, by_state: rowCounts(rest) });
}
function boardModel(g) {
  const B = { gl: globalLevel(), now: nowS() };
  B.hostdown = B.gl === "hostdown";
  B.loading = B.gl === "loading" || S.dev.screen === "loading";
  if (B.loading) {
    B.hostdown = hostDown(); B.mode = "day"; B.tod = S.dev.sky || timeOfDay(nowS()); B.screen = B.hostdown ? "hail" : "loading";
    return B;
  }
  const mode = themeMode();
  B.quiet = inQuiet(B.now);
  B.empty = B.gl === "waiting" || S.dev.screen === "empty";
  B.lost = B.gl === "lost";
  B.redacted = redacted();
  B.sample = !!S.view.sample;
  const att = attention();
  Object.assign(B, att);
  const critOn = new Set(att.critical.filter(a => a.machine && !String(a.id).startsWith("host:")).map(a => a.machine));
  B.machines = (S.view.machines || []).map(m => machineState(m, critOn.has(m.id)));
  // A machine with an alert said once is never read as healthy: its word says so until a second feed confirms or drops it.
  for (const m of B.machines) {
    const pend = (B.pending || []).filter(a => a.machine === m.id && pendingCounts(a));
    if (!pend.length) continue;
    m.unconfirmed = pend.map(a => a.id);
    if (m.key === "ok") { m.word = L("alert_unconfirmed"); m.short = L("alert_unconfirmed_short"); }
  }
  const mstate = Object.fromEntries(B.machines.map(m => [m.id, m]));
  B.lanes = buildLanes(mstate);
  for (const l of B.lanes) Object.assign(l, { machineLabel: (mstate[l.machine] || {}).label || l.machine || L("unassigned") }, rowPlain(l));
  // The one order of rows, the sea's log and the Lists page alike (frontdoor.js sortRows; the order list is display.row_sort).
  B.sorted = sortRows(B.lanes, (cfg().display || {}).row_sort, laneFacts);
  // Becalmed: work runs on a machine, and every running lane there says its activity went quiet (items[].progress.current
  // .activity). The words say for how long nothing has stirred; the ship's sails go slack.
  for (const m of B.machines) {
    const run = B.lanes.filter(l => l.machine === m.id && !l.stale && ["moving", "long", "regressed"].includes(l.kind));
    if (!run.length || run.some(l => l.quiet == null)) continue;
    const ages = run.map(l => l.quiet).filter(a => a >= 0);
    m.becalmed = { s: ages.length ? Math.min(...ages) : null, lanes: run.map(l => l.id) };
    if (m.key === "ok" && !m.unconfirmed) { m.word = L("becalmed", { t: m.becalmed.s != null ? age(m.becalmed.s) : "" }).trim(); m.short = L("becalmed_short"); }
  }
  B.fleet = buildFleet(B);
  // Every list of machines follows the fleet's fixed order (the flagship first): the bar's pips, the panel, the Crow's nest.
  B.machines.sort((a, b) => B.fleet.order.indexOf(a.id) - B.fleet.order.indexOf(b.id));
  // The five classes (docs/feed-spec.md): off course is needs_action plus running_long; waiting is counted apart, calmly.
  // Off course keeps its alarm order first; every other list is grouped by project, then machine (the host's row.order).
  // An old record (frontdoor.js isOldRecord) is in none of the live lists below, whatever its class: it is listed under Housekeeping
  // (B.oldRecords, in the one order) and counted in none of the numbers.
  B.off = B.sorted.filter(offCourse);
  B.oldRecords = B.sorted.filter(l => l.rowOld);
  const live = B.lanes.filter(l => !l.rowOld);
  B.underway = live.filter(l => l.cls === "ok" && (l.kind === "moving" || l.kind === "regressed")).sort((a, b) => byProject(a, b) || a.started - b.started);
  B.scouts = live.filter(l => l.cls === "ok" && l.kind === "scout").sort((a, b) => byProject(a, b) || a.started - b.started);
  B.waiting = live.filter(l => l.cls === "waiting").sort((a, b) => byProject(a, b) || a.started - b.started);
  B.quietLanes = live.filter(l => l.cls === "quiet").sort((a, b) => byProject(a, b) || a.started - b.started);
  // The oldest wait: the lane longest in a held class (waiting, or needs action), counted on the page's clock.
  B.oldest = live.filter(l => (l.cls === "waiting" || l.cls === "needs_action") && l.inState != null).sort((a, b) => b.inState - a.inState)[0] || null;
  B.waitingLanes = live.filter(l => l.kind === "call" || l.kind === "approval");
  B.prLanes = B.lanes.filter(l => l.kind === "pr_open" || l.kind === "pr_unread");
  Object.assign(B, blackHoles(B));
  B.aside = asideModel(B);
  B.software = reporting().map(softwareOf);
  B.strip = stripChips(B);
  B.library = libraryRows();
  logRows(B, g);
  // Every reporting source belongs to a machine that is asleep: the lost-contact takeover says so calmly.
  const rep = reporting(), sleepers = B.machines.filter(m => m.asleep);
  B.asleep = B.lost && sleepers.length && rep.every(s => sleepers.some(m => m.id === s.machine))
    ? { names: sleepers.map(m => m.label).join(", "), since: Math.max(...sleepers.map(m => m.asleep)) } : null;
  B.trust = trustLine(B);
  // A reporting source whose waiting number cannot be verified sends none: the board says "unverified" and why,
  // never a number from another path (feed-spec, `waiting`). `note` is the id of the card that says the same, if the source named one.
  B.unverified = rep.filter(s => s.waiting && s.waiting.verified === false)
    .map(s => ({ id: s.id, name: ((B.machines.find(m => m.id === s.machine) || {}).label) || srcName(s), reason: s.waiting.reason || "",
      note: s.waiting.note || null }));
  // Landed: a rolling 24 hours by default, or since the configured day start (the host says which: history.landed).
  const hist = S.view.history || {}, win = hist.landed || null;
  const since = win ? win.since : null, today = dayKey(B.now);
  B.doneToday = (S.view.done || []).filter(d => (since != null ? epoch(d.at) >= since : dayKey(epoch(d.at)) === today));
  B.landedWindow = win;
  B.score = { n: win ? win.n : hist.done_today || 0, latest: (S.view.done || [])[0] || null };
  B.since = glanceNow(B.now, B.lanes);
  B.next = S.view.next || [];
  B.horizon = horizonOf(B.next, B.now, !!g && g.phone);
  // The anchor: quiet hours, nothing waiting, no critical, the host answers, a source is live, the TV.
  if (B.askCards.length || B.critical.length) S.lastCallAt = B.now;
  const settle = ((S.theme.components || {}).anchor || {}).settle_s ?? 120;
  const settled = S.lastCallAt == null || B.now - S.lastCallAt >= settle;
  B.anchor = !!g && !g.phone && (!S.route || S.route.level === "sea") && !B.empty && !B.hostdown && !B.lost && !B.askCards.length && !B.critical.length && !B.unverified.length && B.trust.live > 0 &&
    ((B.quiet && mode !== "day" && settled) || S.dev.sleep);
  B.mode = B.anchor ? "sleep" : mode === "night" || (mode !== "day" && B.quiet) ? "night" : "day";
  B.tod = B.anchor ? "anchor" : S.dev.sky || (B.mode === "night" && mode === "night" && !B.quiet ? "night" : timeOfDay(B.now));
  B.screen = B.empty ? "empty" : B.anchor ? "anchor" : B.hostdown ? "hail" : B.lost ? "lost" : "board";
  // The open sea (TV, a theme with a scene and an open zone set): nothing waits on the viewer, so the call plate is one
  // banner line and the scene has the whole upper area. A call, an unverified number, or any screen but the board's
  // brings the panel back.
  B.open = !!g && !g.phone && !!S.theme.scene && !!(((S.theme.zones || {}).tv || {}).open) && B.screen === "board" &&
    !B.askCards.length && !B.unverified.length;
  return B;
}
