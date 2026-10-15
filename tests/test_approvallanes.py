"""Acceptance test for approval lanes in the waiting-on-you number (readability pass, slice 2), one ask per line, and the
"sources disagree" badge.

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_waitingonyou.py (CONTRIBUTING.md, "Tests"), for the view contract
and the page's pure rule only (`web/frontdoor.js`: `askRows`, `laneAskCard`, `waitingOnYou`, `badgeCounts`, `asksAge`,
`asksDisagree`). Five fleets go in through the public `weatherdeck ingest`, each into its own temporary data directory:
- five calls and three lanes that say they wait for the viewer's OK: the lane whose PR a call links to is that call's line, the
  lane with an open PR that no call names is a sixth line with its own reason, and the lane whose PR merged is not counted; six
  on the call band, the Lists header, the Bridge door and the ship plates, and the badge lists the one difference;
- one lane that waits for the viewer's OK and no call at all: one line, and the badge;
- one call that names its lane by `item`: one line, no badge;
- one call that names another source's lane whose PR merged: the badge;
- the bundled demo feed (examples/demo/atlas-main.json), whose calls name its own waiting lanes: no badge.
Synthetic sources, machines, titles and addresses, standard library only, no network. The page rule runs in Node when Node is
installed and is skipped otherwise.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
HARNESS = r"""
const s = require(process.argv[1]);
const out = {};
for (const [k, f] of Object.entries(JSON.parse(process.argv[2]))) out[k] = s[f.fn](...f.args);
process.stdout.write(JSON.stringify(out));
"""
AT = "2027-01-15T08:00:00Z"
PR = "https://forge.invalid/cinder/pull/"
BUILD = ("import json, sys; from weatherdeck import view; v = view.build(); "
         "json.dump({k: v[k] for k in ('counts', 'attention', 'sources', 'items', 'waiting_disagree')}, sys.stdout)")
WORDS = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text(encoding="utf-8"))["labels"]


def card(cid, severity="action", kind="decision", **kw):
    return dict({"id": cid, "kind": kind, "severity": severity, "title": "Synthetic " + cid, "detail": "Why " + cid + " needs you",
                 "since": "2027-01-15T07:00:00Z"}, **kw)


def lane(lid, pr, pr_state, handoff="awaiting_you"):
    return {"id": lid, "title": "Lane " + lid, "state": "done", "handoff": {"state": handoff, "since": "2027-01-15T06:00:00Z"},
            "link": {"url": PR + str(pr), "label": "pull request", "state": pr_state}}


def feed(sid, machine, items=(), attention=()):
    return {"schema": "lookout.feed", "schema_version": "1.8", "generated_at": AT, "source": {"id": sid, "machine": machine},
            "items": list(items), "attention": list(attention)}


# atlas (keel) raises five calls: four holds about its own work and one about borealis's lane, linking that lane's PR 20. borealis
# (spar) has three lanes that say they wait for the viewer's OK: PR 20 (open, the call's), PR 21 (open, no call) and PR 19 (merged).
SIX = [
    feed("atlas", "keel", [{"id": "atlas-lane", "title": "Atlas lane", "state": "running"}],
         [card("hold:atlas/release-cinder"), card("hold:atlas/rename-cinder"), card("hold:atlas/retire-cinder"),
          card("hold:atlas/pin-cinder"), card("atlas-merge-20", link={"url": PR + "20", "label": "pull request"}),
          card("service:supervision:atlas", "critical", kind="service", detail="heartbeat 400s old"),
          card("quota:atlas", "info", kind="capacity")]),
    feed("borealis", "spar", [lane("borealis-merge", 20, "open"), lane("borealis-twin", 21, "open"), lane("borealis-old", 19, "merged")]),
]
# borealis says one lane waits for the viewer's OK, and no source raises a call.
LONE = [feed("borealis", "spar", [lane("borealis-twin", 21, "open")])]
# atlas raises a call that names borealis's lane by `item`; the lane says it waits: they agree.
AGREE = [
    feed("atlas", "keel", attention=[card("atlas-merge-20", item="borealis/borealis-merge")]),
    feed("borealis", "spar", [lane("borealis-merge", 20, "open")]),
]

# atlas raises a call that names borealis's lane by `item`; borealis says that lane's PR merged, so it no longer waits: they differ.
STALE = [
    feed("atlas", "keel", attention=[card("atlas-merge-19", item="borealis/borealis-old")]),
    feed("borealis", "spar", [lane("borealis-old", 19, "merged")]),
]
DEMO = [json.loads((ROOT / "examples" / "demo" / "atlas-main.json").read_text(encoding="utf-8"))]


def build_view(feeds):
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, WEATHERDECK_DATA=tmp, PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "src"))
        for f in feeds:
            out = subprocess.run([sys.executable, str(ROOT / "bin" / "weatherdeck"), "ingest"], input=json.dumps(f),
                                 capture_output=True, text=True, env=env, timeout=60)
            assert out.returncode == 0 and out.stdout.startswith("ok"), out.stdout + out.stderr
        out = subprocess.run([sys.executable, "-c", BUILD], capture_output=True, text=True, env=env, timeout=60)
        assert out.returncode == 0, out.stderr
        return json.loads(out.stdout)


def run_js(calls):
    out = subprocess.run([NODE, "-e", HARNESS, str(ROOT / "web" / "frontdoor.js"), json.dumps(calls)], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def page(view):
    """The page's asks over a view, as the board model builds them (web/model.js `attention`): the calls (cardTier), then the
    lanes the host marks `lane.asks_you` (laneAskCard); askRows; the number at each place; and the disagreement in words."""
    att = view["attention"]
    tiers = run_js({a["id"]: {"fn": "cardTier", "args": [a]} for a in att}) if att else {}
    calls = [a for a in att if tiers[a["id"]] == "call"]
    callers = sorted({a["source"] for a in calls})
    lanes = [it for it in view["items"] if it["lane"].get("asks_you")]
    cards = run_js({it["id"]: {"fn": "laneAskCard", "args": [it, WORDS, callers]} for it in lanes}) if lanes else {}
    asks = run_js({"asks": {"fn": "askRows", "args": [{"calls": calls, "lanes": [cards[it["id"]] for it in lanes]}]}})["asks"]
    crit = [a for a in att if tiers[a["id"]] == "alarm"]
    bridge = asks + [{"tier": tiers[a["id"]]} for a in att if tiers[a["id"]] != "call"] + [{"tier": "disagree"}]
    plate = {"asks": asks, "critical": crit, "off": [], "sources": view["sources"]}
    res = run_js({"band": {"fn": "waitingOnYou", "args": [asks]}, "bridge": {"fn": "waitingOnYou", "args": [bridge]},
                  "keel": {"fn": "badgeCounts", "args": ["keel", plate]}, "spar": {"fn": "badgeCounts", "args": ["spar", plate]},
                  "disagree": {"fn": "asksDisagree", "args": [view["waiting_disagree"], view["items"], att, WORDS, {}]}})
    res["asks"] = asks
    return res


class ApprovalLanes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.six, cls.lone, cls.agree = build_view(SIX), build_view(LONE), build_view(AGREE)
        cls.stale, cls.demo = build_view(STALE), build_view(DEMO)

    def test_the_host_counts_each_ask_once(self):
        self.assertEqual(self.six["counts"]["waiting_on_you"], 6)
        self.assertEqual(self.six["counts"]["calls"], 5)
        asks = {it["id"] for it in self.six["items"] if it["lane"].get("asks_you")}
        # The lane whose PR the call links to is that call's line; the merged PR's lane waits on nobody.
        self.assertEqual(asks, {"borealis-twin"})
        self.assertEqual(self.six["waiting_disagree"], [{"kind": "lane", "item": "borealis-twin", "item_source": "borealis", "call": None, "call_source": None}])
        self.assertEqual(self.lone["counts"]["waiting_on_you"], 1)
        self.assertEqual(self.agree["counts"]["waiting_on_you"], 1)
        self.assertEqual(self.agree["waiting_disagree"], [])

    def test_the_bundled_demo_agrees_with_itself(self):
        self.assertEqual(self.demo["waiting_disagree"], [])

    def test_a_call_whose_lane_from_another_source_does_not_wait_differs(self):
        self.assertEqual(self.stale["waiting_disagree"], [{"kind": "call", "item": "borealis-old", "item_source": "borealis",
                                                            "call": "atlas-merge-19", "call_source": "atlas"}])

    @unittest.skipUnless(NODE, "Node is not installed: the page's rule is not run")
    def test_six_lines_and_six_everywhere(self):
        res = page(self.six)
        self.assertEqual((res["band"], res["bridge"], res["keel"]["calls"] + res["spar"]["calls"]), (6, 6, 6))
        self.assertEqual((res["keel"]["calls"], res["spar"]["calls"]), (5, 1))
        # One line per ask, the calls first, each with its own reason; the lane's says no call was raised for it, and by whom.
        self.assertEqual([r["tier"] for r in res["asks"]], ["call"] * 5 + ["lane"])
        self.assertTrue(all(r["c"].get("detail") for r in res["asks"]))
        twin = res["asks"][-1]["c"]
        self.assertEqual(twin["title"], WORDS["lane_ask_title"].replace("{title}", "Lane borealis-twin"))
        self.assertEqual(twin["detail"], WORDS["lane_ask_reason"].replace("{who}", "atlas"))
        self.assertEqual(twin["link"]["url"], PR + "21")
        # The badge, and its detail lists the one difference.
        self.assertEqual(res["disagree"]["badge"], WORDS["disagree_badge"])
        self.assertEqual(res["disagree"]["lines"], [WORDS["disagree_lane"].replace("{source}", "borealis").replace("{title}", "Lane borealis-twin")])

    @unittest.skipUnless(NODE, "Node is not installed: the page's rule is not run")
    def test_a_lane_with_no_call_is_a_line_and_a_badge(self):
        res = page(self.lone)
        self.assertEqual((res["band"], res["bridge"], res["spar"]["calls"]), (1, 1, 1))
        self.assertEqual(res["asks"][0]["c"]["detail"], WORDS["lane_ask_reason_none"])
        self.assertEqual(len(res["disagree"]["lines"]), 1)

    @unittest.skipUnless(NODE, "Node is not installed: the page's rule is not run")
    def test_a_call_that_names_its_lane_is_one_line_and_no_badge(self):
        res = page(self.agree)
        self.assertEqual([r["tier"] for r in res["asks"]], ["call"])
        self.assertIsNone(res["disagree"])

    @unittest.skipUnless(NODE, "Node is not installed: the page's rule is not run")
    def test_the_number_says_how_old_it_is(self):
        srcs = self.six["sources"]
        recv = {s["id"]: s["received_at"] for s in srcs}
        asks = page(self.six)["asks"]
        now = max(recv.values()) + 120
        res = run_js({"recv": {"fn": "asksAge", "args": [asks, srcs, self.six["counts"], now]},
                      "snap": {"fn": "asksAge", "args": [asks, srcs, dict(self.six["counts"], calls_snapshot_at=now - 600), now]},
                      "none": {"fn": "asksAge", "args": [asks, [], {}, now]}})
        # The oldest report behind the number: the calls' snapshot when the view carries one, else when each feed was received.
        self.assertAlmostEqual(res["recv"], now - min(recv["atlas"], recv["borealis"]), places=3)
        self.assertAlmostEqual(res["snap"], 600, places=3)
        self.assertIsNone(res["none"])


if __name__ == "__main__":
    unittest.main()
