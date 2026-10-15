"""Contract tests for the front door (web/frontdoor.js), added under the owner's narrow exception for pure core logic
(CONTRIBUTING.md): which screen a route shows, what a ship plate's badge counts, what the trust line counts, how a
supervision alarm is worded, what a lane's row says (one of six words and one sentence) with a title that reads, and in what
order the rows go on the sea and on the Lists page (one sort for both).
Synthetic routes, ids, cards and sources, standard library only, no network. The file is plain JavaScript; its tests run it in Node when Node is installed, and are skipped
otherwise."""
import calendar
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import lanes, schema  # noqa: E402

NODE = shutil.which("node")
# A name that is no function is read as a value. "@len" stands for a measure that counts characters (the page measures with its loaded face).
HARNESS = r"""
const s = require(process.argv[1]);
const out = {};
for (const [k, f] of Object.entries(JSON.parse(process.argv[2])))
  out[k] = typeof s[f.fn] === "function" ? s[f.fn](...f.args.map(a => (a === "@len" ? (t => t.length) : a))) : s[f.fn];
process.stdout.write(JSON.stringify(out));
"""
TV = {"phone": False, "tv": False, "screen": "board", "loading": False}


class InNode:
    def run_js(self, calls):
        out = subprocess.run([NODE, "-e", HARNESS, str(ROOT / "web" / "frontdoor.js"), json.dumps(calls)],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)


