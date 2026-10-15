"""Contract tests for 0.4.1's pure core logic: the roadstead's slot plan (src/weatherdeck/fleet.py roadstead), and the page's
sightings (web/sightings.js: each creature kind's last sighting, and the one event a replay may play). Added under the
owner's narrow exception for pure core logic (CONTRIBUTING.md): synthetic data, standard library only, no network.
The sightings file is plain JavaScript; its tests run it in Node when Node is installed, and are skipped otherwise."""
import json
import pathlib
import shutil
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import fleet  # noqa: E402


class Roadstead(unittest.TestCase):
    def plans(self):
        for open_sea in (True, False):
            for n in range(1, 7):
                for convoy in ((False, True) if n == 6 else (False,)):
                    yield n, convoy, open_sea, fleet.roadstead(n, convoy, open_sea)

    def test_one_stretch_per_ship_flagship_first(self):
        for n, convoy, open_sea, r in self.plans():
            self.assertEqual([s["slot"] for s in r["ships"]], list(range(n)))
            self.assertEqual(r["open"], open_sea)
            self.assertEqual(r["ships"][0]["x0"], min(s["x0"] for s in r["ships"]))

    def test_inside_the_window(self):
        for n, convoy, open_sea, r in self.plans():
            for s in r["ships"]:
                self.assertTrue(0.0 <= s["x0"] < s["x1"] <= 1.0, (n, convoy, open_sea, s))

    def test_escorts_never_overlap_each_other_or_the_convoy(self):
        for n, convoy, open_sea, r in self.plans():
            spans = [(s["x0"], s["x1"]) for s in r["ships"][1:]] + ([(r["convoy"]["x0"], r["convoy"]["x1"])] if r["convoy"] else [])
            for (a0, a1), (b0, b1) in zip(spans, spans[1:]):
                self.assertLess(a1, b0, (n, convoy, open_sea, spans))
            if convoy:
                self.assertIsNotNone(r["convoy"])
            else:
                self.assertIsNone(r["convoy"])

    def test_open_sea_three_ships_or_fewer_escorts_full_scale(self):
        for n in (2, 3):
            self.assertEqual({s["scale"] for s in fleet.roadstead(n, False, True)["ships"][1:]}, {"full"})
        for n in (4, 5, 6):
            self.assertEqual({s["scale"] for s in fleet.roadstead(n, False, True)["ships"][1:]}, {"half"})

    def test_beside_a_call_escorts_half_scale(self):
        for n in range(2, 7):
            self.assertEqual({s["scale"] for s in fleet.roadstead(n, False, False)["ships"][1:]}, {"half"})

    def test_larger_stretches_on_the_open_sea(self):
        # the open sea's window is wider too; at three ships each escort's share of it is at least as large
        for n in (2, 3):
            o, c = fleet.roadstead(n, False, True)["ships"], fleet.roadstead(n, False, False)["ships"]
            for so, sc in zip(o[1:], c[1:]):
                self.assertGreaterEqual(so["x1"] - so["x0"], sc["x1"] - sc["x0"] - 1e-9)

    def test_equal_stretches_for_the_escorts(self):
        for n, convoy, open_sea, r in self.plans():
            widths = {round(s["x1"] - s["x0"], 3) for s in r["ships"][1:]}
            self.assertLessEqual(len(widths), 1, (n, convoy, open_sea, widths))

    def test_bounded_and_deterministic(self):
        self.assertEqual(len(fleet.roadstead(0)["ships"]), 1)
        self.assertEqual(len(fleet.roadstead(9)["ships"]), 6)
        self.assertEqual(fleet.roadstead(4, False, True), fleet.roadstead(4, False, True))

    def test_view_carries_both_windows(self):
        srcs = [{"id": "a", "machine": "aspen", "kind": "primary"}]
        ms = [{"id": m, "label": m} for m in ("aspen", "birch", "cedar")]
        road = fleet.view(srcs, ms, {})["roadstead"]
        self.assertEqual(len(road["open"]["ships"]), 3)
        self.assertEqual(len(road["call"]["ships"]), 3)
        self.assertTrue(road["open"]["open"])
        self.assertFalse(road["call"]["open"])
        many = fleet.view(srcs, [{"id": "m%d" % i} for i in range(9)], {})
        self.assertEqual(len(many["roadstead"]["open"]["ships"]), 6)
        self.assertIsNotNone(many["roadstead"]["open"]["convoy"])


