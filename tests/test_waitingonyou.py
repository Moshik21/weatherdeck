"""Acceptance test for the one waiting-on-you number (readability pass, slice 1): alarms and FYIs are never part of it.

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_frontdoor.py (CONTRIBUTING.md, "Tests"), for the view contract and
the page's pure counting rule only. Over one synthetic fixture of 1 critical, 5 action and 1 info card, the host's
`counts.waiting_on_you` is 5, and the page's rule (`web/frontdoor.js`: `cardTier`, `askRows`, `waitingOnYou`, `badgeCounts`) gives the
call band, the Lists header, the Bridge door and the ship plates the same 5, and the same 6 once one more ask row is appended; the
critical is a Problem only and the info card an FYI only.
Synthetic sources, machines and titles, standard library only, no network: the feeds go in through the public `weatherdeck ingest`
into a temporary data directory and the view is built from there. The page rule runs in Node when Node is installed and is skipped
otherwise.
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


def card(cid, severity, kind="decision", **kw):
    return dict({"id": cid, "kind": kind, "severity": severity, "title": "Synthetic " + cid, "since": "2027-01-15T07:00:00Z"}, **kw)


# Two homes on two machines: atlas (keel) raises 3 calls and the critical, borealis (spar) 2 calls and the info card.
FEEDS = [
    {"schema": "lookout.feed", "schema_version": "1.8", "generated_at": "2027-01-15T08:00:00Z",
     "source": {"id": "atlas", "machine": "keel"},
     "items": [{"id": "atlas-lane", "title": "Atlas lane", "state": "running"}],
     "attention": [card("hold:atlas/release-cinder", "action"), card("hold:atlas/rename-cinder", "action", kind="approval"),
                   card("atlas-merge", "action", kind="approval"),
                   card("service:supervision:atlas", "critical", kind="service", detail="heartbeat 400s old")]},
    {"schema": "lookout.feed", "schema_version": "1.8", "generated_at": "2027-01-15T08:00:00Z",
     "source": {"id": "borealis", "machine": "spar"},
     "items": [{"id": "borealis-lane", "title": "Borealis lane", "state": "running"}],
     "attention": [card("borealis-key", "action", kind="credential"), card("borealis-choice", "action"),
                   card("quota:borealis", "info", kind="capacity")]},
]
CALLS = {"hold:atlas/release-cinder", "hold:atlas/rename-cinder", "atlas-merge", "borealis-key", "borealis-choice"}
BUILD = "import json, sys; from weatherdeck import view; v = view.build(); json.dump({k: v[k] for k in ('counts', 'attention', 'sources')}, sys.stdout)"


class OneNumber(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        env = dict(os.environ, WEATHERDECK_DATA=tmp.name, PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "src"))
        for f in FEEDS:
            out = subprocess.run([sys.executable, str(ROOT / "bin" / "weatherdeck"), "ingest"], input=json.dumps(f),
                                 capture_output=True, text=True, env=env, timeout=60)
            assert out.returncode == 0 and out.stdout.startswith("ok"), out.stdout + out.stderr
        out = subprocess.run([sys.executable, "-c", BUILD], capture_output=True, text=True, env=env, timeout=60)
        assert out.returncode == 0, out.stderr
        cls.view = json.loads(out.stdout)

    def run_js(self, calls):
        out = subprocess.run([NODE, "-e", HARNESS, str(ROOT / "web" / "frontdoor.js"), json.dumps(calls)],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_the_host_counts_the_calls_only(self):
        counts, att = self.view["counts"], self.view["attention"]
        self.assertEqual(sorted(a["severity"] for a in att), ["action"] * 5 + ["critical", "info"])
        self.assertEqual(counts["waiting_on_you"], 5)
        self.assertEqual(counts["calls"], counts["waiting_on_you"])

    @unittest.skipUnless(NODE, "Node is not installed: the page's counting rule is not run")
    def test_band_lists_bridge_and_plates_show_the_same_number(self):
        att = self.view["attention"]
        tiers = self.run_js({a["id"]: {"fn": "cardTier", "args": [a]} for a in att})
        calls = [a for a in att if tiers[a["id"]] == "call"]
        # The call band and the Lists header both show the call list's length.
        self.assertEqual({a["id"] for a in calls}, CALLS)
        # The Bridge lists each card under its tier, plus rows that are never counted (an unverified share, an unconfirmed alert).
        rows = [{"tier": tiers[a["id"]]} for a in att] + [{"tier": "also"}, {"tier": "also"}]
        sources = self.view["sources"]
        res = self.run_js({"bridge": {"fn": "waitingOnYou", "args": [rows]},
                           "keel": {"fn": "badgeCounts", "args": ["keel", {"calls": calls, "critical": [a for a in att if tiers[a["id"]] == "alarm"], "off": [], "sources": sources}]},
                           "spar": {"fn": "badgeCounts", "args": ["spar", {"calls": calls, "critical": [a for a in att if tiers[a["id"]] == "alarm"], "off": [], "sources": sources}]}})
        self.assertEqual(res["bridge"], 5)
        self.assertEqual(res["keel"]["calls"] + res["spar"]["calls"], 5)
        self.assertEqual(len(calls), self.view["counts"]["waiting_on_you"])
        # The critical is counted as trouble on its own machine's plate, never as a call.
        self.assertEqual(res["keel"], {"calls": 3, "trouble": 1})
        self.assertEqual(res["spar"], {"calls": 2, "trouble": 0})

    @unittest.skipUnless(NODE, "Node is not installed: the page's counting rule is not run")
    def test_an_appended_ask_moves_all_four_places_together(self):
        att = self.view["attention"]
        tiers = self.run_js({a["id"]: {"fn": "cardTier", "args": [a]} for a in att})
        calls = [a for a in att if tiers[a["id"]] == "call"]
        asks = self.run_js({"asks": {"fn": "askRows", "args": [{"calls": calls}]}})["asks"]
        # One more ask from another path (a lane waiting for the viewer's OK, say), appended to the same list of rows.
        asks.append({"tier": "call", "key": "lane:borealis-lane", "machine": "spar", "source": "borealis", "c": {"id": "lane:borealis-lane"}})
        # The Bridge lists the asks plus its Problems, FYIs and the rows that are never counted.
        bridge = asks + [{"tier": tiers[a["id"]]} for a in att if tiers[a["id"]] != "call"] + [{"tier": "also"}]
        crit = [a for a in att if tiers[a["id"]] == "alarm"]
        res = self.run_js({"band": {"fn": "waitingOnYou", "args": [asks]},
                           "lists": {"fn": "waitingOnYou", "args": [asks]},
                           "bridge": {"fn": "waitingOnYou", "args": [bridge]},
                           "keel": {"fn": "badgeCounts", "args": ["keel", {"asks": asks, "critical": crit, "off": [], "sources": self.view["sources"]}]},
                           "spar": {"fn": "badgeCounts", "args": ["spar", {"asks": asks, "critical": crit, "off": [], "sources": self.view["sources"]}]}})
        self.assertEqual((res["band"], res["lists"], res["bridge"], res["keel"]["calls"] + res["spar"]["calls"]), (6, 6, 6, 6))
        self.assertEqual(res["spar"], {"calls": 3, "trouble": 0})

    @unittest.skipUnless(NODE, "Node is not installed: the page's counting rule is not run")
    def test_the_critical_is_a_problem_and_the_info_an_fyi_only(self):
        tiers = self.run_js({a["id"]: {"fn": "cardTier", "args": [a]} for a in self.view["attention"]})
        self.assertEqual(tiers["service:supervision:atlas"], "alarm")
        self.assertEqual(tiers["quota:borealis"], "fyi")
        words = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text(encoding="utf-8"))["labels"]
        # The Bridge heads the critical "Problems" and the info card "FYI"; the sea's alarm says "Problem"; the Lists page's
        # second list is "Problems", never a name that reads like the waiting number.
        self.assertEqual((words["sec_alarm"], words["problem"], words["strip_att"]), ("Problems", "Problem", "Problems"))
        self.assertEqual((words["sec_fyi"], words["fyi"]), ("FYI", "FYI:"))


if __name__ == "__main__":
    unittest.main()