@unittest.skipUnless(NODE, "Node is not installed: the front-door rule is not run")
class FrontDoor(InNode, unittest.TestCase):

    def page_on(self, path, **opts):
        r = self.run_js({"r": {"fn": "parseRoute", "args": [path]}})["r"]
        return self.run_js({"on": {"fn": "pageBoardOn", "args": [r, dict(TV, **opts)]}})["on"]

    def test_routes_round_trip_and_the_board_is_a_view_of_the_sea(self):
        paths = ["/sea", "/board", "/ship/alder", "/ship/alder/deck/bridge", "/ship/alder/deck/gun-deck/item/lane%2F7"]
        r = self.run_js({p: {"fn": "parseRoute", "args": [p]} for p in paths})
        self.assertEqual(r["/sea"], {"level": "sea"})
        self.assertEqual(r["/board"], {"level": "sea", "board": True})
        self.assertEqual(r["/ship/alder/deck/gun-deck/item/lane%2F7"]["key"], "lane/7")
        back = self.run_js({p: {"fn": "routePath", "args": [r[p]]} for p in paths})
        self.assertEqual(back, {p: p for p in paths})

    def test_no_route_or_an_unknown_one_is_the_open_sea(self):
        r = self.run_js({k: {"fn": "parseRoute", "args": [k]} for k in ["", "/", "/nowhere", "/ship", "/boards"]})
        self.assertEqual(set(json.dumps(v) for v in r.values()), {json.dumps({"level": "sea"})})
        self.assertEqual(self.run_js({"x": {"fn": "routePath", "args": [None]}})["x"], "/sea")

    def test_up_from_the_board_is_the_open_sea(self):
        r = self.run_js({"board": {"fn": "parentRoute", "args": [{"level": "sea", "board": True}]},
                         "plan": {"fn": "parentRoute", "args": [{"level": "ship", "ship": "alder"}]},
                         "deck": {"fn": "parentRoute", "args": [{"level": "deck", "ship": "alder", "deck": "bridge"}]}})
        self.assertEqual(r["board"], {"level": "sea"})
        self.assertEqual(r["plan"], {"level": "sea"})
        self.assertEqual(r["deck"], {"level": "ship", "ship": "alder"})

    def test_on_a_tv_sized_screen_the_sea_is_the_front_door_and_the_board_is_opened(self):
        self.assertFalse(self.page_on("/sea"))
        self.assertFalse(self.page_on(""))
        self.assertTrue(self.page_on("/board"))
        self.assertFalse(self.page_on("/ship/alder"))

    def test_a_phone_keeps_the_page_board_at_the_sea(self):
        self.assertTrue(self.page_on("/sea", phone=True))
        self.assertTrue(self.page_on("/board", phone=True))
        self.assertFalse(self.page_on("/ship/alder/deck/bridge", phone=True))

    def test_the_television_profile_never_shows_the_board(self):
        for path in ["/sea", "/board", ""]:
            self.assertFalse(self.page_on(path, tv=True))
            self.assertFalse(self.page_on(path, tv=True, phone=True))

    def test_take_over_screens_keep_the_stage(self):
        for screen in ["anchor", "empty", "lost", "host"]:
            self.assertFalse(self.page_on("/board", screen=screen))
            self.assertFalse(self.page_on("/sea", phone=True, screen=screen))
        self.assertFalse(self.page_on("/board", loading=True))

    def test_badge_counts_only_what_the_view_lists_on_that_machine(self):
        data = {
            "sources": [{"id": "s1", "machine": "alder"}, {"id": "s2", "machine": "birch"}],
            "calls": [{"id": "c1", "machine": "alder", "source": "s1"}, {"id": "c2", "machine": None, "source": "s1"},
                      {"id": "c3", "machine": "birch", "source": "s1"}, {"id": "c4", "source": "gone"}],
            "critical": [{"id": "k1", "machine": "birch", "source": "s2"}],
            "off": [{"id": "l1", "machine": "alder"}, {"id": "l2", "machine": "birch"}, {"id": "l3", "machine": ""}],
        }
        r = self.run_js({m: {"fn": "badgeCounts", "args": [m, data]} for m in ["alder", "birch", "cedar"]})
        self.assertEqual(r["alder"], {"calls": 2, "trouble": 1})      # its own call, and one from its source naming no machine
        self.assertEqual(r["birch"], {"calls": 1, "trouble": 2})      # the card's own machine wins over its source's
        self.assertEqual(r["cedar"], {"calls": 0, "trouble": 0})      # nothing is guessed for a ship with nothing listed
        # A card naming neither a machine nor a known source is on no plate: the plates never add up to more than the card.
        self.assertLessEqual(sum(v["calls"] for v in r.values()), len(data["calls"]))
        self.assertEqual(sum(v["calls"] for v in r.values()), 3)

    def test_badge_of_an_empty_view_is_zero(self):
        r = self.run_js({"x": {"fn": "badgeCounts", "args": ["alder", {}]}})
        self.assertEqual(r["x"], {"calls": 0, "trouble": 0})

    def test_a_placeholder_is_no_failing_feed_in_the_trust_line_count(self):
        rows = [{"placeholder": False, "level": "live", "restingQuiet": False},
                {"placeholder": False, "level": "live", "restingQuiet": False},
                {"placeholder": False, "level": "stale", "restingQuiet": False},
                {"placeholder": False, "level": "lost", "restingQuiet": False},
                {"placeholder": True, "level": "absent", "restingQuiet": False}]
        r = self.run_js({"with": {"fn": "trustCounts", "args": [rows]}, "without": {"fn": "trustCounts", "args": [rows[:-1]]}})
        self.assertEqual(r["with"], {"live": 2, "total": 4, "resting": 0})      # 2 of 4, not 2 of 5
        self.assertEqual(r["with"], r["without"])
        # A real source going silent still counts against the total: nothing is hidden.
        silent = self.run_js({"x": {"fn": "trustCounts", "args": [[{"placeholder": False, "level": "lost"}, {"placeholder": True}]]}})["x"]
        self.assertEqual(silent, {"live": 0, "total": 1, "resting": 0})

    def test_a_placeholder_that_reports_is_counted_like_any_source(self):
        # Once the host has seen it, the view no longer marks it a placeholder.
        r = self.run_js({"x": {"fn": "trustCounts", "args": [[{"placeholder": False, "level": "live"}, {"placeholder": False, "level": "late"}]]}})
        self.assertEqual(r["x"], {"live": 1, "total": 2, "resting": 0})

    def test_trust_counts_keep_resting_apart_and_an_empty_view_is_zero(self):
        rows = [{"level": "live"}, {"level": "stale", "restingQuiet": True}, {"placeholder": True}]
        r = self.run_js({"a": {"fn": "trustCounts", "args": [rows]}, "b": {"fn": "trustCounts", "args": [[]]}, "c": {"fn": "trustCounts", "args": [None]}})
        self.assertEqual(r["a"], {"live": 1, "total": 1, "resting": 1})
        self.assertEqual(r["b"], {"live": 0, "total": 0, "resting": 0})
        self.assertEqual(r["c"], r["b"])

    def test_a_supervision_alarm_names_its_home_and_its_age_and_is_critical_only_on_an_old_unacknowledged_wake(self):
        labels = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text())["labels"]
        words = {k: labels[k] for k in self.run_js({"k": {"fn": "supervisionLabels", "args": []}})["k"]}
        card = {"id": "service:supervision:cinder", "kind": "service", "severity": "critical", "title": "supervision is not beating",
                "detail": "heartbeat 400s old", "since": None, "machine": "borealis", "item": None, "link": None,
                "how": "restart supervision on this home", "options": [], "source": "cinder"}
        cases = {   # name: (card, supervisor object)
            "bare": (card, None),                                                       # no supervisor object: never critical
            "fresh": (dict(card, detail="heartbeat 38s old"), None),                    # the down marker alone, a fresh beat
            "missing": (dict(card, detail="heartbeat missing"), None),
            "under": (dict(card, detail="heartbeat 1799s old"), None),            # just under the stale limit: still FYI
            "stale": (dict(card, detail="heartbeat 1800s old"), None),            # at the stale limit: critical
            "stopped": (card, {"watcher": "down", "oldest_unacked_wake_age_s": 420, "busy": False}),
            "watched": (card, {"watcher": "running", "oldest_unacked_wake_age_s": 900, "busy": False}),
            "young": (card, {"watcher": "down", "oldest_unacked_wake_age_s": 120, "busy": False}),
            "busy": (card, {"watcher": "down", "oldest_unacked_wake_age_s": 120, "busy": True}),
            "other": (dict(card, id="service:pipeline:cinder", title="pipeline daemon is down"), None),
        }
        r = self.run_js({k: {"fn": "supervisionAlarm", "args": [c, "cinder", words, 300, sup, 1800]} for k, (c, sup) in cases.items()})
        self.assertEqual(r["bare"]["title"], "cinder's supervisor hasn't checked in for 6 min")
        self.assertIn("not reported", r["bare"]["note"])        # busy or stopped is not guessed
        self.assertIn("not reported", r["missing"]["title"])    # no age in the feed: none is invented
        self.assertIn("not reported", r["under"]["note"])
        self.assertEqual(r["stale"]["title"], "cinder's supervisor hasn't checked in for 30 min (no busy marker reported)")
        self.assertEqual(r["stale"]["severity"], "critical")
        for k in ("bare", "fresh", "missing", "under", "watched", "young", "busy"):
            self.assertNotEqual(r[k]["severity"], "critical", k)
        self.assertEqual(r["stopped"]["severity"], "critical")
        self.assertIn("7 min", r["stopped"]["title"])
        self.assertIn("busy in a long turn", r["busy"]["title"])
        for k in cases.keys() - {"other"}:
            self.assertNotIn("this home", json.dumps(r[k]))
            self.assertIn("cinder", r[k]["title"])
        self.assertIsNone(r["other"])