NODE = shutil.which("node")
HARNESS = r"""
const s = require(process.argv[1]);
const out = {};
for (const [k, f] of Object.entries(JSON.parse(process.argv[2]))) out[k] = s[f.fn](...f.args);
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "Node is not installed: the page's sightings are not run")
class Sightings(unittest.TestCase):
    def run_js(self, calls):
        out = subprocess.run([NODE, "-e", HARNESS, str(ROOT / "web" / "sightings.js"), json.dumps(calls)],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def entry(self, i, kind, at, status="shown", **kw):
        return dict({"id": "w%d" % i, "kind": kind, "at": at, "text": "%s %d" % (kind, i), "status": status, "why": None}, **kw)

    def test_kinds_of_an_entry(self):
        r = self.run_js({
            "landing": {"fn": "sightKinds", "args": [self.entry(1, "landing", 10)]},
            "dolphins": {"fn": "sightKinds", "args": [self.entry(2, "dolphins", 10)]},
            "walk": {"fn": "sightKinds", "args": [self.entry(3, "walk", 10)]},
            "replay": {"fn": "sightKinds", "args": [self.entry(4, "whale", 10, replay=True)]},
        })
        self.assertEqual(r["landing"], ["longboat"])
        self.assertEqual(r["dolphins"], ["longboat", "dolphins"])
        self.assertEqual(r["walk"], [])
        self.assertEqual(r["replay"], [])

    def test_last_sighting_per_kind(self):
        old, new = self.entry(1, "whale", 100), self.entry(2, "whale", 200)
        told = self.entry(3, "rainbow", 300, status="words", why="a critical is open")
        r = self.run_js({
            "newer_wins": {"fn": "noteSighting", "args": [{"whale": {"at": 100, "id": "w1"}}, new]},
            "older_kept_out": {"fn": "noteSighting", "args": [{"whale": {"at": 200, "id": "w2", "text": "whale 2"}}, old]},
            "same_entry_moves_on": {"fn": "noteSighting", "args": [{"rainbow": {"at": 300, "id": "w3", "status": "queued"}}, told]},
            "dolphins_count_twice": {"fn": "noteSighting", "args": [{}, self.entry(4, "dolphins", 400)]},
            "replay_never_counts": {"fn": "noteSighting", "args": [{}, self.entry(5, "landing", 500, replay=True)]},
        })
        self.assertEqual(r["newer_wins"]["whale"]["id"], "w2")
        self.assertEqual(r["older_kept_out"]["whale"]["id"], "w2")
        self.assertEqual(r["same_entry_moves_on"]["rainbow"]["status"], "words")
        self.assertEqual(r["same_entry_moves_on"]["rainbow"]["why"], "a critical is open")
        self.assertEqual(sorted(r["dolphins_count_twice"]), ["dolphins", "longboat"])
        self.assertEqual(r["replay_never_counts"], {})

    def test_replay_picks_the_newest_real_event_only(self):
        play = {"kind": "whale", "lane": "horizon"}
        log = [self.entry(9, "replay", 900, replay=True), self.entry(8, "walk", 800), self.entry(7, "whale", 700, play=play),
               self.entry(6, "landing", 600, play={"kind": "landing", "lane": "ship", "n": 1})]
        gull_off = self.entry(5, "gulls", 500, play={"kind": "gulls", "lane": "ship", "machine": "birch", "to": False})
        r = self.run_js({
            "newest": {"fn": "replayPick", "args": [log, {}]},
            "none": {"fn": "replayPick", "args": [[], {}]},
            "only_walks": {"fn": "replayPick", "args": [[self.entry(1, "walk", 1), self.entry(2, "becalmed", 2)], {}]},
            "no_play_record": {"fn": "replayPick", "args": [[self.entry(3, "whale", 3), self.entry(2, "whale", 2, play=play)], {}]},
            "gulls_as_left": {"fn": "replayPick", "args": [[gull_off], {"birch": False}]},
            "gulls_moved_on": {"fn": "replayPick", "args": [[gull_off, self.entry(4, "whale", 400, play=play)], {"birch": True}]},
        })
        self.assertEqual(r["newest"]["id"], "w7")
        self.assertIsNone(r["none"])
        self.assertIsNone(r["only_walks"])
        self.assertIsNone(r["no_play_record"])      # never an older event instead
        self.assertEqual(r["gulls_as_left"]["id"], "w5")
        self.assertIsNone(r["gulls_moved_on"])      # never an older event instead


if __name__ == "__main__":
    unittest.main()