NOW = calendar.timegm((2026, 3, 2, 12, 0, 0))
PR = "https://example.invalid/atlas/survey/pull/"
# Synthetic feed items, one per case, in the shapes a pusher sends: "lane" is the source's own lane word (feed 1.5, the host's
# source_lane); items without it are an older pusher's, read from their structured fields only. `row` is the row word expected.
ITEMS = [
    # An older pusher's failed record whose only evidence is the books' own "replaced" text: Can't tell, never failed.
    {"id": "cin-hud-move", "state": "failed", "title": "move the cinder hud checks and the borealis legs of touch-tracking (two rigs…",
     "summary": "run failed · status-log superseded (run failed)", "doing": "run failed · status-log superseded (run failed)",
     "last_event": {"state": "failed", "text": "run failed", "at": "2026-02-25T15:58:25Z"}, "row": "unk"},
    # Its run died while its own records say it was waiting (last event paused): Waiting on someone else, never failed.
    {"id": "cin-gates-one", "state": "failed", "title": "move the borealis gate runner and the cinder legs of touch-possession…",
     "summary": "run failed · status-log superseded (run failed)", "last_event": {"state": "paused", "text": "parked at a gate", "at": "2026-02-25T15:58:25Z"},
     "row": "other", "why": "died_waiting"},
    # Its worker's session ended while it was paused at a gate: a wait that went quiet, not a failure.
    {"id": "cin-followups", "state": "paused", "waiting_on": "gate", "title": "Results followups",
     "agent": {"state": "ended", "since": "2026-02-28T09:13:06Z"}, "row": "other", "why": "gone_waiting"},
    # A worker gone with nothing held: Stuck.
    {"id": "cin-orphan", "state": "running", "title": "Rebuild the atlas tile cache", "agent": {"state": "gone", "since": "2026-03-01T09:00:00Z"},
     "row": "stuck", "why": "gone_pane"},
    {"id": "cin-lieutenants", "state": "blocked", "title": "Lieutenants L1 with gambits (four condition-action slots per…",
     "summary": "harness state unavailable (unknown missing)", "row": "unk"},
    {"id": "cin-router", "state": "paused", "title": "Router B: advisory place script (built on A's facts), held…",
     "summary": "harness state unavailable (unknown missing)", "row": "unk"},
    {"id": "cin-live-fail", "state": "failed", "title": "Borealis export of the night tiles", "row": "stuck", "why": "failed"},
    {"id": "cin-block", "state": "blocked", "title": "Cinder auth rotation", "row": "stuck", "why": "blocked"},
    {"id": "cin-stances", "state": "done", "title": "Fps stances", "summary": "harness state unavailable (unknown missing)",
     "link": {"url": PR + "87", "state": "merged"}, "row": "done", "why": "done_merged"},
    {"id": "cin-lg2", "state": "paused", "title": "LG2 requisition re-queues one-off kinds (hard AI loses…", "waiting_on": "external",
     "link": {"url": PR + "6", "state": "merged"}, "agent": {"state": "ended", "since": "2026-02-27T09:13:06Z"}, "row": "done", "why": "gone_merged"},
    {"id": "cin-twin", "state": "done", "title": "hosted half-turn twin asymmetry from tick 151 (K7 twin…",
     "handoff": {"state": "awaiting_you", "since": None}, "link": {"url": PR + "15", "state": "open"}, "row": "you", "why": "approval_pr"},
    {"id": "cin-tags", "state": "done", "title": "capability tags (webgpu, webkit) so…", "handoff": {"state": "awaiting_you"},
     "link": {"url": PR + "1", "state": "merged"}, "row": "done", "why": "approval_merged"},
    {"id": "cin-advance", "state": "paused", "waiting_on": "external", "title": "Advance order", "link": {"url": PR + "17", "state": "open"},
     "row": "other", "why": "pr_open"},
    {"id": "cin-seed", "state": "waiting", "waiting_on": "gate", "title": "Public dispersion seed", "row": "other", "why": "mate_gate"},
    {"id": "cin-call", "state": "waiting", "needs_you": True, "title": "Pick the borealis map size", "row": "you", "why": "call"},
    {"id": "cin-run", "state": "running", "title": "Pathfinding benchmark on large maps", "row": "work", "why": "work"},
    {"id": "cin-untitled", "state": "running", "row": "work"},
    # A newer pusher's own lane word decides, whatever the record's state says.
    {"id": "atl-check", "state": "running", "title": "Atlas floor tests", "lane": {"state": "Waiting on a check"}, "row": "work"},
    {"id": "atl-gone", "state": "running", "title": "Atlas guard evidence", "lane": {"state": "Needs attention", "cause": "worker-gone"},
     "agent": {"state": "gone", "since": "2026-03-02T10:00:00Z"}, "row": "stuck"},
    {"id": "atl-paused", "state": "failed", "title": "Atlas warden bank", "lane": {"state": "Paused on purpose"}, "row": "other"},
    {"id": "atl-unread", "state": "unknown", "title": "Atlas reactivity pin", "lane": {"state": "Can't tell"}, "row": "unk"},
    {"id": "atl-sup", "state": "waiting", "title": "Atlas release notes", "lane": {"state": "Waiting on atlas"}, "row": "other"},
    {"id": "atl-done", "state": "done", "title": "Atlas onboarding slice", "lane": {"state": "Finished"}, "row": "done"},
]
SIX = ["Waiting on you", "Stuck", "Can't tell", "Working", "Waiting on someone else", "Finished"]
RAW = ["run failed", "superseded", "harness", "unknown missing"]
OLD_WHY = ["unread", "approval_merged", "approval_closed", "gone_merged"]     # frontdoor.js OLD_RECORDS


def facts(it):
    """What the page hands rowState (web/page.js rowPlain), from the host's own lane kind."""
    lane = lanes.classify(it, now=NOW)
    link = it.get("link") or {}
    return {"kind": lane["kind"], "laneWord": (it.get("lane") or {}).get("state"), "pr": link.get("state") if "/pull/" in link.get("url", "") else None,
            "state": it.get("state"), "lastState": (it.get("last_event") or {}).get("state"), "waitingOn": lane["waiting_on"] or it.get("waiting_on"),
            "agent": (it.get("agent") or {}).get("state"), "texts": [it.get("doing"), it.get("state_detail"), it.get("summary")]}


@unittest.skipUnless(NODE, "Node is not installed: the row rule is not run")
class PlainRows(InNode, unittest.TestCase):
    """Readability slices 4 and 5: every row says one of six words and one sentence with nothing raw in it; titles read."""

    def setUp(self):
        self.labels = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text())["labels"]

    def sentence(self, why):
        out = []
        pre = "hk_" if why in OLD_WHY else "rs_"     # an old record says its Housekeeping reason (page.js rowSentence)
        for k in [pre + why, pre + why + "_d", pre + why + "_never"]:
            if k in self.labels:
                was = self.labels["rs_was_failed"]
                out.append(self.labels[k].format(pr="#41", who="the supervisor", gone="2 d", ago="5 d", was=was, detail="Building", t="14:00"))
        return out

    def test_every_row_says_one_of_six_words_and_one_plain_sentence(self):
        r = self.run_js({it["id"]: {"fn": "rowState", "args": [facts(it)]} for it in ITEMS})
        for it in ITEMS:
            got = r[it["id"]]
            self.assertEqual(got["key"], it["row"], it["id"])
            if "why" in it:
                self.assertEqual(got["why"], it["why"], it["id"])
            self.assertIn(self.labels["row_" + got["key"]], SIX)
            said = self.sentence(got["why"])
            self.assertTrue(said, "no sentence for " + got["why"])
            for text in said:
                self.assertNotIn("{", text)
                self.assertFalse([w for w in RAW if w in text.lower()], text)
                self.assertFalse(re.search(r"\b(atl|cin)-", text), text)   # never a task id
        # The closed set is exactly the six words, in order, and none of them reads FAILED.
        keys = self.run_js({"k": {"fn": "ROW_KEYS", "args": []}})["k"]
        self.assertEqual([self.labels["row_" + k] for k in keys], SIX)

    def test_the_words_a_newer_feed_is_worded_in_carry_nothing_raw(self):
        for k, v in self.labels.items():
            if k.startswith(("ls_", "lane_cause_", "rs_", "hk_", "row_", "rcount_")):
                self.assertFalse([w for w in RAW if w in v.lower()], k)

    def test_titles_cut_at_a_whole_word_with_no_open_bracket_and_never_to_one_word(self):
        titles = {it["id"]: it.get("title") for it in ITEMS}
        calls = {}
        for i, (room, chip) in enumerate([(0, 0), (30, 16), (40, 16), (60, 16), (22, 16), (12, 0)]):
            for k, t in titles.items():
                calls[f"{k}@{i}"] = {"fn": "fitTitle", "args": [t, room, chip, "@len"]}
        r = self.run_js(calls)
        for key, got in r.items():
            title = titles[key.split("@")[0]]
            if not title:
                self.assertIsNone(got["text"], key)      # the page says "title not reported", never the id
                continue
            text = got["text"]
            whole = title.rstrip("…").split()[:-1] if title.endswith("…") else title.split()
            words = text.rstrip("…").split()
            self.assertGreaterEqual(len(words), min(2, len(whole)), key)
            self.assertEqual(text.count("(") - text.count(")"), 0, key)
            for w in words[:-1]:
                self.assertIn(w, whole, key)
            self.assertIn(words[-1].rstrip(",;:.-"), [x.rstrip(",;:.-") for x in whole], key)
        # The narrow column of the stale record: one word beside the chip, so the chip gives way and three words show.
        move = r["cin-hud-move@4"]
        self.assertFalse(move["chip"])
        self.assertGreaterEqual(len(move["text"].rstrip("…").split()), 3)
        self.assertEqual(r["cin-hud-move@3"]["chip"], True)
        # A title the source cut inside a word loses that partial word; a short title is never marked cut.
        self.assertEqual(r["cin-tags@0"]["text"], "capability tags (webgpu, webkit)…")
        self.assertEqual(r["cin-advance@0"]["text"], "Advance order")
        self.assertEqual(r["cin-twin@0"]["text"], "hosted half-turn twin asymmetry from tick 151…")

# The page scripts up to page.js in one context with the few browser globals they touch at load (the pattern of test_waitnote.py):
# each lane's Lanes deck row (decks.js laneRow) beside the row word the sea and the page board give it (page.js rowPlain).
DECK = r"""
const vm = require("vm"), fs = require("fs");
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const ctx = vm.createContext({ performance: { now: () => 0 }, document: stub, window: stub, navigator: stub, addEventListener: stub, location: stub, console, Date, Math, JSON, Intl });
for (const f of ["theme.js", "frontdoor.js", "model.js", "board.js", "decks.js", "page.js"]) vm.runInContext(fs.readFileSync(process.argv[1] + "/web/" + f, "utf8"), ctx, { filename: f });
vm.runInContext(`globalThis.run = (view, labels) => {
  S.view = view; S.theme = { components: {}, zones: {} }; S.server = { config: { labels, theme: {}, display: {}, thresholds: {}, poll: {}, sound: {} } };
  return lanesOf(boardModel(null), { flagship: true }).map(laneRow).map(r => ({ key: r.key, word: r.word, sub: r.sub, title: r.title, sea: r.l.rowWord, kind: r.l.kind }));
};`, ctx);
process.stdout.write(JSON.stringify(ctx.run(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]))));
"""


@unittest.skipUnless(NODE, "Node is not installed: the page scripts are not run")
class LanesDeck(unittest.TestCase):
    def test_the_lanes_deck_row_of_the_stale_failed_record_reads_as_the_sea_does(self):
        it = {k: v for k, v in ITEMS[0].items() if k != "row"}
        it.update(source="src-a", machine="m1")
        untitled = {k: v for k, v in ITEMS[16].items() if k != "row"}
        untitled.update(source="src-a", machine="m1")
        view = {"now": 0, "sources": [{"id": "src-a", "label": "src-a", "machine": "m1", "received_at": 0, "generated_at": "1970-01-01T00:00:00Z",
                                       "freshness": []}], "machines": [{"id": "m1", "label": "Alpha"}], "attention": [], "items": [it, untitled]}
        labels = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text())["labels"]
        out = subprocess.run([NODE, "-e", DECK, str(ROOT), json.dumps(view), json.dumps(labels)], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = {r["key"]: r for r in json.loads(out.stdout)}
        row = rows["cin-hud-move"]
        self.assertGreaterEqual(len(row["title"].rstrip("…").split()), 3)
        self.assertEqual(rows["cin-untitled"]["title"], labels["title_not_reported"])
        self.assertEqual(row["kind"], "failed")
        self.assertEqual(row["word"], labels["row_unk"])
        self.assertEqual(row["word"], row["sea"])
        text = (row["word"] + " " + (row["sub"] or "")).lower()
        self.assertFalse([w for w in RAW if w in text], text)
        self.assertNotIn("failed", text)


# The page scripts as above, on a clock held at `now`: each lane's unread-instruction note (page.js steerOf), its Lanes deck row,
# its opened row's look lines (decks.js itemModel) and the Lists page's row order (page.js listsPlan).
STEER = r"""
const vm = require("vm"), fs = require("fs");
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const ctx = vm.createContext({ performance: { now: () => 0 }, document: stub, window: stub, navigator: stub, addEventListener: stub, location: stub, console, Date, Math, JSON, Intl,
  fetch: () => new Promise(() => {}), render: () => {} });   // the opened row asks for its history; no answer comes
for (const f of ["theme.js", "frontdoor.js", "model.js", "board.js", "decks.js", "page.js"]) vm.runInContext(fs.readFileSync(process.argv[1] + "/web/" + f, "utf8"), ctx, { filename: f });
vm.runInContext(`globalThis.run = (view, labels, now) => {
  S.view = view; S.theme = { components: {}, zones: {} }; S.server = { config: { labels, theme: {}, display: {}, thresholds: {}, poll: {}, sound: {} } };
  S.srv0 = now; S.p0 = 0; S.clockHeld = true;
  const B = boardModel(null), ship = { flagship: true }, rows = lanesOf(B, ship).map(laneRow);
  return { lanes: Object.fromEntries(B.lanes.map(l => [l.id, { row: l.steer.row, word: l.rowWord, sentence: l.sentence,
      sub: rows.find(r => r.key === l.id).sub, note: rows.find(r => r.key === l.id).note, look: itemModel({ deck: "gun-deck", key: l.id }, B, ship).look }])),
    order: listOrder(B), deck: rows.map(r => r.key),
    noteInk: noteInk(rows.find(r => r.key === "atl-idle")) };
};
// The Lists page's rows in the order it lists them (page.js listsPlan).
const listOrder = B => {
  const views = B.sorted.map(laneView), ids = rs => rs.map(v => v.id);
  return listsPlan(views, pageGroups(B, views)).flatMap(p => p.kind === "cards" ? p.groups.flatMap(g => ids(g.rows)) : p.kind === "lines" ? [] : ids(p.rows));
};
// The classes of the Lanes deck row's element that carries its note, drawn with h as a plain tree.
const noteInk = row => {
  S.theme.glyphSet = { glyphs: { silent: ["#"] } };   // the glyph is art (on the stub canvas); only the words are looked at
  h = (tag, attrs, ...kids) => ({ cls: (attrs || {}).class || "", text: kids.filter(k => typeof k === "string").join(""), kids: kids.flat().filter(k => k && typeof k === "object") });
  const all = n => [n, ...n.kids.flatMap(all)];
  return all(deckRowEl({ deck: "gun-deck", ship: "m1" }, row, { phone: false })).filter(n => n.text === row.note).map(n => n.cls);
};`, ctx);
process.stdout.write(JSON.stringify(ctx.run(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]), Number(process.argv[4]))));
"""


@unittest.skipUnless(NODE, "Node is not installed: the page scripts are not run")
class UnreadInstruction(unittest.TestCase):
    """Readability slice 12, the page half: an idle lane with an instruction left unread says so in amber; a source that does not
    report its steering inbox says "not reported" in the opened row only, never 0 and never on a row."""

    def test_an_idle_lane_with_an_unread_instruction_says_so_and_a_source_without_the_field_says_not_reported(self):
        ago = lambda m: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - 60 * m))
        steer = lambda m, **kw: dict({"n": 1, "oldest_at": ago(m), "rings": 2, "escalated": False}, **kw)
        feeds = {   # source id: its lanes (feed items, the proposed fields on the source's own lane word)
            "atlas": [
                {"id": "atl-idle", "state": "waiting", "waiting_on": "gate", "title": "Atlas tile index",
                 "lane": {"state": "Waiting on atlas", "since": ago(30), "unread_steer": steer(25), "idle": True}},
                {"id": "atl-busy", "state": "running", "title": "Atlas legend fonts",
                 "lane": {"state": "Working", "since": ago(30), "unread_steer": steer(25), "idle": False}},
                {"id": "atl-none", "state": "running", "title": "Atlas scale bar",
                 "lane": {"state": "Working", "since": ago(30), "unread_steer": None, "idle": True}},
                {"id": "atl-bell", "state": "running", "title": "Atlas print sheet",
                 "lane": {"state": "Working", "since": ago(30), "undelivered_steer": {"n": 2, "oldest_at": ago(12)}}},
                {"id": "atl-escalated", "state": "running", "title": "Atlas contour pass",
                 "lane": {"state": "Working", "since": ago(30), "unread_steer": steer(40, escalated=True), "idle": True}},
            ],
            "borealis": [
                {"id": "bor-plain", "state": "running", "title": "Borealis night tiles", "lane": {"state": "Working", "since": ago(30)}},
                {"id": "bor-old", "state": "running", "title": "Borealis ridge shading"},   # an older pusher: no lane word at all
            ],
        }
        items = []
        for sid, its in feeds.items():
            clean, warn = schema.validate({"schema": "lookout.feed", "schema_version": "1.11", "source": {"id": sid, "machine": "m1"}, "items": its})
            self.assertEqual(warn, [], sid)
            for it in clean["items"]:   # what the host's view makes of an item (src/weatherdeck/view.py)
                it.update(source=sid, owner=sid, machine="m1")
                it["source_lane"] = it.get("lane")
                it["lane"] = lanes.classify(it, now=NOW)
                items.append(it)
        src = lambda sid: {"id": sid, "label": sid, "machine": "m1", "received_at": NOW, "generated_at": ago(0), "freshness": []}
        view = {"now": NOW, "sources": [src("atlas"), src("borealis")], "machines": [{"id": "m1", "label": "Cinder"}], "attention": [], "items": items}
        labels = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text())["labels"]
        out = subprocess.run([NODE, "-e", STEER, str(ROOT), json.dumps(view), json.dumps(labels), str(NOW)], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        r = json.loads(out.stdout)
        L = r["lanes"]
        detail = lambda k: dict(L[k]["look"]).get(labels["steer_head"])
        line = "An instruction from atlas has sat unread for 25 min"
        # The idle lane: the amber line on its row (the sea, the page board and the Lanes deck share it), and its count in the opened row.
        self.assertEqual(L["atl-idle"]["row"], {"text": line, "short": "Unread 25 min (1 from atlas)", "escalated": False})
        # On the Lanes deck the line is its own amber line (the needs ink), not the grey sub text.
        self.assertEqual(L["atl-idle"]["note"], line)
        self.assertNotIn(line, L["atl-idle"]["sub"] or "")
        self.assertEqual(len(r["noteInk"]), 1)
        self.assertIn("c-needs", r["noteInk"][0].split())
        self.assertIn("1 unread, the oldest for 25 min", detail("atl-idle"))
        # A busy worker reads its inbox when its turn ends: no row line, the count only when opened.
        self.assertIsNone(L["atl-busy"]["row"])
        self.assertIn("busy", detail("atl-busy"))
        self.assertIsNone(L["atl-none"]["row"])
        self.assertEqual(detail("atl-none"), labels["steer_none"])
        # An instruction whose doorbell never reached the worker says so, whatever the worker is doing.
        self.assertEqual(L["atl-bell"]["row"]["text"], "2 instructions from atlas were never delivered, the oldest 12 min ago")
        # An escalated one sorts with Stuck: ahead of the working rows on the Lists page.
        self.assertTrue(L["atl-escalated"]["row"]["escalated"])
        self.assertLess(r["order"].index("atl-escalated"), r["order"].index("atl-busy"))
        # On the Lanes deck too: after the off-course lanes, before the rest of its project's lanes.
        self.assertLess(r["deck"].index("atl-escalated"), r["deck"].index("atl-busy"))
        self.assertLess(r["deck"].index("atl-escalated"), r["deck"].index("atl-none"))
        self.assertLess(r["deck"].index("atl-escalated"), r["deck"].index("atl-bell"))
        # A source that sends no such field: "not reported" in the opened row only, never 0, and nothing on the row.
        for k in ("bor-plain", "bor-old"):
            self.assertIsNone(L[k]["row"], k)
            self.assertIsNone(L[k]["note"], k)
            self.assertEqual(detail(k), labels["steer_not_reported"], k)
            on_row = " ".join(filter(None, [L[k]["word"], L[k]["sentence"], L[k]["sub"]])).lower()
            self.assertNotIn("unread", on_row, k)
            self.assertNotIn("instruction", on_row, k)
            self.assertNotRegex(detail(k), r"\b0\b", k)


# One sort for both front doors (readability slice 6): the sea's log and the Lists page, run through the page's own scripts in one context.
SORT = r"""
const vm = require("vm"), fs = require("fs");
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const ctx = vm.createContext({ performance: { now: () => 0 }, document: stub, window: stub, navigator: stub, addEventListener: stub, location: stub, console, Date, Math, JSON, Intl });
for (const f of ["theme.js", "frontdoor.js", "model.js", "board.js", "decks.js", "page.js"]) vm.runInContext(fs.readFileSync(process.argv[1] + "/web/" + f, "utf8"), ctx, { filename: f });
vm.runInContext(`globalThis.run = (view, labels, display, now, rowsMax) => {
  S.srv0 = now; S.p0 = 0; S.view = view; S.theme = { components: {}, zones: { tv: { log: { rows_max: rowsMax || 14 } } } };
  S.server = { config: { labels, theme: {}, display, thresholds: {}, poll: {}, sound: {} } };
  const B = boardModel({ phone: false }), views = B.sorted.map(laneView), plan = listsPlan(views, pageGroups(B, views));
  const ids = rows => rows.map(r => r.id);
  return { sea: ids(B.shown), more: B.more, off: B.off.map(l => l.id), calm: ids(B.shown.filter(l => !offCourse(l))), trouble: shipBadge(B, "m1").filter(b => b.slot === "trouble").map(b => b.n),
    gunDeck: deckCount("gun-deck", B, { id: "m1", flagship: true }).text, gunLoud: !!deckCount("gun-deck", B, { id: "m1", flagship: true }).loud, gunRows: ids(lanesOf(B, { flagship: true })), words: Object.fromEntries(B.lanes.map(l => [l.id, [l.rowKey, l.rowWord, l.ageText]])),
    lists: plan.flatMap(p => p.kind === "cards" ? p.groups.flatMap(g => ids(g.rows)) : p.kind === "lines" ? [] : ids(p.rows)), plan: plan.map(p => p.kind + ":" + p.key) };
};`, ctx);
process.stdout.write(JSON.stringify(ctx.run(...JSON.parse(process.argv[2]))));
"""


def iso(ago_s):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - ago_s))


def sort_item(iid, order, state="running", **kw):
    it = {"id": iid, "source": "src-a", "machine": "m1", "state": state, "title": "Synthetic " + iid.replace("-", " "), "row": {"order": order, "title": "Synthetic " + iid.replace("-", " ")}}
    it.update(kw)
    return it


# Three projects (atlas, borealis, cinder; row.order[0] is the project's place), in the feed's own scrambled order.
SORT_ITEMS = [
    sort_item("cinder-run", [2, 0], started_at=iso(900)),
    sort_item("atlas-done", [0, 0], state="done", lane={"state": "Finished"}, started_at=iso(9000)),
    sort_item("borealis-run", [1, 0], started_at=iso(800)),
    sort_item("atlas-gate", [0, 0], state="waiting", waiting_on="gate", started_at=iso(700)),
    # a stale record: the books' own "superseded" line, long after the live work
    sort_item("atlas-old", [0, 0], state="failed", summary="status-log superseded (run 12)", age={"since": iso(5 * 86400)}, started_at=iso(990000)),
    sort_item("atlas-run", [0, 0], started_at=iso(600)),
    sort_item("borealis-blocked", [1, 0], state="blocked", started_at=iso(500)),               # stuck, no age
    sort_item("cinder-failed", [2, 0], state="failed", age={"since": iso(5 * 3600)}, started_at=iso(400)),   # stuck, 5 h
    sort_item("atlas-unread", [0, 0], state="unknown", lane={"state": "Can't tell"}, started_at=iso(300)),
    sort_item("borealis-call-new", [1, 0], state="waiting", needs_you=True, age={"since": iso(600)}, started_at=iso(200)),
    sort_item("cinder-call-old", [2, 0], state="waiting", needs_you=True, age={"since": iso(3 * 3600)}, started_at=iso(100)),
    sort_item("atlas-stuck-short", [0, 0], state="failed", age={"since": iso(1800)}, started_at=iso(50)),
]


@unittest.skipUnless(NODE, "Node is not installed: the page scripts are not run")
class OneSort(InNode, unittest.TestCase):
    """Readability slice 6: the sea and the Lists page list the lanes in one order, from one function and one list in defaults.json."""

    @classmethod
    def setUpClass(cls):
        defaults = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text())
        cls.labels, cls.display = defaults["labels"], defaults["display"]
        view = {"now": NOW, "sources": [{"id": "src-a", "label": "src-a", "machine": "m1", "received_at": NOW, "generated_at": iso(0), "freshness": []}],
                "machines": [{"id": "m1", "label": "Alpha"}], "attention": [], "items": SORT_ITEMS}
        out = subprocess.run([NODE, "-e", SORT, str(ROOT), json.dumps([view, cls.labels, cls.display, NOW])], capture_output=True, text=True, timeout=30)
        assert out.returncode == 0, out.stderr
        cls.got = json.loads(out.stdout)
        out = subprocess.run([NODE, "-e", SORT, str(ROOT), json.dumps([view, cls.labels, cls.display, NOW, 4])], capture_output=True, text=True, timeout=30)
        assert out.returncode == 0, out.stderr
        cls.short = json.loads(out.stdout)
        view = dict(view, items=[it for it in SORT_ITEMS if it["id"] == "atlas-old"])
        out = subprocess.run([NODE, "-e", SORT, str(ROOT), json.dumps([view, cls.labels, cls.display, NOW])], capture_output=True, text=True, timeout=30)
        assert out.returncode == 0, out.stderr
        cls.only_old = json.loads(out.stdout)

    def test_the_order_list_is_in_defaults_and_names_the_six_words_then_housekeeping(self):
        keys = self.run_js({"k": {"fn": "ROW_KEYS", "args": []}})["k"]
        self.assertEqual(self.display["row_sort"], keys + ["housekeeping"])
        self.assertEqual(keys, ["you", "stuck", "unk", "work", "other", "done"])

    def test_the_sea_and_the_lists_page_list_the_same_rows_in_the_same_order(self):
        sea, lists = self.got["sea"], self.got["lists"]
        self.assertEqual(sea[:5], lists[:5])
        # Waiting on you first, the longest wait first; then Stuck, longest first, the row with no age after those with one.
        self.assertEqual(sea[:5], ["cinder-call-old", "borealis-call-new", "cinder-failed", "atlas-stuck-short", "borealis-blocked"])
        self.assertEqual(self.got["words"]["cinder-call-old"][1], self.labels["row_you"])
        self.assertFalse(self.got["words"]["borealis-blocked"][2])            # no age: it says nothing of one
        self.assertNotEqual(self.got["words"]["cinder-failed"][2], "")

    def test_the_rest_follows_the_order_and_working_goes_by_project(self):
        self.assertEqual(self.got["sea"][5:], ["atlas-unread", "atlas-run", "borealis-run", "cinder-run", "atlas-gate", "atlas-done", "atlas-old"])
        self.assertEqual(self.got["lists"], self.got["sea"])
        self.assertEqual(self.got["plan"], ["section:you", "section:stuck", "section:unk", "cards:work", "section:other", "section:done", "housekeeping:housekeeping"])
        self.assertIsNone(self.got["more"])

    def test_a_stale_record_never_sorts_above_a_live_working_row(self):
        for order in (self.got["sea"], self.got["lists"]):
            self.assertGreater(order.index("atlas-old"), max(order.index(i) for i in ("atlas-run", "borealis-run", "cinder-run")))
            self.assertEqual(order[-1], "atlas-old")
        self.assertEqual(self.got["words"]["atlas-old"][1], self.labels["row_unk"])     # it still reads Can't tell, never FAILED

    def test_an_old_record_is_drawn_calm_and_never_counted_off_course(self):
        self.assertEqual(self.got["off"], ["cinder-call-old", "borealis-call-new", "cinder-failed", "atlas-stuck-short", "borealis-blocked"])
        self.assertIn("atlas-old", self.got["calm"])
        self.assertNotIn("cinder-failed", self.got["calm"])
        self.assertEqual(self.got["trouble"], [5])
        self.assertIn(self.labels["off_course"].format(n=5), self.got["gunDeck"])
        self.assertIn("atlas-old", self.got["gunRows"])                    # still listed on the Gun deck, only not counted
        self.assertTrue(self.got["gunLoud"])
        self.assertEqual((self.only_old["off"], self.only_old["trouble"], self.only_old["gunLoud"]), ([], [], False))

    def test_the_more_line_counts_old_records_under_their_own_word(self):
        self.assertEqual(self.short["sea"], ["cinder-call-old", "borealis-call-new", "cinder-failed"])
        more = self.short["more"]
        self.assertIn(self.labels["rcount_housekeeping_one"], more)
        self.assertIn(self.labels["rcount_unk"].format(n=1), more)      # atlas-unread only; the old record is not a Can't tell

    def test_the_order_list_decides_and_a_shorter_log_counts_the_rest(self):
        rows = [{"id": "w", "key": "work", "p": 0}, {"id": "y", "key": "you", "p": 0}, {"id": "d", "key": "done", "p": 0}, {"id": "o", "key": "other", "p": 0}]
        # sortRows takes a function for the facts, so it runs from Node here, with the order list swapped for others.
        out = subprocess.run([NODE, "-e", """
const s = require(process.argv[1]), rows = JSON.parse(process.argv[2]);
const f = r => ({ key: r.key, old: false, waited: null, order: [r.p, 0], started: 0 });
process.stdout.write(JSON.stringify({ a: s.sortRows(rows, JSON.parse(process.argv[3]), f).map(r => r.id), b: s.sortRows(rows, [], f).map(r => r.id),
  c: s.sortRows(rows, ["done", "you"], f).map(r => r.id) }));
""", str(ROOT / "web" / "frontdoor.js"), json.dumps(rows), json.dumps(["done", "work", "other", "you"])], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        got = json.loads(out.stdout)
        self.assertEqual(got["a"], ["d", "w", "o", "y"])
        self.assertEqual(got["b"], ["y", "w", "o", "d"])      # no list: the six words in their order
        self.assertEqual(got["c"], ["d", "y", "w", "o"])      # a word the list leaves out sorts after the listed ones, in the feed's order


if __name__ == "__main__":
    unittest.main()
